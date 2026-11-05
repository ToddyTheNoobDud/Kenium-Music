import {
  type Client,
  createEvent,
  PresenceUpdateStatus,
  type UsingClient
} from 'seyfert'
import { APP_VERSION } from '../shared/constants.ts'
import { extractDiscordApiCode } from '../shared/errorGuard.ts'
import { createPlayerConnection } from '../shared/player.ts'
import { isSupportedVoiceChannelType } from '../shared/voiceLifecycle.ts'
import { getSettingsCollection } from '../utils/db.ts'
import {
  purgeInvalidSettings,
  updateGuildSettingsSync
} from '../utils/db_helper.ts'
import {
  disableTwentyFourSevenForUnknownChannel,
  isVoiceGatewayHealthy,
  refresh247Cache,
  registerVoiceManager,
  requestTwentyFourSevenRecovery,
  setAutoJoinRunning
} from './voiceStateUpdate.ts'

export const presenceState = {
  presenceInterval: null as ReturnType<typeof setInterval> | null,
  cachedGuildCount: 0,
  cachedUserCount: 0,
  lastCountUpdate: 0
}

const PRESENCE_UPDATE_INTERVAL = 60000
const COUNT_CACHE_TTL = 300000
const PRESENCE_ACTIVITIES = [
  {
    name: `⚡ Kenium ${APP_VERSION} ⚡`,
    type: 1,
    url: 'https://www.youtube.com/watch?v=tSFp2ESLxyU'
  },
  {
    name: '{users} users',
    type: 1,
    url: 'https://www.youtube.com/watch?v=tSFp2ESLxyU'
  },
  {
    name: '{guilds} servers',
    type: 1,
    url: 'https://www.youtube.com/watch?v=tSFp2ESLxyU'
  }
]

export const updatePresence = (client: Client<true>) => {
  if (presenceState.presenceInterval) {
    clearInterval(presenceState.presenceInterval)
  }
  let activityIndex = 0
  presenceState.presenceInterval = setInterval(() => {
    if (!client.me?.id) {
      return
    }
    const now = Date.now()
    if (now - presenceState.lastCountUpdate > COUNT_CACHE_TTL) {
      presenceState.cachedGuildCount = client.cache.guilds?.count() ?? 0
      const guilds = client.cache.guilds?.values() ?? []
      presenceState.cachedUserCount = guilds.reduce(
        (total, guild) => total + (guild.memberCount ?? 0),
        0
      )
      presenceState.lastCountUpdate = now
    }
    // biome-ignore lint/style/noNonNullAssertion: the index wraps at the activity count
    const activity = PRESENCE_ACTIVITIES[activityIndex]!
    activityIndex = (activityIndex + 1) % PRESENCE_ACTIVITIES.length
    const name = activity.name
      .replace('{users}', String(presenceState.cachedUserCount))
      .replace('{guilds}', String(presenceState.cachedGuildCount))
    client.gateway.setPresence({
      activities: [{ ...activity, name }],
      status: PresenceUpdateStatus.Idle,
      since: now,
      afk: true
    })
  }, PRESENCE_UPDATE_INTERVAL)
  presenceState.presenceInterval.unref()
}

const NICKNAME_SUFFIX = ' [24/7]'
const BATCH_SIZE = 2
const BATCH_DELAY = 4000
const BATCH_JITTER = 2000
const HEALTH_WAIT_MS = 5000
const HEALTH_MAX_WAITS = 12
const STARTUP_DELAY = 12000
const PURGE_DELAY = 6000
const AQUA_RETRY_DELAY = 30000

type SavedVoiceSettings = {
  _id?: string
  guildId?: string
  voiceChannelId?: string | null
  textChannelId?: string | null
  twentyFourSevenEnabled?: boolean
}

let autoJoinStarted = false
let playersLoaded = false
let aquaRetryTimer: NodeJS.Timeout | null = null

const hasReadyAqua = (client: UsingClient) =>
  client.aqua.initiated && client.aqua.leastUsedNodes.length > 0

