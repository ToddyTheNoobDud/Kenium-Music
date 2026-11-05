import {
  AttachmentBuilder,
  type CommandContext,
  createStringOption,
  Declare,
  Embed,
  Options,
  SubCommand
} from 'seyfert'
import { playlistTracksToKeniumText } from '../../shared/playlist_format.ts'
import { handlePlaylistAutocomplete } from '../../shared/utils.ts'
import { getPlaylistsCollection, getTracksCollection } from '../../utils/db.ts'
import { getContextTranslations } from '../../utils/i18n.ts'

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

type EmbedVariant = 'default' | 'success' | 'error'

const options = {
  name: createStringOption({
    description: 'Playlist name',
    required: true,
    autocomplete: async (interaction) =>
      handlePlaylistAutocomplete(interaction, getPlaylistsCollection())
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

@Declare({
  name: 'export',
  description: 'Export a playlist'
})
@Options(options)
export class ExportCommand extends SubCommand {
  async run(ctx: CommandContext<typeof options>) {
    const { name: playlistName } = ctx.options
    const userId = ctx.author.id
    const t = getContextTranslations(ctx).playlist.view

    const playlist = getPlaylistsCollection().findOne({
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
            ),
            [],
            ctx.client.me?.avatarURL()
          )
        ],
        flags: 64
      })
    }

    const tracks = getTracksCollection().find(
      { playlistId: playlist._id },
      { sort: { addedAt: 1 } }
    )
    const randomId = Math.random().toString(36).substring(2, 10).toUpperCase()
    const content = playlistTracksToKeniumText(playlistName, tracks, randomId)
    const fileName = `${playlistName}.txt`
    const buffer = Buffer.from(content, 'utf-8')
    const attachment = new AttachmentBuilder()
      .setFile('buffer', buffer)
      .setName(fileName)

    await ctx.write({ files: [attachment], flags: 64 })
  }
}
