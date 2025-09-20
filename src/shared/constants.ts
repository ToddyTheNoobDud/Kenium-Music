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
	primary: "#0x100e09",
	success: "#0x100e09",
	error: "#0x100e09",
	warning: "#0x100e09",
	info: "#0x100e09",
} as const;

export const LIMITS = {
	MAX_PLAYLISTS: 6,
	MAX_TRACKS: 60,
	MAX_NAME_LENGTH: 50,
	PAGE_SIZE: 8,
} as const;
