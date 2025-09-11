/*
  simpleDB.ts - SQLite-backed SimpleDB
  Provides a minimal compatibility layer for the project's existing SimpleDB API.
  Supported operations: collection(name).find/findOne/insert/update/delete/count/findById/getStats, and collection emits 'change'.
*/

import EventEmitter from "node:events";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

interface SimpleDBOptions {
	dbPath?: string;
}

function ensureDir(dir: string) {
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

class SQLiteCollection extends EventEmitter {
	private db: any;
	private tableName: string;

	constructor(db: any, name: string) {
		super();
		this.db = db;
		this.tableName = `col_${name}`;
		this.db
			.prepare(
				`CREATE TABLE IF NOT EXISTS ${this.tableName} ( _id TEXT PRIMARY KEY, doc TEXT NOT NULL, createdAt TEXT, updatedAt TEXT )`,
			)
			.run();
		try {
			this.db
				.prepare(
					`CREATE INDEX IF NOT EXISTS ${this.tableName}_updated_idx ON ${this.tableName}(updatedAt)`,
				)
				.run();
		} catch {}
	}

	private normalizeDoc(doc: any) {
		if (!doc._id)
			doc._id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
		return doc;
	}

	insert(docs: any | any[]) {
		const arr = Array.isArray(docs) ? docs : [docs];
		const now = new Date().toISOString();
		const stmt = this.db.prepare(
			`INSERT OR REPLACE INTO ${this.tableName} (_id, doc, createdAt, updatedAt) VALUES (@_id, @doc, @createdAt, @updatedAt)`,
		);
		const tx = this.db.transaction((items: any[]) => {
			for (const it of items) {
				const doc = this.normalizeDoc(it);
				const payload = JSON.stringify(doc);
				stmt.run({
					_id: doc._id,
					doc: payload,
					createdAt: doc.createdAt || now,
					updatedAt: now,
				});
			}
		});
		tx(arr);
		this.emit("change", "insert", arr);
		return arr.length === 1 ? arr[0] : arr;
	}

	private rowToDoc(row: any) {
		if (!row) return null;
		try {
			return JSON.parse(row.doc);
		} catch {
			return null;
		}
	}

	find(query: any = {}) {
		if (!query || Object.keys(query).length === 0) {
			const rows = this.db.prepare(`SELECT doc FROM ${this.tableName}`).all();
			return rows.map((r: any) => this.rowToDoc(r)).filter(Boolean);
		}

		const where: string[] = [];
		const params: any = {};
		let i = 0;

		for (const k of Object.keys(query)) {
			i++;
			const val = query[k];

			if (typeof val === "boolean") {
				// For booleans, use json_extract with type casting to ensure proper comparison
				where.push(`CAST(json_extract(doc, '$.${k}') AS INTEGER) = @v${i}`);
				params[`v${i}`] = val ? 1 : 0;
			} else if (val === null || val === undefined) {
				where.push(`json_extract(doc, '$.${k}') IS NULL`);
			} else if (
				typeof val === "number" ||
				typeof val === "string" ||
				typeof val === "bigint"
			) {
				where.push(`json_extract(doc, '$.${k}') = @v${i}`);
				params[`v${i}`] = val;
			} else {
				// For arrays/objects, compare as JSON strings
				where.push(`json_extract(doc, '$.${k}') = json(@v${i})`);
				params[`v${i}`] = JSON.stringify(val);
			}
		}

		const sql = `SELECT doc FROM ${this.tableName} WHERE ${where.join(" AND ")}`;
		const rows = this.db.prepare(sql).all(params);
		return rows.map((r: any) => this.rowToDoc(r)).filter(Boolean);
	}

	findOne(query: any = {}) {
		const res = this.find(query);
		return res.length ? res[0] : null;
	}

	findById(id: string) {
		const row = this.db
			.prepare(`SELECT doc FROM ${this.tableName} WHERE _id = ?`)
			.get(id);
		return this.rowToDoc(row);
	}

	update(query: any, updates: any) {
		if (query?._id) {
			const existing = this.findById(query._id);
			if (!existing) return 0;
			const merged = Object.assign({}, existing, updates);
			merged._id = existing._id;
			merged.updatedAt = new Date().toISOString();
			this.db
				.prepare(
					`UPDATE ${this.tableName} SET doc = @doc, updatedAt = @updatedAt WHERE _id = @id`,
				)
				.run({
					doc: JSON.stringify(merged),
					updatedAt: merged.updatedAt,
					id: merged._id,
				});
			this.emit("change", "update", merged);
			return 1;
		}
		const matches = this.find(query);
		if (!matches.length) return 0;
		const now = new Date().toISOString();
		const stmt = this.db.prepare(
			`UPDATE ${this.tableName} SET doc = @doc, updatedAt = @updatedAt WHERE _id = @id`,
		);
		const tx = this.db.transaction((items: any[]) => {
			for (const ex of items) {
				const merged = Object.assign({}, ex, updates);
				merged._id = ex._id;
				merged.updatedAt = now;
				stmt.run({
					doc: JSON.stringify(merged),
					updatedAt: now,
					id: merged._id,
				});
			}
		});
		tx(matches);
		this.emit("change", "update", { query, updates });
		return matches.length;
	}

	delete(query: any) {
		if (!query || Object.keys(query).length === 0) return 0;
		if (query._id) {
			const res = this.db
				.prepare(`DELETE FROM ${this.tableName} WHERE _id = ?`)
				.run(query._id);
			this.emit("change", "delete", { _id: query._id });
			return res.changes;
		}
		const matches = this.find(query);
		if (!matches.length) return 0;
		const stmt = this.db.prepare(`DELETE FROM ${this.tableName} WHERE _id = ?`);
		const tx = this.db.transaction((items: any[]) => {
			for (const m of items) stmt.run(m._id);
		});
		tx(matches);
		this.emit("change", "delete", { query });
		return matches.length;
	}

	count(query: any = {}) {
		if (!query || Object.keys(query).length === 0) {
			const row = this.db
				.prepare(`SELECT COUNT(*) as c FROM ${this.tableName}`)
				.get();
			return row.c;
		}
		const res = this.find(query);
		return res.length;
	}
	getStats() {
		const row = this.db
			.prepare(`SELECT COUNT(*) as c FROM ${this.tableName}`)
			.get();
		return { documentCount: row.c };
	}
}

class SimpleDB extends EventEmitter {
	private db: any;
	private dbPath: string;
	private collections = new Map<string, SQLiteCollection>();

	constructor(options: SimpleDBOptions = {}) {
		super();
		this.dbPath = options.dbPath || join(process.cwd(), "db", "sey.sqlite");
		ensureDir(join(process.cwd(), "db"));
		this.db = new Database(this.dbPath);
		try {
			this.db.pragma("journal_mode = WAL");
		} catch {}
	}

	collection(name: string) {
		if (this.collections.has(name)) return this.collections.get(name)!;
		const col = new SQLiteCollection(this.db, name);
		this.collections.set(name, col);
		col.on("change", (t: any, d: any) => this.emit("change", t, d));
		return col;
	}

	close() {
		for (const c of this.collections.values()) c.removeAllListeners();
		try {
			this.db.close();
		} catch {}
	}
}

export { SimpleDB };
