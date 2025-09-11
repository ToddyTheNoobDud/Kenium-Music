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
			player.queue.unshift(player.previous);
			player.stop();

			if (!player.playing && !player.paused && player.queue.size > 0) {
				player.play();
			}

			await ctx.editOrReply({
				embeds: [
					new Embed()
						.setDescription(t.player?.previousAdded || "Added the previous song to the queue")
						.setColor(0),
				],
				flags: 64,
			});
		} catch (error) {
			if (error.code === 10065) return;
		}
	}
}
