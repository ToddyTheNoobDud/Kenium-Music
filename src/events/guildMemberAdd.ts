import { createEvent } from 'seyfert'
import { state } from '../../index'

export default createEvent({
  data: { name: 'guildMemberAdd' },
  run: () => {
    state.cachedUserCount++
  }
})
