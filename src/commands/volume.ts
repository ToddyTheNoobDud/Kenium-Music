import {
  Command,
  type CommandContext,
  createIntegerOption,
  Declare,
  Embed,
  Middlewares,
  Options
} from 'seyfert'
import { getContextLanguage } from '../utils/i18n'

@Options({
  volume: createIntegerOption({
    description: 'Volume, min is 0 and max is 200',
    max_value: 200,
    min_value: 0,
    required: true
  })
})

@Declare({
  name: 'volume',
  description: 'Change the volume of the music player in the guild'
})
@Middlewares(['checkPlayer', 'checkVoice', 'checkTrack'])
export default class Volume extends Command {
  async run(ctx: CommandContext) {
    try {
      const { options } = ctx
      const { volume } = options as { volume: number }
      const lang = getContextLanguage(ctx)
      const t = ctx.t.get(lang)

      const player = ctx.client.aqua.players.get(ctx.guildId!)

      if (volume < 0 || volume > 200) {
        return ctx.write({
          embeds: [
            new Embed()
              .setColor('#0x100e09')
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
            .setColor('#0x100e09')
        ],
        flags: 64
      })
    } catch (error) {
      if (error.code === 10065) return
    }
  }
}
