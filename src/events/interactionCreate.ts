import { createEvent } from 'seyfert'
import { ICONS, LIMITS } from '../shared/constants'
import {
  formatTime,
  getPlatform,
  getQueueLength,
  truncateText,
  updateNowPlayingEmbed
} from '../shared/nowPlaying'
import { getOrCreatePlayer } from '../shared/player'
import {
  createButtons,
  createEmbed,
  formatDuration,
  shuffleArray
} from '../shared/utils'
import {
  getPlaylistsCollection,
  getPlaylistTracks,
  getTracksCollection
} from '../utils/db'

const VOLUME_STEP = 10
const MAX_VOLUME = 100
const MIN_VOLUME = 0
const PAGE_SIZE = LIMITS.PAGE_SIZE || 10
const RESOLVE_CONCURRENCY = 5

let _playlistsCol: ReturnType<typeof getPlaylistsCollection> | null = null
let _tracksCol: ReturnType<typeof getTracksCollection> | null = null

const playlistsCol = () => {
  if (!_playlistsCol) _playlistsCol = getPlaylistsCollection()
  return _playlistsCol
}
const tracksCol = () => {
  if (!_tracksCol) _tracksCol = getTracksCollection()
  return _tracksCol
}

export const _functions = {
  clamp: (n: number, min: number, max: number) =>
    n < min ? min : n > max ? max : n,

  getQueueLength,
  formatTime,
  truncateText,
  getPlatform,

  getSourceIcon: (uri: string | undefined) => {
    if (!uri) return ICONS.music
    const s = uri.toLowerCase()
    if (s.includes('youtu')) return ICONS.youtube
    if (s.includes('spotify')) return ICONS.spotify
    if (s.includes('soundcloud')) return ICONS.soundcloud
    return ICONS.music
  },

  extractYouTubeId: (uri: string | undefined) => {
    if (!uri) return null
    const s = String(uri)
    const lower = s.toLowerCase()
    if (!lower.includes('youtu')) return null

    const isValidId = (id: string) => {
      if (!id || id.length !== 11) return false
      for (let i = 0; i < id.length; i++) {
        const c = id.charCodeAt(i)
        const ok =
          (c >= 48 && c <= 57) ||
          (c >= 65 && c <= 90) ||
          (c >= 97 && c <= 122) ||
          c === 45 || // -
          c === 95 // _
        if (!ok) return false
      }
      return true
    }

    const cutAtDelim = (str: string) => {
      let end = str.length
      for (const d of ['?', '&', '/', '#']) {
        const idx = str.indexOf(d)
        if (idx !== -1 && idx < end) end = idx
      }
      return str.slice(0, end)
    }

    const shortIdx = lower.indexOf('youtu.be/')
    if (shortIdx !== -1) {
      const raw = s.slice(shortIdx + 'youtu.be/'.length)
      const id = cutAtDelim(raw)
      return isValidId(id) ? id : null
    }

    const qv = lower.indexOf('?v=')
    const av = lower.indexOf('&v=')
    const idx = qv !== -1 ? qv + 3 : av !== -1 ? av + 3 : -1
    if (idx === -1) return null

    const id = cutAtDelim(s.slice(idx))
    return isValidId(id) ? id : null
  },

  setPlayerVolume: (player: any, volume: number) => player?.setVolume?.(volume),

  addToQueueFront: (queue: any, item: any) => {
    if (!queue) return
    if (typeof queue.unshift === 'function') queue.unshift(item)
    else queue.add?.(item)?.catch?.(() => {})
  },

  safeDefer: async (interaction: any, flags = 64) => {
    try {
      await interaction.deferReply(flags)
      return true
    } catch {
      try {
        await interaction.deferReply({ flags })
        return true
      } catch {
        return false
      }
    }
  },

  safeReply: (interaction: any, content: string | any) =>
    interaction.editOrReply({ content }).catch(() => {}),
  safeFollowup: (interaction: any, content: string | any) =>
    interaction.followup({ content }).catch(() => {}),

  parsePlaylistButtonId: (customId: any) => {
    if (!customId) return null
    const parts = customId.split('_')
    if (parts.length < 3) return null

    const userId = parts.at(-1)
    if (!userId) return null

    const a0 = parts[0]
    const a1 = parts[1]

    if ((a0 === 'play' || a0 === 'shuffle') && a1 === 'playlist') {
      return {
        action: `${a0}_${a1}`,
        playlistName: parts.slice(2, -1).join('_'),
        userId
      }
    }

    if (a0 === 'playlist' && (a1 === 'prev' || a1 === 'next')) {
      const page = Number(parts[2])
      return {
        action: `playlist_${a1}`,
        playlistName: parts.slice(3, -1).join('_'),
        userId,
        page: Number.isFinite(page) ? page : undefined
      }
    }

    return null
  },

  updateNowPlayingEmbed,

  resolveTracksAndEnqueue: async (
    tracks: any[],
    resolveFn: (track: any) => Promise<any>,
    enqueueFn: (track: any) => void,
    limit = RESOLVE_CONCURRENCY
  ) => {
    const list = Array.isArray(tracks) ? tracks : []
    for (let i = 0; i < list.length; i += limit) {
      const batch = list.slice(i, i + limit)
      const settled = await Promise.allSettled(batch.map(resolveFn))
      for (const r of settled) {
        if (r.status !== 'fulfilled') continue
        const track = (r.value as any)?.tracks?.[0]
        if (track) enqueueFn(track)
      }
    }
  }
}

