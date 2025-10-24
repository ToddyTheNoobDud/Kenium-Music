import process from 'node:process'
import { lru } from 'tiny-lru'
import { createEvent, Embed } from 'seyfert'
import { getChannelIds, isTwentyFourSevenEnabled } from '../utils/db_helper'
import { hasKaraokeSession, cleanupKaraokeSession } from '../commands/karaoke'
// Constants
const NO_SONG_TIMEOUT = 600000
const REJOIN_DELAY = 5000
const CLEANUP_INTERVAL = 300000
const CACHE_SIZE = 1000
const DEBOUNCE_DELAY = 50

const STATE_IDLE = 1
const STATE_PLAYING = 2
const STATE_REJOINING = 4
const STATE_DESTROYING = 8

const TRANSITIONS = new Uint8Array(16)
TRANSITIONS[STATE_IDLE] = STATE_PLAYING | STATE_DESTROYING
TRANSITIONS[STATE_PLAYING] = STATE_IDLE | STATE_DESTROYING
TRANSITIONS[STATE_REJOINING] = STATE_PLAYING | STATE_IDLE
TRANSITIONS[STATE_DESTROYING] = STATE_REJOINING

// Utility functions
const unrefTimeout = (fn, delay) => {
  const timer = setTimeout(fn, delay)
  if (timer.unref) timer.unref()
  return timer
}

const clearTimer = (timer) => {
  if (timer) {
    clearTimeout(timer)
    if (timer.unref) timer.unref()
  }
  return null
}

const safeDelete = (msg, guildId) => {
  if (hasKaraokeSession(guildId)) cleanupKaraokeSession(guildId)
  msg?.delete?.().catch(() => {})
}

const getBotId = (client) => client.me?.id || client.user?.id || client.bot?.id

const getChannelPair = (guildId, voiceId, textId) => {
  if (voiceId && textId) return [voiceId, textId]
  const ids = getChannelIds(guildId)
  return ids?.voiceChannelId && ids?.textChannelId ? [ids.voiceChannelId, ids.textChannelId] : null
}

const fetchGuild = async (cache, client, guildId) => {
  let guild = cache.get(guildId)
  if (guild) return guild

  guild = client.cache?.guilds?.get?.(guildId)
  if (guild) {
    cache.set(guildId, guild)
    return guild
  }

  try {
    guild = await client.guilds?.fetch?.(guildId)
    if (guild) cache.set(guildId, guild)
    return guild
  } catch {
    return null
  }
}

const getVoiceChannel = async (guild, channelId) => {
  let channel = guild.channels?.get?.(channelId)
  if (channel) return channel.type === 2 ? channel : null

  try {
    channel = await guild.channels?.fetch?.(channelId)
    return channel?.type === 2 ? channel : null
  } catch {
    return null
  }
}

const countHumans = (members: any) => {
  if (!members) return 0

  if (typeof members.filter === 'function') {
    const filtered = members.filter((m: any) => !m?.user?.bot)
    return filtered.size ?? filtered.length ?? 0
  }

  const membersArray = Array.from(members.values?.() ?? [])
  return membersArray.filter((m: any) => !m.user?.bot).length
}

class CircuitBreaker {
  failures = new Map()
  maxFailures = 3
  baseResetTime = 30000

  canAttempt(guildId) {
    const entry = this.failures.get(guildId)
    if (!entry) return true

    const resetTime = this.baseResetTime << Math.min(entry.count - this.maxFailures, 5)
    if (Date.now() - entry.lastAttempt > resetTime) {
      this.failures.delete(guildId)
      return true
    }

    return entry.count < this.maxFailures
  }

  recordResult(guildId, success) {
    if (success) {
      this.failures.delete(guildId)
    } else {
      const entry = this.failures.get(guildId)
      this.failures.set(guildId, {
        count: (entry?.count ?? 0) + 1,
        lastAttempt: Date.now()
      })
    }
  }

  cleanup() {
    const now = Date.now()
    const expireTime = 600000

    for (const [guildId, entry] of this.failures) {
      if (now - entry.lastAttempt > expireTime) this.failures.delete(guildId)
    }
  }
}

class VoiceManager {
  timeouts = new Map()
  states = new Map()
  pending = new Map()
  breaker = new CircuitBreaker()
  guildCache = lru(CACHE_SIZE, 60000)
  registered = new WeakSet()
  cleanupTimer = null

  constructor() {
    this.setupCleanup()
  }

  setupCleanup() {
    this.cleanupTimer = unrefTimeout(() => {
      this.breaker.cleanup()
      this.setupCleanup()
    }, CLEANUP_INTERVAL)
  }

  setState(guildId, newState) {
    const current = this.states.get(guildId) ?? STATE_IDLE
    if (!(TRANSITIONS[current] & newState)) return false
    this.states.set(guildId, newState)
    return true
  }

  clearTimeout(guildId) {
    const timer = this.timeouts.get(guildId)
    if (timer) {
      this.timeouts.set(guildId, clearTimer(timer))
      this.timeouts.delete(guildId)
    }
  }

  setTimeout(guildId, fn, delay) {
    this.clearTimeout(guildId)
    this.timeouts.set(guildId, unrefTimeout(() => {
      this.timeouts.delete(guildId)
      fn()
    }, delay))
  }

