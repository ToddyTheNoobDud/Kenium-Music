import { Cooldown, CooldownType } from '@slipher/cooldown'
import { Command, type CommandContext, Declare, Middlewares } from 'seyfert'
import { isExpiredInteraction } from '../shared/errorGuard'
import { createNowPlayingContainer } from '../shared/nowPlaying'
import { getContextLanguage } from '../utils/i18n'

@Cooldown({
  type: CooldownType.User,
  interval: 1000 * 60,
  uses: { default: 2 }
})
@Declare({
  name: 'nowplaying',
  description: 'Displays the currently playing song.'
})
@Middlewares(['cooldown', 'checkPlayer'])
export default class nowplayngcmds extends Command {
  public override async run(ctx: CommandContext): Promise<void> {
    try {
      const { client } = ctx
      const lang = getContextLanguage(ctx)
      const t = ctx.t.get(lang)

      const guildId = ctx.guildId
      if (!guildId) return

      const player = client.aqua.players.get(guildId)
      if (!player) return

      const track = player.current

      if (!track) {
        await ctx.editOrReply({
          content: t?.player?.noTrack || '❌ There is no music playing.',
          flags: 64
        })
        return
      }

      const artworkUrl =
        track?.info?.artworkUrl ||
        client?.me?.avatarURL?.({ extension: 'webp' }) ||
        ''

      const embed = createNowPlayingContainer({
        position: player.position,
        volume: player.volume,
        loop: player.loop as string,
        queueLength: player.queue?.length || 0,
        title: track.title,
        uri: track.uri,
        length: track.length,
        requesterName: track.requester?.username || 'Unknown',
        artworkUrl
      })
      await ctx.editOrReply({ components: [embed], flags: 64 | 32768 })
    } catch (error: unknown) {
      if (isExpiredInteraction(error)) return
    }
  }
}
