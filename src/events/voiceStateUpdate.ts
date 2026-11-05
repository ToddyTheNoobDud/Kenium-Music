import process from 'node:process'
import type { Player } from 'aqualink'
import {
  createEvent,
  Embed,
  type GuildStructure,
  type MessageStructure,
  type StageChannelStructure,
  type UsingClient,
  type VoiceChannelStructure
} from 'seyfert'
import { lru } from 'tiny-lru'
import {
  cleanupKaraokeSession,
  hasKaraokeSession
} from '../commands/karaoke.ts'
import { extractDiscordApiCode } from '../shared/errorGuard.ts'
import { createPlayerConnection } from '../shared/player.ts'
import {
  isPlayerConnectedToChannel,
  isPlayerRecovering
} from '../shared/voiceLifecycle.ts'
import {
  get247ChannelIds,
  getAll247Settings,
  isTwentyFourSevenEnabled,
  updateGuildSettingsSync
} from '../utils/db_helper.ts'

const NO_SONG_TIMEOUT = 600000
const REJOIN_DELAY = 5000
const BULK_REJOIN_STAGGER = 2500
const BULK_REJOIN_DEDUPE_WINDOW = 15000
const CONFIRM_ATTEMPTS = 10
const CONFIRM_INTERVAL_MS = 1000
const CLEANUP_INTERVAL = 300000
const CACHE_SIZE = 1000
const DEBOUNCE_DELAY = 50

type RejoinOutcome = 'connected' | 'retry' | 'noop'
type TimerLike = ReturnType<typeof setTimeout>
type RecoverySource =
  | 'startup'
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
type VoiceGuild = Pick<GuildStructure, 'channels'>
type VoiceChannel = VoiceChannelStructure | StageChannelStructure
type GuildCache = ReturnType<typeof lru<VoiceGuild>>
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

function unrefTimeout(callback: () => void, delay: number) {
  const timer = setTimeout(callback, delay)
  timer.unref()
  return timer
}

function clearTimer(timer: TimerLike | null | undefined) {
  if (timer) {
    clearTimeout(timer)
  }
  return null
}

function deleteIdleMessage(message: MessageStructure, guildId: string) {
  if (hasKaraokeSession(guildId)) {
    cleanupKaraokeSession(guildId)
  }
  void message.delete().catch(() => {})
}

function getChannelPair(
  guildId: string,
  voiceId?: string | null,
  textId?: string | null
) {
  const ids = get247ChannelIds(guildId)
  const voiceChannelId = voiceId ?? ids?.voiceChannelId ?? null
  if (!voiceChannelId) {
    return null
  }

  return {
    voiceChannelId,
    textChannelId: textId ?? ids?.textChannelId ?? null
  }
}

async function fetchGuild(
  cache: GuildCache,
  client: UsingClient,
  guildId: string
): Promise<VoiceGuild | null> {
  let guild = cache.get(guildId)
  if (guild) {
    return guild
  }

  try {
    guild = await client.guilds.fetch(guildId)
    cache.set(guildId, guild)
    return guild
  } catch (error) {
    if (
      extractDiscordApiCode(error) === 10004 &&
      isTwentyFourSevenEnabled(guildId)
    ) {
      updateGuildSettingsSync(guildId, {
        twentyFourSevenEnabled: false,
        last247DisableReason: 'unknown_guild'
      })
      client.logger.info(
        `[VoiceManager] Disabled 24/7 for unknown guild ${guildId} (Discord 10004).`
      )
    }
    return null
  }
}

async function getVoiceChannel(
  guild: VoiceGuild,
  channelId: string,
  force = false
): Promise<VoiceChannel | null> {
  const channel = await guild.channels.fetch(channelId, force)
  return channel.isVoice() || channel.isStage() ? channel : null
}

class CircuitBreaker {
  failures = new Map<string, { count: number; lastAttempt: number }>()
  maxFailures = 15
  baseResetTime = 30000

