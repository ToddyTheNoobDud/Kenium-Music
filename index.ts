import process from 'node:process'
import 'dotenv/config'
import { CooldownManager } from '@slipher/cooldown'
import { Aqua, AqualinkEvents, type Player, type Track } from 'aqualink'
import {
  Client,
  type Container,
  type HttpClient,
  LimitedMemoryAdapter,
  type ParseClient,
  type ParseLocales,
  type ParseMiddlewares
} from 'seyfert'
import {
  cleanupAllKaraokeSessions,
  cleanupKaraokeSession,
  hasKaraokeSession,
  syncKaraokeSessionTrack
} from './src/commands/karaoke'
import type English from './src/languages/en'
import { middlewares } from './src/middlewares/middlewares'
import { APP_VERSION } from './src/shared/constants'
import { createNowPlayingEmbed, truncateText } from './src/shared/nowPlaying'
import { closeDatabase, initDatabase } from './src/utils/db'
import { flushDatabaseUpdates } from './src/utils/db_helper'

// Constants
const PRESENCE_UPDATE_INTERVAL = 60000
const VOICE_STATUS_LENGTH = 30
const VOICE_STATUS_THROTTLE = 5000
const COUNT_CACHE_TTL = 300000
const RESUMED_NOW_PLAYING_RESTORE_DELAY = 1500
const NOW_PLAYING_DEDUPE_WINDOW_MS = 2500
type CachedGuildCountLike = {
  memberCount?: number
}

const {
  NODE_HOST,
  NODE_PASSWORD,
  NODE_NAME,
  NODE_PORT,
  NODE_SECURE,
  AQUALINK_TRACE,
  id
} = process.env

if (!id) {
  console.error('Bot token (id) is not defined in environment variables.')
  process.exit(1)
}

const client = new Client({
  onShardDisconnect({ shardId, code, reason }) {
    client.logger.warn(`Shard ${shardId} disconnected: ${code} — ${reason}`)
  },
  onShardReconnect({ shardId }) {
    client.logger.info(`Shard ${shardId} reconnected`)
  }
})

const aqua = new Aqua(
  client,
  [
    {
      host: NODE_HOST as string,
      auth: NODE_PASSWORD as string,
      ssl: NODE_SECURE === 'true',
      port: NODE_PORT as string,
      name: NODE_NAME as string
    }
  ],
  {
    defaultSearchPlatform: 'ytsearch',
    restVersion: 'v4',
    shouldDeleteMessage: true,
    infiniteReconnects: true,
    autoResume: true,
    autoRegionMigrate: false,
    loadBalancer: 'random',
    useHttp2: false,
    leaveOnEnd: false,
    debugTrace: false,
    traceMaxEntries: 5000
  }
)

Object.assign(client, { aqua })

const state = {
  presenceInterval: null as NodeJS.Timeout | null,
  voiceStatusUpdates: new Map<string, number>(),
  nowPlayingInflight: new Map<string, Promise<void>>(),
  nowPlayingLastStart: new Map<string, { trackKey: string; at: number }>(),
  lastErrorLog: 0,
  cachedGuildCount: 0,
  cachedUserCount: 0,
  lastCountUpdate: 0
}

const getTrackKey = (track: Track | null | undefined) => {
  if (!track) return ''

  const uri = track.info?.uri || track.uri || ''
  const identifier = track.info?.identifier || track.identifier || ''
  const title = track.info?.title || track.title || ''
  const author = track.info?.author || track.author || ''

  return [uri, identifier, title, author].filter(Boolean).join('|')
}

const cleanupPlayer = (player: Player) => {
  const voiceChannel = player.voiceChannel || player._lastVoiceChannel
  if (voiceChannel)
    client.channels.setVoiceStatus(voiceChannel, null).catch(() => {})
  state.voiceStatusUpdates.delete(player.guildId)
  state.nowPlayingInflight.delete(player.guildId)
  state.nowPlayingLastStart.delete(player.guildId)
  if (hasKaraokeSession(player.guildId)) cleanupKaraokeSession(player.guildId)
}

const shutdown = async () => {
  if (state.presenceInterval) {
    clearInterval(state.presenceInterval)
    state.presenceInterval = null
  }
  await aqua.savePlayer().catch((e) => console.log(e))
  await cleanupAllKaraokeSessions().catch((e) => console.log(e))
  await flushDatabaseUpdates().catch((e) =>
    console.error('Failed to flush pending database updates:', e)
  )
  closeDatabase()
  process.exit(0)
}

// Pre-defined activities to avoid object recreation every interval
const PRESENCE_ACTIVITIES = Object.freeze([
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
])

