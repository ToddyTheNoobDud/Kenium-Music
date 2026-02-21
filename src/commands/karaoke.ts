import { Cooldown, CooldownType } from '@slipher/cooldown'
import type { Player } from 'aqualink'
import {
  Button,
  Command,
  type CommandContext,
  Container,
  Declare,
  Middlewares,
  Section,
  Separator,
  TextDisplay
} from 'seyfert'
import { ButtonStyle, MessageFlags, Spacing } from 'seyfert/lib/types'
import { getContextLanguage } from '../utils/i18n'
import { Musixmatch } from '../utils/musiclyrics'

const MUSIXMATCH = new Musixmatch()

const ACCENT_COLOR = '#100e09'
const ERROR_COLOR = '#e74c3c'

const SESSION_TIMEOUT_MS = 300000
const SONG_END_BUFFER_MS = 5000
const AUTO_DELETE_MS = 10000

const MAX_DRIFT_MS = 10000

const MIN_EDIT_DELAY_MS = 350
const MAX_EDIT_DELAY_MS = 2000
const SCHEDULER_JITTER_MS = 25

const VIEW_PAST_LINES = 1
const VIEW_NEXT_LINES = 4
const PROGRESS_BAR_LENGTH = 14

type LyricLine = {
  line: string
  timestamp?: number
  range?: { start: number; end?: number }
}

interface KaraokeSession {
  // biome-ignore lint/suspicious/noExplicitAny: message is a dynamic Discord message object
  message: any
  lines: LyricLine[]
  player: Player

  updateTimer: NodeJS.Timeout
  timeout: NodeJS.Timeout

  // biome-ignore lint/suspicious/noExplicitAny: collector is a dynamic object
  collector: any

  fallbackStartPosition: number
  fallbackStartTime: number
  title: string
  stoppedByUser: boolean
}

// biome-ignore lint/suspicious/noExplicitAny: msg is a dynamic Discord message object
const _autoDelete = (msg: any, delay = AUTO_DELETE_MS) => {
  if (!msg?.delete) return
  const timer = setTimeout(() => {
    msg.delete().catch(() => null)
  }, delay)
  if (timer.unref) timer.unref()
}

const _divider = () =>
  new Separator().setDivider(true).setSpacing(Spacing.Small)

const _createErrorContainer = (
  message: string,
  lang: string,
  ctx: CommandContext
) => {
  const t = ctx.t.get(lang)
  return new Container()
    .setColor(ERROR_COLOR)
    .addComponents(
      new TextDisplay().setContent(`❌ **${t.karaoke.error}**`),
      _divider(),
      new TextDisplay().setContent(message)
    )
}

const _createEndedContainer = (reason: 'stopped' | 'finished' | 'error') => {
  const messages = {
    stopped: '⏹ Karaoke session was stopped by a user.',
    finished: '🎵 Song ended — thanks for singing!',
    error: '⚠️ The karaoke display has been closed.'
  }

  return new Container()
    .setColor(ERROR_COLOR)
    .addComponents(
      new TextDisplay().setContent('🎙️ **Karaoke Stage**'),
      _divider(),
      new TextDisplay().setContent(messages[reason])
    )
}

const _formatTimestamp = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000)
  const mins = Math.floor(totalSeconds / 60)
  const secs = String(totalSeconds % 60).padStart(2, '0')
  return `${mins}:${secs}`
}

const _lineStartMs = (line: LyricLine): number =>
  line.range?.start ?? line.timestamp ?? 0

const _cleanLyricText = (text: string) => text.replace(/\s+/g, ' ').trim()

const _findCurrentLineIndex = (lines: LyricLine[], currentTimeMs: number) => {
  let left = 0
  let right = lines.length - 1
  let result = -1

  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    const currentLine = lines[mid]
    if (!currentLine) break
    const ts = _lineStartMs(currentLine)

    if (ts <= currentTimeMs) {
      result = mid
      left = mid + 1
    } else {
      right = mid - 1
    }
  }
  return result
}

