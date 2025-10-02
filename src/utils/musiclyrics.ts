import { readFile, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

interface LyricsData {
  text: string | null
  lines: { range: { start: number }; line: string }[] | null
  track: { title: string; author: string; albumArt?: string }
  source: string
}

class HttpError extends Error {
  constructor(public status: number, message?: string) {
    super(message || `HTTP ${status}`)
    this.name = 'HttpError'
  }
}

class MxmApiError extends Error {
  constructor(public code: number, public hint?: string) {
    super(hint || `Musixmatch API error ${code}`)
    this.name = 'MxmApiError'
  }
}

let defaultFetch: typeof globalThis.fetch | null = null
let cookieFetch: typeof globalThis.fetch | null = null

const getFetch = async (withCookies = true): Promise<typeof globalThis.fetch> => {
  if (withCookies) {
    if (!cookieFetch) {
      const fetchCookie = await import('fetch-cookie').then(m => m.default || m)
      if (typeof fetchCookie !== 'function') {
        throw new Error('Invalid fetch-cookie export')
      }
      // fetch-cookie returns a wrapper that doesn't include some environment-specific
      // properties (like Bun's `preconnect`), so cast it to the global fetch type.
      cookieFetch = fetchCookie(globalThis.fetch) as unknown as typeof globalThis.fetch
    }
    return cookieFetch
  }

  if (!defaultFetch) {
    if (typeof globalThis.fetch === 'function') {
      defaultFetch = globalThis.fetch
    } else {
      throw new Error('No global fetch available')
    }
  }

  return defaultFetch
}

const resetCookieFetch = (): void => {
  cookieFetch = null
}

export class Musixmatch {
  private readonly APP_ID = 'web-desktop-app-v1.0'

  private static readonly ENDPOINTS = {
    TOKEN: 'https://apic-desktop.musixmatch.com/ws/1.1/token.get',
    SEARCH: 'https://apic-desktop.musixmatch.com/ws/1.1/track.search',
    LYRICS: 'https://apic-desktop.musixmatch.com/ws/1.1/track.subtitle.get',
    ALT_LYRICS: 'https://apic-desktop.musixmatch.com/ws/1.1/macro.subtitles.get'
  } as const

  // Compiled regex patterns for better performance
  private static readonly TIMESTAMP_REGEX = /\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g
  private static readonly BRACKET_JUNK = /\s*\[([^\]]*(?:official|lyrics?|video|audio|mv|visualizer|color\s*coded|hd|4k)[^\]]*)\]/gi
  private static readonly SEPARATORS = [' - ', ' – ', ' — ', ' ~ ', '-']

  private tokenData: { value: string; expires: number } | null = null
  private tokenPromise: Promise<string> | null = null
  private readonly TOKEN_TTL = 55000
  private readonly tokenFile: string
  private lastTokenPersist = 0
  private readonly TOKEN_PERSIST_INTERVAL = 5000
  private readonly requestTimeoutMs: number
  private readonly defaultHeaders: HeadersInit
  private readonly cache = new Map<string, { value: LyricsData | null; expires: number }>()
  private readonly cacheTTL: number
  private readonly maxCacheEntries: number

  constructor(opts?: {
    requestTimeoutMs?: number
    cacheTTL?: number
    maxCacheEntries?: number
    tokenFile?: string
  }) {
    this.requestTimeoutMs = opts?.requestTimeoutMs ?? 8000
    this.cacheTTL = opts?.cacheTTL ?? 300000
    this.maxCacheEntries = Math.max(10, opts?.maxCacheEntries ?? 100)
    this.tokenFile = opts?.tokenFile ?? path.join(os.tmpdir(), 'mxm_token.json')

    this.defaultHeaders = Object.freeze({
      accept: 'application/json',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    })
  }

  private buildUrl(base: string, params: Record<string, string | undefined>): string {
    const url = new URL(base)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value)
    }
    return url.toString()
  }

  private async readTokenFromFile(): Promise<{ value: string; expires: number } | null> {
    try {
      const data = await readFile(this.tokenFile, 'utf-8')
      const parsed = JSON.parse(data)

      if (parsed?.value &&
          typeof parsed.expires === 'number' &&
          parsed.expires > Date.now()) {
        return parsed
      }
    } catch {}

    return null
  }

  private async saveTokenToFile(token: string, expires: number): Promise<void> {
    try {
      await writeFile(
        this.tokenFile,
        JSON.stringify({ value: token, expires }),
        'utf-8'
      )
    } catch {}
  }

  private async apiGet(url: string): Promise<any> {
    const fetch = await getFetch(true)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs)

    try {
      const response = await fetch(url, {
        headers: this.defaultHeaders,
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

  private async fetchToken(withCookies = true): Promise<string> {
    const url = this.buildUrl(Musixmatch.ENDPOINTS.TOKEN, { app_id: this.APP_ID })
    const body = await this.apiGet(url)
    return body.user_token
  }

  private async resetToken(hard = false): Promise<void> {
    this.tokenData = null
    this.tokenPromise = null

    if (hard) {
      try {
        await unlink(this.tokenFile)
      } catch {}
    }
  }

  private async getToken(force = false): Promise<string> {
    const now = Date.now()

    if (!force && this.tokenData && now < this.tokenData.expires) {
      this.tokenData.expires = now + this.TOKEN_TTL

      if (now - this.lastTokenPersist > this.TOKEN_PERSIST_INTERVAL) {
        this.lastTokenPersist = now
        this.saveTokenToFile(this.tokenData.value, this.tokenData.expires).catch(() => {})
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

  private async acquireNewToken(): Promise<string> {
    try {
      const token = await this.fetchToken(false)
      const expires = Date.now() + this.TOKEN_TTL
      this.tokenData = { value: token, expires }
      await this.saveTokenToFile(token, expires)
      return token
    } catch (err: any) {
      if (err instanceof MxmApiError && (err.code === 401 || err.code === 403)) {
        await this.resetToken(true)
        resetCookieFetch()

        const token = await this.fetchToken(true)
        const expires = Date.now() + this.TOKEN_TTL
        this.tokenData = { value: token, expires }
        await this.saveTokenToFile(token, expires)
        return token
      }
      throw err
    }
  }

  private async callMxm<T>(
    endpoint: string,
    params: Record<string, string | undefined>
  ): Promise<T> {
    try {
      const token = await this.getToken()
      const url = this.buildUrl(endpoint, {
        ...params,
        app_id: this.APP_ID,
        usertoken: token
      })
      return await this.apiGet(url)
    } catch (err: any) {
      if (err instanceof MxmApiError && (err.code === 401 || err.code === 403)) {
        const isCaptcha = err.hint?.toLowerCase().includes('captcha')
        await this.resetToken(isCaptcha)

        if (isCaptcha) resetCookieFetch()

        const newToken = await this.getToken(true)
        const url = this.buildUrl(endpoint, {
          ...params,
          app_id: this.APP_ID,
          usertoken: newToken
        })
        return await this.apiGet(url)
      }
      throw err
    }
  }

  private cleanLyrics(lyrics: string): string {
    const lines = lyrics.replace(Musixmatch.TIMESTAMP_REGEX, '').split('\n')
    const cleaned: string[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed) cleaned.push(trimmed)
    }

    return cleaned.join('\n')
  }

  private parseSubtitles(
    subtitleBody: string
  ): { range: { start: number }; line: string }[] | null {
    try {
      const parsed = JSON.parse(subtitleBody)
      const arr = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.subtitle)
          ? parsed.subtitle
          : null

      if (!Array.isArray(arr) || arr.length === 0) return null

      return arr.map(item => ({
        range: { start: Math.round((item?.time?.total || 0) * 1000) },
        line: String(item?.text ?? '')
      }))
    } catch {
      return null
    }
  }

  private parseQuery(query: string): { artist?: string; title: string } {
    const cleaned = query.replace(Musixmatch.BRACKET_JUNK, '').trim()

    // Try separators first (more specific)
    for (const separator of Musixmatch.SEPARATORS) {
      const index = cleaned.indexOf(separator)

      if (index > 0 && index < cleaned.length - separator.length) {
        const artist = cleaned.slice(0, index).trim()
        const title = cleaned.slice(index + separator.length).trim()

        if (artist && title) return { artist, title }
      }
    }

    return { title: cleaned }
  }

  private formatResult(
    subtitles: string | null,
    lyrics: string | null,
    track: any
  ): LyricsData {
    const lines = subtitles ? this.parseSubtitles(subtitles) : null
    const text = lyrics
      ? this.cleanLyrics(lyrics)
      : lines
        ? lines.map(l => l.line).join('\n')
        : null

    return {
      text,
      lines,
      track: {
        title: track?.track_name || '',
        author: track?.artist_name || '',
        albumArt: track?.album_coverart_800x800 ||
                  track?.album_coverart_350x350 ||
                  track?.album_coverart_100x100
      },
      source: 'Musixmatch'
    }
  }

  private cacheKey(artist: string | undefined, title: string): string {
    const normalizedArtist = artist ? artist.toLowerCase().trim() : ''
    const normalizedTitle = title.toLowerCase().trim()
    return `${normalizedArtist}|${normalizedTitle}`
  }

  private getCached(key: string): LyricsData | null | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined

    if (entry.expires > Date.now()) return entry.value

    this.cache.delete(key)
    return undefined
  }

  private setCached(key: string, value: LyricsData | null): void {
    if (this.cache.size >= this.maxCacheEntries) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) this.cache.delete(firstKey)
    }

    this.cache.set(key, { value, expires: Date.now() + this.cacheTTL })
  }

  private async raceForFirst<T>(promises: Promise<T | null>[]): Promise<T | null> {
    if (promises.length === 0) return null

    return new Promise(resolve => {
      let completed = 0
      let hasResult = false

      for (const promise of promises) {
        promise
          .then(result => {
            if (!hasResult && result) {
              hasResult = true
              resolve(result)
            } else if (++completed === promises.length && !hasResult) {
              resolve(null)
            }
          })
          .catch(() => {
            if (++completed === promises.length && !hasResult) {
              resolve(null)
            }
          })
      }
    })
  }

  public async findLyrics(query: string): Promise<LyricsData | null> {
    const parsed = this.parseQuery(query)
    const key = this.cacheKey(parsed.artist, parsed.title)
    const cached = this.getCached(key)

    if (cached !== undefined) return cached

    let result: LyricsData | null = null

    try {
      if (parsed.artist) {
        const macroPromise = this.callMxm<any>(Musixmatch.ENDPOINTS.ALT_LYRICS, {
          format: 'json',
          namespace: 'lyrics_richsynched',
          subtitle_format: 'mxm',
          q_artist: parsed.artist,
          q_track: parsed.title
        }).then(body => {
          const calls = body?.macro_calls || {}
          const lyrics = calls['track.lyrics.get']?.message?.body?.lyrics?.lyrics_body
          const track = calls['matcher.track.get']?.message?.body?.track
          const subtitles = calls['track.subtitles.get']?.message?.body?.subtitle_list?.[0]?.subtitle?.subtitle_body

          return lyrics || subtitles
            ? this.formatResult(subtitles || null, lyrics || null, track || {})
            : null
        })

        const searchPromise = this.callMxm<any>(Musixmatch.ENDPOINTS.SEARCH, {
          page_size: '1',
          page: '1',
          s_track_rating: 'desc',
          q_track: parsed.title,
          q_artist: parsed.artist
        }).then(async body => {
          const track = body?.track_list?.[0]?.track
          if (!track) return null

          const lyricsBody = await this.callMxm<any>(Musixmatch.ENDPOINTS.LYRICS, {
            subtitle_format: 'mxm',
            track_id: String(track.track_id)
          })

          const subtitles = lyricsBody?.subtitle?.subtitle_body
          return subtitles ? this.formatResult(subtitles, null, track) : null
        })

        result = await this.raceForFirst([macroPromise, searchPromise])
      } else {
        const searchBody = await this.callMxm<any>(Musixmatch.ENDPOINTS.SEARCH, {
          page_size: '1',
          page: '1',
          s_track_rating: 'desc',
          q_track: parsed.title
        })

        const track = searchBody?.track_list?.[0]?.track

        if (track) {
          const lyricsBody = await this.callMxm<any>(Musixmatch.ENDPOINTS.LYRICS, {
            subtitle_format: 'mxm',
            track_id: String(track.track_id)
          })

          const subtitles = lyricsBody?.subtitle?.subtitle_body
          if (subtitles) result = this.formatResult(subtitles, null, track)
        }
      }

      if (!result) {
        const fallbackBody = await this.callMxm<any>(Musixmatch.ENDPOINTS.ALT_LYRICS, {
          format: 'json',
          namespace: 'lyrics_richsynched',
          subtitle_format: 'mxm',
          q_track: parsed.title
        })

        const calls = fallbackBody?.macro_calls || {}
        const lyrics = calls['track.lyrics.get']?.message?.body?.lyrics?.lyrics_body
        const track = calls['matcher.track.get']?.message?.body?.track
        const subtitles = calls['track.subtitles.get']?.message?.body?.subtitle_list?.[0]?.subtitle?.subtitle_body

        if (lyrics || subtitles) {
          result = this.formatResult(subtitles || null, lyrics || null, track || {})
        }
      }
    } catch {
      result = null
    }

    this.setCached(key, result)
    return result
  }
}