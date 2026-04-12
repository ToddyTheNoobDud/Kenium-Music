import {
  Command,
  type CommandContext,
  createStringOption,
  Declare,
  LocalesT,
  Options
} from 'seyfert'
import type { OptionsRecord } from 'seyfert/lib/commands/applications/chat'
import { getGuildLang, setGuildLang } from '../utils/db_helper'
import {
  getContextLanguage,
  getLanguageChoices,
  getLanguageDisplayName
} from '../utils/i18n'
import { safeDefer } from '../utils/interactions'

type LanguageTextLike = {
  success?: {
    settingAlradySet?: string
    languageSet?: string
  }
  errors?: {
    databaseError?: string
    general?: string
  }
}

type LanguageOptions = {
  language: string
}

const options = {
  language: createStringOption({
    description: 'Choose the language used for this server.',
    required: true,
    choices: getLanguageChoices()
  })
}

const _functions = {
  handleLanguageSet: async (
    ctx: CommandContext,
    lang: string
  ): Promise<void> => {
    const currentLang = getContextLanguage(ctx)
    const currentTranslations = ctx.t.get(currentLang) as LanguageTextLike

    if (getGuildLang(ctx.guildId || '') === lang) {
      await ctx.editOrReply({
        content:
          currentTranslations.success?.settingAlradySet ||
          'The language is already set to that option.',
        flags: 64
      })
      return
    }

    const success = setGuildLang(ctx.guildId || '', lang)
    const t = ctx.t.get(lang) as LanguageTextLike
    const displayName = getLanguageDisplayName(lang)
    const successBool = success !== undefined && success !== null
    const content = successBool
      ? t.success?.languageSet?.replace('{lang}', displayName) ||
        `Language set to ${displayName}`
      : t.errors?.databaseError || 'Failed to save settings'

    await ctx.editOrReply({ content, flags: 64 })
  }
}

@Declare({
  name: 'language',
  description: 'Set the language of the bot',
  defaultMemberPermissions: ['Administrator']
})
@LocalesT('commands.language.name', 'commands.language.description')
@Options(options as unknown as OptionsRecord)
export default class LanguageCommand extends Command {
  public override async run(ctx: CommandContext): Promise<void> {
    if (!(await safeDefer(ctx, true))) return

    if (!ctx.guildId) {
      await ctx.editOrReply({
        content: 'This command can only be used in a server.',
        flags: 64
      })
      return
    }

    try {
      const { language } = ctx.options as LanguageOptions
      await _functions.handleLanguageSet(ctx, language)
    } catch (error) {
      console.error('Error in language command:', error)
      const currentLang = getContextLanguage(ctx)
      const t = ctx.t.get(currentLang) as LanguageTextLike
      await ctx.editOrReply({
        content: t.errors?.general || 'An error occurred',
        flags: 64
      })
    }
  }
}
