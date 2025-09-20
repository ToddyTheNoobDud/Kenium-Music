import { Cooldown, CooldownType } from "@slipher/cooldown";
import {
	Command,
	type CommandContext,
	createAttachmentOption,
	Declare,
	Embed,
	Middlewares,
	Options,
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
	name: "import",
	description: "Import a queue from a file (txt, pdf)",
})
@Options({
	file: createAttachmentOption({
		description: "The file to import",
		required: true,
	}),
})
@Middlewares(["checkVoice", "cooldown", "checkPlayer"])
export default class importcmds extends Command {
	public override async run(ctx: CommandContext): Promise<void> {
		try {
			const { client } = ctx;
			const lang = getContextLanguage(ctx);
			const t = ctx.t.get(lang);
			const { file } = ctx.options as { file: any };

			const response = await fetch(file.url);
			const fileContent = await response.text();

			if (!fileContent.trim()) {
				await ctx.editOrReply({
					embeds: [
						new Embed()
							.setDescription(t?.import?.emptyFile || "❌ The file is empty")
							.setColor(0xff0000),
					],
				});
				return;
			}
			const player = client.aqua.players.get(ctx.guildId!);

			const numberRegex = /^\d+\.\s*/;
			const urlRegex =
				/^https?:\/\/|youtube\.com|youtu\.be|spotify\.com|soundcloud\.com/i;
			const pipeRegex = /\s*\|\s*/;

			const tracks = fileContent
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean)
				.map((line) => {
					const parts = line.split(pipeRegex);
					if (parts.length === 1) {
						return { url: line, title: "" };
					}

					const [first, second] = parts;

					if (urlRegex.test(first)) {
						return { url: first, title: second || "" };
					}

					return {
						url: second || "",
						title: first.replace(numberRegex, ""),
					};
				})
				.filter((track) => track.url && urlRegex.test(track.url));

			if (tracks.length === 0) {
				await ctx.editOrReply({
					embeds: [
						new Embed()
							.setDescription(t?.import?.noValidTracks || "❌ No valid tracks found in the file")
							.setColor(0xff0000),
					],
				});
				return;
			}

			const importingText = t?.import?.importing?.replace('{count}', tracks.length.toString())
				|| `🎵 Importing ${tracks.length} tracks...`;

			const embed = new Embed()
				.setDescription(importingText)
				.setColor(0x00ff00);

			await ctx.editOrReply({ embeds: [embed], flags: 64 });

			const batchSize = Math.min(
				10,
				Math.max(3, Math.floor(tracks.length / 20)),
			);
			let successCount = 0;
			let failCount = 0;

			for (let i = 0; i < tracks.length; i += batchSize) {
				const batch = tracks.slice(i, i + batchSize);

				const results = await Promise.allSettled(
					batch.map(async (track) => {
						const result = await client.aqua.resolve({
							query: track.url,
							requester: ctx.interaction.user,
						});

						if (result?.tracks?.[0]) {
							await player.queue.add(result.tracks[0]);
							return true;
						}
						return false;
					}),
				);

				results.forEach((result) => {
					if (result.status === "fulfilled" && result.value) {
						successCount++;
					} else {
						failCount++;
					}
				});

				if (i + batchSize < tracks.length) {
					const delay = Math.max(
						50,
						200 - (successCount / (successCount + failCount)) * 150,
					);
					await new Promise((resolve) => setTimeout(resolve, delay));
				}
			}

			if (!player.playing && !player.paused && player.queue.length > 0) {
				await player.play();
			}

			const completeTitle = t?.import?.complete || "🔥 Import Complete";
			const successText = t?.import?.successfullyImported?.replace('{count}', successCount.toString())
				|| `✅ Successfully imported: **${successCount}** tracks`;
			const failText = failCount > 0
				? (t?.import?.failedToImport?.replace('{count}', failCount.toString())
					|| `❌ Failed to import: **${failCount}** tracks`)
				: "";
			const totalText = t?.import?.totalQueueSize?.replace('{count}', player.queue.length.toString())
				|| `🎵 Total queue size: **${player.queue.length}** tracks`;

			const description = [successText, failText, totalText].filter(Boolean).join("\n");

			const resultEmbed = new Embed()
				.setTitle(completeTitle)
				.setDescription(description)
				.setColor(0)
				.setTimestamp();

			await ctx.editOrReply({ embeds: [resultEmbed], flags: 64 });
		} catch (error) {
			if (error.code === 10065) return;
		}
	}
}