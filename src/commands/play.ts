import {
  Command,
  type CommandContext,
  createStringOption,
  Declare,
  Embed,
  Middlewares,
  Options
} from 'seyfert'
import { LRU } from 'tiny-lru'
import { isExpiredInteraction } from '../shared/errorGuard.ts'
import type { PlayerLike, TrackLike, UserLike } from '../shared/helperTypes.ts'
import {
  enqueueTrack,
  ensurePlayerForVoice,
  getQueueCapacity,
  getQueueLoadState,
  maybeStartPlayback
} from '../shared/playback.ts'
import { truncate } from '../shared/utils.ts'
import { getContextLanguage } from '../utils/i18n.ts'
import {
  getErrorCode,
  isInteractionExpired,
  safeDefer
} from '../utils/interactions.ts'

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

const _functions = {
  async safeAutocompleteRespond(
    interaction: PlayAutocompleteInteractionLike,
    choices: Array<{ name: string; value: string }>
  ): Promise<unknown> {
    try {
      return await interaction.respond(choices)
    } catch (error) {
      if (isInteractionExpired(error) || getErrorCode(error) === 40060) {
        return undefined
      }
      throw error
    }
  },

  isUrl(query: unknown): boolean {
    const s = String(query ?? '')
      .trim()
      .toLowerCase()
    return s.startsWith('http://') || s.startsWith('https://')
  },

  formatChoice(title: unknown, author?: unknown): string {
    const t = truncate(String(title ?? ''), MAX_TITLE_LENGTH)
    const a = author ? ` - ${truncate(String(author), MAX_AUTHOR_LENGTH)}` : ''
    return truncate(t + a, MAX_CHOICE_LENGTH)
  },

  cacheKey(query: string): string {
    return query.trim().toLowerCase()
  },

  addRecentFromTrack(userId: string, track: TrackLike): void {
    const info = track?.info
    if (info?.uri && info?.title) {
      recentTracks.add(userId, info.title, info.uri)
    }
  },

  async processAutocomplete(
    interaction: PlayAutocompleteInteractionLike,
    userId: string,
    query: string
  ): Promise<unknown> {
    if (!query || query.length < MIN_QUERY_LENGTH) {
      const recent = recentTracks.getRecent(userId, MAX_AUTOCOMPLETE_RESULTS)
      if (!recent.length) {
        return _functions.safeAutocompleteRespond(interaction, [])
      }

      const choices = recent.map((track, index) => ({
        name: `🕘 Recent ${index + 1}: ${truncate(String(track.title), MAX_TITLE_LENGTH)}`,
        value: track.uri.slice(0, MAX_URI_LENGTH)
      }))
      return _functions.safeAutocompleteRespond(interaction, choices)
    }

    if (_functions.isUrl(query)) {
      return _functions.safeAutocompleteRespond(interaction, [])
    }

    const key = _functions.cacheKey(query)
    let results = searchCache.get(key)

    if (!results) {
      const res = (await interaction.client.aqua.resolve({
        query,
        requester: interaction.user
      })) as ResolveResponseLike
      const resolved = res.tracks || []
      results = resolved
        .filter((track) => track.info?.uri || track.uri)
        .slice(0, MAX_AUTOCOMPLETE_RESULTS)
        .map((track) => ({
          info: {
            title: track.info?.title || track.title || 'Unknown',
            author: track.info?.author || track.author || '',
            uri: track.info?.uri || track.uri || ''
          }
        }))
      if (results?.length) {
        searchCache.set(key, results)
      }
    }

    if (!results?.length) {
      return _functions.safeAutocompleteRespond(interaction, [])
    }

    const choices: Array<{ name: string; value: string }> = []
    for (
      let i = 0;
      i < results.length && choices.length < MAX_AUTOCOMPLETE_RESULTS;
      i++
    ) {
      const item = results[i]
      const info = item?.info || item
      const uri = info?.uri
      if (!uri) {
        continue
      }
      choices.push({
        name: _functions.formatChoice(info.title || 'Unknown', info.author),
        value: String(uri).slice(0, MAX_URI_LENGTH)
      })
    }

    return _functions.safeAutocompleteRespond(interaction, choices)
  }
}

class RecentTracks {
  private userCaches = new Map<string, LRU<TrackInfo>>()
  private readonly maxUsers: number
  private readonly cacheSize: number

  constructor(maxUsers = USER_CACHE_LIMIT, cacheSize = RECENT_CACHE_SIZE) {
    this.maxUsers = maxUsers
    this.cacheSize = cacheSize
  }

  add(userId: string, title: string, uri: string): void {
    if (!uri) {
      return
    }

    let userCache = this.userCaches.get(userId)
    if (!userCache) {
      if (this.userCaches.size >= this.maxUsers) {
        const firstKey = this.userCaches.keys().next().value
        if (firstKey) {
          this.userCaches.delete(firstKey)
        }
      }
      userCache = new LRU<TrackInfo>(this.cacheSize)
      this.userCaches.set(userId, userCache)
    }

    userCache.set(uri, { title, uri })
  }

