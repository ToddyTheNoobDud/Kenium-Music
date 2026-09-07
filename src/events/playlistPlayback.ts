import type {
  PlayerLike,
  ResolveResultLike,
  TrackLike,
  UserLike
} from '../shared/helperTypes.ts'
import { maybeStartPlayback } from '../shared/playback.ts'
import { buildTrackResolveQueries } from '../shared/playlist_format.ts'
import type { Track } from '../shared/types.ts'

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
  if (!player || player.destroyed) return { action: 'create' }

  const playerChannelId =
    player.voiceChannel || player._lastVoiceChannel || null
  return playerChannelId === callerChannelId
    ? { action: 'reuse' }
    : { action: 'reject' }
}

export const enqueueTracksAndCount = async <T>(
  tracks: T[],
  enqueue: (track: T) => unknown
): Promise<number> => {
  let count = 0
  for (const track of tracks) {
    try {
      await enqueue(track)
      count += 1
    } catch {}
  }
  return count
}

export type PlaylistTrackDoc = Pick<
  Track,
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
  requester: UserLike
): Promise<ResolvedQueueTrack | null> => {
  const uri = track?.uri
  if (!uri) return null

  try {
    const sourceStr = String(track?.source || '').toLowerCase()
    const queries = buildTrackResolveQueries(track)
    for (const query of queries) {
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
      if (firstTrack) return firstTrack
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
  const len = items.length
  if (!len) return []

  const cap = Math.min(limit > 0 ? limit : 1, len)
  const results: Array<TResult | null> = new Array(len)
  let nextIndex = 0

  const getNextIndex = (): number => {
    const idx = nextIndex
    nextIndex += 1
    return idx
  }

  const workers = Array.from({ length: cap }, async () => {
    while (true) {
      const idx = getNextIndex()
      if (idx >= len) break

      try {
        const item = items[idx]
        if (item !== undefined) {
          results[idx] = await fn(item, idx)
        }
      } catch (error) {
        console.error(`Track resolution failed for index ${idx}:`, error)
        results[idx] = null
      }
    }
  })

  await Promise.all(workers)

  return results.filter((result): result is TResult => result !== null)
}

type PendingPlaylistLoad = {
  docs: PlaylistTrackDoc[]
  requester: UserLike
}

const pendingPlaylistLoads = new Map<string, PendingPlaylistLoad>()
const topUpInflight = new Set<string>()

export const registerPendingPlaylistLoads = (
  guildId: string,
  docs: PlaylistTrackDoc[],
  requester: UserLike
): void => {
  if (!guildId) return
  if (!docs.length) {
    pendingPlaylistLoads.delete(guildId)
    return
  }
  pendingPlaylistLoads.set(guildId, { docs, requester })
}

export const dropPendingPlaylistLoads = (guildId: string): void => {
  if (guildId) pendingPlaylistLoads.delete(guildId)
}

export const topUpPlaylistBuffer = async (
  aqua: PlaylistResolverLike,
  player: PlayerLike | null | undefined
): Promise<void> => {
  const guildId = player?.guildId
  if (!guildId || player?.destroyed) return
  const entry = pendingPlaylistLoads.get(guildId)
  if (!entry || entry.docs.length === 0) return
  if ((player.queue?.size ?? 0) >= BUFFER_LOW_WATERMARK) return
  if (topUpInflight.has(guildId)) return
  topUpInflight.add(guildId)
  try {
    const chunk = entry.docs.splice(0, TOP_UP_CHUNK_TRACKS)
    if (!chunk.length) {
      pendingPlaylistLoads.delete(guildId)
      return
    }
    const resolved = await resolveTracksConcurrently(
      chunk,
      MAX_RESOLVE_CONCURRENCY,
      (track) => resolveTrack(aqua, track, entry.requester)
    )
    if (player.destroyed) return
    if (pendingPlaylistLoads.get(guildId) !== entry) return
    await enqueueTracksAndCount(resolved, (track) => {
      if (typeof player.queue?.add !== 'function')
        throw new Error('Player queue is unavailable')
      return player.queue.add(track)
    })
    if (entry.docs.length === 0) pendingPlaylistLoads.delete(guildId)
    await maybeStartPlayback(player)
  } finally {
    topUpInflight.delete(guildId)
  }
}
