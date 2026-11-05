import type {
  PlayerLike,
  ResolveResultLike,
  TrackLike,
  UserLike
} from '../shared/helperTypes.ts'
import {
  cancelQueueLoads,
  enqueueTrack,
  getQueueCapacity,
  getQueueLoadState,
  maybeStartPlayback
} from '../shared/playback.ts'
import type { PlaylistFileTrack } from '../shared/playlist_format.ts'
import { buildTrackResolveQueries } from '../shared/playlist_format.ts'

type PlaylistPlayerLike = {
  destroyed?: boolean
  voiceChannel?: string | null
  _lastVoiceChannel?: string | null
}

export type PlaylistPlayerDecision =
  | { action: 'create' }
  | { action: 'reuse' }
  | { action: 'reject' }

export const decidePlaylistPlayer = (
  player: PlaylistPlayerLike | null | undefined,
  callerChannelId: string
): PlaylistPlayerDecision => {
  if (!player || player.destroyed) {
    return { action: 'create' }
  }

  const playerChannelId =
    player.voiceChannel || player._lastVoiceChannel || null
  return playerChannelId === callerChannelId
    ? { action: 'reuse' }
    : { action: 'reject' }
}

export type PlaylistTrackDoc = Pick<
  PlaylistFileTrack,
  'uri' | 'source' | 'identifier' | 'title' | 'author' | 'isrc'
>

export type ResolvedQueueTrack = TrackLike

export type PlaylistResolverLike = {
  resolve: (opts: {
    query: string
    requester: UserLike
    source?: string
  }) => Promise<ResolveResultLike<ResolvedQueueTrack> & { loadType?: string }>
}

export const MAX_RESOLVE_CONCURRENCY = 6
const BUFFER_LOW_WATERMARK = 4
const TOP_UP_CHUNK_TRACKS = 6

export const resolveTrack = async (
  aqua: PlaylistResolverLike,
  track: PlaylistTrackDoc,
  requester: UserLike,
  state?: { cancelled: boolean }
): Promise<ResolvedQueueTrack | null> => {
  try {
    const sourceStr = String(track?.source || '').toLowerCase()
    const queries = buildTrackResolveQueries(track)
    for (const query of queries) {
      if (state?.cancelled) {
        return null
      }
      const isUrl = /^https?:\/\//.test(query)
      const res = await aqua.resolve({
        query,
        requester,
        ...(query.startsWith('isrc:')
          ? { source: 'spsearch' }
          : sourceStr.includes('youtube') && !isUrl
            ? { source: 'ytsearch' }
            : {})
      })

      const loadType = String(res?.loadType || '').toUpperCase()
      if (!res || loadType === 'LOAD_FAILED' || loadType === 'NO_MATCHES') {
        continue
      }

      const tracks = res.tracks
      const firstTrack = Array.isArray(tracks) ? tracks[0] : null
      if (firstTrack) {
        return firstTrack
      }
    }
    return null
  } catch {
    return null
  }
}

export const resolveTracksConcurrently = async <TItem, TResult>(
  items: TItem[],
  limit: number,
  fn: (item: TItem, index: number) => Promise<TResult | null>
): Promise<TResult[]> => {
  const itemCount = items.length
  if (!itemCount) {
    return []
  }
  const workerCount = Math.min(limit > 0 ? limit : 1, itemCount)
  const results: Array<TResult | null> = new Array(itemCount)
  let nextIndex = 0
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < itemCount) {
      const itemIndex = nextIndex++
      try {
        const item = items[itemIndex]
        if (item !== undefined) {
          results[itemIndex] = await fn(item, itemIndex)
        }
      } catch (error) {
        console.error(`Track resolution failed for index ${itemIndex}:`, error)
        results[itemIndex] = null
      }
    }
  })

  await Promise.all(workers)

  return results.filter((result): result is TResult => result != null)
}

type PendingPlaylistLoad = {
  docs: { track: PlaylistTrackDoc; requester: UserLike }[]
}

const pendingPlaylistLoads = new WeakMap<PlayerLike, PendingPlaylistLoad>()
const topUpInflight = new WeakMap<PlayerLike, Promise<number>>()

export const registerPendingPlaylistLoads = (
  player: PlayerLike,
  docs: PlaylistTrackDoc[],
  requester: UserLike
): number => {
  if (!player.guildId || player.destroyed) {
    return 0
  }
  const accepted = docs.slice(0, getQueueCapacity(player))
  if (!accepted.length) {
    return 0
  }
  let entry = pendingPlaylistLoads.get(player)
  if (!entry) {
    entry = { docs: [] }
    pendingPlaylistLoads.set(player, entry)
  }
  entry.docs.push(...accepted.map((track) => ({ track, requester })))
  getQueueLoadState(player).pending += accepted.length
  return accepted.length
}

export const dropPendingPlaylistLoads = (player: PlayerLike): void => {
  cancelQueueLoads(player)
  const entry = pendingPlaylistLoads.get(player)
  if (entry) {
    entry.docs.length = 0
  }
  pendingPlaylistLoads.delete(player)
  topUpInflight.delete(player)
}

export const topUpPlaylistBuffer = async (
  aqua: PlaylistResolverLike,
  player: PlayerLike | null | undefined,
  targetSize = BUFFER_LOW_WATERMARK
): Promise<number> => {
  if (!player?.guildId || player.destroyed) {
    return 0
  }
  const running = topUpInflight.get(player)
  if (running) {
    await running
    return topUpPlaylistBuffer(aqua, player, targetSize)
  }
  const entry = pendingPlaylistLoads.get(player)
  if (!entry) {
    return 0
  }
  const state = getQueueLoadState(player)
  const work = (async () => {
    let loaded = 0
    while (
      !state.cancelled &&
      !player.destroyed &&
      pendingPlaylistLoads.get(player) === entry &&
      entry.docs.length &&
      (player.queue?.size ?? 0) < targetSize
    ) {
      const chunk = entry.docs.slice(0, TOP_UP_CHUNK_TRACKS)
      const resolved = await resolveTracksConcurrently(
        chunk,
        MAX_RESOLVE_CONCURRENCY,
        ({ track, requester }) => resolveTrack(aqua, track, requester, state)
      )
      if (
        state.cancelled ||
        player.destroyed ||
        pendingPlaylistLoads.get(player) !== entry
      ) {
        return loaded
      }
      entry.docs.splice(0, chunk.length)
      state.pending -= chunk.length
      for (const track of resolved) {
        if (enqueueTrack(player, track, state)) {
          loaded += 1
        }
      }
    }
    if (!state.cancelled && pendingPlaylistLoads.get(player) === entry) {
      if (!entry.docs.length) {
        pendingPlaylistLoads.delete(player)
      }
      await maybeStartPlayback(player)
    }
    return loaded
  })()
  topUpInflight.set(player, work)
  try {
    return await work
  } finally {
    if (topUpInflight.get(player) === work) {
      topUpInflight.delete(player)
    }
  }
}
