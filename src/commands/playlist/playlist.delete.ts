import {
  type CommandContext,
  createStringOption,
  Declare,
  Options,
  SubCommand
} from 'seyfert'
import { createEmbed, handlePlaylistAutocomplete } from '../../shared/utils'
import {
  getPlaylistsCollection,
  getTracksCollection,
  getDatabase
} from '../../utils/db'
import { getContextTranslations } from '../../utils/i18n'

const playlistsCollection = getPlaylistsCollection()
@Declare({
  name: 'delete',
  description: '🗑️ Delete a playlist'
})
@Options({
  name: createStringOption({
    description: 'Playlist name',
    required: true,
    autocomplete: async (interaction: any) => {
      return handlePlaylistAutocomplete(interaction, playlistsCollection)
    }
  })
})
export class DeleteCommand extends SubCommand {
  async run(ctx: CommandContext) {
    const { name: playlistName } = ctx.options as { name: string }
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
            t.playlist?.delete?.notFound || 'Playlist Not Found',
            (
              t.playlist?.delete?.notFoundDesc ||
              'No playlist named "{name}" exists!'
            ).replace('{name}', playlistName)
          )
        ],
        flags: 64
      })
    }

    getDatabase().transaction(() => {
      getTracksCollection().delete({ playlistId: playlist._id })
      playlistsCollection.delete({ _id: playlist._id })
    })

    const db = getDatabase()
    db.vacuum()
    db.checkpoint()

    const embed = createEmbed(
      'success',
      t.playlist?.delete?.deleted || 'Playlist Deleted',
      (
        t.playlist?.delete?.deletedDesc ||
        'Successfully deleted playlist "{name}"'
      ).replace('{name}', playlistName)
    )
    return ctx.write({ embeds: [embed], flags: 64 })
  }
}
