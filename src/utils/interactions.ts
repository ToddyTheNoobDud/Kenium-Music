type DeferableContext = {
  deferReply: (ephemeral?: boolean) => Promise<unknown>
  deferred?: unknown
  interaction?: {
    replied?: unknown
  }
}

const isInteractionAlreadyHandled = (error: any) => {
  const code = error?.code
  const detail = String(error?.metadata?.detail || error?.message || '')

  return (
    code === 40060 ||
    code === 'INTERACTION_ALREADY_REPLIED' ||
    detail.includes('Interaction already replied') ||
    detail.includes('already been acknowledged')
  )
}

export const safeDefer = async (
  ctx: DeferableContext,
  ephemeral = false
): Promise<boolean> => {
  if (!ctx.interaction && Boolean(ctx.deferred)) return true
  if (ctx.interaction?.replied) return true

  try {
    await ctx.deferReply(ephemeral)
    return true
  } catch (error: any) {
    if (error?.code === 10062 || error?.code === 10015) return false
    if (isInteractionAlreadyHandled(error)) return true
    throw error
  }
}
