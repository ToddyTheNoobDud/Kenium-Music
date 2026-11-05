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
import { calculatePlaylistAggregate } from '../../utils/playlistMutations.ts'

const options = {
  playlist: createStringOption({
    description: 'Playlist name',
    required: true,
    autocomplete: async (interaction) => {
      return handlePlaylistAutocomplete(interaction, getPlaylistsCollection())
    }
  }),
  index: createIntegerOption({
    description: 'Track number to remove',
    required: true,
    min_value: 1,
    autocomplete: async (interaction) => {
      return handleTrackIndexAutocomplete(interaction, getPlaylistsCollection())
    }
  })
}

@Declare({
  name: 'remove',
  description: '❌ Remove a track from a playlist'
})
@Options(options)
export class RemoveCommand extends SubCommand {
  async run(ctx: CommandContext<typeof options>) {
    const { playlist: playlistName, index } = ctx.options
    const userId = ctx.author.id
    const t = getContextTranslations(ctx).playlist.remove

    const playlist = getPlaylistsCollection().findOne(
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
    try {
      totalTracks = getTracksCollection().count({ playlistId: playlist._id })
      removedTrack =
        index >= 1 && index <= totalTracks
          ? getPlaylistTracks(playlist._id, {
              limit: 1,
              skip: index - 1,
              fields: ['title', 'author', 'source', 'uri', 'duration']
            })[0]
          : undefined
      if (index < 1 || index > totalTracks || !removedTrack) {
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

      const trackId = removedTrack._id
      getDatabase().transaction(() => {
        const deleted = getTracksCollection().delete({ _id: trackId })
        if (deleted !== 1) {
          throw new Error('Track was not deleted; playlist metadata unchanged')
        }
        const aggregate = calculatePlaylistAggregate(
          getTracksCollection().find(
            { playlistId: playlist._id },
            { fields: ['duration'] }
          )
        )
        const updated = getPlaylistsCollection().update(
          { _id: playlist._id },
          {
            lastModified: new Date().toISOString(),
            ...aggregate
          }
        )
        if (updated !== 1) {
          throw new Error('Playlist metadata was not updated')
        }
        totalTracks = aggregate.trackCount
      })
    } catch (dbError) {
      console.error('Failed to update playlist after track removal:', dbError)
      return ctx.write({
        embeds: [
          createEmbed(
            'error',
            'Remove Failed',
            'Could not remove track: {error}'.replace(
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
