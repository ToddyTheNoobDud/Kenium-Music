import { getDatabase } from './db'
import { lru } from 'tiny-lru'

export class DatabaseError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'DatabaseError'
    this.cause = cause
  }
}

export class ValidationError extends Error {
  field: string | null = null
  value: unknown = null
  constructor(message: string, field?: string, value?: unknown) {
    super(message)
    this.name = 'ValidationError'
    this.field = field || null
    this.value = value
  }
}

const COLLECTION_NAME = 'guildSettings'
const CACHE_MAX = 1000
const CACHE_TTL_MS = 600000
const BATCH_INTERVAL_MS = 100
const MAX_BATCH_SIZE = 50
const GUILD_ID_RE = /^\d{17,20}$/
const SUPPORTED_LANGS = new Set(['en', 'br', 'es', 'hi', 'fr', 'ar', 'bn', 'ru', 'ja', 'tr', 'th'])

export const _functions = {
  isValidGuildId: (guildId: string) => GUILD_ID_RE.test(guildId),
  isValidLang: (lang: string) => SUPPORTED_LANGS.has(lang),
  createDefaultSettings: (guildId: string) => ({
    _id: guildId,
    guildId,
    twentyFourSevenEnabled: false,
    voiceChannelId: null,
    textChannelId: null,
    lang: 'en'
  })
}

class DatabaseManager {
  static instance: DatabaseManager | null = null
  settingsCollection: any = null
  cache = lru(CACHE_MAX, CACHE_TTL_MS, false)
  updateQueue = new Map<string, any>()
  updateTimer: NodeJS.Timeout | null = null
  isProcessing = false
  consecutiveFailures = 0
  maxFailuresBeforeDrop = 5

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager()
    }
    return DatabaseManager.instance
  }

  getSettingsCollection() {
    if (!this.settingsCollection) {
      const db = getDatabase()
      this.settingsCollection = db.collection(COLLECTION_NAME)

      try {
        // Use the wrapper method, checking if it exists first to avoid crashes
        if (this.settingsCollection.createIndex) {
            this.settingsCollection.createIndex('guildId')
        }
      } catch (err) {
        console.warn('Failed to create guild settings index:', err)
      }
    }
    return this.settingsCollection
  }

  scheduleBatch() {
    if (this.updateTimer) return

    const timer = setTimeout(() => {
      this.processBatchUpdates()
      this.updateTimer = null
    }, BATCH_INTERVAL_MS)

    if (timer.unref) timer.unref()
    this.updateTimer = timer
  }

  processBatchUpdates() {
    if (this.updateQueue.size === 0) return
    if (this.isProcessing) {
      this.scheduleBatch()
      return
    }

    this.isProcessing = true
    const collection = this.getSettingsCollection()
    const updates = Array.from(this.updateQueue.entries())

    const chunks = []
    for (let i = 0; i < updates.length; i += MAX_BATCH_SIZE) {
      chunks.push(updates.slice(i, i + MAX_BATCH_SIZE))
    }

    try {
      for (const chunk of chunks) {

        for (const [guildId, updateData] of chunk) {
            const existing = collection.findOne({ guildId })

            if (existing) {
              collection.updateAtomic(
                { _id: existing._id },
                { $set: updateData }
              )
              this.cache.set(guildId, { ...existing, ...updateData })
            } else {
              const doc = { ..._functions.createDefaultSettings(guildId), ...updateData }
              collection.insert(doc)
              this.cache.set(guildId, doc)
            }
        }
      }

      this.consecutiveFailures = 0
      this.updateQueue.clear()
    } catch (error) {
      console.error('Batch update failed:', error)
      this.consecutiveFailures++

      if (this.updateTimer) {
        clearTimeout(this.updateTimer)
        this.updateTimer = null
      }

      if (this.consecutiveFailures >= this.maxFailuresBeforeDrop) {
        console.error(
          `Persistent batch update failure (${this.consecutiveFailures} attempts). Dropping ${this.updateQueue.size} pending updates to prevent memory leak.`,
        )
        this.updateQueue.clear()
      } else {
        setTimeout(() => this.scheduleBatch(), BATCH_INTERVAL_MS * 2)
      }
    } finally {
      this.isProcessing = false
    }
  }

  queueUpdate(guildId: string, updates: any) {
    const existing = this.updateQueue.get(guildId)
    this.updateQueue.set(guildId, existing ? { ...existing, ...updates } : updates)
    this.scheduleBatch()
  }

  flushUpdates() {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer)
      this.updateTimer = null
    }
    this.processBatchUpdates()
  }

  cleanup() {
    this.flushUpdates()
    this.cache.clear()
    this.settingsCollection = null
  }
}

const dbManager = DatabaseManager.getInstance()

export const getGuildSettings = (guildId: string) => {
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

export const updateGuildSettings = (guildId: string, updates: any) => {
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

export const updateGuildSettingsSync = (guildId: string, updates: any) => {
  if (!_functions.isValidGuildId(guildId)) {
    throw new ValidationError('Invalid guild ID format', 'guildId', guildId)
  }

  try {
    const collection = dbManager.getSettingsCollection()
    const existing = collection.findOne({ guildId })

    if (existing) {
      collection.updateAtomic({ _id: existing._id }, { $set: updates })
      const updated = { ...existing, ...updates }
      dbManager.cache.set(guildId, updated)
      return updated
    } else {
      const doc = { ..._functions.createDefaultSettings(guildId), ...updates }
      collection.insert(doc)
      dbManager.cache.set(guildId, doc)
      return doc
    }
  } catch (error) {
    throw new DatabaseError('Failed to update guild settings', error)
  }
}

export const isTwentyFourSevenEnabled = (guildId: string): boolean => {
  try {
    const settings = getGuildSettings(guildId)
    return settings.twentyFourSevenEnabled === true
  } catch {
    return false
  }
}

export const getChannelIds = (guildId: string) => {
  try {
    const settings = getGuildSettings(guildId)
    return settings.twentyFourSevenEnabled && settings.voiceChannelId && settings.textChannelId
      ? { voiceChannelId: settings.voiceChannelId, textChannelId: settings.textChannelId }
      : null
  } catch {
    return null
  }
}

export const setChannelIds = (guildId: string, voiceChannelId: string, textChannelId: string) => {
  if (!_functions.isValidGuildId(guildId)) {
    throw new ValidationError('Invalid guild ID format', 'guildId', guildId)
  }
  if (!voiceChannelId || !textChannelId) {
    throw new ValidationError('Channel IDs are required', 'channelIds', { voiceChannelId, textChannelId })
  }
  updateGuildSettingsSync(guildId, { voiceChannelId, textChannelId })
}

export const getGuildLang = (guildId: string): string => {
  try {
    return getGuildSettings(guildId).lang || 'en'
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
      collection.updateAtomic({ _id: existing._id }, { $set: { lang } })
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
  pendingUpdates: dbManager.updateQueue.size
})
