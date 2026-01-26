import { getDatabase, getPlaylistsCollection, getTracksCollection } from './db'

function tableExists(rawDb: any, tableName: string): boolean {
  try {
    return !!rawDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(tableName)
  } catch {
    return false
  }
}

export async function migrateDatabase() {
  const db = getDatabase()
  const rawDb = (db as any).db

  let sourceTable = ''
  if (tableExists(rawDb, 'col_playlists')) {
    sourceTable = 'col_playlists'
  } else if (tableExists(rawDb, 'col_playlists_old')) {
    sourceTable = 'col_playlists_old'
  }

  if (!sourceTable) {
    if (!tableExists(rawDb, 'col_playlists_v2')) {
      console.log('[Migration] No data to migrate (fresh install).')
    }
    return
  }

  const playlistsV2 = getPlaylistsCollection()
  const tracksV2 = getTracksCollection()

  if (playlistsV2.getStats().documentCount > 0) {
    console.log('[Migration] Destination already has data. Skipping migration.')
    return
  }

  console.log(
    `[Migration] Starting migration from ${sourceTable} to V2 schema...`
  )

  const backupPath = `db/sey.sqlite.bak_${Date.now()}`
  try {
    if (typeof rawDb.backup === 'function') {
      await rawDb.backup(backupPath)
      console.log(`[Migration] WAL-safe backup created at ${backupPath}`)
    } else {
      console.warn(
        '[Migration] Native backup API not found. Performing checkpoint...'
      )
      rawDb.prepare('PRAGMA wal_checkpoint(TRUNCATE)').run()
    }
  } catch (err) {
    console.error('[Migration] Backup failed. Aborting for safety:', err)
    return
  }

  let successCount = 0
  let failureCount = 0

  const stmt = rawDb.prepare(
    `SELECT _id, doc, createdAt, updatedAt FROM ${sourceTable}`
  )

  db.transaction(() => {
    for (const row of stmt.iterate()) {
      try {
        const doc = JSON.parse(row.doc)
        const tracks = Array.isArray(doc.tracks) ? doc.tracks : []

        playlistsV2.insert({
          _id: row._id,
          userId: doc.userId,
          name: doc.name,
          description: doc.description || '',
          playCount: doc.playCount || 0,
          lastPlayedAt: doc.lastPlayedAt || null,
          totalDuration:
            doc.totalDuration ||
            tracks.reduce((sum: number, t: any) => sum + (t.duration || 0), 0),
          trackCount: tracks.length,
          lastModified: doc.lastModified || row.updatedAt || row.createdAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        })

        if (tracks.length > 0) {
          const tracksToInsert = tracks.map((track: any, index: number) => ({
            playlistId: row._id,
            title: track.title,
            uri: track.uri,
            author: track.author,
            duration: track.duration || 0,
            source: track.source || 'Unknown',
            identifier: track.identifier || track.uri,
            artworkUrl: track.artworkUrl || null,
            addedAt: track.addedAt || row.createdAt
          }))
          tracksV2.insert(tracksToInsert)
        }

        successCount++
      } catch (err) {
        failureCount++
        console.error(`[Migration] Failed to migrate playlist ${row._id}:`, err)
      }
    }

    if (failureCount === 0 && successCount > 0) {
      console.log(
        `[Migration] Successfully migrated ${successCount} playlists.`
      )
      if (sourceTable === 'col_playlists') {
        rawDb
          .prepare('ALTER TABLE col_playlists RENAME TO col_playlists_old')
          .run()
        console.log('[Migration] Renamed source table to col_playlists_old.')
      }
    } else if (failureCount > 0) {
      console.warn(
        `[Migration] Migration completed with ${failureCount} errors. Source table NOT renamed.`
      )
    }
  })

  console.log('[Migration] Process finished.')
}
