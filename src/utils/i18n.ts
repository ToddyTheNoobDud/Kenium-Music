import type { CommandContext } from 'seyfert'
import { getGuildLang } from './db_helper'

// Optimized: Using Set for O(1) validation
const VALID_LANGS = new Set([
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

const AVAILABLE_LANGUAGES: Record<string, string> = Object.freeze({
  en: 'English',
  br: 'Português (Brasil)',
  es: 'Espanhol (ES)',
  hi: 'Hindi (IN)',
  fr: 'French (FR)',
  ar: 'Arabic (AR)',
  bn: 'Bengali (BD)',
  ru: 'Russian (RU)',
  ja: 'Japanese (JP)',
  tr: 'Turkish (TR)',
  th: 'Thai (TH)'
})

const REPLACEMENT_REGEX = /\{(\w+)\}/g

export const _functions = {
  isValidLang: (lang: string) => VALID_LANGS.has(lang),
  getContextLang: (guildId: string | undefined): string => {
    if (!guildId) return 'en'
    const guildLang = getGuildLang(guildId)
    return VALID_LANGS.has(guildLang) ? guildLang : 'en'
  }
}

export const getContextLanguage = (ctx: CommandContext): string =>
  _functions.getContextLang(ctx.guildId)

export const getContextTranslations = (ctx: CommandContext): any => {
  const lang = getContextLanguage(ctx)
  try {
    return ctx.t.get(lang)
  } catch {
    return ctx.t.get('en')
  }
}

export const isValidLanguage = _functions.isValidLang

export const getLanguageDisplayName = (lang: string): string =>
  VALID_LANGS.has(lang) ? (AVAILABLE_LANGUAGES[lang] as string) : lang

export const getLanguageChoices = () =>
  Object.entries(AVAILABLE_LANGUAGES).map(([value, name]) => ({ name, value }))

export const formatLocalizedString = (
  template: string,
  replacements: Record<string, string | number>
) =>
  template.replace(REPLACEMENT_REGEX, (match: string, key: string) =>
    String(replacements[key] ?? match)
  )

export const safeTranslate = (
  translations: any,
  key: string,
  fallback = key
): string => {
  const keys = key.split('.')
  let current = translations

  for (const k of keys) {
    if (current?.[k] !== undefined) {
      current = current[k]
    } else {
      return fallback
    }
  }

  return typeof current === 'string' ? current : fallback
}
