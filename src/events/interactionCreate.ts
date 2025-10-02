import { Container, createEvent } from 'seyfert'
import { ICONS, LIMITS } from '../shared/constants'
import { createButtons, createEmbed, formatDuration, shuffleArray } from '../shared/utils'
import { MUSIC_PLATFORMS, PLAYBACK_E } from '../shared/emojis'
import { SimpleDB } from '../utils/simpleDB'

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
const NUMERIC_PATTERN = /^\d+$/

// Optimized platform detection using Map for O(1) lookup
const PLATFORM_KEYWORDS: Map<string, any> = new Map<string, any>([
  ['youtu', MUSIC_PLATFORMS.youtube],
  ['soundcloud', MUSIC_PLATFORMS.soundcloud],
  ['spotify', MUSIC_PLATFORMS.spotify],
  ['deezer', MUSIC_PLATFORMS.deezer]
])

const db = new SimpleDB()
const playlistsCollection = db.collection('playlists')

// Utility functions
const formatTime = (ms: number): string => {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

const truncateText = (text: string, maxLength = MAX_TITLE_LENGTH): string => {
  if (!text || text.length <= maxLength) return text || ''
  const processed = text.replace(TITLE_SANITIZE_REGEX, '').trim()
  return processed.length > maxLength
    ? `${processed.slice(0, maxLength - 3).trimEnd()}...`
    : processed
}

const getPlatform = (uri: string): any => {
  if (!uri) return MUSIC_PLATFORMS.youtube

  const lowerUri = uri.toLowerCase()
  for (const [keyword, platform] of PLATFORM_KEYWORDS) {
    if (lowerUri.includes(keyword)) return platform
  }

  return MUSIC_PLATFORMS.youtube
}

const setPlayerVolume = async (player: any, volume: number): Promise<void> => {
  if (!player) return

  player.volume = volume
  if (player.setVolume) {
    await player.setVolume(volume).catch(() => { })
  }
}

const getSourceIcon = (uri: string): string => {
  if (!uri) return ICONS.music

  // Using indexOf for faster string search
  if (uri.includes('youtube.com') || uri.includes('youtu.be')) return ICONS.youtube
  if (uri.includes('spotify.com')) return ICONS.spotify
  if (uri.includes('soundcloud.com')) return ICONS.soundcloud

  return ICONS.music
}

const extractYouTubeId = (uri: string): string | null => {
  if (!uri) return null
  const match = YT_ID_REGEX.exec(uri)
  return match?.[1] || null
}

// Optimized now playing embed creation
export const createNowPlayingEmbed = (player: any, track: any, client: any): Container => {
  const { position = 0, volume = 0, loop, paused } = player || {}
  const { title = 'Unknown', uri = '', length = 0, requester } = track || {}

  const platform = getPlatform(uri)
  const volumeIcon = volume === 0 ? '🔇' : volume < 50 ? '🔈' : '🔊'
  const loopIcon = loop === 'track' ? '🔂' : loop === 'queue' ? '🔁' : '▶️'
  const truncatedTitle = truncateText(title)
  const capitalizedTitle = truncatedTitle.replace(/\b\w/g, l => l.toUpperCase())

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
            content: `## **[\`${capitalizedTitle}\`](${uri})**\n\`${formatTime(position)}\` / \`${formatTime(length)}\``
          },
          {
            type: 10,
            content: `${volumeIcon} \`${volume}%\` ${loopIcon} Requester: \`${requester?.username || 'Unknown'}\``
          }
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
          {
            type: 2,
            label: paused ? `${PLAYBACK_E.resume}` : `${PLAYBACK_E.pause}`,
            style: paused ? 3 : 2,
            custom_id: paused ? 'resume' : 'pause'
          },
          { type: 2, label: `${PLAYBACK_E.skip}`, style: 2, custom_id: 'skip' },
          { type: 2, label: `${PLAYBACK_E.volume_up}`, style: 2, custom_id: 'volume_up' }
        ]
      },
      { type: 14, divider: true, spacing: 2 }
    ]
  })
}

