import { createMiddleware, Formatter } from 'seyfert'
import { TimestampStyle } from 'seyfert/lib/common'

export const cooldownMiddleware = createMiddleware<void>(
  async ({ context, next, stop }) => {
    const inCooldown = context.client.cooldown.context(context)

    typeof inCooldown === 'number'
      ? context.write({
          content: `You're in cooldown, try again ${Formatter.timestamp(new Date(Date.now() + inCooldown), TimestampStyle.RelativeTime)}`,
          flags: 64
        })
      : next()
  }
)
