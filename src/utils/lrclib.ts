import { APP_VERSION } from '../shared/constants.ts'
import type {
  LyricsFindOptions,
  LyricsLine,
  LyricsResult,
  LyricsSearchHints
} from './musiclyrics.ts'

const BASE_URL = 'https://lrclib.net/api'
const USER_AGENT = `Kenium/${APP_VERSION} (Discord music bot)`
const REQUEST_TIMEOUT_MS = 8000
const REQUEST_MIN_INTERVAL_MS = 300
const RETRY_AFTER_MAX_MS = 15_000
const MAX_REQUEST_ATTEMPTS = 3
const CACHE_TTL_MS = 300_000
const MAX_CACHE_ENTRIES = 100
const MIN_DURATION_SECONDS = 1
const MAX_DURATION_SECONDS = 3600
const MAX_TITLE_VARIANTS = 4
const STRONG_MATCH_SCORE = 78
const MIN_ARTIST_MATCH_SCORE = 52
const MIN_TITLE_ONLY_SCORE = 42

const BRACKET_JUNK =
  /\s*\[([^\]]*(?:official|lyrics?|video|audio|mv|visualizer|color\s*coded|hd|4k|karaoke)[^\]]*)\]/gi
const LRC_LINE_TIMESTAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const LRC_WORD_TIMESTAMP = /<\d{1,3}:\d{1,2}(?:\.\d{1,3})?>/g

class HttpError extends Error {
  status: number

  constructor(status: number) {
    super(`HTTP ${status}`)
    this.name = 'HttpError'
    this.status = status
  }
}

interface LrclibRecord {
  id?: number
  trackName?: string
  artistName?: string
  duration?: number
  instrumental?: boolean
  plainLyrics?: string | null
  syncedLyrics?: string | null
}

interface CacheEntry<T> {
  value: T
  expires: number
}

interface SearchTarget {
  rawQuery: string
  title: string
  artist?: string | undefined
  durationMs?: number | undefined
  normalizedTitle: string
  normalizedArtist?: string | undefined
}

interface ScoredRecord {
  record: LrclibRecord
  score: number
}

export interface LrclibOptions {
  requestTimeoutMs?: number
  requestMinIntervalMs?: number
  cacheTTL?: number
  maxCacheEntries?: number
  baseUrl?: string
  userAgent?: string
}

const stripDiacritics = (value: string) =>
  value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')

const safeText = (value: unknown) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''

const hasText = (value: unknown) =>
  typeof value === 'string' && /\S/.test(value)

const safeNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
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

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    ;(timer as NodeJS.Timeout).unref?.()
  })

const parseRetryAfter = (value: string | null): number => {
  if (!value) return 0

  const seconds = Number(value.trim())
  if (!Number.isFinite(seconds) || seconds <= 0) return 0

  return Math.ceil(seconds * 1000)
}

const discardBody = async (response: Response) => {
  try {
    await response.body?.cancel()
  } catch {}
}

const toDurationSeconds = (durationMs: number | undefined) => {
  if (!durationMs || durationMs <= 0) return undefined

  const seconds = Math.round(durationMs / 1000)
  if (seconds < MIN_DURATION_SECONDS || seconds > MAX_DURATION_SECONDS) {
    return undefined
  }

  return seconds
}

