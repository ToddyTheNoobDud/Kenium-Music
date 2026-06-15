import { Cooldown, CooldownType } from '@slipher/cooldown'
import {
  AttachmentBuilder,
  Command,
  type CommandContext,
  Declare,
  Embed,
  Middlewares
} from 'seyfert'
import { isExpiredInteraction } from '../shared/errorGuard'
import type { QueueLike, TrackLike } from '../shared/helperTypes'
import { playlistTracksToKeniumText } from '../shared/playlist_format'
import { getContextLanguage } from '../utils/i18n'

const getQueueTracks = (
  queue: QueueLike<TrackLike> | undefined
): TrackLike[] => {
  if (!queue) return []
  if (Array.isArray(queue)) return queue.filter(Boolean)
  if (typeof queue.toArray === 'function')
    return queue.toArray().filter(Boolean)
  if (typeof queue.slice === 'function') {
    const size = queue.size ?? queue.length ?? 0
    return queue.slice(0, size).filter(Boolean)
  }
  return Array.from(queue).filter(Boolean)
}

@Cooldown({
  type: CooldownType.User,
  interval: 1000 * 60,
  uses: {
    default: 2
  }
})
@Declare({
  name: 'export',
  description: 'Export the queue'
})
@Middlewares(['checkPlayer', 'checkVoice', 'cooldown'])
export default class exportcmds extends Command {
  public override async run(ctx: CommandContext): Promise<void> {
    try {
      const { client } = ctx
      const lang = getContextLanguage(ctx)
      const t = ctx.t.get(lang)

      const guildId = ctx.guildId
      if (!guildId) return

      const player = client.aqua.players.get(guildId)
      if (!player) return
      const queueTracks = getQueueTracks(player.queue)

      if (queueTracks.length === 0) {
        await ctx.editOrReply({
          embeds: [
            new Embed()
              .setDescription(t.player?.queueEmpty || 'The queue is empty')
              .setColor(0xff0000)
          ],
          flags: 64
        })
        return
      }

      const platformRegex = {
        youtube: /youtube\.com|youtu\.be/,
        soundcloud: /soundcloud\.com/,
        spotify: /spotify\.com/,
        web: /^https?:\/\//
      }

      const platforms = new Set<string>()
      const exportTracks = []

      for (let i = 0; i < queueTracks.length; i++) {
        const song = queueTracks[i]
        if (!song) continue
        const uri = String(song.info?.uri || song.uri || '')
        const title = String(song.info?.title || song.title || 'Unknown')
        const author = String(song.info?.author || song.author || 'Unknown')
        const duration = song.info?.length || song.length || song.duration || 0
        const isrc = song.info?.isrc || null

        exportTracks.push({
          title,
          author,
          uri,
          duration,
          isrc
        })

        if (platformRegex.youtube.test(uri)) {
          platforms.add('youtube')
        } else if (platformRegex.soundcloud.test(uri)) {
          platforms.add('soundcloud')
        } else if (platformRegex.spotify.test(uri)) {
          platforms.add('spotify')
        } else if (platformRegex.web.test(uri)) {
          platforms.add('web')
        } else {
          const colonIndex = uri.indexOf(':')
          if (colonIndex > 0) {
            platforms.add(uri.substring(0, colonIndex))
          }
        }
      }

      const randomId = Math.random().toString(36).substring(2, 10).toUpperCase()
      const queueString = playlistTracksToKeniumText(
        'Kenium Queue',
        exportTracks,
        randomId
      )

      const platformsString = Array.from(platforms).sort().join('_')

      const attachment = new AttachmentBuilder()
        .setDescription('Queue.txt')
        .setName(`Kenium_V4_${platformsString}_${randomId}.txt`)
        .setFile('buffer', Buffer.from(queueString, 'utf8'))

      await ctx.editOrReply({
        embeds: [
          new Embed()
            .setDescription(
              t?.export?.success || 'Exported the queue with URLs for import'
            )
            .setColor(0x100e09)
        ],
        files: [attachment],
        flags: 64
      })
    } catch (error: unknown) {
      if (isExpiredInteraction(error)) return
    }
  }
}
