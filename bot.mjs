import 'dotenv/config';
import { Client, GatewayIntentBits, Options, Partials, Collection, ContainerBuilder} from "discord.js";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import https from "node:https";
import { createRequire } from "node:module";
import { PlaylistButtonHandler } from "./src/commands/playlist.mjs";

const require = createRequire(import.meta.url);
const { Aqua } = require('aqualink');

const { token, NODE_HOST, NODE_PASSWORD, NODE_PORT, NODE_NAME } = process.env;
const UPDATE_INTERVAL = 10000;
const __dirname = dirname(fileURLToPath(import.meta.url));
export const rootPath = __dirname;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildVoiceStates,
    process.env.PREFIX_ENABLED === 'true' ? GatewayIntentBits.MessageContent : null
  ].filter(Boolean),
  
  makeCache: Options.cacheWithLimits({
    MessageManager: { maxSize: 50, keepOverLimit: m => m.author.id === client.user?.id },
    ThreadManager: 25,
    UserManager: 100,
    GuildMemberManager: 50,
    PresenceManager: 0,
    ReactionManager: 0,
    StageInstanceManager: 0,
    GuildBanManager: 0,
    GuildInviteManager: 0,
    ApplicationCommandManager: 10,
    BaseGuildEmojiManager: 0,
    GuildEmojiManager: 0,
    GuildStickerManager: 0
  }),
  
  sweepers: {
    messages: { interval: 600, lifetime: 900 },
    users: { interval: 600, filter: () => u => u?.bot && u.id !== client.user?.id },
    threads: { interval: 600, lifetime: 1800 }
  },
  
  partials: [Partials.Channel],
  rest: { timeout: 10000, retries: 1, rejectOnRateLimit: ['global'] },
  ws: { compress: true, presence: { status: 'idle', activities: [] } },
  allowedMentions: { parse: ['users'], repliedUser: false },
  failIfNotExists: false,
  closeTimeout: 3000
});

const aqua = new Aqua(client, [{
  host: NODE_HOST,
  password: NODE_PASSWORD,
  port: NODE_PORT,
  secure: false,
  name: NODE_NAME
}], {
  defaultSearchPlatform: "ytsearch",
  restVersion: "v4",
  shouldDeleteMessage: true,
  infiniteReconnects: true,
  autoResume: true,
  leaveOnEnd: false,
});

Object.assign(client, {
  aqua,
  slashCommands: new Collection(),
  events: new Collection(),
  selectMenus: new Collection(),
  buttons: new Collection(),
  modals: new Collection()
});

// Global shutdown flag to prevent multiple shutdown attempts
let isShuttingDown = false;

// Enhanced shutdown function
const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log(`Process ${signal} received - graceful shutdown initiated`, "warn");
  
  try {
    // Set a timeout to force exit if graceful shutdown takes too long
    const forceExitTimeout = setTimeout(() => {
      console.log("Force exit due to timeout", "error");
      process.exit(1);
    }, 8000); // 8 seconds timeout
    
    // Save players first
    console.log("Saving players...");
    await aqua.savePlayer();
    console.log("Players saved successfully");
    
    // Destroy all players
    console.log("Destroying players...");
    aqua.players.forEach(player => {
      try {
        player.destroy();
      } catch (e) {
        console.error("Error destroying player:", e);
      }
    });
    
    // Disconnect from Discord
    console.log("Disconnecting from Discord...");
    client.destroy();
    
    clearTimeout(forceExitTimeout);
    console.log("Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    console.error("Error during graceful shutdown:", error);
    process.exit(1);
  }
};

if (process.env.ANTI_DOCKER === 'true') {
  setInterval(async () => {
    if (isShuttingDown) return;
    
    try {
      await aqua.savePlayer();
      console.log("Periodic player save completed");
    } catch (error) {
      console.error("Error during periodic save:", error);
    }
  }, 8 * 60 * 1000) // 8 minutes
}



