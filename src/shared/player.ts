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
  client: any,
  { guildId, voiceChannel, textChannel }: PlayerConnectionOptions
) =>
  client.aqua.createConnection({
    guildId,
    voiceChannel,
    ...DEFAULT_PLAYER_CONNECTION_OPTIONS,
    ...(textChannel ? { textChannel } : {})
  })

export const getOrCreatePlayer = (
  client: any,
  options: PlayerConnectionOptions
) => {
  const player = client.aqua.players.get(options.guildId)
  if (player) {
    if (options.textChannel && player.textChannel !== options.textChannel)
      player.textChannel = options.textChannel
    return player
  }

  return createPlayerConnection(client, options)
}
