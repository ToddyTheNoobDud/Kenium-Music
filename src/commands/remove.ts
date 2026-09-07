import type { Track } from 'aqualink'
import {
  Command,
  type CommandContext,
  createIntegerOption,
  Declare,
  Embed,
  Middlewares,
  Options
} from 'seyfert'
import { isExpiredInteraction } from '../shared/errorGuard.ts'
import type { TrackLike } from '../shared/helperTypes.ts'
import {
  getQueueItems,
  getQueueSize,
  getTrackTitle
} from '../shared/nowPlaying.ts'
import { getContextLanguage } from '../utils/i18n.ts'

function formatTrackName(name: string) {
  return name.length <= 100 ? name : `${name.substring(0, 97)}...`
}

type RemoveAutocompleteInteractionLike = {
  guildId?: string | null
  client: CommandContext['client']
  getInput?: () => string | undefined
  respond: (
    options: Array<{ name: string; value: number }>
  ) => Promise<unknown> | unknown
}

type ChoiceLike = {
  name: string
  value: number
}

const options = {
  position: createIntegerOption({
    description: 'remove track from playlist',
    required: true,
    autocomplete: async (interaction: RemoveAutocompleteInteractionLike) => {
      const player = interaction.client.aqua.players.get(
        interaction.guildId || ''
      )
      if (getQueueSize(player) === 0) {
        return interaction.respond([])
      }

      const focusedValue = interaction.getInput?.()?.toLowerCase()

      const choices = getQueueItems(player)
        .slice(0, 25)
        .map((track: TrackLike, index: number): ChoiceLike => {
          const title = getTrackTitle(track) || 'Unknown'
          const name = formatTrackName(`${index + 1}: ${title}`)
          return { name, value: index + 1 }
        })
        .filter(
          (choice: ChoiceLike) =>
            !focusedValue || choice.name.toLowerCase().includes(focusedValue)
        )

      const validChoices = choices.filter(
        (choice: ChoiceLike) =>
          choice.name.length >= 1 && choice.name.length <= 100
      )

      return interaction.respond(validChoices.slice(0, 25))
    }
  })
}

@Options(options)
@Middlewares(['checkPlayer', 'checkVoice'])
@Declare({
  name: 'remove',
  description: 'remove track from the queue'
})
export default class removecmds extends Command {
  public override async run(ctx: CommandContext): Promise<void> {
    try {
      const t = ctx.t.get(getContextLanguage(ctx))
      const { client } = ctx

      const player = client.aqua.players.get(ctx.guildId as string)
      if (!player) return
      const { position } = ctx.options as { position: number }

      const target = getQueueItems<Track>(player)[position - 1]
      if (!target) {
        await ctx.editOrReply({
          embeds: [
            new Embed()
              .setDescription('❌ No track at that position.')
              .setColor(0x100e09)
          ],
          flags: 64
        })
        return
      }

      player.queue.remove(target)
      await ctx.editOrReply({
        embeds: [
          new Embed().setDescription(t.player?.removedSong).setColor(0x100e09)
        ],
        flags: 64
      })
    } catch (error: unknown) {
      if (isExpiredInteraction(error)) return
    }
  }
}
