import { lru } from 'tiny-lru'
import { getErrorCode, getMemberVoiceState } from '../utils/interactions.ts'
import type {
  AquaClientLike,
  InteractionLike,
  PlayerLike,
  UserLike
} from './helperTypes.ts'
import { getOrCreatePlayer } from './player.ts'
import { authorizeVoiceControl } from './voiceAuthorization.ts'

// Cache recent Lavalink resolve results to avoid double-resolving
// (autocomplete + actual play often resolve the same query)
const RESOLVE_CACHE = lru<{
  tracks: unknown[]
  loadType: string
  result: unknown
}>(50, 30_000) // 50 queries, 30s TTL

type VoiceContextLike = {
  guildId?: string | null | undefined
  channelId?: string | null | undefined
  member?: InteractionLike['member']
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
  player?.voiceChannel || player?._lastVoiceChannel || null

export const ensurePlayerForVoice = async (
  ctx: VoiceContextLike,
  textChannel = ctx.channelId || null
): Promise<PlayerLike | null> => {
  const guildId = ctx.guildId
  if (!guildId) return null
  const voiceState = await getMemberVoiceState(ctx)
  const voiceChannelId = voiceState?.channelId
  if (!voiceChannelId) return null
  return (
    getOrCreatePlayer(ctx.client, {
      guildId,
      voiceChannel: voiceChannelId,
      textChannel
    }) ?? null
  )
}

export const maybeStartPlayback = async (
  player: PlayerLike
): Promise<boolean> => {
  if (
    !player ||
    player.destroyed ||
    player.paused ||
    !player.queue ||
    (player.queue.size ?? 0) <= 0
  ) {
    return false
  }
  // Genuinely streaming: leave the queue alone. yeah.
  if (player.playing && player.connected) return false
  try {
    if (player.playing) {
      // Silent state: Aqualink deferred the start while voice wasn't
      // connected (playing=true, nothing audible). Nudge the voice
      // connection so the deferred track flushes on connect.
      const voiceChannel = getPlayerVoiceChannelId(player)
      if (voiceChannel && player.guildId) {
        await player.connect?.({ guildId: player.guildId, voiceChannel })
      }
      return false
    }
    await player.play?.()
    return true
  } catch (error) {
    const code = getErrorCode(error)
    if (code === 10065 || code === 10008) return false
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
  const cacheKey = (source ? `${source}:` : '') + query.toLowerCase().trim()
  const cached = RESOLVE_CACHE.get(cacheKey)
  if (cached) {
    const loadType = cached.loadType
    const added =
      loadType === 'playlist'
        ? cached.tracks
        : cached.tracks[0]
          ? [cached.tracks[0]]
          : []
    const queue = player.queue
    for (const track of added) {
      if (typeof queue?.add === 'function') queue.add(track)
    }
    return { result: cached.result, added, loadType }
  }

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
  const added = loadType === 'playlist' ? tracks : tracks[0] ? [tracks[0]] : []
  const queue = player.queue
  for (const track of added) {
    if (typeof queue?.add === 'function') {
      queue.add(track)
    }
  }
  RESOLVE_CACHE.set(cacheKey, { tracks: added, loadType, result })
  return { result, added, loadType }
}

export const playPreviousTrack = async (
  player: PlayerLike
): Promise<boolean> => {
  const previous = player?.previous
  if (!player || !previous) return false
  const current = player.current
  // Park the interrupted track at the front so skip() returns to it.
  // AquaLink archives it into history on replace by itself, so never
  // enqueue `previous` — that is what duplicated the queue on each press.
  if (current && current !== previous) {
    const queue = player.queue
    if (queue && typeof queue.add === 'function') {
      queue.add(current)
      const queueSize = queue.size ?? 0
      if (queueSize > 1 && typeof queue.move === 'function') {
        queue.move(queueSize - 1, 0)
      }
    }
  }
  await player.play?.(previous)
  return true
}

export const ensureMemberCanControlPlayer = async (
  interaction: InteractionLike,
  player: PlayerLike,
  options: { requesterOnly?: boolean } = {}
) => {
  const memberVoice = await getMemberVoiceState(interaction)
  const memberVoiceChannelId = memberVoice?.channelId || null
  const playerVoiceChannelId = getPlayerVoiceChannelId(player)
  const requesterId = (
    player?.current?.requester as { id?: string } | undefined
  )?.id
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
