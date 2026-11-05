import { Command, type CommandContext, Declare, Embed, LocalesT } from 'seyfert'
import { isExpiredInteraction } from '../shared/errorGuard.ts'
import { getContextLanguage } from '../utils/i18n.ts'

@Declare({
  name: 'ping',
  description: 'ping the bot'
})
@LocalesT('commands.ping.name', 'commands.ping.description')
export default class PingCommand extends Command {
  public override async run(ctx: CommandContext): Promise<void> {
    if (!ctx.guildId) {
      return
    }

    try {
      const lang = getContextLanguage(ctx)
      const translations = ctx.t.get(lang)
      const { client } = ctx

      const gatewayPing = Math.floor(client.gateway.latency)
      const shardPing = Math.floor(
        (await client.gateway.get(ctx.shardId)?.ping()) ?? 0
      )
      const player = client.aqua.players.get(ctx.guildId)
      const playerPing = player ? Math.floor(player.ping) : 0
      const avatarUrl = client.me?.avatarURL()
      const description =
        playerPing === 0
          ? translations.ping.descriptionNoPlayer
              .replace('{wsPing}', gatewayPing.toString())
              .replace('{shardPing}', shardPing.toString())
          : translations.ping.description
              .replace('{wsPing}', gatewayPing.toString())
              .replace('{shardPing}', shardPing.toString())
              .replace('{playerPing}', playerPing.toString())

      const embed = new Embed()
        .setColor(0x100e09)
        .setTitle(translations.ping.title)
        .setDescription(description)
        .setTimestamp()
        .setFooter({
          text: `Shard ${ctx.shardId}`,
          ...(avatarUrl ? { iconUrl: avatarUrl } : {})
        })

      await ctx.write({ embeds: [embed] })
    } catch (error) {
      if (isExpiredInteraction(error)) {
        return
      }
      const t = ctx.t.get('en')
      await ctx.write({
        content: t.errors?.general || 'An error occurred',
        flags: 64
      })
    }
  }
}
