import type { ConnectionOptions } from 'aqualink'

export type MaybePromise<T> = T | Promise<T>

export type DeferReplyOptionsLike = boolean | number | { flags?: number }

export interface UserLike {
  id: string
  username?: string | null
}

export interface VoiceStateLike {
  channelId?: string | null
}

export interface MemberLike {
  voice?: unknown
}

export interface QueueLike<T = TrackLike> extends Iterable<T> {
  size?: number
  length?: number
  add?: unknown
  move?: (from: number, to: number) => unknown
  clear?: () => void
  slice?: (start: number, end: number) => T[]
  toArray?: () => T[]
  unshift?: unknown
}

export interface TrackInfoLike {
  title?: string
  author?: string
  length?: number
  uri?: string
  artworkUrl?: string | null
  isrc?: string | null
}

export interface TrackLike {
  title?: string
  author?: string
  uri?: string
  length?: number
  duration?: number
  thumbnail?: string | null
  info?: TrackInfoLike
  requester?: unknown
}

export interface EditableMessageLike {
  id?: string
  channelId?: string
  edit?: (payload: unknown) => Promise<unknown>
}

export interface ComponentCollectorLike<TInteraction = InteractionLike> {
  run: (
    customId: string,
    handler: (interaction: TInteraction) => void | Promise<void>
  ) => void
  stop?: () => void
}

export interface ComponentCollectorSourceLike<TInteraction = InteractionLike>
  extends EditableMessageLike {
  createComponentCollector?: (options: {
    idle: number
    filter: (interaction: TInteraction) => boolean
    onStop: () => void
  }) => ComponentCollectorLike<TInteraction> | undefined
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
  queue?: QueueLike<TTrack>
  nowPlayingMessage?: unknown
  play?(track?: TTrack | null, options?: unknown): MaybePromise<unknown>
  pause?: (paused: boolean) => MaybePromise<unknown>
  skip?: () => unknown
  stop?: () => unknown
  destroy?: () => unknown
  deaf?: boolean
  mute?: boolean
  _reconnecting?: boolean
  _voiceRecovering?: boolean
  connect?: (options?: ConnectionOptions) => unknown
  setLoop?: unknown
  setVolume?: (value: number) => MaybePromise<unknown>
}

export interface ResolveResultLike<TTrack = TrackLike> {
  tracks?: TTrack[]
  loadType?: string
}

export interface AvatarClientLike {
  me?: {
    avatarURL?: unknown
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
    players?: {
      get?: unknown
    }
    createConnection?: unknown
  }
}

export interface InteractionLike {
  guildId?: string | null | undefined
  channelId?: string | null | undefined
  customId?: string
  user: UserLike
  member?: MemberLike | null | undefined
  message?: { id?: string | null | undefined } | null | undefined
  deferred?: unknown
  replied?: unknown
  interaction?: {
    replied?: unknown
  }
  isButton?: () => boolean
  isStringSelectMenu?: () => boolean
  values?: string[]
  deferReply: unknown
  deferUpdate?: () => Promise<unknown>
  editOrReply: unknown
  followup: unknown
}
