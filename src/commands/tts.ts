import {
  Command,
  type CommandContext,
  createStringOption,
  Declare,
  Middlewares,
  Options
} from 'seyfert'
import { getContextLanguage } from '../utils/i18n'

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

    const guildId = ctx.guildId
    if (!guildId) return

    const player = ctx.client.aqua.players.get(guildId)
    const t = ctx.t.get(getContextLanguage(ctx))
    if (!player) {
      const voice = await ctx.member?.voice()
      if (!voice?.channelId) return

      await ctx.client.aqua.createConnection({
        guildId: guildId as string,
        voiceChannel: voice.channelId,
        textChannel: ctx.channelId,
        deaf: true,
        defaultVolume: 65
      })
      return
    }

    if (player) {
      const resolved = await ctx.client.aqua.resolve({
        query: tts,
        source: 'speak',
        requester: ctx.interaction.user
      })
      const track = resolved?.tracks?.[0]
      if (track) {
        player.queue.add(track)
        if (!player.playing && !player.paused && player.queue.size > 0) {
          player.play()
        }
      }
      ctx.write({
        content: t.player?.trackAdded,
        flags: 64
      })
    }
  }
}
