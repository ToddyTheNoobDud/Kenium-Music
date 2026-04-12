// @ts-ignore bun runtime module
import { Database } from 'bun:sqlite'
import { mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

const root = process.cwd()
const dbDir = join(root, 'db')
const benchDir = join(dbDir, 'benchmarks')
const sourcePath = join(dbDir, 'sey.sqlite')
const jsonPath = join(benchDir, 'bench_json.sqlite')
const jsonbPath = join(benchDir, 'bench_jsonb.sqlite')
const keep = process.argv.includes('--keep')
const tables = ['col_guildSettings', 'col_playlists_v2', 'col_tracks_v2'] as const

interface BenchResult {
  name: string
  iterations: number
  totalMs: number
  avgMs: number
  opsPerSec: number
}

function nowIso(i: number) {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)).toISOString()
}

function ensureBenchCopies() {
  rmSync(benchDir, { recursive: true, force: true })
  mkdirSync(benchDir, { recursive: true })

  const source = new Database(sourcePath)
  try {
    source.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } catch {}
  source.exec(`VACUUM INTO '${jsonPath.replace(/\\/g, '/')}'`)
  source.close()

  const jsonbDb = new Database(jsonbPath)
  jsonbDb.close()
  const seed = new Database(jsonPath)
  seed.exec(`VACUUM INTO '${jsonbPath.replace(/\\/g, '/')}'`)
  seed.close()

  const convert = new Database(jsonbPath)
  for (const table of tables) {
    convert.exec(`UPDATE "${table}" SET doc = jsonb(doc)`) 
  }
  convert.exec('VACUUM')
  convert.close()
}

function bench(name: string, iterations: number, fn: (i: number) => void): BenchResult {
  const warmup = Math.min(100, Math.max(10, Math.floor(iterations / 20)))
  for (let i = 0; i < warmup; i++) fn(i)

  const start = performance.now()
  for (let i = 0; i < iterations; i++) fn(i)
  const totalMs = performance.now() - start
  return {
    name,
    iterations,
    totalMs,
    avgMs: totalMs / iterations,
    opsPerSec: iterations / (totalMs / 1000)
  }
}

function formatMs(value: number) {
  return value.toFixed(3)
}

function formatOps(value: number) {
  return value.toFixed(1)
}

function formatPct(delta: number) {
  const sign = delta >= 0 ? '+' : ''
  return `${sign}${delta.toFixed(1)}%`
}

ensureBenchCopies()

const jsonDb = new Database(jsonPath)
const jsonbDb = new Database(jsonbPath)
const samplePlaylist = jsonDb
  .query(`
    SELECT _id, userId, name, trackCount, doc
    FROM "col_playlists_v2"
    ORDER BY trackCount DESC, lastModified DESC
    LIMIT 1
  `)
  .get() as { _id: string; userId: string; name: string; trackCount: number; doc: string } | null

if (!samplePlaylist) {
  console.error('No playlist data found to benchmark.')
  process.exit(1)
}

const sampleTrackCount = Number(samplePlaylist.trackCount || 0)
const sampleTrackLimit = Math.max(1, Math.min(50, sampleTrackCount || 1))
const sampleTrackRows = jsonDb
  .query(`
    SELECT _id, uri, title
    FROM "col_tracks_v2"
    WHERE playlistId = ?
    ORDER BY addedAt ASC, _id ASC
    LIMIT ?
  `)
  .all(samplePlaylist._id, sampleTrackLimit) as { _id: string; uri: string; title: string }[]

const ownerPlaylistRows = jsonDb
  .query(
    `
      SELECT _id, userId, name, totalDuration, lastModified, createdAt, playCount, trackCount
      FROM "col_playlists_v2"
      WHERE userId = ?
      ORDER BY lastModified DESC
      LIMIT 25
    `
  )
  .all(samplePlaylist.userId) as Array<{
    _id: string
    userId: string
    name: string
    totalDuration: number
    lastModified: string
    createdAt: string
    playCount: number
    trackCount: number
  }>