export const updatePresence = (clientInstance: Client) => {
  if (state.presenceInterval) clearInterval(state.presenceInterval)

  let activityIndex = 0

  const timer = setInterval(() => {
    if (!clientInstance.me?.id) return

    const now = Date.now()
    if (now - state.lastCountUpdate > COUNT_CACHE_TTL) {
      const guilds = clientInstance.cache.guilds as
        | { size?: number; values?: () => Iterable<CachedGuildCountLike> }
        | undefined
      state.cachedGuildCount = 0
      state.cachedUserCount = 0
      if (typeof guilds?.size === 'number') state.cachedGuildCount = guilds.size
      for (const guild of guilds?.values?.() || []) {
        if (typeof guilds?.size !== 'number') state.cachedGuildCount += 1
        state.cachedUserCount += guild.memberCount || 0
      }
      state.lastCountUpdate = now
    }

    const currentActivity = PRESENCE_ACTIVITIES[activityIndex]
    activityIndex = (activityIndex + 1) % PRESENCE_ACTIVITIES.length
    if (!currentActivity) return
    const activityName = currentActivity.name
      .replace('{users}', String(state.cachedUserCount))
      .replace('{guilds}', String(state.cachedGuildCount))

    clientInstance.gateway?.setPresence({
      activities: [{ ...currentActivity, name: activityName }],
      // @ts-expect-error
      status: 'idle',
      since: now,
      afk: true
    })
  }, PRESENCE_UPDATE_INTERVAL)

  if (timer.unref) timer.unref()
  state.presenceInterval = timer as unknown as NodeJS.Timeout
}

client.setServices({
  langs: { default: 'en' },
  middlewares,
  cache: {
    disabledCache: {
      bans: true,
      emojis: true,
      stickers: true,
      roles: true,
      presences: true,
      stageInstances: true
    },
    adapter: new LimitedMemoryAdapter({
      message: { expire: 5 * 60 * 1000, limit: 10 }
    })
  }
})

aqua.on('lyricsFound', (_player, track, payload) => {
  console.log(
    `Lyrics found for ${track.info?.title || track.title}: ${payload.lyrics?.length} lines`
  )
})

aqua.on('lyricsNotFound', (_player, track) => {
  console.log(`Lyrics not found for ${track.info?.title || track.title}`)
})

aqua.on(
  'trackStart',
  async (
    player: Player,
    track: Track | null | undefined,
    payload?: { resumed?: boolean }
  ) => {
    const activeTrack = (player.current as Track | null | undefined) || track
    if (!activeTrack) return

    const trackKey = getTrackKey(activeTrack)
    const lastStart = state.nowPlayingLastStart.get(player.guildId)
    const now = Date.now()
    if (
      trackKey &&
      lastStart?.trackKey === trackKey &&
      now - lastStart.at < NOW_PLAYING_DEDUPE_WINDOW_MS
    ) {
      return
    }

    if (state.nowPlayingInflight.has(player.guildId)) {
      const inflight = state.nowPlayingInflight.get(player.guildId)
      if (inflight) {
        await inflight.catch(() => null)
      }

      const lastAfterWait = state.nowPlayingLastStart.get(player.guildId)
      if (
        trackKey &&
        lastAfterWait?.trackKey === trackKey &&
        Date.now() - lastAfterWait.at < NOW_PLAYING_DEDUPE_WINDOW_MS
      ) {
        return
      }
    }

    const handleTrackStart = async () => {
      state.nowPlayingLastStart.set(player.guildId, {
        trackKey,
        at: Date.now()
      })

      await syncKaraokeSessionTrack(player.guildId, activeTrack)

      if (payload?.resumed && !player.nowPlayingMessage) {
        await new Promise((resolve) =>
          setTimeout(resolve, RESUMED_NOW_PLAYING_RESTORE_DELAY)
        )
      }

      const msg = player.nowPlayingMessage
      const textChannelId = player.textChannel || msg?.channelId

      if (!textChannelId) return

      const embed: Container = createNowPlayingEmbed(
        player,
        activeTrack,
        client
      )
      const messageOptions = { components: [embed], flags: 4096 | 32768 }

      const tryEditNowPlaying = async () => {
        if (!msg?.id) return null
        return (
          (msg.edit
            ? await msg.edit(messageOptions).catch(() => null)
            : await client.messages
                .edit(msg.id, textChannelId, messageOptions)
                .catch(() => null)) || null
        )
      }

      if (msg?.id) {
        const edited = await tryEditNowPlaying()
        if (edited) {
          player.nowPlayingMessage = edited
        } else {
          player.nowPlayingMessage = null
          const newMsg = await client.messages
            .write(textChannelId, messageOptions)
            .catch(() => null)
          if (newMsg) player.nowPlayingMessage = newMsg
        }
      } else {
        const newMsg = await client.messages
          .write(textChannelId, messageOptions)
          .catch(() => null)
        if (newMsg) player.nowPlayingMessage = newMsg
      }

      const lastVoiceStatusUpdate =
        state.voiceStatusUpdates.get(player.guildId) ?? 0
      const statusNow = Date.now()
      if (statusNow - lastVoiceStatusUpdate > VOICE_STATUS_THROTTLE) {
        state.voiceStatusUpdates.set(player.guildId, statusNow)
        const title = activeTrack.info?.title || activeTrack.title
        if (title && player.voiceChannel) {
          const status = `⭐ ${truncateText(title, VOICE_STATUS_LENGTH)} - Kenium ${APP_VERSION}`
          client.channels
            .setVoiceStatus(player.voiceChannel, status)
            .catch(() => {})
        }
      }
    }

    const inflight = handleTrackStart().finally(() => {
      const current = state.nowPlayingInflight.get(player.guildId)
      if (current === inflight) {
        state.nowPlayingInflight.delete(player.guildId)
      }
    })

    state.nowPlayingInflight.set(player.guildId, inflight)
    await inflight
  }
)

