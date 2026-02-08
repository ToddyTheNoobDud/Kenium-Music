import { Cooldown, CooldownType } from '@slipher/cooldown'
import {
  Declare,
  Middlewares,
  Options,
  SubCommand,
  createBooleanOption,
  createStringOption,
  type CommandContext
} from 'seyfert'
import { ICONS } from '../../shared/constants'
import type { Track } from '../../shared/types'
import {
  createEmbed,
  formatDuration,
  handlePlaylistAutocomplete,
  shuffleArray
} from '../../shared/utils'
import { getPlaylistsCollection, getTracksCollection } from '../../utils/db'
import { getContextTranslations } from '../../utils/i18n'

const playlistsCollection = getPlaylistsCollection()
const tracksCollection = getTracksCollection()
const MAX_RESOLVE_CONCURRENCY = 6

const _functions = {
  async resolveTrack(
    aqua: { resolve: (opts: any) => Promise<any> },
    track: { uri?: string; source?: string; identifier?: string },
    requester: { id: string; username: string }
  ): Promise<Track | null> {
    const uri = track?.uri
    if (!uri) return null

    try {
      const sourceStr = String(track?.source || '').toLowerCase()
      const query = track?.identifier || uri
      const isUrl = /^https?:\/\//.test(query)
      const res = await aqua.resolve({
        query,
        requester,
        source: sourceStr.includes('youtube') && !isUrl ? 'ytsearch' : undefined
      })

      const loadType = String(res?.loadType || '').toUpperCase()
      if (!res || loadType === 'LOAD_FAILED' || loadType === 'NO_MATCHES')
        return null

      const tracks = res.tracks
      return Array.isArray(tracks) && tracks.length ? tracks[0] : null
    } catch {
      return null
    }
  },

  async resolveTracksConcurrently<T>(
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<T | null>
  ): Promise<T[]> {
    const len = items.length
    if (!len) return []

    const cap = Math.min(limit > 0 ? limit : 1, len)
    const results: (T | null)[] = new Array(len)
    let nextIndex = 0

    const getNextIndex = (): number => {
      const idx = nextIndex
      nextIndex += 1
      return idx
    }

    const workers = Array.from({ length: cap }, async () => {
      while (true) {
        const idx = getNextIndex()
        if (idx >= len) break

        try {
          const item = items[idx]
          if (item !== undefined) {
            results[idx] = await fn(item, idx)
          }
        } catch (error) {
          console.error(`Track resolution failed for index ${idx}:`, error)
          results[idx] = null
        }
      }
    })

    await Promise.all(workers)

    return results.filter((result): result is T => result !== null)
  },

  getChannelName(vc: { channel: { name: string }; channelId: string }) {
    return vc?.channel?.name || vc?.channelId || 'Voice'
  },

  writeError(ctx: CommandContext, title: string, desc: string) {
    return ctx.write({
      embeds: [createEmbed('error', title, desc)],
      flags: 64
    })
  },

  editError(ctx: CommandContext, title: string, desc: string) {
    return ctx.editOrReply({ embeds: [createEmbed('error', title, desc)] })
  }
}

