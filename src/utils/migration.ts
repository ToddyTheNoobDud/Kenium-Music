import {
  getDatabase,
  getPlaylistsCollection,
  getSettingsCollection,
  getTracksCollection
} from './db'

const SCHEMA_VERSION = 3

type ColumnType = 'TEXT' | 'INTEGER' | 'REAL'

interface ColumnSpec {
  path: string
  type: ColumnType
  boolean?: boolean
}

interface RawSQLiteDB {
  prepare(sql: string): {
    get: (...params: unknown[]) => Record<string, unknown> | undefined
    all: (...params: unknown[]) => unknown[]
    run: (...params: unknown[]) => unknown
  }
  backup?(path: string): Promise<void>
}

interface RawStmt<T = unknown> {
  all?: (...params: unknown[]) => T[]
  iterate?: (...params: unknown[]) => Iterable<T>
}

const HOT_COLUMNS: Record<string, Record<string, ColumnSpec>> = {
  col_guildSettings: {
    twentyFourSevenEnabled: {
      path: '$.twentyFourSevenEnabled',
      type: 'INTEGER',
      boolean: true
    },
    voiceChannelId: { path: '$.voiceChannelId', type: 'TEXT' },
    textChannelId: { path: '$.textChannelId', type: 'TEXT' },
    lang: { path: '$.lang', type: 'TEXT' },
    last247DisableReason: { path: '$.last247DisableReason', type: 'TEXT' }
  },
  col_playlists_v2: {
    userId: { path: '$.userId', type: 'TEXT' },
    name: { path: '$.name', type: 'TEXT' },
    description: { path: '$.description', type: 'TEXT' },
    lastModified: { path: '$.lastModified', type: 'TEXT' },
    playCount: { path: '$.playCount', type: 'INTEGER' },
    totalDuration: { path: '$.totalDuration', type: 'INTEGER' },
    trackCount: { path: '$.trackCount', type: 'INTEGER' },
    lastPlayedAt: { path: '$.lastPlayedAt', type: 'TEXT' }
  },
  col_tracks_v2: {
    playlistId: { path: '$.playlistId', type: 'TEXT' },
    title: { path: '$.title', type: 'TEXT' },
    uri: { path: '$.uri', type: 'TEXT' },
    author: { path: '$.author', type: 'TEXT' },
    duration: { path: '$.duration', type: 'INTEGER' },
    addedAt: { path: '$.addedAt', type: 'TEXT' },
    addedBy: { path: '$.addedBy', type: 'TEXT' },
    source: { path: '$.source', type: 'TEXT' },
    identifier: { path: '$.identifier', type: 'TEXT' }
  }
}

function tableExists(rawDb: RawSQLiteDB, tableName: string): boolean {
  try {
    return !!rawDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(tableName)
  } catch {
    return false
  }
}

function columnExists(
  rawDb: RawSQLiteDB,
  tableName: string,
  columnName: string
) {
  try {
    const rows = rawDb.prepare(`PRAGMA table_info("${tableName}")`).all() as {
      name?: string
    }[]
    return rows.some((row) => row.name === columnName)
  } catch {
    return false
  }
}

function getUserVersion(rawDb: RawSQLiteDB): number {
  try {
    const row = rawDb.prepare('PRAGMA user_version').get() as
      | { user_version?: unknown }
      | undefined
    return Number(row?.user_version || 0)
  } catch {
    return 0
  }
}

function setUserVersion(rawDb: RawSQLiteDB, version: number): void {
  rawDb.prepare(`PRAGMA user_version = ${version}`).run()
}

function getAllRows<T>(stmt: RawStmt<T>): T[] {
  return typeof stmt.all === 'function'
    ? stmt.all()
    : Array.from(stmt.iterate?.() ?? [])
}

function ensureBaseCollections() {
  getSettingsCollection()
  getPlaylistsCollection()
  getTracksCollection()
}

function columnExtractSql(spec: ColumnSpec): string {
  if (spec.boolean) {
    return `CASE json_type(doc, '${spec.path}')
      WHEN 'true' THEN 1
      WHEN 'false' THEN 0
      ELSE CAST(COALESCE(json_extract(doc, '${spec.path}'), 0) AS INTEGER)
    END`
  }

  const extract = `json_extract(doc, '${spec.path}')`
  if (spec.type === 'INTEGER') return `CAST(COALESCE(${extract}, 0) AS INTEGER)`
  if (spec.type === 'REAL') return `CAST(COALESCE(${extract}, 0) AS REAL)`
  return extract
}

function ensureHotColumns(rawDb: RawSQLiteDB): void {
  for (const [tableName, columns] of Object.entries(HOT_COLUMNS)) {
    if (!tableExists(rawDb, tableName)) continue

    for (const [columnName, spec] of Object.entries(columns)) {
      if (columnExists(rawDb, tableName, columnName)) continue
      rawDb
        .prepare(
          `ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${spec.type}`
        )
        .run()
    }
  }
}

function backfillHotColumns(rawDb: RawSQLiteDB): void {
  for (const [tableName, columns] of Object.entries(HOT_COLUMNS)) {
    if (!tableExists(rawDb, tableName)) continue

    const assignments = Object.entries(columns).map(
      ([columnName, spec]) => `"${columnName}" = ${columnExtractSql(spec)}`
    )

    if (!assignments.length) continue
    rawDb.prepare(`UPDATE "${tableName}" SET ${assignments.join(', ')}`).run()
  }
}

