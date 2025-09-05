import {
    Command,
    Declare,
    type CommandContext,
    Embed,
    Middlewares,
    Container,
    ActionRow
} from 'seyfert';
import { CooldownType, Cooldown } from '@slipher/cooldown';

const TRACKS_PER_PAGE = 5;
const MAX_DURATION_CACHE = 1000;
const EPHEMERAL_FLAG = 64 | 32768 as const;

const durationCache: Map<number, string> = new Map();
const queueViewState = new Map<
    string,
    { page: number; maxPages: number; totalMs: number }
>();

function pad(n: number) {
    return n < 10 ? `0${n}` : `${n}`;
}
function formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return '0:00';
    const cached = durationCache.get(ms);
    if (cached) return cached;

    const totalSeconds = (ms / 1000) | 0;
    const hours = (totalSeconds / 3600) | 0;
    const minutes = ((totalSeconds % 3600) / 60) | 0;
    const seconds = totalSeconds % 60;

    const formatted =
        hours > 0
            ? `${hours}:${pad(minutes)}:${pad(seconds)}`
            : `${minutes}:${pad(seconds)}`;

    if (durationCache.size < MAX_DURATION_CACHE) {
        durationCache.set(ms, formatted);
    }
    return formatted;
}

function truncate(text: string, max: number): string {
    if (!text) return '';
    if (text.length <= max) return text;
    return text.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

function calcPagination(queueLength: number, page: number) {
    const maxPages = Math.max(1, Math.ceil(queueLength / TRACKS_PER_PAGE));
    const validPage = Math.min(Math.max(1, page), maxPages);
    const startIndex = (validPage - 1) * TRACKS_PER_PAGE;
    const endIndex = Math.min(startIndex + TRACKS_PER_PAGE, queueLength);
    return { validPage, maxPages, startIndex, endIndex };
}


function createProgressBar(current: number, total: number, size = 18): string {
    if (!total || total <= 0) return '🔴 LIVE';
    const ratio = Math.min(Math.max(current / total, 0), 1);
    const knobPos = Math.round(ratio * (size - 1));
    let bar = '';
    for (let i = 0; i < size; i++) bar += i === knobPos ? '●' : '─';
    return bar;
}

// ---------- UI Components ----------
const createButtonRows = (
    page: number,
    maxPages: number,
    opts: { paused: boolean; loop: boolean; shuffle: boolean }
) => {
    const isFirstPage = page <= 1;
    const isLastPage = page >= maxPages;

    return [
        {
            type: 1,
            components: [
                {
                    type: 2,
                    style: 2,
                    emoji: { name: '⏮️' },
                    custom_id: 'queue_first',
                    disabled: isFirstPage,
                },
                {
                    type: 2,
                    style: 2,
                    emoji: { name: '◀️' },
                    custom_id: 'queue_prev',
                    disabled: isFirstPage,
                },
                {
                    type: 2,
                    style: 1, // primary
                    emoji: { name: opts.paused ? '▶️' : '⏸️' },
                    custom_id: 'queue_playpause',
                    label: opts.paused ? 'Resume' : 'Pause',
                },
                {
                    type: 2,
                    style: 2,
                    emoji: { name: '▶️' },
                    custom_id: 'queue_next',
                    disabled: isLastPage,
                },
                {
                    type: 2,
                    style: 2,
                    emoji: { name: '⏭️' },
                    custom_id: 'queue_last',
                    disabled: isLastPage,
                },
            ],
        },
        {
            type: 1,
            components: [
                {
                    type: 2,
                    style: opts.shuffle ? 3 : 2, // success if active
                    emoji: { name: '🔀' },
                    custom_id: 'queue_shuffle',
                    label: opts.shuffle ? 'Shuffle: On' : 'Shuffle: Off',
                },
                {
                    type: 2,
                    style: opts.loop ? 3 : 2, // success if active
                    emoji: { name: '🔁' },
                    custom_id: 'queue_loop',
                    label: opts.loop ? 'Loop: On' : 'Loop: Off',
                },
                {
                    type: 2,
                    style: 1, // primary
                    emoji: { name: '🔄' },
                    custom_id: 'queue_refresh',
                    label: 'Refresh',
                },
                {
                    type: 2,
                    style: 4, // danger
                    emoji: { name: '🗑️' },
                    custom_id: 'queue_clear',
                    label: 'Clear',
                },
            ],
        },
    ];
};

// ---------- Container Builder ----------
function createQueueContainer(
    player: any,
    page: number,
    precomputedTotalMs?: number
): Container {
    const queueLength = player.queue.length;
    const { validPage, maxPages, startIndex, endIndex } = calcPagination(
        queueLength,
        page
    );

    const currentTrack = player.current;
    const queueSlice = player.queue.slice(startIndex, endIndex);

    const components: any[] = [
        { type: 10, content: `**Queue • Page ${validPage}/${maxPages}**` },
        { type: 14, divider: true, spacing: 1 }
    ];

    if (currentTrack) {
        const title = truncate(currentTrack.info?.title ?? 'Unknown title', 60);
        const artist = truncate(
            currentTrack.info?.author ?? 'Unknown artist',
            40
        );
        const lengthMs = currentTrack.info?.length ?? 0;
        const posMs = player.position ?? 0;

        const bar = createProgressBar(posMs, lengthMs);
        const pct = lengthMs > 0 ? Math.round((posMs / lengthMs) * 100) : 0;
        const requester = currentTrack.requester?.id
            ? ` • 👤 <@${currentTrack.requester.id}>`
            : '';

        const nowPlayingContent = [
            `## 🎵 Now Playing`,
            `**[${title}](${currentTrack.info?.uri ?? '#'})**`,
            `by ${artist}${requester}`,
            '',
            `${bar}  **${pct}%**`,
            `\`${formatDuration(posMs)}\` / \`${formatDuration(lengthMs)}\``
        ].join('\n');

        components.push({
            type: 9,
            components: [
                { type: 10, content: nowPlayingContent }
            ],
            accessory: currentTrack?.info?.artworkUrl || currentTrack?.thumbnail ? {
                type: 11,
                media: { url: currentTrack.info?.artworkUrl ?? currentTrack.thumbnail }
            } : undefined
        });
    }

    if (queueLength > 0) {
        const lines: string[] = [];
        for (let i = 0; i < queueSlice.length; i++) {
            const track = queueSlice[i];
            const num = startIndex + i + 1;
            const title = truncate(track?.info?.title ?? 'Unknown', 52);
            const uri = track?.info?.uri ?? '#';

            lines.push(`• \`${num}.\` [\`${title}\`](${uri})`);
        }

        const comingUpTitle = `📋 Coming Up${
            queueLength > TRACKS_PER_PAGE
                ? ` (${startIndex + 1}-${endIndex} of ${queueLength})`
                : ''
        }`;

        components.push(
            { type: 14, divider: true, spacing: 1 },
            { type: 10, content: `**${comingUpTitle}**` },
            { type: 10, content: lines.join('\n') || '*No tracks queued*' }
        );
    }

    // Add buttons to the container
    const buttonRows = createButtonRows(page, maxPages, {
        paused: !!player.paused,
        loop: !!player.loop,
        shuffle: !!player.shuffle,
    });

    components.push(
        { type: 14, divider: true, spacing: 2 },
        ...buttonRows
    );

    return new Container({ components });
}

// ---------- Interaction Handlers ----------
// Fixed handleQueueNavigation function
async function handleQueueNavigation(
    interaction: any,
    player: any,
    action: string
): Promise<void> {
    try {
        await interaction.deferUpdate();

        const messageId = interaction?.message?.id;
        const state = messageId ? queueViewState.get(messageId) : undefined;
        if (!state) return;

        let newPage = state.page;

        switch (action) {
            case 'queue_first':
                newPage = 1;
                break;
            case 'queue_prev':
                newPage = Math.max(1, state.page - 1);
                break;
            case 'queue_next': {
                const { maxPages } = calcPagination(
                    player.queue.length,
                    state.page
                );
                newPage = Math.min(maxPages, state.page + 1);
                break;
            }
            case 'queue_last': {
                const { maxPages } = calcPagination(
                    player.queue.length,
                    state.page
                );
                newPage = maxPages;
                break;
            }
            case 'queue_refresh':
                // No-op: rebuild UI
                break;
            case 'queue_playpause':
                if (player.paused) await player.pause(false);
                else await player.pause(true);
                break;
            case 'queue_shuffle': {
                // Call the shuffle method to shuffle the queue
                player.shuffle();
                newPage = 1; // reset to start after shuffle
                break;
            }
            case 'queue_loop': {
                // Toggle loop mode using setLoop method
                const currentLoop = player.loop || 0;
                const newLoop = currentLoop === 0 ? 1 : 0; // Toggle between NONE (0) and TRACK (1)
                player.setLoop(newLoop);
                break;
            }
            case 'queue_clear':
                // Clear the queue
                player.queue.clear();
                newPage = 1;
                break;
            default:
                return;
        }

        // Recompute totals and pagination after potential mutations
        const totalMs = player.queue.toArray().reduce(
            (total: number, track: any) => total + (track?.info?.length ?? 0),
            0
        );
        const queueLength = player.queue.size || player.queue.length || 0;
        const { maxPages } = calcPagination(queueLength, newPage);
        newPage = Math.min(newPage, maxPages);

        queueViewState.set(messageId!, { page: newPage, maxPages, totalMs });

        const container = createQueueContainer(player, newPage, totalMs);

        await interaction.editOrReply({
            components: [container],
            flags: EPHEMERAL_FLAG,
        });
    } catch (err) {
        console.error('Navigation error:', err);
    }
}

// ---------- Main Queue Display ----------
async function handleShowQueue(
    ctx: CommandContext,
    player: any
): Promise<void> {
    const queueLength = player.queue.length;

    if (queueLength === 0 && !player.current) {
        const emptyContainer = new Container({
            components: [
                { type: 10, content: '**Queue Empty**' },
                { type: 14, divider: true, spacing: 1 },
                { type: 10, content: '📭 **No tracks in queue**\n\nUse `/play` to add some music!' },
                { type: 14, divider: true, spacing: 1 },
                { type: 10, content: '*Tip: You can search or use URLs*' }
            ]
        });

        await ctx.write({ components: [emptyContainer], flags: EPHEMERAL_FLAG });
        return;
    }

    const totalMs = player.queue.reduce(
        (total: number, track: any) => total + (track?.info?.length ?? 0),
        0
    );
    const container = createQueueContainer(player, 1, totalMs);
    const { maxPages } = calcPagination(queueLength, 1);

    const message = await ctx.write(
        { components: [container], flags: EPHEMERAL_FLAG },
        true
    );
    if (!message?.id) return;

    queueViewState.set(message.id, { page: 1, maxPages, totalMs });

    const collector = message.createComponentCollector?.({
        idle: 180000, // 3 minutes
        filter: (i: any) => i.user.id === ctx.interaction.user.id,
    });

    if (collector) {
        collector.run('queue_first', (i: any) =>
            handleQueueNavigation(i, player, 'queue_first')
        );
        collector.run('queue_prev', (i: any) =>
            handleQueueNavigation(i, player, 'queue_prev')
        );
        collector.run('queue_next', (i: any) =>
            handleQueueNavigation(i, player, 'queue_next')
        );
        collector.run('queue_last', (i: any) =>
            handleQueueNavigation(i, player, 'queue_last')
        );
        collector.run('queue_refresh', (i: any) =>
            handleQueueNavigation(i, player, 'queue_refresh')
        );
        collector.run('queue_playpause', (i: any) =>
            handleQueueNavigation(i, player, 'queue_playpause')
        );
        collector.run('queue_shuffle', (i: any) =>
            handleQueueNavigation(i, player, 'queue_shuffle')
        );
        collector.run('queue_loop', (i: any) =>
            handleQueueNavigation(i, player, 'queue_loop')
        );
        collector.run('queue_clear', (i: any) =>
            handleQueueNavigation(i, player, 'queue_clear')
        );
    }

    // Cleanup
    setTimeout(() => queueViewState.delete(message.id), 180000);
}

// ---------- Command ----------
@Cooldown({
    type: CooldownType.User,
    interval: 60000,
    uses: { default: 2 },
})
@Declare({
    name: 'queue',
    description: 'Show the music queue with controls',
})
@Middlewares(['cooldown', 'checkPlayer', 'checkVoice'])
export default class QueueCommand extends Command {
    public override async run(ctx: CommandContext): Promise<void> {
        try {
            const player = ctx.client?.aqua?.players?.get(
                ctx.interaction.guildId
            );
            if (!player) {
                await ctx.write({
                    content: '❌ No active player found',
                    flags: EPHEMERAL_FLAG,
                });
                return;
            }
            await handleShowQueue(ctx, player);
        } catch (error: any) {
            if (error?.code === 10065) return;
            console.error('Queue command error:', error);
            await ctx.write({
                content: '❌ An error occurred while displaying the queue',
                flags: EPHEMERAL_FLAG,
            });
        }
    }
}