const normalizeComparable = (value: string) =>
  stripDiacritics(value.replace(/\s+/g, ' ').trim())
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[\u2018\u2019']/g, '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\b(?:feat|ft|featuring)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const tokensOf = (normalized: string) =>
  normalized.split(' ').filter((token) => token.length > 1)

const tokenOverlap = (leftTokens: Set<string>, rightTokens: Set<string>) => {
  if (!leftTokens.size || !rightTokens.size) return 0

  let common = 0
  for (const token of leftTokens) if (rightTokens.has(token)) common++

  return (2 * common) / (leftTokens.size + rightTokens.size)
}

const bigramDice = (a: string, b: string) => {
  if (a.length < 2 || b.length < 2) return 0

  const counts = new Map<string, number>()
  for (let index = 0; index < a.length - 1; index++) {
    const gram = a.slice(index, index + 2)
    counts.set(gram, (counts.get(gram) ?? 0) + 1)
  }

  let intersection = 0
  for (let index = 0; index < b.length - 1; index++) {
    const gram = b.slice(index, index + 2)
    const count = counts.get(gram) ?? 0
    if (count > 0) {
      intersection++
      counts.set(gram, count - 1)
    }
  }

  return (2 * intersection) / (a.length + b.length - 2)
}

const similarity = (left: string, right: string) => {
  const a = normalizeComparable(left)
  const b = normalizeComparable(right)

  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return 0.92

  const leftTokens = tokensOf(a)
  const rightTokens = tokensOf(b)

  return Math.max(
    tokenOverlap(new Set(leftTokens), new Set(rightTokens)),
    bigramDice(a, b)
  )
}

const durationScore = (
  targetDurationMs: number | undefined,
  candidateDurationMs: number | undefined
) => {
  if (!targetDurationMs || !candidateDurationMs) return 0

  const diff = Math.abs(targetDurationMs - candidateDurationMs)
  if (diff <= 1500) return 1
  if (diff <= 5000) return 0.8
  if (diff <= 12_000) return 0.45
  if (diff <= 25_000) return 0.2
  return 0
}

const stripFeaturing = (value: string): string => {
  const lower = value.toLowerCase()
  let cut = -1

  for (const marker of [' feat.', ' ft.', ' featuring ', ' feat ', ' ft ']) {
    const index = lower.indexOf(marker)
    if (index !== -1 && (cut === -1 || index < cut)) cut = index
  }

  return (cut === -1 ? value : value.slice(0, cut)).trim()
}

const stripArtistJunk = (value: string) =>
  value.replace(/\s*-\s*(?:topic|vevo)$/i, '').trim()

const isGenericUploader = (value: string) => {
  const normalized = normalizeComparable(value)
  return (
    normalized === 'nocopyrightsounds' ||
    normalized === 'ncs' ||
    normalized === 'nocopyrightsounds ncs'
  )
}

const stripTrailingParensJunk = (value: string): string => {
  let output = value

  while (output.endsWith(')')) {
    const openIndex = output.lastIndexOf('(')
    if (openIndex === -1) break

    const inside = output.slice(openIndex + 1, -1).toLowerCase()
    if (
      !/(official|lyrics?|video|audio|mv|visualizer|karaoke|hd|4k)/.test(inside)
    ) {
      break
    }

    output = output.slice(0, openIndex).trim()
  }

  return output
}

const stripCollaboratorSuffix = (value: string) =>
  value
    .replace(/\s+(?:feat\.?|ft\.?|featuring|part\.?|pt\.?|com)\s+.+$/iu, '')
    .trim()

// Only a variant: the untouched title is always tried first, so
// music-video timings that only exist under the full title still match.
// cuz lrclib has some nice support for music video synced lyrics.
export const stripPipeSuffix = (value: string) =>
  (value.split('|')[0] ?? value).trim()

const DASH_JUNK_SUFFIX =
  /\s+-\s+(?:ncs\b.*|copyright.*|official(?:\s+music)?\s+video|official\s+audio|lyrics?\s+video|(?:official\s+)?audio|visualizer|\bmvs?\b)$/i

export const stripDashJunkSuffix = (value: string) =>
  value.replace(DASH_JUNK_SUFFIX, '').trim()

const norm = (value: string) => value.replace(/\s+/g, ' ').trim()

const normalizeTitle = (value: string) =>
  normalizeComparable(
    stripFeaturing(
      stripTrailingParensJunk(norm(value.replace(BRACKET_JUNK, ' ')))
    )
  )

const normalizeArtist = (value: string) =>
  normalizeComparable(
    stripArtistJunk(
      stripFeaturing(
        stripTrailingParensJunk(norm(value.replace(BRACKET_JUNK, ' ')))
      )
    )
  )

export const buildTitleVariants = (title: string): string[] => {
  const direct = norm(title)
  const withoutGuests = norm(stripCollaboratorSuffix(title))
  const cleanedBase = stripDashJunkSuffix(stripPipeSuffix(title))
  const cleaned = norm(cleanedBase)
  const cleanedWithoutGuests = norm(stripCollaboratorSuffix(cleanedBase))

  return uniqueBy(
    [direct, withoutGuests, cleaned, cleanedWithoutGuests].filter(Boolean),
    (value) => normalizeTitle(value)
  )
}

export const buildArtistVariants = (artist: string): string[] => {
  const direct = norm(artist)
  const head = stripFeaturing(artist)
    .split(/\s*(?:&|,|\+|×)\s*|\s+x\s+/i)
    .map((part) => part.trim())
    .filter(Boolean)[0]

  return uniqueBy([direct, norm(head ?? '')].filter(Boolean), (value) =>
    normalizeArtist(value)
  )
}

const parseQuery = (query: string): { title: string; artist?: string } => {
  let cleaned = stripTrailingParensJunk(norm(query.replace(BRACKET_JUNK, ' ')))

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
    ? stripArtistJunk(stripFeaturing(norm(parts.artist)))
    : undefined
  const title = stripFeaturing(norm(parts?.title ?? cleaned))

  return artist ? { artist, title } : { title }
}

const shouldUseHints = (query: string, hints?: LyricsSearchHints) => {
  if (!hints?.title) return false
  if (!query) return true

  const hintedTitle = normalizeTitle(hints.title)
  const hintedArtist = hints.artist ? normalizeArtist(hints.artist) : ''
  const hintSignature = [hintedArtist, hintedTitle].filter(Boolean).join(' ')
  const queryValue = normalizeComparable(query)

  return (
    similarity(queryValue, hintSignature) >= 0.72 ||
    similarity(queryValue, hintedTitle) >= 0.88
  )
}

const buildSearchTarget = (
  query: string,
  hints?: LyricsSearchHints
): SearchTarget | null => {
  const cleanedQuery = norm(query)
  const trustedHints = shouldUseHints(cleanedQuery, hints)
  const hintTitle = hints?.title ? norm(hints.title) : ''
  const hintArtist = hints?.artist ? norm(hints.artist) : ''
  let parsed = cleanedQuery ? parseQuery(cleanedQuery) : { title: hintTitle }

  if (hintTitle && hintArtist && parsed.artist) {
    const reversedTitleScore = similarity(parsed.artist, hintTitle)
    const reversedArtistScore = similarity(parsed.title, hintArtist)
    if (reversedTitleScore >= 0.86 && reversedArtistScore >= 0.72) {
      parsed = { title: parsed.artist, artist: parsed.title }
    }
  }

  const title = parsed.title || hintTitle
  if (!title) return null

  let artist = parsed.artist
  if (
    !artist &&
    hintArtist &&
    !isGenericUploader(hintArtist) &&
    (!cleanedQuery || trustedHints || similarity(title, hintTitle) >= 0.86)
  ) {
    artist = hintArtist
  }

  return {
    rawQuery: cleanedQuery || [hintArtist, hintTitle].filter(Boolean).join(' '),
    title,
    artist,
    durationMs: trustedHints || !cleanedQuery ? hints?.durationMs : undefined,
    normalizedTitle: normalizeTitle(title),
    normalizedArtist: artist ? normalizeArtist(artist) : undefined
  }
}

const parseLrc = (content: string): LyricsLine[] | null => {
  const lines: LyricsLine[] = []

  for (const row of content.split(/\r?\n/)) {
    if (!row.includes('[')) continue

    const stamps = [...row.matchAll(LRC_LINE_TIMESTAMP)]
    if (!stamps.length) continue

    let text = row.replace(LRC_LINE_TIMESTAMP, ' ')
    if (row.includes('<')) text = text.replace(LRC_WORD_TIMESTAMP, ' ')
    text = text.replace(/\s+/g, ' ').trim()

    if (!text) continue

    for (const stamp of stamps) {
      const minutes = Number(stamp[1])
      const seconds = Number(stamp[2])
      if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) continue

      const fractionRaw = stamp[3] ?? ''
      const fraction = Number(fractionRaw.padEnd(3, '0').slice(0, 3))

      lines.push({
        range: {
          start:
            minutes * 60_000 +
            seconds * 1000 +
            (Number.isFinite(fraction) ? fraction : 0)
        },
        line: text
      })
    }
  }

  lines.sort((left, right) => left.range.start - right.range.start)

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
}

