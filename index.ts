import process from 'node:process'
import 'dotenv/config'
import { Client, HttpClient, ParseClient, LimitedMemoryAdapter, ParseMiddlewares, ParseLocales } from 'seyfert'
import { CooldownManager } from '@slipher/cooldown'
import { middlewares } from './src/middlewares/middlewares'
import { Aqua } from 'aqualink'
import { createNowPlayingEmbed, _functions } from './src/events/interactionCreate'
import English from './src/languages/en'
import { hasKaraokeSession, cleanupKaraokeSession } from './src/commands/karaoke'
// Constants
const PRESENCE_UPDATE_INTERVAL = 60000
const VOICE_STATUS_LENGTH = 30
const VOICE_STATUS_THROTTLE = 5000
const ERROR_LOG_THROTTLE = 5000
const COUNT_CACHE_TTL = 30000

const { NODE_HOST, NODE_PASSWORD, NODE_PORT, NODE_NAME, NODE_SECURE, id } = process.env

if (!NODE_HOST || !NODE_PASSWORD || !NODE_PORT || !id) {
  process.exit(1)
}

const client = new Client({})

const aqua = new Aqua(client, [{
  host: NODE_HOST,
  auth: NODE_PASSWORD,
  port: Number.parseInt(NODE_PORT, 10),
  ssl: NODE_SECURE === 'true',
  name: NODE_NAME
}], {
  defaultSearchPlatform: 'ytsearch',
  restVersion: 'v4',
  shouldDeleteMessage: true,
  infiniteReconnects: true,
  autoResume: true,
  loadBalancer: 'random',
  useHttp2: true,
  leaveOnEnd: false
})

aqua.init(id)
Object.assign(client, { aqua })
aqua.on('debug', msg => client.logger.debug(msg))

// State management
const state = {
  presenceInterval: null,
  lastVoiceStatusUpdate: 0,
  lastErrorLog: 0,
  cachedGuildCount: 0,
  cachedUserCount: 0,
  lastCountUpdate: 0
}

const cleanupPlayer = (player) => {
  const voiceChannel = player.voiceChannel || player._lastVoiceChannel
  if (voiceChannel) client.channels.setVoiceStatus(voiceChannel, null).catch(() => {})
  if (hasKaraokeSession(player.guildId)) cleanupKaraokeSession(player.guildId)

  const msg = player.nowPlayingMessage
  if (msg?.delete) {
    msg.delete().catch(() => {})
    player.nowPlayingMessage = null
  }
}

const shutdown = async () => {
  if (state.presenceInterval) {
    clearInterval(state.presenceInterval)
    state.presenceInterval = null
  }
  await aqua.savePlayer().catch(() => {})
  process.exit(0)
}

export const updatePresence = (clientInstance) => {
  if (state.presenceInterval) clearInterval(state.presenceInterval)

  let activityIndex = 0
  const activities = [
    { name: '⚡ Kenium 4.9.0 ⚡', type: 1, url: 'https://www.youtube.com/watch?v=7aIjwQCEox8' },
    { name: '{users} users', type: 1, url: 'https://www.youtube.com/watch?v=7aIjwQCEox8' },
    { name: '{guilds} servers', type: 1, url: 'https://www.youtube.com/watch?v=7aIjwQCEox8' },
    { name: 'Sponsor: https://links.triniumhost.com/', type: 1, url: 'https://www.youtube.com/watch?v=7aIjwQCEox8' }
  ]

  const timer = setInterval(() => {
    if (!clientInstance.me?.id) return

    const now = Date.now()
    if (now - state.lastCountUpdate > COUNT_CACHE_TTL) {
      const guilds = clientInstance.cache.guilds?.values() || []
      state.cachedGuildCount = Array.isArray(guilds) ? guilds.length : 0
      state.cachedUserCount = 0
      for (const guild of guilds) state.cachedUserCount += guild.memberCount || 0
      state.lastCountUpdate = now
    }

    const currentActivity = activities[activityIndex++ % activities.length]
    const activityName = currentActivity.name
      .replace('{users}', String(state.cachedUserCount))
      .replace('{guilds}', String(state.cachedGuildCount))

    clientInstance.gateway?.setPresence({
      activities: [{ ...currentActivity, name: activityName }],
      status: 'idle',
      since: now,
      afk: true
    })
  }, PRESENCE_UPDATE_INTERVAL)

  if (timer.unref) timer.unref()
  state.presenceInterval = timer
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
    adapter: new LimitedMemoryAdapter({ message: { expire: 5 * 60 * 1000, limit: 10 } })
  }
})

