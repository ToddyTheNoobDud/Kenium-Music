import {
  Command,
  type CommandContext,
  createStringOption,
  Declare,
  LocalesT,
  Options
} from 'seyfert'
import { getGuildLang, setGuildLang } from '../utils/db_helper'
import {
  getContextLanguage,
  getLanguageChoices,
  getLanguageDisplayName
} from '../utils/i18n'
import { safeDefer } from '../utils/interactions'

const options = {
  language: createStringOption({
    description: 'Choose the language used for this server.',
    required: true,
    choices: getLanguageChoices()
  })
} as any

const _functions = {
  handleLanguageSet: async (
    ctx: CommandContext<typeof options>,
    lang: string
  ): Promise<void> => {
    const currentLang = getContextLanguage(ctx)
    const currentTranslations = ctx.t.get(currentLang)

    if (getGuildLang(ctx.guildId || '') === lang) {
      await ctx.editOrReply({
        content:
          (currentTranslations as any).success?.settingAlradySet ||
          'The language is already set to that option.',
        flags: 64
      })
      return
    }

    const success = setGuildLang(ctx.guildId || '', lang)
    const t = ctx.t.get(lang)
    const displayName = getLanguageDisplayName(lang)
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
    if (!(await safeDefer(ctx, true))) return

    if (!ctx.guildId) {
      await ctx.editOrReply({
        content: 'This command can only be used in a server.',
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
