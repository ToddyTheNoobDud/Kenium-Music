import type { CooldownResult } from '@slipher/cooldown'
import { type AnyContext, createMiddleware, Formatter } from 'seyfert'

export const cooldownMiddleware = createMiddleware<
  CooldownResult | undefined,
  AnyContext
>(async ({ context, next, stop }) => {
  const result = await context.cooldown.consume()

  if (!result || result.allowed) {
    return next(result)
  }

  await context.write({
    content: `You're in cooldown, try again ${Formatter.timestamp(result.retryAfter)}`,
    flags: 64
  })
  stop()
})
