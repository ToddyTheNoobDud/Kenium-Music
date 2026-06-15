import {
  Command,
  type CommandContext,
  Declare,
  Embed,
  Middlewares
} from 'seyfert'
import { isExpiredInteraction } from '../shared/errorGuard'
import { getContextLanguage } from '../utils/i18n'

@Declare({
  name: 'restart',
  description: 'Restart the music'
})
@Middlewares(['checkPlayer', 'checkVoice', 'checkTrack'])
export default class restartStuff extends Command {
  public override async run(ctx: CommandContext): Promise<void> {
    try {
      const t = ctx.t.get(getContextLanguage(ctx))
      const { client } = ctx

      const player = client.aqua.players.get(String(ctx.guildId))
      if (!player) return

      player.replay()

      await ctx.editOrReply({
        embeds: [
          new Embed().setDescription(t.player?.restarted).setColor(0x100e09)
        ],
        flags: 64
      })
    } catch (error: unknown) {
      if (isExpiredInteraction(error)) return
    }
  }
}
