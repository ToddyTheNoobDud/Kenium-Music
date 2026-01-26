import { Container, createEvent } from "seyfert";
import { ICONS, LIMITS } from "../shared/constants";
import {
	createButtons,
	createEmbed,
	formatDuration,
	shuffleArray,
} from "../shared/utils";
import { MUSIC_PLATFORMS, PLAYBACK_E } from "../shared/emojis";
import {
	getPlaylistsCollection,
	getTracksCollection,
	getPlaylistTracks,
} from "../utils/db";

const MAX_TITLE_LENGTH = 60;
const VOLUME_STEP = 10;
const MAX_VOLUME = 100;
const MIN_VOLUME = 0;
const FLAGS_UPDATE = 36864;
const PAGE_SIZE = LIMITS.PAGE_SIZE || 10;
const RESOLVE_CONCURRENCY = 5;

const TITLE_SANITIZE_RE = /[^\w\s\-_.]/g;
const WORD_START_RE = /\b\w/g;

const playlistsCollection = getPlaylistsCollection();
const tracksCollection = getTracksCollection();

export const _functions = {
	clamp: (n, min, max) => (n < min ? min : n > max ? max : n),

	getQueueLength: (queue) => queue?.length ?? queue?.size ?? 0,

	formatTime: (ms) => {
		const s = Math.floor((ms || 0) / 1000);
		const pad = (n) => String(n).padStart(2, "0");
		return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
	},

	sanitizeTitle: (text) =>
		String(text || "")
			.replace(TITLE_SANITIZE_RE, "")
			.trim(),

	truncateText: (text, maxLength = MAX_TITLE_LENGTH) => {
		if (!text) return "";
		if (text.length <= maxLength) return text;
		const processed = _functions.sanitizeTitle(text);
		if (processed.length <= maxLength) return processed;
		return `${processed.slice(0, maxLength - 3).trimEnd()}...`;
	},

	titleCaseWordBoundaries: (text) =>
		String(text || "").replace(WORD_START_RE, (c) => c.toUpperCase()),

	getPlatform: (uri) => {
		if (!uri) return MUSIC_PLATFORMS.youtube;
		const s = uri.toLowerCase();
		if (s.includes("soundcloud")) return MUSIC_PLATFORMS.soundcloud;
		if (s.includes("spotify")) return MUSIC_PLATFORMS.spotify;
		if (s.includes("deezer")) return MUSIC_PLATFORMS.deezer;
		if (s.includes("youtu")) return MUSIC_PLATFORMS.youtube;
		return MUSIC_PLATFORMS.youtube;
	},

	getSourceIcon: (uri) => {
		if (!uri) return ICONS.music;
		const s = uri.toLowerCase();
		if (s.includes("youtu")) return ICONS.youtube;
		if (s.includes("spotify")) return ICONS.spotify;
		if (s.includes("soundcloud")) return ICONS.soundcloud;
		return ICONS.music;
	},

	extractYouTubeId: (uri) => {
		if (!uri) return null;
		const s = String(uri);
		const lower = s.toLowerCase();
		if (!lower.includes("youtu")) return null;

		const isValidId = (id) => {
			if (!id || id.length !== 11) return false;
			for (let i = 0; i < id.length; i++) {
				const c = id.charCodeAt(i);
				const ok =
					(c >= 48 && c <= 57) ||
					(c >= 65 && c <= 90) ||
					(c >= 97 && c <= 122) ||
					c === 45 || // -
					c === 95; // _
				if (!ok) return false;
			}
			return true;
		};

		const cutAtDelim = (str) => {
			let end = str.length;
			for (const d of ["?", "&", "/", "#"]) {
				const idx = str.indexOf(d);
				if (idx !== -1 && idx < end) end = idx;
			}
			return str.slice(0, end);
		};

		const shortIdx = lower.indexOf("youtu.be/");
		if (shortIdx !== -1) {
			const raw = s.slice(shortIdx + "youtu.be/".length);
			const id = cutAtDelim(raw);
			return isValidId(id) ? id : null;
		}

		const qv = lower.indexOf("?v=");
		const av = lower.indexOf("&v=");
		const idx = qv !== -1 ? qv + 3 : av !== -1 ? av + 3 : -1;
		if (idx === -1) return null;

		const id = cutAtDelim(s.slice(idx));
		return isValidId(id) ? id : null;
	},

	setPlayerVolume: (player, volume) => player?.setVolume?.(volume),

	addToQueueFront: (queue, item) => {
		if (!queue) return;
		if (typeof queue.unshift === "function") queue.unshift(item);
		else queue.add?.(item)?.catch?.(() => {});
	},

	safeDefer: async (interaction, flags = 64) => {
		try {
			await interaction.deferReply(flags);
			return true;
		} catch {
			try {
				await interaction.deferReply({ flags });
				return true;
			} catch {
				return false;
			}
		}
	},

	safeReply: (interaction, content) =>
		interaction.editOrReply({ content }).catch(() => {}),
	safeFollowup: (interaction, content) =>
		interaction.followup({ content }).catch(() => {}),

	parsePlaylistButtonId: (customId) => {
		if (!customId) return null;
		const parts = customId.split("_");
		if (parts.length < 3) return null;

		const userId = parts.at(-1);
		if (!userId) return null;

		const a0 = parts[0];
		const a1 = parts[1];

		if ((a0 === "play" || a0 === "shuffle") && a1 === "playlist") {
			return {
				action: `${a0}_${a1}`,
				playlistName: parts.slice(2, -1).join("_"),
				userId,
			};
		}

		if (a0 === "playlist" && (a1 === "prev" || a1 === "next")) {
			const page = Number(parts[2]);
			return {
				action: `playlist_${a1}`,
				playlistName: parts.slice(3, -1).join("_"),
				userId,
				page: Number.isFinite(page) ? page : undefined,
			};
		}

		return null;
	},

	updateNowPlayingEmbed: async (player, client) => {
		const msg = player?.nowPlayingMessage;
		if (!msg?.edit || !player?.current) {
			if (player) player.nowPlayingMessage = null;
			return;
		}
		try {
			await msg.edit({
				components: [createNowPlayingEmbed(player, player.current, client)],
				flags: FLAGS_UPDATE,
			});
		} catch {
			player.nowPlayingMessage = null;
		}
	},

	resolveTracksAndEnqueue: async (
		tracks,
		resolveFn,
		enqueueFn,
		limit = RESOLVE_CONCURRENCY,
	) => {
		const list = Array.isArray(tracks) ? tracks : [];
		for (let i = 0; i < list.length; i += limit) {
			const batch = list.slice(i, i + limit);
			const settled = await Promise.allSettled(batch.map(resolveFn));
			for (const r of settled) {
				if (r.status !== "fulfilled") continue;
				const track = (r.value as any)?.tracks?.[0];
				if (track) enqueueFn(track);
			}
		}
	},
};

