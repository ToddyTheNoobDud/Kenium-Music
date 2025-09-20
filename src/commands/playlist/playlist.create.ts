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
import { getContextTranslations } from "../../utils/i18n";

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
		const t = getContextTranslations(ctx);

		// Early validation
		if (name.length > LIMITS.MAX_NAME_LENGTH) {
			return ctx.write({
				embeds: [
					createEmbed(
						"error",
						t.playlist?.create?.invalidName || "Invalid Name",
						(t.playlist?.create?.nameTooLong || "Playlist name must be less than {maxLength} characters.").replace("{maxLength}", String(LIMITS.MAX_NAME_LENGTH)),
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
						t.playlist?.create?.limitReached || "Playlist Limit Reached",
						(t.playlist?.create?.maxPlaylists || "You can only have a maximum of {max} playlists.").replace("{max}", String(LIMITS.MAX_PLAYLISTS)),
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
						t.playlist?.create?.exists || "Playlist Exists",
						(t.playlist?.create?.alreadyExists || "A playlist named \"{name}\" already exists!").replace("{name}", name),
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

		const embed = createEmbed(
			"success",
			t.playlist?.create?.created || "Playlist Created",
			undefined,
			[
				{ name: `${ICONS.playlist} ${t.playlist?.create?.name || "Name"}`, value: `**${name}**`, inline: true },
				{
					name: `${ICONS.star} ${t.playlist?.create?.status || "Status"}`,
					value: t.playlist?.create?.readyForTracks || "Ready for tracks!",
					inline: true,
				},
			],
		);

		const buttons = createButtons([
			{
				id: `add_track_${name}_${userId}`,
				label: t.playlist?.create?.addTracks || "Add Tracks",
				emoji: ICONS.add,
				style: ButtonStyle.Success,
			},
			{
				id: `view_playlist_${name}_${userId}`,
				label: t.playlist?.create?.viewPlaylist || "View Playlist",
				emoji: ICONS.playlist,
				style: ButtonStyle.Primary,
			},
		]);

		return ctx.write({ embeds: [embed], components: [buttons], flags: 64 });
	}
}
