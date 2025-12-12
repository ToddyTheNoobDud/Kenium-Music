import process from 'node:process'
import { lru } from 'tiny-lru'
import { createEvent, Embed } from 'seyfert'
import { getChannelIds, isTwentyFourSevenEnabled } from '../utils/db_helper'
import { hasKaraokeSession, cleanupKaraokeSession } from '../commands/karaoke'

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
TRANSITIONS[STATE_IDLE] = STATE_PLAYING | STATE_DESTROYING | STATE_REJOINING
TRANSITIONS[STATE_PLAYING] = STATE_IDLE | STATE_DESTROYING | STATE_REJOINING
TRANSITIONS[STATE_REJOINING] = STATE_PLAYING | STATE_IDLE
TRANSITIONS[STATE_DESTROYING] = STATE_REJOINING

const _functions = {
  unrefTimeout(fn: () => void, delay: number) {
    const t: any = setTimeout(fn, delay)
    t?.unref?.()
    return t
  },

  clearTimer(timer: any) {
    if (timer) clearTimeout(timer)
    return null
  },

  safeDelete(msg: any, guildId: string) {
    if (hasKaraokeSession(guildId)) cleanupKaraokeSession(guildId)
    msg?.delete?.().catch(() => {})
  },

  getBotId(client: any) {
    return client.me?.id || client.user?.id || client.bot?.id
  },

  getChannelPair(guildId: string, voiceId?: string | null, textId?: string | null) {
    if (voiceId && textId) return [voiceId, textId] as const
    const ids = getChannelIds(guildId)
    return ids?.voiceChannelId && ids?.textChannelId ? ([ids.voiceChannelId, ids.textChannelId] as const) : null
  },

  async fetchGuild(cache: any, client: any, guildId: string) {
    let guild = cache.get(guildId)
    if (guild) return guild

    guild = client.cache?.guilds?.get?.(guildId)
    if (guild) return cache.set(guildId, guild), guild

    try {
      guild = await client.guilds?.fetch?.(guildId)
      if (guild) cache.set(guildId, guild)
      return guild ?? null
    } catch {
      return null
    }
  },

  async getVoiceChannel(guild: any, channelId: string) {
    let ch = guild.channels?.get?.(channelId)
    if (ch) return ch.type === 2 ? ch : null
    try {
      ch = await guild.channels?.fetch?.(channelId)
      return ch?.type === 2 ? ch : null
    } catch {
      return null
    }
  },

  getBotVoiceChannelId(guild: any, botId: string) {
    return (
      guild?.members?.me?.voice?.channelId ||
      guild?.members?.get?.(botId)?.voice?.channelId ||
      guild?.voiceStates?.get?.(botId)?.channelId ||
      null
    )
  },

  countHumans(members: any) {
    if (!members) return 0
    let n = 0

    const it =
      typeof members.values === 'function'
        ? members.values()
        : Array.isArray(members)
          ? members
          : typeof members[Symbol.iterator] === 'function'
            ? members
            : typeof members.cache?.values === 'function'
              ? members.cache.values()
              : null

    if (!it) return 0
    for (const m of it as any) if (!m?.user?.bot) n++
    return n
  }
}

class CircuitBreaker {
  failures = new Map<string, { count: number; lastAttempt: number }>()
  maxFailures = 3
  baseResetTime = 30000

  canAttempt(guildId: string) {
    const entry = this.failures.get(guildId)
    if (!entry) return true

    const resetTime = this.baseResetTime << Math.min(entry.count - this.maxFailures, 5)
    if (Date.now() - entry.lastAttempt > resetTime) {
      this.failures.delete(guildId)
      return true
    }
    return entry.count < this.maxFailures
  }

  recordResult(guildId: string, success: boolean) {
    if (success) return void this.failures.delete(guildId)
    const entry = this.failures.get(guildId)
    this.failures.set(guildId, { count: (entry?.count ?? 0) + 1, lastAttempt: Date.now() })
  }

