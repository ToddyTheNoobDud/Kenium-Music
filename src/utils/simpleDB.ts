import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const IS_BUN = typeof process !== 'undefined' && !!process.versions?.bun
const DatabaseConstructor = IS_BUN
  ? require('bun:sqlite').Database
  : require('better-sqlite3')

const VALID_KEY = /^[a-zA-Z0-9_]+$/

interface QueryOperator {
  $gt?: any; $gte?: any; $lt?: any; $lte?: any; $ne?: any
  $in?: any[]; $nin?: any[]
}
interface Query { [k: string]: any | QueryOperator }
interface FindOptions { limit?: number; skip?: number; sort?: Record<string, 1 | -1>; fields?: string[] }
interface Document { _id: string; createdAt: string; updatedAt: string; [k: string]: any }
interface AtomicUpdate {
  $set?: Record<string, any>
  $inc?: Record<string, number>
  $push?: Record<string, any | any[]>
  $addToSet?: Record<string, any>
  $pull?: Record<string, any>
  $pullAll?: Record<string, any[]>
}

const ensureDir = (dir: string) => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

const validateId = (name: string) => {
  if (!VALID_KEY.test(name)) throw new Error(`Invalid identifier: ${name}`)
}

const buildJsonPath = (key: string): string => {
  const parts = key.split('.')
  for (const p of parts) if (!VALID_KEY.test(p)) throw new Error(`Invalid key component: ${key}`)
  return `$.${key}`
}

class SQLiteCollection extends EventEmitter {
  private readonly _db: any
  private readonly _table: string
  private readonly _quotedTable: string
  private readonly _stmtCache = new Map<string, any>()
  private readonly _cacheLimit: number

  private readonly _stmts: {
    insert: any
    selectId: any
    updateRaw: any
    delete: any
    countAll: any
  }

  constructor(db: any, name: string, cacheSize = 50) {
    super()
    validateId(name)

    this._db = db
    this._table = `col_${name}`
    this._quotedTable = `"${this._table}"`
    this._cacheLimit = cacheSize

    db.exec(`
      CREATE TABLE IF NOT EXISTS ${this._quotedTable} (
        _id TEXT PRIMARY KEY,
        doc TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "${this._table}_up_idx"
      ON ${this._quotedTable}(updatedAt)
    `)

    this._stmts = {
      insert: db.prepare(`
        INSERT INTO ${this._quotedTable}
        (_id, doc, createdAt, updatedAt)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(_id) DO UPDATE SET
          doc = excluded.doc,
          updatedAt = excluded.updatedAt
      `),
      selectId: db.prepare(`SELECT doc FROM ${this._quotedTable} WHERE _id = ?`),
      updateRaw: db.prepare(`UPDATE ${this._quotedTable} SET doc = ?, updatedAt = ? WHERE _id = ?`),
      delete: db.prepare(`DELETE FROM ${this._quotedTable} WHERE _id = ?`),
      countAll: db.prepare(`SELECT COUNT(*) as c FROM ${this._quotedTable}`)
    }
  }

  private _getStmt(sql: string) {
    if (this._cacheLimit <= 0) return this._db.prepare(sql)
    let stmt = this._stmtCache.get(sql)
    if (!stmt) {
      stmt = this._db.prepare(sql)
      if (this._stmtCache.size >= this._cacheLimit)
        this._stmtCache.delete(this._stmtCache.keys().next().value)
      this._stmtCache.set(sql, stmt)
    }
    return stmt
  }

  private _normalize(doc: any): Document {
    const now = new Date().toISOString()
    return {
      _id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      ...(typeof doc === 'object' ? doc : {})
    }
  }

  private _where(query: Query) {
    const conditions: string[] = []
    const params: any[] = []

    for (const [key, value] of Object.entries(query)) {
      const path = buildJsonPath(key)

      if (value === null || value === undefined) {
        conditions.push(`json_extract(doc, ?) IS NULL`)
        params.push(path)
        continue
      }

      if (typeof value === 'object' && !Array.isArray(value)) {
        for (const [op, opVal] of Object.entries(value)) {
          if (op === '$in' || op === '$nin') {
            if (Array.isArray(opVal) && opVal.length) {
              const placeholders = opVal.map(() => '?').join(',')
              conditions.push(`json_extract(doc, ?) ${op === '$in' ? 'IN' : 'NOT IN'} (${placeholders})`)
              params.push(path, ...opVal)
            } else {
              conditions.push(op === '$in' ? '0=1' : '1=1')
            }
          } else {
            const sqlOp = {
              $gt: '>',
              $gte: '>=',
              $lt: '<',
              $lte: '<=',
              $ne: '!='
            }[op]
            if (sqlOp) {
              conditions.push(`json_extract(doc, ?) ${sqlOp} ?`)
              params.push(path, opVal)
            }
          }
        }
      } else {
        conditions.push(`json_extract(doc, ?) = ?`)
        params.push(path, value)
      }
    }

    return {
      sql: conditions.length ? conditions.join(' AND ') : '1=1',
      params
    }
  }

