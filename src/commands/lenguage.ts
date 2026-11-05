import {
  Command,
  type CommandContext,
  createStringOption,
  Declare,
  LocalesT,
  Options
} from 'seyfert'
import { getGuildLang, setGuildLang } from '../utils/db_helper.ts'
import {
  getContextLanguage,
  getLanguageChoices,
  getLanguageDisplayName
} from '../utils/i18n.ts'
import { safeDefer } from '../utils/interactions.ts'

const options = {
  language: createStringOption({
    description: 'Choose the language used for this server.',
    required: true,
    choices: getLanguageChoices()
  })
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
    if (!(await safeDefer(ctx, true))) {
      return
    }

    if (!ctx.guildId) {
      await ctx.editOrReply({
        content: 'This command can only be used in a server.',
        flags: 64
      })
      return
    }

    try {
      const { language } = ctx.options
      const currentLang = getContextLanguage(ctx)
      const currentTranslations = ctx.t.get(currentLang)

      if (getGuildLang(ctx.guildId) === language) {
        await ctx.editOrReply({
          content:
            currentTranslations.success?.settingAlradySet ||
            'The language is already set to that option.',
          flags: 64
        })
        return
      }

      const success = setGuildLang(ctx.guildId, language)
      const translations = ctx.t.get(language)
      const displayName = getLanguageDisplayName(language)
      const content = success
        ? translations.success?.languageSet?.replace(
            '{language}',
            displayName
          ) || `Language set to ${displayName}`
        : translations.errors?.databaseError || 'Failed to save settings'

      await ctx.editOrReply({ content, flags: 64 })
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