const playlistLookupJson = jsonDb.query(
  `SELECT _id, playCount, totalDuration FROM "col_playlists_v2" WHERE userId = ? AND name = ? LIMIT 1`
)
const playlistLookupJsonb = jsonbDb.query(
  `SELECT _id, playCount, totalDuration FROM "col_playlists_v2" WHERE userId = ? AND name = ? LIMIT 1`
)
const playlistViewJson = jsonDb.query(
  `SELECT _id, name, totalDuration, lastModified, createdAt, playCount, trackCount
   FROM "col_playlists_v2"
   WHERE userId = ?
   ORDER BY lastModified DESC
   LIMIT 25`
)
const playlistViewJsonb = jsonbDb.query(
  `SELECT _id, name, totalDuration, lastModified, createdAt, playCount, trackCount
   FROM "col_playlists_v2"
   WHERE userId = ?
   ORDER BY lastModified DESC
   LIMIT 25`
)

const trackPageJson = jsonDb.query(
  `SELECT _id, title, author, duration, uri FROM "col_tracks_v2" WHERE playlistId = ? ORDER BY addedAt ASC, _id ASC LIMIT 25`
)
const trackPageJsonb = jsonbDb.query(
  `SELECT _id, title, author, duration, uri FROM "col_tracks_v2" WHERE playlistId = ? ORDER BY addedAt ASC, _id ASC LIMIT 25`
)

const coldDocJson = jsonDb.query(
  `SELECT doc FROM "col_tracks_v2" WHERE playlistId = ? ORDER BY addedAt ASC, _id ASC LIMIT ?`
)
const coldDocJsonbToText = jsonbDb.query(
  `SELECT json(doc) as doc FROM "col_tracks_v2" WHERE playlistId = ? ORDER BY addedAt ASC, _id ASC LIMIT ?`
)

const coldExtractJson = jsonDb.query(
  `SELECT json_extract(doc, '$.artworkUrl') AS artworkUrl, json_extract(doc, '$.isrc') AS isrc FROM "col_tracks_v2" WHERE playlistId = ? ORDER BY addedAt ASC, _id ASC LIMIT ?`
)
const coldExtractJsonb = jsonbDb.query(
  `SELECT json_extract(doc, '$.artworkUrl') AS artworkUrl, json_extract(doc, '$.isrc') AS isrc FROM "col_tracks_v2" WHERE playlistId = ? ORDER BY addedAt ASC, _id ASC LIMIT ?`
)

const jsonWriteDb = new Database(jsonPath)
const jsonbWriteDb = new Database(jsonbPath)
const partialUpdateJson = jsonWriteDb.query(
  `UPDATE "col_playlists_v2"
   SET updatedAt = ?,
       playCount = COALESCE(playCount, 0) + 1,
       lastPlayedAt = ?,
       doc = json_set(doc, '$.playCount', COALESCE(playCount, 0) + 1, '$.lastPlayedAt', json(?), '$.updatedAt', json(?))
   WHERE _id = ?`
)
const partialUpdateJsonb = jsonbWriteDb.query(
  `UPDATE "col_playlists_v2"
   SET updatedAt = ?,
       playCount = COALESCE(playCount, 0) + 1,
       lastPlayedAt = ?,
       doc = jsonb_set(doc, '$.playCount', jsonb(COALESCE(playCount, 0) + 1), '$.lastPlayedAt', jsonb(?), '$.updatedAt', jsonb(?))
   WHERE _id = ?`
)
const fullRewriteJson = jsonWriteDb.query(
  `UPDATE "col_playlists_v2" SET updatedAt = ?, doc = json(?) WHERE _id = ?`
)
const fullRewriteJsonb = jsonbWriteDb.query(
  `UPDATE "col_playlists_v2" SET updatedAt = ?, doc = jsonb(?) WHERE _id = ?`
)

const fullDocPayload = samplePlaylist.doc
const readIterations = {
  hotLookup: 20000,
  playlistView: 15000,
  trackPage: 10000,
  coldParse: 5000,
  coldExtract: 10000
}
const writeIterations = {
  partial: 5000,
  full: 2500
}

const results: Array<{ workload: string; json: BenchResult; jsonb: BenchResult }> = []

results.push({
  workload: 'Hot playlist lookup (projected columns)',
  json: bench('json hot lookup', readIterations.hotLookup, () => {
    playlistLookupJson.get(samplePlaylist.userId, samplePlaylist.name)
  }),
  jsonb: bench('jsonb hot lookup', readIterations.hotLookup, () => {
    playlistLookupJsonb.get(samplePlaylist.userId, samplePlaylist.name)
  })
})

results.push({
  workload: 'Playlist view listing (owner playlists)',
  json: bench('json playlist view', readIterations.playlistView, () => {
    playlistViewJson.all(samplePlaylist.userId)
  }),
  jsonb: bench('jsonb playlist view', readIterations.playlistView, () => {
    playlistViewJsonb.all(samplePlaylist.userId)
  })
})

