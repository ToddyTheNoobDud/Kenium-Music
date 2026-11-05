import { APP_VERSION } from '../shared/constants.ts'
import { ImportFileError } from './importFile.ts'

export type PlaylistFileTrack = {
  title: string
  author: string
  album?: string | undefined
  playlistName?: string | undefined
  uri?: string | undefined
  duration?: number | undefined
  source?: string | undefined
  identifier?: string | undefined
  isrc?: string | null
}

type CsvRow = Record<string, string>

const TUNEMYMUSIC_HEADERS = [
  'Track name',
  'Artist name',
  'Album',
  'Playlist name',
  'Type',
  'ISRC',
  'Track URL',
  'Kenium URI',
  'Kenium Identifier',
  'Duration'
] as const

const URL_RE =
  /^https?:\/\/|youtube\.com|youtu\.be|spotify\.com|soundcloud\.com/i
const ISRC_RE = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i
const NUMBER_RE = /^\d+\.\s*/

function validatePlaylistTracks(
  tracks: PlaylistFileTrack[]
): PlaylistFileTrack[] {
  for (const [index, track] of tracks.entries()) {
    for (const [field, value] of Object.entries(track)) {
      const limit = field === 'uri' || field === 'identifier' ? 4096 : 1024
      if (typeof value === 'string' && value.length > limit) {
        throw new ImportFileError(
          `Track ${index + 1}: ${field} exceeds ${limit} characters.`
        )
      }
    }
    for (const reference of [track.uri, track.identifier]) {
      if (!reference) {
        continue
      }
      let url: URL
      try {
        url = new URL(reference)
      } catch {
        if (
          !/^(?:(?:www|m|music)\.)?(?:youtube\.com|youtu\.be)\//i.test(
            reference
          )
        ) {
          continue
        }
        url = new URL(`https://${reference}`)
      }
      let videoId: string | null | undefined
      if (url.hostname === 'youtu.be') {
        videoId = url.pathname.split('/')[1] ?? ''
      } else if (
        url.hostname === 'youtube.com' ||
        url.hostname.endsWith('.youtube.com')
      ) {
        if (url.pathname === '/watch') {
          videoId = url.searchParams.get('v')
        } else if (/^\/(shorts|embed|live)\//.test(url.pathname)) {
          videoId = url.pathname.split('/')[2] ?? ''
        }
      }
      if (videoId !== undefined && !/^[A-Za-z0-9_-]{11}$/.test(videoId ?? '')) {
        throw new ImportFileError(
          `Track ${index + 1}: invalid YouTube video URL.`
        )
      }
    }
  }
  return tracks
}

const safeText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

const safeNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

const normalizeIsrc = (value: unknown): string | null => {
  const isrc = safeText(value).replaceAll('-', '').toUpperCase()
  return ISRC_RE.test(isrc) ? isrc : null
}

const readColumn = (row: CsvRow, names: string[]): string => {
  for (const name of names) {
    const value = row[name.toLowerCase()]
    if (value) {
      return value.trim()
    }
  }
  return ''
}

const readServiceId = (row: CsvRow): { source: string; id: string } | null => {
  for (const [key, value] of Object.entries(row)) {
    const match = key.match(/^(.+?)\s*-\s*id$/i)
    if (match?.[1] && value.trim()) {
      return {
        source: match[1].trim().toLowerCase(),
        id: value.trim()
      }
    }
  }
  return null
}

const serviceIdToUri = (
  serviceId: { source: string; id: string } | null
): string => {
  if (!serviceId) {
    return ''
  }
  if (serviceId.source === 'spotify') {
    return `https://open.spotify.com/track/${serviceId.id}`
  }
  return ''
}

