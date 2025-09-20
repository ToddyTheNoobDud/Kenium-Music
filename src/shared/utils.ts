import { ActionRow, Button, Embed } from "seyfert";
import { ButtonStyle } from "seyfert/lib/types";

import { COLORS, ICONS } from "./constants";

const MAX_AUTOCOMPLETE_OPTIONS = 25;
const MAX_EMBED_FIELDS = 25;
const MAX_BUTTONS_PER_ROW = 5;

const YOUTUBE_REGEX =
	/(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/;

const TITLE_ICONS = {
	primary: ICONS.music,
	success: "✨",
	error: "❌",
	warning: "⚠️",
	info: "ℹ️",
} as const;

export type EmbedField = { name: string; value: string; inline?: boolean };

export const createEmbed = (
	type: keyof typeof COLORS,
	title: string,
	description?: string,
	fields: Array<EmbedField> = [],
) => {
	const embed = new Embed()
		.setColor(COLORS[type])
		.setTitle(`${TITLE_ICONS[type]} ${title}`)
		.setTimestamp()
		.setFooter({
			text: `${ICONS.tracks} Kenium Music • Playlist System`,
			iconUrl:
				"https://toddythenoobdud.github.io/0a0f3c0476c8b495838fa6a94c7e88c2.png",
		});

	if (description) {
		embed.setDescription(`\`\`\`fix\n${description}\n\`\`\``);
	}

	if (fields.length > 0) {
		const clamped = fields.slice(0, MAX_EMBED_FIELDS).map((f) => ({
			name: f.name.length > 256 ? f.name.slice(0, 256) : f.name,
			value: f.value.length > 1024 ? f.value.slice(0, 1024) : f.value,
			inline: !!f.inline,
		}));
		embed.addFields(clamped);
	}

	return embed;
};

export const createButtons = (
	configs: Array<{
		id: string;
		label: string;
		emoji?: string;
		style?: ButtonStyle;
		disabled?: boolean;
	}>,
) => {
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

export const formatDuration = (ms: number): string => {
	if (!ms) return "00:00";
	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	return hours > 0
		? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
		: `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export const determineSource = (uri: string): string => {
	if (!uri) return "❓ Unknown";
	const s = uri.toLowerCase();
	if (s.includes("youtube.com") || s.includes("youtu.be"))
		return `${ICONS.youtube} YouTube`;
	if (s.includes("spotify.com")) return `${ICONS.spotify} Spotify`;
	if (s.includes("soundcloud.com")) return `${ICONS.soundcloud} SoundCloud`;
	return "🎵 Music";
};

export const extractYouTubeId = (url: string): string | null => {
	if (!url) return null;
	const match = YOUTUBE_REGEX.exec(url);
	return match?.[1] ?? null;
};

export const handlePlaylistAutocomplete = async (
	interaction: any,
	playlistsCollection: any,
) => {
	const userId = interaction.user?.id;
	const items = playlistsCollection.find({ userId }) || [];
	const options =
		items.length > 0
			? items.slice(0, MAX_AUTOCOMPLETE_OPTIONS).map((p: any) => ({
					name: String(p.name || "").slice(0, 100),
					value: String(p.name || ""),
				}))
			: [{ name: "No Playlists", value: "No Playlists" }];
	return interaction.respond(options);
};

export const handleTrackAutocomplete = async (interaction: any) => {
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
				? tracks.slice(0, MAX_AUTOCOMPLETE_OPTIONS).map((track: any) => {
						const title = String(track.title || track.uri || "Unknown").slice(
							0,
							100,
						);
						const uri = String(track.uri || "");
						return { name: title, value: uri };
					})
				: [{ name: "No Tracks Found", value: "no_tracks" }];

		return interaction.respond(options);
	} catch (_e) {
		return interaction.respond([
			{ name: "Search Error", value: "search_error" },
		]);
	}
};

export const handleTrackIndexAutocomplete = async (
	interaction: any,
	playlistsCollection: any,
) => {
	const userId = interaction.user?.id;
	const playlistName = interaction.options.getString("playlist");

	if (!playlistName) {
		return interaction.respond([{ name: "Select playlist first", value: "0" }]);
	}

	const playlist = playlistsCollection.findOne({ userId, name: playlistName });
	const tracks = playlist?.tracks || [];

	if (tracks.length === 0) {
		return interaction.respond([{ name: "No Tracks", value: "0" }]);
	}

	const options = tracks
		.slice(0, MAX_AUTOCOMPLETE_OPTIONS)
		.map((track: any, index: number) => ({
			name: `${index + 1}. ${String(track.title || "Untitled").slice(0, 80)}`,
			value: String(index + 1),
		}));

	return interaction.respond(options);
};

export const shuffleArray = <T>(array: T[]): T[] => {
	const shuffled = array.slice();
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const tmp = shuffled[i];
		shuffled[i] = shuffled[j];
		shuffled[j] = tmp;
	}
	return shuffled;
};
