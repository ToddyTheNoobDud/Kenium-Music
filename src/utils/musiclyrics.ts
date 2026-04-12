import { readFile, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

class HttpError extends Error {
  status: number

  constructor(status: number, message?: string) {
    super(message || `HTTP ${status}`)
    this.name = 'HttpError'
    this.status = status
  }
}

class MxmApiError extends Error {
  code: number
  hint?: string

  constructor(code: number, hint?: string) {
    super(hint || `Musixmatch API error ${code}`)
    this.name = 'MxmApiError'
    this.code = code
    if (hint !== undefined) this.hint = hint
  }
}

const APP_ID = 'web-desktop-app-v1.0'
const TOKEN_TTL = 21_600_000
const TOKEN_PERSIST_INTERVAL = 300_000
const MAX_SEARCH_RESULTS = 8
const MAX_RESOLVED_CANDIDATES = 4

const ENDPOINTS = Object.freeze({
  TOKEN: 'https://apic-desktop.musixmatch.com/ws/1.1/token.get',
  SEARCH: 'https://apic-desktop.musixmatch.com/ws/1.1/track.search',
  SUBTITLE: 'https://apic-desktop.musixmatch.com/ws/1.1/track.subtitle.get',
  TRACK_LYRICS: 'https://apic-desktop.musixmatch.com/ws/1.1/track.lyrics.get',
  MACRO: 'https://apic-desktop.musixmatch.com/ws/1.1/macro.subtitles.get'
})

const TIMESTAMP_REGEX = /\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g
const BRACKET_JUNK =
  /\s*\[([^\]]*(?:official|lyrics?|video|audio|mv|visualizer|color\s*coded|hd|4k|karaoke)[^\]]*)\]/gi
const FOOTER_LINE_PATTERNS = [
  /^\*{2,}.*this lyrics is not for commercial use.*$/i,
  /^\(\d+\)$/,
  /^writers?:/i,
  /^lyrics powered by /i
] as const
const VERSION_MARKERS = [
  'live',
  'remix',
  'sped up',
  'slowed',
  'acoustic',
  'instrumental',
  'karaoke',
  'remaster',
  'remastered',
  'mono',
  'stereo',
  'edit',
  'version'
] as const

const DEFAULT_HEADERS: Record<string, string> = Object.freeze({
  accept: 'application/json',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  cookie:
    'AWSELB=unknown; x-mxm-user-id=undefined; x-mxm-token-guid=undefined; mxm-encrypted-token='
})

const isAuthError = (err: unknown): err is MxmApiError =>
  err instanceof MxmApiError && (err.code === 401 || err.code === 403)

const stripDiacritics = (value: string) =>
  value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')

const normalizeArtwork = (value: string | undefined) => {
  if (!value) return ''

  try {
    const url = new URL(value)
    return `${url.hostname}${url.pathname}`
      .toLowerCase()
      .replace(/\/(?:100x100|350x350|800x800)(?=\/)/g, '')
      .replace(/\?.*$/, '')
  } catch {
    return value.toLowerCase().replace(/\?.*$/, '')
  }
}

const takeLastPathBits = (value: string) => {
  const pieces = value.split('/').filter(Boolean)
  return pieces.slice(-2).join('/')
}

const safeText = (value: unknown) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''

const safeNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

const env = process.env as NodeJS.ProcessEnv & {
  MUSIXMATCH_TOKEN?: string
}

const uniqueBy = <T>(items: T[], mapper: (item: T) => string) => {
  const seen = new Set<string>()
  const output: T[] = []

  for (const item of items) {
    const key = mapper(item)
    if (seen.has(key)) continue
    seen.add(key)
    output.push(item)
  }

  return output
}

interface SearchTrack {
  track_id?: number
  track_name?: string
  artist_name?: string
  album_coverart_800x800?: string
  album_coverart_350x350?: string
  album_coverart_100x100?: string
  track_length?: number | string
  track_isrc?: string
  has_subtitles?: number | string
  has_lyrics?: number | string
}

interface MacroSubtitleEntry {
  subtitle?: {
    subtitle_body?: string
  }
}

interface MacroCallEntry {
  message?: {
    body?: {
      lyrics?: {
        lyrics_body?: string
      }
      track?: SearchTrack
      subtitle_list?: MacroSubtitleEntry[]
    }
  }
}

interface ApiEnvelope<TBody = unknown> {
  message?: {
    header?: {
      status_code?: number
      hint?: string
    }
    body?: TBody
  }
}

interface TokenResponseBody {
  user_token?: string
}

