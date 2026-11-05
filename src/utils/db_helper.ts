import { lru } from 'tiny-lru'
import {
  type GuildSettingsRow,
  getSettingsCollection as getSettingsDbCollection
} from './collections.ts'

const toBool = (value: unknown): boolean =>
  value === true || value === 1 || value === '1' || value === 'true'

export interface GuildSettings extends Record<string, unknown> {
  _id: string
  guildId: string
  twentyFourSevenEnabled: boolean
  voiceChannelId: string | null
  textChannelId: string | null
  lang: string | null
  last247DisableReason?: string | null
  createdAt?: string
  updatedAt?: string
}

export class DatabaseError extends Error {
  override cause?: unknown

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

const CACHE_MAX = 5000
const CACHE_TTL_MS = 600000

const GUILD_ID_RE = /^\d{17,20}$/
const SUPPORTED_LANGS = new Set([
  'en',
  'br',
  'es',
  'hi',
  'fr',
  'ar',
  'bn',
  'ru',
  'ja',
  'tr',
  'th'
])

const SETTINGS_FIELDS = [
  'guildId',
  'twentyFourSevenEnabled',
  'voiceChannelId',
  'textChannelId',
  'lang',
  'last247DisableReason',
  'createdAt',
  'updatedAt'
] as const

const isValidGuildId = (guildId: string) => GUILD_ID_RE.test(guildId)
const isValidLang = (lang: string) => SUPPORTED_LANGS.has(lang)

const createDefaultSettings = (guildId: string): GuildSettings => ({
  _id: guildId,
  guildId,
  twentyFourSevenEnabled: false,
  voiceChannelId: null,
  textChannelId: null,
  lang: 'en'
})

function settingsFromRow(
  guildId: string,
  row: GuildSettingsRow
): GuildSettings {
  return {
    ...row,
    _id: row._id || guildId,
    guildId: row.guildId || guildId,
    twentyFourSevenEnabled: toBool(row.twentyFourSevenEnabled),
    voiceChannelId: row.voiceChannelId ?? null,
    textChannelId: row.textChannelId ?? null,
    lang: row.lang ?? null
  }
}

const settingsCache = lru<GuildSettings>(CACHE_MAX, CACHE_TTL_MS, true)

export const getGuildSettings = (guildId: string) => {
  if (!isValidGuildId(guildId)) {
    throw new ValidationError('Invalid guild ID format', 'guildId', guildId)
  }

  const cached = settingsCache.get(guildId)
  if (cached) {
    return { ...cached }
  }

  try {
    const collection = getSettingsDbCollection()
    const found = collection.findById(guildId, { fields: [...SETTINGS_FIELDS] })

    const settings = found
      ? settingsFromRow(guildId, found)
      : createDefaultSettings(guildId)

    settingsCache.set(guildId, { ...settings })
    return { ...settings }
  } catch (error) {
    throw new DatabaseError('Failed to retrieve guild settings', error)
  }
}

export const updateGuildSettingsSync = (
  guildId: string,
  updates: Partial<GuildSettings>
) => {
  if (!isValidGuildId(guildId)) {
    throw new ValidationError('Invalid guild ID format', 'guildId', guildId)
  }

  try {
    const collection = getSettingsDbCollection()
    const base =
      settingsCache.get(guildId) ??
      collection.findById(guildId, { fields: [...SETTINGS_FIELDS] }) ??
      createDefaultSettings(guildId)

    const nowIso = new Date().toISOString()
    const createdAt = base.createdAt ?? nowIso

    const next = settingsFromRow(guildId, {
      ...base,
      ...updates,
      _id: guildId,
      guildId,
      createdAt,
      updatedAt: nowIso
    })

    collection.insert(next)
    settingsCache.set(guildId, { ...next })
    return { ...next }
  } catch (error) {
    throw new DatabaseError('Failed to update guild settings', error)
  }
}

export const isTwentyFourSevenEnabled = (guildId: string): boolean => {
  try {
    return getGuildSettings(guildId).twentyFourSevenEnabled
  } catch (error) {
    console.error('[db_helper] Failed to check 24/7 for', guildId, error)
    return false
  }
}

export const get247ChannelIds = (guildId: string) => {
  try {
    const settings = getGuildSettings(guildId)
    return settings.twentyFourSevenEnabled && settings.voiceChannelId
      ? {
          voiceChannelId: settings.voiceChannelId,
          textChannelId: settings.textChannelId || null
        }
      : null
  } catch (error) {
    console.error('[db_helper] Unexpected error:', error)
    return null
  }
}

export const getGuildLang = (guildId: string): string => {
  try {
    const lang = String(getGuildSettings(guildId).lang || 'en')
    return isValidLang(lang) ? lang : 'en'
  } catch (error) {
    console.error('[db_helper] Failed to get language for', guildId, error)
    return 'en'
  }
}

export const setGuildLang = (guildId: string, lang: string): boolean => {
  if (!isValidGuildId(guildId)) {
    throw new ValidationError('Invalid guild ID format', 'guildId', guildId)
  }
  if (!isValidLang(lang)) {
    throw new ValidationError('Invalid language code', 'lang', lang)
  }

  try {
    updateGuildSettingsSync(guildId, { lang })
    return true
  } catch (error) {
    console.error('[db_helper] Failed to set language for', guildId, error)
    return false
  }
}

export const purgeInvalidSettings = async () => {
  try {
    const collection = getSettingsDbCollection()
    const all = collection.find({}, { fields: ['_id'] })
    const toDelete: string[] = []

    for (const doc of all) {
      if (!isValidGuildId(doc._id)) {
        toDelete.push(doc._id)
      }
    }

    if (toDelete.length > 0) {
      let count = 0
      for (let offset = 0; offset < toDelete.length; offset += 50) {
        const chunk = toDelete.slice(offset, offset + 50)
        collection.delete({ _id: { $in: chunk } })
        count += chunk.length
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      return count
    }
  } catch (err) {
    console.error('[DatabaseHelper] Failed to purge invalid settings:', err)
  }
  return 0
}

export const getAll247Settings = () => {
  try {
    const collection = getSettingsDbCollection()
    const docs = collection.find(
      {
        twentyFourSevenEnabled: 1,
        voiceChannelId: { $ne: null }
      },
      { fields: ['guildId', 'voiceChannelId', 'textChannelId'] }
    )
    return docs.flatMap((doc) => {
      if (!doc.voiceChannelId) {
        return []
      }
      return {
        guildId: doc.guildId || String(doc._id),
        voiceChannelId: doc.voiceChannelId,
        textChannelId: doc.textChannelId || null
      }
    })
  } catch (error) {
    console.error('[db_helper] Failed to get all 24/7 settings:', error)
    return []
  }
}
