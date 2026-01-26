import { Cooldown, CooldownType } from '@slipher/cooldown'
import {
  Command,
  type CommandContext,
  Container,
  Declare,
  Middlewares
} from 'seyfert'
import { getContextLanguage } from '../utils/i18n'
import { lru } from 'tiny-lru'

const TRACKS_PER_PAGE = 5
const MAX_DURATION_CACHE = 1000
const EPHEMERAL_FLAG = 64 | (32768 as const)

// use tiny-lru for a bounded LRU cache instead of a plain Map
const durationCache = lru(MAX_DURATION_CACHE)

const queueViewState = new Map<string, { page: number; maxPages: number }>()

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00'
  const cached = durationCache.get(ms)
  if (cached) return cached
  const totalSeconds = (ms / 1000) | 0
  const hours = (totalSeconds / 3600) | 0
  const minutes = ((totalSeconds % 3600) / 60) | 0
  const seconds = totalSeconds % 60
  const formatted =
    hours > 0
      ? `${hours}:${pad(minutes)}:${pad(seconds)}`
      : `${minutes}:${pad(seconds)}`
  // tiny-lru will enforce max size and evict LRU items automatically
  durationCache.set(ms, formatted)
  return formatted
}

function truncate(text: string, max: number): string {
  if (!text) return ''
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

function calcPagination(queueLength: number, page: number) {
  const maxPages = Math.max(1, Math.ceil(queueLength / TRACKS_PER_PAGE))
  const validPage = Math.min(Math.max(1, page), maxPages)
  const startIndex = (validPage - 1) * TRACKS_PER_PAGE
  const endIndex = Math.min(startIndex + TRACKS_PER_PAGE, queueLength)
  return { validPage, maxPages, startIndex, endIndex }
}

function createProgressBar(current: number, total: number, size = 18): string {
  if (!total || total <= 0) return '🔴 LIVE'
  const ratio = Math.min(Math.max(current / total, 0), 1)
  const knobPos = Math.round(ratio * (size - 1))
  return `${'─'.repeat(knobPos)}●${'─'.repeat(size - 1 - knobPos)}`
}

function getQueueArray(q: any): any[] {
  if (Array.isArray(q)) return q
  if (typeof q?.toArray === 'function') return q.toArray()
  if (typeof q?.values === 'function') return Array.from(q.values())
  if (typeof q?.[Symbol.iterator] === 'function')
    return Array.from(q as Iterable<any>)
  return []
}

function getQueueLength(q: any): number {
  if (typeof q?.size === 'number') return q.size
  if (typeof q?.length === 'number') return q.length
  if (typeof q?.toArray === 'function') return q.toArray().length
  if (typeof q?.values === 'function') return Array.from(q.values()).length
  if (typeof q?.[Symbol.iterator] === 'function')
    return Array.from(q as Iterable<any>).length
  return 0
}

function sliceQueue(q: any, start: number, end: number): any[] {
  const arr = getQueueArray(q)
  return arr.slice(start, end)
}

const createButtonRows = (
  page: number,
  maxPages: number,
  opts: { paused: boolean; loop: boolean },
  thele: any
) => {
  const isFirst = page <= 1
  const isLast = page >= maxPages
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          emoji: { name: '⏮️' },
          custom_id: 'ignore_queue_first',
          disabled: isFirst
        },
        {
          type: 2,
          style: 2,
          emoji: { name: '◀️' },
          custom_id: 'ignore_queue_prev',
          disabled: isFirst
        },
        {
          type: 2,
          style: 1,
          emoji: { name: opts.paused ? '▶️' : '⏸️' },
          custom_id: 'ignore_queue_playpause',
          label: opts.paused ? thele.queue.resume : thele.queue.pause
        },
        {
          type: 2,
          style: 2,
          emoji: { name: '▶️' },
          custom_id: 'ignore_queue_next',
          disabled: isLast
        },
        {
          type: 2,
          style: 2,
          emoji: { name: '⏭️' },
          custom_id: 'ignore_queue_last',
          disabled: isLast
        }
      ]
    },
    {
      type: 1,
      components: [
        {
          type: 2,
          style: opts.loop ? 3 : 2,
          emoji: { name: '🔁' },
          custom_id: 'ignore_queue_loop',
          label: opts.loop ? thele.queue.loopOn : thele.queue.loopOff
        },
        {
          type: 2,
          style: 1,
          emoji: { name: '🔄' },
          custom_id: 'ignore_queue_refresh',
          label: thele.queue.refresh
        },
        {
          type: 2,
          style: 4,
          emoji: { name: '🗑️' },
          custom_id: 'ignore_queue_clear',
          label: thele.queue.clear
        }
      ]
    }
  ]
}

