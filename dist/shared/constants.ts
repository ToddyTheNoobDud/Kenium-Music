export const ICONS = {
	music: "🎵",
	playlist: "🎧",
	add: "➕",
	tracks: "💿",
	info: "ℹ️",
	star: "⭐",
	play: "▶️",
	shuffle: "🔀",
	remove: "➖",
	artist: "🎤",
	source: "📡",
	duration: "⏱️",
	volume: "🔊",
	youtube: "🎥",
	spotify: "🟢",
	soundcloud: "🟠",
	export: "📤",
	import: "📥",
	delete: "🗑️",
} as const;

export const COLORS = {
	primary: "#000000",
	success: "#000000",
	error: "#000000",
	warning: "#000000",
	info: "#000000",
} as const;

export const LIMITS = {
	MAX_PLAYLISTS: 6,
	MAX_TRACKS: 60,
	MAX_NAME_LENGTH: 50,
	PAGE_SIZE: 8,
} as const;
