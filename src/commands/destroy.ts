import {
	Command,
	type CommandContext,
	Declare,
	Embed,
	Middlewares,
} from "seyfert";
import { getContextLanguage } from "../utils/i18n";

@Declare({
	name: "destroy",
	description: "destroy the music",
})
@Middlewares(["checkPlayer", "checkVoice"])
export default class destroycmd extends Command {
	public override async run(ctx: CommandContext): Promise<void> {
		try {
			const { client } = ctx;
			const lang = getContextLanguage(ctx);
			const t = ctx.t.get(lang);

			const player = client.aqua.players.get(ctx.guildId!);

			player.destroy();

			await ctx.editOrReply({
				embeds: [new Embed()
					.setDescription(t.player?.destroyed || "Destroyed the music")
					.setColor(0)
				],
				flags: 64,
			});
		} catch (error) {
			if (error.code === 10065) return;
		}
	}
}