const addToQueueFront = (queue: any, item: any): void => {
  if (!queue) return

  if (Array.isArray(queue)) {
    queue.unshift(item)
  } else if (typeof queue.unshift === 'function') {
    queue.unshift(item)
  } else if (typeof queue.add === 'function') {
    queue.add(item).catch(() => { })
  }
}

// Playback control handlers with type safety
interface ActionResult {
  message: string
  shouldUpdate: boolean
}

const actionHandlers: Record<string, (player: any) => Promise<ActionResult> | ActionResult> = {
  volume_down: async (player) => {
    const vol = Math.max(MIN_VOLUME, (player.volume || 0) - VOLUME_STEP)
    await setPlayerVolume(player, vol)
    return { message: `🔉 Volume set to ${vol}%`, shouldUpdate: true }
  },

  previous: (player) => {
    if (!player.previous) {
      return { message: '❌ No previous track available', shouldUpdate: false }
    }

    if (player.current) addToQueueFront(player.queue, player.current)
    addToQueueFront(player.queue, player.previous)
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
    if (!player.queue?.length && !player.queue?.size) {
      return { message: '❌ No tracks in queue to skip to.', shouldUpdate: false }
    }

    player.skip?.()
    return { message: '⏭️ Skipped to the next track.', shouldUpdate: false }
  },

  volume_up: async (player) => {
    const vol = Math.min(MAX_VOLUME, (player.volume || 0) + VOLUME_STEP)
    await setPlayerVolume(player, vol)
    return { message: `🔊 Volume set to ${vol}%`, shouldUpdate: true }
  }
}

// Optimized playlist page builder
const buildPlaylistPage = (
  playlist: any,
  playlistName: string,
  userId: string,
  page: number
): { embed: any, components: any[] } => {
  const total = Array.isArray(playlist.tracks) ? playlist.tracks.length : 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const startIdx = (currentPage - 1) * PAGE_SIZE
  const tracks = playlist.tracks.slice(startIdx, startIdx + PAGE_SIZE)

  const embed = createEmbed('primary', `${ICONS.playlist} ${playlistName}`)

  embed.addFields(
    { name: `${ICONS.info} Info`, value: playlist.description || 'No description', inline: false },
    { name: `${ICONS.tracks} Tracks`, value: String(total), inline: true },
    { name: `${ICONS.duration} Duration`, value: formatDuration(playlist.totalDuration || 0), inline: true },
    { name: `${ICONS.info} Plays`, value: String(playlist.playCount || 0), inline: true }
  )

  if (tracks.length > 0) {
    const trackList = tracks.map((t: any, i: number) => {
      const pos = String(startIdx + i + 1).padStart(2, '0')
      const duration = formatDuration(t.duration || 0)
      const source = getSourceIcon(t.uri)
      return `\`${pos}.\` **${t.title}**\n     ${ICONS.artist} ${t.author || 'Unknown'} • ${ICONS.duration} ${duration} ${source}`
    }).join('\n\n')

    embed.addFields({
      name: `${ICONS.music} Tracks (Page ${currentPage}/${totalPages})`,
      value: trackList,
      inline: false
    })

    const firstVideoId = extractYouTubeId(tracks[0]?.uri)
    if (firstVideoId) {
      embed.setThumbnail(`https://img.youtube.com/vi/${firstVideoId}/maxresdefault.jpg`)
    }
  }

  const components = [
    createButtons([
      { id: `play_playlist_${playlistName}_${userId}`, label: 'Play', emoji: ICONS.play, style: 3 },
      { id: `shuffle_playlist_${playlistName}_${userId}`, label: 'Shuffle', emoji: ICONS.shuffle, style: 1 }
    ])
  ]

  if (totalPages > 1) {
    components.push(createButtons([
      {
        id: `playlist_prev_${currentPage}_${playlistName}_${userId}`,
        label: 'Previous',
        emoji: '◀️',
        disabled: currentPage === 1
      },
      {
        id: `playlist_next_${currentPage}_${playlistName}_${userId}`,
        label: 'Next',
        emoji: '▶️',
        disabled: currentPage === totalPages
      }
    ]))
  }

  return { embed, components }
}

