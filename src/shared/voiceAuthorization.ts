export type VoiceAuthorizationInput = {
  guildId?: string | null
  memberChannelId?: string | null
  playerChannelId?: string | null
  hasPlayer: boolean
  requirePlayer?: boolean
  playerDestroyed?: boolean
  requesterOnly?: boolean
  memberId?: string | null
  requesterId?: string | null
}

export type VoiceAuthorizationResult =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'guild'
        | 'member-channel'
        | 'player'
        | 'player-channel'
        | 'requester'
    }

export const authorizeVoiceControl = ({
  guildId,
  memberChannelId,
  playerChannelId,
  hasPlayer,
  requirePlayer = false,
  playerDestroyed = false,
  requesterOnly = false,
  memberId,
  requesterId
}: VoiceAuthorizationInput): VoiceAuthorizationResult => {
  if (!guildId) {
    return { ok: false, reason: 'guild' }
  }
  if (!memberChannelId) {
    return { ok: false, reason: 'member-channel' }
  }
  if (requirePlayer && (!hasPlayer || playerDestroyed)) {
    return { ok: false, reason: 'player' }
  }

  if (hasPlayer) {
    if (!playerChannelId || memberChannelId !== playerChannelId) {
      return { ok: false, reason: 'player-channel' }
    }
  }

  if (
    requesterOnly &&
    (!memberId || !requesterId || memberId !== requesterId)
  ) {
    return { ok: false, reason: 'requester' }
  }

  return { ok: true }
}
