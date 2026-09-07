import {
  type CommandContext,
  createIntegerOption,
  createStringOption,
  Declare,
  Options,
  SubCommand
} from 'seyfert'
import { ICONS } from '../../shared/constants.ts'
import {
  createEmbed,
  extractYouTubeId,
  handlePlaylistAutocomplete,
  handleTrackIndexAutocomplete
} from '../../shared/utils.ts'
import {
  getDatabase,
  getPlaylistsCollection,
  getPlaylistTracks,
  getTracksCollection
} from '../../utils/db.ts'
import { getContextTranslations } from '../../utils/i18n.ts'
import {
  calculatePlaylistAggregate,
  playlistLockKey,
  withPlaylistMutationLock
} from '../../utils/playlistMutations.ts'

const playlistsCol = () => getPlaylistsCollection()
const tracksCol = () => getTracksCollection()

type PlaylistRemoveTextLike = {
  notFound?: string
  notFoundDesc?: string
  invalidIndex?: string
  invalidIndexDesc?: string
  removeFailed?: string
  removeFailedDesc?: string
  removed?: string
  removedTrack?: string
  artist?: string
  source?: string
  remaining?: string
}

const options = {
  playlist: createStringOption({
    description: 'Playlist name',
    required: true,
    autocomplete: async (interaction) => {
      return handlePlaylistAutocomplete(interaction, playlistsCol())
    }
  }),
  index: createIntegerOption({
    description: 'Track number to remove',
    required: true,
    min_value: 1,
    autocomplete: async (interaction) => {
      return handleTrackIndexAutocomplete(interaction, playlistsCol())
    }
  })
}

@Declare({
  name: 'remove',
  description: '❌ Remove a track from a playlist'
})
@Options(options)
export class RemoveCommand extends SubCommand {
  async run(ctx: CommandContext) {
    const { playlist: playlistName, index } = ctx.options as {
      playlist: string
      index: number
    }
    const userId = ctx.author.id
    const t = (
      getContextTranslations(ctx) as {
        playlist?: { remove?: PlaylistRemoveTextLike }
      }
    ).playlist?.remove

    const playlist = playlistsCol().findOne(
      {
        userId,
        name: playlistName
      },
      {
        fields: ['_id', 'trackCount', 'totalDuration']
      }
    )

    if (!playlist) {
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

    let totalTracks = 0
    let removedTrack: ReturnType<typeof getPlaylistTracks>[number] | undefined
    let mutationResult: 'removed' | 'invalid-index' | 'not-found' = 'not-found'

    try {
      mutationResult = await withPlaylistMutationLock(
        playlistLockKey(userId, playlistName),
        () => {
          const currentPlaylist = playlistsCol().findOne(
            { userId, name: playlistName },
            { fields: ['_id'] }
          )
          if (!currentPlaylist) return 'not-found' as const

          totalTracks = tracksCol().count({ playlistId: currentPlaylist._id })
          if (index < 1 || index > totalTracks) return 'invalid-index' as const

          removedTrack = getPlaylistTracks(currentPlaylist._id, {
            limit: 1,
            skip: index - 1,
            fields: ['title', 'author', 'source', 'uri', 'duration']
          })[0]
          if (!removedTrack) return 'invalid-index' as const

          getDatabase().transaction(() => {
            const deleted = tracksCol().delete({ _id: removedTrack?._id })
            if (deleted !== 1) {
              throw new Error(
                'Track was not deleted; playlist metadata unchanged'
              )
            }
            const aggregate = calculatePlaylistAggregate(
              tracksCol().find(
                { playlistId: currentPlaylist._id },
                { fields: ['duration'] }
              )
            )
            const updated = playlistsCol().update(
              { _id: currentPlaylist._id },
              {
                lastModified: new Date().toISOString(),
                ...aggregate
              }
            )
            if (updated !== 1)
              throw new Error('Playlist metadata was not updated')
            totalTracks = aggregate.trackCount
          })
          return 'removed' as const
        }
      )
    } catch (dbError) {
      console.error('Failed to update playlist after track removal:', dbError)
      return ctx.write({
        embeds: [
          createEmbed(
            'error',
            t?.removeFailed || 'Remove Failed',
            (t?.removeFailedDesc || 'Could not remove track: {error}').replace(
              '{error}',
              dbError instanceof Error ? dbError.message : 'Unknown error'
            ),
            [],
            ctx.client.me?.avatarURL()
          )
        ],
        flags: 64
      })
    }

    if (mutationResult === 'not-found') {
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

    if (mutationResult === 'invalid-index') {
      return ctx.write({
        embeds: [
          createEmbed(
            'error',
            t?.invalidIndex || 'Invalid Index',
            (
              t?.invalidIndexDesc || 'Track index must be between 1 and {max}'
            ).replace('{max}', String(totalTracks)),
            [],
            ctx.client.me?.avatarURL()
          )
        ],
        flags: 64
      })
    }

    if (!removedTrack) {
      return ctx.write({
        embeds: [
          createEmbed(
            'error',
            t?.notFound || 'Track Not Found',
            'Could not find the track at that index.',
            [],
            ctx.client.me?.avatarURL()
          )
        ],
        flags: 64
      })
    }

    const embed = createEmbed(
      'success',
      t?.removed || 'Track Removed',
      null,
      [
        {
          name: `${ICONS.remove} ${t?.removedTrack || 'Removed'}`,
          value: `**${removedTrack.title}**`,
          inline: false
        },
        {
          name: `${ICONS.artist} ${t?.artist || 'Artist'}`,
          value: removedTrack.author || 'Unknown',
          inline: true
        },
        {
          name: `${ICONS.source} ${t?.source || 'Source'}`,
          value: removedTrack.source || 'Unknown',
          inline: true
        },
        {
          name: `${ICONS.tracks} ${t?.remaining || 'Remaining'}`,
          value: `${totalTracks} tracks`,
          inline: true
        }
      ],
      ctx.client.me?.avatarURL()
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
