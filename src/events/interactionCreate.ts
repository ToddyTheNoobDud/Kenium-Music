import { createEvent } from 'seyfert'
import { ICONS, LIMITS } from '../shared/constants.ts'
import type {
  AquaClientLike,
  InteractionLike,
  PlayerLike,
  ResolveResultLike,
  TrackLike
} from '../shared/helperTypes.ts'
import {
  formatTime,
  getPlatform,
  getQueueLength,
  truncateText,
  updateNowPlayingEmbed
} from '../shared/nowPlaying.ts'
import {
  ensureMemberCanControlPlayer,
  playPreviousTrack
} from '../shared/playback.ts'
import { getOrCreatePlayer } from '../shared/player.ts'
import {
  botAvatarUrl,
  createButtons,
  createEmbed,
  formatDuration,
  shuffleArray
} from '../shared/utils.ts'
import {
  getPlaylistsCollection,
  getPlaylistTracks,
  getTracksCollection
} from '../utils/db.ts'
import { isInteractionExpired, safeDefer } from '../utils/interactions.ts'
import { classifyInteractionId } from './playlistInteraction.ts'
import {
  decidePlaylistPlayer,
  enqueueTracksAndCount
} from './playlistPlayback.ts'

const VOLUME_STEP = 10
const MAX_VOLUME = 100
const MIN_VOLUME = 0
const PAGE_SIZE = LIMITS.PAGE_SIZE || 10
const RESOLVE_CONCURRENCY = 5

let _playlistsCol: ReturnType<typeof getPlaylistsCollection> | null = null
let _tracksCol: ReturnType<typeof getTracksCollection> | null = null

type ActionResult = {
  message: string
  shouldUpdate: boolean
}

type PlaylistButtonAction =
  | 'play_playlist'
  | 'shuffle_playlist'
  | 'playlist_prev'
  | 'playlist_next'

type StoredPlaylistTrackLike = {
  uri?: string
  title?: string
  author?: string
  duration?: number
}

type PlaylistSummaryLike = {
  _id: string
  name?: string
  description?: string
  totalDuration?: number
  playCount?: number
  trackCount?: number
}

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
      if (id?.length !== 11) return false
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

  setPlayerVolume: (player: PlayerLike, volume: number) =>
    player?.setVolume?.(volume),

  safeReply: async (interaction: InteractionLike, content: string) => {
    try {
      if (typeof interaction.editOrReply === 'function') {
        await interaction.editOrReply({ content })
      }
    } catch {}
  },
  safeFollowup: async (interaction: InteractionLike, content: string) => {
    try {
      if (typeof interaction.followup === 'function') {
        await interaction.followup({ content })
      }
    } catch {}
  },

  updateNowPlayingEmbed,

  resolveTracksAndEnqueue: async (
    tracks: StoredPlaylistTrackLike[],
    resolveFn: (
      track: StoredPlaylistTrackLike
    ) => Promise<ResolveResultLike<TrackLike>>,
    enqueueFn: (track: TrackLike) => unknown,
    limit = RESOLVE_CONCURRENCY
  ): Promise<number> => {
    const list = Array.isArray(tracks) ? tracks : []
    let enqueuedCount = 0
    for (let i = 0; i < list.length; i += limit) {
      const batch = list.slice(i, i + limit)
      const settled = await Promise.allSettled(batch.map(resolveFn))
      for (const r of settled) {
        if (r.status !== 'fulfilled') continue
        const track = r.value?.tracks?.[0]
        if (track)
          enqueuedCount += await enqueueTracksAndCount([track], enqueueFn)
      }
    }
    return enqueuedCount
  }
}

