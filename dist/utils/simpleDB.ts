import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'

interface SimpleDBOptions {
  dbPath?: string
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function validateIdentifier(name: string) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error('Invalid identifier (allowed: A-Za-z0-9_): ' + String(name))
  }
  return name
}

function qualifyIdentifier(name: string) {

  return `"${name}"`
}

function jsonPathForKey(key: string) {
  const parts = String(key).split('.')
  if (parts.length === 0) throw new Error('Invalid JSON path')
  for (const p of parts) {
    if (!/^[A-Za-z0-9_]+$/.test(p)) throw new Error('Invalid JSON key component: ' + p)
  }

  return '$.' + parts.map(p => `"${p}"`).join('.')
}

class SQLiteCollection extends EventEmitter {
  private db: any
  private tableName: string
  private qualifiedTable: string

  constructor(db: any, name: string) {
    validateIdentifier(name)
    super()
    this.db = db
    this.tableName = `col_${name}`
    validateIdentifier(this.tableName)
    this.qualifiedTable = qualifyIdentifier(this.tableName)

    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS ${this.qualifiedTable} ( _id TEXT PRIMARY KEY, doc TEXT NOT NULL, createdAt TEXT, updatedAt TEXT )`
      )
      .run()

    try {
      const idx = `"${this.tableName}_updated_idx"`
      this.db
        .prepare(`CREATE INDEX IF NOT EXISTS ${idx} ON ${this.qualifiedTable}(updatedAt)`)
        .run()
    } catch (e) {

    }
  }

  private normalizeDoc(doc: any) {
    if (!doc || typeof doc !== 'object') doc = {}
    if (!doc._id) doc._id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    return doc
  }

  private rowToDoc(row: any) {
    if (!row || typeof row.doc !== 'string') return null
    try {
      return JSON.parse(row.doc)
    } catch (err) {

      try {
        console.error('[SimpleDB] Failed to parse JSON doc for _id=', row._id, 'error=', err)
      } catch (e) {
        console.error('[SimpleDB] Failed to parse JSON doc (unknown id)', err)
      }
      return null
    }
  }

  private buildWhereAndParams(query: any) {
    const where: string[] = []
    const params: any = {}
    let i = 0

    for (const k of Object.keys(query)) {
      i++
      const val = query[k]
      const path = jsonPathForKey(k)

      if (typeof val === 'boolean') {
        where.push(`CAST(json_extract(doc, '${path}') AS INTEGER) = @v${i}`)
        params[`v${i}`] = val ? 1 : 0
      } else if (val === null || val === undefined) {
        where.push(`json_extract(doc, '${path}') IS NULL`)
      } else if (typeof val === 'number' || typeof val === 'string' || typeof val === 'bigint') {
        where.push(`json_extract(doc, '${path}') = @v${i}`)
        params[`v${i}`] = val
      } else {

        where.push(`json_extract(doc, '${path}') = json(@v${i})`)
        params[`v${i}`] = JSON.stringify(val)
      }
    }

    return { where, params }
  }

  insert(docs: any | any[]) {
    const arr = Array.isArray(docs) ? docs : [docs]
    const now = new Date().toISOString()

    const stmt = this.db.prepare(
      `INSERT INTO ${this.qualifiedTable} (_id, doc, createdAt, updatedAt)
       VALUES (@_id, @doc, @createdAt, @updatedAt)
       ON CONFLICT(_id) DO UPDATE SET
         doc = excluded.doc,
         updatedAt = excluded.updatedAt,
         createdAt = COALESCE((SELECT createdAt FROM ${this.qualifiedTable} WHERE _id = excluded._id), excluded.createdAt)`
    )

    const tx = this.db.transaction((items: any[]) => {
      for (const it of items) {
        const doc = this.normalizeDoc(it)
        const payload = JSON.stringify(doc)
        stmt.run({
          _id: doc._id,
          doc: payload,
          createdAt: doc.createdAt || now,
          updatedAt: now,
        })
      }
    })

    try {
      tx(arr)
    } catch (err) {
      console.error('[SimpleDB] Insert transaction failed', err)
      throw err
    }

    this.emit('change', 'insert', arr)
    return arr.length === 1 ? arr[0] : arr
  }

  find(query: any = {}) {
    if (!query || Object.keys(query).length === 0) {
      const rows = this.db
        .prepare(`SELECT _id, doc FROM ${this.qualifiedTable}`)
        .all()
      return rows.map((r: any) => this.rowToDoc(r)).filter(Boolean)
    }

    const { where, params } = this.buildWhereAndParams(query)
    if (!where.length) return []

    const sql = `SELECT _id, doc FROM ${this.qualifiedTable} WHERE ${where.join(' AND ')}`
    const rows = this.db.prepare(sql).all(params)
    return rows.map((r: any) => this.rowToDoc(r)).filter(Boolean)
  }

  findOne(query: any = {}) {
    const res = this.find(query)
    return res.length ? res[0] : null
  }

  findById(id: string) {
    if (!id) return null
    const row = this.db
      .prepare(`SELECT _id, doc FROM ${this.qualifiedTable} WHERE _id = ?`)
      .get(id)
    return this.rowToDoc(row)
  }

  update(query: any, updates: any) {
    const t = this.qualifiedTable

    const tx = this.db.transaction(() => {
      if (query?._id) {
        const existing = this.findById(query._id)
        if (!existing) return 0

        const merged = Object.assign({}, existing, updates)
        merged._id = existing._id
        merged.updatedAt = new Date().toISOString()

        this.db
          .prepare(`UPDATE ${t} SET doc = @doc, updatedAt = @updatedAt WHERE _id = @id`)
          .run({ doc: JSON.stringify(merged), updatedAt: merged.updatedAt, id: merged._id })

        this.emit('change', 'update', merged)
        return 1
      }

      const matches = this.find(query)
      if (!matches.length) return 0

      const now = new Date().toISOString()
      const stmt = this.db.prepare(`UPDATE ${t} SET doc = @doc, updatedAt = @updatedAt WHERE _id = @id`)

      for (const ex of matches) {
        const merged = Object.assign({}, ex, updates)
        merged._id = ex._id
        merged.updatedAt = now
        stmt.run({ doc: JSON.stringify(merged), updatedAt: now, id: merged._id })
      }

      this.emit('change', 'update', { query, updates })
      return matches.length
    })

    try {
      return tx()
    } catch (err) {
      console.error('[SimpleDB] Update transaction failed', err)
      throw err
    }
  }

  delete(query: any) {
    if (!query || Object.keys(query).length === 0) return 0
    if (query._id) {
      const res = this.db
        .prepare(`DELETE FROM ${this.qualifiedTable} WHERE _id = ?`)
        .run(query._id)
      this.emit('change', 'delete', { _id: query._id })
      return res.changes
    }

    const matches = this.find(query)
    if (!matches.length) return 0

    const stmt = this.db.prepare(`DELETE FROM ${this.qualifiedTable} WHERE _id = ?`)
    const tx = this.db.transaction((items: any[]) => {
      for (const m of items) stmt.run(m._id)
    })

    try {
      tx(matches)
    } catch (err) {
      console.error('[SimpleDB] Delete transaction failed', err)
      throw err
    }

    this.emit('change', 'delete', { query })
    return matches.length
  }

  count(query: any = {}) {
    if (!query || Object.keys(query).length === 0) {
      const row = this.db.prepare(`SELECT COUNT(*) as c FROM ${this.qualifiedTable}`).get()
      return row.c
    }

    const { where, params } = this.buildWhereAndParams(query)
    if (!where.length) return 0
    const sql = `SELECT COUNT(*) as c FROM ${this.qualifiedTable} WHERE ${where.join(' AND ')}`
    const row = this.db.prepare(sql).get(params)
    return row.c
  }

  getStats() {
    const row = this.db.prepare(`SELECT COUNT(*) as c FROM ${this.qualifiedTable}`).get()
    return { documentCount: row.c }
  }
}

class SimpleDB extends EventEmitter {
  private db: any
  private dbPath: string
  private collections = new Map<string, SQLiteCollection>()

  constructor(options: SimpleDBOptions = {}) {
    super()
    this.dbPath = options.dbPath || join(process.cwd(), 'db', 'sey.sqlite')
    ensureDir(join(process.cwd(), 'db'))
    this.db = new Database(this.dbPath)
    try {

      this.db.pragma('journal_mode = WAL')
    } catch (e) {

    }
  }

  collection(name: string) {
    if (this.collections.has(name)) return this.collections.get(name)!
    const col = new SQLiteCollection(this.db, name)

    col.on('change', (t: any, d: any) => this.emit('change', t, d))

    this.collections.set(name, col)
    return col
  }

  close() {
    for (const c of this.collections.values()) c.removeAllListeners()
    try {
      this.db.close()
    } catch {}
  }
}

export { SimpleDB }
