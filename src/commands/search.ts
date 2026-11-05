import {
  type ButtonInteraction,
  Command,
  type CommandContext,
  Container,
  createStringOption,
  Declare,
  type Message,
  Middlewares,
  Options,
  type WebhookMessage
} from 'seyfert'
import { MUSIC_PLATFORMS } from '../shared/emojis.ts'
import { isExpiredInteraction } from '../shared/errorGuard.ts'
import type { PlayerLike, TrackLike } from '../shared/helperTypes.ts'
import {
  enqueueTrack,
  ensurePlayerForVoice,
  getQueueCapacity,
  getQueueLoadState,
  maybeStartPlayback
} from '../shared/playback.ts'
import { formatDuration, truncate } from '../shared/utils.ts'
import { authorizeVoiceControl } from '../shared/voiceAuthorization.ts'
import type { Translations } from '../utils/i18n.ts'
import { getContextLanguage } from '../utils/i18n.ts'
import { getMemberVoiceState, safeDefer } from '../utils/interactions.ts'

const CONFIG = Object.freeze({
  INTERACTION_TIMEOUT: 45000,
  MAX_RESULTS: 5,
  BUTTON_STYLE_SELECTION: 2,
  MAX_QUERY_LENGTH: 100,
  MIN_QUERY_LENGTH: 2
})

const REGEX_PATTERNS = Object.freeze({
  CUSTOM_EMOJI: /^<:([a-zA-Z0-9_]+):(\d+)>$/,
  CLEAN_QUERY: /[^\w\s-]/g,
  WHITESPACE: /\s+/g
})

const UI_LIMITS = Object.freeze({
  TITLE: 46,
  AUTHOR: 28
})

const parseEmoji = (emoji: string): { name: string; id?: string } | null => {
  const match = REGEX_PATTERNS.CUSTOM_EMOJI.exec(emoji)
  return match
    ? { name: match[1] as string, id: match[2] as string }
    : { name: emoji }
}

const sanitizeQuery = (query: string): string => {
  return query
    .replace(REGEX_PATTERNS.CLEAN_QUERY, '')
    .replace(REGEX_PATTERNS.WHITESPACE, ' ')
    .trim()
    .slice(0, CONFIG.MAX_QUERY_LENGTH)
}

type MusicPlatform = (typeof MUSIC_PLATFORMS)[keyof typeof MUSIC_PLATFORMS]

type SearchTrackLike = TrackLike & {
  platform?: {
    emoji?: string
  } | null
}

type TextDisplayComponent = { type: 10; content: string }
type DividerComponent = { type: 14; divider: true; spacing: 1 | 2 }
type ButtonComponent = {
  type: 2
  custom_id: string
  label: string
  emoji?: { name: string; id?: string }
  style: number
  disabled?: boolean
}
type ActionRowComponent = { type: 1; components: ButtonComponent[] }
type SectionComponent = {
  type: 9
  components: TextDisplayComponent[]
  accessory: ButtonComponent
}

const options = {
  query: createStringOption({
    description: 'The song you want to search for',
    required: true
  }),
  platform: createStringOption({
    description: 'Choose which platform to search first',
    required: false,
    choices: [
      { name: 'YouTube', value: 'youtube' },
      { name: 'SoundCloud', value: 'soundcloud' },
      { name: 'Spotify', value: 'spotify' },
      { name: 'Deezer', value: 'deezer' }
    ]
  })
}

@Options(options)
@Middlewares(['checkVoice'])
@Declare({
  name: 'search',
  description: 'Search for a song on music platforms'
})
export default class SearchCommand extends Command {
  public override async run(
    ctx: CommandContext<typeof options>
  ): Promise<void> {
    const lang = getContextLanguage(ctx)
    const thele = ctx.t.get(lang)
    const { query, platform = 'youtube' } = ctx.options

    // Validate and sanitize query
    const cleanQuery = sanitizeQuery(query)
    if (cleanQuery.length < CONFIG.MIN_QUERY_LENGTH) {
      await ctx.editOrReply({ content: thele.search.invalidQuery, flags: 64 })
      return
    }

    try {
      if (!(await safeDefer(ctx, true))) {
        return
      }
      const player = await this.getOrCreatePlayer(ctx, thele)
      if (!player) {
        return
      }

      // Get the selected platform or default to YouTube
      const platformKey = platform as keyof typeof MUSIC_PLATFORMS
      const selectedPlatform =
        MUSIC_PLATFORMS[platformKey] || MUSIC_PLATFORMS.youtube

      const tracks = await this.searchTracks(
        ctx,
        cleanQuery,
        selectedPlatform.source
      )

      if (!tracks.length) {
        await ctx.editOrReply({ content: thele.search.noResults, flags: 64 })
        return
      }

      const searchContainer = this.createSearchContainer(
        cleanQuery,
        tracks,
        selectedPlatform,
        thele
      )
      const message = await ctx.editResponse({
        components: [searchContainer],
        flags: 32768 | 64
      })

      this.setupInteractionHandler(message, ctx, cleanQuery, tracks, thele)
    } catch (error: unknown) {
      console.error('Search command error:', error)
      if (isExpiredInteraction(error)) {
        return
      }
      await ctx.editOrReply({ content: thele.search.genericError, flags: 64 })
    }
  }

