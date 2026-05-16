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

type KeniumJsonPayload = {
  name?: string
  description?: string
  tracks?: Array<Record<string, unknown>>
}

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

const safeText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

const safeNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
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
    if (value) return value.trim()
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
  if (!serviceId) return ''
  if (serviceId.source === 'spotify') {
    return `https://open.spotify.com/track/${serviceId.id}`
  }
  return ''
}

const splitCsvLine = (line: string): string[] => {
  const values: string[] = []
  let current = ''
  let quoted = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const next = line[i + 1]

    if (char === '"' && quoted && next === '"') {
      current += '"'
      i++
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      values.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  values.push(current.trim())
  return values
}

const parseCsv = (content: string): CsvRow[] => {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  const headerLine = lines[0]
  if (!headerLine?.includes(',')) return []

  const headers = splitCsvLine(headerLine).map((header) =>
    header.toLowerCase()
  )
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line)
    const row: CsvRow = {}
    headers.forEach((header, index) => {
      row[header] = values[index] || ''
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
  if (!trimmed) return null

  if (trimmed.startsWith('{')) {
    const payload = JSON.parse(trimmed) as KeniumJsonPayload
    const tracks = Array.isArray(payload.tracks)
      ? payload.tracks.map((track) => ({
          title: safeText(track['title']),
          uri: safeText(track['uri']) || undefined,
          author: safeText(track['author']),
          duration: safeNumber(track['duration']),
          source: safeText(track['source']) || undefined,
          identifier: safeText(track['identifier']) || undefined,
          isrc: normalizeIsrc(track['isrc'])
        }))
      : []

    return {
      name: safeText(payload.name) || fallbackName,
      description: safeText(payload.description) || undefined,
      tracks
    }
  }

  const csvRows = parseCsv(trimmed)
  if (csvRows.length > 0) {
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
      tracks
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

  return { name: fallbackName, tracks }
}

export function buildTrackResolveQueries(track: PlaylistFileTrack): string[] {
  const queries = new Set<string>()
  if (track.isrc) queries.add(`isrc:${track.isrc}`)
  if (track.identifier?.startsWith('isrc:')) queries.add(track.identifier)
  if (track.uri && URL_RE.test(track.uri)) queries.add(track.uri)
  if (
    track.identifier &&
    !track.identifier.startsWith('isrc:') &&
    URL_RE.test(track.identifier)
  ) {
    queries.add(track.identifier)
  }
  if (track.title && track.author) queries.add(`${track.title} ${track.author}`)
  if (track.title) queries.add(track.title)
  if (track.uri && !URL_RE.test(track.uri)) queries.add(track.uri)
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
    '# DO NOT MODIFY THIS FILE / CAN GET CORRUPTED - Kenium 4.10.0 - BY mushroom0162',
    `# Export ID: ${exportId}`,
    `# Playlist: ${playlistName}`,
    `# Generated: ${generatedAt.toISOString()}`,
    '# Format: TuneMyMusic-compatible CSV table inside a .txt file'
  ].join('\n')

  return `${csv}\n${footer}`
}
