import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const CONFIG = {
    GITHUB: {
        REPO_URL: 'https://api.github.com/repos/ToddyTheNoobDud/Kenium-Music/commits',
        REPO_LINK: 'https://github.com/ToddyTheNoobDud/Kenium-Music',
        get COMMITS_LINK() { return `${this.REPO_LINK}/commits/main`; },
        get ISSUES_LINK() { return `${this.REPO_LINK}/issues/new`; },
    },
    BOT: {
        VERSION: '3.0.0',
        DEVELOPER: "mushroom0162",
        CHANGELOG: [
            "✨ Small changes on the track UI (Now the track UI is more compact, and the track UI is now more responsive, also faster)",
            "✨ Improved the /destroy command in-player code",
            "🔧 Rewrited the Bot Handler, Command Handler, Events Handler, and Interaction Handler (way faster now)",
            "🌐 Updated to aqualink 1.9.0 (Lots of speed, performance, and recourses fixes)",
            "🔧 Remade the /play command, improving autocomplete for saving recourses + speed in resolving",
            "🐛 Fixed the /lyrics (soon, will be implemented)",
            "🐛 Fixed nodes getting disconnected at random times (hopefully)",
            "🔧 Rewrite the /queue system (way faster, new UI)",
            "📦 Added Latency to the ping command",
            "🔧 Small changes into the /search command (Now uses ephemeral)",
            "🔧 Small changes into the /status command (Misc changes in UI)",
            "📚 Check out on github too see the full changes...",
        ]
    },
    COLORS: {
        PRIMARY: 0x6C5CE7,
        ERROR: 0xFF0000,
    },
    TIMERS: {
        CACHE_DURATION: 15 * 60 * 1000,
        COOLDOWN_DURATION: 30 * 1000,  
    },
    DISPLAY: {
        COMMIT_MESSAGE_MAX_LENGTH: 80,
        DEFAULT_COMMIT_COUNT: 5,
    }
};



class GitHubCache {
  constructor() {
    this.data = null;
    this.etag = '';
    this.lastFetch = 0;
  }

  isValid() {
    return this.data && (Date.now() - this.lastFetch < CONFIG.TIMERS.CACHE_DURATION);
  }

  update(data, etag) {
    this.data = data;
    this.etag = etag || '';
    this.lastFetch = Date.now();
  }

  getData() {
    return this.data;
  }

  getEtag() {
    return this.etag;
  }
}


async function fetchCommits(client, count) {
  if (!client.githubCache) {
    client.githubCache = new GitHubCache();
  }

  if (client.githubCache.isValid()) {
    return client.githubCache.getData();
  }

  try {
    const response = await fetch(`${CONFIG.GITHUB.REPO_URL}?per_page=${count}`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'If-None-Match': client.githubCache.getEtag(),
        'User-Agent': 'Kenium-Music-Bot'
      },
    });

    if (response.status === 304) {
      client.githubCache.update(client.githubCache.getData(), client.githubCache.getEtag());
      return client.githubCache.getData();
    }

    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    client.githubCache.update(data, response.headers.get('etag'));
    return data;
  } catch (error) {
    console.error("Error fetching commits:", error);
    throw error;
  }
}

function formatCommitMessage(message) {
  const typeMatch = message.match(/^(\w+)(?:\([\w-]+\))?:\s*/);
  
  let type = '';
  let cleanMessage = message;
  
  if (typeMatch) {
    type = typeMatch[1].toUpperCase();
    cleanMessage = message.substring(typeMatch[0].length);
  }
  
  cleanMessage = cleanMessage.charAt(0).toUpperCase() + cleanMessage.slice(1);
  
  if (cleanMessage.length > CONFIG.DISPLAY.COMMIT_MESSAGE_MAX_LENGTH) {
    cleanMessage = cleanMessage.substring(0, CONFIG.DISPLAY.COMMIT_MESSAGE_MAX_LENGTH - 3) + '...';
  }
  
  return type ? `[${type}] ${cleanMessage}` : cleanMessage;
}