const parseCsv = (content: string): CsvRow[] | null => {
  const headerLine = content
    .split(/\r?\n/)
    .find((line) => line.trim() && !line.trimStart().startsWith('#'))
  if (
    !headerLine?.includes(',') ||
    !/(?:^|,)\s*"?(?:track name|title|name|track url|url|uri|kenium uri)"?\s*(?:,|$)/i.test(
      headerLine
    )
  ) {
    return null
  }

  const rows: string[][] = []
  let values: string[] = []
  let value = ''
  let quoted = false
  let closedQuote = false

  for (let index = 0; index <= content.length; index++) {
    if (index === content.length && quoted) {
      throw new ImportFileError('Invalid CSV: an opening quote was not closed.')
    }
    const character = content[index] ?? '\n'
    const next = content[index + 1]

    if (!quoted && !values.length && !value.trim() && character === '#') {
      while (index < content.length && content[index] !== '\n') {
        index++
      }
      value = ''
      continue
    }
    if (character === '"' && quoted && next === '"') {
      value += '"'
      index++
    } else if (character === '"') {
      if (!quoted && (value.trim() || closedQuote)) {
        throw new ImportFileError(
          'Invalid CSV: unexpected quote inside a field.'
        )
      }
      quoted = !quoted
      closedQuote = !quoted
    } else if (character === ',' && !quoted) {
      values.push(value.trim())
      value = ''
      closedQuote = false
    } else if (character === '\n' && !quoted) {
      values.push(value.trim())
      if (values.some(Boolean)) {
        rows.push(values)
      }
      values = []
      value = ''
      closedQuote = false
    } else if (character !== '\r' || quoted) {
      if (closedQuote && character.trim()) {
        throw new ImportFileError(
          'Invalid CSV: unexpected text after a closing quote.'
        )
      }
      value += character
    }
  }

  const headers = (rows.shift() ?? []).map((header) => header.toLowerCase())
  return rows.map((columns, index) => {
    if (columns.length !== headers.length) {
      throw new ImportFileError(
        `Invalid CSV: row ${index + 2} has ${columns.length} columns; expected ${headers.length}.`
      )
    }
    const row: CsvRow = {}
    headers.forEach((header, index) => {
      row[header] = columns[index] || ''
    })
    return row
  })
}

const csvEscape = (value: unknown): string => {
  const text = String(value ?? '')
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function parsePlaylistFile(
  content: string,
  fallbackName = 'Imported playlist'
): {
  name: string
  description?: string | undefined
  tracks: PlaylistFileTrack[]
} | null {
  const trimmed = content.trim()
  if (!trimmed) {
    return null
  }

  if (trimmed.startsWith('{')) {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(trimmed)
    } catch {
      throw new ImportFileError('Invalid JSON playlist file.')
    }
    if (!Array.isArray(payload.tracks)) {
      throw new ImportFileError(
        'The JSON playlist must contain a tracks array.'
      )
    }
    const tracks = payload.tracks.map((track: unknown) => {
      if (!track || typeof track !== 'object' || Array.isArray(track)) {
        throw new ImportFileError('Each imported track must be a JSON object.')
      }
      const fields = track as Record<string, unknown>
      for (const field of [
        'title',
        'author',
        'uri',
        'source',
        'identifier',
        'isrc'
      ]) {
        if (fields[field] != null && typeof fields[field] !== 'string') {
          throw new ImportFileError(`Invalid track ${field}: expected text.`)
        }
      }
      return {
        title: safeText(fields.title),
        uri: safeText(fields.uri) || undefined,
        author: safeText(fields.author),
        duration: safeNumber(fields.duration),
        source: safeText(fields.source) || undefined,
        identifier: safeText(fields.identifier) || undefined,
        isrc: normalizeIsrc(fields.isrc)
      }
    })
    const description = safeText(payload.description) || undefined
    if (description && description.length > 4096) {
      throw new ImportFileError('Playlist description exceeds 4096 characters.')
    }

    return {
      name: safeText(payload.name) || fallbackName,
      description,
      tracks: validatePlaylistTracks(tracks)
    }
  }

  const csvRows = parseCsv(trimmed)
  if (csvRows !== null) {
    const tracks = csvRows.map((row) => {
      const title = readColumn(row, ['track name', 'title', 'name'])
      const author = readColumn(row, ['artist name', 'artist', 'artists'])
      const serviceId = readServiceId(row)
      const uri =
        readColumn(row, [
          'track url',
          'url',
          'uri',
          'kenium uri',
          'spotify url',
          'youtube url',
          'soundcloud url'
        ]) || serviceIdToUri(serviceId)
      const playlistName = readColumn(row, ['playlist name', 'playlist'])

      return {
        title,
        author,
        album: readColumn(row, ['album', 'album name']) || undefined,
        playlistName: playlistName || undefined,
        uri: uri || undefined,
        duration: safeNumber(readColumn(row, ['duration', 'length'])),
        source:
          readColumn(row, ['source', 'platform', 'type']) ||
          serviceId?.source ||
          undefined,
        identifier:
          readColumn(row, ['kenium identifier', 'identifier', 'track id']) ||
          serviceId?.id ||
          undefined,
        isrc: normalizeIsrc(readColumn(row, ['isrc']))
      }
    })

    return {
      name: fallbackName,
      tracks: validatePlaylistTracks(tracks)
    }
  }

  const tracks = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const parts = line.split(/\s*\|\s*/)
      if (parts.length === 1) {
        return { title: '', author: '', uri: line }
      }

      const [first = '', second = '', third = '', , fifth = ''] = parts
      if (URL_RE.test(first)) {
        return {
          title: second.replace(NUMBER_RE, ''),
          author: third,
          uri: first,
          isrc: normalizeIsrc(fifth)
        }
      }

      return {
        title: first.replace(NUMBER_RE, ''),
        author: third,
        uri: second,
        isrc: normalizeIsrc(fifth)
      }
    })

  return { name: fallbackName, tracks: validatePlaylistTracks(tracks) }
}

