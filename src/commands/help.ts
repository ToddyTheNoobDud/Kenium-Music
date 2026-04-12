import { Command, type CommandContext, Container, Declare } from 'seyfert'
import { EMBED_COLOR } from '../shared/constants'
import type { InteractionLike } from '../shared/helperTypes'
import { getContextLanguage } from '../utils/i18n'
import { safeDefer } from '../utils/interactions'

const COMMANDS_PER_PAGE = 4
const EPHEMERAL_FLAG = 64 | 32768

type CommandLike = {
  name: string
  description?: string
}

type HelpTextLike = {
  commands?: Record<string, { description?: string } | undefined>
  help?: {
    previous?: string
    next?: string
  }
}

type HelpCategoryId =
  | 'start'
  | 'playback'
  | 'queue'
  | 'library'
  | 'tools'
  | 'system'

type HelpCategory = {
  id: HelpCategoryId
  label: string
  summary: string
}

type ButtonComponent = {
  type: 2
  custom_id: string
  label: string
  style: 1 | 2 | 3 | 4
  disabled?: boolean
}

type ActionRowComponent = {
  type: 1
  components: ButtonComponent[]
}

type TextDisplayComponent = {
  type: 10
  content: string
}

type DividerComponent = {
  type: 14
  divider: true
  spacing: 1 | 2
}

type HelpInteractionLike = InteractionLike & {
  isButton: () => boolean
  update: (payload: { components: Container[] }) => Promise<unknown>
}

type HelpMessageLike = {
  edit: (payload: { components: Container[] }) => Promise<unknown>
  createComponentCollector: (options: {
    filter: (interaction: HelpInteractionLike) => boolean
    idle: number
    onStop: () => Promise<void> | void
  }) => {
    run: (
      customId: string,
      handler: (interaction: HelpInteractionLike) => Promise<void>
    ) => void
  }
}

const HELP_CATEGORIES: HelpCategory[] = [
  {
    id: 'start',
    label: 'Start',
    summary: 'Quick entry points for first actions.'
  },
  {
    id: 'playback',
    label: 'Playback',
    summary: 'Core controls for what is currently playing.'
  },
  {
    id: 'queue',
    label: 'Queue',
    summary: 'Reorder, inspect, and shape what comes next.'
  },
  {
    id: 'library',
    label: 'Library',
    summary: 'Save, export, import, and collect tracks.'
  },
  {
    id: 'tools',
    label: 'Tools',
    summary: 'Utility commands and information panels.'
  },
  {
    id: 'system',
    label: 'System',
    summary: 'Bot settings and maintenance controls.'
  }
]

const START_COMMANDS = new Set([
  'play',
  'search',
  'queue',
  'skip',
  'nowplaying',
  'help'
])

const CATEGORY_COMMANDS: Record<
  Exclude<HelpCategoryId, 'start'>,
  Set<string>
> = {
  playback: new Set([
    '247',
    'autoplay',
    'filters',
    'karaoke',
    'loop',
    'lyrics',
    'nowplaying',
    'pause',
    'play',
    'play-file',
    'previous',
    'resume',
    'seek',
    'skip',
    'stop',
    'tts',
    'volume'
  ]),
  queue: new Set(['clear', 'jump', 'queue', 'remove', 'roulette', 'shuffle']),
  library: new Set(['export', 'grab', 'import']),
  tools: new Set([
    'changelog',
    'help',
    'invite',
    'ping',
    'search',
    'sources',
    'status'
  ]),
  system: new Set(['destroy', 'lenguage', 'restart'])
}

const getCategory = (id: HelpCategoryId) => {
  const category = HELP_CATEGORIES.find((entry) => entry.id === id)
  if (category) return category

  return {
    id: 'start',
    label: 'Start',
    summary: 'Quick entry points for first actions.'
  } satisfies HelpCategory
}

@Declare({
  name: 'help',
  description: 'Browse the available commands.'
})
export default class HelpCommand extends Command {
  public override async run(ctx: CommandContext) {
    if (!(await safeDefer(ctx, true))) return

    const lang = getContextLanguage(ctx)
    const t = ctx.t.get(lang) as unknown as HelpTextLike
    const commands = Array.from(
      ctx.client.commands.values as Iterable<CommandLike>
    ).sort((a: CommandLike, b: CommandLike) => a.name.localeCompare(b.name))

    const registeredCommands = await ctx.client.proxy
      .applications(ctx.client.applicationId)
      .commands.get()

    const commandMap = new Map(
      registeredCommands.map((cmd) => [cmd.name, cmd.id])
    )

    let category: HelpCategoryId = 'start'
    let page = 0

    const container = this._buildContainer(
      commands,
      commandMap,
      category,
      page,
      ctx,
      t
    )

    const message = (await ctx.editOrReply(
      { components: [container], flags: EPHEMERAL_FLAG },
      true
    )) as HelpMessageLike

    const collector = message.createComponentCollector({
      filter: (i: HelpInteractionLike) =>
        i.user.id === ctx.author.id && i.isButton(),
      idle: 60_000,
      onStop: async () => {
        const disabled = this._buildContainer(
          commands,
          commandMap,
          category,
          page,
          ctx,
          t,
          true
        )
        await message.edit({ components: [disabled] }).catch(() => null)
      }
    })

    for (const entry of HELP_CATEGORIES) {
      collector.run(
        `ignore_help_cat_${entry.id}`,
        async (i: HelpInteractionLike) => {
          category = entry.id
          page = 0
          const updated = this._buildContainer(
            commands,
            commandMap,
            category,
            page,
            ctx,
            t
          )
          await i.update({ components: [updated] })
        }
      )
    }

    collector.run('ignore_help_prev', async (i: HelpInteractionLike) => {
      page = Math.max(page - 1, 0)
      const updated = this._buildContainer(
        commands,
        commandMap,
        category,
        page,
        ctx,
        t
      )
      await i.update({ components: [updated] })
    })

    collector.run('ignore_help_next', async (i: HelpInteractionLike) => {
      const totalPages = this._getTotalPages(commands, category)
      page = Math.min(page + 1, totalPages - 1)
      const updated = this._buildContainer(
        commands,
        commandMap,
        category,
        page,
        ctx,
        t
      )
      await i.update({ components: [updated] })
    })
  }

