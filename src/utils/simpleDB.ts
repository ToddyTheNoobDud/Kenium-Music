import { Database, type SQLQueryBindings, type Statement } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

type JsonPrimitive = string | number | boolean | null
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue }

type QueryOps = Partial<{
  $ne: JsonPrimitive
  $in: JsonPrimitive[]
}>
type QueryValue = JsonPrimitive | undefined | QueryOps
type Query = Record<string, QueryValue>

interface FindOptions {
  limit?: number
  skip?: number
  sort?: Record<string, 1 | -1>
  fields?: string[]
}

type Document = {
  _id: string
  createdAt: string
  updatedAt: string
} & Record<string, JsonValue | undefined>

interface AtomicUpdate {
  $set?: Record<string, JsonValue>
  $inc?: Record<string, number>
}

interface SimpleDBOptions {
  dbPath?: string
}

type ColumnType = 'TEXT' | 'INTEGER' | 'REAL'
type SQLValue = string | number | null

interface CollectionOptions {
  columns?: Record<string, ColumnType>
}

const VALID_NAME = /^[A-Za-z0-9_]+$/
const VALID_PATH = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseDocument(raw: string): Document | null {
  try {
    const document: unknown = JSON.parse(raw)
    return isPlainObject(document) ? (document as Document) : null
  } catch {
    return null
  }
}

function jsonPath(field: string): string {
  if (!VALID_PATH.test(field)) {
    throw new Error(`Invalid field path: ${field}`)
  }
  return `$.${field}`
}

const quoteIdentifier = (name: string) => `"${name.replace(/"/g, '""')}"`

function columnSqlValue(value: unknown, columnType: ColumnType): SQLValue {
  if (value === null || value === undefined) {
    return null
  }
  if (columnType === 'INTEGER') {
    if (typeof value === 'boolean') {
      return Number(value)
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0
    }
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') {
        return 1
      }
      if (value.toLowerCase() === 'false') {
        return 0
      }
      const numericValue = Number(value)
      return Number.isFinite(numericValue) ? numericValue : 0
    }
    return 0
  }
  if (columnType === 'REAL') {
    const numericValue = Number(value)
    return Number.isFinite(numericValue) ? numericValue : 0
  }
  return typeof value === 'string' ? value : JSON.stringify(value)
}

const toJsonArgument = (value: unknown): string =>
  JSON.stringify(value) ?? 'null'

export const generateSortableId = (): string => Bun.randomUUIDv7()

class SQLiteCollection<DocumentType extends Record<string, unknown>> {
  private readonly db: Database
  private readonly quotedTableName: string
  private readonly hotColumns: Map<string, ColumnType>

  // Pre-compiled statements for core operations
  private insertStatement?: Statement<unknown, SQLQueryBindings[]>
  private byIdStatement?: Statement<{ doc: string }, [string]>
  private updateStatement?: Statement<unknown, SQLQueryBindings[]>
  private countStatement?: Statement<{ count: number }, []>
  private createdAtStatement?: Statement<{ createdAt: string }, [string]>

