import type { Player } from 'aqualink'
import {
  type APIContainerComponent,
  type APITextDisplayComponent,
  type ButtonInteraction,
  Container,
  createEvent,
  type StringSelectMenuInteraction,
  type UsingClient
} from 'seyfert'
import { ICONS, LIMITS } from '../shared/constants.ts'
import {
  getQueueLength,
  truncateText,
  updateNowPlayingEmbed
} from '../shared/nowPlaying.ts'
import {
  ensureMemberCanControlPlayer,
  getQueueLoadState,
  playPreviousTrack
} from '../shared/playback.ts'
import { getOrCreatePlayer } from '../shared/player.ts'
import type { Playlist } from '../shared/types.ts'
import {
  createButtons,
  extractYouTubeId,
  formatDuration,
  shuffleArray
} from '../shared/utils.ts'
import {
  getPlaylistsCollection,
  getPlaylistTracks,
  getTracksCollection
} from '../utils/db.ts'
import {
  getMemberVoiceState,
  isInteractionExpired,
  safeDefer
} from '../utils/interactions.ts'
import { classifyInteractionId } from './playlistInteraction.ts'
import {
  decidePlaylistPlayer,
  registerPendingPlaylistLoads,
  topUpPlaylistBuffer
} from './playlistPlayback.ts'

type MusicComponentInteraction = ButtonInteraction | StringSelectMenuInteraction

const VOLUME_STEP = 10
const MAX_VOLUME = 100
const MIN_VOLUME = 0
const PAGE_SIZE = LIMITS.PAGE_SIZE
const PLAYLIST_VIEW_FLAGS = 64 | 32768

type ActionResult = {
  message: string
  shouldUpdate: boolean
}

type PlaylistButtonAction =
  | 'play_playlist'
  | 'shuffle_playlist'
  | 'playlist_prev'
  | 'playlist_next'

type PlaylistSummary = Pick<
  Playlist,
  '_id' | 'name' | 'description' | 'totalDuration' | 'playCount' | 'trackCount'
>

const playlistsCol = getPlaylistsCollection
const tracksCol = getTracksCollection

const getSourceIcon = (uri: string | undefined) => {
  const source = uri?.toLowerCase() ?? ''
  if (source.includes('youtu')) {
    return ICONS.youtube
  }
  if (source.includes('spotify')) {
    return ICONS.spotify
  }
  if (source.includes('soundcloud')) {
    return ICONS.soundcloud
  }
  return ICONS.music
}

const safeReply = async (
  interaction: MusicComponentInteraction,
  content: string
) => {
  try {
    await interaction.editOrReply({ content })
  } catch (error) {
    if (!isInteractionExpired(error)) {
      throw error
    }
  }
}

const safeFollowup = async (
  interaction: MusicComponentInteraction,
  content: string
) => {
  try {
    await interaction.followup({ content })
  } catch (error) {
    if (!isInteractionExpired(error)) {
      throw error
    }
  }
}

const adjustVolume = async (
  player: Player,
  delta: number
): Promise<ActionResult> => {
  const volume = Math.min(
    MAX_VOLUME,
    Math.max(MIN_VOLUME, player.volume + delta)
  )
  await player.setVolume(volume)
  return {
    message: `${delta > 0 ? '🔊' : '🔉'} Volume set to ${volume}%`,
    shouldUpdate: true
  }
}

const actionHandlers: Record<
  string,
  (player: Player) => ActionResult | Promise<ActionResult>
> = {
  volume_down: (player: Player) => adjustVolume(player, -VOLUME_STEP),
  volume_up: (player: Player) => adjustVolume(player, VOLUME_STEP),

  previous: async (player: Player) => {
    const playedPrevious = await playPreviousTrack(player)
    return playedPrevious
      ? { message: '⏮️ Playing the previous track.', shouldUpdate: false }
      : {
          message: '❌ No previous track available',
          shouldUpdate: false
        }
  },

  resume: async (player: Player) => {
    await player.pause(false)
    return { message: '▶️ Resumed playback.', shouldUpdate: true }
  },

  pause: async (player: Player) => {
    await player.pause(true)
    return { message: '⏸️ Paused playback.', shouldUpdate: true }
  },

  skip: async (player: Player) => {
    if (!getQueueLength(player.queue)) {
      return {
        message: '❌ No tracks in queue to skip to.',
        shouldUpdate: false
      }
    }
    await player.skip()
    return { message: '⏭️ Skipped to the next track.', shouldUpdate: false }
  }
}

