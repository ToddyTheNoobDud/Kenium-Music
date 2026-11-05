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
  registerPendingPlaylistLoads,
  topUpPlaylistBuffer
} from '../../events/playlistPlayback.ts'
import { ICONS } from '../../shared/constants.ts'
import { getQueueLoadState } from '../../shared/playback.ts'
import { getOrCreatePlayer } from '../../shared/player.ts'
import {
  createEmbed,
  formatDuration,
  handlePlaylistAutocomplete,
  shuffleArray
} from '../../shared/utils.ts'
import { getPlaylistsCollection, getPlaylistTracks } from '../../utils/db.ts'
import { getContextTranslations } from '../../utils/i18n.ts'
import { safeDefer } from '../../utils/interactions.ts'

const FIRST_CHUNK_TRACKS = 10

const options = {
  playlist: createStringOption({
    description: 'Playlist name to play',
    required: true,
    autocomplete: async (interaction) =>
      handlePlaylistAutocomplete(interaction, getPlaylistsCollection())
  }),
  shuffle: createBooleanOption({
    description: 'Whether to shuffle tracks before playing',
    required: false
  })
}

function writeError(ctx: CommandContext, title: string, description: string) {
  return ctx.write({
    embeds: [
      createEmbed('error', title, description, [], ctx.client.me?.avatarURL())
    ],
    flags: 64
  })
}

function editError(ctx: CommandContext, title: string, description: string) {
  return ctx.editOrReply({
    embeds: [
      createEmbed('error', title, description, [], ctx.client.me?.avatarURL())
    ]
  })
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

    const translations = getContextTranslations(ctx).playlist.play

    const playlistDb = getPlaylistsCollection().findOne(
      {
        userId: ctx.author.id,
        name: playlistName
      },
      {
        fields: ['_id', 'totalDuration']
      }
    )

    if (!playlistDb) {
      return writeError(
        ctx,
        translations?.notFound || 'Playlist Not Found',
        (
          translations?.notFoundDesc || 'No playlist named "{name}" exists!'
        ).replace('{name}', playlistName)
      )
    }

    const dbTracks = getPlaylistTracks(playlistDb._id, {
      fields: ['uri', 'source', 'identifier', 'title', 'author', 'isrc']
    })
    if (dbTracks.length === 0) {
      return writeError(
        ctx,
        translations?.empty || 'Empty Playlist',
        translations?.emptyDesc || 'This playlist has no tracks to play!'
      )
    }

    if (!(await safeDefer(ctx, true))) {
      return
    }

    const voiceState = await ctx.member?.voice()
    if (!voiceState?.channelId) {
      return editError(
        ctx,
        translations?.noVoiceChannel || 'No Voice Channel',
        translations?.noVoiceChannelDesc ||
          'Join a voice channel to play a playlist'
      )
    }

    try {
      const guildId = ctx.guildId as string
      const existingPlayer = ctx.client.aqua.players.get(guildId)
      const playerDecision = decidePlaylistPlayer(
        existingPlayer,
        voiceState.channelId
      )
      if (playerDecision.action === 'reject') {
        return editError(
          ctx,
          translations?.playFailed || 'Play Failed',
          'You must be in the same voice channel as the player.'
        )
      }
      const player =
        existingPlayer && !existingPlayer.destroyed
          ? existingPlayer
          : await getOrCreatePlayer(ctx.client, {
              guildId,
              voiceChannel: voiceState.channelId,
              textChannel: ctx.channelId
            })

      const total = dbTracks.length
      const ordered = shuffle ? shuffleArray(dbTracks) : dbTracks
      const state = getQueueLoadState(player)
      const accepted = registerPendingPlaylistLoads(
        player,
        ordered,
        ctx.interaction.user
      )
      if (!accepted) {
        return editError(ctx, 'Queue Full', 'The queue limit is 1,000 tracks.')
      }
      const loadedCount = await topUpPlaylistBuffer(
        ctx.client.aqua,
        player,
        FIRST_CHUNK_TRACKS
      )
      if (state.cancelled) {
        return editError(
          ctx,
          'Load Cancelled',
          'Playback loading was cancelled.'
        )
      }
      if (!loadedCount && !state.pending) {
        return editError(
          ctx,
          translations?.loadFailed || 'Load Failed',
          translations?.loadFailedDesc ||
            'Could not load any tracks from this playlist.'
        )
      }

      try {
        getPlaylistsCollection().updateAtomic(
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
              ? translations?.shuffling || 'Shuffling Playlist'
              : translations?.playing || 'Playing Playlist',
            notes.length > 0 ? `\n\n${notes.join('\n')}` : null,
            [
              {
                name: `${ICONS.playlist} ${translations?.playlist || 'Playlist'}`,
                value: `**${playlistName}**`,
                inline: true
              },
              {
                name: `${ICONS.tracks} Queued`,
                value: `${accepted}/${total} tracks`,
                inline: true
              },
              {
                name: `${ICONS.duration} ${translations?.duration || 'Duration'}`,
                value: formatDuration(playlistDb.totalDuration || 0),
                inline: true
              },
              {
                name: `${ICONS.music} ${translations?.channel || 'Channel'}`,
                value: voiceState.channelId,
                inline: true
              },
              {
                name: `${ICONS.shuffle} ${translations?.mode || 'Mode'}`,
                value: shuffle
                  ? translations?.shuffled || 'Shuffled'
                  : translations?.sequential || 'Sequential',
                inline: true
              },
              {
                name: `${ICONS.tracks} In Queue`,
                value: `${player.queue?.size ?? loadedCount} track(s)`,
                inline: true
              }
            ],
            ctx.client.me?.avatarURL()
          )
        ]
      })
    } catch (err) {
      return editError(
        ctx,
        translations?.playFailed || 'Play Failed',
        `${
          translations?.playFailedDesc ||
          'Could not play playlist. Please try again later.'
        }\n\nError: ${err instanceof Error ? err.message : 'Unknown error'}`
      )
    }
  }
}
