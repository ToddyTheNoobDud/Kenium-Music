import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [k: string]: JsonValue }

type QueryOps = Partial<{
  $ne: JsonValue
  $in: JsonValue[]
  $nin: JsonValue[]
  $gt: JsonPrimitive
  $gte: JsonPrimitive
  $lt: JsonPrimitive
  $lte: JsonPrimitive
}>
type QueryValue = JsonValue | undefined | QueryOps
type Query = Record<string, QueryValue>

interface FindOptions {
  limit?: number
  skip?: number
  sort?: Record<string, 1 | -1>
  fields?: string[]
}

type Document = {
  _id?: string
  createdAt?: string
  updatedAt?: string
} & Record<string, JsonValue | undefined>

interface AtomicUpdate {
  $set?: Record<string, JsonValue>
  $inc?: Record<string, number>
  $push?: Record<string, JsonValue>
  $pull?: Record<string, JsonValue>
}

interface SimpleDBOptions {
  dbPath?: string
  cacheSize?: number
}


type SQLiteRunResult = { changes: number }

interface SQLiteStmt {
  run(...params: unknown[]): SQLiteRunResult
  get<T extends Record<string, unknown> = Record<string, unknown>>(
    ...params: unknown[]
  ): T | undefined
  all<T extends Record<string, unknown> = Record<string, unknown>>(
    ...params: unknown[]
  ): T[]
  finalize?: () => void
}

type TxRunner = <T>(fn: () => T) => T

interface SQLiteDB {
  prepare(sql: string): SQLiteStmt
  close(): void

  // better-sqlite3
  pragma?: (p: string) => unknown
  transaction?: (
    fn: (fn: () => unknown) => unknown
  ) => (fn: () => unknown) => unknown


  run?: (sql: string) => unknown
}

type SQLiteCtor = new (path: string) => SQLiteDB

const IS_BUN =
  typeof (process as unknown as { isBun?: unknown }).isBun !== 'undefined'

const DatabaseCtor: SQLiteCtor | null = (() => {
  try {
    if (IS_BUN) {
      const m: unknown = require('bun:sqlite')
      const ctor = (m as { default?: unknown })?.default ?? m
      return ctor as SQLiteCtor
    }
  } catch {}

  try {
    const m: unknown = require('better-sqlite3')
    return m as SQLiteCtor
  } catch {
    return null
  }
})()

const VALID_NAME = /^[A-Za-z0-9_]+$/
const VALID_PATH = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/

const _functions = {
  now: () => new Date().toISOString(),

  isPlainObject: (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v),

  parseDoc: (raw: string): Document | null => {
    try {
      const doc: unknown = JSON.parse(raw)
      return _functions.isPlainObject(doc) ? (doc as Document) : null
    } catch {
      return null
    }
  },

  jsonPath: (key: string) => {
    if (!VALID_PATH.test(key)) throw new Error(`Invalid field path: ${key}`)
    return `$.${key}`
  },

  finalize: (stmt: SQLiteStmt | undefined) => {
    try {
      stmt?.finalize?.()
    } catch {}
  },

  makeTxRunner: (db: SQLiteDB): TxRunner | null => {
    try {
      if (typeof db.transaction === 'function') {
        const wrapped = db.transaction((fn: () => unknown) => fn())
        return <T>(fn: () => T) => wrapped(fn) as T
      }
    } catch {}
    return null
  },

  runTx: <T>(runner: TxRunner | null, fn: () => T) =>
    runner ? runner(fn) : fn(),

  ensureDirForFile: (filePath: string) => {
    try {
      mkdirSync(dirname(filePath), { recursive: true })
    } catch {}
  },

  applyPragmas: (db: SQLiteDB, pragmas: string[]) => {
    for (const p of pragmas) {
      try {
        if (IS_BUN) db.run?.(`PRAGMA ${p}`)
        else db.pragma?.(p)
      } catch {}
    }
  }
}

class SQLiteCollection<T extends Record<string, any>> extends EventEmitter {
  private readonly db: SQLiteDB
  private readonly table: string
  private readonly qtable: string
  private readonly cacheSize: number
  private readonly stmtCache = new Map<string, SQLiteStmt>()
  private readonly txRunner: TxRunner | null

  private _insert?: SQLiteStmt
  private _byId?: SQLiteStmt
  private _updateById?: SQLiteStmt
  private _deleteById?: SQLiteStmt
  private _countAll?: SQLiteStmt
  private _createdAtById?: SQLiteStmt

