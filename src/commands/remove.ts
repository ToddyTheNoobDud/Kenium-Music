import {
  Command,
  type CommandContext,
  createIntegerOption,
  Declare,
  Embed,
  Middlewares,
  Options
} from 'seyfert'
import type { OptionsRecord } from 'seyfert/lib/commands/applications/chat'
import type { PlayerLike, TrackLike } from '../shared/helperTypes'
import { getContextLanguage } from '../utils/i18n'
import { getErrorCode } from '../utils/interactions'

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

const getQueueItems = (player: PlayerLike | undefined) =>
  Array.isArray(player?.queue) ? (player.queue as TrackLike[]) : []

const options = {
  position: createIntegerOption({
    description: 'remove track from playlist',
    required: true,
    autocomplete: async (interaction: RemoveAutocompleteInteractionLike) => {
      const player = interaction.client.aqua.players.get(
        interaction.guildId || ''
      )
      if (!player?.queue?.length) {
        return interaction.respond([])
      }

      const focusedValue = interaction.getInput?.()?.toLowerCase()

      const choices = getQueueItems(player)
        .slice(0, 25)
        .map((track: TrackLike, index: number): ChoiceLike => {
          const title = String(track.info?.title || track.title || 'Unknown')
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

@Options(options as unknown as OptionsRecord)
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

      player.queue.splice(position - 1, 1)
      await ctx.editOrReply({
        embeds: [
          new Embed().setDescription(t.player?.removedSong).setColor(0x100e09)
        ],
        flags: 64
      })
    } catch (error: unknown) {
      if (getErrorCode(error) === 10065) return
    }
  }
}
