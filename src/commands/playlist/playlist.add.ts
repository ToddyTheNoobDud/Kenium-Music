import {
  ButtonStyle,
  type CommandContext,
  createStringOption,
  Declare,
  Options,
  SubCommand
} from 'seyfert'
import { ICONS, LIMITS } from '../../shared/constants.ts'
import type { Track } from '../../shared/types.ts'
import {
  createButtons,
  createEmbed,
  determineSource,
  extractYouTubeId,
  formatDuration,
  handlePlaylistAutocomplete,
  handleTrackAutocomplete,
  mapPool
} from '../../shared/utils.ts'
import {
  getDatabase,
  getPlaylistsCollection,
  getTracksCollection
} from '../../utils/db.ts'
import { getContextTranslations } from '../../utils/i18n.ts'
import { safeDefer } from '../../utils/interactions.ts'
import {
  calculatePlaylistAggregate,
  playlistLockKey,
  withPlaylistMutationLock
} from '../../utils/playlistMutations.ts'
import { generateSortableId } from '../../utils/simpleDB.ts'

const playlistsCol = () => getPlaylistsCollection()
const tracksCol = () => getTracksCollection()

type PlaylistAddTextLike = {
  notFound?: string
  notFoundDesc?: string
  full?: string
  fullDesc?: string
  nothingAdded?: string
  nothingAddedDesc?: string
  addFailed?: string
  addFailedDesc?: string
  tracksAdded?: string
  trackAdded?: string
  tracks?: string
  track?: string
  artist?: string
  source?: string
  added?: string
  total?: string
  duration?: string
  playNow?: string
}

type ResolvedTrackLike = {
  info?: {
    title?: string
    uri?: string
    author?: string
    length?: number
    identifier?: string
    isStream?: boolean
    isSeekable?: boolean
    position?: number
    artworkUrl?: string | null
    isrc?: string | null
  }
}

const TRACK_SEPARATOR_RE = /[,;\n]+/
const YOUTUBE_PLAYLIST_RE =
  /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/|music\.youtube\.com\/).*?[?&]list=([A-Za-z0-9_-]+)/i
const SPOTIFY_TRACK_RE = /open\.spotify\.com\/track\/([A-Za-z0-9]+)/i
const CONCURRENCY = 3

const options = {
  playlist: createStringOption({
    description: 'Playlist name',
    required: true,
    autocomplete: async (interaction) =>
      handlePlaylistAutocomplete(interaction, playlistsCol())
  }),
  tracks: createStringOption({
    description: 'Track names or URLs (comma/newline separated)',
    required: true,
    autocomplete: async (interaction) => handleTrackAutocomplete(interaction)
  })
}

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
  normalizeLoadType: (t: unknown): string => String(t || '').toUpperCase()
}

@Declare({
  name: 'add',
  description: 'Add tracks to playlist'
})
@Options(options)
export class AddCommand extends SubCommand {
  async run(ctx: CommandContext) {
    const { playlist: playlistName, tracks: rawQuery } = ctx.options as {
      playlist: string
      tracks: string
    }
    const userId = ctx.author.id
    const t = (
      getContextTranslations(ctx) as {
        playlist?: { add?: PlaylistAddTextLike }
      }
    ).playlist?.add

    const playlistDb = playlistsCol().findOne(
      {
        userId,
        name: playlistName
      },
      {
        fields: ['_id', 'trackCount', 'totalDuration']
      }
    )

    if (!playlistDb) {
      return ctx.write({
        embeds: [
          createEmbed(
            'error',
            t?.notFound || 'Playlist Not Found',
            (t?.notFoundDesc || 'No playlist named "{name}" exists!').replace(
              '{name}',
              playlistName
            ),
            [],
            ctx.client.me?.avatarURL()
          )
        ],
        flags: 64
      })
    }

    const availableSlots = LIMITS.MAX_TRACKS

    if (!(await safeDefer(ctx, true))) return

    const timestamp = new Date().toISOString()
    const existingCanonical = new Set<string>()
    const tokens = _functions.splitInput(rawQuery)
    const isSingleYouTubePlaylist =
      tokens.length === 1 && YOUTUBE_PLAYLIST_RE.test(tokens[0] as string)

    const toAdd: Track[] = []
    const baseTime = Date.now()

    const pushTrack = (track: ResolvedTrackLike) => {
      const uri = track.info?.uri
      if (!uri || toAdd.length >= availableSlots) return
      const canonical = _functions.canonicalizeUri(uri)
      if (existingCanonical.has(canonical)) return

      const newTrack: Track = {
        _id: generateSortableId(),
        playlistId: playlistDb._id,
        title: track.info?.title || 'Unknown',
        uri,
        author: track.info?.author || 'Unknown',
        duration: track.info?.length || 0,
        addedAt: new Date(baseTime + toAdd.length).toISOString(),
        addedBy: userId,
        source: determineSource(uri),
        identifier: track.info?.identifier || uri,
        isStream: track.info?.isStream || false,
        isSeekable: track.info?.isSeekable ?? true,
        position: track.info?.position || 0,
        artworkUrl: track.info?.artworkUrl || null,
        isrc: track.info?.isrc || null
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
          if (tr) pushTrack(tr as ResolvedTrackLike)
        }
        return
      }
      if (tracks[0]) pushTrack(tracks[0] as ResolvedTrackLike)
    }