  insert(data: any | any[]) {
    const arr = Array.isArray(data) ? data : [data]
    const docs = arr.map(d => this._normalize(d))

    const tx = this._db.transaction(() => {
      for (const d of docs)
        this._stmts.insert.run(d._id, JSON.stringify(d), d.createdAt, d.updatedAt)
    })
    tx()

    this.emit('change', 'insert', docs)
    return Array.isArray(data) ? docs : docs[0]
  }

  findById(id: string) {
    if (!id) return null
    const row = this._stmts.selectId.get(id)
    return row ? JSON.parse(row.doc) : null
  }

  findOne(query: Query = {}, options: FindOptions = {}) {
    const result = this.find(query, { ...options, limit: 1 })
    return result[0] || null
  }

  find(query: Query = {}, options: FindOptions = {}) {
    const { sql: whereSql, params } = this._where(query)
    let sql = `SELECT doc FROM ${this._quotedTable} WHERE ${whereSql}`

    if (options.sort) {
      const sortParts: string[] = []
      for (const [key, dir] of Object.entries(options.sort)) {
        if (key === 'createdAt' || key === 'updatedAt') {
          sortParts.push(`${key} ${dir === 1 ? 'ASC' : 'DESC'}`)
        } else {
          sortParts.push(`json_extract(doc, ?) ${dir === 1 ? 'ASC' : 'DESC'}`)
          params.push(buildJsonPath(key))
        }
      }
      if (sortParts.length) sql += ` ORDER BY ${sortParts.join(', ')}`
    }

    if (options.limit !== undefined) sql += ` LIMIT ${Math.max(options.limit, 0)}`
    if (options.skip !== undefined) sql += ` OFFSET ${Math.max(options.skip, 0)}`

    const rows = this._getStmt(sql).all(...params)

    if (options.fields?.length) {
      return rows.map((r: any) => {
        const doc = JSON.parse(r.doc)
        const out: any = { _id: doc._id }
        for (const f of options.fields) if (f in doc) out[f] = doc[f]
        return out
      })
    }

    return rows.map((r: any) => JSON.parse(r.doc))
  }

  count(query: Query = {}) {
    if (!Object.keys(query).length) return this._stmts.countAll.get().c
    const { sql, params } = this._where(query)
    return this._getStmt(`SELECT COUNT(*) as c FROM ${this._quotedTable} WHERE ${sql}`).get(...params).c
  }

  delete(query: Query) {
    if (!Object.keys(query).length) throw new Error('Delete query cannot be empty')
    const { sql, params } = this._where(query)
    const res = this._getStmt(`DELETE FROM ${this._quotedTable} WHERE ${sql}`).run(...params)
    if (res.changes) this.emit('change', 'delete', { query, count: res.changes })
    return res.changes
  }

  update(query: Query, updates: Partial<Document>) {
    return this.updateAtomic(query, { $set: updates })
  }

  updateAtomic(query: Query, updates: AtomicUpdate) {
    if (!Object.keys(query).length) throw new Error('Update query cannot be empty')

    const isComplex =
      updates.$inc || updates.$push || updates.$addToSet ||
      updates.$pull || updates.$pullAll ||
      (updates.$set && Object.keys(updates.$set).some(k => k.includes('.')))

    return isComplex
      ? this._updateJs(query, updates)
      : this._updateNative(query, updates.$set || {})
  }

  private _updateNative(query: Query, setFields: Record<string, any>) {
    const { sql, params } = this._where(query)
    const now = new Date().toISOString()

    const jsonArgs: string[] = ['doc']
    const jsonParams: any[] = []

    for (const [k, v] of Object.entries(setFields)) {
      jsonArgs.push(`'${buildJsonPath(k)}'`, '?')
      jsonParams.push(JSON.stringify(v))
    }

    const stmtSql = `
      UPDATE ${this._quotedTable}
      SET doc = json_set(${jsonArgs.join(', ')}),
          updatedAt = ?
      WHERE ${sql}
    `

    const res = this._db.prepare(stmtSql).run(...jsonParams, now, ...params)

    if (res.changes)
      this.emit('change', 'update', { query, count: res.changes, type: 'native' })

    return res.changes
  }