aqua.on('trackStart', async (player, track) => {
  const channel = client.cache.channels.get(player.textChannel)
  if (!channel) return

  const embed = createNowPlayingEmbed(player, track, client)
  const messageOptions = { components: [embed], flags: 4096 | 32768 }
  const msg = player.nowPlayingMessage

  if (msg?.id && msg.edit) {
    try {
      await msg.edit(messageOptions)
    } catch {
      const newMsg = await channel.client.messages.write(channel.id, messageOptions).catch(() => null)
      if (newMsg) player.nowPlayingMessage = newMsg
    }
  } else {
    const newMsg = await channel.client.messages.write(channel.id, messageOptions).catch(() => null)
    if (newMsg) player.nowPlayingMessage = newMsg
  }

  const now = Date.now()
  if (now - state.lastVoiceStatusUpdate > VOICE_STATUS_THROTTLE) {
    state.lastVoiceStatusUpdate = now
    const title = track.info?.title || track.title
    if (title) {
      const status = `⭐ ${_functions.truncateText(title, VOICE_STATUS_LENGTH)} - Kenium 4.9.0`
      client.channels.setVoiceStatus(player.voiceChannel, status).catch(() => {})
    }
  }
})

aqua.on('trackError', async (player, track, payload) => {
  const channel = client.cache.channels.get(player.textChannel)
  if (!channel) return

  const errorMsg = payload.exception?.message || 'Playback failed'
  const title = _functions.truncateText(track.info?.title || track.title, 25)

  await channel.client.messages.write(channel.id, {
    content: `❌ **${title}**: ${_functions.truncateText(errorMsg, 50)}`
  }).catch(() => {})
})

const cleanupHandler = (player) => cleanupPlayer(player)
aqua.on('playerDestroy', cleanupHandler)
aqua.on('queueEnd', cleanupHandler)
aqua.on('trackEnd', cleanupHandler)

aqua.on('nodeError', (node, error) => {
  const now = Date.now()
  if (now - state.lastErrorLog > ERROR_LOG_THROTTLE) {
    client.logger.error(`Node [${node.name}] error: ${error.message}`)
    state.lastErrorLog = now
  }
})

aqua.on('socketClosed', (player, payload) => {
  client.logger.debug(`Socket closed [${player.guildId}], code: ${payload.code}`)
})

aqua.on('nodeConnect', (node) => {
  client.logger.debug(`Node [${node.name}] connected, IsNodeSecure: ${node.ssl}`)
})

aqua.on('nodeDisconnect', (_, reason) => {
  client.logger.info(`Node disconnected: ${reason}`)
})

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

client.start().then(async () => {
  await client.uploadCommands({ cachePath: './commands.json' }).catch(() => {})
  aqua.loadPlayers().catch(() => {})
  client.cooldown = new CooldownManager(client as any)
  updatePresence(client)
}).catch(error => {
  process.exit(1)
})

declare module 'seyfert' {
  interface UsingClient extends ParseClient<Client<true>>, ParseClient<HttpClient> {
    aqua: InstanceType<typeof Aqua>
  }
  interface Client<Ready extends boolean> {
    cooldown: CooldownManager
  }
  interface RegisteredMiddlewares extends ParseMiddlewares<typeof middlewares> {}
  interface DefaultLocale extends ParseLocales<typeof English> {}
}