const adjustVolume = async (player: any, delta: number) => {
  const vol = _functions.clamp(
    (player?.volume || 0) + delta,
    MIN_VOLUME,
    MAX_VOLUME
  )
  await _functions.setPlayerVolume(player, vol)
  return {
    message: `${delta > 0 ? '🔊' : '🔉'} Volume set to ${vol}%`,
    shouldUpdate: true
  }
}

const actionHandlers: Record<
  string,
  (player: any) => { message: string; shouldUpdate: boolean } | Promise<any>
> = {
  volume_down: (player: any) => adjustVolume(player, -VOLUME_STEP),
  volume_up: (player: any) => adjustVolume(player, VOLUME_STEP),

  previous: (player: any) => {
    if (!player?.previous)
      return { message: '❌ No previous track available', shouldUpdate: false }
    if (player.current) _functions.addToQueueFront(player.queue, player.current)
    _functions.addToQueueFront(player.queue, player.previous)
    player.stop?.()
    return { message: '⏮️ Playing the previous track.', shouldUpdate: false }
  },

  resume: (player: any) => {
    player.pause?.(false)
    return { message: '▶️ Resumed playback.', shouldUpdate: true }
  },

  pause: (player: any) => {
    player.pause?.(true)
    return { message: '⏸️ Paused playback.', shouldUpdate: true }
  },

  skip: (player: any) => {
    if (!_functions.getQueueLength(player?.queue))
      return {
        message: '❌ No tracks in queue to skip to.',
        shouldUpdate: false
      }
    player.skip?.()
    return { message: '⏭️ Skipped to the next track.', shouldUpdate: false }
  }
}

const buildPlaylistPage = (
  playlist: any,
  playlistName: string,
  userId: string,
  page: number | undefined
) => {
  const total = tracksCol().count({ playlistId: playlist._id })
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.min(Math.max(1, page || 1), totalPages)
  const startIdx = (currentPage - 1) * PAGE_SIZE

  const tracks = getPlaylistTracks(playlist._id, {
    limit: PAGE_SIZE,
    skip: startIdx
  })

  const embed = createEmbed('primary', `${ICONS.playlist} ${playlistName}`, '')
  embed.addFields(
    {
      name: `${ICONS.info} Info`,
      value: playlist?.description || 'No description',
      inline: false
    },
    { name: `${ICONS.tracks} Tracks`, value: String(total), inline: true },
    {
      name: `${ICONS.duration} Duration`,
      value: formatDuration(playlist?.totalDuration || 0),
      inline: true
    },
    {
      name: `${ICONS.info} Plays`,
      value: String(playlist?.playCount || 0),
      inline: true
    }
  )

  if (tracks.length) {
    embed.addFields({
      name: `${ICONS.music} Tracks (Page ${currentPage}/${totalPages})`,
      value: tracks
        .map((t, i) => {
          const pos = String(startIdx + i + 1).padStart(2, '0')
          return `\`${pos}.\` **${t.title}**\n     ${ICONS.artist} ${t.author || 'Unknown'} • ${ICONS.duration} ${formatDuration((t.duration as number) || 0)} ${_functions.getSourceIcon(t.uri as string | undefined)}`
        })
        .join('\n\n'),
      inline: false
    })

    const firstVideoId = _functions.extractYouTubeId(
      tracks[0]?.uri as string | undefined
    )
    if (firstVideoId)
      embed.setThumbnail(
        `https://img.youtube.com/vi/${firstVideoId}/maxresdefault.jpg`
      )
  }

  const components = [
    createButtons([
      {
        id: `play_playlist_${playlistName}_${userId}`,
        label: 'Play',
        emoji: ICONS.play,
        style: 3
      },
      {
        id: `shuffle_playlist_${playlistName}_${userId}`,
        label: 'Shuffle',
        emoji: ICONS.shuffle,
        style: 1
      }
    ])
  ]

  if (totalPages > 1) {
    components.push(
      createButtons([
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
      ])
    )
  }

  return { embed, components }
}

