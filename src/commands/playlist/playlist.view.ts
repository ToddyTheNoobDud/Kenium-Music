import {
	ActionRow,
	type CommandContext,
	createStringOption,
	Declare,
	Options,
	StringSelectMenu,
	SubCommand,
} from "seyfert";
import { ButtonStyle } from "seyfert/lib/types";
import { ICONS, LIMITS } from "../../shared/constants";
import {
	createButtons,
	createEmbed,
	extractYouTubeId,
	formatDuration,
	handlePlaylistAutocomplete,
} from "../../shared/utils";
import { SimpleDB } from "../../utils/simpleDB";
import { getContextTranslations } from "../../utils/i18n";

const db = new SimpleDB();
const playlistsCollection = db.collection("playlists");

function createSelectMenu(
	customId: string,
	placeholder: string,
	opts: {
		label: string;
		value: string;
		description?: string;
		emoji?: string;
	}[],
) {
	const menu = new StringSelectMenu()
		.setCustomId(customId)
		.setPlaceholder(placeholder);

	for (const opt of opts) {
		menu.addOption({
			// @ts-ignore
			label: opt.label,
			value: opt.value,
			description: opt.description,
			emoji: opt.emoji,
		});
	}

	return new ActionRow().addComponents(menu);
}

function getSourceIcon(uri: string): string {
	if (!uri) return ICONS.music;
	if (uri.includes("youtube.com") || uri.includes("youtu.be"))
		return ICONS.youtube;
	if (uri.includes("spotify.com")) return ICONS.spotify;
	if (uri.includes("soundcloud.com")) return ICONS.soundcloud;
	return ICONS.music;
}