  constructor(db: Database, name: string, options: CollectionOptions = {}) {
    if (!VALID_NAME.test(name)) {
      throw new Error(`Invalid collection name: ${name}`)
    }

    this.db = db
    this.quotedTableName = quoteIdentifier(`col_${name}`)
    this.hotColumns = new Map(Object.entries(options.columns ?? {}))
    for (const field of this.hotColumns.keys()) {
      if (!VALID_NAME.test(field)) {
        throw new Error(`Invalid column field name: ${field}`)
      }
    }

    const hotColumnSql = Array.from(this.hotColumns.entries())
      .map(
        ([field, columnType]) =>
          `,\n          ${quoteIdentifier(field)} ${columnType}`
      )
      .join('')

    this.db
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS ${this.quotedTableName} (
          _id TEXT PRIMARY KEY,
          doc TEXT NOT NULL CHECK (json_valid(doc)),
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL${hotColumnSql}
        )`
      )
      .run()
  }

  private isHotColumn(field: string): boolean {
    return this.hotColumns.has(field)
  }

  private isNumericHotColumn(field: string): boolean {
    const columnType = this.hotColumns.get(field)
    return columnType === 'INTEGER' || columnType === 'REAL'
  }

  private getColumnSqlValue(
    doc: Record<string, unknown>,
    field: string
  ): SQLValue {
    const columnType = this.hotColumns.get(field)
    return columnType ? columnSqlValue(doc[field], columnType) : null
  }

  private getColumnValues(doc: Record<string, unknown>): SQLValue[] {
    const values: SQLValue[] = []
    for (const field of this.hotColumns.keys()) {
      values.push(this.getColumnSqlValue(doc, field))
    }
    return values
  }

  private getFieldSelect(field: string): string {
    return `${this.fieldExpression(field)} AS ${quoteIdentifier(field)}`
  }

  private buildSelect(fields?: string[]): {
    selectSql: string
    usesDoc: boolean
  } {
    if (!fields?.length) {
      return { selectSql: 'doc', usesDoc: true }
    }

    const seen = new Set<string>(['_id'])
    const orderedFields = ['_id']
    for (const field of fields) {
      if (seen.has(field)) {
        continue
      }
      seen.add(field)
      orderedFields.push(field)
    }

    return {
      selectSql: orderedFields
        .map((field) => this.getFieldSelect(field))
        .join(', '),
      usesDoc: false
    }
  }

  private get insertQuery(): Statement<unknown, SQLQueryBindings[]> {
    if (this.insertStatement) {
      return this.insertStatement
    }
    const columnNames = Array.from(this.hotColumns.keys())
    const columnList = columnNames.map((field) => quoteIdentifier(field))
    const insertColumns = columnList.length ? `, ${columnList.join(', ')}` : ''
    const insertValues = columnNames.length
      ? `, ${columnNames.map(() => '?').join(', ')}`
      : ''
    const updateAssignments = [
      'updatedAt = excluded.updatedAt',
      ...columnList.map((field) => `${field} = excluded.${field}`),
      `doc = json_set(
          excluded.doc,
          '$.createdAt', ${this.quotedTableName}.createdAt,
          '$.updatedAt', excluded.updatedAt
        )`
    ]
    this.insertStatement = this.db.prepare(`
      INSERT INTO ${this.quotedTableName} (_id, doc, createdAt, updatedAt${insertColumns})
      VALUES (?, json(?), ?, ?${insertValues})
      ON CONFLICT(_id) DO UPDATE SET
        ${updateAssignments.join(',\n        ')}
    `)
    return this.insertStatement
  }

  private get createdAtQuery(): Statement<{ createdAt: string }, [string]> {
    if (this.createdAtStatement) {
      return this.createdAtStatement
    }
    this.createdAtStatement = this.db.prepare(
      `SELECT createdAt FROM ${this.quotedTableName} WHERE _id = ?`
    )
    return this.createdAtStatement
  }

  private get documentQuery(): Statement<{ doc: string }, [string]> {
    if (this.byIdStatement) {
      return this.byIdStatement
    }
    this.byIdStatement = this.db.prepare(
      `SELECT doc FROM ${this.quotedTableName} WHERE _id = ?`
    )
    return this.byIdStatement
  }

  private get updateQuery(): Statement<unknown, SQLQueryBindings[]> {
    if (this.updateStatement) {
      return this.updateStatement
    }
    const columnNames = Array.from(this.hotColumns.keys())
    const assignments = [
      'doc = json(?)',
      'updatedAt = ?',
      ...columnNames.map((field) => `${quoteIdentifier(field)} = ?`)
    ]
    this.updateStatement = this.db.prepare(
      `UPDATE ${this.quotedTableName} SET ${assignments.join(', ')} WHERE _id = ?`
    )
    return this.updateStatement
  }

  private get countQuery(): Statement<{ count: number }, []> {
    if (this.countStatement) {
      return this.countStatement
    }
    this.countStatement = this.db.prepare(
      `SELECT COUNT(*) AS count FROM ${this.quotedTableName}`
    )
    return this.countStatement
  }

  private fieldExpression(field: string): string {
    if (
      field === '_id' ||
      field === 'createdAt' ||
      field === 'updatedAt' ||
      this.isHotColumn(field)
    ) {
      return quoteIdentifier(field)
    }
    return `json_extract(doc, '${jsonPath(field)}')`
  }

  private buildWhere(query: Query): {
    sql: string
    params: SQLQueryBindings[]
  } {
    const conditions: string[] = []
    const params: SQLQueryBindings[] = []

    for (const [field, value] of Object.entries(query)) {
      const expression = this.fieldExpression(field)
      if (value === null || value === undefined) {
        conditions.push(`${expression} IS NULL`)
      } else if (typeof value === 'object') {
        const operators = value
        if (Object.hasOwn(operators, '$ne')) {
          if (operators.$ne === null) {
            conditions.push(`${expression} IS NOT NULL`)
          } else {
            conditions.push(`${expression} != ?`)
            params.push(operators.$ne as JsonPrimitive)
          }
        }
        if (operators.$in) {
          conditions.push(
            operators.$in.length
              ? `${expression} IN (${operators.$in.map(() => '?').join(', ')})`
              : '0=1'
          )
          params.push(...operators.$in)
        }
      } else {
        conditions.push(`${expression} = ?`)
        params.push(typeof value === 'boolean' ? Number(value) : value)
      }
    }

    return { sql: conditions.length ? conditions.join(' AND ') : '1=1', params }
  }

  insert(document: DocumentType): DocumentType & Document
  insert(documents: DocumentType[]): (DocumentType & Document)[]
  insert(
    docs: DocumentType | DocumentType[]
  ): (DocumentType & Document) | (DocumentType & Document)[] {
    const isArray = Array.isArray(docs)
    const items = isArray ? docs : [docs]
    const now = new Date().toISOString()
    const result: (DocumentType & Document)[] = []

    this.db.transaction(() => {
      for (const doc of items) {
        const inputDoc = doc as DocumentType & Partial<Document>
        const _id = inputDoc._id || generateSortableId()

        const shouldLookupCreatedAt = !!inputDoc._id && !inputDoc.createdAt
        const existing =
          shouldLookupCreatedAt && inputDoc._id
            ? this.createdAtQuery.get(inputDoc._id)
            : undefined

        const createdAt = inputDoc.createdAt || existing?.createdAt || now
        const updatedAt = inputDoc.updatedAt || now

        const full = {
          ...doc,
          _id,
          createdAt,
          updatedAt
        } as DocumentType & Document
        const columnValues = this.getColumnValues(full)

        this.insertQuery.run(
          full._id,
          JSON.stringify(full),
          full.createdAt,
          full.updatedAt,
          ...columnValues
        )
        result.push(full)
      }
    })()

    const first = result[0] as DocumentType & Document
    return isArray ? result : first
  }

  find(
    query: Query = {},
    options: FindOptions = {}
  ): (DocumentType & Document)[] {
    const { sql, params } = this.buildWhere(query)
    const { selectSql, usesDoc } = this.buildSelect(options.fields)
    let querySql = `SELECT ${selectSql} FROM ${this.quotedTableName} WHERE ${sql}`

    if (options.sort) {
      const clauses = Object.entries(options.sort).map(
        ([field, direction]) =>
          `${this.fieldExpression(field)} ${direction === 1 ? 'ASC' : 'DESC'}`
      )
      if (clauses.length) {
        querySql += ` ORDER BY ${clauses.join(', ')}`
      }
    }

    if (options.limit !== undefined) {
      if (options.limit < 0) {
        throw new Error('limit must be >= 0')
      }
      querySql += ` LIMIT ${options.limit}`
    }
    if (options.skip !== undefined) {
      if (options.skip < 0) {
        throw new Error('skip must be >= 0')
      }
      if (options.limit === undefined) {
        querySql += ' LIMIT -1'
      }
      querySql += ` OFFSET ${options.skip}`
    }

    const rows = this.db
      .query<Record<string, unknown>, SQLQueryBindings[]>(querySql)
      .all(...params)

    const documents: (DocumentType & Document)[] = []

    for (const row of rows) {
      if (usesDoc) {
        const doc = parseDocument(row.doc as string)
        if (!doc) {
          continue
        }
        documents.push(doc as DocumentType & Document)
        continue
      }

      documents.push({ ...row } as DocumentType & Document)
    }

    return documents
  }

  findOne(
    query: Query = {},
    options?: FindOptions
  ): (DocumentType & Document) | null {
    return this.find(query, { ...options, limit: 1 })[0] ?? null
  }

  findById(
    id: string,
    options?: FindOptions
  ): (DocumentType & Document) | null {
    if (!id) {
      return null
    }
    if (options?.fields?.length) {
      return this.findOne({ _id: id }, { fields: options.fields }) ?? null
    }
    const row = this.documentQuery.get(id)
    return row ? (parseDocument(row.doc) as DocumentType & Document) : null
  }

  private updateWhere(
    query: Query,
    mutateDocument: (doc: DocumentType & Document) => DocumentType & Document
  ): number {
    if (!query || !Object.keys(query).length) {
      throw new Error('Update query cannot be empty')
    }

    const { sql, params } = this.buildWhere(query)
    const selectSql = `SELECT _id, doc FROM ${this.quotedTableName} WHERE ${sql}`
    const rows = this.db
      .query<
        {
          _id: string
          doc: string
        },
        SQLQueryBindings[]
      >(selectSql)
      .all(...params)
    if (!rows.length) {
      return 0
    }

    const now = new Date().toISOString()
    let changed = 0

    this.db.transaction(() => {
      for (const row of rows) {
        const doc = parseDocument(row.doc)
        if (!doc) {
          continue
        }

        const next = mutateDocument({
          ...doc,
          _id: row._id,
          ...(doc.createdAt ? { createdAt: doc.createdAt } : {}),
          updatedAt: now
        } as DocumentType & Document)

        next._id = row._id
        if (doc.createdAt && !next.createdAt) {
          next.createdAt = doc.createdAt
        }
        next.updatedAt = now

        this.updateQuery.run(
          JSON.stringify(next),
          now,
          ...this.getColumnValues(next),
          row._id
        )
        changed++
      }
    })()

    return changed
  }

  private updateHotColumns(
    query: Query,
    updates: Partial<DocumentType>
  ): number | null {
    const entries = Object.entries(updates).filter(
      ([, value]) => value !== undefined
    )
    if (!entries.length) {
      return 0
    }
    if (entries.some(([field]) => !this.isHotColumn(field))) {
      return null
    }

    const { sql, params } = this.buildWhere(query)
    const now = new Date().toISOString()
    const assignments = ['updatedAt = ?']
    const statementParams: SQLQueryBindings[] = [now]
    const jsonArgs = [`'$.updatedAt'`, 'json(?)']
    const jsonParams: SQLQueryBindings[] = [toJsonArgument(now)]

    for (const [field, value] of entries) {
      assignments.push(`${quoteIdentifier(field)} = ?`)
      statementParams.push(this.getColumnSqlValue({ [field]: value }, field))
      jsonArgs.push(`'${jsonPath(field)}'`, 'json(?)')
      jsonParams.push(toJsonArgument(value))
    }

    assignments.push(`doc = json_set(doc, ${jsonArgs.join(', ')})`)

    const updateSql = `UPDATE ${this.quotedTableName} SET ${assignments.join(', ')} WHERE ${sql}`
    const result = this.db
      .query(updateSql)
      .run(...statementParams, ...jsonParams, ...params)

    return result.changes
  }

  private updateJsonFields(
    query: Query,
    updates: Partial<DocumentType>
  ): number | null {
    const entries = Object.entries(updates).filter(
      ([, value]) => value !== undefined
    )
    if (!entries.length) {
      return 0
    }
    if (entries.some(([field]) => this.isHotColumn(field))) {
      return null
    }

    const { sql, params } = this.buildWhere(query)
    const now = new Date().toISOString()
    const jsonArgs = [`'$.updatedAt'`, 'json(?)']
    const jsonParams: SQLQueryBindings[] = [toJsonArgument(now)]

    for (const [field, value] of entries) {
      jsonArgs.push(`'${jsonPath(field)}'`, 'json(?)')
      jsonParams.push(toJsonArgument(value))
    }

    const updateSql = `UPDATE ${this.quotedTableName} SET updatedAt = ?, doc = json_set(doc, ${jsonArgs.join(', ')}) WHERE ${sql}`
    const result = this.db.query(updateSql).run(now, ...jsonParams, ...params)

    return result.changes
  }

  private updateAtomicHotColumns(
    query: Query,
    operations: AtomicUpdate
  ): number | null {
    const setEntries = Object.entries(operations.$set ?? {}).filter(
      ([, value]) => value !== undefined
    )
    const incEntries = Object.entries(operations.$inc ?? {}).filter(
      ([, value]) => Number.isFinite(value)
    )

    if (!setEntries.length && !incEntries.length) {
      return 0
    }
    if (setEntries.some(([field]) => !this.isHotColumn(field))) {
      return null
    }
    if (incEntries.some(([field]) => !this.isNumericHotColumn(field))) {
      return null
    }

    const overlap = new Set(setEntries.map(([field]) => field))
    if (incEntries.some(([field]) => overlap.has(field))) {
      return null
    }

    const { sql, params } = this.buildWhere(query)
    const now = new Date().toISOString()
    const assignments = ['updatedAt = ?']
    const statementParams: SQLQueryBindings[] = [now]
    const jsonArgs = [`'$.updatedAt'`, 'json(?)']
    const jsonParams: SQLQueryBindings[] = [toJsonArgument(now)]

    for (const [field, value] of setEntries) {
      assignments.push(`${quoteIdentifier(field)} = ?`)
      statementParams.push(this.getColumnSqlValue({ [field]: value }, field))
      jsonArgs.push(`'${jsonPath(field)}'`, 'json(?)')
      jsonParams.push(toJsonArgument(value))
    }

    for (const [field, value] of incEntries) {
      assignments.push(
        `${quoteIdentifier(field)} = COALESCE(${quoteIdentifier(field)}, 0) + ?`
      )
      statementParams.push(value)
      jsonArgs.push(
        `'${jsonPath(field)}'`,
        `COALESCE(${quoteIdentifier(field)}, 0) + ?`
      )
      jsonParams.push(value)
    }

    assignments.push(`doc = json_set(doc, ${jsonArgs.join(', ')})`)

    const updateSql = `UPDATE ${this.quotedTableName} SET ${assignments.join(', ')} WHERE ${sql}`
    const result = this.db
      .query(updateSql)
      .run(...statementParams, ...jsonParams, ...params)

    return result.changes
  }

  update(query: Query, updates: Partial<DocumentType>): number {
    if (!query || !Object.keys(query).length) {
      throw new Error('Update query cannot be empty')
    }

    const updatedCount = this.updateHotColumns(query, updates)
    if (updatedCount !== null) {
      return updatedCount
    }

    const json = this.updateJsonFields(query, updates)
    if (json !== null) {
      return json
    }

    return this.updateWhere(query, (doc) => {
      const next: DocumentType & Document = {
        ...doc,
        ...updates
      }
      if (doc._id) {
        next._id = doc._id
      }
      if (doc.createdAt) {
        next.createdAt = doc.createdAt
      }
      return next as DocumentType & Document
    })
  }

  updateAtomic(query: Query, operations: AtomicUpdate): number {
    if (!query || !Object.keys(query).length) {
      throw new Error('Update query cannot be empty')
    }

    const updatedCount = this.updateAtomicHotColumns(query, operations)
    if (updatedCount !== null) {
      return updatedCount
    }

    return this.updateWhere(query, (doc) => {
      const next: DocumentType & Document = { ...doc }

      if (operations.$set) {
        Object.assign(next, operations.$set)
      }

      if (operations.$inc) {
        const mutable = next as Record<string, JsonValue | undefined>
        for (const [field, increment] of Object.entries(operations.$inc)) {
          const current = mutable[field]
          mutable[field] =
            (typeof current === 'number' ? current : 0) + increment
        }
      }

      return next as DocumentType & Document
    })
  }

  delete(query: Query): number {
    if (!query || !Object.keys(query).length) {
      throw new Error('Delete query cannot be empty')
    }

    const { sql, params } = this.buildWhere(query)
    const delSql = `DELETE FROM ${this.quotedTableName} WHERE ${sql}`
    const result = this.db.query(delSql).run(...params)

    return result.changes
  }

  count(query: Query = {}): number {
    if (!Object.keys(query).length) {
      return this.countQuery.get()?.count ?? 0
    }

    const { sql, params } = this.buildWhere(query)
    const countSql = `SELECT COUNT(*) AS count FROM ${this.quotedTableName} WHERE ${sql}`
    return (
      this.db
        .query<{ count: number }, SQLQueryBindings[]>(countSql)
        .get(...params)?.count ?? 0
    )
  }
}

export class SimpleDB {
  readonly db: Database
  private readonly collections = new Map<
    string,
    SQLiteCollection<Record<string, unknown>>
  >()

  private readonly checkpointStatement: Statement

  private readonly checkpointTimer: ReturnType<typeof setInterval>
  private readonly optimizeTimer: ReturnType<typeof setInterval>
  private static readonly CHECKPOINT_INTERVAL_MS = 120000 // 2 minutes
  private static readonly OPTIMIZE_INTERVAL_MS = 24 * 60 * 60 * 1000 // Daily

  constructor(options: SimpleDBOptions = {}) {
    const defaultDir = join(process.cwd(), 'db')
    const dbPath = options.dbPath || join(defaultDir, 'sey.sqlite')

    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true })
    }

    this.db = new Database(dbPath)

    for (const pragma of [
      'busy_timeout = 1000',
      'auto_vacuum = INCREMENTAL',
      'journal_mode = WAL',
      'synchronous = NORMAL',
      'cache_size = -10000',
      'temp_store = MEMORY',
      'mmap_size = 268435456',
      'foreign_keys = ON',
      'journal_size_limit = 5242880',
      'trusted_schema = OFF'
    ]) {
      this.db.run(`PRAGMA ${pragma}`)
    }

    try {
      // Recommended for long-lived connections.
      this.db.prepare('PRAGMA optimize = 0x10002').run()
    } catch {}

    this.checkpointStatement = this.db.prepare('PRAGMA wal_checkpoint(PASSIVE)')
    this.checkpointTimer = setInterval(() => {
      this.checkpointPassive()
    }, SimpleDB.CHECKPOINT_INTERVAL_MS).unref()

    this.optimizeTimer = setInterval(() => {
      try {
        this.db.prepare('PRAGMA optimize').run()
      } catch {}
    }, SimpleDB.OPTIMIZE_INTERVAL_MS).unref()
  }

  collection<DocumentType extends Record<string, unknown>>(
    name: string,
    options?: CollectionOptions
  ): SQLiteCollection<DocumentType> {
    const existing = this.collections.get(name)
    if (existing) {
      return existing as SQLiteCollection<DocumentType>
    }

    const collection = new SQLiteCollection<DocumentType>(
      this.db,
      name,
      options
    )
    this.collections.set(name, collection)
    return collection
  }

  transaction(callback: () => void): void {
    this.db.transaction(callback)()
  }

  checkpointPassive(): void {
    try {
      this.db.prepare('PRAGMA incremental_vacuum(64)').all()
      this.checkpointStatement.all()
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
    clearInterval(this.checkpointTimer)
    clearInterval(this.optimizeTimer)

    this.checkpoint()

    this.collections.clear()
    this.checkpointStatement.finalize()

    try {
      this.db.close(true)
    } catch {}
  }
}
