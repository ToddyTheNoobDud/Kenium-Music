import { Cooldown } from '@slipher/cooldown'
import {
  type ButtonInteraction,
  ButtonStyle,
  Command,
  type CommandContext,
  Container,
  Declare,
  Embed,
  type Message,
  Middlewares,
  type WebhookMessage
} from 'seyfert'
import { APP_VERSION } from '../shared/constants.ts'
import type { Translations } from '../utils/i18n.ts'
import { getContextLanguage } from '../utils/i18n.ts'
import { safeDefer } from '../utils/interactions.ts'

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
      date: '2026-11-04',
      summary:
        'This update focuses on a lot of things.',
      changed: [
        'Queues now have a 1,000-track limit, including playlist tracks still waiting to load. Imports report tracks left out because the queue is full.',
        'Playlist buttons start playback after loading the first few songs, then load more as you listen. Adding another saved playlist keeps the earlier playlist waiting in order.',
        'Playlist imports report broken files and invalid YouTube links. CSV files handle commas, quotes and line breaks inside song details.',
      ],
      fixed: [
        'Saved sessions load after a restart. Restored tracks show who requested them, and requester-only controls still recognize that person.',
        'Normal restarts remove the old now-playing message before exiting, so resumed playback can post a fresh one.',
        'Clearing the queue or destroying the player cancels pending loads, so songs do not appear again afterward.',
        '24/7 reconnects wait until Discord and the music server are ready. Temporary errors no longer turn 24/7 off; missing permissions pause retries until you fix access and toggle /247 off and on.',
        'Jump and roulette start playback after selecting a queued song. Search acknowledges commands before waiting for results, avoiding interaction timeouts.',
        'Search suggestions no longer attach someone else as the requester. Long searches no longer share results just because their first 60 characters match.',
        'Voice activity checks no longer treat a failed member lookup as an empty channel. Clear and stop also work when no song is currently playing.',
        'Now-playing cards show the correct repeat icon. Queue views work when a song has no artwork.',
        'Fixed the distortion effect setting. Filter commands wait for changes before confirming them.',
        'Older playlists are copied during a database upgrade even if newer playlists already exist. The upgrade checks the copy before removing old data.',
        'The changelog still opens when GitHub cannot provide the recent commits.'
      ],
      github: [
        'Removed many typeof checks and compatibility fallbacks in favor of the framework and player APIs. Replaced loose types with their actual types and formatted the code with Biome.',
        'Shared the playlist play/shuffle loader and now-playing layout across commands and buttons. Pending loads belong to each player, so replacing a player does not mix its work with the old one.',
        'Database access now uses bun:sqlite. Settings save immediately; schema v7 upgrades create a backup and remove unused indexes.',
        'Updated Seyfert to 5.2.1 and tiny-lru to 13.1.1, and aqualink to v4.'
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
  changed: string[]
  fixed: string[]
  github: string[]
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

async function fetchCommits(): Promise<GithubCommit[]> {
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

    return (await response.json()) as GithubCommit[]
  } catch (error: unknown) {
    clearTimeout(timeoutId)
    if (isAbortError(error)) {
      throw new Error('Request timeout')
    }
    throw error
  }
}

function formatCommitMessage(message: string): string {
  if (!message?.trim()) {
    return 'No message'
  }

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
  thele: Translations,
  currentPage: 'changelog' | 'commits' = 'changelog'
): Container {
  const notes = CONFIG.BOT.RELEASE_NOTES
  const navigationButtons = createNavigationButtons(currentPage)
  const githubLabel = asText(thele?.invite?.github, 'GitHub')
  const supportLabel = asText(thele?.invite?.supportServer, 'Support')
  const heroContent = [
    `## [${notes.version}] - ${notes.date}`,
    notes.summary
  ].join('\n')

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
          }
        ],
        accessory: {
          type: 11,
          media: { url: ctx.client.me.avatarURL({ extension: 'webp' }) || '' }
        }
      },
      { type: 14, divider: true, spacing: 1 },
      createReleaseBlock('Changed', notes.changed),
      { type: 14, divider: true, spacing: 1 },
      createReleaseBlock('Fixed', notes.fixed),
      { type: 14, divider: true, spacing: 1 },
      createReleaseBlock('GitHub', notes.github),
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
  thele: Translations,
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
  const navigationButtons = createNavigationButtons(currentPage)

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

function createNavigationButtons(currentPage: 'changelog' | 'commits') {
  const changelog = 'Changelog'
  const commits = 'Commits'

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
@Cooldown.user(60000, { uses: 2 })
@Middlewares(['cooldown'])
export default class Changelog extends Command {
  public override async run(ctx: CommandContext): Promise<void> {
    const lang = getContextLanguage(ctx)
    const thele = ctx.t.get(lang)

    try {
      if (!(await safeDefer(ctx, true))) {
        return
      }

      // The commits page is optional: a GitHub 403 (rate limit) must not
      // block the changelog page itself. The loader keeps working with an
      // empty commits list and the Commits button shows an empty page.
      const commits = await fetchCommits().catch((error: unknown) => {
        console.warn(
          `Changelog: commits unavailable, showing changelog only: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
        return [] as GithubCommit[]
      })

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
      this.setupNavigationHandler(message, ctx, commits, thele)
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
            name: 'GitHub',
            value: `[Repository](${CONFIG.GITHUB.REPO_URL})`,
            inline: true
          },
          {
            name: 'Support',
            value: `[Open Issue](${CONFIG.GITHUB.ISSUES_URL})`,
            inline: true
          }
        ])
        .setFooter({
          text: `Made by ${CONFIG.BOT.DEVELOPER}`,
          iconUrl: ctx.client.me.avatarURL() || ''
        })

      await ctx.editOrReply({
        embeds: [errorEmbed]
      })
    }
  }

  private setupNavigationHandler(
    message: Message | WebhookMessage,
    ctx: CommandContext,
    commits: GithubCommit[],
    thele: Translations
  ): void {
    const collector = message.createComponentCollector({
      filter: (i: { user: { id: string } }) =>
        i.user.id === ctx.interaction.user.id,
      idle: 300000, // 5 minutes timeout
      onStop: () => {
        message.edit({ components: [] }).catch(() => {})
      }
    })

    collector.run(
      'ignore_changelog_page',
      async (interaction: ButtonInteraction) => {
        try {
          await interaction.deferUpdate()
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
      async (interaction: ButtonInteraction) => {
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
