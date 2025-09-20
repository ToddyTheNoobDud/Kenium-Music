import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";

function loadJson(filePath: string) {
	if (!existsSync(filePath)) return null;
	const raw = readFileSync(filePath, "utf8");
	try {
		return JSON.parse(raw);
	} catch (e) {
		console.error(`Failed to parse ${filePath}:`, e);
		return null;
	}
}

function ensureTable(db: any, tableName: string) {
	db.prepare(
		`CREATE TABLE IF NOT EXISTS ${tableName} ( _id TEXT PRIMARY KEY, doc TEXT NOT NULL, createdAt TEXT, updatedAt TEXT )`,
	).run();
}

function insertDocs(db: any, tableName: string, docs: any[]) {
	if (!Array.isArray(docs) || docs.length === 0) return 0;
	const stmt = db.prepare(
		`INSERT OR REPLACE INTO ${tableName} (_id, doc, createdAt, updatedAt) VALUES (@_id, @doc, @createdAt, @updatedAt)`,
	);
	const tx = db.transaction((items: any[]) => {
		const now = new Date().toISOString();
		for (const it of items) {
			const doc = Object.assign({}, it);
			const id = String(
				doc._id || doc._id === 0
					? doc._id
					: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
			);
			if (!doc.createdAt) doc.createdAt = doc.createdAt || now;
			const payload = JSON.stringify(doc);
			stmt.run({
				_id: id,
				doc: payload,
				createdAt: doc.createdAt,
				updatedAt: now,
			});
		}
	});
	tx(docs);
	return docs.length;
}

function migrateCollection(db: any, collectionName: string, jsonPath: string) {
	const table = `col_${collectionName}`;
	ensureTable(db, table);
	const data = loadJson(jsonPath);
	if (!data) {
		console.log(`No data found at ${jsonPath}`);
		return;
	}
	const inserted = insertDocs(db, table, data);
	console.log(`Inserted ${inserted} documents into ${table}`);
}

function main() {
	const dbPath = join(process.cwd(), "db", "sey.sqlite");
	const db = new Database(dbPath);
	try {
		db.run("PRAGMA journal_mode = WAL;");
	} catch (e) {
		console.warn("Failed to set WAL mode", e);
	}

	// Migrate guildSettings shards
	const gsShard = join(process.cwd(), "db", "guildSettings", "shard_0.json");
	migrateCollection(db, "guildSettings", gsShard);

	const plShard = join(process.cwd(), "db", "playlists", "shard_0.json");
	migrateCollection(db, "playlists", plShard);

	db.close();
	console.log("Migration complete");
}

if (require.main === module) main();
