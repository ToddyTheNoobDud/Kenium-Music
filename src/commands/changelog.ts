import { Cooldown, CooldownType } from '@slipher/cooldown'
import {
  Command,
  type CommandContext,
  Container,
  Declare,
  Embed,
  Middlewares
} from 'seyfert'
import { ButtonStyle } from 'seyfert/lib/types'
import type { InteractionLike } from '../shared/helperTypes'
import { getContextLanguage } from '../utils/i18n'
import { safeDefer } from '../utils/interactions'
import { APP_VERSION } from '../shared/constants'

const CONFIG = {
  GITHUB: {
    API_URL:
      'https://api.github.com/repos/ToddyTheNoobDud/Kenium-Music/commits?per_page=15',
    REPO_URL: 'https://github.com/ToddyTheNoobDud/Kenium-Music',
    COMMITS_URL: 'https://github.com/ToddyTheNoobDud/Kenium-Music/commits/main',
    ISSUES_URL: 'https://github.com/ToddyTheNoobDud/Kenium-Music/issues/new'
  },
  BOT: {
    VERSION: APP_VERSION,
    DEVELOPER: 'mushroom0162',
    RELEASE_NOTES: {
      version: APP_VERSION,
      date: '2026-06-15',
      summary:
        'Integrated TuneMyMusic for seamless playlist migration, overhauled the 24/7 stream retention system with exponential backoffs, and introduced database optimizations alongside consolidated UI components.',
      highlights: [
        'Added TuneMyMusic CSV/TXT integration for playlist imports/exports',
        'Overhauled 24/7 reconnects with exponential backoffs and socket error recovery',
        'Fully refactored the caching system to improve memory footprint and lookup speed',
        'Optimized SQLite performance with native JSON field path updates',
        'Consolidated Now Playing UI layouts and centralized Discord interaction error guards'
      ],
      added: [
        'TuneMyMusic playlist format support (CSV, TXT, and Kenium JSON payloads)',
        'ISRC lookup support during playlist import to resolve tracks with high fidelity',
        'Centralized interaction error handling middleware and decorators (errorGuard.ts)',
        'Async concurrency pool worker (mapPool) for batch actions to limit resource strain',
        'Automatic 24/7 reconnection trigger on shard ready and shard reconnect events',
        'SQLite collection unit tests for mixed hot and non-hot column updates'
      ],
      changed: [
        'Fully refactored the caching system to improve caching efficiency and memory management',
        'Rebuilt the 24/7 reconnect flow to use exponential backoff delays instead of instant reconnects',
        'Reused active player connections on rejoin instead of destructively recreating the player',
        'Expanded VoiceManager socket close code handling to handle 1001, 1006, 4015, and 5001 disconnects',
        'Optimized user count checking on the /status command by reading from a cached state variable',
        'Modified SimpleDB update operations to perform in-place updates using native SQLite json_set',
        'Consolidated all duplicate Now Playing UI layout logic into a single shared function',
        'Replaced repetitive getErrorCode checks with a unified isExpiredInteraction error check'
      ],
      fixed: [
        'A critical SimpleDB database bug where updates to hot-columns alongside document JSON fields would get desynchronized; it now falls back to full document writes',
        'Unhandled crashes during /play command autocomplete by wrapping interactions with safe response handlers',
        'Player text channel resolution bugs during track playback exceptions',
        'Outdated package dependencies for Biome, Seyfert, Node, and Bun types'
      ],
      removed: [
        'Legacy inline UI layout blocks from /grab, /nowplaying, and related command files',
        'Duplicate error-catching blocks across more than 25 command handlers'
      ]
    } as ReleaseNotes
  },
  COLORS: {
    PRIMARY: 0,
    ERROR: 0xff5252
  },
  DISPLAY: {
    COMMIT_MESSAGE_MAX_LENGTH: 77 // Optimized for ...
  }
} as const

