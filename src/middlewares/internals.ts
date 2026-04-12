import { createMiddleware, Embed } from 'seyfert'
import {
  getMemberVoiceState,
  isInteractionExpired
} from '../utils/interactions'

export const checkPlayer = createMiddleware<void>(
  async ({ context, pass, next }) => {
    if (!context.inGuild()) return next()

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
        if (!isInteractionExpired(err)) throw err
      }
      return pass()
    }

    next()
  }
)

export const checkVoice = createMiddleware<void>(
  async ({ context, pass, next }) => {
    if (!context.inGuild()) return next()

    const memberVoice = await getMemberVoiceState(context)

    const botId = context.client.botId
    const botvoice = context.client.cache.voiceStates?.get(
      botId,
      context.guildId
    )
    if (
      !memberVoice ||
      (botvoice && botvoice.channelId !== memberVoice.channelId)
    ) {
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
        if (!isInteractionExpired(err)) throw err
      }
      return pass()
    }

    next()
  }
)

export const checkTrack = createMiddleware<void>(
  async ({ context, pass, next }) => {
    if (!context.inGuild()) return next()

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
        if (!isInteractionExpired(err)) throw err
      }
      return pass()
    }

    next()
  }
)
