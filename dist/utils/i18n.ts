import type { CommandContext, ComponentContext } from 'seyfert';
import { getGuildLang } from './db_helper';

const AVAILABLE_LANGUAGES = {
  en: 'English',
  br: 'Português (Brasil)'
} as const;

const LANG_REGEX = /^(en|br)$/;
const REPLACEMENT_REGEX = /\{(\w+)\}/g;

const _functions = {
  isValidLang: (lang: string): lang is keyof typeof AVAILABLE_LANGUAGES => LANG_REGEX.test(lang),

  getContextLang: (guildId?: string): string => {
    if (!guildId) return 'en';
    const guildLang = getGuildLang(guildId);
    return (guildLang && _functions.isValidLang(guildLang)) ? guildLang : 'en';
  }
};

export const getContextLanguage = (ctx: CommandContext | ComponentContext | { guildId?: string }): string =>
  _functions.getContextLang(ctx.guildId);

export const getContextTranslations = (ctx: CommandContext | ComponentContext) => {
  const lang = getContextLanguage(ctx);
  try {
    return ctx.t.get(lang);
  } catch {
    return ctx.t.get('en');
  }
};

export const isValidLanguage = _functions.isValidLang;

export const getLanguageDisplayName = (lang: string): string =>
  _functions.isValidLang(lang) ? AVAILABLE_LANGUAGES[lang] : lang;

export const getLanguageChoices = () =>
  Object.entries(AVAILABLE_LANGUAGES).map(([value, name]) => ({ name, value }));

export const formatLocalizedString = (template: string, replacements: Record<string, string | number>): string =>
  template.replace(REPLACEMENT_REGEX, (match, key) => String(replacements[key] ?? match));

export const safeTranslate = (translations: any, key: string, fallback = key): string => {
  const keys = key.split('.');
  let current = translations;

  for (const k of keys) {
    if (current?.[k] !== undefined) {
      current = current[k];
    } else {
      return fallback;
    }
  }

  return typeof current === 'string' ? current : fallback;
};