export const createNowPlayingEmbed = (player, track, client) => {
	const { position = 0, volume = 0, loop, paused } = player || {};
	const { title = "Unknown", uri = "", length = 0, requester } = track || {};

	const platform = _functions.getPlatform(uri);
	const volumeIcon = volume === 0 ? "🔇" : volume < 50 ? "🔈" : "🔊";
	const loopIcon = loop === "track" ? "🔂" : loop === "queue" ? "🔁" : "▶️";
	const displayTitle = _functions.titleCaseWordBoundaries(
		_functions.truncateText(title),
	);

	return new Container({
		components: [
			{
				type: 10,
				content: `**${platform.emoji} Now Playing** | **Queue size**: ${_functions.getQueueLength(player?.queue)}`,
			},
			{ type: 14, divider: true, spacing: 1 },
			{
				type: 9,
				components: [
					{
						type: 10,
						content: `## **[\`${displayTitle}\`](${uri})**\n\`${_functions.formatTime(position)}\` / \`${_functions.formatTime(length)}\``,
					},
					{
						type: 10,
						content: `${volumeIcon} \`${volume}%\` ${loopIcon} Requester: \`${requester?.username || "Unknown"}\``,
					},
				],
				accessory: {
					type: 11,
					media: {
						url:
							track?.info?.artworkUrl ||
							client?.me?.avatarURL?.({ extension: "webp" }) ||
							"",
					},
				},
			},
			{ type: 14, divider: true, spacing: 2 },
			{
				type: 1,
				components: [
					{
						type: 2,
						label: `${PLAYBACK_E.volume_down}`,
						style: 2,
						custom_id: "volume_down",
					},
					{
						type: 2,
						label: `${PLAYBACK_E.previous}`,
						style: 2,
						custom_id: "previous",
					},
					{
						type: 2,
						label: paused ? `${PLAYBACK_E.resume}` : `${PLAYBACK_E.pause}`,
						style: paused ? 3 : 2,
						custom_id: paused ? "resume" : "pause",
					},
					{ type: 2, label: `${PLAYBACK_E.skip}`, style: 2, custom_id: "skip" },
					{
						type: 2,
						label: `${PLAYBACK_E.volume_up}`,
						style: 2,
						custom_id: "volume_up",
					},
				],
			},
			{ type: 14, divider: true, spacing: 2 },
		],
	});
};

