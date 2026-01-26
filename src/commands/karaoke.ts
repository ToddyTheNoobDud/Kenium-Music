import { Cooldown, CooldownType } from "@slipher/cooldown";
import {
	Command,
	type CommandContext,
	Declare,
	Embed,
	Middlewares,
	Container,
} from "seyfert";
import { lru } from "tiny-lru";
import { Musixmatch } from "../utils/musiclyrics";
import { getContextLanguage } from "../utils/i18n";

const MUSIXMATCH = new Musixmatch();

const EMBED_COLOR = 0x100e09;
const ERROR_COLOR = 0xe74c3c;

const SESSION_TIMEOUT_MS = 300000;
const SONG_END_BUFFER_MS = 5000;

const MAX_SESSIONS = 100;
const MAX_DRIFT_MS = 10000;

const MIN_EDIT_DELAY_MS = 150;
const MAX_EDIT_DELAY_MS = 2000;
const SCHEDULER_JITTER_MS = 25;

const VIEW_PAST_LINES = 2;
const VIEW_NEXT_LINES = 2;
const PROGRESS_BAR_LENGTH = 14;

type LyricLine = {
	line: string;
	timestamp?: number;
	range?: { start: number; end?: number };
};

interface KaraokeSession {
	message: any;
	lines: LyricLine[];
	player: any;

	updateTimer: NodeJS.Timeout;
	timeout: NodeJS.Timeout;

	fallbackStartPosition: number;
	fallbackStartTime: number;
	title: string;
}

const _createErrorEmbed = (
	message: string,
	lang: string,
	ctx: CommandContext,
) => {
	const t = ctx.t.get(lang);
	return new Embed()
		.setColor(ERROR_COLOR)
		.setTitle(t.karaoke.error)
		.setDescription(message);
};

const _formatTimestamp = (ms: number) => {
	const totalSeconds = Math.floor(ms / 1000);
	const mins = Math.floor(totalSeconds / 60);
	const secs = String(totalSeconds % 60).padStart(2, "0");
	return `${mins}:${secs}`;
};

const _lineStartMs = (line: LyricLine): number =>
	line.range?.start ?? line.timestamp ?? 0;

const _cleanLyricText = (text: string) => text.replace(/\s+/g, " ").trim();

const _findCurrentLineIndex = (lines: LyricLine[], currentTimeMs: number) => {
	let left = 0;
	let right = lines.length - 1;
	let result = -1;

	while (left <= right) {
		const mid = Math.floor((left + right) / 2);
		const ts = _lineStartMs(lines[mid]);

		if (ts <= currentTimeMs) {
			result = mid;
			left = mid + 1;
		} else {
			right = mid - 1;
		}
	}
	return result;
};

const _createProgressBar = (
	currentMs: number,
	startMs: number,
	endMs: number,
) => {
	const durationMs = endMs - startMs;
	if (durationMs <= 0) return `▰${"═".repeat(PROGRESS_BAR_LENGTH)}`;

	const elapsedMs = currentMs - startMs;
	const progress = Math.max(0, Math.min(1, elapsedMs / durationMs));
	const filled = Math.round(progress * PROGRESS_BAR_LENGTH);

	return `▰${"▰".repeat(filled)}${"═".repeat(PROGRESS_BAR_LENGTH - filled)}`;
};

const _formatViewportLine = (
	line: LyricLine,
	kind: "past" | "current" | "next",
) => {
	const time = _formatTimestamp(_lineStartMs(line));
	const text = _cleanLyricText(line.line) || "…";
	const base = `\`${time}\` ${text}`;

	if (kind === "current") return `> **${base}**`;
	if (kind === "past") return `*${base}*`;
	return base;
};

const _createKaraokeStageContainer = (
	title: string,
	lines: LyricLine[],
	currentTimeMs: number,
	isPaused: boolean,
) => {
	if (!lines.length) {
		return new Container({
			accent_color: EMBED_COLOR,
			components: [
				{ type: 10, content: `🎙️ **Karaoke Stage**` },
				{ type: 14, divider: true, spacing: 1 },
				{
					type: 10,
					content: `No time-synced lyrics available for this track.`,
				},
			],
		});
	}

	const currentIdx = _findCurrentLineIndex(lines, currentTimeMs);
	const safeIdx = Math.max(0, currentIdx);

	const current = lines[safeIdx];
	const next = lines[safeIdx + 1];

	const segStart = _lineStartMs(current);
	const segEnd = next ? _lineStartMs(next) : segStart + 4000;

	const status = isPaused ? "⏸ Paused" : "▶ Playing";
	const bar = _createProgressBar(currentTimeMs, segStart, segEnd);

	const pastStart = Math.max(0, safeIdx - VIEW_PAST_LINES);
	const past = lines.slice(pastStart, safeIdx);
	const upcoming = lines.slice(safeIdx + 1, safeIdx + 1 + VIEW_NEXT_LINES);

	const viewport = [
		...past.map((l) => _formatViewportLine(l, "past")),
		_formatViewportLine(current, "current"),
		...upcoming.map((l) => _formatViewportLine(l, "next")),
	].join("\n");

	return new Container({
		accent_color: EMBED_COLOR,
		components: [
			{
				type: 10,
				content: `🎙️ **Karaoke Stage**\n**${title}** • ${status}`,
			},
			{ type: 14, divider: true, spacing: 1 },
			{
				type: 10,
				content: `${bar}  \`${_formatTimestamp(currentTimeMs)}\``,
			},
			{ type: 14, divider: true, spacing: 1 },
			{ type: 10, content: viewport },
			{ type: 14, divider: true, spacing: 1 },
			{
				type: 10,
				content: `*Tip: the highlighted line is what you should sing right now.*`,
			},
		],
	});
};