  register(client) {
    if (this.registered.has(client)) return
    this.registered.add(client)

    const aqua = client.aqua
    const handlers = {
      trackStart: (player) => {
        this.setState(player.guildId, STATE_PLAYING)
        this.clearTimeout(player.guildId)
      },

      queueEnd: (player) => {
        this.setState(player.guildId, STATE_IDLE)
        if (!isTwentyFourSevenEnabled(player.guildId)) this.scheduleDestroy(client, player)
      },

      playerDestroy: (player) => {
        if (!player?.guildId) return
        this.setState(player.guildId, STATE_DESTROYING)
        this.clearTimeout(player.guildId)


        if (isTwentyFourSevenEnabled(player.guildId)) {
          this.scheduleRejoin(client, player.guildId, player.voiceChannel, player.textChannel)
        } else {
          this.states.delete(player.guildId)
        }
      }
    }

    aqua.on('trackStart', handlers.trackStart)
    aqua.on('queueEnd', handlers.queueEnd)
    aqua.on('playerDestroy', handlers.playerDestroy)
    client._voiceHandlers = handlers
  }

  unregister(client) {
    if (!this.registered.has(client)) return
    this.registered.delete(client)

    const handlers = client._voiceHandlers
    if (handlers && client.aqua) {
      client.aqua.off('trackStart', handlers.trackStart)
      client.aqua.off('queueEnd', handlers.queueEnd)
      client.aqua.off('playerDestroy', handlers.playerDestroy)
    }

    delete client._voiceHandlers
  }

  handleUpdate(event, client) {
    const guildId = event.guildId
    const existing = this.pending.get(guildId)

    if (existing) existing.timer = clearTimer(existing.timer)

    this.pending.set(guildId, {
      event,
      timer: unrefTimeout(() => {
        this.pending.delete(guildId)
        this.processUpdate(event, client)
      }, DEBOUNCE_DELAY)
    })
  }

  processUpdate(event, client) {
    const { newState, oldState } = event
    const guildId = newState?.guildId

    if (!guildId || oldState?.channelId === newState?.channelId) return

    const player = client.aqua?.players?.get?.(guildId)
    const is247 = isTwentyFourSevenEnabled(guildId)

    if (!player && is247) {
      const pair = getChannelPair(guildId, null, null)
      if (pair) this.scheduleRejoin(client, guildId, pair[0], pair[1])
    }

    if (player && !is247) this.checkActivity(client, guildId, player)
  }

  scheduleRejoin(client, guildId, voiceId, textId) {
    if (!this.breaker.canAttempt(guildId)) return

    this.setTimeout(guildId, async () => {
      if (!this.setState(guildId, STATE_REJOINING)) return

      try {
        await this.rejoinChannel(client, guildId, voiceId, textId)
        this.breaker.recordResult(guildId, true)
      } catch {
        this.breaker.recordResult(guildId, false)
      }
    }, REJOIN_DELAY)
  }

  async rejoinChannel(client, guildId, voiceId, textId) {
    if (client.aqua?.players?.get?.(guildId)) return

    const pair = getChannelPair(guildId, voiceId, textId)
    if (!pair) return

    const guild = await fetchGuild(this.guildCache, client, guildId)
    if (!guild) return

    const voiceChannel = await getVoiceChannel(guild, pair[0])
    if (!voiceChannel) return

    await client.aqua.createConnection({
      guildId,
      voiceChannel: pair[0],
      textChannel: pair[1],
      deaf: true,
      defaultVolume: 65
    })

    this.setState(guildId, STATE_IDLE)
  }

  scheduleDestroy(client, player) {
    this.setTimeout(player.guildId, async () => {
      const current = client.aqua?.players?.get?.(player.guildId)
      if (!current || current.playing || isTwentyFourSevenEnabled(player.guildId)) return

      const embed = new Embed()
        .setColor(0x100e09)
        .setDescription('No song added in 10 minutes, disconnecting...\nUse the `/24_7` command to keep the bot in voice channel.')
        .setFooter({ text: 'Automatically destroying player' })

      try {
        const msg = await client.messages.write(current.textChannel, { embeds: [embed] })
        if (msg) this.setTimeout(`msg_${msg.id}`, () => safeDelete(msg, player.guildId), 10000)
      } catch {}

      current.destroy()
    }, NO_SONG_TIMEOUT)
  }

  async checkActivity(client, guildId, player) {
    const voiceId = player?.voiceChannel
    if (!voiceId) return

    const guild = await fetchGuild(this.guildCache, client, guildId)
    if (!guild) return

    const voiceChannel = await getVoiceChannel(guild, voiceId)
    if (!voiceChannel) return

    const members = voiceChannel.members || voiceChannel.voiceMembers || voiceChannel?.members?.cache
    const humanCount = countHumans(members)

    if (humanCount === 0) {
      this.scheduleDestroy(client, player)
    } else {
      this.clearTimeout(guildId)
    }
  }

  cleanup() {
    for (const timer of this.timeouts.values()) clearTimer(timer)
    for (const { timer } of this.pending.values()) clearTimer(timer)
    if (this.cleanupTimer) clearTimer(this.cleanupTimer)

    this.timeouts.clear()
    this.pending.clear()
    this.states.clear()
    this.guildCache.clear()
    this.breaker.cleanup()
    this.cleanupTimer = null
  }
}

const manager = new VoiceManager()

export default createEvent({
  data: { name: 'voiceStateUpdate', once: false },
  run: async ([newState, oldState], client) => {
    if (!client.aqua?.players) return

    const botId = getBotId(client)
    const userLeft = newState?.userId === botId
    const userJoined = oldState?.userId === botId
    const sameChannel = oldState?.channelId === newState?.channelId

    if (userLeft || userJoined || sameChannel) return

    manager.register(client)
    manager.handleUpdate({
      newState,
      oldState,
      guildId: newState?.guildId ?? oldState?.guildId
    }, client)
  }
})

process.on('exit', () => manager.cleanup())
process.on('SIGTERM', () => manager.cleanup())
process.on('SIGINT', () => manager.cleanup())
