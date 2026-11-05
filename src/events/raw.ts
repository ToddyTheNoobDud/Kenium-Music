import type { VoicePacket } from 'aqualink'
import { createEvent } from 'seyfert'
import { requestTwentyFourSevenRecovery } from './voiceStateUpdate.ts'
export default createEvent({
  data: { name: 'raw' },
  async run(data, client) {
    if (data.t === 'GUILDS_READY') {
      requestTwentyFourSevenRecovery(client, 'gatewayReconnect')
    }
    if (data.t === 'VOICE_SERVER_UPDATE' || data.t === 'VOICE_STATE_UPDATE') {
      return client.aqua.updateVoiceState(data as VoicePacket)
    }
  }
})
