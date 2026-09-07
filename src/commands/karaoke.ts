import { Cooldown } from '@slipher/cooldown'
import type { Player } from 'aqualink'
import {
  ActionRow,
  Button,
  ButtonStyle,
  Command,
  type CommandContext,
  Container,
  Declare,
  MessageFlags,
  Middlewares,
  Section,
  Separator,
  Spacing,
  TextDisplay,
  Thumbnail,
  type UsingClient
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
  // biome-ignore lint/suspicious/noExplicitAny: dynamic Discord message
  message: any
  lines: LyricLine[]
  player: Player
  timers: NodeJS.Timeout[]
  timeout: NodeJS.Timeout
  // biome-ignore lint/suspicious/noExplicitAny: dynamic collector
  collector: any
  artist: string
  artworkUrl?: string | undefined
  title: string
  uri?: string | undefined
  trackKey: string
  stoppedByUser: boolean
  seekTimer?: NodeJS.Timeout | undefined
  posBase: number
  posBaseAt: number
  lastRawPos?: number | undefined
  editAvgMs?: number | undefined
  client?: UsingClient | undefined
}

const sessions = new Map<string, KaraokeSession>()

// biome-ignore lint/suspicious/noExplicitAny: dynamic
const autoDelete = (msg: any, delay = AUTO_DELETE_MS) => {
  if (!msg?.delete) return
  const t = setTimeout(() => msg.delete().catch(() => null), delay)
  if (t.unref) t.unref()
}

const divider = () => new Separator().setDivider(true).setSpacing(Spacing.Small)

const lineStart = (l: LyricLine) => l.range?.start ?? l.timestamp ?? 0
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const gatewayLatencyOf = (session: KaraokeSession) => {
  const latency = session.client?.gateway?.latency
  return typeof latency === 'number' && Number.isFinite(latency) ? latency : 0
}

const playerPingOf = (player: Player) => {
  const ping = (player as unknown as { ping?: unknown }).ping
  return typeof ping === 'number' && Number.isFinite(ping) ? ping : 0
}

// Expected message.edit round-trip. Uses measured edits once available,
// otherwise live gateway latency instead of a hardcoded guess.
const editLeadMs = (session: KaraokeSession) => {
  if (typeof session.editAvgMs === 'number')
    return clamp(Math.round(session.editAvgMs), 50, 600)
  const gateway = gatewayLatencyOf(session)
  if (gateway > 0) return clamp(Math.round(gateway + 120), 100, 500)
  return 220
}

const seekCheckMs = (session: KaraokeSession) =>
  clamp(editLeadMs(session), 250, 600)

const seekThresholdMs = (session: KaraokeSession) =>
  clamp(editLeadMs(session) + playerPingOf(session.player) + 300, 500, 2500)

const recordEditSample = (session: KaraokeSession, sample: number) => {
  if (!Number.isFinite(sample)) return
  const clamped = clamp(sample, 0, 5000)
  session.editAvgMs =
    typeof session.editAvgMs === 'number'
      ? Math.round(session.editAvgMs * 0.7 + clamped * 0.3)
      : Math.round(clamped)
}

const rawPlayerPos = (player: Player) => {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic
  const pos = (player as any).position
  return typeof pos === 'number' && Number.isFinite(pos) ? pos : 0
}

const rebasePos = (session: KaraokeSession, pos: number) => {
  session.posBase = pos
  session.posBaseAt = Date.now()
  session.lastRawPos = pos
}

const sessionPos = (session: KaraokeSession) => {
  const raw = rawPlayerPos(session.player)
  if (session.lastRawPos === undefined || raw !== session.lastRawPos) {
    rebasePos(session, raw)
    return raw
  }
  if (isPaused(session.player)) return session.posBase
  return session.posBase + Math.max(0, Date.now() - session.posBaseAt)
}

const trackKey = (
  t:
    | {
        uri?: string
        identifier?: string
        title?: string
        author?: string
        info?: {
          uri?: string
          identifier?: string
          title?: string
          author?: string
        }
      }
    | null
    | undefined
) => {
  if (!t) return ''
  return [
    t.info?.uri ?? t.uri,
    t.info?.identifier ?? t.identifier,
    t.info?.title ?? t.title,
    t.info?.author ?? t.author
  ]
    .filter(Boolean)
    .join('|')
}