// Optimized regex patterns (compiled once)
const COMMIT_TYPE_REGEX = /^([a-z]+)(?:\([^)]+\))?:\s*/i
const COMMIT_MESSAGE_CLEAN_REGEX = /^\w+(?:\([^)]+\))?:\s*/

interface GithubCommit {
  sha: string
  html_url: string
  commit: {
    message: string
    author: {
      name: string
      date: string
    }
  }
}

interface ReleaseNotes {
  version: string
  date: string
  summary: string
  highlights: string[]
  added: string[]
  changed: string[]
  fixed: string[]
  removed: string[]
}

type ChangelogTextLike = {
  invite?: {
    github?: unknown
    supportServer?: unknown
  }
  common?: {
    next?: unknown
    unknown?: unknown
  }
  errors?: {
    general?: unknown
    commandError?: unknown
  }
  github?: {
    title?: unknown
    label?: unknown
  }
  supportServer?: {
    title?: unknown
    label?: unknown
  }
  changelog?: unknown
  commits?: unknown
}

type ChangelogInteractionLike = InteractionLike & {
  client: CommandContext['client']
  deferUpdate?: () => Promise<unknown>
  editOrReply: (payload: {
    components: Container[]
    flags: number
  }) => Promise<unknown>
}

type ChangelogMessageLike = {
  edit: (payload: { components: [] }) => Promise<unknown>
  createComponentCollector: (options: {
    filter: (i: { user: { id: string } }) => boolean
    idle: number
    onStop: () => void
  }) => {
    run: (
      customId: string,
      handler: (interaction: ChangelogInteractionLike) => Promise<void>
    ) => void
  }
}

type PageContextLike = {
  client: CommandContext['client']
}

const isAbortError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  (error as { name?: unknown }).name === 'AbortError'

function asText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

async function fetchCommits(): Promise<Record<string, unknown>[]> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 4000) // Reduced timeout

  try {
    const response = await fetch(CONFIG.GITHUB.API_URL, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Kenium-Music-Bot'
      },
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`)
    }

    return (await response.json()) as Record<string, unknown>[]
  } catch (error: unknown) {
    clearTimeout(timeoutId)
    if (isAbortError(error)) {
      throw new Error('Request timeout')
    }
    throw error
  }
}

function formatCommitMessage(message: string): string {
  if (!message?.trim()) return 'No message'

  // Single regex operation instead of match + slice
  const cleanMessage = message.replace(COMMIT_MESSAGE_CLEAN_REGEX, '')
  const typeMatch = COMMIT_TYPE_REGEX.exec(message)

  // Optimized truncation
  const truncated =
    cleanMessage.length > CONFIG.DISPLAY.COMMIT_MESSAGE_MAX_LENGTH
      ? `${cleanMessage.slice(0, CONFIG.DISPLAY.COMMIT_MESSAGE_MAX_LENGTH)}...`
      : cleanMessage

  return typeMatch?.[1]
    ? `\`${typeMatch[1].toUpperCase()}\` ${truncated}`
    : truncated
}

function createBulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n')
}

function createReleaseBlock(
  title: string,
  items: string[]
): { type: 10; content: string } {
  return {
    type: 10,
    content: `### ${title}\n${createBulletList(items)}`
  }
}

