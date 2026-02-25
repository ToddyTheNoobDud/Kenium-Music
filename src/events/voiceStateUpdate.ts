import { createEvent } from 'seyfert'
import { getChannelIds, isTwentyFourSevenEnabled } from '../utils/db_helper'

const REJOIN_DELAY = 3000

function getBotId(client: any) {
  return client.me?.id || client.user?.id || client.bot?.id
}

function getChannelPair(
  guildId: string,
  voiceId?: string | null,
  textId?: string | null
) {
  if (voiceId && textId) return [voiceId, textId] as const
  const ids = getChannelIds(guildId)
  return ids?.voiceChannelId && ids?.textChannelId
    ? ([ids.voiceChannelId, ids.textChannelId] as const)
    : null
}

async function fetchGuild(
  cache: any,
  client: any,
  guildId: string
): Promise<any> {
  let guild = cache.get(guildId)
  if (guild) return guild

  guild = client.cache?.guilds?.get?.(guildId)
  if (guild) {
    cache.set(guildId, guild)
    return guild
  }

  try {
    guild = await client.guilds?.fetch?.(guildId)
    if (guild) cache.set(guildId, guild)
    return guild ?? null
  } catch {
    return null
  }
}

async function getVoiceChannel(guild: any, channelId: string): Promise<any> {
  let ch = guild.channels?.get?.(channelId)
  if (ch) return ch.type === 2 ? ch : null
  try {
    ch = await guild.channels?.fetch?.(channelId)
    return ch?.type === 2 ? ch : null
  } catch {
    return null
  }
}

function getBotVoiceChannelId(guild: any, botId: string): string | null {
  return (
    guild?.members?.me?.voice?.channelId ||
    guild?.members?.get?.(botId)?.voice?.channelId ||
    guild?.voiceStates?.get?.(botId)?.channelId ||
    null
  )
}

class VoiceManager {
  timeouts = new Map<string, any>()
  guildCache = new Map<string, any>()
  client: any = null

  setTimeout(key: string, fn: () => void, delay: number) {
    const existing = this.timeouts.get(key)
    if (existing) clearTimeout(existing)
    this.timeouts.set(
      key,
      setTimeout(() => {
        this.timeouts.delete(key)
        fn()
      }, delay)
    )
  }

  async rejoinChannel(
    client: any,
    guildId: string,
    voiceId?: string,
    textId?: string
  ): Promise<boolean> {
    const aqua = client?.aqua
    if (
      !aqua?.initiated ||
      !Array.isArray(aqua?.leastUsedNodes) ||
      aqua.leastUsedNodes.length === 0
    ) {
      client.logger.debug(
        `[24/7] Rejoin skipped for ${guildId}: Aqua has no connected nodes.`
      )
      return false
    }

    const pair = getChannelPair(guildId, voiceId, textId)
    if (!pair) return false

    const guild = await fetchGuild(this.guildCache, client, guildId)
    if (!guild) return false

    const botId = getBotId(client)
    if (botId) {
      const botVc = getBotVoiceChannelId(guild, botId)
      if (botVc === pair[0]) {
        client.logger.debug(`[24/7] Bot already in voice for ${guildId}`)
        return true
      }
    }

    const voiceChannel = await getVoiceChannel(guild, pair[0])
    if (!voiceChannel) {
      client.logger.warn(
        `[24/7] Voice channel ${pair[0]} not found for ${guildId}`
      )
      return false
    }

    try {
      await client.aqua.createConnection({
        guildId,
        voiceChannel: pair[0],
        textChannel: pair[1],
        deaf: true,
        defaultVolume: 65
      })
      return true
    } catch (err: any) {
      client.logger.debug(
        `[24/7] Rejoin failed for ${guildId}: ${err?.message || err}`
      )
      return false
    }
  }
}

const manager = new VoiceManager()

export const handleSocketClosed = (
  guildId: string,
  code: number,
  client: any
) => {
  if (!isTwentyFourSevenEnabled(guildId)) return
  const aqua = client?.aqua
  if (
    !aqua?.initiated ||
    !Array.isArray(aqua?.leastUsedNodes) ||
    aqua.leastUsedNodes.length === 0
  ) {
    client.logger.debug(
      `[24/7] Socket closed ${guildId}, code: ${code}. Skipping rejoin: no available nodes.`
    )
    return
  }

  client.logger.debug(`[24/7] Socket closed ${guildId}, code: ${code}`)

  const player = client.aqua?.players?.get?.(guildId)
  manager.setTimeout(
    `rejoin_${guildId}`,
    () => {
      manager.rejoinChannel(
        client,
        guildId,
        player?.voiceChannel,
        player?.textChannel
      )
    },
    REJOIN_DELAY
  )
}

export default createEvent({
  data: { name: 'voiceStateUpdate', once: false },
  run: async ([newState, oldState], client) => {
    if (!client.aqua?.players) return

    const guildId = newState?.guildId ?? oldState?.guildId
    if (!guildId) return
    if (oldState?.channelId === newState?.channelId) return
    if (!isTwentyFourSevenEnabled(guildId)) return
    const botId = getBotId(client)
    const userId = newState?.userId ?? oldState?.userId

    if (
      botId &&
      userId === botId &&
      oldState?.channelId &&
      !newState?.channelId
    ) {
      const player = client.aqua?.players?.get?.(guildId)
      manager.setTimeout(
        `rejoin_${guildId}`,
        () => {
          manager.rejoinChannel(
            client,
            guildId,
            player?.voiceChannel ?? oldState.channelId ?? undefined,
            player?.textChannel
          )
        },
        REJOIN_DELAY
      )
    }
  }
})
