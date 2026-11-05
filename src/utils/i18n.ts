import type { CommandContext } from 'seyfert'
import { getGuildLang } from './db_helper.ts'

const AVAILABLE_LANGUAGES: Record<string, string> = Object.freeze({
  en: 'English',
  br: 'Portugu\u00EAs (Brasil)',
  es: 'Espa\u00F1ol (ES)',
  hi: 'Hindi (IN)',
  fr: 'French (FR)',
  ar: 'Arabic (AR)',
  bn: 'Bengali (BD)',
  ru: 'Russian (RU)',
  ja: 'Japanese (JP)',
  tr: 'Turkish (TR)',
  th: 'Thai (TH)'
})

export type Translations = ReturnType<CommandContext['t']['get']>

export const getContextLanguage = (ctx: CommandContext): string => {
  const language = ctx.guildId ? getGuildLang(ctx.guildId) : 'en'
  return Object.hasOwn(AVAILABLE_LANGUAGES, language) ? language : 'en'
}

export const getContextTranslations = (ctx: CommandContext): Translations => {
  const lang = getContextLanguage(ctx)
  try {
    return ctx.t.get(lang)
  } catch {
    return ctx.t.get('en')
  }
}

export const getLanguageDisplayName = (lang: string): string =>
  Object.hasOwn(AVAILABLE_LANGUAGES, lang)
    ? (AVAILABLE_LANGUAGES[lang] as string)
    : lang

export const getLanguageChoices = () =>
  Object.entries(AVAILABLE_LANGUAGES).map(([value, name]) => ({ name, value }))
