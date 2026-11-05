import { createEvent } from 'seyfert'
import { presenceState } from './botReady.ts'

export default createEvent({
  data: { name: 'guildCreate' },
  run: (guild) => {
    presenceState.cachedGuildCount++
    presenceState.cachedUserCount += guild.memberCount
  }
})
