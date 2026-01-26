// Optimized: Removed redundant color values, streamlined structure
const BASE_COLOR = 0x100e09;
const BASE_STYLE = 1;

const createPlatform = (name, source, emoji, icon) =>
	Object.freeze({
		name,
		source,
		color: BASE_COLOR,
		emoji,
		icon,
		style: BASE_STYLE,
	});

export const MUSIC_PLATFORMS = Object.freeze({
	youtube: createPlatform(
		"YouTube",
		"ytsearch",
		"<:youtube:1326295615017058304>",
		"📺",
	),
	soundcloud: createPlatform(
		"SoundCloud",
		"scsearch",
		"<:soundcloud:1326295646818406486>",
		"🎵",
	),
	spotify: createPlatform(
		"Spotify",
		"spsearch",
		"<:spotify:1326702792269893752>",
		"🎧",
	),
	deezer: createPlatform(
		"Deezer",
		"dzsearch",
		"<:Deezer_New_Icon:1398710505106964632>",
		"🎶",
	),
});

export const PLAYBACK_E = Object.freeze({
	volume_up: "🔊",
	volume_down: "🔉",
	mute: "🔇",
	unmute: "🔈",
	loop: "🔁",
	loop_one: "🔂",
	shuffle: "🔀",
	previous: "⏮️",
	resume: "▶️",
	pause: "⏸️",
	skip: "⏭️",
});
