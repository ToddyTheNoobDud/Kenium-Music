import { Container, createEvent } from 'seyfert'
import { ICONS, LIMITS } from '../shared/constants'
import { createButtons, createEmbed, formatDuration, shuffleArray } from '../shared/utils'
import { MUSIC_PLATFORMS, PLAYBACK_E } from '../shared/emojis'
import { SimpleDB } from '../utils/simpleDB'

// Constants
const MAX_TITLE_LENGTH = 60
const VOLUME_STEP = 10
const MAX_VOLUME = 100
const MIN_VOLUME = 0
const FLAGS_UPDATE = 36864
const PAGE_SIZE = LIMITS.PAGE_SIZE || 10
const RESOLVE_CONCURRENCY = 5

// Optimized regex patterns
const TITLE_SANITIZE_REGEX = /[^\w\s\-_.]/g
const YT_ID_REGEX = /(?:youtube\.com\/.*[?&]v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/

// Platform lookup map for O(1) access
const PLATFORM_MAP = new Map([
  ['youtu', MUSIC_PLATFORMS.youtube],
  ['soundcloud', MUSIC_PLATFORMS.soundcloud],
  ['spotify', MUSIC_PLATFORMS.spotify],
  ['deezer', MUSIC_PLATFORMS.deezer]
])

const db = new SimpleDB()
const playlistsCollection = db.collection('playlists')

// Utility functions
export const _functions = {
  formatTime: (ms) => {
    const s = Math.floor(ms / 1000)
    const pad = n => String(n).padStart(2, '0')
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
  },

  truncateText: (text, maxLength = MAX_TITLE_LENGTH) => {
    if (!text || text.length <= maxLength) return text || ''
    const processed = text.replace(TITLE_SANITIZE_REGEX, '').trim()
    return processed.length > maxLength
      ? `${processed.slice(0, maxLength - 3).trimEnd()}...`
      : processed
  },

  getPlatform: (uri) => {
    if (!uri) return MUSIC_PLATFORMS.youtube
    const lower = uri.toLowerCase()
    for (const [key, platform] of PLATFORM_MAP) {
      if (lower.includes(key)) return platform
    }
    return MUSIC_PLATFORMS.youtube
  },

  getSourceIcon: (uri) => {
    if (!uri) return ICONS.music
    if (uri.includes('youtu')) return ICONS.youtube
    if (uri.includes('spotify')) return ICONS.spotify
    if (uri.includes('soundcloud')) return ICONS.soundcloud
    return ICONS.music
  },

  extractYouTubeId: (uri) => uri ? YT_ID_REGEX.exec(uri)?.[1] ?? null : null,

  setPlayerVolume: (player, volume) => player?.setVolume?.(volume),

  addToQueueFront: (queue, item) => {
    if (!queue) return
    if (typeof queue.unshift === 'function') queue.unshift(item)
    else queue.add?.(item)?.catch?.(() => {})
  },

  isNumeric: (str) => /^\d+$/.test(str),

  safeDefer: async (interaction, flags = 64) => {
    try {
      await interaction.deferReply(flags)
      return true
    } catch {
      return false
    }
  },

  safeReply: (interaction, content) => interaction.editOrReply({ content }).catch(() => {}),

  getQueueLength: (queue) => queue?.length ?? queue?.size ?? 0
}

export const createNowPlayingEmbed = (player, track, client) => {
  const { position = 0, volume = 0, loop, paused } = player || {}
  const { title = 'Unknown', uri = '', length = 0, requester } = track || {}
  const platform = _functions.getPlatform(uri)
  const volumeIcon = volume === 0 ? '🔇' : volume < 50 ? '🔈' : '🔊'
  const loopIcon = loop === 'track' ? '🔂' : loop === 'queue' ? '🔁' : '▶️'
  const capitalizedTitle = _functions.truncateText(title).replace(/\b\w/g, l => l.toUpperCase())

  return new Container({
    components: [
      { type: 10, content: `**${platform.emoji} Now Playing** | **Queue size**: ${_functions.getQueueLength(player?.queue)}` },
      { type: 14, divider: true, spacing: 1 },
      {
        type: 9,
        components: [
          { type: 10, content: `## **[\`${capitalizedTitle}\`](${uri})**\n\`${_functions.formatTime(position)}\` / \`${_functions.formatTime(length)}\`` },
          { type: 10, content: `${volumeIcon} \`${volume}%\` ${loopIcon} Requester: \`${requester?.username || 'Unknown'}\`` }
        ],
        accessory: {
          type: 11,
          media: { url: track?.info?.artworkUrl || client?.me?.avatarURL?.({ extension: 'webp' }) || '' }
        }
      },
      { type: 14, divider: true, spacing: 2 },
      {
        type: 1,
        components: [
          { type: 2, label: `${PLAYBACK_E.volume_down}`, style: 2, custom_id: 'volume_down' },
          { type: 2, label: `${PLAYBACK_E.previous}`, style: 2, custom_id: 'previous' },
          { type: 2, label: paused ? `${PLAYBACK_E.resume}` : `${PLAYBACK_E.pause}`, style: paused ? 3 : 2, custom_id: paused ? 'resume' : 'pause' },
          { type: 2, label: `${PLAYBACK_E.skip}`, style: 2, custom_id: 'skip' },
          { type: 2, label: `${PLAYBACK_E.volume_up}`, style: 2, custom_id: 'volume_up' }
        ]
      },
      { type: 14, divider: true, spacing: 2 }
    ]
  })
}

// Volume adjustment helper
const adjustVolume = async (player, delta) => {
  const vol = Math.max(MIN_VOLUME, Math.min(MAX_VOLUME, (player.volume || 0) + delta))
  await _functions.setPlayerVolume(player, vol)
  return { message: `${delta > 0 ? '🔊' : '🔉'} Volume set to ${vol}%`, shouldUpdate: true }
}

// Action handlers
const actionHandlers = {
  volume_down: (player) => adjustVolume(player, -VOLUME_STEP),
  volume_up: (player) => adjustVolume(player, VOLUME_STEP),

  previous: (player) => {
    if (!player.previous) return { message: '❌ No previous track available', shouldUpdate: false }
    if (player.current) _functions.addToQueueFront(player.queue, player.current)
    _functions.addToQueueFront(player.queue, player.previous)
    player.stop?.()
    return { message: '⏮️ Playing the previous track.', shouldUpdate: false }
  },

  resume: (player) => {
    player.pause?.(false)
    return { message: '▶️ Resumed playback.', shouldUpdate: true }
  },

  pause: (player) => {
    player.pause?.(true)
    return { message: '⏸️ Paused playback.', shouldUpdate: true }
  },

  skip: (player) => {
    if (!_functions.getQueueLength(player.queue)) {
      return { message: '❌ No tracks in queue to skip to.', shouldUpdate: false }
    }
    player.skip?.()
    return { message: '⏭️ Skipped to the next track.', shouldUpdate: false }
  }
}

// Playlist page builder
const buildPlaylistPage = (playlist, playlistName, userId, page) => {
  const total = Array.isArray(playlist.tracks) ? playlist.tracks.length : 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const startIdx = (currentPage - 1) * PAGE_SIZE
  const tracks = playlist.tracks.slice(startIdx, startIdx + PAGE_SIZE)
  const embed = createEmbed('primary', `${ICONS.playlist} ${playlistName}`, '')

  embed.addFields(
    { name: `${ICONS.info} Info`, value: playlist.description || 'No description', inline: false },
    { name: `${ICONS.tracks} Tracks`, value: String(total), inline: true },
    { name: `${ICONS.duration} Duration`, value: formatDuration(playlist.totalDuration || 0), inline: true },
    { name: `${ICONS.info} Plays`, value: String(playlist.playCount || 0), inline: true }
  )

  if (tracks.length) {
    const trackList = tracks.map((t, i) => {
      const pos = String(startIdx + i + 1).padStart(2, '0')
      return `\`${pos}.\` **${t.title}**\n     ${ICONS.artist} ${t.author || 'Unknown'} • ${ICONS.duration} ${formatDuration(t.duration || 0)} ${_functions.getSourceIcon(t.uri)}`
    }).join('\n\n')

    embed.addFields({ name: `${ICONS.music} Tracks (Page ${currentPage}/${totalPages})`, value: trackList, inline: false })

    const firstVideoId = _functions.extractYouTubeId(tracks[0]?.uri)
    if (firstVideoId) embed.setThumbnail(`https://img.youtube.com/vi/${firstVideoId}/maxresdefault.jpg`)
  }

  const components = [
    createButtons([
      { id: `play_playlist_${playlistName}_${userId}`, label: 'Play', emoji: ICONS.play, style: 3 },
      { id: `shuffle_playlist_${playlistName}_${userId}`, label: 'Shuffle', emoji: ICONS.shuffle, style: 1 }
    ])
  ]

  if (totalPages > 1) {
    components.push(createButtons([
      { id: `playlist_prev_${currentPage}_${playlistName}_${userId}`, label: 'Previous', emoji: '◀️', disabled: currentPage === 1 },
      { id: `playlist_next_${currentPage}_${playlistName}_${userId}`, label: 'Next', emoji: '▶️', disabled: currentPage === totalPages }
    ]))
  }

  return { embed, components }
}

// Track resolution with concurrency control
const resolveTracksWithLimit = async (tracks, resolveFn, limit = RESOLVE_CONCURRENCY) => {
  const results = []
  for (let i = 0; i < tracks.length; i += limit) {
    const settled = await Promise.allSettled(tracks.slice(i, i + limit).map(resolveFn))
    results.push(...settled)
  }
  return results
}

// Playlist action handlers
const playlistActionHandlers = {
  play_playlist: async (interaction, client, userId, playlistName) => {
    const playlist = playlistsCollection.findOne({ userId, name: playlistName })
    if (!playlist?.tracks?.length) return { message: '❌ Playlist is empty', shouldUpdate: false }

    const voiceState = await interaction.member?.voice()
    if (!voiceState?.channelId) return { message: '❌ Join a voice channel first', shouldUpdate: false }

    let player = client.aqua.players.get(interaction.guildId)
    player ??= client.aqua.createConnection({
      guildId: interaction.guildId,
      voiceChannel: voiceState.channelId,
      textChannel: interaction.channelId,
      defaultVolume: 65,
      deaf: true
    })

    const resolved = await resolveTracksWithLimit(
      playlist.tracks,
      track => client.aqua.resolve({ query: track.uri, requester: interaction.user })
    )

    for (const result of resolved) {
      if (result.status === 'fulfilled' && result.value?.tracks?.[0]) {
        player.queue.add(result.value.tracks[0])
      }
    }

    playlistsCollection.update({ _id: playlist._id }, { ...playlist, playCount: (playlist.playCount || 0) + 1, lastPlayedAt: Date.now() })

    if (!player.playing && !player.paused && player.queue.size) player.play()
    return { message: `▶️ Playing playlist "${playlistName}" with ${playlist.tracks.length} tracks`, shouldUpdate: false }
  },

  shuffle_playlist: (_interaction, client, userId, playlistName) => {
    const playlist = playlistsCollection.findOne({ userId, name: playlistName })
    if (!playlist?.tracks?.length) return { message: '❌ Playlist is empty', shouldUpdate: false }
    playlistsCollection.update({ _id: playlist._id }, { ...playlist, tracks: shuffleArray([...playlist.tracks]) })
    return { message: `🔀 Shuffled playlist "${playlistName}"`, shouldUpdate: false }
  },

  playlist_prev: async (interaction, client, userId, playlistName, page) => {
    const playlist = playlistsCollection.findOne({ userId, name: playlistName })
    if (!playlist) return { message: '❌ Playlist not found', shouldUpdate: false }
    const { embed, components } = buildPlaylistPage(playlist, playlistName, userId, Math.max(1, (page || 1) - 1))
    await interaction.editOrReply({ embeds: [embed], components })
    return { message: '', shouldUpdate: false }
  },

  playlist_next: async (interaction, client, userId, playlistName, page) => {
    const playlist = playlistsCollection.findOne({ userId, name: playlistName })
    if (!playlist) return { message: '❌ Playlist not found', shouldUpdate: false }
    const { embed, components } = buildPlaylistPage(playlist, playlistName, userId, (page || 1) + 1)
    await interaction.editOrReply({ embeds: [embed], components })
    return { message: '', shouldUpdate: false }
  }
}

// Button ID parser
const parsePlaylistButtonId = (customId) => {
  const parts = customId.split('_')
  if (parts.length < 2) return null

  const userId = parts.at(-1)
  const { isNumeric } = _functions

  if (parts[0] === 'playlist' && (parts[1] === 'prev' || parts[1] === 'next')) {
    return {
      action: `playlist_${parts[1]}`,
      playlistName: parts.slice(3, -1).filter(p => !isNumeric(p)).join('_'),
      userId,
      page: isNumeric(parts[2]) ? Number.parseInt(parts[2], 10) : undefined
    }
  }

  const knownActions = ['play_playlist', 'shuffle_playlist']
  for (let i = 1; i < parts.length; i++) {
    const potentialAction = parts.slice(0, i + 1).join('_')
    if (knownActions.includes(potentialAction)) {
      return {
        action: potentialAction,
        playlistName: parts.slice(i + 1, -1).filter(p => !isNumeric(p)).join('_'),
        userId
      }
    }
  }

  return null
}

// Update now playing embed
const updateNowPlayingEmbed = async (player, client) => {
  const msg = player?.nowPlayingMessage
  if (!msg?.edit || !player?.current) {
    if (player) player.nowPlayingMessage = null
    return
  }

  try {
    await msg.edit({ components: [createNowPlayingEmbed(player, player.current, client)], flags: FLAGS_UPDATE })
  } catch {
    player.nowPlayingMessage = null
  }
}

// Main event handler
export default createEvent({
  data: { name: 'interactionCreate' },
  run: async (interaction, client) => {
    if (!interaction.isButton?.() || !interaction.customId || !interaction.guildId) return
    if (interaction.customId.startsWith('ignore_')) return

    const parsed = parsePlaylistButtonId(interaction.customId)

    if (parsed && playlistActionHandlers[parsed.action]) {
      if (parsed.userId !== interaction.user.id) return
      if (!(await _functions.safeDefer(interaction))) return

      try {
        const result = await playlistActionHandlers[parsed.action](interaction, client, parsed.userId, parsed.playlistName || '', parsed.page)
        if (result.message) await interaction.followup({ content: result.message }).catch(() => {})
      } catch {
        _functions.safeReply(interaction, '❌ An error occurred.')
      }
      return
    }

    if (!(await _functions.safeDefer(interaction))) return

    const player = client.aqua?.players?.get?.(interaction.guildId)
    if (!player) return _functions.safeReply(interaction, '❌ There is no active music player in this server.')
    if (!player.current) return _functions.safeReply(interaction, '❌ There is no music playing right now.')

    const memberVoice = await interaction.member?.voice().catch(() => null)
    if (!memberVoice) return _functions.safeReply(interaction, '❌ You must be in a voice channel to use this button.')
    if (interaction.user.id !== player.current.requester?.id) return _functions.safeReply(interaction, '❌ You are not allowed to use this button.')

    const handler = actionHandlers[interaction.customId]
    if (!handler) return _functions.safeReply(interaction, '❌ This button action is not recognized.')

    try {
      const result = await handler(player)
      await interaction.followup({ content: result.message }).catch(() => {})
      if (result.shouldUpdate && player.current) queueMicrotask(() => updateNowPlayingEmbed(player, client))
    } catch {
      _functions.safeReply(interaction, '❌ An error occurred. Please try again.')
    }
  }
})

export const { formatTime, truncateText, getPlatform } = _functions