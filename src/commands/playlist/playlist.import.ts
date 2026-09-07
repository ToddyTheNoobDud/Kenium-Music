import {
  type Attachment,
  type CommandContext,
  createAttachmentOption,
  createStringOption,
  Declare,
  Embed,
  Options,
  SubCommand
} from 'seyfert'
import { LIMITS } from '../../shared/constants.ts'
import { isExpiredInteraction } from '../../shared/errorGuard.ts'
import { fetchImportFile, ImportFileError } from '../../shared/importFile.ts'
import { parsePlaylistFile } from '../../shared/playlist_format.ts'
import type { Playlist, Track } from '../../shared/types.ts'
import {
  determineSource,
  formatDuration,
  invalidatePlaylistNameCache
} from '../../shared/utils.ts'
import {
  getDatabase,
  getPlaylistsCollection,
  getTracksCollection
} from '../../utils/db.ts'
import { getContextTranslations } from '../../utils/i18n.ts'
import { safeDefer } from '../../utils/interactions.ts'
import {
  calculatePlaylistAggregate,
  limitImportedTracks,
  userPlaylistsLockKey,
  validatePlaylistCreation,
  withPlaylistMutationLock
} from '../../utils/playlistMutations.ts'
import { generateSortableId } from '../../utils/simpleDB.ts'

const ICONS = {
  music: 'Music',
  tracks: 'Tracks',
  import: 'Import',
  playlist: 'Playlist',
  duration: 'Duration'
} as const

const COLORS = {
  primary: 0x100e09,
  success: 0x100e09,
  error: 0x100e09
} as const

const playlistsCol = () => getPlaylistsCollection()
const tracksCol = () => getTracksCollection()
const DEFAULT_IMPORTED_PLAYLIST_NAME = 'Imported Playlist'

type EmbedVariant = 'default' | 'success' | 'error'

type PlaylistImportTextLike = {
  invalidFile?: string
  invalidFileDesc?: string
  nameConflict?: string
  nameConflictDesc?: string
  importFailed?: string
  importFailedDesc?: string
  imported?: string
  name?: string
  tracks?: string
  duration?: string
  limitReached?: string
  maxPlaylists?: string
}

type ImportedTrackLike = {
  title?: string
  uri?: string
  author?: string
  duration?: number
  source?: string
  identifier?: string
  isrc?: string | null
}

type ImportedPlaylistPayload = {
  name?: string
  description?: string
  tracks?: ImportedTrackLike[]
}

const options = {
  file: createAttachmentOption({
    description: 'Playlist file to import',
    required: true
  }),
  name: createStringOption({
    description: 'Custom playlist name (optional)',
    required: false
  })
}

function createEmbed(
  type: EmbedVariant,
  title: string,
  description: string | null = null,
  fields: Array<{ name: string; value: string; inline?: boolean }> = [],
  iconUrl?: string | undefined
) {
  const colors: Record<EmbedVariant, number> = {
    default: COLORS.primary,
    success: COLORS.success,
    error: COLORS.error
  }

  const icons: Record<EmbedVariant, string> = {
    default: ICONS.music,
    success: 'Success',
    error: 'Error'
  }

  const embed = new Embed()
    .setColor(colors[type])
    .setTitle(`${icons[type]} ${title}`)
    .setTimestamp()
    .setFooter({
      text: `${ICONS.tracks} Kenium Music - Playlist System`,
      ...(iconUrl ? { iconUrl } : {})
    })

  if (description) {
    embed.setDescription(`\`\`\`fix\n${description}\n\`\`\``)
  }

  if (fields.length > 0) {
    embed.addFields(fields)
  }

  return embed
}

function isValidTrack(
  track: ImportedTrackLike
): track is Required<Pick<ImportedTrackLike, 'title' | 'author'>> &
  ImportedTrackLike {
  return (
    typeof track.title === 'string' &&
    typeof track.author === 'string' &&
    Boolean(track.title.trim()) &&
    Boolean(track.author.trim())
  )
}

