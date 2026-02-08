import {
  Command,
  type CommandContext,
  Declare,
  Embed,
  Middlewares
} from 'seyfert'
import { getContextLanguage } from '../utils/i18n'

@Declare({
  name: 'clear',
  description: 'Clear the music queue'
})
@Middlewares(['checkPlayer', 'checkVoice', 'checkTrack'])
export default class clearcmds extends Command {
  public override async run(ctx: CommandContext): Promise<void> {
    try {
      const { client } = ctx
      const lang = getContextLanguage(ctx)
      const t = ctx.t.get(lang)

      const guildId = ctx.guildId
      if (!guildId) return

      const player = client.aqua.players.get(guildId)
      if (!player) return

      if (player.queue.length === 0) {
        await ctx.editOrReply({
          embeds: [
            new Embed()
              .setDescription(t.player?.queueEmpty || 'The queue is empty')
              .setColor('#0x100e09')
          ],
          flags: 64
        })
        return
      }

      player.queue.clear()

      await ctx.editOrReply({
        embeds: [
          new Embed()
            .setDescription(t.player?.queueCleared || 'Cleared the queue')
            .setColor('#0x100e09')
        ],
        flags: 64
      })
    } catch (error: any) {
      if (error?.code === 10065) return
    }
  }
}
