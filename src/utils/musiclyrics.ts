import { readFile, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// Custom errors
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

// Constants
const APP_ID = 'web-desktop-app-v1.0'
const TOKEN_TTL = 55000
const TOKEN_PERSIST_INTERVAL = 5000

const ENDPOINTS = Object.freeze({
  TOKEN: 'https://apic-desktop.musixmatch.com/ws/1.1/token.get',
  SEARCH: 'https://apic-desktop.musixmatch.com/ws/1.1/track.search',
  LYRICS: 'https://apic-desktop.musixmatch.com/ws/1.1/track.subtitle.get',
  ALT_LYRICS: 'https://apic-desktop.musixmatch.com/ws/1.1/macro.subtitles.get'
})

const TIMESTAMP_REGEX = /\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g
const BRACKET_JUNK =
  /\s*\[([^\]]*(?:official|lyrics?|video|audio|mv|visualizer|color\s*coded|hd|4k)[^\]]*)\]/gi

const DEFAULT_HEADERS: Record<string, string> = Object.freeze({
  accept: 'application/json',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  cookie:
    'AWSELB=unknown; x-mxm-user-id=undefined; x-mxm-token-guid=undefined; mxm-encrypted-token='
})

const isAuthError = (err: unknown): err is MxmApiError =>
  err instanceof MxmApiError && (err.code === 401 || err.code === 403)

const extractMacroCalls = (body: any) => {
  const calls = body?.macro_calls
  return {
    lyrics: calls?.['track.lyrics.get']?.message?.body?.lyrics?.lyrics_body as
      | string
      | undefined,
    track: calls?.['matcher.track.get']?.message?.body?.track as any,
    subtitles: calls?.['track.subtitles.get']?.message?.body?.subtitle_list?.[0]
      ?.subtitle?.subtitle_body as string | undefined
  }
}

interface MusixmatchOptions {
  requestTimeoutMs?: number
  cacheTTL?: number
  maxCacheEntries?: number
  tokenFile?: string
}

interface TokenData {
  value: string
  expires: number
}

interface CacheEntry<T> {
  value: T
  expires: number
}

interface LyricsLine {
  range: { start: number }
  line: string
}

interface LyricsResult {
  text: string | null
  lines: LyricsLine[] | null
  track: { title: string; author: string; albumArt?: string }
  source: string
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

  constructor(opts: MusixmatchOptions = {}) {
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 8000
    this.cacheTTL = opts.cacheTTL ?? 300000
    this.maxCacheEntries = Math.max(10, opts.maxCacheEntries ?? 100)
    this.tokenFile = opts.tokenFile ?? path.join(os.tmpdir(), 'mxm_token.json')
  }

