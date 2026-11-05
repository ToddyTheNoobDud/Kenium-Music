import { Cooldown } from '@slipher/cooldown'
import {
  Command,
  type CommandContext,
  createAttachmentOption,
  Declare,
  Embed,
  Middlewares,
  Options
} from 'seyfert'
import {
  MAX_RESOLVE_CONCURRENCY,
  resolveTrack,
  resolveTracksConcurrently
} from '../events/playlistPlayback.ts'
import { isExpiredInteraction } from '../shared/errorGuard.ts'
import { fetchImportFile, ImportFileError } from '../shared/importFile.ts'
import {
  enqueueTrack,
  getQueueCapacity,
  getQueueLoadState,
  maybeStartPlayback
} from '../shared/playback.ts'
import {
  buildTrackResolveQueries,
  parsePlaylistFile
} from '../shared/playlist_format.ts'
import { getContextLanguage } from '../utils/i18n.ts'
import { safeDefer } from '../utils/interactions.ts'

const options = {
  file: createAttachmentOption({
    description: 'The file to import',
    required: true
  })
}

@Cooldown.user(1000 * 60, { uses: 2 })

@Declare({
  name: 'import',
  description: 'Import a queue from a file (txt, pdf)'
})
@Options(options)
@Middlewares(['checkVoice', 'cooldown', 'checkPlayer'])
export default class importcmds extends Command {
  public override async run(
    ctx: CommandContext<typeof options>
  ): Promise<void> {
    try {
      if (!(await safeDefer(ctx, true))) {
        return
      }

      const { client } = ctx
      const lang = getContextLanguage(ctx)
      const t = ctx.t.get(lang)
      const { file } = ctx.options
      if (!ctx.guildId) {
        return
      }
      const player = client.aqua.players.get(ctx.guildId)
      if (!player) {
        return
      }
      if (!getQueueCapacity(player)) {
        await ctx.editOrReply({ content: 'The queue limit is 1,000 tracks.' })
        return
      }
      const state = getQueueLoadState(player)
      const fileContent = await fetchImportFile(file)
      if (state.cancelled || player.destroyed) {
        await ctx.editOrReply({ content: 'Import cancelled.' })
        return
      }

      if (!fileContent.trim()) {
        await ctx.editOrReply({
          embeds: [
            new Embed()
              .setDescription(t?.import?.emptyFile || '❌ The file is empty')
              .setColor(0xff0000)
          ]
        })
        return
      }
      const parsed = parsePlaylistFile(fileContent, 'Kenium Queue')
      const validTracks =
        parsed?.tracks.filter(
          (track) => buildTrackResolveQueries(track).length
        ) || []
      const tracks = validTracks.slice(0, getQueueCapacity(player))

      if (tracks.length === 0) {
        await ctx.editOrReply({
          embeds: [
            new Embed()
              .setDescription(
                t?.import?.noValidTracks ||
                  '❌ No valid tracks found in the file'
              )
              .setColor(0xff0000)
          ]
        })
        return
      }

      const importingText =
        t?.import?.importing?.replace('{count}', tracks.length.toString()) ||
        `🎵 Importing ${tracks.length} tracks...`

      const embed = new Embed().setDescription(importingText).setColor(0x00ff00)

      await ctx.editOrReply({ embeds: [embed], flags: 64 })

      let successCount = 0
      let failCount = 0
      for (
        let offset = 0;
        offset < tracks.length && getQueueCapacity(player);
        offset += MAX_RESOLVE_CONCURRENCY
      ) {
        const batch = tracks.slice(offset, offset + MAX_RESOLVE_CONCURRENCY)
        const resolved = await resolveTracksConcurrently(
          batch,
          MAX_RESOLVE_CONCURRENCY,
          (track) =>
            resolveTrack(client.aqua, track, ctx.interaction.user, state)
        )
        if (state.cancelled || player.destroyed) {
          await ctx.editOrReply({ content: 'Import cancelled.' })
          return
        }
        for (const track of resolved) {
          if (enqueueTrack(player, track, state)) {
            successCount += 1
          }
        }
        failCount += batch.length - resolved.length
      }
      await maybeStartPlayback(player)

      const completeTitle = t?.import?.complete || '🔥 Import Complete'
      const successText =
        t?.import?.successfullyImported?.replace(
          '{count}',
          successCount.toString()
        ) || `✅ Successfully imported: **${successCount}** tracks`
      const failText =
        failCount > 0
          ? t?.import?.failedToImport?.replace(
              '{count}',
              failCount.toString()
            ) || `❌ Failed to import: **${failCount}** tracks`
          : ''
      const totalText =
        t?.import?.totalQueueSize?.replace(
          '{count}',
          player.queue.size.toString()
        ) || `🎵 Total queue size: **${player.queue.size}** tracks`

      const omitted = validTracks.length - successCount - failCount
      const limitText =
        omitted > 0
          ? `${omitted} track(s) omitted; the queue limit is 1,000 tracks.`
          : ''
      const description = [successText, failText, totalText, limitText]
        .filter(Boolean)
        .join('\n')

      const resultEmbed = new Embed()
        .setTitle(completeTitle)
        .setDescription(description)
        .setColor(0x100e09)
        .setTimestamp()

      await ctx.editOrReply({ embeds: [resultEmbed], flags: 64 })
    } catch (error: unknown) {
      if (isExpiredInteraction(error)) {
        return
      }
      const message =
        error instanceof ImportFileError
          ? error.message
          : 'The file could not be imported. Please try again.'
      try {
        await ctx.editOrReply({
          embeds: [
            new Embed().setDescription(`❌ ${message}`).setColor(0xff0000)
          ],
          flags: 64
        })
      } catch (responseError) {
        if (isExpiredInteraction(responseError)) {
          return
        }
        throw responseError
      }
    }
  }
}
