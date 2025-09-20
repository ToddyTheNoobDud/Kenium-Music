import {
  Command,
  type CommandContext,
  createStringOption,
  Declare,
  Embed,
  Middlewares,
  Options,
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
const URL_REGEX = /^https?:\/\//i
const MIN_QUERY_LENGTH = 2
const MAX_TITLE_LENGTH = 70
const MAX_AUTHOR_LENGTH = 18
const MAX_CHOICE_LENGTH = 98
const MAX_URI_LENGTH = 98

const _isUrl = (query = ''): boolean => URL_REGEX.test(String(query).trim())

const _escapeMarkdown = (text = ''): string => {
  if (!text) return ''
  return String(text).replace(/[\\`*_{}\[\]()#+\-.!|]/g, '\\$&')
}

const _truncate = (text = '', maxLength: number): string => {
  const s = String(text)
  if (s.length <= maxLength) return s
  return s.slice(0, maxLength - 1) + '…'
}

const _formatChoice = (title: string, author?: string): string => {
  const escapedTitle = _escapeMarkdown(_truncate(title, MAX_TITLE_LENGTH))
  const authorSuffix = author ? ` - ${_truncate(_escapeMarkdown(author), MAX_AUTHOR_LENGTH)}` : ''
  return _truncate(escapedTitle + authorSuffix, MAX_CHOICE_LENGTH)
}

type TrackInfo = { title: string; uri: string }
type SearchResult = { info?: TrackInfo; [key: string]: any }

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

    // Get entries and reverse to show most recent first
    const entries = [...userCache.entries()].reverse().slice(0, Math.max(0, Math.min(limit, userCache.size)))
    return entries.map(([, value]) => value)
  }
}

class ThrottleMap {
  private timestamps = new Map<string, number>()
  private cleanupCounter = 0
  private readonly cleanupThreshold = 200
  private readonly retentionMs = 45_000

  shouldThrottle(userId: string, intervalMs = THROTTLE_INTERVAL_MS): boolean {
    const now = Date.now()
    const lastAccess = this.timestamps.get(userId) ?? 0

    if (now - lastAccess < intervalMs) return true

    this.timestamps.set(userId, now)

    if (++this.cleanupCounter >= this.cleanupThreshold) {
      this.cleanupCounter = 0
      this._cleanup(now - this.retentionMs)
    }

    return false
  }

  private _cleanup(threshold: number): void {
    for (const [key, timestamp] of this.timestamps) {
      if (timestamp < threshold) this.timestamps.delete(key)
    }
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

process.once('exit', _cleanupTimers)
process.once('SIGINT', _cleanupTimers)
process.once('SIGTERM', _cleanupTimers)

const _processAutocomplete = async (
  interaction: any,
  userId: string,
  query: string,
  resolve: (value: any) => void,
): Promise<void> => {
  if (!query || query.length < MIN_QUERY_LENGTH) {
    const recent = recentTracks.getRecent(userId, MAX_AUTOCOMPLETE_RESULTS)
    if (!recent.length) return resolve(interaction.respond([]))

    const choices = recent.map((track, index) => ({
      name: `🕘 Recent ${index + 1}: ${_truncate(track.title, 79)}`,
      value: track.uri.slice(0, MAX_URI_LENGTH),
    }))

    return resolve(interaction.respond(choices))
  }

  if (_isUrl(query)) return resolve(interaction.respond([]))

  const cacheKey = query.toLowerCase().slice(0, 60)
  let results = searchCache.get(cacheKey)

  if (!results) {
    const searchResponse = await interaction.client.aqua.resolve({
      query,
      requester: interaction.user,
    })

    results = Array.isArray(searchResponse) ? searchResponse : searchResponse?.tracks || []

    if (results.length) searchCache.set(cacheKey, results)
  }

  if (!results.length) return resolve(interaction.respond([]))

  const choices = results
    .slice(0, MAX_AUTOCOMPLETE_RESULTS)
    .map((item: SearchResult) => {
      const info = item.info || item
      if (!info?.uri) return null

      return {
        name: _formatChoice(info.title || 'Unknown', (info as any).author),
        value: info.uri.slice(0, MAX_URI_LENGTH),
      }
    })
    .filter(Boolean)

  resolve(interaction.respond(choices))
}

const _handleAutocomplete = async (interaction: any): Promise<void> => {
  const userId = interaction.user.id

  if (throttleMap.shouldThrottle(userId)) return interaction.respond([])

  const query = String(interaction.getInput() || '').trim()

  const existingTimer = debounceTimers.get(userId)
  if (existingTimer) {
    clearTimeout(existingTimer)
    debounceTimers.delete(userId)
  }

  return new Promise(resolve => {
    const timer = setTimeout(async () => {
      debounceTimers.delete(userId)
      try {
        await _processAutocomplete(interaction, userId, query, resolve)
      } catch (e) {
        console.error('autocomplete process error', e)
        resolve(interaction.respond([]))
      }
    }, 200)

    debounceTimers.set(userId, timer)
  })
}

const options = {
  query: createStringOption({
    description: 'The song you want to search for',
    required: true,
    autocomplete: _handleAutocomplete,
  }),
}

@Declare({ name: 'play', description: 'Play a song by search query or URL.' })
@Options(options)
@Middlewares(['checkVoice'])
export default class Play extends Command {
  async run(ctx: CommandContext): Promise<void> {
    const { query } = ctx.options as { query: string }
    const lang = getContextLanguage(ctx)
    const t = ctx.t.get(lang)

    try {
      await ctx.deferReply(true)

      const voice = await ctx.member.voice()
      if (!voice?.channelId) {
        await ctx.editResponse({
          content: t.player?.noVoiceChannel || 'You must be in a voice channel to use this command.',
        })
        return
      }

      const player = ctx.client.aqua.createConnection({
        guildId: ctx.guildId,
        voiceChannel: voice.channelId,
        textChannel: ctx.channelId,
        deaf: true,
        defaultVolume: 65,
      })

      const result = await ctx.client.aqua.resolve({
        query,
        requester: ctx.interaction.user,
      })

      if (!result?.tracks?.length) {
        await ctx.editResponse({
          content: t.player?.noTracksFound || 'No tracks found for the given query.',
        })
        return
      }

      const { loadType, tracks, playlistInfo } = result
      const embed = new Embed().setColor(EMBED_COLOR).setTimestamp()
      const userId = ctx.interaction.user.id

      if (loadType === 'track' || loadType === 'search') {
        const track = tracks[0]
        const info = track?.info || {}
        player.queue.add(track)
        if (info.uri && info.title) {
          recentTracks.add(userId, info.title, info.uri)
        }

        const title = _escapeMarkdown(info.title || 'Track')
        const addedText = t?.player?.trackAdded
          ?.replace('{title}', title)
          ?.replace('{uri}', info.uri || '#') ||
          `Added [**${title}**](${info.uri || '#'}) to the queue.`

        embed.setDescription(addedText)
      } else if (loadType === 'playlist' && playlistInfo?.name) {
        for (const track of tracks) {
          player.queue.add(track)
        }

        const tracksToCache = tracks.slice(0, 3)
        tracksToCache.forEach((track: any) => {
          const info = track?.info || {}
          if (info.uri && info.title) {
            recentTracks.add(userId, info.title, info.uri)
          }
        })

        const playlistName = _escapeMarkdown(playlistInfo.name)
        const firstTrack = tracks[0]
        const playlistText = t.player?.playlistAdded
          ?.replace('{name}', playlistName)
          ?.replace('{count}', tracks.length.toString())
          ?.replace('{uri}', firstTrack?.info?.uri || '#') ||
          `Added **[\`${playlistName}\`](${firstTrack?.info?.uri || '#'})** playlist (${tracks.length} tracks) to the queue.`

        embed.setDescription(playlistText)
        if (playlistInfo.thumbnail) embed.setThumbnail(playlistInfo.thumbnail)
      } else {
        await ctx.editResponse({
          content: t?.errors?.unsupportedContentType || 'Unsupported content type.',
        })
        return
      }

      await ctx.editResponse({ embeds: [embed] })

      if (!player.playing && !player.paused && player.queue.size > 0) {
        try {
          player.play()
        } catch (e) {
          console.error('play start error', e)
        }
      }
    } catch (err: any) {
      if (err?.code === 10065) return

      console.error('Play error:', err)
      try {
        await ctx.editResponse({ content: t.errors?.general || 'An error occurred. Please try again.' })
      } catch {}
    }
  }
}