  buildUrl(base: string, params: Record<string, string | undefined>): string {
    const url = new URL(base)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value)
    }
    return url.toString()
  }

  async readTokenFromFile(): Promise<TokenData | null> {
    try {
      const data = await readFile(this.tokenFile, 'utf-8')
      const parsed = JSON.parse(data)
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

  async apiGet(url: string, externalSignal?: AbortSignal): Promise<any> {
    externalSignal?.throwIfAborted?.()

    const controller = new AbortController()
    const onExternalAbort = () => controller.abort()
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true })

    const timeoutId = setTimeout(
      () => controller.abort(),
      this.requestTimeoutMs
    )
    ;(timeoutId as any).unref?.()

    try {
      const response = await fetch(url, {
        headers: DEFAULT_HEADERS,
        signal: controller.signal
      })
      if (!response.ok) throw new HttpError(response.status)

      const data = (await response.json()) as any
      const header = data?.message?.header
      if (header?.status_code !== 200)
        throw new MxmApiError(header?.status_code ?? 0, header?.hint)

      return data.message.body
    } finally {
      clearTimeout(timeoutId)
      externalSignal?.removeEventListener('abort', onExternalAbort)
    }
  }

  async fetchToken(): Promise<string> {
    const url = this.buildUrl(ENDPOINTS.TOKEN, { app_id: APP_ID })
    const body = await this.apiGet(url)
    return body.user_token
  }

  async resetToken(hard = false): Promise<void> {
    this.tokenData = null
    this.tokenPromise = null
    if (hard) {
      try {
        await unlink(this.tokenFile)
      } catch {}
    }
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
      if (this.tokenData && now < this.tokenData.expires)
        return this.tokenData.value
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
    } catch (err) {
      if (isAuthError(err)) {
        await this.resetToken(true)
        return await this.storeToken(await this.fetchToken())
      }
      throw err
    }
  }

  async callMxm(
    endpoint: string,
    params: Record<string, string | undefined>,
    signal?: AbortSignal
  ): Promise<any> {
    try {
      const token = await this.getToken()
      const url = this.buildUrl(endpoint, {
        ...params,
        app_id: APP_ID,
        usertoken: token
      })
      return await this.apiGet(url, signal)
    } catch (err) {
      if (isAuthError(err)) {
        if (signal?.aborted) throw err
        await this.resetToken(err.hint?.toLowerCase().includes('captcha'))
        const newToken = await this.getToken(true)
        const url = this.buildUrl(endpoint, {
          ...params,
          app_id: APP_ID,
          usertoken: newToken
        })
        return await this.apiGet(url, signal)
      }
      throw err
    }
  }

  cleanLyrics(lyrics: string): string {
    const lines = lyrics.replace(TIMESTAMP_REGEX, '').split('\n')
    const cleaned: string[] = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed) cleaned.push(trimmed)
    }
    return cleaned.join('\n')
  }

  parseSubtitles(subtitleBody: string): LyricsLine[] | null {
    try {
      const parsed = JSON.parse(subtitleBody)
      const arr = Array.isArray(parsed) ? parsed : parsed?.subtitle
      if (!Array.isArray(arr) || !arr.length) return null
      return arr.map((item) => ({
        range: { start: Math.round((item?.time?.total || 0) * 1000) },
        line: String(item?.text ?? '')
      }))
    } catch {
      return null
    }
  }

  private norm(s: string): string {
    return s.replace(/\s+/g, ' ').trim()
  }

  private stripFeaturing(s: string): string {
    const lower = s.toLowerCase()
    let cut = -1
    for (const m of [' feat.', ' ft.', ' featuring ']) {
      const i = lower.indexOf(m)
      if (i !== -1 && (cut === -1 || i < cut)) cut = i
    }
    return (cut === -1 ? s : s.slice(0, cut)).trim()
  }

  private stripTrailingParensJunk(s: string): string {
    for (;;) {
      s = s.trim()
      if (!s.endsWith(')')) return s
      const open = s.lastIndexOf('(')
      if (open === -1) return s
      const inside = s.slice(open + 1, -1).toLowerCase()
      if (
        inside.includes('official') ||
        inside.includes('lyrics') ||
        inside.includes('video') ||
        inside.includes('audio') ||
        inside.includes('mv') ||
        inside.includes('visualizer') ||
        inside.includes('hd') ||
        inside.includes('4k')
      ) {
        s = s.slice(0, open)
        continue
      }
      return s
    }
  }

  parseQuery(query: string): { artist?: string; title: string } {
    let cleaned = this.norm(query.replace(BRACKET_JUNK, ''))
    cleaned = this.stripTrailingParensJunk(cleaned)

    if (
      (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))
    ) {
      cleaned = cleaned.slice(1, -1).trim()
    }

    const splitBy = (sep: string) => {
      const idx = cleaned.indexOf(sep)
      if (idx <= 0 || idx >= cleaned.length - sep.length) return null
      const artist = cleaned.slice(0, idx).trim()
      const title = cleaned.slice(idx + sep.length).trim()
      return artist && title ? { artist, title } : null
    }

    let parts =
      splitBy(' - ') || splitBy(' – ') || splitBy(' — ') || splitBy(' ~ ')

    if (!parts) {
      for (const ch of ['–', '—', '~', '-'] as const) {
        const idx = cleaned.indexOf(ch)
        if (idx <= 0 || idx >= cleaned.length - 1) continue
        if (ch === '-' && cleaned[idx - 1] !== ' ' && cleaned[idx + 1] !== ' ')
          continue
        const artist = cleaned.slice(0, idx).trim()
        const title = cleaned.slice(idx + 1).trim()
        if (artist && title) {
          parts = { artist, title }
          break
        }
      }
    }

    if (!parts && !cleaned.includes(' ')) {
      const idx = cleaned.indexOf('-')
      if (
        idx > 0 &&
        idx === cleaned.lastIndexOf('-') &&
        idx < cleaned.length - 1
      )
        parts = { artist: cleaned.slice(0, idx), title: cleaned.slice(idx + 1) }
    }

    const artist = parts?.artist
      ? this.stripFeaturing(
          this.stripTrailingParensJunk(this.norm(parts.artist))
        )
      : undefined
    const title = this.stripFeaturing(
      this.stripTrailingParensJunk(this.norm(parts?.title ?? cleaned))
    )

    return artist ? { artist, title } : { title }
  }

  formatResult(
    subtitles: string | null,
    lyrics: string | null,
    track: any
  ): LyricsResult {
    const lines = subtitles ? this.parseSubtitles(subtitles) : null
    const text = lyrics
      ? this.cleanLyrics(lyrics)
      : (lines?.map((l) => l.line).join('\n') ?? null)

    return {
      text,
      lines,
      track: {
        title: track?.track_name || '',
        author: track?.artist_name || '',
        albumArt:
          track?.album_coverart_800x800 ||
          track?.album_coverart_350x350 ||
          track?.album_coverart_100x100
      },
      source: 'Musixmatch'
    }
  }

  cacheKey(artist: string | undefined, title: string): string {
    return `${(artist || '').toLowerCase().trim()}|${title.toLowerCase().trim()}`
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
    for (const [k, v] of this.cache) if (v.expires <= now) this.cache.delete(k)

    while (this.cache.size >= this.maxCacheEntries) {
      const firstKey = this.cache.keys().next().value as string | undefined
      if (!firstKey) break
      this.cache.delete(firstKey)
    }
    this.cache.set(key, { value, expires: now + this.cacheTTL })
  }

  async raceForFirst<T>(
    factories: Array<(signal: AbortSignal) => Promise<T | null>>
  ): Promise<T | null> {
    if (!factories.length) return null
    const controller = new AbortController()
    const promises = factories.map((fn) => fn(controller.signal))

    return await new Promise((resolve) => {
      let pending = promises.length
      let done = false

      const settle = (result: T | null) => {
        if (done) return
        if (result !== null) {
          done = true
          controller.abort()
          resolve(result)
        } else if (--pending === 0) {
          resolve(null)
        }
      }

      for (const p of promises) p.then(settle, () => settle(null))
    })
  }

  private formatMacroResult(body: any): LyricsResult | null {
    const { lyrics, track, subtitles } = extractMacroCalls(body)
    return lyrics || subtitles
      ? this.formatResult(subtitles ?? null, lyrics ?? null, track ?? {})
      : null
  }

  private async searchSubtitles(
    title: string,
    artist: string | undefined,
    signal?: AbortSignal
  ): Promise<LyricsResult | null> {
    const body = await this.callMxm(
      ENDPOINTS.SEARCH,
      {
        page_size: artist ? '3' : '5',
        page: '1',
        s_track_rating: 'desc',
        f_has_subtitle: '1',
        q_track: title,
        q_artist: artist,
        q_track_artist: artist ? `${artist} ${title}` : undefined
      },
      signal
    )

    const list = body?.track_list
    if (!Array.isArray(list) || !list.length) return null

    for (const item of list) {
      const track = item?.track
      const id = track?.track_id
      if (!id) continue
      try {
        const lyricsBody = await this.callMxm(
          ENDPOINTS.LYRICS,
          { subtitle_format: 'mxm', track_id: String(id) },
          signal
        )
        const subtitles = lyricsBody?.subtitle?.subtitle_body
        if (subtitles) return this.formatResult(subtitles, null, track)
      } catch (e) {
        if (signal?.aborted) throw e
      }
    }
    return null
  }

  async findLyrics(query: string): Promise<LyricsResult | null> {
    const parsed = this.parseQuery(query)
    const key = this.cacheKey(parsed.artist, parsed.title)
    const cached = this.getCached(key)
    if (cached !== undefined) return cached

    let result: LyricsResult | null = null

    try {
      if (parsed.artist) {
        result = await this.raceForFirst([
          (signal) =>
            this.callMxm(
              ENDPOINTS.ALT_LYRICS,
              {
                format: 'json',
                namespace: 'lyrics_richsynched',
                subtitle_format: 'mxm',
                q_artist: parsed.artist,
                q_track: parsed.title
              },
              signal
            ).then((body) => this.formatMacroResult(body)),

          (signal) => this.searchSubtitles(parsed.title, parsed.artist, signal)
        ])
      } else {
        result = await this.searchSubtitles(parsed.title, undefined)
      }

      if (!result) {
        const fallbackBody = await this.callMxm(ENDPOINTS.ALT_LYRICS, {
          format: 'json',
          namespace: 'lyrics_richsynched',
          subtitle_format: 'mxm',
          q_track: parsed.title
        })
        result = this.formatMacroResult(fallbackBody)
      }
    } catch {
      result = null
    }

    this.setCached(key, result)
    return result
  }
}
