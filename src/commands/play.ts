import {
  Command,
  type CommandContext,
  createStringOption,
  Declare,
  Embed,
  Middlewares,
  Options
} from 'seyfert'
import type { OptionsRecord } from 'seyfert/lib/commands/applications/chat'
import { LRU } from 'tiny-lru'
import type { PlayerLike, TrackLike, UserLike } from '../shared/helperTypes'
import { ensurePlayerForVoice, maybeStartPlayback } from '../shared/playback'
import { getContextLanguage } from '../utils/i18n'
import {
  getErrorCode,
  isInteractionExpired,
  safeDefer
} from '../utils/interactions'

const RECENT_CACHE_SIZE = 8
const USER_CACHE_LIMIT = 150
const SEARCH_CACHE_SIZE = 96
const MAX_AUTOCOMPLETE_RESULTS = 4
const THROTTLE_INTERVAL_MS = 250
const SEARCH_TTL_MS = 25_000
const EMBED_COLOR = 0x100e09
const MAX_DEBOUNCE_ENTRIES = 500
const MIN_QUERY_LENGTH = 2
const MAX_TITLE_LENGTH = 70
const MAX_AUTHOR_LENGTH = 18
const MAX_CHOICE_LENGTH = 98
const MAX_URI_LENGTH = 98
const AUTOCOMPLETE_DEBOUNCE_MS = 200

type TrackInfo = { title: string; uri: string }

type SearchResult = TrackLike

type PlayAutocompleteInteractionLike = {
  user: UserLike
  client: CommandContext['client']
  getInput?: () => unknown
  respond: (
    choices: Array<{ name: string; value: string }>
  ) => Promise<unknown> | unknown
}

type ResolveResponseLike = {
  loadType?: string
  tracks?: SearchResult[]
  playlistInfo?: {
    name?: string
    thumbnail?: string | null
  }
}

type PlayTextLike = {
  player?: {
    noVoiceChannel?: string
    noTracksFound?: string
    trackAdded?: string
    playlistAdded?: string
  }
  errors?: {
    unsupportedContentType?: string
    general?: string
  }
}

const _functions = {
  isUrl(query: unknown): boolean {
    const s = String(query ?? '')
      .trim()
      .toLowerCase()
    return s.startsWith('http://') || s.startsWith('https://')
  },

  truncate(text: unknown, maxLength: number): string {
    const s = String(text ?? '')
    return s.length <= maxLength ? s : `${s.slice(0, maxLength - 1)}…`
  },

  formatChoice(title: unknown, author?: unknown): string {
    const t = _functions.truncate(title, MAX_TITLE_LENGTH)
    const a = author
      ? ` - ${_functions.truncate(author, MAX_AUTHOR_LENGTH)}`
      : ''
    return _functions.truncate(t + a, MAX_CHOICE_LENGTH)
  },

  cacheKey(query: string): string {
    return query.toLowerCase().slice(0, 60)
  },

  safeUnref(timer: { unref?: () => void } | null | undefined): void {
    try {
      timer?.unref?.()
    } catch {}
  },

  bindProcessCleanupOnce(cleanup: () => void): void {
    const sym = Symbol.for('play.autocomplete.cleanup.bound')
    const g = globalThis as typeof globalThis &
      Record<symbol, boolean | undefined>
    if (g[sym]) return
    g[sym] = true

    process.once('exit', cleanup)
    process.once('SIGINT', cleanup)
    process.once('SIGTERM', cleanup)
  },

  addRecentFromTrack(userId: string, track: TrackLike): void {
    const info = track?.info
    if (info?.uri && info?.title) recentTracks.add(userId, info.title, info.uri)
  },

  async processAutocomplete(
    interaction: PlayAutocompleteInteractionLike,
    userId: string,
    query: string
  ): Promise<unknown> {
    if (!query || query.length < MIN_QUERY_LENGTH) {
      const recent = recentTracks.getRecent(userId, MAX_AUTOCOMPLETE_RESULTS)
      if (!recent.length) return interaction.respond([])

      const choices = recent.map((track, index) => ({
        name: `🕘 Recent ${index + 1}: ${_functions.truncate(track.title, MAX_TITLE_LENGTH)}`,
        value: track.uri.slice(0, MAX_URI_LENGTH)
      }))
      return interaction.respond(choices)
    }

    if (_functions.isUrl(query)) return interaction.respond([])

    const key = _functions.cacheKey(query)
    let results = searchCache.get(key)

    if (!results) {
      const res = (await interaction.client.aqua.resolve({
        query,
        requester: interaction.user
      })) as ResolveResponseLike | SearchResult[]
      results = Array.isArray(res)
        ? res
        : Array.isArray(res?.tracks)
          ? res.tracks
          : []
      if (results?.length) {
        searchCache.set(key, results)
        for (const r of results) {
          const uri = (r as any)?.info?.uri
          if (uri) uriToTrackCache.set(String(uri), r)
        }
      }
    }

    if (!results || !results.length) return interaction.respond([])

    const choices: Array<{ name: string; value: string }> = []
    for (
      let i = 0;
      i < results.length && choices.length < MAX_AUTOCOMPLETE_RESULTS;
      i++
    ) {
      const item = results[i]
      const info = item?.info || item
      const uri = info?.uri
      if (!uri) continue
      choices.push({
        name: _functions.formatChoice(info.title || 'Unknown', info.author),
        value: String(uri).slice(0, MAX_URI_LENGTH)
      })
    }

    return interaction.respond(choices)
  }
}

