import {
  type Client,
  createEvent,
  PresenceUpdateStatus,
  type UsingClient
} from 'seyfert'
import { APP_VERSION } from '../shared/constants.ts'
import { purgeInvalidSettings } from '../utils/db_helper.ts'
import {
  refresh247Cache,
  registerVoiceManager,
  requestTwentyFourSevenRecovery,
  setStartupRecoveryPending
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

const STARTUP_DELAY = 12000
const PURGE_DELAY = 6000
const AQUA_RETRY_DELAY = 30000

let startupStarted = false
let aquaRetryTimer: ReturnType<typeof setTimeout> | null = null

const hasReadyAqua = (client: UsingClient) =>
  client.aqua.initiated && client.aqua.leastUsedNodes.length > 0

const restoreSavedPlayers = async (client: UsingClient): Promise<void> => {
  if (startupStarted) {
    return
  }
  startupStarted = true
  try {
    await client.aqua.loadPlayers()
    client.logger.info('[Aqua] Restored saved players from disk.')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      client.logger.info('[Aqua] No saved players file found, starting fresh.')
    } else {
      client.logger.warn(
        `[Aqua] Failed to load saved players: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  setTimeout(() => {
    setStartupRecoveryPending(false)
    requestTwentyFourSevenRecovery(client, 'startup')
  }, STARTUP_DELAY)
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
    if (hasReadyAqua(client)) {
      void restoreSavedPlayers(client)
    } else {
      client.aqua.once('nodeReady', () => void restoreSavedPlayers(client))
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
