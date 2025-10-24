import { Cooldown, CooldownType } from '@slipher/cooldown';
import {
  Command,
  type CommandContext,
  createStringOption,
  Declare,
  Embed,
  Middlewares,
  Options,
  Container
} from 'seyfert';
import { lru } from 'tiny-lru';
import { Musixmatch } from '../utils/musiclyrics';
import { getContextLanguage } from '../utils/i18n';

// Constants
const MUSIXMATCH = new Musixmatch();
const EMBED_COLOR = 0x100e09;
const ERROR_COLOR = 0xe74c3c;
const UPDATE_INTERVAL_MS = 1000;
const SESSION_TIMEOUT_MS = 300000;
const CONTEXT_LINES = 2;
const PROGRESS_BAR_LENGTH = 10;
const SONG_END_BUFFER_MS = 5000;
const MAX_SESSIONS = 100;
const MAX_DRIFT_MS = 10000;

// Helper functions
const _createErrorEmbed = (message: string, lang: string, ctx: CommandContext) => {
  const t = ctx.t.get(lang);
  return new Embed()
    .setColor(ERROR_COLOR)
    .setTitle(t.karaoke.error)
    .setDescription(message);
};

const _formatTimestamp = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = String(totalSeconds % 60).padStart(2, '0');
  return `${mins}:${secs}`;
};