export class Lrclib {
  requestTimeoutMs: number
  requestMinIntervalMs: number
  cacheTTL: number
  maxCacheEntries: number
  baseUrl: string
  userAgent: string

  private queue: Promise<unknown> = Promise.resolve()
  private lastRequestAt = 0
  private cache = new Map<string, CacheEntry<LyricsResult | null>>()

  constructor(opts: LrclibOptions = {}) {
    this.requestTimeoutMs = opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
    this.requestMinIntervalMs =
      opts.requestMinIntervalMs ?? REQUEST_MIN_INTERVAL_MS
    this.cacheTTL = opts.cacheTTL ?? CACHE_TTL_MS
    this.maxCacheEntries = Math.max(
      10,
      opts.maxCacheEntries ?? MAX_CACHE_ENTRIES
    )
    this.baseUrl = opts.baseUrl ?? BASE_URL
    this.userAgent = opts.userAgent ?? USER_AGENT
  }

  async findLyrics(
    query: string,
    hints?: LyricsSearchHints,
    opts: LyricsFindOptions = {}
  ): Promise<LyricsResult | null> {
    const target = buildSearchTarget(query, hints)
    if (!target) return null

    const cacheKey = `${target.normalizedArtist ?? ''}|${target.normalizedTitle}`
    const cached = this.getCached(cacheKey)
    if (cached !== undefined) return cached

    // Independent attempts: an exact hit survives a search outage and
    // vice versa.
    const exactBest = await this.tryExactGet(target, opts).catch(() => null)
    const searchBest = await this.searchBestMatch(target, opts).catch(
      () => null
    )

    let best: ScoredRecord | null = null
    if (exactBest) best = exactBest
    if (searchBest && (!best || searchBest.score > best.score))
      best = searchBest

    const result = best ? this.formatRecord(best.record) : null
    this.setCached(cacheKey, result)
    return result
  }

