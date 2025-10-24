
import { SimpleDB } from './simpleDB'

let dbInstance: SimpleDB | null = null

export function getDatabase(): SimpleDB {
  if (!dbInstance) {
    dbInstance = new SimpleDB({
      cacheSize: 100,
      enableWAL: true
    })
  }
  return dbInstance
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
}


export function getPlaylistsCollection() {
  const db = getDatabase()
  const collection = db.collection('playlists')

  try {
    collection._db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_playlists_user_name
       ON "col_playlists"(
         json_extract(doc, '$.userId'),
         json_extract(doc, '$.name')
       )`
    ).run()
  } catch (err) {
    console.warn('Failed to create compound index:', err)
  }

  try {
    collection.createIndex('userId', 'idx_playlists_user')
  } catch (err) {
    console.warn('Failed to create userId index:', err)
  }

  return collection
}

export function getSettingsCollection() {
  const db = getDatabase()
  const collection = db.collection('guildSettings')

  try {
    collection.createIndex('guildId', 'idx_settings_guild')
  } catch (err) {
    console.warn('Failed to create guildId index:', err)
  }

  return collection
}