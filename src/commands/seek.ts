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

@Options({
  time: createIntegerOption({
    description: 'Time to seek (in secs)',
    required: true
  })
} as any)

@Declare({
  name: 'seek',
  description: 'Seek to a specific position in the song'
})
@Middlewares(['checkPlayer', 'checkVoice', 'checkTrack'])
export default class Seek extends Command {
  public override async run(ctx: CommandContext) {
    try {
      const t = ctx.t.get(getContextLanguage(ctx))
      const { client } = ctx

      const guildId = ctx.guildId
      if (!guildId) return

      const player = client.aqua.players.get(guildId)
      if (!player) return
      const { time } = ctx.options as { time: number }

      player.seek(time * 1000)

      await ctx.editOrReply({
        embeds: [
          new Embed().setDescription(t.player.seeked).setColor('#0x100e09')
        ],
        flags: 64
      })
    } catch (error: any) {
      if (error?.code === 10065) return
    }
  }
}