  getRecent(userId: string, limit: number): TrackInfo[] {
    const userCache = this.userCaches.get(userId)
    if (!userCache) {
      return []
    }

    const max = Math.max(0, Math.min(limit, userCache.size))
    const tracks: TrackInfo[] = []
    for (const [, track] of [...userCache.entries()].reverse().slice(0, max)) {
      if (track) {
        tracks.push(track)
      }
    }
    return tracks
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
    if (now - last < intervalMs) {
      return true
    }

    this.timestamps.set(userId, now)
    if (++this.cleanupCounter >= this.cleanupThreshold) {
      this.cleanupCounter = 0
      const threshold = now - this.retentionMs
      for (const [key, ts] of this.timestamps) {
        if (ts < threshold) {
          this.timestamps.delete(key)
        }
      }
    }
    return false
  }
}

const searchCache = new LRU<SearchResult[]>(SEARCH_CACHE_SIZE, SEARCH_TTL_MS)
const recentTracks = new RecentTracks()
const throttleMap = new ThrottleMap()
const debounceTimers = new Map<
  string,
  { timer: NodeJS.Timeout; resolve: (value?: unknown) => void }
>()

const _cleanupTimers = (): void => {
  for (const entry of debounceTimers.values()) {
    clearTimeout(entry.timer)
  }
  debounceTimers.clear()
  searchCache.clear()
}
process.once('exit', _cleanupTimers)
process.once('SIGINT', _cleanupTimers)
process.once('SIGTERM', _cleanupTimers)

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

  if (throttleMap.shouldThrottle(userId)) {
    return _functions.safeAutocompleteRespond(interaction, [])
  }

  return new Promise<unknown>((resolve) => {
    const timer = setTimeout(() => {
      debounceTimers.delete(userId)
      _functions
        .processAutocomplete(interaction, userId, query)
        .then(resolve)
        .catch(() =>
          resolve(_functions.safeAutocompleteRespond(interaction, []))
        )
    }, AUTOCOMPLETE_DEBOUNCE_MS)

    timer.unref()

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
@Options(options)
@Middlewares(['checkVoice'])
export default class Play extends Command {
  public override async run(
    ctx: CommandContext<typeof options>
  ): Promise<void> {
    const { query } = ctx.options
    const lang = getContextLanguage(ctx)
    const t = ctx.t.get(lang)

    let player: PlayerLike | null = null
    try {
      if (!(await safeDefer(ctx, true))) {
        return
      }

      player = await ensurePlayerForVoice(ctx, ctx.channelId)
      if (!player) {
        await ctx.editResponse({
          content:
            t.player?.noVoiceChannel ||
            'You must be in a voice channel to use this command.'
        })
        return
      }

      if (!getQueueCapacity(player)) {
        await ctx.editResponse({ content: 'The queue limit is 1,000 tracks.' })
        return
      }
      const state = getQueueLoadState(player)
      const result = (await ctx.client.aqua.resolve({
        query,
        requester: ctx.interaction.user
      })) as ResolveResponseLike
      if (state.cancelled || player.destroyed) {
        await ctx.editResponse({ content: 'Playback loading was cancelled.' })
        return
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

      if (loadType === 'track' || loadType === 'search') {
        const track = tracks[0]
        if (!track) {
          await ctx.editResponse({
            content:
              t.player?.noTracksFound || 'No tracks found for the given query.'
          })
          return
        }

        if (!enqueueTrack(player, track, state)) {
          await ctx.editResponse({
            content: 'The queue limit is 1,000 tracks.'
          })
          return
        }
        _functions.addRecentFromTrack(userId, track)

        const info = track?.info
        const title = truncate(String(info?.title || 'Track'), MAX_TITLE_LENGTH)
        embed.setDescription(
          t?.player?.trackAdded
            ?.replace('{title}', title)
            ?.replace('{uri}', info?.uri || '#') ||
            `Added [**${title}**](${info?.uri || '#'}) to the queue.`
        )
      } else if (loadType === 'playlist' && playlistInfo?.name) {
        const added: SearchResult[] = []
        for (const track of tracks) {
          if (enqueueTrack(player, track, state)) {
            added.push(track)
          }
        }
        if (!added.length) {
          await ctx.editResponse({
            content: 'The queue limit is 1,000 tracks.'
          })
          return
        }
        for (let i = 0; i < tracks.length && i < 3; i++) {
          const track = tracks[i]
          if (track) {
            _functions.addRecentFromTrack(userId, track)
          }
        }

        const playlistName = truncate(
          String(playlistInfo.name),
          MAX_TITLE_LENGTH
        )
        const firstUri = tracks[0]?.info?.uri || '#'
        embed.setDescription(
          t.player?.playlistAdded
            ?.replace('{name}', playlistName)
            ?.replace('{count}', String(added.length))
            ?.replace('{uri}', firstUri) ||
            `Added **[\`${playlistName}\`](${firstUri})** playlist (${added.length} tracks) to the queue.`
        )
        if (playlistInfo.thumbnail) {
          embed.setThumbnail(playlistInfo.thumbnail)
        }
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
      if (isExpiredInteraction(err)) {
        return
      }
      console.error(err)
      try {
        await ctx.editOrReply({
          content: t.errors?.general || 'An error occurred. Please try again.'
        })
      } catch (err) {
        if (isInteractionExpired(err)) {
          return
        }
        console.error(err)
      }
    }
  }
}
