import type { CommandContext } from 'seyfert'
import { getErrorCode, isInteractionExpired } from '../utils/interactions'

export function withErrorGuard(
  run: (ctx: CommandContext) => Promise<void>
): (ctx: CommandContext) => Promise<void> {
  return async (ctx: CommandContext) => {
    try {
      await run(ctx)
    } catch (err: unknown) {
      if (isInteractionExpired(err) || getErrorCode(err) === 10065) return
      console.error(err)
      try {
        await ctx.editOrReply({ content: 'An error occurred.' })
      } catch (innerErr) {
        if (isInteractionExpired(innerErr)) return
      }
    }
  }
}

export function isExpiredInteraction(error: unknown): boolean {
  return isInteractionExpired(error) || getErrorCode(error) === 10065
}
