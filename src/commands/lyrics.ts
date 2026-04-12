import { Cooldown, CooldownType } from '@slipher/cooldown'
import {
  ActionRow,
  Button,
  Command,
  type CommandContext,
  createStringOption,
  Declare,
  Embed,
  Middlewares,
  Options
} from 'seyfert'
import type { OptionsRecord } from 'seyfert/lib/commands/applications/chat'
import { ButtonStyle, ComponentType } from 'seyfert/lib/types'
import {
  buildLyricsQueryFromHints,
  extractLyricsSearchHints,
  pickLyricsArtwork
} from '../shared/lyrics'
import { musixmatch } from '../shared/musixmatch'
import { getContextLanguage } from '../utils/i18n'
import { safeDefer } from '../utils/interactions'
import type { LyricsLine } from '../utils/musiclyrics'

const MAX_EMBED_LENGTH = 1800
const MAX_SYNC_LINES_PER_PAGE = 18
const EMBED_COLOR = 0x100e09
const COLLECTOR_TIMEOUT = 300_000

type LyricsTrackLike = {
  title?: string
  author?: string
  albumArt?: string
}

type LyricsTextLike = {
  common: {
    close: string
    previous: string
    next: string
    page: string
    unknown: string
  }
  lyrics: {
    error: string
    title: string
    noLyrics: string
    syncedLyrics: string
    textLyrics: string
    noActivePlayer: string
    noLyricsFound: string
    serviceUnavailable: string
  }
}

function createErrorEmbed(message: string, thele: LyricsTextLike) {
  return new Embed()
    .setColor(0xe74c3c)
    .setTitle(thele.lyrics.error)
    .setDescription(message)
}

function formatTimestamp(ms: number) {
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function normalizeLoose(value: string | undefined) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatSyncedLyrics(lines: LyricsLine[]) {
  return lines
    .map((line) => {
      const lyric = String(line.line || '')
        .replace(/\s+/g, ' ')
        .trim()
      if (!lyric) return null

      const stamp = line.range?.start
      const label =
        stamp !== undefined ? formatTimestamp(stamp).padStart(5, ' ') : '  -- '

      return `\`${label}\`  ${lyric}`
    })
    .filter((line): line is string => Boolean(line))
}

function formatTextLyrics(plainText: string) {
  const cleaned = plainText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!cleaned) return ''

  return cleaned
    .split('\n')
    .map((line) => (line ? `> ${line}` : ''))
    .join('\n')
}

function chunkTextContent(content: string, maxLength = MAX_EMBED_LENGTH) {
  if (!content.trim()) return ['']

  const chunks: string[] = []
  let current = ''

  const pushChunk = (value: string) => {
    const trimmed = value.trim()
    if (trimmed) chunks.push(trimmed)
  }

  for (const line of content.split('\n')) {
    const next = current ? `${current}\n${line}` : line
    if (next.length <= maxLength) {
      current = next
      continue
    }

    if (current) pushChunk(current)
    current = ''

    if (line.length <= maxLength) {
      current = line
      continue
    }

    for (let index = 0; index < line.length; index += maxLength) {
      pushChunk(line.slice(index, index + maxLength))
    }
  }

  if (current) pushChunk(current)
  return chunks.length ? chunks : ['']
}

function chunkSyncedContent(lines: string[]) {
  if (!lines.length) return ['']

  const chunks: string[] = []
  let currentLines: string[] = []

  for (const line of lines) {
    const nextLines = [...currentLines, line]
    const nextText = nextLines.join('\n')

    if (
      currentLines.length < MAX_SYNC_LINES_PER_PAGE &&
      nextText.length <= MAX_EMBED_LENGTH
    ) {
      currentLines = nextLines
      continue
    }

    if (currentLines.length) chunks.push(currentLines.join('\n'))
    currentLines = [line]
  }

  if (currentLines.length) chunks.push(currentLines.join('\n'))
  return chunks.length ? chunks : ['']
}

