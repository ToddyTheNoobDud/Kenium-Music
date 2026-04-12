import { Cooldown, CooldownType } from '@slipher/cooldown'
import type { Player } from 'aqualink'
import {
  Command,
  type CommandContext,
  Container,
  Declare,
  Middlewares,
  type UsingClient
} from 'seyfert'
import { _functions } from '../events/interactionCreate'
import { getContextLanguage } from '../utils/i18n'
import { getErrorCode } from '../utils/interactions'

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
  private createNowPlayingUI(
    player: Player,
    track: {
      title?: string
      uri?: string
      length?: number
      requester?: { username?: string }
      info?: { artworkUrl?: string | null }
    },
    client: UsingClient
  ) {
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
        // Removed the buttons section (type: 1 with button components)
      ]
    })
  }

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

      const embed = this.createNowPlayingUI(player, track, client)
      await ctx.editOrReply({ components: [embed], flags: 64 | 32768 })
    } catch (error: unknown) {
      if (getErrorCode(error) === 10065) return
    }
  }
}
