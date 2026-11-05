import {
  ActionRow,
  type AutocompleteInteraction,
  Button,
  ButtonStyle,
  Embed
} from 'seyfert'
import { type getPlaylistsCollection, getPlaylistTracks } from '../utils/db.ts'
import { COLORS, ICONS } from './constants.ts'
import { createPlaylistNameCache } from './playlistNameCache.ts'

const MAX_AUTOCOMPLETE_OPTIONS = 25
const PLAYLIST_NAME_CACHE = createPlaylistNameCache()
const MAX_EMBED_FIELDS = 25
const MAX_BUTTONS_PER_ROW = 5

const YT_REGEX =
  /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/

const TITLE_ICONS = Object.freeze({
  primary: ICONS.music,
  success: '\u2728',
  error: '\u274C',
  warning: '\u26A0\uFE0F',
  info: ICONS.info
})

type EmbedFieldInput = {
  name: string | number
  value: string | number
  inline?: boolean
}

type ButtonEmoji = string | { name: string }

type ButtonConfig = {
  id: string
  label: string
  style?: ButtonStyle
  emoji?: ButtonEmoji
  disabled?: boolean
}

type PlaylistCollection = Pick<
  ReturnType<typeof getPlaylistsCollection>,
  'find' | 'findOne'
>

export const createEmbed = (
  type: keyof typeof TITLE_ICONS,
  title: string,
  description: string | null,
  fields: EmbedFieldInput[] = [],
  iconUrl?: string | undefined
) => {
  const embed = new Embed()
    .setColor(COLORS[type])
    .setTitle(`${TITLE_ICONS[type]} ${title}`)
    .setTimestamp()
    .setFooter({
      text: `${ICONS.music} Kenium Music`,
      ...(iconUrl ? { iconUrl } : {})
    })

  if (description) {
    embed.setDescription(description)
  }

  if (fields.length > 0) {
    const clamped = fields.slice(0, MAX_EMBED_FIELDS).map((field) => ({
      name: String(field.name).slice(0, 256),
      value: String(field.value).slice(0, 1024),
      inline: Boolean(field.inline)
    }))
    embed.addFields(clamped)
  }

  return embed
}

export const createButtons = (configs: ButtonConfig[]) => {
  const row = new ActionRow<Button>()
  const limit = Math.min(configs.length, MAX_BUTTONS_PER_ROW)

  for (const config of configs.slice(0, limit)) {
    const button = new Button()
      .setCustomId(config.id)
      .setLabel(config.label)
      .setStyle(config.style ?? ButtonStyle.Secondary)

    if (config.emoji) {
      button.setEmoji(config.emoji)
    }
    if (config.disabled) {
      button.setDisabled(true)
    }
    row.addComponents(button)
  }

  return row
}

