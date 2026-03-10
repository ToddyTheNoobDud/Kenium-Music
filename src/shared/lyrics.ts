import type { LyricsSearchHints } from '../utils/musiclyrics'

type TrackInfoLike = {
  title?: unknown
  author?: unknown
  artworkUrl?: unknown
  length?: unknown
  isrc?: unknown
  uri?: unknown
}

type TrackLike = {
  title?: unknown
  author?: unknown
  thumbnail?: unknown
  length?: unknown
  uri?: unknown
  info?: TrackInfoLike | null
}

type MatchedLyricsTrack = {
  title?: string | undefined
  author?: string | undefined
  albumArt?: string | undefined
}

const safeText = (value: unknown) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : undefined

const stripTrackIndexPrefix = (value: string | undefined) =>
  String(value || '')
    .replace(/^\s*\d+\s*[.)-]\s*/u, '')
    .trim()

const safeNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

const normalize = (value: string | undefined) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const similarity = (left: string | undefined, right: string | undefined) => {
  const a = normalize(left)
  const b = normalize(right)

  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return 0.9

  const aTokens = new Set(a.split(' ').filter(Boolean))
  const bTokens = new Set(b.split(' ').filter(Boolean))
  let common = 0

  for (const token of aTokens) if (bTokens.has(token)) common++
  return (2 * common) / (aTokens.size + bTokens.size)
}

const sanitizeTrackTitle = (
  title: string | undefined,
  artist: string | undefined
) => {
  const cleanTitle = stripTrackIndexPrefix(safeText(title))
  const cleanArtist = safeText(artist)

  if (!cleanTitle || !cleanArtist) return cleanTitle || cleanArtist

  const parts = cleanTitle.split(/\s[-–—]\s/u).filter(Boolean)
  if (parts.length >= 2) {
    const first = stripTrackIndexPrefix(parts[0])
    const last = stripTrackIndexPrefix(parts[parts.length - 1])

    if (similarity(first, cleanArtist) >= 0.8) {
      return parts.slice(1).join(' - ').trim()
    }

    if (similarity(last, cleanArtist) >= 0.8) {
      return parts.slice(0, -1).join(' - ').trim()
    }
  }

  return cleanTitle
}

export const extractLyricsSearchHints = (
  track: TrackLike | null | undefined
): LyricsSearchHints | undefined => {
  if (!track) return undefined

  const info = track.info ?? undefined
  const artist = safeText(track.author) ?? safeText(info?.author)
  const title = sanitizeTrackTitle(
    safeText(track.title) ?? safeText(info?.title),
    artist
  )
  const albumArt = safeText(info?.artworkUrl) ?? safeText(track.thumbnail)
  const durationMs = safeNumber(track.length) ?? safeNumber(info?.length)
  const isrc = safeText(info?.isrc)
  const uri = safeText(info?.uri) ?? safeText(track.uri)

  if (!title && !artist && !albumArt && !durationMs && !isrc && !uri) {
    return undefined
  }

  return {
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
    ...(albumArt ? { albumArt } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(isrc ? { isrc } : {}),
    ...(uri ? { uri } : {})
  }
}

export const buildLyricsQueryFromHints = (
  hints: LyricsSearchHints | undefined
): string => hints?.title || hints?.artist || ''

export const lyricsTrackMatchesHints = (
  hints: LyricsSearchHints | undefined,
  track: MatchedLyricsTrack | undefined
): boolean => {
  if (!hints?.title || !track?.title) return false

  const titleScore = similarity(hints.title, track.title)
  const artistScore =
    hints.artist && track.author ? similarity(hints.artist, track.author) : 1

  return titleScore >= 0.86 && artistScore >= 0.65
}

export const pickLyricsArtwork = (
  searchQuery: string | undefined,
  hints: LyricsSearchHints | undefined,
  track: MatchedLyricsTrack | undefined
): string | undefined => {
  const hintedArt = hints?.albumArt
  if (!hintedArt) return track?.albumArt

  if (!searchQuery?.trim() || lyricsTrackMatchesHints(hints, track)) {
    return hintedArt
  }

  return track?.albumArt ?? hintedArt
}
