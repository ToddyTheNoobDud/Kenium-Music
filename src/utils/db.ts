import { SimpleDB } from "./simpleDB";
import { migrateDatabase } from "./migration";

let dbInstance: SimpleDB | null = null;
let _settingsIndexed = false;
let _initialized = false;

export function getDatabase(): SimpleDB {
	return (dbInstance ??= new SimpleDB());
}

let initPromise: Promise<void> | null = null;

export async function initDatabase(): Promise<void> {
    if (_initialized) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        await migrateDatabase();
        _initialized = true;
    })().catch(err => {
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

let _playlistsIndexed = false;
let _tracksIndexed = false;

export function getPlaylistsCollection() {
	const db = getDatabase();
	const collection = db.collection("playlists_v2");
	if (!_playlistsIndexed) {
		try {
			const rawDb = collection.getDatabase();
			const tableName = collection.getStats().tableName;

			rawDb.prepare(`
				CREATE INDEX IF NOT EXISTS idx_playlists_user_name
				ON "${tableName}"(json_extract(doc, '$.userId'), json_extract(doc, '$.name'))
			`).run();

			collection.createIndex("lastModified");
            _playlistsIndexed = true;
		} catch (err) {
            console.error("Failed to create playlists index:", err);
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
            // Compound index for deterministic ordering (ordering by addedAt within a playlist)
            const rawDb = collection.getDatabase();
            const tableName = collection.getStats().tableName;
            rawDb.prepare(`
                CREATE INDEX IF NOT EXISTS idx_tracks_playlist_order
                ON "${tableName}"(json_extract(doc, '$.playlistId'), json_extract(doc, '$.addedAt'))
            `).run();
            _tracksIndexed = true;
		} catch (err) {
            console.error("Failed to create tracks index:", err);
            _tracksIndexed = false;
        }
	}
	return collection;
}

export function getPlaylistTracks(playlistId: string, options: { limit?: number; skip?: number } = {}) {
    return getTracksCollection().find({ playlistId }, { ...options, sort: { addedAt: 1, _id: 1 } });
}

export async function getPlaylistWithTracks(userId: string, name: string) {
    const playlists = getPlaylistsCollection();

    const playlist = playlists.findOne({ userId, name });
    if (!playlist) return null;

    const playlistTracks = getPlaylistTracks(playlist._id as string);
    return { ...playlist, tracks: playlistTracks || [] };
}

export function getSettingsCollection() {
	const db = getDatabase();
	const collection = db.collection("guildSettings");

	if (!_settingsIndexed) {
		try {
			collection.createIndex("guildId");
            _settingsIndexed = true;
		} catch (err) {
            console.error("Failed to create guildSettings index:", err);
            _settingsIndexed = false;
        }
	}

	return collection;
}
