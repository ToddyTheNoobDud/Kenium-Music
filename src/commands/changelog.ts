import { Cooldown, CooldownType } from '@slipher/cooldown'
import {
  Command,
  type CommandContext,
  Container,
  Declare,
  Embed,
  Middlewares
} from 'seyfert'
import { ButtonStyle, ComponentType } from 'seyfert/lib/types'
import { getContextLanguage } from '../utils/i18n'

const CONFIG = {
  GITHUB: {
    API_URL:
      'https://api.github.com/repos/ToddyTheNoobDud/Kenium-Music/commits?per_page=15',
    REPO_URL: 'https://github.com/ToddyTheNoobDud/Kenium-Music',
    COMMITS_URL: 'https://github.com/ToddyTheNoobDud/Kenium-Music/commits/main',
    ISSUES_URL: 'https://github.com/ToddyTheNoobDud/Kenium-Music/issues/new'
  },
  BOT: {
    VERSION: '4.9.2',
    DEVELOPER: 'mushroom0162',
    CHANGELOG: `
### Added
- Some missing translations / outdated translations

### Changed
- Updated dependencies
- Reworked all the playlists commands, now all of them are indexed by default, this should make everything faster
- Reworked the entire database system, with indexing support & pure sqlite json, this improves the performance by a lot
- Improved the cache hits on the database too, this should make everything faster for users who use the bot frequently
- Made the /play command use less allocations by using more string methods
- Reworked the karaoke command, now it uses timestamp based math, and reworked its UI
- Optimized the interaction commands for playlists, it should give responses faster too.
- Optimized the 24/7 command to reduce the db queries
- Optimized bot startup to reduce the db queries, and improve the overall startup speed.

### Removed
- Nothing

### Fixed
- Some memory leaks

### For github users:
- The database will auto-migrate to the new system, if you have any issues, please open an issue on github.
`
  },
  COLORS: {
    PRIMARY: 0,
    ERROR: 0xff5252
  },
  DISPLAY: {
    COMMIT_MESSAGE_MAX_LENGTH: 77, // Optimized for ...
    EMOJIS: {
      RELEASE: '🚀',
      GITHUB: '🔆',
      REPO: '📁',
      COMMITS: '📜',
      ISSUE: '🐛'
    }
  }
} as const

// Optimized regex patterns (compiled once)
const COMMIT_TYPE_REGEX = /^([a-z]+)(?:\([^)]+\))?:\s*/i
const COMMIT_MESSAGE_CLEANUP_REGEX = /^\w+(?:\([^)]+\))?:\s*/

async function fetchCommits(): Promise<any[]> {
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

    return await response.json()
  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      throw new Error('Request timeout')
    }
    throw error
  }
}

function formatCommitMessage(message: string): string {
  if (!message?.trim()) return 'No message'

  // Single regex operation instead of match + slice
  const cleanMessage = message.replace(COMMIT_MESSAGE_CLEANUP_REGEX, '')
  const typeMatch = COMMIT_TYPE_REGEX.exec(message)

  // Optimized truncation
  const truncated =
    cleanMessage.length > CONFIG.DISPLAY.COMMIT_MESSAGE_MAX_LENGTH
      ? `${cleanMessage.slice(0, CONFIG.DISPLAY.COMMIT_MESSAGE_MAX_LENGTH)}...`
      : cleanMessage

  return typeMatch
    ? `\`${typeMatch[1].toUpperCase()}\` ${truncated}`
    : truncated
}