@Declare({
  name: 'play',
  description: '🎵 Play a playlist'
})
// biome-ignore lint/suspicious/noExplicitAny: bypassed for exactOptionalPropertyTypes
@Options({
  playlist: createStringOption({
    description: 'Playlist name to play',
    required: true,
    autocomplete: async (interaction) =>
      handlePlaylistAutocomplete(interaction, playlistsCollection)
  }),
  shuffle: createBooleanOption({
    description: 'Whether to shuffle tracks before playing',
    required: false
  })
} as any)
@Cooldown({ type: CooldownType.User, interval: 20000, uses: { default: 2 } })
@Middlewares(['checkVoice'])
export class PlayCommand extends SubCommand {
  async run(ctx: CommandContext) {
    const { playlist: playlistName, shuffle = false } = ctx.options as {
      playlist: string
      shuffle?: boolean
    }

    const tp = getContextTranslations(ctx).playlist?.play

    const playlistDb = playlistsCollection.findOne({
      userId: ctx.author.id,
      name: playlistName
    })

    if (!playlistDb) {
      return _functions.writeError(
        ctx,
        tp?.notFound || 'Playlist Not Found',
        (tp?.notFoundDesc || 'No playlist named "{name}" exists!').replace(
          '{name}',
          playlistName
        )
      )
    }

    const dbTracks = tracksCollection.find(
      { playlistId: playlistDb._id },
      { sort: { addedAt: 1 } }
    )
    if (!Array.isArray(dbTracks) || dbTracks.length === 0) {
      return _functions.writeError(
        ctx,
        tp?.empty || 'Empty Playlist',
        tp?.emptyDesc || 'This playlist has no tracks to play!'
      )
    }

    const voiceState = await ctx.member?.voice()
    if (!voiceState?.channelId) {
      return _functions.writeError(
        ctx,
        tp?.noVoiceChannel || 'No Voice Channel',
        tp?.noVoiceChannelDesc || 'Join a voice channel to play a playlist'
      )
    }

    if (!ctx.deferred) await ctx.deferReply(true)

    try {
      const player =
        ctx.client.aqua.players.get(ctx.guildId || '') ??
        ctx.client.aqua.createConnection({
          guildId: ctx.guildId as string,
          voiceChannel: voiceState.channelId,
          textChannel: ctx.channelId,
          defaultVolume: 65,
          deaf: true
        })

      const total = dbTracks.length
      const tracks = shuffle ? shuffleArray(dbTracks.slice()) : dbTracks

      const loadedTracks = await _functions.resolveTracksConcurrently(
        tracks,
        MAX_RESOLVE_CONCURRENCY,
        (track) =>
          _functions.resolveTrack(ctx.client.aqua, track, ctx.interaction.user)
      )

      if (!loadedTracks.length) {
        return _functions.editError(
          ctx,
          tp?.loadFailed || 'Load Failed',
          tp?.loadFailedDesc ||
            'Could not load any tracks from this playlist. The tracks may no longer be available.'
        )
      }

      for (const tr of loadedTracks) player.queue.add(tr)

      try {
        playlistsCollection.update(
          { _id: playlistDb._id },
          {
            playCount: (playlistDb.playCount || 0) + 1,
            lastPlayedAt: new Date().toISOString()
          }
        )
      } catch (dbError) {
        console.error('Database error updating playlist stats:', dbError)
      }

      if (!player.playing && !player.paused) player.play()

      const failedCount = total - loadedTracks.length

      return ctx.editOrReply({
        embeds: [
          createEmbed(
            'success',
            shuffle
              ? tp?.shuffling || 'Shuffling Playlist'
              : tp?.playing || 'Playing Playlist',
            failedCount > 0 ? `\n\n⚠️ ${failedCount} track(s) could not be loaded` : null,
            [
              {
                name: `${ICONS.playlist} ${tp?.playlist || 'Playlist'}`,
                value: `**${playlistName}**`,
                inline: true
              },
              {
                name: `${ICONS.tracks} ${tp?.loaded || 'Loaded'}`,
                value: `${loadedTracks.length}/${total} tracks`,
                inline: true
              },
              {
                name: `${ICONS.duration} ${tp?.duration || 'Duration'}`,
                value: formatDuration(playlistDb.totalDuration || 0),
                inline: true
              },
              {
                name: `${ICONS.music} ${tp?.channel || 'Channel'}`,
                value: _functions.getChannelName(voiceState as { channel: { name: string }; channelId: string }),
                inline: true
              },
              {
                name: `${ICONS.shuffle} ${tp?.mode || 'Mode'}`,
                value: shuffle
                  ? tp?.shuffled || 'Shuffled'
                  : tp?.sequential || 'Sequential',
                inline: true
              },
              {
                name: `${ICONS.tracks} ${tp?.inQueue || 'In Queue'}`,
                value: `${player.queue.size} track(s)`,
                inline: true
              }
            ]
          )
        ]
      })
    } catch (err) {
      return _functions.editError(
        ctx,
        tp?.playFailed || 'Play Failed',
        `${
          tp?.playFailedDesc ||
          'Could not play playlist. Please try again later.'
        }\n\nError: ${err instanceof Error ? err.message : 'Unknown error'}`
      )
    }
  }
}
