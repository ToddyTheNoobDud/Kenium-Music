// Optimized: Removed duplicate color values, using single reference
const BASE_COLOR = 0x100e09

export const ICONS = Object.freeze({
  music: '🎵',
  playlist: '🎧',
  add: '➕',
  tracks: '💿',
  info: 'ℹ️',
  star: '⭐',
  play: '▶️',
  shuffle: '🔀',
  remove: '➖',
  artist: '🎤',
  source: '📡',
  duration: '⏱️',
  volume: '🔊',
  youtube: '🎥',
  spotify: '🟢',
  soundcloud: '🟠',
  export: '📤',
  import: '📥',
  delete: '🗑️'
})

// Optimized: All colors use same value, simplified to single constant
export const COLORS = Object.freeze({
  primary: BASE_COLOR,
  success: BASE_COLOR,
  error: BASE_COLOR,
  warning: BASE_COLOR,
  info: BASE_COLOR
})

export const LIMITS = Object.freeze({
  MAX_PLAYLISTS: 6,
  MAX_TRACKS: 60,
  MAX_NAME_LENGTH: 50,
  PAGE_SIZE: 8
})
