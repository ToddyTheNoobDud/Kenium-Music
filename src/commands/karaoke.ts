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
const POSITION_CHECK_MS = 250

type LyricLine = {
  line: string
  timestamp?: number
  range?: { start: number; end?: number }
}

interface KaraokeSession {
  message: Message | WebhookMessage
  lines: LyricLine[]
  player: Player
  timer?: NodeJS.Timeout
  timeout: NodeJS.Timeout
  collector: ReturnType<Message['createComponentCollector']>
  artist: string
  artworkUrl?: string | undefined
  title: string
  uri?: string | undefined
  trackKey: string
  lineIndex: number
  pendingEdit?: Promise<unknown>
  positionAtLastUpdate: number
  positionAtLastUpdateAt: number
  lastPlayerPosition: number
  lastPlayerTimestamp: number
  editLatencyMs: number
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

const isPaused = (player: Player) => player.paused || !player.playing

const getEstimatedPlayerPosition = (player: Player) => {
  const position = Number.isFinite(player.position) ? player.position : 0
  if (
    isPaused(player) ||
    !Number.isFinite(player.timestamp) ||
    player.timestamp <= 0
  ) {
    return position
  }
  return position + Math.max(0, Date.now() - player.timestamp)
}

const updateSessionPosition = (session: KaraokeSession, position: number) => {
  session.positionAtLastUpdate = position
  session.positionAtLastUpdateAt = Date.now()
  session.lastPlayerPosition = session.player.position
  session.lastPlayerTimestamp = session.player.timestamp
}

const getSessionPosition = (session: KaraokeSession) => {
  const { player } = session
  if (player.timestamp !== session.lastPlayerTimestamp) {
    updateSessionPosition(session, getEstimatedPlayerPosition(player))
  } else if (player.position !== session.lastPlayerPosition) {
    // Local seeks change position before a fresh server timestamp arrives.
    updateSessionPosition(session, player.position)
  } else {
    const position =
      session.positionAtLastUpdate +
      (isPaused(player)
        ? 0
        : Math.max(0, Date.now() - session.positionAtLastUpdateAt))
    updateSessionPosition(session, position)
  }
  return session.positionAtLastUpdate
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

const refreshSession = async (guildId: string) => {
  const session = sessions.get(guildId)
  if (!session || session.pendingEdit) {
    return
  }
  clearTimeout(session.timer)
  if (session.player.destroyed) {
    await cleanup(guildId, 'error')
    return
  }
  if (trackKey(session.player.current) !== session.trackKey) {
    await cleanup(guildId, 'changed')
    return
  }

  const paused = isPaused(session.player)
  const position = getSessionPosition(session)
  const displayPosition = position + (paused ? 0 : session.editLatencyMs)
  const lineIndex = findLyricIndex(session.lines, displayPosition)
  const nextLine = session.lines[lineIndex + 1]
  const lastLine = session.lines[session.lines.length - 1]
  const endPosition = (lastLine ? lineStart(lastLine) : 0) + SONG_END_BUFFER_MS
  if (!paused && position >= endPosition) {
    await cleanup(guildId, 'finished')
    return
  }

  if (lineIndex !== session.lineIndex) {
    const startedAt = Date.now()
    session.lineIndex = lineIndex
    session.pendingEdit = session.message.edit({
      components: [karaokeContainer(session, session.lines, lineIndex)],
      flags: MessageFlags.IsComponentsV2
    })
    try {
      await session.pendingEdit
      session.editLatencyMs = Date.now() - startedAt
    } catch (error) {
      const code = (error as { code?: number }).code
      if (code === 10008 || code === 10065) {
        await cleanup(guildId, 'error')
        return
      }
    } finally {
      session.pendingEdit = undefined
    }
  }

  if (sessions.get(guildId) !== session) {
    return
  }
  const currentPosition = getSessionPosition(session)
  const nextPosition = nextLine
    ? lineStart(nextLine) - session.editLatencyMs
    : endPosition
  const delay = paused
    ? POSITION_CHECK_MS
    : Math.min(POSITION_CHECK_MS, Math.max(0, nextPosition - currentPosition))
  session.timer = setTimeout(() => refreshSession(guildId), delay)
  session.timer.unref()
}

const cleanup = async (
  guildId: string,
  reason: 'stopped' | 'finished' | 'error' | 'changed' = 'error'
) => {
  const session = sessions.get(guildId)
  if (!session) {
    return
  }
  sessions.delete(guildId)
  clearTimeout(session.timer)
  clearTimeout(session.timeout)
  session.collector.stop('cleanup')
  await session.pendingEdit?.catch(() => null)
  await session.message
    .edit({
      components: [endedContainer(reason)],
      flags: MessageFlags.IsComponentsV2
    })
    .catch(() => null)
  autoDelete(session.message)
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
    const position = getEstimatedPlayerPosition(player)
    const lineIndex = findLyricIndex(res.lines, position)

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
    sessions.set(guildId, {
      message: msg,
      lines: res.lines,
      player,
      timeout,
      collector,
      artist,
      artworkUrl,
      title,
      uri,
      trackKey: trackKey(player.current),
      lineIndex,
      positionAtLastUpdate: getEstimatedPlayerPosition(player),
      positionAtLastUpdateAt: Date.now(),
      lastPlayerPosition: player.position,
      lastPlayerTimestamp: player.timestamp,
      editLatencyMs: Date.now() - sendStartedAt
    })

    await refreshSession(guildId)
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
  if (!session || session.player.destroyed) {
    return
  }
  if (typeof position !== 'number' || !Number.isFinite(position)) {
    return
  }
  updateSessionPosition(session, position)
  void refreshSession(guildId)
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