function createQueueContainer(
  player: any,
  page: number,
  thele: any
): Container {
  const queueLength = getQueueLength(player?.queue)
  const { validPage, maxPages, startIndex, endIndex } = calcPagination(
    queueLength,
    page
  )
  const currentTrack = player?.current
  const queueSlice = sliceQueue(player?.queue, startIndex, endIndex)

  const components: any[] = [
    {
      type: 10,
      content: `**${thele.queue.title} • ${thele.queue.page.replace('{current}', validPage).replace('{total}', maxPages)}**`
    },
    { type: 14, divider: true, spacing: 1 }
  ]

  if (currentTrack) {
    const title = truncate(currentTrack.info?.title ?? thele.common.unknown, 60)
    const artist = truncate(
      currentTrack.info?.author ?? thele.common.unknown,
      40
    )
    const lengthMs = currentTrack.info?.length ?? 0
    const posMs = player.position ?? 0
    const bar = createProgressBar(posMs, lengthMs)
    const pct = lengthMs > 0 ? Math.round((posMs / lengthMs) * 100) : 0
    const requester = currentTrack.requester?.id
      ? ` • ${thele.player.requestedBy} 👤 <@${currentTrack.requester.id}>`
      : ''
    const nowPlayingContent = [
      `## ${thele.queue.nowPlaying}`,
      `**[${title}](${currentTrack.info?.uri ?? '#'})**`,
      `${thele.player.author}: ${artist}${requester}`,
      '',
      `${bar}  **${pct}%**`,
      `\`${formatDuration(posMs)}\` / \`${lengthMs > 0 ? formatDuration(lengthMs) : 'LIVE'}\``
    ].join('\n')

    components.push({
      type: 9,
      components: [{ type: 10, content: nowPlayingContent }],
      accessory:
        currentTrack?.info?.artworkUrl || currentTrack?.thumbnail
          ? {
              type: 11,
              media: {
                url: currentTrack.info?.artworkUrl ?? currentTrack.thumbnail
              }
            }
          : undefined
    })
  }

  if (queueLength > 0) {
    const lines = queueSlice.map((track: any, i: number) => {
      const num = startIndex + i + 1
      const title = truncate(track?.info?.title ?? thele.common.unknown, 52)
      const uri = track?.info?.uri ?? '#'
      return `• \`${num}.\` [\`${title}\`](${uri})`
    })
    const comingUpTitle = `${thele.queue.comingUp}${queueLength > TRACKS_PER_PAGE ? ` (${startIndex + 1}-${endIndex} ${thele.common.of} ${queueLength})` : ''}`
    components.push(
      { type: 14, divider: true, spacing: 1 },
      { type: 10, content: `**${comingUpTitle}**` },
      {
        type: 10,
        content: lines.join('\n') || `*${thele.queue.noTracksInQueue}*`
      }
    )
  }

  const buttonRows = createButtonRows(
    validPage,
    maxPages,
    {
      paused: !!player?.paused,
      loop: !!player?.loop
    },
    thele
  )

  components.push({ type: 14, divider: true, spacing: 2 }, ...buttonRows)
  return new Container({ components })
}

