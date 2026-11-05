import type { ConnectionOptions, PlayOptions } from 'aqualink'
import type { GuildMember, User } from 'seyfert'

export type MaybePromise<T> = T | Promise<T>

export type DeferReplyOptionsLike = boolean | number | { flags?: number }

export interface UserLike {
  id: string
  username?: string | null
}

export interface VoiceStateLike {
  channelId?: string | null
}

export type MemberLike = Pick<GuildMember, 'voice'>

export interface QueueLike<T = TrackLike> {
  [Symbol.iterator]?: () => Iterator<T>
  size: number
  add(...tracks: T[]): unknown
  move?: (from: number, to: number) => unknown
  clear(): void
  toArray(): T[]
}

export interface TrackInfoLike {
  title?: string
  author?: string
  length?: number
  uri?: string | null
  artworkUrl?: string | null
  isrc?: string | null
}

export interface TrackLike {
  title?: string
  author?: string
  uri?: string | null
  length?: number
  duration?: number
  thumbnail?: string | null
  info?: TrackInfoLike
  requester?: unknown
}

export interface PlayerLike<TTrack = TrackLike> {
  guildId?: string
  destroyed?: boolean
  connected?: boolean
  playing?: boolean
  paused?: boolean
  loop?: string | number | null
  volume?: number
  position?: number
  voiceChannel?: string | null
  _lastVoiceChannel?: string | null
  textChannel?: string | null
  current?: TTrack | null
  previous?: TTrack | null
  queue: QueueLike<TTrack>
  nowPlayingMessage?: unknown
  play(track?: TTrack | null, options?: PlayOptions): MaybePromise<unknown>
  pause(paused: boolean): MaybePromise<unknown>
  skip(): unknown
  stop(): unknown
  destroy(): unknown
  deaf?: boolean
  mute?: boolean
  connect(options?: ConnectionOptions): unknown
  connection?: {
    voiceChannel?: string | null
    resendVoiceUpdate?: (force?: boolean) => MaybePromise<boolean>
  }
  setLoop(mode: 0 | 1 | 2): unknown
  setVolume(value: number): MaybePromise<unknown>
}

export interface ResolveResultLike<TTrack = TrackLike> {
  tracks?: TTrack[]
  loadType?: string
}

export interface AvatarClientLike {
  me?: {
    avatarURL: User['avatarURL']
    id?: string
  }
}

export interface AquaClientLike<TTrack = TrackLike> {
  me?: AvatarClientLike['me']
  aqua: {
    resolve: (options: {
      query: string
      requester: UserLike
      source?: string
    }) => Promise<ResolveResultLike<TTrack>>
    players: {
      get(guildId: string): PlayerLike<TTrack> | undefined
    }
    createConnection(
      options: ConnectionOptions
    ): MaybePromise<PlayerLike<TTrack>>
  }
}