const adjustVolume = async (player, delta) => {
	const vol = _functions.clamp(
		(player?.volume || 0) + delta,
		MIN_VOLUME,
		MAX_VOLUME,
	);
	await _functions.setPlayerVolume(player, vol);
	return {
		message: `${delta > 0 ? "🔊" : "🔉"} Volume set to ${vol}%`,
		shouldUpdate: true,
	};
};

const actionHandlers = {
	volume_down: (player) => adjustVolume(player, -VOLUME_STEP),
	volume_up: (player) => adjustVolume(player, VOLUME_STEP),

	previous: (player) => {
		if (!player?.previous)
			return { message: "❌ No previous track available", shouldUpdate: false };
		if (player.current)
			_functions.addToQueueFront(player.queue, player.current);
		_functions.addToQueueFront(player.queue, player.previous);
		player.stop?.();
		return { message: "⏮️ Playing the previous track.", shouldUpdate: false };
	},

	resume: (player) => {
		player.pause?.(false);
		return { message: "▶️ Resumed playback.", shouldUpdate: true };
	},

	pause: (player) => {
		player.pause?.(true);
		return { message: "⏸️ Paused playback.", shouldUpdate: true };
	},

	skip: (player) => {
		if (!_functions.getQueueLength(player?.queue))
			return {
				message: "❌ No tracks in queue to skip to.",
				shouldUpdate: false,
			};
		player.skip?.();
		return { message: "⏭️ Skipped to the next track.", shouldUpdate: false };
	},
};

