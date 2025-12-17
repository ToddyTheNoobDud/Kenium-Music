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
import { getContextTranslations } from "../../utils/i18n";
import { getPlaylistsCollection } from "../../utils/db";

const playlistsCollection = getPlaylistsCollection();
const MAX_RESOLVE_CONCURRENCY = 6;

async function _resolveTrack(aqua: any, track: any, requester: any) {
	if (!track?.uri) {
		console.warn('[Playlist Play] Track missing URI:', track);
		return null;
	}

	try {
		// Try to resolve using the stored identifier first (more reliable for YouTube)
		const query = track.identifier || track.uri;

		const res = await aqua.resolve({
			query,
			requester,
			source: track.source?.toLowerCase().includes('youtube') ? 'ytsearch' : undefined
		});

		if (!res) {
			console.warn('[Playlist Play] No response for track:', track.title);
			return null;
		}

		const loadType = String(res.loadType || '').toUpperCase();

		// Handle different load types
		if (loadType === 'LOAD_FAILED' || loadType === 'NO_MATCHES') {
			console.warn(`[Playlist Play] Failed to load track: ${track.title} (${loadType})`);
			return null;
		}

		if (!Array.isArray(res.tracks) || res.tracks.length === 0) {
			console.warn('[Playlist Play] No tracks in response for:', track.title);
			return null;
		}

		// Return the first track from the response
		const resolved = res.tracks[0];
		console.log(`[Playlist Play] Successfully resolved: ${track.title}`);
		return resolved;

	} catch (error) {
		console.error('[Playlist Play] Error resolving track:', track.title, error);
		return null;
	}
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
			let player = ctx.client.aqua.players.get(ctx.guildId!);
			if (!player) {
				player = ctx.client.aqua.createConnection({
					guildId: ctx.guildId!,
					voiceChannel: voiceState.channelId,
					textChannel: ctx.channelId!,
					defaultVolume: 65,
					deaf: true,
				});
			}

			console.log(`[Playlist Play] Loading ${playlistDb.tracks.length} tracks from "${playlistName}"`);

			const tracks = shuffle
				? shuffleArray([...playlistDb.tracks])
				: [...playlistDb.tracks];

			const loadedTracks = await _mapLimit<any, any>(
				tracks,
				MAX_RESOLVE_CONCURRENCY,
				async (t) => {
					const tr = await _resolveTrack(ctx.client.aqua, t, ctx.interaction.user);
					return tr;
				},
			);

			console.log(`[Playlist Play] Successfully loaded ${loadedTracks.length}/${playlistDb.tracks.length} tracks`);

			if (loadedTracks.length === 0) {
				return ctx.editOrReply({
					embeds: [
						createEmbed(
							"error",
							t.playlist?.play?.loadFailed || "Load Failed",
							t.playlist?.play?.loadFailedDesc || "Could not load any tracks from this playlist. The tracks may no longer be available.",
						),
					],
				});
			}

			// Add all loaded tracks to the queue
			for (const t of loadedTracks) {
				player.queue.add(t);
			}

			// Update playlist stats
			try {
				playlistsCollection.updateAtomic(
					{ _id: playlistDb._id },
					{
						$inc: { playCount: 1 },
						$set: { lastPlayedAt: new Date().toISOString() }
					}
				);
			} catch (err) {
				console.warn('[Playlist Play] Failed to update playlist stats:', err);
			}

			// Start playing if not already playing
			if (!player.playing && !player.paused) {
				player.play();
			}

			const warningMessage = loadedTracks.length < playlistDb.tracks.length
				? `\n\n⚠️ ${playlistDb.tracks.length - loadedTracks.length} track(s) could not be loaded`
				: '';

			const embed = createEmbed(
				"success",
				shuffle ? (t.playlist?.play?.shuffling || "Shuffling Playlist") : (t.playlist?.play?.playing || "Playing Playlist"),
				warningMessage || undefined,
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
					{
						name: `${ICONS.tracks} ${t.playlist?.play?.inQueue || "In Queue"}`,
						value: `${player.queue.size} track(s)`,
						inline: true,
					},
				],
			);

			return ctx.editOrReply({ embeds: [embed] });
		} catch (err) {
			console.error('[Playlist Play] Fatal error:', err);
			return ctx.editOrReply({
				embeds: [
					createEmbed(
						"error",
						t.playlist?.play?.playFailed || "Play Failed",
						`${t.playlist?.play?.playFailedDesc || "Could not play playlist. Please try again later."}\n\nError: ${err instanceof Error ? err.message : 'Unknown error'}`,
					),
				],
			});
		}
	}
}
