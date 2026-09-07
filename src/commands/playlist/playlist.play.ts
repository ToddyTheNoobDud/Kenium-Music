import { Cooldown } from '@slipher/cooldown'
import {
  type CommandContext,
  createBooleanOption,
  createStringOption,
  Declare,
  Middlewares,
  Options,
  SubCommand
} from 'seyfert'
import {
  decidePlaylistPlayer,
  enqueueTracksAndCount,
  MAX_RESOLVE_CONCURRENCY,
  type PlaylistTrackDoc,
  registerPendingPlaylistLoads,
  resolveTrack,
  resolveTracksConcurrently
} from '../../events/playlistPlayback.ts'
import { ICONS } from '../../shared/constants.ts'
import type { PlayerLike } from '../../shared/helperTypes.ts'
import { maybeStartPlayback } from '../../shared/playback.ts'
import { getOrCreatePlayer } from '../../shared/player.ts'
import {
  createEmbed,
  formatDuration,
  handlePlaylistAutocomplete,
  shuffleArray
} from '../../shared/utils.ts'
import { getPlaylistsCollection, getTracksCollection } from '../../utils/db.ts'
import { getContextTranslations } from '../../utils/i18n.ts'
import { safeDefer } from '../../utils/interactions.ts'

const playlistsCol = () => getPlaylistsCollection()
const tracksCol = () => getTracksCollection()
const FIRST_CHUNK_TRACKS = 10

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
      handlePlaylistAutocomplete(interaction, playlistsCol())
  }),
  shuffle: createBooleanOption({
    description: 'Whether to shuffle tracks before playing',
    required: false
  })
}

const _functions = {
  getChannelName(vc: { channel: { name: string }; channelId: string }) {
    return vc?.channel?.name || vc?.channelId || 'Voice'
  },

  writeError(ctx: CommandContext, title: string, desc: string) {
    return ctx.write({
      embeds: [
        createEmbed('error', title, desc, [], ctx.client.me?.avatarURL())
      ],
      flags: 64
    })
  },

  editError(ctx: CommandContext, title: string, desc: string) {
    return ctx.editOrReply({
      embeds: [
        createEmbed('error', title, desc, [], ctx.client.me?.avatarURL())
      ]
    })
  }
}

@Declare({
  name: 'play',
  description: '🎵 Play a playlist'
})
@Options(options)
@Cooldown.user(20000, { uses: 2 })
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

    const playlistDb = playlistsCol().findOne(
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

    const dbTracks = tracksCol().find(
      { playlistId: playlistDb._id },
      {
        sort: { addedAt: 1, _id: 1 },
        fields: ['uri', 'source', 'identifier', 'title', 'author', 'isrc']
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
      const guildId = ctx.guildId as string
      const existingPlayer = ctx.client.aqua.players.get(guildId) as
        | PlayerLike
        | undefined
      const playerDecision = decidePlaylistPlayer(
        existingPlayer,
        voiceState.channelId
      )
      if (playerDecision.action === 'reject') {
        return _functions.editError(
          ctx,
          tp?.playFailed || 'Play Failed',
          'You must be in the same voice channel as the player.'
        )
      }
      const player = (
        playerDecision.action === 'reuse'
          ? existingPlayer
          : getOrCreatePlayer(ctx.client, {
              guildId,
              voiceChannel: voiceState.channelId,
              textChannel: ctx.channelId
            })
      ) as PlayerLike | undefined
      if (!player) {
        return _functions.editError(
          ctx,
          tp?.playFailed || 'Play Failed',
          tp?.playFailedDesc ||
            'Could not play playlist. Please try again later.'
        )
      }

      const total = dbTracks.length
      const ordered = shuffle ? shuffleArray(dbTracks.slice()) : dbTracks
      const firstChunk = ordered.slice(0, FIRST_CHUNK_TRACKS)
      const remaining = ordered.slice(firstChunk.length)

      const resolvedFirst = await resolveTracksConcurrently(
        firstChunk,
        MAX_RESOLVE_CONCURRENCY,
        (track) => resolveTrack(ctx.client.aqua, track, ctx.interaction.user)
      )

      const loadedCount = await enqueueTracksAndCount(
        resolvedFirst,
        (track) => {
          if (typeof player.queue?.add !== 'function')
            throw new Error('Player queue is unavailable')
          return player.queue.add(track)
        }
      )

      if (loadedCount === 0 && remaining.length === 0) {
        return _functions.editError(
          ctx,
          tp?.loadFailed || 'Load Failed',
          tp?.loadFailedDesc ||
            'Could not load any tracks from this playlist. The tracks may no longer be available.'
        )
      }

      registerPendingPlaylistLoads(guildId, remaining, ctx.interaction.user)

      try {
        playlistsCol().update(
          { _id: playlistDb._id },
          {
            playCount: (playlistDb.playCount || 0) + 1,
            lastPlayedAt: new Date().toISOString()
          }
        )
      } catch (dbError) {
        console.error('Database error updating playlist stats:', dbError)
      }

      await maybeStartPlayback(player)

      const failedUpfront = firstChunk.length - loadedCount
      const notes: string[] = []
      if (failedUpfront > 0)
        notes.push(`⚠️ ${failedUpfront} track(s) could not be loaded`)
      if (remaining.length > 0)
        notes.push(
          `⏳ ${remaining.length} more track(s) will load as the queue plays`
        )

      return ctx.editOrReply({
        embeds: [
          createEmbed(
            'success',
            shuffle
              ? tp?.shuffling || 'Shuffling Playlist'
              : tp?.playing || 'Playing Playlist',
            notes.length > 0 ? `\n\n${notes.join('\n')}` : null,
            [
              {
                name: `${ICONS.playlist} ${tp?.playlist || 'Playlist'}`,
                value: `**${playlistName}**`,
                inline: true
              },
              {
                name: `${ICONS.tracks} ${tp?.loaded || 'Loaded'}`,
                value: `${loadedCount}/${total} tracks`,
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
                value: `${player.queue?.size ?? loadedCount} track(s)`,
                inline: true
              }
            ],
            ctx.client.me?.avatarURL()
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
