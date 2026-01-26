import { Cooldown, CooldownType } from '@slipher/cooldown'
import {
  Command,
  type CommandContext,
  Declare,
  Embed,
  Middlewares
} from 'seyfert'
import { getGuildSettings, updateGuildSettingsSync } from '../utils/db_helper'
import { getContextLanguage } from '../utils/i18n'

const toBool = (v: any) => v === true || v === 1 || v === '1' || v === 'true'
const NICKNAME_SUFFIX = ' [24/7]'

@Declare({ name: '247', description: 'Toggle 24/7 mode' })
@Cooldown({ type: CooldownType.User, interval: 60000, uses: { default: 2 } })
@Middlewares(['cooldown', 'checkVoice'])
export default class TwentyFourSevenCommand extends Command {
  public override async run(ctx: CommandContext): Promise<void> {
    try {
      const guildId = ctx.guildId!
      const lang = getContextLanguage(ctx)
      const t = ctx.t.get(lang)

      const settings = getGuildSettings(guildId)
      const newEnabled = !toBool(settings.twentyFourSevenEnabled)

      let voiceChannelId: string | null = null

      if (newEnabled) {
        const voiceState = await ctx.member.voice()
        voiceChannelId = voiceState?.channelId ?? null
        if (!voiceChannelId) {
          await ctx.write({
            content: 'You must be in a voice channel.',
            flags: 64
          })
          return
        }
      }

      await ctx.deferReply(true)

      // Only create/ensure player when enabling
      if (newEnabled) {
        const player = ctx.client.aqua.players.get(guildId)
        if (!player) {
          await ctx.client.aqua.createConnection({
            guildId,
            voiceChannel: voiceChannelId!,
            textChannel: ctx.channelId,
            deaf: true,
            defaultVolume: 65
          })
        }
      }

      // ONE write per toggle (sync upsert)
      updateGuildSettingsSync(guildId, {
        twentyFourSevenEnabled: newEnabled,
        voiceChannelId: newEnabled ? voiceChannelId : null,
        textChannelId: newEnabled ? ctx.channelId : null
      })

      // nickname update best-effort
      void (async () => {
        try {
          const botMember = await ctx.me()
          const baseNick = botMember.nick || botMember.user.username

          const targetNick = newEnabled
            ? baseNick.includes(NICKNAME_SUFFIX)
              ? baseNick
              : baseNick + NICKNAME_SUFFIX
            : baseNick.replace(/ ?\[24\/7\]/, '')

          if (botMember.nick !== targetNick)
            await botMember.edit({ nick: targetNick })
        } catch {}
      })()

      const embed = new Embed()
        .setTitle(t.mode247?.title || '24/7 Mode')
        .setDescription(
          newEnabled
            ? t.mode247?.enabled || '24/7 mode enabled'
            : t.mode247?.disabled || '24/7 mode disabled'
        )
        .setColor(newEnabled ? 0x00ff00 : 0xff0000)
        .setTimestamp()

      await ctx.editOrReply({ embeds: [embed], flags: 64 })
    } catch (err: any) {
      if (err?.code === 10062 || err?.code === 10015) return
      console.error('247 command error:', err)
    }
  }
}
