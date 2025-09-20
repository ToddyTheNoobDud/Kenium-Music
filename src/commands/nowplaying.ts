import { Cooldown, CooldownType } from "@slipher/cooldown";
import { Command, type CommandContext, Declare, Middlewares } from "seyfert";
import { createEmbed } from "../events/interactionCreate";
import { getContextLanguage } from "../utils/i18n";

@Cooldown({
	type: CooldownType.User,
	interval: 1000 * 60,
	uses: { default: 2 },
})
@Declare({
	name: "nowplaying",
	description: "Displays the currently playing song.",
})
@Middlewares(["cooldown", "checkPlayer"])
export default class nowplayngcmds extends Command {
	public override async run(ctx: CommandContext): Promise<void> {
		try {
			const { client } = ctx;
			const lang = getContextLanguage(ctx);
			const t = ctx.t.get(lang);

			const player = client.aqua.players.get(ctx.guildId!);
			const track = player.current;

			if (!track) {
				await ctx.editOrReply({
					content: t?.player?.noTrack || "❌ There is no music playing.",
					flags: 64,
				});
				return;
			}

			const embed = createEmbed(player, track, ctx);

			await ctx.editOrReply({ components: [embed], flags: 64 | 32768 });
		} catch (error: any) {
			if (error?.code === 10065) return;
		}
	}
}