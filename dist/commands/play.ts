import {
  Command,
  createStringOption,
  Declare,
  Options,
  Embed,
  Middlewares,
  type CommandContext,
} from 'seyfert'

const CACHE_SIZE = 10
const MAX_USER_CACHE = 200
const MAX_SEARCH_CACHE = 128
const MAX_RESULTS = 4
const THROTTLE_MS = 300
const SEARCH_TTL_MS = 30_000
const SWEEP_INTERVAL_MS = 5_000
const EMBED_COLOR = 0x000000

const isUrl = (s?: string): boolean => {
  const x = (s || '').trim().toLowerCase()
  return x.startsWith('http://') || x.startsWith('https://')
}

const esc = (s?: string): string => {
  if (!s) return ''
  const out: string[] = []
  for (let i = 0, len = s.length; i < len; i++) {
    const c = s[i]
    out.push(c)
  }
  return out.join('')
}

const trunc = (s?: string, n = 80): string => {
  const str = String(s ?? '')
  return str.length <= n ? str : str.slice(0, n - 3) + '...'
}

const ERR = Object.freeze({
  NO_VOICE: 'You must be in a voice channel to use this command.',
  NO_TRACKS: 'No tracks found for the given query.',
  GENERIC: 'An error occurred. Please try again.'
} as const)

type CacheEntry<T> = { value: T; expires: number }

class CacheManager<T> {
  private map = new Map<string, CacheEntry<T>>()

  constructor(private readonly maxSize = 128, private readonly ttl = 30_000) { }

  get(key: string): T | undefined {
    const e = this.map.get(key)
    if (!e) return undefined
    const now = Date.now()
    if (now > e.expires) {
      this.map.delete(key)
      return undefined
    }
    this.map.delete(key)
    this.map.set(key, e)
    return e.value
  }

  set(key: string, value: T): void {
    if (!this.map.has(key) && this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value
      if (oldest !== undefined) this.map.delete(oldest)
    }
    this.map.set(key, { value, expires: Date.now() + this.ttl })
  }

  delete(key: string): void {
    this.map.delete(key)
  }

  sweep(): void {
    if (this.map.size === 0) return
    const now = Date.now()
    const toDelete: string[] = []
    for (const [k, v] of this.map) if (now > v.expires) toDelete.push(k)
    for (const k of toDelete) this.map.delete(k)
  }
}

type RecentItem = { title: string; uri: string }

class RecentTracks {
  private userTracks = new Map<string, Map<string, RecentItem>>()

  constructor(private readonly maxUsers = MAX_USER_CACHE, private readonly maxTracks = CACHE_SIZE) { }

  add(userId: string, title: string | undefined, uri: string | undefined): void {
    if (!uri) return
    let tracks = this.userTracks.get(userId)
    if (!tracks) {
      if (this.userTracks.size >= this.maxUsers) {
        const oldestUser = this.userTracks.keys().next().value
        if (oldestUser) this.userTracks.delete(oldestUser)
      }
      tracks = new Map<string, RecentItem>()
      this.userTracks.set(userId, tracks)
    }

    if (tracks.has(uri)) tracks.delete(uri)
    tracks.set(uri, { title: title || uri, uri })

    while (tracks.size > this.maxTracks) {
      const oldest = tracks.keys().next().value
      if (!oldest) break
      tracks.delete(oldest)
    }
  }

  getLatestLimited(userId: string, limit: number): RecentItem[] | undefined {
    const tracks = this.userTracks.get(userId)
    if (!tracks) return undefined

    const sz = tracks.size
    if (sz <= limit) {
      const arr = Array.from(tracks.values())
      arr.reverse()
      return arr
    }

    const cap = limit
    const buf: (RecentItem | undefined)[] = new Array(cap)
    let idx = 0
    for (const v of tracks.values()) {
      buf[idx] = v
      idx = (idx + 1) % cap
    }
    const out: RecentItem[] = new Array(cap)
    let outIndex = 0
    let cur = (idx - 1 + cap) % cap
    for (let i = 0; i < cap; i++) {
      out[outIndex++] = buf[cur] as RecentItem
      cur = (cur - 1 + cap) % cap
    }
    return out
  }
}

class ThrottleManager {
  private lastAccess = new Map<string, number>()
  private counter = 0

  constructor(private readonly retentionMs = 60_000, private readonly cleanupInterval = 256) { }

  shouldThrottle(userId: string, ms = THROTTLE_MS): boolean {
    const now = Date.now()
    const last = this.lastAccess.get(userId) || 0
    if (now - last < ms) return true
    this.lastAccess.set(userId, now)
    if (++this.counter >= this.cleanupInterval) {
      this.counter = 0
      const threshold = now - this.retentionMs
      for (const [k, v] of this.lastAccess) if (v < threshold) this.lastAccess.delete(k)
    }
    return false
  }
}

const searchCache = new CacheManager<any[]>(MAX_SEARCH_CACHE, SEARCH_TTL_MS)
const recentTracks = new RecentTracks()
const throttleManager = new ThrottleManager()

