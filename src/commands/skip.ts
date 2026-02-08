import {
  Command,
  type CommandContext,
  Declare,
  Embed,
  Middlewares
} from 'seyfert'
import { getContextLanguage } from '../utils/i18n'

@Declare({
  name: 'skip',
  description: 'skip the music'
})
@Middlewares(['checkPlayer', 'checkVoice', 'checkTrack'])
export default class skipCmds extends Command {
  public override async run(ctx: CommandContext): Promise<void> {
    try {
      const { client } = ctx
      const t = ctx.t.get(getContextLanguage(ctx))

      const player = client.aqua.players.get(ctx.guildId as string)
      if (!player || player.queue.length === 0) {
        await ctx.editOrReply({
          embeds: [
            new Embed()
              .setDescription(t.player?.queueEmpty)
              .setColor('#0x100e09')
          ],
          flags: 64
        })
        return
      }
      player.skip()

      await ctx.editOrReply({
        embeds: [
          new Embed().setDescription(t.player?.skipped).setColor('#0x100e09')
        ],
        flags: 64
      })
    } catch (error: any) {
      if (error?.code === 10065) return
    }
  }
}