class OptimizedRecentTracks {
  private userCaches = new Map<string, LRU<TrackInfo>>()
  private readonly maxUsers: number
  private readonly cacheSize: number

  constructor(maxUsers = USER_CACHE_LIMIT, cacheSize = RECENT_CACHE_SIZE) {
    this.maxUsers = maxUsers
    this.cacheSize = cacheSize
  }

  add(userId: string, title: string, uri: string): void {
    if (!uri) return

    let userCache = this.userCaches.get(userId)
    if (!userCache) {
      if (this.userCaches.size >= this.maxUsers) {
        const firstKey = this.userCaches.keys().next().value
        if (firstKey) this.userCaches.delete(firstKey)
      }
      userCache = new LRU<TrackInfo>(this.cacheSize)
      this.userCaches.set(userId, userCache)
    }

    userCache.set(uri, { title, uri })
  }

  getRecent(userId: string, limit: number): TrackInfo[] {
    const userCache = this.userCaches.get(userId)
    if (!userCache) return []

    const max = Math.max(0, Math.min(limit, userCache.size))
    return [...userCache.entries()]
      .reverse()
      .slice(0, max)
      .map(([, v]) => v)
  }
}

class ThrottleMap {
  private timestamps = new Map<string, number>()
  private cleanupCounter = 0
  private readonly cleanupThreshold = 200
  private readonly retentionMs = 45_000

  shouldThrottle(userId: string, intervalMs = THROTTLE_INTERVAL_MS): boolean {
    const now = Date.now()
    const last = this.timestamps.get(userId) ?? 0
    if (now - last < intervalMs) return true

    this.timestamps.set(userId, now)
    if (++this.cleanupCounter >= this.cleanupThreshold) {
      this.cleanupCounter = 0
      const threshold = now - this.retentionMs
      for (const [key, ts] of this.timestamps)
        if (ts < threshold) this.timestamps.delete(key)
    }
    return false
  }
}

const searchCache = new LRU<SearchResult[]>(SEARCH_CACHE_SIZE, SEARCH_TTL_MS)
const uriToTrackCache = new LRU<SearchResult>(SEARCH_CACHE_SIZE, SEARCH_TTL_MS)
const recentTracks = new OptimizedRecentTracks()
const throttleMap = new ThrottleMap()
const debounceTimers = new Map<
  string,
  { timer: NodeJS.Timeout; resolve: (value?: unknown) => void }
>()

const _cleanupTimers = (): void => {
  for (const entry of debounceTimers.values()) clearTimeout(entry.timer)
  debounceTimers.clear()
  searchCache.clear()
  uriToTrackCache.clear()
}
_functions.bindProcessCleanupOnce(_cleanupTimers)

const _handleAutocomplete = async (
  interaction: PlayAutocompleteInteractionLike
): Promise<unknown> => {
  const userId = interaction.user.id
  const query = String(interaction.getInput?.() ?? '').trim()

  const prev = debounceTimers.get(userId)
  if (prev) {
    clearTimeout(prev.timer)
    prev.resolve()
    debounceTimers.delete(userId)
  }

  if (throttleMap.shouldThrottle(userId)) return interaction.respond([])

  return new Promise<unknown>((resolve) => {
    const timer = setTimeout(() => {
      debounceTimers.delete(userId)
      _functions
        .processAutocomplete(interaction, userId, query)
        .then(resolve)
        .catch(() => resolve(interaction.respond([])))
    }, AUTOCOMPLETE_DEBOUNCE_MS)

    _functions.safeUnref(timer)

    if (debounceTimers.size >= MAX_DEBOUNCE_ENTRIES) {
      const firstKey = debounceTimers.keys().next().value
      if (firstKey) {
        const evicted = debounceTimers.get(firstKey)
        if (evicted) {
          clearTimeout(evicted.timer)
          evicted.resolve()
        }
        debounceTimers.delete(firstKey)
      }
    }
    debounceTimers.set(userId, { timer, resolve })
  })
}

