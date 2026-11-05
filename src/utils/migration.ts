import type { Database } from 'bun:sqlite'
import { existsSync, renameSync, rmSync } from 'node:fs'
import type { Playlist, Track } from '../shared/types.ts'
import {
  getDatabase,
  getPlaylistsCollection,
  getSettingsCollection,
  getTracksCollection
} from './collections.ts'

const SCHEMA_VERSION = 7

type ColumnType = 'TEXT' | 'INTEGER' | 'REAL'

interface ColumnSpec {
  path: string
  type: ColumnType
  boolean?: boolean
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

function tableExists(rawDb: Database, tableName: string): boolean {
  return !!rawDb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(tableName)
}

function columnExists(
  rawDb: Database,
  tableName: string,
  columnName: string
): boolean {
  const rows = rawDb.prepare(`PRAGMA table_info("${tableName}")`).all() as {
    name: string
  }[]
  return rows.some((row) => row.name === columnName)
}

function getUserVersion(rawDb: Database): number {
  return Number(
    rawDb.query<{ user_version: number }, []>('PRAGMA user_version').get()
      ?.user_version ?? 0
  )
}

function setUserVersion(rawDb: Database, version: number): void {
  rawDb.prepare(`PRAGMA user_version = ${version}`).run()
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
  if (spec.type === 'INTEGER') {
    return `CAST(COALESCE(${extract}, 0) AS INTEGER)`
  }
  if (spec.type === 'REAL') {
    return `CAST(COALESCE(${extract}, 0) AS REAL)`
  }
  return extract
}

function ensureHotColumns(rawDb: Database): void {
  for (const [tableName, columns] of Object.entries(HOT_COLUMNS)) {
    if (!tableExists(rawDb, tableName)) {
      continue
    }

    for (const [columnName, spec] of Object.entries(columns)) {
      if (columnExists(rawDb, tableName, columnName)) {
        continue
      }
      rawDb
        .prepare(
          `ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${spec.type}`
        )
        .run()
    }
  }
}

function backfillHotColumns(rawDb: Database): void {
  for (const [tableName, columns] of Object.entries(HOT_COLUMNS)) {
    if (!tableExists(rawDb, tableName)) {
      continue
    }

    const assignments = Object.entries(columns).map(
      ([columnName, spec]) => `"${columnName}" = ${columnExtractSql(spec)}`
    )

    if (!assignments.length) {
      continue
    }
    rawDb.prepare(`UPDATE "${tableName}" SET ${assignments.join(', ')}`).run()
  }
}

function rebuildIndexes(rawDb: Database): void {
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

type LegacyPlaylistRow = {
  _id: string
  doc: string
  createdAt: string
  updatedAt: string
}

function missingLegacyTracks(
  row: LegacyPlaylistRow,
  existingTracks: Track[]
): Track[] {
  const legacy = JSON.parse(row.doc) as Playlist & { tracks?: Track[] }
  if (legacy.tracks !== undefined && !Array.isArray(legacy.tracks)) {
    throw new Error(`Invalid tracks for legacy playlist ${row._id}`)
  }
  const unmatched = existingTracks.slice()
  return (legacy.tracks ?? []).filter((legacyTrack) => {
    if (
      typeof legacyTrack.title !== 'string' ||
      typeof legacyTrack.uri !== 'string' ||
      typeof legacyTrack.author !== 'string'
    ) {
      throw new Error(`Invalid track for legacy playlist ${row._id}`)
    }
    const matchIndex = unmatched.findIndex(
      (track) =>
        track.title === legacyTrack.title &&
        track.uri === legacyTrack.uri &&
        track.author === legacyTrack.author &&
        track.duration === (legacyTrack.duration || 0) &&
        track.source === (legacyTrack.source || 'Unknown') &&
        track.identifier === (legacyTrack.identifier || legacyTrack.uri) &&
        (track.artworkUrl ?? null) === (legacyTrack.artworkUrl || null) &&
        (!legacyTrack.isrc || track.isrc === legacyTrack.isrc) &&
        (!legacyTrack.addedBy || track.addedBy === legacyTrack.addedBy) &&
        track.addedAt === (legacyTrack.addedAt || row.createdAt)
    )
    if (matchIndex === -1) {
      return true
    }
    unmatched.splice(matchIndex, 1)
    return false
  })
}

function migrateLegacyPlaylistTable(
  rawDb: Database,
  sourceTable: string
): void {
  const playlists = getPlaylistsCollection()
  const tracks = getTracksCollection()
  const rows = rawDb
    .prepare(`SELECT _id, doc, createdAt, updatedAt FROM "${sourceTable}"`)
    .all() as LegacyPlaylistRow[]
  getDatabase().transaction(() => {
    for (const row of rows) {
      const legacy = JSON.parse(row.doc) as Playlist & { tracks?: Track[] }
      if (
        typeof legacy.userId !== 'string' ||
        !legacy.userId ||
        typeof legacy.name !== 'string' ||
        !legacy.name
      ) {
        throw new Error(`Invalid legacy playlist ${row._id}`)
      }
      const existing = playlists.findById(row._id)
      if (
        existing &&
        (existing.userId !== legacy.userId || existing.name !== legacy.name)
      ) {
        throw new Error(`Conflicting legacy playlist ${row._id}`)
      }
      const missing = missingLegacyTracks(
        row,
        tracks.find({ playlistId: row._id })
      )
      if (!existing) {
        playlists.insert({
          _id: row._id,
          userId: legacy.userId,
          name: legacy.name,
          description: legacy.description || '',
          playCount: legacy.playCount || 0,
          lastPlayedAt: legacy.lastPlayedAt || null,
          totalDuration: 0,
          trackCount: 0,
          lastModified: legacy.lastModified || row.updatedAt || row.createdAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        })
      }
      if (missing.length) {
        tracks.insert(
          missing.map((track) => ({
            _id: Bun.randomUUIDv7(),
            playlistId: row._id,
            title: track.title,
            uri: track.uri,
            author: track.author,
            duration: track.duration || 0,
            source: track.source || 'Unknown',
            identifier: track.identifier || track.uri,
            artworkUrl: track.artworkUrl || null,
            isrc: track.isrc || null,
            addedBy: track.addedBy || legacy.userId,
            addedAt: track.addedAt || row.createdAt
          }))
        )
      }
      const migratedTracks = tracks.find(
        { playlistId: row._id },
        { fields: ['duration'] }
      )
      playlists.update(
        { _id: row._id },
        {
          trackCount: migratedTracks.length,
          totalDuration: migratedTracks.reduce(
            (total, track) => total + (track.duration || 0),
            0
          )
        }
      )
    }
    if (sourceTable === 'col_playlists') {
      rawDb
        .prepare('ALTER TABLE col_playlists RENAME TO col_playlists_old')
        .run()
    }
  })
}

function dropLegacyTables(rawDb: Database): boolean {
  try {
    getDatabase().transaction(() => {
      if (tableExists(rawDb, 'col_guildLanguages')) {
        const rows = rawDb
          .prepare('SELECT doc FROM "col_guildLanguages"')
          .all() as { doc?: string }[]
        const settings = getSettingsCollection()
        for (const row of rows) {
          const doc = JSON.parse(row.doc ?? '') as {
            guildId?: unknown
            lang?: unknown
          }
          if (
            typeof doc.guildId !== 'string' ||
            !doc.guildId ||
            typeof doc.lang !== 'string' ||
            !doc.lang
          ) {
            throw new Error('Invalid legacy guild language row')
          }
          const existingSettings = settings.findById(doc.guildId)
          if (existingSettings) {
            if (!existingSettings.lang) {
              settings.update({ _id: doc.guildId }, { lang: doc.lang })
            }
            continue
          }
          settings.insert({
            _id: doc.guildId,
            guildId: doc.guildId,
            twentyFourSevenEnabled: false,
            voiceChannelId: null,
            textChannelId: null,
            lang: doc.lang
          })
        }
        rawDb.prepare('DROP TABLE IF EXISTS "col_guildLanguages"').run()
      }

      if (!tableExists(rawDb, 'col_playlists_old')) {
        return
      }
      const rows = rawDb
        .prepare(
          'SELECT _id, doc, createdAt, updatedAt FROM "col_playlists_old"'
        )
        .all() as LegacyPlaylistRow[]
      const playlists = getPlaylistsCollection()
      const tracks = getTracksCollection()
      for (const row of rows) {
        const legacy = JSON.parse(row.doc) as Playlist & { tracks?: Track[] }
        const migrated = playlists.findById(row._id)
        if (
          !migrated ||
          migrated.userId !== legacy.userId ||
          migrated.name !== legacy.name ||
          migrated.description !== (legacy.description || '') ||
          (legacy.tracks !== undefined && !Array.isArray(legacy.tracks))
        ) {
          throw new Error(`Legacy playlist ${row._id} is not fully migrated`)
        }

        if (
          missingLegacyTracks(row, tracks.find({ playlistId: row._id })).length
        ) {
          throw new Error(`Legacy playlist ${row._id} has unmigrated tracks`)
        }
      }
      rawDb.prepare('DROP TABLE IF EXISTS "col_playlists_old"').run()
    })
    return true
  } catch (err) {
    console.warn(
      '[Migration] Keeping legacy tables: cleanup could not verify a complete transfer.',
      err
    )
    return false
  }
}

export async function migrateDatabase() {
  const db = getDatabase()
  const rawDb = db.db
  let version = getUserVersion(rawDb)
  if (version > SCHEMA_VERSION) {
    return
  }

  if (
    version < SCHEMA_VERSION &&
    rawDb.filename &&
    rawDb.filename !== ':memory:'
  ) {
    const backupPath = `${rawDb.filename}.pre-v${SCHEMA_VERSION}.bak`
    if (!existsSync(backupPath)) {
      const temporaryPath = `${backupPath}.tmp`
      try {
        const backupStatement = rawDb.prepare('VACUUM INTO ?')
        try {
          backupStatement.run(temporaryPath)
        } finally {
          backupStatement.finalize()
        }
        renameSync(temporaryPath, backupPath)
      } catch (error) {
        rmSync(temporaryPath, { force: true })
        throw error
      }
      console.log(`[Migration] Backup created at ${backupPath}`)
    }
  }
  ensureBaseCollections()
  if (version < 2) {
    db.transaction(() => {
      ensureHotColumns(rawDb)
      backfillHotColumns(rawDb)
    })
  }

  if (tableExists(rawDb, 'col_playlists')) {
    migrateLegacyPlaylistTable(rawDb, 'col_playlists')
  } else if (version < 1 && tableExists(rawDb, 'col_playlists_old')) {
    migrateLegacyPlaylistTable(rawDb, 'col_playlists_old')
  }
  if (version < 1) {
    setUserVersion(rawDb, 1)
    version = 1
  }
  if (version < 2) {
    setUserVersion(rawDb, 2)
    version = 2
  }
  if (version < 3) {
    db.transaction(() => {
      rebuildIndexes(rawDb)
      setUserVersion(rawDb, 3)
    })
    rawDb.prepare('PRAGMA optimize').run()
    version = 3
  }
  if (version < 6) {
    for (const tableName of Object.keys(HOT_COLUMNS)) {
      rawDb.prepare(`DROP INDEX IF EXISTS "${tableName}_created"`).run()
      rawDb.prepare(`DROP INDEX IF EXISTS "${tableName}_updated"`).run()
    }
    const cleanupComplete = dropLegacyTables(rawDb)
    const autoVacuum = rawDb
      .query<{ auto_vacuum: number }, []>('PRAGMA auto_vacuum')
      .get()
    if (Number(autoVacuum?.auto_vacuum) !== 2) {
      rawDb.prepare('PRAGMA auto_vacuum = INCREMENTAL').run()
      rawDb.prepare('VACUUM').run()
    }
    if (cleanupComplete) {
      setUserVersion(rawDb, 6)
      version = 6
    }
  }
  if (version === 6) {
    db.transaction(() => {
      for (const indexName of [
        'col_guildSettings_created_idx',
        'col_guildSettings_up_idx',
        'col_guildSettings_updated_idx',
        'idx_guild_settings_guild',
        'idx_settings_guild'
      ]) {
        rawDb.prepare(`DROP INDEX IF EXISTS "${indexName}"`).run()
      }
      setUserVersion(rawDb, SCHEMA_VERSION)
    })
  }
}