function createChangelogPage(
  ctx: PageContextLike,
  thele: ChangelogTextLike,
  currentPage: 'changelog' | 'commits' = 'changelog'
): Container {
  const notes = CONFIG.BOT.RELEASE_NOTES
  const navigationButtons = createNavigationButtons(currentPage, thele)
  const githubLabel = asText(thele?.invite?.github, 'GitHub')
  const supportLabel = asText(thele?.invite?.supportServer, 'Support')
  const heroContent = [
    `## [${notes.version}] - ${notes.date}`,
    notes.summary
  ].join('\n')
  const highlightsContent = `**Highlights**\n${createBulletList(notes.highlights)}`

  return new Container({
    components: [
      {
        type: 10,
        content: `### Kenium Music v${CONFIG.BOT.VERSION} - Changelog`
      },
      { type: 14, divider: true, spacing: 2 },
      {
        type: 9,
        components: [
          {
            type: 10,
            content: heroContent
          },
          {
            type: 10,
            content: highlightsContent
          }
        ],
        accessory: {
          type: 11,
          media: { url: ctx.client.me.avatarURL({ extension: 'webp' }) || '' }
        }
      },
      { type: 14, divider: true, spacing: 1 },
      createReleaseBlock('Added', notes.added),
      { type: 14, divider: true, spacing: 1 },
      createReleaseBlock('Changed', notes.changed),
      { type: 14, divider: true, spacing: 1 },
      createReleaseBlock('Fixed', notes.fixed),
      { type: 14, divider: true, spacing: 1 },
      createReleaseBlock('Removed', notes.removed),
      { type: 14, divider: true, spacing: 2 },
      {
        type: 1,
        components: [
          {
            type: 2,
            label: githubLabel,
            style: 5,
            url: CONFIG.GITHUB.REPO_URL
          },
          {
            type: 2,
            label: supportLabel,
            style: 5,
            url: CONFIG.GITHUB.ISSUES_URL
          }
        ]
      },
      { type: 14, divider: true, spacing: 2 },
      navigationButtons
    ]
  })
}

function createCommitsPage(
  ctx: PageContextLike,
  commits: GithubCommit[],
  thele: ChangelogTextLike,
  currentPage: 'changelog' | 'commits' = 'commits'
): Container {
  const githubLabel = asText(thele?.invite?.github, 'GitHub')
  const nextLabel = asText(thele?.common?.next, 'More')
  const supportLabel = asText(thele?.invite?.supportServer, 'Support')
  // Build commits string in single pass
  const commitsText = commits
    .map((commit) => {
      const shortSha = commit.sha.slice(0, 7)
      const message = formatCommitMessage(commit.commit.message)
      const timestamp = Math.floor(
        new Date(commit.commit.author.date).getTime() / 1000
      )
      return `> [\`${shortSha}\`](${commit.html_url}) ${message} by **${commit.commit.author.name}** <t:${timestamp}:R>`
    })
    .join('\n')

  const description = `## Recent Commits\n${commitsText}`
  const navigationButtons = createNavigationButtons(currentPage, thele)

  return new Container({
    components: [
      {
        type: 10,
        content: `### Kenium Music v${CONFIG.BOT.VERSION} - Commits`
      },
      { type: 14, divider: true, spacing: 2 },
      {
        type: 9,
        components: [
          {
            type: 10,
            content: description
          }
        ],
        accessory: {
          type: 11,
          media: { url: ctx.client.me.avatarURL({ extension: 'webp' }) || '' }
        }
      },
      { type: 14, divider: true, spacing: 2 },
      {
        type: 1,
        components: [
          {
            type: 2,
            label: githubLabel,
            style: 5,
            url: CONFIG.GITHUB.REPO_URL
          },
          {
            type: 2,
            label: nextLabel,
            style: 5,
            url: CONFIG.GITHUB.COMMITS_URL
          },
          {
            type: 2,
            label: supportLabel,
            style: 5,
            url: CONFIG.GITHUB.ISSUES_URL
          }
        ]
      },
      { type: 14, divider: true, spacing: 2 },
      navigationButtons
    ]
  })
}

function createNavigationButtons(
  currentPage: 'changelog' | 'commits',
  thele: ChangelogTextLike
) {
  const changelog = asText(thele?.changelog, 'Changelog')
  const commits = asText(thele?.commits, 'Commits')

  return {
    type: 1,
    components: [
      {
        type: 2,
        custom_id: 'ignore_changelog_page',
        label: changelog,
        style:
          currentPage === 'changelog'
            ? ButtonStyle.Primary
            : ButtonStyle.Secondary,
        disabled: currentPage === 'changelog'
      },
      {
        type: 2,
        custom_id: 'ignore_commits_page',
        label: commits,
        style:
          currentPage === 'commits'
            ? ButtonStyle.Primary
            : ButtonStyle.Secondary,
        disabled: currentPage === 'commits'
      }
    ]
  }
}

