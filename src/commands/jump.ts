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
import type { OptionsRecord } from 'seyfert/lib/commands/applications/chat'
import { getContextLanguage } from '../utils/i18n'
import { getErrorCode } from '../utils/interactions'

type QueueItemLike = {
  info?: {
    title?: string
  }
}

type JumpTextLike = {
  jump?: {
    noSongsInQueue?: string
    specifyPositionOrName?: string
  }
  commands?: {
    jump?: {
      positionRange?: string
      alreadyAt?: string
      jumpedTo?: string
      songNotFound?: string
      alreadyPlaying?: string
      jumpedToSong?: string
    }
  }
}

type AutocompleteInteractionLike = {
  guildId?: string | null
  client: CommandContext['client']
  getInput?: () => string | undefined
  respond: (
    options: { name: string; value: number | string }[]
  ) => Promise<unknown> | unknown
}

type JumpPlayerLike = Player & {
  queue: QueueItemLike[] & {
    findIndex: (predicate: (song: QueueItemLike) => boolean) => number
    shift: () => QueueItemLike | undefined
  }
}

const createAutocompleteResults = (
  queue: QueueItemLike[],
  focused: string,
  includePosition = false
): { name: string; value: number | string }[] => {
  if (!queue?.length) return []

  const results: { name: string; value: number | string }[] = []
  const focusedLower = focused.toLowerCase()
  const maxResults = 25

  for (let i = 0; i < queue.length && results.length < maxResults; i++) {
    const item = queue[i]
    const title = item?.info?.title
    if (!title) continue
    const titleLower = title.toLowerCase()

    if (focused && !titleLower.includes(focusedLower)) continue

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

const getQueueItems = (player: { queue?: unknown } | null | undefined) => {
  const queue = player?.queue
  return Array.isArray(queue) ? (queue as QueueItemLike[]) : []
}

const options = {
  name: createStringOption({
    description: 'The song to jump to',
    required: false,
    autocomplete: async (interaction: AutocompleteInteractionLike) => {
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
    autocomplete: async (interaction: AutocompleteInteractionLike) => {
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
@Options(options as unknown as OptionsRecord)
@Declare({
  name: 'jump',
  description: 'Jump to a specific position or song in the queue'
})
export default class JumpCommand extends Command {
  public override async run(ctx: CommandContext): Promise<void> {
    const lang = getContextLanguage(ctx)
    const t = ctx.t.get(lang) as JumpTextLike
    const player = ctx.client.aqua.players.get(ctx.guildId || '') as
      | JumpPlayerLike
      | undefined

    if (!player?.queue?.length) {
      await ctx.editOrReply({
        content: t.jump?.noSongsInQueue || 'No songs in queue',
        flags: 64
      })
      return
    }

    const { position, name } = ctx.options as {
      position?: number
      name?: string
    }

    if (!player) return
    try {
      if (position !== undefined) {
        return await this.handlePositionJump(ctx, player, position, t)
      }

      if (name) {
        return await this.handleNameJump(ctx, player, name, t)
      }

      await ctx.editOrReply({
        content:
          t.jump?.specifyPositionOrName ||
          'Please specify either a position number or song name',
        flags: 64
      })
    } catch (error: unknown) {
      if (getErrorCode(error) === 10065) return

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
    player: JumpPlayerLike,
    position: number,
    t: JumpTextLike
  ): Promise<void> {
    const queueLength = player.queue.length

    if (position < 1 || position > queueLength) {
      const errorMsg =
        t.commands?.jump?.positionRange
          ?.replace('{min}', '1')
          ?.replace('{max}', queueLength.toString()) ||
        `Position must be between 1 and ${queueLength}`

      await ctx.editOrReply({
        content: errorMsg,
        flags: 64
      })
      return
    }

    if (position === 1) {
      await ctx.editOrReply({
        content:
          t.commands?.jump?.alreadyAt?.replace('{position}', '1') ||
          'Already at position 1',
        flags: 64
      })
      return
    }

    const itemsToRemove = position - 1
    for (let i = 0; i < itemsToRemove; i++) {
      player.queue.shift()
    }

    player.stop()

    const successMsg =
      t.commands?.jump?.jumpedTo?.replace('{position}', position.toString()) ||
      `Jumped to song ${position}`

    await ctx.editOrReply({ content: successMsg, flags: 64 })
  }

  private async handleNameJump(
    ctx: CommandContext,
    player: JumpPlayerLike,
    name: string,
    t: JumpTextLike
  ): Promise<void> {
    const songIndex = player.queue.findIndex(
      (song) => song.info?.title === name
    )

    if (songIndex === -1) {
      const errorMsg =
        t.commands?.jump?.songNotFound?.replace('{name}', name) ||
        `Couldn't find "${name}" in the queue`

      await ctx.editOrReply({
        content: errorMsg,
        flags: 64
      })
      return
    }

    if (songIndex === 0) {
      const alreadyPlayingMsg =
        t.commands?.jump?.alreadyPlaying?.replace('{name}', name) ||
        `"${name}" is already playing`

      await ctx.editOrReply({
        content: alreadyPlayingMsg,
        flags: 64
      })
      return
    }

    for (let i = 0; i < songIndex; i++) {
      player.queue.shift()
    }

    player.stop()

    const successMsg =
      t.commands?.jump?.jumpedToSong?.replace('{name}', name) ||
      `Jumped to song "${name}"`

    await ctx.editOrReply({ content: successMsg, flags: 64 })
  }
}