const _createProgressBar = (
  currentMs: number,
  startMs: number,
  endMs: number
) => {
  const durationMs = endMs - startMs
  if (durationMs <= 0) return `▰${'═'.repeat(PROGRESS_BAR_LENGTH)}`

  const elapsedMs = currentMs - startMs
  const progress = Math.max(0, Math.min(1, elapsedMs / durationMs))
  const filled = Math.round(progress * PROGRESS_BAR_LENGTH)

  return `${'▰'.repeat(Math.max(1, filled))}${'═'.repeat(PROGRESS_BAR_LENGTH - filled)}`
}

const _formatViewportLine = (
  line: LyricLine,
  kind: 'past' | 'current' | 'next',
  nextIndex?: number
) => {
  const text = _cleanLyricText(line.line) || '…'

  switch (kind) {
    case 'past':
      return `-# ♫ *${text}*`
    case 'current':
      return `🎤 **${text}**`
    case 'next':
      return nextIndex === 0 ? `➜ ${text}` : `-# ♪ ${text}`
  }
}

const _createKaraokeStageContainer = (
  title: string,
  lines: LyricLine[],
  currentTimeMs: number,
  isPaused: boolean
) => {
  const stopButton = new Button()
    .setCustomId('ignore_karaoke-stop')
    .setLabel('⏹ Stop')
    .setStyle(ButtonStyle.Secondary)

  if (!lines.length) {
    return new Container()
      .setColor(ACCENT_COLOR)
      .addComponents(
        new TextDisplay().setContent('🎙️ **Karaoke Stage**'),
        _divider(),
        new TextDisplay().setContent(
          'No time-synced lyrics available for this track.'
        )
      )
  }

  const currentIdx = _findCurrentLineIndex(lines, currentTimeMs)
  const status = isPaused ? '⏸ Paused' : '▶ Playing'

  if (currentIdx < 0) {
    const firstLine = lines[0]
    const preview = lines.slice(0, Math.min(VIEW_NEXT_LINES + 1, lines.length))
    const previewText = preview
      .map((l, i) => _formatViewportLine(l, 'next', i))
      .join('\n')

    const timeUntil = firstLine ? _lineStartMs(firstLine) - currentTimeMs : 0
    const countdown =
      timeUntil > 0
        ? `⏳ Lyrics begin in **${Math.ceil(timeUntil / 1000)}s**…`
        : ''

    const bodyParts = [countdown, '', previewText].filter(Boolean).join('\n')

    return new Container()
      .setColor(ACCENT_COLOR)
      .addComponents(
        new TextDisplay().setContent(`🎙️ **${title}** · ${status}`),
        _divider(),
        new TextDisplay().setContent(bodyParts),
        _divider(),
        new Section()
          .addComponents(
            new TextDisplay().setContent('-# Get ready to sing! 🎶')
          )
          .setAccessory(stopButton)
      )
  }

  const safeIdx = currentIdx
  const current = lines[safeIdx]
  if (!current) {
    return new Container()
      .setColor(ACCENT_COLOR)
      .addComponents(new TextDisplay().setContent('…'))
  }

  const next = lines[safeIdx + 1]
  const segStart = _lineStartMs(current)
  const segEnd = next ? _lineStartMs(next) : segStart + 4000

  const bar = _createProgressBar(currentTimeMs, segStart, segEnd)

  const pastStart = Math.max(0, safeIdx - VIEW_PAST_LINES)
  const past = lines.slice(pastStart, safeIdx)
  const upcoming = lines.slice(safeIdx + 1, safeIdx + 1 + VIEW_NEXT_LINES)

  const viewportParts: string[] = []

  if (past.length) {
    viewportParts.push(
      past.map((l) => _formatViewportLine(l, 'past')).join('\n')
    )
    viewportParts.push('')
  }

  viewportParts.push(_formatViewportLine(current, 'current'))
  viewportParts.push(`-# ${bar}  ${_formatTimestamp(currentTimeMs)}`)

  if (upcoming.length) {
    viewportParts.push('')
    viewportParts.push(
      upcoming.map((l, i) => _formatViewportLine(l, 'next', i)).join('\n')
    )
  } else if (safeIdx === lines.length - 1) {
    viewportParts.push('')
    viewportParts.push('-# 🎵 Last line — song ending soon…')
  }

  const viewport = viewportParts.join('\n')

  return new Container()
    .setColor(ACCENT_COLOR)
    .addComponents(
      new TextDisplay().setContent(`🎙️ **${title}** · ${status}`),
      _divider(),
      new TextDisplay().setContent(viewport),
      _divider(),
      new Section()
        .addComponents(
          new TextDisplay().setContent(
            '-# Follow the 🎤 line · Lyrics sync with playback'
          )
        )
        .setAccessory(stopButton)
    )
}

