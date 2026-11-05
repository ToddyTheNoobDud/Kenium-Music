import {
  Command,
  type CommandContext,
  Declare,
  Embed,
  Middlewares
} from 'seyfert'
import { getContextLanguage } from '../utils/i18n.ts'
import { safeDefer } from '../utils/interactions.ts'

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
      if (!guildId) {
        return
      }

      const player = ctx.client.aqua.players.get(guildId)
      if (!player) {
        return
      }

      const queue = player?.queue
      if (queue.size === 0) {
        return ctx.write({
          embeds: [
            new Embed()
              .setDescription(`❌ ${t.player.queueEmpty}`)
              .setColor(0xff0000)
          ],
          flags: 64
        })
      }

      const tracks = queue.toArray()
      const randomIndex = Math.floor(Math.random() * tracks.length)
      const randomTrack = tracks.splice(randomIndex, 1)[0]
      if (!randomTrack) {
        return
      }
      if (!(await safeDefer(ctx, true))) {
        return
      }
      tracks.unshift(randomTrack)
      queue.clear()
      queue.add(...tracks)

      await player.stop()
      await player.play()

      const trackTitle = randomTrack?.info?.title || 'Unknown Track'
      const trackAuthor = randomTrack?.info?.author || 'Unknown Artist'

      return ctx.editOrReply({
        embeds: [
          new Embed()
            .setDescription(
              t.roulette.playingRandom
                .replace('{title}', trackTitle)
                .replace('{author}', trackAuthor)
            )
            .setColor(0x00ff00)
            .setFooter({
              text: `Position: ${randomIndex + 1}/${queue.size + 1}`
            })
        ],
        flags: 64
      })
    } catch (error: unknown) {
      console.error('Roulette command error:', error)
      const lang = getContextLanguage(ctx)
      const t = ctx.t.get(lang)

      return ctx.editOrReply({
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
