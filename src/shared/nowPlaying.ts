import {
  ActionRow,
  Container,
  type Message,
  Separator,
  type WebhookMessage
} from 'seyfert'
import { MUSIC_PLATFORMS, PLAYBACK_E } from './emojis.ts'
import type {
  AvatarClientLike,
  PlayerLike,
  QueueLike,
  TrackLike
} from './helperTypes.ts'
import { getTrackRequester } from './trackRequester.ts'

const MAX_TITLE_LENGTH = 60
const FLAGS_UPDATE = 32768 | 4096
const TITLE_SANITIZE_RE = /[^\w\s\-_.]/g
const WORD_START_RE = /\b\w/g

export const getQueueLength = (queue?: QueueLike<TrackLike> | null) =>
  queue?.size ?? 0

type QueueSourceLike<TTrack> =
  | { queue?: Pick<QueueLike<TTrack>, 'size' | 'toArray'> }
  | null
  | undefined

export const getTrackTitle = (track: TrackLike | null | undefined) =>
  track?.info?.title || track?.title || ''

export const getQueueItems = <TTrack = TrackLike>(
  player: QueueSourceLike<TTrack>
): TTrack[] => player?.queue?.toArray() ?? []

export const getQueueSize = (player: QueueSourceLike<TrackLike>): number =>
  player?.queue?.size ?? 0

export const formatTime = (ms: number | undefined) => {
  const s = Math.floor((ms || 0) / 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

export const truncateText = (
  text: string | undefined,
  maxLength = MAX_TITLE_LENGTH
) => {
  if (!text) {
    return ''
  }
  if (text.length <= maxLength) {
    return text
  }

  const processed = String(text).replace(TITLE_SANITIZE_RE, '').trim()
  if (processed.length <= maxLength) {
    return processed
  }
  return `${processed.slice(0, maxLength - 3).trimEnd()}...`
}

const titleCaseWordBoundaries = (text: string | undefined) =>
  String(text || '').replace(WORD_START_RE, (c) => c.toUpperCase())

export const getPlatform = (uri: string | null | undefined) => {
  if (!uri) {
    return MUSIC_PLATFORMS.youtube
  }

  const value = uri.toLowerCase()
  if (value.includes('soundcloud')) {
    return MUSIC_PLATFORMS.soundcloud
  }
  if (value.includes('spotify')) {
    return MUSIC_PLATFORMS.spotify
  }
  if (value.includes('deezer')) {
    return MUSIC_PLATFORMS.deezer
  }
  if (value.includes('youtu')) {
    return MUSIC_PLATFORMS.youtube
  }
  return MUSIC_PLATFORMS.youtube
}

export const createNowPlayingEmbed = (
  player: Partial<
    Pick<PlayerLike, 'position' | 'volume' | 'loop' | 'paused' | 'queue'>
  >,
  track: TrackLike,
  client: AvatarClientLike
) => {
  const requester = getTrackRequester(track.requester)
  const container = createNowPlayingContainer({
    position: player.position,
    volume: player.volume,
    loop: player.loop,
    queueLength: getQueueLength(player.queue),
    title: track.title,
    uri: track.uri,
    length: track.length,
    requesterName: requester.username || 'Unknown',
    artworkUrl:
      track.info?.artworkUrl ||
      client.me?.avatarURL({ extension: 'webp' }) ||
      ''
  })
  return container.addComponents(
    new ActionRow({
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
          label: player.paused ? `${PLAYBACK_E.resume}` : `${PLAYBACK_E.pause}`,
          style: player.paused ? 3 : 2,
          custom_id: player.paused ? 'resume' : 'pause'
        },
        { type: 2, label: `${PLAYBACK_E.skip}`, style: 2, custom_id: 'skip' },
        {
          type: 2,
          label: `${PLAYBACK_E.volume_up}`,
          style: 2,
          custom_id: 'volume_up'
        }
      ]
    }),
    new Separator({ type: 14, divider: true, spacing: 2 })
  )
}

export const updateNowPlayingEmbed = async (
  player: PlayerLike,
  client: AvatarClientLike
) => {
  const msg = player.nowPlayingMessage as
    | Message
    | WebhookMessage
    | null
    | undefined
  if (!msg || !player.current) {
    if (player) {
      player.nowPlayingMessage = null
    }
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

export const deleteNowPlayingMessage = async (
  player: Pick<PlayerLike, 'nowPlayingMessage'> | null | undefined
): Promise<void> => {
  const message = player?.nowPlayingMessage as
    | Message
    | WebhookMessage
    | null
    | undefined
  if (player) {
    player.nowPlayingMessage = null
  }
  if (!message) {
    return
  }
  await message.delete().catch(() => {})
}

type NowPlayingUIOptions = {
  position?: number
  volume?: number
  loop?: PlayerLike['loop']
  queueLength?: number
  title?: string
  uri?: string | null
  length?: number
  requesterName?: string
  artworkUrl?: string
}

export const createNowPlayingContainer = (options: NowPlayingUIOptions) => {
  const {
    position = 0,
    volume = 0,
    loop,
    queueLength = 0,
    title = 'Unknown',
    uri = '',
    length = 0,
    requesterName = 'Unknown',
    artworkUrl = ''
  } = options

  const platform = getPlatform(uri)
  const volumeIcon =
    volume === 0
      ? '\uD83D\uDD07'
      : volume < 50
        ? '\uD83D\uDD08'
        : '\uD83D\uDD0A'
  const loopIcon =
    loop === 'track' || loop === 1
      ? '\uD83D\uDD02'
      : loop === 'queue' || loop === 2
        ? '\uD83D\uDD01'
        : '\u25B6\uFE0F'
  const displayTitle = titleCaseWordBoundaries(truncateText(title))

  return new Container({
    components: [
      {
        type: 10,
        content: `**${platform.emoji} Now Playing** | **Queue size**: ${queueLength}`
      },
      { type: 14, divider: true, spacing: 1 },
      {
        type: 9,
        components: [
          {
            type: 10,
            content: `## **[\`${displayTitle}\`](${uri ?? ''})**\n\`${formatTime(position)}\` / \`${formatTime(length)}\``
          },
          {
            type: 10,
            content: `${volumeIcon} \`${volume}%\` ${loopIcon} Requester: \`${requesterName}\``
          }
        ],
        accessory: {
          type: 11,
          media: {
            url: artworkUrl
          }
        }
      },
      { type: 14, divider: true, spacing: 2 }
    ]
  })
}