const channelCache = new Map();
const lastUpdates = new Map();
const PROGRESS_CHARS = ['', '█', '██', '███', '████', '█████', '██████', '███████', '████████', '█████████', '██████████', '███████████', '████████████'];

const formatTime = ms => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return `${h.toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
};

const getChannel = id => channelCache.get(id) || client.channels.cache.get(id);

const canUpdate = id => {
  const last = lastUpdates.get(id) || 0;
  const now = Date.now();
  if (now - last < UPDATE_INTERVAL) return false;
  lastUpdates.set(id, now);
  return true;
};

const updateVoiceStatus = (id, status) => {
  if (!canUpdate(id)) return;
  
  const req = https.request({
    host: 'discord.com',
    path: `/api/v10/channels/${id}/voice-status`,
    method: 'PUT',
    headers: { 'Authorization': `Bot ${token}`, 'Content-Type': 'application/json' },
    timeout: 2000,
  }, res => res.statusCode !== 204 && console.error(`Voice status failed: ${res.statusCode}`));
  
  req.on('error', () => {});
  req.on('timeout', () => req.destroy());
  req.write(JSON.stringify({ status }));
  req.end();
};

const truncateText = (text, length) => text.length > length ? `${text.slice(0, length - 3)}...` : text;

const createEmbed = (player, track) => {
  const { position, volume, loop } = player;
  const { title, uri, length } = track;
  const progress = Math.min(12, Math.max(0, Math.round((position / length) * 12)));
  const bar = `\`[${PROGRESS_CHARS[progress]}⦿${'▬'.repeat(12 - progress)}]\``;
  const volIcon = volume === 0 ? '🔇' : volume < 30 ? '🔈' : volume < 70 ? '🔉' : '🔊';
  const loopIcon = { track: '🔂', queue: '🔁', none: '▶️' }[loop] || '▶️';
  
return new ContainerBuilder({
    components: [
      {
        type: 9,
        components: [
          {
            type: 10,
            content: `### [${truncateText(title, 60)}](${uri})`
          },
          {
            type: 10,
            content: `\`${formatTime(position)}\` ${bar} \`${formatTime(length)}\`\n\n${volIcon} \`${volume}%\` ${loopIcon} \`${track.requester.username}\``
          }
        ],
        accessory: {
          type: 11,
          media: {
            url: track.thumbnail || client.user.avatarURL({ dynamic: true }),
          }
        }
      },
      {
        "type": 14,
        "divider": true,
        "spacing": 2
      },
      {
        type: 1,
        components: [
          {
            type: 2,
            label: "🔉",
            style: 1,
            custom_id: "volume_down"
          },
          {
            type: 2,
            label: "⏮️",
            style: 1,
            custom_id: "previous"
          },
          {
            type: 2,
            label: player.paused ? "▶️" : "⏸️",
            style: player.paused ? 3 : 1,
            custom_id: player.paused ? "resume" : "pause"
          },
          {
            type: 2,
            label: "⏭️",
            style: 1,
            custom_id: "skip"
          },
          {
            type: 2,
            label: "🔊",
            style: 1,
            custom_id: "volume_up"
          },
        ],
      },
    ],
    accent_color: 0
  });
}


let updateTimeout;
const updateMessage = (player, track, force = false) => {
  if (!player.nowPlayingMessage) return;
  
  clearTimeout(updateTimeout);
  updateTimeout = setTimeout(async () => {
    try {
      const embed = force ? createEmbed(player, track) : player.cachedEmbed;
      await player.nowPlayingMessage.edit({ components: [embed], flags: ["4096", "32768"] });
    } catch {
      player.nowPlayingMessage = null;
    }
  }, 500);
};

aqua.on("trackStart", async (player, track) => {
  const channel = getChannel(player.textChannel);
  if (!channel) return;
  
  try {
    const embed = createEmbed(player, track);
    player.cachedEmbed = embed;
    player.nowPlayingMessage = await channel.send({ components: [embed], flags: ["4096", "32768"] });
    updateVoiceStatus(player.voiceChannel, `⭐ ${track.info.title} - Kenium 3.70`);
  } catch (e) {
    console.error("Track start error:", e);
  }
});