// Optimized track resolution with concurrency control
const resolveTracksWithLimit = async (
  tracks: any[],
  resolveFn: (track: any) => Promise<any>,
  limit = RESOLVE_CONCURRENCY
): Promise<PromiseSettledResult<any>[]> => {
  const results: PromiseSettledResult<any>[] = []

  for (let i = 0; i < tracks.length; i += limit) {
    const chunk = tracks.slice(i, i + limit)
    const settled = await Promise.allSettled(chunk.map(resolveFn))

    for (let j = 0; j < settled.length; j++) {
      results.push(settled[j])
    }
  }

  return results
}

// Playlist action handlers with improved structure
type PlaylistHandler = (
  interaction: any,
  client: any,
  userId: string,
  playlistName: string,
  playlist: any,
  page?: number
) => Promise<ActionResult> | ActionResult

const createPlaylistHandler = (handler: PlaylistHandler) => {
  return async (
    interaction: any,
    client: any,
    userId: string,
    playlistName: string,
    page?: number
  ): Promise<ActionResult> => {
    const playlist = playlistsCollection.findOne({ userId, name: playlistName })
    if (!playlist) {
      return { message: '❌ Playlist not found', shouldUpdate: false }
    }
    // Ensure both sync and async handlers are supported
    return await handler(interaction, client, userId, playlistName, playlist, page)
  }
}

const playlistActionHandlers: Record<string, ReturnType<typeof createPlaylistHandler>> = {
  play_playlist: createPlaylistHandler(async (interaction, client, userId, playlistName, playlist) => {
    if (!playlist.tracks?.length) {
      return { message: 'Playlist is empty', shouldUpdate: false }
    }

    const voiceState = await interaction.member?.voice()
    if (!voiceState?.channelId) {
      return { message: 'Join a voice channel first', shouldUpdate: false }
    }

    let player = client.aqua.players.get(interaction.guildId)

    if (!player) {
      player = client.aqua.createConnection({
        guildId: interaction.guildId,
        voiceChannel: voiceState.channelId,
        textChannel: interaction.channelId,
        defaultVolume: 65,
        deaf: true
      })
    }

    const resolved = await resolveTracksWithLimit(
      playlist.tracks,
      track => client.aqua.resolve({ query: track.uri, requester: interaction.user })
    )

    for (const result of resolved) {
      if (result.status === 'fulfilled' && result.value?.tracks?.[0]) {
        player.queue.add(result.value.tracks[0])
      }
    }

    playlistsCollection.update(
      { _id: playlist._id },
      {
        ...playlist,
        playCount: (playlist.playCount || 0) + 1,
        lastPlayedAt: Date.now()
      }
    )

    if (!player.playing && !player.paused && player.queue.size) {
      player.play()
    }

    return {
      message: `▶️ Playing playlist "${playlistName}" with ${playlist.tracks.length} tracks`,
      shouldUpdate: false
    }
  }),

  shuffle_playlist: createPlaylistHandler((interaction, client, userId, playlistName, playlist) => {
    if (!playlist.tracks?.length) {
      return { message: 'Playlist is empty', shouldUpdate: false }
    }

    playlistsCollection.update(
      { _id: playlist._id },
      { ...playlist, tracks: shuffleArray([...playlist.tracks]) }
    )

    return { message: `🔀 Shuffled playlist "${playlistName}"`, shouldUpdate: false }
  }),

  playlist_prev: createPlaylistHandler(async (interaction, client, userId, playlistName, playlist, page) => {
    const newPage = Math.max(1, (page || 1) - 1)
    const { embed, components } = buildPlaylistPage(playlist, playlistName, userId, newPage)
    await interaction.editOrReply({ embeds: [embed], components })
    return { message: '', shouldUpdate: false }
  }),

  playlist_next: createPlaylistHandler(async (interaction, client, userId, playlistName, playlist, page) => {
    const newPage = (page || 1) + 1
    const { embed, components } = buildPlaylistPage(playlist, playlistName, userId, newPage)
    await interaction.editOrReply({ embeds: [embed], components })
    return { message: '', shouldUpdate: false }
  })
}

