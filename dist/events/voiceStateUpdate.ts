import process from 'node:process'
import QuickLRU from 'quick-lru'
import { createEvent, Embed } from 'seyfert'
import { getChannelIds, isTwentyFourSevenEnabled } from '../utils/db_helper'

const NO_SONG_TIMEOUT = 600_000
const REJOIN_DELAY = 5_000
const CLEANUP_INTERVAL = 300_000
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

const _unrefTimeout = (fn, delay) => {
  const timer = setTimeout(fn, delay)
  timer.unref?.()
  return timer
}

const _clearTimer = (timer) => {
  if (timer) {
    clearTimeout(timer)
    timer.unref?.()
  }
  return null
}

const _safeDelete = (msg) => msg?.delete?.().catch(() => {})

const _getBotId = (client) => client.me?.id || client.user?.id || client.bot?.id

const _getChannelPair = (guildId: string, voiceId?: string, textId?: string): [string, string] | null => {
  if (voiceId && textId) return [voiceId, textId]
  const ids = getChannelIds(guildId)
  return ids?.voiceChannelId && ids?.textChannelId ? [ids.voiceChannelId, ids.textChannelId] : null
}

const _fetchGuild = async (cache, client, guildId) => {
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

const _getVoiceChannel = async (guild, channelId) => {
  let channel = guild.channels?.get?.(channelId)
  if (channel) return channel.type === 2 ? channel : null

  try {
    channel = await guild.channels?.fetch?.(channelId)
    return channel?.type === 2 ? channel : null
  } catch {
    return null
  }
}

const _countHumans = (members) => {
  if (!members) return 0
  if (typeof members.filter === 'function') {
    const filtered = members.filter(m => !m?.user?.bot)
    return filtered.size ?? filtered.length ?? 0
  }
  return [...(members.values?.() ?? [])].filter(m => !m?.user?.bot).length
}

interface FailureEntry {
  count: number
  lastAttempt: number
}

class CircuitBreaker {
  failures: Map<string, FailureEntry>

  constructor() {
    this.failures = new Map()
  }

  canAttempt(guildId) {
    const entry = this.failures.get(guildId)
    if (!entry) return true

    const resetTime = 30_000 << Math.min(entry.count - 3, 5)
    if (Date.now() - entry.lastAttempt > resetTime) {
      this.failures.delete(guildId)
      return true
    }
    return entry.count < 3
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
    for (const [guildId, entry] of this.failures) {
      if (now - entry.lastAttempt > 600_000) {
        this.failures.delete(guildId)
      }
    }
  }
}

interface PendingEntry {
  event: any
  timer: NodeJS.Timeout
}

class VoiceManager {
  timeouts: Map<string, NodeJS.Timeout>
  states: Map<string, number>
  pending: Map<string, PendingEntry>
  breaker: CircuitBreaker
  guildCache: QuickLRU<string, any>
  registered: WeakSet<any>
  cleanupTimer: NodeJS.Timeout | null

  constructor() {
    this.timeouts = new Map()
    this.states = new Map()
    this.pending = new Map()
    this.breaker = new CircuitBreaker()
    this.guildCache = new QuickLRU({ maxSize: CACHE_SIZE, maxAge: 60_000 })
    this.registered = new WeakSet()
    this.cleanupTimer = null
    this._setupCleanup()
  }

  _setupCleanup() {
    this.cleanupTimer = _unrefTimeout(() => {
      this.breaker.cleanup()
      this._setupCleanup()
    }, CLEANUP_INTERVAL)
  }

  _setState(guildId, newState) {
    const current = this.states.get(guildId) ?? STATE_IDLE
    if (!(TRANSITIONS[current] & newState)) return false
    this.states.set(guildId, newState)
    return true
  }

  _clearTimeout(guildId) {
    const timer = this.timeouts.get(guildId)
    if (timer) {
      this.timeouts.set(guildId, _clearTimer(timer))
      this.timeouts.delete(guildId)
    }
  }

  _setTimeout(guildId, fn, delay) {
    this._clearTimeout(guildId)
    this.timeouts.set(guildId, _unrefTimeout(() => {
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
        this._setState(player.guildId, STATE_PLAYING)
        this._clearTimeout(player.guildId)
      },
      queueEnd: (player) => {
        this._setState(player.guildId, STATE_IDLE)
        if (!isTwentyFourSevenEnabled(player.guildId)) {
          this._scheduleDestroy(client, player)
        }
      },
      playerDestroy: (player) => {
        if (!player?.guildId) return
        this._setState(player.guildId, STATE_DESTROYING)
        this._clearTimeout(player.guildId)

        if (isTwentyFourSevenEnabled(player.guildId)) {
          this._scheduleRejoin(client, player.guildId, player.voiceChannel, player.textChannel)
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
    if (existing) existing.timer = _clearTimer(existing.timer)

    this.pending.set(guildId, {
      event,
      timer: _unrefTimeout(() => {
        this.pending.delete(guildId)
        this._processUpdate(event, client)
      }, DEBOUNCE_DELAY)
    })
  }

  _processUpdate(event, client) {
    const { newState, oldState } = event
    const guildId = newState?.guildId
    if (!guildId || oldState?.channelId === newState?.channelId) return

    const player = client.aqua?.players?.get?.(guildId)
    const is247 = isTwentyFourSevenEnabled(guildId)

    if (!player && is247) {
      const pair = _getChannelPair(guildId)
      if (pair) this._scheduleRejoin(client, guildId, pair[0], pair[1])
    }

    if (player && !is247) {
      this._checkActivity(client, guildId, player)
    }
  }

  _scheduleRejoin(client, guildId, voiceId, textId) {
    if (!this.breaker.canAttempt(guildId)) return

    this._setTimeout(guildId, async () => {
      if (!this._setState(guildId, STATE_REJOINING)) return

      try {
        await this._rejoinChannel(client, guildId, voiceId, textId)
        this.breaker.recordResult(guildId, true)
      } catch {
        this.breaker.recordResult(guildId, false)
      }
    }, REJOIN_DELAY)
  }

  async _rejoinChannel(client, guildId, voiceId, textId) {
    if (client.aqua?.players?.get?.(guildId)) return

    const pair = _getChannelPair(guildId, voiceId, textId)
    if (!pair) return

    const guild = await _fetchGuild(this.guildCache, client, guildId)
    if (!guild) return

    const voiceChannel = await _getVoiceChannel(guild, pair[0])
    if (!voiceChannel) return

    await client.aqua.createConnection({
      guildId,
      voiceChannel: pair[0],
      textChannel: pair[1],
      deaf: true,
      defaultVolume: 65
    })

    this._setState(guildId, STATE_IDLE)
  }

  _scheduleDestroy(client, player) {
    this._setTimeout(player.guildId, async () => {
      const current = client.aqua?.players?.get?.(player.guildId)
      if (!current || current.playing || isTwentyFourSevenEnabled(player.guildId)) return

      const embed = new Embed()
        .setColor(0)
        .setDescription('No song added in 10 minutes, disconnecting...\nUse the `/24_7` command to keep the bot in voice channel.')
        .setFooter({ text: 'Automatically destroying player' })

      try {
        const msg = await client.messages.write(current.textChannel, { embeds: [embed] })
        if (msg) {
          this._setTimeout(`msg_${msg.id}`, () => _safeDelete(msg), 10_000)
        }
      } catch {}

      current.destroy()
    }, NO_SONG_TIMEOUT)
  }

  async _checkActivity(client, guildId, player) {
    const voiceId = player?.voiceChannel
    if (!voiceId) return

    const guild = await _fetchGuild(this.guildCache, client, guildId)
    if (!guild) return

    const voiceChannel = await _getVoiceChannel(guild, voiceId)
    if (!voiceChannel) return

    const members = voiceChannel.members || voiceChannel.voiceMembers || voiceChannel?.members?.cache
    const humanCount = _countHumans(members)

    if (humanCount === 0) {
      this._scheduleDestroy(client, player)
    } else {
      this._clearTimeout(guildId)
    }
  }

  cleanup() {
    for (const timer of this.timeouts.values()) _clearTimer(timer)
    for (const { timer } of this.pending.values()) _clearTimer(timer)
    if (this.cleanupTimer) _clearTimer(this.cleanupTimer)

    this.timeouts.clear()
    this.pending.clear()
    this.states.clear()
    this.guildCache.clear()
    this.breaker.failures.clear()
    this.cleanupTimer = null
  }
}

const manager = new VoiceManager()

export default createEvent({
  data: { name: 'voiceStateUpdate', once: false },
  run: async ([newState, oldState], client) => {
    if (!client.aqua?.players) return

    const botId = _getBotId(client)
    if ((newState?.userId === botId) ||
        (oldState?.userId === botId) ||
        (oldState?.channelId === newState?.channelId)) return
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
