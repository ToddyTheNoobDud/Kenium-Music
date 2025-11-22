import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

let Database: any
const isBun = typeof process !== 'undefined' && !!process.versions?.bun
if (isBun) {
  const mod = require('bun:sqlite')
  Database = mod.default || mod
} else {
  Database = require('better-sqlite3')
}

const VALID_IDENTIFIER = /^[A-Za-z0-9_]+$/

interface QueryOperator {
  $gt?: any; $gte?: any; $lt?: any; $lte?: any; $ne?: any
  $in?: any[]; $nin?: any[]
}
interface Query { [k: string]: any | QueryOperator }
interface FindOptions { limit?: number; skip?: number; sort?: Record<string, 1 | -1>; fields?: string[] }
interface Document { _id: string; createdAt: string; updatedAt: string;[k: string]: any }
interface AtomicUpdate {
  $set?: Record<string, any>
  $inc?: Record<string, number>
  $push?: Record<string, any | any[]>
  $addToSet?: Record<string, any>
  $pull?: Record<string, any>
  $pullAll?: Record<string, any[]>
}

const ensureDir = (dir: string) => !existsSync(dir) && mkdirSync(dir, { recursive: true })
const validateIdentifier = (name: string) => { if (!VALID_IDENTIFIER.test(name)) throw new Error(`Invalid identifier: ${name}`) }
const buildJsonPath = (key: string): string => {
  const parts = key.split('.')
  for (const p of parts) if (!/^[A-Za-z0-9_]+$/.test(p)) throw new Error(`Invalid key component: ${p}`)
  return '$.' + parts.join('.')
}

class SQLiteCollection extends EventEmitter {
  private _db: any
  private _tableName: string
  private _quotedTable: string
  private _cacheSize: number
  private _stmtCache = new Map<string, any>()

  private _insertStmt: any
  private _selectByIdStmt: any
  private _updateByIdRawStmt: any
  private _deleteByIdStmt: any
  private _countAllStmt: any

  constructor(db: any, name: string, cacheSize = 50) {
    super()
    validateIdentifier(name)
    this._db = db
    this._tableName = `col_${name}`
    this._quotedTable = `"${this._tableName}"`
    this._cacheSize = Math.max(0, cacheSize)

    this._db.prepare(`CREATE TABLE IF NOT EXISTS ${this._quotedTable} (
      _id TEXT PRIMARY KEY,
      doc TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )`).run()

    try {
      this._db.prepare(`CREATE INDEX IF NOT EXISTS "${this._tableName}_updated_idx" ON ${this._quotedTable}(updatedAt)`).run()
      this._db.prepare(`CREATE INDEX IF NOT EXISTS "${this._tableName}_created_idx" ON ${this._quotedTable}(createdAt)`).run()
    } catch { }

    this._insertStmt = this._db.prepare(`INSERT INTO ${this._quotedTable} (_id, doc, createdAt, updatedAt)
      VALUES (?, ?, ?, ?) ON CONFLICT(_id) DO UPDATE SET doc=excluded.doc, updatedAt=excluded.updatedAt`)
    this._selectByIdStmt = this._db.prepare(`SELECT doc FROM ${this._quotedTable} WHERE _id = ?`)
    this._updateByIdRawStmt = this._db.prepare(`UPDATE ${this._quotedTable} SET doc = ?, updatedAt = ? WHERE _id = ?`)
    this._deleteByIdStmt = this._db.prepare(`DELETE FROM ${this._quotedTable} WHERE _id = ?`)
    this._countAllStmt = this._db.prepare(`SELECT COUNT(*) as c FROM ${this._quotedTable}`)
  }

  private normalizeDoc(doc: any): Document {
    if (!doc || typeof doc !== 'object') doc = {}
    if (!doc._id) doc._id = randomUUID()
    const now = new Date().toISOString()
    if (!doc.createdAt) doc.createdAt = now
    doc.updatedAt = now
    return doc
  }

