import {
	Command,
	type CommandContext,
	Declare,
	Embed,
	Middlewares,
} from "seyfert";
import { getContextLanguage } from "../utils/i18n";

@Declare({
	name: "autoplay",
	description: "Toggle autoplay",
})
@Middlewares(["checkPlayer", "checkVoice", "checkTrack"])
export default class autoPlaycmd extends Command {
	public override async run(ctx: CommandContext): Promise<void> {
		try {
			const { client } = ctx;
			const lang = getContextLanguage(ctx);
			const t = ctx.t.get(lang);

			const player = client.aqua.players.get(ctx.guildId!);
			const newState = !player.isAutoplayEnabled;
			player.setAutoplay(newState);

			const statusText = newState
				? t?.player?.autoplayEnabled || "Autoplay has been **enabled**"
				: t?.player?.disabled || "Autoplay has been **disabled**";

			const embed = new Embed()
				.setColor(newState ? "#000000" : "#000000")
				.setTitle(t.commands?.autoplay?.name || "Autoplay Status")
				.setDescription(statusText)
				.setFooter({
					text: t.commands?.autoplay?.name || "Autoplay",
					iconUrl: client.me.avatarURL()
				})
				.setTimestamp();

			await ctx.editOrReply({ embeds: [embed], flags: 64 });
		} catch (error) {
			if (error.code === 10065) return;
		}
	}
}