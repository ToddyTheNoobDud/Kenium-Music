import { SimpleDB } from "./simpleDB";
import { migrateDatabase } from "./migration";

let dbInstance: SimpleDB | null = null;

let _initialized = false;
let initPromise: Promise<void> | null = null;

let _settingsIndexed = false;
let _playlistsIndexed = false;
let _tracksIndexed = false;

export function getDatabase(): SimpleDB {
	return (dbInstance ??= new SimpleDB());
}

export async function initDatabase(): Promise<void> {
	if (_initialized) return;
	if (initPromise) return initPromise;

	initPromise = (async () => {
		await migrateDatabase();
		_initialized = true;
	})().catch((err) => {
		initPromise = null;
		throw err;
	});

	return initPromise;
}

export function closeDatabase(): void {
	if (!dbInstance) return;
	dbInstance.close();
	dbInstance = null;

	_settingsIndexed = false;
	_playlistsIndexed = false;
	_tracksIndexed = false;

	_initialized = false;
	initPromise = null;
}

export function getPlaylistsCollection() {
	const db = getDatabase();
	const collection = db.collection("playlists_v2");

	if (!_playlistsIndexed) {
		try {
			const rawDb = collection.getDatabase();
			const tableName = collection.getStats().tableName;

			rawDb
				.prepare(`
          CREATE INDEX IF NOT EXISTS idx_playlists_user_name
          ON "${tableName}"(json_extract(doc, '$.userId'), json_extract(doc, '$.name'))
        `)
				.run();

			collection.createIndex("lastModified");
			collection.createIndex("userId");
			collection.createIndex("name");

			_playlistsIndexed = true;
		} catch (err) {
			console.error("Failed to create playlists indexes:", err);
			_playlistsIndexed = false;
		}
	}

	return collection;
}

export function getTracksCollection() {
	const db = getDatabase();
	const collection = db.collection("tracks_v2");

	if (!_tracksIndexed) {
		try {
			const rawDb = collection.getDatabase();
			const tableName = collection.getStats().tableName;

			rawDb
				.prepare(`
          CREATE INDEX IF NOT EXISTS idx_tracks_playlist_order
          ON "${tableName}"(json_extract(doc, '$.playlistId'), json_extract(doc, '$.addedAt'))
        `)
				.run();

			// Optional but common:
			collection.createIndex("playlistId");
			collection.createIndex("addedAt");

			_tracksIndexed = true;
		} catch (err) {
			console.error("Failed to create tracks indexes:", err);
			_tracksIndexed = false;
		}
	}

	return collection;
}

export function getPlaylistTracks(
	playlistId: string,
	options: { limit?: number; skip?: number } = {},
) {
	// Deterministic ordering:
	return getTracksCollection().find(
		{ playlistId },
		{ ...options, sort: { addedAt: 1, _id: 1 } },
	);
}

export async function getPlaylistWithTracks(userId: string, name: string) {
	const playlists = getPlaylistsCollection();
	const playlist = playlists.findOne({ userId, name });
	if (!playlist) return null;

	const tracks = getPlaylistTracks(playlist._id as string);
	return { ...playlist, tracks: tracks || [] };
}

export function getSettingsCollection() {
	const db = getDatabase();
	const collection = db.collection("guildSettings");

	if (!_settingsIndexed) {
		try {
			// Useful for startup scan:
			collection.createIndex("twentyFourSevenEnabled");

			// Optional/legacy; if you always use _id, this isn’t required:
			collection.createIndex("guildId");

			_settingsIndexed = true;
		} catch (err) {
			console.error("Failed to create guildSettings indexes:", err);
			_settingsIndexed = false;
		}
	}

	return collection;
}
