import {
  AttachmentBuilder,
  Declare,
  Embed,
  Options,
  SubCommand,
  createStringOption,
  type CommandContext
} from 'seyfert'
import type { Playlist, Track } from '../../shared/types'
import { handlePlaylistAutocomplete } from '../../shared/utils'
import { getPlaylistsCollection, getTracksCollection } from '../../utils/db'
import { getContextTranslations } from '../../utils/i18n'

// Modern Emoji Set
const ICONS = {
  music: '🎵',
  tracks: '💿',
  export: '📤',
  artist: '🎤',
  duration: '⏱️'
}

// Modern Black Theme Colors
const COLORS = {
  primary: '#0x100e09',
  success: '#0x100e09',
  error: '#0x100e09'
}

const playlistsCollection = getPlaylistsCollection()
const tracksCollection = getTracksCollection()

function createEmbed(
  type: string,
  title: string,
  description: string | null = null,
  fields: Array<{ name: string; value: string; inline?: boolean }> = []
) {
  const colors = {
    default: COLORS.primary,
    success: COLORS.success,
    error: COLORS.error
  }

  const icons = {
    default: ICONS.music,
    success: '✨',
    error: '❌'
  }

  const embed = new Embed()
    .setColor((colors as any)[type] || colors.default)
    .setTitle(`${(icons as any)[type] || icons.default} ${title}`)
    .setTimestamp()
    .setFooter({
      text: `${ICONS.tracks} Kenium Music • Playlist System`,
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


@Declare({
  name: 'export',
  description: '📤 Export a playlist'
})
// biome-ignore lint/suspicious/noExplicitAny: bypassed for exactOptionalPropertyTypes
@Options({
  name: createStringOption({
    description: 'Playlist name',
    required: true,
    autocomplete: async (interaction) => {
      return handlePlaylistAutocomplete(interaction, playlistsCollection)
    }
  })
} as any)
export class ExportCommand extends SubCommand {
  async run(ctx: CommandContext) {
    const { name } = ctx.options as { name: string }
    const playlistName = name
    const userId = ctx.author.id
    const t = getContextTranslations(ctx)

    const playlist = playlistsCollection.findOne({
      userId,
      name: playlistName
    })
    if (!playlist) {
      return await ctx.write({
        embeds: [
          createEmbed(
            'error',
            t.playlist?.view?.notFound || 'Playlist Not Found',
            (
              t.playlist?.view?.notFoundDesc ||
              'No playlist named "{name}" exists!'
            ).replace('{name}', playlistName)
          )
        ],
        flags: 64
      })
    }

    const tracks = tracksCollection.find(
      { playlistId: playlist._id },
      { sort: { addedAt: 1 } }
    )
    const exportData = {
      ...playlist,
      tracks
    }

    const content = JSON.stringify(exportData, null, 2)
    const fileName = `${playlistName}.json`
    const buffer = Buffer.from(content, 'utf-8')
    const attachment = new AttachmentBuilder()
      .setFile('buffer', buffer)
      .setName(fileName)

    await ctx.write({ files: [attachment], flags: 64 })
  }
}