  private parseRow(row: any): Document | null {
    if (!row?.doc) return null
    try { return JSON.parse(row.doc) } catch { return null }
  }

  private buildWhereClause(query: Query): { where: string; params: any[] } {
    const conditions: string[] = []
    const params: any[] = []
    for (const [key, value] of Object.entries(query)) {
      const path = buildJsonPath(key)
      if (value === null || value === undefined) {
        conditions.push(`json_extract(doc, ?) IS NULL`)
        params.push(path)
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [op, opValue] of Object.entries(value)) {
          switch (op) {
            case '$gt': conditions.push(`json_extract(doc, ?) > ?`); params.push(path, opValue); break
            case '$gte': conditions.push(`json_extract(doc, ?) >= ?`); params.push(path, opValue); break
            case '$lt': conditions.push(`json_extract(doc, ?) < ?`); params.push(path, opValue); break
            case '$lte': conditions.push(`json_extract(doc, ?) <= ?`); params.push(path, opValue); break
            case '$ne': conditions.push(`json_extract(doc, ?) != ?`); params.push(path, opValue); break
            case '$in':
              if (Array.isArray(opValue) && opValue.length) {
                const ph = opValue.map(() => '?').join(',')
                conditions.push(`json_extract(doc, ?) IN (${ph})`)
                params.push(path, ...opValue)
              } else conditions.push('0=1')
              break
            case '$nin':
              if (Array.isArray(opValue) && opValue.length) {
                const ph = opValue.map(() => '?').join(',')
                conditions.push(`json_extract(doc, ?) NOT IN (${ph})`)
                params.push(path, ...opValue)
              }
              break
          }
        }
      } else {
        conditions.push(`json_extract(doc, ?) = ?`)
        params.push(path, value)
      }
    }
    return { where: conditions.length ? conditions.join(' AND ') : '1=1', params }
  }

  private getCachedStmt(sql: string) {
    if (this._cacheSize <= 0) return this._db.prepare(sql)
    let stmt = this._stmtCache.get(sql)
    if (!stmt) {
      stmt = this._db.prepare(sql)
      if (this._stmtCache.size >= this._cacheSize) this._stmtCache.delete(this._stmtCache.keys().next().value)
      this._stmtCache.set(sql, stmt)
    }
    return stmt
  }

  insert(docs: Document | Document[]): Document | Document[] {
    const arr = Array.isArray(docs) ? docs : [docs]
    const normalized = arr.map(d => this.normalizeDoc(d))
    const tx = this._db.transaction(() => {
      for (const doc of normalized) this._insertStmt.run(doc._id, JSON.stringify(doc), doc.createdAt, doc.updatedAt)
    })
    tx()
    this.emit('change', 'insert', normalized)
    return Array.isArray(docs) ? normalized : normalized[0]
  }

  find<T = Document>(query: Query = {}, options: FindOptions = {}): T[] {
    const { where, params } = this.buildWhereClause(query)
    let sql = `SELECT doc FROM ${this._quotedTable} WHERE ${where}`
    const allParams: any[] = [...params]

    if (options.sort) {
      const sorts: string[] = []
      for (const [key, dir] of Object.entries(options.sort)) {
        if (key === 'createdAt' || key === 'updatedAt') {
          sorts.push(`${key} ${dir === 1 ? 'ASC' : 'DESC'}`)
        } else {
          sorts.push(`json_extract(doc, ?) ${dir === 1 ? 'ASC' : 'DESC'}`)
          allParams.push(buildJsonPath(key))
        }
      }
      if (sorts.length) sql += ` ORDER BY ${sorts.join(', ')}`
    }
    if (options.limit) sql += ` LIMIT ${options.limit}`
    if (options.skip) sql += ` OFFSET ${options.skip}`

    const stmt = this.getCachedStmt(sql)
    const rows = stmt.all(...allParams)
    const results = new Array(rows.length)

    for (let i = 0; i < rows.length; i++) {
      const doc = JSON.parse(rows[i].doc)
      if (options.fields?.length) {
        const proj: any = { _id: doc._id }
        for (const f of options.fields) if (f in doc) proj[f] = doc[f]
        results[i] = proj
      } else results[i] = doc
    }
    return results as T[]
  }

  findOne<T = Document>(q: Query = {}, o: FindOptions = {}) { return this.find<T>(q, { ...o, limit: 1 })[0] || null }
  findById<T = Document>(id: string): T | null {
    if (!id) return null
    const row = this._selectByIdStmt.get(id)
    return row ? this.parseRow(row) as T : null
  }

  updateAtomic(query: Query, updates: AtomicUpdate): number {
    if (!query || !Object.keys(query).length) throw new Error('Update query cannot be empty')

    const complex = updates.$inc || updates.$push || updates.$pull || updates.$addToSet || updates.$pullAll ||
      (updates.$set && Object.keys(updates.$set).some(k => k.includes('.'))) ||
      (updates.$set && Object.values(updates.$set).some(v => typeof v === 'boolean'))

    return complex ? this.performJsUpdate(query, updates) : this.performNativeSqlUpdate(query, updates.$set!)
  }

  private performNativeSqlUpdate(query: Query, setFields: Record<string, any>): number {
    const { where, params } = this.buildWhereClause(query)
    const now = new Date().toISOString()
    const jsonArgs: string[] = ['doc']
    const jsonParams: any[] = []

    for (const [key, value] of Object.entries(setFields)) {
      jsonArgs.push(`'${buildJsonPath(key)}'`, '?')
      jsonParams.push(value && typeof value === 'object' ? JSON.stringify(value) : value)
    }

    const sql = `UPDATE ${this._quotedTable}
      SET doc = json_set(${jsonArgs.join(',')}), updatedAt = ?
      WHERE ${where}`

    const stmt = this._db.prepare(sql)
    const res = stmt.run(...jsonParams, now, ...params)
    if (res.changes) this.emit('change', 'update', { query, count: res.changes, type: 'native' })
    return res.changes
  }

  private performJsUpdate(query: Query, updates: AtomicUpdate): number {
    const { where, params } = this.buildWhereClause(query)
    const rows = this._db.prepare(`SELECT _id, doc FROM ${this._quotedTable} WHERE ${where}`).all(...params)
    if (!rows.length) return 0

    const now = new Date().toISOString()
    let changes = 0
    const tx = this._db.transaction(() => {
      for (const row of rows) {
        const doc = JSON.parse(row.doc)
        let modified = false

        if (updates.$set) { Object.assign(doc, updates.$set); modified = true }
        if (updates.$inc) for (const [k, v] of Object.entries(updates.$inc)) { doc[k] = (doc[k] ?? 0) + v; modified = true }
        if (updates.$push) for (const [k, v] of Object.entries(updates.$push)) { doc[k] ??= []; doc[k].push(...(Array.isArray(v) ? v : [v])); modified = true }
        if (updates.$addToSet) for (const [k, v] of Object.entries(updates.$addToSet ?? {})) { doc[k] ??= []; if (!doc[k].includes(v)) doc[k].push(v), modified = true }
        if (updates.$pull) for (const [k, v] of Object.entries(updates.$pull ?? {})) { if (Array.isArray(doc[k])) doc[k] = doc[k].filter(x => x !== v), modified = true }
        if (updates.$pullAll) for (const [k, vs] of Object.entries(updates.$pullAll ?? {})) { if (Array.isArray(doc[k])) doc[k] = doc[k].filter(x => !vs.includes(x)), modified = true }

        if (modified) {
          doc.updatedAt = now
          this._updateByIdRawStmt.run(JSON.stringify(doc), now, doc._id)
          changes++
        }
      }
    })
    tx()
    if (changes) this.emit('change', 'update', { query, updates, count: changes })
    return changes
  }

  update(query: Query, updates: Partial<Document>): number {
    return this.updateAtomic(query, { $set: updates })
  }

  delete(query: Query): number {
    if (!query || !Object.keys(query).length) throw new Error('Delete query cannot be empty')
    const { where, params } = this.buildWhereClause(query)
    const res = this.getCachedStmt(`DELETE FROM ${this._quotedTable} WHERE ${where}`).run(...params)
    if (res.changes) this.emit('change', 'delete', { query, count: res.changes })
    return res.changes
  }

  count(query: Query = {}): number {
    if (!Object.keys(query).length) return this._countAllStmt.get().c ?? 0
    const { where, params } = this.buildWhereClause(query)
    return this.getCachedStmt(`SELECT COUNT(*) as c FROM ${this._quotedTable} WHERE ${where}`).get(...params).c ?? 0
  }

  // FINAL FIX: No parameters in DDL expressions (works on Bun + better-sqlite3)
  addGeneratedColumn(field: string, type = 'TEXT') {
    const colName = field.split('.').pop()!
    validateIdentifier(colName)
    const path = buildJsonPath(field)
    try {
      const ddl = `ALTER TABLE ${this._quotedTable} ADD COLUMN "${colName}" ${type} GENERATED ALWAYS AS (json_extract(doc, '${path}'))`
      this._db.prepare(ddl).run()
      this._db.prepare(`CREATE INDEX IF NOT EXISTS "${this._tableName}_${colName}_idx" ON ${this._quotedTable}("${colName}")`).run()
    } catch (e) {
      console.warn('Generated column may already exist:', e)
    }
  }

  createIndex(field: string, name?: string) {
    const indexName = name || `${this._tableName}_${field.replace(/\./g, '_')}_idx`
    validateIdentifier(indexName)
    const path = buildJsonPath(field)
    const sql = `CREATE INDEX IF NOT EXISTS "${indexName}" ON ${this._quotedTable}(json_extract(doc, '${path}'))`
    try {
      this._db.prepare(sql).run()
    } catch (e) {
      console.warn(`Failed to create index ${indexName}:`, e)
    }
  }

  getStats() { return { documentCount: this._countAllStmt.get().c ?? 0, tableName: this._tableName } }
  destroy() { this._stmtCache.clear(); this.removeAllListeners() }
}