async function handleQueueNavigation(
  interaction: any,
  player: any,
  action: string,
  thele: any
): Promise<void> {
  try {
    await interaction.deferUpdate()
    const messageId = interaction?.message?.id
    const state = messageId ? queueViewState.get(messageId) : undefined
    if (!state) return

    let newPage = state.page

    switch (action) {
      case 'queue_first':
        newPage = 1
        break
      case 'queue_prev':
        newPage = Math.max(1, state.page - 1)
        break
      case 'queue_next': {
        const { maxPages } = calcPagination(
          getQueueLength(player?.queue),
          state.page
        )
        newPage = Math.min(maxPages, state.page + 1)
        break
      }
      case 'queue_last': {
        const { maxPages } = calcPagination(
          getQueueLength(player?.queue),
          state.page
        )
        newPage = maxPages
        break
      }
      case 'queue_refresh':
        break
      case 'queue_playpause':
        if (player?.paused) await player.pause(false)
        else await player.pause(true)
        break
      case 'queue_loop': {
        const currentLoop = player?.loop || 0
        const newLoop = currentLoop === 0 ? 1 : 0
        if (typeof player?.setLoop === 'function') player.setLoop(newLoop)
        else player.loop = newLoop
        break
      }
      case 'queue_clear':
        if (player?.queue?.clear) player.queue.clear()
        else if (Array.isArray(player?.queue)) player.queue.length = 0
        newPage = 1
        break
      default:
        return
    }

    const { maxPages } = calcPagination(getQueueLength(player?.queue), newPage)
    newPage = Math.min(newPage, maxPages)
    queueViewState.set(messageId!, { page: newPage, maxPages })

    const container = createQueueContainer(player, newPage, thele)
    await interaction.editOrReply({
      components: [container],
      flags: EPHEMERAL_FLAG
    })
  } catch {}
}

async function handleShowQueue(
  ctx: CommandContext,
  player: any,
  thele: any
): Promise<void> {
  const queueLength = getQueueLength(player?.queue)
  if (queueLength === 0 && !player?.current) {
    const emptyContainer = new Container({
      components: [
        { type: 10, content: thele.queue.queueEmpty },
        { type: 14, divider: true, spacing: 1 },
        {
          type: 10,
          content: thele.queue.noTracksInQueue
        },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: thele.queue.tip }
      ]
    })
    await ctx.write({ components: [emptyContainer], flags: EPHEMERAL_FLAG })
    return
  }

  const container = createQueueContainer(player, 1, thele)
  const { maxPages } = calcPagination(queueLength, 1)
  const message = await ctx.write(
    { components: [container], flags: EPHEMERAL_FLAG },
    true
  )
  if (!message?.id) return

  queueViewState.set(message.id, { page: 1, maxPages })

  const collector = message.createComponentCollector?.({
    idle: 180000,
    filter: (i: any) => i.user.id === ctx.interaction.user.id,
    onStop: () => {
      message.edit({ components: [] }).catch(() => null)
    }
  })

  if (collector) {
    for (const id of [
      'queue_first',
      'queue_prev',
      'queue_next',
      'queue_last',
      'queue_refresh',
      'queue_playpause',
      'queue_loop',
      'queue_clear'
    ]) {
      collector.run(id, (i: any) => handleQueueNavigation(i, player, id, thele))
    }
  }

  const t = setTimeout(() => queueViewState.delete(message.id), 180000)
  if (typeof (t as any).unref === 'function') (t as any).unref()
}

@Cooldown({
  type: CooldownType.User,
  interval: 60000,
  uses: { default: 2 }
})
@Declare({
  name: 'queue',
  description: 'Show the music queue with controls'
})
@Middlewares(['cooldown', 'checkPlayer', 'checkVoice'])
export default class QueueCommand extends Command {
  public override async run(ctx: CommandContext): Promise<void> {
    const lang = getContextLanguage(ctx)
    const thele = ctx.t.get(lang)
    try {
      const player = ctx.client?.aqua?.players?.get(ctx.interaction.guildId)
      if (!player) {
        await ctx.write({
          content: thele.queue.noActivePlayerFound,
          flags: EPHEMERAL_FLAG
        })
        return
      }

      await handleShowQueue(ctx, player, thele)
    } catch (error: any) {
      if (error?.code === 10065) return
      await ctx.write({
        content: thele.queue.errorDisplayingQueue,
        flags: EPHEMERAL_FLAG
      })
    }
  }
}