  getDelay(guildId: string): number {
    const entry = this.failures.get(guildId)
    if (!entry) {
      return REJOIN_DELAY
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
    if (success) {
      this.failures.delete(guildId)
      return
    }
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
    for (const [guildId, entry] of this.failures) {
      // Entries in exponential backoff never expire: retries continue at
      // capped backoff forever and user settings are never deleted.
      if (entry.count >= this.maxFailures) {
        continue
      }
      if (now - entry.lastAttempt > expireTime) {
        this.failures.delete(guildId)
      }
    }
  }
}

type RecoveryJob = {
  client: UsingClient
  dueAt: number
  source: RecoverySource
  textId?: string
  timer: TimerLike
  voiceId?: string
}

class VoiceManager {
  timeouts = new Map<string, TimerLike>()
  recoveryJobs = new Map<string, RecoveryJob>()
  blockedVoiceChannels = new Map<string, string>()
  states = new Map<string, number>()
  pending = new Map<
    string,
    { timer: TimerLike | null; event: VoiceStateUpdatePayload }
  >()
  breaker = new CircuitBreaker()

  guildCache = lru<VoiceGuild>(CACHE_SIZE, 60000)
  registered = new WeakSet<UsingClient>()
  cleanupTimer: TimerLike | null = null
  lastBulkRecoveryAt = 0
  stopped = false

  constructor() {
    this.setupCleanup()
  }

  setupCleanup() {
    if (this.stopped) {
      return
    }
    this.cleanupTimer = unrefTimeout(() => {
      if (this.stopped) {
        return
      }
      this.breaker.cleanup()
      // Cap states map: remove IDLE entries when map exceeds 2000 guilds
      // (prevents unbounded growth for long-lived 24/7 guilds)
      const MAX_STATES_ENTRIES = 2000
      if (this.states.size > MAX_STATES_ENTRIES) {
        for (const [guildId, state] of this.states) {
          if (state === STATE_IDLE) {
            this.states.delete(guildId)
          }
          if (this.states.size <= Math.floor(MAX_STATES_ENTRIES * 0.8)) {
            break
          }
        }
      }
      this.setupCleanup()
    }, CLEANUP_INTERVAL)
  }

  setState(guildId: string, newState: number): boolean {
    const current = this.states.get(guildId) ?? STATE_IDLE
    const allowed = TRANSITIONS[current] ?? 0
    if (!(allowed & newState)) {
      return false
    }
    this.states.set(guildId, newState)
    return true
  }

  clearTimeout(key: string) {
    const timer = this.timeouts.get(key)
    if (!timer) {
      return
    }
    clearTimer(timer)
    this.timeouts.delete(key)
  }

  setTimeout(key: string, callback: () => void, delay: number) {
    this.clearTimeout(key)
    this.timeouts.set(
      key,
      unrefTimeout(() => {
        this.timeouts.delete(key)
        callback()
      }, delay)
    )
  }

  cancelRecovery(guildId: string) {
    const job = this.recoveryJobs.get(guildId)
    if (!job) {
      return
    }
    clearTimer(job.timer)
    this.recoveryJobs.delete(guildId)
  }

  cancelAllRecovery() {
    this.lastBulkRecoveryAt = 0
    for (const job of this.recoveryJobs.values()) {
      clearTimer(job.timer)
    }
    this.recoveryJobs.clear()
    for (const pending of this.pending.values()) {
      clearTimer(pending.timer)
    }
    this.pending.clear()
  }

  register(client: UsingClient) {
    if (this.registered.has(client)) {
      return
    }

    const aqua = client.aqua
    this.registered.add(client)

    const handlers = {
      trackStart: (player: Player) => {
        if (!player.guildId) {
          return
        }
        this.setState(player.guildId, STATE_PLAYING)
        this.clearTimeout(player.guildId)
        this.cancelRecovery(player.guildId)
      },

      queueEnd: (player: Player) => {
        if (!player.guildId) {
          return
        }
        this.setState(player.guildId, STATE_IDLE)
        if (!isTwentyFourSevenEnabled(player.guildId)) {
          this.scheduleDestroy(client, player)
        }
      },

      playerDestroy: (player: Player) => {
        if (!player.guildId) {
          return
        }
        if (isPlayerRecovering(player)) {
          return
        }
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
        player: Player,
        payload: {
          code?: number
        }
      ) => {
        const guildId = player.guildId
        const code = payload?.code
        if (
          !guildId ||
          code === undefined ||
          ![1001, 1006, 4014, 4015, 4022, 5001].includes(code)
        ) {
          return
        }
        if (!isTwentyFourSevenEnabled(guildId)) {
          return
        }
        // Don't fight Aqualink's built-in recovery/reconnection
        if (isPlayerRecovering(player)) {
          return
        }

        this.scheduleRejoin(
          client,
          guildId,
          player.voiceChannel,
          player.textChannel,
          'socketClosed'
        )
      }
    }

    aqua.on('trackStart', handlers.trackStart)
    aqua.on('queueEnd', handlers.queueEnd)
    aqua.on('playerDestroy', handlers.playerDestroy)
    aqua.on('socketClosed', handlers.socketClosed)
  }

