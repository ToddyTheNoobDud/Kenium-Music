import {
  getDatabase,
  getPlaylistsCollection,
  getTracksCollection
} from './collections'
import { migrateDatabase } from './migration'

let _initialized = false
let initPromise: Promise<void> | null = null

export {
  getDatabase,
  getPlaylistsCollection,
  getSettingsCollection,
  getTracksCollection
} from './collections'

export async function initDatabase(): Promise<void> {
  if (_initialized) return
  if (initPromise) return initPromise

  initPromise = (async () => {
    await migrateDatabase()
    _initialized = true
  })().catch((err) => {
    initPromise = null
    throw err
  })

  return initPromise
}

export function closeDatabase(): void {
  const db = getDatabase()
  db.close()
  _initialized = false
  initPromise = null
}

export function getPlaylistTracks(
  playlistId: string,
  options: { limit?: number; skip?: number; fields?: string[] } = {}
) {
  // Deterministic ordering:
  return getTracksCollection().find(
    { playlistId },
    { ...options, sort: { addedAt: 1, _id: 1 } }
  )
}

export async function getPlaylistWithTracks(userId: string, name: string) {
  const playlists = getPlaylistsCollection()
  const playlist = playlists.findOne({ userId, name })
  if (!playlist) return null
  const tracks = getPlaylistTracks(playlist._id as string)
  return { ...playlist, tracks: tracks || [] }
}
