import {
  Command,
  type CommandContext,
  createStringOption,
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
  tts: createStringOption({
    description: 'Generate and play a TTS message on the voice channel',
    required: true,
    max_length: 500,
    min_length: 1
  })
} as any)
@Middlewares(['checkVoice'])
@Declare({
  name: 'tts',
  description: 'Generate and play a TTS message'
})
export default class TTSCommand extends Command {
  public override async run(ctx: CommandContext) {
    const { tts } = ctx.options as { tts: string }
    const t = ctx.t.get(getContextLanguage(ctx))

    if (!(await safeDefer(ctx, true))) return

    const player = await ensurePlayerForVoice(ctx, ctx.channelId)
    if (!player) {
      await ctx.editOrReply({
        embeds: [
          new Embed()
            .setDescription(
              t.player?.noVoiceChannel ||
                'You must be in a voice channel to use this command.'
            )
            .setColor(0xff5252)
        ],
        flags: 64
      })
      return
    }

    const { added } = await resolveAndQueue({
      client: ctx.client,
      player,
      query: tts,
      source: 'speak',
      requester: ctx.interaction.user
    })

    if (!added.length) {
      await ctx.editOrReply({
        content: t.player?.noTrackFound || 'No track found.',
        flags: 64
      })
      return
    }

    await maybeStartPlayback(player)
    await ctx.editOrReply({
      content: t.player?.trackAdded || 'Added to the queue.',
      flags: 64
    })
  }
}