const PLAYLIST_BATCH_SIZE = 50

const getAllPlaylistTracksBatched = (playlistId: string): any[] => {
  const all: any[] = []
  let offset = 0
  while (true) {
    const batch = getPlaylistTracks(playlistId, {
      limit: PLAYLIST_BATCH_SIZE,
      skip: offset
    })
    if (!batch.length) break
    all.push(...batch)
    if (batch.length < PLAYLIST_BATCH_SIZE) break
    offset += PLAYLIST_BATCH_SIZE
  }
  return all
}

const playlistActionHandlers: Record<string, any> = {
  play_playlist: async (
    interaction: any,
    client: any,
    userId: string,
    playlistName: string
  ) => {
    const playlist = playlistsCol().findOne({
      userId,
      name: playlistName
    })
    if (!playlist)
      return { message: '❌ Playlist not found', shouldUpdate: false }

    const trackCount = tracksCol().count({ playlistId: playlist._id })
    if (trackCount === 0)
      return { message: '❌ Playlist is empty', shouldUpdate: false }

    let voiceState = null
    try {
      voiceState = await interaction.member?.voice()
    } catch {
      voiceState = null
    }
    if (!voiceState?.channelId)
      return { message: '❌ Join a voice channel first', shouldUpdate: false }

    const player = getOrCreatePlayer(client, {
      guildId: interaction.guildId,
      voiceChannel: voiceState.channelId,
      textChannel: interaction.channelId
    })

    let loadedTracks = 0
    let offset = 0
    while (loadedTracks < trackCount) {
      const batch = getPlaylistTracks(playlist._id, {
        limit: PLAYLIST_BATCH_SIZE,
        skip: offset
      })
      if (!batch.length) break

      await _functions.resolveTracksAndEnqueue(
        batch,
        (t) =>
          client.aqua.resolve({ query: t.uri, requester: interaction.user }),
        (track) => player.queue.add(track),
        RESOLVE_CONCURRENCY
      )

      loadedTracks += batch.length
      offset += PLAYLIST_BATCH_SIZE
    }

    playlistsCol().updateAtomic(
      { _id: playlist._id },
      {
        $inc: { playCount: 1 },
        $set: { lastPlayedAt: new Date().toISOString() }
      }
    )

    if (!player.playing && !player.paused && player.queue.size)
      player.play().catch(() => {})
    return {
      message: `▶️ Playing playlist "${playlistName}" with ${loadedTracks} tracks`,
      shouldUpdate: false
    }
  },

  shuffle_playlist: async (
    interaction: any,
    client: any,
    userId: string,
    playlistName: string
  ) => {
    const playlist = playlistsCol().findOne({
      userId,
      name: playlistName
    })
    if (!playlist)
      return { message: '❌ Playlist not found', shouldUpdate: false }

    const trackCount = tracksCol().count({ playlistId: playlist._id })
    if (trackCount === 0)
      return { message: '❌ Playlist is empty', shouldUpdate: false }

    let voiceState = null
    try {
      voiceState = await interaction.member?.voice()
    } catch {
      voiceState = null
    }
    if (!voiceState?.channelId)
      return { message: '❌ Join a voice channel first', shouldUpdate: false }

    const player = getOrCreatePlayer(client, {
      guildId: interaction.guildId,
      voiceChannel: voiceState.channelId,
      textChannel: interaction.channelId
    })

    const allTracks = getAllPlaylistTracksBatched(playlist._id)
    const shuffled = shuffleArray(allTracks)

    await _functions.resolveTracksAndEnqueue(
      shuffled,
      (t: any) =>
        client.aqua.resolve({ query: t.uri, requester: interaction.user }),
      (track: any) => player.queue.add(track),
      RESOLVE_CONCURRENCY
    )

    if (!player.playing && !player.paused && player.queue.size)
      player.play().catch(() => {})
    return {
      message: `🔀 Playing shuffled playlist "${playlistName}"`,
      shouldUpdate: false
    }
  },

  playlist_prev: async (
    interaction: any,
    _client: any,
    userId: string,
    playlistName: string,
    page: number | undefined
  ) => {
    const playlist = playlistsCol().findOne({
      userId,
      name: playlistName
    })
    if (!playlist)
      return { message: '❌ Playlist not found', shouldUpdate: false }
    const { embed, components } = buildPlaylistPage(
      playlist,
      playlistName,
      userId,
      Math.max(1, (page || 1) - 1)
    )
    await interaction.editOrReply({ embeds: [embed], components })
    return { message: '', shouldUpdate: false }
  },

  playlist_next: async (
    interaction: any,
    _client: any,
    userId: string,
    playlistName: string,
    page: number | undefined
  ) => {
    const playlist = playlistsCol().findOne({
      userId,
      name: playlistName
    })
    if (!playlist)
      return { message: '❌ Playlist not found', shouldUpdate: false }
    const { embed, components } = buildPlaylistPage(
      playlist,
      playlistName,
      userId,
      (page || 1) + 1
    )
    await interaction.editOrReply({ embeds: [embed], components })
    return { message: '', shouldUpdate: false }
  }
}