const _findCurrentLineIndex = (lines: any[], currentTimeMs: number) => {
  let left = 0;
  let right = lines.length - 1;
  let result = -1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const timestampMs = lines[mid].range?.start ?? lines[mid].timestamp ?? 0;

    if (timestampMs <= currentTimeMs) {
      result = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return result;
};

const _formatLine = (line: any, timestampMs: number, isCurrent: boolean, isPast: boolean) => {
  const time = _formatTimestamp(timestampMs);
  const text = line.line.trim();

  if (isCurrent) return `**[${time}] ${text}**`;
  if (isPast) return `✅ ~~[${time}] ${text}~~`;
  return `⏸️ [${time}] ${text}`;
};

const _createProgressBar = (currentMs: number, startMs: number, endMs: number) => {
  const durationMs = endMs - startMs;
  if (durationMs <= 0) return '🔴──────────';

  const elapsedMs = currentMs - startMs;
  const progress = Math.max(0, Math.min(1, elapsedMs / durationMs));
  const filled = Math.round(progress * PROGRESS_BAR_LENGTH);
  // ■■■■■■■■■▢ 90%
  // [̲̅_̲̅_̲̅_̲̅_̲̅_̲̅] 10%
  // ╞▰═════════╡ 10%
  // https://copy-paste.net/en/loading-bar.php js saving lmao
  return `🔴${'▰'.repeat(filled)}${'═'.repeat(PROGRESS_BAR_LENGTH - filled)}`;
};

const _createKaraokeContainer = (title: string, lines: any[], currentTimeMs: number, isPaused: boolean) => {
  const currentIdx = _findCurrentLineIndex(lines, currentTimeMs);

  // Get current line for header
  const currentLine = lines[currentIdx];
  const currentLineText = currentLine ? _formatLine(currentLine, currentLine.range?.start ?? currentLine.timestamp ?? 0, true, false) : 'No lyrics available';

  // Get upcoming lines (next 2 lines after current)
  const upcomingLines = [];
  for (let i = 1; i <= CONTEXT_LINES && currentIdx + i < lines.length; i++) {
    const line = lines[currentIdx + i];
    const timestampMs = line.range?.start ?? line.timestamp ?? 0;
    upcomingLines.push(_formatLine(line, timestampMs, false, false));
  }

  const statusIcon = isPaused ? '⏸️' : '▶️';
  const statusText = isPaused ? 'Paused' : 'Playing';

  // Get past lines that update dynamically based on current position
  const pastLinesStart = Math.max(0, currentIdx - 2);
  const pastLines = lines.slice(pastLinesStart, currentIdx);

  const components = [
    {
      type: 10,
      content: `**${title}** • ${statusIcon} ${statusText} • ${_formatTimestamp(currentTimeMs)}`
    },
    // Divider
    { type: 14, divider: true, spacing: 2 },
  ];

  // Add past lines if they exist and update dynamically
  if (pastLines.length > 0) {
    components.push(
      // Past lines
      { type: 10, content: pastLines.map((line) => _formatLine(line, line.range?.start ?? line.timestamp ?? 0, false, true)).join('\n') },
      // Divider
      { type: 14, divider: true, spacing: 2 }
    );
  }

  components.push(
    // Header - Current lyrics line (h1 style)
    { type: 10, content: `### ${currentLineText}` },
    // Divider
    { type: 14, divider: true, spacing: 2 }
  );

  // Add upcoming lines if any
  if (upcomingLines.length > 0) {
    components.push({ type: 10, content: upcomingLines.join('\n') });
    // Another divider before footer
    components.push({ type: 14, divider: true, spacing: 1 });
  }

  return new Container({
    components,
    accent_color: EMBED_COLOR,
  });
};

const _createKaraokeEmbed = (title: string, lines: any[], currentTimeMs: number, isPaused: boolean) => {
  const currentIdx = _findCurrentLineIndex(lines, currentTimeMs);
  const startIdx = Math.max(0, currentIdx - CONTEXT_LINES);
  const endIdx = Math.min(lines.length, currentIdx + CONTEXT_LINES + 1);

  const visibleLines = lines.slice(startIdx, endIdx);
  const formatted = visibleLines.map((line, idx) => {
    const timestampMs = line.range?.start ?? line.timestamp ?? 0;
    const actualIdx = startIdx + idx;
    return _formatLine(line, timestampMs, actualIdx === currentIdx, actualIdx < currentIdx);
  });

  let description = formatted.join('\n');



  const statusIcon = isPaused ? '⏸️' : '▶️';
  const statusText = isPaused ? 'Paused' : 'Playing';

  return new Embed()
    .setColor(EMBED_COLOR)
    .setTitle(`🎤 ${title}`)
    .setDescription(description)
    .setFooter({ text: `${statusIcon} ${statusText} • ${_formatTimestamp(currentTimeMs)}` });
};

const _fetchKaraokeLyrics = async (query: string, currentTrack: any) => {
  let searchQuery = query;


  if (!searchQuery && currentTrack) {
    const title = currentTrack.title ?? '';
    const author = currentTrack.author ?? '';
    searchQuery = `${title} ${author}`.trim();
  }

  if (!searchQuery && currentTrack) {
    searchQuery = currentTrack.title ?? '';
  }


  if (!searchQuery) return null;

  try {
    const result = await MUSIXMATCH.findLyrics(searchQuery);
    if (!result?.text && !result?.lines) return null;

    return {
      lines: result.lines,
      track: result.track,
    };
  } catch {
    return null;
  }
};

interface KaraokeSession {
  message: any;
  lines: any[];
  player: any;
  interval: NodeJS.Timeout;
  timeout: NodeJS.Timeout;
  fallbackStartPosition: number;
  fallbackStartTime: number;
  title: string;
}

class KaraokeSessionRegistry {
  private static cache = lru<KaraokeSession>(MAX_SESSIONS);

  static add(guildId: string, session: KaraokeSession) {
    this.cleanup(guildId);
    this.cache.set(guildId, session);
  }

  static get(guildId: string) {
    return this.cache.get(guildId);
  }

  static async cleanup(guildId: string) {
    const session = this.cache.get(guildId);
    if (!session) return;

    clearInterval(session.interval);
    clearTimeout(session.timeout);

    if (session.message?.delete) {
      await session.message.delete().catch(() => null);
    } else if (session.message?.edit) {
      // For cleanup, we don't have context, so use a simple embed
      await session.message.edit({
        embeds: [new Embed()
          .setColor(ERROR_COLOR)
          .setTitle('Karaoke Error')
          .setDescription('Karaoke session ended')],
        components: []
      }).catch(() => null);
    }

    this.cache.delete(guildId);
  }

  static has(guildId: string) {
    const session = this.cache.get(guildId);
    if (!session) return false;

    // Check if player still exists and is connected
    return session.player && session.player.connected;
  }

  static async cleanupAll() {
    const keys = this.cache.keys();
    for (const key of keys) {
      await this.cleanup(key);
    }
    this.cache.clear();
  }
}

@Cooldown({
  type: CooldownType.User,
  interval: 60000,
  uses: { default: 2 }
})

@Declare({
  name: 'karaoke',
  description: 'Start a karaoke session with synced lyrics'
})
@Middlewares(['cooldown', 'checkPlayer', 'checkVoice', 'checkTrack'])
export default class KaraokeCommand extends Command {
  private _getCurrentTimeMs(session: KaraokeSession): number {
    const player = session.player;
    if (player?.position !== undefined && player?.position !== null && player?.timestamp !== undefined && player?.timestamp !== null) {
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

  private async _updateDisplay(guildId: string) {
    const session = KaraokeSessionRegistry.get(guildId);
    if (!session) return;
    if (!KaraokeSessionRegistry.has(guildId)) return await KaraokeSessionRegistry.cleanup(guildId);

    const currentTimeMs = this._getCurrentTimeMs(session);
    const isPaused = this._isPlayerPaused(session.player);

    // Check if song has ended
    const lastLine = session.lines[session.lines.length - 1];
    const lastTimestampMs = lastLine?.range?.start ?? lastLine?.timestamp ?? 0;

    if (currentTimeMs > lastTimestampMs + SONG_END_BUFFER_MS) {
      await KaraokeSessionRegistry.cleanup(guildId);
      return;
    }

    const container = _createKaraokeContainer(session.title, session.lines, currentTimeMs, isPaused);

    await session.message.edit({ components: [container] }).catch(async () => {
      await KaraokeSessionRegistry.cleanup(guildId);
    });
  }

  public override async run(ctx: CommandContext): Promise<void> {
    await ctx.deferReply();

    const lang = getContextLanguage(ctx);
    const t = ctx.t.get(lang);

    const player = ctx.client.aqua.players.get(ctx.guildId);
    if (!player) {
      await ctx.editOrReply({ embeds: [_createErrorEmbed(t.karaoke.noActivePlayer, lang, ctx)] });
      return;
    }

    // Check if there's already an active karaoke session
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
        embeds: [_createErrorEmbed(t.karaoke.noLyricsAvailable, lang, ctx)]
      });
      return;
    }

    const title = player.current?.title ?? 'Karaoke';
    const initialPosition = player.position ?? 0;
    const isPaused = this._isPlayerPaused(player);
    const container = _createKaraokeContainer(title, result.lines, initialPosition, isPaused);

    const message = await ctx.editOrReply({ components: [container], flags: 32768 });
    if (!message) return;

    const interval = setInterval(() => {
      this._updateDisplay(ctx.guildId);
    }, UPDATE_INTERVAL_MS);

    const timeout = setTimeout(() => {
      KaraokeSessionRegistry.cleanup(ctx.guildId);
    }, SESSION_TIMEOUT_MS);

    KaraokeSessionRegistry.add(ctx.guildId, {
      message,
      lines: result.lines,
      player,
      interval,
      timeout,
      fallbackStartPosition: initialPosition,
      fallbackStartTime: Date.now(),
      title
    });
  }
}

// Export cleanup functions
export const cleanupKaraokeSession = async (guildId: string) => {
  await KaraokeSessionRegistry.cleanup(guildId);
};

export const hasKaraokeSession = (guildId: string) => {
  return KaraokeSessionRegistry.has(guildId);
};

export const cleanupAllKaraokeSessions = async () => {
  await KaraokeSessionRegistry.cleanupAll();
};