  handleUpdate(event: VoiceStateUpdatePayload, client: UsingClient) {
    const guildId = event.guildId
    if (!guildId) {
      return
    }

    const existing = this.pending.get(guildId)
    if (existing) {
      existing.timer = clearTimer(existing.timer)
    }

    this.pending.set(guildId, {
      event,
      timer: unrefTimeout(() => {
        this.pending.delete(guildId)
        this.processUpdate(event, client)
      }, DEBOUNCE_DELAY)
    })
  }

  processUpdate(event: VoiceStateUpdatePayload, client: UsingClient) {
    const { newState, oldState } = event
    const guildId = event.guildId
    if (!guildId || oldState?.channelId === newState?.channelId) {
      return
    }
    // Invalidate human count cache for affected channels
    if (oldState?.channelId) {
      humanCountCache.delete(oldState.channelId)
    }
    if (newState?.channelId) {
      humanCountCache.delete(newState.channelId)
    }

    const players = client.aqua.players
    const player = players.get(guildId)
    const is247 = isTwentyFourSevenEnabled(guildId)

    if (is247) {
      const botId = client.botId
      const userId = newState?.userId ?? oldState?.userId
      const botLeft =
        botId && userId === botId && oldState?.channelId && !newState?.channelId

      if (botLeft) {
        if (isPlayerRecovering(player)) {
          return
        }
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
        const pair = getChannelPair(guildId, null, null)
        if (pair) {
          this.scheduleRejoin(
            client,
            guildId,
            pair.voiceChannelId,
            pair.textChannelId || undefined,
            'voiceStateUpdate'
          )
        }
        return
      }

      return
    }

    if (player) {
      void this.checkActivity(client, guildId, player)
    }
  }

