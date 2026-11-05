import process from 'node:process'
import 'dotenv/config'
import { cooldown } from '@slipher/cooldown'
import { Aqua, type Player, type Track } from 'aqualink'
import {
  Client,
  definePlugins,
  LimitedMemoryAdapter,
  type Message,
  type ParseClient,
  type ParseLocales
} from 'seyfert'
import { lru } from 'tiny-lru'
import seyfertConfig from './seyfert.config.ts'
import {
  cleanupAllKaraokeSessions,
  cleanupKaraokeSession,
  hasKaraokeSession,
  resyncKaraokeSession,
  syncKaraokeSessionTrack
} from './src/commands/karaoke.ts'
import { presenceState } from './src/events/botReady.ts'
import {
  dropPendingPlaylistLoads,
  topUpPlaylistBuffer
} from './src/events/playlistPlayback.ts'
import {
  registerVoiceManager,
  setVoiceGatewayHealthy
} from './src/events/voiceStateUpdate.ts'
import type English from './src/languages/en.ts'
import { middlewares } from './src/middlewares/middlewares.ts'
import { APP_VERSION } from './src/shared/constants.ts'
import {
  createNowPlayingEmbed,
  deleteNowPlayingMessage,
  truncateText
} from './src/shared/nowPlaying.ts'
import { closeDatabase, initDatabase } from './src/utils/db.ts'
import { isTwentyFourSevenEnabled } from './src/utils/db_helper.ts'

const plugins = definePlugins(cooldown())

const VOICE_STATUS_LENGTH = 30
const VOICE_STATUS_THROTTLE = 5000
const NOW_PLAYING_DEDUPE_WINDOW_MS = 2500
const SOCKET_CLOSE_LOG_WINDOW_MS = 30_000

const { NODE_HOST, NODE_PASSWORD, NODE_NAME, NODE_PORT, NODE_SECURE, id } =
  process.env

if (!id) {
  console.error(
    'Discord application ID (id) is not defined in environment variables.'
  )
  process.exit(1)
}

const client = new Client({
  plugins,
  getRC: () => seyfertConfig,
  onShardDisconnect({ shardId, code, reason }) {
    client.logger.warn(`Shard ${shardId} disconnected: ${code} — ${reason}`)
    setVoiceGatewayHealthy(false)
  },
  onShardReconnect({ shardId }) {
    client.logger.info(`Shard ${shardId} WebSocket opened`)
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
    infiniteReconnects: true,
    autoResume: true,
    resumeTimeout: 120,
    leaveOnEnd: false,
    lazyloadPlayer: true,
    send: async (payload) => {
      const shardId = client.gateway.calculateShardId(payload.d.guild_id)
      await client.gateway.send(shardId, payload)
    }
  }
)

const musicClient = Object.assign(client, { aqua })

const state = {
  voiceStatusUpdates: lru<number>(500, 3_600_000), // 500 guilds; 1-hour TTL, lazy expiry
  nowPlayingInflight: new Map<string, Promise<void>>(),
  nowPlayingLastStart: lru<{ trackKey: string; at: number }>(500, 3_600_000), // 500 guilds; 1-hour TTL, lazy expiry
  socketCloseLogs: lru<number>(1000, SOCKET_CLOSE_LOG_WINDOW_MS)
}

const getPlayerTextChannelId = (player: Player) =>
  player.textChannel ||
  (player.nowPlayingMessage as Message | null)?.channelId ||
  null

const shouldLogSocketClose = (guildId: string, code: unknown) => {
  const key = `${guildId}:${String(code ?? 'unknown')}`
  const now = Date.now()
  const lastLog = state.socketCloseLogs.get(key) ?? 0
  if (now - lastLog < SOCKET_CLOSE_LOG_WINDOW_MS) {
    return false
  }
  state.socketCloseLogs.set(key, now)
  return true
}

const cleanupPlayer = (
  player: Player,
  reason?: 'queueEnd' | 'playerDestroy'
) => {
  const guildId = player.guildId
  if (!guildId) {
    return
  }
  state.nowPlayingInflight.delete(guildId)
  if (hasKaraokeSession(guildId)) {
    cleanupKaraokeSession(guildId)
  }
  void deleteNowPlayingMessage(player)

  // An idle 24/7 player keeps its voice status and last track.
  if (isTwentyFourSevenEnabled(guildId) && reason === 'queueEnd') {
    return
  }
  if (player.voiceChannel) {
    client.channels.setVoiceStatus(player.voiceChannel, null).catch(() => {})
  }
  state.voiceStatusUpdates.delete(guildId)
  state.nowPlayingLastStart.delete(guildId)
}

const shutdown = async () => {
  if (presenceState.presenceInterval) {
    clearInterval(presenceState.presenceInterval)
    presenceState.presenceInterval = null
  }
  await aqua.savePlayer().catch((error) => console.error(error))
  await Promise.all(Array.from(aqua.players.values(), deleteNowPlayingMessage))
  await cleanupAllKaraokeSessions().catch((error) => console.error(error))
  closeDatabase()
  process.exit(0)
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
      stageInstances: true,
      // Never read: now-playing/collector messages are held live, and no
      // permission checks run. Disabling skips the write+evict path.
      messages: true,
      overwrites: true
    },
    adapter: new LimitedMemoryAdapter({
      message: { expire: 300_000, limit: 10 },
      voice_state: { expire: 600_000, limit: 5000 },
      member: { expire: 900_000, limit: 10000 },
      channel: { expire: 1_800_000, limit: 5000 },
      user: { expire: 3_600_000, limit: 5000 },
      overwrite: { expire: 3_600_000, limit: 2000 }
    })
  }
})

