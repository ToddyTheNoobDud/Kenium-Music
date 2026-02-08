import {
  Command,
  type CommandContext,
  createStringOption,
  Declare,
  LocalesT,
  Options
} from 'seyfert'
import { getGuildLang, setGuildLang } from '../utils/db_helper'
import { getContextLanguage } from '../utils/i18n'

const LANGUAGE_NAMES = {
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
} as const

const options = {
  language: createStringOption({
    description: 'Language to use in the bot',
    required: true,
    choices: [
      { name: 'English', value: 'en' },
      { name: 'Português (Brasil)', value: 'br' },
      { name: 'Espanhol (ES)', value: 'es' },
      { name: 'Hindi (IN)', value: 'hi' },
      { name: 'French (FR)', value: 'fr' },
      { name: 'Arabic (AR)', value: 'ar' },
      { name: 'Bengali (BD)', value: 'bn' },
      { name: 'Russian (RU)', value: 'ru' },
      { name: 'Japanese (JP)', value: 'ja' },
      { name: 'Turkish (TR)', value: 'tr' },
      { name: 'Thai (TH)', value: 'th' }
    ]
  })
} as any

const _functions = {
  getLangDisplayName: (lang: string): string =>
    LANGUAGE_NAMES[lang as keyof typeof LANGUAGE_NAMES] || lang,

  handleLanguageSet: async (
    ctx: CommandContext<typeof options>,
    lang: string
  ): Promise<void> => {
    if (getGuildLang(ctx.guildId || '') === lang) {
      const t = ctx.t.get(getContextLanguage(ctx))
      await ctx.editOrReply({
        content: (t as any).success?.settingAlradySet || 'Language already set',
        flags: 64
      })
      return
    }
    const success = setGuildLang(ctx.guildId || '', lang)
    const t = ctx.t.get(lang)
    const displayName = _functions.getLangDisplayName(lang)
    const successBool = success !== undefined && success !== null
    const content = successBool
      ? (t as any).success?.languageSet?.replace('{lang}', displayName) ||
        `Language set to ${displayName}`
      : (t as any).errors?.databaseError || 'Failed to save settings'

    await ctx.editOrReply({ content, flags: 64 })
  }
}

@Declare({
  name: 'language',
  description: 'Set the language of the bot',
  defaultMemberPermissions: ['Administrator']
})
@LocalesT('commands.language.name', 'commands.language.description')
@Options(options)
export default class LanguageCommand extends Command {
  public override async run(
    ctx: CommandContext<typeof options>
  ): Promise<void> {
    if (!ctx.guildId) {
      await ctx.editOrReply({
        content: 'This command only works in servers.',
        flags: 64
      })
      return
    }

    try {
      await _functions.handleLanguageSet(ctx, (ctx.options as any).language)
    } catch (error) {
      console.error('Error in language command:', error)
      const currentLang = getContextLanguage(ctx)
      const t = ctx.t.get(currentLang)
      await ctx.editOrReply({
        content: t.errors?.general || 'An error occurred',
        flags: 64
      })
    }
  }
}
