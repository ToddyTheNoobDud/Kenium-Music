import { LIMITS } from '../shared/constants.ts'

export type PlaylistAggregate = {
  trackCount: number
  totalDuration: number
}

export type PlaylistCreationValidation =
  | 'name-too-long'
  | 'playlist-limit'
  | null

export function calculatePlaylistAggregate(
  tracks: ReadonlyArray<{ duration?: number }>
): PlaylistAggregate {
  return {
    trackCount: tracks.length,
    totalDuration: tracks.reduce(
      (total, track) => total + (track.duration || 0),
      0
    )
  }
}

export function validatePlaylistCreation(
  name: string,
  playlistCount: number
): PlaylistCreationValidation {
  if (name.length > LIMITS.MAX_NAME_LENGTH) {
    return 'name-too-long'
  }
  if (playlistCount >= LIMITS.MAX_PLAYLISTS) {
    return 'playlist-limit'
  }
  return null
}

export function limitImportedTracks<T>(tracks: readonly T[]): T[] {
  return tracks.slice(0, LIMITS.MAX_TRACKS)
}
