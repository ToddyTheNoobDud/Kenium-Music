export const isSupportedVoiceChannelType = (type?: number): boolean =>
  type === 2 || type === 13

type ConnectedPlayerLike = {
  connected?: boolean
  destroyed?: boolean
  voiceChannel?: string | null
}

export const playersRestoring = new WeakSet<ConnectedPlayerLike>()

export const isPlayerConnectedToChannel = (
  player: ConnectedPlayerLike | null | undefined,
  channelId: string
): boolean =>
  !!player &&
  !player.destroyed &&
  !playersRestoring.has(player) &&
  player.connected === true &&
  player.voiceChannel === channelId

export const isPlayerRecovering = (
  player: ConnectedPlayerLike | null | undefined
): boolean => !!player && playersRestoring.has(player)
