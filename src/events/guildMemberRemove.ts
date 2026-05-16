import { createEvent } from 'seyfert'
import { state } from '../../index'

export default createEvent({
  data: { name: 'guildMemberRemove' },
  run: () => {
    state.cachedUserCount = Math.max(0, state.cachedUserCount - 1)
  }
})
