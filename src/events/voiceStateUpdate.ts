import process from 'node:process'
import { createEvent, Embed } from 'seyfert'
import { lru } from 'tiny-lru'
import { cleanupKaraokeSession, hasKaraokeSession } from '../commands/karaoke'
import type {
  AquaClientLike,
  PlayerLike,
  TrackLike
} from '../shared/helperTypes'
import { createPlayerConnection } from '../shared/player'
import { get247ChannelIds, isTwentyFourSevenEnabled } from '../utils/db_helper'

const NO_SONG_TIMEOUT = 600000
const REJOIN_DELAY = 5000
const CLEANUP_INTERVAL = 300000
const CACHE_SIZE = 1000
const DEBOUNCE_DELAY = 50

type RejoinOutcome = 'connected' | 'retry' | 'noop'
type TimerLike = ReturnType<typeof setTimeout>
type VoiceStateLike = { channelId?: string | null; userId?: string | null }
type VoiceStateUpdatePayload = {
  guildId: string
  newState?: VoiceStateLike | null | undefined
  oldState?: VoiceStateLike | null | undefined
}
type MessageLike = {
  id?: string
  delete?: () => Promise<unknown>
}
type MemberPresenceLike = {
  user?: {
    bot?: boolean
  }
}
type MembersLike =
  | Iterable<MemberPresenceLike>
  | {
      values?: () => Iterable<MemberPresenceLike>
      cache?: {
        values?: () => Iterable<MemberPresenceLike>
      }
    }
  | null
  | undefined

const getIterableMembers = (
  members: MembersLike
): Iterable<MemberPresenceLike> | null => {
  if (!members) return null
  if (Array.isArray(members)) return members
  if (
    typeof members === 'object' &&
    members !== null &&
    'values' in members &&
    typeof members.values === 'function'
  ) {
    return members.values()
  }
  if (
    typeof members === 'object' &&
    members !== null &&
    Symbol.iterator in members
  ) {
    return members as Iterable<MemberPresenceLike>
  }
  if (
    typeof members === 'object' &&
    members !== null &&
    'cache' in members &&
    members.cache &&
    typeof members.cache.values === 'function'
  ) {
    return members.cache.values()
  }
  return null
}
type VoiceChannelLike = {
  type?: number
  members?: MembersLike
  voiceMembers?: MembersLike
}
type GuildLike = {
  channels?: {
    get?: (channelId: string) => VoiceChannelLike | undefined
    fetch?: (channelId: string) => Promise<VoiceChannelLike | undefined>
  }
  members?: {
    me?: {
      voice?: {
        channelId?: string | null
      }
    }
    get?: (userId: string) =>
      | {
          voice?: {
            channelId?: string | null
          }
        }
      | undefined
  }
  voiceStates?: {
    get?: (userId: string) =>
      | {
          channelId?: string | null
        }
      | undefined
  }
}
type GuildCacheLike = {
  get: (guildId: string) => GuildLike | undefined
  set: (guildId: string, guild: GuildLike) => unknown
  clear: () => void
}
type VoiceHandlers = {
  trackStart: (player: PlayerLike) => void
  queueEnd: (player: PlayerLike) => void
  playerDestroy: (player: PlayerLike) => void
  socketClosed: (
    player: PlayerLike,
    payload: {
      code?: number
    }
  ) => void
}
type VoiceClientLike = AquaClientLike<TrackLike> & {
  aqua: AquaClientLike<TrackLike>['aqua'] & {
    on?: unknown
    off?: unknown
    players?: {
      get?: unknown
    }
  }
  cache?: {
    guilds?: {
      get?: unknown
    }
  }
  guilds?: {
    fetch?: unknown
  }
  messages?: {
    write?: unknown
  }
  me?: { id?: string }
  user?: { id?: string }
  bot?: { id?: string }
  _voiceHandlers?: VoiceHandlers
}

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
    const t = setTimeout(fn, delay)
    if (typeof t.unref === 'function') t.unref()
    return t
  },
  clearTimer(timer: TimerLike | null | undefined) {
    if (timer) clearTimeout(timer)
    return null
  },
  safeDelete(msg: MessageLike | null | undefined, guildId: string) {
    if (hasKaraokeSession(guildId)) cleanupKaraokeSession(guildId)
    msg?.delete?.().catch(() => {})
  },
  getBotId(client: VoiceClientLike) {
    return client.me?.id || client.user?.id || client.bot?.id
  },
  getChannelPair(
    guildId: string,
    voiceId?: string | null,
    textId?: string | null
  ) {
    const ids = get247ChannelIds(guildId)
    const voiceChannelId = voiceId ?? ids?.voiceChannelId ?? null
    if (!voiceChannelId) return null

    return {
      voiceChannelId,
      textChannelId: textId ?? ids?.textChannelId ?? null
    }
  },
  async fetchGuild(
    cache: GuildCacheLike,
    client: VoiceClientLike,
    guildId: string
  ): Promise<GuildLike | null> {
    let guild = cache.get(guildId)
    if (guild) return guild

    const guildCache = client.cache?.guilds as
      | { get?: (guildId: string) => GuildLike | undefined }
      | undefined
    guild =
      typeof guildCache?.get === 'function'
        ? guildCache.get(guildId)
        : undefined
    if (guild) {
      cache.set(guildId, guild)
      return guild
    }

    try {
      const guilds = client.guilds as
        | { fetch?: (guildId: string) => Promise<GuildLike | undefined> }
        | undefined
      guild =
        typeof guilds?.fetch === 'function'
          ? await guilds.fetch(guildId)
          : undefined
      if (guild) cache.set(guildId, guild)
      return guild ?? null
    } catch {
      return null
    }
  },
  async getVoiceChannel(
    guild: GuildLike,
    channelId: string
  ): Promise<VoiceChannelLike | null> {
    const channels = guild.channels
    let ch =
      typeof channels?.get === 'function' ? channels.get(channelId) : undefined
    if (ch) return ch.type === 2 ? ch : null
    try {
      ch =
        typeof channels?.fetch === 'function'
          ? await channels.fetch(channelId)
          : undefined
      return ch?.type === 2 ? ch : null
    } catch {
      return null
    }
  },
  getBotVoiceChannelId(guild: GuildLike, botId: string): string | null {
    return (
      guild?.members?.me?.voice?.channelId ||
      guild?.members?.get?.(botId)?.voice?.channelId ||
      guild?.voiceStates?.get?.(botId)?.channelId ||
      null
    )
  },
  countHumans(members: MembersLike): number {
    let n = 0
    const it = getIterableMembers(members)
    if (!it) return 0
    for (const member of it) if (!member?.user?.bot) n++
    return n
  }
}