const buildPlaylistPage = (playlist, playlistName, userId, page) => {
	const total = tracksCollection.count({ playlistId: playlist._id });
	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
	const currentPage = Math.min(Math.max(1, page || 1), totalPages);
	const startIdx = (currentPage - 1) * PAGE_SIZE;

	const tracks = getPlaylistTracks(playlist._id, {
		limit: PAGE_SIZE,
		skip: startIdx,
	});

	const embed = createEmbed("primary", `${ICONS.playlist} ${playlistName}`, "");
	embed.addFields(
		{
			name: `${ICONS.info} Info`,
			value: playlist?.description || "No description",
			inline: false,
		},
		{ name: `${ICONS.tracks} Tracks`, value: String(total), inline: true },
		{
			name: `${ICONS.duration} Duration`,
			value: formatDuration(playlist?.totalDuration || 0),
			inline: true,
		},
		{
			name: `${ICONS.info} Plays`,
			value: String(playlist?.playCount || 0),
			inline: true,
		},
	);

	if (tracks.length) {
		embed.addFields({
			name: `${ICONS.music} Tracks (Page ${currentPage}/${totalPages})`,
			value: tracks
				.map((t, i) => {
					const pos = String(startIdx + i + 1).padStart(2, "0");
					return `\`${pos}.\` **${t.title}**\n     ${ICONS.artist} ${t.author || "Unknown"} • ${ICONS.duration} ${formatDuration(t.duration || 0)} ${_functions.getSourceIcon(t.uri)}`;
				})
				.join("\n\n"),
			inline: false,
		});

		const firstVideoId = _functions.extractYouTubeId(tracks[0]?.uri);
		if (firstVideoId)
			embed.setThumbnail(
				`https://img.youtube.com/vi/${firstVideoId}/maxresdefault.jpg`,
			);
	}

	const components = [
		createButtons([
			{
				id: `play_playlist_${playlistName}_${userId}`,
				label: "Play",
				emoji: ICONS.play,
				style: 3,
			},
			{
				id: `shuffle_playlist_${playlistName}_${userId}`,
				label: "Shuffle",
				emoji: ICONS.shuffle,
				style: 1,
			},
		]),
	];

	if (totalPages > 1) {
		components.push(
			createButtons([
				{
					id: `playlist_prev_${currentPage}_${playlistName}_${userId}`,
					label: "Previous",
					emoji: "◀️",
					disabled: currentPage === 1,
				},
				{
					id: `playlist_next_${currentPage}_${playlistName}_${userId}`,
					label: "Next",
					emoji: "▶️",
					disabled: currentPage === totalPages,
				},
			]),
		);
	}

	return { embed, components };
};

const playlistActionHandlers = {
	play_playlist: async (interaction, client, userId, playlistName) => {
		const playlist = playlistsCollection.findOne({
			userId,
			name: playlistName,
		});
		if (!playlist)
			return { message: "❌ Playlist not found", shouldUpdate: false };

		const tracks = tracksCollection.find({ playlistId: playlist._id });
		if (!tracks.length)
			return { message: "❌ Playlist is empty", shouldUpdate: false };

		let voiceState = null;
		try {
			voiceState = await interaction.member?.voice();
		} catch {
			voiceState = null;
		}
		if (!voiceState?.channelId)
			return { message: "❌ Join a voice channel first", shouldUpdate: false };

		let player = client.aqua.players.get(interaction.guildId);
		player ??= client.aqua.createConnection({
			guildId: interaction.guildId,
			voiceChannel: voiceState.channelId,
			textChannel: interaction.channelId,
			defaultVolume: 65,
			deaf: true,
		});

		await _functions.resolveTracksAndEnqueue(
			tracks,
			(t) => client.aqua.resolve({ query: t.uri, requester: interaction.user }),
			(track) => player.queue.add(track),
			RESOLVE_CONCURRENCY,
		);

		playlistsCollection.update(
			{ _id: playlist._id },
			{
				playCount: (playlist.playCount || 0) + 1,
				lastPlayedAt: new Date().toISOString(),
			},
		);

		if (!player.playing && !player.paused && player.queue.size) player.play();
		return {
			message: `▶️ Playing playlist "${playlistName}" with ${tracks.length} tracks`,
			shouldUpdate: false,
		};
	},

	shuffle_playlist: async (interaction, client, userId, playlistName) => {
		const playlist = playlistsCollection.findOne({
			userId,
			name: playlistName,
		});
		if (!playlist)
			return { message: "❌ Playlist not found", shouldUpdate: false };

		// We don't shuffle in the DB anymore if we want to preserve order,
		// but the original code did a shuffle in DB.
		// In normalized schema, we should probably just shuffle the fetched array
		// OR add an 'order' column. For now, let's keep it simple:
		// Fetch all tracks, shuffle them, and play immediately.

		const tracks = tracksCollection.find({ playlistId: playlist._id });
		if (!tracks.length)
			return { message: "❌ Playlist is empty", shouldUpdate: false };

		let voiceState = null;
		try {
			voiceState = await interaction.member?.voice();
		} catch {
			voiceState = null;
		}
		if (!voiceState?.channelId)
			return { message: "❌ Join a voice channel first", shouldUpdate: false };

		let player = client.aqua.players.get(interaction.guildId);
		player ??= client.aqua.createConnection({
			guildId: interaction.guildId,
			voiceChannel: voiceState.channelId,
			textChannel: interaction.channelId,
			defaultVolume: 65,
			deaf: true,
		});

		const shuffled = shuffleArray([...tracks]);

		await _functions.resolveTracksAndEnqueue(
			shuffled,
			(t) => client.aqua.resolve({ query: t.uri, requester: interaction.user }),
			(track) => player.queue.add(track),
			RESOLVE_CONCURRENCY,
		);

		if (!player.playing && !player.paused && player.queue.size) player.play();
		return {
			message: `🔀 Playing shuffled playlist "${playlistName}"`,
			shouldUpdate: false,
		};
	},

	playlist_prev: async (interaction, _client, userId, playlistName, page) => {
		const playlist = playlistsCollection.findOne({
			userId,
			name: playlistName,
		});
		if (!playlist)
			return { message: "❌ Playlist not found", shouldUpdate: false };
		const { embed, components } = buildPlaylistPage(
			playlist,
			playlistName,
			userId,
			Math.max(1, (page || 1) - 1),
		);
		await interaction.editOrReply({ embeds: [embed], components });
		return { message: "", shouldUpdate: false };
	},

	playlist_next: async (interaction, _client, userId, playlistName, page) => {
		const playlist = playlistsCollection.findOne({
			userId,
			name: playlistName,
		});
		if (!playlist)
			return { message: "❌ Playlist not found", shouldUpdate: false };
		const { embed, components } = buildPlaylistPage(
			playlist,
			playlistName,
			userId,
			(page || 1) + 1,
		);
		await interaction.editOrReply({ embeds: [embed], components });
		return { message: "", shouldUpdate: false };
	},
};