export default createEvent({
  data: { name: 'interactionCreate' },
  run: async (interaction, client) => {
    if (
      !interaction?.isButton?.() ||
      !interaction?.customId ||
      !interaction?.guildId
    )
      return
    if (interaction.customId.startsWith('ignore_')) return

    const parsed = _functions.parsePlaylistButtonId(interaction.customId)
    if (parsed && (playlistActionHandlers as any)[parsed.action]) {
      if (parsed.userId !== interaction.user.id) return
      if (!(await _functions.safeDefer(interaction))) return
      try {
        const result = await (playlistActionHandlers as any)[parsed.action](
          interaction,
          client,
          parsed.userId,
          parsed.playlistName || '',
          parsed.page
        )
        if (result?.message)
          await _functions.safeFollowup(interaction, result.message)
      } catch (err) {
        console.error('Playlist button error:', err)
        _functions.safeReply(interaction, '❌ An error occurred.')
      }
      return
    }

    if (!(await _functions.safeDefer(interaction))) return

    const player = client.aqua?.players?.get?.(interaction.guildId)
    if (!player)
      return _functions.safeReply(
        interaction,
        '❌ There is no active music player in this server.'
      )
    if (!player.current)
      return _functions.safeReply(
        interaction,
        '❌ There is no music playing right now.'
      )

    const memberVoice = await interaction.member?.voice().catch(() => null)
    if (!memberVoice)
      return _functions.safeReply(
        interaction,
        '❌ You must be in a voice channel to use this button.'
      )
    if (interaction.user.id !== player.current.requester?.id)
      return _functions.safeReply(
        interaction,
        '❌ You are not allowed to use this button.'
      )

    const handler = (actionHandlers as any)[interaction.customId]
    if (!handler)
      return _functions.safeReply(
        interaction,
        '❌ This button action is not recognized.'
      )

    try {
      const result = await handler(player)
      await _functions.safeFollowup(interaction, result.message)
      if (result.shouldUpdate && player.current)
        queueMicrotask(() => _functions.updateNowPlayingEmbed(player, client))
    } catch (err) {
      console.error('Action button error:', err)
      _functions.safeReply(
        interaction,
        '❌ An error occurred. Please try again.'
      )
    }
  }
})

export { formatTime, truncateText, getPlatform }
