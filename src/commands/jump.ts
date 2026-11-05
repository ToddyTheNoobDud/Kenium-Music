import type { Player } from 'aqualink'
import {
  Command,
  type CommandContext,
  createIntegerOption,
  createStringOption,
  Declare,
  Middlewares,
  Options
} from 'seyfert'
import { isExpiredInteraction } from '../shared/errorGuard.ts'
import {
  getQueueItems,
  getQueueSize,
  getTrackTitle
} from '../shared/nowPlaying.ts'
import { getContextLanguage } from '../utils/i18n.ts'
import { safeDefer } from '../utils/interactions.ts'

type QueueItemLike = {
  info?: {
    title?: string
  }
  title?: string
}

function createAutocompleteResults(
  queue: QueueItemLike[],
  focused: string,
  includePosition: true
): { name: string; value: number }[]
function createAutocompleteResults(
  queue: QueueItemLike[],
  focused: string,
  includePosition?: false
): { name: string; value: string }[]
function createAutocompleteResults(
  queue: QueueItemLike[],
  focused: string,
  includePosition = false
): { name: string; value: number | string }[] {
  if (!queue?.length) {
    return []
  }

  const results: { name: string; value: number | string }[] = []
  const focusedLower = focused.toLowerCase()
  const maxResults = 25

  for (let i = 0; i < queue.length && results.length < maxResults; i++) {
    const item = queue[i]
    const title = getTrackTitle(item)
    if (!title) {
      continue
    }
    const titleLower = title.toLowerCase()

    if (focused && !titleLower.includes(focusedLower)) {
      continue
    }

    if (includePosition) {
      const truncatedTitle =
        title.length > 94 ? `${title.slice(0, 91)}...` : title
      results.push({
        name: `${i + 1}. ${truncatedTitle}`,
        value: i + 1
      })
    } else {
      const truncatedTitle =
        title.length > 100 ? `${title.slice(0, 97)}...` : title
      results.push({
        name: truncatedTitle,
        value: title
      })
    }
  }

  return results
}

const options = {
  name: createStringOption({
    description: 'The song to jump to',
    required: false,
    autocomplete: async (interaction) => {
      try {
        const player = interaction.client.aqua.players.get(
          interaction.guildId || ''
        )
        const focused = interaction.getInput?.()?.toLowerCase() || ''
        const results = createAutocompleteResults(
          getQueueItems(player),
          focused,
          false
        )
        return interaction.respond(results)
      } catch {
        return interaction.respond([])
      }
    }
  }),
  position: createIntegerOption({
    description: 'The song number to jump to',
    required: false,
    autocomplete: async (interaction) => {
      try {
        const player = interaction.client.aqua.players.get(
          interaction.guildId || ''
        )
        const focused = interaction.getInput?.()?.toLowerCase() || ''
        const results = createAutocompleteResults(
          getQueueItems(player),
          focused,
          true
        )
        return interaction.respond(results)
      } catch {
        return interaction.respond([])
      }
    }
  })
}

@Middlewares(['checkPlayer', 'checkVoice'])
@Options(options)
@Declare({
  name: 'jump',
  description: 'Jump to a specific position or song in the queue'
})
export default class JumpCommand extends Command {
  public override async run(
    ctx: CommandContext<typeof options>
  ): Promise<void> {
    const lang = getContextLanguage(ctx)
    const t = ctx.t.get(lang)
    const player = ctx.client.aqua.players.get(ctx.guildId || '') as
      | Player
      | undefined

    if (getQueueSize(player) === 0) {
      await ctx.editOrReply({
        content: t.jump?.noSongsInQueue || 'No songs in queue',
        flags: 64
      })
      return
    }

    const { position, name } = ctx.options

    if (!player) {
      return
    }
    if (!(await safeDefer(ctx, true))) {
      return
    }
    try {
      if (position !== undefined) {
        return await this.handlePositionJump(ctx, player, position)
      }

      if (name) {
        return await this.handleNameJump(ctx, player, name)
      }

      await ctx.editOrReply({
        content:
          t.jump?.specifyPositionOrName ||
          'Please specify either a position number or song name',
        flags: 64
      })
    } catch (error: unknown) {
      if (isExpiredInteraction(error)) {
        return
      }

      console.error('Jump command error:', error)
      await ctx
        .editOrReply({
          content: 'An error occurred while jumping to the song',
          flags: 64
        })
        .catch(() => {})
    }
  }

  private async handlePositionJump(
    ctx: CommandContext,
    player: Player,
    position: number
  ): Promise<void> {
    const queueLength = getQueueSize(player)

    if (position < 1 || position > queueLength) {
      const errorMsg = `Position must be between 1 and ${queueLength}`

      await ctx.editOrReply({
        content: errorMsg,
        flags: 64
      })
      return
    }

    if (position === 1) {
      await ctx.editOrReply({
        content: 'Already at position 1',
        flags: 64
      })
      return
    }

    const itemsToRemove = position - 1
    for (let i = 0; i < itemsToRemove; i++) {
      player.queue.dequeue()
    }

    await player.stop()
    await player.play()

    const successMsg = `Jumped to song ${position}`

    await ctx.editOrReply({ content: successMsg, flags: 64 })
  }

  private async handleNameJump(
    ctx: CommandContext,
    player: Player,
    name: string
  ): Promise<void> {
    const songIndex = getQueueItems(player).findIndex(
      (song) => getTrackTitle(song) === name
    )

    if (songIndex === -1) {
      const errorMsg = `Couldn't find "${name}" in the queue`

      await ctx.editOrReply({
        content: errorMsg,
        flags: 64
      })
      return
    }

    if (getTrackTitle(player.current) === name) {
      const alreadyPlayingMsg = `"${name}" is already playing`

      await ctx.editOrReply({
        content: alreadyPlayingMsg,
        flags: 64
      })
      return
    }

    for (let i = 0; i < songIndex; i++) {
      player.queue.dequeue?.()
    }

    await player.stop()
    await player.play()

    const successMsg = `Jumped to song "${name}"`

    await ctx.editOrReply({ content: successMsg, flags: 64 })
  }
}
