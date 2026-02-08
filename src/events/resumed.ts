import { createEvent } from 'seyfert'

export default createEvent({
  data: { name: 'resumed', once: false },
  run: async (_args, client) => {
    const players = client.aqua?.players
    if (!players?.size) return

    for (const player of players.values()) {
      const vcId = player.voiceChannel ?? player._lastVoiceChannel
      if (!vcId) continue

      if (player.connection) {
        player.connection._lastSentVoiceKey = ''
        player.connection._lastVoiceDataUpdate = 0
      }

      if (player.nowPlayingMessage) {
        client.messages.fetch(
          player.nowPlayingMessage.channelId,
          player.textChannel
        )
      }

      player.send({
        guild_id: player.guildId,
        channel_id: vcId,
        self_deaf: player.deaf,
        self_mute: player.mute
      })

      const t: NodeJS.Timeout = setTimeout(() => {
        if (player.destroyed) return
        const conn = player.connection
        if (!conn) return

        if (
          !conn._lastVoiceDataUpdate ||
          Date.now() - conn._lastVoiceDataUpdate > 2500
        ) {
          player.send({
            guild_id: player.guildId,
            channel_id: null,
            self_deaf: player.deaf,
            self_mute: player.mute
          })
          setTimeout(() => {
            if (player.destroyed) return
            player.connect({
              guildId: player.guildId,
              voiceChannel: vcId,
              deaf: player.deaf,
              mute: player.mute
            })
          }, 250)
        }
      }, 2500)
      t?.unref?.()
    }
  }
})
