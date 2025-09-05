import { Command, Declare, type CommandContext, Embed, Middlewares, createAttachmentOption, Options } from "seyfert";
import { CooldownType, Cooldown } from '@slipher/cooldown';

@Options({
    file: createAttachmentOption({
        description: 'what u want to play?',
        required: true
    })
})
@Declare({
    name: "play-file",
    description: "Play a file from your computer.",
})
@Cooldown({
    type: CooldownType.User,
    interval: 1000 * 60,
    uses: {
        default: 2
    },
})

@Middlewares(["cooldown", "checkVoice"])

export default class playfile extends Command {
    public override async run(ctx: CommandContext) {
        try {
            const { client } = ctx;
            let voiceChannel = ctx.member?.voice()

            let player = client.aqua.players.get(ctx.guildId!) ?? client.aqua.createConnection({
                guildId: ctx.guildId!,
                voiceChannel: (await voiceChannel).channelId,
                textChannel: ctx.channelId,
                deaf: true,
                defaultVolume: 65,
            });

            const { file } = ctx.options as { file: { url: string, filename: string } }

            try {
                const result = await client.aqua.resolve({
                    query: file.url,
                    requester: ctx.interaction.user
                })
                const track = result.tracks[0];
                if (!track) {
                    await ctx.editOrReply({ embeds: [new Embed().setDescription('No track found').setColor(0)], flags: 64 });
                    return;
                }

                player.queue.add(track);

                if (!player.playing && !player.paused && player.queue.size > 0) {
                    player.play();
                }
            await ctx.write({ embeds: [new Embed().setDescription('Added to queue').setColor(0)], flags: 64 });
            } catch (error) {
                console.log(error);
            }
        } catch (error) {
            if (error.code === 10065) return;
        }
    }
}
