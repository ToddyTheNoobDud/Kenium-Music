import { Command, type CommandContext, Declare, Embed, LocalesT } from 'seyfert';
import { getContextLanguage } from '../utils/i18n';

const _functions = {
  createPingEmbed: (t: any, wsPing: number, shardPing: number, playerPing: number, shardId: number, avatarURL?: string): Embed =>
    new Embed()
      .setColor(0x100e09)
      .setTitle(t.ping.title)
      .setDescription(t.ping.description
        .replace('{wsPing}', wsPing.toString())
        .replace('{shardPing}', shardPing.toString())
        .replace('{playerPing}', playerPing.toString()))
      .setTimestamp()
      .setFooter({ text: `Shard ${shardId}`, iconUrl: avatarURL }),

  getPlayerPing: (client: any, guildId: string): number => {
    const player = client.aqua.players.get(guildId);
    return player ? Math.floor(player.ping) : 0;
  }
};

@Declare({
  name: 'ping',
  description: 'ping the bot'
})
@LocalesT('commands.ping.name', 'commands.ping.description')
export default class PingCommand extends Command {
  public override async run(ctx: CommandContext): Promise<void> {
    if (!ctx.guildId) return;

    try {
      const lang = getContextLanguage(ctx);
      const t = ctx.t.get(lang);
      const { client } = ctx;

      const wsPing = Math.floor(client.gateway.latency);
      const shardPing = Math.floor((await client.gateway.get(ctx.shardId)?.ping()) ?? 0);
      const playerPing = _functions.getPlayerPing(client, ctx.guildId);

      const embed = _functions.createPingEmbed(
        t,
        wsPing,
        shardPing,
        playerPing,
        ctx.shardId,
        client.me?.avatarURL()
      );

      await ctx.write({ embeds: [embed] });
    } catch (error: any) {
      if (error.code !== 10065) {
        const t = ctx.t.get('en');
        await ctx.write({ content: t.errors?.general || 'An error occurred', flags: 64 });
      }
    }
  }
}