  private async getOrCreatePlayer(
    ctx: CommandContext,
    thele: Translations
  ): Promise<PlayerLike | null> {
    try {
      const player = await ensurePlayerForVoice(ctx, ctx.channelId)
      if (!player) {
        await ctx.editOrReply({
          content: thele.search.noVoiceChannel,
          flags: 64
        })
        return null
      }
      return player
    } catch (error) {
      console.error('Failed to create player:', error)
      await ctx.editOrReply({
        content: thele.search.failedToJoinVoice,
        flags: 64
      })
      return null
    }
  }

  private async searchTracks(
    ctx: CommandContext,
    query: string,
    source: string
  ): Promise<SearchTrackLike[]> {
    try {
      const result = await ctx.client.aqua.resolve({
        query,
        source,
        requester: ctx.interaction.user
      })
      return Array.isArray(result.tracks)
        ? (result.tracks.slice(0, CONFIG.MAX_RESULTS) as SearchTrackLike[])
        : []
    } catch (error: unknown) {
      console.error(`Search tracks error for ${source}:`, error)
      return []
    }
  }

  private createTrackLine(
    track: SearchTrackLike,
    index: number,
    platform: MusicPlatform,
    thele: Translations
  ): string {
    const emoji = track.platform?.emoji || platform.emoji
    const titleValue = String(track.info?.title || track.title || 'Unknown')
    const title = truncate(titleValue, UI_LIMITS.TITLE)
    const author = truncate(
      String(
        track.info?.author || track.author || thele.common?.unknown || 'Unknown'
      ),
      UI_LIMITS.AUTHOR
    )
    const uri = String(track.info?.uri || track.uri || '#')
    const length = Number(track.info?.length || track.length || 0)
    const authorLabel = String(thele.player?.author || 'Author')

    return [
      `**${index + 1}** ${emoji} [\`${title}\`](${uri})`,
      `-# ${formatDuration(length)} | ${authorLabel}: ${author}`
    ].join('\n')
  }

  private createTrackSection(
    track: SearchTrackLike,
    index: number,
    platform: MusicPlatform,
    thele: Translations
  ): SectionComponent {
    return {
      type: 9,
      components: [
        {
          type: 10,
          content: this.createTrackLine(track, index, platform, thele)
        }
      ],
      accessory: {
        type: 2,
        custom_id: `ignore_select_${index}`,
        label: index === 0 ? 'Play First' : 'Play',
        style: index === 0 ? 1 : CONFIG.BUTTON_STYLE_SELECTION
      }
    }
  }

  private createSearchContainer(
    query: string,
    tracks: SearchTrackLike[],
    platform: MusicPlatform,
    thele: Translations
  ): Container {
    const components: Array<
      | TextDisplayComponent
      | DividerComponent
      | ActionRowComponent
      | SectionComponent
    > = [
      {
        type: 10,
        content: `-# Query | \`${query}\` | audition one lane at a time`
      },
      { type: 1, components: this.createPlatformButtons(platform) },
      { type: 14, divider: true, spacing: 2 },
      ...tracks.flatMap((track, index) => {
        const rows: Array<SectionComponent | DividerComponent> = [
          this.createTrackSection(track, index, platform, thele)
        ]
        if (index < tracks.length - 1) {
          rows.push({ type: 14, divider: true, spacing: 1 })
        }
        return rows
      })
    ]

    return new Container({
      components,
      accent_color: platform.color
    })
  }

  private createPlatformButtons(
    currentPlatform: MusicPlatform
  ): ButtonComponent[] {
    return Object.entries(MUSIC_PLATFORMS).map(([key, platform]) => {
      const emoji = parseEmoji(platform.emoji) || parseEmoji(platform.icon)
      const isActive = platform.name === currentPlatform.name

      return {
        type: 2,
        custom_id: `ignore_platform_${key.toLowerCase()}`,
        label: platform.name,
        ...(emoji && { emoji }),
        style: isActive ? 4 : platform.style,
        disabled: isActive
      }
    })
  }

