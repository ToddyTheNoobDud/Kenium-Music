import { createEvent } from 'seyfert'
import { state } from '../../index'

export default createEvent({
  data: { name: 'guildDelete' },
  run: (guild) => {
    state.cachedGuildCount = Math.max(0, state.cachedGuildCount - 1)
    const raw = guild as {
      memberCount?: number
      member_count?: number
    }
    state.cachedUserCount = Math.max(
      0,
      state.cachedUserCount - (raw.memberCount ?? raw.member_count ?? 0)
    )
  }
})
