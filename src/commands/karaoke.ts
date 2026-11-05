import { Cooldown } from '@slipher/cooldown'
import type { Player, Track } from 'aqualink'
import {
  ActionRow,
  Button,
  ButtonStyle,
  Command,
  type CommandContext,
  Container,
  Declare,
  type Message,
  MessageFlags,
  Middlewares,
  Section,
  Separator,
  Spacing,
  TextDisplay,
  Thumbnail,
  type UsingClient,
  type WebhookMessage
} from 'seyfert'
import {
  buildLyricsQueryFromHints,
  extractLyricsSearchHints
} from '../shared/lyrics.ts'
import { findLyrics } from '../shared/lyricsservice.ts'
import { authorizeVoiceControl } from '../shared/voiceAuthorization.ts'
import { getContextLanguage } from '../utils/i18n.ts'
import { getMemberVoiceState, safeDefer } from '../utils/interactions.ts'

const ACCENT_COLOR = '#100e09'
const ERROR_COLOR = '#e74c3c'
const SESSION_TIMEOUT_MS = 300000
const SONG_END_BUFFER_MS = 5000
const AUTO_DELETE_MS = 10000

type LyricLine = {
  line: string
  timestamp?: number
  range?: { start: number; end?: number }
}

interface KaraokeSession {
  message: Message | WebhookMessage
  lines: LyricLine[]
  player: Player
  timers: NodeJS.Timeout[]
  timeout: NodeJS.Timeout
  collector: ReturnType<Message['createComponentCollector']>
  artist: string
  artworkUrl?: string | undefined
  title: string
  uri?: string | undefined
  trackKey: string
  stoppedByUser: boolean
  seekTimer?: NodeJS.Timeout | undefined
  positionAtLastUpdate: number
  positionAtLastUpdateAt: number
  lastPlayerPosition?: number | undefined
  averageEditLatencyMs?: number | undefined
  client?: UsingClient | undefined
}

const sessions = new Map<string, KaraokeSession>()

const autoDelete = (
  message: Pick<Message, 'delete'>,
  delay = AUTO_DELETE_MS
) => {
  setTimeout(() => message.delete().catch(() => null), delay).unref()
}

const divider = () => new Separator().setDivider(true).setSpacing(Spacing.Small)

const lineStart = (line: LyricLine) => line.range?.start ?? line.timestamp ?? 0
const cleanLyricText = (text: string) => text.replace(/\s+/g, ' ').trim()

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const getGatewayLatency = (session: KaraokeSession) => {
  const latency = session.client?.gateway?.latency
  return Number.isFinite(latency) ? (latency ?? 0) : 0
}

const getPlayerPing = (player: Player) => {
  return Number.isFinite(player.ping) ? player.ping : 0
}

// Expected message.edit round-trip. Uses measured edits once available,
// otherwise live gateway latency instead of a hardcoded guess.
const getEditLeadMs = (session: KaraokeSession) => {
  if (session.averageEditLatencyMs !== undefined) {
    return clamp(Math.round(session.averageEditLatencyMs), 50, 600)
  }
  const gateway = getGatewayLatency(session)
  if (gateway > 0) {
    return clamp(Math.round(gateway + 120), 100, 500)
  }
  return 220
}

const getSeekCheckInterval = (session: KaraokeSession) =>
  clamp(getEditLeadMs(session), 250, 600)

const getSeekThresholdMs = (session: KaraokeSession) =>
  clamp(getEditLeadMs(session) + getPlayerPing(session.player) + 300, 500, 2500)

const recordEditSample = (session: KaraokeSession, sample: number) => {
  if (!Number.isFinite(sample)) {
    return
  }
  const clamped = clamp(sample, 0, 5000)
  session.averageEditLatencyMs =
    session.averageEditLatencyMs !== undefined
      ? Math.round(session.averageEditLatencyMs * 0.7 + clamped * 0.3)
      : Math.round(clamped)
}

const getPlayerPosition = (player: Player) =>
  Number.isFinite(player.position) ? player.position : 0

const updateSessionPosition = (session: KaraokeSession, pos: number) => {
  session.positionAtLastUpdate = pos
  session.positionAtLastUpdateAt = Date.now()
  session.lastPlayerPosition = pos
}

const getSessionPosition = (session: KaraokeSession) => {
  const raw = getPlayerPosition(session.player)
  if (
    session.lastPlayerPosition === undefined ||
    raw !== session.lastPlayerPosition
  ) {
    updateSessionPosition(session, raw)
    return raw
  }
  if (isPaused(session.player)) {
    return session.positionAtLastUpdate
  }
  return (
    session.positionAtLastUpdate +
    Math.max(0, Date.now() - session.positionAtLastUpdateAt)
  )
}