export function buildTrackResolveQueries(track: PlaylistFileTrack): string[] {
  const queries = new Set<string>()
  if (track.isrc) {
    queries.add(`isrc:${track.isrc}`)
  }
  if (track.identifier?.startsWith('isrc:')) {
    queries.add(track.identifier)
  }
  if (track.uri && URL_RE.test(track.uri)) {
    queries.add(track.uri)
  }
  if (
    track.identifier &&
    !track.identifier.startsWith('isrc:') &&
    URL_RE.test(track.identifier)
  ) {
    queries.add(track.identifier)
  }
  if (track.title && track.author) {
    queries.add(`${track.title} ${track.author}`)
  }
  if (track.title) {
    queries.add(track.title)
  }
  if (track.uri && !URL_RE.test(track.uri)) {
    queries.add(track.uri)
  }
  return [...queries]
}

export function playlistTracksToCsv(
  playlistName: string,
  tracks: PlaylistFileTrack[]
): string {
  const rows = tracks.map((track) =>
    [
      track.title,
      track.author,
      track.album || '',
      playlistName,
      track.source || 'Music',
      track.isrc || '',
      track.uri || '',
      track.uri || '',
      track.identifier || '',
      track.duration || ''
    ]
      .map(csvEscape)
      .join(',')
  )

  return `${TUNEMYMUSIC_HEADERS.join(',')}\n${rows.join('\n')}`
}

export function playlistTracksToKeniumText(
  playlistName: string,
  tracks: PlaylistFileTrack[],
  exportId: string,
  generatedAt = new Date()
): string {
  const csv = playlistTracksToCsv(playlistName, tracks)
  const footer = [
    '',
    `# DO NOT MODIFY THIS FILE / CAN GET CORRUPTED - Kenium ${APP_VERSION} - BY mushroom0162`,
    `# Export ID: ${exportId}`,
    `# Playlist: ${playlistName}`,
    `# Generated: ${generatedAt.toISOString()}`,
    '# Format: TuneMyMusic-compatible CSV table inside a .txt file'
  ].join('\n')

  return `${csv}\n${footer}`
}
