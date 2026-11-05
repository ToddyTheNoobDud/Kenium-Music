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
  type PlaylistTrackDoc,
  registerPendingPlaylistLoads,
  topUpPlaylistBuffer
} from '../../events/playlistPlayback.ts'
import { ICONS } from '../../shared/constants.ts'
import type { PlayerLike } from '../../shared/helperTypes.ts'
import { getQueueLoadState } from '../../shared/playback.ts'
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
  async run(ctx: CommandContext<typeof options>) {
    const { playlist: playlistName, shuffle = false } = ctx.options

    const translations = getContextTranslations(ctx)
    const tp = translations.playlist?.play

    const playlistDb = playlistsCol().findOne(
      {
        userId: ctx.author.id,
        name: playlistName
      },
      {
        fields: ['_id', 'totalDuration']
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

    if (!(await safeDefer(ctx, true))) {
      return
    }

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
          : await getOrCreatePlayer(ctx.client, {
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
      const state = getQueueLoadState(player)
      const accepted = registerPendingPlaylistLoads(
        player,
        ordered,
        ctx.interaction.user
      )
      if (!accepted) {
        return _functions.editError(
          ctx,
          'Queue Full',
          'The queue limit is 1,000 tracks.'
        )
      }
      const loadedCount = await topUpPlaylistBuffer(
        ctx.client.aqua,
        player,
        FIRST_CHUNK_TRACKS
      )
      if (state.cancelled) {
        return _functions.editError(
          ctx,
          'Load Cancelled',
          'Playback loading was cancelled.'
        )
      }
      if (!loadedCount && !state.pending) {
        return _functions.editError(
          ctx,
          tp?.loadFailed || 'Load Failed',
          tp?.loadFailedDesc || 'Could not load any tracks from this playlist.'
        )
      }

      try {
        playlistsCol().updateAtomic(
          { _id: playlistDb._id },
          {
            $inc: { playCount: 1 },
            $set: { lastPlayedAt: new Date().toISOString() }
          }
        )
      } catch (dbError) {
        console.error('Database error updating playlist stats:', dbError)
      }

      const notes: string[] = []
      if (state.pending > 0) {
        notes.push('More tracks will load as the queue plays.')
      }
      if (accepted < total) {
        notes.push(
          'The queue limit is 1,000 tracks; excess tracks were omitted.'
        )
      }

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
                name: `${ICONS.tracks} Queued`,
                value: `${accepted}/${total} tracks`,
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
                name: `${ICONS.tracks} ${'In Queue'}`,
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
