import {
  Command,
  type CommandContext,
  createIntegerOption,
  Declare,
  Embed,
  Middlewares,
  Options
} from 'seyfert'
import type { OptionsRecord } from 'seyfert/lib/commands/applications/chat'
import { getContextLanguage } from '../utils/i18n'
import { getErrorCode } from '../utils/interactions'

const options = {
  volume: createIntegerOption({
    description: 'Volume, min is 0 and max is 200',
    max_value: 200,
    min_value: 0,
    required: true
  })
}

@Options(options as unknown as OptionsRecord)

@Declare({
  name: 'volume',
  description: 'Change the volume of the music player in the guild'
})
@Middlewares(['checkPlayer', 'checkVoice', 'checkTrack'])
export default class Volume extends Command {
  public override async run(ctx: CommandContext) {
    try {
      const { options } = ctx
      const { volume } = options as { volume: number }
      const lang = getContextLanguage(ctx)
      const t = ctx.t.get(lang)

      const player = ctx.client.aqua.players.get(ctx.guildId as string)
      if (!player) return

      if (volume < 0 || volume > 200) {
        return ctx.write({
          embeds: [
            new Embed()
              .setColor(0x100e09)
              .setDescription(
                t.volume?.rangeError || 'Use an integer between 0 and 200.'
              )
          ]
        })
      }

      player.setVolume(volume)

      await ctx.editOrReply({
        embeds: [
          new Embed()
            .setDescription(
              (t.player?.volumeSet || 'Volume set to {volume}%.').replace(
                '{volume}',
                volume.toString()
              )
            )
            .setColor(0x100e09)
        ],
        flags: 64
      })
    } catch (error: unknown) {
      if (getErrorCode(error) === 10065) return
    }
  }
}