interface SearchResponseBody {
  track_list?: Array<{
    track?: SearchTrack
  }>
}

interface SubtitleResponseBody {
  subtitle?: {
    subtitle_body?: string
  }
}

interface LyricsResponseBody {
  lyrics?: {
    lyrics_body?: string
  }
}

const extractMacroCalls = (body: unknown) => {
  const macroBody = (
    body as { macro_calls?: Record<string, MacroCallEntry | undefined> }
  )?.macro_calls

  return {
    lyrics: macroBody?.['track.lyrics.get']?.message?.body?.lyrics
      ?.lyrics_body as string | undefined,
    track: macroBody?.['matcher.track.get']?.message?.body?.track as
      | SearchTrack
      | undefined,
    subtitles: macroBody?.['track.subtitles.get']?.message?.body
      ?.subtitle_list?.[0]?.subtitle?.subtitle_body as string | undefined
  }
}

export interface LyricsSearchHints {
  title?: string | undefined
  artist?: string | undefined
  albumArt?: string | undefined
  durationMs?: number | undefined
  isrc?: string | undefined
  uri?: string | undefined
}

interface MusixmatchOptions {
  requestTimeoutMs?: number
  cacheTTL?: number
  maxCacheEntries?: number
  tokenFile?: string
  manualTokenFile?: string
}

interface TokenData {
  value: string
  expires: number
}

interface CacheEntry<T> {
  value: T
  expires: number
}

export interface LyricsLine {
  range: { start: number }
  line: string
}

interface LyricsTrack {
  id?: number | undefined
  title: string
  author: string
  albumArt?: string | undefined
  durationMs?: number | undefined
  isrc?: string | undefined
}

export interface LyricsResult {
  text: string | null
  lines: LyricsLine[] | null
  track: LyricsTrack
  source: string
}

interface SearchTarget {
  rawQuery: string
  title: string
  artist?: string | undefined
  albumArt?: string | undefined
  durationMs?: number | undefined
  isrc?: string | undefined
  normalizedTitle: string
  normalizedArtist?: string | undefined
}

interface CandidateTrack {
  raw: SearchTrack
  score: number
}

interface MatchableTrack {
  title: string
  artist: string
  albumArt?: string | undefined
  durationMs?: number | undefined
  isrc?: string | undefined
  hasSubtitles?: boolean | undefined
  hasLyrics?: boolean | undefined
}

export class Musixmatch {
  tokenData: TokenData | null = null
  tokenPromise: Promise<string> | null = null
  lastTokenPersist = 0
  cache = new Map<string, CacheEntry<LyricsResult | null>>()
  requestTimeoutMs: number
  cacheTTL: number
  maxCacheEntries: number
  tokenFile: string
  manualTokenFile: string

  constructor(opts: MusixmatchOptions = {}) {
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 8000
    this.cacheTTL = opts.cacheTTL ?? 300_000
    this.maxCacheEntries = Math.max(10, opts.maxCacheEntries ?? 100)
    this.tokenFile = opts.tokenFile ?? path.join(os.tmpdir(), 'mxm_token.json')
    this.manualTokenFile =
      opts.manualTokenFile ?? path.join(process.cwd(), 'musixmatch_token.txt')
  }

