import {
  Client,
  GatewayIntentBits,
  Collection,
  EmbedBuilder,
  GatewayDispatchEvents
} from "discord.js";
import { token } from "./config.mjs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Aqua } = require('aqualink');

const nodes = [{
  host: "",
  password: "a",
  port: 133,
  secure: false,
  name: "toddys"
}];
const __dirname = dirname(fileURLToPath(import.meta.url));
export const rootPath = __dirname;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: ["CHANNEL"],
});

const aqua = new Aqua(client, nodes, {
  send: (payload) => {
    const guild = client.guilds.cache.get(payload.d.guild_id);
    if (guild) guild.shard.send(payload);
  },
  defaultSearchPlatform: "ytsearch",
  restVersion: "v4",
  shouldDeleteMessage: true,
  autoResume: false, 
});


function formatTime(time) {
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

function createTrackEmbed(player, track) {
  const position = player.position || 0;
  const duration = track.info.length;
  const progress = Math.floor((position / duration) * 20);
  const progressBar = '▰'.repeat(progress) + '▱'.repeat(20 - progress);
  
  return new EmbedBuilder()
    .setColor(0x000000)
    .setDescription(`> [\`${track.info.title}\`](${track.info.uri})`)
    .addFields(
      { name: "> ⏱️ Duration", value: `> \`${formatTime(Math.round(track.info.length / 1000))}\``, inline: true },
      { name: "> 👤 Author", value: `> \`${track.info.author}\``, inline: true },
      { name: "> 💿 Album", value: `> \`${track.info.album || 'N/A'}\``, inline: true },
      { name: "> 🔊 Volume", value: `> \`${player.volume}%\``, inline: true },
      { name: "> 🔁 Loop", value: `> ${player.loop ? 'Off' : 'On'}`, inline: true },
      { name: "▶️ Progress", value: `\`${Math.round((position / duration) * 100)}%\` [${progressBar}]`, inline: false } 
    )
    .setThumbnail(track.info.artworkUrl)
    .setAuthor({ name: "Kenium v2.5.0 | by mushroom0162", iconURL: client.user.avatarURL() });
}
async function updateTrackEmbed(player, track, message) {
  const interval = setInterval(async () => {
    if (player.playing) {
      const newEmbed = createTrackEmbed(player, track);
      await message.edit({ embeds: [newEmbed] });
    } else {
      clearInterval(interval); 
    }
  }, 20000); 

  player.on('trackEnd', () => {
    clearInterval(interval);
  });
}
const channelCache = new WeakMap();
const getChannelFromCache = (channelId) => {
  let channel = channelCache.get(channelId);
  if (!channel) {
    channel = client.channels.cache.get(channelId);
    if (channel) channelCache.set(channel, channelId);
  }
  return channel;
};

// Example usage in your event listener
aqua.on('trackStart', async (player, track) => {
  const channel = getChannelFromCache(player.textChannel);
  if (channel) {
    player.nowPlayingMessage = await channel.send({ embeds: [createTrackEmbed(player, track)] });
    updateTrackEmbed(player, track, player.nowPlayingMessage); // Start updating the embed
  }
});

aqua.on('trackChange', async (player, newTrack) => {
  if (player.nowPlayingMessage && !player.shouldDeleteMessage) {
    await player.nowPlayingMessage.edit({ embeds: [createTrackEmbed(player, newTrack)] });
    // Restart the update interval for the new track
    updateTrackEmbed(player, newTrack, player.nowPlayingMessage);
  }
});

aqua.on('trackEnd', async (player) => {
  player.nowPlayingMessage = null;
});

aqua.on('trackError', async (player, track, payload) => {
  console.error(`Error ${payload.exception.code} / ${payload.exception.message}`);
  const channel = getChannelFromCache(player.textChannel);
  
  if (channel) {
    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle("❌ Error Playing Track")
      .setDescription(`Error playing track: \`${track.info.title}\`\nMessage: \`${payload.exception.message}\``)
      .setFooter({ text: "Kenium v2.5.0 | by mushroom0162" })
      .setTimestamp();
    try {
      const message = await channel.send({ embeds: [embed] });
      setTimeout(() => message.delete().catch(console.error), 5000);
    } catch (error) {
      console.error('Error sending error message:', error);
    }
  }
});

client.aqua = aqua;
client.on("raw", (d) => {
  if (![GatewayDispatchEvents.VoiceStateUpdate, GatewayDispatchEvents.VoiceServerUpdate].includes(d.t)) return;
  client.aqua.updateVoiceState(d);
});

client.aqua.on('nodeConnect', (node) => {
  console.log(`Node "${node.name}" connected.`);
});

aqua.on("debug", (message) => console.log(message));

client.aqua.on('nodeError', (node, error) => {
  console.error(`Node "${node.name}" encountered an error: ${error.message}.`);
});

client.slashCommands = new Collection();
client.events = new Collection();
client.selectMenus = new Collection();

await import("./src/handlers/Command.mjs").then(({ CommandHandler }) => CommandHandler(client, rootPath));
await import("./src/handlers/Events.mjs").then(({ EventHandler }) => EventHandler(client, rootPath));

client.login(token);
