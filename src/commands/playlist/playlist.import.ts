import {
	type CommandContext,
	createAttachmentOption,
	createStringOption,
	Declare,
	Embed,
	Options,
	SubCommand,
} from "seyfert";
import {
	getPlaylistsCollection,
	getTracksCollection,
	getDatabase,
} from "../../utils/db";
import { getContextTranslations } from "../../utils/i18n";

// Schema validation for imported playlists
interface ImportedPlaylist {
	name: string;
	description?: string;
	tracks: Array<{
		title: string;
		uri: string;
		author: string;
		duration: number;
		source?: string;
		identifier?: string;
	}>;
}

// Modern Emoji Set
const ICONS = {
	music: "🎵",
	tracks: "💿",
	import: "📥",
	playlist: "🎧",
	duration: "⏱️",
};

const COLORS = {
	primary: 0x100e09,
	success: 0x100e09,
	error: 0x100e09,
};

const playlistsCollection = getPlaylistsCollection();
const tracksCollection = getTracksCollection();

function createEmbed(
	type: string,
	title: string,
	description: string | null = null,
	fields: Array<{ name: string; value: string; inline?: boolean }> = [],
) {
	const colors = {
		default: COLORS.primary,
		success: COLORS.success,
		error: COLORS.error,
	};

	const icons = {
		default: ICONS.music,
		success: "✨",
		error: "❌",
	};

	const embed = new Embed()
		.setColor(colors[type] || colors.default)
		.setTitle(`${icons[type] || icons.default} ${title}`)
		.setTimestamp()
		.setFooter({
			text: `${ICONS.tracks} Kenium Music • Playlist System`,
			iconUrl:
				"https://toddythenoobdud.github.io/0a0f3c0476c8b495838fa6a94c7e88c2.png",
		});

	if (description) {
		embed.setDescription(`\`\`\`fix\n${description}\n\`\`\``);
	}

	if (fields.length > 0) {
		embed.addFields(fields);
	}

	return embed;
}

function formatDuration(ms: number): string {
	if (!ms || ms === 0) return "00:00";
	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) {
		return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
	}
	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function determineSource(uri: string): string {
	if (!uri) return "❓ Unknown";
	if (uri.includes("youtube.com") || uri.includes("youtu.be"))
		return "🎥 YouTube";
	if (uri.includes("spotify.com")) return "🟢 Spotify";
	if (uri.includes("soundcloud.com")) return "🟠 SoundCloud";
	return "🎵 Music";
}

@Declare({
	name: "import",
	description: "📥 Import a playlist",
})
@Options({
	file: createAttachmentOption({
		description: "Playlist file to import",
		required: true,
	}),
	name: createStringOption({
		description: "Custom playlist name (optional)",
		required: false,
	}),
})
export class ImportCommand extends SubCommand {
	async run(ctx: CommandContext) {
		const { file: attachment } = ctx.options as { file: any };
		const { name: providedName } = ctx.options as { name: string };
		const userId = ctx.author.id;
		const t = getContextTranslations(ctx);

		try {
			const response = await fetch(attachment.url);
			const data = await response.json();

			if (
				!data.name ||
				typeof data.name !== "string" ||
				!Array.isArray(data.tracks)
			) {
				return await ctx.write({
					embeds: [
						createEmbed(
							"error",
							t.playlist?.import?.invalidFile || "Invalid File",
							t.playlist?.import?.invalidFileDesc ||
								"The file must contain a valid playlist with name and tracks array.",
						),
					],
					flags: 64,
				});
			}

			const validTracks = data.tracks.filter((track: any) => {
				return (
					track &&
					typeof track.title === "string" &&
					typeof track.uri === "string" &&
					typeof track.author === "string" &&
					typeof track.duration === "number"
				);
			});

			if (validTracks.length === 0) {
				return await ctx.write({
					embeds: [
						createEmbed(
							"error",
							t.playlist?.import?.invalidFile || "Invalid File",
							"The playlist contains no valid tracks.",
						),
					],
					flags: 64,
				});
			}

			const playlistName = providedName || data.name;

			const existing = playlistsCollection.findOne({
				userId,
				name: playlistName,
			});
			if (existing) {
				return await ctx.write({
					embeds: [
						createEmbed(
							"error",
							t.playlist?.import?.nameConflict || "Name Conflict",
							(
								t.playlist?.import?.nameConflictDesc ||
								'A playlist named "{name}" already exists!'
							).replace("{name}", playlistName),
						),
					],
					flags: 64,
				});
			}

			const timestamp = new Date().toISOString();
			const totalDuration = validTracks.reduce(
				(sum: number, track: any) => sum + (track.duration || 0),
				0,
			);

			try {
				getDatabase().transaction(() => {
					const insertedPlaylist = playlistsCollection.insert({
						userId,
						name: playlistName,
						description: data.description || "Imported playlist",
						createdAt: timestamp,
						lastModified: timestamp,
						playCount: 0,
						totalDuration: totalDuration,
						trackCount: validTracks.length,
					}) as any;

					const tracksToInsert = validTracks.map((track: any) => ({
						playlistId: insertedPlaylist._id,
						title: track.title,
						uri: track.uri,
						author: track.author,
						duration: track.duration,
						addedAt: timestamp,
						addedBy: userId,
						source: track.source || determineSource(track.uri),
						identifier: track.identifier || "",
					}));

					tracksCollection.insert(tracksToInsert);
				});
			} catch (dbError) {
				console.error("Database error importing playlist:", dbError);
				return await ctx.write({
					embeds: [
						createEmbed(
							"error",
							t.playlist?.import?.importFailed || "Import Failed",
							(
								t.playlist?.import?.importFailedDesc ||
								"Could not save playlist: {error}"
							).replace(
								"{error}",
								dbError instanceof Error ? dbError.message : "Unknown error",
							),
						),
					],
					flags: 64,
				});
			}

			const embed = createEmbed(
				"success",
				t.playlist?.import?.imported || "Playlist Imported",
				null,
				[
					{
						name: `${ICONS.playlist} ${t.playlist?.import?.name || "Name"}`,
						value: `**${playlistName}**`,
						inline: true,
					},
					{
						name: `${ICONS.tracks} ${t.playlist?.import?.tracks || "Tracks"}`,
						value: `${validTracks.length}`,
						inline: true,
					},
					{
						name: `${ICONS.duration} ${t.playlist?.import?.duration || "Duration"}`,
						value: formatDuration(totalDuration),
						inline: true,
					},
				],
			);

			await ctx.write({ embeds: [embed], flags: 64 });
		} catch (error) {
			console.error("Import playlist error:", error);
			await ctx.write({
				embeds: [
					createEmbed(
						"error",
						t.playlist?.import?.importFailed || "Import Failed",
						(
							t.playlist?.import?.importFailedDesc ||
							"Could not import playlist: {error}"
						).replace("{error}", (error as Error).message),
					),
				],
				flags: 64,
			});
		}
	}
}
