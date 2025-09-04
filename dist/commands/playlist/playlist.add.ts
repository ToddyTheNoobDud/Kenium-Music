import { type CommandContext, Declare, SubCommand, Options, createStringOption } from 'seyfert'
import { ButtonStyle } from 'seyfert/lib/types'
import { SimpleDB } from '../../utils/simpleDB'
import { createEmbed, createButtons, formatDuration, determineSource, extractYouTubeId, handlePlaylistAutocomplete, handleTrackAutocomplete } from '../../shared/utils'
import { ICONS, LIMITS } from '../../shared/constants'

const db = new SimpleDB()
const playlistsCollection = db.collection('playlists')

const TRACK_SEPARATOR_RE = /[,;\n]+/
const YOUTUBE_PLAYLIST_RE = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/).*?[?&]list=([A-Za-z0-9_-]+)/i
const SPOTIFY_TRACK_RE = /open\.spotify\.com\/track\/([A-Za-z0-9]+)/i
const CONCURRENCY = 3

export const _functions = {
  splitInput: (input: string): string[] => input.split(TRACK_SEPARATOR_RE).map(s => s.trim()).filter(Boolean),
  canonicalizeUri: (uri: string): string => {
    const ytId = extractYouTubeId(uri)
    if (ytId) return `youtube:${ytId}`
    const s = uri.match(SPOTIFY_TRACK_RE)
    if (s) return `spotify:${s[1]}`
    try {
      const u = new URL(uri)
      u.search = ''
      return u.toString()
    } catch {
      return uri
    }
  },
  normalizeLoadType: (t: unknown): string => String(t || '').toUpperCase(),
  mapPool: async <T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>, shouldStop?: () => boolean) => {
    const l = Math.max(1, limit)
    let i = 0
    const next = async () => {
      for (;;) {
        if (shouldStop && shouldStop()) return
        const idx = i++
        if (idx >= items.length) return
        await fn(items[idx], idx)
      }
    }
    const runners = Array.from({ length: Math.min(l, items.length) }, next)
    await Promise.all(runners)
  }
}

