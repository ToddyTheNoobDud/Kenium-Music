import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'

interface SimpleDBOptions {
  dbPath?: string
  cacheSize?: number
  maxCacheSize?: number
  enableWAL?: boolean
}

const VALID_IDENTIFIER = /^[A-Za-z0-9_]+$/
const JSON_PATH_COMPONENT = /^[A-Za-z0-9_]+$/
const ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz'

const ensureDir = (dir: string): void => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

const validateIdentifier = (name: string): void => {
  if (!VALID_IDENTIFIER.test(name)) {
    throw new Error(`Invalid identifier: ${name}`)
  }
}

const buildJsonPath = (key: string): string => {
  const parts = key.split('.')
  for (const part of parts) {
    if (!JSON_PATH_COMPONENT.test(part)) {
      throw new Error(`Invalid key: ${part}`)
    }
  }
  return `$.${parts.map(p => `"${p}"`).join('.')}`
}

const generateId = (): string => {
  const timestamp = Date.now().toString(36)
  let random = ''
  for (let i = 0; i < 6; i++) {
    random += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]
  }
  return `${timestamp}_${random}`
}

class SQLiteCollection extends EventEmitter {
  private readonly _db: Database.Database
  private readonly _tableName: string
  private readonly _quotedTable: string
  private readonly _insertStmt: Database.Statement
  private readonly _selectAllStmt: Database.Statement
  private readonly _selectByIdStmt: Database.Statement
  private readonly _updateStmt: Database.Statement
  private readonly _deleteByIdStmt: Database.Statement
  private readonly _countAllStmt: Database.Statement
  private readonly _stmtCache = new Map<string, Database.Statement>()
  private readonly _cacheSize: number

  constructor(db: Database.Database, name: string, cacheSize = 50) {
    super()
    validateIdentifier(name)
    this._db = db
    this._tableName = `col_${name}`
    validateIdentifier(this._tableName)
    this._quotedTable = `"${this._tableName}"`
    this._cacheSize = Math.max(0, cacheSize)

    this._db.prepare(
      `CREATE TABLE IF NOT EXISTS ${this._quotedTable} (
        _id TEXT PRIMARY KEY,
        doc TEXT NOT NULL,
        createdAt TEXT,
        updatedAt TEXT
      )`
    ).run()

    try {
      this._db.prepare(`CREATE INDEX IF NOT EXISTS "${this._tableName}_updated_idx" ON ${this._quotedTable}(updatedAt)`).run()
    } catch {}

    this._insertStmt = this._db.prepare(
      `INSERT INTO ${this._quotedTable} (_id, doc, createdAt, updatedAt)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(_id) DO UPDATE SET
         doc = excluded.doc,
         updatedAt = excluded.updatedAt,
         createdAt = COALESCE((SELECT createdAt FROM ${this._quotedTable} WHERE _id = excluded._id), excluded.createdAt)`
    )

    this._selectAllStmt = this._db.prepare(`SELECT _id, doc FROM ${this._quotedTable}`)
    this._selectByIdStmt = this._db.prepare(`SELECT _id, doc FROM ${this._quotedTable} WHERE _id = ?`)
    this._updateStmt = this._db.prepare(`UPDATE ${this._quotedTable} SET doc = ?, updatedAt = ? WHERE _id = ?`)
    this._deleteByIdStmt = this._db.prepare(`DELETE FROM ${this._quotedTable} WHERE _id = ?`)
    this._countAllStmt = this._db.prepare(`SELECT COUNT(*) as c FROM ${this._quotedTable}`)
  }

  private normalizeDoc(doc: any): any {
    if (!doc || typeof doc !== 'object') doc = {}
    if (!doc._id) doc._id = generateId()
    return doc
  }

  private parseRow(row: any): any | null {
    try {
      const parsed = JSON.parse(row.doc)
      if (typeof parsed === 'object' && parsed !== null) {
        if (!parsed._id) parsed._id = row._id
      }
      return parsed
    } catch (err) {
      try {
        console.error('[SimpleDB] Failed to parse JSON doc for id=', row && row._id, 'error=', err)
      } catch {}
      return null
    }
  }

  private getSelectStmt(query: any): Database.Statement | null {
    const keys = Object.keys(query)
    if (keys.length === 0) return this._selectAllStmt

    keys.sort()
    const cacheKey = keys.join('|')
    if (this._cacheSize > 0 && this._stmtCache.has(cacheKey)) {
      return this._stmtCache.get(cacheKey)!
    }

    const where: string[] = []
    for (const key of keys) {
      const path = buildJsonPath(key)
      const val = query[key]

      if (val === null || val === undefined) {
        where.push(`json_extract(doc, '${path}') IS NULL`)
      } else if (typeof val === 'boolean') {
        where.push(`CAST(json_extract(doc, '${path}') AS INTEGER) = ?`)
      } else if (typeof val === 'number' || typeof val === 'string' || typeof val === 'bigint') {
        where.push(`json_extract(doc, '${path}') = ?`)
      } else {
        where.push(`json_extract(doc, '${path}') = json(?)`)
      }
    }

    const stmt = this._db.prepare(`SELECT _id, doc FROM ${this._quotedTable} WHERE ${where.join(' AND ')}`)

    if (this._cacheSize > 0) {
      if (this._stmtCache.size >= this._cacheSize) {
        const firstKey = this._stmtCache.keys().next().value
        if (firstKey) this._stmtCache.delete(firstKey)
      }
      this._stmtCache.set(cacheKey, stmt)
    }

    return stmt
  }