const adjustVolume = async (
  player: PlayerLike,
  delta: number
): Promise<ActionResult> => {
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
  (player: PlayerLike) => ActionResult | Promise<ActionResult>
> = {
  volume_down: (player: PlayerLike) => adjustVolume(player, -VOLUME_STEP),
  volume_up: (player: PlayerLike) => adjustVolume(player, VOLUME_STEP),

  previous: async (player: PlayerLike) => {
    const playedPrevious = await playPreviousTrack(player)
    return playedPrevious
      ? { message: '⏮️ Playing the previous track.', shouldUpdate: false }
      : {
          message: '❌ No previous track available',
          shouldUpdate: false
        }
  },

  resume: (player: PlayerLike) => {
    player.pause?.(false)
    return { message: '▶️ Resumed playback.', shouldUpdate: true }
  },

  pause: (player: PlayerLike) => {
    player.pause?.(true)
    return { message: '⏸️ Paused playback.', shouldUpdate: true }
  },

  skip: (player: PlayerLike) => {
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
  playlist: PlaylistSummaryLike,
  playlistName: string,
  userId: string,
  page: number | undefined,
  iconUrl?: string | undefined
) => {
  const total =
    typeof playlist?.trackCount === 'number'
      ? playlist.trackCount
      : tracksCol().count({ playlistId: playlist._id })
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.min(Math.max(1, page || 1), totalPages)
  const startIdx = (currentPage - 1) * PAGE_SIZE

  const tracks = getPlaylistTracks(playlist._id, {
    limit: PAGE_SIZE,
    skip: startIdx,
    fields: ['title', 'author', 'duration', 'uri']
  })

  const embed = createEmbed(
    'primary',
    `${ICONS.playlist} ${playlistName}`,
    '',
    [],
    iconUrl
  )
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

const displayPlaylistById = async (
  interaction: InteractionLike,
  playlistId: string,
  userId: string,
  iconUrl?: string | undefined
): Promise<ActionResult> => {
  const playlist = playlistsCol().findOne(
    { _id: playlistId, userId },
    {
      fields: [
        '_id',
        'name',
        'description',
        'totalDuration',
        'playCount',
        'trackCount'
      ]
    }
  )
  if (!playlist)
    return { message: '❌ Playlist not found.', shouldUpdate: false }

  const { embed, components } = buildPlaylistPage(
    playlist,
    String(playlist.name || 'Playlist'),
    userId,
    1,
    iconUrl
  )
  if (typeof interaction.editOrReply === 'function') {
    await interaction.editOrReply({ embeds: [embed], components })
  }
  return { message: '', shouldUpdate: false }
}

const getAllPlaylistTracksBatched = (
  playlistId: string
): StoredPlaylistTrackLike[] => {
  const all: StoredPlaylistTrackLike[] = []
  let offset = 0
  while (true) {
    const batch = getPlaylistTracks(playlistId, {
      limit: PLAYLIST_BATCH_SIZE,
      skip: offset,
      fields: ['uri']
    })
    if (!batch.length) break
    all.push(...batch)
    if (batch.length < PLAYLIST_BATCH_SIZE) break
    offset += PLAYLIST_BATCH_SIZE
  }
  return all
}

const playlistActionHandlers: Record<
  PlaylistButtonAction,
  (
    interaction: InteractionLike,
    client: AquaClientLike,
    userId: string,
    playlistName: string,
    page?: number
  ) => Promise<ActionResult>
> = {
  play_playlist: async (
    interaction: InteractionLike,
    client: AquaClientLike,
    userId: string,
    playlistName: string
  ) => {
    const playlist = playlistsCol().findOne(
      {
        userId,
        name: playlistName
      },
      {
        fields: ['_id']
      }
    )
    if (!playlist)
      return { message: '❌ Playlist not found', shouldUpdate: false }

    const trackCount = tracksCol().count({ playlistId: playlist._id })
    if (trackCount === 0)
      return { message: '❌ Playlist is empty', shouldUpdate: false }

    let voiceState = null
    try {
      voiceState =
        typeof interaction.member?.voice === 'function'
          ? await interaction.member.voice()
          : null
    } catch {
      voiceState = null
    }
    if (!voiceState?.channelId)
      return {
        message: '\u274c Join a voice channel first',
        shouldUpdate: false
      }
    if (!interaction.guildId)
      return { message: '\u274c Guild not found', shouldUpdate: false }

    const existingPlayer = (
      client.aqua.players as {
        get: (guildId: string) => PlayerLike | undefined
      }
    ).get(interaction.guildId)
    const playerDecision = decidePlaylistPlayer(
      existingPlayer,
      voiceState.channelId
    )
    if (playerDecision.action === 'reject')
      return {
        message: '❌ You must be in the same voice channel as the player.',
        shouldUpdate: false
      }
    const player =
      playerDecision.action === 'reuse'
        ? existingPlayer
        : getOrCreatePlayer(client, {
            guildId: interaction.guildId,
            voiceChannel: voiceState.channelId,
            ...(interaction.channelId !== undefined
              ? { textChannel: interaction.channelId }
              : {})
          })
    if (!player) {
      return { message: '\u274c Failed to create player', shouldUpdate: false }
    }

    let loadedTracks = 0
    let offset = 0
    while (offset < trackCount) {
      const batch = getPlaylistTracks(playlist._id, {
        limit: PLAYLIST_BATCH_SIZE,
        skip: offset,
        fields: ['uri']
      })
      if (!batch.length) break

      loadedTracks += await _functions.resolveTracksAndEnqueue(
        batch,
        (t: StoredPlaylistTrackLike) =>
          client.aqua.resolve({
            query: t.uri || '',
            requester: interaction.user
          }),
        (track: TrackLike) => {
          if (typeof player.queue?.add !== 'function')
            throw new Error('Player queue is unavailable')
          return player.queue.add(track)
        },
        RESOLVE_CONCURRENCY
      )

      offset += PLAYLIST_BATCH_SIZE
    }

    if (loadedTracks > 0) {
      playlistsCol().updateAtomic(
        { _id: playlist._id },
        {
          $inc: { playCount: 1 },
          $set: { lastPlayedAt: new Date().toISOString() }
        }
      )
    }

    if (!player.playing && !player.paused && (player.queue?.size ?? 0) > 0) {
      const playResult = player.play?.()
      if (
        playResult &&
        typeof playResult === 'object' &&
        'catch' in playResult
      ) {
        ;(playResult as Promise<unknown>).catch(() => {})
      }
    }
    return {
      message: `▶️ Playing playlist "${playlistName}" with ${loadedTracks} tracks`,
      shouldUpdate: false
    }
  },

  shuffle_playlist: async (
    interaction: InteractionLike,
    client: AquaClientLike,
    userId: string,
    playlistName: string
  ) => {
    const playlist = playlistsCol().findOne(
      {
        userId,
        name: playlistName
      },
      {
        fields: ['_id']
      }
    )
    if (!playlist)
      return { message: '❌ Playlist not found', shouldUpdate: false }
    let voiceState = null
    try {
      voiceState =
        typeof interaction.member?.voice === 'function'
          ? await interaction.member.voice()
          : null
    } catch {
      voiceState = null
    }
    if (!voiceState?.channelId)
      return {
        message: '\u274c Join a voice channel first',
        shouldUpdate: false
      }
    if (!interaction.guildId)
      return { message: '\u274c Guild not found', shouldUpdate: false }

    const existingPlayer = (
      client.aqua.players as {
        get: (guildId: string) => PlayerLike | undefined
      }
    ).get(interaction.guildId)
    const playerDecision = decidePlaylistPlayer(
      existingPlayer,
      voiceState.channelId
    )
    if (playerDecision.action === 'reject')
      return {
        message: '❌ You must be in the same voice channel as the player.',
        shouldUpdate: false
      }
    const player =
      playerDecision.action === 'reuse'
        ? existingPlayer
        : getOrCreatePlayer(client, {
            guildId: interaction.guildId,
            voiceChannel: voiceState.channelId,
            ...(interaction.channelId !== undefined
              ? { textChannel: interaction.channelId }
              : {})
          })
    if (!player) {
      return { message: '\u274c Failed to create player', shouldUpdate: false }
    }

    const allTracks = getAllPlaylistTracksBatched(playlist._id)
    const shuffled = shuffleArray(allTracks)

    const loadedTracks = await _functions.resolveTracksAndEnqueue(
      shuffled,
      (t: StoredPlaylistTrackLike) =>
        client.aqua.resolve({
          query: t.uri || '',
          requester: interaction.user
        }),
      (track: TrackLike) => {
        if (typeof player.queue?.add !== 'function')
          throw new Error('Player queue is unavailable')
        return player.queue.add(track)
      },
      RESOLVE_CONCURRENCY
    )

    if (loadedTracks > 0) {
      playlistsCol().updateAtomic(
        { _id: playlist._id },
        {
          $inc: { playCount: 1 },
          $set: { lastPlayedAt: new Date().toISOString() }
        }
      )
    }

    if (!player.playing && !player.paused && (player.queue?.size ?? 0) > 0) {
      const playResult = player.play?.()
      if (
        playResult &&
        typeof playResult === 'object' &&
        'catch' in playResult
      ) {
        ;(playResult as Promise<unknown>).catch(() => {})
      }
    }
    return {
      message: `🔀 Playing shuffled playlist "${playlistName}" with ${loadedTracks} tracks`,
      shouldUpdate: false
    }
  },

  playlist_prev: async (
    interaction: InteractionLike,
    client: AquaClientLike,
    userId: string,
    playlistName: string,
    page: number | undefined
  ) => {
    const playlist = playlistsCol().findOne(
      {
        userId,
        name: playlistName
      },
      {
        fields: [
          '_id',
          'description',
          'totalDuration',
          'playCount',
          'trackCount'
        ]
      }
    )
    if (!playlist)
      return { message: '❌ Playlist not found', shouldUpdate: false }
    const { embed, components } = buildPlaylistPage(
      playlist,
      playlistName,
      userId,
      Math.max(1, (page || 1) - 1),
      botAvatarUrl(client)
    )
    if (typeof interaction.editOrReply === 'function') {
      await interaction.editOrReply({ embeds: [embed], components })
    }
    return { message: '', shouldUpdate: false }
  },

  playlist_next: async (
    interaction: InteractionLike,
    client: AquaClientLike,
    userId: string,
    playlistName: string,
    page: number | undefined
  ) => {
    const playlist = playlistsCol().findOne(
      {
        userId,
        name: playlistName
      },
      {
        fields: [
          '_id',
          'description',
          'totalDuration',
          'playCount',
          'trackCount'
        ]
      }
    )
    if (!playlist)
      return { message: '❌ Playlist not found', shouldUpdate: false }
    const { embed, components } = buildPlaylistPage(
      playlist,
      playlistName,
      userId,
      (page || 1) + 1,
      botAvatarUrl(client)
    )
    if (typeof interaction.editOrReply === 'function') {
      await interaction.editOrReply({ embeds: [embed], components })
    }
    return { message: '', shouldUpdate: false }
  }
}

export default createEvent({
  data: { name: 'interactionCreate' },
  run: async (interaction, client): Promise<void> => {
    const isButton = interaction?.isButton?.() === true
    const isPlaylistSelect = interaction?.isStringSelectMenu?.() === true
    if ((!isButton && !isPlaylistSelect) || !interaction?.customId) return

    const classified = classifyInteractionId(interaction.customId)
    if (classified.kind === 'ignore') return
    if (classified.kind === 'unknown') {
      if (!(await safeDefer(interaction, 64))) return
      await _functions.safeReply(
        interaction,
        '❌ This component action is not recognized.'
      )
      return
    }

    if (
      classified.kind === 'playlist' ||
      classified.kind === 'playlist-select'
    ) {
      if (!(await safeDefer(interaction, 64))) return
      if (classified.userId !== interaction.user.id) {
        await _functions.safeReply(
          interaction,
          '❌ Only the playlist owner can use this control.'
        )
        return
      }
      try {
        let result: ActionResult
        if (classified.kind === 'playlist-select') {
          const playlistId = interaction.isStringSelectMenu()
            ? interaction.values[0]
            : undefined
          result = playlistId
            ? await displayPlaylistById(
                interaction,
                playlistId,
                classified.userId,
                botAvatarUrl(client)
              )
            : { message: '❌ No playlist was selected.', shouldUpdate: false }
        } else if (classified.action === 'view') {
          result = await displayPlaylistById(
            interaction,
            classified.playlistId,
            classified.userId,
            botAvatarUrl(client)
          )
        } else {
          const action =
            classified.action === 'play'
              ? 'play_playlist'
              : classified.action === 'shuffle'
                ? 'shuffle_playlist'
                : classified.action === 'previous'
                  ? 'playlist_prev'
                  : 'playlist_next'
          result = await playlistActionHandlers[action](
            interaction,
            client,
            classified.userId,
            classified.playlistName,
            'page' in classified ? classified.page : undefined
          )
        }
        if (result?.message)
          await _functions.safeFollowup(interaction, result.message)
      } catch (err) {
        if (isInteractionExpired(err)) return
        console.error('Playlist button error:', err)
        _functions.safeReply(interaction, '❌ An error occurred.')
      }
      return
    }

    if (!interaction.guildId) {
      if (!(await safeDefer(interaction, 64))) return
      await _functions.safeReply(
        interaction,
        '❌ This control requires a server.'
      )
      return
    }
    if (!(await safeDefer(interaction, 64))) return

    const player = client.aqua?.players?.get?.(interaction.guildId)
    if (!player) {
      await _functions.safeReply(
        interaction,
        '\u274c There is no active music player in this server.'
      )
      return
    }
    if (!player.current) {
      await _functions.safeReply(
        interaction,
        '\u274c There is no music playing right now.'
      )
      return
    }

    const controlCheck = await ensureMemberCanControlPlayer(
      interaction,
      player,
      {
        requesterOnly: true
      }
    )
    if (!controlCheck.ok) {
      await _functions.safeReply(
        interaction,
        controlCheck.reason || '\u274c You are not allowed to use this button.'
      )
      return
    }

    const handler = actionHandlers[interaction.customId]
    if (!handler) {
      await _functions.safeReply(
        interaction,
        '\u274c This button action is not recognized.'
      )
      return
    }

    try {
      const result = await handler(player)
      await _functions.safeFollowup(interaction, result.message)
      if (result.shouldUpdate && player.current)
        queueMicrotask(() => _functions.updateNowPlayingEmbed(player, client))
    } catch (err) {
      if (isInteractionExpired(err)) return
      console.error('Action button error:', err)
      _functions.safeReply(
        interaction,
        '❌ An error occurred. Please try again.'
      )
    }
  }
})

export { formatTime, getPlatform, truncateText }