const findIdx = (lines: LyricLine[], ms: number) => {
  let l = 0
  let r = lines.length - 1
  let res = -1
  while (l <= r) {
    const m = (l + r) >> 1
    const line = lines[m]
    if (!line) break
    const ts = lineStart(line)
    if (ts <= ms) {
      res = m
      l = m + 1
    } else r = m - 1
  }
  return res
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
  const t = clean(line.line) || '...'
  return kind === 'current' ? `## ${t}` : `-# ${t}`
}

const karaokeContainer = (
  details: { artist: string; artworkUrl?: string; title: string; uri?: string },
  lines: LyricLine[],
  idx: number
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

  if (!lines.length)
    return new Container()
      .setColor(ACCENT_COLOR)
      .addComponents(
        header,
        divider(),
        new TextDisplay().setContent(
          'No time-synced lyrics available for this track.'
        )
      )

  if (idx < 0) {
    const preview = lines
      .slice(0, 2)
      .map((l) => viewportLine(l, 'next'))
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

  const cur = lines[idx]
  if (!cur)
    return new Container()
      .setColor(ACCENT_COLOR)
      .addComponents(new TextDisplay().setContent('...'))

  const past = idx > 0 ? lines[idx - 1] : undefined
  const next = lines[idx + 1]

  const parts: string[] = []
  if (past) parts.push(viewportLine(past, 'past'), '')
  parts.push(viewportLine(cur, 'current'))
  if (next) parts.push('', '-# UP NEXT', viewportLine(next, 'next'))
  else if (idx === lines.length - 1)
    parts.push('', '-# FINAL LINE  •  bring it home')

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

const fetchLyrics = async (
  // biome-ignore lint/suspicious/noExplicitAny: dynamic
  track: any
) => {
  const hints = extractLyricsSearchHints(track)
  const q = buildLyricsQueryFromHints(hints)
  if (!q) return null
  try {
    const res = await findLyrics(q, hints, { requireSynced: true })
    const lines = ((res?.lines ?? []) as LyricLine[])
      .map((l) => ({ ...l, line: String(l.line ?? '') }))
      .filter((l) => clean(l.line))
      .sort((a, b) => lineStart(a) - lineStart(b))
    if (!lines.length) return null
    return { lines, track: res?.track }
  } catch {
    return null
  }
}

const clearTimers = (s: KaraokeSession) => {
  for (const t of s.timers) clearTimeout(t)
  s.timers = []
}

const ensureSeekWatcher = (guildId: string) => {
  const s = sessions.get(guildId)
  if (!s) return
  if (s.seekTimer) clearTimeout(s.seekTimer)
  const tick = () => {
    const cur = sessions.get(guildId)
    if (!cur) return
    if (cur.stoppedByUser || cur.player.destroyed) return

    if (isPaused(cur.player)) {
      rebasePos(cur, rawPlayerPos(cur.player))
    } else {
      // Raw only changes on playerUpdate or seek: compare fresh state
      // against our extrapolation BEFORE adopting it, so real jumps
      // are detected and stale values can never false-trigger.
      const raw = rawPlayerPos(cur.player)
      if (cur.lastRawPos === undefined || raw !== cur.lastRawPos) {
        const expected = cur.posBase + Math.max(0, Date.now() - cur.posBaseAt)
        const jumped =
          cur.lastRawPos !== undefined &&
          Math.abs(raw - expected) > seekThresholdMs(cur)
        rebasePos(cur, raw)
        if (jumped) {
          const idx = findIdx(cur.lines, raw)
          renderIdx(guildId, idx).catch(() => {})
          schedule(guildId, idx + 1)
          return
        }
      }
    }
    const t = setTimeout(tick, seekCheckMs(cur))
    if (t.unref) t.unref()
    cur.seekTimer = t
  }
  const t = setTimeout(tick, seekCheckMs(s))
  if (t.unref) t.unref()
  s.seekTimer = t
}

const renderIdx = async (guildId: string, idx: number) => {
  const s = sessions.get(guildId)
  if (!s) return
  const c = karaokeContainer(
    { artist: s.artist, artworkUrl: s.artworkUrl, title: s.title, uri: s.uri },
    s.lines,
    idx
  )
  const startedAt = Date.now()
  try {
    await s.message.edit({
      components: [c],
      flags: MessageFlags.IsComponentsV2
    })
    recordEditSample(s, Date.now() - startedAt)
  } catch (e) {
    const code = (e as { code?: number }).code
    if (code === 10008 || code === 10065) await cleanup(guildId, 'error')
  }
}

const isPaused = (p: Player) =>
  // biome-ignore lint/suspicious/noExplicitAny: dynamic
  (p as any)?.paused === true || (p as any)?.playing === false

const nowPos = (p: Player) => {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic
  const pos = (p as any).position
  // biome-ignore lint/suspicious/noExplicitAny: dynamic
  const ts = (p as any).timestamp
  if (typeof pos !== 'number' || !Number.isFinite(pos)) return 0
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return pos
  return pos + Math.max(0, Date.now() - ts)
}

const schedule = (guildId: string, nextIdx: number) => {
  const s = sessions.get(guildId)
  if (!s) return
  clearTimers(s)
  rebasePos(s, rawPlayerPos(s.player))
  ensureSeekWatcher(guildId)

  if (isPaused(s.player)) {
    const t = setTimeout(() => {
      const cur = sessions.get(guildId)
      if (!cur) return
      if (cur.stoppedByUser || cur.player.destroyed) {
        cleanup(guildId, cur.stoppedByUser ? 'stopped' : 'error').catch(
          () => {}
        )
        return
      }
      if (isPaused(cur.player)) return schedule(guildId, nextIdx)
      const pos = sessionPos(cur)
      const idx = findIdx(cur.lines, pos)
      renderIdx(guildId, idx).catch(() => {})
      schedule(guildId, idx + 1)
    }, seekCheckMs(s))
    if (t.unref) t.unref()
    s.timers.push(t)
    return
  }

  const pos = sessionPos(s)
  const lead = editLeadMs(s)
  const overdueLimit = -seekThresholdMs(s)

  if (nextIdx >= s.lines.length) {
    const last = s.lines[s.lines.length - 1]
    const delay = last
      ? Math.max(0, lineStart(last) - pos - lead + SONG_END_BUFFER_MS)
      : SONG_END_BUFFER_MS
    const t = setTimeout(
      () => cleanup(guildId, 'finished').catch(() => {}),
      delay
    )
    if (t.unref) t.unref()
    s.timers.push(t)
    return
  }

  // Batch-schedule from single estimated position so drift doesn't accumulate.
  // Edits fire one measured round-trip early so visuals land on beat.
  // Lines only slightly overdue render immediately so we never lag behind.
  let scheduled = 0
  for (let i = nextIdx; i < s.lines.length; i++) {
    const line = s.lines[i]
    if (!line) continue
    const rawDelay = lineStart(line) - pos - lead
    if (rawDelay < overdueLimit) continue
    const delay = Math.max(0, rawDelay)
    const idx = i
    const t = setTimeout(async () => {
      const cur = sessions.get(guildId)
      if (!cur || cur.stoppedByUser || cur.player.destroyed) {
        await cleanup(guildId, cur?.stoppedByUser ? 'stopped' : 'error')
        return
      }
      if (trackKey(cur.player.current) !== cur.trackKey) {
        await cleanup(guildId, 'changed')
        return
      }
      if (isPaused(cur.player)) return schedule(guildId, idx)
      await renderIdx(guildId, idx)
    }, delay)
    if (t.unref) t.unref()
    s.timers.push(t)
    scheduled++
  }

  if (!scheduled) {
    const t = setTimeout(
      () => cleanup(guildId, 'finished').catch(() => {}),
      SONG_END_BUFFER_MS
    )
    if (t.unref) t.unref()
    s.timers.push(t)
  }
}

const cleanup = async (
  guildId: string,
  reason: 'stopped' | 'finished' | 'error' | 'changed' = 'error'
) => {
  const s = sessions.get(guildId)
  if (!s) return
  clearTimers(s)
  if (s.seekTimer) clearTimeout(s.seekTimer)
  clearTimeout(s.timeout)
  s.collector?.stop?.('cleanup')
  if (s.message?.edit) {
    await s.message
      .edit({
        components: [endedContainer(reason)],
        flags: MessageFlags.IsComponentsV2
      })
      .catch(() => null)
    autoDelete(s.message)
  }
  sessions.delete(guildId)
}

@Cooldown.user(60000, { uses: 2 })
@Declare({
  name: 'karaoke',
  description: 'Start a karaoke session with synced lyrics'
})
@Middlewares(['cooldown', 'checkPlayer', 'checkVoice', 'checkTrack'])
export default class KaraokeCommand extends Command {
  private async sendError(ctx: CommandContext, c: Container) {
    const m = await ctx.editOrReply(
      { components: [c], flags: MessageFlags.IsComponentsV2 },
      true
    )
    autoDelete(m)
  }

  public override async run(ctx: CommandContext): Promise<void> {
    if (!(await safeDefer(ctx))) return
    const lang = getContextLanguage(ctx)
    const t = ctx.t.get(lang)
    const guildId = ctx.guildId
    if (!guildId) return

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
    const pos = nowPos(player)
    const idx = findIdx(res.lines, pos)

    const sendStartedAt = Date.now()
    const msg = await ctx.editOrReply(
      {
        components: [
          karaokeContainer({ artist, artworkUrl, title, uri }, res.lines, idx)
        ],
        flags: MessageFlags.IsComponentsV2
      },
      true
    )
    if (!msg) return

    const collector = msg.createComponentCollector?.({
      filter: (i: { isButton: () => boolean; customId: string }) =>
        i.isButton() && i.customId === 'ignore_karaoke-stop',
      onStop() {},
      idle: SESSION_TIMEOUT_MS
    })
    if (!collector) {
      autoDelete(msg)
      return
    }

    collector.run(
      'ignore_karaoke-stop',
      async (i: {
        guildId?: string | null
        member?: { voice?: unknown } | null
        user: { id: string }
        client?: unknown
        write: (opts: { content: string; flags: number }) => Promise<void>
      }) => {
        const s = sessions.get(guildId)
        const cur = ctx.client.aqua.players.get(guildId)
        const voice = await getMemberVoiceState({
          ...i,
          guildId,
          client: ctx.client
        })
        const auth = authorizeVoiceControl({
          guildId,
          memberChannelId: voice?.channelId ?? null,
          playerChannelId: cur?.voiceChannel ?? null,
          hasPlayer: Boolean(cur),
          requirePlayer: true,
          playerDestroyed: cur?.destroyed === true
        })
        if (!auth.ok || !s || s.player !== cur) {
          await i.write({
            content: 'You must be in the voice channel to stop karaoke.',
            flags: 64
          })
          return
        }
        s.stoppedByUser = true
        await cleanup(guildId, 'stopped')
        await i.write({
          content: `Karaoke session stopped by <@${i.user.id}>.`,
          flags: 64
        })
      }
    )

    const timeout = setTimeout(
      () => cleanup(guildId, 'finished').catch(() => {}),
      SESSION_TIMEOUT_MS
    )
    if (timeout.unref) timeout.unref()

    if (sessions.size >= 100) {
      const first = sessions.keys().next().value
      if (first) await cleanup(first, 'error')
    }
    const startRaw = rawPlayerPos(player)
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
      posBase: startRaw,
      posBaseAt: Date.now(),
      lastRawPos: startRaw,
      client: ctx.client
    })

    const created = sessions.get(guildId)
    if (created) recordEditSample(created, Date.now() - sendStartedAt)

    schedule(guildId, idx + 1)
    if (idx >= res.lines.length - 1) schedule(guildId, res.lines.length)
  }
}