export default createEvent({
	data: { name: "interactionCreate" },
	run: async (interaction, client) => {
		if (
			!interaction.isButton?.() ||
			!interaction.customId ||
			!interaction.guildId
		)
			return;
		if (interaction.customId.startsWith("ignore_")) return;

		const parsed = _functions.parsePlaylistButtonId(interaction.customId);
		if (parsed && playlistActionHandlers[parsed.action]) {
			if (parsed.userId !== interaction.user.id) return;
			if (!(await _functions.safeDefer(interaction))) return;
			try {
				const result = await playlistActionHandlers[parsed.action](
					interaction,
					client,
					parsed.userId,
					parsed.playlistName || "",
					parsed.page,
				);
				if (result && result.message)
					await _functions.safeFollowup(interaction, result.message);
			} catch (err) {
				console.error("Playlist button error:", err);
				_functions.safeReply(interaction, "❌ An error occurred.");
			}
			return;
		}

		if (!(await _functions.safeDefer(interaction))) return;

		const player = client.aqua?.players?.get?.(interaction.guildId);
		if (!player)
			return _functions.safeReply(
				interaction,
				"❌ There is no active music player in this server.",
			);
		if (!player.current)
			return _functions.safeReply(
				interaction,
				"❌ There is no music playing right now.",
			);

		const memberVoice = await interaction.member?.voice().catch(() => null);
		if (!memberVoice)
			return _functions.safeReply(
				interaction,
				"❌ You must be in a voice channel to use this button.",
			);
		if (interaction.user.id !== player.current.requester?.id)
			return _functions.safeReply(
				interaction,
				"❌ You are not allowed to use this button.",
			);

		const handler = actionHandlers[interaction.customId];
		if (!handler)
			return _functions.safeReply(
				interaction,
				"❌ This button action is not recognized.",
			);

		try {
			const result = await handler(player);
			await _functions.safeFollowup(interaction, result.message);
			if (result.shouldUpdate && player.current)
				queueMicrotask(() => _functions.updateNowPlayingEmbed(player, client));
		} catch (err) {
			console.error("Action button error:", err);
			_functions.safeReply(
				interaction,
				"❌ An error occurred. Please try again.",
			);
		}
	},
});

export const { formatTime, truncateText, getPlatform } = _functions;
