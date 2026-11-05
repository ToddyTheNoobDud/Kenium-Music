import {
  type CommandContext,
  createStringOption,
  Declare,
  Options,
  SubCommand
} from 'seyfert'
import {
  createEmbed,
  handlePlaylistAutocomplete,
  invalidatePlaylistNameCache
} from '../../shared/utils.ts'
import {
  getDatabase,
  getPlaylistsCollection,
  getTracksCollection
} from '../../utils/db.ts'
import { getContextTranslations } from '../../utils/i18n.ts'

const playlistsCol = () => getPlaylistsCollection()
const tracksCol = () => getTracksCollection()

const options = {
  name: createStringOption({
    description: 'Playlist name',
    required: true,
    autocomplete: async (interaction) => {
      return handlePlaylistAutocomplete(interaction, playlistsCol())
    }
  })
}
@Declare({
  name: 'delete',
  description: '🗑️ Delete a playlist'
})
@Options(options)
export class DeleteCommand extends SubCommand {
  async run(ctx: CommandContext<typeof options>) {
    const { name: playlistName } = ctx.options
    const userId = ctx.author.id
    const t = getContextTranslations(ctx).playlist.delete

    const playlist = playlistsCol().findOne(
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
            ),
            [],
            ctx.client.me?.avatarURL()
          )
        ],
        flags: 64
      })
    }

    getDatabase().transaction(() => {
      const playlistId = playlist._id
      if (playlistId) {
        tracksCol().delete({ playlistId })
        playlistsCol().delete({ _id: playlistId })
      }
    })
    invalidatePlaylistNameCache(userId)

    const embed = createEmbed(
      'success',
      t?.deleted || 'Playlist Deleted',
      (t?.deletedDesc || 'Successfully deleted playlist "{name}"').replace(
        '{name}',
        playlistName
      ),
      [],
      ctx.client.me?.avatarURL()
    )
    return ctx.write({ embeds: [embed], flags: 64 })
  }
}
