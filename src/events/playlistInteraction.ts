export type PlaylistInteraction =
  | {
      kind: 'playlist'
      action: 'play' | 'shuffle'
      playlistName: string
      userId: string
    }
  | {
      kind: 'playlist'
      action: 'previous' | 'next'
      playlistName: string
      userId: string
      page: number
    }
  | {
      kind: 'playlist'
      action: 'view'
      playlistId: string
      userId: string
    }
  | { kind: 'playlist-select'; userId: string }
  | { kind: 'player' }
  | { kind: 'ignore' }
  | { kind: 'unknown' }

const PLAYER_ACTIONS = new Set([
  'volume_down',
  'volume_up',
  'previous',
  'resume',
  'pause',
  'skip'
])

export function classifyInteractionId(customId: string): PlaylistInteraction {
  if (customId.startsWith('ignore_')) {
    return { kind: 'ignore' }
  }
  if (PLAYER_ACTIONS.has(customId)) {
    return { kind: 'player' }
  }

  const idParts = customId.split(':')
  if (
    idParts.length === 4 &&
    idParts[0] === 'playlist' &&
    idParts[1] === 'view' &&
    idParts[2] &&
    idParts[3]
  ) {
    return {
      kind: 'playlist',
      action: 'view',
      playlistId: idParts[2],
      userId: idParts[3]
    }
  }
  if (
    idParts.length === 3 &&
    idParts[0] === 'playlist' &&
    idParts[1] === 'select' &&
    idParts[2]
  ) {
    return { kind: 'playlist-select', userId: idParts[2] }
  }

  const parts = customId.split('_')
  const userId = parts.at(-1)
  if (!userId) {
    return { kind: 'unknown' }
  }

  if (
    parts.length >= 4 &&
    (parts[0] === 'play' || parts[0] === 'shuffle') &&
    parts[1] === 'playlist'
  ) {
    return {
      kind: 'playlist',
      action: parts[0],
      playlistName: parts.slice(2, -1).join('_'),
      userId
    }
  }

  if (
    parts.length >= 5 &&
    parts[0] === 'playlist' &&
    (parts[1] === 'prev' || parts[1] === 'next')
  ) {
    const page = Number(parts[2])
    if (!Number.isFinite(page)) {
      return { kind: 'unknown' }
    }
    return {
      kind: 'playlist',
      action: parts[1] === 'prev' ? 'previous' : 'next',
      page,
      playlistName: parts.slice(3, -1).join('_'),
      userId
    }
  }

  return { kind: 'unknown' }
}
