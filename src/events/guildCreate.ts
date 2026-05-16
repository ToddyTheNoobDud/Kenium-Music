import { createEvent } from 'seyfert'
import { state } from '../../index'

export default createEvent({
  data: { name: 'guildCreate' },
  run: (guild) => {
    state.cachedGuildCount++
    const raw = guild as {
      memberCount?: number
      member_count?: number
    }
    state.cachedUserCount += raw.memberCount ?? raw.member_count ?? 0
  }
})