const _fetchKaraokeLyrics = async (
	query: string | undefined,
	currentTrack: any,
) => {
	let searchQuery = query?.trim() ?? "";

	if (!searchQuery && currentTrack) {
		const title = (currentTrack.title ?? "").trim();
		const author = (currentTrack.author ?? "").trim();
		searchQuery = author ? `${title} ${author}`.trim() : title;
	}

	if (!searchQuery) return null;

	try {
		const result = await MUSIXMATCH.findLyrics(searchQuery);

		const rawLines = (result?.lines ?? []) as LyricLine[];
		const lines = rawLines
			.map((l) => ({ ...l, line: (l.line ?? "").toString() }))
			.filter((l) => _cleanLyricText(l.line).length > 0)
			.sort((a, b) => _lineStartMs(a) - _lineStartMs(b));

		if (!lines.length) return null;

		return { lines, track: result?.track };
	} catch {
		return null;
	}
};

class KaraokeSessionRegistry {
	private static cache = lru<KaraokeSession>(MAX_SESSIONS);

	static get(guildId: string) {
		return KaraokeSessionRegistry.cache.get(guildId);
	}

	static has(guildId: string) {
		const session = KaraokeSessionRegistry.cache.get(guildId);
		if (!session) return false;

		return session.player && session.player.connected;
	}

	static async add(guildId: string, session: KaraokeSession) {
		await KaraokeSessionRegistry.cleanup(guildId);
		KaraokeSessionRegistry.cache.set(guildId, session);
	}

	static async cleanup(guildId: string) {
		const session = KaraokeSessionRegistry.cache.get(guildId);
		if (!session) return;

		clearTimeout(session.updateTimer);
		clearTimeout(session.timeout);

		if (session.message?.delete) {
			await session.message.delete().catch(() => null);
		} else if (session.message?.edit) {
			await session.message
				.edit({
					embeds: [
						new Embed()
							.setColor(ERROR_COLOR)
							.setTitle("Karaoke session ended")
							.setDescription("The karaoke display has been closed."),
					],
					components: [],
				})
				.catch(() => null);
		}

		KaraokeSessionRegistry.cache.delete(guildId);
	}

	static async cleanupAll() {
		const keys = KaraokeSessionRegistry.cache.keys();
		for (const key of keys) {
			await KaraokeSessionRegistry.cleanup(key);
		}
		KaraokeSessionRegistry.cache.clear();
	}
}

@Cooldown({
	type: CooldownType.User,
	interval: 60000,
	uses: { default: 2 },
})
@Declare({
	name: "karaoke",
	description: "Start a karaoke session with synced lyrics",
})
@Middlewares(["cooldown", "checkPlayer", "checkVoice", "checkTrack"])
export default class KaraokeCommand extends Command {
	private _getCurrentTimeMs(session: KaraokeSession): number {
		const player = session.player;

		if (
			player?.position !== undefined &&
			player?.position !== null &&
			player?.timestamp !== undefined &&
			player?.timestamp !== null
		) {
			const driftMs = Date.now() - player.timestamp;

			if (driftMs >= 0 && driftMs < MAX_DRIFT_MS) {
				return player.position + driftMs;
			}
			return player.position;
		}

		if (player?.position !== undefined && player?.position !== null) {
			return player.position;
		}

		const elapsedMs = Date.now() - session.fallbackStartTime;
		return session.fallbackStartPosition + elapsedMs;
	}

	private _isPlayerPaused(player: any): boolean {
		return player?.paused === true || player?.playing === false;
	}