  buildUrl(base: string, params: Record<string, string | undefined>): string {
    const url = new URL(base)

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value)
    }

    return url.toString()
  }

  async readManualToken(): Promise<string | null> {
    const envToken = env.MUSIXMATCH_TOKEN?.trim()
    if (envToken) return envToken

    try {
      const value = (await readFile(this.manualTokenFile, 'utf-8')).trim()
      return value || null
    } catch {
      return null
    }
  }

  async readTokenFromFile(): Promise<TokenData | null> {
    try {
      const data = await readFile(this.tokenFile, 'utf-8')
      const parsed = JSON.parse(data) as TokenData | undefined

      if (
        parsed?.value &&
        typeof parsed.expires === 'number' &&
        parsed.expires > Date.now()
      ) {
        return parsed
      }
    } catch {}

    return null
  }

  async saveTokenToFile(token: string, expires: number): Promise<void> {
    try {
      await writeFile(
        this.tokenFile,
        JSON.stringify({ value: token, expires }),
        'utf-8'
      )
    } catch {}
  }

  async apiGet<TBody = unknown>(
    url: string,
    externalSignal?: AbortSignal
  ): Promise<TBody> {
    externalSignal?.throwIfAborted?.()

    const controller = new AbortController()
    const onExternalAbort = () => controller.abort()
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true })

    const timeoutId = setTimeout(
      () => controller.abort(),
      this.requestTimeoutMs
    )
    ;(timeoutId as NodeJS.Timeout).unref?.()

    try {
      const response = await fetch(url, {
        headers: DEFAULT_HEADERS,
        signal: controller.signal
      })

      if (!response.ok) throw new HttpError(response.status)

      const data = (await response.json()) as ApiEnvelope<TBody>
      const header = data.message?.header

      if (header?.status_code !== 200) {
        throw new MxmApiError(header?.status_code ?? 0, header?.hint)
      }

      return data.message?.body as TBody
    } finally {
      clearTimeout(timeoutId)
      externalSignal?.removeEventListener('abort', onExternalAbort)
    }
  }

  async fetchToken(): Promise<string> {
    const manualToken = await this.readManualToken()
    if (manualToken) return manualToken

    const url = this.buildUrl(ENDPOINTS.TOKEN, { app_id: APP_ID })
    const body = await this.apiGet<TokenResponseBody>(url)
    const token = safeText(body.user_token)
    if (!token) throw new MxmApiError(0, 'Missing user token')
    return token
  }

  async resetToken(hard = false): Promise<void> {
    this.tokenData = null
    this.tokenPromise = null

    if (!hard) return

    try {
      await unlink(this.tokenFile)
    } catch {}
  }

  private async storeToken(token: string): Promise<string> {
    const expires = Date.now() + TOKEN_TTL
    this.tokenData = { value: token, expires }
    this.saveTokenToFile(token, expires).catch(() => {})
    return token
  }

  async getToken(force = false): Promise<string> {
    const now = Date.now()

    if (!force && this.tokenData && now < this.tokenData.expires) {
      this.tokenData.expires = now + TOKEN_TTL

      if (now - this.lastTokenPersist > TOKEN_PERSIST_INTERVAL) {
        this.lastTokenPersist = now
        this.saveTokenToFile(
          this.tokenData.value,
          this.tokenData.expires
        ).catch(() => {})
      }

      return this.tokenData.value
    }

    if (!this.tokenData && !force) {
      this.tokenData = await this.readTokenFromFile()
      if (this.tokenData && now < this.tokenData.expires) {
        return this.tokenData.value
      }
    }

    if (this.tokenPromise) return this.tokenPromise

    this.tokenPromise = this.acquireNewToken()
    try {
      return await this.tokenPromise
    } finally {
      this.tokenPromise = null
    }
  }

  async acquireNewToken(): Promise<string> {
    try {
      return await this.storeToken(await this.fetchToken())
    } catch (error) {
      if (isAuthError(error)) {
        await this.resetToken(true)
        return await this.storeToken(await this.fetchToken())
      }
      throw error
    }
  }

  async callMxm(
    endpoint: string,
    params: Record<string, string | undefined>,
    signal?: AbortSignal
  ): Promise<unknown> {
    try {
      const token = await this.getToken()
      const url = this.buildUrl(endpoint, {
        ...params,
        app_id: APP_ID,
        usertoken: token
      })

      return await this.apiGet(url, signal)
    } catch (error) {
      if (!isAuthError(error)) throw error
      if (signal?.aborted) throw error

      await this.resetToken(error.hint?.toLowerCase().includes('captcha'))
      const newToken = await this.getToken(true)
      const url = this.buildUrl(endpoint, {
        ...params,
        app_id: APP_ID,
        usertoken: newToken
      })

      return await this.apiGet(url, signal)
    }
  }

  private norm(value: string): string {
    return value.replace(/\s+/g, ' ').trim()
  }

  private normalizeComparable(value: string): string {
    return stripDiacritics(this.norm(value))
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[\u2018\u2019']/g, '')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .replace(/\b(?:feat|ft|featuring)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private stripFeaturing(value: string): string {
    const lower = value.toLowerCase()
    let cut = -1

    for (const marker of [' feat.', ' ft.', ' featuring ', ' feat ', ' ft ']) {
      const index = lower.indexOf(marker)
      if (index !== -1 && (cut === -1 || index < cut)) cut = index
    }

    return (cut === -1 ? value : value.slice(0, cut)).trim()
  }

  private stripArtistJunk(value: string): string {
    return value.replace(/\s*-\s*(?:topic|vevo)$/i, '').trim()
  }

  private stripTrailingParensJunk(value: string): string {
    let output = value

    while (output.endsWith(')')) {
      const openIndex = output.lastIndexOf('(')
      if (openIndex === -1) break

      const inside = output.slice(openIndex + 1, -1).toLowerCase()
      if (
        !/(official|lyrics?|video|audio|mv|visualizer|karaoke|hd|4k)/.test(
          inside
        )
      ) {
        break
      }

      output = output.slice(0, openIndex).trim()
    }

    return output
  }

  private normalizeTitle(value: string): string {
    return this.normalizeComparable(
      this.stripFeaturing(
        this.stripTrailingParensJunk(
          this.norm(value.replace(BRACKET_JUNK, ' '))
        )
      )
    )
  }

  private normalizeArtist(value: string): string {
    return this.normalizeComparable(
      this.stripArtistJunk(
        this.stripFeaturing(
          this.stripTrailingParensJunk(
            this.norm(value.replace(BRACKET_JUNK, ' '))
          )
        )
      )
    )
  }

  private tokenize(value: string): string[] {
    return this.normalizeComparable(value)
      .split(' ')
      .filter((token) => token.length > 1)
  }

  private deStylize(value: string): string {
    return value
      .replace(/\$/g, 's')
      .replace(/@/g, 'a')
      .replace(/0/g, 'o')
      .replace(/1/g, 'i')
      .replace(/3/g, 'e')
      .replace(/!/g, 'i')
  }

  private stripCollaboratorSuffix(value: string): string {
    return value
      .replace(/\s+(?:feat\.?|ft\.?|featuring|part\.?|pt\.?|com)\s+.+$/iu, '')
      .trim()
  }

  private buildTitleVariants(title: string): string[] {
    const direct = this.norm(title)
    const withoutGuests = this.norm(this.stripCollaboratorSuffix(title))
    const destylized = this.norm(this.deStylize(title))
    const alnumOnly = this.norm(
      this.deStylize(title).replace(/[^\p{L}\p{N}\s]/gu, ' ')
    )

    return uniqueBy(
      [direct, withoutGuests, destylized, alnumOnly].filter(Boolean),
      (value) => this.normalizeTitle(value)
    )
  }

  private tokenOverlap(a: string, b: string): number {
    const aTokens = new Set(this.tokenize(a))
    const bTokens = new Set(this.tokenize(b))

    if (!aTokens.size || !bTokens.size) return 0

    let common = 0
    for (const token of aTokens) if (bTokens.has(token)) common++

    return (2 * common) / (aTokens.size + bTokens.size)
  }

  private bigramDice(a: string, b: string): number {
    const left = this.normalizeComparable(a)
    const right = this.normalizeComparable(b)

    if (!left || !right) return 0
    if (left === right) return 1
    if (left.length < 2 || right.length < 2) return 0

    const counts = new Map<string, number>()
    for (let index = 0; index < left.length - 1; index++) {
      const gram = left.slice(index, index + 2)
      counts.set(gram, (counts.get(gram) ?? 0) + 1)
    }

    let intersection = 0
    for (let index = 0; index < right.length - 1; index++) {
      const gram = right.slice(index, index + 2)
      const count = counts.get(gram) ?? 0
      if (count > 0) {
        intersection++
        counts.set(gram, count - 1)
      }
    }

    return (2 * intersection) / (left.length + right.length - 2)
  }

  private similarity(a: string, b: string): number {
    const left = this.normalizeComparable(a)
    const right = this.normalizeComparable(b)

    if (!left || !right) return 0
    if (left === right) return 1
    if (left.includes(right) || right.includes(left)) return 0.92

    return Math.max(
      this.tokenOverlap(left, right),
      this.bigramDice(left, right)
    )
  }

  private hasVersionMarker(value: string): boolean {
    const normalized = this.normalizeComparable(value)
    return VERSION_MARKERS.some((marker) => normalized.includes(marker))
  }

  private versionPenalty(targetTitle: string, candidateTitle: string): number {
    const targetHasMarker = this.hasVersionMarker(targetTitle)
    const candidateHasMarker = this.hasVersionMarker(candidateTitle)

    if (targetHasMarker === candidateHasMarker) return 0
    return candidateHasMarker ? 12 : 4
  }

  private artworkScore(
    targetArtwork: string | undefined,
    candidateArtwork: string | undefined
  ) {
    if (!targetArtwork || !candidateArtwork) return 0

    const target = normalizeArtwork(targetArtwork)
    const candidate = normalizeArtwork(candidateArtwork)
    if (!target || !candidate) return 0
    if (target === candidate) return 1

    const targetTail = takeLastPathBits(target)
    const candidateTail = takeLastPathBits(candidate)

    return targetTail && candidateTail && targetTail === candidateTail
      ? 0.75
      : 0
  }

  private durationScore(
    targetDurationMs: number | undefined,
    candidateDurationMs: number | undefined
  ) {
    if (!targetDurationMs || !candidateDurationMs) return 0

    const diff = Math.abs(targetDurationMs - candidateDurationMs)
    if (diff <= 1500) return 1
    if (diff <= 5000) return 0.8
    if (diff <= 12_000) return 0.45
    if (diff <= 25_000) return 0.2
    return 0
  }

  private isrcScore(
    targetIsrc: string | undefined,
    candidateIsrc: string | undefined
  ) {
    if (!targetIsrc || !candidateIsrc) return 0
    return this.normalizeComparable(targetIsrc) ===
      this.normalizeComparable(candidateIsrc)
      ? 1
      : 0
  }

  private trackAlbumArt(
    track: SearchTrack | LyricsTrack | undefined
  ): string | undefined {
    if (!track) return undefined

    if ('albumArt' in track && track.albumArt) return track.albumArt

    const searchTrack = track as SearchTrack
    return (
      searchTrack.album_coverart_800x800 ||
      searchTrack.album_coverart_350x350 ||
      searchTrack.album_coverart_100x100
    )
  }

  private toMatchableTrack(track: SearchTrack): MatchableTrack {
    const seconds = safeNumber(track.track_length)

    return {
      title: safeText(track.track_name),
      artist: safeText(track.artist_name),
      albumArt: this.trackAlbumArt(track),
      durationMs:
        seconds !== undefined ? Math.round(seconds * 1000) : undefined,
      isrc: safeText(track.track_isrc) || undefined,
      hasSubtitles: safeNumber(track.has_subtitles) === 1,
      hasLyrics: safeNumber(track.has_lyrics) === 1
    }
  }

  private scoreMatchableTrack(
    track: MatchableTrack,
    target: SearchTarget
  ): number {
    const titleScore = this.similarity(track.title, target.title)
    const artistScore = target.artist
      ? this.similarity(track.artist, target.artist)
      : 0

    let score = titleScore * 60

    if (target.artist) {
      score += artistScore * 28
      if (artistScore < 0.25) score -= 12
    }

    if (titleScore < 0.35) score -= 18
    if (titleScore === 1) score += 12
    if (target.artist && artistScore === 1) score += 6

    score += this.artworkScore(target.albumArt, track.albumArt) * 16
    score += this.durationScore(target.durationMs, track.durationMs) * 10
    score += this.isrcScore(target.isrc, track.isrc) * 80
    score += track.hasSubtitles ? 8 : 0
    score += track.hasLyrics ? 4 : 0
    score -= this.versionPenalty(target.title, track.title)

    return score
  }

  private scoreResolvedResult(
    result: LyricsResult,
    target: SearchTarget
  ): number {
    const base = this.scoreMatchableTrack(
      {
        title: result.track.title,
        artist: result.track.author,
        albumArt: result.track.albumArt,
        durationMs: result.track.durationMs,
        isrc: result.track.isrc,
        hasSubtitles: Boolean(result.lines?.length),
        hasLyrics: Boolean(result.text)
      },
      target
    )

    return base + (result.lines?.length ? 10 : 0) + (result.text ? 5 : 0)
  }

  private searchCacheKey(target: SearchTarget) {
    return [
      target.normalizedArtist ?? '',
      target.normalizedTitle,
      target.isrc ?? ''
    ].join('|')
  }

  cleanLyrics(lyrics: string): string {
    const cleanedLines: string[] = []
    let sawGap = false

    for (const rawLine of lyrics.replace(TIMESTAMP_REGEX, '').split(/\r?\n/)) {
      const line = rawLine.trim()

      if (!line) {
        if (cleanedLines.length) sawGap = true
        continue
      }

      if (FOOTER_LINE_PATTERNS.some((pattern) => pattern.test(line))) continue

      if (sawGap && cleanedLines.length) cleanedLines.push('')
      cleanedLines.push(line)
      sawGap = false
    }

    return cleanedLines.join('\n').trim()
  }

  parseSubtitles(subtitleBody: string): LyricsLine[] | null {
    try {
      const parsed = JSON.parse(subtitleBody) as
        | Array<Record<string, unknown>>
        | { subtitle?: Array<Record<string, unknown>> }
        | undefined

      const subtitleItems = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.subtitle)
          ? parsed.subtitle
          : []

      const lines = subtitleItems
        .map((item) => {
          const entry = item as {
            time?: { total?: number; start?: number }
            total?: unknown
            start?: unknown
            milliseconds?: unknown
            text?: unknown
            text_display?: unknown
            text_highlighted?: unknown
            lyrics?: unknown
            line?: unknown
          }
          const seconds =
            safeNumber(entry.time?.total) ??
            safeNumber(entry.time?.start) ??
            safeNumber(entry.total) ??
            safeNumber(entry.start) ??
            safeNumber(entry.milliseconds)

          const line = this.norm(
            safeText(entry.text) ||
              safeText(entry.text_display) ||
              safeText(entry.text_highlighted) ||
              safeText(entry.lyrics) ||
              safeText(entry.line)
          )

          if (!line) return null

          const rawMs =
            seconds === undefined
              ? 0
              : seconds > 1000
                ? Math.round(seconds)
                : Math.round(seconds * 1000)

          return {
            line,
            range: { start: rawMs }
          }
        })
        .filter((line): line is LyricsLine => Boolean(line))
        .sort((left, right) => left.range.start - right.range.start)

      if (!lines.length) return null

      const deduped: LyricsLine[] = []
      for (const line of lines) {
        const previous = deduped[deduped.length - 1]
        if (
          previous &&
          previous.line === line.line &&
          previous.range.start === line.range.start
        ) {
          continue
        }

        deduped.push(line)
      }

      return deduped.length ? deduped : null
    } catch {
      return null
    }
  }

  parseQuery(query: string): { artist?: string; title: string } {
    let cleaned = this.norm(query.replace(BRACKET_JUNK, ' '))
    cleaned = this.stripTrailingParensJunk(cleaned)

    if (
      (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))
    ) {
      cleaned = cleaned.slice(1, -1).trim()
    }

    const splitBy = (separator: string) => {
      const index = cleaned.indexOf(separator)
      if (index <= 0 || index >= cleaned.length - separator.length) return null

      const artist = cleaned.slice(0, index).trim()
      const title = cleaned.slice(index + separator.length).trim()
      return artist && title ? { artist, title } : null
    }

    let parts = splitBy(' - ') || splitBy(' ~ ') || splitBy(' by ')

    if (!parts) {
      const lower = cleaned.toLowerCase()
      const byIndex = lower.lastIndexOf(' by ')
      if (byIndex > 0 && byIndex < cleaned.length - 4) {
        parts = {
          title: cleaned.slice(0, byIndex).trim(),
          artist: cleaned.slice(byIndex + 4).trim()
        }
      }
    }

    const artist = parts?.artist
      ? this.stripArtistJunk(this.stripFeaturing(this.norm(parts.artist)))
      : undefined
    const title = this.stripFeaturing(this.norm(parts?.title ?? cleaned))

    return artist ? { artist, title } : { title }
  }

  private shouldUseHints(query: string, hints?: LyricsSearchHints): boolean {
    if (!hints?.title) return false
    if (!query) return true

    const hintedTitle = this.normalizeTitle(hints.title)
    const hintedArtist = hints.artist ? this.normalizeArtist(hints.artist) : ''
    const hintSignature = [hintedArtist, hintedTitle].filter(Boolean).join(' ')
    const queryValue = this.normalizeComparable(query)

    return (
      this.similarity(queryValue, hintSignature) >= 0.72 ||
      this.similarity(queryValue, hintedTitle) >= 0.88
    )
  }

  private buildSearchTarget(
    query: string,
    hints?: LyricsSearchHints
  ): SearchTarget | null {
    const cleanedQuery = this.norm(query)
    const trustedHints = this.shouldUseHints(cleanedQuery, hints)
    const hintTitle = hints?.title ? this.norm(hints.title) : ''
    const hintArtist = hints?.artist ? this.norm(hints.artist) : ''
    let parsed = cleanedQuery
      ? this.parseQuery(cleanedQuery)
      : { title: hintTitle }

    if (hintTitle && hintArtist && parsed.artist) {
      const reversedTitleScore = this.similarity(parsed.artist, hintTitle)
      const reversedArtistScore = this.similarity(parsed.title, hintArtist)
      if (reversedTitleScore >= 0.86 && reversedArtistScore >= 0.72) {
        parsed = { title: parsed.artist, artist: parsed.title }
      }
    }

    const title = parsed.title || hintTitle
    if (!title) return null

    let artist = parsed.artist
    if (!artist && hintArtist) {
      if (
        !cleanedQuery ||
        trustedHints ||
        this.similarity(title, hintTitle) >= 0.86
      ) {
        artist = hintArtist
      }
    }

    return {
      rawQuery:
        cleanedQuery || [hintArtist, hintTitle].filter(Boolean).join(' '),
      title,
      artist,
      albumArt: trustedHints || !cleanedQuery ? hints?.albumArt : undefined,
      durationMs: trustedHints || !cleanedQuery ? hints?.durationMs : undefined,
      isrc: trustedHints || !cleanedQuery ? hints?.isrc : undefined,
      normalizedTitle: this.normalizeTitle(title),
      normalizedArtist: artist ? this.normalizeArtist(artist) : undefined
    }
  }

  getCached(key: string): LyricsResult | null | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined

    if (entry.expires <= Date.now()) {
      this.cache.delete(key)
      return undefined
    }

    this.cache.delete(key)
    this.cache.set(key, entry)
    return entry.value
  }

  setCached(key: string, value: LyricsResult | null): void {
    const now = Date.now()
    for (const [cacheKey, entry] of this.cache) {
      if (entry.expires <= now) this.cache.delete(cacheKey)
    }

    while (this.cache.size >= this.maxCacheEntries) {
      const firstKey = this.cache.keys().next().value as string | undefined
      if (!firstKey) break
      this.cache.delete(firstKey)
    }

    this.cache.set(key, { value, expires: now + this.cacheTTL })
  }

  formatResult(
    subtitles: string | null,
    lyrics: string | null,
    track: SearchTrack | LyricsTrack
  ): LyricsResult {
    const lines = subtitles ? this.parseSubtitles(subtitles) : null
    const text = lyrics
      ? this.cleanLyrics(lyrics)
      : (lines?.map((line) => line.line).join('\n') ?? null)

    let trackData: LyricsTrack
    if ('track_id' in track) {
      const seconds = safeNumber(track.track_length)
      trackData = {
        id: track.track_id,
        title: safeText(track.track_name) || '',
        author: safeText(track.artist_name) || '',
        albumArt: this.trackAlbumArt(track),
        durationMs:
          seconds !== undefined ? Math.round(seconds * 1000) : undefined,
        isrc: safeText(track.track_isrc) || undefined
      }
    } else {
      const lyricsTrack = track as LyricsTrack
      trackData = {
        id: lyricsTrack.id,
        title: lyricsTrack.title || '',
        author: lyricsTrack.author || '',
        albumArt: lyricsTrack.albumArt,
        durationMs: lyricsTrack.durationMs,
        isrc: lyricsTrack.isrc
      }
    }

    return {
      text: text || null,
      lines,
      track: trackData,
      source: 'Musixmatch'
    }
  }

  private async safeMxmCall<T>(
    factory: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<T | null> {
    try {
      return await factory()
    } catch (error) {
      if (signal?.aborted) throw error
      return null
    }
  }

  private async searchTracks(
    target: SearchTarget,
    signal?: AbortSignal
  ): Promise<CandidateTrack[]> {
    const body = (await this.callMxm(
      ENDPOINTS.SEARCH,
      {
        page_size: String(MAX_SEARCH_RESULTS),
        page: '1',
        s_track_rating: 'desc',
        q_track: target.title,
        q_artist: target.artist,
        q_track_artist: target.artist
          ? `${target.artist} ${target.title}`
          : target.rawQuery || target.title
      },
      signal
    )) as SearchResponseBody

    const trackList = body.track_list
    if (!Array.isArray(trackList) || !trackList.length) return []

    const ranked = trackList
      .map((item) => item?.track as SearchTrack | undefined)
      .filter((track): track is SearchTrack => Boolean(track?.track_id))
      .map((track) => ({
        raw: track,
        score: this.scoreMatchableTrack(this.toMatchableTrack(track), target)
      }))
      .sort((left, right) => right.score - left.score)

    return ranked.filter(
      ({ score }, index) => index < 3 || score >= (target.artist ? 28 : 18)
    )
  }

  private buildSearchVariants(target: SearchTarget): SearchTarget[] {
    return uniqueBy(
      this.buildTitleVariants(target.title).map((title) => ({
        ...target,
        title,
        normalizedTitle: this.normalizeTitle(title)
      })),
      (variant) =>
        `${variant.normalizedArtist ?? ''}|${variant.normalizedTitle}`
    )
  }

  private async fetchTrackPayload(
    trackId: number,
    signal?: AbortSignal
  ): Promise<{ subtitles: string | null; lyrics: string | null } | null> {
    const [subtitleBody, lyricsBody] = await Promise.all([
      this.safeMxmCall(
        () =>
          this.callMxm(
            ENDPOINTS.SUBTITLE,
            { subtitle_format: 'mxm', track_id: String(trackId) },
            signal
          ),
        signal
      ),
      this.safeMxmCall(
        () =>
          this.callMxm(
            ENDPOINTS.TRACK_LYRICS,
            { track_id: String(trackId) },
            signal
          ),
        signal
      )
    ])

    const subtitles =
      (subtitleBody as SubtitleResponseBody | null)?.subtitle?.subtitle_body ??
      null
    const lyrics =
      (lyricsBody as LyricsResponseBody | null)?.lyrics?.lyrics_body ?? null

    return subtitles || lyrics ? { subtitles, lyrics } : null
  }

  private formatMacroResult(body: unknown): LyricsResult | null {
    const { lyrics, track, subtitles } = extractMacroCalls(body)
    if (!track || (!lyrics && !subtitles)) return null
    return this.formatResult(subtitles ?? null, lyrics ?? null, track)
  }

  private async fetchExactMacroMatch(
    title: string,
    artist: string | undefined,
    signal?: AbortSignal
  ): Promise<LyricsResult | null> {
    const body = await this.safeMxmCall(
      () =>
        this.callMxm(
          ENDPOINTS.MACRO,
          {
            format: 'json',
            namespace: 'lyrics_richsynched',
            subtitle_format: 'mxm',
            q_track: title,
            q_artist: artist
          },
          signal
        ),
      signal
    )

    return body ? this.formatMacroResult(body) : null
  }

  private async resolveCandidate(
    candidate: CandidateTrack,
    target: SearchTarget,
    signal?: AbortSignal
  ): Promise<{ result: LyricsResult; score: number } | null> {
    const trackId = candidate.raw.track_id
    if (!trackId) return null

    const payload = await this.fetchTrackPayload(trackId, signal)
    if (payload) {
      const result = this.formatResult(
        payload.subtitles,
        payload.lyrics,
        candidate.raw
      )
      return { result, score: this.scoreResolvedResult(result, target) }
    }

    const fallback = await this.fetchExactMacroMatch(
      safeText(candidate.raw.track_name),
      safeText(candidate.raw.artist_name) || undefined,
      signal
    )

    if (!fallback) return null
    return {
      result: fallback,
      score: this.scoreResolvedResult(fallback, target)
    }
  }

  private buildFallbackTargets(target: SearchTarget) {
    return uniqueBy(
      [
        ...this.buildTitleVariants(target.title).flatMap((title) => [
          { title, artist: target.artist },
          { title }
        ]),
        target.rawQuery ? { title: target.rawQuery } : null
      ].filter((value): value is { title: string; artist?: string } =>
        Boolean(value?.title)
      ),
      (value) =>
        `${this.normalizeArtist(value.artist ?? '')}|${this.normalizeTitle(value.title)}`
    )
  }

  async findLyrics(
    query: string,
    hints?: LyricsSearchHints
  ): Promise<LyricsResult | null> {
    const target = this.buildSearchTarget(query, hints)
    if (!target) return null

    const cacheKey = this.searchCacheKey(target)
    const cached = this.getCached(cacheKey)
    if (cached !== undefined) return cached

    let bestMatch: { result: LyricsResult; score: number } | null = null

    try {
      const rankedCandidates = uniqueBy(
        (
          await Promise.all(
            this.buildSearchVariants(target).map((variant) =>
              this.searchTracks(variant)
            )
          )
        )
          .flat()
          .sort((left, right) => right.score - left.score),
        (candidate) => String(candidate.raw.track_id ?? '')
      )

      const resolved = await Promise.all(
        rankedCandidates
          .slice(0, MAX_RESOLVED_CANDIDATES)
          .map((candidate) => this.resolveCandidate(candidate, target))
      )

      for (const candidate of resolved) {
        if (!candidate) continue
        if (!bestMatch || candidate.score > bestMatch.score) {
          bestMatch = candidate
        }
      }

      if (!bestMatch) {
        for (const fallbackTarget of this.buildFallbackTargets(target)) {
          const fallback = await this.fetchExactMacroMatch(
            fallbackTarget.title,
            fallbackTarget.artist
          )

          if (!fallback) continue

          const score = this.scoreResolvedResult(fallback, target)
          if (!bestMatch || score > bestMatch.score) {
            bestMatch = { result: fallback, score }
          }
        }
      }
    } catch {
      bestMatch = null
    }

    const minimumScore = target.artist ? 36 : 24
    const result =
      bestMatch && bestMatch.score >= minimumScore ? bestMatch.result : null

    this.setCached(cacheKey, result)
    return result
  }
}