  private setupInteractionHandler(
    message: Message | WebhookMessage,
    ctx: CommandContext,
    query: string,
    tracks: SearchTrackLike[],
    thele: Translations
  ): void {
    const collector = message.createComponentCollector({
      filter: (i) => i.user.id === ctx.interaction.user.id,
      idle: CONFIG.INTERACTION_TIMEOUT,
      onStop: () => {
        message.delete().catch(() => {
          message.edit({ components: [] }).catch(() => {})
        })
      }
    })

    // Handle track selection
    for (let i = 0; i < Math.min(tracks.length, CONFIG.MAX_RESULTS); i++) {
      collector.run(
        `ignore_select_${i}`,
        async (interaction: ButtonInteraction) => {
          try {
            await interaction.deferUpdate()
            await this.handleTrackSelection(interaction, ctx, tracks, thele)
          } catch (error) {
            console.error('Track selection error:', error)
          }
        }
      )
    }

    // Handle platform switching
    Object.keys(MUSIC_PLATFORMS).forEach((key) => {
      collector.run(
        `ignore_platform_${key.toLowerCase()}`,
        async (interaction: ButtonInteraction) => {
          try {
            await interaction.deferUpdate()
            await this.handlePlatformSwitch(
              interaction,
              ctx,
              query,
              tracks,
              thele
            )
          } catch (error) {
            console.error('Platform switch error:', error)
          }
        }
      )
    })
  }

  private async handleTrackSelection(
    i: ButtonInteraction,
    ctx: CommandContext,
    tracks: SearchTrackLike[],
    thele: Translations
  ): Promise<void> {
    const guildId = i.guildId ?? ctx.guildId
    const player = guildId
      ? (ctx.client.aqua.players.get(guildId) as PlayerLike | undefined)
      : undefined
    const memberVoice = await getMemberVoiceState(i)
    const authorization = authorizeVoiceControl({
      guildId,
      memberChannelId: memberVoice?.channelId ?? null,
      playerChannelId: player?.voiceChannel ?? null,
      hasPlayer: Boolean(player),
      requirePlayer: true,
      playerDestroyed: player?.destroyed === true
    })
    if (!authorization.ok || !player) {
      await i.followup({
        content: 'You must be in the same voice channel as the active player.',
        flags: 64
      })
      return
    }
    const trackIndex = parseInt(i.customId.split('_')[2] || '-1', 10)
    const track = tracks[trackIndex]

    if (track) {
      if (!getQueueCapacity(player)) {
        await i.followup({
          content: 'The queue limit is 1,000 tracks.',
          flags: 64
        })
        return
      }
      const state = getQueueLoadState(player)
      const result = await ctx.client.aqua.resolve({
        query: track.info?.uri || track.uri || '',
        requester: i.user
      })
      const freshTrack = result.tracks?.[0]
      if (!freshTrack || !enqueueTrack(player, freshTrack, state)) {
        await i.followup({
          content: state.cancelled
            ? 'Playback loading was cancelled.'
            : 'The track could not be added; the queue limit is 1,000 tracks.',
          flags: 64
        })
        return
      }
      const titleValue = String(track.info?.title || track.title || 'Unknown')
      await i.followup({
        content: `${thele.search.trackAdded}: **${titleValue.slice(0, 30)}${titleValue.length > 30 ? '...' : ''}**`,
        flags: 64
      })

      await maybeStartPlayback(player)
    }
  }

  private async handlePlatformSwitch(
    i: ButtonInteraction,
    ctx: CommandContext,
    query: string,
    tracks: SearchTrackLike[],
    thele: Translations
  ): Promise<void> {
    const platformKey = i.customId.split('_')[2] as keyof typeof MUSIC_PLATFORMS
    const newPlatform = MUSIC_PLATFORMS[platformKey]
    if (!newPlatform) {
      return
    }

    try {
      const newTracks = await this.searchTracks(
        ctx,
        query,
        String(newPlatform.source || '')
      )

      if (newTracks.length) {
        tracks.length = 0
        tracks.push(...newTracks)

        const searchContainer = this.createSearchContainer(
          query,
          newTracks,
          newPlatform,
          thele
        )
        await i.editOrReply({ components: [searchContainer], flags: 32768 })
      } else {
        await i.followup({ content: thele.search.noResults, flags: 64 })
      }
    } catch (error) {
      console.error(`Platform switch error:`, error)
      await i.followup({ content: thele.search.searchError, flags: 64 })
    }
  }
}