  scheduleRejoin(
    client: UsingClient,
    guildId: string,
    voiceId?: string,
    textId?: string,
    source: RecoverySource = 'retry',
    minimumDelay = 0
  ) {
    if (!gatewayHealthy || autoJoinRunning) {
      return
    }
    const blockedChannelId = this.blockedVoiceChannels.get(guildId)
    if (blockedChannelId) {
      const voiceChannelId =
        voiceId ?? get247ChannelIds(guildId)?.voiceChannelId
      if (voiceChannelId === blockedChannelId) {
        return
      }
      this.blockedVoiceChannels.delete(guildId)
    }
    const breakerDelay = this.breaker.getDelay(guildId)

    this.clearTimeout(guildId)
    const delay = Math.max(breakerDelay, minimumDelay)
    const dueAt = Date.now() + delay
    const existingJob = this.recoveryJobs.get(guildId)

    if (existingJob) {
      existingJob.client = client
      existingJob.source = source
      if (voiceId !== undefined) {
        existingJob.voiceId = voiceId
      }
      if (textId !== undefined) {
        existingJob.textId = textId
      }
      if (existingJob.dueAt <= dueAt) {
        return
      }
      clearTimer(existingJob.timer)
    }

    const timer = unrefTimeout(() => {
      const job = this.recoveryJobs.get(guildId)
      if (!job || job.timer !== timer) {
        return
      }
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
        } catch (error) {
          job.client.logger.warn(
            `[VoiceManager] Unexpected recovery error for ${guildId}:`,
            error
          )
          outcome = 'retry'
        }

        const attempt = (this.breaker.failures.get(guildId)?.count ?? 0) + 1
        // Skip the boring case (first-try success) to keep logs readable
        // at scale; retries and recovered guilds are always logged.
        if (outcome === 'retry' || attempt > 1) {
          job.client.logger.info(
            `[VoiceManager] rejoin ${job.source} ${guildId}: ${outcome} (attempt ${attempt})`
          )
        }

        if (outcome === 'connected') {
          this.breaker.recordResult(guildId, true)
          this.setState(guildId, STATE_IDLE)
          return
        }

        this.setState(guildId, STATE_IDLE)
        if (outcome === 'retry') {
          this.cancelRecovery(guildId)
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
    client: UsingClient,
    guildId: string,
    voiceId?: string,
    textId?: string
  ): Promise<RejoinOutcome> {
    if (!isTwentyFourSevenEnabled(guildId)) {
      return 'noop'
    }
    const pair = getChannelPair(guildId, voiceId, textId)
    if (!pair) {
      return 'noop'
    }

    const players = client.aqua.players
    let existing = players.get(guildId)

    if (isPlayerConnectedToChannel(existing, pair.voiceChannelId)) {
      return 'connected'
    }
    if (isPlayerRecovering(existing)) {
      client.logger.warn(
        `[VoiceManager] recovery blocked ${guildId}: Aqualink recovering`
      )
      return 'retry'
    }

    const guild = await fetchGuild(this.guildCache, client, guildId)
    if (!guild) {
      if (!isTwentyFourSevenEnabled(guildId)) {
        this.cancelRecovery(guildId)
        this.breaker.reset(guildId)
        return 'noop'
      }
      client.logger.warn(
        `[VoiceManager] recovery blocked ${guildId}: guild lookup failed`
      )
      return 'retry'
    }

    let voiceChannel: VoiceChannel | null
    try {
      voiceChannel = await getVoiceChannel(guild, pair.voiceChannelId, true)
    } catch (error) {
      const code = extractDiscordApiCode(error)
      if (code === 10003) {
        await disableTwentyFourSevenForUnknownChannel(
          client,
          guildId,
          pair.voiceChannelId
        )
        return 'noop'
      }
      const outcome = code === 50001 || code === 50013 ? 'noop' : 'retry'
      if (outcome === 'noop') {
        this.blockedVoiceChannels.set(guildId, pair.voiceChannelId)
        this.cancelRecovery(guildId)
      }
      const reason =
        code === null
          ? error instanceof Error
            ? error.message
            : String(error)
          : `Discord ${code}`
      client.logger.warn(
        `[VoiceManager] Failed to fetch voice channel ${pair.voiceChannelId} for ${guildId}: ${reason}. ${outcome === 'noop' ? 'Automatic retries stopped; check the saved channel and bot permissions, then toggle /247 off and on to save a valid channel.' : 'Will retry.'} Keeping 24/7 settings.`
      )
      return outcome
    }
    if (!voiceChannel) {
      this.blockedVoiceChannels.set(guildId, pair.voiceChannelId)
      this.cancelRecovery(guildId)
      client.logger.warn(
        `[VoiceManager] Voice channel ${pair.voiceChannelId} for ${guildId} has an unsupported type. Automatic retries stopped; toggle /247 off and on in a voice channel. Keeping 24/7 settings.`
      )
      return 'noop'
    }

    existing = players.get(guildId)
    if (isPlayerConnectedToChannel(existing, pair.voiceChannelId)) {
      return 'connected'
    }
    if (isPlayerRecovering(existing)) {
      client.logger.warn(
        `[VoiceManager] recovery blocked ${guildId}: Aqualink started recovering during channel lookup`
      )
      return 'retry'
    }

    const connectionOptions = {
      guildId,
      voiceChannel: pair.voiceChannelId,
      ...(pair.textChannelId ? { textChannel: pair.textChannelId } : {})
    }

    try {
      if (existing && !existing.destroyed) {
        await existing.connect({
          guildId,
          voiceChannel: pair.voiceChannelId,
          deaf: existing.deaf,
          mute: existing.mute
        })
        // Unchanged Gateway data can be deduplicated before reaching the node.
        if (
          !existing.connected &&
          existing.connection.voiceChannel === pair.voiceChannelId
        ) {
          await existing.connection.resendVoiceUpdate(true)
        }
      } else {
        const connection = await createPlayerConnection(
          client,
          connectionOptions
        )
        if (connection.destroyed) {
          client.logger.warn(
            `[VoiceManager] Created player was destroyed before voice confirmation for ${guildId} in ${pair.voiceChannelId}. Will retry.`
          )
          return 'retry'
        }
      }
    } catch (error) {
      client.logger.warn(
        `[VoiceManager] Voice connection failed for ${guildId} in ${pair.voiceChannelId}: ${error instanceof Error ? error.message : String(error)}`
      )
      return 'retry'
    }

    const confirmed = await this.confirmVoiceConnection(
      client,
      guildId,
      pair.voiceChannelId
    )
    if (!confirmed) {
      client.logger.warn(
        `[VoiceManager] Voice connection not confirmed for ${guildId} in ${pair.voiceChannelId}. Will retry.`
      )
    }
    return confirmed ? 'connected' : 'retry'
  }

  /**
   * Check the latest registered player for confirmation of the configured channel.
   * A completed join request and a later server state update can report different states.
   */
  async confirmVoiceConnection(
    client: UsingClient,
    guildId: string,
    voiceChannelId: string
  ): Promise<boolean> {
    const players = client.aqua.players
    for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt++) {
      const current = players.get(guildId)
      if (isPlayerConnectedToChannel(current, voiceChannelId)) {
        return true
      }
      if (isPlayerRecovering(current)) {
        return false
      }
      await new Promise((resolve) => setTimeout(resolve, CONFIRM_INTERVAL_MS))
    }
    const current = players.get(guildId)
    return isPlayerConnectedToChannel(current, voiceChannelId)
  }

  scheduleDestroy(client: UsingClient, player: Player) {
    if (!player.guildId) {
      return
    }
    const guildId = player.guildId
    // 24/7 players are exempt from the idle destroy below, so don't let
    // an empty-channel reading cancel their queued rejoin either.
    if (isTwentyFourSevenEnabled(guildId)) {
      return
    }
    this.cancelRecovery(guildId)
    this.setTimeout(
      guildId,
      () => {
        void (async () => {
          const players = client.aqua.players
          const current = players.get(guildId)
          if (
            !current ||
            current.playing ||
            isTwentyFourSevenEnabled(guildId)
          ) {
            return
          }

          if (current.textChannel) {
            const embed = new Embed()
              .setColor(0x100e09)
              .setDescription(
                'No song added in 10 minutes, disconnecting...\nUse `/247` to keep the bot in VC.'
              )
              .setFooter({ text: 'Automatically destroying player' })

            try {
              const msg = await client.messages.write(current.textChannel, {
                embeds: [embed]
              })
              if (msg?.id) {
                this.setTimeout(
                  `msg_${msg.id}`,
                  () => deleteIdleMessage(msg, guildId),
                  10000
                )
              }
            } catch {}
          }

          void current.destroy()
        })()
      },
      NO_SONG_TIMEOUT
    )
  }

  async checkActivity(client: UsingClient, guildId: string, player: Player) {
    const voiceId = player.voiceChannel
    if (!voiceId) {
      return
    }

    const guild = await fetchGuild(this.guildCache, client, guildId)
    if (!guild) {
      return
    }

    const voiceChannel = await getVoiceChannel(guild, voiceId).catch(() => null)
    if (!voiceChannel) {
      return
    }

    let humanCount = humanCountCache.get(voiceId)
    if (humanCount === undefined) {
      const members = await voiceChannel.members().catch(() => null)
      if (!members) {
        return
      }
      humanCount = members.filter((member) => !member.user.bot).length
      humanCountCache.set(voiceId, humanCount)
    }
    if (humanCount === 0) {
      this.scheduleDestroy(client, player)
    } else {
      this.clearTimeout(guildId)
    }
  }

  requestBulkRecovery(
    client: UsingClient,
    source: 'startup' | 'gatewayReconnect' | 'gatewayResumed'
  ) {
    if (autoJoinRunning) {
      client.logger.info(
        '[VoiceManager] bulk recovery skipped: 24/7 auto-join running.'
      )
      return
    }
    if (!gatewayHealthy) {
      return
    }
    if (!client.aqua.initiated || !client.aqua.leastUsedNodes.length) {
      return
    }

    const now = Date.now()
    if (now - this.lastBulkRecoveryAt < BULK_REJOIN_DEDUPE_WINDOW) {
      return
    }
    this.lastBulkRecoveryAt = now

    const settingsList = getAll247Settings()
    if (!settingsList.length) {
      return
    }

    const players = client.aqua.players
    let scheduled = 0
    let alreadyConnected = 0
    let ownedByAqualink = 0

    for (const settings of settingsList) {
      const player = players.get(settings.guildId)

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
        REJOIN_DELAY +
          scheduled * BULK_REJOIN_STAGGER +
          Math.random() * BULK_REJOIN_STAGGER
      )
      scheduled++
    }

    client.logger.info(
      `[VoiceManager] ${source}: ${alreadyConnected} already connected, ${ownedByAqualink} recovering in Aqualink, ${scheduled} queued.`
    )
  }

