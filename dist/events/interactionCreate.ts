import { createEvent, Container } from 'seyfert'
import { MUSIC_PLATFORMS } from '../shared/emojis'

const MAX_TITLE_LENGTH = 60
const VOLUME_STEP = 10
const MAX_VOLUME = 100
const MIN_VOLUME = 0
const PROGRESS_BAR_LENGTH = 10
const PROGRESS_CHAR = '█'
const EMPTY_CHAR = '▬'
const PROGRESS_FULL = PROGRESS_CHAR.repeat(PROGRESS_BAR_LENGTH)
const PROGRESS_EMPTY = EMPTY_CHAR.repeat(PROGRESS_BAR_LENGTH)
const FLAGS_UPDATE = 4096 | 32768

const EXCLUDED_PREFIXES = new Set([
  'queue_', 'select_', 'platform_', 'lyrics_', 'add_more_',
  'add_track_', 'edit_description_', 'remove_track_',
  'playlist_next_', 'playlist_prev_', 'create_playlist_',
  'manage_playlist_', 'view_playlist_', 'shuffle_playlist_',
  'play_playlist_', 'help_'
])

const PREFIX_LENGTHS = (() => {
  const lengths = new Set()
  for (const p of EXCLUDED_PREFIXES) lengths.add(p.length)
  return [...lengths]
})()