aqua.on('trackStart', async (player: Player, track: Track | null) => {
  const guildId = player.guildId
  if (!guildId) {
    return
  }
  const activeTrack = player.current || track
  if (!activeTrack) {
    return
  }

  const trackKey = [
    activeTrack.uri,
    activeTrack.identifier,
    activeTrack.title,
    activeTrack.author
  ]
    .filter(Boolean)
    .join('|')
  const lastStart = state.nowPlayingLastStart.get(player.guildId)
  const now = Date.now()
  if (
    trackKey &&
    lastStart?.trackKey === trackKey &&
    now - lastStart.at < NOW_PLAYING_DEDUPE_WINDOW_MS
  ) {
    return
  }

  // Wait for any in-flight handler for this guild, eliminating the has/get race window
  const existingInflight = state.nowPlayingInflight.get(guildId)
  if (existingInflight) {
    await existingInflight.catch(() => null)

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

    await syncKaraokeSessionTrack(guildId, activeTrack)

    const message = player.nowPlayingMessage as Message | null
    const textChannelId = player.textChannel || message?.channelId

    if (!textChannelId) {
      return
    }

    const embed = createNowPlayingEmbed(player, activeTrack, client)
    const messageOptions = { components: [embed], flags: 4096 | 32768 }

    const editedMessage = message
      ? await message.edit(messageOptions).catch(() => null)
      : null
    player.nowPlayingMessage =
      editedMessage ||
      (await client.messages
        .write(textChannelId, messageOptions)
        .catch(() => null))

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
    const current = state.nowPlayingInflight.get(guildId)
    if (current === inflight) {
      state.nowPlayingInflight.delete(guildId)
    }
  })

  state.nowPlayingInflight.set(guildId, inflight)
  await inflight
})

aqua.on('trackError', async (player, track, error) => {
  const payload = error as { exception?: { message?: string } }
  const textChannelId = getPlayerTextChannelId(player)
  if (!textChannelId) {
    return
  }

  const errorMsg = payload.exception?.message || 'Playback failed'
  const fallbackTrack = player.current || track
  const rawTitle =
    fallbackTrack?.info?.title || fallbackTrack?.title || 'Unknown track'
  const title = truncateText(rawTitle, 25)

  await client.messages
    .write(textChannelId, {
      content: `❌ **${title}**: ${truncateText(errorMsg, 50)}`
    })
    .catch(() => {})
})

aqua.on('error', (sourceOrError: unknown, maybeError?: unknown) => {
  const errStr = String(
    maybeError instanceof Error
      ? maybeError.message
      : sourceOrError instanceof Error
        ? sourceOrError.message
        : maybeError || sourceOrError || ''
  )
  // Suppress benign "Unknown Message" 10008 from now-playing edits racing
  // manual message deletes
  if (errStr.includes('10008')) {
    return
  }
  const err =
    maybeError instanceof Error
      ? maybeError
      : sourceOrError instanceof Error
        ? sourceOrError
        : new Error(errStr || 'Unknown Aqualink error')
  client.logger.warn(`[Aqua Error] ${err.message}`)
})

aqua.on('playerDestroy', (player: Player) => {
  dropPendingPlaylistLoads(player)
  cleanupPlayer(player, 'playerDestroy')
})
aqua.on('queueEnd', (player: Player) => {
  cleanupPlayer(player, 'queueEnd')
  void topUpPlaylistBuffer(aqua, player)
})
aqua.on('trackEnd', (player: Player) => {
  void topUpPlaylistBuffer(aqua, player)
})

aqua.on('nodeError', (node, error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Node [${node.name}] error: ${message}`)
})

aqua.on(
  'seek',
  (player: Player, _track: Track | null, payload: { position?: number }) => {
    if (player.guildId) {
      resyncKaraokeSession(player.guildId, payload.position)
    }
  }
)

aqua.on('socketClosed', (player, payload) => {
  if (!player.guildId) {
    return
  }
  const code = payload?.code ?? 'unknown'
  if (!shouldLogSocketClose(player.guildId, code)) {
    return
  }

  client.logger.debug(`Socket closed [${player.guildId}], code: ${code}`)
})

aqua.on('nodeDisconnect', (_, reason) => {
  const details =
    typeof reason === 'string' ? reason : JSON.stringify(reason ?? {})
  client.logger.info(`Node disconnected: ${details}`)
})

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

try {
  await initDatabase()
  await client.start()
  await client.uploadCommands({ cachePath: './commands.json' }).catch(() => {})
  registerVoiceManager(musicClient)
} catch (error) {
  console.error('Startup failed:', error)
  process.exit(1)
}

declare module 'seyfert' {
  interface SeyfertRegistry {
    client: ParseClient<typeof musicClient>
    langs: ParseLocales<typeof English>
    middlewares: typeof middlewares
    plugins: typeof plugins
  }
}
