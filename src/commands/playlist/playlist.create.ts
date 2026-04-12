import {
  type CommandContext,
  createStringOption,
  Declare,
  Options,
  SubCommand
} from 'seyfert'
import type { OptionsRecord } from 'seyfert/lib/commands/applications/chat'
import { ButtonStyle } from 'seyfert/lib/types'
import { ICONS, LIMITS } from '../../shared/constants'
import type { Playlist } from '../../shared/types'
import { createButtons, createEmbed } from '../../shared/utils'
import { getPlaylistsCollection } from '../../utils/db'
import { getContextTranslations } from '../../utils/i18n'
import { generateSortableId } from '../../utils/simpleDB'

const playlistsCollection = getPlaylistsCollection()

type PlaylistCreateTextLike = {
  invalidName?: string
  nameTooLong?: string
  exists?: string
  alreadyExists?: string
  limitReached?: string
  maxPlaylists?: string
  created?: string
  name?: string
  status?: string
  readyForTracks?: string
  addTracks?: string
  viewPlaylist?: string
}

const options = {
  name: createStringOption({ description: 'Playlist name', required: true })
}

@Declare({
  name: 'create',
  description: 'Create a new playlist'
})
@Options(options as unknown as OptionsRecord)
export class CreateCommand extends SubCommand {
  async run(ctx: CommandContext) {
    const { name } = ctx.options as { name: string }
    const userId = ctx.author.id
    const t = (
      getContextTranslations(ctx) as {
        playlist?: { create?: PlaylistCreateTextLike }
      }
    ).playlist?.create

    if (name.length > LIMITS.MAX_NAME_LENGTH) {
      return ctx.write({
        embeds: [
          createEmbed(
            'error',
            t?.invalidName || 'Invalid Name',
            (
              t?.nameTooLong ||
              'Playlist name must be less than {maxLength} characters.'
            ).replace('{maxLength}', String(LIMITS.MAX_NAME_LENGTH))
          )
        ],
        flags: 64
      })
    }

    const existing = playlistsCollection.findOne(
      {
        userId,
        name
      },
      { fields: ['_id'] }
    )

    if (existing) {
      return ctx.write({
        embeds: [
          createEmbed(
            'error',
            t?.exists || 'Playlist Exists',
            (
              t?.alreadyExists || 'A playlist named "{name}" already exists!'
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
            t?.limitReached || 'Playlist Limit Reached',
            (
              t?.maxPlaylists ||
              'You can only have a maximum of {max} playlists.'
            ).replace('{max}', String(LIMITS.MAX_PLAYLISTS))
          )
        ],
        flags: 64
      })
    }

    const timestamp = new Date().toISOString()
    const playlist: Playlist = {
      _id: generateSortableId(),
      userId,
      name,
      createdAt: timestamp,
      lastModified: timestamp,
      playCount: 0,
      totalDuration: 0,
      trackCount: 0
    }

    playlistsCollection.insert(playlist)

    const embed = createEmbed(
      'success',
      t?.created || 'Playlist Created',
      null,
      [
        {
          name: `${ICONS.playlist} ${t?.name || 'Name'}`,
          value: `**${name}**`,
          inline: true
        },
        {
          name: `${ICONS.star} ${t?.status || 'Status'}`,
          value: t?.readyForTracks || 'Ready for tracks!',
          inline: true
        }
      ]
    )

    const buttons = createButtons([
      {
        id: `add_track_${name}_${userId}`,
        label: t?.addTracks || 'Add Tracks',
        emoji: ICONS.add,
        style: ButtonStyle.Success
      },
      {
        id: `view_playlist_${name}_${userId}`,
        label: t?.viewPlaylist || 'View Playlist',
        emoji: ICONS.playlist,
        style: ButtonStyle.Primary
      }
    ])

    return ctx.write({ embeds: [embed], components: [buttons], flags: 64 })
  }
}