  private _getCommandsForCategory(
    commands: CommandLike[],
    category: HelpCategoryId
  ) {
    if (category === 'start') {
      return commands.filter((command) => START_COMMANDS.has(command.name))
    }

    const names = CATEGORY_COMMANDS[category]
    return commands.filter((command) => names.has(command.name))
  }

  private _getTotalPages(commands: CommandLike[], category: HelpCategoryId) {
    const categoryCommands = this._getCommandsForCategory(commands, category)
    return Math.max(1, Math.ceil(categoryCommands.length / COMMANDS_PER_PAGE))
  }

  private _formatCommandEntry(
    command: CommandLike,
    commandMap: Map<string, string>,
    t: HelpTextLike
  ) {
    const name = command.name || 'unknown'
    const description =
      t.commands?.[name]?.description ||
      command.description ||
      'No description available.'

    return `**</${name}:${commandMap.get(name) || 'unknown'}>**\n-# ${description}`
  }

  private _buildCategoryRows(
    category: HelpCategoryId,
    disabled: boolean
  ): ActionRowComponent[] {
    const rows = [HELP_CATEGORIES.slice(0, 3), HELP_CATEGORIES.slice(3)]

    return rows.map((row) => ({
      type: 1,
      components: row.map((entry) => ({
        type: 2,
        custom_id: `ignore_help_cat_${entry.id}`,
        label: entry.label,
        style: entry.id === category ? 1 : 2,
        disabled
      }))
    }))
  }

  private _buildPaginationRow(
    page: number,
    totalPages: number,
    t: HelpTextLike,
    disabled: boolean
  ): ActionRowComponent {
    return {
      type: 1,
      components: [
        {
          type: 2,
          custom_id: 'ignore_help_prev',
          label: t.help?.previous || 'Previous',
          style: 2,
          disabled: disabled || page === 0
        },
        {
          type: 2,
          custom_id: 'ignore_help_next',
          label: t.help?.next || 'Next',
          style: 2,
          disabled: disabled || page >= totalPages - 1
        }
      ]
    }
  }

  private _buildContainer(
    commands: CommandLike[],
    commandMap: Map<string, string>,
    category: HelpCategoryId,
    page: number,
    _ctx: CommandContext,
    t: HelpTextLike,
    disabled = false
  ) {
    const currentCategory = getCategory(category)
    const categoryCommands = this._getCommandsForCategory(commands, category)
    const totalPages = Math.max(
      1,
      Math.ceil(categoryCommands.length / COMMANDS_PER_PAGE)
    )
    const safePage = Math.min(page, totalPages - 1)
    const start = safePage * COMMANDS_PER_PAGE
    const chunk = categoryCommands.slice(start, start + COMMANDS_PER_PAGE)

    const quickStart =
      category === 'start'
        ? '-# Start with `/play`. Use `/search` for options. Open `/queue` next.'
        : null

    const commandEntries =
      chunk.length > 0
        ? chunk.flatMap((command, index) => {
            const rows: Array<TextDisplayComponent | DividerComponent> = [
              {
                type: 10,
                content: this._formatCommandEntry(command, commandMap, t)
              }
            ]
            if (index < chunk.length - 1) {
              rows.push({ type: 14, divider: true, spacing: 1 })
            }
            return rows
          })
        : [
            {
              type: 10,
              content: '-# No commands available in this deck yet.'
            } satisfies TextDisplayComponent
          ]

    return new Container({
      components: [
        {
          type: 10,
          content: `## Control Deck\n-# ${currentCategory.label} | ${currentCategory.summary}${totalPages > 1 ? ` | ${safePage + 1}/${totalPages}` : ''}`
        },
        ...this._buildCategoryRows(category, disabled),
        { type: 14, divider: true, spacing: 1 },
        ...(quickStart
          ? ([
              { type: 10, content: quickStart },
              { type: 14, divider: true, spacing: 1 }
            ] as Array<TextDisplayComponent | DividerComponent>)
          : []),
        ...commandEntries,
        ...(totalPages > 1
          ? ([
              { type: 14, divider: true, spacing: 1 },
              this._buildPaginationRow(safePage, totalPages, t, disabled)
            ] as Array<DividerComponent | ActionRowComponent>)
          : [])
      ],
      accent_color: EMBED_COLOR
    })
  }
}
