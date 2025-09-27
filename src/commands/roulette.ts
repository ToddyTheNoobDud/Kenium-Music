import { Command, type CommandContext, Declare, Middlewares, Embed } from "seyfert";
import { getContextLanguage } from "../utils/i18n";

@Declare({
    name: 'roulette',
    description: 'Play a random track from the queue',
})

@Middlewares(["checkPlayer", "checkVoice", "checkTrack"])
export default class roulettecmds extends Command {
    public override async run(ctx: CommandContext) {
        try {
            const player = ctx.client.aqua.players.get(ctx.guildId!);
            const lang = getContextLanguage(ctx);
            const t = ctx.t.get(lang);

            const queue = player?.queue;
            if (!queue || queue.length === 0) {
                return ctx.write({
                    embeds: [
                        new Embed()
                            .setDescription(t?.roulette?.emptyQueue || '❌ The queue is empty!')
                            .setColor(0xff0000)
                    ],
                    flags: 64,
                });
            }

            const randomIndex = Math.floor(Math.random() * queue.length);
            const randomTrack = queue[randomIndex];


            if (queue.splice) {
                queue.splice(randomIndex, 1);
                queue.unshift(randomTrack);
            }

            if (player.playing || player.paused) {
                player.stop();
            }

            setTimeout(() => {
                if (!player.playing && !player.paused && player.queue.size > 0) {
                    player.play();
                }
            }, 100);

            const trackTitle = randomTrack?.info?.title || 'Unknown Track';
            const trackAuthor = randomTrack?.info?.author || 'Unknown Artist';

            return ctx.write({
                embeds: [
                    new Embed()
                        .setDescription(
                            (t?.roulette?.playingRandom || '🎲 Playing random track: **{title}** by **{author}**')
                                .replace('{title}', trackTitle)
                                .replace('{author}', trackAuthor)
                        )
                        .setColor(0x00ff00)
                        .setFooter({
                            text: `${t?.roulette?.queuePosition || 'Position'}: ${randomIndex + 1}/${queue.length + 1}`,
                        })
                ],
                flags: 64,
            });
        } catch (error) {
            console.error('Roulette command error:', error);
            const lang = getContextLanguage(ctx);
            const t = ctx.t.get(lang);

            return ctx.write({
                embeds: [
                    new Embed()
                        .setDescription(t?.roulette?.error || '❌ An error occurred while playing random track!')
                        .setColor(0xff0000)
                ],
                flags: 64,
            });
        }
    }
}