// Unified utility functions
const formatTime = ms => {
  const totalSeconds = Math.floor((ms || 0) / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = n => n.toString().padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

const truncateText = (text, maxLength = MAX_TITLE_LENGTH) => {
  if (!text || text.length <= maxLength) return text || ''
  const processedText = text.replace(/[^\w\s-_.]/g, '').trim()
  return processedText.length > maxLength
    ? processedText.slice(0, Math.max(0, maxLength - 3)).trimEnd() + '...'
    : processedText
}

const getPlatform = uri => {
  const lowerUri = (uri || '').toLowerCase()
  if (lowerUri.includes('youtu')) return MUSIC_PLATFORMS.youtube
  if (lowerUri.includes('soundcloud')) return MUSIC_PLATFORMS.soundcloud
  if (lowerUri.includes('spotify')) return MUSIC_PLATFORMS.spotify
  if (lowerUri.includes('deezer')) return MUSIC_PLATFORMS.deezer
  return MUSIC_PLATFORMS.youtube
}

const createProgressBar = (position, length) => {
  const denom = length > 0 ? length : 1
  const progress = Math.min(PROGRESS_BAR_LENGTH, ((position / denom) * PROGRESS_BAR_LENGTH) | 0)
  return `[${PROGRESS_FULL.substring(0, progress)}⦿${PROGRESS_EMPTY.substring(0, PROGRESS_BAR_LENGTH - progress)}]`
}

const setPlayerVolume = async (player, newVolume) => {
  if (!player) return
  if (typeof player.setVolume === 'function') {
    try {
      await player.setVolume(newVolume)
    } catch (err) {
      try { player.volume = newVolume } catch (e) {}
    }
  } else {
    try { player.volume = newVolume } catch (e) {}
  }
}

const isExcludedInteraction = customId => {
  if (!customId) return false
  for (const len of PREFIX_LENGTHS) {
    if (customId.length >= len && EXCLUDED_PREFIXES.has(customId.substring(0, len))) return true
  }
  return false
}

export const createEmbed = (player, track, client) => {
  const { position = 0, volume = 0, loop, paused } = player || {}
  const { title = 'Unknown', uri = '', length = 0, requester } = track || {}
  const platform = getPlatform(uri)
  const volumeIcon = volume === 0 ? '🔇' : volume < 50 ? '🔈' : '🔊'
  const loopIcon = loop === 'track' ? '🔂' : loop === 'queue' ? '🔁' : '▶️'
  const playPauseIcon = paused ? '▶️' : '⏸️'
  const truncatedTitle = truncateText(title).replace(/\b\w/g, l => l.toUpperCase())
  const requesterName = requester?.username || 'Unknown'

  return new Container({
    components: [
      { type: 10, content: `**${platform.emoji} Now Playing**` },
      { type: 14, divider: true, spacing: 1 },
      {
        type: 9,
        components: [
          {
            type: 10,
            content: `## **[\`${truncatedTitle}\`](${uri})**\n\`${formatTime(position)}\` / \`${formatTime(length)}\``
          },
          {
            type: 10,
            content: `${volumeIcon} \`${volume}%\` ${loopIcon} Requester: \`${requesterName}\``
          }
        ],
        accessory: {
          type: 11,
          media: { url: track.thumbnail || client.me.avatarURL({ extension: 'webp' }) || '' }
        }
      },
      { type: 14, divider: true, spacing: 2 },
      {
        type: 1,
        components: [
          { type: 2, label: '🔉', style: 2, custom_id: 'volume_down' },
          { type: 2, label: '⏮️', style: 2, custom_id: 'previous' },
          { type: 2, label: playPauseIcon, style: paused ? 3 : 2, custom_id: paused ? 'resume' : 'pause' },
          { type: 2, label: '⏭️', style: 2, custom_id: 'skip' },
          { type: 2, label: '🔊', style: 2, custom_id: 'volume_up' }
        ]
      },
      { type: 14, divider: true, spacing: 2 },
    ],
  })
}

const actionHandlers = {
  volume_down: async player => {
    const newVolume = Math.max(MIN_VOLUME, (player.volume || 0) - VOLUME_STEP)
    await setPlayerVolume(player, newVolume)
    return { message: `🔉 Volume set to ${newVolume}%`, shouldUpdate: true }
  },
  previous: player => {
    if (!player.previous) return { message: '❌ No previous track available', shouldUpdate: false }
    if (player.current) player.queue?.unshift(player.current)
    player.queue?.unshift(player.previous)
    try { player.stop() } catch (e) {}
    return { message: '⏮️ Playing the previous track.', shouldUpdate: false }
  },
  resume: async player => {
    if (typeof player.pause === 'function') await player.pause(false)
    return { message: '▶️ Resumed playback.', shouldUpdate: true }
  },
  pause: async player => {
    if (typeof player.pause === 'function') await player.pause(true)
    return { message: '⏸️ Paused playback.', shouldUpdate: true }
  },
  skip: async player => {
    if (!player.queue || !player.queue.length) return { message: '❌ No tracks in queue to skip to.', shouldUpdate: false }
    if (typeof player.skip === 'function') await player.skip()
    return { message: '⏭️ Skipped to the next track.', shouldUpdate: false }
  },
  volume_up: async player => {
    const newVolume = Math.min(MAX_VOLUME, (player.volume || 0) + VOLUME_STEP)
    await setPlayerVolume(player, newVolume)
    return { message: `🔊 Volume set to ${newVolume}%`, shouldUpdate: true }
  }
}

const updateNowPlayingEmbed = async (player, client) => {
  if (!player?.nowPlayingMessage || !player?.current) {
    player.nowPlayingMessage = null
    return
  }

  try {
    const updatedEmbed = createEmbed(player, player.current, client)
    await player.nowPlayingMessage.edit({
      components: [updatedEmbed],
      flags: FLAGS_UPDATE
    })
  } catch (error) {
    player.nowPlayingMessage = null
    if (error?.code !== 10008) console.error('Failed to update now playing message:', error?.message ?? error)
  }
}

export default createEvent({
  data: { name: 'interactionCreate' },
  run: async (interaction, client) => {
    if (!interaction.isButton?.() || !interaction.customId || !interaction.guildId) return
    if (isExcludedInteraction(interaction.customId)) return

    const player = client.aqua?.players?.get?.(interaction.guildId)
    if (!player?.current) {
      return interaction.write?.({
        content: '❌ There is no music playing right now.',
        flags: 64
      }).catch(() => null)
    }

    try {
      await interaction.deferReply?.(64)
    } catch {
      return
    }

    const handler = actionHandlers[interaction.customId]
    if (!handler) {
      return interaction.editOrReply?.({
        content: '❌ This button action is not recognized.'
      }).catch(() => null)
    }

    try {
      const result = await handler(player)
      await interaction.followup?.({ content: result.message }).catch(() => null)
      if (result.shouldUpdate && player.current) queueMicrotask(() => updateNowPlayingEmbed(player, client))
    } catch (error) {
      console.error(`Action ${interaction.customId} failed:`, error?.message ?? error)
      await interaction.editOrReply?.({
        content: '❌ An error occurred. Please try again.'
      }).catch(() => null)
    }
  }
})

export { formatTime, truncateText, getPlatform }