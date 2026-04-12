import { Cooldown, CooldownType } from '@slipher/cooldown'
import {
  type CommandContext,
  createBooleanOption,
  createStringOption,
  Declare,
  Middlewares,
  Options,
  SubCommand
} from 'seyfert'
import type { OptionsRecord } from 'seyfert/lib/commands/applications/chat'
import { ICONS } from '../../shared/constants'
import type {
  PlayerLike,
  ResolveResultLike,
  TrackLike,
  UserLike
} from '../../shared/helperTypes'
import { getOrCreatePlayer } from '../../shared/player'
import type { Track } from '../../shared/types'
import {
  createEmbed,
  formatDuration,
  handlePlaylistAutocomplete,
  shuffleArray
} from '../../shared/utils'
import { getPlaylistsCollection, getTracksCollection } from '../../utils/db'
import { getContextTranslations } from '../../utils/i18n'
import { safeDefer } from '../../utils/interactions'

const playlistsCollection = getPlaylistsCollection()
const tracksCollection = getTracksCollection()
const MAX_RESOLVE_CONCURRENCY = 6

type PlaylistTrackDoc = Pick<Track, 'uri' | 'source' | 'identifier'>

type ResolvedQueueTrack = TrackLike

type PlaylistResolverLike = {
  resolve: (opts: {
    query: string
    requester: UserLike
    source?: string
  }) => Promise<ResolveResultLike<ResolvedQueueTrack> & { loadType?: string }>
}

type PlaylistPlayTextLike = {
  notFound?: string
  notFoundDesc?: string
  empty?: string
  emptyDesc?: string
  noVoiceChannel?: string
  noVoiceChannelDesc?: string
  loadFailed?: string
  loadFailedDesc?: string
  shuffling?: string
  playing?: string
  playlist?: string
  loaded?: string
  duration?: string
  channel?: string
  mode?: string
  shuffled?: string
  sequential?: string
  inQueue?: string
  playFailed?: string
  playFailedDesc?: string
}

const options = {
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
}

const _functions = {
  async resolveTrack(
    aqua: PlaylistResolverLike,
    track: PlaylistTrackDoc,
    requester: UserLike
  ): Promise<ResolvedQueueTrack | null> {
    const uri = track?.uri
    if (!uri) return null

    try {
      const sourceStr = String(track?.source || '').toLowerCase()
      const query = track?.identifier || uri
      const isUrl = /^https?:\/\//.test(query)
      const res = await aqua.resolve({
        query,
        requester,
        ...(sourceStr.includes('youtube') && !isUrl
          ? { source: 'ytsearch' }
          : {})
      })

      const loadType = String(res?.loadType || '').toUpperCase()
      if (!res || loadType === 'LOAD_FAILED' || loadType === 'NO_MATCHES')
        return null

      const tracks = res.tracks
      const firstTrack = Array.isArray(tracks) ? tracks[0] : null
      return firstTrack ?? null
    } catch {
      return null
    }
  },

  async resolveTracksConcurrently<TItem, TResult>(
    items: TItem[],
    limit: number,
    fn: (item: TItem, index: number) => Promise<TResult | null>
  ): Promise<TResult[]> {
    const len = items.length
    if (!len) return []

    const cap = Math.min(limit > 0 ? limit : 1, len)
    const results: Array<TResult | null> = new Array(len)
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

    return results.filter((result): result is TResult => result !== null)
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
@Options(options as unknown as OptionsRecord)
@Cooldown({ type: CooldownType.User, interval: 20000, uses: { default: 2 } })
@Middlewares(['checkVoice'])
export class PlayCommand extends SubCommand {
  async run(ctx: CommandContext) {
    const { playlist: playlistName, shuffle = false } = ctx.options as {
      playlist: string
      shuffle?: boolean
    }

    const translations = getContextTranslations(ctx) as {
      playlist?: { play?: PlaylistPlayTextLike }
    }
    const tp = translations.playlist?.play

    const playlistDb = playlistsCollection.findOne(
      {
        userId: ctx.author.id,
        name: playlistName
      },
      {
        fields: ['_id', 'playCount', 'totalDuration']
      }
    )

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
      {
        sort: { addedAt: 1, _id: 1 },
        fields: ['uri', 'source', 'identifier']
      }
    ) as PlaylistTrackDoc[]
    if (!Array.isArray(dbTracks) || dbTracks.length === 0) {
      return _functions.writeError(
        ctx,
        tp?.empty || 'Empty Playlist',
        tp?.emptyDesc || 'This playlist has no tracks to play!'
      )
    }

    if (!(await safeDefer(ctx, true))) return

    const voiceState = await ctx.member?.voice()
    if (!voiceState?.channelId) {
      return _functions.editError(
        ctx,
        tp?.noVoiceChannel || 'No Voice Channel',
        tp?.noVoiceChannelDesc || 'Join a voice channel to play a playlist'
      )
    }

    try {
      const player = getOrCreatePlayer(ctx.client, {
        guildId: ctx.guildId as string,
        voiceChannel: voiceState.channelId,
        textChannel: ctx.channelId
      }) as PlayerLike | undefined
      if (!player) {
        return _functions.editError(
          ctx,
          tp?.playFailed || 'Play Failed',
          tp?.playFailedDesc ||
            'Could not play playlist. Please try again later.'
        )
      }

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

      const queue = player.queue
      for (const tr of loadedTracks) {
        if (typeof queue?.add === 'function') queue.add(tr)
      }

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

      if (!player.playing && !player.paused) player.play?.().catch(() => {})

      const failedCount = total - loadedTracks.length

      return ctx.editOrReply({
        embeds: [
          createEmbed(
            'success',
            shuffle
              ? tp?.shuffling || 'Shuffling Playlist'
              : tp?.playing || 'Playing Playlist',
            failedCount > 0
              ? `\n\n⚠️ ${failedCount} track(s) could not be loaded`
              : null,
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
                value: _functions.getChannelName(
                  voiceState as { channel: { name: string }; channelId: string }
                ),
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
                value: `${player.queue?.size ?? loadedTracks.length} track(s)`,
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