const _fetchKaraokeLyrics = async (
  query: string | undefined,
  // biome-ignore lint/suspicious/noExplicitAny: currentTrack is a dynamic track object
  currentTrack: any
) => {
  let searchQuery = query?.trim() ?? ''

  if (!searchQuery && currentTrack) {
    const title = (currentTrack.title ?? '').trim()
    const author = (currentTrack.author ?? '').trim()
    searchQuery = author ? `${title} ${author}`.trim() : title
  }

  if (!searchQuery) return null

  try {
    const result = await MUSIXMATCH.findLyrics(searchQuery)

    const rawLines = (result?.lines ?? []) as LyricLine[]
    const lines = rawLines
      .map((l) => ({ ...l, line: (l.line ?? '').toString() }))
      .filter((l) => _cleanLyricText(l.line).length > 0)
      .sort((a, b) => _lineStartMs(a) - _lineStartMs(b))

    if (!lines.length) return null

    return { lines, track: result?.track }
  } catch {
    return null
  }
}

const KaraokeSessionRegistry = {
  cache: new Map<string, KaraokeSession>(),

  get(guildId: string) {
    return KaraokeSessionRegistry.cache.get(guildId)
  },

  has(guildId: string) {
    const session = KaraokeSessionRegistry.cache.get(guildId)
    if (!session) return false
    return session.player?.connected
  },

  async add(guildId: string, session: KaraokeSession) {
    await KaraokeSessionRegistry.cleanup(guildId, 'error')
    KaraokeSessionRegistry.cache.set(guildId, session)
  },

  async cleanup(
    guildId: string,
    reason: 'stopped' | 'finished' | 'error' = 'error'
  ) {
    const session = KaraokeSessionRegistry.cache.get(guildId)
    if (!session) return

    clearTimeout(session.updateTimer)
    clearTimeout(session.timeout)

    if (session.collector?.stop) {
      session.collector.stop('cleanup')
    }

    if (session.message?.edit) {
      await session.message
        .edit({
          components: [_createEndedContainer(reason)],
          flags: MessageFlags.IsComponentsV2
        })
        .catch(() => null)

      _autoDelete(session.message)
    }

    KaraokeSessionRegistry.cache.delete(guildId)
  },

  async cleanupAll() {
    const keys = [...KaraokeSessionRegistry.cache.keys()]
    for (const key of keys) {
      await KaraokeSessionRegistry.cleanup(key, 'error')
    }
    KaraokeSessionRegistry.cache.clear()
  }
}

@Cooldown({
  type: CooldownType.User,
  interval: 60000,
  uses: { default: 2 }
})
@Declare({
  name: 'karaoke',
  description: 'Start a karaoke session with synced lyrics'
})
@Middlewares(['cooldown', 'checkPlayer', 'checkVoice', 'checkTrack'])
export default class KaraokeCommand extends Command {
  private _getCurrentTimeMs(session: KaraokeSession): number {
    const player = session.player

    if (
      player?.position !== undefined &&
      player?.position !== null &&
      player?.timestamp !== undefined &&
      player?.timestamp !== null
    ) {
      const driftMs = Date.now() - player.timestamp

      if (driftMs >= 0 && driftMs < MAX_DRIFT_MS) {
        return player.position + driftMs
      }
      return player.position
    }

    if (player?.position !== undefined && player?.position !== null) {
      return player.position
    }

    const elapsedMs = Date.now() - session.fallbackStartTime
    return session.fallbackStartPosition + elapsedMs
  }

