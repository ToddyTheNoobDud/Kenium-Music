import type { AquaClientLike, PlayerLike } from './helperTypes'

const DEFAULT_PLAYER_CONNECTION_OPTIONS = Object.freeze({
  deaf: true,
  defaultVolume: 65
})

type PlayerConnectionOptions = {
  guildId: string
  voiceChannel: string
  textChannel?: string | null
}

export const createPlayerConnection = (
  client: AquaClientLike,
  { guildId, voiceChannel, textChannel }: PlayerConnectionOptions
) => {
  const aqua = client.aqua as {
    createConnection?: (options: {
      guildId: string
      voiceChannel: string
      deaf: boolean
      defaultVolume: number
      textChannel?: string
    }) => PlayerLike
  }

  if (typeof aqua.createConnection !== 'function') return undefined

  return aqua.createConnection({
    guildId,
    voiceChannel,
    ...DEFAULT_PLAYER_CONNECTION_OPTIONS,
    ...(textChannel ? { textChannel } : {})
  })
}

export const getOrCreatePlayer = (
  client: AquaClientLike,
  options: PlayerConnectionOptions
) => {
  const players = client.aqua.players as
    | { get?: (guildId: string) => PlayerLike | undefined }
    | undefined
  const player =
    typeof players?.get === 'function'
      ? players.get(options.guildId)
      : undefined
  if (player && !player.destroyed && player.queue) {
    if (
      options.voiceChannel &&
      player.voiceChannel !== options.voiceChannel &&
      typeof player.connect === 'function'
    ) {
      player.connect(options)
    }
    if (options.textChannel && player.textChannel !== options.textChannel)
      player.textChannel = options.textChannel
    return player
  }

  return createPlayerConnection(client, options)
}
