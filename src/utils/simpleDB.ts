import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const IS_BUN = !!(process as any).isBun;

const Database: any = (() => {
  try {
    if (IS_BUN) {
      const m = require("bun:sqlite");
      return m?.default || m;
    }
    return require("better-sqlite3");
  } catch {
    return require("better-sqlite3");
  }
})();

const VALID_NAME = /^[A-Za-z0-9_]+$/;
const VALID_PATH = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;

interface Query {
  [key: string]: any;
}
interface FindOptions {
  limit?: number;
  skip?: number;
  sort?: { [key: string]: 1 | -1 };
  fields?: string[];
}
interface Document {
  _id?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
}
interface AtomicUpdate {
  $set?: Record<string, any>;
  $inc?: Record<string, number>;
  $push?: Record<string, any>;
  $pull?: Record<string, any>;
}
interface SimpleDBOptions {
  dbPath?: string;
  cacheSize?: number;
}

const _functions = {
  now: () => new Date().toISOString(),
  isPlainObject: (v: any) => !!v && typeof v === "object" && !Array.isArray(v),
  parseDoc: (raw: string): Document | null => {
    try {
      const doc = JSON.parse(raw);
      return doc && typeof doc === "object" ? doc : null;
    } catch {
      return null;
    }
  },
  jsonPath: (key: string) => {
    if (!VALID_PATH.test(key)) throw new Error(`Invalid field path: ${key}`);
    return `$.${key}`;
  },
  finalize: (stmt: any) => {
    try {
      if (stmt && typeof stmt.finalize === "function") stmt.finalize();
    } catch {}
  },
  makeTxRunner: (db: any) => {
    try {
      if (db && typeof db.transaction === "function") return db.transaction((fn: any) => fn());
    } catch {}
    return null as null | ((fn: () => any) => any);
  },
  runTx: <T>(runner: null | ((fn: () => T) => T), fn: () => T) => (runner ? runner(fn) : fn()),
  ensureDirForFile: (filePath: string) => {
    try {
      mkdirSync(dirname(filePath), { recursive: true });
    } catch {}
  },
  applyPragmas: (db: any, pragmas: string[]) => {
    for (const p of pragmas) {
      try {
        if (IS_BUN) db.run(`PRAGMA ${p}`);
        else db.pragma(p);
      } catch {}
    }
  },
};

class SQLiteCollection extends EventEmitter {
  private readonly db: any;
  private readonly table: string;
  private readonly qtable: string;
  private readonly cacheSize: number;
  private readonly stmtCache = new Map<string, any>();
  private readonly txRunner: null | ((fn: () => any) => any);

  private _insert?: any;
  private _byId?: any;
  private _updateById?: any;
  private _deleteById?: any;
  private _countAll?: any;
  private _createdAtById?: any;

  public get tableName() {
    return this.table;
  }
  public get database() {
    return this.db;
  }

  public vacuum(): void {
    try {
      this.db.prepare("VACUUM").run();
    } catch (err) {
      console.error(`[SQLiteCollection] Vacuum failed for ${this.table}:`, err);
    }
  }

