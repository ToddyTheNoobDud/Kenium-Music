import type { Playlist, Track } from '../shared/types'
import { migrateDatabase } from './migration'
import { SimpleDB } from './simpleDB'

let dbInstance: SimpleDB | null = null

let _initialized = false
let initPromise: Promise<void> | null = null

const PLAYLIST_COLUMNS = {
  userId: 'TEXT',
  name: 'TEXT',
  description: 'TEXT',
  lastModified: 'TEXT',
  playCount: 'INTEGER',
  totalDuration: 'INTEGER',
  trackCount: 'INTEGER',
  lastPlayedAt: 'TEXT'
} as const

const TRACK_COLUMNS = {
  playlistId: 'TEXT',
  title: 'TEXT',
  uri: 'TEXT',
  author: 'TEXT',
  duration: 'INTEGER',
  addedAt: 'TEXT',
  addedBy: 'TEXT',
  source: 'TEXT',
  identifier: 'TEXT'
} as const

const SETTINGS_COLUMNS = {
  twentyFourSevenEnabled: 'INTEGER',
  voiceChannelId: 'TEXT',
  textChannelId: 'TEXT',
  lang: 'TEXT',
  last247DisableReason: 'TEXT'
} as const

export function getDatabase(): SimpleDB {
  if (!dbInstance) dbInstance = new SimpleDB()
  return dbInstance
}

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
  if (!dbInstance) return
  dbInstance.close()
  dbInstance = null

  _initialized = false
  initPromise = null
}

export function getPlaylistsCollection() {
  const db = getDatabase()
  return db.collection<Playlist>('playlists_v2', { columns: PLAYLIST_COLUMNS })
}

export function getTracksCollection() {
  const db = getDatabase()
  return db.collection<Track>('tracks_v2', { columns: TRACK_COLUMNS })
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

export function getSettingsCollection() {
  const db = getDatabase()
  return db.collection('guildSettings', { columns: SETTINGS_COLUMNS })
}
