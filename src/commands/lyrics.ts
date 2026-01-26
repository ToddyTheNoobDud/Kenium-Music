import { Cooldown, CooldownType } from "@slipher/cooldown";
import {
	ActionRow,
	Button,
	Command,
	type CommandContext,
	createStringOption,
	Declare,
	Embed,
	Middlewares,
	Options,
} from "seyfert";
import { ButtonStyle, ComponentType } from "seyfert/lib/types";
import { Musixmatch } from "../utils/musiclyrics";
import { getContextLanguage } from "../utils/i18n";

// Create singleton instance
const MUSIXMATCH = new Musixmatch();
const MAX_EMBED_LENGTH = 1800;
const EMBED_COLOR = 0x100e09;
const COLLECTOR_TIMEOUT = 300_000;

function createErrorEmbed(message: string, thele: any) {
	return new Embed()
		.setColor(0xe74c3c)
		.setTitle(thele.lyrics.error)
		.setDescription(message);
}

function formatTimestamp(ms: number) {
	const seconds = Math.floor(ms / 1000);
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatLyrics(lines: any[], plainText: string) {
	if (!lines?.length) return plainText || "";

	return lines
		.map((line) => {
			const timestamp =
				line.timestamp !== undefined
					? `\`[${formatTimestamp(line.timestamp)}]\``
					: line.range?.start !== undefined
						? `\`[${formatTimestamp(line.range.start)}]\``
						: "";

			return `${timestamp} **${line.line.trim()}**`.trim();
		})
		.join("\n");
}

function chunkContent(content: string, maxLength = MAX_EMBED_LENGTH) {
	if (content.length <= maxLength) return [content];

	const chunks: string[] = [];
	let start = 0;

	while (start < content.length) {
		let end = start + maxLength;
		if (end < content.length) {
			// Find last newline before maxLength
			const lastNewline = content.lastIndexOf("\n", end);
			if (lastNewline > start && lastNewline - start > maxLength * 0.8) {
				end = lastNewline;
			}
		}
		chunks.push(content.substring(start, end).trim());
		start = end;
	}

	return chunks;
}

function createNavigationRow(
	currentPage: number,
	totalPages: number,
	thele: any,
) {
	const row = new ActionRow().addComponents(
		new Button()
			.setCustomId("ignore_lyrics_close")
			.setEmoji("🗑️")
			.setStyle(ButtonStyle.Danger)
			.setLabel(thele.common.close),
	);

	if (totalPages > 1) {
		row.components.unshift(
			new Button()
				.setCustomId("ignore_lyrics_prev")
				.setEmoji("◀️")
				.setStyle(ButtonStyle.Primary)
				.setLabel(thele.common.previous)
				.setDisabled(currentPage === 0),
			new Button()
				.setCustomId("ignore_lyrics_page")
				.setLabel(`${currentPage + 1}/${totalPages}`)
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(true),
			new Button()
				.setCustomId("ignore_lyrics_next")
				.setEmoji("▶️")
				.setStyle(ButtonStyle.Primary)
				.setLabel(thele.common.next)
				.setDisabled(currentPage === totalPages - 1),
		);
	}

	return row;
}

async function displayLyricsUI(ctx: CommandContext, data: any, thele: any) {
	const formattedLyrics = formatLyrics(data.lines, data.lyrics);
	const chunks = chunkContent(formattedLyrics);
	let currentPage = 0;
	const totalPages = chunks.length;

	const createEmbed = () =>
		new Embed()
			.setColor(EMBED_COLOR)
			.setTitle(data.title)
			.setDescription(chunks[currentPage])
			.setThumbnail(data.albumArt)
			.setFooter({
				text: [
					data.source,
					data.track?.author && `${thele.lyrics.artist}: ${data.track.author}`,
					data.lines ? thele.lyrics.syncedLyrics : thele.lyrics.textLyrics,
					`${thele.common.page} ${currentPage + 1}/${totalPages}`,
				]
					.filter(Boolean)
					.join(" • "),
			});

	const response = await ctx.editOrReply({
		embeds: [createEmbed()],
		components: [createNavigationRow(currentPage, totalPages, thele)],
	});

	if (response) {
		const collector = response.createComponentCollector({
			componentType: ComponentType.Button,
			filter: (i) => i.user.id === ctx.interaction.user.id,
			idle: COLLECTOR_TIMEOUT,
		} as {
			componentType: ComponentType;
			filter: (i: any) => boolean;
			idle: number;
		});

		collector.run("ignore_lyrics_prev", async (i) => {
			if (currentPage > 0) {
				currentPage--;
				await i.update({
					embeds: [createEmbed()],
					components: [createNavigationRow(currentPage, totalPages, thele)],
				});
			}
		});

		collector.run("ignore_lyrics_next", async (i) => {
			if (currentPage < totalPages - 1) {
				currentPage++;
				await i.update({
					embeds: [createEmbed()],
					components: [createNavigationRow(currentPage, totalPages, thele)],
				});
			}
		});

		collector.run("ignore_lyrics_close", async (_i) => {
			collector.stop();
			await response.delete().catch(() => null);
		});

		collector.run("end", async () => {
			await response.edit({ components: [] }).catch(() => null);
		});
	}
}

async function fetchMusixmatchLyrics(query: string, currentTrack: any) {
	let searchQuery = query;

	if (!searchQuery && currentTrack) {
		searchQuery = currentTrack.title || "";
		if (!searchQuery && currentTrack.author) {
			searchQuery =
				`${currentTrack.title || ""} ${currentTrack.author || ""}`.trim();
		}
	}

	if (!searchQuery) return null;

	try {
		const result = await MUSIXMATCH.findLyrics(searchQuery);
		if (!result?.text && !result?.lines) return null;

		return {
			text: result.text,
			lines: result.lines,
			track: result.track,
			source: result.source,
			provider: result.source,
		};
	} catch (error) {
		console.error("Musixmatch error:", error);
		return null;
	}
}

@Cooldown({
	type: CooldownType.User,
	interval: 60_000,
	uses: { default: 2 },
})
@Options({
	search: createStringOption({
		description: "Song title to search for",
		required: false,
	}),
})
@Declare({
	name: "lyrics",
	description: "Get lyrics for the current song or search",
})
@Middlewares(["cooldown", "checkPlayer", "checkVoice", "checkTrack"])
export default class LyricsCommand extends Command {
	public override async run(ctx: CommandContext): Promise<void> {
		const lang = getContextLanguage(ctx);
		const thele = ctx.t.get(lang);
		await ctx.deferReply();
		const player = ctx.client.aqua.players.get(ctx.guildId);

		if (!player) {
			await ctx.editOrReply({
				embeds: [createErrorEmbed(thele.lyrics.noActivePlayer, thele)],
			});
			return void 0;
		}

		try {
			const { search } = ctx.options as { search?: string };
			let lyricsResult = null;

			// Primary lyrics source
			try {
				lyricsResult = await fetchMusixmatchLyrics(search, player.current);
			} catch (primaryError) {
				console.log("Primary lyrics failed:", primaryError.message);
			}

			if (!lyricsResult) {
				await ctx.editOrReply({
					embeds: [createErrorEmbed(thele.lyrics.noLyricsFound, thele)],
				});
				return void 0;
			}

			const { text, track, lines } = lyricsResult;
			const source = lyricsResult.provider || thele.common.unknown;
			const hasSyncedLyrics = Array.isArray(lines) && lines.length > 0;

			await displayLyricsUI(
				ctx,
				{
					lyrics: text || "",
					title: player.current?.title
						? `🎵 ${player.current.title}`
						: thele.lyrics.title,
					track,
					lines: hasSyncedLyrics ? lines : null,
					source,
					albumArt:
						player.current?.thumbnail ||
						track?.albumArt ||
						ctx.client.me.avatarURL(),
				},
				thele,
			);
		} catch (error) {
			console.error("Lyrics command error:", error);
			await ctx.editOrReply({
				embeds: [createErrorEmbed(thele.lyrics.serviceUnavailable, thele)],
			});
		}
	}
}
