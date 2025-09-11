import {
	type CommandContext,
	createStringOption,
	Declare,
	Options,
	SubCommand,
} from "seyfert";
import { createEmbed, handlePlaylistAutocomplete } from "../../shared/utils";
import { SimpleDB } from "../../utils/simpleDB";

const db = new SimpleDB();
const playlistsCollection = db.collection("playlists");

@Declare({
	name: "delete",
	description: "🗑️ Delete a playlist",
})
@Options({
	name: createStringOption({
		description: "Playlist name",
		required: true,
		autocomplete: async (interaction: any) => {
			return handlePlaylistAutocomplete(interaction, playlistsCollection);
		},
	}),
})
export class DeleteCommand extends SubCommand {
	async run(ctx: CommandContext) {
		const { name: playlistName } = ctx.options as { name: string };
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

		playlistsCollection.delete({ userId, name: playlistName });

		const embed = createEmbed(
			"success",
			"Playlist Deleted",
			`Successfully deleted playlist "${playlistName}"`,
		);
		return ctx.write({ embeds: [embed], flags: 64 });
	}
}
