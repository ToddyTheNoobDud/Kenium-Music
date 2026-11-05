import {
  Command,
  type CommandContext,
  Declare,
  Embed,
  Middlewares
} from 'seyfert'
import { isExpiredInteraction } from '../shared/errorGuard.ts'
import { getContextLanguage } from '../utils/i18n.ts'

@Declare({
  name: 'stop',
  description: 'Stop the music player in the guild.'
})
@Middlewares(['checkPlayer', 'checkVoice'])
export default class skipCmds extends Command {
  public override async run(ctx: CommandContext): Promise<void> {
    try {
      const { client } = ctx
      const t = ctx.t.get(getContextLanguage(ctx))
      const player = client.aqua.players.get(ctx.guildId as string)
      if (!player) {
        return
      }

      await player.stop()

      await ctx.editOrReply({
        embeds: [
          new Embed().setDescription(t.player?.stopped).setColor(0x100e09)
        ],
        flags: 64
      })
    } catch (error: unknown) {
      if (isExpiredInteraction(error)) {
        return
      }
      throw error
    }
  }
}
