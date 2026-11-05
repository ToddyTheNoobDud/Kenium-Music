import type { Track } from 'aqualink'
import {
  type AutocompleteInteraction,
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
import type { PlayerLike } from '../shared/helperTypes.ts'
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
const THROTTLE_CLEANUP_EVERY = 200
const THROTTLE_RETENTION_MS = 45_000
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

type AutocompleteTrack = { title: string; author: string; uri: string }

async function respondToAutocomplete(
  interaction: AutocompleteInteraction,
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
}

function addRecentTrack(userId: string, track: Track): void {
  if (track.uri && track.title) {
    recentTracks.add(userId, track.title, track.uri)
  }
}

async function processAutocomplete(
  interaction: AutocompleteInteraction,
  userId: string,
  query: string
): Promise<unknown> {
  if (query.length < MIN_QUERY_LENGTH) {
    const recent = recentTracks.getRecent(userId, MAX_AUTOCOMPLETE_RESULTS)
    return respondToAutocomplete(
      interaction,
      recent.map((track, index) => ({
        name: `🕘 Recent ${index + 1}: ${truncate(track.title, MAX_TITLE_LENGTH)}`,
        value: track.uri.slice(0, MAX_URI_LENGTH)
      }))
    )
  }
  if (/^https?:\/\//i.test(query)) {
    return respondToAutocomplete(interaction, [])
  }

  const key = query.toLowerCase()
  let results = searchCache.get(key)
  if (!results) {
    const response = await interaction.client.aqua.resolve({
      query,
      requester: interaction.user
    })
    results = response.tracks
      .filter((track) => track.uri)
      .slice(0, MAX_AUTOCOMPLETE_RESULTS)
      .map((track) => ({
        title: track.title || 'Unknown',
        author: track.author || '',
        uri: track.uri || ''
      }))
    if (results.length) {
      searchCache.set(key, results)
    }
  }

  const choices = results.map((track) => {
    const title = truncate(track.title, MAX_TITLE_LENGTH)
    const author = track.author
      ? ` - ${truncate(track.author, MAX_AUTHOR_LENGTH)}`
      : ''
    return {
      name: truncate(title + author, MAX_CHOICE_LENGTH),
      value: track.uri.slice(0, MAX_URI_LENGTH)
    }
  })
  return respondToAutocomplete(interaction, choices)
}

class RecentTracks {
  private userCaches = new Map<string, LRU<TrackInfo>>()

  add(userId: string, title: string, uri: string): void {
    if (!uri) {
      return
    }

    let userCache = this.userCaches.get(userId)
    if (!userCache) {
      if (this.userCaches.size >= USER_CACHE_LIMIT) {
        const firstKey = this.userCaches.keys().next().value
        if (firstKey) {
          this.userCaches.delete(firstKey)
        }
      }
      userCache = new LRU<TrackInfo>(RECENT_CACHE_SIZE)
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

  shouldThrottle(userId: string, intervalMs = THROTTLE_INTERVAL_MS): boolean {
    const now = Date.now()
    const last = this.timestamps.get(userId) ?? 0
    if (now - last < intervalMs) {
      return true
    }

    this.timestamps.set(userId, now)
    if (++this.cleanupCounter >= THROTTLE_CLEANUP_EVERY) {
      this.cleanupCounter = 0
      const threshold = now - THROTTLE_RETENTION_MS
      for (const [key, ts] of this.timestamps) {
        if (ts < threshold) {
          this.timestamps.delete(key)
        }
      }
    }
    return false
  }
}

const searchCache = new LRU<AutocompleteTrack[]>(
  SEARCH_CACHE_SIZE,
  SEARCH_TTL_MS
)
const recentTracks = new RecentTracks()
const throttleMap = new ThrottleMap()
const debounceTimers = new Map<
  string,
  { timer: NodeJS.Timeout; resolve: (value?: unknown) => void }
>()

const cleanupAutocomplete = (): void => {
  for (const entry of debounceTimers.values()) {
    clearTimeout(entry.timer)
  }
  debounceTimers.clear()
  searchCache.clear()
}
process.once('exit', cleanupAutocomplete)
process.once('SIGINT', cleanupAutocomplete)
process.once('SIGTERM', cleanupAutocomplete)

const handleAutocomplete = async (
  interaction: AutocompleteInteraction
): Promise<unknown> => {
  const userId = interaction.user.id
  const query = String(interaction.getInput() ?? '').trim()

  const prev = debounceTimers.get(userId)
  if (prev) {
    clearTimeout(prev.timer)
    prev.resolve()
    debounceTimers.delete(userId)
  }

  if (throttleMap.shouldThrottle(userId)) {
    return respondToAutocomplete(interaction, [])
  }

  return new Promise<unknown>((resolve) => {
    const timer = setTimeout(() => {
      debounceTimers.delete(userId)
      processAutocomplete(interaction, userId, query)
        .then(resolve)
        .catch(() => resolve(respondToAutocomplete(interaction, [])))
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
    autocomplete: handleAutocomplete
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
      const result = await ctx.client.aqua.resolve({
        query,
        requester: ctx.interaction.user
      })
      if (state.cancelled || player.destroyed) {
        await ctx.editResponse({ content: 'Playback loading was cancelled.' })
        return
      }

      const tracks = result.tracks
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
        addRecentTrack(userId, track)

        const info = track?.info
        const title = truncate(String(info?.title || 'Track'), MAX_TITLE_LENGTH)
        embed.setDescription(
          t?.player?.trackAdded
            ?.replace('{title}', title)
            ?.replace('{uri}', info?.uri || '#') ||
            `Added [**${title}**](${info?.uri || '#'}) to the queue.`
        )
      } else if (loadType === 'playlist' && playlistInfo?.name) {
        const added: Track[] = []
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
        for (const track of tracks.slice(0, 3)) {
          addRecentTrack(userId, track)
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
