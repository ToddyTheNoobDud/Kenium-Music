import {
  Command,
  type CommandContext,
  Declare,
  Embed,
  Middlewares
} from 'seyfert'
import { getContextLanguage } from '../utils/i18n'

@Declare({
  name: 'roulette',
  description: 'Play a random track from the queue'
})

@Middlewares(['checkPlayer', 'checkVoice', 'checkTrack'])
export default class roulettecmds extends Command {
  public override async run(ctx: CommandContext) {
    try {
      const lang = getContextLanguage(ctx)
      const t = ctx.t.get(lang)

      const guildId = ctx.guildId
      if (!guildId) return

      const player = ctx.client.aqua.players.get(guildId)
      if (!player) return

      const queue = player?.queue
      if (!queue || queue.length === 0) {
        return ctx.write({
          embeds: [
            new Embed()
              .setDescription(`❌ ${t.player.queueEmpty}`)
              .setColor(0xff0000)
          ],
          flags: 64
        })
      }

      const randomIndex = Math.floor(Math.random() * queue.length)
      const randomTrack = queue[randomIndex]

      if (queue.splice) {
        queue.splice(randomIndex, 1)
        queue.unshift(randomTrack as any)
      }

      if (player.playing || player.paused) {
        player.stop()
      }

      setTimeout(() => {
        if (!player.playing && !player.paused && player.queue.size > 0) {
          player.play()
        }
      }, 100)

      const trackTitle = randomTrack?.info?.title || 'Unknown Track'
      const trackAuthor = randomTrack?.info?.author || 'Unknown Artist'

      return ctx.write({
        embeds: [
          new Embed()
            .setDescription(
              t.roulette.playingRandom
                .replace('{title}', trackTitle)
                .replace('{author}', trackAuthor)
            )
            .setColor(0x00ff00)
            .setFooter({
              text: `Position: ${randomIndex + 1}/${queue.length + 1}`
            })
        ],
        flags: 64
      })
    } catch (error: any) {
      console.error('Roulette command error:', error)
      const lang = getContextLanguage(ctx)
      const t = ctx.t.get(lang)

      return ctx.write({
        embeds: [
          new Embed()
            .setDescription(`❌ ${t.roulette.error}`)
            .setColor(0xff0000)
        ],
        flags: 64
      })
    }
  }
}
