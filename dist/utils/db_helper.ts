import { SimpleDB } from './simpleDB';

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

const VALID_LANGS = /^(en|br)$/;
const GUILD_ID_REGEX = /^\d{17,20}$/;

let dbInstance: SimpleDB | null = null;
let settingsCollection: any = null;
let languagesCollection: any = null;

const _functions = {
  initDb: (): SimpleDB => {
    if (!dbInstance) dbInstance = new SimpleDB();
    return dbInstance;
  },

  getSettingsCollection: () => {
    if (!settingsCollection) settingsCollection = _functions.initDb().collection('guildSettings');
    return settingsCollection;
  },

  getLanguagesCollection: () => {
    if (!languagesCollection) languagesCollection = _functions.initDb().collection('guildLanguages');
    return languagesCollection;
  },

  validateGuildId: (guildId: string): boolean => GUILD_ID_REGEX.test(guildId),

  validateLang: (lang: string): boolean => VALID_LANGS.test(lang)
};

export const getGuildSettings = (guildId: string): GuildSettings | null => {
  if (!_functions.validateGuildId(guildId)) return null;

  try {
    const collection = _functions.getSettingsCollection();
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
  } catch {
    return null;
  }
};

export const updateGuildSettings = (guildId: string, updates: Partial<GuildSettings>): number => {
  if (!_functions.validateGuildId(guildId)) return 0;

  try {
    return _functions.getSettingsCollection().update({ guildId }, updates);
  } catch {
    return 0;
  }
};

export const isTwentyFourSevenEnabled = (guildId: string): boolean => {
  const settings = getGuildSettings(guildId);
  return settings?.twentyFourSevenEnabled === true;
};

export const getChannelIds = (guildId: string): { voiceChannelId: string; textChannelId: string } | null => {
  const settings = getGuildSettings(guildId);
  return (settings?.twentyFourSevenEnabled && settings.voiceChannelId && settings.textChannelId)
    ? { voiceChannelId: settings.voiceChannelId, textChannelId: settings.textChannelId }
    : null;
};

export const setChannelIds = (guildId: string, voiceChannelId: string, textChannelId: string): boolean => {
  if (!_functions.validateGuildId(guildId) || !voiceChannelId || !textChannelId) return false;
  return updateGuildSettings(guildId, { voiceChannelId, textChannelId }) > 0;
};

export const getGuildLang = (guildId: string): string | null => {
  if (!_functions.validateGuildId(guildId)) return null;

  try {
    const doc = _functions.getLanguagesCollection().findOne({ guildId });
    return doc?.lang || null;
  } catch {
    return null;
  }
};

export const setGuildLang = (guildId: string, lang: string): boolean => {
  if (!_functions.validateGuildId(guildId) || !_functions.validateLang(lang)) return false;

  try {
    const collection = _functions.getLanguagesCollection();
    const existing = collection.findOne({ guildId });

    const result = existing
      ? collection.update({ guildId }, { lang })
      : collection.insert({ guildId, lang });

    return result !== null && result !== undefined;
  } catch {
    return false;
  }
};

export const deleteGuildLang = (guildId: string): boolean => {
  if (!_functions.validateGuildId(guildId)) return false;

  try {
    return _functions.getLanguagesCollection().remove({ guildId }) > 0;
  } catch {
    return false;
  }
};