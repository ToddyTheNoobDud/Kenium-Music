import process from 'node:process'
import { createEvent, Embed } from 'seyfert'
import { lru } from 'tiny-lru'
import {
  cleanupKaraokeSession,
  hasKaraokeSession
} from '../commands/karaoke.ts'
import type {
  AquaClientLike,
  PlayerLike,
  TrackLike
} from '../shared/helperTypes.ts'
import { createPlayerConnection } from '../shared/player.ts'
import {
  isPlayerConnectedToChannel,
  isPlayerRecovering,
  isSupportedVoiceChannelType
} from '../shared/voiceLifecycle.ts'
import {
  disable247Sync,
  get247ChannelIds,
  getAll247Settings,
  isTwentyFourSevenEnabled
} from '../utils/db_helper.ts'

const NO_SONG_TIMEOUT = 600000
const REJOIN_DELAY = 5000
const BULK_REJOIN_STAGGER = 900
const BULK_REJOIN_DEDUPE_WINDOW = 15000
const CLEANUP_INTERVAL = 300000
const CACHE_SIZE = 1000
const DEBOUNCE_DELAY = 50

type RejoinOutcome = 'connected' | 'retry' | 'noop'
type TimerLike = ReturnType<typeof setTimeout>
type RecoverySource =
  | 'gatewayReconnect'
  | 'gatewayResumed'
  | 'playerDestroy'
  | 'socketClosed'
  | 'voiceStateUpdate'
  | 'retry'
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
  logger?: {
    info: (...args: unknown[]) => void
    warn: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
  }
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

// Cache human counts per channel (60s TTL)
const humanCountCache = lru<number>(CACHE_SIZE, 60000)

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
    if (ch) return isSupportedVoiceChannelType(ch.type) ? ch : null
    try {
      ch =
        typeof channels?.fetch === 'function'
          ? await channels.fetch(channelId)
          : undefined
      return ch && isSupportedVoiceChannelType(ch.type) ? ch : null
    } catch {
      return null
    }
  },
  countHumans(channelId: string, members: MembersLike): number {
    const cached = humanCountCache.get(channelId)
    if (cached != null) return cached
    let n = 0
    const it = getIterableMembers(members)
    if (!it) return 0
    for (const member of it) if (!member?.user?.bot) n++
    humanCountCache.set(channelId, n)
    return n
  }
}

const MAX_REJOIN_ATTEMPTS = 60

type GiveUpCallback = (guildId: string) => void

class CircuitBreaker {
  failures = new Map<string, { count: number; lastAttempt: number }>()
  maxFailures = 15
  baseResetTime = 30000
  onGiveUp: GiveUpCallback | null = null

  getDelay(guildId: string): number {
    const entry = this.failures.get(guildId)
    if (!entry) return REJOIN_DELAY
    if (entry.count >= MAX_REJOIN_ATTEMPTS) {
      return -1
    }
    if (entry.count < this.maxFailures) {
      return REJOIN_DELAY
    }
    const backoffLevel = Math.max(0, entry.count - this.maxFailures)
    const resetTime = this.baseResetTime * 2 ** Math.min(backoffLevel, 5)
    const elapsed = Date.now() - entry.lastAttempt
    const remaining = resetTime - elapsed
    return Math.max(REJOIN_DELAY, remaining)
  }

  recordResult(guildId: string, success: boolean) {
    if (success) return void this.failures.delete(guildId)
    const entry = this.failures.get(guildId)
    this.failures.set(guildId, {
      count: (entry?.count ?? 0) + 1,
      lastAttempt: Date.now()
    })
  }

  reset(guildId: string) {
    this.failures.delete(guildId)
  }

  cleanup() {
    const now = Date.now()
    const expireTime = 600000
    for (const [guildId, entry] of this.failures)
      if (now - entry.lastAttempt > expireTime) this.failures.delete(guildId)
  }
}

type RecoveryJob = {
  client: VoiceClientLike
  dueAt: number
  source: RecoverySource
  textId?: string
  timer: TimerLike
  voiceId?: string
}

class VoiceManager {
  timeouts = new Map<string, TimerLike>()
  recoveryJobs = new Map<string, RecoveryJob>()
  states = new Map<string, number>()
  pending = new Map<
    string,
    { timer: TimerLike | null; event: VoiceStateUpdatePayload }
  >()
  breaker = new CircuitBreaker()

