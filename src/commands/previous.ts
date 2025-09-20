import {
	Command,
	type CommandContext,
	Declare,
	Embed,
	Middlewares,
} from "seyfert";
import { getContextLanguage } from "../utils/i18n";
@Declare({
	name: "previous",
	description: "Play the previous song",
})
@Middlewares(["checkPlayer", "checkVoice"])
export default class previoiusCmds extends Command {
	public override async run(ctx: CommandContext): Promise<void> {
		const t = ctx.t.get(getContextLanguage(ctx));
		try {
			const { client } = ctx;

			const player = client.aqua.players.get(ctx.guildId!);

			if (player.current) player.queue.unshift(player.current);

			player.queue.unshift(player.previous);
			player.stop();

			if (!player.playing && !player.paused && !player.queue.length) {
				player.play();
			}

			await ctx.editOrReply({
				embeds: [
					new Embed()
						.setDescription(player.playing ? t.player.previousPlayed : t.player.previousAdded || "Playing/added the previous track")
						.setColor(0),
				],
				flags: 64,
			});
		} catch (error) {
			if (error.code === 10065) return;
		}
	}
}
