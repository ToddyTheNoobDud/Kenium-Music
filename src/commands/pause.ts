import {
	Command,
	type CommandContext,
	Declare,
	Embed,
	Middlewares,
} from "seyfert";
import { getContextLanguage } from "../utils/i18n";

@Declare({
	name: "pause",
	description: "pause the music",
})
@Middlewares(["checkPlayer", "checkVoice", "checkTrack"])
export default class pauseCmds extends Command {
	public override async run(ctx: CommandContext): Promise<void> {
		try {
			const { client } = ctx;
			const lang = getContextLanguage(ctx);
			const t = ctx.t.get(lang);

			const player = client.aqua.players.get(ctx.guildId!);

			if (player.paused) {
				await ctx.editOrReply({
					embeds: [
						new Embed()
							.setDescription(t.player.alreadyPaused)
							.setColor(0),
					],
					flags: 64,
				});
				return;
			}

			player.pause(true);

			await ctx.editOrReply({
				embeds: [new Embed().setDescription(t.player.paused).setColor(0)],
				flags: 64,
			});
		} catch (error) {
			if (error.code === 10065) return;
		}
	}
}