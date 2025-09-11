import {
	type CommandContext,
	createStringOption,
	Declare,
	Options,
	SubCommand,
} from "seyfert";
import { ButtonStyle } from "seyfert/lib/types";
import { ICONS, LIMITS } from "../../shared/constants";
import { createButtons, createEmbed } from "../../shared/utils";
import { SimpleDB } from "../../utils/simpleDB";

const db = new SimpleDB();
const playlistsCollection = db.collection("playlists");

@Declare({
	name: "create",
	description: "🎧 Create a new playlist",
})
@Options({
	name: createStringOption({ description: "Playlist name", required: true }),
})
export class CreateCommand extends SubCommand {
	async run(ctx: CommandContext) {
		const { name } = ctx.options as { name: string };
		const userId = ctx.author.id;

		// Early validation
		if (name.length > LIMITS.MAX_NAME_LENGTH) {
			return ctx.write({
				embeds: [
					createEmbed(
						"error",
						"Invalid Name",
						`Playlist name must be less than ${LIMITS.MAX_NAME_LENGTH} characters.`,
					),
				],
				flags: 64,
			});
		}

		// Single query for both checks
		const userPlaylists = playlistsCollection.find({ userId });

		if (userPlaylists.length >= LIMITS.MAX_PLAYLISTS) {
			return ctx.write({
				embeds: [
					createEmbed(
						"error",
						"Playlist Limit Reached",
						`You can only have a maximum of ${LIMITS.MAX_PLAYLISTS} playlists.`,
					),
				],
				flags: 64,
			});
		}

		if (userPlaylists.some((p) => p.name === name)) {
			return ctx.write({
				embeds: [
					createEmbed(
						"error",
						"Playlist Exists",
						`A playlist named "${name}" already exists!`,
					),
				],
				flags: 64,
			});
		}

		const timestamp = new Date().toISOString();
		const playlist = {
			userId,
			name,
			tracks: [],
			createdAt: timestamp,
			lastModified: timestamp,
			playCount: 0,
			totalDuration: 0,
		};

		playlistsCollection.insert(playlist);

		const embed = createEmbed("success", "Playlist Created", undefined, [
			{ name: `${ICONS.playlist} Name`, value: `**${name}**`, inline: true },
			{
				name: `${ICONS.star} Status`,
				value: "Ready for tracks!",
				inline: true,
			},
		]);

		const buttons = createButtons([
			{
				id: `add_track_${name}_${userId}`,
				label: "Add Tracks",
				emoji: ICONS.add,
				style: ButtonStyle.Success,
			},
			{
				id: `view_playlist_${name}_${userId}`,
				label: "View Playlist",
				emoji: ICONS.playlist,
				style: ButtonStyle.Primary,
			},
		]);

		return ctx.write({ embeds: [embed], components: [buttons], flags: 64 });
	}
}
