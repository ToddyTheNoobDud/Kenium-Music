import {
  Command,
  type CommandContext,
  createIntegerOption,
  Declare,
  Embed,
  Middlewares,
  Options
} from 'seyfert'
import { getContextLanguage } from '../utils/i18n'

function formatTrackName(name: string) {
  return name.length <= 100 ? name : `${name.substring(0, 97)}...`
}
@Options({
  position: createIntegerOption({
    description: 'remove track from playlist',
    required: true,
    autocomplete: async (interaction: any) => {
      const player = interaction.client.aqua.players.get(interaction.guildId)
      if (!player?.queue?.length) {
        return interaction.respond([])
      }

      const focusedValue = interaction.getInput()?.toLowerCase()

      const choices = player.queue
        .slice(0, 25)
        .map((track: any, index: number) => {
          const name = formatTrackName(`${index + 1}: ${track.info.title}`)
          return { name, value: index + 1 }
        })
        .filter(
          (choice: any) =>
            !focusedValue || choice.name.toLowerCase().includes(focusedValue)
        )

      const validChoices = choices.filter(
        (choice: any) => choice.name.length >= 1 && choice.name.length <= 100
      )

      return interaction.respond(validChoices.slice(0, 25))
    }
  })
} as any)
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
          new Embed()
            .setDescription(t.player?.removedSong)
            .setColor('#0x100e09')
        ],
        flags: 64
      })
    } catch (error: any) {
      if (error?.code === 10065) return
    }
  }
}
