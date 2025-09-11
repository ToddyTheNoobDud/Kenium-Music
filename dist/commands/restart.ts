import {
	Command,
	type CommandContext,
	Declare,
	Embed,
	Middlewares,
} from "seyfert";
import { getContextLanguage } from "../utils/i18n";

@Declare({
	name: "restart",
	description: "Restart the music",
})
@Middlewares(["checkPlayer", "checkVoice", "checkTrack"])
export default class restartStuff extends Command {
	public override async run(ctx: CommandContext): Promise<void> {
		try {
			const t = ctx.t.get(getContextLanguage(ctx));
			const { client } = ctx;

			const player = client.aqua.players.get(ctx.guildId!);

			player.replay();

			await ctx.editOrReply({
				embeds: [new Embed().setDescription(t.player?.restarted).setColor(0)],
				flags: 64,
			});
		} catch (error) {
			if (error.code === 10065) return;
		}
	}
}
