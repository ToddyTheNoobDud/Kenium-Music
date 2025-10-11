import { SimpleDB } from './simpleDB'
import { lru } from 'tiny-lru'

export class DatabaseError extends Error {
  constructor(message, cause) {
    super(message)
    this.name = 'DatabaseError'
    this.cause = cause
  }
}

export class ValidationError extends Error {
  field = null
  value = null
  constructor(message, field, value) {
    super(message)
    this.name = 'ValidationError'
    this.field = field
    this.value = value
  }
}

// Constants
const COLLECTION_NAME = 'guildSettings'
const CACHE_MAX = 1000
const CACHE_TTL_MS = 600000
const BATCH_INTERVAL_MS = 1000
const GUILD_ID_RE = /^\d{17,20}$/
const SUPPORTED_LANGS = new Set(['en', 'br', 'es', 'hi', 'fr', 'ar', 'bn', 'ru', 'ja', 'tr'])

export const _functions = {
  isValidGuildId: (guildId) => GUILD_ID_RE.test(guildId),
  isValidLang: (lang) => SUPPORTED_LANGS.has(lang),
  createDefaultSettings: (guildId) => ({
    _id: guildId,
    guildId,
    twentyFourSevenEnabled: false,
    voiceChannelId: null,
    textChannelId: null,
    lang: 'en'
  })
}

class DatabaseManager {
  static instance = null
  db = null
  settingsCollection = null
  cache = lru(CACHE_MAX, CACHE_TTL_MS, false)
  updateQueue = new Map()
  updateTimer = null

  static getInstance() {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager()
    }
    return DatabaseManager.instance
  }

  getDb() {
    if (!this.db) {
      this.db = new SimpleDB({
        cacheSize: 100,
        maxCacheSize: 200,
        enableWAL: true
      })
    }
    return this.db
  }

  getSettingsCollection() {
    if (!this.settingsCollection) {
      this.settingsCollection = this.getDb().collection(COLLECTION_NAME)
      this.settingsCollection._db.prepare(
        `CREATE INDEX IF NOT EXISTS idx_guild_settings_guild ON col_${COLLECTION_NAME}(json_extract(doc, '$.guildId'))`
      ).run()
    }
    return this.settingsCollection
  }

  scheduleBatch() {
    if (this.updateTimer) return

    const timer = setTimeout(() => {
      this.processBatchUpdates()
      this.updateTimer = null
    }, BATCH_INTERVAL_MS)

    // Optimized: Unref properly
    if (timer.unref) timer.unref()
    this.updateTimer = timer
  }

  processBatchUpdates() {
    if (this.updateQueue.size === 0) return

    const collection = this.getSettingsCollection()
    const tx = collection._db.transaction(() => {
      for (const [guildId, updates] of this.updateQueue) {
        const existing = collection.findOne({ guildId })
        if (existing) {
          collection.update({ guildId }, updates)
          this.cache.set(guildId, { ...existing, ...updates })
        } else {
          const doc = { ..._functions.createDefaultSettings(guildId), ...updates }
          collection.insert(doc)
          this.cache.set(guildId, doc)
        }
      }
    })

    try {
      tx()
      this.updateQueue.clear()
    } catch {
      if (this.updateTimer) {
        clearTimeout(this.updateTimer)
        this.updateTimer = null
      }
      this.scheduleBatch()
    }
  }

  queueUpdate(guildId, updates) {
    const existing = this.updateQueue.get(guildId)
    this.updateQueue.set(guildId, existing ? { ...existing, ...updates } : updates)
    this.scheduleBatch()
  }

  cleanup() {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer)
      this.updateTimer = null
      this.processBatchUpdates()
    }
    this.cache.clear()
    if (this.db) {
      this.db.close()
      this.db = null
    }
    this.settingsCollection = null
  }
}

const dbManager = DatabaseManager.getInstance()

export const getGuildSettings = (guildId) => {
  if (!_functions.isValidGuildId(guildId)) {
    throw new ValidationError('Invalid guild ID format', 'guildId', guildId)
  }

  const cached = dbManager.cache.get(guildId)
  if (cached) return cached

  try {
    const collection = dbManager.getSettingsCollection()
    const found = collection.findOne({ guildId })
    const settings = found || _functions.createDefaultSettings(guildId)

    if (!found) collection.insert(settings)
    dbManager.cache.set(guildId, settings)
    return settings
  } catch (error) {
    throw new DatabaseError('Failed to retrieve guild settings', error)
  }
}

export const updateGuildSettings = (guildId, updates) => {
  if (!_functions.isValidGuildId(guildId)) {
    throw new ValidationError('Invalid guild ID format', 'guildId', guildId)
  }

  const cached = dbManager.cache.get(guildId)
  if (cached) {
    Object.assign(cached, updates)
    dbManager.cache.set(guildId, cached)
  }
  dbManager.queueUpdate(guildId, updates)
}

export const isTwentyFourSevenEnabled = (guildId) => {
  try {
    const settings = getGuildSettings(guildId)
    return settings.twentyFourSevenEnabled === true
  } catch {
    return false
  }
}

export const getChannelIds = (guildId) => {
  try {
    const settings = getGuildSettings(guildId)
    return settings.twentyFourSevenEnabled && settings.voiceChannelId && settings.textChannelId
      ? { voiceChannelId: settings.voiceChannelId, textChannelId: settings.textChannelId }
      : null
  } catch {
    return null
  }
}

export const setChannelIds = (guildId, voiceChannelId, textChannelId) => {
  if (!_functions.isValidGuildId(guildId)) {
    throw new ValidationError('Invalid guild ID format', 'guildId', guildId)
  }
  if (!voiceChannelId || !textChannelId) {
    throw new ValidationError('Channel IDs are required', 'channelIds', { voiceChannelId, textChannelId })
  }
  updateGuildSettings(guildId, { voiceChannelId, textChannelId })
}

export const getGuildLang = (guildId) => {
  try {
    return getGuildSettings(guildId).lang || 'en'
  } catch {
    return 'en'
  }
}

export const setGuildLang = (guildId, lang) => {
  if (!_functions.isValidGuildId(guildId)) {
    throw new ValidationError('Invalid guild ID format', 'guildId', guildId)
  }
  if (!_functions.isValidLang(lang)) {
    throw new ValidationError('Invalid language code', 'lang', lang)
  }

  try {
    const collection = dbManager.getSettingsCollection()
    const existing = collection.findOne({ guildId })

    if (existing) {
      collection.update({ guildId }, { lang })
      dbManager.cache.set(guildId, { ...existing, lang })
    } else {
      const doc = { ..._functions.createDefaultSettings(guildId), lang }
      collection.insert(doc)
      dbManager.cache.set(guildId, doc)
    }
    return true
  } catch {
    return false
  }
}

export const cleanupDatabase = () => dbManager.cleanup()

export const getCacheStats = () => ({
  size: dbManager.cache.size,
  evictions: dbManager.cache.evictions
})