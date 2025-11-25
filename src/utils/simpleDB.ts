import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

let Database: any
if (process.isBun) {
  const mod = require('bun:sqlite')
  Database = mod.default || mod
} else {
  Database = require('better-sqlite3')
}

// Constants
const VALID_IDENTIFIER = /^[A-Za-z0-9_]+$/
const JSON_PATH_COMPONENT = /^[A-Za-z0-9_]+$/

// Types
interface QueryOperator {
  $gt?: any
  $gte?: any
  $lt?: any
  $lte?: any
  $ne?: any
  $in?: any[]
  $nin?: any[]
}

type QueryValue = any | QueryOperator

interface Query {
  [key: string]: QueryValue
}

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
  $set?: { [key: string]: any }
  $inc?: { [key: string]: number }
  $push?: { [key: string]: any }
  $pull?: { [key: string]: any }
}

// Utility functions
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
      throw new Error(`Invalid key component: ${part}`)
    }
  }
  return `$.${parts.join('.')}`
}

const generateId = (): string => {
  const timestamp = Date.now().toString(36)
  const random = randomBytes(6).toString('hex')
  return `${timestamp}_${random}`
}

class SQLiteCollection extends EventEmitter {
  private _db: any
  private _tableName: string
  private _quotedTable: string
  private _cacheSize: number
  private _stmtCache: Map<string, any>
  private _insertStmt: any
  private _selectAllStmt: any
  private _selectByIdStmt: any
  private _updateByIdStmt: any
  private _deleteByIdStmt: any
  private _countAllStmt: any

  constructor(db: any, name: string, cacheSize = 50) {
    super()
    validateIdentifier(name)
    this._db = db
    this._tableName = `col_${name}`
    this._quotedTable = `"${this._tableName}"`
    this._cacheSize = Math.max(0, cacheSize)
    this._stmtCache = new Map()

    this._db.prepare(
      `CREATE TABLE IF NOT EXISTS ${this._quotedTable} (
        _id TEXT PRIMARY KEY,
        doc TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )`
    ).run()

    try {
      this._db.prepare(
        `CREATE INDEX IF NOT EXISTS "${this._tableName}_updated_idx"
         ON ${this._quotedTable}(updatedAt)`
      ).run()
      this._db.prepare(
        `CREATE INDEX IF NOT EXISTS "${this._tableName}_created_idx"
         ON ${this._quotedTable}(createdAt)`
      ).run()
    } catch (err) {
      console.warn(`Failed to create indexes for ${name}:`, err)
    }

    this._insertStmt = this._db.prepare(
      `INSERT INTO ${this._quotedTable} (_id, doc, createdAt, updatedAt)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(_id) DO UPDATE SET
         doc = excluded.doc,
         updatedAt = excluded.updatedAt`
    )

    this._selectAllStmt = this._db.prepare(
      `SELECT _id, doc FROM ${this._quotedTable}`
    )

    this._selectByIdStmt = this._db.prepare(
      `SELECT _id, doc FROM ${this._quotedTable} WHERE _id = ?`
    )

    this._updateByIdStmt = this._db.prepare(
      `UPDATE ${this._quotedTable} SET doc = ?, updatedAt = ? WHERE _id = ?`
    )

    this._deleteByIdStmt = this._db.prepare(
      `DELETE FROM ${this._quotedTable} WHERE _id = ?`
    )

    this._countAllStmt = this._db.prepare(
      `SELECT COUNT(*) as c FROM ${this._quotedTable}`
    )
  }

  normalizeDoc(doc: any): Document {
    if (!doc || typeof doc !== 'object') doc = {}
    if (!doc._id) doc._id = generateId()
    const now = new Date().toISOString()
    if (!doc.createdAt) doc.createdAt = now
    doc.updatedAt = now
    return doc
  }

  parseRow(row: any): Document | null {
    try {
      const parsed = JSON.parse(row.doc)
      if (typeof parsed === 'object' && parsed !== null) {
        if (!parsed._id) parsed._id = row._id
        return parsed
      }
      return null
    } catch {
      return null
    }
  }