const trackKey = (track: Track | null | undefined) => {
  if (!track) {
    return ''
  }
  return [track.uri, track.identifier, track.title, track.author]
    .filter(Boolean)
    .join('|')
}

const findLyricIndex = (lines: LyricLine[], positionMs: number) => {
  let leftIndex = 0
  let rightIndex = lines.length - 1
  let matchingIndex = -1
  while (leftIndex <= rightIndex) {
    const middleIndex = (leftIndex + rightIndex) >> 1
    const line = lines[middleIndex]
    if (!line) {
      break
    }
    const lineTime = lineStart(line)
    if (lineTime <= positionMs) {
      matchingIndex = middleIndex
      leftIndex = middleIndex + 1
    } else {
      rightIndex = middleIndex - 1
    }
  }
  return matchingIndex
}

const errorContainer = (msg: string, lang: string, ctx: CommandContext) =>
  new Container()
    .setColor(ERROR_COLOR)
    .addComponents(
      new TextDisplay().setContent(`## [X] ${ctx.t.get(lang).karaoke.error}`),
      divider(),
      new TextDisplay().setContent(msg)
    )

const endedContainer = (reason: 'stopped' | 'finished' | 'error' | 'changed') =>
  new Container().setColor(ERROR_COLOR).addComponents(
    new TextDisplay().setContent('## KARAOKE STAGE'),
    divider(),
    new TextDisplay().setContent(
      {
        stopped: 'Session stopped by a user.',
        finished: 'Track finished. Stage lights down.',
        error: 'The karaoke display has been closed.',
        changed: 'Track changed. Karaoke closed to avoid stale lyrics.'
      }[reason]
    )
  )

const viewportLine = (line: LyricLine, kind: 'past' | 'current' | 'next') => {
  const t = cleanLyricText(line.line) || '...'
  return kind === 'current' ? `## ${t}` : `-# ${t}`
}

const karaokeContainer = (
  details: { artist: string; artworkUrl?: string; title: string; uri?: string },
  lines: LyricLine[],
  lineIndex: number
) => {
  const stop = new Button()
    .setCustomId('ignore_karaoke-stop')
    .setLabel('Stop')
    .setStyle(ButtonStyle.Secondary)

  const linked = details.uri
    ? `[${details.title}](${details.uri})`
    : details.title
  const headerText = `## KARAOKE\n**${linked}**\n-# ${details.artist || 'Unknown artist'}  •  synchronized lyrics`
  const header = details.artworkUrl
    ? new Section()
        .addComponents(new TextDisplay().setContent(headerText))
        .setAccessory(new Thumbnail().setMedia(details.artworkUrl))
    : new TextDisplay().setContent(headerText)

  if (!lines.length) {
    return new Container()
      .setColor(ACCENT_COLOR)
      .addComponents(
        header,
        divider(),
        new TextDisplay().setContent(
          'No time-synced lyrics available for this track.'
        )
      )
  }

  if (lineIndex < 0) {
    const preview = lines
      .slice(0, 2)
      .map((line) => viewportLine(line, 'next'))
      .join('\n')
    return new Container()
      .setColor(ACCENT_COLOR)
      .addComponents(
        header,
        divider(),
        new TextDisplay().setContent(
          `### Mic check\n-# First line coming up\n\n${preview}`
        ),
        divider(),
        new ActionRow().addComponents(stop)
      )
  }

  const currentLine = lines[lineIndex]
  if (!currentLine) {
    return new Container()
      .setColor(ACCENT_COLOR)
      .addComponents(new TextDisplay().setContent('...'))
  }

  const past = lineIndex > 0 ? lines[lineIndex - 1] : undefined
  const next = lines[lineIndex + 1]

  const parts: string[] = []
  if (past) {
    parts.push(viewportLine(past, 'past'), '')
  }
  parts.push(viewportLine(currentLine, 'current'))
  if (next) {
    parts.push('', '-# UP NEXT', viewportLine(next, 'next'))
  } else if (lineIndex === lines.length - 1) {
    parts.push('', '-# FINAL LINE  •  bring it home')
  }

  return new Container()
    .setColor(ACCENT_COLOR)
    .addComponents(
      header,
      divider(),
      new TextDisplay().setContent(parts.join('\n')),
      divider(),
      new ActionRow().addComponents(stop)
    )
}