interface SimpleDBOptions { dbPath?: string; cacheSize?: number }
class SimpleDB extends EventEmitter {
  private _dbPath: string
  private _cacheSize: number
  private _collections = new Map<string, SQLiteCollection>()
  private _db: any

  constructor(options: SimpleDBOptions = {}) {
    super()
    this._dbPath = options.dbPath || join(process.cwd(), 'db', 'sey.sqlite')
    ensureDir(join(process.cwd(), 'db'))
    this._cacheSize = Math.max(0, options.cacheSize ?? 50)

    this._db = new Database(this._dbPath)
    const pragmas = ['journal_mode = WAL', 'synchronous = NORMAL', 'cache_size = 10000',
      'temp_store = MEMORY', 'mmap_size = 268435456', 'foreign_keys = ON', 'busy_timeout = 30000']
    if (isBun) pragmas.forEach(p => this._db.run(`PRAGMA ${p}`))
    else pragmas.forEach(p => this._db.pragma(p))
  }

  collection(name: string): SQLiteCollection {
    let col = this._collections.get(name)
    if (col) return col
    col = new SQLiteCollection(this._db, name, this._cacheSize)
    col.on('change', (...a) => this.emit('change', ...a))
    col.on('error', e => this.emit('error', e))
    this._collections.set(name, col)
    return col
  }

  transaction(fn: () => void) { this._db.transaction(fn)() }
  close() {
    this._collections.forEach(c => c.destroy())
    this._collections.clear()
    try { this._db.close() } catch { }
  }
}

export { SimpleDB }
