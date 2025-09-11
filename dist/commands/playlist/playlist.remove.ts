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
import { SimpleDB } from "../../utils/simpleDB";

const db = new SimpleDB();
const playlistsCollection = db.collection("playlists");

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

		if (index < 1 || index > playlist.tracks.length) {
			return ctx.write({
				embeds: [
					createEmbed(
						"error",
						"Invalid Index",
						`Track index must be between 1 and ${playlist.tracks.length}`,
					),
				],
				flags: 64,
			});
		}

		const [removedTrack] = playlist.tracks.splice(index - 1, 1);
		const timestamp = new Date().toISOString();

		// Batch update
		const updatedPlaylist = {
			...playlist,
			lastModified: timestamp,
			totalDuration: playlist.tracks.reduce(
				(sum: number, track: any) => sum + (track.duration || 0),
				0,
			),
		};

		playlistsCollection.update({ _id: playlist._id }, updatedPlaylist);

		const embed = createEmbed("success", "Track Removed", undefined, [
			{
				name: `${ICONS.remove} Removed`,
				value: `**${removedTrack.title}**`,
				inline: false,
			},
			{
				name: `${ICONS.artist} Artist`,
				value: removedTrack.author || "Unknown",
				inline: true,
			},
			{
				name: `${ICONS.source} Source`,
				value: removedTrack.source || "Unknown",
				inline: true,
			},
			{
				name: `${ICONS.tracks} Remaining`,
				value: `${playlist.tracks.length} tracks`,
				inline: true,
			},
		]);

		const videoId = extractYouTubeId(removedTrack.uri);
		if (videoId) {
			embed.setThumbnail(
				`https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
			);
		}

		return ctx.write({ embeds: [embed], flags: 64 });
	}
}