  /** Guilds where 24/7 was auto-disabled due to persistent rejoin failure */
  autoDisabled247 = new Set<string>()

  /** Called by CircuitBreaker when a guild hits MAX_REJOIN_ATTEMPTS */
  private handleRejoinGiveUp = (guildId: string) => {
    if (this.autoDisabled247.has(guildId)) return
    if (!isTwentyFourSevenEnabled(guildId)) return
    try {
      disable247Sync(
        guildId,
        'Voice channel unreachable after 60 rejoin attempts'
      )
      this.autoDisabled247.add(guildId)
      this.states.delete(guildId)
      console.error(
        '[VoiceManager] Auto-disabled 24/7 for guild',
        guildId,
        '- channel unreachable after',
        MAX_REJOIN_ATTEMPTS,
        'attempts'
      )
    } catch (err) {
      console.error(
        '[VoiceManager] Failed to auto-disable 24/7 for',
        guildId,
        err
      )
    }
  }
  guildCache = lru(CACHE_SIZE, 60000) as GuildCacheLike
  registered = new WeakSet<VoiceClientLike>()
  cleanupTimer: TimerLike | null = null
  lastBulkRecoveryAt = 0
  stopped = false

  constructor() {
    this.breaker.onGiveUp = this.handleRejoinGiveUp
    this.setupCleanup()
  }