const fetchLyrics = async (track: Track | null) => {
  const hints = extractLyricsSearchHints(track)
  const q = buildLyricsQueryFromHints(hints)
  if (!q) {
    return null
  }
  try {
    const res = await findLyrics(q, hints, { requireSynced: true })
    const lines = ((res?.lines ?? []) as LyricLine[])
      .map((l) => ({ ...l, line: String(l.line ?? '') }))
      .filter((l) => cleanLyricText(l.line))
      .sort((a, b) => lineStart(a) - lineStart(b))
    if (!lines.length) {
      return null
    }
    return { lines, track: res?.track }
  } catch {
    return null
  }
}

const clearTimers = (session: KaraokeSession) => {
  for (const timer of session.timers) {
    clearTimeout(timer)
  }
  session.timers = []
}

const ensureSeekWatcher = (guildId: string) => {
  const session = sessions.get(guildId)
  if (!session) {
    return
  }
  if (session.seekTimer) {
    clearTimeout(session.seekTimer)
  }
  const tick = () => {
    const currentSession = sessions.get(guildId)
    if (!currentSession) {
      return
    }
    if (currentSession.stoppedByUser || currentSession.player.destroyed) {
      return
    }

    if (isPaused(currentSession.player)) {
      updateSessionPosition(
        currentSession,
        getPlayerPosition(currentSession.player)
      )
    } else {
      // Raw only changes on playerUpdate or seek: compare fresh state
      // against our extrapolation BEFORE adopting it, so real jumps
      // are detected and stale values can never false-trigger.
      const raw = getPlayerPosition(currentSession.player)
      if (
        currentSession.lastPlayerPosition === undefined ||
        raw !== currentSession.lastPlayerPosition
      ) {
        const expected =
          currentSession.positionAtLastUpdate +
          Math.max(0, Date.now() - currentSession.positionAtLastUpdateAt)
        const jumped =
          currentSession.lastPlayerPosition !== undefined &&
          Math.abs(raw - expected) > getSeekThresholdMs(currentSession)
        updateSessionPosition(currentSession, raw)
        if (jumped) {
          const lineIndex = findLyricIndex(currentSession.lines, raw)
          renderLyricLine(guildId, lineIndex).catch(() => {})
          schedule(guildId, lineIndex + 1)
          return
        }
      }
    }
    const t = setTimeout(tick, getSeekCheckInterval(currentSession))
    t.unref()
    currentSession.seekTimer = t
  }
  const t = setTimeout(tick, getSeekCheckInterval(session))
  t.unref()
  session.seekTimer = t
}

const renderLyricLine = async (guildId: string, lineIndex: number) => {
  const session = sessions.get(guildId)
  if (!session) {
    return
  }
  const container = karaokeContainer(
    {
      artist: session.artist,
      artworkUrl: session.artworkUrl,
      title: session.title,
      uri: session.uri
    },
    session.lines,
    lineIndex
  )
  const startedAt = Date.now()
  try {
    await session.message.edit({
      components: [container],
      flags: MessageFlags.IsComponentsV2
    })
    recordEditSample(session, Date.now() - startedAt)
  } catch (e) {
    const code = (e as { code?: number }).code
    if (code === 10008 || code === 10065) {
      await cleanup(guildId, 'error')
    }
  }
}

const isPaused = (player: Player) => player.paused || !player.playing

const getEstimatedPlayerPosition = (player: Player) => {
  if (!Number.isFinite(player.position)) {
    return 0
  }
  if (!Number.isFinite(player.timestamp)) {
    return player.position
  }
  return player.position + Math.max(0, Date.now() - player.timestamp)
}