@Declare({
  name: 'changelog',
  description: 'stuff that my owner coded on me.'
})
@Cooldown({
  type: CooldownType.User,
  interval: 60000, // 1 minute
  uses: {
    default: 2
  }
})
@Middlewares(['cooldown'])
export default class Changelog extends Command {
  private activeCollectors = new WeakSet<object>()

  public override async run(ctx: CommandContext): Promise<void> {
    const lang = getContextLanguage(ctx)
    const thele = ctx.t.get(lang) as unknown as ChangelogTextLike

    try {
      if (!(await safeDefer(ctx, true))) return

      const commits = await fetchCommits()

      // Start with changelog page
      const changelogContainer = createChangelogPage(ctx, thele, 'changelog')

      const message = await ctx.editOrReply(
        {
          components: [changelogContainer],
          flags: 64 | 32768
        },
        true
      )

      // Set up button interaction handler
      this.setupNavigationHandler(
        message as unknown as ChangelogMessageLike,
        ctx,
        commits as unknown as GithubCommit[],
        thele
      )
    } catch (error) {
      console.error('Changelog error:', error)

      const errorEmbed = new Embed()
        .setColor(CONFIG.COLORS.ERROR)
        .setTitle(asText(thele?.errors?.general, 'Error'))
        .setDescription(
          `${asText(thele?.errors?.commandError, 'An error occurred.')}\n\`\`\`\n${(error as Error).message || asText(thele?.common?.unknown, 'Unknown')}\n\`\`\``
        )
        .addFields([
          {
            name: asText(thele?.github?.title, 'GitHub'),
            value: `[${asText(thele?.github?.label, 'Repository')}](${CONFIG.GITHUB.REPO_URL})`,
            inline: true
          },
          {
            name: asText(thele?.supportServer?.title, 'Support'),
            value: `[${asText(thele?.supportServer?.label, 'Open Issue')}](${CONFIG.GITHUB.ISSUES_URL})`,
            inline: true
          }
        ])
        .setFooter({
          text: `Made by ${CONFIG.BOT.DEVELOPER}`,
          iconUrl: ctx.client.me.avatarURL() || ''
        })

      await ctx.editOrReply({
        embeds: [errorEmbed as unknown as Embed]
      })
    }
  }

  private setupNavigationHandler(
    message: ChangelogMessageLike,
    ctx: CommandContext,
    commits: GithubCommit[],
    thele: ChangelogTextLike
  ): void {
    const collector = message.createComponentCollector({
      filter: (i: { user: { id: string } }) =>
        i.user.id === ctx.interaction.user.id,
      idle: 300000, // 5 minutes timeout
      onStop: () => {
        this.activeCollectors.delete(collector)
        message.edit({ components: [] }).catch(() => {})
      }
    })

    this.activeCollectors.add(collector)

    collector.run(
      'ignore_changelog_page',
      async (interaction: ChangelogInteractionLike) => {
        try {
          await interaction.deferUpdate?.()
          const changelogContainer = createChangelogPage(
            interaction,
            thele,
            'changelog'
          )

          await interaction.editOrReply({
            components: [changelogContainer],
            flags: 64 | 32768
          })
        } catch (error) {
          console.error('Navigation error:', error)
        }
      }
    )

    collector.run(
      'ignore_commits_page',
      async (interaction: ChangelogInteractionLike) => {
        try {
          await interaction.deferUpdate?.()
          const commitsContainer = createCommitsPage(
            interaction,
            commits,
            thele,
            'commits'
          )

          await interaction.editOrReply({
            components: [commitsContainer],
            flags: 64 | 32768
          })
        } catch (error) {
          console.error('Navigation error:', error)
        }
      }
    )
  }
}
