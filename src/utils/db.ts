import { SimpleDB } from "./simpleDB";

let dbInstance: SimpleDB | null = null;
let _playlistsIndexed = false;
let _settingsIndexed = false;

export function getDatabase(): SimpleDB {
	return (dbInstance ??= new SimpleDB());
}

export function closeDatabase(): void {
	if (!dbInstance) return;
	dbInstance.close();
	dbInstance = null;
	_playlistsIndexed = false;
	_settingsIndexed = false;
}

export function getPlaylistsCollection() {
	const db = getDatabase();
	const collection = db.collection("playlists");

	if (!_playlistsIndexed) {
		_playlistsIndexed = true;

		try {
			(collection as any).db
				.prepare(
					`CREATE INDEX IF NOT EXISTS idx_playlists_user_name
					 ON "col_playlists"(
						 json_extract(doc, '$.userId'),
						 json_extract(doc, '$.name')
					 )`,
				)
				.run();
		} catch {}

		try {
			(collection as any).db
				.prepare(
					`CREATE INDEX IF NOT EXISTS idx_playlists_user_lastModified
					 ON "col_playlists"(
						 json_extract(doc, '$.userId'),
						 json_extract(doc, '$.lastModified')
					 )`,
				)
				.run();
		} catch {}

		try {
			(collection as any).db
				.prepare(
					`CREATE INDEX IF NOT EXISTS idx_playlists_user_createdAt
					 ON "col_playlists"(
						 json_extract(doc, '$.userId'),
						 json_extract(doc, '$.createdAt')
					 )`,
				)
				.run();
		} catch {}

		try {
			(collection as any).db
				.prepare(
					`CREATE INDEX IF NOT EXISTS idx_playlists_totalDuration
					 ON "col_playlists"(
						 json_extract(doc, '$.totalDuration')
					 )`,
				)
				.run();
		} catch {}

		try {
			collection.createIndex("userId");
			collection.createIndex("name");
			collection.createIndex("lastModified");
			collection.createIndex("createdAt");
		} catch {}
	}

	return collection;
}

export function getSettingsCollection() {
	const db = getDatabase();
	const collection = db.collection("guildSettings");

	if (!_settingsIndexed) {
		_settingsIndexed = true;
		try {
			collection.createIndex("guildId");
		} catch {}
	}

	return collection;
}
