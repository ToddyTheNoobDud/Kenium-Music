// Single color constant used throughout the app
export const EMBED_COLOR = 0x100e09

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

// All colors use same value for consistent branding
export const COLORS = Object.freeze({
  primary: EMBED_COLOR,
  success: EMBED_COLOR,
  error: EMBED_COLOR,
  warning: EMBED_COLOR,
  info: EMBED_COLOR
})

export const LIMITS = Object.freeze({
  MAX_PLAYLISTS: 6,
  MAX_TRACKS: 60,
  MAX_NAME_LENGTH: 50,
  PAGE_SIZE: 8
})
