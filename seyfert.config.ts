import { config } from 'seyfert'
import 'dotenv/config'

const env = process.env as NodeJS.ProcessEnv & {
  token?: string
}

export default config.bot({
  token: env.token ?? '',
  locations: {
    base: './src',
    commands: 'commands',
    events: 'events',
    langs: 'languages'
  },
  intents: ['Guilds', 'GuildMessages', 'DirectMessages', 'GuildVoiceStates']
})
