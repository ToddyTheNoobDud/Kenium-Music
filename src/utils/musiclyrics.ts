import { readFile, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// Custom errors
class HttpError extends Error {
  status: number;
  constructor(status: number, message?: string) {
    super(message || `HTTP ${status}`)
    this.name = 'HttpError'
    this.status = status
  }
}

class MxmApiError extends Error {
  code: number;
  hint?: string;
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
const BRACKET_JUNK = /\s*\[([^\]]*(?:official|lyrics?|video|audio|mv|visualizer|color\s*coded|hd|4k)[^\]]*)\]/gi
const SEPARATORS = [' - ', ' – ', ' — ', ' ~ ', '-']

const DEFAULT_HEADERS = Object.freeze({
  accept: 'application/json',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'cookie': 'AWSELB=unknown; x-mxm-user-id=undefined; x-mxm-token-guid=undefined; mxm-encrypted-token='
})

const COOKIE_HEADER = 'AWSELB=unknown; x-mxm-user-id=undefined; x-mxm-token-guid=undefined; mxm-encrypted-token='

interface MusixmatchOptions {
  requestTimeoutMs?: number;
  cacheTTL?: number;
  maxCacheEntries?: number;
  tokenFile?: string;
}

export class Musixmatch {
  tokenData: { value: string; expires: number } | null = null;
  tokenPromise: Promise<string> | null = null;
  lastTokenPersist = 0;
  cache = new Map<string, { value: any; expires: number }>();
  requestTimeoutMs: number;
  cacheTTL: number;
  maxCacheEntries: number;
  tokenFile: string;

  constructor(opts: MusixmatchOptions = {}) {
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 8000
    this.cacheTTL = opts.cacheTTL ?? 300000
    this.maxCacheEntries = Math.max(10, opts.maxCacheEntries ?? 100)
    this.tokenFile = opts.tokenFile ?? path.join(os.tmpdir(), 'mxm_token.json')
  }

