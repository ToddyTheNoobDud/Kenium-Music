import { createMiddleware, Embed } from 'seyfert'
import { getPlayerVoiceChannelId } from '../shared/playback.ts'
import { authorizeVoiceControl } from '../shared/voiceAuthorization.ts'
import {
  getMemberVoiceState,
  isInteractionExpired
} from '../utils/interactions.ts'

export const checkPlayer = createMiddleware<void>(
  async ({ context, stop, next }) => {
    if (!context.inGuild()) {
      return next()
    }

    const { client } = context

    const player = client.aqua.players.get(context.guildId)

    if (!player) {
      try {
        await context.editOrReply({
          flags: 64,
          embeds: [
            new Embed()
              .setColor(0x100e09)
              .setDescription(
                `**[❌ | No active \`player\` found.](https://discord.com/oauth2/authorize?client_id=1202232935311495209)**`
              )
          ]
        })
      } catch (err) {
        if (!isInteractionExpired(err)) {
          throw err
        }
      }
      return stop()
    }

    next()
  }
)

export const checkVoice = createMiddleware<void>(
  async ({ context, stop, next }) => {
    const memberVoice = await getMemberVoiceState(context)
    const player = context.inGuild()
      ? context.client.aqua.players.get(context.guildId)
      : null
    const authorization = authorizeVoiceControl({
      guildId: context.inGuild() ? context.guildId : null,
      memberChannelId: memberVoice?.channelId ?? null,
      playerChannelId: player ? getPlayerVoiceChannelId(player) : null,
      hasPlayer: Boolean(player)
    })
    if (!authorization.ok) {
      try {
        await context.editOrReply({
          flags: 64,
          embeds: [
            new Embed()
              .setColor(0x100e09)
              .setDescription(
                `**[❌ | You must be in a voice channel.](https://discord.com/oauth2/authorize?client_id=1202232935311495209)**`
              )
          ]
        })
      } catch (err) {
        if (!isInteractionExpired(err)) {
          throw err
        }
      }
      return stop()
    }

    next()
  }
)

export const checkTrack = createMiddleware<void>(
  async ({ context, stop, next }) => {
    if (!context.inGuild()) {
      return next()
    }

    const { client } = context

    const player = client.aqua.players.get(context.guildId)

    if (!player?.current) {
      try {
        await context.editOrReply({
          flags: 64,
          embeds: [
            new Embed()
              .setColor(0x100e09)
              .setDescription(
                `**[❌ | No active \`track\` found.](https://discord.com/oauth2/authorize?client_id=1202232935311495209)**`
              )
          ]
        })
      } catch (err) {
        if (!isInteractionExpired(err)) {
          throw err
        }
      }
      return stop()
    }

    next()
  }
)
