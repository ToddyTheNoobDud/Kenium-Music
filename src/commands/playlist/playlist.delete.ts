import {
  Declare,
  Options,
  SubCommand,
  createStringOption,
  type CommandContext
} from 'seyfert'
import { createEmbed, handlePlaylistAutocomplete } from '../../shared/utils'
import {
  getDatabase,
  getPlaylistsCollection,
  getTracksCollection
} from '../../utils/db'
import { getContextTranslations } from '../../utils/i18n'

import type { Playlist } from '../../shared/types'

const playlistsCollection = getPlaylistsCollection()
@Declare({
  name: 'delete',
  description: '🗑️ Delete a playlist'
})
// biome-ignore lint/suspicious/noExplicitAny: bypassed for exactOptionalPropertyTypes
@Options({
  name: createStringOption({
    description: 'Playlist name',
    required: true,
    autocomplete: async (interaction) => {
      const playlistsCollection = getPlaylistsCollection()
      return handlePlaylistAutocomplete(interaction, playlistsCollection)
    }
  })
} as any)
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
      const playlistId = playlist._id
      if (playlistId) {
        getTracksCollection().delete({ playlistId })
        playlistsCollection.delete({ _id: playlistId })
      }
    })

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
