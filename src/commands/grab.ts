import {
  Command,
  type CommandContext,
  Container,
  Declare,
  Middlewares
} from 'seyfert'
import { _functions } from '../events/interactionCreate'
import { getContextLanguage } from '../utils/i18n'
import { getErrorCode } from '../utils/interactions'

interface GrabPlayer {
  position?: number
  volume?: number
  loop?: string
  queue?: unknown[]
  current?: GrabTrack
}

interface GrabTrack {
  uri?: string
  title?: string
  length?: number
  info?: {
    artworkUrl?: string
  }
}

@Declare({
  name: 'grab',
  description: 'Gives the current song and send to dms. (No VC needed)'
})
@Middlewares(['checkPlayer'])
export default class Grab extends Command {
  private createGrabNowPlayingUI(
    player: GrabPlayer,
    track: GrabTrack,
    client: unknown
  ) {
    const { position = 0, volume = 0, loop } = player || {}
    const {
      title = 'Unknown',
      uri = '',
      length = 0,
      requester
    } = (track as {
      title: string
      uri: string
      length: number
      requester: { username: string }
    }) || {}
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
          content: `**${platform.emoji} Now Playing** | **Queue size**: ${
            player?.queue?.length || 0
          }`
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
              content: `${volumeIcon} \`${volume}%\` ${loopIcon}`
            },
            {
              type: 10,
              content: `Requester: \`${requester?.username || 'Unknown'}\``
            }
          ],
          accessory: {
            type: 11,
            media: {
              url:
                track?.info?.artworkUrl ||
                // biome-ignore lint/suspicious/noExplicitAny: library requirement
                (client as any)?.me?.avatarURL?.({ extension: 'webp' }) ||
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

      const guildId = ctx.guildId
      if (!guildId) return

      const player = client.aqua.players.get(guildId) as unknown as GrabPlayer

      if (!player?.current) {
        return ctx.write({
          content: t.player?.noTrack || 'No song is currently playing.',
          flags: 64
        })
      }

      const song = player.current

      // Create the same UI as nowplaying but without buttons
      const trackUI = this.createGrabNowPlayingUI(
        player,
        song as unknown as GrabTrack,
        client
      )

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
      if (getErrorCode(error) === 10065) return

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
