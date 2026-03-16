import { Cooldown, CooldownType } from '@slipher/cooldown'
import {
  Command,
  type CommandContext,
  Declare,
  Embed,
  Middlewares
} from 'seyfert'
import { EMBED_COLOR } from '../shared/constants'
import { createPlayerConnection } from '../shared/player'
import { getGuildSettings, updateGuildSettingsSync } from '../utils/db_helper'
import { getContextLanguage } from '../utils/i18n'
import { safeDefer } from '../utils/interactions'

const toBool = (v: unknown) =>
  v === true || v === 1 || v === '1' || v === 'true'
const NICKNAME_SUFFIX = ' [24/7]'

@Declare({
  name: '247',
  description: 'Keep the bot connected and prevent the player from timing out.'
})
@Cooldown({ type: CooldownType.User, interval: 60000, uses: { default: 2 } })
@Middlewares(['cooldown', 'checkVoice'])
export default class TwentyFourSevenCommand extends Command {
  public override async run(ctx: CommandContext): Promise<void> {
    try {
      const guildId = ctx.guildId
      if (!guildId) return

      const lang = getContextLanguage(ctx)
      const t = ctx.t.get(lang)
      const settings = getGuildSettings(guildId)
      const newEnabled = !toBool(settings.twentyFourSevenEnabled)

      let voiceChannelId: string | null = null
      if (!(await safeDefer(ctx, true))) return

      if (newEnabled) {
        const voiceState = await ctx.member?.voice()
        voiceChannelId = voiceState?.channelId ?? null
        if (!voiceChannelId) {
          await ctx.editOrReply({
            content:
              t.player?.noVoiceChannel ||
              'You must be in a voice channel to use this command.',
            flags: 64
          })
          return
        }
      }

      if (newEnabled && voiceChannelId) {
        const player = ctx.client.aqua.players.get(guildId)
        if (!player) {
          createPlayerConnection(ctx.client, {
            guildId,
            voiceChannel: voiceChannelId,
            textChannel: ctx.channelId
          })
        }
      }

      updateGuildSettingsSync(guildId, {
        twentyFourSevenEnabled: newEnabled,
        voiceChannelId: newEnabled ? voiceChannelId : null,
        textChannelId: newEnabled ? ctx.channelId : null
      })

      void (async () => {
        try {
          const botMember = await ctx.me()
          if (!botMember) return
          const baseNick = botMember.nick || botMember.user?.username || 'Bot'

          const targetNick = newEnabled
            ? baseNick.includes(NICKNAME_SUFFIX)
              ? baseNick
              : baseNick + NICKNAME_SUFFIX
            : baseNick.replace(/ ?\[24\/7\]/, '')

          if (botMember.nick !== targetNick) {
            await botMember.edit({ nick: targetNick })
          }
        } catch {}
      })()

      const embed = new Embed()
        .setTitle(t.mode247?.title || '24/7 Mode')
        .setDescription(
          newEnabled
            ? t.mode247?.enabled ||
                '24/7 mode is enabled. I will stay in your voice channel and keep the player alive when idle.'
            : t.mode247?.disabled ||
                '24/7 mode is disabled. I can disconnect again after the idle timeout.'
        )
        .setColor(EMBED_COLOR)
        .setTimestamp()

      if (newEnabled && voiceChannelId) {
        embed.addFields({
          name: 'Connected Channel',
          value: `<#${voiceChannelId}>`,
          inline: true
        })
      }

      await ctx.editOrReply({ embeds: [embed], flags: 64 })
    } catch (err: unknown) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err.code === 10062 || err.code === 10015)
      )
        return
      console.error('247 command error:', err)
    }
  }
}