@Declare({
  name: 'import',
  description: 'Import a playlist from a JSON file'
})
@Options(options)
export class ImportCommand extends SubCommand {
  async run(ctx: CommandContext) {
    const { file: attachment, name: providedName } = ctx.options as {
      file: Attachment
      name?: string
    }
    const userId = ctx.author.id
    const t = (
      getContextTranslations(ctx) as {
        playlist?: { import?: PlaylistImportTextLike }
      }
    ).playlist?.import

    try {
      if (!(await safeDefer(ctx, true))) return

      const fileContent = await fetchImportFile(attachment)
      const data = parsePlaylistFile(
        fileContent,
        providedName || DEFAULT_IMPORTED_PLAYLIST_NAME
      ) as ImportedPlaylistPayload | null

      if (
        !data?.name ||
        typeof data.name !== 'string' ||
        !Array.isArray(data.tracks)
      ) {
        return ctx.editOrReply({
          embeds: [
            createEmbed(
              'error',
              t?.invalidFile || 'Invalid File',
              t?.invalidFileDesc ||
                'The file must contain a valid playlist with name and tracks array.',
              [],
              ctx.client.me?.avatarURL()
            )
          ],
          flags: 64
        })
      }

      const validTracks = limitImportedTracks(data.tracks.filter(isValidTrack))
      if (validTracks.length === 0) {
        return ctx.editOrReply({
          embeds: [
            createEmbed(
              'error',
              t?.invalidFile || 'Invalid File',
              'The playlist contains no valid tracks.',
              [],
              ctx.client.me?.avatarURL()
            )
          ],
          flags: 64
        })
      }

      const playlistName = providedName || DEFAULT_IMPORTED_PLAYLIST_NAME
      if (validatePlaylistCreation(playlistName, 0) === 'name-too-long') {
        return ctx.editOrReply({
          embeds: [
            createEmbed(
              'error',
              t?.invalidFile || 'Invalid Playlist Name',
              `Playlist name must be at most ${LIMITS.MAX_NAME_LENGTH} characters.`,
              [],
              ctx.client.me?.avatarURL()
            )
          ],
          flags: 64
        })
      }

      const timestamp = new Date().toISOString()
      const tracksToInsert: Track[] = validTracks.map((track, index) => ({
        _id: generateSortableId(),
        playlistId: '',
        title: track.title,
        uri:
          track.uri ||
          track.identifier ||
          track.isrc ||
          `${track.title} ${track.author}`,
        author: track.author,
        duration: track.duration || 0,
        addedAt: new Date(Date.now() + index).toISOString(),
        addedBy: userId,
        source: track.source || determineSource(track.uri || ''),
        identifier:
          track.identifier ||
          (track.isrc
            ? `isrc:${track.isrc}`
            : `${track.title} ${track.author}`),
        isrc: track.isrc || null
      }))

      let aggregate = calculatePlaylistAggregate(tracksToInsert)
      const importResult = await withPlaylistMutationLock(
        userPlaylistsLockKey(userId),
        () => {
          if (playlistsCol().findOne({ userId, name: playlistName })) {
            return 'exists' as const
          }
          const validation = validatePlaylistCreation(
            playlistName,
            playlistsCol().count({ userId })
          )
          if (validation) return validation

          getDatabase().transaction(() => {
            const playlistId = generateSortableId()
            for (const track of tracksToInsert) track.playlistId = playlistId
            const insertedPlaylist: Playlist = {
              _id: playlistId,
              userId,
              name: playlistName,
              description: data.description || 'Imported playlist',
              createdAt: timestamp,
              lastModified: timestamp,
              playCount: 0,
              totalDuration: 0,
              trackCount: 0
            }
            playlistsCol().insert(insertedPlaylist)
            tracksCol().insert(tracksToInsert)
            aggregate = calculatePlaylistAggregate(
              tracksCol().find({ playlistId }, { fields: ['duration'] })
            )
            playlistsCol().update({ _id: playlistId }, aggregate)
          })
          return null
        }
      )

      if (importResult === 'exists') {
        return ctx.editOrReply({
          embeds: [
            createEmbed(
              'error',
              t?.nameConflict || 'Name Conflict',
              (
                t?.nameConflictDesc ||
                'A playlist named "{name}" already exists!'
              ).replace('{name}', playlistName),
              [],
              ctx.client.me?.avatarURL()
            )
          ],
          flags: 64
        })
      }
      if (importResult === 'playlist-limit') {
        return ctx.editOrReply({
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
        t?.imported || 'Playlist Imported',
        null,
        [
          {
            name: `${ICONS.playlist} ${t?.name || 'Name'}`,
            value: `**${playlistName}**`,
            inline: true
          },
          {
            name: `${ICONS.tracks} ${t?.tracks || 'Tracks'}`,
            value: String(aggregate.trackCount),
            inline: true
          },
          {
            name: `${ICONS.duration} ${t?.duration || 'Duration'}`,
            value: formatDuration(aggregate.totalDuration),
            inline: true
          }
        ],
        ctx.client.me?.avatarURL()
      )

      await ctx.editOrReply({ embeds: [embed], flags: 64 })
    } catch (error) {
      if (isExpiredInteraction(error)) return
      console.error('Import playlist error:', error)
      try {
        await ctx.editOrReply({
          embeds: [
            createEmbed(
              'error',
              t?.importFailed || 'Import Failed',
              error instanceof ImportFileError
                ? error.message
                : (
                    t?.importFailedDesc || 'Could not import playlist: {error}'
                  ).replace(
                    '{error}',
                    error instanceof Error ? error.message : 'Unknown error'
                  ),
              [],
              ctx.client.me?.avatarURL()
            )
          ],
          flags: 64
        })
      } catch (responseError) {
        if (isExpiredInteraction(responseError)) return
        throw responseError
      }
    }
  }
}