  buildUrl(base, params) {
    const url = new URL(base)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value as string)
    }
    return url.toString()
  }

  async readTokenFromFile() {
    try {
      const data = await readFile(this.tokenFile, 'utf-8')
      const parsed = JSON.parse(data)
      if (parsed?.value && typeof parsed.expires === 'number' && parsed.expires > Date.now()) {
        return parsed
      }
    } catch {}
    return null
  }

  async saveTokenToFile(token, expires) {
    try {
      await writeFile(this.tokenFile, JSON.stringify({ value: token, expires }), 'utf-8')
    } catch {}
  }

  async apiGet(url, withCookies = false) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs)

    try {
      const headers = { ...DEFAULT_HEADERS }
      if (withCookies) {
        headers.cookie = COOKIE_HEADER
      }

      const response = await fetch(url, { headers, signal: controller.signal })
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

  async fetchToken(withCookies = true): Promise<string> {
    const url = this.buildUrl(ENDPOINTS.TOKEN, { app_id: APP_ID })
    const body = await this.apiGet(url, withCookies)
    return body.user_token as string
  }

  async resetToken(hard = false) {
    this.tokenData = null
    this.tokenPromise = null
    if (hard) {
      try {
        await unlink(this.tokenFile)
      } catch {}
    }
  }

  async getToken(force = false) {
    const now = Date.now()

    if (!force && this.tokenData && now < this.tokenData.expires) {
      this.tokenData.expires = now + TOKEN_TTL
      if (now - this.lastTokenPersist > TOKEN_PERSIST_INTERVAL) {
        this.lastTokenPersist = now
        this.saveTokenToFile(this.tokenData.value, this.tokenData.expires).catch(() => {})
      }
      return this.tokenData.value
    }

    if (!this.tokenData && !force) {
      this.tokenData = await this.readTokenFromFile()
      if (this.tokenData && now < this.tokenData.expires) return this.tokenData.value
    }

    if (this.tokenPromise) return this.tokenPromise

    this.tokenPromise = this.acquireNewToken()
    try {
      return await this.tokenPromise
    } finally {
      this.tokenPromise = null
    }
  }

  async acquireNewToken() {
    try {
      const token = await this.fetchToken(false)
      const expires = Date.now() + TOKEN_TTL
      this.tokenData = { value: token, expires }
      await this.saveTokenToFile(token, expires)
      return token
    } catch (err) {
      if (err instanceof MxmApiError && (err.code === 401 || err.code === 403)) {
        await this.resetToken(true)
        const token = await this.fetchToken(true)
        const expires = Date.now() + TOKEN_TTL
        this.tokenData = { value: token, expires }
        await this.saveTokenToFile(token, expires)
        return token
      }
      throw err
    }
  }

  async callMxm(endpoint, params) {
    try {
      const token = await this.getToken()
      const url = this.buildUrl(endpoint, { ...params, app_id: APP_ID, usertoken: token })
      return await this.apiGet(url)
    } catch (err) {
      if (err instanceof MxmApiError && (err.code === 401 || err.code === 403)) {
        const isCaptcha = err.hint?.toLowerCase().includes('captcha')
        await this.resetToken(isCaptcha)
        const newToken = await this.getToken(true)
        const url = this.buildUrl(endpoint, { ...params, app_id: APP_ID, usertoken: newToken })
        return await this.apiGet(url)
      }
      throw err
    }
  }

  cleanLyrics(lyrics) {
    const lines = lyrics.replace(TIMESTAMP_REGEX, '').split('\n')
    const cleaned = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed) cleaned.push(trimmed)
    }
    return cleaned.join('\n')
  }

  parseSubtitles(subtitleBody) {
    try {
      const parsed = JSON.parse(subtitleBody)
      const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.subtitle) ? parsed.subtitle : null
      if (!Array.isArray(arr) || arr.length === 0) return null
      return arr.map(item => ({
        range: { start: Math.round((item?.time?.total || 0) * 1000) },
        line: String(item?.text ?? '')
      }))
    } catch {
      return null
    }
  }

  parseQuery(query) {
    const cleaned = query.replace(BRACKET_JUNK, '').trim()
    for (const separator of SEPARATORS) {
      const index = cleaned.indexOf(separator)
      if (index > 0 && index < cleaned.length - separator.length) {
        const artist = cleaned.slice(0, index).trim()
        const title = cleaned.slice(index + separator.length).trim()
        if (artist && title) return { artist, title }
      }
    }
    return { title: cleaned }
  }

  formatResult(subtitles, lyrics, track) {
    const lines = subtitles ? this.parseSubtitles(subtitles) : null
    const text = lyrics ? this.cleanLyrics(lyrics) : lines ? lines.map(l => l.line).join('\n') : null

    return {
      text,
      lines,
      track: {
        title: track?.track_name || '',
        author: track?.artist_name || '',
        albumArt: track?.album_coverart_800x800 || track?.album_coverart_350x350 || track?.album_coverart_100x100
      },
      source: 'Musixmatch'
    }
  }

  cacheKey(artist, title) {
    const normalizedArtist = artist ? artist.toLowerCase().trim() : ''
    const normalizedTitle = title.toLowerCase().trim()
    return `${normalizedArtist}|${normalizedTitle}`
  }

  getCached(key) {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (entry.expires > Date.now()) return entry.value
    this.cache.delete(key)
    return undefined
  }

  setCached(key, value) {
    if (this.cache.size >= this.maxCacheEntries) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) this.cache.delete(firstKey)
    }
    this.cache.set(key, { value, expires: Date.now() + this.cacheTTL })
  }

  async raceForFirst(promises) {
    if (promises.length === 0) return null
    return new Promise(resolve => {
      let completed = 0
      let hasResult = false
      for (const promise of promises) {
        promise.then(result => {
          if (!hasResult && result) {
            hasResult = true
            resolve(result)
          } else if (++completed === promises.length && !hasResult) {
            resolve(null)
          }
        }).catch(() => {
          if (++completed === promises.length && !hasResult) resolve(null)
        })
      }
    })
  }

  async findLyrics(query) {
    const parsed = this.parseQuery(query)
    const key = this.cacheKey(parsed.artist, parsed.title)
    const cached = this.getCached(key)
    if (cached !== undefined) return cached

    let result = null

    try {
      if (parsed.artist) {
        const macroPromise = this.callMxm(ENDPOINTS.ALT_LYRICS, {
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
          return lyrics || subtitles ? this.formatResult(subtitles || null, lyrics || null, track || {}) : null
        })

        const searchPromise = this.callMxm(ENDPOINTS.SEARCH, {
          page_size: '1',
          page: '1',
          s_track_rating: 'desc',
          q_track: parsed.title,
          q_artist: parsed.artist
        }).then(async body => {
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
