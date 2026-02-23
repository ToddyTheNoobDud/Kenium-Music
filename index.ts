import process from 'node:process'
import 'dotenv/config'
import { CooldownManager } from '@slipher/cooldown'
import { Aqua, type Player, type Track } from 'aqualink'
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
  hasKaraokeSession
} from './src/commands/karaoke'
import {
  _functions,
  createNowPlayingEmbed
} from './src/events/interactionCreate'
import { handleSocketClosed } from './src/events/voiceStateUpdate'
import type English from './src/languages/en'
import { middlewares } from './src/middlewares/middlewares'
import { flushDatabaseUpdates } from './src/utils/db_helper'
import { closeDatabase, initDatabase } from './src/utils/db'

// Constants
const PRESENCE_UPDATE_INTERVAL = 60000
const VOICE_STATUS_LENGTH = 30
const VOICE_STATUS_THROTTLE = 5000
const COUNT_CACHE_TTL = 30000

const { NODE_HOST, NODE_PASSWORD, NODE_NAME, NODE_PORT, NODE_SECURE, id } =
  process.env
const AQUALINK_TRACE = true

if (!id) {
  console.error('Bot token (id) is not defined in environment variables.')
  process.exit(1)
}

const client = new Client({})


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
  lastVoiceStatusUpdate: 0,
  lastErrorLog: 0,
  cachedGuildCount: 0,
  cachedUserCount: 0,
  lastCountUpdate: 0
}

const cleanupPlayer = (player: Player) => {
  const voiceChannel = player.voiceChannel || player._lastVoiceChannel
  if (voiceChannel)
    client.channels.setVoiceStatus(voiceChannel, null).catch(() => {})
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
    name: '⚡ Kenium 4.9.2 ⚡',
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
      const guilds = clientInstance.cache.guilds?.values() || []
      state.cachedGuildCount = Array.isArray(guilds) ? guilds.length : 0
      state.cachedUserCount = 0
      for (const guild of guilds)
        state.cachedUserCount += guild.memberCount || 0
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

aqua.on('lyricsLine', (_player, _track, payload) => {
  console.log(JSON.stringify(payload))
})

aqua.on(
  'trackStart',
  async (
    player: Player,
    track: Track | null | undefined  ) => {
    const activeTrack = (player.current as Track | null | undefined) || track
    if (!activeTrack) return

    const msg = player.nowPlayingMessage
    const textChannelId = player.textChannel || msg?.channelId

    if (!textChannelId) return

    const embed: Container = createNowPlayingEmbed(player, activeTrack, client)
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

    const now = Date.now()
    if (now - state.lastVoiceStatusUpdate > VOICE_STATUS_THROTTLE) {
      state.lastVoiceStatusUpdate = now
      const title = activeTrack.info?.title || activeTrack.title
      if (title) {
        const status = `⭐ ${_functions.truncateText(title, VOICE_STATUS_LENGTH)} - Kenium 4.9.2`
        client.channels
          .setVoiceStatus(player.voiceChannel, status)
          .catch(() => {})
      }
    }
  }
)

aqua.on(
  'trackError',
  async (
    player: Player,
    track: Track,
    payload: { exception?: { message?: string } }
  ) => {
    const channel = client.cache.channels?.get(player.textChannel)
    if (!channel) return

    const errorMsg = payload.exception?.message || 'Playback failed'
    const title = _functions.truncateText(track.info?.title || track.title, 25)

    await channel.client.messages
      .write(channel.id, {
        content: `❌ **${title}**: ${_functions.truncateText(errorMsg, 50)}`
      })
      .catch(() => {})
  }
)

aqua.on('debug', (source: string, message: string) => {
  client.logger.debug(`[Aqua Debug:${source}] ${message}`)
})

if (AQUALINK_TRACE) {
  const dumpTrace = (label: string, guildId?: string) => {
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

  aqua.on('socketClosed', (player, payload) => {
    dumpTrace(`socketClosed code=${payload?.code}`, player.guildId)
  })

  aqua.on('nodeDisconnect', (_node, reason) => {
    dumpTrace(`nodeDisconnect reason=${JSON.stringify(reason)}`)
  })
}

const cleanupHandler = (player: Player) => cleanupPlayer(player)
aqua.on('playerDestroy', cleanupHandler)
aqua.on('queueEnd', cleanupHandler)

aqua.on('nodeError', (node, error) => {
  console.error(`Node [${node.name}] error: ${error.message}`)
})

aqua.on('socketClosed', (player, payload) => {
  client.logger.debug(
    `Socket closed [${player.guildId}], code: ${payload.code}`
  )
  handleSocketClosed(player.guildId, payload.code, client)
})

aqua.on('nodeDisconnect', (_, reason) => {
  client.logger.info(`Node disconnected: ${reason}`)
})

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

client
  .start()
  .then(async () => {
    await client
      .uploadCommands({ cachePath: './commands.json' })
      .catch(() => {})
    await initDatabase().catch(console.error)
    client.cooldown = new CooldownManager(client as never)
    updatePresence(client)
  })
  .catch((_error) => {
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
