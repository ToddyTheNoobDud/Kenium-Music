// biome-ignore assist/source/organizeImports: <unresolved>
import {
  Declare,
  Options,
  SubCommand,
  createStringOption,
  type CommandContext
} from 'seyfert'
import { ButtonStyle } from 'seyfert/lib/types'
import { ICONS, LIMITS } from '../../shared/constants'
import type { Track } from '../../shared/types'
import {
  createButtons,
  createEmbed,
  determineSource,
  extractYouTubeId,
  formatDuration,
  handlePlaylistAutocomplete,
  handleTrackAutocomplete
} from '../../shared/utils'
import {
  getDatabase,
  getPlaylistsCollection,
  getTracksCollection
} from '../../utils/db'
import { getContextTranslations } from '../../utils/i18n'

const playlistsCollection = getPlaylistsCollection()
const tracksCollection = getTracksCollection()

// using Track from shared/types

const TRACK_SEPARATOR_RE = /[,;\n]+/
const YOUTUBE_PLAYLIST_RE =
  /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/|music\.youtube\.com\/).*?[?&]list=([A-Za-z0-9_-]+)/i
const SPOTIFY_TRACK_RE = /open\.spotify\.com\/track\/([A-Za-z0-9]+)/i
const CONCURRENCY = 3

export const _functions = {
  splitInput: (input: string): string[] =>
    input
      .split(TRACK_SEPARATOR_RE)
      .map((s) => s.trim())
      .filter(Boolean),
  canonicalizeUri: (uri: string): string => {
    const ytId = extractYouTubeId(uri)
    if (ytId) return `youtube:${ytId}`
    const s = uri.match(SPOTIFY_TRACK_RE)
    if (s) return `spotify:${s[1]}`
    try {
      const u = new URL(uri)
      u.search = ''
      return u.toString()
    } catch {
      return uri
    }
  },
  normalizeLoadType: (t: unknown): string => String(t || '').toUpperCase(),
  mapPool: async <T>(
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<void>,
    shouldStop?: () => boolean
  ) => {
    const l = Math.max(1, limit)
    let nextIndex = 0
    const getNextIndex = (): number => {
      const idx = nextIndex
      nextIndex += 1
      return idx
    }
    const next = async () => {
      for (;;) {
        if (shouldStop?.()) return
        const idx = getNextIndex()
        if (idx >= items.length) return
        try {
          const item = items[idx]
          if (item !== undefined) {
            await fn(item, idx)
          }
        } catch (err) {
          console.error(`mapPool task ${idx} failed:`, err)
        }
      }
    }
    const runners = Array.from({ length: Math.min(l, items.length) }, next)
    await Promise.all(runners)
  }
}

@Declare({
  name: 'add',
  description: '➕ Add tracks to playlist'
})

