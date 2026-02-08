import {
  Declare,
  Options,
  SubCommand,
  createStringOption,
  type CommandContext
} from 'seyfert'
import { ButtonStyle } from 'seyfert/lib/types'
import { ICONS, LIMITS } from '../../shared/constants'
import type { Playlist } from '../../shared/types'
import { createButtons, createEmbed } from '../../shared/utils'
import { getPlaylistsCollection } from '../../utils/db'
import { getContextTranslations } from '../../utils/i18n'

const playlistsCollection = getPlaylistsCollection()

@Declare({
  name: 'create',
  description: '🎧 Create a new playlist'
})
// biome-ignore lint/suspicious/noExplicitAny: bypassed for exactOptionalPropertyTypes
@Options({
  name: createStringOption({ description: 'Playlist name', required: true })
} as any)
export class CreateCommand extends SubCommand {
  async run(ctx: CommandContext) {
    const { name } = ctx.options as { name: string }
    const userId = ctx.author.id
    const t = getContextTranslations(ctx)

    if (name.length > LIMITS.MAX_NAME_LENGTH) {
      return ctx.write({
        embeds: [
          createEmbed(
            'error',
            t.playlist?.create?.invalidName || 'Invalid Name',
            (
              t.playlist?.create?.nameTooLong ||
              'Playlist name must be less than {maxLength} characters.'
            ).replace('{maxLength}', String(LIMITS.MAX_NAME_LENGTH))
          )
        ],
        flags: 64
      })
    }

    const existing = playlistsCollection.findOne({
      userId,
      name
    })

    if (existing) {
      return ctx.write({
        embeds: [
          createEmbed(
            'error',
            t.playlist?.create?.exists || 'Playlist Exists',
            (
              t.playlist?.create?.alreadyExists ||
              'A playlist named "{name}" already exists!'
            ).replace('{name}', name)
          )
        ],
        flags: 64
      })
    }

    const userPlaylistCount = playlistsCollection.count({ userId })

    if (userPlaylistCount >= LIMITS.MAX_PLAYLISTS) {
      return ctx.write({
        embeds: [
          createEmbed(
            'error',
            t.playlist?.create?.limitReached || 'Playlist Limit Reached',
            (
              t.playlist?.create?.maxPlaylists ||
              'You can only have a maximum of {max} playlists.'
            ).replace('{max}', String(LIMITS.MAX_PLAYLISTS))
          )
        ],
        flags: 64
      })
    }

    const timestamp = new Date().toISOString()
    const playlist: Playlist = {
      _id: `pl_${Math.random().toString(36).slice(2, 11)}_${Date.now()}`,
      userId,
      name,
      createdAt: timestamp,
      lastModified: timestamp,
      playCount: 0,
      totalDuration: 0,
      trackCount: 0
    }

    playlistsCollection.insert(playlist as any)

    const embed = createEmbed(
      'success',
      t.playlist?.create?.created || 'Playlist Created',
      null,
      [
        {
          name: `${ICONS.playlist} ${t.playlist?.create?.name || 'Name'}`,
          value: `**${name}**`,
          inline: true
        },
        {
          name: `${ICONS.star} ${t.playlist?.create?.status || 'Status'}`,
          value: t.playlist?.create?.readyForTracks || 'Ready for tracks!',
          inline: true
        }
      ]
    )

    const buttons = createButtons([
      {
        id: `add_track_${name}_${userId}`,
        label: t.playlist?.create?.addTracks || 'Add Tracks',
        emoji: ICONS.add,
        style: ButtonStyle.Success
      },
      {
        id: `view_playlist_${name}_${userId}`,
        label: t.playlist?.create?.viewPlaylist || 'View Playlist',
        emoji: ICONS.playlist,
        style: ButtonStyle.Primary
      }
    ])

    return ctx.write({ embeds: [embed], components: [buttons], flags: 64 })
  }
}
