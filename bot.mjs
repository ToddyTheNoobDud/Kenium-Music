import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder, GatewayDispatchEvents } from "discord.js";
import { dirname } from "node:path";
import http2 from "node:http2";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Aqua } = require('aqualink');

const token = process.env.token;
const { NODE_HOST, NODE_PASSWORD, NODE_PORT, NODE_NAME } = process.env;
const UPDATE_INTERVAL = 10_000;
const ERROR_MESSAGE_DURATION = 5_000;
const ERROR_COLOR = 0xff0000;

const nodes = [{ host: NODE_HOST, password: NODE_PASSWORD, port: NODE_PORT, secure: false, name: NODE_NAME }];

const __dirname = dirname(fileURLToPath(import.meta.url));
export const rootPath = __dirname;

class TimeFormatter {
  static format(ms) {
    return new Date(ms).toISOString().substring(11, 19);
  }
}

class ChannelManager {
  static cache = new Map();
  static updateQueue = new Map();

  static getChannel(client, channelId) {
    let cached = this.cache.get(channelId);
    if (!cached) {
      const channel = client.channels.cache.get(channelId);
      if (channel) {
        cached = { channel, timestamp: Date.now() };
        this.cache.set(channelId, cached);
      }
    }
    return cached?.channel;
  }

  static async updateVoiceStatus(channelId, status, botToken) {
    const now = Date.now();
    if ((now - (this.updateQueue.get(channelId) || 0)) < UPDATE_INTERVAL) return;

    this.updateQueue.set(channelId, now);

    try {
      const client = http2.connect('https://discord.com');
      const req = client.request({
        ':method': 'PUT',
        ':path': `/api/v10/channels/${channelId}/voice-status`,
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      });

      req.setEncoding('utf8');
      req.on('response', (headers) => {
        if (headers[':status'] !== 204) {
          console.error(`Voice status update failed: ${headers[':status']}`);
        }
        client.close();
      });

      req.on('error', (e) => {
        console.error('Voice status update error:', e);
        client.close();
      });

      req.write(JSON.stringify({ status }));
      req.end();
    } catch (e) {
      console.error("Voice status update error:", e);
    }
  }

  static clearOldCache(expiry = 600_000) {
    const now = Date.now();
    this.cache.forEach(({ timestamp }, id) => {
      if (now - timestamp > expiry) this.cache.delete(id);
    });
  }
}

class EmbedFactory {
  static createTrackEmbed(client, player, track) {
    return new EmbedBuilder()
      .setColor(0)
      .setAuthor({ name: '🎵 Kenium 3.0.0', iconURL: client.user.displayAvatarURL(), url: 'https://github.com/ToddyTheNoobDud/Kenium-Music' })
      .setDescription(this.desc(player, track))
      .setThumbnail(track.info.artworkUrl || client.user.displayAvatarURL())
      .setFooter({ text: 'An Open Source Bot', iconURL: 'https://cdn.discordapp.com/attachments/1296093808236302380/1335389585395683419/a62c2f3218798e7eca7a35d0ce0a50d1_1.png' });
  }

  static desc(player, track) {
    const { position, volume, loop } = player;
    const { title, uri, author, album, length, isStream } = track.info;

    return `**[${title}](${uri})**\n*by* **${author}** • *${album || 'Single'}* • *${isStream ? '🔴 LIVE' : '🎵 320kbps'}*\n\n` +
      `\`${TimeFormatter.format(position)}\` ${this.createProgressBar(length, position)} \`${TimeFormatter.format(length)}\`\n\n` +
      `${volume > 50 ? '🔊' : '🔈'} \`${volume}%\` • ${this.getLoopStatus(loop)} • 👤 <@${track.requester.id}>`;
  }

  static createProgressBar(total, current, length = 15) {
    const progress = Math.round((current / total) * length);
    return `\`[${'━'.repeat(progress)}⚪${'─'.repeat(length - progress)}]\``;
  }

  static getLoopStatus(loop) {
    return { track: '🔂 Track Loop', queue: '🔁 Queue Loop', none: '▶️ No Loop' }[loop] || '▶️ No Loop';
  }

  static createErrorEmbed(track, payload) {
    return new EmbedBuilder()
      .setColor(ERROR_COLOR)
      .setTitle("❌ Error Playing Track")
      .setDescription(`**Error:** \`${track.info.title}\`\n**Message:** \`${payload.exception?.message}\``)
      .setFooter({ text: "Kenium v3.0.0 | by mushroom0162" })
      .setTimestamp();
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: ["CHANNEL"]
});

const aqua = new Aqua(client, nodes, {
  defaultSearchPlatform: "ytsearch",
  restVersion: "v4",
  shouldDeleteMessage: true,
  autoResume: true,
  infiniteReconnects: true,
});

aqua.on("trackStart", async (player, track) => {
  const channel = ChannelManager.getChannel(client, player.textChannel);
  if (!channel) return;

  try {
    const status = player.queue.size > 2
      ? `⭐ Playlist (${player.queue.size} tracks) - Kenium 3.0.0`
      : `⭐ ${track.info.title} - Kenium 3.0.0`;

    player.nowPlayingMessage = await channel.send({ embeds: [EmbedFactory.createTrackEmbed(client, player, track)], flags: 4096 });
    ChannelManager.updateVoiceStatus(player.voiceChannel, status, token);
  } catch (error) {
    console.error("Track start error:", error);
  }
});

aqua.on("queueEnd", (player) => {
  ChannelManager.updateVoiceStatus(player.voiceChannel, null, token);
  ChannelManager.clearOldCache();
  player.nowPlayingMessage = null;
});

aqua.on("trackError", async (player, track, payload) => {
  console.error(`Error ${payload.exception.code} / ${payload.exception.message}`);
  const channel = ChannelManager.getChannel(client, player.textChannel);
  if (!channel) return;

  try {
    const errorMessage = await channel.send({ embeds: [EmbedFactory.createErrorEmbed(track, payload)] });
    setTimeout(() => errorMessage.delete().catch(() => { }), ERROR_MESSAGE_DURATION);
  } catch (error) {
    console.error("Error message sending failed:", error);
  }
});

aqua.on("nodeConnect", node => console.log(`Node "${node.name}" connected.`));
aqua.on("nodeError", (node, error) => console.error(`Node "${node.name}" encountered an error: ${error.message}`));

client.on("raw", d => {
  if ([GatewayDispatchEvents.VoiceStateUpdate, GatewayDispatchEvents.VoiceServerUpdate].includes(d.t)) {
    client.aqua.updateVoiceState(d);
  }
});

client.aqua = aqua;
client.slashCommands = new Map();
client.events = new Map();
client.selectMenus = new Map();

await Promise.all([
  import("./src/handlers/Command.mjs").then(({ CommandHandler }) => new CommandHandler(client, rootPath).refreshCommands()),
  import("./src/handlers/Events.mjs").then(({ EventHandler }) => new EventHandler(client, rootPath).loadEvents())
]);

client.login(token);
