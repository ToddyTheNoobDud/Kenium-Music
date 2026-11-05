export const isSupportedVoiceChannelType = (type?: number): boolean =>
  type === 2 || type === 13

type ConnectedPlayerLike = {
  connected?: boolean
  destroyed?: boolean
  voiceChannel?: string | null
  _reconnecting?: boolean
  _voiceRecovering?: boolean
}

export const isPlayerConnectedToChannel = (
  player: ConnectedPlayerLike | null | undefined,
  channelId: string
): boolean =>
  !!player &&
  !player.destroyed &&
  player.connected === true &&
  player.voiceChannel === channelId

export const isPlayerRecovering = (
  player: ConnectedPlayerLike | null | undefined
): boolean =>
  !!player &&
  (player._reconnecting === true || player._voiceRecovering === true)