@Declare({
  name: 'add',
  description: '➕ Add tracks to playlist'
})
@Options({
  playlist: createStringOption({
    description: 'Playlist name',
    required: true,
    autocomplete: async (interaction: any) => handlePlaylistAutocomplete(interaction, playlistsCollection)
  }),
  tracks: createStringOption({
    description: 'Tracks to add (URL, title, multiple separated by commas, or a playlist link)',
    required: true,
    autocomplete: async (interaction: any) => handleTrackAutocomplete(interaction)
  })
})
export class AddCommand extends SubCommand {
  async run(ctx: CommandContext) {
    const { playlist: playlistName, tracks: rawQuery } = ctx.options as { playlist: string; tracks: string }
    const userId = ctx.author.id

    const playlistDb = playlistsCollection.findOne({ userId, name: playlistName })
    if (!playlistDb) {
      return ctx.write({
        embeds: [createEmbed('error', 'Playlist Not Found', `No playlist named "${playlistName}" exists!`)],
        flags: 64
      })
    }

    const availableSlots = Math.max(0, LIMITS.MAX_TRACKS - playlistDb.tracks.length)
    if (availableSlots === 0) {
      return ctx.write({
        embeds: [createEmbed('warning', 'Playlist Full', `This playlist has reached the ${LIMITS.MAX_TRACKS}-track limit!`)],
        flags: 64
      })
    }

    await ctx.deferReply(true)

    const timestamp = new Date().toISOString()
    const existingCanonical = new Set<string>()
    for (const t of playlistDb.tracks) existingCanonical.add(_functions.canonicalizeUri(t.uri))

    const tokens = _functions.splitInput(rawQuery)
    const isSingleYouTubePlaylist = tokens.length === 1 && YOUTUBE_PLAYLIST_RE.test(tokens[0])

    const toAdd: Array<{ title: string; uri: string; author: string; duration: number; addedAt: string; addedBy: string; source: string }> = []

    const pushTrack = (track: any) => {
      const uri = track?.info?.uri
      if (!uri || toAdd.length >= availableSlots) return
      const canonical = _functions.canonicalizeUri(uri)
      if (existingCanonical.has(canonical)) return
      toAdd.push({
        title: track.info.title || 'Unknown',
        uri,
        author: track.info.author || 'Unknown',
        duration: track.info.length || 0,
        addedAt: timestamp,
        addedBy: userId,
        source: determineSource(uri)
      })
      existingCanonical.add(canonical)
    }

    const resolveOne = async (query: string) => {
      const res = await ctx.client.aqua.resolve({ query, requester: ctx.author })
      if (!res) return
      const type = _functions.normalizeLoadType((res as any).loadType)
      if (type === 'LOAD_FAILED' || type === 'NO_MATCHES') return
      const tracks = Array.isArray((res as any).tracks) ? (res as any).tracks : []
      if (tracks.length === 0) return
      const isPlaylist = type.includes('PLAYLIST') || !!(res as any).playlistInfo
      if (isPlaylist) {
        for (const tr of tracks) {
          if (toAdd.length >= availableSlots) break
          pushTrack(tr)
        }
      } else {
        pushTrack(tracks[0])
      }
    }

    try {
      if (isSingleYouTubePlaylist) {
        await resolveOne(tokens[0])
      } else {
        const uniqueTokens = Array.from(new Set(tokens))
        const limit = Math.min(CONCURRENCY, availableSlots || 1)
        await _functions.mapPool(
          uniqueTokens,
          limit,
          async token => {
            if (toAdd.length >= availableSlots) return
            await resolveOne(token)
          },
          () => toAdd.length >= availableSlots
        )
      }

      if (toAdd.length === 0) {
        return ctx.editOrReply({
          embeds: [createEmbed('warning', 'Nothing Added', 'No new tracks were added. They may already exist in the playlist or no matches were found.')]
        })
      }

      if (toAdd.length > availableSlots) toAdd.length = availableSlots

      for (const t of toAdd) {
        playlistDb.tracks.push(t)
      }
      playlistDb.lastModified = timestamp

      const addedDuration = toAdd.reduce((s, t) => s + (t.duration || 0), 0)
      playlistDb.totalDuration = (playlistDb.totalDuration || 0) + addedDuration

      playlistsCollection.update({ _id: playlistDb._id }, playlistDb)

      const primary = toAdd[0]
      const embed = createEmbed(
        'success',
        toAdd.length > 1 ? 'Tracks Added' : 'Track Added',
        undefined,
        [
          {
            name: `${ICONS.music} ${toAdd.length > 1 ? 'Tracks' : 'Track'}`,
            value: toAdd.length > 1 ? `**${primary.title}** (+${toAdd.length - 1} more)` : `**${primary.title}**`,
            inline: false
          },
          { name: `${ICONS.artist} Artist`, value: primary.author, inline: true },
          { name: `${ICONS.source} Source`, value: primary.source, inline: true },
          { name: `${ICONS.tracks} Added`, value: `${toAdd.length} track${toAdd.length !== 1 ? 's' : ''}`, inline: true },
          { name: `${ICONS.playlist} Total`, value: `${playlistDb.tracks.length}/${LIMITS.MAX_TRACKS} tracks`, inline: true },
          { name: `${ICONS.duration} Duration`, value: formatDuration(playlistDb.totalDuration), inline: true }
        ]
      )

      const buttons = createButtons([
        { id: `add_more_${playlistName}_${userId}`, label: 'Add More', emoji: ICONS.add, style: ButtonStyle.Secondary, disabled: playlistDb.tracks.length >= LIMITS.MAX_TRACKS },
        { id: `play_playlist_${playlistName}_${userId}`, label: 'Play Now', emoji: ICONS.play, style: ButtonStyle.Success },
        { id: `view_playlist_${playlistName}_${userId}`, label: 'View All', emoji: ICONS.playlist, style: ButtonStyle.Primary }
      ])

      return ctx.editOrReply({ embeds: [embed], components: [buttons] })
    } catch (err) {
      return ctx.editOrReply({
        embeds: [createEmbed('error', 'Add Failed', `Could not add tracks: ${err instanceof Error ? err.message : 'Unknown error'}`)]
      })
    }
  }
}