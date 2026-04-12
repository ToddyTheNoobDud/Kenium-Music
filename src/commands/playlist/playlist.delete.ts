import {
  type CommandContext,
  createStringOption,
  Declare,
  Options,
  SubCommand
} from 'seyfert'
import type { OptionsRecord } from 'seyfert/lib/commands/applications/chat'
import { createEmbed, handlePlaylistAutocomplete } from '../../shared/utils'
import {
  getDatabase,
  getPlaylistsCollection,
  getTracksCollection
} from '../../utils/db'
import { getContextTranslations } from '../../utils/i18n'

const playlistsCollection = getPlaylistsCollection()

type PlaylistDeleteTextLike = {
  notFound?: string
  notFoundDesc?: string
  deleted?: string
  deletedDesc?: string
}

const options = {
  name: createStringOption({
    description: 'Playlist name',
    required: true,
    autocomplete: async (interaction) => {
      const playlistsCollection = getPlaylistsCollection()
      return handlePlaylistAutocomplete(interaction, playlistsCollection)
    }
  })
}
@Declare({
  name: 'delete',
  description: '🗑️ Delete a playlist'
})
@Options(options as unknown as OptionsRecord)
export class DeleteCommand extends SubCommand {
  async run(ctx: CommandContext) {
    const { name: playlistName } = ctx.options as { name: string }
    const userId = ctx.author.id
    const t = (
      getContextTranslations(ctx) as {
        playlist?: { delete?: PlaylistDeleteTextLike }
      }
    ).playlist?.delete

    const playlist = playlistsCollection.findOne(
      {
        userId,
        name: playlistName
      },
      { fields: ['_id'] }
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
            )
          )
        ],
        flags: 64
      })
    }

    getDatabase().transaction(() => {
      const playlistId = playlist._id
      if (playlistId) {
        getTracksCollection().delete({ playlistId })
        playlistsCollection.delete({ _id: playlistId })
      }
    })

    const embed = createEmbed(
      'success',
      t?.deleted || 'Playlist Deleted',
      (t?.deletedDesc || 'Successfully deleted playlist "{name}"').replace(
        '{name}',
        playlistName
      )
    )
    return ctx.write({ embeds: [embed], flags: 64 })
  }
}