const schedule = (guildId: string, nextLineIndex: number) => {
  const session = sessions.get(guildId)
  if (!session) {
    return
  }
  clearTimers(session)
  updateSessionPosition(session, getPlayerPosition(session.player))
  ensureSeekWatcher(guildId)

  if (isPaused(session.player)) {
    const t = setTimeout(() => {
      const currentSession = sessions.get(guildId)
      if (!currentSession) {
        return
      }
      if (currentSession.stoppedByUser || currentSession.player.destroyed) {
        cleanup(
          guildId,
          currentSession.stoppedByUser ? 'stopped' : 'error'
        ).catch(() => {})
        return
      }
      if (isPaused(currentSession.player)) {
        return schedule(guildId, nextLineIndex)
      }
      const pos = getSessionPosition(currentSession)
      const lineIndex = findLyricIndex(currentSession.lines, pos)
      renderLyricLine(guildId, lineIndex).catch(() => {})
      schedule(guildId, lineIndex + 1)
    }, getSeekCheckInterval(session))
    t.unref()
    session.timers.push(t)
    return
  }

  const pos = getSessionPosition(session)
  const lead = getEditLeadMs(session)
  const overdueLimit = -getSeekThresholdMs(session)

  if (nextLineIndex >= session.lines.length) {
    const last = session.lines[session.lines.length - 1]
    const delay = last
      ? Math.max(0, lineStart(last) - pos - lead + SONG_END_BUFFER_MS)
      : SONG_END_BUFFER_MS
    const t = setTimeout(
      () => cleanup(guildId, 'finished').catch(() => {}),
      delay
    )
    t.unref()
    session.timers.push(t)
    return
  }

  // Batch-schedule from single estimated position so drift doesn't accumulate.
  // Edits fire one measured round-trip early so visuals land on beat.
  // Lines only slightly overdue render immediately so we never lag behind.
  let scheduled = 0
  for (let i = nextLineIndex; i < session.lines.length; i++) {
    const line = session.lines[i]
    if (!line) {
      continue
    }
    const rawDelay = lineStart(line) - pos - lead
    if (rawDelay < overdueLimit) {
      continue
    }
    const delay = Math.max(0, rawDelay)
    const lineIndex = i
    const t = setTimeout(async () => {
      const currentSession = sessions.get(guildId)
      if (
        !currentSession ||
        currentSession.stoppedByUser ||
        currentSession.player.destroyed
      ) {
        await cleanup(
          guildId,
          currentSession?.stoppedByUser ? 'stopped' : 'error'
        )
        return
      }
      if (trackKey(currentSession.player.current) !== currentSession.trackKey) {
        await cleanup(guildId, 'changed')
        return
      }
      if (isPaused(currentSession.player)) {
        return schedule(guildId, lineIndex)
      }
      await renderLyricLine(guildId, lineIndex)
    }, delay)
    t.unref()
    session.timers.push(t)
    scheduled++
  }

  if (!scheduled) {
    const t = setTimeout(
      () => cleanup(guildId, 'finished').catch(() => {}),
      SONG_END_BUFFER_MS
    )
    t.unref()
    session.timers.push(t)
  }
}

const cleanup = async (
  guildId: string,
  reason: 'stopped' | 'finished' | 'error' | 'changed' = 'error'
) => {
  const session = sessions.get(guildId)
  if (!session) {
    return
  }
  clearTimers(session)
  if (session.seekTimer) {
    clearTimeout(session.seekTimer)
  }
  clearTimeout(session.timeout)
  session.collector.stop('cleanup')
  await session.message
    .edit({
      components: [endedContainer(reason)],
      flags: MessageFlags.IsComponentsV2
    })
    .catch(() => null)
  autoDelete(session.message)
  sessions.delete(guildId)
}

@Cooldown.user(60000, { uses: 2 })
@Declare({
  name: 'karaoke',
  description: 'Start a karaoke session with synced lyrics'
})
@Middlewares(['cooldown', 'checkPlayer', 'checkVoice', 'checkTrack'])
export default class KaraokeCommand extends Command {
  private async sendError(ctx: CommandContext, container: Container) {
    const message = await ctx.editOrReply(
      { components: [container], flags: MessageFlags.IsComponentsV2 },
      true
    )
    autoDelete(message)
  }