// Optimized button ID parser using structure instead of string manipulation
interface ParsedButtonId {
  action: string
  playlistName?: string
  userId?: string
  page?: number
}

const parsePlaylistButtonId = (customId: string): ParsedButtonId | null => {
  const parts = customId.split('_')

  if (parts.length < 2) return null

  const userId = parts[parts.length - 1]

  // Handle pagination buttons
  if (parts[0] === 'playlist' && (parts[1] === 'prev' || parts[1] === 'next')) {
    const action = `playlist_${parts[1]}`
    const page = NUMERIC_PATTERN.test(parts[2]) ? Number.parseInt(parts[2], 10) : undefined
    const playlistName = parts.slice(3, -1).filter(p => !NUMERIC_PATTERN.test(p)).join('_')

    return { action, playlistName, userId, page }
  }

  // Handle standard playlist actions
  const knownActions = ['play_playlist', 'shuffle_playlist', 'add_playlist', 'view_playlist', 'create_playlist']

  for (let i = 1; i < parts.length; i++) {
    const potentialAction = parts.slice(0, i + 1).join('_')

    if (knownActions.includes(potentialAction)) {
      const playlistName = parts.slice(i + 1, -1).filter(p => !NUMERIC_PATTERN.test(p)).join('_')
      return { action: potentialAction, playlistName, userId }
    }
  }

  return null
}

// Update now playing embed efficiently
const updateNowPlayingEmbed = async (player: any, client: any): Promise<void> => {
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

// Main event handler
export default createEvent({
  data: { name: 'interactionCreate' },
  run: async (interaction, client) => {
    if (!interaction.isButton?.() || !interaction.customId || !interaction.guildId) return

    const customId = interaction.customId

    // Fast path: ignore buttons
    if (customId.startsWith('ignore_')) return

    // Parse button ID
    const parsed = parsePlaylistButtonId(customId)

    // Handle playlist buttons
    if (parsed && playlistActionHandlers[parsed.action]) {
      if (parsed.userId !== interaction.user.id) return

      try {
        await interaction.deferReply(64)
      } catch {
        return
      }

      const handler = playlistActionHandlers[parsed.action]

      try {
        const result = await handler(
          interaction,
          client,
          parsed.userId,
          parsed.playlistName || '',
          parsed.page
        )

        if (result.message) {
          await interaction.followup({ content: result.message }).catch(() => { })
        }
      } catch {
        await interaction.editOrReply({ content: '❌ An error occurred.' }).catch(() => { })
      }

      return
    }

    // Handle playback control buttons
    try {
      await interaction.deferReply(64)
    } catch {
      return
    }

    const player = client.aqua?.players?.get?.(interaction.guildId)

    if (!player) {
      return interaction.editOrReply({
        content: '❌ There is no active music player in this server.'
      }).catch(() => { })
    }

    if (!player.current) {
      return interaction.editOrReply({
        content: '❌ There is no music playing right now.',
        flags: 64
      }).catch(() => { })
    }

    const memberVoice = await interaction.member?.voice().catch(() => null)
    if (!memberVoice) {
      return interaction.editOrReply({
        content: '❌ You must be in a voice channel to use this button.'
      }).catch(() => { })
    }

    if (interaction.user.id !== player.current.requester?.id) {
      return interaction.editOrReply({
        content: '❌ You are not allowed to use this button.'
      }).catch(() => { })
    }

    const handler = actionHandlers[customId]
    if (!handler) {
      return interaction.editOrReply({
        content: '❌ This button action is not recognized.'
      }).catch(() => { })
    }

    try {
      const result = await handler(player)
      await interaction.followup({ content: result.message }).catch(() => { })

      if (result.shouldUpdate && player.current) {
        queueMicrotask(() => updateNowPlayingEmbed(player, client))
      }
    } catch {
      await interaction.editOrReply({
        content: '❌ An error occurred. Please try again.'
      }).catch(() => { })
    }
  }
})

export { formatTime, truncateText, getPlatform }