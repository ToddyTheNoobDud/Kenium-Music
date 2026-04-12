import { createEvent } from 'seyfert'
import { updatePresence } from '../../index'
import { createPlayerConnection } from '../shared/player'
import { getSettingsCollection } from '../utils/db'
import {
  disable247Sync,
  purgeInvalidSettings,
  updateGuildSettingsSync
} from '../utils/db_helper'

const NICKNAME_SUFFIX = ' [24/7]'
const BATCH_SIZE = 10
const BATCH_DELAY = 500
const STARTUP_DELAY = 6000
const AQUA_RETRY_DELAY = 30000

type LoggerLike = {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

type ManagedPlayerLike = {
  destroy?: () => unknown
}

type GuildMemberLike = {
  nickname?: string | null
  user?: { username?: string | null }
  edit?: (options: { nick: string }) => Promise<unknown>
}

type ChannelLike = {
  type?: number
}

type GuildLike = {
  name?: string
  members?: {
    me?: GuildMemberLike
  }
  channels: {
    fetch: (channelId: string) => Promise<ChannelLike | null>
  }
}

type SettingsLike = {
  _id?: string
  guildId?: string
  voiceChannelId?: string | null
  textChannelId?: string | null
  twentyFourSevenEnabled?: boolean
}

type DiscordApiErrorLike = {
  body?: { code?: unknown }
  response?: { code?: unknown }
  metadata?: {
    response?: { code?: unknown }
    code?: unknown
    detail?: unknown
  }
  message?: unknown
  code?: unknown
}

type BotReadyClient = Parameters<typeof updatePresence>[0] &
  Parameters<typeof createPlayerConnection>[0] & {
    botId?: string
    aqua: Parameters<typeof createPlayerConnection>[0]['aqua'] & {
      initiated?: boolean
      leastUsedNodes?: unknown[]
      players?: {
        get: (guildId: string) => ManagedPlayerLike | undefined
      }
      init: (botId: string) => Promise<unknown>
    }
    logger: LoggerLike
    guilds: {
      fetch: (guildId: string) => Promise<unknown>
    }
  }

let settingsCollection: ReturnType<typeof getSettingsCollection> | null = null
let clientInstance: BotReadyClient | null = null
let autoJoinStarted = false
let aquaRetryTimer: NodeJS.Timeout | null = null

const extractDiscordApiCode = (err: DiscordApiErrorLike): number | null => {
  const candidates = [
    err?.body?.code,
    err?.response?.code,
    err?.metadata?.response?.code,
    err?.metadata?.code
  ]

  for (const candidate of candidates) {
    const value = Number(candidate)
    if (Number.isFinite(value)) return value
  }

  const text = String(err?.metadata?.detail || err?.message || err?.code || '')
  const directMatch = text.match(/\b(10003|10004|50001|50013)\b/)
  if (directMatch?.[1]) return Number(directMatch[1])

  const suffixMatch = String(err?.code || '').match(/_(\d{5})$/)
  if (suffixMatch?.[1]) return Number(suffixMatch[1])

  return null
}

const getSettings = () => {
  if (!settingsCollection) settingsCollection = getSettingsCollection()
  return settingsCollection
}

const hasReadyAqua = (client: BotReadyClient) =>
  !!(
    client.aqua?.initiated &&
    Array.isArray(client.aqua?.leastUsedNodes) &&
    client.aqua.leastUsedNodes.length > 0
  )

const updateNickname = async (guild: {
  members?: { me?: GuildMemberLike }
}) => {
  const botMember = guild.members?.me
  if (!botMember) return

  const currentNick = botMember.nickname || botMember.user?.username || ''
  if (currentNick.includes(NICKNAME_SUFFIX)) return

  try {
    await botMember.edit?.({ nick: currentNick + NICKNAME_SUFFIX })
  } catch {}
}

const disable247ForGuild = async (guildId: string, reason: string) => {
  try {
    if (guildId && /^\d+$/.test(guildId)) {
      disable247Sync(guildId, reason)
    }

    const player = clientInstance?.aqua?.players?.get(guildId)
    player?.destroy?.()

    clientInstance?.logger?.info(
      `[24/7] Disabled for guild ${guildId}: ${reason}`
    )
  } catch (err) {
    clientInstance?.logger?.error(`[24/7] Disable failed for ${guildId}:`, err)
  }
}

const clearInvalidTextChannel = async (
  guildId: string,
  textChannelId: string
) => {
  try {
    updateGuildSettingsSync(guildId, { textChannelId: null })
    clientInstance?.logger?.info(
      `[24/7] Cleared invalid text channel ${textChannelId} for guild ${guildId}.`
    )
  } catch (err) {
    clientInstance?.logger?.error(
      `[24/7] Failed to clear text channel ${textChannelId} for ${guildId}:`,
      err
    )
  }
}

const processGuild = async (client: BotReadyClient, settings: SettingsLike) => {
  const guildId = String(settings._id || settings.guildId || '')
  if (!guildId) return

  const voiceChannelId = settings.voiceChannelId
  const textChannelId = settings.textChannelId || null

  if (!voiceChannelId) {
    await disable247ForGuild(guildId, 'missing voice channel id')
    return
  }

  const guild = await client.guilds.fetch(guildId).catch((err: unknown) => {
    const apiCode = extractDiscordApiCode(err as DiscordApiErrorLike)
    if (apiCode === 10004 || apiCode === 50001 || apiCode === 50013) {
      client.logger.warn(
        `[24/7] Guild ${guildId} is inaccessible (${apiCode}). Removing invalid 24/7 settings.`
      )
      void disable247ForGuild(guildId, `Guild fetch failed ${apiCode}`)
      return null
    }

    client.logger.warn(
      `[24/7] Failed to fetch guild ${guildId}: ${err instanceof Error ? err.message : String(err)}`
    )
    return null
  })

  if (!guild) return
  const guildLike = guild as GuildLike

  const [voiceChannel, textChannel] = await Promise.all([
    guildLike.channels.fetch(voiceChannelId).catch(() => null),
    textChannelId
      ? guildLike.channels.fetch(textChannelId).catch(() => null)
      : null
  ])

  if (!voiceChannel || (voiceChannel.type !== 2 && voiceChannel.type !== 13)) {
    client.logger.warn(
      `[24/7] ${guildLike.name} (${guildId}): Voice channel ${voiceChannelId} is invalid or missing.`
    )
    await disable247ForGuild(
      guildId,
      `Voice channel ${voiceChannelId} is invalid or missing`
    )
    return
  }

  const validTextTypes = [0, 5, 10, 11, 12]
  const canUseText =
    !!textChannel &&
    !!textChannelId &&
    validTextTypes.includes(textChannel.type ?? -1)
  if (textChannelId && !canUseText) {
    client.logger.warn(
      `[24/7] ${guildLike.name} (${guildId}): Text channel ${textChannelId} is invalid/missing. Proceeding with voice only.`
    )
    await clearInvalidTextChannel(guildId, textChannelId)
  }

  if (!hasReadyAqua(client)) {
    client.logger.warn(
      `[24/7] Skipping rejoin for ${guildId}: Aqua is not connected to any node.`
    )
    return
  }

  try {
    await Promise.all([
      Promise.resolve(
        createPlayerConnection(client, {
          guildId,
          voiceChannel: voiceChannelId,
          ...(canUseText ? { textChannel: textChannelId } : {})
        })
      ),
      updateNickname(guildLike)
    ])
  } catch (err) {
    client.logger.warn(
      `[24/7] Failed to create player for ${guildId}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

const processAutoJoin = async (client: BotReadyClient) => {
  if (autoJoinStarted) return
  if (!hasReadyAqua(client)) {
    client.logger.warn(
      '[24/7] Auto-join skipped: Aqua has no connected Lavalink node yet.'
    )
    return
  }
  autoJoinStarted = true
  client.logger.info('[24/7] Scanning database for 24/7 guilds...')

  const enabled = getSettings().find(
    {
      twentyFourSevenEnabled: true,
      voiceChannelId: { $ne: null }
    },
    {
      fields: [
        '_id',
        'guildId',
        'voiceChannelId',
        'textChannelId',
        'twentyFourSevenEnabled'
      ]
    }
  ) as SettingsLike[]

  if (!enabled?.length) {
    client.logger.info('[24/7] No guilds found to rejoin.')
    return
  }

  client.logger.info(
    `[24/7] Found ${enabled.length} guilds. Preparing to rejoin...`
  )

  for (let i = 0; i < enabled.length; i += BATCH_SIZE) {
    const batch = enabled.slice(i, i + BATCH_SIZE)
    client.logger.info(
      `[24/7] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}...`
    )
    await Promise.allSettled(
      batch.map((settings) => processGuild(client, settings))
    )

    if (i + BATCH_SIZE < enabled.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY))
    }
  }

  client.logger.info('[24/7] Startup auto-join process finished.')
}

const scheduleAquaRetry = (client: BotReadyClient) => {
  if (aquaRetryTimer) clearTimeout(aquaRetryTimer)
  aquaRetryTimer = setTimeout(() => {
    aquaRetryTimer = null
    void tryInitAqua(client)
  }, AQUA_RETRY_DELAY)
  aquaRetryTimer.unref?.()
}

const tryInitAqua = async (client: BotReadyClient) => {
  if (!client.botId) return false
  if (hasReadyAqua(client)) return true
  try {
    await client.aqua.init(client.botId)
    client.logger.info('[Aqua] Connected to Lavalink node(s).')
    if (!autoJoinStarted) {
      setTimeout(() => void processAutoJoin(client), STARTUP_DELAY)
    }
    return true
  } catch (err) {
    client.logger.warn(
      `[Aqua] Init failed: ${err instanceof Error ? err.message : String(err)}. Retrying in ${AQUA_RETRY_DELAY / 1000}s.`
    )
    scheduleAquaRetry(client)
    return false
  }
}

export default createEvent({
  data: { once: true, name: 'botReady' },
  run: async (user, client) => {
    const readyClient = client as unknown as BotReadyClient
    clientInstance = readyClient
    if (!readyClient.botId) readyClient.botId = user.id

    await tryInitAqua(readyClient)
    updatePresence(readyClient)
    readyClient.logger.info(`${user.username} is ready`)

    const purged = purgeInvalidSettings()
    if (purged > 0) {
      readyClient.logger.info(
        `[24/7] Purged ${purged} malformed guild settings from database.`
      )
    }

    if (hasReadyAqua(readyClient)) {
      setTimeout(() => void processAutoJoin(readyClient), STARTUP_DELAY)
    }
  }
})