  public override async run(ctx: CommandContext): Promise<void> {
    if (!(await safeDefer(ctx))) {
      return
    }
    const lang = getContextLanguage(ctx)
    const t = ctx.t.get(lang)
    const guildId = ctx.guildId
    if (!guildId) {
      return
    }

    const player = ctx.client.aqua.players.get(guildId)
    if (!player) {
      await this.sendError(
        ctx,
        errorContainer(t.karaoke.noActivePlayer, lang, ctx)
      )
      return
    }
    if (sessions.get(guildId)?.player?.connected) {
      await this.sendError(
        ctx,
        errorContainer(t.karaoke.sessionAlreadyActive, lang, ctx)
      )
      return
    }
    await cleanup(guildId, 'error')

    const res = await fetchLyrics(player.current)
    // The search yields for seconds: the player may have been destroyed
    // (or replaced) meanwhile. Never start a session on a dead player. Yeah, i found this out randomly while testing.
    const freshPlayer = ctx.client.aqua.players.get(guildId)
    if (!freshPlayer || freshPlayer !== player || freshPlayer.destroyed) {
      await this.sendError(
        ctx,
        errorContainer(t.karaoke.noActivePlayer, lang, ctx)
      )
      return
    }
    if (!res) {
      await this.sendError(
        ctx,
        errorContainer(t.karaoke.noLyricsAvailable, lang, ctx)
      )
      return
    }

    const title = res.track?.title || player.current?.title || 'Karaoke'
    const artist =
      res.track?.author || player.current?.author || 'Unknown artist'
    const artworkUrl =
      res.track?.albumArt ||
      player.current?.info?.artworkUrl ||
      player.current?.thumbnail ||
      undefined
    const uri = player.current?.info?.uri || player.current?.uri || undefined
    const pos = getEstimatedPlayerPosition(player)
    const lineIndex = findLyricIndex(res.lines, pos)

    const sendStartedAt = Date.now()
    const msg = await ctx.editOrReply(
      {
        components: [
          karaokeContainer(
            { artist, artworkUrl, title, uri },
            res.lines,
            lineIndex
          )
        ],
        flags: MessageFlags.IsComponentsV2
      },
      true
    )
    if (!msg) {
      return
    }

    const collector = msg.createComponentCollector({
      filter: (i: { isButton: () => boolean; customId: string }) =>
        i.isButton() && i.customId === 'ignore_karaoke-stop',
      idle: SESSION_TIMEOUT_MS
    })

    collector.run(
      'ignore_karaoke-stop',
      async (interaction: {
        guildId?: string | null
        member?: import('../shared/helperTypes.ts').MemberLike | null
        user: { id: string }
        client?: unknown
        write: (opts: { content: string; flags: number }) => Promise<void>
      }) => {
        const session = sessions.get(guildId)
        const currentPlayer = ctx.client.aqua.players.get(guildId)
        const voice = await getMemberVoiceState({
          ...interaction,
          guildId,
          client: ctx.client
        })
        const auth = authorizeVoiceControl({
          guildId,
          memberChannelId: voice?.channelId ?? null,
          playerChannelId: currentPlayer?.voiceChannel ?? null,
          hasPlayer: Boolean(currentPlayer),
          requirePlayer: true,
          playerDestroyed: currentPlayer?.destroyed === true
        })
        if (!auth.ok || !session || session.player !== currentPlayer) {
          await interaction.write({
            content: 'You must be in the voice channel to stop karaoke.',
            flags: 64
          })
          return
        }
        session.stoppedByUser = true
        await cleanup(guildId, 'stopped')
        await interaction.write({
          content: `Karaoke session stopped by <@${interaction.user.id}>.`,
          flags: 64
        })
      }
    )

    const timeout = setTimeout(
      () => cleanup(guildId, 'finished').catch(() => {}),
      SESSION_TIMEOUT_MS
    )
    timeout.unref()

    if (sessions.size >= 100) {
      const first = sessions.keys().next().value
      if (first) {
        await cleanup(first, 'error')
      }
    }
    const startRaw = getPlayerPosition(player)
    sessions.set(guildId, {
      message: msg,
      lines: res.lines,
      player,
      timers: [],
      timeout,
      collector,
      artist,
      artworkUrl,
      title,
      uri,
      trackKey: trackKey(player.current),
      stoppedByUser: false,
      positionAtLastUpdate: startRaw,
      positionAtLastUpdateAt: Date.now(),
      lastPlayerPosition: startRaw,
      client: ctx.client
    })

    const created = sessions.get(guildId)
    if (created) {
      recordEditSample(created, Date.now() - sendStartedAt)
    }

    schedule(guildId, lineIndex + 1)
    if (lineIndex >= res.lines.length - 1) {
      schedule(guildId, res.lines.length)
    }
  }
}

export const cleanupKaraokeSession = (
  guildId: string,
  reason: 'stopped' | 'finished' | 'error' = 'error'
) => cleanup(guildId, reason)
export const hasKaraokeSession = (guildId: string) =>
  Boolean(sessions.get(guildId)?.player?.connected)

export const resyncKaraokeSession = (guildId: string, position: unknown) => {
  const session = sessions.get(guildId)
  if (!session || session.stoppedByUser || session.player.destroyed) {
    return
  }
  if (typeof position !== 'number' || !Number.isFinite(position)) {
    return
  }
  updateSessionPosition(session, position)
  const lineIndex = findLyricIndex(session.lines, position)
  renderLyricLine(guildId, lineIndex).catch(() => {})
  schedule(guildId, lineIndex + 1)
}

export const syncKaraokeSessionTrack = async (
  guildId: string,
  track: Track | null | undefined
) => {
  const session = sessions.get(guildId)
  if (!session) {
    return
  }
  const currentTrackKey = trackKey(track)
  if (!currentTrackKey || currentTrackKey !== session.trackKey) {
    await cleanup(guildId, 'changed')
  }
}
export const cleanupAllKaraokeSessions = async () => {
  for (const guildId of [...sessions.keys()]) {
    await cleanup(guildId, 'error')
  }
}
