import {Command, Declare, type CommandContext, Embed, Middlewares} from 'seyfert'

@Declare({
    name: 'resume',
    description: 'resume the music',
})

@Middlewares(['checkPlayer', 'checkVoice', 'checkTrack'])
export default class resumecmds extends Command {
    public override async run(ctx: CommandContext): Promise<void> {
        try {
        const { client } = ctx;

        const player = client.aqua.players.get(ctx.guildId!);

        if (!player.paused) {
            await ctx.editOrReply({ embeds: [new Embed().setDescription('The song is not paused').setColor(0)], flags: 64 });
            return;
        }

        player.pause(false);

        await ctx.editOrReply({ embeds: [new Embed().setDescription('Paused the song').setColor(0)], flags: 64 });
                } catch (error) {
           if(error.code === 10065) return;
        }
    }
}