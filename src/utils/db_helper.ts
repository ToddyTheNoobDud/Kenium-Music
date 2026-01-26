import { getDatabase } from "./db";
import { lru } from "tiny-lru";

const toBool = (v: any) => v === true || v === 1 || v === "1" || v === "true";

export class DatabaseError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "DatabaseError";
    (this as any).cause = cause;
  }
}

export class ValidationError extends Error {
  field: string | null = null;
  value: unknown = null;
  constructor(message: string, field?: string, value?: unknown) {
    super(message);
    this.name = "ValidationError";
    this.field = field || null;
    this.value = value;
  }
}

const COLLECTION_NAME = "guildSettings";

const CACHE_MAX = 5000;
const CACHE_TTL_MS = 600000;

const BATCH_INTERVAL_MS = 100;
const MAX_BATCH_SIZE = 50;

const GUILD_ID_RE = /^\d{17,20}$/;
const SUPPORTED_LANGS = new Set(["en", "br", "es", "hi", "fr", "ar", "bn", "ru", "ja", "tr", "th"]);

export const _functions = {
  isValidGuildId: (guildId: string) => GUILD_ID_RE.test(guildId),
  isValidLang: (lang: string) => SUPPORTED_LANGS.has(lang),

  createDefaultSettings: (guildId: string) => ({
    _id: guildId, // IMPORTANT: _id === guildId
    guildId,
    twentyFourSevenEnabled: false,
    voiceChannelId: null,
    textChannelId: null,
    lang: "en",
  }),
};

type AnyDoc = Record<string, any>;

class DatabaseManager {
  static instance: DatabaseManager | null = null;

  settingsCollection: any = null;

  cache = lru(CACHE_MAX, CACHE_TTL_MS, true);

  updateQueue = new Map<string, AnyDoc>();
  updateTimer: NodeJS.Timeout | null = null;

  private processingMutex: Promise<void> = Promise.resolve();
  private isProcessingScheduled = false;

  consecutiveFailures = 0;
  maxFailuresBeforeDrop = 5;

  static getInstance(): DatabaseManager {
    return (DatabaseManager.instance ??= new DatabaseManager());
  }

  getSettingsCollection() {
    if (!this.settingsCollection) {
      const db = getDatabase();
      const col = db.collection(COLLECTION_NAME);

      try {
        col.createIndex?.("twentyFourSevenEnabled");
      } catch {}
      try {
        col.createIndex?.("guildId");
      } catch {}

      this.settingsCollection = col;
    }
    return this.settingsCollection;
  }

  scheduleBatch() {
    if (this.updateTimer) return;

    const timer = setTimeout(() => {
      this.updateTimer = null;
      this.processBatchUpdates();
    }, BATCH_INTERVAL_MS);

    (timer as any)?.unref?.();
    this.updateTimer = timer;
  }

  processBatchUpdates() {
    if (this.updateQueue.size === 0) return;

    // Use mutex to ensure only one batch processes at a time
    this.processingMutex = this.processingMutex.then(() => {
      return this._executeBatchUpdates();
    }).catch((err) => {
      console.error("Batch mutex error:", err);
    });
  }

  private _executeBatchUpdates() {
    if (this.updateQueue.size === 0) return;
    const collection = this.getSettingsCollection();

    const batch = this.updateQueue;
    this.updateQueue = new Map<string, AnyDoc>();

    const updates = Array.from(batch.entries());

    const chunks: Array<Array<[string, AnyDoc]>> = [];
    for (let i = 0; i < updates.length; i += MAX_BATCH_SIZE) {
      chunks.push(updates.slice(i, i + MAX_BATCH_SIZE));
    }

    try {
      for (const chunk of chunks) {
        const idsToFetch: string[] = [];
        for (const [guildId] of chunk) {
          if (!this.cache.get(guildId)) idsToFetch.push(guildId);
        }

        let existingMap = new Map<string, AnyDoc>();
        if (idsToFetch.length) {
          const existingDocs = collection.find({ _id: { $in: idsToFetch } }) as AnyDoc[];
          existingMap = new Map(existingDocs.map((d) => [String(d._id), d]));
        }

        const nowIso = new Date().toISOString();
        const docsToUpsert: AnyDoc[] = [];

        for (const [guildId, updateData] of chunk) {
          const base =
            this.cache.get(guildId) ??
            existingMap.get(guildId) ??
            _functions.createDefaultSettings(guildId);

          const createdAt = base.createdAt ?? nowIso;

          const next = {
            ...base,
            ...updateData,
            _id: guildId,
            guildId,
            createdAt,
            updatedAt: nowIso,
          };

          next.twentyFourSevenEnabled = toBool(next.twentyFourSevenEnabled);
          docsToUpsert.push(next);
        }

        const saved = collection.insert(docsToUpsert) as AnyDoc[];

        for (const doc of saved) {
          const key = String(doc._id ?? doc.guildId);
          if (key) this.cache.set(key, doc);
        }
      }

      this.consecutiveFailures = 0;
    } catch (error) {
      console.error("Batch update failed:", error);
      this.consecutiveFailures++;

      for (const [k, v] of batch.entries()) {
        const existing = this.updateQueue.get(k);
        this.updateQueue.set(k, existing ? { ...existing, ...v } : v);
      }

      if (this.updateTimer) {
        clearTimeout(this.updateTimer);
        this.updateTimer = null;
      }

      if (this.consecutiveFailures >= this.maxFailuresBeforeDrop) {
        console.error(
          `Persistent batch update failure (${this.consecutiveFailures} attempts). Dropping ${this.updateQueue.size} pending updates to prevent memory leak.`,
        );
        this.updateQueue.clear();
      } else {
        setTimeout(() => this.scheduleBatch(), BATCH_INTERVAL_MS * 2);
      }
    }
  }

