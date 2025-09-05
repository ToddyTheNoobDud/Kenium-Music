import { Declare, Command, type CommandContext, Embed, Middlewares} from 'seyfert'

@Declare({
    name: 'skip',
    description: 'skip the music',
})
@Middlewares(['checkPlayer', 'checkVoice', 'checkTrack'])
export default class skipCmds extends Command {
    public override async run(ctx: CommandContext): Promise<void> {
        try {
        const { client } = ctx;

        const player = client.aqua.players.get(ctx.guildId!);
        if (player.queue.length === 0) {
            await ctx.editOrReply({ embeds: [new Embed().setDescription('The queue is empty').setColor(0)], flags: 64 });
            return;
        }
        player.skip();

        await ctx.editOrReply({ embeds: [new Embed().setDescription('Skipped the song').setColor(0)], flags: 64 });
        } catch (error) {
           if(error.code === 10065) return;
        }
    }
}