	private _computeNextEditDelayMs(
		session: KaraokeSession,
		currentTimeMs: number,
		isPaused: boolean,
	) {
		if (isPaused) return 1500;

		const lines = session.lines;
		if (!lines.length) return 1000;

		const idx = _findCurrentLineIndex(lines, currentTimeMs);
		const safeIdx = Math.max(0, idx);

		const current = lines[safeIdx];
		const next = lines[safeIdx + 1];

		const segStart = _lineStartMs(current);
		const segEnd = next ? _lineStartMs(next) : segStart + 4000;

		const duration = segEnd - segStart;
		if (duration <= 0) return 500;

		const rawProgress = (currentTimeMs - segStart) / duration;
		const progress = Math.max(0, Math.min(0.999999, rawProgress));

		const bucket = Math.floor(progress * PROGRESS_BAR_LENGTH);
		const nextBucket = Math.min(PROGRESS_BAR_LENGTH, bucket + 1);

		const nextBucketTime =
			segStart + (nextBucket / PROGRESS_BAR_LENGTH) * duration;
		const nextLineTime = segEnd;

		const nextEventTime = Math.min(nextBucketTime, nextLineTime);

		let delay = nextEventTime - currentTimeMs + SCHEDULER_JITTER_MS;
		if (!Number.isFinite(delay)) delay = 1000;

		delay = Math.max(MIN_EDIT_DELAY_MS, Math.min(MAX_EDIT_DELAY_MS, delay));
		return delay;
	}

	private _scheduleNextTick(guildId: string, delayMs: number) {
		const session = KaraokeSessionRegistry.get(guildId);
		if (!session) return;

		clearTimeout(session.updateTimer);

		session.updateTimer = setTimeout(() => {
			this._tick(guildId).catch(() => KaraokeSessionRegistry.cleanup(guildId));
		}, delayMs);

		if (session.updateTimer.unref) session.updateTimer.unref();
	}

	private async _tick(guildId: string) {
		const session = KaraokeSessionRegistry.get(guildId);
		if (!session) return;

		if (!KaraokeSessionRegistry.has(guildId)) {
			await KaraokeSessionRegistry.cleanup(guildId);
			return;
		}

		const currentTimeMs = this._getCurrentTimeMs(session);
		const isPaused = this._isPlayerPaused(session.player);

		const lastLine = session.lines[session.lines.length - 1];
		const lastTimestampMs = lastLine ? _lineStartMs(lastLine) : 0;

		if (currentTimeMs > lastTimestampMs + SONG_END_BUFFER_MS) {
			await KaraokeSessionRegistry.cleanup(guildId);
			return;
		}

		const container = _createKaraokeStageContainer(
			session.title,
			session.lines,
			currentTimeMs,
			isPaused,
		);

		const edited = await session.message
			.edit({ components: [container] })
			.then(() => true)
			.catch(() => false);

		if (!edited) {
			await KaraokeSessionRegistry.cleanup(guildId);
			return;
		}

		const delay = this._computeNextEditDelayMs(
			session,
			currentTimeMs,
			isPaused,
		);
		this._scheduleNextTick(guildId, delay);
	}

	public override async run(ctx: CommandContext): Promise<void> {
		await ctx.deferReply();

		const lang = getContextLanguage(ctx);
		const t = ctx.t.get(lang);

		const player = ctx.client.aqua.players.get(ctx.guildId);
		if (!player) {
			await ctx.editOrReply({
				embeds: [_createErrorEmbed(t.karaoke.noActivePlayer, lang, ctx)],
			});
			return;
		}

		if (KaraokeSessionRegistry.has(ctx.guildId)) {
			await ctx.editOrReply({
				embeds: [_createErrorEmbed(t.karaoke.sessionAlreadyActive, lang, ctx)],
			});
			return;
		}

		await KaraokeSessionRegistry.cleanup(ctx.guildId);

		const result = await _fetchKaraokeLyrics(undefined, player.current);
		if (!result) {
			await ctx.editOrReply({
				embeds: [_createErrorEmbed(t.karaoke.noLyricsAvailable, lang, ctx)],
			});
			return;
		}

		const title = player.current?.title ?? "Karaoke";
		const initialPosition = player.position ?? 0;
		const isPaused = this._isPlayerPaused(player);

		const container = _createKaraokeStageContainer(
			title,
			result.lines,
			initialPosition,
			isPaused,
		);

		const message = await ctx.editOrReply({
			components: [container],
			flags: 32768,
		});
		if (!message) return;

		const timeout = setTimeout(() => {
			KaraokeSessionRegistry.cleanup(ctx.guildId);
		}, SESSION_TIMEOUT_MS);
		if (timeout.unref) timeout.unref();

		const updateTimer = setTimeout(() => {}, 0);
		if (updateTimer.unref) updateTimer.unref();

		await KaraokeSessionRegistry.add(ctx.guildId, {
			message,
			lines: result.lines,
			player,
			updateTimer,
			timeout,
			fallbackStartPosition: initialPosition,
			fallbackStartTime: Date.now(),
			title,
		});

		this._scheduleNextTick(ctx.guildId, 0);
	}
}

export const cleanupKaraokeSession = async (guildId: string) => {
	await KaraokeSessionRegistry.cleanup(guildId);
};

export const hasKaraokeSession = (guildId: string) => {
	return KaraokeSessionRegistry.has(guildId);
};

export const cleanupAllKaraokeSessions = async () => {
	await KaraokeSessionRegistry.cleanupAll();
};