const options = {
  query: createStringOption({
    description: 'The song you want to search for',
    required: true,
    autocomplete: _handleAutocomplete
  })
}

@Declare({ name: 'play', description: 'Play a song by search query or URL.' })
@Options(options as unknown as OptionsRecord)
@Middlewares(['checkVoice'])
export default class Play extends Command {
  public override async run(ctx: CommandContext): Promise<void> {
    const { query } = ctx.options as { query: string }
    const lang = getContextLanguage(ctx)
    const t = ctx.t.get(lang) as unknown as PlayTextLike

    let player: PlayerLike | null = null
    try {
      if (!(await safeDefer(ctx, true))) return

      player = await ensurePlayerForVoice(ctx, ctx.channelId)
      if (!player) {
        await ctx.editResponse({
          content:
            t.player?.noVoiceChannel ||
            'You must be in a voice channel to use this command.'
        })
        return
      }

      let result: ResolveResponseLike | null = null

      if (_functions.isUrl(query)) {
        const cached = uriToTrackCache.get(query)
        if (cached) {
          result = { loadType: 'track', tracks: [cached] }
        }
      }

      if (!result) {
        result = (await ctx.client.aqua.resolve({
          query,
          requester: ctx.interaction.user
        })) as ResolveResponseLike
      }

      const tracks = Array.isArray(result?.tracks) ? result.tracks : []
      if (!tracks.length) {
        await ctx.editResponse({
          content:
            t.player?.noTracksFound || 'No tracks found for the given query.'
        })
        return
      }

      const loadType = String(result.loadType || '').toLowerCase()
      const playlistInfo = result.playlistInfo
      const embed = new Embed().setColor(EMBED_COLOR).setTimestamp()
      const userId = ctx.interaction.user.id
      const queue = player.queue

      if (loadType === 'track' || loadType === 'search') {
        const track = tracks[0]
        if (!track) {
          await ctx.editResponse({
            content:
              t.player?.noTracksFound || 'No tracks found for the given query.'
          })
          return
        }

        if (typeof queue?.add === 'function') queue.add(track)
        _functions.addRecentFromTrack(userId, track)

        const info = track?.info
        const title = _functions.truncate(
          info?.title || 'Track',
          MAX_TITLE_LENGTH
        )
        embed.setDescription(
          t?.player?.trackAdded
            ?.replace('{title}', title)
            ?.replace('{uri}', info?.uri || '#') ||
            `Added [**${title}**](${info?.uri || '#'}) to the queue.`
        )
      } else if (loadType === 'playlist' && playlistInfo?.name) {
        for (const track of tracks) {
          if (typeof queue?.add === 'function') queue.add(track)
        }
        for (let i = 0; i < tracks.length && i < 3; i++) {
          const track = tracks[i]
          if (track) _functions.addRecentFromTrack(userId, track)
        }

        const playlistName = _functions.truncate(
          playlistInfo.name,
          MAX_TITLE_LENGTH
        )
        const firstUri = tracks[0]?.info?.uri || '#'
        embed.setDescription(
          t.player?.playlistAdded
            ?.replace('{name}', playlistName)
            ?.replace('{count}', String(tracks.length))
            ?.replace('{uri}', firstUri) ||
            `Added **[\`${playlistName}\`](${firstUri})** playlist (${tracks.length} tracks) to the queue.`
        )
        if (playlistInfo.thumbnail) embed.setThumbnail(playlistInfo.thumbnail)
      } else {
        await ctx.editResponse({
          content:
            t?.errors?.unsupportedContentType || 'Unsupported content type.'
        })
        return
      }

      await ctx.editResponse({ embeds: [embed] })
      await maybeStartPlayback(player)
    } catch (err: unknown) {
      if (isInteractionExpired(err) || getErrorCode(err) === 10065) return
      console.error(err)
      try {
        await ctx.editOrReply({
          content: t.errors?.general || 'An error occurred. Please try again.'
        })
      } catch (err) {
        if (isInteractionExpired(err)) return
        console.error(err)
      }
    }
  }
}
