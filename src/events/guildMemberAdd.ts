import { createEvent } from 'seyfert'
import { presenceState } from './botReady.ts'

export default createEvent({
  data: { name: 'guildMemberAdd' },
  run: () => {
    presenceState.cachedUserCount++
  }
})
