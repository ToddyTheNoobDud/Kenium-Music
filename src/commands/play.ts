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
import { getContextLanguage } from '../utils/i18n'

const RECENT_CACHE_SIZE = 8
const USER_CACHE_LIMIT = 150
const SEARCH_CACHE_SIZE = 96
const MAX_AUTOCOMPLETE_RESULTS = 4
const THROTTLE_INTERVAL_MS = 250
const SEARCH_TTL_MS = 25_000
const EMBED_COLOR = 0x100e09
const MIN_QUERY_LENGTH = 2
const MAX_TITLE_LENGTH = 70
const MAX_AUTHOR_LENGTH = 18
const MAX_CHOICE_LENGTH = 98
const MAX_URI_LENGTH = 98
const AUTOCOMPLETE_DEBOUNCE_MS = 200

type TrackInfo = { title: string; uri: string }
type SearchResult = { info?: TrackInfo; [key: string]: any }

const _functions = {
  isUrl(query: unknown): boolean {
    const s = String(query ?? '')
      .trim()
      .toLowerCase()
    return s.startsWith('http://') || s.startsWith('https://')
  },

  truncate(text: unknown, maxLength: number): string {
    const s = String(text ?? '')
    return s.length <= maxLength ? s : s.slice(0, maxLength - 1) + '…'
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

  safeUnref(timer: any): void {
    try {
      timer?.unref?.()
    } catch {}
  },

  bindProcessCleanupOnce(cleanup: () => void): void {
    const sym = Symbol.for('play.autocomplete.cleanup.bound')
    const g = globalThis as any
    if (g[sym]) return
    g[sym] = true

    process.once('exit', cleanup)
    process.once('SIGINT', cleanup)
    process.once('SIGTERM', cleanup)
  },

  addRecentFromTrack(userId: string, track: any): void {
    const info = track?.info
    if (info?.uri && info?.title) recentTracks.add(userId, info.title, info.uri)
  },

  async processAutocomplete(
    interaction: any,
    userId: string,
    query: string
  ): Promise<any> {
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
      const res = await interaction.client.aqua.resolve({
        query,
        requester: interaction.user
      })
      results = Array.isArray(res) ? res : res?.tracks || []
      if (results.length) searchCache.set(key, results)
    }

    if (!results.length) return interaction.respond([])

    const choices: Array<{ name: string; value: string }> = []
    for (
      let i = 0;
      i < results.length && choices.length < MAX_AUTOCOMPLETE_RESULTS;
      i++
    ) {
      const item: any = results[i]
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
const recentTracks = new OptimizedRecentTracks()
const throttleMap = new ThrottleMap()
const debounceTimers = new Map<string, NodeJS.Timeout>()

const _cleanupTimers = (): void => {
  for (const timer of debounceTimers.values()) clearTimeout(timer)
  debounceTimers.clear()
}
_functions.bindProcessCleanupOnce(_cleanupTimers)

const _handleAutocomplete = async (interaction: any): Promise<void> => {
  const userId = interaction.user.id
  const query = String(interaction.getInput?.() ?? '').trim()

  const prev = debounceTimers.get(userId)
  if (prev) {
    clearTimeout(prev)
    debounceTimers.delete(userId)
  }

  if (throttleMap.shouldThrottle(userId)) return interaction.respond([])

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      debounceTimers.delete(userId)
      _functions
        .processAutocomplete(interaction, userId, query)
        .then(resolve)
        .catch(() => resolve(interaction.respond([])))
    }, AUTOCOMPLETE_DEBOUNCE_MS)

    _functions.safeUnref(timer)
    debounceTimers.set(userId, timer)
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
  async run(ctx: CommandContext): Promise<void> {
    const { query } = ctx.options as { query: string }
    const lang = getContextLanguage(ctx)
    const t = ctx.t.get(lang)

    let player: any
    try {
      if (!ctx.deferred) await ctx.deferReply(true)

      const voice = await ctx.member.voice()
      if (!voice?.channelId) {
        await ctx.editResponse({
          content:
            t.player?.noVoiceChannel ||
            'You must be in a voice channel to use this command.'
        })
        return
      }

      const result = await ctx.client.aqua.resolve({
        query,
        requester: ctx.interaction.user
      })

      if (!result?.tracks?.length) {
        await ctx.editResponse({
          content:
            t.player?.noTracksFound || 'No tracks found for the given query.'
        })
        return
      }

      player = ctx.client.aqua.createConnection({
        guildId: ctx.guildId,
        voiceChannel: voice.channelId,
        textChannel: ctx.channelId,
        deaf: true,
        defaultVolume: 65
      })

      const { loadType, tracks, playlistInfo } = result
      const embed = new Embed().setColor(EMBED_COLOR).setTimestamp()
      const userId = ctx.interaction.user.id

      if (loadType === 'track' || loadType === 'search') {
        const track = tracks[0]
        player.queue.add(track)
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
        for (const track of tracks) player.queue.add(track)
        for (let i = 0; i < tracks.length && i < 3; i++)
          _functions.addRecentFromTrack(userId, tracks[i])

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

      if (!player.playing && !player.paused && player.queue.size > 0) {
        try {
          player.play()
        } catch {}
      }
    } catch (err: any) {
      if (err?.code === 10065) return
      try {
        await ctx.editOrReply({
          content: t.errors?.general || 'An error occurred. Please try again.'
        })
      } catch {}
    }
  }
}
