import { createEvent } from 'seyfert'
import { updatePresence } from '../../index'
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

let settingsCollection: ReturnType<typeof getSettingsCollection> | null = null
let clientInstance: any = null
let autoJoinStarted = false
let aquaRetryTimer: NodeJS.Timeout | null = null

const extractDiscordApiCode = (err: any): number | null => {
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

  const text = String(
    err?.metadata?.detail || err?.message || err?.code || ''
  )
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

const hasReadyAqua = (client: any) =>
  !!(
    client?.aqua?.initiated &&
    Array.isArray(client?.aqua?.leastUsedNodes) &&
    client.aqua.leastUsedNodes.length > 0
  )

const updateNickname = async (guild: any) => {
  const botMember = guild.members?.me
  if (!botMember) return

  const currentNick = botMember.nickname || botMember.user?.username || ''
  if (currentNick.includes(NICKNAME_SUFFIX)) return

  try {
    await botMember.edit({ nick: currentNick + NICKNAME_SUFFIX })
  } catch {}
}

const disable247ForGuild = async (guildId: string, reason: string) => {
  try {
    if (guildId && /^\d+$/.test(guildId)) {
      disable247Sync(guildId, reason)
    }

    const player = clientInstance?.aqua?.players?.get(guildId)
    if (player?.destroy) player.destroy()

    clientInstance?.logger?.info(
      `[24/7] Disabled for guild ${guildId}: ${reason}`
    )
  } catch (err) {
    clientInstance?.logger?.error(`[24/7] Disable failed for ${guildId}:`, err)
  }
}

const clearInvalidTextChannel = async (guildId: string, textChannelId: string) => {
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

const processGuild = async (client: any, settings: any) => {
  const guildId = String(settings?._id || settings?.guildId || '')
  if (!guildId) return

  const voiceChannelId = settings.voiceChannelId
  const textChannelId = settings.textChannelId || null

  if (!voiceChannelId) {
    await disable247ForGuild(guildId, 'missing voice channel id')
    return
  }

  const guild = await client.guilds.fetch(guildId).catch(async (err: any) => {
    const apiCode = extractDiscordApiCode(err)
    if (apiCode === 10004 || apiCode === 50001 || apiCode === 50013) {
      client.logger.warn(
        `[24/7] Guild ${guildId} is inaccessible (${apiCode}). Removing invalid 24/7 settings.`
      )
      await disable247ForGuild(guildId, `Guild fetch failed ${apiCode}`)
      return null
    }

    client.logger.warn(
      `[24/7] Failed to fetch guild ${guildId}: ${err?.message || err}`
    )
    return null
  })

  if (!guild) {
    return
  }

  const [voiceChannel, textChannel] = await Promise.all([
    guild.channels.fetch(voiceChannelId).catch(() => null),
    textChannelId ? guild.channels.fetch(textChannelId).catch(() => null) : null
  ])

  if (!voiceChannel || (voiceChannel.type !== 2 && voiceChannel.type !== 13)) {
    client.logger.warn(
      `[24/7] ${guild.name} (${guildId}): Voice channel ${voiceChannelId} is invalid or missing.`
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
    validTextTypes.includes((textChannel as any).type)
  if (textChannelId && !canUseText) {
    client.logger.warn(
      `[24/7] ${guild.name} (${guildId}): Text channel ${textChannelId} is invalid/missing. Proceeding with voice only.`
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
      client.aqua.createConnection({
        guildId,
        voiceChannel: voiceChannelId,
        ...(canUseText ? { textChannel: textChannelId } : {}),
        deaf: true,
        defaultVolume: 65
      }),
      updateNickname(guild)
    ])
  } catch (err: any) {
    client.logger.warn(
      `[24/7] Failed to create player for ${guildId}: ${err?.message || err}`
    )
  }
}

const processAutoJoin = async (client: any) => {
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
  )

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
    await Promise.allSettled(batch.map((s: any) => processGuild(client, s)))

    if (i + BATCH_SIZE < enabled.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY))
    }
  }

  client.logger.info('[24/7] Startup auto-join process finished.')
}

const scheduleAquaRetry = (client: any) => {
  if (aquaRetryTimer) clearTimeout(aquaRetryTimer)
  aquaRetryTimer = setTimeout(() => {
    aquaRetryTimer = null
    void tryInitAqua(client)
  }, AQUA_RETRY_DELAY)
  aquaRetryTimer.unref?.()
}

const tryInitAqua = async (client: any) => {
  if (!client?.botId) return false
  if (hasReadyAqua(client)) return true
  try {
    await client.aqua.init(client.botId)
    client.logger.info('[Aqua] Connected to Lavalink node(s).')
    if (!autoJoinStarted) {
      setTimeout(() => void processAutoJoin(client), STARTUP_DELAY)
    }
    return true
  } catch (err: any) {
    client.logger.warn(
      `[Aqua] Init failed: ${err?.message || err}. Retrying in ${AQUA_RETRY_DELAY / 1000}s.`
    )
    scheduleAquaRetry(client)
    return false
  }
}

export default createEvent({
  data: { once: true, name: 'botReady' },
  run: async (user, client) => {
    clientInstance = client
    if (!client.botId) client.botId = user.id

    await tryInitAqua(client)
    updatePresence(client as any)
    client.logger.info(`${user.username} is ready`)

    const purged = purgeInvalidSettings()
    if (purged > 0) {
      client.logger.info(
        `[24/7] Purged ${purged} malformed guild settings from database.`
      )
    }

    if (hasReadyAqua(client)) {
      setTimeout(() => void processAutoJoin(client), STARTUP_DELAY)
    }
  }
})