const buildPlaylistPage = (
  playlist: PlaylistSummary,
  playlistName: string,
  userId: string,
  page: number | undefined
) => {
  const total = playlist.trackCount
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.min(Math.max(1, page || 1), totalPages)
  const startIdx = (currentPage - 1) * PAGE_SIZE

  const tracks = getPlaylistTracks(playlist._id, {
    limit: PAGE_SIZE,
    skip: startIdx,
    fields: ['title', 'author', 'duration', 'uri']
  })

  const header = [
    `## ${ICONS.playlist} ${playlistName}`,
    `-# ${total} tracks • ${formatDuration(playlist?.totalDuration || 0)} • ${playlist?.playCount || 0} plays`
  ]
  if (playlist?.description) {
    header.push(`-# ${playlist.description}`)
  }

  const content: APIContainerComponent['components'] = [
    { type: 10, content: header.join('\n') },
    { type: 14, divider: true, spacing: 1 }
  ]

  if (tracks.length) {
    const range = `### Tracks (${startIdx + 1}-${startIdx + tracks.length} of ${total})`
    const titleBlock: APITextDisplayComponent = { type: 10, content: range }
    const firstVideoId = extractYouTubeId(tracks[0]?.uri)
    content.push(
      firstVideoId
        ? {
            type: 9,
            components: [titleBlock],
            accessory: {
              type: 11,
              media: {
                url: `https://img.youtube.com/vi/${firstVideoId}/maxresdefault.jpg`
              }
            }
          }
        : titleBlock,
      {
        type: 10,
        content: tracks
          .map((track, index) => {
            const position = String(startIdx + index + 1).padStart(2, '0')
            const title = truncateText(track.title, 60)
            const heading = track.uri
              ? `**${position}.** [\`${title}\`](${track.uri})`
              : `**${position}.** \`${title}\``
            return `${heading}\n-# ${ICONS.artist} ${track.author || 'Unknown'} • ${ICONS.duration} ${formatDuration(track.duration || 0)} ${getSourceIcon(track.uri)}`
          })
          .join('\n\n')
      }
    )
  } else {
    content.push({
      type: 10,
      content: '-# No tracks in this playlist yet.'
    })
  }

  content.push(
    { type: 14, divider: true, spacing: 2 },
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
      },
      ...(totalPages > 1
        ? [
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
          ]
        : [])
    ]).toJSON()
  )

  return { container: new Container({ components: content }) }
}

const displayPlaylistPage = async (
  interaction: MusicComponentInteraction,
  query: { userId: string; _id?: string; name?: string },
  page = 1
): Promise<ActionResult> => {
  const playlist = playlistsCol().findOne(query, {
    fields: [
      '_id',
      'name',
      'description',
      'totalDuration',
      'playCount',
      'trackCount'
    ]
  })
  if (!playlist) {
    return { message: '❌ Playlist not found.', shouldUpdate: false }
  }

  const { container } = buildPlaylistPage(
    playlist,
    String(playlist.name || 'Playlist'),
    query.userId,
    page
  )
  await interaction.editOrReply({
    content: null,
    embeds: [],
    components: [container],
    flags: PLAYLIST_VIEW_FLAGS
  })
  return { message: '', shouldUpdate: false }
}

const playPlaylist = async (
  interaction: MusicComponentInteraction,
  client: UsingClient,
  userId: string,
  playlistName: string,
  shuffle = false
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
  if (!playlist) {
    return { message: '❌ Playlist not found', shouldUpdate: false }
  }

  const trackCount = tracksCol().count({ playlistId: playlist._id })
  if (trackCount === 0) {
    return { message: '❌ Playlist is empty', shouldUpdate: false }
  }

  const voiceState = await getMemberVoiceState(interaction)
  if (!voiceState?.channelId) {
    return {
      message: '\u274c Join a voice channel first',
      shouldUpdate: false
    }
  }
  if (!interaction.guildId) {
    return { message: '\u274c Guild not found', shouldUpdate: false }
  }

  const existingPlayer = client.aqua.players.get(interaction.guildId)
  const playerDecision = decidePlaylistPlayer(
    existingPlayer,
    voiceState.channelId
  )
  if (playerDecision.action === 'reject') {
    return {
      message: '❌ You must be in the same voice channel as the player.',
      shouldUpdate: false
    }
  }
  const player =
    playerDecision.action === 'reuse'
      ? existingPlayer
      : await getOrCreatePlayer(client, {
          guildId: interaction.guildId,
          voiceChannel: voiceState.channelId,
          ...(interaction.channel.id !== undefined
            ? { textChannel: interaction.channel.id }
            : {})
        })
  if (!player) {
    return { message: '\u274c Failed to create player', shouldUpdate: false }
  }

  const docs = getPlaylistTracks(playlist._id, {
    fields: ['uri', 'source', 'identifier', 'title', 'author', 'isrc']
  })
  const state = getQueueLoadState(player)
  const accepted = registerPendingPlaylistLoads(
    player,
    shuffle ? shuffleArray(docs) : docs,
    interaction.user
  )
  if (!accepted) {
    return { message: 'The queue limit is 1,000 tracks.', shouldUpdate: false }
  }
  const loaded = await topUpPlaylistBuffer(client.aqua, player, 10)
  if (state.cancelled) {
    return { message: 'Playback loading was cancelled.', shouldUpdate: false }
  }

  if (!loaded && !state.pending) {
    return { message: 'No tracks could be loaded.', shouldUpdate: false }
  }

  playlistsCol().updateAtomic(
    { _id: playlist._id },
    {
      $inc: { playCount: 1 },
      $set: { lastPlayedAt: new Date().toISOString() }
    }
  )

  return {
    message: `${shuffle ? '🔀' : '▶️'} Queued playlist "${playlistName}" (${accepted} tracks; remaining tracks load during playback)`,
    shouldUpdate: false
  }
}