  // biome-ignore lint/suspicious/noExplicitAny: player is a dynamic player object
  private _isPlayerPaused(player: any): boolean {
    return player?.paused === true || player?.playing === false
  }

  private _computeNextEditDelayMs(
    session: KaraokeSession,
    currentTimeMs: number,
    isPaused: boolean
  ) {
    if (isPaused) return 1500

    const lines = session.lines
    if (!lines.length) return 1000

    const idx = _findCurrentLineIndex(lines, currentTimeMs)
    const safeIdx = Math.max(0, idx)

    const current = lines[safeIdx]
    if (!current) return 1000
    const next = lines[safeIdx + 1]

    const segStart = _lineStartMs(current)
    const segEnd = next ? _lineStartMs(next) : segStart + 4000

    const duration = segEnd - segStart
    if (duration <= 0) return 500

    const rawProgress = (currentTimeMs - segStart) / duration
    const progress = Math.max(0, Math.min(0.999999, rawProgress))

    const bucket = Math.floor(progress * PROGRESS_BAR_LENGTH)
    const nextBucket = Math.min(PROGRESS_BAR_LENGTH, bucket + 1)

    const nextBucketTime =
      segStart + (nextBucket / PROGRESS_BAR_LENGTH) * duration
    const nextLineTime = segEnd

    const nextEventTime = Math.min(nextBucketTime, nextLineTime)

    let delay = nextEventTime - currentTimeMs + SCHEDULER_JITTER_MS
    if (!Number.isFinite(delay)) delay = 1000

    delay = Math.max(MIN_EDIT_DELAY_MS, Math.min(MAX_EDIT_DELAY_MS, delay))
    return delay
  }

  private _scheduleNextTick(guildId: string, delayMs: number, errorCount = 0) {
    const session = KaraokeSessionRegistry.get(guildId)
    if (!session) return

    clearTimeout(session.updateTimer)

    session.updateTimer = setTimeout(() => {
      this._tick(guildId, errorCount).catch(() =>
        KaraokeSessionRegistry.cleanup(guildId, 'error')
      )
    }, delayMs)

    if (session.updateTimer.unref) session.updateTimer.unref()
  }

  private async _tick(guildId: string, errorCount = 0): Promise<void> {
    const session = KaraokeSessionRegistry.get(guildId)
    if (!session || session.stoppedByUser || session.player.destroyed) {
      await KaraokeSessionRegistry.cleanup(
        guildId,
        session?.stoppedByUser ? 'stopped' : 'error'
      )
      return
    }

    if (!KaraokeSessionRegistry.has(guildId)) {
      await KaraokeSessionRegistry.cleanup(guildId, 'error')
      return
    }

    const currentTimeMs = this._getCurrentTimeMs(session)
    const isPaused = this._isPlayerPaused(session.player)

    const lastLine = session.lines[session.lines.length - 1]
    const lastTimestampMs = lastLine ? _lineStartMs(lastLine) : 0

    if (currentTimeMs > lastTimestampMs + SONG_END_BUFFER_MS) {
      await KaraokeSessionRegistry.cleanup(guildId, 'finished')
      return
    }

    const container = _createKaraokeStageContainer(
      session.title,
      session.lines,
      currentTimeMs,
      isPaused
    )

    try {
      await session.message.edit({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      })
    } catch (error) {
      const err = error as { code?: number }
      if (err.code === 10065 || err.code === 10008) {
        await KaraokeSessionRegistry.cleanup(guildId, 'error')
        return
      }

      if (errorCount < 3) {
        this._scheduleNextTick(guildId, 1000, errorCount + 1)
        return
      }

      await KaraokeSessionRegistry.cleanup(guildId, 'error')
      return
    }

    const delay = this._computeNextEditDelayMs(
      session,
      currentTimeMs,
      isPaused
    )
    this._scheduleNextTick(guildId, delay, 0)
  }