  private buildParams(query: any): any[] {
    const keys = Object.keys(query)
    keys.sort()
    const params: any[] = []

    for (const key of keys) {
      const val = query[key]
      if (val === null || val === undefined) continue

      if (typeof val === 'boolean') {
        params.push(val ? 1 : 0)
      } else if (typeof val === 'number' || typeof val === 'string' || typeof val === 'bigint') {
        params.push(val)
      } else {
        params.push(JSON.stringify(val))
      }
    }
    return params
  }

  insert(docs: any | any[]): any {
    const arr = Array.isArray(docs) ? docs : [docs]
    const now = new Date().toISOString()

    const tx = this._db.transaction(() => {
      for (const item of arr) {
        const doc = this.normalizeDoc(item)
        this._insertStmt.run(doc._id, JSON.stringify(doc), doc.createdAt || now, now)
      }
    })

    try {
      tx()
    } catch (err) {
      console.error('[SimpleDB] Insert transaction failed', err)
      throw err
    }

    this.emit('change', 'insert', arr)
    return arr.length === 1 ? arr[0] : arr
  }

  find(query: any = {}): any[] {
    const stmt = this.getSelectStmt(query)
    if (!stmt) return []

    const params = this.buildParams(query)
    const rows = stmt.all(...params)

    const results: any[] = []
    for (const row of rows) {
      const doc = this.parseRow(row)
      if (doc) results.push(doc)
    }
    return results
  }

  findOne(query: any = {}): any {
    const stmt = this.getSelectStmt(query)
    if (!stmt) return null

    const params = this.buildParams(query)
    const row = stmt.get(...params)

    return row ? this.parseRow(row) : null
  }

  findById(id: string): any {
    if (!id) return null
    const row = this._selectByIdStmt.get(id) as any
    return row ? this.parseRow(row) : null
  }

  update(query: any, updates: any): number {
    if (query?._id) {
      const existing = this.findById(query._id)
      if (!existing) return 0

      const merged = { ...existing, ...updates, _id: existing._id, updatedAt: new Date().toISOString() }
      this._updateStmt.run(JSON.stringify(merged), merged.updatedAt, merged._id)
      this.emit('change', 'update', merged)
      return 1
    }

    const matches = this.find(query)
    if (matches.length === 0) return 0

    const tx = this._db.transaction(() => {
      const now = new Date().toISOString()
      for (const doc of matches) {
        const merged = { ...doc, ...updates, _id: doc._id, updatedAt: now }
        this._updateStmt.run(JSON.stringify(merged), now, doc._id)
      }
    })

    try {
      tx()
    } catch (err) {
      console.error('[SimpleDB] Update transaction failed', err)
      throw err
    }

    this.emit('change', 'update', { query, updates })
    return matches.length
  }

  delete(query: any): number {
    if (!query || Object.keys(query).length === 0) return 0

    if (query._id) {
      const result = this._deleteByIdStmt.run(query._id)
      this.emit('change', 'delete', { _id: query._id })
      return result.changes
    }

    const matches = this.find(query)
    if (matches.length === 0) return 0

    const tx = this._db.transaction(() => {
      for (const doc of matches) {
        this._deleteByIdStmt.run(doc._id)
      }
    })

    try {
      tx()
    } catch (err) {
      console.error('[SimpleDB] Delete transaction failed', err)
      throw err
    }

    this.emit('change', 'delete', { query })
    return matches.length
  }

  count(query: any = {}): number {
    if (!query || Object.keys(query).length === 0) {
      const row = this._countAllStmt.get() as any
      return row?.c || 0
    }
    return this.find(query).length
  }

  getStats(): { documentCount: number } {
    const row = this._countAllStmt.get() as any
    return { documentCount: row?.c || 0 }
  }

  destroy(): void {
    this._stmtCache.clear()
    this.removeAllListeners()
  }
}

class SimpleDB extends EventEmitter {
  private readonly _db: Database.Database
  private readonly _dbPath: string
  private readonly _collections = new Map<string, SQLiteCollection>()
  private readonly _cacheSize: number
  private readonly _maxCacheSize: number

  constructor(options: SimpleDBOptions = {}) {
    super()
    this._dbPath = options.dbPath || join(process.cwd(), 'db', 'sey.sqlite')
    ensureDir(join(process.cwd(), 'db'))
    this._cacheSize = typeof options.cacheSize === 'number' ? Math.max(0, options.cacheSize) : 50
    this._maxCacheSize = typeof options.maxCacheSize === 'number' ? Math.max(0, options.maxCacheSize) : 100

    this._db = new Database(this._dbPath)

    try {
      this._db.pragma('journal_mode = WAL')
      this._db.pragma('synchronous = NORMAL')
      this._db.pragma('cache_size = 10000')
      this._db.pragma('temp_store = MEMORY')
      this._db.pragma('mmap_size = 268435456') // 256MB
      this._db.pragma('foreign_keys = ON')
      this._db.pragma('busy_timeout = 30000') // 30 seconds
    } catch {}
  }

  collection(name: string): SQLiteCollection {
    let col = this._collections.get(name)
    if (col) return col

    col = new SQLiteCollection(this._db, name, this._cacheSize)
    col.on('change', (type: string, data: any) => this.emit('change', type, data))
    this._collections.set(name, col)
    return col
  }

  close(): void {
    for (const col of this._collections.values()) {
      col.destroy()
    }
    this._collections.clear()

    try {
      this._db.close()
    } catch {}
  }
}

export { SimpleDB }
