import type { AquaClientLike } from './helperTypes.ts'

type PlayerConnectionOptions = {
  guildId: string
  voiceChannel: string
  textChannel?: string | null
}

export const createPlayerConnection = async (
  client: AquaClientLike,
  { guildId, voiceChannel, textChannel }: PlayerConnectionOptions
) => {
  return client.aqua.createConnection({
    guildId,
    voiceChannel,
    deaf: true,
    defaultVolume: 65,
    ...(textChannel ? { textChannel } : {})
  })
}

export const getOrCreatePlayer = async (
  client: AquaClientLike,
  options: PlayerConnectionOptions
) => {
  const player = client.aqua.players.get(options.guildId)
  if (player && !player.destroyed) {
    if (
      options.voiceChannel &&
      (player.connected === false ||
        player.voiceChannel !== options.voiceChannel)
    ) {
      await player.connect({
        guildId: options.guildId,
        voiceChannel: options.voiceChannel,
        ...(options.textChannel ? { textChannel: options.textChannel } : {})
      })
    }
    if (options.textChannel && player.textChannel !== options.textChannel) {
      player.textChannel = options.textChannel
    }
    return player
  }

  return createPlayerConnection(client, options)
}
