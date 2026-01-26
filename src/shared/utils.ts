import { ActionRow, Button, Embed } from "seyfert";
import { ButtonStyle } from "seyfert/lib/types";
import { COLORS, ICONS } from "./constants";
import { getTracksCollection } from "../utils/db";

// ... (rest of the imports/constants)

// Constants
const MAX_AUTOCOMPLETE_OPTIONS = 25;
const MAX_EMBED_FIELDS = 25;
const MAX_BUTTONS_PER_ROW = 5;

// Pre-compiled regex patterns for better performance
const YT_REGEX =
	/(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/;
const PLATFORM_REGEX = /youtube\.com|youtu\.be|spotify\.com|soundcloud\.com/i;

// Lookup tables for O(1) access
const TITLE_ICONS = Object.freeze({
	primary: ICONS.music,
	success: "✨",
	error: "❌",
	warning: "⚠️",
	info: "ℹ️",
});

const PLATFORM_ICONS = Object.freeze({
	youtube: ICONS.youtube,
	spotify: ICONS.spotify,
	soundcloud: ICONS.soundcloud,
});

export const _functions = {
	formatSeconds: (totalSeconds) => {
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;
		return hours > 0
			? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
			: `${minutes}:${String(seconds).padStart(2, "0")}`;
	},

	clampField: (text, maxLen) => {
		const str = String(text);
		return str.length > maxLen ? str.slice(0, maxLen) : str;
	},

	getPlatformFromUri: (uri) => {
		if (!uri) return "Music";
		const lower = uri.toLowerCase();
		if (lower.includes("youtu")) return `${ICONS.youtube} YouTube`;
		if (lower.includes("spotify")) return `${ICONS.spotify} Spotify`;
		if (lower.includes("soundcloud")) return `${ICONS.soundcloud} SoundCloud`;
		return "🎵 Music";
	},
};

export const createEmbed = (type, title, description, fields = []) => {
	const embed = new Embed()
		.setColor(COLORS[type])
		.setTitle(`${TITLE_ICONS[type]} ${title}`)
		.setTimestamp()
		.setFooter({
			text: `${ICONS.tracks} Kenium Music • Playlist System`,
			iconUrl:
				"https://toddythenoobdud.github.io/0a0f3c0476c8b495838fa6a94c7e88c2.png",
		});

	if (description) embed.setDescription(`\`\`\`fix\n${description}\n\`\`\``);

	if (fields.length > 0) {
		const clamped = fields.slice(0, MAX_EMBED_FIELDS).map((f) => ({
			name: _functions.clampField(f.name, 256),
			value: _functions.clampField(f.value, 1024),
			inline: Boolean(f.inline),
		}));
		embed.addFields(clamped);
	}

	return embed;
};

export const createButtons = (configs) => {
	const row = new ActionRow();
	const limit = Math.min(configs.length, MAX_BUTTONS_PER_ROW);

	for (let i = 0; i < limit; i++) {
		const c = configs[i];
		const button = new Button()
			.setCustomId(c.id)
			.setLabel(c.label)
			.setStyle(c.style ?? ButtonStyle.Secondary);

		if (c.emoji) button.setEmoji(c.emoji);
		if (c.disabled) button.setDisabled(true);
		row.addComponents(button);
	}

	return row;
};

// Optimized: Direct calculation without intermediate variable
export const formatDuration = (ms) => {
	if (!ms) return "00:00";
	return _functions.formatSeconds(Math.floor(ms / 1000));
};

export const determineSource = (uri) => {
	if (!uri) return "❓ Unknown";
	return _functions.getPlatformFromUri(uri);
};

// Optimized: Reuse pre-compiled regex
export const extractYouTubeId = (url) => {
	if (!url) return null;
	const match = YT_REGEX.exec(url);
	return match?.[1] ?? null;
};

export const handlePlaylistAutocomplete = async (
	interaction,
	playlistsCollection,
) => {
	const items =
		playlistsCollection.find({ userId: interaction.user?.id }) || [];
	const options =
		items.length > 0
			? items.slice(0, MAX_AUTOCOMPLETE_OPTIONS).map((p) => ({
					name: String(p.name || "").slice(0, 100),
					value: String(p.name || ""),
				}))
			: [{ name: "No Playlists", value: "No Playlists" }];

	return interaction.respond(options);
};

export const handleTrackAutocomplete = async (interaction) => {
	try {
		const raw = interaction.getInput?.();
		const query =
			typeof raw === "string" ? raw.trim() : String(raw || "").trim();

		if (!query) {
			return interaction.respond([
				{ name: "Start typing to search...", value: "empty" },
			]);
		}

		const res = await interaction.client.aqua.resolve({
			query,
			requester: interaction.user,
		});
		const tracks = Array.isArray(res?.tracks) ? res.tracks : [];
		const options =
			tracks.length > 0
				? tracks.slice(0, MAX_AUTOCOMPLETE_OPTIONS).map((track) => ({
						name: String(track.title || track.uri || "Unknown").slice(0, 100),
						value: String(track.uri || ""),
					}))
				: [{ name: "No Tracks Found", value: "no_tracks" }];

		return interaction.respond(options);
	} catch {
		return interaction.respond([
			{ name: "Search Error", value: "search_error" },
		]);
	}
};

export const handleTrackIndexAutocomplete = async (
	interaction,
	playlistsCollection,
) => {
	const playlistName = interaction.options.getString("playlist");
	if (!playlistName) {
		return interaction.respond([{ name: "Select playlist first", value: "0" }]);
	}

	const playlist = playlistsCollection.findOne({
		userId: interaction.user?.id,
		name: playlistName,
	});

	if (!playlist) {
		return interaction.respond([{ name: "Playlist not found", value: "0" }]);
	}

	const tracks = getTracksCollection().find(
		{ playlistId: playlist._id },
		{ limit: MAX_AUTOCOMPLETE_OPTIONS },
	);

	if (tracks.length === 0) {
		return interaction.respond([{ name: "No Tracks", value: "0" }]);
	}

	const options = tracks.map((track, index) => ({
		name: `${index + 1}. ${String(track.title || "Untitled").slice(0, 80)}`,
		value: String(index + 1),
	}));

	return interaction.respond(options);
};

// Optimized: Fisher-Yates shuffle with single swap
export const shuffleArray = (array) => {
	const shuffled = [...array];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}
	return shuffled;
};