class CircuitBreaker {
  failures = new Map<string, { count: number; lastAttempt: number }>()
  maxFailures = 15
  baseResetTime = 30000

  canAttempt(guildId: string) {
    const entry = this.failures.get(guildId)
    if (!entry) return true

    const backoffLevel = Math.max(0, entry.count - this.maxFailures)
    const resetTime = this.baseResetTime * 2 ** Math.min(backoffLevel, 5)
    if (Date.now() - entry.lastAttempt > resetTime) {
      this.failures.delete(guildId)
      return true
    }
    return entry.count < this.maxFailures
  }

  recordResult(guildId: string, success: boolean) {
    if (success) return void this.failures.delete(guildId)
    const entry = this.failures.get(guildId)
    this.failures.set(guildId, {
      count: (entry?.count ?? 0) + 1,
      lastAttempt: Date.now()
    })
  }

  cleanup() {
    const now = Date.now()
    const expireTime = 600000
    for (const [guildId, entry] of this.failures)
      if (now - entry.lastAttempt > expireTime) this.failures.delete(guildId)
  }
}

class VoiceManager {
  timeouts = new Map<string, TimerLike>()
  states = new Map<string, number>()
  pending = new Map<
    string,
    { timer: TimerLike | null; event: VoiceStateUpdatePayload }
  >()
  breaker = new CircuitBreaker()
  guildCache = lru(CACHE_SIZE, 60000) as GuildCacheLike
  registered = new WeakSet<VoiceClientLike>()
  cleanupTimer: TimerLike | null = null
  stopped = false

  constructor() {
    this.setupCleanup()
  }

  setupCleanup() {
    if (this.stopped) return
    this.cleanupTimer = _functions.unrefTimeout(() => {
      if (this.stopped) return
      try {
        this.breaker.cleanup()
      } catch {}
      this.setupCleanup()
    }, CLEANUP_INTERVAL)
  }

