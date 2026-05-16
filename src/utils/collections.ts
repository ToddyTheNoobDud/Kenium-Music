import type { Playlist, Track } from '../shared/types'
import { SimpleDB } from './simpleDB'

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

let dbInstance: SimpleDB | null = null

export function getDatabase(): SimpleDB {
  if (!dbInstance) dbInstance = new SimpleDB()
  return dbInstance
}

export function setDatabaseInstance(db: SimpleDB): void {
  dbInstance = db
}

export function getPlaylistsCollection() {
  return getDatabase().collection<Playlist>('playlists_v2', {
    columns: PLAYLIST_COLUMNS
  })
}

export function getTracksCollection() {
  return getDatabase().collection<Track>('tracks_v2', {
    columns: TRACK_COLUMNS
  })
}

export function getSettingsCollection() {
  return getDatabase().collection('guildSettings', {
    columns: SETTINGS_COLUMNS
  })
}