    try {
      if (isSingleYouTubePlaylist) {
        await resolveOne(tokens[0] as string)
      } else {
        const uniqueTokens = Array.from(new Set(tokens))
        const limit = Math.min(CONCURRENCY, availableSlots || 1)
        await mapPool(
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
              t?.nothingAdded || 'Nothing Added',
              t?.nothingAddedDesc ||
                'No new tracks were added. They may already exist in the playlist or no matches were found.',
              [],
              ctx.client.me?.avatarURL()
            )
          ]
        })
      }

      let committedTracks: Track[] = []
      let aggregate = { trackCount: 0, totalDuration: 0 }

      try {
        const mutationResult = await withPlaylistMutationLock(
          playlistLockKey(userId, playlistName),
          () => {
            const currentPlaylist = playlistsCol().findOne(
              { userId, name: playlistName },
              { fields: ['_id'] }
            )
            if (!currentPlaylist) return 'not-found' as const

            const existingRows = tracksCol().find(
              { playlistId: currentPlaylist._id },
              { fields: ['uri'] }
            )
            const committedCanonical = new Set(
              existingRows.map((track) => _functions.canonicalizeUri(track.uri))
            )
            const slots = Math.max(0, LIMITS.MAX_TRACKS - existingRows.length)
            committedTracks = toAdd
              .filter((track) => {
                const canonical = _functions.canonicalizeUri(track.uri)
                if (committedCanonical.has(canonical)) return false
                committedCanonical.add(canonical)
                return true
              })
              .slice(0, slots)
              .map((track) => ({
                ...track,
                playlistId: currentPlaylist._id
              }))
            if (committedTracks.length === 0) return 'nothing-added' as const

            getDatabase().transaction(() => {
              tracksCol().insert(committedTracks)
              aggregate = calculatePlaylistAggregate(
                tracksCol().find(
                  { playlistId: currentPlaylist._id },
                  { fields: ['duration'] }
                )
              )
              playlistsCol().update(
                { _id: currentPlaylist._id },
                { lastModified: timestamp, ...aggregate }
              )
            })
            return 'added' as const
          }
        )
        if (mutationResult !== 'added') {
          return ctx.editOrReply({
            embeds: [
              createEmbed(
                'warning',
                mutationResult === 'not-found'
                  ? t?.notFound || 'Playlist Not Found'
                  : t?.nothingAdded || 'Nothing Added',
                mutationResult === 'not-found'
                  ? (
                      t?.notFoundDesc || 'No playlist named "{name}" exists!'
                    ).replace('{name}', playlistName)
                  : t?.nothingAddedDesc ||
                      'No new tracks were added. They may already exist or the playlist may be full.',
                [],
                ctx.client.me?.avatarURL()
              )
            ]
          })
        }
      } catch (dbError) {
        console.error('Failed to update playlist:', dbError)
        return ctx.editOrReply({
          embeds: [
            createEmbed(
              'error',
              t?.addFailed || 'Add Failed',
              (
                t?.addFailedDesc || 'Could not save playlist changes: {error}'
              ).replace(
                '{error}',
                dbError instanceof Error ? dbError.message : 'Unknown error'
              ),
              [],
              ctx.client.me?.avatarURL()
            )
          ]
        })
      }

      const primary = committedTracks[0]
      if (!primary) {
        return ctx.editOrReply({
          embeds: [
            createEmbed(
              'warning',
              t?.nothingAdded || 'Nothing Added',
              'No new tracks were added.',
              [],
              ctx.client.me?.avatarURL()
            )
          ]
        })
      }

      const embed = createEmbed(
        'success',
        committedTracks.length > 1
          ? t?.tracksAdded || 'Tracks Added'
          : t?.trackAdded || 'Track Added',
        null,
        [
          {
            name: `${ICONS.music} ${committedTracks.length > 1 ? t?.tracks || 'Tracks' : t?.track || 'Track'}`,
            value:
              committedTracks.length > 1
                ? `**${primary.title}** (+${committedTracks.length - 1} more)`
                : `**${primary.title}**`,
            inline: false
          },
          {
            name: `${ICONS.artist} ${t?.artist || 'Artist'}`,
            value: primary.author,
            inline: true
          },
          {
            name: `${ICONS.source} ${t?.source || 'Source'}`,
            value: primary.source,
            inline: true
          },
          {
            name: `${ICONS.tracks} ${t?.added || 'Added'}`,
            value: `${committedTracks.length} track${committedTracks.length !== 1 ? 's' : ''}`,
            inline: true
          },
          {
            name: `${ICONS.playlist} ${t?.total || 'Total'}`,
            value: `${aggregate.trackCount}/${LIMITS.MAX_TRACKS} tracks`,
            inline: true
          },
          {
            name: `${ICONS.duration} ${t?.duration || 'Duration'}`,
            value: formatDuration(aggregate.totalDuration),
            inline: true
          }
        ],
        ctx.client.me?.avatarURL()
      )

      const buttons = createButtons([
        {
          id: `play_playlist_${playlistName}_${userId}`,
          label: t?.playNow || 'Play Now',
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
            t?.addFailed || 'Add Failed',
            (t?.addFailedDesc || 'Could not add tracks: {error}').replace(
              '{error}',
              err instanceof Error ? err.message : 'Unknown error'
            ),
            [],
            ctx.client.me?.avatarURL()
          )
        ]
      })
    }
  }
}
