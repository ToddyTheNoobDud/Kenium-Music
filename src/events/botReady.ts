import { createEvent } from 'seyfert'
import { updatePresence } from '../../index'
import { SimpleDB } from '../utils/simpleDB'

const db = new SimpleDB()
const settingsCollection = db.collection('guildSettings')

const NICKNAME_SUFFIX = ' [24/7]'
const BATCH_SIZE = 10
const BATCH_DELAY = 500
const UNKNOWN_VOICE_STATE_CODE = 10065
const STARTUP_DELAY = 6000

const VOICE_STATE_ROUTE_REGEX = /\/guilds\/(\d{17,20})\/voice-states/i

let clientInstance: any = null


const isUnknownVoiceStateError = (err: any): boolean => {
  if (!err) return false

  if (err.code === UNKNOWN_VOICE_STATE_CODE) return true

  const errStr = String(err.message ?? err ?? '')

  return errStr.includes('Unknown Voice State 10065') ||
         (errStr.includes('/voice-states/') && (errStr.includes('404') || errStr.includes('Unknown')))
}


const extractGuildIdFromError = (err: any): string | null => {
  const candidates = [
    err?.path,
    err?.route,
    err?.request?.path,
    err?.stack,
    err?.message,
    String(err)
  ]

  for (const candidate of candidates) {
    if (!candidate) continue

    const match = VOICE_STATE_ROUTE_REGEX.exec(String(candidate))
    if (match?.[1]) return match[1]
  }

  return null
}


const cleanup247ForGuild = async (guildId: string): Promise<void> => {
  try {
    const docs = settingsCollection.find({ guildId })
    if (!docs?.length) return

    settingsCollection.delete({ guildId })

    const player = clientInstance?.aqua?.players?.get(guildId)
    if (player?.destroy) {
      player.destroy()
    }

    clientInstance?.logger?.info(`[24/7] Removed settings for guild ${guildId} due to Unknown Voice State`)
  } catch (err) {
    clientInstance?.logger?.error('[24/7] Cleanup failed:', err)
  }
}

const processGuild = async (client: any, settings: any): Promise<void> => {
  const { guildId, voiceChannelId, textChannelId, _id } = settings

  if (!voiceChannelId || !textChannelId) {
    settingsCollection.delete({ _id })
    return
  }

  try {
    const guild = await client.guilds.fetch(guildId).catch(() => null)
    if (!guild) {
      settingsCollection.delete({ _id })
      return
    }

    const [voiceChannel, textChannel] = await Promise.all([
      guild.channels.fetch(voiceChannelId).catch(() => null),
      guild.channels.fetch(textChannelId).catch(() => null)
    ])


    if (!voiceChannel || voiceChannel.type !== 2) {
      settingsCollection.delete({ _id })
      return
    }

    if (!textChannel || (textChannel.type !== 0 && textChannel.type !== 5)) {
      settingsCollection.delete({ _id })
      return
    }

    await Promise.all([
      client.aqua.createConnection({
        guildId,
        voiceChannel: voiceChannelId,
        textChannel: textChannelId,
        deaf: true,
        defaultVolume: 65
      }),
      updateNickname(guild)
    ])
  } catch (error: any) {
    if (isUnknownVoiceStateError(error)) {
      await cleanup247ForGuild(guildId)
    }
  }
}

const processAutoJoin = async (client: any): Promise<void> => {
  const guildsWithTwentyFourSeven = settingsCollection.find({
    twentyFourSevenEnabled: true
  })

  if (!guildsWithTwentyFourSeven?.length) return

  const totalGuilds = guildsWithTwentyFourSeven.length

  for (let i = 0; i < totalGuilds; i += BATCH_SIZE) {
    const batch = guildsWithTwentyFourSeven.slice(i, i + BATCH_SIZE)

    await Promise.allSettled(
      batch.map(settings => processGuild(client, settings))
    )

    if (i + BATCH_SIZE < totalGuilds) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY))
    }
  }
}

const updateNickname = async (guild: any): Promise<void> => {
  const botMember = guild.members?.me
  if (!botMember) return

  const currentNick = botMember.nickname || botMember.user?.username || ''

  if (currentNick.includes(NICKNAME_SUFFIX)) return

  try {
    await botMember.edit({ nick: currentNick + NICKNAME_SUFFIX })
  } catch (err) {
  }
}

let errorHandlerRegistered = false

const setupGlobalErrorHandler = (client: any): void => {
  if (errorHandlerRegistered) return

  errorHandlerRegistered = true

  process.on('unhandledRejection', async (reason: any) => {
    if (!isUnknownVoiceStateError(reason)) return

    const guildId = extractGuildIdFromError(reason)
    if (guildId) {
      await cleanup247ForGuild(guildId)
    }
  })
}

export default createEvent({
  data: { once: true, name: 'botReady' },
  run: (user, client) => {
    clientInstance = client

    if (!client.botId) {
      client.botId = user.id
    }

    client.aqua.init(client.botId)
    updatePresence(client as any)
    setupGlobalErrorHandler(client)

    client.logger.info(`${user.username} is ready`)

    setTimeout(() => processAutoJoin(client), STARTUP_DELAY)
  }
})