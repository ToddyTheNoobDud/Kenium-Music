import { Cooldown } from '@slipher/cooldown'
import {
  type APIContainerComponent,
  Command,
  type CommandContext,
  type ComponentInteraction,
  Container,
  Declare,
  type Message,
  Middlewares,
  type WebhookMessage
} from 'seyfert'
import { dropPendingPlaylistLoads } from '../events/playlistPlayback.ts'
import { isExpiredInteraction } from '../shared/errorGuard.ts'
import type { PlayerLike, TrackLike } from '../shared/helperTypes.ts'
import { getTrackRequester } from '../shared/trackRequester.ts'
import { formatDuration, truncate } from '../shared/utils.ts'
import { authorizeVoiceControl } from '../shared/voiceAuthorization.ts'
import type { Translations } from '../utils/i18n.ts'
import { getContextLanguage } from '../utils/i18n.ts'
import { getMemberVoiceState } from '../utils/interactions.ts'

const TRACKS_PER_PAGE = 5
const EPHEMERAL_FLAG = 64 | (32768 as const)

type QueueViewState = { page: number; maxPages: number }
type ContainerComponentLike = APIContainerComponent['components'][number]

const queueViewState = new Map<string, QueueViewState>()

const disposeQueueView = (message: Message | WebhookMessage) => {
  if (!message.id) {
    return
  }
  queueViewState.delete(message.id)
  message.edit({ components: [] }).catch(() => null)
}

function calcPagination(queueLength: number, page: number) {
  const maxPages = Math.max(1, Math.ceil(queueLength / TRACKS_PER_PAGE))
  const validPage = Math.min(Math.max(1, page), maxPages)
  const startIndex = (validPage - 1) * TRACKS_PER_PAGE
  const endIndex = Math.min(startIndex + TRACKS_PER_PAGE, queueLength)
  return { validPage, maxPages, startIndex, endIndex }
}

function createProgressBar(current: number, total: number, size = 18): string {
  if (!total || total <= 0) {
    return '🔴 LIVE'
  }
  const ratio = Math.min(Math.max(current / total, 0), 1)
  const knobPos = Math.round(ratio * (size - 1))
  return `${'─'.repeat(knobPos)}●${'─'.repeat(size - 1 - knobPos)}`
}

function formatTrackMeta(
  track: TrackLike,
  thele: Translations,
  opts: { includeRequester?: boolean } = {}
): string {
  const artist = truncate(track.info?.author ?? thele.common.unknown, 36)
  const requesterId = getTrackRequester(track.requester).id
  const requester =
    opts.includeRequester && requesterId
      ? ` • ${thele.player.requestedBy} <@${requesterId}>`
      : ''
  const lengthMs = track.info?.length ?? 0

  return `${thele.player.author}: ${artist} • ${lengthMs > 0 ? formatDuration(lengthMs) : 'LIVE'}${requester}`
}

const createButtonRows = (
  page: number,
  maxPages: number,
  opts: { paused: boolean; loop: boolean },
  thele: Translations
): ContainerComponentLike[] => {
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
  player: PlayerLike,
  page: number,
  thele: Translations
): Container {
  const queueLength = player.queue.size
  const { validPage, maxPages, startIndex, endIndex } = calcPagination(
    queueLength,
    page
  )
  const currentTrack = player.current
  const queueSlice = player.queue.toArray().slice(startIndex, endIndex)

  const components: ContainerComponentLike[] = [
    {
      type: 10,
      content: `## DECK STACK\n-# ${thele.queue.page.replace('{current}', String(validPage)).replace('{total}', String(maxPages))} • ${queueLength} waiting in line`
    },
    { type: 14, divider: true, spacing: 1 }
  ]

  if (currentTrack) {
    const title = truncate(currentTrack.info?.title ?? thele.common.unknown, 60)
    const lengthMs = currentTrack.info?.length ?? 0
    const posMs = player.position ?? 0
    const bar = createProgressBar(posMs, lengthMs)
    const pct = lengthMs > 0 ? Math.round((posMs / lengthMs) * 100) : 0
    const nowPlayingContent = [
      `### ${thele.queue.nowPlaying}`,
      `**[${title}](${currentTrack.info?.uri ?? '#'})**`,
      `-# ${formatTrackMeta(currentTrack, thele, { includeRequester: true })}`,
      `\`${formatDuration(posMs)}\`  ${bar}  \`${lengthMs > 0 ? formatDuration(lengthMs) : 'LIVE'}\`  **${pct}%**`
    ].join('\n')

    const artworkUrl = currentTrack.info?.artworkUrl || currentTrack.thumbnail
    components.push(
      artworkUrl
        ? {
            type: 9,
            components: [{ type: 10, content: nowPlayingContent }],
            accessory: { type: 11, media: { url: artworkUrl } }
          }
        : { type: 10, content: nowPlayingContent }
    )
  }

  if (queueLength > 0) {
    const lines = queueSlice.map((track: TrackLike, i: number) => {
      const num = startIndex + i + 1
      const title = truncate(track?.info?.title ?? thele.common.unknown, 52)
      const uri = track?.info?.uri ?? '#'
      return [
        `**${num}.** [\`${title}\`](${uri})`,
        `-# ${formatTrackMeta(track, thele)}`
      ].join('\n')
    })
    const comingUpTitle = `${thele.queue.comingUp}${queueLength > TRACKS_PER_PAGE ? ` (${startIndex + 1}-${endIndex} ${thele.common.of} ${queueLength})` : ''}`
    components.push(
      { type: 14, divider: true, spacing: 1 },
      { type: 10, content: `### ${comingUpTitle}` },
      {
        type: 10,
        content: lines.join('\n\n') || `*${thele.queue.noTracksInQueue}*`
      }
    )
  }

  const buttonRows = createButtonRows(
    validPage,
    maxPages,
    {
      paused: !!player.paused,
      loop: !!player.loop
    },
    thele
  )

  components.push({ type: 14, divider: true, spacing: 2 })
  if (buttonRows[0]) {
    components.push(buttonRows[0])
  }
  if (buttonRows[1]) {
    components.push({ type: 14, divider: true, spacing: 1 }, buttonRows[1])
  }
  return new Container({ components })
}

