import {Command, Declare, type CommandContext, Embed, Middlewares} from 'seyfert'

@Declare({
    name: 'pause',
    description: 'pause the music',
})
@Middlewares(['checkPlayer', 'checkVoice', 'checkTrack'])
export default class pauseCmds extends Command {
    public override async run(ctx: CommandContext): Promise<void> {
      try {
        const { client } = ctx;

        const player = client.aqua.players.get(ctx.guildId!);

        if (player.paused) return;

        player.pause(true);

        await ctx.editOrReply({ embeds: [new Embed().setDescription('Paused the song').setColor(0)], flags: 64 });
        } catch (error) {
           if(error.code === 10065) return;
        }
    }
}