// aqualink v4 requires an explicit loadPlayers() call to restore the
// players that savePlayer() wrote on the previous shutdown. Without it
// the saved file is never read and non-24/7 sessions are lost on reboot.
// loadPlayers skips guilds that already have a player, so running it
// before the 24/7 auto-join sweep is safe for 24/7 guilds too.
const restoreSavedPlayers = async (client: UsingClient): Promise<void> => {
  if (playersLoaded || !hasReadyAqua(client)) {
    return
  }
  playersLoaded = true
  try {
    await client.aqua.loadPlayers()
    client.logger.info('[Aqua] Restored saved players from disk.')
  } catch (err) {
    playersLoaded = false
    const error = err as NodeJS.ErrnoException
    if (error?.code === 'ENOENT') {
      client.logger.info('[Aqua] No saved players file found, starting fresh.')
      return
    }
    client.logger.warn(
      `[Aqua] Failed to load saved players: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

const updateNickname = async (
  guild: Awaited<ReturnType<UsingClient['guilds']['fetch']>>,
  botId: string
) => {
  try {
    const botMember = await guild.members.fetch(botId)
    const currentNick = botMember.nick || botMember.user.username
    if (!currentNick.includes(NICKNAME_SUFFIX)) {
      await botMember.edit({ nick: currentNick + NICKNAME_SUFFIX })
    }
  } catch {}
}

const clearInvalidTextChannel = async (
  client: UsingClient,
  guildId: string,
  textChannelId: string
) => {
  try {
    updateGuildSettingsSync(guildId, { textChannelId: null })
    client.logger.info(
      `[24/7] Cleared invalid text channel ${textChannelId} for guild ${guildId}.`
    )
  } catch (err) {
    client.logger.error(
      `[24/7] Failed to clear text channel ${textChannelId} for ${guildId}:`,
      err
    )
  }
}

export const processGuild = async (
  client: UsingClient,
  settings: SavedVoiceSettings
) => {
  const guildId = String(settings._id || settings.guildId || '')
  if (!guildId) {
    return
  }
  if (!isVoiceGatewayHealthy()) {
    return
  }

  const voiceChannelId = settings.voiceChannelId
  const textChannelId = settings.textChannelId || null

  if (!voiceChannelId) {
    client.logger.warn(
      `[24/7] Missing saved voice channel for ${guildId}; keeping 24/7 settings.`
    )
    return
  }

  const guild = await client.guilds.fetch(guildId).catch((err: unknown) => {
    if (extractDiscordApiCode(err) === 10004) {
      updateGuildSettingsSync(guildId, {
        twentyFourSevenEnabled: false,
        last247DisableReason: 'unknown_guild'
      })
      client.logger.info(
        `[24/7] Disabled 24/7 for unknown guild ${guildId} (Discord 10004).`
      )
      return null
    }
    client.logger.warn(
      `[24/7] Failed to fetch guild ${guildId}: ${err instanceof Error ? err.message : String(err)}`
    )
    return null
  })

  if (!guild) {
    return
  }

  const [voiceChannel, textChannel] = await Promise.all([
    guild.channels.fetch(voiceChannelId, true).catch(async (err: unknown) => {
      if (extractDiscordApiCode(err) === 10003) {
        await disableTwentyFourSevenForUnknownChannel(
          client,
          guildId,
          voiceChannelId
        )
        return null
      }
      client.logger.warn(
        `[24/7] Failed to fetch voice channel ${voiceChannelId} for ${guildId}; keeping 24/7 settings: ${err instanceof Error ? err.message : String(err)}`
      )
      return undefined
    }),
    textChannelId
      ? guild.channels.fetch(textChannelId).catch((err: unknown) => {
          if (extractDiscordApiCode(err) === 10003) {
            return null
          }
          client.logger.warn(
            `[24/7] Failed to fetch text channel ${textChannelId} for ${guildId}; keeping its saved ID: ${err instanceof Error ? err.message : String(err)}`
          )
          return undefined
        })
      : null
  ])

  if (voiceChannel == null) {
    return
  }

  if (!isSupportedVoiceChannelType(voiceChannel.type)) {
    client.logger.warn(
      `[24/7] ${guild.name} (${guildId}): Voice channel ${voiceChannelId} is invalid or missing. Keeping 24/7 settings.`
    )
    return
  }

  const validTextTypes = [0, 5, 10, 11, 12]
  const canUseText =
    !!textChannel &&
    !!textChannelId &&
    validTextTypes.includes(textChannel.type ?? -1)
  if (textChannelId && textChannel !== undefined && !canUseText) {
    client.logger.warn(
      `[24/7] ${guild.name} (${guildId}): Text channel ${textChannelId} is invalid/missing. Proceeding with voice only.`
    )
    await clearInvalidTextChannel(client, guildId, textChannelId)
  }

  if (!hasReadyAqua(client)) {
    client.logger.warn(
      `[24/7] Skipping rejoin for ${guildId}: Aqua is not connected to any node.`
    )
    return
  }

  try {
    await Promise.all([
      createPlayerConnection(client, {
        guildId,
        voiceChannel: voiceChannelId,
        ...(canUseText ? { textChannel: textChannelId } : {})
      }),
      updateNickname(guild, client.botId)
    ])
  } catch (err) {
    client.logger.warn(
      `[24/7] Failed to create player for ${guildId}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

export const processAutoJoin = async (client: UsingClient) => {
  if (!hasReadyAqua(client)) {
    autoJoinStarted = false
    client.logger.warn(
      '[24/7] Waiting for a ready Lavalink node before auto-join.'
    )
    await tryInitAqua(client)
    return
  }

  const enabled = getSettingsCollection().find(
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
  ) as SavedVoiceSettings[]

  if (!enabled?.length) {
    client.logger.info('[24/7] No guilds found to rejoin.')
    setAutoJoinRunning(false)
    return
  }

  client.logger.info(
    `[24/7] Found ${enabled.length} guilds. Preparing to rejoin...`
  )

  setAutoJoinRunning(true)
  try {
    for (
      let batchStart = 0;
      batchStart < enabled.length;
      batchStart += BATCH_SIZE
    ) {
      let waits = 0
      while (!isVoiceGatewayHealthy() && waits < HEALTH_MAX_WAITS) {
        waits += 1
        await new Promise((resolve) => setTimeout(resolve, HEALTH_WAIT_MS))
      }
      if (!isVoiceGatewayHealthy()) {
        client.logger.warn(
          '[24/7] Auto-join aborted: shard unhealthy. Remaining guilds will be covered by reconnect recovery.'
        )
        break
      }

      const batch = enabled.slice(batchStart, batchStart + BATCH_SIZE)

      for (const settings of batch) {
        await processGuild(client, settings)
      }

      if (batchStart + BATCH_SIZE < enabled.length) {
        const jitter = Math.floor(Math.random() * BATCH_JITTER)
        await new Promise((resolve) =>
          setTimeout(resolve, BATCH_DELAY + jitter)
        )
      }
    }
  } finally {
    setAutoJoinRunning(false)
  }

  client.logger.info('[24/7] Startup auto-join process finished.')
  requestTwentyFourSevenRecovery(client, 'startup')
}

const scheduleAquaRetry = (client: UsingClient) => {
  if (aquaRetryTimer) {
    clearTimeout(aquaRetryTimer)
  }
  aquaRetryTimer = setTimeout(() => {
    aquaRetryTimer = null
    void tryInitAqua(client)
  }, AQUA_RETRY_DELAY)
  aquaRetryTimer.unref()
}

const tryInitAqua = async (client: UsingClient) => {
  if (!client.botId) {
    return false
  }
  try {
    if (!hasReadyAqua(client)) {
      await client.aqua.init(client.botId)
      client.logger.info('[Aqua] Connected to Lavalink node(s).')
    }
    if (!autoJoinStarted) {
      const startAutoJoin = async () => {
        if (autoJoinStarted) {
          return
        }
        autoJoinStarted = true
        // Restore saved sessions first; auto-join then fills the gaps.
        await restoreSavedPlayers(client)
        setTimeout(() => void processAutoJoin(client), STARTUP_DELAY)
      }
      if (hasReadyAqua(client)) {
        void startAutoJoin()
      } else {
        client.aqua.once('nodeReady', () => void startAutoJoin())
      }
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
    if (!client.botId) {
      client.botId = user.id
    }

    registerVoiceManager(client)
    refresh247Cache()

    await tryInitAqua(client)
    updatePresence(client)
    client.logger.info(`${user.username} is ready`)

    setTimeout(async () => {
      const purged = await purgeInvalidSettings()
      if (purged > 0) {
        client.logger.info(
          `[24/7] Purged ${purged} malformed guild settings from database.`
        )
      }
    }, PURGE_DELAY)

    await client.me?.fetch()
  }
})
