import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  GatewayDispatchEvents,
  Options
} from "discord.js";
import { token } from "./config.mjs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Aqua } = require('aqualink');

const CONFIG = Object.freeze({
  UPDATE_INTERVAL: 30000,
  ERROR_MESSAGE_DURATION: 5000,
  ERROR_COLOR: 0xff0000,
  DEFAULT_COLOR: '#0A0A0A',
  PROGRESS_BAR_LENGTH: 12,
  BOT_VERSION: 'v2.8.0'
});

const LAVALINK_NODES = Object.freeze([{
  host: "",
  password: "",
  port: 433,
  secure: false,
  name: "toddy's"
}]);

class TimeFormatter {
  static formatter = new Intl.NumberFormat('en-US', {
    minimumIntegerDigits: 2,
    useGrouping: false
  });

  static format(milliseconds) {
    if (!milliseconds || milliseconds < 0) return '00:00';
    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return hours > 0
      ? `${hours}:${this.formatter.format(minutes)}:${this.formatter.format(seconds)}`
      : `${this.formatter.format(minutes)}:${this.formatter.format(seconds)}`;
  }
}

class ChannelManager {
  static cache = new Map();
  static updateQueue = new Set();
  static maxCacheSize = 1000;

  static getChannel(client, channelId) {
    const cacheKey = `${client.user.id}:${channelId}`;
    let channel = this.cache.get(cacheKey);
    if (!channel) {
      channel = client.channels.cache.get(channelId);
      if (channel) {
        if (this.cache.size >= this.maxCacheSize) {
          const oldestKey = this.cache.keys().next().value;
          this.cache.delete(oldestKey);
        }
        this.cache.set(cacheKey, channel);
      }
    }
    return channel;
  }

  static async updateVoiceStatus(channelId, status, token) {
    if (this.updateQueue.has(channelId)) return;
    this.updateQueue.add(channelId);

    try {
      const response = await fetch(
        `https://discord.com/api/v10/channels/${channelId}/voice-status`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bot ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: status || `Kenium ${CONFIG.BOT_VERSION}` }),
        }
      );

      if (!response.ok) {
        console.error(`Voice status update failed: ${response.status}`);
      }
    } catch (error) {
      console.error("Voice status update error:", error.message);
    } finally {
      setTimeout(() => {
        this.updateQueue.delete(channelId);
      }, CONFIG.UPDATE_INTERVAL);
    }
  }

  static clearCache() {
    this.cache.clear();
    this.updateQueue.clear();
  }
}

class EmbedFactory {
  static baseEmbed = new EmbedBuilder().setColor(CONFIG.DEFAULT_COLOR);
  static errorEmbed = new EmbedBuilder().setColor(CONFIG.ERROR_COLOR);

  static createTrackEmbed(client, player, track) {
    if (!track || !track.info) return null;
    const progressBar = this.createProgressBar(track.info.length, player.position);
    const embed = new EmbedBuilder(this.baseEmbed.toJSON());
    return embed
      .setAuthor({
        name: `Kenium ${CONFIG.BOT_VERSION}`,
        iconURL: client.user.displayAvatarURL(),
        url: 'https://github.com/ToddyTheNoobDud/Kenium-Music'
      })
      .setDescription(this.createTrackDescription(track, player, progressBar))
      .setThumbnail(track.info.artworkUrl || client.user.displayAvatarURL())
      .setFooter({
        text: `${CONFIG.BOT_VERSION} • mushroom0162`,
        iconURL: 'https://cdn.discordapp.com/attachments/1296093808236302380/1335389585395683419/a62c2f3218798e7eca7a35d0ce0a50d1_1.png'
      });
  }

  static createTrackDescription(track, player, progressBar) {
    return [
      `### [\`${track.info.title}\`](<${track.info.uri}>)`,
      `> by **${track.info.author}** • ${track.info.album || 'Single'} • ${track.info.isStream ? '🔴 LIVE' : '320kbps'}`,
      '',
      `\`${TimeFormatter.format(player.position)}\` ${progressBar} \`${TimeFormatter.format(track.info.length)}\``,
      '',
      `${player.volume > 50 ? '🔊' : '🔈'} \`${player.volume}%\` • ${player.loop ? '🔁' : '▶️'} \`${player.loop ? 'Loop' : 'Normal'}\` • 👤 <@${track.requester.id}>`
    ].join('\n');
  }

  static createProgressBar(total, current) {
    if (!total || total === 0) return '─'.repeat(CONFIG.PROGRESS_BAR_LENGTH);
    const progress = Math.min(Math.round((current / total) * CONFIG.PROGRESS_BAR_LENGTH), CONFIG.PROGRESS_BAR_LENGTH);
    return '━'.repeat(progress) + (current > 0 ? '⚪' : '⭕') + '─'.repeat(CONFIG.PROGRESS_BAR_LENGTH - progress);
  }

