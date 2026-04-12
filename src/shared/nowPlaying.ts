import { Container } from 'seyfert'
import { MUSIC_PLATFORMS, PLAYBACK_E } from './emojis'
import type {
  AvatarClientLike,
  PlayerLike,
  QueueLike,
  TrackLike
} from './helperTypes'

const MAX_TITLE_LENGTH = 60
const FLAGS_UPDATE = 36864
const TITLE_SANITIZE_RE = /[^\w\s\-_.]/g
const WORD_START_RE = /\b\w/g

export const getQueueLength = (queue?: QueueLike<TrackLike> | null) =>
  queue?.size ?? queue?.length ?? 0

export const formatTime = (ms: number | undefined) => {
  const s = Math.floor((ms || 0) / 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

export const truncateText = (
  text: string | undefined,
  maxLength = MAX_TITLE_LENGTH
) => {
  if (!text) return ''
  if (text.length <= maxLength) return text

  const processed = String(text).replace(TITLE_SANITIZE_RE, '').trim()
  if (processed.length <= maxLength) return processed
  return `${processed.slice(0, maxLength - 3).trimEnd()}...`
}

const titleCaseWordBoundaries = (text: string | undefined) =>
  String(text || '').replace(WORD_START_RE, (c) => c.toUpperCase())

export const getPlatform = (uri: string | undefined) => {
  if (!uri) return MUSIC_PLATFORMS.youtube

  const value = uri.toLowerCase()
  if (value.includes('soundcloud')) return MUSIC_PLATFORMS.soundcloud
  if (value.includes('spotify')) return MUSIC_PLATFORMS.spotify
  if (value.includes('deezer')) return MUSIC_PLATFORMS.deezer
  if (value.includes('youtu')) return MUSIC_PLATFORMS.youtube
  return MUSIC_PLATFORMS.youtube
}

export const createNowPlayingEmbed = (
  player: PlayerLike,
  track: TrackLike,
  client: AvatarClientLike
) => {
  const { position = 0, volume = 0, loop, paused } = player || {}
  const { title = 'Unknown', uri = '', length = 0, requester } = track || {}

  const platform = getPlatform(uri)
  const volumeIcon = volume === 0 ? '🔇' : volume < 50 ? '🔈' : '🔊'
  const loopIcon = loop === 'track' ? '🔂' : loop === 'queue' ? '🔁' : '▶️'
  const displayTitle = titleCaseWordBoundaries(truncateText(title))
  const me = client?.me as
    | {
        avatarURL?: (options?: {
          extension?: string
        }) => string | null | undefined
      }
    | undefined
  const artworkUrl =
    track?.info?.artworkUrl ||
    (typeof me?.avatarURL === 'function'
      ? me.avatarURL({ extension: 'webp' })
      : undefined) ||
    ''

  return new Container({
    components: [
      {
        type: 10,
        content: `**${platform.emoji} Now Playing** | **Queue size**: ${getQueueLength(player?.queue)}`
      },
      { type: 14, divider: true, spacing: 1 },
      {
        type: 9,
        components: [
          {
            type: 10,
            content: `## **[\`${displayTitle}\`](${uri})**\n\`${formatTime(position)}\` / \`${formatTime(length)}\``
          },
          {
            type: 10,
            content: `${volumeIcon} \`${volume}%\` ${loopIcon} Requester: \`${requester?.username || 'Unknown'}\``
          }
        ],
        accessory: {
          type: 11,
          media: {
            url: artworkUrl
          }
        }
      },
      { type: 14, divider: true, spacing: 2 },
      {
        type: 1,
        components: [
          {
            type: 2,
            label: `${PLAYBACK_E.volume_down}`,
            style: 2,
            custom_id: 'volume_down'
          },
          {
            type: 2,
            label: `${PLAYBACK_E.previous}`,
            style: 2,
            custom_id: 'previous'
          },
          {
            type: 2,
            label: paused ? `${PLAYBACK_E.resume}` : `${PLAYBACK_E.pause}`,
            style: paused ? 3 : 2,
            custom_id: paused ? 'resume' : 'pause'
          },
          { type: 2, label: `${PLAYBACK_E.skip}`, style: 2, custom_id: 'skip' },
          {
            type: 2,
            label: `${PLAYBACK_E.volume_up}`,
            style: 2,
            custom_id: 'volume_up'
          }
        ]
      },
      { type: 14, divider: true, spacing: 2 }
    ]
  })
}

export const updateNowPlayingEmbed = async (
  player: PlayerLike,
  client: AvatarClientLike
) => {
  const msg = player?.nowPlayingMessage
  if (!msg?.edit || !player?.current) {
    if (player) player.nowPlayingMessage = null
    return
  }

  try {
    await msg.edit({
      components: [createNowPlayingEmbed(player, player.current, client)],
      flags: FLAGS_UPDATE
    })
  } catch {
    player.nowPlayingMessage = null
  }
}