async function sendChangelogEmbed(interaction, commits, count) {
  const limitedCommits = commits.slice(0, count);
  const totalCommits = limitedCommits.length;
  
  const changelogItems = CONFIG.BOT.CHANGELOG.map(item => `• ${item}`).join('\n');
  
  let recentCommitsSection = '';
  if (totalCommits > 0) {
    recentCommitsSection = `\n\n## 📊 Github Recent Changes (${totalCommits})\n${limitedCommits.map(commit => {
      const message = formatCommitMessage(commit.commit.message);
      const authorName = commit.commit.author.name;
      const authorUrl = commit.author?.html_url || null;
      const authorText = authorUrl ? `[\`${authorName}\`](${authorUrl})` : `\`${authorName}\``;
      const commitDate = new Date(commit.commit.author.date).toLocaleDateString();
      
      return `• [\`${commit.sha.substring(0, 7)}\`](${commit.html_url}) **${message}** by ${authorText} (${commitDate})`;
    }).join('\n')}`;
  }
  
  const embed = new EmbedBuilder()
    .setColor(CONFIG.COLORS.PRIMARY)
    .setTitle(`Kenium Music Changelog v${CONFIG.BOT.VERSION}`)
    .setDescription(`## Current Release\n${changelogItems}${recentCommitsSection}`)
    .setFooter({
      text: `Kenium Music v${CONFIG.BOT.VERSION} • Made by ${CONFIG.BOT.DEVELOPER}`,
      iconURL: interaction.guild?.iconURL()
    })
    .setTimestamp();
  
  const buttons = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setLabel('Repository')
        .setEmoji('📁')
        .setURL(CONFIG.GITHUB.REPO_LINK)
        .setStyle(ButtonStyle.Link),
      new ButtonBuilder()
        .setLabel('Commit History')
        .setEmoji('📜')
        .setURL(CONFIG.GITHUB.COMMITS_LINK)
        .setStyle(ButtonStyle.Link),
      new ButtonBuilder()
        .setLabel('Report Issue')
        .setEmoji('🐛')
        .setURL(CONFIG.GITHUB.ISSUES_LINK)
        .setStyle(ButtonStyle.Link)
    );
  
  await interaction.editReply({
    embeds: [embed],
    components: [buttons]
  });
}

function createErrorEmbed(error) {
  return new EmbedBuilder()
    .setColor(CONFIG.COLORS.ERROR)
    .setTitle("⚠️ Error Fetching Changelog")
    .setDescription(`Failed to get the latest changes. GitHub API might be down or rate limited.\n\`\`\`\n${error.message || 'Unknown error'}\n\`\`\``)
    .setFooter({
      text: `Made with ❤️ by ${CONFIG.BOT.DEVELOPER}`,
    });
}

class CooldownManager {
  constructor(duration) {
    this.cooldowns = new Map();
    this.duration = duration;
    this.cleanupInterval = setInterval(() => this.cleanup(), duration);
  }
  async isOnCooldown(userId) {
    const timestamp = this.cooldowns.get(userId);
    return timestamp && Date.now() < timestamp + this.duration;
  }
  getRemainingTime(userId) {
    const timestamp = this.cooldowns.get(userId);
    return timestamp ? Math.max(0, (timestamp + this.duration - Date.now()) / 1000) : 0;
  }
  async setCooldown(userId) {
    this.cooldowns.set(userId, Date.now());
  }
  cleanup() {
    const now = Date.now();
    for (const [userId, timestamp] of this.cooldowns.entries()) {
      if (now > timestamp + this.duration) {
        this.cooldowns.delete(userId);
      }
    }
  }
  destroy() {
    clearInterval(this.cleanupInterval);
  }
}

const cooldownManager = new CooldownManager(CONFIG.TIMERS.COOLDOWN_DURATION);
export const Command = {
  name: "changelog",
  description: "Stuff that my owner coded on me",
  run: async (client, interaction) => {
    const userId = interaction.user.id;
    if (await cooldownManager.isOnCooldown(userId)) {
      const timeLeft = cooldownManager.getRemainingTime(userId);
      return await interaction.reply({
        content: `⏳ Please wait **${timeLeft.toFixed(1)}** more seconds before using the changelog command again.`,
        flags: 64
      });
    }
    await cooldownManager.setCooldown(userId);
    try {
      await interaction.deferReply();
      const count = CONFIG.DISPLAY.DEFAULT_COMMIT_COUNT;
      const commits = await fetchCommits(client, count);
      await sendChangelogEmbed(interaction, commits, count);
    } catch (error) {
      console.error("Error in changelog command:", error);
      const errorEmbed = createErrorEmbed(error);
      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }
};
