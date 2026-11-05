import {
  Command,
  type CommandContext,
  createStringOption,
  Declare,
  Embed,
  Middlewares,
  Options
} from 'seyfert'
import { EMBED_COLOR } from '../shared/constants.ts'
import { isExpiredInteraction } from '../shared/errorGuard.ts'
import { getContextLanguage } from '../utils/i18n.ts'
import { safeDefer } from '../utils/interactions.ts'

const options = {
  filters: createStringOption({
    description: 'Choose an audio filter preset.',
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
}

@Options(options)

@Declare({
  name: 'filters',
  description: 'Apply an audio filter to the current track.'
})
@Middlewares(['checkPlayer', 'checkVoice', 'checkTrack'])
export default class FiltersCommand extends Command {
  public override async run(ctx: CommandContext<typeof options>) {
    try {
      const { client } = ctx
      const lang = getContextLanguage(ctx)
      const t = ctx.t.get(lang)

      if (!(await safeDefer(ctx, true))) {
        return
      }

      const guildId = ctx.guildId
      if (!guildId) {
        return
      }

      const player = client.aqua.players.get(guildId)
      if (!player) {
        await ctx.editOrReply({
          content: t.player?.noPlayer || 'No music player found.',
          flags: 64
        })
        return
      }

      const { filters } = ctx.options

      await player.filters.clearFilters()

      switch (filters) {
        case '8d':
          await player.filters.set8D(true)
          break
        case 'equalizer':
          await player.filters.setEqualizer([{ band: 0, gain: 0.5 }])
          break
        case 'karaoke':
          await player.filters.setKaraoke(true)
          break
        case 'timescale':
          await player.filters.setTimescale(true, {
            speed: 1.2,
            pitch: 1.2,
            rate: 1.0
          })
          break
        case 'tremolo':
          await player.filters.setTremolo(true, { depth: 0.5, frequency: 4 })
          break
        case 'vibrato':
          await player.filters.setVibrato(true, { depth: 0.5, frequency: 4 })
          break
        case 'rotation':
          await player.filters.setRotation(true, { rotationHz: 0.2 })
          break
        case 'distortion':
          await player.filters.setDistortion(true, { sinScale: 0.5 })
          break
        case 'channelMix':
          await player.filters.setChannelMix(true, {
            leftToLeft: 0.5,
            leftToRight: 0.5,
            rightToLeft: 0.5,
            rightToRight: 0.5
          })
          break
        case 'lowPass':
          await player.filters.setLowPass(true, { smoothing: 20 })
          break
        case 'bassboost':
          await player.filters.setBassboost(true)
          break
        case 'slowmode':
          await player.filters.setSlowmode(true)
          break
        case 'nightcore':
          await player.filters.setNightcore(true)
          break
        case 'vaporwave':
          await player.filters.setVaporwave(true)
          break
        case 'clear':
          break
        default:
          await ctx.editOrReply({
            content: t.player?.filterInvalid || 'Invalid filter selected.',
            flags: 64
          })
          return
      }

      const filterName = t.filters?.[filters] || filters
      const appliedText =
        filters === 'clear'
          ? t.player?.filtersCleared || 'Cleared all filters.'
          : t.player?.filterApplied?.replace('{filter}', filterName) ||
            `Applied **${filterName}** filter.`

      await ctx.editOrReply({
        embeds: [new Embed().setDescription(appliedText).setColor(EMBED_COLOR)],
        flags: 64
      })
    } catch (error: unknown) {
      if (isExpiredInteraction(error)) {
        return
      }
      console.error('filters command error:', error)
    }
  }
}