export const formatDuration = (ms: number | undefined) => {
  if (!ms) {
    return '00:00'
  }
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const paddedSeconds = String(seconds).padStart(2, '0')
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`
    : `${minutes}:${paddedSeconds}`
}

export const determineSource = (uri: string | undefined) => {
  if (!uri) {
    return '\u2753 Unknown'
  }
  const source = uri.toLowerCase()
  if (source.includes('youtu')) {
    return `${ICONS.youtube} YouTube`
  }
  if (source.includes('spotify')) {
    return `${ICONS.spotify} Spotify`
  }
  if (source.includes('soundcloud')) {
    return `${ICONS.soundcloud} SoundCloud`
  }
  return `${ICONS.music} Music`
}

export const extractYouTubeId = (url: string | undefined) => {
  if (!url) {
    return null
  }
  const match = YT_REGEX.exec(url)
  return match?.[1] ?? null
}

export const handlePlaylistAutocomplete = async (
  interaction: AutocompleteInteraction,
  playlistsCollection: PlaylistCollection
) => {
  const userId = interaction.user.id
  let names = PLAYLIST_NAME_CACHE.get(userId)
  if (!names) {
    names = playlistsCollection
      .find(
        { userId },
        {
          sort: { lastModified: -1 },
          limit: MAX_AUTOCOMPLETE_OPTIONS,
          fields: ['name']
        }
      )
      .map((playlist) => playlist.name)
    PLAYLIST_NAME_CACHE.set(userId, names)
  }
  return interaction.respond(
    names.length
      ? names.map((name) => ({ name: name.slice(0, 100), value: name }))
      : [{ name: 'No Playlists', value: 'No Playlists' }]
  )
}

export const invalidatePlaylistNameCache = (userId: string) =>
  PLAYLIST_NAME_CACHE.invalidate(userId)

export const handleTrackAutocomplete = async (
  interaction: AutocompleteInteraction
) => {
  try {
    const query = String(interaction.getInput() ?? '').trim()

    if (!query) {
      return interaction.respond([
        { name: 'Start typing to search...', value: 'empty' }
      ])
    }

    const result = await interaction.client.aqua.resolve({
      query,
      requester: interaction.user
    })
    const tracks = result.tracks
    const options =
      tracks.length > 0
        ? tracks.slice(0, MAX_AUTOCOMPLETE_OPTIONS).map((track) => ({
            name: String(track.title || track.uri || 'Unknown').slice(0, 100),
            value: String(track.uri || '')
          }))
        : [{ name: 'No Tracks Found', value: 'no_tracks' }]

    return interaction.respond(options)
  } catch {
    return interaction.respond([
      { name: 'Search Error', value: 'search_error' }
    ])
  }
}

export const handleTrackIndexAutocomplete = async (
  interaction: AutocompleteInteraction,
  playlistsCollection: PlaylistCollection
) => {
  const playlistName = interaction.options.getString('playlist')
  if (!playlistName) {
    return interaction.respond([{ name: 'Select playlist first', value: 0 }])
  }

  const playlist = playlistsCollection.findOne({
    userId: interaction.user.id,
    name: playlistName
  })

  if (!playlist) {
    return interaction.respond([{ name: 'Playlist not found', value: 0 }])
  }

  const tracks = getPlaylistTracks(playlist._id, {
    limit: MAX_AUTOCOMPLETE_OPTIONS,
    fields: ['title']
  })

  if (tracks.length === 0) {
    return interaction.respond([{ name: 'No Tracks', value: 0 }])
  }

  const options = tracks.map((track, index) => ({
    name: `${index + 1}. ${String(track.title || 'Untitled').slice(0, 80)}`,
    value: index + 1
  }))

  return interaction.respond(options)
}

export const shuffleArray = <T>(array: T[]) => {
  const shuffled = [...array]
  for (let index = shuffled.length - 1; index > 0; index--) {
    const targetIndex = Math.floor(Math.random() * (index + 1))
    const current = shuffled[index] as T
    shuffled[index] = shuffled[targetIndex] as T
    shuffled[targetIndex] = current
  }
  return shuffled
}

export const truncate = (text: string | undefined, max: number): string => {
  if (!text) {
    return ''
  }
  if (text.length <= max) {
    return text
  }
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}\u2026`
}

export const mapPool = async <T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
  shouldStop?: () => boolean
) => {
  const concurrency = Math.max(1, limit)
  let nextIndex = 0
  const getNextIndex = (): number => {
    const itemIndex = nextIndex
    nextIndex += 1
    return itemIndex
  }
  const next = async () => {
    for (;;) {
      if (shouldStop?.()) {
        return
      }
      const itemIndex = getNextIndex()
      if (itemIndex >= items.length) {
        return
      }
      try {
        const item = items[itemIndex]
        if (item !== undefined) {
          await fn(item, itemIndex)
        }
      } catch (err) {
        console.error(`mapPool task ${itemIndex} failed:`, err)
      }
    }
  }
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    next
  )
  await Promise.all(runners)
}
