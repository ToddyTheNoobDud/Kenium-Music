import { getErrorCode, isInteractionExpired } from '../utils/interactions.ts'

type DiscordApiErrorLike = {
  body?: { code?: unknown }
  response?: { code?: unknown }
  metadata?: {
    response?: { code?: unknown }
    code?: unknown
    detail?: unknown
  }
  message?: unknown
  code?: unknown
}

export const extractDiscordApiCode = (error: unknown): number | null => {
  const err = error as DiscordApiErrorLike
  const candidates = [
    err?.body?.code,
    err?.response?.code,
    err?.metadata?.response?.code,
    err?.metadata?.code,
    err?.code
  ]

  for (const candidate of candidates) {
    const value = Number(candidate)
    if (Number.isFinite(value)) {
      return value
    }
  }

  const text = String(err?.metadata?.detail || err?.message || err?.code || '')
  const directMatch = text.match(/\b(10003|10004|50001|50013)\b/)
  if (directMatch?.[1]) {
    return Number(directMatch[1])
  }

  const suffixMatch = String(err?.code || '').match(/_(\d{5})$/)
  if (suffixMatch?.[1]) {
    return Number(suffixMatch[1])
  }

  return null
}

export function isExpiredInteraction(error: unknown): boolean {
  return isInteractionExpired(error) || getErrorCode(error) === 10065
}