  cleanup() {
    const now = Date.now()
    const expireTime = 600000
    for (const [guildId, entry] of this.failures) if (now - entry.lastAttempt > expireTime) this.failures.delete(guildId)
  }
}

class VoiceManager {
  timeouts = new Map<string, any>()
  states = new Map<string, number>()
  pending = new Map<string, { timer: any; event: any }>()
  breaker = new CircuitBreaker()
  guildCache = lru(CACHE_SIZE, 60000)
  registered = new WeakSet<any>()
  cleanupTimer: any = null
  stopped = false

  constructor() {
    this.setupCleanup()
  }

  setupCleanup() {
    if (this.stopped) return
    this.cleanupTimer = _functions.unrefTimeout(() => {
      if (this.stopped) return
      this.breaker.cleanup()
      this.setupCleanup()
    }, CLEANUP_INTERVAL)
  }

  setState(guildId: string, newState: number) {
    const current = this.states.get(guildId) ?? STATE_IDLE
    if (!(TRANSITIONS[current] & newState)) return false
    this.states.set(guildId, newState)
    return true
  }

  clearTimeout(key: string) {
    const t = this.timeouts.get(key)
    if (!t) return
    _functions.clearTimer(t)
    this.timeouts.delete(key)
  }

  setTimeout(key: string, fn: () => void, delay: number) {
    this.clearTimeout(key)
    this.timeouts.set(
      key,
      _functions.unrefTimeout(() => {
        this.timeouts.delete(key)
        fn()
      }, delay)
    )
  }

