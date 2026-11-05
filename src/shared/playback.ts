import type { Queue } from 'aqualink'
import type { ComponentInteraction } from 'seyfert'
import { getErrorCode, getMemberVoiceState } from '../utils/interactions.ts'
import type {
  AquaClientLike,
  MemberLike,
  PlayerLike,
  TrackLike,
  UserLike
} from './helperTypes.ts'
import { getOrCreatePlayer } from './player.ts'
import { getTrackRequester } from './trackRequester.ts'
import { authorizeVoiceControl } from './voiceAuthorization.ts'

export const MAX_QUEUE_TRACKS = 1000

type QueueLoadState = { cancelled: boolean; pending: number }
const queueLoadStates = new WeakMap<PlayerLike, QueueLoadState>()

export const getQueueLoadState = (player: PlayerLike): QueueLoadState => {
  let state = queueLoadStates.get(player)
  if (!state) {
    state = { cancelled: false, pending: 0 }
    queueLoadStates.set(player, state)
  }
  return state
}

export const cancelQueueLoads = (player: PlayerLike): void => {
  const state = queueLoadStates.get(player)
  if (state) {
    state.cancelled = true
    state.pending = 0
  }
  queueLoadStates.delete(player)
}

export const getQueueCapacity = (player: PlayerLike): number =>
  Math.max(
    0,
    MAX_QUEUE_TRACKS - player.queue.size - getQueueLoadState(player).pending
  )

export const enqueueTrack = (
  player: PlayerLike,
  track: TrackLike,
  state = getQueueLoadState(player)
): boolean => {
  if (state.cancelled || player.destroyed || !getQueueCapacity(player)) {
    return false
  }
  player.queue.add(track)
  return true
}

type VoiceContextLike = {
  guildId?: string | null | undefined
  channelId?: string | null | undefined
  member?: MemberLike | null | undefined
  client: AquaClientLike
}

type ResolveAndQueueOptions = {
  client: AquaClientLike
  player: PlayerLike
  query: string
  requester: UserLike
  source?: string
}

export const getPlayerVoiceChannelId = (player: PlayerLike): string | null =>
  player.voiceChannel || player._lastVoiceChannel || null

export const ensurePlayerForVoice = async (
  ctx: VoiceContextLike,
  textChannel = ctx.channelId || null
): Promise<PlayerLike | null> => {
  const guildId = ctx.guildId
  if (!guildId) {
    return null
  }
  const voiceState = await getMemberVoiceState(ctx)
  const voiceChannelId = voiceState?.channelId
  if (!voiceChannelId) {
    return null
  }
  return (
    (await getOrCreatePlayer(ctx.client, {
      guildId,
      voiceChannel: voiceChannelId,
      textChannel
    })) ?? null
  )
}

export const maybeStartPlayback = async (
  player: PlayerLike
): Promise<boolean> => {
  if (player.destroyed || player.paused || player.queue.size === 0) {
    return false
  }
  // Genuinely streaming: leave the queue alone. yeah.
  if (player.playing && player.connected) {
    return false
  }
  try {
    if (player.playing) {
      // Silent state: Aqualink deferred the start while voice wasn't
      // connected (playing=true, nothing audible). Nudge the voice
      // connection so the deferred track flushes on connect.
      const voiceChannel = getPlayerVoiceChannelId(player)
      if (voiceChannel && player.guildId) {
        await player.connect({ guildId: player.guildId, voiceChannel })
      }
      return false
    }
    await player.play()
    return true
  } catch (error) {
    const code = getErrorCode(error)
    if (code === 10065 || code === 10008) {
      return false
    }
    console.error('[playback] Failed to start playback:', error)
    return false
  }
}

export const resolveAndQueue = async ({
  client,
  player,
  query,
  requester,
  source
}: ResolveAndQueueOptions) => {
  if (!getQueueCapacity(player)) {
    return { result: null, added: [], loadType: '' }
  }
  const state = getQueueLoadState(player)
  const result = await client.aqua.resolve({
    query,
    requester,
    ...(source ? { source } : {})
  })
  const tracks = Array.isArray(result?.tracks) ? result.tracks : []
  if (!tracks.length) {
    return { result, added: [], loadType: String(result?.loadType || '') }
  }
  const loadType = String(result?.loadType || '').toLowerCase()
  const candidates = loadType === 'playlist' ? tracks : tracks.slice(0, 1)
  const added = candidates.filter((track) => enqueueTrack(player, track, state))
  return { result, added, loadType }
}

export const playPreviousTrack = async (
  player: PlayerLike
): Promise<boolean> => {
  const previous = player.previous
  if (!previous) {
    return false
  }
  const current = player.current
  // Park the interrupted track at the front so skip() returns to it.
  if (current && current !== previous) {
    const queue = player.queue
    if (!enqueueTrack(player, current)) {
      return false
    }
    const queueSize = queue.size
    if (queueSize > 1) {
      ;(queue as Pick<Queue, 'move'>).move(queueSize - 1, 0)
    }
  }
  await player.play(previous, { noReplace: false })
  return true
}

export const ensureMemberCanControlPlayer = async (
  interaction: Pick<ComponentInteraction, 'guildId' | 'user' | 'member'>,
  player: PlayerLike,
  options: { requesterOnly?: boolean } = {}
) => {
  const memberVoice = await getMemberVoiceState(interaction)
  const memberVoiceChannelId = memberVoice?.channelId || null
  const playerVoiceChannelId = getPlayerVoiceChannelId(player)
  const requesterId = getTrackRequester(player.current?.requester).id
  const authorization = authorizeVoiceControl({
    guildId: interaction.guildId,
    memberChannelId: memberVoiceChannelId,
    playerChannelId: playerVoiceChannelId,
    hasPlayer: true,
    requesterOnly: Boolean(options.requesterOnly),
    memberId: interaction.user.id,
    requesterId: requesterId ?? null
  })
  if (!authorization.ok) {
    const reason =
      authorization.reason === 'requester'
        ? 'You are not allowed to use this button.'
        : authorization.reason === 'player-channel'
          ? 'You must be in the same voice channel as the player.'
          : 'You must be in a voice channel to use this button.'
    return {
      ok: false,
      reason
    }
  }
  return { ok: true, memberVoiceChannelId, playerVoiceChannelId }
}