  constructor(db: any, name: string, cacheSize = 50) {
    super();
    if (!VALID_NAME.test(name)) throw new Error(`Invalid collection name: ${name}`);

    this.db = db;
    this.table = `col_${name}`;
    this.qtable = `"${this.table}"`;
    this.cacheSize = Math.max(0, cacheSize);
    this.txRunner = _functions.makeTxRunner(this.db);

    this.db
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS ${this.qtable} (
          _id TEXT PRIMARY KEY,
          doc TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        )`,
      )
      .run();

    this.db.prepare(`CREATE INDEX IF NOT EXISTS "${this.table}_updated" ON ${this.qtable}(updatedAt)`).run();
    this.db.prepare(`CREATE INDEX IF NOT EXISTS "${this.table}_created" ON ${this.qtable}(createdAt)`).run();
  }

  private get insertStmt() {
    return (this._insert ??= this.db.prepare(`
      INSERT INTO ${this.qtable} (_id, doc, createdAt, updatedAt)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(_id) DO UPDATE SET
        updatedAt = excluded.updatedAt,
        doc = json_set(
          excluded.doc,
          '$.createdAt', ${this.qtable}.createdAt,
          '$.updatedAt', excluded.updatedAt
        )
    `));
  }

  private get createdAtByIdStmt() {
    return (this._createdAtById ??= this.db.prepare(`SELECT createdAt FROM ${this.qtable} WHERE _id = ?`));
  }

  private get byIdStmt() {
    return (this._byId ??= this.db.prepare(`SELECT doc FROM ${this.qtable} WHERE _id = ?`));
  }
  private get updateStmt() {
    return (this._updateById ??= this.db.prepare(`UPDATE ${this.qtable} SET doc = ?, updatedAt = ? WHERE _id = ?`));
  }
  private get deleteStmt() {
    return (this._deleteById ??= this.db.prepare(`DELETE FROM ${this.qtable} WHERE _id = ?`));
  }
  private get countAllStmt() {
    return (this._countAll ??= this.db.prepare(`SELECT COUNT(*) AS c FROM ${this.qtable}`));
  }

  private getStmt(sql: string, cacheKey?: string): any {
    if (!cacheKey || this.cacheSize === 0) return this.db.prepare(sql);

    const hit = this.stmtCache.get(cacheKey);
    if (hit) {
      this.stmtCache.delete(cacheKey);
      this.stmtCache.set(cacheKey, hit);
      return hit;
    }

    if (this.stmtCache.size >= this.cacheSize) {
      const oldestKey = this.stmtCache.keys().next().value as string | undefined;
      if (oldestKey) {
        const oldest = this.stmtCache.get(oldestKey);
        this.stmtCache.delete(oldestKey);
        _functions.finalize(oldest);
      }
    }

    const stmt = this.db.prepare(sql);
    this.stmtCache.set(cacheKey, stmt);
    return stmt;
  }

  private buildWhere(query: Query): { sql: string; params: any[] } {
    const parts: string[] = [];
    const params: any[] = [];

    for (const [key, value] of Object.entries(query)) {
      if (key === "_id") {
        if (value == null) {
          parts.push(`_id IS NULL`);
          continue;
        }

        if (_functions.isPlainObject(value)) {
          for (const [op, opVal] of Object.entries(value)) {
            switch (op) {
              case "$ne":
                parts.push(`_id != ?`);
                params.push(opVal);
                break;

              case "$in":
              case "$nin": {
                if (!Array.isArray(opVal)) break;
                if (opVal.length === 0) {
                  if (op === "$in") parts.push("0=1");
                  break;
                }
                parts.push(`_id ${op === "$in" ? "IN" : "NOT IN"} (${opVal.map(() => "?").join(", ")})`);
                params.push(...opVal);
                break;
              }

              case "$gt":
              case "$gte":
              case "$lt":
              case "$lte":
                parts.push(
                  `_id ${
                    op === "$gt" ? ">" : op === "$gte" ? ">=" : op === "$lt" ? "<" : "<="
                  } ?`,
                );
                params.push(opVal);
                break;
            }
          }
        } else {
          parts.push(`_id = ?`);
          params.push(value);
        }
        continue;
      }

      if (key === "createdAt" || key === "updatedAt") {
        const col = key;

        if (value == null) {
          parts.push(`${col} IS NULL`);
          continue;
        }

        if (_functions.isPlainObject(value)) {
          for (const [op, opVal] of Object.entries(value)) {
            switch (op) {
              case "$gt":
                parts.push(`${col} > ?`);
                params.push(opVal);
                break;
              case "$gte":
                parts.push(`${col} >= ?`);
                params.push(opVal);
                break;
              case "$lt":
                parts.push(`${col} < ?`);
                params.push(opVal);
                break;
              case "$lte":
                parts.push(`${col} <= ?`);
                params.push(opVal);
                break;
              case "$ne":
                parts.push(`${col} != ?`);
                params.push(opVal);
                break;
              case "$in":
              case "$nin": {
                if (!Array.isArray(opVal)) break;
                if (opVal.length === 0) {
                  if (op === "$in") parts.push("0=1");
                  break;
                }
                parts.push(`${col} ${op === "$in" ? "IN" : "NOT IN"} (${opVal.map(() => "?").join(", ")})`);
                params.push(...opVal);
                break;
              }
            }
          }
        } else {
          parts.push(`${col} = ?`);
          params.push(value);
        }
        continue;
      }

      const path = _functions.jsonPath(key);
      const extract = `json_extract(doc, '${path}')`;

      if (value == null) {
        parts.push(`${extract} IS NULL`);
        continue;
      }

      if (_functions.isPlainObject(value)) {
        for (const [op, opVal] of Object.entries(value)) {
          switch (op) {
            case "$gt":
              parts.push(`${extract} > ?`);
              params.push(opVal);
              break;
            case "$gte":
              parts.push(`${extract} >= ?`);
              params.push(opVal);
              break;
            case "$lt":
              parts.push(`${extract} < ?`);
              params.push(opVal);
              break;
            case "$lte":
              parts.push(`${extract} <= ?`);
              params.push(opVal);
              break;
            case "$ne":
              parts.push(`${extract} != ?`);
              params.push(opVal);
              break;
            case "$in":
            case "$nin": {
              if (!Array.isArray(opVal)) break;
              if (opVal.length === 0) {
                if (op === "$in") parts.push("0=1");
                break;
              }
              parts.push(`${extract} ${op === "$in" ? "IN" : "NOT IN"} (${opVal.map(() => "?").join(", ")})`);
              params.push(...opVal);
              break;
            }
          }
        }
        continue;
      }

      if (value === true) {
        parts.push(`${extract} = 1`);
        continue;
      }
      if (value === false) {
        parts.push(`${extract} = 0`);
        continue;
      }

      parts.push(`${extract} = ?`);
      params.push(value);
    }

    return { sql: parts.length ? parts.join(" AND ") : "1=1", params };
  }

  insert(docs: Document | Document[]): Document | Document[] {
    const isArray = Array.isArray(docs);
    const items = isArray ? docs : [docs];
    const now = _functions.now();
    const result: Document[] = [];

    _functions.runTx(this.txRunner, () => {
      for (const doc of items) {
        const _id = doc._id || randomUUID();

        const shouldLookupCreatedAt = !!doc._id && !doc.createdAt;
        const existing = shouldLookupCreatedAt ? this.createdAtByIdStmt.get(doc._id) : null;

        const createdAt = doc.createdAt || existing?.createdAt || now;
        const updatedAt = doc.updatedAt || now;

        const full: Document = {
          ...doc,
          _id,
          createdAt,
          updatedAt,
        };

        this.insertStmt.run(full._id, JSON.stringify(full), full.createdAt, full.updatedAt);
        result.push(full);
      }
    });

    this.emit("change", "insert", isArray ? result : result[0]);

    return isArray ? result : result[0];
  }

  find(query: Query = {}, opts: FindOptions = {}): Document[] {
    const { sql, params } = this.buildWhere(query);
    let querySql = `SELECT doc FROM ${this.qtable} WHERE ${sql}`;

    if (opts.sort) {
      const clauses: string[] = [];
      for (const [field, dir] of Object.entries(opts.sort)) {
        if (field === "_id" || field === "createdAt" || field === "updatedAt") {
          clauses.push(`${field} ${dir === 1 ? "ASC" : "DESC"}`);
          continue;
        }

        const path = _functions.jsonPath(field);
        clauses.push(`json_extract(doc, '${path}') ${dir === 1 ? "ASC" : "DESC"}`);
      }
      if (clauses.length) querySql += ` ORDER BY ${clauses.join(", ")}`;
    }

    if (typeof opts.limit === "number") {
      if (opts.limit < 0) throw new Error("limit must be >= 0");
      querySql += ` LIMIT ${opts.limit}`;
    }
    if (typeof opts.skip === "number") {
      if (opts.skip < 0) throw new Error("skip must be >= 0");
      querySql += ` OFFSET ${opts.skip}`;
    }

    const cacheKey = this.cacheSize ? `find:${querySql}` : undefined;
    const rows = this.getStmt(querySql, cacheKey).all(...params);

    const fields = opts.fields?.length ? new Set(opts.fields) : null;
    const out: Document[] = [];

    for (const row of rows) {
      const doc = _functions.parseDoc(row.doc);
      if (!doc) continue;

      if (!fields) {
        out.push(doc);
        continue;
      }

      const proj: Document = { _id: doc._id };
      for (const f of fields) if (Object.prototype.hasOwnProperty.call(doc, f)) proj[f] = doc[f];
      out.push(proj);
    }

    return out;
  }

  findOne(query: Query = {}, opts?: FindOptions): Document | null {
    return this.find(query, { ...opts, limit: 1 })[0] ?? null;
  }

  findById(id: string): Document | null {
    if (!id) return null;

    const row = this.byIdStmt.get(id);
    const out = row ? _functions.parseDoc(row.doc) : null;

    return out;
  }

  private updateWhere(query: Query, mut: (doc: Document) => Document): number {
    if (!query || !Object.keys(query).length) throw new Error("Update query cannot be empty");

    const { sql, params } = this.buildWhere(query);
    const selSql = `SELECT _id, doc FROM ${this.qtable} WHERE ${sql}`;
    const rows = this.getStmt(selSql, `selupd:${selSql}`).all(...params);
    if (!rows.length) return 0;

    const now = _functions.now();
    let changed = 0;

    _functions.runTx(this.txRunner, () => {
      for (const row of rows) {
        const doc = _functions.parseDoc(row.doc);
        if (!doc) continue;
        const next = mut({ ...doc, _id: row._id, createdAt: doc.createdAt, updatedAt: now });
        this.updateStmt.run(JSON.stringify(next), now, row._id);
        changed++;
      }
    });

    if (changed) this.emit("change", "update", { count: changed });

    return changed;
  }

  update(query: Query, updates: Partial<Document>): number {
    return this.updateWhere(query, (doc) => ({
      ...doc,
      ...updates,
      _id: doc._id,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }));
  }

  updateAtomic(query: Query, ops: AtomicUpdate): number {
    return this.updateWhere(query, (doc) => {
      const next: Document = { ...doc };

      if (ops.$set) Object.assign(next, ops.$set);

      if (ops.$inc) {
        for (const [k, v] of Object.entries(ops.$inc)) {
          next[k] = (typeof next[k] === "number" ? next[k] : 0) + v;
        }
      }

      if (ops.$push) {
        for (const [k, v] of Object.entries(ops.$push)) {
          const cur = next[k];
          if (!Array.isArray(cur)) next[k] = [v];
          else cur.push(v);
        }
      }

      if (ops.$pull) {
        for (const [k, v] of Object.entries(ops.$pull)) {
          const cur = next[k];
          if (Array.isArray(cur)) next[k] = cur.filter((x: any) => x !== v);
        }
      }

      return next;
    });
  }

  delete(query: Query): number {
    if (!query || !Object.keys(query).length) throw new Error("Delete query cannot be empty");

    const { sql, params } = this.buildWhere(query);
    const delSql = `DELETE FROM ${this.qtable} WHERE ${sql}`;
    const res = this.getStmt(delSql, `del:${delSql}`).run(...params);

    if (res.changes > 0) this.emit("change", "delete", { count: res.changes });

    return res.changes;
  }

  count(query: Query = {}): number {
    if (!Object.keys(query).length) return this.countAllStmt.get()?.c || 0;

    const { sql, params } = this.buildWhere(query);
    const cSql = `SELECT COUNT(*) AS c FROM ${this.qtable} WHERE ${sql}`;
    return this.getStmt(cSql, `count:${cSql}`).get(...params)?.c || 0;
  }

  createIndex(field: string, name?: string): void {
    const path = _functions.jsonPath(field);
    const safeField = field.includes(".") ? field.split(".").join("_") : field;
    const idxName = name || `${this.table}_${safeField}_idx`;
    if (!VALID_NAME.test(idxName)) throw new Error(`Invalid index name: ${idxName}`);
    this.db
      .prepare(`CREATE INDEX IF NOT EXISTS "${idxName}" ON ${this.qtable}(json_extract(doc, '${path}'))`)
      .run();
  }

  getStats(): { documentCount: number; tableName: string } {
    return { documentCount: this.countAllStmt.get()?.c || 0, tableName: this.table };
  }

  getDatabase(): any {
    return this.db;
  }

  destroy(): void {
    _functions.finalize(this._insert);
    _functions.finalize(this._byId);
    _functions.finalize(this._updateById);
    _functions.finalize(this._deleteById);
    _functions.finalize(this._countAll);
    _functions.finalize(this._createdAtById);

    for (const stmt of this.stmtCache.values()) _functions.finalize(stmt);
    this.stmtCache.clear();
    this.removeAllListeners();
  }
}

export class SimpleDB extends EventEmitter {
  private readonly db: any;
  private readonly collections = new Map<string, SQLiteCollection>();
  private readonly cacheSize: number;

  constructor(options: SimpleDBOptions = {}) {
    super();

    const defaultDir = join(process.cwd(), "db");
    const dbPath = options.dbPath || join(defaultDir, "sey.sqlite");
    this.cacheSize = options.cacheSize ?? 50;

    mkdirSync(defaultDir, { recursive: true });
    _functions.ensureDirForFile(dbPath);

    this.db = new Database(dbPath);

    _functions.applyPragmas(this.db, [
      "journal_mode = WAL",
      "synchronous = NORMAL",
      "cache_size = -10000",
      "temp_store = MEMORY",
      "mmap_size = 268435456",
      "foreign_keys = ON",
      "busy_timeout = 30000",
      "journal_size_limit = 5242880",
      "auto_vacuum = INCREMENTAL",
    ]);
  }

  collection(name: string): SQLiteCollection {
    const existing = this.collections.get(name);
    if (existing) return existing;

    const col = new SQLiteCollection(this.db, name, this.cacheSize);
    col.on("change", (...args) => this.emit("change", ...args));
    col.on("error", (err) => this.emit("error", err));
    this.collections.set(name, col);
    return col;
  }

  transaction(fn: () => void): void {
    const runner = _functions.makeTxRunner(this.db);
    _functions.runTx(runner, fn);
  }

  vacuum(): void {
    try {
      this.db.prepare("VACUUM").run();
    } catch (err) {
      console.error("[SimpleDB] Vacuum failed:", err);
    }
  }

  checkpoint(): void {
    try {
      this.db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").run();
    } catch (err) {
      console.error("[SimpleDB] Checkpoint failed:", err);
    }
  }

  close(): void {
    for (const col of this.collections.values()) col.destroy();
    this.collections.clear();
    try {
      this.db.close();
    } catch {}
  }
}
