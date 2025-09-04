import { Command, Declare, type CommandContext, Embed, Middlewares} from 'seyfert'

@Declare({
    name: "stop",
    description: "Stop the music player in the guild."
})
@Middlewares(['checkPlayer', 'checkVoice', 'checkTrack'])
export default class skipCmds extends Command {
    public override async run(ctx: CommandContext): Promise<void> {
        try {
        const { client } = ctx;

        const player = client.aqua.players.get(ctx.guildId!);

        player.stop();

        await ctx.editOrReply({ embeds: [new Embed().setDescription('Stopped the music').setColor(0)], flags: 64 });
        } catch (error) {
           if(error.code === 10065) return;
        }
    }
}