import { getDatabase, getTracksCollection } from './collections.ts'
import { migrateDatabase } from './migration.ts'

let initPromise: Promise<void> | null = null

export {
  getDatabase,
  getPlaylistsCollection,
  getSettingsCollection,
  getTracksCollection
} from './collections.ts'

export function initDatabase(): Promise<void> {
  if (!initPromise) {
    initPromise = migrateDatabase().catch((error) => {
      initPromise = null
      throw error
    })
  }
  return initPromise
}

export function closeDatabase(): void {
  const db = getDatabase()
  db.close()
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