  private _updateJs(query: Query, updates: AtomicUpdate) {
    const { sql, params } = this._where(query)
    const BATCH = 500
    let offset = 0
    let changes = 0
    const now = new Date().toISOString()

    while (true) {
      const rows = this._db.prepare(`
        SELECT _id, doc FROM ${this._quotedTable}
        WHERE ${sql}
        LIMIT ? OFFSET ?
      `).all(...params, BATCH, offset)

      if (!rows.length) break

      const tx = this._db.transaction(() => {
        for (const row of rows) {
          const doc = JSON.parse(row.doc)
          let modified = false

          if (updates.$set) { Object.assign(doc, updates.$set); modified = true }
          if (updates.$inc) for (const [k, v] of Object.entries(updates.$inc)) {
            doc[k] = (doc[k] ?? 0) + v
            modified = true
          }
          if (updates.$push) for (const [k, v] of Object.entries(updates.$push)) {
            doc[k] ??= []
            doc[k].push(...(Array.isArray(v) ? v : [v]))
            modified = true
          }
          if (updates.$addToSet) for (const [k, v] of Object.entries(updates.$addToSet)) {
            doc[k] ??= []
            if (!doc[k].includes(v)) doc[k].push(v), modified = true
          }
          if (updates.$pull) for (const [k, v] of Object.entries(updates.$pull)) {
            if (Array.isArray(doc[k])) {
              doc[k] = doc[k].filter((x: any) => x !== v)
              modified = true
            }
          }
          if (updates.$pullAll) for (const [k, arr] of Object.entries(updates.$pullAll)) {
            if (Array.isArray(doc[k])) {
              doc[k] = doc[k].filter((x: any) => !arr.includes(x))
              modified = true
            }
          }

          if (modified) {
            doc.updatedAt = now
            this._stmts.updateRaw.run(JSON.stringify(doc), now, doc._id)
            changes++
          }
        }
      })
      tx()

      offset += rows.length
    }

    if (changes)
      this.emit('change', 'update', { query, count: changes, type: 'js' })

    return changes
  }

  addGeneratedColumn(field: string, type = 'TEXT') {
    const colName = field.split('.').pop()
    if (!colName || !VALID_KEY.test(colName))
      throw new Error(`Invalid column name: ${colName}`)

    const path = buildJsonPath(field)
    try {
      this._db.prepare(`
        ALTER TABLE ${this._quotedTable}
        ADD COLUMN "${colName}" ${type}
        GENERATED ALWAYS AS (json_extract(doc, '${path}'))
      `).run()

      this._db.prepare(`
        CREATE INDEX IF NOT EXISTS "${this._table}_${colName}_idx"
        ON ${this._quotedTable}("${colName}")
      `).run()
    } catch {}
  }

  createIndex(field: string) {
    const name = `${this._table}_${field.replace(/\./g, '_')}_idx`
    const path = buildJsonPath(field)

    try {
      this._db.prepare(`
        CREATE INDEX IF NOT EXISTS "${name}"
        ON ${this._quotedTable}(json_extract(doc, '${path}'))
      `).run()
    } catch {}
  }

  getStats() {
    return {
      count: this._stmts.countAll.get().c,
      cacheSize: this._stmtCache.size,
      tableName: this._table
    }
  }

  destroy() {
    this._stmtCache.clear()
    this.removeAllListeners()
  }
}

export class SimpleDB extends EventEmitter {
  private readonly _db: any
  private readonly _collections = new Map<string, SQLiteCollection>()

  constructor(options: { dbPath?: string; cacheSize?: number } = {}) {
    super()

    const dir = join(process.cwd(), 'db')
    ensureDir(dir)

    const path = options.dbPath || join(dir, 'sey.sqlite')
    this._db = new DatabaseConstructor(path)

    const pragmas = [
      'journal_mode = WAL',
      'synchronous = NORMAL',
      'temp_store = MEMORY',
      'foreign_keys = ON',
      'busy_timeout = 5000',
      'trusted_schema = 0',
      'cache_size = -64000'
    ]

    if (IS_BUN) pragmas.forEach(p => this._db.run(`PRAGMA ${p}`))
    else pragmas.forEach(p => this._db.pragma(p))
  }

  collection(name: string) {
    let col = this._collections.get(name)
    if (!col) {
      col = new SQLiteCollection(this._db, name)
      col.on('change', (...a) => this.emit('change', ...a))
      col.on('error', e => this.emit('error', e))
      this._collections.set(name, col)
    }
    return col
  }

  close() {
    for (const col of this._collections.values()) col.destroy()
    this._collections.clear()
    try { this._db.close() } catch {}
  }
}