  buildWhereClause(query: Query): { where: string; params: any[] } {
    const conditions: string[] = []
    const params: any[] = []

    for (const [key, value] of Object.entries(query)) {
      const path = buildJsonPath(key)

      if (value === null || value === undefined) {
        conditions.push(`json_extract(doc, ?) IS NULL`)
        params.push(path)
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        for (const [op, opValue] of Object.entries(value)) {
          switch (op) {
            case '$gt':
              conditions.push(`json_extract(doc, ?) > ?`)
              params.push(path, opValue)
              break
            case '$gte':
              conditions.push(`json_extract(doc, ?) >= ?`)
              params.push(path, opValue)
              break
            case '$lt':
              conditions.push(`json_extract(doc, ?) < ?`)
              params.push(path, opValue)
              break
            case '$lte':
              conditions.push(`json_extract(doc, ?) <= ?`)
              params.push(path, opValue)
              break
            case '$ne':
              conditions.push(`json_extract(doc, ?) != ?`)
              params.push(path, opValue)
              break
            case '$in':
              if (Array.isArray(opValue) && opValue.length > 0) {
                const placeholders = opValue.map(() => '?').join(',')
                conditions.push(`json_extract(doc, ?) IN (${placeholders})`)
                params.push(path, ...opValue)
              }
              break
            case '$nin':
              if (Array.isArray(opValue) && opValue.length > 0) {
                const placeholders = opValue.map(() => '?').join(',')
                conditions.push(`json_extract(doc, ?) NOT IN (${placeholders})`)
                params.push(path, ...opValue)
              }
              break
          }
        }
      } else if (typeof value === 'boolean') {
        conditions.push(`CAST(json_extract(doc, ?) AS INTEGER) = ?`)
        params.push(path, value ? 1 : 0)
      } else if (typeof value === 'number' || typeof value === 'string') {
        conditions.push(`json_extract(doc, ?) = ?`)
        params.push(path, value)
      } else {
        conditions.push(`json_extract(doc, ?) = json(?)`)
        params.push(path, JSON.stringify(value))
      }
    }

    return {
      where: conditions.length > 0 ? conditions.join(' AND ') : '1=1',
      params
    }
  }

  getSelectStmt(query: Query, options: FindOptions = {}): { stmt: any; params: any[] } {
    const { where, params } = this.buildWhereClause(query)

    let sql = `SELECT _id, doc FROM ${this._quotedTable}`

    if (where !== '1=1') {
      sql += ` WHERE ${where}`
    }

    if (options.sort) {
      const sortClauses = Object.entries(options.sort).map(([key, direction]) => {
        const path = buildJsonPath(key)
        return `json_extract(doc, '${path}') ${direction === 1 ? 'ASC' : 'DESC'}`
      })
      if (sortClauses.length > 0) {
        sql += ` ORDER BY ${sortClauses.join(', ')}`
      }
    }

    if (options.limit) {
      sql += ` LIMIT ${options.limit}`
    }
    if (options.skip) {
      sql += ` OFFSET ${options.skip}`
    }

    if (!options.limit && !options.skip && !options.sort) {
      const cacheKey = where
      if (this._cacheSize > 0 && this._stmtCache.has(cacheKey)) {
        return { stmt: this._stmtCache.get(cacheKey), params }
      }

      const stmt = this._db.prepare(sql)

      if (this._cacheSize > 0) {
        if (this._stmtCache.size >= this._cacheSize) {
          const firstKey = this._stmtCache.keys().next().value
          if (firstKey) this._stmtCache.delete(firstKey)
        }
        this._stmtCache.set(cacheKey, stmt)
      }

      return { stmt, params }
    }

    return { stmt: this._db.prepare(sql), params }
  }

  getCountStmt(query: Query): { stmt: any; params: any[] } {
    const { where, params } = this.buildWhereClause(query)

    let sql = `SELECT COUNT(*) as c FROM ${this._quotedTable}`

    if (where !== '1=1') {
      sql += ` WHERE ${where}`
    }

    const stmt = this._db.prepare(sql)
    return { stmt, params }
  }

  insert(docs: Document | Document[]): Document | Document[] {
    const arr = Array.isArray(docs) ? docs : [docs]
    const normalized = arr.map(d => this.normalizeDoc(d))

    try {
      const tx = this._db.transaction(() => {
        for (const doc of normalized) {
          this._insertStmt.run(
            doc._id,
            JSON.stringify(doc),
            doc.createdAt,
            doc.updatedAt
          )
        }
      })
      tx()
      this.emit('change', 'insert', normalized)
      return Array.isArray(docs) ? normalized : normalized[0]
    } catch (error) {
      this.emit('error', error)
      throw error
    }
  }

