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
import { getContextLanguage } from '../utils/i18n'

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
      const { client } = ctx
      const guildId = ctx.guildId
      if (!guildId) return

      const voice = await ctx.member?.voice()
      if (!voice?.channelId) return

      const player =
        client.aqua.players.get(guildId) ??
        client.aqua.createConnection({
          guildId: guildId,
          voiceChannel: voice.channelId,
          textChannel: ctx.channelId,
          deaf: true,
          defaultVolume: 65
        })

      const { file } = ctx.options as {
        file: { url: string; filename: string }
      }

      try {
        const result = await client.aqua.resolve({
          query: file.url,
          requester: ctx.interaction.user
        })
        const track = result?.tracks?.[0]
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

        player.queue.add(track)

        if (!player.playing && !player.paused && player.queue.size > 0) {
          player.play()
        }
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
