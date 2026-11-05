import type { Track as ResolvedTrack } from 'aqualink'
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
import { calculatePlaylistAggregate } from '../../utils/playlistMutations.ts'
import { generateSortableId } from '../../utils/simpleDB.ts'

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
      handlePlaylistAutocomplete(interaction, getPlaylistsCollection())
  }),
  tracks: createStringOption({
    description: 'Track names or URLs (comma/newline separated)',
    required: true,
    autocomplete: async (interaction) => handleTrackAutocomplete(interaction)
  })
}

function canonicalizeUri(uri: string): string {
  const videoId = extractYouTubeId(uri)
  if (videoId) {
    return `youtube:${videoId}`
  }
  const spotifyTrack = uri.match(SPOTIFY_TRACK_RE)
  if (spotifyTrack) {
    return `spotify:${spotifyTrack[1]}`
  }
  try {
    const url = new URL(uri)
    url.search = ''
    return url.toString()
  } catch {
    return uri
  }
}

@Declare({
  name: 'add',
  description: 'Add tracks to playlist'
})
@Options(options)
export class AddCommand extends SubCommand {
  async run(ctx: CommandContext<typeof options>) {
    const { playlist: playlistName, tracks: rawQuery } = ctx.options
    const userId = ctx.author.id
    const translations = getContextTranslations(ctx).playlist.add

    const playlistDb = getPlaylistsCollection().findOne(
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
            translations?.notFound || 'Playlist Not Found',
            (
              translations?.notFoundDesc || 'No playlist named "{name}" exists!'
            ).replace('{name}', playlistName),
            [],
            ctx.client.me?.avatarURL()
          )
        ],
        flags: 64
      })
    }

    const availableSlots = LIMITS.MAX_TRACKS

    if (!(await safeDefer(ctx, true))) {
      return
    }

    const timestamp = new Date().toISOString()
    const existingCanonical = new Set<string>()
    const tokens = rawQuery
      .split(TRACK_SEPARATOR_RE)
      .map((track) => track.trim())
      .filter(Boolean)
    const isSingleYouTubePlaylist =
      tokens.length === 1 && YOUTUBE_PLAYLIST_RE.test(tokens[0] as string)

    const toAdd: Track[] = []
    const baseTime = Date.now()

    const pushTrack = (track: ResolvedTrack) => {
      const uri = track.info.uri
      if (!uri || toAdd.length >= availableSlots) {
        return
      }
      const canonical = canonicalizeUri(uri)
      if (existingCanonical.has(canonical)) {
        return
      }

      const newTrack: Track = {
        _id: generateSortableId(),
        playlistId: playlistDb._id,
        title: track.info.title || 'Unknown',
        uri,
        author: track.info.author || 'Unknown',
        duration: track.info.length || 0,
        addedAt: new Date(baseTime + toAdd.length).toISOString(),
        addedBy: userId,
        source: determineSource(uri),
        identifier: track.info.identifier || uri,
        isStream: track.info.isStream || false,
        isSeekable: track.info.isSeekable ?? true,
        position: track.info.position || 0,
        artworkUrl: track.info.artworkUrl || null,
        isrc: track.info.isrc || null
      }
      toAdd.push(newTrack)
      existingCanonical.add(canonical)
    }

    const resolveOne = async (query: string) => {
      const response = await ctx.client.aqua.resolve({
        query,
        requester: ctx.author
      })
      const tracks = response.tracks
      if (tracks.length === 0) {
        return
      }
      const isPlaylist =
        response.loadType === 'playlist' || !!response.playlistInfo
      if (isPlaylist) {
        for (const resolvedTrack of tracks) {
          if (toAdd.length >= availableSlots) {
            break
          }
          if (resolvedTrack) {
            pushTrack(resolvedTrack)
          }
        }
        return
      }
      if (tracks[0]) {
        pushTrack(tracks[0])
      }
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
            if (toAdd.length >= availableSlots) {
              return
            }
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
              translations?.nothingAdded || 'Nothing Added',
              translations?.nothingAddedDesc ||
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
        const mutationResult = (() => {
          const currentPlaylist = getPlaylistsCollection().findOne(
            { userId, name: playlistName },
            { fields: ['_id'] }
          )
          if (!currentPlaylist) {
            return 'not-found' as const
          }

          const existingRows = getTracksCollection().find(
            { playlistId: currentPlaylist._id },
            { fields: ['uri'] }
          )
          const committedCanonical = new Set(
            existingRows.map((track) => canonicalizeUri(track.uri))
          )
          const slots = Math.max(0, LIMITS.MAX_TRACKS - existingRows.length)
          committedTracks = toAdd
            .filter((track) => {
              const canonical = canonicalizeUri(track.uri)
              if (committedCanonical.has(canonical)) {
                return false
              }
              committedCanonical.add(canonical)
              return true
            })
            .slice(0, slots)
            .map((track) => ({
              ...track,
              playlistId: currentPlaylist._id
            }))
          if (committedTracks.length === 0) {
            return 'nothing-added' as const
          }

          getDatabase().transaction(() => {
            getTracksCollection().insert(committedTracks)
            aggregate = calculatePlaylistAggregate(
              getTracksCollection().find(
                { playlistId: currentPlaylist._id },
                { fields: ['duration'] }
              )
            )
            getPlaylistsCollection().update(
              { _id: currentPlaylist._id },
              { lastModified: timestamp, ...aggregate }
            )
          })
          return 'added' as const
        })()
        if (mutationResult !== 'added') {
          return ctx.editOrReply({
            embeds: [
              createEmbed(
                'warning',
                mutationResult === 'not-found'
                  ? translations?.notFound || 'Playlist Not Found'
                  : translations?.nothingAdded || 'Nothing Added',
                mutationResult === 'not-found'
                  ? (
                      translations?.notFoundDesc ||
                      'No playlist named "{name}" exists!'
                    ).replace('{name}', playlistName)
                  : translations?.nothingAddedDesc ||
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
              translations?.addFailed || 'Add Failed',
              (
                translations?.addFailedDesc ||
                'Could not save playlist changes: {error}'
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
              translations?.nothingAdded || 'Nothing Added',
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
          ? translations?.tracksAdded || 'Tracks Added'
          : translations?.trackAdded || 'Track Added',
        null,
        [
          {
            name: `${ICONS.music} ${committedTracks.length > 1 ? translations?.tracks || 'Tracks' : translations?.track || 'Track'}`,
            value:
              committedTracks.length > 1
                ? `**${primary.title}** (+${committedTracks.length - 1} more)`
                : `**${primary.title}**`,
            inline: false
          },
          {
            name: `${ICONS.artist} ${translations?.artist || 'Artist'}`,
            value: primary.author,
            inline: true
          },
          {
            name: `${ICONS.source} ${translations?.source || 'Source'}`,
            value: primary.source,
            inline: true
          },
          {
            name: `${ICONS.tracks} ${translations?.added || 'Added'}`,
            value: `${committedTracks.length} track${committedTracks.length !== 1 ? 's' : ''}`,
            inline: true
          },
          {
            name: `${ICONS.playlist} ${translations?.total || 'Total'}`,
            value: `${aggregate.trackCount}/${LIMITS.MAX_TRACKS} tracks`,
            inline: true
          },
          {
            name: `${ICONS.duration} ${translations?.duration || 'Duration'}`,
            value: formatDuration(aggregate.totalDuration),
            inline: true
          }
        ],
        ctx.client.me?.avatarURL()
      )

      const buttons = createButtons([
        {
          id: `play_playlist_${playlistName}_${userId}`,
          label: translations?.playNow || 'Play Now',
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
            translations?.addFailed || 'Add Failed',
            (
              translations?.addFailedDesc || 'Could not add tracks: {error}'
            ).replace(
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
