import { SimpleDB } from './simpleDB'

let dbInstance: SimpleDB | null = null

export function getDatabase(): SimpleDB {
  if (!dbInstance) {
    dbInstance = new SimpleDB({
      cacheSize: 100
      // enableWAL is not a valid option in your SimpleDB constructor
      // options (it accepts dbPath and cacheSize), but WAL is enabled
      // by default in the class constructor anyway.
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
    // Accessing private _db requires casting to any, or making _db public in SimpleDB
    (collection as any)._db.prepare(
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
    // FIX: createIndex only accepts the field name, not a custom index name
    collection.createIndex('userId')
  } catch (err) {
    console.warn('Failed to create userId index:', err)
  }

  return collection
}

export function getSettingsCollection() {
  const db = getDatabase()
  const collection = db.collection('guildSettings')

  try {
    // FIX: Use the native method instead of raw SQL
    collection.createIndex('guildId')
  } catch (err) {
    console.warn('Failed to create guildId index:', err)
  }

  return collection
}