  register(client: any) {
    if (this.registered.has(client)) return

    const old = client._voiceHandlers
    if (old && client.aqua?.off) {
      client.aqua.off('trackStart', old.trackStart)
      client.aqua.off('queueEnd', old.queueEnd)
      client.aqua.off('playerDestroy', old.playerDestroy)
    }

    this.registered.add(client)

    const aqua = client.aqua
    const handlers = {
      trackStart: (player: any) => {
        this.setState(player.guildId, STATE_PLAYING)
        this.clearTimeout(player.guildId)
      },

      queueEnd: (player: any) => {
        this.setState(player.guildId, STATE_IDLE)
        if (!isTwentyFourSevenEnabled(player.guildId)) this.scheduleDestroy(client, player)
      },

      playerDestroy: (player: any) => {
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

    aqua?.on?.('trackStart', handlers.trackStart)
    aqua?.on?.('queueEnd', handlers.queueEnd)
    aqua?.on?.('playerDestroy', handlers.playerDestroy)
    client._voiceHandlers = handlers
  }

  handleUpdate(event: any, client: any) {
    const guildId = event.guildId
    if (!guildId) return

    const existing = this.pending.get(guildId)
    if (existing) existing.timer = _functions.clearTimer(existing.timer)

    this.pending.set(guildId, {
      event,
      timer: _functions.unrefTimeout(() => {
        this.pending.delete(guildId)
        this.processUpdate(event, client)
      }, DEBOUNCE_DELAY)
    })
  }

  processUpdate(event: any, client: any) {
    const { newState, oldState } = event
    const guildId = event.guildId
    if (!guildId || oldState?.channelId === newState?.channelId) return

    const player = client.aqua?.players?.get?.(guildId)
    const is247 = isTwentyFourSevenEnabled(guildId)

    if (is247) {
      const botId = _functions.getBotId(client)
      const userId = newState?.userId ?? oldState?.userId
      const botLeft = botId && userId === botId && oldState?.channelId && !newState?.channelId

      if (botLeft) {
        this.scheduleRejoin(client, guildId, player?.voiceChannel ?? oldState.channelId, player?.textChannel)
        return
      }

      if (!player) {
        const pair = _functions.getChannelPair(guildId, null, null)
        if (pair) this.scheduleRejoin(client, guildId, pair[0], pair[1])
        return
      }

      return
    }

    if (player) void this.checkActivity(client, guildId, player)
  }

  scheduleRejoin(client: any, guildId: string, voiceId?: string, textId?: string) {
    if (!this.breaker.canAttempt(guildId)) return

    this.setTimeout(guildId, () => {
      if (!this.setState(guildId, STATE_REJOINING)) return
      void (async () => {
        try {
          await this.rejoinChannel(client, guildId, voiceId, textId)
          this.breaker.recordResult(guildId, true)
        } catch {
          this.breaker.recordResult(guildId, false)
        }
      })()
    }, REJOIN_DELAY)
  }

  async rejoinChannel(client: any, guildId: string, voiceId?: string, textId?: string) {
    const pair = _functions.getChannelPair(guildId, voiceId, textId)
    if (!pair) return

    const guild = await _functions.fetchGuild(this.guildCache, client, guildId)
    if (!guild) return

    const botId = _functions.getBotId(client)
    if (botId) {
      const botVc = _functions.getBotVoiceChannelId(guild, botId)
      if (botVc === pair[0]) return void this.setState(guildId, STATE_IDLE)
    }

    const voiceChannel = await _functions.getVoiceChannel(guild, pair[0])
    if (!voiceChannel) return

    const existing = client.aqua?.players?.get?.(guildId)

    try {
      await client.aqua.createConnection({
        guildId,
        voiceChannel: pair[0],
        textChannel: pair[1],
        deaf: true,
        defaultVolume: 65
      })
    } catch {
      if (existing?.destroy) {
        try {
          existing.destroy()
          await client.aqua.createConnection({
            guildId,
            voiceChannel: pair[0],
            textChannel: pair[1],
            deaf: true,
            defaultVolume: 65
          })
        } catch {
          return
        }
      } else {
        return
      }
    }

    this.setState(guildId, STATE_IDLE)
  }

  scheduleDestroy(client: any, player: any) {
    this.setTimeout(player.guildId, () => {
      void (async () => {
        const current = client.aqua?.players?.get?.(player.guildId)
        if (!current || current.playing || isTwentyFourSevenEnabled(player.guildId)) return

        const embed = new Embed()
          .setColor(0x100e09)
          .setDescription(
            'No song added in 10 minutes, disconnecting...\nUse the `/24_7` command to keep the bot in voice channel.'
          )
          .setFooter({ text: 'Automatically destroying player' })

        try {
          const msg = await client.messages.write(current.textChannel, { embeds: [embed] })
          if (msg) this.setTimeout(`msg_${msg.id}`, () => _functions.safeDelete(msg, player.guildId), 10000)
        } catch {}

        current.destroy()
      })()
    }, NO_SONG_TIMEOUT)
  }

  async checkActivity(client: any, guildId: string, player: any) {
    const voiceId = player?.voiceChannel
    if (!voiceId) return

    const guild = await _functions.fetchGuild(this.guildCache, client, guildId)
    if (!guild) return

    const voiceChannel = await _functions.getVoiceChannel(guild, voiceId)
    if (!voiceChannel) return

    const members = voiceChannel.members || voiceChannel.voiceMembers || voiceChannel?.members?.cache
    if (_functions.countHumans(members) === 0) this.scheduleDestroy(client, player)
    else this.clearTimeout(guildId)
  }

  cleanup() {
    this.stopped = true
    for (const t of this.timeouts.values()) _functions.clearTimer(t)
    for (const p of this.pending.values()) _functions.clearTimer(p.timer)
    _functions.clearTimer(this.cleanupTimer)

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

    const guildId = newState?.guildId ?? oldState?.guildId
    if (!guildId) return
    if (oldState?.channelId === newState?.channelId) return

    manager.register(client)
    manager.handleUpdate({ newState, oldState, guildId }, client)
  }
})

const HOOK_FLAG = '_voiceManagerCleanupHookAdded'
const anyProcess: any = process
if (!anyProcess[HOOK_FLAG]) {
  anyProcess[HOOK_FLAG] = true
  const cleanup = () => manager.cleanup()
  process.once('exit', cleanup)
  process.once('SIGTERM', cleanup)
  process.once('SIGINT', cleanup)
}