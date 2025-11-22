import { Cooldown, CooldownType } from "@slipher/cooldown";
import {
	AttachmentBuilder,
	Command,
	type CommandContext,
	Declare,
	Embed,
	Middlewares,
} from "seyfert";
import { getContextLanguage } from "../utils/i18n";

@Cooldown({
	type: CooldownType.User,
	interval: 1000 * 60,
	uses: {
		default: 2,
	},
})
@Declare({
	name: "export",
	description: "Export the queue",
})
@Middlewares(["checkPlayer", "checkVoice", "cooldown"])
export default class exportcmds extends Command {
	public override async run(ctx: CommandContext): Promise<void> {
		try {
			const { client } = ctx;
			const lang = getContextLanguage(ctx);
			const t = ctx.t.get(lang);

			const player = client.aqua.players.get(ctx.guildId!);

			if (player.queue.length === 0) {
				await ctx.editOrReply({
					embeds: [
						new Embed()
							.setDescription(t.player?.queueEmpty || "The queue is empty")
							.setColor(0xff0000),
					],
					flags: 64,
				});
				return;
			}

			const platformRegex = {
				youtube: /youtube\.com|youtu\.be/,
				soundcloud: /soundcloud\.com/,
				spotify: /spotify\.com/,
				web: /^https?:\/\//,
			};

			const platforms = new Set<string>();
			const queueLines: string[] = [];

			for (let i = 0; i < player.queue.length; i++) {
				const song = player.queue[i];
				const uri = song.info.uri;

				queueLines.push(
					`${uri} | ${song.info.title} | ${song.info.author} | ${i + 1}`,
				);

				if (platformRegex.youtube.test(uri)) {
					platforms.add("youtube");
				} else if (platformRegex.soundcloud.test(uri)) {
					platforms.add("soundcloud");
				} else if (platformRegex.spotify.test(uri)) {
					platforms.add("spotify");
				} else if (platformRegex.web.test(uri)) {
					platforms.add("web");
				} else {
					const colonIndex = uri.indexOf(":");
					if (colonIndex > 0) {
						platforms.add(uri.substring(0, colonIndex));
					}
				}
			}

			const randomId = Math.random()
				.toString(36)
				.substring(2, 10)
				.toUpperCase();

			const warningHeader = `# DO NOT MODIFY THIS FILE / CAN GET CORRUPTED - Kenium 4.9.1 - BY mushroom0162\n# Export ID: ${randomId}\n# Generated: ${new Date().toISOString()}\n\n`;
			const queueString = warningHeader + queueLines.join("\n");

			const platformsString = Array.from(platforms).sort().join("_");

			const attachment = new AttachmentBuilder()
				.setDescription("Queue.txt")
				.setName(`Kenium_V4_${platformsString}_${randomId}.txt`)
				.setFile("buffer", Buffer.from(queueString, "utf8"));

			await ctx.editOrReply({
				embeds: [
					new Embed()
						.setDescription(t?.export?.success || "Exported the queue with URLs for import")
						.setColor("#0x100e09"),
				],
				files: [attachment],
				flags: 64,
			});
		} catch (error) {
			if (error.code === 10065) return;
		}
	}
}