  cleanup() {
    this.stopped = true
    for (const timer of this.timeouts.values()) {
      clearTimer(timer)
    }
    for (const job of this.recoveryJobs.values()) {
      clearTimer(job.timer)
    }
    for (const pending of this.pending.values()) {
      clearTimer(pending.timer)
    }
    clearTimer(this.cleanupTimer)

    this.timeouts.clear()
    this.recoveryJobs.clear()
    this.blockedVoiceChannels.clear()
    this.pending.clear()
    this.states.clear()
    this.guildCache.clear()
    this.breaker.cleanup()
    this.cleanupTimer = null
  }
}

export const manager = new VoiceManager()

let gatewayHealthy = false
// Startup owns voice joins until its final recovery sweep.
let autoJoinRunning = true

export const isVoiceGatewayHealthy = () => gatewayHealthy

export const setVoiceGatewayHealthy = (healthy: boolean) => {
  gatewayHealthy = healthy
  if (!healthy) {
    manager.cancelAllRecovery()
  }
}

export const setAutoJoinRunning = (running: boolean) => {
  autoJoinRunning = running
  // Auto-join covers every 24/7 guild itself: drop any recovery jobs
  // queued earlier (e.g. by a reconnect sweep) so guilds aren't joined twice.
  if (running) {
    manager.cancelAllRecovery()
  }
}

export default createEvent({
  data: { name: 'voiceStateUpdate', once: false },
  run: async ([newState, oldState], client) => {
    const guildId = newState?.guildId ?? oldState?.guildId
    if (!guildId) {
      return
    }
    if (oldState?.channelId === newState?.channelId) {
      return
    }

    manager.register(client)
    manager.handleUpdate({ newState, oldState, guildId }, client)
  }
})

/** Reset the rejoin circuit breaker for a guild. Call when 24/7 is re-enabled. */
export const resetRejoinBreaker = (guildId: string) => {
  manager.breaker.reset(guildId)
  manager.blockedVoiceChannels.delete(guildId)
}

export const disableTwentyFourSevenForUnknownChannel = async (
  client: UsingClient,
  guildId: string,
  voiceChannelId: string
) => {
  if (get247ChannelIds(guildId)?.voiceChannelId !== voiceChannelId) {
    return
  }
  updateGuildSettingsSync(guildId, {
    twentyFourSevenEnabled: false,
    voiceChannelId: null,
    textChannelId: null,
    last247DisableReason: 'unknown_voice_channel'
  })
  manager.cancelRecovery(guildId)
  resetRejoinBreaker(guildId)
  client.logger.info(
    `[24/7] Disabled 24/7 for ${guildId}: saved voice channel ${voiceChannelId} is unknown (Discord 10003). Cleared saved channel IDs.`
  )
  try {
    const member = await client.members.fetch(guildId, client.botId, true)
    const nickname = member.nick
    if (nickname?.includes('[24/7]')) {
      await member.edit({ nick: nickname.replace(/ ?\[24\/7\]/, '') })
    }
  } catch (error) {
    client.logger.warn(
      `[24/7] Disabled 24/7 for ${guildId}, but could not remove the nickname suffix: ${extractDiscordApiCode(error) ?? (error instanceof Error ? error.message : String(error))}`
    )
  }
}

/** Invalidate cached guild data after 24/7 settings change. */
export const refresh247Cache = () => {
  manager.guildCache.clear()
}

/** Request one deduplicated, globally staggered 24/7 recovery sweep. */
export const requestTwentyFourSevenRecovery = (
  client: UsingClient,
  source: 'startup' | 'gatewayReconnect' | 'gatewayResumed'
) => {
  const gateway = client.gateway
  if (
    gateway.size === 0 ||
    gateway.size !== gateway.shardEnd - gateway.shardStart
  ) {
    return
  }
  for (const shard of gateway.values()) {
    if (!shard.isOpen || !shard.isReady) {
      return
    }
  }
  setVoiceGatewayHealthy(true)
  manager.requestBulkRecovery(client, source)
}

/** Register VoiceManager event handlers on client. */
export const registerVoiceManager = (client: UsingClient) => {
  manager.register(client)
  if (!cleanupHooksAdded) {
    cleanupHooksAdded = true
    const cleanup = () => manager.cleanup()
    process.once('exit', cleanup)
    process.once('SIGTERM', cleanup)
    process.once('SIGINT', cleanup)
  }
}

let cleanupHooksAdded = false