async function handleQueueNavigation(
  interaction: ComponentInteraction,
  ctx: CommandContext,
  action: string,
  thele: Translations
): Promise<void> {
  try {
    await interaction.deferUpdate()
    const normalizedAction = action.replace(/^ignore_/, '')
    const guildId = interaction.guildId ?? ctx.guildId
    const player = guildId ? ctx.client.aqua.players.get(guildId) : undefined
    const mutating =
      normalizedAction === 'queue_playpause' ||
      normalizedAction === 'queue_loop' ||
      normalizedAction === 'queue_clear'
    if (mutating) {
      const memberVoice = await getMemberVoiceState(interaction)
      const authorization = authorizeVoiceControl({
        guildId,
        memberChannelId: memberVoice?.channelId ?? null,
        playerChannelId: player?.voiceChannel ?? null,
        hasPlayer: Boolean(player),
        requirePlayer: true,
        playerDestroyed: player?.destroyed === true
      })
      if (!authorization.ok) {
        await interaction.followup({
          content:
            'You must be in the same voice channel as the active player.',
          flags: 64
        })
        return
      }
    }
    if (!player || player.destroyed) {
      return
    }
    const messageId = interaction.message.id
    const state = queueViewState.get(messageId)
    if (!state) {
      return
    }

    let newPage = state.page

    switch (normalizedAction) {
      case 'queue_first':
        newPage = 1
        break
      case 'queue_prev':
        newPage = Math.max(1, state.page - 1)
        break
      case 'queue_next': {
        const { maxPages } = calcPagination(player.queue.size, state.page)
        newPage = Math.min(maxPages, state.page + 1)
        break
      }
      case 'queue_last': {
        const { maxPages } = calcPagination(player.queue.size, state.page)
        newPage = maxPages
        break
      }
      case 'queue_refresh':
        break
      case 'queue_playpause':
        await player.pause(!player.paused)
        break
      case 'queue_loop': {
        const currentLoop = player.loop || 0
        const newLoop = currentLoop === 0 ? 1 : 0
        player.setLoop(newLoop)
        break
      }
      case 'queue_clear':
        dropPendingPlaylistLoads(player)
        player.queue.clear()
        newPage = 1
        break
      default:
        return
    }

    const { maxPages } = calcPagination(player.queue.size, newPage)
    newPage = Math.min(newPage, maxPages)
    queueViewState.set(messageId, { page: newPage, maxPages })

    const container = createQueueContainer(player, newPage, thele)
    await interaction.editOrReply({
      components: [container],
      flags: EPHEMERAL_FLAG
    })
  } catch (error) {
    if (!isExpiredInteraction(error)) {
      throw error
    }
  }
}

async function handleShowQueue(
  ctx: CommandContext,
  player: PlayerLike,
  thele: Translations
): Promise<void> {
  const queueLength = player.queue.size
  if (queueLength === 0 && !player.current) {
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
    await ctx.editOrReply({
      components: [emptyContainer],
      flags: EPHEMERAL_FLAG
    })
    return
  }

  const container = createQueueContainer(player, 1, thele)
  const { maxPages } = calcPagination(queueLength, 1)
  const message = await ctx.editOrReply(
    { components: [container], flags: EPHEMERAL_FLAG },
    true
  )
  if (!message?.id) {
    return
  }

  queueViewState.set(message.id, { page: 1, maxPages })

  const collector = message.createComponentCollector({
    idle: 180000,
    filter: (i: ComponentInteraction) =>
      i.user.id === ctx.interaction.user.id && i.isButton(),
    onStop: () => disposeQueueView(message)
  })

  for (const id of [
    'ignore_queue_first',
    'ignore_queue_prev',
    'ignore_queue_next',
    'ignore_queue_last',
    'ignore_queue_refresh',
    'ignore_queue_playpause',
    'ignore_queue_loop',
    'ignore_queue_clear'
  ]) {
    collector.run(id, (i: ComponentInteraction) =>
      handleQueueNavigation(i, ctx, id, thele)
    )
  }
}

@Cooldown.user(60000, { uses: 2 })
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
      const player = ctx.client.aqua.players.get(
        ctx.interaction.guildId as string
      )
      if (!player) {
        await ctx.editOrReply({
          content: thele.queue.noActivePlayerFound,
          flags: EPHEMERAL_FLAG
        })
        return
      }

      await handleShowQueue(ctx, player, thele)
    } catch (error: unknown) {
      if (isExpiredInteraction(error)) {
        return
      }
      try {
        await ctx.editOrReply({
          content: thele.queue.errorDisplayingQueue,
          flags: EPHEMERAL_FLAG
        })
      } catch {}
    }
  }
}
