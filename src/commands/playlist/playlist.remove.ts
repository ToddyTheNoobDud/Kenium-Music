import {
  type CommandContext,
  createIntegerOption,
  createStringOption,
  Declare,
  Options,
  SubCommand
} from 'seyfert'
import { ICONS } from '../../shared/constants'
import {
  createEmbed,
  extractYouTubeId,
  handlePlaylistAutocomplete,
  handleTrackIndexAutocomplete
} from '../../shared/utils'
import {
  getPlaylistsCollection,
  getTracksCollection,
  getPlaylistTracks,
  getDatabase
} from '../../utils/db'
import { getContextTranslations } from '../../utils/i18n'

const playlistsCollection = getPlaylistsCollection()
const tracksCollection = getTracksCollection()

@Declare({
  name: 'remove',
  description: '➖ Remove a track from a playlist'
})
@Options({
  playlist: createStringOption({
    description: 'Playlist name',
    required: true,
    autocomplete: async (interaction: any) => {
      return handlePlaylistAutocomplete(interaction, playlistsCollection)
    }
  }),
  index: createIntegerOption({
    description: 'Track number to remove',
    required: true,
    min_value: 1,
    autocomplete: async (interaction: any) => {
      return handleTrackIndexAutocomplete(interaction, playlistsCollection)
    }
  })
})
export class RemoveCommand extends SubCommand {
  async run(ctx: CommandContext) {
    const { playlist: playlistName, index } = ctx.options as {
      playlist: string
      index: number
    }
    const userId = ctx.author.id
    const t = getContextTranslations(ctx)

    const playlist = playlistsCollection.findOne({
      userId,
      name: playlistName
    })

    if (!playlist) {
      return ctx.write({
        embeds: [
          createEmbed(
            'error',
            t.playlist?.remove?.notFound || 'Playlist Not Found',
            (
              t.playlist?.remove?.notFoundDesc ||
              'No playlist named "{name}" exists!'
            ).replace('{name}', playlistName)
          )
        ],
        flags: 64
      })
    }

    const totalTracks =
      typeof playlist.trackCount === 'number'
        ? playlist.trackCount
        : getTracksCollection().count({ playlistId: playlist._id })

    if (index < 1 || index > totalTracks) {
      return ctx.write({
        embeds: [
          createEmbed(
            'error',
            t.playlist?.remove?.invalidIndex || 'Invalid Index',
            (
              t.playlist?.remove?.invalidIndexDesc ||
              'Track index must be between 1 and {max}'
            ).replace('{max}', String(totalTracks))
          )
        ],
        flags: 64
      })
    }

    // Fetch just the track at that index (Deterministic due to addedAt sort in getPlaylistTracks)
    const tracks = getPlaylistTracks(playlist._id as string, {
      limit: 1,
      skip: index - 1
    })
    const removedTrack = tracks[0]

    if (!removedTrack) {
      return ctx.write({
        embeds: [
          createEmbed(
            'error',
            t.playlist?.remove?.notFound || 'Track Not Found',
            'Could not find the track at that index.'
          )
        ],
        flags: 64
      })
    }

    const timestamp = new Date().toISOString()
    const newTotalDuration = Math.max(
      0,
      ((playlist as any).totalDuration || 0) - (removedTrack.duration || 0)
    )

    // Use atomic operation with proper error handling
    try {
      getDatabase().transaction(() => {
        tracksCollection.delete({ _id: removedTrack._id })
        playlistsCollection.update(
          { _id: playlist._id },
          {
            lastModified: timestamp,
            totalDuration: newTotalDuration,
            trackCount: Math.max(0, totalTracks - 1)
          }
        )
      })
    } catch (dbError) {
      console.error('Failed to update playlist after track removal:', dbError)
      return ctx.write({
        embeds: [
          createEmbed(
            'error',
            t.playlist?.remove?.removeFailed || 'Remove Failed',
            (
              t.playlist?.remove?.removeFailedDesc ||
              'Could not remove track: {error}'
            ).replace(
              '{error}',
              dbError instanceof Error ? dbError.message : 'Unknown error'
            )
          )
        ],
        flags: 64
      })
    }

    const embed = createEmbed(
      'success',
      t.playlist?.remove?.removed || 'Track Removed',
      undefined,
      [
        {
          name: `${ICONS.remove} ${t.playlist?.remove?.removedTrack || 'Removed'}`,
          value: `**${removedTrack.title}**`,
          inline: false
        },
        {
          name: `${ICONS.artist} ${t.playlist?.remove?.artist || 'Artist'}`,
          value: removedTrack.author || 'Unknown',
          inline: true
        },
        {
          name: `${ICONS.source} ${t.playlist?.remove?.source || 'Source'}`,
          value: removedTrack.source || 'Unknown',
          inline: true
        },
        {
          name: `${ICONS.tracks} ${t.playlist?.remove?.remaining || 'Remaining'}`,
          value: `${totalTracks - 1} tracks`,
          inline: true
        }
      ]
    )

    const videoId = extractYouTubeId(removedTrack.uri)
    if (videoId) {
      embed.setThumbnail(
        `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
      )
    }

    return ctx.write({ embeds: [embed], flags: 64 })
  }
}
