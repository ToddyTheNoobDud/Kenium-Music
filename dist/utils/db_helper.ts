import { SimpleDB } from './simpleDB';

// Custom error classes for better error handling
export class DatabaseError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export class ValidationError extends Error {
  constructor(message: string, public readonly field: string, public readonly value: any) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class GuildNotFoundError extends Error {
  constructor(guildId: string) {
    super(`Guild not found: ${guildId}`);
    this.name = 'GuildNotFoundError';
  }
}

interface GuildSettings {
  guildId: string;
  twentyFourSevenEnabled: boolean;
  voiceChannelId: string | null;
  textChannelId: string | null;
}

interface GuildLanguage {
  guildId: string;
  lang: string;
}

const VALID_LANGS = /^(en|br|es|hi|fr|ar|bn|ru|ja)$/;
const GUILD_ID_REGEX = /^\d{17,20}$/;

class DatabaseManager {
  private static instance: DatabaseManager;
  private dbInstance: SimpleDB | null = null;
  private settingsCollection: any = null;
  private languagesCollection: any = null;
  private languageCache = new Map<string, string>();
  private cacheExpiry = new Map<string, number>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  private constructor() {}

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  private initDb(): SimpleDB {
    if (!this.dbInstance) {
      this.dbInstance = new SimpleDB();
    }
    return this.dbInstance;
  }

  getSettingsCollection() {
    if (!this.settingsCollection) {
      this.settingsCollection = this.initDb().collection('guildSettings');
    }
    return this.settingsCollection;
  }

  getLanguagesCollection() {
    if (!this.languagesCollection) {
      this.languagesCollection = this.initDb().collection('guildLanguages');
    }
    return this.languagesCollection;
  }

  validateGuildId(guildId: string): boolean {
    return GUILD_ID_REGEX.test(guildId);
  }

  validateLang(lang: string): boolean {
    return VALID_LANGS.test(lang);
  }

  // Language caching for performance
  getCachedLanguage(guildId: string): string | null {
    const now = Date.now();
    const expiry = this.cacheExpiry.get(guildId);

    if (expiry && now < expiry) {
      return this.languageCache.get(guildId) || null;
    }

    // Cache expired or not found
    this.languageCache.delete(guildId);
    this.cacheExpiry.delete(guildId);
    return null;
  }

  setCachedLanguage(guildId: string, lang: string | null): void {
    if (lang) {
      this.languageCache.set(guildId, lang);
      this.cacheExpiry.set(guildId, Date.now() + this.CACHE_TTL);
    } else {
      this.languageCache.delete(guildId);
      this.cacheExpiry.delete(guildId);
    }
  }

  // Cleanup method to prevent memory leaks
  cleanup(): void {
    this.languageCache.clear();
    this.cacheExpiry.clear();

    if (this.dbInstance) {
      this.dbInstance.close();
      this.dbInstance = null;
    }

    this.settingsCollection = null;
    this.languagesCollection = null;
  }
}

const dbManager = DatabaseManager.getInstance();

const _functions = {
  validateGuildId: (guildId: string): boolean => dbManager.validateGuildId(guildId),
  validateLang: (lang: string): boolean => dbManager.validateLang(lang)
};

export const getGuildSettings = (guildId: string): GuildSettings => {
  if (!dbManager.validateGuildId(guildId)) {
    throw new ValidationError('Invalid guild ID format', 'guildId', guildId);
  }

  try {
    const collection = dbManager.getSettingsCollection();
    let settings = collection.findOne({ guildId });

    if (!settings) {
      settings = {
        guildId,
        twentyFourSevenEnabled: false,
        voiceChannelId: null,
        textChannelId: null
      };
      collection.insert(settings);
    }

    return settings;
  } catch (error) {
    throw new DatabaseError('Failed to retrieve guild settings', error as Error);
  }
};

export const updateGuildSettings = (guildId: string, updates: Partial<GuildSettings>): number => {
  if (!dbManager.validateGuildId(guildId)) {
    throw new ValidationError('Invalid guild ID format', 'guildId', guildId);
  }

  try {
    return dbManager.getSettingsCollection().update({ guildId }, updates);
  } catch (error) {
    throw new DatabaseError('Failed to update guild settings', error as Error);
  }
};

export const isTwentyFourSevenEnabled = (guildId: string): boolean => {
  try {
    const settings = getGuildSettings(guildId);
    return settings.twentyFourSevenEnabled === true;
  } catch (error) {
    console.error('Error checking 24/7 mode:', error);
    return false;
  }
};

export const getChannelIds = (guildId: string): { voiceChannelId: string; textChannelId: string } | null => {
  try {
    const settings = getGuildSettings(guildId);
    return (settings.twentyFourSevenEnabled && settings.voiceChannelId && settings.textChannelId)
      ? { voiceChannelId: settings.voiceChannelId, textChannelId: settings.textChannelId }
      : null;
  } catch (error) {
    console.error('Error getting channel IDs:', error);
    return null;
  }
};

export const setChannelIds = (guildId: string, voiceChannelId: string, textChannelId: string): boolean => {
  if (!dbManager.validateGuildId(guildId)) {
    throw new ValidationError('Invalid guild ID format', 'guildId', guildId);
  }
  if (!voiceChannelId || !textChannelId) {
    throw new ValidationError('Voice and text channel IDs are required', 'channelIds', { voiceChannelId, textChannelId });
  }

  try {
    return updateGuildSettings(guildId, { voiceChannelId, textChannelId }) > 0;
  } catch (error) {
    throw new DatabaseError('Failed to set channel IDs', error as Error);
  }
};

export const getGuildLang = (guildId: string): string | null => {
  if (!dbManager.validateGuildId(guildId)) {
    throw new ValidationError('Invalid guild ID format', 'guildId', guildId);
  }

  // Check cache first
  const cached = dbManager.getCachedLanguage(guildId);
  if (cached !== null) return cached;

  try {
    const doc = dbManager.getLanguagesCollection().findOne({ guildId });
    const lang = doc?.lang || null;
    dbManager.setCachedLanguage(guildId, lang);
    return lang;
  } catch (error) {
    throw new DatabaseError('Failed to retrieve guild language', error as Error);
  }
};

export const setGuildLang = (guildId: string, lang: string): boolean => {
  if (!dbManager.validateGuildId(guildId)) {
    throw new ValidationError('Invalid guild ID format', 'guildId', guildId);
  }
  if (!dbManager.validateLang(lang)) {
    throw new ValidationError('Invalid language code', 'lang', lang);
  }

  try {
    const collection = dbManager.getLanguagesCollection();
    const existing = collection.findOne({ guildId });

    const result = existing
      ? collection.update({ guildId }, { lang })
      : collection.insert({ guildId, lang });

    const success = result !== null && result !== undefined;
    if (success) {
      dbManager.setCachedLanguage(guildId, lang);
    }
    return success;
  } catch (error) {
    throw new DatabaseError('Failed to set guild language', error as Error);
  }
};

export const deleteGuildLang = (guildId: string): boolean => {
  if (!dbManager.validateGuildId(guildId)) {
    throw new ValidationError('Invalid guild ID format', 'guildId', guildId);
  }

  try {
    const success = dbManager.getLanguagesCollection().remove({ guildId }) > 0;
    if (success) {
      dbManager.setCachedLanguage(guildId, null);
    }
    return success;
  } catch (error) {
    throw new DatabaseError('Failed to delete guild language', error as Error);
  }
};

// Export cleanup function for proper shutdown
export const cleanupDatabase = (): void => {
  dbManager.cleanup();
};