  private async _sendErrorAndAutoDelete(
    ctx: CommandContext,
    container: Container
  ) {
    const msg = await ctx.editOrReply(
      {
        components: [container],
        flags: MessageFlags.IsComponentsV2
      },
      true
    )
    _autoDelete(msg)
  }

  public override async run(ctx: CommandContext): Promise<void> {
    if (!ctx.deferred) await ctx.deferReply()

    const lang = getContextLanguage(ctx)
    const t = ctx.t.get(lang)

    const guildId = ctx.guildId
    if (!guildId) return

    const player = ctx.client.aqua.players.get(guildId)
    if (!player) {
      await this._sendErrorAndAutoDelete(
        ctx,
        _createErrorContainer(t.karaoke.noActivePlayer, lang, ctx)
      )
      return
    }

    if (KaraokeSessionRegistry.has(guildId)) {
      await this._sendErrorAndAutoDelete(
        ctx,
        _createErrorContainer(t.karaoke.sessionAlreadyActive, lang, ctx)
      )
      return
    }

    await KaraokeSessionRegistry.cleanup(guildId, 'error')

    const result = await _fetchKaraokeLyrics(undefined, player.current)
    if (!result) {
      await this._sendErrorAndAutoDelete(
        ctx,
        _createErrorContainer(t.karaoke.noLyricsAvailable, lang, ctx)
      )
      return
    }

    const title = player.current?.title ?? 'Karaoke'
    const initialPosition = player.position ?? 0
    const isPaused = this._isPlayerPaused(player)

    const container = _createKaraokeStageContainer(
      title,
      result.lines,
      initialPosition,
      isPaused
    )

    const message = await ctx.editOrReply(
      {
        components: [container],
        flags: MessageFlags.IsComponentsV2
      },
      true
    )
    if (!message) return

    const collector = message.createComponentCollector({
      filter: (i: { isButton: () => boolean; customId: string }) =>
        i.isButton() && i.customId === 'ignore_karaoke-stop',
      onStop(_reason: string | undefined, _refresh: () => void) {},
      idle: SESSION_TIMEOUT_MS
    })

    collector.run(
      'ignore_karaoke-stop',
      async (i: {
        user: { id: string }
        write: (opts: { content: string; flags: number }) => Promise<void>
      }) => {
        const session = KaraokeSessionRegistry.get(guildId)

        const member = ctx.client.cache.members?.get(i.user.id, guildId)
        const memberVoice =
          member &&
          'voice' in member &&
          (member as { voice?: { channelId?: string } }).voice?.channelId
        const playerVoice = session?.player?.voiceChannel

        if (playerVoice && memberVoice && memberVoice !== playerVoice) {
          await i.write({
            content: '❌ You must be in the voice channel to stop karaoke.',
            flags: 64
          })
          return
        }

        if (session) {
          session.stoppedByUser = true
        }

        await KaraokeSessionRegistry.cleanup(guildId, 'stopped')

        await i.write({
          content: `⏹ Karaoke session stopped by <@${i.user.id}>.`,
          flags: 64
        })
      }
    )

    const timeout = setTimeout(() => {
      KaraokeSessionRegistry.cleanup(guildId, 'finished')
    }, SESSION_TIMEOUT_MS)
    if (timeout.unref) timeout.unref()

    const updateTimer = setTimeout(() => {}, 0)
    if (updateTimer.unref) updateTimer.unref()

    await KaraokeSessionRegistry.add(guildId, {
      message,
      lines: result.lines,
      player,
      updateTimer,
      timeout,
      collector,
      fallbackStartPosition: initialPosition,
      fallbackStartTime: Date.now(),
      title,
      stoppedByUser: false
    })

    this._scheduleNextTick(guildId, 0, 0)
  }
}

export const cleanupKaraokeSession = async (
  guildId: string,
  reason: 'stopped' | 'finished' | 'error' = 'error'
) => {
  await KaraokeSessionRegistry.cleanup(guildId, reason)
}

export const hasKaraokeSession = (guildId: string) => {
  return KaraokeSessionRegistry.has(guildId)
}

export const cleanupAllKaraokeSessions = async () => {
  await KaraokeSessionRegistry.cleanupAll()
}