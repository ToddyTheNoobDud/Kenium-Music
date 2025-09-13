import { Cooldown, CooldownType } from "@slipher/cooldown";
import {
	type CommandContext,
	createBooleanOption,
	createStringOption,
	Declare,
	Middlewares,
	Options,
	SubCommand,
} from "seyfert";
import { ICONS } from "../../shared/constants";
import {
	createEmbed,
	formatDuration,
	handlePlaylistAutocomplete,
	shuffleArray,
} from "../../shared/utils";
import { SimpleDB } from "../../utils/simpleDB";
import { getContextTranslations } from "../../utils/i18n";

const db = new SimpleDB();
const playlistsCollection = db.collection("playlists");

const MAX_RESOLVE_CONCURRENCY = 6;

async function _resolveTrack(aqua: any, uri: string, requester: any) {
	if (!uri) return null;
	const res = await aqua.resolve({ query: uri, requester });
	if (
		res &&
		res.loadType !== "LOAD_FAILED" &&
		Array.isArray(res.tracks) &&
		res.tracks.length > 0
	)
		return res.tracks[0];
	return null;
}

async function _mapLimit<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R | null>,
) {
	const results: R[] = [];
	let i = 0;
	const workers = new Array(Math.min(limit, items.length))
		.fill(0)
		.map(async () => {
			while (i < items.length) {
				const idx = i++;
				const r = await fn(items[idx], idx);
				if (r !== null) results.push(r);
			}
		});
	await Promise.all(workers);
	return results;
}

function _safeChannelName(vc: any) {
	return vc?.channel?.name || vc?.channelId || "Voice";
}

@Declare({
	name: "play",
	description: "▶️ Play a playlist",
})
@Options({
	playlist: createStringOption({
		description: "Playlist name",
		required: true,
		autocomplete: async (interaction: any) =>
			handlePlaylistAutocomplete(interaction, playlistsCollection),
	}),
	shuffle: createBooleanOption({
		description: "Shuffle the playlist",
		required: false,
	}),
})
@Cooldown({
	type: CooldownType.User,
	interval: 20000,
	uses: { default: 2 },
})
@Middlewares(["checkVoice"])
export class PlayCommand extends SubCommand {
	async run(ctx: CommandContext) {
		const { playlist: playlistName, shuffle = false } = ctx.options as {
			playlist: string;
			shuffle?: boolean;
		};
		const userId = ctx.author.id;
		const t = getContextTranslations(ctx);

		const playlistDb = playlistsCollection.findOne({
			userId,
			name: playlistName,
		});
		if (!playlistDb) {
			return ctx.write({
				embeds: [
					createEmbed(
						"error",
						t.playlist?.play?.notFound || "Playlist Not Found",
						(t.playlist?.play?.notFoundDesc || "No playlist named \"{name}\" exists!").replace("{name}", playlistName),
					),
				],
				flags: 64,
			});
		}
		if (!Array.isArray(playlistDb.tracks) || playlistDb.tracks.length === 0) {
			return ctx.write({
				embeds: [
					createEmbed(
						"error",
						t.playlist?.play?.empty || "Empty Playlist",
						t.playlist?.play?.emptyDesc || "This playlist has no tracks to play!",
					),
				],
				flags: 64,
			});
		}

		const member = ctx.member;
		const voiceState = await member?.voice();
		if (!voiceState?.channelId) {
			return ctx.write({
				embeds: [
					createEmbed(
						"error",
						t.playlist?.play?.noVoiceChannel || "No Voice Channel",
						t.playlist?.play?.noVoiceChannelDesc || "Join a voice channel to play a playlist",
					),
				],
				flags: 64,
			});
		}

		await ctx.deferReply(true);

		try {
			const player = ctx.client.aqua.createConnection({
				guildId: ctx.guildId!,
				voiceChannel: voiceState.channelId,
				textChannel: ctx.channelId!,
				defaultVolume: 65,
				deaf: true,
			});

			const tracks = shuffle
				? shuffleArray([...playlistDb.tracks])
				: [...playlistDb.tracks];
			const loadedTracks = await _mapLimit<any, any>(
				tracks,
				MAX_RESOLVE_CONCURRENCY,
				async (t) => {
					const tr = await _resolveTrack(ctx.client.aqua, t.uri, ctx.author);
					return tr;
				},
			);

			if (loadedTracks.length === 0) {
				return ctx.editOrReply({
					embeds: [
						createEmbed(
							"error",
							t.playlist?.play?.loadFailed || "Load Failed",
							t.playlist?.play?.loadFailedDesc || "Could not load any tracks from this playlist",
						),
					],
				});
			}

			for (const t of loadedTracks) player.queue.add(t);

			playlistsCollection.update(
				{ _id: playlistDb._id },
				{
					...playlistDb,
					playCount: (playlistDb.playCount || 0) + 1,
					lastPlayedAt: Date.now(),
				},
			);

			if (!player.playing && !player.paused && player.queue.size) player.play();

			const embed = createEmbed(
				"success",
				shuffle ? (t.playlist?.play?.shuffling || "Shuffling Playlist") : (t.playlist?.play?.playing || "Playing Playlist"),
				undefined,
				[
					{
						name: `${ICONS.playlist} ${t.playlist?.play?.playlist || "Playlist"}`,
						value: `**${playlistName}**`,
						inline: true,
					},
					{
						name: `${ICONS.tracks} ${t.playlist?.play?.loaded || "Loaded"}`,
						value: `${loadedTracks.length}/${playlistDb.tracks.length} tracks`,
						inline: true,
					},
					{
						name: `${ICONS.duration} ${t.playlist?.play?.duration || "Duration"}`,
						value: formatDuration(playlistDb.totalDuration || 0),
						inline: true,
					},
					{
						name: `${ICONS.music} ${t.playlist?.play?.channel || "Channel"}`,
						value: _safeChannelName(voiceState),
						inline: true,
					},
					{
						name: `${ICONS.shuffle} ${t.playlist?.play?.mode || "Mode"}`,
						value: shuffle ? (t.playlist?.play?.shuffled || "Shuffled") : (t.playlist?.play?.sequential || "Sequential"),
						inline: true,
					},
				],
			);

			return ctx.editOrReply({ embeds: [embed] });
		} catch (_err) {
			return ctx.editOrReply({
				embeds: [
					createEmbed(
						"error",
						t.playlist?.play?.playFailed || "Play Failed",
						t.playlist?.play?.playFailedDesc || "Could not play playlist. Please try again later.",
					),
				],
			});
		}
	}
}