aqua.on(
  'trackError',
  async (
    player: Player,
    track: Track | null | undefined,
    payload: { exception?: { message?: string } }
  ) => {
    const channel = client.cache.channels?.get(player.textChannel)
    if (!channel) return

    const errorMsg = payload.exception?.message || 'Playback failed'
    const fallbackTrack = (player.current as Track | null | undefined) || track
    const rawTitle =
      fallbackTrack?.info?.title || fallbackTrack?.title || 'Unknown track'
    const title = truncateText(rawTitle, 25)

    await channel.client.messages
      .write(channel.id, {
        content: `❌ **${title}**: ${truncateText(errorMsg, 50)}`
      })
      .catch(() => {})
  }
)

aqua.on('debug', (source: string, message: string) => {
  client.logger.debug(`[Aqua Debug:${source}] ${message}`)
})

aqua.on('error', (sourceOrError: unknown, maybeError?: unknown) => {
  const errStr = String(
    maybeError instanceof Error
      ? maybeError.message
      : sourceOrError instanceof Error
        ? sourceOrError.message
        : maybeError || sourceOrError || ''
  )
  // Suppress benign "Unknown Message" 10008 from shouldDeleteMessage
  if (errStr.includes('10008')) return
  const err =
    maybeError instanceof Error
      ? maybeError
      : sourceOrError instanceof Error
        ? sourceOrError
        : new Error(errStr || 'Unknown Aqualink error')
  client.logger.warn(`[Aqua Error] ${err.message}`)
})

let dumpTrace: ((label: string, guildId?: string) => void) | null = null

if (AQUALINK_TRACE) {
  dumpTrace = (label: string, guildId?: string) => {
    const raw = aqua.getTrace(300)
    const rows = guildId
      ? raw.filter(
          (x) =>
            x?.data?.guildId === guildId ||
            x?.data?.guild_id === guildId ||
            x?.data?.g === guildId
        )
      : raw
    console.log(
      `[AquaTrace] ${label} entries=${rows.length}\n${rows
        .map((x) => `${x.seq}|${x.at}|${x.event}|${JSON.stringify(x.data)}`)
        .join('\n')}`
    )
  }
}

const cleanupHandler = (player: Player) => cleanupPlayer(player)
aqua.on('playerDestroy', cleanupHandler)
aqua.on('queueEnd', cleanupHandler)

aqua.on('nodeError', (node, error) => {
  console.error(`Node [${node.name}] error: ${error.message}`)
})

aqua.on('socketClosed', (player, payload) => {
  dumpTrace?.(`socketClosed code=${payload?.code}`, player.guildId)
  client.logger.debug(
    `Socket closed [${player.guildId}], code: ${payload.code}`
  )
})

aqua.on('nodeDisconnect', (_, reason) => {
  dumpTrace?.(`nodeDisconnect reason=${JSON.stringify(reason)}`)
  const details =
    typeof reason === 'string' ? reason : JSON.stringify(reason ?? {})
  client.logger.info(`Node disconnected: ${details}`)
})

// Periodic cleanup of stale state maps to prevent memory leaks
const STATE_CLEANUP_INTERVAL = 300_000 // 5 minutes
const STATE_STALE_THRESHOLD = 3_600_000 // 1 hour
const stateCleanupTimer = setInterval(() => {
  const cutoff = Date.now() - STATE_STALE_THRESHOLD
  for (const [key, ts] of state.voiceStatusUpdates) {
    if (ts < cutoff) state.voiceStatusUpdates.delete(key)
  }
  for (const [key, data] of state.nowPlayingLastStart) {
    if (data.at < cutoff) state.nowPlayingLastStart.delete(key)
  }
}, STATE_CLEANUP_INTERVAL)
if (stateCleanupTimer.unref) stateCleanupTimer.unref()

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

initDatabase()
  .then(() => client.start())
  .then(async () => {
    await client
      .uploadCommands({ cachePath: './commands.json' })
      .catch(() => {})
    client.cooldown = new CooldownManager(client as never)
  })
  .catch((error) => {
    console.error('Startup failed:', error)
    process.exit(1)
  })

declare module 'seyfert' {
  interface UsingClient
    extends ParseClient<Client<true>>,
      ParseClient<HttpClient> {
    aqua: InstanceType<typeof Aqua>
  }
  interface Client<Ready extends boolean> {
    cooldown: CooldownManager
  }
  interface RegisteredMiddlewares
    extends ParseMiddlewares<typeof middlewares> {}
  interface DefaultLocale extends ParseLocales<typeof English> {}
}