function createNavigationRow(
  currentPage: number,
  totalPages: number,
  thele: LyricsTextLike
) {
  const row = new ActionRow().addComponents(
    new Button()
      .setCustomId('ignore_lyrics_close')
      .setStyle(ButtonStyle.Danger)
      .setLabel(thele.common.close)
  )

  if (totalPages > 1) {
    row.components.unshift(
      new Button()
        .setCustomId('ignore_lyrics_prev')
        .setStyle(ButtonStyle.Primary)
        .setLabel(thele.common.previous)
        .setDisabled(currentPage === 0),
      new Button()
        .setCustomId('ignore_lyrics_page')
        .setLabel(`${currentPage + 1}/${totalPages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new Button()
        .setCustomId('ignore_lyrics_next')
        .setStyle(ButtonStyle.Primary)
        .setLabel(thele.common.next)
        .setDisabled(currentPage === totalPages - 1)
    )
  }

  return row
}

async function displayLyricsUI(
  ctx: CommandContext,
  data: {
    lines: LyricsLine[] | null
    lyrics: string
    title?: string
    artist?: string
    albumArt?: string
    source?: string
  },
  thele: LyricsTextLike
) {
  const chunks = data.lines
    ? chunkSyncedContent(formatSyncedLyrics(data.lines))
    : chunkTextContent(formatTextLyrics(data.lyrics))
  const totalPages = chunks.length
  let currentPage = 0

  const createEmbed = () => {
    const header = [data.artist, data.source].filter(Boolean).join(' • ')
    const embed = new Embed()
      .setColor(EMBED_COLOR)
      .setTitle(data.title || thele.lyrics.title)
      .setDescription(
        [
          header ? `*${header}*` : null,
          chunks[currentPage] || thele.lyrics.noLyrics
        ]
          .filter(Boolean)
          .join('\n\n')
      )
      .setFooter({
        text: [
          data.lines ? thele.lyrics.syncedLyrics : thele.lyrics.textLyrics,
          `${thele.common.page} ${currentPage + 1}/${totalPages}`
        ].join(' | ')
      })

    if (data.albumArt) embed.setThumbnail(data.albumArt)

    return embed
  }

  const response = await ctx.editOrReply(
    {
      embeds: [createEmbed()],
      components: [createNavigationRow(currentPage, totalPages, thele)]
    },
    true
  )

  if (!response) return

  const collector = response.createComponentCollector({
    componentType: ComponentType.Button,
    filter: (interaction) =>
      interaction.user.id === ctx.interaction.user.id &&
      (typeof interaction.isButton !== 'function' || interaction.isButton()),
    idle: COLLECTOR_TIMEOUT,
    onStop: async () => {
      await response.edit({ components: [] }).catch(() => null)
    }
  } as {
    componentType: ComponentType
    filter: (interaction: {
      user: { id: string }
      isButton?: () => boolean
    }) => boolean
    idle: number
    onStop: () => Promise<void>
  })

  collector.run('ignore_lyrics_prev', async (interaction) => {
    if (currentPage <= 0) return

    currentPage--
    await interaction.update({
      embeds: [createEmbed()],
      components: [createNavigationRow(currentPage, totalPages, thele)]
    })
  })

  collector.run('ignore_lyrics_next', async (interaction) => {
    if (currentPage >= totalPages - 1) return

    currentPage++
    await interaction.update({
      embeds: [createEmbed()],
      components: [createNavigationRow(currentPage, totalPages, thele)]
    })
  })

  collector.run('ignore_lyrics_close', async () => {
    collector.stop()
    await response.delete().catch(() => null)
  })
}

async function fetchMusixmatchLyrics(
  query: string | undefined,
  currentTrack: unknown
) {
  const hints = extractLyricsSearchHints(currentTrack as LyricsTrackLike)
  const searchQuery = query?.trim() || buildLyricsQueryFromHints(hints)

  if (!searchQuery) return null

  try {
    const result = await musixmatch.findLyrics(searchQuery, hints)
    if (!result?.text && !result?.lines) return null

    return {
      ...result,
      provider: result.source,
      hints,
      searchQuery
    }
  } catch (error) {
    console.error('Musixmatch error:', error)
    return null
  }
}

function shouldPreferMatchedTrackTitle(
  search: string | undefined,
  matchedTitle: string
) {
  return Boolean(search?.trim()) || normalizeLoose(matchedTitle).length > 0
}

const options = {
  search: createStringOption({
    description: 'Song title to search for',
    required: false
  })
}

@Cooldown({
  type: CooldownType.User,
  interval: 60_000,
  uses: { default: 2 }
})
@Options(options as unknown as OptionsRecord)
@Declare({
  name: 'lyrics',
  description: 'Get lyrics for the current song or search'
})
@Middlewares(['cooldown'])
export default class LyricsCommand extends Command {
  public override async run(ctx: CommandContext): Promise<void> {
    const lang = getContextLanguage(ctx)
    const thele = ctx.t.get(lang) as unknown as LyricsTextLike
    if (!(await safeDefer(ctx))) return

    const search = ((ctx.options as { search?: string }).search || '').trim()
    const player = ctx.guildId ? ctx.client.aqua.players.get(ctx.guildId) : null
    const currentTrack = (player?.current || null) as LyricsTrackLike | null

    if (!search && !currentTrack) {
      await ctx.editOrReply({
        embeds: [createErrorEmbed(thele.lyrics.noActivePlayer, thele)]
      })
      return
    }

    try {
      const lyricsResult = await fetchMusixmatchLyrics(search, currentTrack)

      if (!lyricsResult) {
        await ctx.editOrReply({
          embeds: [createErrorEmbed(thele.lyrics.noLyricsFound, thele)]
        })
        return
      }

      const displayTitle = shouldPreferMatchedTrackTitle(
        search,
        lyricsResult.track.title
      )
        ? lyricsResult.track.title || currentTrack?.title || thele.lyrics.title
        : currentTrack?.title || lyricsResult.track.title || thele.lyrics.title

      const albumArt =
        pickLyricsArtwork(search, lyricsResult.hints, {
          title: lyricsResult.track.title,
          author: lyricsResult.track.author,
          albumArt: lyricsResult.track.albumArt
        }) || ctx.client.me.avatarURL()

      await displayLyricsUI(
        ctx,
        {
          lyrics: lyricsResult.text || '',
          lines:
            Array.isArray(lyricsResult.lines) && lyricsResult.lines.length > 0
              ? lyricsResult.lines
              : null,
          title: displayTitle,
          artist:
            lyricsResult.track.author ||
            lyricsResult.hints?.artist ||
            thele.common.unknown,
          source: lyricsResult.provider || thele.common.unknown,
          albumArt
        },
        thele
      )
    } catch (error) {
      console.error('Lyrics command error:', error)
      await ctx.editOrReply({
        embeds: [createErrorEmbed(thele.lyrics.serviceUnavailable, thele)]
      })
    }
  }
}