const sweepTimer = setInterval(() => searchCache.sweep(), SWEEP_INTERVAL_MS)
if (typeof (sweepTimer as any)?.unref === 'function') (sweepTimer as any).unref()

const debounceTimers = new Map<string, NodeJS.Timeout>()

const options = {
  query: createStringOption({
    description: 'The song you want to search for',
    required: true,
    autocomplete: async (interaction: any) => {
      const uid = interaction.user.id
      if (throttleManager.shouldThrottle(uid)) return interaction.respond([])

      const raw = interaction.getInput()
      const input = String(raw || '').trim()

      if (debounceTimers.has(uid)) {
        clearTimeout(debounceTimers.get(uid)!)
      }

      return new Promise(resolve => {
        debounceTimers.set(uid, setTimeout(async () => {
          try {
            if (!input || input.length < 2) {
              const recent = recentTracks.getLatestLimited(uid, MAX_RESULTS)
              if (!recent?.length) return resolve(interaction.respond([]))
              const choices = new Array(recent.length)
              for (let i = 0; i < recent.length; i++) {
                const it = recent[i]
                choices[i] = {
                  name: `🕘 Recent ${i + 1}: ${trunc(it.title, 79)}`,
                  value: it.uri.slice(0, 100)
                }
              }
              return resolve(interaction.respond(choices))
            }

            if (isUrl(input)) return resolve(interaction.respond([]))

            const key = input.toLowerCase().slice(0, 80)
            let results = searchCache.get(key)
            if (!results) {
              const raw = await interaction.client.aqua.resolve({
                query: input,
                requester: interaction.user
              })

              let arr: any[] = []
              if (Array.isArray(raw)) arr = raw
              else if (raw && Array.isArray((raw as any).tracks)) arr = (raw as any).tracks
              results = arr
              if (results.length) searchCache.set(key, results)
            }

            if (!results?.length) return resolve(interaction.respond([]))

            const len = Math.min(results.length, MAX_RESULTS)
            const choices: any[] = []
            for (let i = 0; i < len; i++) {
              const item = results[i]
              const info = item?.info ?? item ?? {}
              if (!info?.uri) continue
              const title = esc(info.title || 'Unknown')
              const author = info.author ? ` - ${trunc(esc(info.author), 20)}` : ''
              choices.push({
                name: `${trunc(title, 70)}${author}`.slice(0, 100),
                value: String(info.uri).slice(0, 100)
              })
            }
            return resolve(interaction.respond(choices))
          } catch (e) {
            console.error('autocomplete resolve error', e)
            return resolve(interaction.respond([]))
          }
        }, 300))
      })
    }
  })
}


@Declare({ name: 'play', description: 'Play a song by search query or URL.' })
@Options(options)
@Middlewares(['checkVoice'])
export default class Play extends Command {
  async run(ctx: CommandContext): Promise<void> {
    const { query } = ctx.options as { query: string }
    try {
      await ctx.deferReply(true)
      const voice = await ctx.member.voice()
      if (!voice?.channelId) {
        await ctx.editResponse({ content: ERR.NO_VOICE })
        return
      }

      const player = ctx.client.aqua.createConnection({
        guildId: ctx.guildId,
        voiceChannel: voice.channelId,
        textChannel: ctx.channelId,
        deaf: true,
        defaultVolume: 65
      })


      const result = await ctx.client.aqua.resolve({ query, requester: ctx.interaction.user })
      if (!result?.tracks?.length) {
        await ctx.editResponse({ content: ERR.NO_TRACKS })
        return
      }

      const { loadType, tracks, playlistInfo } = result
      const embed = new Embed().setColor(EMBED_COLOR).setTimestamp()

      if (loadType === 'track' || loadType === 'search') {
        const track = tracks[0]
        const info = track?.info || {}
        player.queue.add(track)
        // @ts-ignore
        recentTracks.add(ctx.interaction.user.id, info.title || query, info.uri || query)
        // @ts-ignore
        embed.setDescription(`Added [**${esc(info.title || 'Track')}**](${info.uri || '#'}) to the queue.`)
      } else if (loadType === 'playlist' && playlistInfo?.name) {
        for (let i = 0; i < tracks.length; i++) player.queue.add(tracks[i])
        const first = tracks[0]
        if (first?.info?.uri) recentTracks.add(ctx.interaction.user.id, first.info.title || first.info.uri, first.info.uri)
        embed.setDescription(`Added **[\`${esc(playlistInfo.name)}\`](${first?.info?.uri})** playlist (${tracks.length} tracks) to the queue.`)
        if (playlistInfo.thumbnail) embed.setThumbnail(playlistInfo.thumbnail)
      } else {
        await ctx.editResponse({ content: 'Unsupported content type.' })
        return
      }

      await ctx.editResponse({ embeds: [embed] })

      if (!player.playing && !player.paused && player.queue.size > 0) {
        try {
          player.play()
        } catch (e) {
          console.error('play start error', e)
        }
      }
    } catch (err: any) {
      if (err?.code === 10065) return
      console.error('Play error:', err)
      try { await ctx.editResponse({ content: ERR.GENERIC }) } catch { }
    }
  }
}