results.push({
  workload: 'Hot track page (projected columns)',
  json: bench('json hot track page', readIterations.trackPage, () => {
    trackPageJson.all(samplePlaylist._id)
  }),
  jsonb: bench('jsonb hot track page', readIterations.trackPage, () => {
    trackPageJsonb.all(samplePlaylist._id)
  })
})

results.push({
  workload: 'Cold track docs fetch + app JSON.parse',
  json: bench('json cold parse', readIterations.coldParse, () => {
    const rows = coldDocJson.all(samplePlaylist._id, sampleTrackLimit) as { doc: string }[]
    for (const row of rows) JSON.parse(row.doc)
  }),
  jsonb: bench('jsonb cold parse via json(doc)', readIterations.coldParse, () => {
    const rows = coldDocJsonbToText.all(samplePlaylist._id, sampleTrackLimit) as { doc: string }[]
    for (const row of rows) JSON.parse(row.doc)
  })
})

results.push({
  workload: 'Cold doc field extraction in SQLite',
  json: bench('json cold extract', readIterations.coldExtract, () => {
    coldExtractJson.all(samplePlaylist._id, sampleTrackLimit)
  }),
  jsonb: bench('jsonb cold extract', readIterations.coldExtract, () => {
    coldExtractJsonb.all(samplePlaylist._id, sampleTrackLimit)
  })
})

jsonWriteDb.exec('BEGIN')
jsonbWriteDb.exec('BEGIN')
results.push({
  workload: 'Partial hot update using json_set/jsonb_set',
  json: bench('json partial update', writeIterations.partial, (i) => {
    const iso = nowIso(i)
    partialUpdateJson.run(iso, iso, JSON.stringify(iso), JSON.stringify(iso), samplePlaylist._id)
  }),
  jsonb: bench('jsonb partial update', writeIterations.partial, (i) => {
    const iso = nowIso(i)
    partialUpdateJsonb.run(iso, iso, JSON.stringify(iso), JSON.stringify(iso), samplePlaylist._id)
  })
})
jsonWriteDb.exec('ROLLBACK')
jsonbWriteDb.exec('ROLLBACK')

jsonWriteDb.exec('BEGIN')
jsonbWriteDb.exec('BEGIN')
results.push({
  workload: 'Full doc rewrite from app payload',
  json: bench('json full rewrite', writeIterations.full, (i) => {
    fullRewriteJson.run(nowIso(i), fullDocPayload, samplePlaylist._id)
  }),
  jsonb: bench('jsonb full rewrite', writeIterations.full, (i) => {
    fullRewriteJsonb.run(nowIso(i), fullDocPayload, samplePlaylist._id)
  })
})
jsonWriteDb.exec('ROLLBACK')
jsonbWriteDb.exec('ROLLBACK')

const jsonSize = statSync(jsonPath).size
const jsonbSize = statSync(jsonbPath).size

console.log('SQLite JSON vs JSONB benchmark')
console.log(`Source DB: ${sourcePath}`)
console.log(`Representative playlist: ${samplePlaylist.name} (${sampleTrackCount} tracks)`)
console.log(`Representative owner: ${samplePlaylist.userId} (${ownerPlaylistRows.length} playlists)`)
console.log(`Benchmark track sample: ${sampleTrackRows.length} rows`)
console.log(`JSON DB size: ${jsonSize} bytes`)
console.log(`JSONB DB size: ${jsonbSize} bytes (${formatPct(((jsonbSize - jsonSize) / jsonSize) * 100)})`)
console.log('')
console.log('| Workload | JSON avg ms | JSON ops/s | JSONB avg ms | JSONB ops/s | JSONB delta vs JSON |')
console.log('| --- | ---: | ---: | ---: | ---: | ---: |')
for (const row of results) {
  const delta = ((row.json.opsPerSec - row.jsonb.opsPerSec) / row.json.opsPerSec) * -100
  console.log(
    `| ${row.workload} | ${formatMs(row.json.avgMs)} | ${formatOps(row.json.opsPerSec)} | ${formatMs(row.jsonb.avgMs)} | ${formatOps(row.jsonb.opsPerSec)} | ${formatPct(delta)} |`
  )
}

jsonDb.close()
jsonbDb.close()
jsonWriteDb.close()
jsonbWriteDb.close()

if (!keep) rmSync(benchDir, { recursive: true, force: true })