function rebuildIndexes(rawDb: RawSQLiteDB): void {
  const obsoleteIndexes = [
    'col_guildSettings_guildId_idx',
    'col_guildSettings_twentyFourSevenEnabled_idx',
    'idx_settings_247_enabled',
    'col_playlists_v2_lastModified_idx',
    'col_playlists_v2_name_idx',
    'col_playlists_v2_userId_idx',
    'idx_playlists_user_name',
    'col_tracks_v2_addedAt_idx',
    'col_tracks_v2_playlistId_idx',
    'idx_tracks_playlist_order'
  ]

  for (const indexName of obsoleteIndexes) {
    rawDb.prepare(`DROP INDEX IF EXISTS "${indexName}"`).run()
  }

  try {
    rawDb
      .prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_playlists_user_name
         ON "col_playlists_v2"("userId", "name")`
      )
      .run()
  } catch (err) {
    console.warn(
      '[Migration] Could not create unique playlist name index. Existing duplicate playlist names may need cleanup first.',
      err
    )
    rawDb
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_playlists_user_name
         ON "col_playlists_v2"("userId", "name")`
      )
      .run()
  }

  rawDb
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_playlists_user_last_modified
       ON "col_playlists_v2"("userId", "lastModified" DESC)`
    )
    .run()

  rawDb
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_tracks_playlist_order
       ON "col_tracks_v2"("playlistId", "addedAt", _id)`
    )
    .run()

  rawDb
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_settings_247_enabled
       ON "col_guildSettings"("voiceChannelId", "textChannelId")
       WHERE "twentyFourSevenEnabled" = 1 AND "voiceChannelId" IS NOT NULL`
    )
    .run()
}

async function migrateLegacyPlaylistTable(rawDb: RawSQLiteDB) {
  let sourceTable = ''
  if (tableExists(rawDb, 'col_playlists')) sourceTable = 'col_playlists'
  else if (tableExists(rawDb, 'col_playlists_old'))
    sourceTable = 'col_playlists_old'

  if (!sourceTable) return

  const playlistsV2 = getPlaylistsCollection()
  const tracksV2 = getTracksCollection()

  if (playlistsV2.getStats().documentCount > 0) {
    console.log(
      '[Migration] Legacy playlist table detected, but destination already has data. Skipping legacy import.'
    )
    return
  }

  const backupPath = `db/sey.sqlite.bak_${Date.now()}`
  try {
    if (typeof rawDb.backup === 'function') {
      await rawDb.backup(backupPath)
      console.log(`[Migration] WAL-safe backup created at ${backupPath}`)
    } else {
      rawDb.prepare('PRAGMA wal_checkpoint(TRUNCATE)').run()
    }
  } catch (err) {
    console.error(
      '[Migration] Backup failed. Aborting legacy migration for safety:',
      err
    )
    return
  }

  const stmt = rawDb.prepare(
    `SELECT _id, doc, createdAt, updatedAt FROM ${sourceTable}`
  ) as RawStmt<{
    _id: string
    doc: string
    createdAt: string
    updatedAt: string
  }>

  const rows = getAllRows(stmt)
  if (!rows.length) return

  let successCount = 0
  let failureCount = 0

  getDatabase().transaction(() => {
    for (const row of rows) {
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
            tracks.reduce(
              (sum: number, t: { duration?: number }) =>
                sum + (t.duration || 0),
              0
            ),
          trackCount: tracks.length,
          lastModified: doc.lastModified || row.updatedAt || row.createdAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        })

        if (tracks.length > 0) {
          tracksV2.insert(
            tracks.map(
              (track: {
                title: string
                uri: string
                author: string
                duration?: number
                source?: string
                identifier?: string
                artworkUrl?: string | null
                addedAt?: string
              }) => ({
                playlistId: row._id,
                title: track.title,
                uri: track.uri,
                author: track.author,
                duration: track.duration || 0,
                source: track.source || 'Unknown',
                identifier: track.identifier || track.uri,
                artworkUrl: track.artworkUrl || null,
                addedAt: track.addedAt || row.createdAt
              })
            )
          )
        }

        successCount++
      } catch (err) {
        failureCount++
        console.error(`[Migration] Failed to migrate playlist ${row._id}:`, err)
      }
    }
  })

  if (
    failureCount === 0 &&
    successCount > 0 &&
    sourceTable === 'col_playlists'
  ) {
    rawDb.prepare('ALTER TABLE col_playlists RENAME TO col_playlists_old').run()
  }

  if (successCount > 0) {
    console.log(
      `[Migration] Imported ${successCount} legacy playlists into the normalized schema.`
    )
  }
  if (failureCount > 0) {
    console.warn(
      `[Migration] Legacy import completed with ${failureCount} errors.`
    )
  }
}

export async function migrateDatabase() {
  const db = getDatabase()
  const rawDb = (db as unknown as { db: RawSQLiteDB }).db

  ensureBaseCollections()

  let version = getUserVersion(rawDb)

  if (version < 1) {
    await migrateLegacyPlaylistTable(rawDb)
    setUserVersion(rawDb, 1)
    version = 1
  }

  if (version < 2) {
    ensureHotColumns(rawDb)
    backfillHotColumns(rawDb)
    setUserVersion(rawDb, 2)
    version = 2
  }

  if (version < 3) {
    rebuildIndexes(rawDb)
    try {
      rawDb.prepare('PRAGMA optimize').run()
    } catch {}
    setUserVersion(rawDb, 3)
    version = 3
  }

  if (version !== SCHEMA_VERSION) {
    setUserVersion(rawDb, SCHEMA_VERSION)
  }
}