  setState(guildId: string, newState: number): boolean {
    const current = this.states.get(guildId) ?? STATE_IDLE
    const allowed = TRANSITIONS[current] ?? 0
    if (!(allowed & newState)) return false
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

  register(client: VoiceClientLike) {
    if (this.registered.has(client)) return

    const old = client._voiceHandlers
    const aqua = client.aqua
    const off =
      typeof aqua?.off === 'function'
        ? (aqua.off.bind(aqua) as (
            event: string,
            handler: (...args: unknown[]) => void
          ) => void)
        : undefined
    if (old && off) {
      off('trackStart', old.trackStart as (...args: unknown[]) => void)
      off('queueEnd', old.queueEnd as (...args: unknown[]) => void)
      off('playerDestroy', old.playerDestroy as (...args: unknown[]) => void)
      if (old.socketClosed)
        off('socketClosed', old.socketClosed as (...args: unknown[]) => void)
    }

    this.registered.add(client)

    const handlers = {
      trackStart: (player: PlayerLike) => {
        if (!player.guildId) return
        this.setState(player.guildId, STATE_PLAYING)
        this.clearTimeout(player.guildId)
      },

      queueEnd: (player: PlayerLike) => {
        if (!player.guildId) return
        this.setState(player.guildId, STATE_IDLE)
        if (!isTwentyFourSevenEnabled(player.guildId))
          this.scheduleDestroy(client, player)
      },

      playerDestroy: (player: PlayerLike) => {
        if (!player?.guildId) return
        this.setState(player.guildId, STATE_DESTROYING)
        this.clearTimeout(player.guildId)

        if (isTwentyFourSevenEnabled(player.guildId)) {
          this.scheduleRejoin(
            client,
            player.guildId,
            player.voiceChannel ?? undefined,
            player.textChannel ?? undefined
          )
        } else {
          this.states.delete(player.guildId)
        }
      },

      socketClosed: (
        player: PlayerLike,
        payload: {
          code?: number
        }
      ) => {
        const guildId = player?.guildId
        const code = payload?.code
        if (!guildId || code === undefined || ![4014, 4022].includes(code))
          return
        if (!isTwentyFourSevenEnabled(guildId)) return
        // Don't fight Aqualink's built-in recovery/reconnection
        if ((player as Record<string, unknown>)?.['_reconnecting']) return

        this.scheduleRejoin(
          client,
          guildId,
          player?.voiceChannel ?? undefined,
          player?.textChannel ?? undefined
        )
      }
    }

    const on =
      typeof aqua?.on === 'function'
        ? (aqua.on.bind(aqua) as (
            event: string,
            handler: (...args: unknown[]) => void
          ) => void)
        : undefined
    if (on) {
      on('trackStart', handlers.trackStart as (...args: unknown[]) => void)
      on('queueEnd', handlers.queueEnd as (...args: unknown[]) => void)
      on(
        'playerDestroy',
        handlers.playerDestroy as (...args: unknown[]) => void
      )
      on('socketClosed', handlers.socketClosed as (...args: unknown[]) => void)
    }
    client._voiceHandlers = handlers
  }

  handleUpdate(event: VoiceStateUpdatePayload, client: VoiceClientLike) {
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

  processUpdate(event: VoiceStateUpdatePayload, client: VoiceClientLike) {
    const { newState, oldState } = event
    const guildId = event.guildId
    if (!guildId || oldState?.channelId === newState?.channelId) return

    const players = client.aqua?.players as
      | { get?: (guildId: string) => PlayerLike | undefined }
      | undefined
    const player =
      typeof players?.get === 'function' ? players.get(guildId) : undefined
    const is247 = isTwentyFourSevenEnabled(guildId)

    if (is247) {
      const botId = _functions.getBotId(client)
      const userId = newState?.userId ?? oldState?.userId
      const botLeft =
        botId && userId === botId && oldState?.channelId && !newState?.channelId

      if (botLeft) {
        this.scheduleRejoin(
          client,
          guildId,
          player?.voiceChannel ?? oldState.channelId ?? undefined,
          player?.textChannel ?? undefined
        )
        return
      }

      if (!player) {
        const pair = _functions.getChannelPair(guildId, null, null)
        if (pair)
          this.scheduleRejoin(
            client,
            guildId,
            pair.voiceChannelId,
            pair.textChannelId || undefined
          )
        return
      }

      return
    }

    if (player) void this.checkActivity(client, guildId, player)
  }

  scheduleRejoin(
    client: VoiceClientLike,
    guildId: string,
    voiceId?: string,
    textId?: string
  ) {
    if (!this.breaker.canAttempt(guildId)) return

    this.setTimeout(
      guildId,
      () => {
        if (!this.setState(guildId, STATE_REJOINING)) return
        void (async () => {
          let outcome: RejoinOutcome = 'retry'
          try {
            outcome = await this.rejoinChannel(client, guildId, voiceId, textId)
          } catch {
            outcome = 'retry'
          }

          if (outcome === 'connected') {
            this.breaker.recordResult(guildId, true)
            this.setState(guildId, STATE_IDLE)
            return
          }

          this.setState(guildId, STATE_IDLE)
          if (outcome === 'retry') {
            this.breaker.recordResult(guildId, false)
            this.scheduleRejoin(client, guildId, voiceId, textId)
          }
        })()
      },
      REJOIN_DELAY
    )
  }

  async rejoinChannel(
    client: VoiceClientLike,
    guildId: string,
    voiceId?: string,
    textId?: string
  ): Promise<RejoinOutcome> {
    const pair = _functions.getChannelPair(guildId, voiceId, textId)
    if (!pair) return 'noop'

    const guild = await _functions.fetchGuild(this.guildCache, client, guildId)
    if (!guild) return 'retry'

    const botId = _functions.getBotId(client)
    if (botId) {
      const botVc = _functions.getBotVoiceChannelId(guild, botId)
      if (botVc === pair.voiceChannelId) return 'noop'
    }

    const voiceChannel = await _functions.getVoiceChannel(
      guild,
      pair.voiceChannelId
    )
    if (!voiceChannel) return 'retry'

    const players = client.aqua?.players as
      | { get?: (guildId: string) => PlayerLike | undefined }
      | undefined
    const existing =
      typeof players?.get === 'function' ? players.get(guildId) : undefined
    const connectionOptions = {
      guildId,
      voiceChannel: pair.voiceChannelId,
      ...(pair.textChannelId ? { textChannel: pair.textChannelId } : {})
    }

    try {
      createPlayerConnection(client, connectionOptions)
    } catch {
      if (existing?.destroy) {
        try {
          existing.destroy()
          createPlayerConnection(client, connectionOptions)
        } catch {
          return 'retry'
        }
      } else {
        return 'retry'
      }
    }

    return 'connected'
  }

  scheduleDestroy(client: VoiceClientLike, player: PlayerLike) {
    if (!player.guildId) return
    const guildId = player.guildId
    this.setTimeout(
      guildId,
      () => {
        void (async () => {
          const players = client.aqua?.players as
            | { get?: (guildId: string) => PlayerLike | undefined }
            | undefined
          const current =
            typeof players?.get === 'function'
              ? players.get(guildId)
              : undefined
          if (!current || current.playing || isTwentyFourSevenEnabled(guildId))
            return

          const embed = new Embed()
            .setColor(0x100e09)
            .setDescription(
              'No song added in 10 minutes, disconnecting...\nUse `/247` to keep the bot in VC.'
            )
            .setFooter({ text: 'Automatically destroying player' })

          try {
            if (!current.textChannel) return
            const messages = client.messages as
              | {
                  write?: (
                    channelId: string,
                    payload: { embeds: Embed[] }
                  ) => Promise<MessageLike | undefined>
                }
              | undefined
            const msg =
              typeof messages?.write === 'function'
                ? await messages.write(current.textChannel, {
                    embeds: [embed]
                  })
                : undefined
            if (msg?.id)
              this.setTimeout(
                `msg_${msg.id}`,
                () => _functions.safeDelete(msg, guildId),
                10000
              )
          } catch {}

          current.destroy?.()
        })()
      },
      NO_SONG_TIMEOUT
    )
  }

  async checkActivity(
    client: VoiceClientLike,
    guildId: string,
    player: PlayerLike
  ) {
    const voiceId = player?.voiceChannel
    if (!voiceId) return

    const guild = await _functions.fetchGuild(this.guildCache, client, guildId)
    if (!guild) return

    const voiceChannel = await _functions.getVoiceChannel(guild, voiceId)
    if (!voiceChannel) return

    const members = voiceChannel.members || voiceChannel.voiceMembers || null
    if (_functions.countHumans(members) === 0)
      this.scheduleDestroy(client, player)
    else this.clearTimeout(guildId)
  }

  cleanup() {
    this.stopped = true
    for (const t of this.timeouts.values()) _functions.clearTimer(t)
    for (const pending of this.pending.values())
      _functions.clearTimer(pending.timer)
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

    const voiceClient = client as unknown as VoiceClientLike
    manager.register(voiceClient)
    manager.handleUpdate({ newState, oldState, guildId }, voiceClient)
  }
})

const HOOK_FLAG = '_voiceManagerCleanupHookAdded'
const processHooks = process as NodeJS.Process & Record<string, unknown>
if (!processHooks[HOOK_FLAG]) {
  processHooks[HOOK_FLAG] = true
  const cleanup = () => manager.cleanup()
  process.once('exit', cleanup)
  process.once('SIGTERM', cleanup)
  process.once('SIGINT', cleanup)
}
