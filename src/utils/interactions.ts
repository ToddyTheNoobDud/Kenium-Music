import type {
  DeferReplyOptionsLike,
  MemberLike,
  VoiceStateLike
} from '../shared/helperTypes'

type DeferableContext = {
  deferReply: unknown
  deferred?: unknown
  interaction?: {
    replied?: unknown
  }
  replied?: unknown
}

type RawInteractionLike = DeferableContext & {
  deferReply?: (flags?: number, withResponse?: boolean) => Promise<unknown>
  interaction?: undefined
}

type WrappedContextLike = DeferableContext & {
  deferReply?: (ephemeral?: boolean, withResponse?: boolean) => Promise<unknown>
  interaction?: {
    replied?: unknown
  }
}

const MEMBER_VOICE_STATE = Symbol('interaction.memberVoiceState')

type VoiceContext = {
  member?: MemberLike | null | undefined
  guildId?: string | null | undefined
  author?: { id?: string | null | undefined }
  user?: { id?: string | null | undefined }
  interaction?: {
    user?: { id?: string | null | undefined }
    replied?: unknown
  }
  client?: unknown
  [MEMBER_VOICE_STATE]?: VoiceStateLike | null
}

export const getErrorCode = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined

export const hasErrorCode = (error: unknown, code: string | number) =>
  getErrorCode(error) === code

const getErrorDetail = (error: unknown) => {
  if (typeof error !== 'object' || error === null) return ''

  const metadata =
    'metadata' in error
      ? (error as { metadata?: { detail?: unknown } }).metadata
      : undefined
  const message =
    'message' in error ? (error as { message?: unknown }).message : undefined

  return String(metadata?.detail || message || '')
}

const isInteractionAlreadyHandled = (error: unknown) => {
  const code = getErrorCode(error)
  const detail = getErrorDetail(error)

  return (
    code === 40060 ||
    code === 'INTERACTION_ALREADY_REPLIED' ||
    detail.includes('Interaction already replied') ||
    detail.includes('already been acknowledged')
  )
}

export const isInteractionExpired = (error: unknown) => {
  const code = getErrorCode(error)
  const detail = getErrorDetail(error)
  return (
    code === 10062 ||
    code === 10015 ||
    code === 40060 ||
    code === 'INTERACTION_ALREADY_REPLIED' ||
    detail.includes('Interaction already replied') ||
    detail.includes('already been acknowledged') ||
    detail.includes('Unknown interaction')
  )
}

const EPHEMERAL_FLAG = 64

const getDeferFlags = (option: DeferReplyOptionsLike): number | undefined => {
  if (typeof option === 'boolean') return option ? EPHEMERAL_FLAG : undefined
  if (typeof option === 'number') return option || undefined
  if (typeof option === 'object' && option !== null && 'flags' in option) {
    return typeof option.flags === 'number'
      ? option.flags || undefined
      : undefined
  }
  return undefined
}

const getDeferEphemeral = (option: DeferReplyOptionsLike): boolean =>
  Boolean((getDeferFlags(option) ?? 0) & EPHEMERAL_FLAG)

export const safeDefer = async (
  ctx: DeferableContext,
  option: DeferReplyOptionsLike = false
): Promise<boolean> => {
  if (!ctx.interaction && Boolean(ctx.deferred)) return true
  if (ctx.replied) return true
  if (ctx.interaction?.replied) return true

  if (typeof ctx.deferReply !== 'function') return false

  try {
    if (ctx.interaction !== undefined) {
      await (ctx as WrappedContextLike).deferReply?.(getDeferEphemeral(option))
    } else {
      await (ctx as RawInteractionLike).deferReply?.(getDeferFlags(option))
    }
    return true
  } catch (error) {
    if (isInteractionExpired(error)) return false
    if (isInteractionAlreadyHandled(error)) return true
    throw error
  }
}

export const getMemberVoiceState = async (
  ctx: VoiceContext
): Promise<VoiceStateLike | null> => {
  if (MEMBER_VOICE_STATE in ctx) return ctx[MEMBER_VOICE_STATE] ?? null

  let voiceState: VoiceStateLike | null | undefined
  try {
    if (typeof ctx.member?.voice === 'function') {
      voiceState =
        (await ctx.member.voice('cache')) ??
        (await ctx.member.voice('flow')) ??
        null
    } else {
      voiceState = null
    }
  } catch {
    voiceState = null
  }

  if (!voiceState?.channelId) {
    const userId =
      ctx.author?.id || ctx.user?.id || ctx.interaction?.user?.id || null
    const guildId = ctx.guildId || null
    const voiceStates = (
      ctx.client as
        | {
            cache?: {
              voiceStates?: {
                get?: (
                  userId: string,
                  guildId: string
                ) => VoiceStateLike | null | undefined
              }
            }
          }
        | undefined
    )?.cache?.voiceStates

    if (userId && guildId && typeof voiceStates?.get === 'function') {
      try {
        voiceState = voiceStates.get(userId, guildId) ?? null
      } catch {
        voiceState = null
      }
    }
  }

  ctx[MEMBER_VOICE_STATE] = voiceState ?? null
  return ctx[MEMBER_VOICE_STATE] ?? null
}