function createChangelogPage(
  ctx: CommandContext,
  thele: any,
  currentPage: 'changelog' | 'commits' = 'changelog'
): Container {
  const description = CONFIG.BOT.CHANGELOG
  const navigationButtons = createNavigationButtons(currentPage, thele)

  return new Container({
    components: [
      {
        type: 10,
        content: `### ${CONFIG.DISPLAY.EMOJIS.RELEASE} Kenium Music v${CONFIG.BOT.VERSION} - Changelog`
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
            label: `${thele.invite.github}${CONFIG.DISPLAY.EMOJIS.REPO}`,
            style: 5,
            url: CONFIG.GITHUB.REPO_URL
          },
          {
            type: 2,
            label: `${thele.invite.supportServer}${CONFIG.DISPLAY.EMOJIS.ISSUE}`,
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
  ctx: CommandContext,
  commits: any[],
  thele: any,
  currentPage: 'changelog' | 'commits' = 'commits'
): Container {
  // Build commits string in single pass
  const commitsText = commits
    .map((commit) => {
      const shortSha = commit.sha.slice(0, 7)
      const message = formatCommitMessage(commit.commit.message)
      const author = commit.commit.author.name
      const timestamp = Math.floor(
        new Date(commit.commit.author.date).getTime() / 1000
      )

      return `> [\`${shortSha}\`](${commit.html_url}) ${message} by **${author}** <t:${timestamp}:R>`
    })
    .join('\n')

  const description = `## ${CONFIG.DISPLAY.EMOJIS.GITHUB} Recent Commits\n${commitsText}`
  const navigationButtons = createNavigationButtons(currentPage, thele)

  return new Container({
    components: [
      {
        type: 10,
        content: `### ${CONFIG.DISPLAY.EMOJIS.RELEASE} Kenium Music v${CONFIG.BOT.VERSION} - Commits`
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
            label: `${thele.invite.github}${CONFIG.DISPLAY.EMOJIS.REPO}`,
            style: 5,
            url: CONFIG.GITHUB.REPO_URL
          },
          {
            type: 2,
            label: `${thele.common.next}${CONFIG.DISPLAY.EMOJIS.COMMITS}`,
            style: 5,
            url: CONFIG.GITHUB.COMMITS_URL
          },
          {
            type: 2,
            label: `${thele.invite.supportServer}${CONFIG.DISPLAY.EMOJIS.ISSUE}`,
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
  thele: any
) {
  return {
    type: 1,
    components: [
      {
        type: 2,
        custom_id: 'ignore_changelog_page',
        label: thele.common.previous || 'Changelog',
        emoji: { name: '📝' },
        style:
          currentPage === 'changelog'
            ? ButtonStyle.Primary
            : ButtonStyle.Secondary,
        disabled: currentPage === 'changelog'
      },
      {
        type: 2,
        custom_id: 'ignore_commits_page',
        label: thele.common.next || 'Commits',
        emoji: { name: '📜' },
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
  private activeCollectors = new WeakSet<any>()

  public override async run(ctx: CommandContext): Promise<void> {
    const lang = getContextLanguage(ctx)
    const thele = ctx.t.get(lang)

    try {
      if (!ctx.deferred) await ctx.deferReply(true)

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
      this.setupNavigationHandler(message, ctx, commits, thele)
    } catch (error) {
      console.error('Changelog error:', error)

      const errorEmbed = new Embed()
        .setColor(CONFIG.COLORS.ERROR)
        .setTitle(thele.errors.general)
        .setDescription(
          `${thele.errors.commandError}\n\`\`\`\n${error.message || thele.common.unknown}\n\`\`\``
        )
        .setFooter({
          text: `Made with ❤️ by ${CONFIG.BOT.DEVELOPER}`,
          iconUrl: ctx.client.me.avatarURL()
        })

      await ctx.editOrReply({ embeds: [errorEmbed] })
    }
  }

  private setupNavigationHandler(
    message: any,
    ctx: CommandContext,
    commits: any[],
    thele: any
  ): void {
    const collector = message.createComponentCollector({
      filter: (i: any) => i.user.id === ctx.interaction.user.id,
      idle: 300000, // 5 minutes timeout
      onStop: () => {
        this.activeCollectors.delete(collector)
        message.edit({ components: [] }).catch(() => {})
      }
    })

    this.activeCollectors.add(collector)

    // Handle changelog page button
    collector.run('ignore_changelog_page', async (interaction: any) => {
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
    })

    // Handle commits page button
    collector.run('ignore_commits_page', async (interaction: any) => {
      try {
        await interaction.deferUpdate()
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
    })
  }
}
