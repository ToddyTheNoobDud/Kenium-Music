import { createEvent } from 'seyfert'
import { presenceState } from './botReady.ts'

export default createEvent({
  data: { name: 'guildDelete' },
  run: (guild) => {
    presenceState.cachedGuildCount = Math.max(
      0,
      presenceState.cachedGuildCount - 1
    )
    presenceState.cachedUserCount = Math.max(
      0,
      presenceState.cachedUserCount -
        ('memberCount' in guild ? (guild.memberCount ?? 0) : 0)
    )
  }
})