  getCached(key: string): LyricsResult | null | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined

    if (entry.expires <= Date.now()) {
      this.cache.delete(key)
      const now = Date.now()
      for (const [cacheKey, value] of this.cache) {
        if (value.expires <= now) this.cache.delete(cacheKey)
      }
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

  async request<T>(
    endpointPath: string,
    params: Record<string, string | number | undefined>
  ): Promise<T | null> {
    const url = new URL(`${this.baseUrl}${endpointPath}`)

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, String(value))
      }
    }

    const task = this.queue.then(() => this.performRequest<T>(url.toString()))
    this.queue = task.then(
      () => undefined,
      () => undefined
    )

    return task
  }

  private async performRequest<T>(url: string): Promise<T | null> {
    for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt++) {
      await this.waitForSlot()

      const controller = new AbortController()
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.requestTimeoutMs
      )
      ;(timeoutId as NodeJS.Timeout).unref?.()

      try {
        const response = await fetch(url, {
          headers: {
            accept: 'application/json',
            'user-agent': this.userAgent
          },
          signal: controller.signal
        })

        if (response.status === 404) {
          await discardBody(response)
          return null
        }

        if (response.status === 429 && attempt < MAX_REQUEST_ATTEMPTS) {
          const retryAfterMs = parseRetryAfter(
            response.headers.get('retry-after')
          )

          if (retryAfterMs > 0 && retryAfterMs <= RETRY_AFTER_MAX_MS) {
            await discardBody(response)
            await sleep(retryAfterMs)
            continue
          }
        }

        if (!response.ok) {
          await discardBody(response)
          throw new HttpError(response.status)
        }

        return (await response.json()) as T
      } finally {
        clearTimeout(timeoutId)
      }
    }

    throw new HttpError(429)
  }

  private async waitForSlot(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt
    const remaining = this.requestMinIntervalMs - elapsed
    if (remaining > 0) await sleep(remaining)
    this.lastRequestAt = Date.now()
  }

  private minimumScore(target: SearchTarget) {
    return target.artist ? MIN_ARTIST_MATCH_SCORE : MIN_TITLE_ONLY_SCORE
  }

  private hasContent(record: LrclibRecord, requireSynced = false) {
    if (record.instrumental) return false
    if (requireSynced) return hasText(record.syncedLyrics)
    return hasText(record.syncedLyrics) || hasText(record.plainLyrics)
  }

  private scoreRecord(record: LrclibRecord, target: SearchTarget) {
    const title = safeText(record.trackName)
    const artist = safeText(record.artistName)
    const titleScore = similarity(title, target.title)
    const artistScore = target.artist ? similarity(artist, target.artist) : 0

    let score = titleScore * 60

    if (target.artist) {
      score += artistScore * 28
      if (artistScore < 0.25) score -= 12
    }

    if (titleScore < 0.35) score -= 18
    if (titleScore === 1) score += 12
    if (target.artist && artistScore === 1) score += 6

    const seconds = safeNumber(record.duration)
    score +=
      durationScore(
        target.durationMs,
        seconds !== undefined ? Math.round(seconds * 1000) : undefined
      ) * 10
    if (hasText(record.syncedLyrics)) score += 8
    if (hasText(record.plainLyrics)) score += 4

    return score
  }

  private formatRecord(record: LrclibRecord): LyricsResult {
    const lines = record.syncedLyrics ? parseLrc(record.syncedLyrics) : null
    const plain =
      typeof record.plainLyrics === 'string' ? record.plainLyrics.trim() : ''
    const derived = lines?.map((line) => line.line).join('\n') ?? ''
    const seconds = safeNumber(record.duration)

    return {
      text: plain || derived || null,
      lines,
      track: {
        id: typeof record.id === 'number' ? record.id : undefined,
        title: safeText(record.trackName),
        author: safeText(record.artistName),
        durationMs:
          seconds !== undefined ? Math.round(seconds * 1000) : undefined
      },
      source: 'LRCLIB'
    }
  }

  private async tryExactGet(
    target: SearchTarget,
    opts: LyricsFindOptions = {}
  ): Promise<ScoredRecord | null> {
    if (!target.artist) return null

    const seconds = toDurationSeconds(target.durationMs)
    const minimum = this.minimumScore(target)
    const requireSynced = opts.requireSynced ?? false
    let best: ScoredRecord | null = null

    for (const title of buildTitleVariants(target.title).slice(
      0,
      MAX_TITLE_VARIANTS
    )) {
      for (const artist of buildArtistVariants(target.artist)) {
        const record = await this.request<LrclibRecord>('/get', {
          track_name: title,
          artist_name: artist,
          ...(seconds !== undefined ? { duration: seconds } : {})
        })

        if (!record || !this.hasContent(record, requireSynced)) continue

        const score = this.scoreRecord(record, target)
        if (score < minimum) continue
        if (!best || score > best.score) best = { record, score }
      }
    }

    return best
  }

  private buildSearchParams(
    target: SearchTarget
  ): Array<Record<string, string>> {
    const attempts: Array<Record<string, string>> = []

    for (const title of buildTitleVariants(target.title).slice(
      0,
      MAX_TITLE_VARIANTS
    )) {
      if (target.artist) {
        attempts.push({ track_name: title, artist_name: target.artist })
      }
    }

    if (target.artist) {
      attempts.push({ q: `${target.artist} ${target.title}` })
    }

    attempts.push({ q: target.rawQuery || target.title })
    attempts.push({ q: target.title })

    return uniqueBy(attempts, (params) => JSON.stringify(params))
  }

  private async searchBestMatch(
    target: SearchTarget,
    opts: LyricsFindOptions = {}
  ): Promise<ScoredRecord | null> {
    let best: ScoredRecord | null = null
    const requireSynced = opts.requireSynced ?? false

    for (const params of this.buildSearchParams(target)) {
      const records = await this.request<LrclibRecord[]>('/search', params)
      if (!Array.isArray(records)) continue

      for (const record of records) {
        if (!record || !this.hasContent(record, requireSynced)) continue

        const score = this.scoreRecord(record, target)
        if (!best || score > best.score) best = { record, score }
      }

      if (best && best.score >= STRONG_MATCH_SCORE) break
    }

    if (!best || best.score < this.minimumScore(target)) return null
    return best
  }
}