  find(query: Query = {}, options: FindOptions = {}): Document[] {
    try {
      const { stmt, params } = this.getSelectStmt(query, options)
      const rows = stmt.all(...params)
      const results: Document[] = []

      for (const row of rows) {
        const doc = this.parseRow(row)
        if (doc) {
          if (options.fields && options.fields.length > 0) {
            const projected: any = { _id: doc._id }
            for (const field of options.fields) {
              if (field in doc) projected[field] = doc[field]
            }
            results.push(projected)
          } else {
            results.push(doc)
          }
        }
      }

      return results
    } catch (error) {
      this.emit('error', error)
      throw error
    }
  }

  findOne(query: Query = {}, options: FindOptions = {}): Document | null {
    const results = this.find(query, { ...options, limit: 1 })
    return results.length > 0 ? results[0] : null
  }

  findById(id: string): Document | null {
    if (!id) return null
    try {
      const row = this._selectByIdStmt.get(id)
      return row ? this.parseRow(row) : null
    } catch (error) {
      this.emit('error', error)
      throw error
    }
  }

  updateAtomic(query: Query, updates: AtomicUpdate): number {
    if (!query || Object.keys(query).length === 0) {
      throw new Error('Update query cannot be empty')
    }

    const now = new Date().toISOString()

    try {
      if (query._id && Object.keys(query).length === 1) {
        const id = query._id as string
        const row = this._selectByIdStmt.get(id)
        if (!row) return 0

        const doc = this.parseRow(row)
        if (!doc) return 0

        const merged: any = { ...doc }

        if (updates.$set) {
          for (const [key, value] of Object.entries(updates.$set)) {
            merged[key] = value
          }
        }

        if (updates.$inc) {
          for (const [key, value] of Object.entries(updates.$inc)) {
            merged[key] = (typeof merged[key] === 'number' ? merged[key] : 0) + value
          }
        }

        if (updates.$push) {
          for (const [key, value] of Object.entries(updates.$push)) {
            if (!Array.isArray(merged[key])) merged[key] = []
            merged[key].push(value)
          }
        }

        if (updates.$pull) {
          for (const [key, value] of Object.entries(updates.$pull)) {
            if (Array.isArray(merged[key])) {
              merged[key] = merged[key].filter((item: any) => item !== value)
            }
          }
        }

        merged.updatedAt = now

        this._updateByIdStmt.run(JSON.stringify(merged), now, merged._id)
        this.emit('change', 'update', { query, updates })
        return 1
      }

      const { where, params: whereParams } = this.buildWhereClause(query)
      const selectSql = `SELECT _id FROM ${this._quotedTable} WHERE ${where}`
      const selectStmt = this._db.prepare(selectSql)
      const rows = selectStmt.all(...whereParams)

      if (rows.length === 0) return 0

      const tx = this._db.transaction(() => {
        for (const row of rows) {
          this.updateAtomic({ _id: row._id }, updates)
        }
      })

      tx()
      return rows.length
    } catch (error) {
      this.emit('error', error)
      throw error
    }
  }

  update(query: Query, updates: Partial<Document>): number {
    if (!query || Object.keys(query).length === 0) {
      throw new Error('Update query cannot be empty')
    }

    const now = new Date().toISOString()

    try {
      if (query._id && Object.keys(query).length === 1) {
        const existing = this.findById(query._id as string)
        if (!existing) return 0

        const merged = {
          ...existing,
          ...updates,
          _id: existing._id,
          createdAt: existing.createdAt,
          updatedAt: now
        }

        this._updateByIdStmt.run(JSON.stringify(merged), now, merged._id)
        this.emit('change', 'update', { query, doc: merged })
        return 1
      }

      const { where, params } = this.buildWhereClause(query)
      const selectSql = `SELECT _id, doc FROM ${this._quotedTable} WHERE ${where}`
      const selectStmt = this._db.prepare(selectSql)
      const rows = selectStmt.all(...params)

      if (rows.length === 0) return 0

      const tx = this._db.transaction(() => {
        for (const row of rows) {
          const doc = this.parseRow(row)
          if (doc) {
            const merged = {
              ...doc,
              ...updates,
              _id: doc._id,
              createdAt: doc.createdAt,
              updatedAt: now
            }
            this._updateByIdStmt.run(JSON.stringify(merged), now, merged._id)
          }
        }
      })

      tx()
      this.emit('change', 'update', { query, updates, count: rows.length })
      return rows.length
    } catch (error) {
      this.emit('error', error)
      throw error
    }
  }

