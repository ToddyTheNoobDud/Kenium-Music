import { getMemberVoiceState } from '../utils/interactions'
import type {
  AquaClientLike,
  InteractionLike,
  PlayerLike,
  UserLike
} from './helperTypes'
import { getOrCreatePlayer } from './player'

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
    player.playing ||
    player.paused ||
    !player.queue ||
    (player.queue.size ?? 0) <= 0
  ) {
    return false
  }

  try {
    await player.play?.()
    return true
  } catch {
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

  return { result, added, loadType }
}

export const ensureMemberCanControlPlayer = async (
  interaction: InteractionLike,
  player: PlayerLike,
  options: { requesterOnly?: boolean } = {}
) => {
  const memberVoice = await getMemberVoiceState(interaction)
  const memberVoiceChannelId = memberVoice?.channelId || null
  if (!memberVoiceChannelId) {
    return {
      ok: false,
      reason: 'You must be in a voice channel to use this button.'
    }
  }

  const playerVoiceChannelId = getPlayerVoiceChannelId(player)
  if (playerVoiceChannelId && memberVoiceChannelId !== playerVoiceChannelId) {
    return {
      ok: false,
      reason: 'You must be in the same voice channel as the player.'
    }
  }

  if (
    options.requesterOnly &&
    interaction.user.id !== player?.current?.requester?.id
  ) {
    return {
      ok: false,
      reason: 'You are not allowed to use this button.'
    }
  }

  return { ok: true, memberVoiceChannelId, playerVoiceChannelId }
}