const playlistActionHandlers: Record<
  PlaylistButtonAction,
  (
    interaction: MusicComponentInteraction,
    client: UsingClient,
    userId: string,
    playlistName: string,
    page?: number
  ) => Promise<ActionResult>
> = {
  play_playlist: (interaction, client, userId, playlistName) =>
    playPlaylist(interaction, client, userId, playlistName),
  shuffle_playlist: (interaction, client, userId, playlistName) =>
    playPlaylist(interaction, client, userId, playlistName, true),

  playlist_prev: (interaction, _client, userId, playlistName, page) =>
    displayPlaylistPage(
      interaction,
      { userId, name: playlistName },
      Math.max(1, (page || 1) - 1)
    ),

  playlist_next: (interaction, _client, userId, playlistName, page) =>
    displayPlaylistPage(
      interaction,
      { userId, name: playlistName },
      (page || 1) + 1
    )
}

export default createEvent({
  data: { name: 'interactionCreate' },
  run: async (interaction, client): Promise<void> => {
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) {
      return
    }

    const classified = classifyInteractionId(interaction.customId)
    if (classified.kind === 'ignore') {
      return
    }
    if (classified.kind === 'unknown') {
      if (!(await safeDefer(interaction, 64))) {
        return
      }
      await safeReply(
        interaction,
        '❌ This component action is not recognized.'
      )
      return
    }

    if (
      classified.kind === 'playlist' ||
      classified.kind === 'playlist-select'
    ) {
      if (classified.userId !== interaction.user.id) {
        if (!(await safeDefer(interaction, 64))) {
          return
        }
        await safeReply(
          interaction,
          '❌ Only the playlist owner can use this control.'
        )
        return
      }
      // Page turns edit the detail card in place so flipping through a
      // playlist never spams new messages; everything else keeps a reply.
      const isPageTurn =
        classified.kind === 'playlist' &&
        (classified.action === 'previous' || classified.action === 'next')
      if (isPageTurn) {
        try {
          await interaction.deferUpdate()
        } catch (error) {
          if (isInteractionExpired(error)) {
            return
          }
          throw error
        }
      } else if (!(await safeDefer(interaction, 64))) {
        return
      }
      try {
        let result: ActionResult
        if (classified.kind === 'playlist-select') {
          const playlistId = interaction.isStringSelectMenu()
            ? interaction.values[0]
            : undefined
          result = playlistId
            ? await displayPlaylistPage(interaction, {
                _id: playlistId,
                userId: classified.userId
              })
            : { message: '❌ No playlist was selected.', shouldUpdate: false }
        } else if (classified.action === 'view') {
          result = await displayPlaylistPage(interaction, {
            _id: classified.playlistId,
            userId: classified.userId
          })
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
        if (result?.message) {
          await safeFollowup(interaction, result.message)
        }
      } catch (err) {
        if (isInteractionExpired(err)) {
          return
        }
        console.error('Playlist button error:', err)
        await safeReply(interaction, '❌ An error occurred.')
      }
      return
    }

    if (!interaction.guildId) {
      if (!(await safeDefer(interaction, 64))) {
        return
      }
      await safeReply(interaction, '❌ This control requires a server.')
      return
    }
    if (!(await safeDefer(interaction, 64))) {
      return
    }

    const player = client.aqua.players.get(interaction.guildId)
    if (!player) {
      await safeReply(
        interaction,
        '\u274c There is no active music player in this server.'
      )
      return
    }
    if (!player.current) {
      await safeReply(
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
      await safeReply(
        interaction,
        controlCheck.reason || '\u274c You are not allowed to use this button.'
      )
      return
    }

    const handler = actionHandlers[interaction.customId]
    if (!handler) {
      await safeReply(
        interaction,
        '\u274c This button action is not recognized.'
      )
      return
    }

    try {
      const result = await handler(player)
      await safeFollowup(interaction, result.message)
      if (result.shouldUpdate && player.current) {
        await updateNowPlayingEmbed(player, client)
      }
    } catch (err) {
      if (isInteractionExpired(err)) {
        return
      }
      console.error('Action button error:', err)
      safeReply(interaction, '❌ An error occurred. Please try again.')
    }
  }
})
