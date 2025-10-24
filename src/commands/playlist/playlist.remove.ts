import {
	type CommandContext,
	createIntegerOption,
	createStringOption,
	Declare,
	Options,
	SubCommand,
} from "seyfert";
import { ICONS } from "../../shared/constants";
import {
	createEmbed,
	extractYouTubeId,
	handlePlaylistAutocomplete,
	handleTrackIndexAutocomplete,
} from "../../shared/utils";
import { getPlaylistsCollection } from "../../utils/db";
import { getContextTranslations } from "../../utils/i18n";

const playlistsCollection = getPlaylistsCollection();

@Declare({
	name: "remove",
	description: "➖ Remove a track from a playlist",
})
@Options({
	playlist: createStringOption({
		description: "Playlist name",
		required: true,
		autocomplete: async (interaction: any) => {
			return handlePlaylistAutocomplete(interaction, playlistsCollection);
		},
	}),
	index: createIntegerOption({
		description: "Track number to remove",
		required: true,
		min_value: 1,
		autocomplete: async (interaction: any) => {
			return handleTrackIndexAutocomplete(interaction, playlistsCollection);
		},
	}),
})
export class RemoveCommand extends SubCommand {
	async run(ctx: CommandContext) {
		const { playlist: playlistName, index } = ctx.options as {
			playlist: string;
			index: number;
		};
		const userId = ctx.author.id;
		const t = getContextTranslations(ctx);

		const playlist = playlistsCollection.findOne({
			userId,
			name: playlistName,
		});

		if (!playlist) {
			return ctx.write({
				embeds: [
					createEmbed(
						"error",
						t.playlist?.remove?.notFound || "Playlist Not Found",
						(t.playlist?.remove?.notFoundDesc || "No playlist named \"{name}\" exists!").replace("{name}", playlistName),
					),
				],
				flags: 64,
			});
		}

		if (index < 1 || index > playlist.tracks.length) {
			return ctx.write({
				embeds: [
					createEmbed(
						"error",
						t.playlist?.remove?.invalidIndex || "Invalid Index",
						(t.playlist?.remove?.invalidIndexDesc || "Track index must be between 1 and {max}").replace("{max}", String(playlist.tracks.length)),
					),
				],
				flags: 64,
			});
		}

		const removedTrack = playlist.tracks[index - 1];
		const timestamp = new Date().toISOString();
		const updatedTracks = playlist.tracks.filter((_, i) => i !== index - 1);
		const newTotalDuration = Math.max(
			0,
			(playlist.totalDuration || 0) - (removedTrack.duration || 0)
		);

		playlistsCollection.updateAtomic(
			{ _id: playlist._id },
			{
				$set: {
					tracks: updatedTracks,
					lastModified: timestamp,
					totalDuration: newTotalDuration
				}
			}
		);

		const embed = createEmbed(
			"success",
			t.playlist?.remove?.removed || "Track Removed",
			undefined,
			[
				{
					name: `${ICONS.remove} ${t.playlist?.remove?.removedTrack || "Removed"}`,
					value: `**${removedTrack.title}**`,
					inline: false,
				},
				{
					name: `${ICONS.artist} ${t.playlist?.remove?.artist || "Artist"}`,
					value: removedTrack.author || "Unknown",
					inline: true,
				},
				{
					name: `${ICONS.source} ${t.playlist?.remove?.source || "Source"}`,
					value: removedTrack.source || "Unknown",
					inline: true,
				},
				{
					name: `${ICONS.tracks} ${t.playlist?.remove?.remaining || "Remaining"}`,
					value: `${updatedTracks.length} tracks`,
					inline: true,
				},
			],
		);

		const videoId = extractYouTubeId(removedTrack.uri);
		if (videoId) {
			embed.setThumbnail(
				`https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
			);
		}

		return ctx.write({ embeds: [embed], flags: 64 });
	}
}