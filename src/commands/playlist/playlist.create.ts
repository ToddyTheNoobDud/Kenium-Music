import {
  ButtonStyle,
  type CommandContext,
  createStringOption,
  Declare,
  Options,
  SubCommand
} from 'seyfert'
import { ICONS, LIMITS } from '../../shared/constants.ts'
import type { Playlist } from '../../shared/types.ts'
import {
  createButtons,
  createEmbed,
  invalidatePlaylistNameCache
} from '../../shared/utils.ts'
import { getPlaylistsCollection } from '../../utils/db.ts'
import { getContextTranslations } from '../../utils/i18n.ts'
import {
  userPlaylistsLockKey,
  validatePlaylistCreation,
  withPlaylistMutationLock
} from '../../utils/playlistMutations.ts'
import { generateSortableId } from '../../utils/simpleDB.ts'

const playlistsCol = () => getPlaylistsCollection()

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
@Options(options)
export class CreateCommand extends SubCommand {
  async run(ctx: CommandContext) {
    const { name } = ctx.options as { name: string }
    const userId = ctx.author.id
    const t = (
      getContextTranslations(ctx) as {
        playlist?: { create?: PlaylistCreateTextLike }
      }
    ).playlist?.create

    if (validatePlaylistCreation(name, 0) === 'name-too-long') {
      return ctx.write({
        embeds: [
          createEmbed(
            'error',
            t?.invalidName || 'Invalid Name',
            (
              t?.nameTooLong ||
              'Playlist name must be less than {maxLength} characters.'
            ).replace('{maxLength}', String(LIMITS.MAX_NAME_LENGTH)),
            [],
            ctx.client.me?.avatarURL()
          )
        ],
        flags: 64
      })
    }

    const creation = await withPlaylistMutationLock(
      userPlaylistsLockKey(userId),
      () => {
        const existing = playlistsCol().findOne(
          { userId, name },
          { fields: ['_id'] }
        )
        if (existing) return 'exists' as const

        const validation = validatePlaylistCreation(
          name,
          playlistsCol().count({ userId })
        )
        if (validation) return validation

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
        playlistsCol().insert(playlist)
        return null
      }
    )

    if (creation === 'exists') {
      return ctx.write({
        embeds: [
          createEmbed(
            'error',
            t?.exists || 'Playlist Exists',
            (
              t?.alreadyExists || 'A playlist named "{name}" already exists!'
            ).replace('{name}', name),
            [],
            ctx.client.me?.avatarURL()
          )
        ],
        flags: 64
      })
    }

    if (creation === 'playlist-limit') {
      return ctx.write({
        embeds: [
          createEmbed(
            'error',
            t?.limitReached || 'Playlist Limit Reached',
            (
              t?.maxPlaylists ||
              'You can only have a maximum of {max} playlists.'
            ).replace('{max}', String(LIMITS.MAX_PLAYLISTS)),
            [],
            ctx.client.me?.avatarURL()
          )
        ],
        flags: 64
      })
    }

    invalidatePlaylistNameCache(userId)

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
      ],
      ctx.client.me?.avatarURL()
    )

    embed.addFields({
      name: `${ICONS.info} Next Steps`,
      value: `Use \`/playlists add playlist:${name}\` to add tracks.`
    })

    const created = playlistsCol().findOne(
      { userId, name },
      { fields: ['_id'] }
    )
    const components = created
      ? [
          createButtons([
            {
              id: `playlist:view:${created._id}:${userId}`,
              label: t?.viewPlaylist || 'View Playlist',
              emoji: ICONS.playlist,
              style: ButtonStyle.Primary
            }
          ])
        ]
      : []

    return ctx.write({ embeds: [embed], components, flags: 64 })
  }
}