  static createErrorEmbed(track, payload) {
    const embed = new EmbedBuilder(this.errorEmbed.toJSON());
    return embed
      .setTitle("❌ Error Playing Track")
      .setDescription([
        '### Something went wrong while playing:',
        '```diff',
        `- Track: ${track?.info?.title || 'Unknown'}`,
        `- Error: ${payload?.exception?.message || 'Unknown error'}`,
        '```',
        '*Try playing the track again or check if the URL is valid.*'
      ].join('\n'))
      .setFooter({
        text: `Kenium ${CONFIG.BOT_VERSION} • Report bugs on GitHub`,
        iconURL: 'https://cdn.discordapp.com/attachments/1296093808236302380/1335389585395683419/a62c2f3218798e7eca7a35d0ce0a50d1_1.png'
      })
      .setTimestamp();
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: ["CHANNEL"],
  sweepers: {
    messages: {
      interval: 300,
      lifetime: 600
    },
    users: {
      interval: 3600,
      filter: () => user => !user.bot
    },
    guilds: {
      interval: 3600,
      filter: () => guild => guild.members.cache.size === 0
    }
  },
  makeCache: Options.cacheWithLimits({
    MessageManager: 100,
    PresenceManager: 0,
    UserManager: {
      maxSize: 100,
      keepOverLimit: (user) => user.bot
    }
  })
});

const aqua = new Aqua(client, LAVALINK_NODES, {
  defaultSearchPlatform: "ytsearch",
  restVersion: "v4",
  shouldDeleteMessage: true,
  autoResume: false,
  infiniteReconnects: false,
  leaveOnEnd: true,
  reconnectTries: 5,
  reconnectInterval: 5000
});

const handleTrackStart = async (player, track) => {
  const channel = ChannelManager.getChannel(client, player.textChannel);
  if (!channel) return;
  try {
    const trackCount = player.queue.size;
    const status = trackCount > 2
      ? `⭐ Playlist (${trackCount} tracks) - Kenium ${CONFIG.BOT_VERSION}`
      : `⭐ ${track.info.title} - Kenium ${CONFIG.BOT_VERSION}`;
    const embed = EmbedFactory.createTrackEmbed(client, player, track);
    if (!embed) return;
    const nowPlayingMessage = await channel.send({ embeds: [embed] });
    player.nowPlayingMessage = nowPlayingMessage;
    ChannelManager.updateVoiceStatus(player.voiceChannel, status, token);
  } catch (error) {
    console.error("Track start error:", error.message);
  }
};

aqua.on("trackStart", handleTrackStart);
aqua.on("trackChange", async (player, newTrack) => {
  if (!player?.nowPlayingMessage || player.shouldDeleteMessage) return;
  try {
    const embed = EmbedFactory.createTrackEmbed(client, player, newTrack);
    if (!embed) return;
    await player.nowPlayingMessage.edit({ embeds: [embed] });
  } catch (error) {
    console.error("Track change error:", error.message);
    player.nowPlayingMessage = null;
  }
});
aqua.on("trackEnd", (player) => {
  if (player.queue.length === 0) {
    ChannelManager.clearCache();
  }
  player.nowPlayingMessage = null;
});
aqua.on("trackError", async (player, track, payload) => {
  console.error(`Track error: ${payload?.exception?.message}`);
  const channel = ChannelManager.getChannel(client, player.textChannel);
  if (!channel) return;
  try {
    const errorMessage = await channel.send({
      embeds: [EmbedFactory.createErrorEmbed(track, payload)]
    });
    setTimeout(() => {
      errorMessage.delete().catch(() => { });
    }, CONFIG.ERROR_MESSAGE_DURATION);
  } catch (error) {
    console.error("Error message sending failed:", error.message);
  }
});

aqua.on("nodeConnect", (node) => console.log(`Node "${node.name}" connected.`));
aqua.on("nodeError", (node, error) => console.error(`Node "${node.name}" error:`, error.message));
aqua.on("nodeDisconnect", (node) => {
  console.log(`Node "${node.name}" disconnected. Cleaning up resources...`);
  ChannelManager.clearCache();
});

client.on("raw", (d) => {
  if (![GatewayDispatchEvents.VoiceStateUpdate, GatewayDispatchEvents.VoiceServerUpdate].includes(d.t)) return;
  if (!d.d?.guild_id) return;
  client.aqua.updateVoiceState(d);
});

client.aqua = aqua;
client.slashCommands = new Map();
client.events = new Map();
client.selectMenus = new Map();

Promise.all([
  import("./src/handlers/Command.mjs").then(({ CommandHandler }) => CommandHandler(client, dirname(fileURLToPath(import.meta.url)))),
  import("./src/handlers/Events.mjs").then(({ EventHandler }) => EventHandler(client, dirname(fileURLToPath(import.meta.url))))
]).catch(console.error);

client.login(token).catch(console.error);