@Declare({
	name: "view",
	description: "🎧 View your playlists or a specific playlist",
})
@Options({
	playlist: createStringOption({
		description: "Playlist name",
		required: true,
		autocomplete: async (interaction: any) =>
			handlePlaylistAutocomplete(interaction, playlistsCollection),
	}),
})
export class ViewCommand extends SubCommand {
	async run(ctx: CommandContext) {
		const { playlist: playlistName } = ctx.options as { playlist?: string };
		const userId = ctx.author.id;

		if (!playlistName) {
			const playlists = playlistsCollection.find({ userId });
			if (!Array.isArray(playlists) || playlists.length === 0) {
				const embed = createEmbed(
					"info",
					"No Playlists",
					"You haven’t created any playlists yet!",
					[
						{
							name: `${ICONS.info} Getting Started`,
							value: "Use `/playlist create` to make your first playlist!",
						},
					],
				);
				const button = createButtons([
					{
						id: `create_playlist_${userId}`,
						label: "Create Playlist",
						emoji: ICONS.add,
						style: ButtonStyle.Success,
					},
				]);
				return ctx.write({ embeds: [embed], components: [button], flags: 64 });
			}

			const embed = createEmbed(
				"primary",
				"Your Playlists",
				`You have **${playlists.length}** playlist${playlists.length !== 1 ? "s" : ""}`,
			);
			playlists.slice(0, 10).forEach((p) => {
				const duration = formatDuration(p.totalDuration || 0);
				const lastMod = new Date(
					p.lastModified || p.createdAt,
				).toLocaleDateString();
				embed.addFields({
					name: `${ICONS.playlist} ${p.name}`,
					value: `${ICONS.tracks} ${p.tracks.length} tracks • ${ICONS.duration} ${duration}\n${ICONS.info} Modified: ${lastMod}`,
					inline: true,
				});
			});

			const selectOptions = playlists.slice(0, 25).map((p) => ({
				label: p.name,
				value: p.name,
				description: `${p.tracks.length} tracks • ${formatDuration(p.totalDuration || 0)}`,
				emoji: ICONS.playlist,
			}));
			const components =
				selectOptions.length > 0
					? [
							createSelectMenu(
								`select_playlist_${userId}`,
								"Choose a playlist to view...",
								selectOptions,
							),
						]
					: [];

			return ctx.write({ embeds: [embed], components, flags: 64 });
		}

		const playlist = playlistsCollection.findOne({
			userId,
			name: playlistName,
		});
		if (!playlist) {
			return ctx.write({
				embeds: [
					createEmbed(
						"error",
						"Playlist Not Found",
						`No playlist named "${playlistName}" exists!`,
					),
				],
				flags: 64,
			});
		}

		if (!Array.isArray(playlist.tracks) || playlist.tracks.length === 0) {
			const embed = createEmbed(
				"info",
				`Playlist: ${playlistName}`,
				"This playlist is empty",
				[
					{
						name: `${ICONS.info} Description`,
						value: playlist.description || "No description",
					},
				],
			);
			const button = createButtons([
				{
					id: `add_track_${playlistName}_${userId}`,
					label: "Add Tracks",
					emoji: ICONS.add,
					style: ButtonStyle.Success,
				},
			]);
			return ctx.write({ embeds: [embed], components: [button], flags: 64 });
		}

		const page = 1;
		const pageSize = LIMITS.PAGE_SIZE || 10;
		const totalPages = Math.max(
			1,
			Math.ceil(playlist.tracks.length / pageSize),
		);
		const startIdx = (page - 1) * pageSize;
		const endIdx = Math.min(startIdx + pageSize, playlist.tracks.length);
		const tracks = playlist.tracks.slice(startIdx, endIdx);

		const embed = createEmbed(
			"primary",
			`${ICONS.playlist} ${playlistName}`,
			undefined,
			[
				{
					name: `${ICONS.info} Info`,
					value: playlist.description || "No description",
					inline: false,
				},
				{
					name: `${ICONS.tracks} Tracks`,
					value: String(playlist.tracks.length),
					inline: true,
				},
				{
					name: `${ICONS.duration} Duration`,
					value: formatDuration(playlist.totalDuration || 0),
					inline: true,
				},
				{
					name: `${ICONS.info} Plays`,
					value: String(playlist.playCount || 0),
					inline: true,
				},
			],
		);

		const trackList = tracks
			.map((t: any, i: number) => {
				const pos = String(startIdx + i + 1).padStart(2, "0");
				const duration = formatDuration(t.duration || 0);
				const source = getSourceIcon(t.uri);
				return `\`${pos}.\` **${t.title}**\n     ${ICONS.artist} ${t.author || "Unknown"} • ${ICONS.duration} ${duration} ${source}`;
			})
			.join("\n\n");

		if (trackList)
			embed.addFields({
				name: `${ICONS.music} Tracks (Page ${page}/${totalPages})`,
				value: trackList,
				inline: false,
			});

		const firstVideoId = extractYouTubeId(tracks[0]?.uri);
		if (firstVideoId)
			embed.setThumbnail(
				`https://img.youtube.com/vi/${firstVideoId}/maxresdefault.jpg`,
			);

		const actions = createButtons([
			{
				id: `play_playlist_${playlistName}_${userId}`,
				label: "Play",
				emoji: ICONS.play,
				style: ButtonStyle.Success,
			},
			{
				id: `shuffle_playlist_${playlistName}_${userId}`,
				label: "Shuffle",
				emoji: ICONS.shuffle,
				style: ButtonStyle.Primary,
			},
			{
				id: `manage_playlist_${playlistName}_${userId}`,
				label: "Manage",
				emoji: "⚙️",
				style: ButtonStyle.Secondary,
			},
		]);

		const components = [actions];
		if (totalPages > 1) {
			components.push(
				createButtons([
					{
						id: `playlist_prev_${page}_${playlistName}_${userId}`,
						label: "Previous",
						emoji: "◀️",
						disabled: page === 1,
					},
					{
						id: `playlist_next_${page}_${playlistName}_${userId}`,
						label: "Next",
						emoji: "▶️",
						disabled: page === totalPages,
					},
				]),
			);
		}

		return ctx.write({ embeds: [embed], components, flags: 64 });
	}
}
