import {
	Command,
	type CommandContext,
	createStringOption,
	Declare,
	Embed,
	Middlewares,
	Options,
} from "seyfert";
import { getContextLanguage } from "../utils/i18n";

@Options({
	loop: createStringOption({
		description: "select your loop mode",
		required: true,
		choices: [
			{ name: "none", value: "none" },
			{ name: "song", value: "track" },
			{ name: "queue", value: "queue" },
		],
	}),
})
@Middlewares(["checkVoice", "checkPlayer"])
@Declare({
	name: "loop",
	description: "Want some loop bro?",
})
export default class LoopCommand extends Command {
	public override async run(ctx: CommandContext): Promise<void> {
		try {
			const { client } = ctx;
			const lang = getContextLanguage(ctx);
			const t = ctx.t.get(lang);
			const { loop } = ctx.options as { loop: string };

			const player = client.aqua.players.get(ctx.guildId!);
			// @ts-expect-error
			player.setLoop(loop);

			const status = loop === "none"
				? (t.common?.disabled || "disabled")
				: (player.loop ? (t.common?.enabled || "enabled") : (t.common?.disabled || "disabled"));

			let description: string;
			if (loop === "none") {
				description = t?.player?.loopDisabled || `Looping has been ${status}.`;
			} else {
				description = t?.player?.loopDisabled?.replace('{mode}', loop) || `Current song loop has been ${status}.`;
			}

			await ctx.editOrReply({
				embeds: [
					new Embed()
						.setColor(0x100e09)
						.setDescription(description),
				],
				flags: 64,
			});
		} catch (error) {
			if (error.code === 10065) return;
		}
	}
}