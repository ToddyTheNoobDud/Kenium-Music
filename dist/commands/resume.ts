import {
	Command,
	type CommandContext,
	Declare,
	Embed,
	Middlewares,
} from "seyfert";
import { getContextLanguage } from "../utils/i18n";

@Declare({
	name: "resume",
	description: "resume the music",
})

@Middlewares(["checkPlayer", "checkVoice", "checkTrack"])
export default class resumecmds extends Command {
	public override async run(ctx: CommandContext): Promise<void> {
		try {
			const t = ctx.t.get(getContextLanguage(ctx));
			const { client } = ctx;

			const player = client.aqua.players.get(ctx.guildId!);

			if (!player.paused) {
				await ctx.editOrReply({
					embeds: [
						new Embed().setDescription(t.player?.alreadyResumed).setColor(0),
					],
					flags: 64,
				});
				return;
			}

			player.pause(false);

			await ctx.editOrReply({
				embeds: [new Embed().setDescription(t.player?.resumed).setColor(0)],
				flags: 64,
			});
		} catch (error) {
			if (error.code === 10065) return;
		}
	}
}
