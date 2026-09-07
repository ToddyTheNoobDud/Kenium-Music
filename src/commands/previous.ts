import {
  Command,
  type CommandContext,
  Declare,
  Embed,
  Middlewares
} from 'seyfert'
import { isExpiredInteraction } from '../shared/errorGuard.ts'
import { playPreviousTrack } from '../shared/playback.ts'
import { getContextLanguage } from '../utils/i18n.ts'
@Declare({
  name: 'previous',
  description: 'Play the previous song'
})
@Middlewares(['checkPlayer', 'checkVoice'])
export default class previoiusCmds extends Command {
  public override async run(ctx: CommandContext): Promise<void> {
    const t = ctx.t.get(getContextLanguage(ctx))
    try {
      const { client } = ctx

      const guildId = ctx.guildId
      if (!guildId) return

      const player = client.aqua.players.get(guildId)
      if (!player) return

      const playedPrevious = await playPreviousTrack(player)

      await ctx.editOrReply({
        embeds: [
          new Embed()
            .setDescription(
              !playedPrevious
                ? '❌ No previous track available'
                : player.playing
                  ? t.player.previousPlayed
                  : t.player.previousAdded || 'Playing/added the previous track'
            )
            .setColor(0x100e09)
        ],
        flags: 64
      })
    } catch (error: unknown) {
      if (isExpiredInteraction(error)) return
    }
  }
}