  queueUpdate(guildId: string, updates: AnyDoc) {
    const existing = this.updateQueue.get(guildId);
    this.updateQueue.set(guildId, existing ? { ...existing, ...updates } : updates);
    this.scheduleBatch();
  }

  flushUpdates() {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }
    this.processBatchUpdates();
  }

  cleanup() {
    this.flushUpdates();
    this.cache.clear();
    this.settingsCollection = null;
  }
}

const dbManager = DatabaseManager.getInstance();


export const getGuildSettings = (guildId: string) => {
  if (!_functions.isValidGuildId(guildId)) {
    throw new ValidationError("Invalid guild ID format", "guildId", guildId);
  }

  const cached = dbManager.cache.get(guildId);
  if (cached) return cached;

  try {
    const collection = dbManager.getSettingsCollection();
    const found = collection.findById(guildId);

    const settings = found || _functions.createDefaultSettings(guildId);
    settings.twentyFourSevenEnabled = toBool(settings.twentyFourSevenEnabled);

    dbManager.cache.set(guildId, settings);
    return settings;
  } catch (error) {
    throw new DatabaseError("Failed to retrieve guild settings", error);
  }
};

export const updateGuildSettings = (guildId: string, updates: AnyDoc) => {
  if (!_functions.isValidGuildId(guildId)) {
    throw new ValidationError("Invalid guild ID format", "guildId", guildId);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "twentyFourSevenEnabled")) {
    updates.twentyFourSevenEnabled = toBool(updates.twentyFourSevenEnabled);
  }

  const cached = dbManager.cache.get(guildId);
  if (cached) {
    Object.assign(cached, updates);
    cached.twentyFourSevenEnabled = toBool(cached.twentyFourSevenEnabled);
    dbManager.cache.set(guildId, cached);
  }

  dbManager.queueUpdate(guildId, updates);
};

export const updateGuildSettingsSync = (guildId: string, updates: AnyDoc) => {
  if (!_functions.isValidGuildId(guildId)) {
    throw new ValidationError("Invalid guild ID format", "guildId", guildId);
  }

  try {
    const collection = dbManager.getSettingsCollection();
    const base =
      dbManager.cache.get(guildId) ??
      collection.findById(guildId) ??
      _functions.createDefaultSettings(guildId);

    const nowIso = new Date().toISOString();
    const createdAt = base.createdAt ?? nowIso;

    const next = {
      ...base,
      ...updates,
      _id: guildId,
      guildId,
      createdAt,
      updatedAt: nowIso,
    };

    next.twentyFourSevenEnabled = toBool(next.twentyFourSevenEnabled);

    const saved = collection.insert(next) as AnyDoc;
    dbManager.cache.set(guildId, saved);
    return saved;
  } catch (error) {
    throw new DatabaseError("Failed to update guild settings", error);
  }
};


export const isTwentyFourSevenEnabled = (guildId: string): boolean => {
  try {
    return toBool(getGuildSettings(guildId).twentyFourSevenEnabled);
  } catch {
    return false;
  }
};

export const getChannelIds = (guildId: string) => {
  try {
    const settings = getGuildSettings(guildId);
    return toBool(settings.twentyFourSevenEnabled) && settings.voiceChannelId && settings.textChannelId
      ? { voiceChannelId: settings.voiceChannelId, textChannelId: settings.textChannelId }
      : null;
  } catch {
    return null;
  }
};

export const setChannelIds = (guildId: string, voiceChannelId: string, textChannelId: string) => {
  if (!_functions.isValidGuildId(guildId)) {
    throw new ValidationError("Invalid guild ID format", "guildId", guildId);
  }
  if (!voiceChannelId || !textChannelId) {
    throw new ValidationError("Channel IDs are required", "channelIds", { voiceChannelId, textChannelId });
  }
  updateGuildSettingsSync(guildId, { voiceChannelId, textChannelId });
};


export const getGuildLang = (guildId: string): string => {
  try {
    const lang = String(getGuildSettings(guildId).lang || "en");
    return _functions.isValidLang(lang) ? lang : "en";
  } catch {
    return "en";
  }
};

export const setGuildLang = (guildId: string, lang: string): boolean => {
  if (!_functions.isValidGuildId(guildId)) {
    throw new ValidationError("Invalid guild ID format", "guildId", guildId);
  }
  if (!_functions.isValidLang(lang)) {
    throw new ValidationError("Invalid language code", "lang", lang);
  }

  try {
    updateGuildSettingsSync(guildId, { lang });
    return true;
  } catch {
    return false;
  }
};

export const disable247Sync = (guildId: string, reason?: string) => {
  return updateGuildSettingsSync(guildId, {
    twentyFourSevenEnabled: false,
    voiceChannelId: null,
    textChannelId: null,
    ...(reason ? { last247DisableReason: reason } : null),
  });
};

export const purgeInvalidSettings = () => {
  try {
    const collection = dbManager.getSettingsCollection();
    const all = collection.find({}, { fields: ["_id"] });
    const toDelete: string[] = [];

    for (const doc of all) {
      if (typeof doc._id === "string" && !_functions.isValidGuildId(doc._id)) {
        toDelete.push(doc._id);
      }
    }

    if (toDelete.length > 0) {
      const res = collection.delete({ _id: { $in: toDelete } });
      return res;
    }
  } catch (err) {
    console.error("[DatabaseHelper] Failed to purge invalid settings:", err);
  }
  return 0;
};

export const cleanupDatabase = () => dbManager.cleanup();

export const getCacheStats = () => ({
  size: dbManager.cache.size,
  pendingUpdates: dbManager.updateQueue.size,
});