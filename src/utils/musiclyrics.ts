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
    this.hint = hint
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
const SEPARATORS = [' - ', ' – ', ' — ', ' ~ ', '-']

const DEFAULT_HEADERS: HeadersInit = Object.freeze({
  accept: 'application/json',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  cookie:
    'AWSELB=unknown; x-mxm-user-id=undefined; x-mxm-token-guid=undefined; mxm-encrypted-token='
})

// Shared helper functions
const _functions = {
  isAuthError(err: unknown): err is MxmApiError {
    return err instanceof MxmApiError && (err.code === 401 || err.code === 403)
  },

  extractMacroCalls(body: any) {
    const calls = body?.macro_calls || {}
    return {
      lyrics: calls['track.lyrics.get']?.message?.body?.lyrics?.lyrics_body as
        | string
        | undefined,
      track: calls['matcher.track.get']?.message?.body?.track,
      subtitles: calls['track.subtitles.get']?.message?.body?.subtitle_list?.[0]
        ?.subtitle?.subtitle_body as string | undefined
    }
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

  async apiGet(url: string): Promise<any> {
    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.requestTimeoutMs
    )

    try {
      const response = await fetch(url, {
        headers: DEFAULT_HEADERS,
        signal: controller.signal
      })
      if (!response.ok) throw new HttpError(response.status)

      const data = await response.json()
      const header = data?.message?.header

      if (header?.status_code !== 200) {
        throw new MxmApiError(header?.status_code ?? 0, header?.hint)
      }

      return data.message.body
    } finally {
      clearTimeout(timeoutId)
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
    await this.saveTokenToFile(token, expires)
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
      if (_functions.isAuthError(err)) {
        await this.resetToken(true)
        return await this.storeToken(await this.fetchToken())
      }
      throw err
    }
  }

  async callMxm(
    endpoint: string,
    params: Record<string, string | undefined>
  ): Promise<any> {
    try {
      const token = await this.getToken()
      const url = this.buildUrl(endpoint, {
        ...params,
        app_id: APP_ID,
        usertoken: token
      })
      return await this.apiGet(url)
    } catch (err) {
      if (_functions.isAuthError(err)) {
        await this.resetToken(err.hint?.toLowerCase().includes('captcha'))
        const newToken = await this.getToken(true)
        const url = this.buildUrl(endpoint, {
          ...params,
          app_id: APP_ID,
          usertoken: newToken
        })
        return await this.apiGet(url)
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

  parseQuery(query: string): { artist?: string; title: string } {
    const cleaned = query.replace(BRACKET_JUNK, '').trim()
    for (const sep of SEPARATORS) {
      const idx = cleaned.indexOf(sep)
      if (idx > 0 && idx < cleaned.length - sep.length) {
        const artist = cleaned.slice(0, idx).trim()
        const title = cleaned.slice(idx + sep.length).trim()
        if (artist && title) return { artist, title }
      }
    }
    return { title: cleaned }
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
    if (entry.expires > Date.now()) return entry.value
    this.cache.delete(key)
    return undefined
  }

  setCached(key: string, value: LyricsResult | null): void {
    if (this.cache.size >= this.maxCacheEntries) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) this.cache.delete(firstKey)
    }
    this.cache.set(key, { value, expires: Date.now() + this.cacheTTL })
  }

  async raceForFirst<T>(promises: Promise<T | null>[]): Promise<T | null> {
    if (!promises.length) return null
    return new Promise((resolve) => {
      let completed = 0
      let resolved = false
      const total = promises.length

      const settle = (result?: T | null) => {
        if (resolved) return ++completed
        if (result) {
          resolved = true
          return resolve(result)
        }
        if (++completed === total) resolve(null)
      }

      for (const p of promises) p.then(settle, () => settle())
    })
  }

  private formatMacroResult(body: any): LyricsResult | null {
    const { lyrics, track, subtitles } = _functions.extractMacroCalls(body)
    return lyrics || subtitles
      ? this.formatResult(subtitles ?? null, lyrics ?? null, track ?? {})
      : null
  }

  async findLyrics(query: string): Promise<LyricsResult | null> {
    const parsed = this.parseQuery(query)
    const key = this.cacheKey(parsed.artist, parsed.title)
    const cached = this.getCached(key)
    if (cached !== undefined) return cached

    let result: LyricsResult | null = null

    try {
      if (parsed.artist) {
        const macroPromise = this.callMxm(ENDPOINTS.ALT_LYRICS, {
          format: 'json',
          namespace: 'lyrics_richsynched',
          subtitle_format: 'mxm',
          q_artist: parsed.artist,
          q_track: parsed.title
        }).then((body) => this.formatMacroResult(body))

        const searchPromise = this.callMxm(ENDPOINTS.SEARCH, {
          page_size: '1',
          page: '1',
          s_track_rating: 'desc',
          q_track: parsed.title,
          q_artist: parsed.artist
        }).then(async (body) => {
          const track = body?.track_list?.[0]?.track
          if (!track) return null
          const lyricsBody = await this.callMxm(ENDPOINTS.LYRICS, {
            subtitle_format: 'mxm',
            track_id: String(track.track_id)
          })
          const subtitles = lyricsBody?.subtitle?.subtitle_body
          return subtitles ? this.formatResult(subtitles, null, track) : null
        })

        result = await this.raceForFirst([macroPromise, searchPromise])
      } else {
        const searchBody = await this.callMxm(ENDPOINTS.SEARCH, {
          page_size: '1',
          page: '1',
          s_track_rating: 'desc',
          q_track: parsed.title
        })
        const track = searchBody?.track_list?.[0]?.track
        if (track) {
          const lyricsBody = await this.callMxm(ENDPOINTS.LYRICS, {
            subtitle_format: 'mxm',
            track_id: String(track.track_id)
          })
          const subtitles = lyricsBody?.subtitle?.subtitle_body
          if (subtitles) result = this.formatResult(subtitles, null, track)
        }
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