aqua.on("trackError", async (player, track, payload) => {
  const channel = getChannel(player.textChannel);
  if (!channel) return;
  
  console.log(payload.exception.message);
  try {
    await channel.send({ content: `❌ Error playing **${track.info.title}**:\n\`${payload.exception.message}\`` });
  } catch {}
});

aqua.on("playerDestroy", player => {
  updateVoiceStatus(player._lastVoiceChannel || player.voiceChannel, null);
  player.nowPlayingMessage = null;
});

aqua.on("queueEnd", player => {
  updateVoiceStatus(player.voiceChannel, null);
  player.nowPlayingMessage = null;
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  
  const { customId } = interaction;
  
  await PlaylistButtonHandler.run(client, interaction);
  
  if (!['volume_down', 'previous', 'pause', 'resume', 'skip', 'volume_up'].includes(customId)) return;
  
  const player = aqua.players.get(interaction.guildId);
  if (!player) return interaction.reply({ content: '❌ No active player', flags: 64 });
  
  const voiceChannel = interaction.member.voice.channel;
  if (!voiceChannel || voiceChannel.id !== player.voiceChannel) {
    return interaction.reply({ content: '❌ Join the same voice channel', flags: 64 });
  }
  
  try {
    let message;
    
    switch (customId) {
      case 'volume_down':
        player.setVolume(Math.max(0, player.volume - 10));
        message = `🔉 Volume: ${player.volume}%`;
        break;
      case 'previous':
        if (!player.previous) return interaction.reply({ content: '❌ No previous track', flags: 64 });
        player.queue.unshift(player.previous);
        player.stop();
        message = '⏮️ Previous track';
        break;
      case 'pause':
        player.pause(true);
        message = '⏸️ Paused';
        break;
      case 'resume':
        player.pause(false);
        message = '▶️ Resumed';
        break;
      case 'skip':
        player.skip();
        message = '⏭️ Skipped';
        break;
      case 'volume_up':
        player.setVolume(Math.min(150, player.volume + 10));
        message = `🔊 Volume: ${player.volume}%`;
        break;
    }
    
    await interaction.reply({ content: message, flags: 64 });
    
    if (['volume_down', 'volume_up', 'pause', 'resume'].includes(customId) && player.current) {
      player.cachedEmbed = createEmbed(player, player.current);
      updateMessage(player, player.current);
    }
  } catch (e) {
    console.error('Button error:', e);
    interaction.reply({ content: '❌ Error occurred', flags: 64 }).catch(() => {});
  }
});

process.on('unhandledRejection', (reason) => {
  console.log(`Unhandled Rejection: ${reason}`, "error");
});

process.on('uncaughtException', (error) => {
  console.log(`Uncaught Exception: ${error}`, "error");
  if (!isShuttingDown) {
    gracefulShutdown('uncaughtException');
  }
});

const signals = ['SIGINT', 'SIGTERM', 'SIGUSR2', 'SIGHUP'];
signals.forEach(signal => {
  process.on(signal, () => gracefulShutdown(signal));
});

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('message', (msg) => {
  if (msg === 'shutdown') {
    gracefulShutdown('PM2_SHUTDOWN');
  }
});

process.on('exit', () => {
  clearInterval();
});

aqua.on('nodeError', (node, error) => console.error(`Node error: ${error.message}`));
aqua.on('nodeConnect', node => console.log(`Node connected: ${node.name}`));
aqua.on("debug", message => console.debug(`[Aqua/Debug] ${message}`));

Promise.allSettled([
  import("./src/handlers/Command.mjs").then(({ CommandHandler }) => new CommandHandler(client, rootPath).refreshCommands()),
  import("./src/handlers/Events.mjs").then(({ EventHandler }) => new EventHandler(client, rootPath).loadEvents())
]).catch(err => console.error("Handler error:", err));

client.on("raw", d => client.aqua.updateVoiceState(d));
client.login(token).catch(err => console.error("Login error:", err));
