import { Container, createEvent } from 'seyfert';
import { MUSIC_PLATFORMS } from '../shared/emojis';

const MAX_TITLE_LENGTH = 60;
const VOLUME_STEP = 10;
const MAX_VOLUME = 100;
const MIN_VOLUME = 0;
const FLAGS_UPDATE = 36864;

const EXCLUDED_PREFIX_REGEX = /^(?:queue_|select_|platform_|lyrics_|add_(?:more_|track_)|edit_description_|remove_track_|playlist_(?:next_|prev_)|create_playlist_|manage_playlist_|view_playlist_|shuffle_playlist_|play_playlist_|help_)/;
const TITLE_SANITIZE_REGEX = /[^\w\s\-_.]/g;
const PLATFORM_PATTERNS = [
  ['youtu', MUSIC_PLATFORMS.youtube],
  ['soundcloud', MUSIC_PLATFORMS.soundcloud],
  ['spotify', MUSIC_PLATFORMS.spotify],
  ['deezer', MUSIC_PLATFORMS.deezer]
];


const formatTime = (ms) => {
  const s = (ms / 1000) | 0;
  const h = (s / 3600) | 0;
  const m = ((s % 3600) / 60) | 0;
  const sec = s % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
};

const truncateText = (text, maxLength = MAX_TITLE_LENGTH) => {
  if (!text || text.length <= maxLength) return text || '';
  const processed = text.replace(TITLE_SANITIZE_REGEX, '').trim();
  return processed.length > maxLength
    ? `${processed.substring(0, maxLength - 3).trimEnd()}...`
    : processed;
};

const getPlatform = (uri) => {
  if (!uri) return MUSIC_PLATFORMS.youtube;
  const lower = uri.toLowerCase();
  for (const [pattern, platform] of PLATFORM_PATTERNS) {
    if (lower.includes(pattern)) return platform;
  }
  return MUSIC_PLATFORMS.youtube;
};

const setPlayerVolume = async (player, volume) => {
  if (!player) return;
  player.volume = volume;
  if (player.setVolume) {
    try {
      await player.setVolume(volume);
    } catch {}
  }
};

export const createEmbed = (player, track, client) => {
  const { position = 0, volume = 0, loop, paused } = player || {};
  const { title = 'Unknown', uri = '', length = 0, requester } = track || {};

  const platform = getPlatform(uri);
  const volumeIcon = volume === 0 ? '🔇' : volume < 50 ? '🔈' : '🔊';
  const loopIcon = loop === 'track' ? '🔂' : loop === 'queue' ? '🔁' : '▶️';
  const truncatedTitle = truncateText(title);
  const capitalizedTitle = truncatedTitle.replace(/\b\w/g, l => l.toUpperCase());

  return new Container({
    components: [
	  // @ts-ignore
      { type: 10, content: `**${platform.emoji} Now Playing**` },
      { type: 14, divider: true, spacing: 1 },
      {
        type: 9,
        components: [
          {
            type: 10,
            content: `## **[\`${capitalizedTitle}\`](${uri})**\n\`${formatTime(position)}\` / \`${formatTime(length)}\``
          },
          {
            type: 10,
            content: `${volumeIcon} \`${volume}%\` ${loopIcon} Requester: \`${requester?.username || 'Unknown'}\``
          }
        ],
        accessory: {
          type: 11,
          media: {
            url: track.info?.artworkUrl || client.me.avatarURL({ extension: 'webp' }) || ''
          }
        }
      },
      { type: 14, divider: true, spacing: 2 },
      {
        type: 1,
        components: [
          { type: 2, label: '🔉', style: 2, custom_id: 'volume_down' },
          { type: 2, label: '⏮️', style: 2, custom_id: 'previous' },
          {
            type: 2,
            label: paused ? '▶️' : '⏸️',
            style: paused ? 3 : 2,
            custom_id: paused ? 'resume' : 'pause'
          },
          { type: 2, label: '⏭️', style: 2, custom_id: 'skip' },
          { type: 2, label: '🔊', style: 2, custom_id: 'volume_up' }
        ]
      },
      { type: 14, divider: true, spacing: 2 }
    ]
  });
};

const actionHandlers = {
  volume_down: async (player) => {
    const vol = Math.max(MIN_VOLUME, (player.volume || 0) - VOLUME_STEP);
    await setPlayerVolume(player, vol);
    return { message: `🔉 Volume set to ${vol}%`, shouldUpdate: true };
  },
  previous: (player) => {
    if (!player.previous) return { message: '❌ No previous track available', shouldUpdate: false };
    player.queue?.unshift(player.current, player.previous);
    player.stop?.();
    return { message: '⏮️ Playing the previous track.', shouldUpdate: false };
  },
  resume: async (player) => {
    player.pause?.(false);
    return { message: '▶️ Resumed playback.', shouldUpdate: true };
  },
  pause: async (player) => {
    player.pause?.(true);
    return { message: '⏸️ Paused playback.', shouldUpdate: true };
  },
  skip: async (player) => {
    if (!player.queue?.length) return { message: '❌ No tracks in queue to skip to.', shouldUpdate: false };
    player.skip?.();
    return { message: '⏭️ Skipped to the next track.', shouldUpdate: false };
  },
  volume_up: async (player) => {
    const vol = Math.min(MAX_VOLUME, (player.volume || 0) + VOLUME_STEP);
    await setPlayerVolume(player, vol);
    return { message: `🔊 Volume set to ${vol}%`, shouldUpdate: true };
  }
};

const updateNowPlayingEmbed = async (player, client) => {
  const msg = player?.nowPlayingMessage;
  if (!msg || !player?.current) {
    if (player) player.nowPlayingMessage = null;
    return;
  }

  try {
    await msg.edit({
      components: [createEmbed(player, player.current, client)],
      flags: FLAGS_UPDATE
    });
  } catch (err) {
    player.nowPlayingMessage = null;
  }
};

export default createEvent({
  data: { name: 'interactionCreate' },
  run: async (interaction, client) => {
    if (!interaction.isButton?.() || !interaction.customId || !interaction.guildId) return;
    if (EXCLUDED_PREFIX_REGEX.test(interaction.customId)) return;

    try {
      await interaction.deferReply?.(64);
    } catch {
      return;
    }

    const player = client.aqua?.players?.get?.(interaction.guildId);
    if (!player?.current) {
      return interaction.editOrReply?.({
        content: '❌ There is no music playing right now.',
        flags: 64
      }).catch(() => null);
    }

    const memberVoice = await interaction.member?.voice().catch(() => null);
    if (!memberVoice) {
      return interaction.editOrReply?.({
        content: '❌ You must be in a voice channel to use this button.'
      }).catch(() => null);
    }

    if (interaction.user.id !== player.current.requester?.id) {
      return interaction.editOrReply?.({
        content: '❌ You are not allowed to use this button.'
      }).catch(() => null);
    }

    const handler = actionHandlers[interaction.customId];
    if (!handler) {
      return interaction.editOrReply?.({
        content: '❌ This button action is not recognized.'
      }).catch(() => null);
    }

    try {
      const result = await handler(player);
      await interaction.followup?.({ content: result.message }).catch(() => null);
      if (result.shouldUpdate && player.current) {
        queueMicrotask(() => updateNowPlayingEmbed(player, client));
      }
    } catch {
      await interaction.editOrReply?.({
        content: '❌ An error occurred. Please try again.'
      }).catch(() => null);
    }
  }
});

export { formatTime, truncateText, getPlatform };
