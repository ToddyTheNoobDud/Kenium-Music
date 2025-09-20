import { SimpleDB } from './simpleDB'
import { lru } from 'tiny-lru'

export class DatabaseError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message)
    this.name = 'DatabaseError'
  }
}

export class ValidationError extends Error {
  constructor(message: string, public readonly field: string, public readonly value: any) {
    super(message)
    this.name = 'ValidationError'
  }
}

interface GuildSettings {
  _id: string
  guildId: string
  twentyFourSevenEnabled: boolean
  voiceChannelId: string | null
  textChannelId: string | null
  lang: string
}

const COLLECTION_NAME = 'guildSettings'
const CACHE_MAX = 1000
const CACHE_TTL_MS = 600000
const BATCH_INTERVAL_MS = 1000
const GUILD_ID_RE = /^\d{17,20}$/
const SUPPORTED_LANGS = new Set(['en', 'br', 'es', 'hi', 'fr', 'ar', 'bn', 'ru', 'ja'])

export const _functions = {
  isValidGuildId: (guildId: string): boolean => GUILD_ID_RE.test(guildId),
  isValidLang: (lang: string): boolean => SUPPORTED_LANGS.has(lang),
  createDefaultSettings: (guildId: string): GuildSettings => ({
    _id: guildId,
    guildId,
    twentyFourSevenEnabled: false,
    voiceChannelId: null,
    textChannelId: null,
    lang: 'en'
  })
}

class DatabaseManager {
  private static instance: DatabaseManager
  private db: SimpleDB | null = null
  private settingsCollection: any = null
  readonly cache = lru<GuildSettings>(CACHE_MAX, CACHE_TTL_MS, false)
  private updateQueue = new Map<string, Partial<GuildSettings>>()
  private updateTimer: NodeJS.Timeout | null = null

  private constructor() {}

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) DatabaseManager.instance = new DatabaseManager()
    return DatabaseManager.instance
  }

  private getDb(): SimpleDB {
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

  private scheduleBatch(): void {
    if (this.updateTimer) return
    const t = setTimeout(() => {
      this.processBatchUpdates()
      this.updateTimer = null
    }, BATCH_INTERVAL_MS) as NodeJS.Timeout
    t.unref()
    this.updateTimer = t
  }

  private processBatchUpdates(): void {
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

  queueUpdate(guildId: string, updates: Partial<GuildSettings>): void {
    const existing = this.updateQueue.get(guildId)
    this.updateQueue.set(guildId, existing ? { ...existing, ...updates } : updates)
    this.scheduleBatch()
  }

  cleanup(): void {
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

export const getGuildSettings = (guildId: string): GuildSettings => {
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
    throw new DatabaseError('Failed to retrieve guild settings', error as Error)
  }
}

export const updateGuildSettings = (guildId: string, updates: Partial<GuildSettings>): void => {
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

export const isTwentyFourSevenEnabled = (guildId: string): boolean => {
  try {
    const settings = getGuildSettings(guildId)
    return settings.twentyFourSevenEnabled === true
  } catch {
    return false
  }
}

export const getChannelIds = (guildId: string): { voiceChannelId: string; textChannelId: string } | null => {
  try {
    const settings = getGuildSettings(guildId)
    return settings.twentyFourSevenEnabled && settings.voiceChannelId && settings.textChannelId
      ? { voiceChannelId: settings.voiceChannelId, textChannelId: settings.textChannelId }
      : null
  } catch {
    return null
  }
}

export const setChannelIds = (guildId: string, voiceChannelId: string, textChannelId: string): void => {
  if (!_functions.isValidGuildId(guildId)) {
    throw new ValidationError('Invalid guild ID format', 'guildId', guildId)
  }
  if (!voiceChannelId || !textChannelId) {
    throw new ValidationError('Channel IDs are required', 'channelIds', { voiceChannelId, textChannelId })
  }
  updateGuildSettings(guildId, { voiceChannelId, textChannelId })
}

export const getGuildLang = (guildId: string): string => {
  try {
    const settings = getGuildSettings(guildId)
    return settings.lang || 'en'
  } catch {
    return 'en'
  }
}

export const setGuildLang = (guildId: string, lang: string): boolean => {
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

export const cleanupDatabase = (): void => {
  dbManager.cleanup()
}

export const getCacheStats = () => {
  const cache: any = dbManager.cache as any
  return {
    size: cache.size,
    evictions: cache.evictions
  }
}