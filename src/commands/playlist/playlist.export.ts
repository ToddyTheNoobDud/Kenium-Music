import {
  AttachmentBuilder,
  type CommandContext,
  createStringOption,
  Declare,
  Embed,
  Options,
  SubCommand
} from 'seyfert'
import type { OptionsRecord } from 'seyfert/lib/commands/applications/chat'
import { handlePlaylistAutocomplete } from '../../shared/utils'
import { getPlaylistsCollection, getTracksCollection } from '../../utils/db'
import { getContextTranslations } from '../../utils/i18n'

const ICONS = {
  music: 'Music',
  tracks: 'Tracks',
  export: 'Export'
} as const

const COLORS = {
  primary: 0x100e09,
  success: 0x100e09,
  error: 0x100e09
} as const

const playlistsCollection = getPlaylistsCollection()
const tracksCollection = getTracksCollection()

type PlaylistViewTextLike = {
  notFound?: string
  notFoundDesc?: string
}

type EmbedVariant = 'default' | 'success' | 'error'

const options = {
  name: createStringOption({
    description: 'Playlist name',
    required: true,
    autocomplete: async (interaction) =>
      handlePlaylistAutocomplete(interaction, playlistsCollection)
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

@Declare({
  name: 'export',
  description: 'Export a playlist'
})
@Options(options as unknown as OptionsRecord)
export class ExportCommand extends SubCommand {
  async run(ctx: CommandContext) {
    const { name: playlistName } = ctx.options as { name: string }
    const userId = ctx.author.id
    const t = (
      getContextTranslations(ctx) as {
        playlist?: { view?: PlaylistViewTextLike }
      }
    ).playlist?.view

    const playlist = playlistsCollection.findOne({
      userId,
      name: playlistName
    })

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
