import type { Player } from 'aqualink'
import {
  Command,
  type CommandContext,
  createStringOption,
  Declare,
  Embed,
  Middlewares,
  Options
} from 'seyfert'
import { getContextLanguage } from '../utils/i18n'

@Options({
  loop: createStringOption({
    description: 'select your loop mode',
    required: true,
    choices: [
      { name: 'none', value: 'none' },
      { name: 'song', value: 'track' },
      { name: 'queue', value: 'queue' }
    ]
  }) as any
})
@Middlewares(['checkVoice', 'checkPlayer'])
@Declare({
  name: 'loop',
  description: 'Want some loop bro?'
})
export default class LoopCommand extends Command {
  public override async run(ctx: CommandContext): Promise<void> {
    try {
      const { client } = ctx
      const lang = getContextLanguage(ctx)
      const t = ctx.t.get(lang)
      const { loop } = ctx.options as { loop: string }

      const player = client.aqua.players.get(ctx.guildId || '') as (Player & {
        setLoop(v: number): void
      }) | undefined
      if (!player) return
      const loopMap: Record<string, number> = { none: 0, track: 1, queue: 2 }
      const loopValue = loopMap[loop] ?? 0
      player.setLoop(loopValue)

      const status =
        loopValue === 0
          ? t.common?.disabled || 'disabled'
          : t.common?.enabled || 'enabled'

      let description: string
      if (player?.loop === 0) {
        description = t?.player?.loopDisabled || `Looping has been ${status}.`
      } else {
        description =
          t?.player?.loopEnabled?.replace('{mode}', loop) ||
          `Current song loop has been ${status}.`
      }

      await ctx.editOrReply({
        embeds: [new Embed().setColor(0x100e09).setDescription(description)],
        flags: 64
      })
    } catch (error: unknown) {
      if ((error as any)?.code === 10065) return
    }
  }
}
