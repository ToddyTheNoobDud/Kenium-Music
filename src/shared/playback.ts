import { getOrCreatePlayer } from './player'

type MaybePromise<T> = T | Promise<T>

type VoiceContextLike = {
  guildId?: string | null | undefined
  channelId?: string | null | undefined
  member?:
    | {
        voice?: () => MaybePromise<
          { channelId?: string | null } | null | undefined
        >
      }
    | null
    | undefined
  client: any
}

type ResolveAndQueueOptions = {
  client: any
  player: any
  query: string
  requester: any
  source?: string
}

export const getPlayerVoiceChannelId = (player: any): string | null =>
  player?.voiceChannel || player?._lastVoiceChannel || null

export const ensurePlayerForVoice = async (
  ctx: VoiceContextLike,
  textChannel = ctx.channelId || null
) => {
  const guildId = ctx.guildId
  if (!guildId) return null

  let voiceState: { channelId?: string | null } | null | undefined = null
  try {
    voiceState = await ctx.member?.voice?.()
  } catch {
    voiceState = null
  }
  const voiceChannelId = voiceState?.channelId
  if (!voiceChannelId) return null

  return getOrCreatePlayer(ctx.client, {
    guildId,
    voiceChannel: voiceChannelId,
    textChannel
  })
}

export const maybeStartPlayback = async (player: any): Promise<boolean> => {
  if (
    !player ||
    player.destroyed ||
    player.playing ||
    player.paused ||
    !player.queue ||
    player.queue.size <= 0
  ) {
    return false
  }

  try {
    await player.play()
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

  for (const track of added) player.queue.add(track)

  return { result, added, loadType }
}

export const ensureMemberCanControlPlayer = async (
  interaction: any,
  player: any,
  options: { requesterOnly?: boolean } = {}
) => {
  let memberVoice: { channelId?: string | null } | null | undefined = null
  try {
    memberVoice = await interaction.member?.voice?.()
  } catch {
    memberVoice = null
  }
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
