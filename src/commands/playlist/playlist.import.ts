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
import type { OptionsRecord } from 'seyfert/lib/commands/applications/chat'
import type { Playlist, Track } from '../../shared/types'
import {
  getDatabase,
  getPlaylistsCollection,
  getTracksCollection
} from '../../utils/db'
import { getContextTranslations } from '../../utils/i18n'
import { generateSortableId } from '../../utils/simpleDB'

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

const playlistsCollection = getPlaylistsCollection()
const tracksCollection = getTracksCollection()

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
}

type ImportedTrackLike = {
  title?: string
  uri?: string
  author?: string
  duration?: number
  source?: string
  identifier?: string
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
  fields: Array<{ name: string; value: string; inline?: boolean }> = []
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
      iconUrl:
        'https://toddythenoobdud.github.io/0a0f3c0476c8b495838fa6a94c7e88c2.png'
    })

  if (description) {
    embed.setDescription(`\`\`\`fix\n${description}\n\`\`\``)
  }

  if (fields.length > 0) {
    embed.addFields(fields)
  }

  return embed
}

function formatDuration(ms: number): string {
  if (!ms || ms === 0) return '00:00'
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function determineSource(uri: string): string {
  if (!uri) return 'Unknown'
  if (uri.includes('youtube.com') || uri.includes('youtu.be')) return 'YouTube'
  if (uri.includes('spotify.com')) return 'Spotify'
  if (uri.includes('soundcloud.com')) return 'SoundCloud'
  return 'Music'
}

function isValidTrack(
  track: ImportedTrackLike
): track is Required<
  Pick<ImportedTrackLike, 'title' | 'uri' | 'author' | 'duration'>
> &
  ImportedTrackLike {
  return (
    typeof track.title === 'string' &&
    typeof track.uri === 'string' &&
    typeof track.author === 'string' &&
    typeof track.duration === 'number'
  )
}

@Declare({
  name: 'import',
  description: 'Import a playlist from a JSON file'
})
@Options(options as unknown as OptionsRecord)
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
      const response = await fetch(attachment.url)
      const data = (await response.json()) as ImportedPlaylistPayload

      if (
        !data.name ||
        typeof data.name !== 'string' ||
        !Array.isArray(data.tracks)
      ) {
        return ctx.write({
          embeds: [
            createEmbed(
              'error',
              t?.invalidFile || 'Invalid File',
              t?.invalidFileDesc ||
                'The file must contain a valid playlist with name and tracks array.'
            )
          ],
          flags: 64
        })
      }

      const validTracks = data.tracks.filter(isValidTrack)
      if (validTracks.length === 0) {
        return ctx.write({
          embeds: [
            createEmbed(
              'error',
              t?.invalidFile || 'Invalid File',
              'The playlist contains no valid tracks.'
            )
          ],
          flags: 64
        })
      }

      const playlistName = providedName || data.name
      const existing = playlistsCollection.findOne({
        userId,
        name: playlistName
      })
      if (existing) {
        return ctx.write({
          embeds: [
            createEmbed(
              'error',
              t?.nameConflict || 'Name Conflict',
              (
                t?.nameConflictDesc ||
                'A playlist named "{name}" already exists!'
              ).replace('{name}', playlistName)
            )
          ],
          flags: 64
        })
      }

      const timestamp = new Date().toISOString()
      const totalDuration = validTracks.reduce(
        (sum, track) => sum + (track.duration || 0),
        0
      )

      try {
        getDatabase().transaction(() => {
          const insertedPlaylist: Playlist = {
            _id: generateSortableId(),
            userId,
            name: playlistName,
            description: data.description || 'Imported playlist',
            createdAt: timestamp,
            lastModified: timestamp,
            playCount: 0,
            totalDuration,
            trackCount: validTracks.length
          }

          playlistsCollection.insert(insertedPlaylist)

          const tracksToInsert: Track[] = validTracks.map((track) => ({
            _id: generateSortableId(),
            playlistId: insertedPlaylist._id,
            title: track.title,
            uri: track.uri,
            author: track.author,
            duration: track.duration,
            addedAt: timestamp,
            addedBy: userId,
            source: track.source || determineSource(track.uri),
            identifier: track.identifier || ''
          }))

          tracksCollection.insert(tracksToInsert)
        })
      } catch (dbError) {
        console.error('Database error importing playlist:', dbError)
        return ctx.write({
          embeds: [
            createEmbed(
              'error',
              t?.importFailed || 'Import Failed',
              (
                t?.importFailedDesc || 'Could not save playlist: {error}'
              ).replace(
                '{error}',
                dbError instanceof Error ? dbError.message : 'Unknown error'
              )
            )
          ],
          flags: 64
        })
      }

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
            value: String(validTracks.length),
            inline: true
          },
          {
            name: `${ICONS.duration} ${t?.duration || 'Duration'}`,
            value: formatDuration(totalDuration),
            inline: true
          }
        ]
      )

      await ctx.write({ embeds: [embed], flags: 64 })
    } catch (error) {
      console.error('Import playlist error:', error)
      await ctx.write({
        embeds: [
          createEmbed(
            'error',
            t?.importFailed || 'Import Failed',
            (
              t?.importFailedDesc || 'Could not import playlist: {error}'
            ).replace(
              '{error}',
              error instanceof Error ? error.message : 'Unknown error'
            )
          )
        ],
        flags: 64
      })
    }
  }
}