  setupCleanup() {
    if (this.stopped) return
    this.cleanupTimer = _functions.unrefTimeout(() => {
      if (this.stopped) return
      try {
        this.breaker.cleanup()
        // Cap states map: remove IDLE entries when map exceeds 2000 guilds
        // (prevents unbounded growth for long-lived 24/7 guilds)
        const MAX_STATES_ENTRIES = 2000
        if (this.states.size > MAX_STATES_ENTRIES) {
          for (const [gid, st] of this.states) {
            if (st === STATE_IDLE) this.states.delete(gid)
            if (this.states.size <= Math.floor(MAX_STATES_ENTRIES * 0.8)) break
          }
        }
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

  cancelRecovery(guildId: string) {
    const job = this.recoveryJobs.get(guildId)
    if (!job) return
    _functions.clearTimer(job.timer)
    this.recoveryJobs.delete(guildId)
  }

  cancelAllRecovery() {
    for (const job of this.recoveryJobs.values())
      _functions.clearTimer(job.timer)
    this.recoveryJobs.clear()
    for (const pending of this.pending.values())
      _functions.clearTimer(pending.timer)
    this.pending.clear()
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
        this.cancelRecovery(player.guildId)
      },

      queueEnd: (player: PlayerLike) => {
        if (!player.guildId) return
        this.setState(player.guildId, STATE_IDLE)
        if (!isTwentyFourSevenEnabled(player.guildId))
          this.scheduleDestroy(client, player)
      },

      playerDestroy: (player: PlayerLike) => {
        if (!player?.guildId) return
        if (isPlayerRecovering(player)) return
        this.setState(player.guildId, STATE_DESTROYING)
        this.clearTimeout(player.guildId)

        if (isTwentyFourSevenEnabled(player.guildId)) {
          this.scheduleRejoin(
            client,
            player.guildId,
            player.voiceChannel ?? undefined,
            player.textChannel ?? undefined,
            'playerDestroy'
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
        if (
          !guildId ||
          code === undefined ||
          ![1001, 1006, 4014, 4015, 4022, 5001].includes(code)
        ) {
          return
        }
        if (!isTwentyFourSevenEnabled(guildId)) return
        // Don't fight Aqualink's built-in recovery/reconnection
        if (isPlayerRecovering(player)) return

        this.scheduleRejoin(
          client,
          guildId,
          player?.voiceChannel ?? undefined,
          player?.textChannel ?? undefined,
          'socketClosed'
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
    // Invalidate human count cache for affected channels
    if (oldState?.channelId) humanCountCache.delete(oldState.channelId)
    if (newState?.channelId) humanCountCache.delete(newState.channelId)

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
        if (isPlayerRecovering(player)) return
        this.scheduleRejoin(
          client,
          guildId,
          player?.voiceChannel ?? oldState.channelId ?? undefined,
          player?.textChannel ?? undefined,
          'voiceStateUpdate'
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
            pair.textChannelId || undefined,
            'voiceStateUpdate'
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
    textId?: string,
    source: RecoverySource = 'retry',
    minimumDelay = 0
  ) {
    if (!gatewayHealthy) return
    const breakerDelay = this.breaker.getDelay(guildId)
    if (breakerDelay < 0) {
      this.handleRejoinGiveUp(guildId)
      return
    }

    this.clearTimeout(guildId)
    const delay = Math.max(breakerDelay, minimumDelay)
    const dueAt = Date.now() + delay
    const existingJob = this.recoveryJobs.get(guildId)

    if (existingJob) {
      existingJob.client = client
      existingJob.source = source
      if (voiceId !== undefined) existingJob.voiceId = voiceId
      if (textId !== undefined) existingJob.textId = textId
      if (existingJob.dueAt <= dueAt) return
      _functions.clearTimer(existingJob.timer)
    }

    const timer = _functions.unrefTimeout(() => {
      const job = this.recoveryJobs.get(guildId)
      if (!job || job.timer !== timer) return
      this.recoveryJobs.delete(guildId)
      if (!gatewayHealthy) {
        this.setState(guildId, STATE_IDLE)
        return
      }

      void (async () => {
        if (!this.setState(guildId, STATE_REJOINING)) {
          this.scheduleRejoin(
            job.client,
            guildId,
            job.voiceId,
            job.textId,
            job.source,
            REJOIN_DELAY
          )
          return
        }

        let outcome: RejoinOutcome = 'retry'
        try {
          outcome = await this.rejoinChannel(
            job.client,
            guildId,
            job.voiceId,
            job.textId
          )
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
          this.scheduleRejoin(
            job.client,
            guildId,
            job.voiceId,
            job.textId,
            'retry'
          )
        }
      })()
    }, delay)

    this.recoveryJobs.set(guildId, {
      client,
      dueAt,
      source,
      timer,
      ...(textId !== undefined ? { textId } : {}),
      ...(voiceId !== undefined ? { voiceId } : {})
    })
  }

  async rejoinChannel(
    client: VoiceClientLike,
    guildId: string,
    voiceId?: string,
    textId?: string
  ): Promise<RejoinOutcome> {
    const pair = _functions.getChannelPair(guildId, voiceId, textId)
    if (!pair) return 'noop'

    const players = client.aqua?.players as
      | { get?: (guildId: string) => PlayerLike | undefined }
      | undefined
    let existing =
      typeof players?.get === 'function' ? players.get(guildId) : undefined

    if (isPlayerConnectedToChannel(existing, pair.voiceChannelId)) {
      return 'connected'
    }
    if (isPlayerRecovering(existing)) return 'noop'

    const guild = await _functions.fetchGuild(this.guildCache, client, guildId)
    if (!guild) return 'retry'

    const voiceChannel = await _functions.getVoiceChannel(
      guild,
      pair.voiceChannelId
    )
    if (!voiceChannel) return 'retry'

    existing =
      typeof players?.get === 'function' ? players.get(guildId) : undefined
    if (isPlayerConnectedToChannel(existing, pair.voiceChannelId)) {
      return 'connected'
    }
    if (isPlayerRecovering(existing)) return 'noop'

    const connectionOptions = {
      guildId,
      voiceChannel: pair.voiceChannelId,
      ...(pair.textChannelId ? { textChannel: pair.textChannelId } : {})
    }

    try {
      if (existing && !existing.destroyed) {
        existing.connect?.({
          guildId,
          voiceChannel: pair.voiceChannelId,
          deaf: existing.deaf ?? true,
          mute: existing.mute ?? false
        })
      } else {
        const conn = createPlayerConnection(client, connectionOptions)
        if (!conn || conn.destroyed) return 'retry'
      }
    } catch {
      if (existing?.destroy) {
        try {
          existing.destroy()
          const conn = createPlayerConnection(client, connectionOptions)
          if (!conn || conn.destroyed) return 'retry'
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
    this.cancelRecovery(guildId)
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

          if (current.textChannel) {
            const embed = new Embed()
              .setColor(0x100e09)
              .setDescription(
                'No song added in 10 minutes, disconnecting...\nUse `/247` to keep the bot in VC.'
              )
              .setFooter({ text: 'Automatically destroying player' })

            try {
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
          }

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
    if (_functions.countHumans(voiceId, members) === 0)
      this.scheduleDestroy(client, player)
    else this.clearTimeout(guildId)
  }

  requestBulkRecovery(
    client: VoiceClientLike,
    source: 'gatewayReconnect' | 'gatewayResumed'
  ) {
    const now = Date.now()
    if (now - this.lastBulkRecoveryAt < BULK_REJOIN_DEDUPE_WINDOW) return
    this.lastBulkRecoveryAt = now

    if (autoJoinRunning) {
      client.logger?.info(
        '[VoiceManager] bulk recovery skipped: 24/7 auto-join running.'
      )
      return
    }
    if (!gatewayHealthy) return

    const settingsList = getAll247Settings()
    if (!settingsList.length) return

    const players = client.aqua?.players as
      | { get?: (guildId: string) => PlayerLike | undefined }
      | undefined
    let scheduled = 0
    let alreadyConnected = 0
    let ownedByAqualink = 0

    for (const settings of settingsList) {
      const player =
        typeof players?.get === 'function'
          ? players.get(settings.guildId)
          : undefined

      if (isPlayerConnectedToChannel(player, settings.voiceChannelId)) {
        this.cancelRecovery(settings.guildId)
        this.breaker.recordResult(settings.guildId, true)
        alreadyConnected++
        continue
      }
      if (isPlayerRecovering(player)) {
        ownedByAqualink++
        continue
      }

      this.scheduleRejoin(
        client,
        settings.guildId,
        settings.voiceChannelId,
        settings.textChannelId || undefined,
        source,
        REJOIN_DELAY + scheduled * BULK_REJOIN_STAGGER
      )
      scheduled++
    }

    client.logger?.info(
      `[VoiceManager] ${source}: ${alreadyConnected} already connected, ${ownedByAqualink} recovering in Aqualink, ${scheduled} queued.`
    )
  }

  cleanup() {
    this.stopped = true
    for (const t of this.timeouts.values()) _functions.clearTimer(t)
    for (const job of this.recoveryJobs.values())
      _functions.clearTimer(job.timer)
    for (const pending of this.pending.values())
      _functions.clearTimer(pending.timer)
    _functions.clearTimer(this.cleanupTimer)

    this.timeouts.clear()
    this.recoveryJobs.clear()
    this.pending.clear()
    this.states.clear()
    this.guildCache.clear()
    this.breaker.cleanup()
    this.cleanupTimer = null
  }
}

const manager = new VoiceManager()

let gatewayHealthy = true
let autoJoinRunning = false

export const isVoiceGatewayHealthy = () => gatewayHealthy

export const setVoiceGatewayHealthy = (healthy: boolean) => {
  gatewayHealthy = healthy
  if (!healthy) manager.cancelAllRecovery()
}

export const setAutoJoinRunning = (running: boolean) => {
  autoJoinRunning = running
  // Auto-join covers every 24/7 guild itself: drop any recovery jobs
  // queued earlier (e.g. by a reconnect sweep) so guilds aren't joined twice.
  if (running) manager.cancelAllRecovery()
}

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

/** Reset the rejoin circuit breaker for a guild. Call when 24/7 is re-enabled. */
export const resetRejoinBreaker = (guildId: string) => {
  manager.breaker.reset(guildId)
  manager.autoDisabled247.delete(guildId)
}

/** Invalidate cached guild data after 24/7 settings change. */
export const refresh247Cache = () => {
  manager.guildCache.clear()
}

/** Request one deduplicated, globally staggered 24/7 recovery sweep. */
export const requestTwentyFourSevenRecovery = (
  client: VoiceClientLike,
  source: 'gatewayReconnect' | 'gatewayResumed'
) => manager.requestBulkRecovery(client, source)

/** Register VoiceManager event handlers on client. */
export const registerVoiceManager = (client: VoiceClientLike) => {
  manager.register(client)
}

const HOOK_FLAG = '_voiceManagerCleanupHookAdded'
const processHooks = process as NodeJS.Process & Record<string, unknown>
if (!processHooks[HOOK_FLAG]) {
  processHooks[HOOK_FLAG] = true
  const cleanup = () => manager.cleanup()
  process.once('exit', cleanup)
  process.once('SIGTERM', cleanup)
  process.once('SIGINT', cleanup)
}