  delete(query: Query): number {
    if (!query || Object.keys(query).length === 0) {
      throw new Error('Delete query cannot be empty')
    }

    try {
      if (query._id && Object.keys(query).length === 1) {
        const result = this._deleteByIdStmt.run(query._id)
        if (result.changes > 0) {
          this.emit('change', 'delete', { _id: query._id })
        }
        return result.changes
      }

      const { where, params } = this.buildWhereClause(query)
      const deleteSql = `DELETE FROM ${this._quotedTable} WHERE ${where}`
      const deleteStmt = this._db.prepare(deleteSql)
      const result = deleteStmt.run(...params)

      if (result.changes > 0) {
        this.emit('change', 'delete', { query, count: result.changes })
      }

      return result.changes
    } catch (error) {
      this.emit('error', error)
      throw error
    }
  }

  count(query: Query = {}): number {
    try {
      if (!query || Object.keys(query).length === 0) {
        const row = this._countAllStmt.get()
        return row?.c || 0
      }

      const { stmt, params } = this.getCountStmt(query)
      const row = stmt.get(...params)
      return row?.c || 0
    } catch (error) {
      this.emit('error', error)
      throw error
    }
  }

  createIndex(field: string, name?: string): void {
    validateIdentifier(field)
    const indexName = name || `${this._tableName}_${field}_idx`
    validateIdentifier(indexName)

    const path = buildJsonPath(field)
    const sql = `CREATE INDEX IF NOT EXISTS "${indexName}"
                 ON ${this._quotedTable}(json_extract(doc, '${path}'))`

    try {
      this._db.prepare(sql).run()
    } catch (error) {
      console.warn(`Failed to create index ${indexName}:`, error)
      throw error
    }
  }

  getStats(): { documentCount: number; tableName: string } {
    const row = this._countAllStmt.get()
    return {
      documentCount: row?.c || 0,
      tableName: this._tableName
    }
  }

  destroy(): void {
    this._stmtCache.clear()
    this.removeAllListeners()
  }
}

interface SimpleDBOptions {
  dbPath?: string
  cacheSize?: number
  enableWAL?: boolean
}

class SimpleDB extends EventEmitter {
  private _dbPath: string
  private _cacheSize: number
  private _collections: Map<string, SQLiteCollection>
  private _db: any

  constructor(options: SimpleDBOptions = {}) {
    super()
    this._dbPath = options.dbPath || join(process.cwd(), 'db', 'sey.sqlite')
    ensureDir(join(process.cwd(), 'db'))
    this._cacheSize = typeof options.cacheSize === 'number' ? Math.max(0, options.cacheSize) : 50
    this._collections = new Map()

    try {
      this._db = new Database(this._dbPath)

      if (process.isBun) {
        this._db.run('PRAGMA journal_mode = WAL')
        this._db.run('PRAGMA synchronous = NORMAL')
        this._db.run('PRAGMA cache_size = 10000')
        this._db.run('PRAGMA temp_store = MEMORY')
        this._db.run('PRAGMA mmap_size = 268435456')
        this._db.run('PRAGMA foreign_keys = ON')
        this._db.run('PRAGMA busy_timeout = 30000')
      } else {
        this._db.pragma('journal_mode = WAL')
        this._db.pragma('synchronous = NORMAL')
        this._db.pragma('cache_size = 10000')
        this._db.pragma('temp_store = MEMORY')
        this._db.pragma('mmap_size = 268435456')
        this._db.pragma('foreign_keys = ON')
        this._db.pragma('busy_timeout = 30000')
      }
    } catch (error) {
      this.emit('error', error)
      throw error
    }
  }

  collection(name: string): SQLiteCollection {
    let col = this._collections.get(name)
    if (col) return col

    col = new SQLiteCollection(this._db, name, this._cacheSize)
    col.on('change', (type, data) => this.emit('change', type, data))
    col.on('error', (error) => this.emit('error', error))
    this._collections.set(name, col)

    return col
  }

  transaction(fn: () => void): void {
    try {
      const tx = this._db.transaction(fn)
      tx()
    } catch (error) {
      this.emit('error', error)
      throw error
    }
  }

  close(): void {
    for (const col of this._collections.values()) {
      col.destroy()
    }
    this._collections.clear()

    try {
      this._db.close()
    } catch (error) {
      console.warn('Error closing database:', error)
    }
  }
}

export { SimpleDB }
