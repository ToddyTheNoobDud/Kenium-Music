import { EventEmitter } from 'node:events'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const IS_BUN = !!(process as any).isBun
const Database: any = (() => {
  try {
    return IS_BUN ? require('bun:sqlite').default || require('bun:sqlite') : require('better-sqlite3')
  } catch {
    return require('better-sqlite3')
  }
})()

const VALID_NAME = /^[A-Za-z0-9_]+$/
const VALID_PATH = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/

interface Query { [key: string]: any }
interface FindOptions {
  limit?: number
  skip?: number
  sort?: { [key: string]: 1 | -1 }
  fields?: string[]
}
interface Document {
  _id?: string
  createdAt?: string
  updatedAt?: string
  [key: string]: any
}
interface AtomicUpdate {
  $set?: Record<string, any>
  $inc?: Record<string, number>
  $push?: Record<string, any>
  $pull?: Record<string, any>
}
interface SimpleDBOptions {
  dbPath?: string
  cacheSize?: number
}

class SQLiteCollection extends EventEmitter {
  private readonly db: any
  private readonly table: string
  private readonly qtable: string
  private readonly cacheSize: number
  private readonly stmtCache = new Map<string, any>()

  private _insert?: any
  private _byId?: any
  private _updateById?: any
  private _deleteById?: any
  private _countAll?: any