export const cleanupKaraokeSession = (
  guildId: string,
  reason: 'stopped' | 'finished' | 'error' = 'error'
) => cleanup(guildId, reason)
export const hasKaraokeSession = (guildId: string) =>
  Boolean(sessions.get(guildId)?.player?.connected)

export const resyncKaraokeSession = (guildId: string, position: unknown) => {
  const s = sessions.get(guildId)
  if (!s || s.stoppedByUser || s.player.destroyed) return
  if (typeof position !== 'number' || !Number.isFinite(position)) return
  rebasePos(s, position)
  const idx = findIdx(s.lines, position)
  renderIdx(guildId, idx).catch(() => {})
  schedule(guildId, idx + 1)
}

export const syncKaraokeSessionTrack = async (
  guildId: string,
  track:
    | {
        uri?: string
        identifier?: string
        title?: string
        author?: string
        info?: {
          uri?: string
          identifier?: string
          title?: string
          author?: string
        }
      }
    | null
    | undefined
) => {
  const s = sessions.get(guildId)
  if (!s) return
  const k = trackKey(track)
  if (!k || k !== s.trackKey) await cleanup(guildId, 'changed')
}
export const cleanupAllKaraokeSessions = async () => {
  for (const k of [...sessions.keys()]) await cleanup(k, 'error')
}