@Options({
  playlist: createStringOption({
    description: 'Playlist name',
    required: true,
    autocomplete: async (interaction) =>
      handlePlaylistAutocomplete(interaction, playlistsCollection)
  }),
  tracks: createStringOption({
    description: 'Track names or URLs (comma/newline separated)',
    required: true,
    autocomplete: async (interaction) =>
      handleTrackAutocomplete(interaction)
  })
} as any)
export class AddCommand extends SubCommand {
  async run(ctx: CommandContext) {
    const { playlist: playlistName, tracks: rawQuery } = ctx.options as {
      playlist: string
      tracks: string
    }
    const userId = ctx.author.id
    const t = getContextTranslations(ctx)

    const playlistDb = playlistsCollection.findOne({
      userId,
      name: playlistName
    })

    if (!playlistDb) {
      return ctx.write({
        embeds: [
          createEmbed(
            'error',
            t.playlist?.add?.notFound || 'Playlist Not Found',
            (
              t.playlist?.add?.notFoundDesc ||
              'No playlist named "{name}" exists!'
            ).replace('{name}', playlistName)
          )
        ],
        flags: 64
      })
    }

    const currentTracksCount =
      typeof playlistDb.trackCount === 'number'
        ? playlistDb.trackCount
        : tracksCollection.count({ playlistId: playlistDb._id })
    const availableSlots = Math.max(0, LIMITS.MAX_TRACKS - currentTracksCount)

    if (availableSlots === 0) {
      return ctx.write({
        embeds: [
          createEmbed(
            'warning',
            t.playlist?.add?.full || 'Playlist Full',
            (
              t.playlist?.add?.fullDesc ||
              'This playlist has reached the {max}-track limit!'
            ).replace('{max}', String(LIMITS.MAX_TRACKS))
          )
        ],
        flags: 64
      })
    }

    if (!ctx.deferred) await ctx.deferReply(true)

    const timestamp = new Date().toISOString()
    const existingCanonical = new Set<string>()
    const existingUris = tracksCollection.find(
      { playlistId: playlistDb._id },
      { fields: ['uri'] }
    ) as unknown as { uri: string }[]
    for (const tr of existingUris)
      existingCanonical.add(_functions.canonicalizeUri(tr.uri))

    const tokens = _functions.splitInput(rawQuery)
    const isSingleYouTubePlaylist =
      tokens.length === 1 && YOUTUBE_PLAYLIST_RE.test(tokens[0] as string)

    const toAdd: Track[] = []

    const baseTime = Date.now()
    const pushTrack = (track: { info: any }) => {
      const uri = track?.info?.uri
      if (!uri || toAdd.length >= availableSlots) return
      const canonical = _functions.canonicalizeUri(uri)
      if (existingCanonical.has(canonical)) return
      const newTrack: Track = {
        _id: `tr_${Math.random().toString(36).slice(2, 11)}_${Date.now() + toAdd.length}`,
        playlistId: playlistDb._id,
        title: track.info.title || 'Unknown',
        uri,
        author: track.info.author || 'Unknown',
        duration: track.info.length || 0,
        addedAt: new Date(baseTime + toAdd.length).toISOString(),
        addedBy: userId,
        source: determineSource(uri),
        identifier: uri || track.info.identifier,
        isStream: track.info.isStream || false,
        isSeekable: track.info.isSeekable || true,
        position: track.info.position || 0,
        artworkUrl: track.info.artworkUrl || null,
        isrc: track.info.isrc || null
      }
      toAdd.push(newTrack)
      existingCanonical.add(canonical)
    }

    const resolveOne = async (query: string) => {
      const res = await ctx.client.aqua.resolve({
        query,
        requester: ctx.author
      })
      if (!res) return
      const type = _functions.normalizeLoadType(res.loadType)
      if (type === 'LOAD_FAILED' || type === 'NO_MATCHES') return
      const tracks = Array.isArray(res.tracks) ? res.tracks : []
      if (tracks.length === 0) return
      const isPlaylist = type.includes('PLAYLIST') || !!res.playlistInfo
      if (isPlaylist) {
        for (const tr of tracks) {
          if (toAdd.length >= availableSlots) break
          if (tr) pushTrack(tr as any)
        }
      } else {
        if (tracks[0]) pushTrack(tracks[0] as any)
      }
    }

    try {
      if (isSingleYouTubePlaylist) {
        await resolveOne(tokens[0] as string)
      } else {
        const uniqueTokens = Array.from(new Set(tokens))
        const limit = Math.min(CONCURRENCY, availableSlots || 1)
        await _functions.mapPool(
          uniqueTokens,
          limit,
          async (token) => {
            if (toAdd.length >= availableSlots) return
            await resolveOne(token)
          },
          () => toAdd.length >= availableSlots
        )
      }

      if (toAdd.length === 0) {
        return ctx.editOrReply({
          embeds: [
            createEmbed(
              'warning',
              t.playlist?.add?.nothingAdded || 'Nothing Added',
              t.playlist?.add?.nothingAddedDesc ||
                'No new tracks were added. They may already exist in the playlist or no matches were found.'
            )
          ]
        })
      }

      if (toAdd.length > availableSlots) toAdd.length = availableSlots

      const addedDuration = toAdd.reduce((sum, t) => sum + (t.duration || 0), 0)
      const newTotalDuration =
        (playlistDb.totalDuration || 0) + addedDuration
      const newTotalTracks = currentTracksCount + toAdd.length

      // Atomic update for tracks and playlist metadata
      try {
        getDatabase().transaction(() => {
          tracksCollection.insert(toAdd)
          playlistsCollection.update(
            { _id: playlistDb._id },
            {
              lastModified: timestamp,
              totalDuration: newTotalDuration,
              trackCount: newTotalTracks
            }
          )
        })
      } catch (dbError) {
        console.error('Failed to update playlist:', dbError)
        return ctx.editOrReply({
          embeds: [
            createEmbed(
              'error',
              t.playlist?.add?.addFailed || 'Add Failed',
              (
                t.playlist?.add?.addFailedDesc ||
                'Could not save playlist changes: {error}'
              ).replace(
                '{error}',
                dbError instanceof Error ? dbError.message : 'Unknown error'
              )
            )
          ]
        })
      }
      const primary = toAdd[0]
      if (!primary) {
        return ctx.editOrReply({
          embeds: [
            createEmbed(
              'warning',
              t.playlist?.add?.nothingAdded || 'Nothing Added',
              'No new tracks were added.'
            )
          ]
        })
      }

      const embed = createEmbed(
        'success',
        toAdd.length > 1
          ? t.playlist?.add?.tracksAdded || 'Tracks Added'
          : t.playlist?.add?.trackAdded || 'Track Added',
        null,
        [
          {
            name: `${ICONS.music} ${toAdd.length > 1 ? t.playlist?.add?.tracks || 'Tracks' : t.playlist?.add?.track || 'Track'}`,
            value:
              toAdd.length > 1
                ? `**${primary.title}** (+${toAdd.length - 1} more)`
                : `**${primary.title}**`,
            inline: false
          },
          {
            name: `${ICONS.artist} ${t.playlist?.add?.artist || 'Artist'}`,
            value: primary.author,
            inline: true
          },
          {
            name: `${ICONS.source} ${t.playlist?.add?.source || 'Source'}`,
            value: primary.source,
            inline: true
          },
          {
            name: `${ICONS.tracks} ${t.playlist?.add?.added || 'Added'}`,
            value: `${toAdd.length} track${toAdd.length !== 1 ? 's' : ''}`,
            inline: true
          },
          {
            name: `${ICONS.playlist} ${t.playlist?.add?.total || 'Total'}`,
            value: `${newTotalTracks}/${LIMITS.MAX_TRACKS} tracks`,
            inline: true
          },
          {
            name: `${ICONS.duration} ${t.playlist?.add?.duration || 'Duration'}`,
            value: formatDuration(newTotalDuration),
            inline: true
          }
        ]
      )

      const buttons = createButtons([
        {
          id: `play_playlist_${playlistName}_${userId}`,
          label: t.playlist?.add?.playNow || 'Play Now',
          emoji: ICONS.play,
          style: ButtonStyle.Success
        }
      ])

      return ctx.editOrReply({ embeds: [embed], components: [buttons] })
    } catch (err) {
      return ctx.editOrReply({
        embeds: [
          createEmbed(
            'error',
            t.playlist?.add?.addFailed || 'Add Failed',
            (
              t.playlist?.add?.addFailedDesc || 'Could not add tracks: {error}'
            ).replace(
              '{error}',
              err instanceof Error ? err.message : 'Unknown error'
            )
          )
        ]
      })
    }
  }
}