  constructor(db: any, name: string, cacheSize = 50) {
    super()

    if (!VALID_NAME.test(name)) {
      throw new Error(`Invalid collection name: ${name}`)
    }

    this.db = db
    this.table = `col_${name}`
    this.qtable = `"${this.table}"`
    this.cacheSize = Math.max(0, cacheSize)

    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS ${this.qtable} (
        _id TEXT PRIMARY KEY,
        doc TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `).run()

    try {
      this.db.prepare(`CREATE INDEX IF NOT EXISTS "${this.table}_updated" ON ${this.qtable}(updatedAt)`).run()
      this.db.prepare(`CREATE INDEX IF NOT EXISTS "${this.table}_created" ON ${this.qtable}(createdAt)`).run()
    } catch {}
  }

  private get insertStmt() {
    return (this._insert ??= this.db.prepare(`
      INSERT INTO ${this.qtable} (_id, doc, createdAt, updatedAt)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(_id) DO UPDATE SET doc = excluded.doc, updatedAt = excluded.updatedAt
    `))
  }

  private get byIdStmt() {
    return (this._byId ??= this.db.prepare(`SELECT doc FROM ${this.qtable} WHERE _id = ?`))
  }

  private get updateStmt() {
    return (this._updateById ??= this.db.prepare(`UPDATE ${this.qtable} SET doc = ?, updatedAt = ? WHERE _id = ?`))
  }

  private get deleteStmt() {
    return (this._deleteById ??= this.db.prepare(`DELETE FROM ${this.qtable} WHERE _id = ?`))
  }

  private get countAllStmt() {
    return (this._countAll ??= this.db.prepare(`SELECT COUNT(*) AS c FROM ${this.qtable}`))
  }

  private now(): string {
    return new Date().toISOString()
  }

  private jsonPath(key: string): string {
    if (!VALID_PATH.test(key)) {
      throw new Error(`Invalid field path: ${key}`)
    }
    return `$.${key}`
  }

  private parseDoc(raw: string): Document | null {
    try {
      const doc = JSON.parse(raw)
      return (doc && typeof doc === 'object') ? doc : null
    } catch {
      return null
    }
  }

  private buildWhere(query: Query): { sql: string; params: any[] } {
    const parts: string[] = []
    const params: any[] = []

    for (const [key, value] of Object.entries(query)) {
      const path = this.jsonPath(key)

      if (value == null) {
        parts.push('json_extract(doc, ?) IS NULL')
        params.push(path)
        continue
      }

      if (typeof value === 'object' && !Array.isArray(value)) {
        for (const [op, opVal] of Object.entries(value)) {
          switch (op) {
            case '$gt':
              parts.push('json_extract(doc, ?) > ?')
              params.push(path, opVal)
              break
            case '$gte':
              parts.push('json_extract(doc, ?) >= ?')
              params.push(path, opVal)
              break
            case '$lt':
              parts.push('json_extract(doc, ?) < ?')
              params.push(path, opVal)
              break
            case '$lte':
              parts.push('json_extract(doc, ?) <= ?')
              params.push(path, opVal)
              break
            case '$ne':
              parts.push('json_extract(doc, ?) != ?')
              params.push(path, opVal)
              break
            case '$in':
            case '$nin':
              if (Array.isArray(opVal) && opVal.length > 0) {
                const ph = opVal.map(() => '?').join(', ')
                parts.push(`json_extract(doc, ?) ${op === '$in' ? 'IN' : 'NOT IN'} (${ph})`)
                params.push(path, ...opVal)
              }
              break
          }
        }
        continue
      }

      if (value === true) {
        parts.push('json_extract(doc, ?) = 1')
        params.push(path)
        continue
      }

      if (value === false) {
        parts.push('json_extract(doc, ?) = 0')
        params.push(path)
        continue
      }

      parts.push('json_extract(doc, ?) = ?')
      params.push(path, value)
    }

    return {
      sql: parts.length > 0 ? parts.join(' AND ') : '1=1',
      params
    }
  }

  private getStmt(sql: string, cacheKey?: string): any {
    if (!cacheKey || this.cacheSize === 0) {
      return this.db.prepare(sql)
    }

    const cached = this.stmtCache.get(cacheKey)
    if (cached) {
      return cached
    }

    if (this.stmtCache.size >= this.cacheSize) {
      const oldest = this.stmtCache.keys().next().value
      if (oldest) {
        this.stmtCache.delete(oldest)
      }
    }

    const stmt = this.db.prepare(sql)
    this.stmtCache.set(cacheKey, stmt)
    return stmt
  }

  insert(docs: Document | Document[]): Document | Document[] {
    const isArray = Array.isArray(docs)
    const items = isArray ? docs : [docs]
    const now = this.now()
    const result: Document[] = []

    this.db.transaction(() => {
      for (const doc of items) {
        const full: Document = {
          ...doc,
          _id: doc._id || randomUUID(),
          createdAt: doc.createdAt || now,
          updatedAt: now
        }
        this.insertStmt.run(full._id, JSON.stringify(full), full.createdAt, full.updatedAt)
        result.push(full)
      }
    })()

    this.emit('change', 'insert', isArray ? result : result[0])
    return isArray ? result : result[0]
  }

  find(query: Query = {}, opts: FindOptions = {}): Document[] {
    const { sql, params } = this.buildWhere(query)
    let querySql = `SELECT doc FROM ${this.qtable} WHERE ${sql}`

    if (opts.sort) {
      const clauses = Object.entries(opts.sort).map(([field, dir]) => {
        const path = this.jsonPath(field)
        return `json_extract(doc, '${path}') ${dir === 1 ? 'ASC' : 'DESC'}`
      })
      if (clauses.length > 0) {
        querySql += ` ORDER BY ${clauses.join(', ')}`
      }
    }

    if (typeof opts.limit === 'number') {
      if (opts.limit < 0) {
        throw new Error('limit must be >= 0')
      }
      querySql += ` LIMIT ${opts.limit}`
    }

    if (typeof opts.skip === 'number') {
      if (opts.skip < 0) {
        throw new Error('skip must be >= 0')
      }
      querySql += ` OFFSET ${opts.skip}`
    }

    const cacheKey = (!opts.limit && !opts.skip && !opts.sort) ? sql : undefined
    const stmt = this.getStmt(querySql, cacheKey)
    const rows = stmt.all(...params)

    const fields = opts.fields?.length ? new Set(opts.fields) : null
    const result: Document[] = []

    for (const row of rows) {
      const doc = this.parseDoc(row.doc)
      if (!doc) {
        continue
      }

      if (fields) {
        const proj: Document = { _id: doc._id }
        for (const f of fields) {
          if (Object.prototype.hasOwnProperty.call(doc, f)) {
            proj[f] = doc[f]
          }
        }
        result.push(proj)
      } else {
        result.push(doc)
      }
    }

    return result
  }

  findOne(query: Query = {}, opts?: FindOptions): Document | null {
    const results = this.find(query, { ...opts, limit: 1 })
    return results[0] ?? null
  }

  findById(id: string): Document | null {
    if (!id) {
      return null
    }
    const row = this.byIdStmt.get(id)
    return row ? this.parseDoc(row.doc) : null
  }

  update(query: Query, updates: Partial<Document>): number {
    if (!query || Object.keys(query).length === 0) {
      throw new Error('Update query cannot be empty')
    }

    const { sql, params } = this.buildWhere(query)
    const rows = this.db.prepare(`SELECT _id, doc FROM ${this.qtable} WHERE ${sql}`).all(...params)

    if (rows.length === 0) {
      return 0
    }

    const now = this.now()

    this.db.transaction(() => {
      for (const row of rows) {
        const doc = this.parseDoc(row.doc)
        if (!doc) {
          continue
        }

        const next: Document = {
          ...doc,
          ...updates,
          _id: row._id,
          createdAt: doc.createdAt,
          updatedAt: now
        }

        this.updateStmt.run(JSON.stringify(next), now, row._id)
      }
    })()

    this.emit('change', 'update', { count: rows.length })
    return rows.length
  }

  updateAtomic(query: Query, ops: AtomicUpdate): number {
    if (!query || Object.keys(query).length === 0) {
      throw new Error('Update query cannot be empty')
    }

    const { sql, params } = this.buildWhere(query)
    const rows = this.db.prepare(`SELECT _id, doc FROM ${this.qtable} WHERE ${sql}`).all(...params)

    if (rows.length === 0) {
      return 0
    }

    const now = this.now()

    this.db.transaction(() => {
      for (const row of rows) {
        const doc = this.parseDoc(row.doc)
        if (!doc) {
          continue
        }

        const next: Document = {
          ...doc,
          _id: row._id,
          createdAt: doc.createdAt,
          updatedAt: now
        }

        if (ops.$set) {
          Object.assign(next, ops.$set)
        }

        if (ops.$inc) {
          for (const [k, v] of Object.entries(ops.$inc)) {
            next[k] = (typeof next[k] === 'number' ? next[k] : 0) + v
          }
        }

        if (ops.$push) {
          for (const [k, v] of Object.entries(ops.$push)) {
            if (!Array.isArray(next[k])) {
              next[k] = []
            }
            next[k].push(v)
          }
        }

        if (ops.$pull) {
          for (const [k, v] of Object.entries(ops.$pull)) {
            if (Array.isArray(next[k])) {
              next[k] = next[k].filter((x: any) => x !== v)
            }
          }
        }

        this.updateStmt.run(JSON.stringify(next), now, row._id)
      }
    })()

    this.emit('change', 'update', { count: rows.length })
    return rows.length
  }

  delete(query: Query): number {
    if (!query || Object.keys(query).length === 0) {
      throw new Error('Delete query cannot be empty')
    }

    const { sql, params } = this.buildWhere(query)
    const res = this.db.prepare(`DELETE FROM ${this.qtable} WHERE ${sql}`).run(...params)

    if (res.changes > 0) {
      this.emit('change', 'delete', { count: res.changes })
    }

    return res.changes
  }

  count(query: Query = {}): number {
    if (Object.keys(query).length === 0) {
      return this.countAllStmt.get().c || 0
    }

    const { sql, params } = this.buildWhere(query)
    const row = this.db.prepare(`SELECT COUNT(*) AS c FROM ${this.qtable} WHERE ${sql}`).get(...params)
    return row?.c || 0
  }

  createIndex(field: string, name?: string): void {
    const path = this.jsonPath(field)
    const idxName = name || `${this.table}_${field.replace(/\./g, '_')}_idx`

    if (!VALID_NAME.test(idxName)) {
      throw new Error(`Invalid index name: ${idxName}`)
    }

    this.db.prepare(`CREATE INDEX IF NOT EXISTS "${idxName}" ON ${this.qtable}(json_extract(doc, '${path}'))`).run()
  }

  getStats(): { documentCount: number; tableName: string } {
    return {
      documentCount: this.countAllStmt.get()?.c || 0,
      tableName: this.table
    }
  }

  destroy(): void {
    this.stmtCache.clear()
    this.removeAllListeners()
  }
}

export class SimpleDB extends EventEmitter {
  private readonly db: any
  private readonly collections = new Map<string, SQLiteCollection>()
  private readonly cacheSize: number

  constructor(options: SimpleDBOptions = {}) {
    super()

    const dir = join(process.cwd(), 'db')
    const path = options.dbPath || join(dir, 'sey.sqlite')
    this.cacheSize = options.cacheSize ?? 50

    mkdirSync(dir, { recursive: true })
    this.db = new Database(path)

    const pragmas = [
      'journal_mode = WAL',
      'synchronous = NORMAL',
      'cache_size = -10000',
      'temp_store = MEMORY',
      'mmap_size = 268435456',
      'foreign_keys = ON',
      'busy_timeout = 30000'
    ]

    for (const p of pragmas) {
      try {
        if (IS_BUN) {
          this.db.run(`PRAGMA ${p}`)
        } else {
          this.db.pragma(p)
        }
      } catch {}
    }
  }

  collection(name: string): SQLiteCollection {
    const existing = this.collections.get(name)
    if (existing) {
      return existing
    }

    const col = new SQLiteCollection(this.db, name, this.cacheSize)
    col.on('change', (...args) => this.emit('change', ...args))
    col.on('error', (err) => this.emit('error', err))
    this.collections.set(name, col)

    return col
  }

  transaction(fn: () => void): void {
    this.db.transaction(fn)()
  }

  close(): void {
    for (const col of this.collections.values()) {
      col.destroy()
    }
    this.collections.clear()

    try {
      this.db.close()
    } catch {}
  }
}
