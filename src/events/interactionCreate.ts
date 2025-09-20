import { Container, createEvent } from 'seyfert'
import { ICONS, LIMITS } from '../shared/constants'
import { createButtons, createEmbed, formatDuration, shuffleArray } from '../shared/utils'
import { MUSIC_PLATFORMS } from '../shared/emojis'
import { SimpleDB } from '../utils/simpleDB'

const MAX_TITLE_LENGTH = 60
const VOLUME_STEP = 10
const MAX_VOLUME = 100
const MIN_VOLUME = 0
const FLAGS_UPDATE = 36864
const PAGE_SIZE = LIMITS.PAGE_SIZE || 10
const TITLE_SANITIZE_REGEX = /[^\w\s\-_.]/g
const YT_ID_REGEX = /(?:youtube\.com\/.*[?&]v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/
// @ts-ignore
const PLATFORM_MAP = new Map([
  ['youtu', MUSIC_PLATFORMS.youtube],
  ['soundcloud', MUSIC_PLATFORMS.soundcloud],
  ['spotify', MUSIC_PLATFORMS.spotify],
  ['deezer', MUSIC_PLATFORMS.deezer]
])

const db = new SimpleDB()
const playlistsCollection = db.collection('playlists')

const formatTime = ms => {
  const s = (ms / 1000) | 0
  const h = (s / 3600) | 0
  const m = ((s % 3600) / 60) | 0
  const sec = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

const truncateText = (text, maxLength = MAX_TITLE_LENGTH) => {
  if (!text || text.length <= maxLength) return text || ''
  const processed = text.replace(TITLE_SANITIZE_REGEX, '').trim()
  return processed.length > maxLength ? `${processed.slice(0, maxLength - 3).trimEnd()}...` : processed
}

const getPlatform = uri => {
  if (!uri) return MUSIC_PLATFORMS.youtube
  const lower = uri.toLowerCase()
  for (const [key, value] of PLATFORM_MAP) {
    if (lower.includes(key)) return value
  }
  return MUSIC_PLATFORMS.youtube
}

const setPlayerVolume = async (player, volume) => {
  if (!player) return
  player.volume = volume
  try {
    await player.setVolume?.(volume)
  } catch (err) {
    console.debug('setVolume failed', err)
  }
}

const getSourceIcon = uri => {
  if (!uri) return ICONS.music
  const map = {
    'youtube.com': ICONS.youtube,
    'youtu.be': ICONS.youtube,
    'spotify.com': ICONS.spotify,
    'soundcloud.com': ICONS.soundcloud
  }
  for (const [key, icon] of Object.entries(map)) {
    if (uri.includes(key)) return icon
  }
  return ICONS.music
}

const extractYouTubeId = uri => uri?.match(YT_ID_REGEX)?.[1] || null

export const createNowPlayingEmbed = (player, track, client) => {
  const { position = 0, volume = 0, loop, paused } = player || {}
  const { title = 'Unknown', uri = '', length = 0, requester } = track || {}
  const platform = getPlatform(uri)
  const volumeIcon = volume === 0 ? '🔇' : volume < 50 ? '🔈' : '🔊'
  const loopIcon = loop === 'track' ? '🔂' : loop === 'queue' ? '🔁' : '▶️'
  const truncatedTitle = truncateText(title)
  const capitalizedTitle = truncatedTitle.replace(/\b\w/g, l => l.toUpperCase())

  return new Container({
    components: [
      { type: 10, content: `**${platform.emoji} Now Playing**` },
      { type: 14, divider: true, spacing: 1 },
      {
        type: 9,
        components: [
          { type: 10, content: `## **[\`${capitalizedTitle}\`](${uri})**\n\`${formatTime(position)}\` / \`${formatTime(length)}\`` },
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
          { type: 2, label: '🔉', style: 2, custom_id: 'volume_down' },
          { type: 2, label: '⏮️', style: 2, custom_id: 'previous' },
          { type: 2, label: paused ? '▶️' : '⏸️', style: paused ? 3 : 2, custom_id: paused ? 'resume' : 'pause' },
          { type: 2, label: '⏭️', style: 2, custom_id: 'skip' },
          { type: 2, label: '🔊', style: 2, custom_id: 'volume_up' }
        ]
      },
      { type: 14, divider: true, spacing: 2 }
    ]
  })
}

const addToQueueFront = (queue, item) => {
  if (!queue) return
  if (Array.isArray(queue)) {
    queue.unshift(item)
    return
  }
  if (typeof queue.unshift === 'function') {
    queue.unshift(item)
    return
  }
  if (typeof queue.add === 'function') {
    try {
      queue.add(item)
    } catch (err) {
      console.debug('addToQueueFront failed', err)
    }
  }
}

const actionHandlers = {
  volume_down: async player => {
    const vol = Math.max(MIN_VOLUME, (player.volume || 0) - VOLUME_STEP)
    await setPlayerVolume(player, vol)
    return { message: `🔉 Volume set to ${vol}%`, shouldUpdate: true }
  },
  previous: player => {
    if (!player.previous) return { message: '❌ No previous track available', shouldUpdate: false }
    if (player.current) addToQueueFront(player.queue, player.current)
    addToQueueFront(player.queue, player.previous)
    player.stop?.()
    return { message: '⏮️ Playing the previous track.', shouldUpdate: false }
  },
  resume: player => {
    player.pause?.(false)
    return { message: '▶️ Resumed playback.', shouldUpdate: true }
  },
  pause: player => {
    player.pause?.(true)
    return { message: '⏸️ Paused playback.', shouldUpdate: true }
  },
  skip: player => {
    if (!player.queue?.length && !player.queue?.size) return { message: '❌ No tracks in queue to skip to.', shouldUpdate: false }
    player.skip?.()
    return { message: '⏭️ Skipped to the next track.', shouldUpdate: false }
  },
  volume_up: async player => {
    const vol = Math.min(MAX_VOLUME, (player.volume || 0) + VOLUME_STEP)
    await setPlayerVolume(player, vol)
    return { message: `🔊 Volume set to ${vol}%`, shouldUpdate: true }
  }
}

const buildPlaylistPage = (playlist, playlistName, userId, page) => {
  const total = Array.isArray(playlist.tracks) ? playlist.tracks.length : 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const newPage = Math.min(Math.max(1, page), totalPages)
  const startIdx = (newPage - 1) * PAGE_SIZE
  const tracks = playlist.tracks.slice(startIdx, startIdx + PAGE_SIZE)

  const embed = createEmbed('primary', `${ICONS.playlist} ${playlistName}`)
  embed.addFields(
    { name: `${ICONS.info} Info`, value: playlist.description || 'No description', inline: false },
    { name: `${ICONS.tracks} Tracks`, value: String(total), inline: true },
    { name: `${ICONS.duration} Duration`, value: formatDuration(playlist.totalDuration || 0), inline: true },
    { name: `${ICONS.info} Plays`, value: String(playlist.playCount || 0), inline: true }
  )

  const trackList = tracks.map((t, i) => {
    const pos = String(startIdx + i + 1).padStart(2, '0')
    const duration = formatDuration(t.duration || 0)
    const source = getSourceIcon(t.uri)
    return `\`${pos}.\` **${t.title}**\n     ${ICONS.artist} ${t.author || 'Unknown'} • ${ICONS.duration} ${duration} ${source}`
  }).join('\n\n')

  if (trackList) {
    embed.addFields({ name: `${ICONS.music} Tracks (Page ${newPage}/${totalPages})`, value: trackList, inline: false })
  }

  const firstVideoId = extractYouTubeId(tracks[0]?.uri)
  if (firstVideoId) embed.setThumbnail(`https://img.youtube.com/vi/${firstVideoId}/maxresdefault.jpg`)

  const components = [
    createButtons([
      { id: `play_playlist_${playlistName}_${userId}`, label: 'Play', emoji: ICONS.play, style: 3 },
      { id: `shuffle_playlist_${playlistName}_${userId}`, label: 'Shuffle', emoji: ICONS.shuffle, style: 1 },
    ])
  ]

  if (totalPages > 1) {
    components.push(createButtons([
      { id: `playlist_prev_${newPage}_${playlistName}_${userId}`, label: 'Previous', emoji: '◀️', disabled: newPage === 1 },
      { id: `playlist_next_${newPage}_${playlistName}_${userId}`, label: 'Next', emoji: '▶️', disabled: newPage === totalPages }
    ]))
  }

  return { embed, components }
}

const resolveTracksWithLimit = async (tracks, resolveFn, limit = 5) => {
  const results = []
  for (let i = 0; i < tracks.length; i += limit) {
    const chunk = tracks.slice(i, i + limit)
    const promises = chunk.map(track => resolveFn(track))
    const settled = await Promise.allSettled(promises)
    for (const res of settled) {
      results.push(res)
    }
  }
  return results
}

const createPlaylistHandler = handler => async (interaction, client, userId, playlistName, page) => {
  const playlist = playlistsCollection.findOne({ userId, name: playlistName })
  if (!playlist) return { message: '❌ Playlist not found', shouldUpdate: false }
  return handler(interaction, client, userId, playlistName, playlist, page)
}

const playlistActionHandlers = {
  play_playlist: createPlaylistHandler(async (interaction, client, userId, playlistName, playlist, page) => {
    if (!playlist.tracks?.length) return { message: 'Playlist is empty', shouldUpdate: false }
    const voiceState = await interaction.member?.voice()
    if (!voiceState?.channelId) return { message: 'Join a voice channel first', shouldUpdate: false }

    try {
      const player = client.aqua.createConnection({
        guildId: interaction.guildId,
        voiceChannel: voiceState.channelId,
        textChannel: interaction.channelId,
        defaultVolume: 65,
        deaf: true
      })

      const resolved = await resolveTracksWithLimit(playlist.tracks, track => client.aqua.resolve({ query: track.uri, requester: interaction.user }), 5)
      resolved.forEach(r => {
        if (r.status === 'fulfilled' && r.value?.tracks?.[0]) player.queue.add(r.value.tracks[0])
      })

      playlistsCollection.update({ _id: playlist._id }, {
        ...playlist,
        playCount: (playlist.playCount || 0) + 1,
        lastPlayedAt: Date.now()
      })

      if (!player.playing && !player.paused && player.queue.size) player.play()
      return { message: `▶️ Playing playlist "${playlistName}" with ${playlist.tracks.length} tracks`, shouldUpdate: false }
    } catch (err) {
      console.debug('play_playlist failed', err)
      return { message: 'Failed to play playlist', shouldUpdate: false }
    }
  }),

  shuffle_playlist: createPlaylistHandler((interaction, client, userId, playlistName, playlist) => {
    if (!playlist.tracks?.length) return { message: 'Playlist is empty', shouldUpdate: false }
    playlistsCollection.update({ _id: playlist._id }, { ...playlist, tracks: shuffleArray([...playlist.tracks]) })
    return { message: `🔀 Shuffled playlist "${playlistName}"`, shouldUpdate: false }
  }),

  playlist_prev: createPlaylistHandler(async (interaction, client, userId, playlistName, playlist, page) => {
    const newPage = Math.max(1, (parseInt(page) || 1) - 1)
    const { embed, components } = buildPlaylistPage(playlist, playlistName, userId, newPage)
    await interaction.editOrReply({ embeds: [embed], components })
    return { message: '', shouldUpdate: false }
  }),

  playlist_next: createPlaylistHandler(async (interaction, client, userId, playlistName, playlist, page) => {
    const newPage = (parseInt(page) || 1) + 1
    const { embed, components } = buildPlaylistPage(playlist, playlistName, userId, newPage)
    await interaction.editOrReply({ embeds: [embed], components })
    return { message: '', shouldUpdate: false }
  })
}

const updateNowPlayingEmbed = async (player, client) => {
  const msg = player?.nowPlayingMessage
  if (!msg || !player?.current) {
    if (player) player.nowPlayingMessage = null
    return
  }
  try {
    await msg.edit({ components: [createNowPlayingEmbed(player, player.current, client)], flags: FLAGS_UPDATE })
  } catch (err) {
    console.debug('updateNowPlayingEmbed failed', err)
    player.nowPlayingMessage = null
  }
}

export default createEvent({
  data: { name: 'interactionCreate' },
  run: async (interaction, client) => {
    if (!interaction.isButton?.() || !interaction.customId || !interaction.guildId) return

    const id = interaction.customId
    const parts = id.split('_')

    if (parts.length > 1) {
      const isPlaylistButton = parts[0] === 'playlist' || ['play', 'shuffle', 'add', 'view', 'create'].includes(parts[0])

      if (isPlaylistButton) {
        const userId = parts[parts.length - 1]
        if (userId !== interaction.user.id) return

        try {
          await interaction.deferReply(64)
        } catch {
          return
        }

        let action = null

        if (parts[0] === 'playlist' && ['prev', 'next'].includes(parts[1])) {
          action = `playlist_${parts[1]}`
        } else {
          const knownActions = [
            'play_playlist',
            'shuffle_playlist',
            'add_playlist',
            'view_playlist',
            'create_playlist'
          ]

          for (let i = 1; i < parts.length; i++) {
            const potential = parts.slice(0, i + 1).join('_')
            if (knownActions.includes(potential)) {
              action = potential
              break
            }
          }
        }

        const pagePart = parts.find(p => /^\d+$/.test(p))
        const page = pagePart || null

        // compute playlistName by slicing after the action tokens and before the trailing userId
        // filter out numeric segments (page numbers) that may appear before the playlist name
        const actionLen = action ? action.split('_').length : 0
        const nameParts = parts.slice(actionLen, -1).filter(p => !/^\d+$/.test(p))
        const playlistName = nameParts.length ? nameParts.join('_') : null

        const handler = playlistActionHandlers[action]
        if (!handler) {
          return interaction.editOrReply({ content: '❌ This button action is not recognized.' }).catch(() => {})
        }

        try {
          const result = await handler(interaction, client, userId, playlistName, page)
          if (result.message) await interaction.followup({ content: result.message }).catch(() => {})
        } catch (err) {
          console.debug('playlist handler failed', err)
          await interaction.editOrReply({ content: '❌ An error occurred.' }).catch(() => {})
        }
        return
      }
    }

    const prefixCheck = ['queue', 'select', 'platform', 'lyrics', 'help', 'playlist'].some(p => id.startsWith(p))
    if (prefixCheck) return

    try {
      await interaction.deferReply(64)
    } catch {
      return
    }

    const player = client.aqua?.players?.get?.(interaction.guildId)
    if (!player?.current) {
      return interaction.editOrReply({ content: '❌ There is no music playing right now.', flags: 64 }).catch(() => {})
    }

    const memberVoice = await interaction.member?.voice().catch(() => null)
    if (!memberVoice) {
      return interaction.editOrReply({ content: '❌ You must be in a voice channel to use this button.' }).catch(() => {})
    }

    if (interaction.user.id !== player.current.requester?.id) {
      return interaction.editOrReply({ content: '❌ You are not allowed to use this button.' }).catch(() => {})
    }

    const handler = actionHandlers[id]
    if (!handler) {
      return interaction.editOrReply({ content: '❌ This button action is not recognized.' }).catch(() => {})
    }

    try {
      const result = await handler(player)
      await interaction.followup({ content: result.message }).catch(() => {})
      if (result.shouldUpdate && player.current) {
        queueMicrotask(() => updateNowPlayingEmbed(player, client))
      }
    } catch (err) {
      console.debug('action handler failed', err)
      await interaction.editOrReply({ content: '❌ An error occurred. Please try again.' }).catch(() => {})
    }
  }
})

export const _functions = {
  formatTime,
  truncateText,
  getPlatform,
  setPlayerVolume,
  getSourceIcon,
  extractYouTubeId,
  createNowPlayingEmbed,
  updateNowPlayingEmbed
}

export { formatTime, truncateText, getPlatform }
