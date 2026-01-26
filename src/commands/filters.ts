import {
  Command,
  type CommandContext,
  createStringOption,
  Declare,
  Embed,
  Middlewares,
  Options
} from 'seyfert'
import { getContextLanguage } from '../utils/i18n'

@Options({
  filters: createStringOption({
    description: 'Filter to apply',
    required: true,
    choices: [
      { name: '8D', value: '8d' },
      { name: 'Equalizer', value: 'equalizer' },
      { name: 'Karaoke', value: 'karaoke' },
      { name: 'Timescale', value: 'timescale' },
      { name: 'Tremolo', value: 'tremolo' },
      { name: 'Vibrato', value: 'vibrato' },
      { name: 'Rotation', value: 'rotation' },
      { name: 'Distortion', value: 'distortion' },
      { name: 'Channel Mix', value: 'channelMix' },
      { name: 'Low Pass', value: 'lowPass' },
      { name: 'Bassboost', value: 'bassboost' },
      { name: 'Slowmode', value: 'slowmode' },
      { name: 'Nightcore', value: 'nightcore' },
      { name: 'Vaporwave', value: 'vaporwave' },
      { name: 'Clear', value: 'clear' }
    ] as const
  })
})

@Declare({
  name: 'filters',
  description: 'apply some filters'
})
@Middlewares(['checkPlayer', 'checkVoice', 'checkTrack'])
export default class filtersss extends Command {
  public override async run(ctx: CommandContext) {
    try {
      const { client } = ctx
      const lang = getContextLanguage(ctx)
      const t = ctx.t.get(lang)

      const player = client.aqua.players.get(ctx.guildId!)

      const { filters } = ctx.options as { filters: string }

      player.filters.clearFilters()

      switch (filters) {
        case '8d':
          player.filters.set8D(true)
          break
        case 'equalizer':
          player.filters.setEqualizer([{ band: 0, gain: 0.5 }])
          break
        case 'karaoke':
          player.filters.setKaraoke(true)
          break
        case 'timescale':
          player.filters.setTimescale(true, {
            speed: 1.2,
            pitch: 1.2,
            rate: 1.0
          })
          break
        case 'tremolo':
          player.filters.setTremolo(true, { depth: 0.5, frequency: 4 })
          break
        case 'vibrato':
          player.filters.setVibrato(true, { depth: 0.5, frequency: 4 })
          break
        case 'rotation':
          player.filters.setRotation(true, { rotationHz: 0.2 })
          break
        case 'distortion':
          player.filters.setDistortion(true, { distortion: 0.5 })
          break
        case 'channelMix':
          player.filters.setChannelMix(true, {
            leftToLeft: 0.5,
            leftToRight: 0.5,
            rightToLeft: 0.5,
            rightToRight: 0.5
          })
          break
        case 'lowPass':
          player.filters.setLowPass(true, { smoothing: 20 })
          break
        case 'bassboost':
          player.filters.setBassboost(true)
          break
        case 'slowmode':
          player.filters.setSlowmode(true)
          break
        case 'nightcore':
          player.filters.setNightcore(true)
          break
        case 'vaporwave':
          player.filters.setVaporwave(true)
          break
        case 'clear':
          player.filters.clearFilters()
          break
        default:
          return ctx.write({
            content: t.player?.filterInvalid || 'Invalid filter selected.',
            flags: 64
          })
      }

      const appliedText =
        t.player?.filterApplied?.replace('{filter}', filters) ||
        `**Applied ${filters}**`

      await ctx.editOrReply({
        embeds: [new Embed().setDescription(appliedText).setColor('#0x100e09')],
        flags: 64
      })
    } catch (error) {
      if (error.code === 10065) return
    }
  }
}
