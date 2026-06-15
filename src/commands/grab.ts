import { Command, type CommandContext, Declare, Middlewares } from 'seyfert'
import { isExpiredInteraction } from '../shared/errorGuard'
import { createNowPlayingContainer } from '../shared/nowPlaying'
import { getContextLanguage } from '../utils/i18n'

@Declare({
  name: 'grab',
  description: 'Gives the current song and send to dms. (No VC needed)'
})
@Middlewares(['checkPlayer'])
export default class Grab extends Command {
  public override async run(ctx: CommandContext) {
    try {
      const { client } = ctx
      const lang = getContextLanguage(ctx)
      const t = ctx.t.get(lang)

      const guildId = ctx.guildId
      if (!guildId) return

      const player = client.aqua.players.get(guildId)

      if (!player?.current) {
        return ctx.write({
          content: t.player?.noTrack || 'No song is currently playing.',
          flags: 64
        })
      }

      const song = player.current

      const artworkUrl =
        song?.info?.artworkUrl ||
        // biome-ignore lint/suspicious/noExplicitAny: library requirement
        (client as any)?.me?.avatarURL?.({ extension: 'webp' }) ||
        ''

      const trackUI = createNowPlayingContainer({
        position: player.position,
        volume: player.volume,
        loop: player.loop as string,
        queueLength: player.queue?.length || 0,
        title: song.title,
        uri: song.uri,
        length: song.length,
        requesterName: song.requester?.username || 'Unknown',
        artworkUrl
      })

      try {
        await ctx.author.write({ components: [trackUI], flags: 32768 })
        return ctx.write({
          content:
            t?.grab?.sentToDm ||
            "✅ I've sent you the track details in your DMs.",
          flags: 64
        })
      } catch (error) {
        console.error('DM Error:', error)
        return ctx.write({
          content:
            t?.grab?.dmError ||
            "❌ I couldn't send you a DM. Please check your privacy settings.",
          flags: 64
        })
      }
    } catch (error: unknown) {
      console.error('Grab Command Error:', error)
      if (isExpiredInteraction(error)) return

      const lang = getContextLanguage(ctx)
      const t = ctx.t.get(lang)

      return ctx.write({
        content:
          t?.grab?.dmError || 'An error occurred while grabbing the song.',
        flags: 64
      })
    }
  }
}
