import {
  Command,
  type CommandContext,
  Declare,
  Embed,
  Middlewares,
  Container
} from 'seyfert'
import { getContextLanguage } from '../utils/i18n'
import { _functions } from '../events/interactionCreate'

@Declare({
  name: 'grab',
  description: 'Grab current song and send to dms. (No VC needed)'
})
@Middlewares(['checkPlayer'])
export default class Grab extends Command {
  private formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  private createGrabNowPlayingUI(player: any, track: any, client: any) {
    const { position = 0, volume = 0, loop } = player || {}
    const { title = 'Unknown', uri = '', length = 0, requester } = track || {}
    const platform = _functions.getPlatform(uri)
    const volumeIcon = volume === 0 ? '🔇' : volume < 50 ? '🔈' : '🔊'
    const loopIcon = loop === 'track' ? '🔂' : loop === 'queue' ? '🔁' : '▶️'
    const truncatedTitle = _functions.truncateText(title)
    const capitalizedTitle = truncatedTitle.replace(/\b\w/g, (l) =>
      l.toUpperCase()
    )

    return new Container({
      components: [
        {
          type: 10,
          content: `**${platform.emoji} Now Playing** | **Queue size**: ${player?.queue?.length || 0}`
        },
        { type: 14, divider: true, spacing: 1 },
        {
          type: 9,
          components: [
            {
              type: 10,
              content: `## **[\`${capitalizedTitle}\`](${uri})**\n\`${_functions.formatTime(position)}\` / \`${_functions.formatTime(length)}\``
            },
            {
              type: 10,
              content: `${volumeIcon} \`${volume}%\` ${loopIcon} Requester: \`${requester?.username || 'Unknown'}\``
            }
          ],
          accessory: {
            type: 11,
            media: {
              url:
                track?.info?.artworkUrl ||
                client?.me?.avatarURL?.({ extension: 'webp' }) ||
                ''
            }
          }
        },
        { type: 14, divider: true, spacing: 2 }
      ]
    })
  }

  public override async run(ctx: CommandContext) {
    try {
      const { client } = ctx
      const lang = getContextLanguage(ctx)
      const t = ctx.t.get(lang)

      const player = client.aqua.players.get(ctx.guildId!)

      if (!player?.current) {
        return ctx.write({
          content: t.player?.noTrack || 'No song is currently playing.',
          flags: 64
        })
      }

      const song = player.current
      const guild = await ctx.guild()

      // Create the same UI as nowplaying but without buttons
      const trackUI = this.createGrabNowPlayingUI(player, song, client)

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
    } catch (error) {
      console.error('Grab Command Error:', error)
      if (error.code === 10065) return

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
