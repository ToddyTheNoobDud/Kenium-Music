import { Lrclib } from '../utils/lrclib.ts'
import type {
  LyricsFindOptions,
  LyricsResult,
  LyricsSearchHints
} from '../utils/musiclyrics.ts'
import { musixmatch } from './musixmatch.ts'

const lrclib = new Lrclib()

export const findLyrics = async (
  query: string,
  hints?: LyricsSearchHints,
  opts?: LyricsFindOptions
): Promise<LyricsResult | null> => {
  const primary = await lrclib.findLyrics(query, hints, opts).catch(() => null)
  if (opts?.requireSynced) {
    if (primary?.lines?.length) return primary
  } else if (primary?.text || primary?.lines?.length) {
    return primary
  }

  return musixmatch.findLyrics(query, hints, opts).catch(() => null)
}
