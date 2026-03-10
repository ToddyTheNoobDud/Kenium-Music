import { Command, type CommandContext, Container, Declare } from 'seyfert'
import { lru } from 'tiny-lru'
import { getContextLanguage } from '../utils/i18n'

const SOURCE_CACHE = lru<{
  fingerprint: string
  sources: string[]
  version: string
}>(100, 3 * 24 * 60 * 60 * 1000)

const COMPONENTS_V2_FLAG = 64 | 32768
const SOURCE_GROUPS = Object.freeze([
  { label: 'A-H', start: 'A', end: 'H' },
  { label: 'I-P', start: 'I', end: 'P' },
  { label: 'Q-Z', start: 'Q', end: 'Z' }
])

const SOURCE_LABELS: Record<string, string> = Object.freeze({
  applemusic: 'Apple Music',
  bandcamp: 'Bandcamp',
  deezer: 'Deezer',
  flowerytts: 'Flowery TTS',
  http: 'HTTP',
  jiosaavn: 'JioSaavn',
  local: 'Local',
  pandora: 'Pandora',
  soundcloud: 'SoundCloud',
  spotify: 'Spotify',
  speak: 'Speak',
  twitch: 'Twitch',
  vimeo: 'Vimeo',
  yandexmusic: 'Yandex Music',
  youtube: 'YouTube'
})

const formatSourceName = (source: string): string => {
  const normalized = source.trim().toLowerCase()
  if (!normalized) return 'Unknown'
  if (SOURCE_LABELS[normalized]) return SOURCE_LABELS[normalized]

  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

async function getNodeSources(node: any) {
  if (!node) {
    return {
      nodeName: 'Unknown',
      version: 'Unknown',
      sources: [] as string[]
    }
  }

  const nodeName = String(
    node.options?.name || node.name || node.host || 'Unknown'
  )
  let info = node.info ?? null

  if (!info && typeof node.rest?.getInfo === 'function') {
    try {
      info = await node.rest.getInfo()
      node.info = info
    } catch {
      info = null
    }
  }

  const fingerprint = [
    info?.version?.semver ?? 'unknown-version',
    info?.buildTime ?? 'unknown-build'
  ].join(':')

  const cached = SOURCE_CACHE.get(nodeName)
  if (cached && cached.fingerprint === fingerprint) {
    return {
      nodeName,
      version: cached.version,
      sources: cached.sources
    }
  }

  const rawSources = Array.isArray(info?.sourceManagers)
    ? (info.sourceManagers as unknown[]).map((source) => String(source))
    : []

  const sources = [...new Set(rawSources)]
    .sort((a, b) => a.localeCompare(b))
    .map(formatSourceName)

  const version = String(info?.version?.semver || 'Unknown')

  SOURCE_CACHE.set(nodeName, {
    fingerprint,
    version,
    sources
  })

  return {
    nodeName,
    version,
    sources
  }
}

const groupSources = (sources: string[]) =>
  SOURCE_GROUPS.map((group) => ({
    label: group.label,
    sources: sources.filter((source) => {
      const firstChar = source.charAt(0).toUpperCase()
      return firstChar >= group.start && firstChar <= group.end
    })
  })).filter((group) => group.sources.length > 0)

const getTargetNodes = (ctx: CommandContext): any[] => {
  const player = ctx.client.aqua.players.get(ctx.guildId as string)
  const playerNode = player?.nodes

  if (playerNode) return [playerNode]

  const allNodes = [...(ctx.client.aqua.nodeMap.values() as Iterable<any>)]
  const connectedNodes = allNodes.filter((node) => node?.connected)

  return connectedNodes.length > 0 ? connectedNodes : allNodes
}

function createSourcesContainer(
  summary: { nodeName: string; version: string; sources: string[] },
  options: {
    isCurrentPlayerNode: boolean
    page: number
    total: number
    emptyText: string
  }
): Container {
  const groupedSources = groupSources(summary.sources)
  const title =
    options.total === 1
      ? '### Sources'
      : `### Sources (${options.page}/${options.total})`

  const scope = options.isCurrentPlayerNode
    ? 'current player node'
    : 'available node'
  const compactSummary = `**${summary.nodeName}** • \`${summary.version}\` • \`${summary.sources.length}\` sources • ${scope}`

  const components: any[] = [
    { type: 10, content: title },
    { type: 14, divider: true, spacing: 1 },
    { type: 10, content: compactSummary }
  ]

  if (!groupedSources.length) {
    components.push(
      { type: 14, divider: true, spacing: 1 },
      {
        type: 10,
        content: options.emptyText
      }
    )

    return new Container({
      components
    })
  }

  for (const group of groupedSources) {
    components.push(
      { type: 14, divider: true, spacing: 1 },
      {
        type: 10,
        content: `**${group.label}:** ${group.sources.join(', ')}`
      }
    )
  }

  return new Container({
    components
  })
}

@Declare({
  name: 'sources',
  description: 'Displays the sources enabled in kenium'
})
export default class SourcesCommand extends Command {
  public override async run(ctx: CommandContext): Promise<void> {
    try {
      if (!ctx.deferred) await ctx.deferReply()

      const lang = getContextLanguage(ctx)
      const t = ctx.t.get(lang)
      const nodes = getTargetNodes(ctx)

      if (!nodes.length) {
        await ctx.editOrReply({
          components: [
            new Container({
              components: [
                { type: 10, content: '### Sources' },
                { type: 14, divider: true, spacing: 2 },
                {
                  type: 10,
                  content: 'No Lavalink nodes are available right now.'
                }
              ]
            })
          ],
          flags: COMPONENTS_V2_FLAG
        })
        return
      }

      const summaries = await Promise.all(
        nodes.map((node) => getNodeSources(node))
      )
      const showingCurrentPlayerNode = !!ctx.client.aqua.players.get(
        ctx.guildId as string
      )?.nodes

      const containers = summaries.map((summary, index) =>
        createSourcesContainer(summary, {
          isCurrentPlayerNode: showingCurrentPlayerNode && index === 0,
          page: index + 1,
          total: summaries.length,
          emptyText: t.errors?.notFound || 'No source information available.'
        })
      )

      await ctx.editOrReply({
        components: containers,
        flags: COMPONENTS_V2_FLAG
      })
    } catch (error: any) {
      if (error?.code === 10065) return
    }
  }
}