  private _findAll?: SQLiteStmt
  private _deleteAll?: SQLiteStmt

  private readonly fieldStmtCache = new Map<string, SQLiteStmt>()

  public get tableName() {
    return this.table
  }
  public get database() {
    return this.db
  }

  public vacuum(): void {
    try {
      this.db.prepare('VACUUM').run()
    } catch (err) {
      console.error(`[SQLiteCollection] Vacuum failed for ${this.table}:`, err)
    }
  }

  constructor(db: SQLiteDB, name: string, cacheSize = 50) {
    super()
    if (!VALID_NAME.test(name))
      throw new Error(`Invalid collection name: ${name}`)

    this.db = db
    this.table = `col_${name}`
    this.qtable = `"${this.table}"`
    this.cacheSize = Math.max(0, cacheSize)
    this.txRunner = _functions.makeTxRunner(this.db)

    this.db
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS ${this.qtable} (
          _id TEXT PRIMARY KEY,
          doc TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        )`
      )
      .run()

    this.db
      .prepare(
        `CREATE INDEX IF NOT EXISTS "${this.table}_updated" ON ${this.qtable}(updatedAt)`
      )
      .run()
    this.db
      .prepare(
        `CREATE INDEX IF NOT EXISTS "${this.table}_created" ON ${this.qtable}(createdAt)`
      )
      .run()
  }

  private get insertStmt(): SQLiteStmt {
    if (this._insert) return this._insert
    this._insert = this.db.prepare(`
      INSERT INTO ${this.qtable} (_id, doc, createdAt, updatedAt)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(_id) DO UPDATE SET
        updatedAt = excluded.updatedAt,
        doc = json_set(
          excluded.doc,
          '$.createdAt', ${this.qtable}.createdAt,
          '$.updatedAt', excluded.updatedAt
        )
    `)
    return this._insert
  }

  private get createdAtByIdStmt(): SQLiteStmt {
    if (this._createdAtById) return this._createdAtById
    this._createdAtById = this.db.prepare(
      `SELECT createdAt FROM ${this.qtable} WHERE _id = ?`
    )
    return this._createdAtById
  }

  private get byIdStmt(): SQLiteStmt {
    if (this._byId) return this._byId
    this._byId = this.db.prepare(`SELECT doc FROM ${this.qtable} WHERE _id = ?`)
    return this._byId
  }

  private get updateStmt(): SQLiteStmt {
    if (this._updateById) return this._updateById
    this._updateById = this.db.prepare(
      `UPDATE ${this.qtable} SET doc = ?, updatedAt = ? WHERE _id = ?`
    )
    return this._updateById
  }

  private get deleteByIdStmt(): SQLiteStmt {
    if (this._deleteById) return this._deleteById
    this._deleteById = this.db.prepare(
      `DELETE FROM ${this.qtable} WHERE _id = ?`
    )
    return this._deleteById
  }

  private get countAllStmt(): SQLiteStmt {
    if (this._countAll) return this._countAll
    this._countAll = this.db.prepare(`SELECT COUNT(*) AS c FROM ${this.qtable}`)
    return this._countAll
  }

  private getStmt(sql: string, cacheKey?: string): SQLiteStmt {
    if (!cacheKey || this.cacheSize === 0) return this.db.prepare(sql)

    const hit = this.stmtCache.get(cacheKey)
    if (hit) {
      this.stmtCache.delete(cacheKey)
      this.stmtCache.set(cacheKey, hit)
      return hit
    }

    if (this.stmtCache.size >= this.cacheSize) {
      const oldestKey = this.stmtCache.keys().next().value as string | undefined
      if (oldestKey) {
        const oldest = this.stmtCache.get(oldestKey)
        this.stmtCache.delete(oldestKey)
        _functions.finalize(oldest)
      }
    }

    const stmt = this.db.prepare(sql)
    this.stmtCache.set(cacheKey, stmt)
    return stmt
  }

  private buildWhere(query: Query): { sql: string; params: unknown[] } {
    const parts: string[] = []
    const params: unknown[] = []

    for (const [key, value] of Object.entries(query)) {
      if (key === '_id') {
        if (value == null) {
          parts.push(`_id IS NULL`)
          continue
        }

        if (_functions.isPlainObject(value)) {
          for (const [op, opVal] of Object.entries(
            value as Record<string, unknown>
          )) {
            switch (op) {
              case '$ne':
                if (opVal === null) parts.push(`_id IS NOT NULL`)
                else {
                  parts.push(`_id != ?`)
                  params.push(opVal)
                }
                break

              case '$in':
              case '$nin': {
                if (!Array.isArray(opVal)) break
                if (opVal.length === 0) {
                  if (op === '$in') parts.push('0=1')
                  break
                }
                parts.push(
                  `_id ${op === '$in' ? 'IN' : 'NOT IN'} (${opVal.map(() => '?').join(', ')})`
                )
                params.push(...opVal)
                break
              }

              case '$gt':
              case '$gte':
              case '$lt':
              case '$lte':
                parts.push(
                  `_id ${
                    op === '$gt'
                      ? '>'
                      : op === '$gte'
                        ? '>='
                        : op === '$lt'
                          ? '<'
                          : '<='
                  } ?`
                )
                params.push(opVal)
                break
            }
          }
        } else {
          if (value === null) parts.push(`_id IS NULL`)
          else {
            parts.push(`_id = ?`)
            params.push(value)
          }
        }
        continue
      }

      if (key === 'createdAt' || key === 'updatedAt') {
        const col = key

        if (value == null) {
          parts.push(`${col} IS NULL`)
          continue
        }

        if (_functions.isPlainObject(value)) {
          for (const [op, opVal] of Object.entries(
            value as Record<string, unknown>
          )) {
            switch (op) {
              case '$gt':
                parts.push(`${col} > ?`)
                params.push(opVal)
                break
              case '$gte':
                parts.push(`${col} >= ?`)
                params.push(opVal)
                break
              case '$lt':
                parts.push(`${col} < ?`)
                params.push(opVal)
                break
              case '$lte':
                parts.push(`${col} <= ?`)
                params.push(opVal)
                break
              case '$ne':
                if (opVal === null) parts.push(`${col} IS NOT NULL`)
                else {
                  parts.push(`${col} != ?`)
                  params.push(opVal)
                }
                break
              case '$in':
              case '$nin': {
                if (!Array.isArray(opVal)) break
                if (opVal.length === 0) {
                  if (op === '$in') parts.push('0=1')
                  break
                }
                parts.push(
                  `${col} ${op === '$in' ? 'IN' : 'NOT IN'} (${opVal.map(() => '?').join(', ')})`
                )
                params.push(...opVal)
                break
              }
            }
          }
        } else {
          if (value === null) parts.push(`${col} IS NULL`)
          else {
            parts.push(`${col} = ?`)
            params.push(value)
          }
        }
        continue
      }

      const path = _functions.jsonPath(key)
      const extract = `json_extract(doc, '${path}')`

      if (value == null) {
        parts.push(`${extract} IS NULL`)
        continue
      }

      if (_functions.isPlainObject(value)) {
        for (const [op, opVal] of Object.entries(
          value as Record<string, unknown>
        )) {
          switch (op) {
            case '$gt':
              parts.push(`${extract} > ?`)
              params.push(opVal)
              break
            case '$gte':
              parts.push(`${extract} >= ?`)
              params.push(opVal)
              break
            case '$lt':
              parts.push(`${extract} < ?`)
              params.push(opVal)
              break
            case '$lte':
              parts.push(`${extract} <= ?`)
              params.push(opVal)
              break
            case '$ne':
              if (opVal === null) parts.push(`${extract} IS NOT NULL`)
              else {
                parts.push(`${extract} != ?`)
                params.push(opVal)
              }
              break
            case '$in':
            case '$nin': {
              if (!Array.isArray(opVal)) break
              if (opVal.length === 0) {
                if (op === '$in') parts.push('0=1')
                break
              }
              parts.push(
                `${extract} ${op === '$in' ? 'IN' : 'NOT IN'} (${opVal.map(() => '?').join(', ')})`
              )
              params.push(...opVal)
              break
            }
          }
        }
        continue
      }

      if (value === true) {
        parts.push(`(${extract} = 1 OR ${extract} = 'true')`)
        continue
      }
      if (value === false) {
        parts.push(`(${extract} = 0 OR ${extract} = 'false')`)
        continue
      }

      parts.push(`${extract} = ?`)
      params.push(value)
    }

    return { sql: parts.length ? parts.join(' AND ') : '1=1', params }
  }

  insert(docs: T | T[]): (T & Required<Document>) | (T & Required<Document>)[] {
    const isArray = Array.isArray(docs)
    const items = isArray ? docs : [docs]
    const now = _functions.now()
    const result: (T & Required<Document>)[] = []

    _functions.runTx(this.txRunner, () => {
      for (const doc of items) {
        const _id = (doc as any)._id || randomUUID()

        const shouldLookupCreatedAt = !!(doc as any)._id && !(doc as any).createdAt
        const existing =
          shouldLookupCreatedAt && (doc as any)._id
            ? this.createdAtByIdStmt.get<{ createdAt: string }>((doc as any)._id)
            : undefined

        const createdAt = (doc as any).createdAt || existing?.createdAt || now
        const updatedAt = (doc as any).updatedAt || now

        const full: T & Required<Document> = {
          ...doc,
          _id,
          createdAt,
          updatedAt
        }

        this.insertStmt.run(
          full._id,
          JSON.stringify(full),
          full.createdAt,
          full.updatedAt
        )
        result.push(full)
      }
    })

    const changeData = isArray ? result : result[0]
    if (changeData) {
      this.emit('change', 'insert', changeData)
    }
    return isArray ? result : (result[0] as any)
  }

  find(query: Query = {}, opts: FindOptions = {}): (T & Required<Document>)[] {
    const { sql, params } = this.buildWhere(query)
    let querySql = `SELECT doc FROM ${this.qtable} WHERE ${sql}`

    if (opts.sort) {
      const clauses: string[] = []
      for (const [field, dir] of Object.entries(opts.sort)) {
        if (field === '_id' || field === 'createdAt' || field === 'updatedAt') {
          clauses.push(`${field} ${dir === 1 ? 'ASC' : 'DESC'}`)
          continue
        }

        const path = _functions.jsonPath(field)
        clauses.push(
          `json_extract(doc, '${path}') ${dir === 1 ? 'ASC' : 'DESC'}`
        )
      }
      if (clauses.length) querySql += ` ORDER BY ${clauses.join(', ')}`
    }

    if (typeof opts.limit === 'number') {
      if (opts.limit < 0) throw new Error('limit must be >= 0')
      querySql += ` LIMIT ${opts.limit}`
    }
    if (typeof opts.skip === 'number') {
      if (opts.skip < 0) throw new Error('skip must be >= 0')
      querySql += ` OFFSET ${opts.skip}`
    }

    const cacheKey = this.cacheSize ? `find:${querySql}` : undefined
    const rows = this.getStmt(querySql, cacheKey).all<{ doc: string }>(
      ...params
    )

    const fields = opts.fields?.length ? new Set(opts.fields) : null
    const out: (T & Required<Document>)[] = []

    for (const row of rows) {
      const doc = _functions.parseDoc(row.doc)
      if (!doc) continue

      if (!fields) {
        out.push(doc as T & Required<Document>)
        continue
      }

      const proj: any = {}
      if (doc._id) proj._id = doc._id
      if (fields) {
        for (const f of fields) if (Object.hasOwn(doc, f)) proj[f] = (doc as any)[f]
      }
      out.push(proj as T & Required<Document>)
    }

    return out
  }

  findOne(query: Query = {}, opts?: FindOptions): (T & Required<Document>) | null {
    return this.find(query, { ...opts, limit: 1 })[0] ?? null
  }

  findById(id: string): (T & Required<Document>) | null {
    if (!id) return null
    const row = this.byIdStmt.get<{ doc: string }>(id)
    return row ? (_functions.parseDoc(row.doc) as T & Required<Document>) : null
  }

  deleteById(id: string): boolean {
    if (!id) return false
    const res = this.deleteByIdStmt.run(id)
    if (res.changes > 0) this.emit('change', 'delete', { count: res.changes })
    return res.changes > 0
  }

  private updateWhere(query: Query, mut: (doc: T & Required<Document>) => T & Required<Document>): number {
    if (!query || !Object.keys(query).length)
      throw new Error('Update query cannot be empty')

    const { sql, params } = this.buildWhere(query)
    const selSql = `SELECT _id, doc FROM ${this.qtable} WHERE ${sql}`
    const rows = this.getStmt(selSql, `selupd:${selSql}`).all<{
      _id: string
      doc: string
    }>(...params)
    if (!rows.length) return 0

    const now = _functions.now()
    let changed = 0

    _functions.runTx(this.txRunner, () => {
      for (const row of rows) {
        const doc = _functions.parseDoc(row.doc)
        if (!doc) continue

        const next = mut({
          ...doc,
          _id: row._id,
          ...(doc.createdAt ? { createdAt: doc.createdAt } : {}),
          updatedAt: now
        } as T & Required<Document>)

        this.updateStmt.run(JSON.stringify(next), now, row._id)
        changed++
      }
    })

    if (changed) this.emit('change', 'update', { count: changed })
    return changed
  }

  update(query: Query, updates: Partial<T>): number {
    return this.updateWhere(query, (doc) => {
      const next: T & Required<Document> = {
        ...doc,
        ...updates
      }
      if (doc._id) next._id = doc._id
      if (doc.createdAt) next.createdAt = doc.createdAt
      if (doc.updatedAt) next.updatedAt = doc.updatedAt
      return next as T & Required<Document>
    })
  }

  updateAtomic(query: Query, ops: AtomicUpdate): number {
    return this.updateWhere(query, (doc) => {
      const next: T & Required<Document> = { ...doc }

      if (ops.$set) Object.assign(next, ops.$set)

      if (ops.$inc) {
        for (const [k, v] of Object.entries(ops.$inc)) {
          (next as any)[k] = (typeof (next as any)[k] === 'number' ? ((next as any)[k] as number) : 0) + v
        }
      }

      if (ops.$push) {
        for (const [k, v] of Object.entries(ops.$push)) {
          const cur = (next as any)[k]
          if (!Array.isArray(cur)) (next as any)[k] = [v]
          else (cur as JsonValue[]).push(v)
        }
      }

      if (ops.$pull) {
        for (const [k, v] of Object.entries(ops.$pull)) {
          const cur = (next as any)[k]
          if (Array.isArray(cur))
            (next as any)[k] = (cur as JsonValue[]).filter((x: JsonValue) => x !== v)
        }
      }

      return next as T & Required<Document>
    })
  }

  delete(query: Query): number {
    if (!query || !Object.keys(query).length)
      throw new Error('Delete query cannot be empty')

    const { sql, params } = this.buildWhere(query)
    const delSql = `DELETE FROM ${this.qtable} WHERE ${sql}`
    const res = this.getStmt(delSql, `del:${delSql}`).run(...params)

    if (res.changes > 0) this.emit('change', 'delete', { count: res.changes })
    return res.changes
  }

  count(query: Query = {}): number {
    if (!Object.keys(query).length)
      return this.countAllStmt.get<{ c: number }>()?.c ?? 0

    const { sql, params } = this.buildWhere(query)
    const cSql = `SELECT COUNT(*) AS c FROM ${this.qtable} WHERE ${sql}`
    return (
      this.getStmt(cSql, `count:${cSql}`).get<{ c: number }>(...params)?.c ?? 0
    )
  }

  createIndex(field: string, name?: string): void {
    const path = _functions.jsonPath(field)
    const safeField = field.includes('.') ? field.split('.').join('_') : field
    const idxName = name || `${this.table}_${safeField}_idx`
    if (!VALID_NAME.test(idxName))
      throw new Error(`Invalid index name: ${idxName}`)

    this.db
      .prepare(
        `CREATE INDEX IF NOT EXISTS "${idxName}" ON ${this.qtable}(json_extract(doc, '${path}'))`
      )
      .run()
  }

  getStats(): { documentCount: number; tableName: string } {
    return {
      documentCount: this.countAllStmt.get<{ c: number }>()?.c ?? 0,
      tableName: this.table
    }
  }

  getDatabase(): SQLiteDB {
    return this.db
  }

  destroy(): void {
    _functions.finalize(this._insert)
    _functions.finalize(this._byId)
    _functions.finalize(this._updateById)
    _functions.finalize(this._deleteById)
    _functions.finalize(this._countAll)
    _functions.finalize(this._createdAtById)

    _functions.finalize(this._findAll)
    _functions.finalize(this._deleteAll)

    for (const stmt of this.fieldStmtCache.values()) _functions.finalize(stmt)
    this.fieldStmtCache.clear()

    for (const stmt of this.stmtCache.values()) _functions.finalize(stmt)
    this.stmtCache.clear()

    this.removeAllListeners()
  }
}

export class SimpleDB extends EventEmitter {
  private readonly db: SQLiteDB
  private readonly collections = new Map<string, SQLiteCollection<any>>()
  private readonly cacheSize: number

  private _checkpointStmt?: SQLiteStmt
  private _vacuumStmt?: SQLiteStmt

  private checkpointTimer: NodeJS.Timeout | null = null
  private optimizeTimer: NodeJS.Timeout | null = null
  private static readonly CHECKPOINT_INTERVAL_MS = 120000 // 2 minutes
  private static readonly OPTIMIZE_INTERVAL_MS = 24 * 60 * 60 * 1000 // Daily

  constructor(options: SimpleDBOptions = {}) {
    super()

    if (!DatabaseCtor) {
      throw new Error(
        'No SQLite driver found. Install "better-sqlite3" or run on Bun with "bun:sqlite".'
      )
    }

    const defaultDir = join(process.cwd(), 'db')
    const dbPath = options.dbPath || join(defaultDir, 'sey.sqlite')
    this.cacheSize = options.cacheSize ?? 50

    mkdirSync(defaultDir, { recursive: true })
    _functions.ensureDirForFile(dbPath)

    this.db = new DatabaseCtor(dbPath)

    _functions.applyPragmas(this.db, [
      'journal_mode = WAL',
      'synchronous = NORMAL',
      'cache_size = -10000',
      'temp_store = MEMORY',
      'mmap_size = 268435456',
      'foreign_keys = ON',
      'busy_timeout = 30000',
      'journal_size_limit = 5242880',
      'auto_vacuum = INCREMENTAL'
    ])

    this._checkpointStmt = this.db.prepare('PRAGMA wal_checkpoint(PASSIVE)')
    this.startCheckpointTimer()
    this.startOptimizeTimer()
  }

  private startCheckpointTimer(): void {
    if (this.checkpointTimer) return

    this.checkpointTimer = setInterval(() => {
      this.checkpointPassive()
    }, SimpleDB.CHECKPOINT_INTERVAL_MS)

    this.checkpointTimer.unref?.()
  }

  private stopCheckpointTimer(): void {
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer)
      this.checkpointTimer = null
    }
  }

  private startOptimizeTimer(): void {
    if (this.optimizeTimer) return

    const t = setTimeout(() => {
      try {
        console.log('[SimpleDB] Database optimized')
        this.db.prepare('PRAGMA optimize').run()
      } catch {}
    }, 10000)

    t.unref?.()

    this.optimizeTimer = setInterval(() => {
      try {
        this.db.prepare('PRAGMA optimize').run()
      } catch {}
    }, SimpleDB.OPTIMIZE_INTERVAL_MS)

    this.optimizeTimer.unref?.()
  }

  private stopOptimizeTimer(): void {
    if (this.optimizeTimer) {
      clearInterval(this.optimizeTimer)
      this.optimizeTimer = null
    }
  }

  collection<T extends Record<string, any>>(name: string): SQLiteCollection<T> {
    const existing = this.collections.get(name)
    if (existing) return existing as any

    const col = new SQLiteCollection<T>(this.db, name, this.cacheSize)
    col.on('change', (...args) => this.emit('change', ...args))
    col.on('error', (err) => this.emit('error', err))
    this.collections.set(name, col)
    return col
  }

  transaction(fn: () => void): void {
    const runner = _functions.makeTxRunner(this.db)
    _functions.runTx(runner, fn)
  }

  vacuum(): void {
    try {
      this.stopCheckpointTimer()
      this.db.prepare('VACUUM').run()
    } catch (err) {
      console.error('[SimpleDB] Vacuum failed:', err)
    } finally {
      this.startCheckpointTimer()
    }
  }

  checkpointPassive(): void {
    try {
      this._checkpointStmt?.run()
    } catch (err) {
      console.error('[SimpleDB] Passive checkpoint failed:', err)
    }
  }

  checkpoint(): void {
    try {
      this.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').run()
    } catch (err) {
      console.error('[SimpleDB] Checkpoint failed:', err)
    }
  }

  close(): void {
    this.stopCheckpointTimer()
    this.stopOptimizeTimer()

    try {
      this.checkpoint()
    } catch {}

    for (const col of this.collections.values()) col.destroy()
    this.collections.clear()

    _functions.finalize(this._checkpointStmt)
    _functions.finalize(this._vacuumStmt)

    try {
      this.db.close()
    } catch {}
  }
}
