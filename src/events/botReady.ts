import { createEvent } from "seyfert";
import { updatePresence } from "../../index";
import { getSettingsCollection } from "../utils/db";
import { disable247Sync } from "../utils/db_helper";

const NICKNAME_SUFFIX = " [24/7]";
const BATCH_SIZE = 10;
const BATCH_DELAY = 500;
const STARTUP_DELAY = 6000;

const settingsCollection = getSettingsCollection();
let clientInstance: any = null;

const updateNickname = async (guild: any) => {
  const botMember = guild.members?.me;
  if (!botMember) return;

  const currentNick = botMember.nickname || botMember.user?.username || "";
  if (currentNick.includes(NICKNAME_SUFFIX)) return;

  try {
    await botMember.edit({ nick: currentNick + NICKNAME_SUFFIX });
  } catch {}
};

const disable247ForGuild = async (guildId: string, reason: string) => {
  try {
    disable247Sync(guildId, reason);

    const player = clientInstance?.aqua?.players?.get(guildId);
    if (player?.destroy) player.destroy();

    clientInstance?.logger?.info(`[24/7] Disabled for guild ${guildId}: ${reason}`);
  } catch (err) {
    clientInstance?.logger?.error("[24/7] Disable failed:", err);
  }
};

const processGuild = async (client: any, settings: any) => {
  const guildId = String(settings?._id || settings?.guildId || "");
  if (!guildId) return;

  const voiceChannelId = settings.voiceChannelId;
  const textChannelId = settings.textChannelId;

  if (!voiceChannelId || !textChannelId) {
    await disable247ForGuild(guildId, "missing voice/text channel ids");
    return;
  }

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    await disable247ForGuild(guildId, "guild not found");
    return;
  }

  const [voiceChannel, textChannel] = await Promise.all([
    guild.channels.fetch(voiceChannelId).catch(() => null),
    guild.channels.fetch(textChannelId).catch(() => null),
  ]);

  if (!voiceChannel || voiceChannel.type !== 2) {
    await disable247ForGuild(guildId, "voice channel invalid");
    return;
  }

  if (!textChannel || (textChannel.type !== 0 && textChannel.type !== 5)) {
    await disable247ForGuild(guildId, "text channel invalid");
    return;
  }

  await Promise.all([
    client.aqua.createConnection({
      guildId,
      voiceChannel: voiceChannelId,
      textChannel: textChannelId,
      deaf: true,
      defaultVolume: 65,
    }),
    updateNickname(guild),
  ]);
};

const processAutoJoin = async (client: any) => {
  const enabled = settingsCollection.find(
    {
      twentyFourSevenEnabled: true,
      voiceChannelId: { $ne: null },
      textChannelId: { $ne: null },
    },
    { fields: ["_id", "guildId", "voiceChannelId", "textChannelId", "twentyFourSevenEnabled"] },
  );

  if (!enabled?.length) return;

  for (let i = 0; i < enabled.length; i += BATCH_SIZE) {
    const batch = enabled.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(batch.map((s: any) => processGuild(client, s)));

    if (i + BATCH_SIZE < enabled.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY));
    }
  }
};

export default createEvent({
  data: { once: true, name: "botReady" },
  run: (user, client) => {
    clientInstance = client;
    if (!client.botId) client.botId = user.id;

    client.aqua.init(client.botId);
    updatePresence(client as any);
    client.logger.info(`${user.username} is ready`);

    setTimeout(() => processAutoJoin(client), STARTUP_DELAY);
  },
});