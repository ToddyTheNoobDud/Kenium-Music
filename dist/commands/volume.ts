import { Command, Declare, type CommandContext, Embed, createIntegerOption, Options, Middlewares} from 'seyfert'

@Options({
      volume: createIntegerOption({
        description: 'Volume, min is 0 and max is 200',
        max_value: 200,
        min_value: 0,
        required: true
    })
})

@Declare({
    name: "volume",
    description: "Change the volume of the music player in the guild",
})
@Middlewares(['checkPlayer', 'checkVoice', 'checkTrack'])
export default class Volume extends Command {
    async run(ctx: CommandContext) {

        try {

        const { options } = ctx;
        const { volume } = options as { volume: number };



        let player = ctx.client.aqua.players.get(ctx.guildId!);



        if (volume < 0 || volume > 200) {
            return ctx.write({
                embeds: [
                    new Embed()
                        .setColor(0)
                        .setDescription(`Use an number between \`0 - 200\`.`),
                ],
            });
        }


        player.setVolume(volume);

        await ctx.editOrReply({ embeds: [new Embed().setDescription('Changed the volume').setColor(0)], flags: 64 });
        }
        catch (error) {
           if(error.code === 10065) return;
        }
    }

}