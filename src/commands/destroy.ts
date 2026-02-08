import {
  Command,
  type CommandContext,
  Declare,
  Embed,
  Middlewares
} from 'seyfert'
import { getContextLanguage } from '../utils/i18n'

@Declare({
  name: 'destroy',
  description: 'destroy the music'
})
@Middlewares(['checkPlayer', 'checkVoice'])
export default class destroycmd extends Command {
  public override async run(ctx: CommandContext): Promise<void> {
    try {
      const { client } = ctx
      const lang = getContextLanguage(ctx)
      const t = ctx.t.get(lang)

      const guildId = ctx.guildId
      if (!guildId) return

      const player = client.aqua.players.get(guildId)
      if (!player) return

      player.destroy()

      await ctx.editOrReply({
        embeds: [
          new Embed()
            .setDescription(t.player?.destroyed || 'Destroyed the music')
            .setColor('#0x100e09')
        ],
        flags: 64
      })
    } catch (error: any) {
      if (error?.code === 10065) return
    }
  }
}
