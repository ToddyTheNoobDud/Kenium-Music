import { Cooldown, CooldownType } from '@slipher/cooldown'
import {
  Command,
  type CommandContext,
  createAttachmentOption,
  Declare,
  Embed,
  Middlewares,
  Options
} from 'seyfert'
import {
  ensurePlayerForVoice,
  maybeStartPlayback,
  resolveAndQueue
} from '../shared/playback'
import { getContextLanguage } from '../utils/i18n'
import { safeDefer } from '../utils/interactions'

@Options({
  file: createAttachmentOption({
    description: 'what u want to play?',
    required: true
  })
})
@Declare({
  name: 'play-file',
  description: 'Play a file from your computer.'
})
@Cooldown({
  type: CooldownType.User,
  interval: 1000 * 60,
  uses: {
    default: 2
  }
})
@Middlewares(['cooldown', 'checkVoice'])
export default class PlayFile extends Command {
  public override async run(ctx: CommandContext) {
    const lang = getContextLanguage(ctx)
    const thele = ctx.t.get(lang)

    try {
      if (!(await safeDefer(ctx, true))) return

      const player = await ensurePlayerForVoice(ctx, ctx.channelId)
      if (!player) {
        await ctx.editOrReply({
          embeds: [
            new Embed()
              .setDescription(
                thele.player?.noVoiceChannel ||
                  'You must be in a voice channel to use this command.'
              )
              .setColor(0xff5252)
          ],
          flags: 64
        })
        return
      }

      const { file } = ctx.options as {
        file: { url: string; filename: string }
      }

      try {
        const { added } = await resolveAndQueue({
          client: ctx.client,
          player,
          query: file.url,
          requester: ctx.interaction.user
        })
        const track = added[0]
        if (!track) {
          await ctx.editOrReply({
            embeds: [
              new Embed()
                .setDescription(thele.player.noTrackFound)
                .setColor('#0x100e09')
            ],
            flags: 64
          })
          return
        }

        await maybeStartPlayback(player)
        await ctx.editOrReply({
          embeds: [
            new Embed()
              .setDescription(thele.player.fileAdded)
              .setColor('#0x100e09')
          ],
          flags: 64
        })
      } catch (error) {
        console.log(error)
        await ctx.editOrReply({
          embeds: [
            new Embed()
              .setDescription(thele.errors.commandError)
              .setColor(0xff5252)
          ],
          flags: 64
        })
      }
    } catch (error: any) {
      if (error?.code === 10065) return
      await ctx.editOrReply({
        embeds: [
          new Embed()
            .setDescription(thele.errors.commandError)
            .setColor(0xff5252)
        ],
        flags: 64
      })
    }
  }
}
