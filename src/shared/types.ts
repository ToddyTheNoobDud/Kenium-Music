export interface Playlist {
  [key: string]: any
  _id: string
  userId: string
  name: string
  description?: string
  createdAt: string
  lastModified: string
  playCount: number
  totalDuration: number
  trackCount: number
}

export interface Track {
  [key: string]: any
  _id: string
  playlistId: string
  title: string
  uri: string
  author: string
  duration: number
  addedAt: string
  addedBy: string
  source: string
  identifier: string
  isStream?: boolean
  isSeekable?: boolean
  position?: number
  artworkUrl?: string | null
  isrc?: string | null
}
