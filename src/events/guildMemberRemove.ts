import { createEvent } from 'seyfert'
import { presenceState } from './botReady.ts'

export default createEvent({
  data: { name: 'guildMemberRemove' },
  run: () => {
    presenceState.cachedUserCount = Math.max(
      0,
      presenceState.cachedUserCount - 1
    )
  }
})
