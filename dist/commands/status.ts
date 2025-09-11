import { cpus, freemem, loadavg, totalmem } from "node:os";
import { Cooldown, CooldownType } from "@slipher/cooldown";
import {
	Command,
	type CommandContext,
	Declare,
	Embed,
	Middlewares,
} from "seyfert";

const CPU_CACHE = {
	model:
		cpus()[0]
			?.model.replace(
				/KATEX_INLINE_OPENRKATEX_INLINE_CLOSE|®|KATEX_INLINE_OPENTMKATEX_INLINE_CLOSE|™/g,
				"",
			)
			.trim()
			.split("@") || [],
	cores: cpus().length,
	lastCheck: 0,
	loadAvg: [0, 0, 0],
};

const formatters = {
	uptime: (() => {
		const cache = new Map<number, string>();

		return (ms: number): string => {
			const cacheKey = Math.floor(ms / 1000);
			if (cache.has(cacheKey)) return cache.get(cacheKey)!;

			const seconds = Math.floor(ms / 1000);
			const days = Math.floor(seconds / 86400);
			const hours = Math.floor((seconds % 86400) / 3600);
			const minutes = Math.floor((seconds % 3600) / 60);
			const secs = seconds % 60;

			const result = [
				days > 0 && `${days}d`,
				hours > 0 && `${hours}h`,
				minutes > 0 && `${minutes}m`,
				`${secs}s`,
			]
				.filter(Boolean)
				.join(" ");

			cache.set(cacheKey, result);
			if (cache.size > 100) {
				const firstKey = cache.keys().next().value;
				cache.delete(firstKey);
			}

			return result;
		};
	})(),

	memory: (() => {
		const cache = new Map<string, string>();
		const GB = 1073741824;
		const MB = 1048576;

		return (bytes: number, inGB = false): string => {
			const roundedBytes = Math.round(bytes / MB) * MB;
			const cacheKey = `${roundedBytes}-${inGB}`;

			if (cache.has(cacheKey)) return cache.get(cacheKey)!;

			const result = inGB
				? `${(roundedBytes / GB).toFixed(2)} GB`
				: `${(roundedBytes / MB).toFixed(2)} MB`;

			cache.set(cacheKey, result);
			if (cache.size > 50) {
				const firstKey = cache.keys().next().value;
				cache.delete(firstKey);
			}

			return result;
		};
	})(),
};

const createProgressBar = (
	used: number,
	total: number,
	length = 10,
): string => {
	if (total <= 0) return "▱".repeat(length);
	const progress = Math.min(Math.round((used / total) * length), length);
	return `${"▰".repeat(progress)}${"▱".repeat(length - progress)}`;
};
function formatMemoryUsage(bytes: number): string {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let i = 0;

	while (bytes >= 1024 && i < units.length - 1) {
		bytes /= 1024;
		i++;
	}

	return `${bytes.toFixed(2)} ${units[i]}`;
}
@Declare({
	name: "status",
	description: "status of the bot",
})
@Cooldown({
	type: CooldownType.User,
	interval: 1000 * 60,
	uses: { default: 2 },
})
@Middlewares(["cooldown"])
export default class statusCmds extends Command {
	public override async run(ctx: CommandContext): Promise<void> {
		const { client, interaction } = ctx;
		await ctx.deferReply();

		const now = Date.now();
		if (now - CPU_CACHE.lastCheck > 5000) {
			CPU_CACHE.loadAvg = loadavg();
			CPU_CACHE.lastCheck = now;
		}

		const totalMemory = totalmem();
		const freeMemory = freemem();
		const usedMemory = totalMemory - freeMemory;
		const memoryPercentage = ((usedMemory / totalMemory) * 100).toFixed(1);

		const pingTime = Date.now() - interaction.createdTimestamp;
		const nodes = [...client.aqua.nodeMap.values()];
		const connectedNodes = nodes.filter((node) => node.connected).length;

		const sortedNodes = [...nodes].sort((a, b) => {
			if (a.connected !== b.connected) return a.connected ? -1 : 1;
			// @ts-expect-error
			return (a.options?.identifier || "").localeCompare(
				b.options?.identifier || "",
			);
		});

		const activeNode = sortedNodes.find((node) => node.connected);
		const { stats = {} } = activeNode || {};
		// @ts-expect-error
		const {
			memory = {},
			cpu = {},
			players = 0,
			playingPlayers = 0,
			uptime: lavalinkUptime = 0,
		} = stats;

		const cpuLoad = cpu?.lavalinkLoadPercentage
			? `${(cpu.lavalinkLoadPercentage * 100).toFixed(1)}%`
			: "N/A";

		const memoryUsed = memory?.used || 0;
		const memoryTotal = memory?.reservable || 0;
		const lavalinkMemoryPercentage =
			memoryTotal > 0 ? ((memoryUsed / memoryTotal) * 100).toFixed(1) : "0.0";

		const systemMemoryBar = createProgressBar(usedMemory, totalMemory, 20);
		const lavalinkMemoryBar = createProgressBar(memoryUsed, memoryTotal, 20);
		const embed = new Embed().setColor(0).setDescription(`\`\`\`yml
System Uptime     :: ${formatters.uptime(process.uptime() * 1000)}
System CPU Model  :: ${CPU_CACHE.model[0] || "N/A"}, ${CPU_CACHE.cores} core(s)
System CPU Load   :: ${cpus()[0]?.speed} MHz, ${loadavg()[0].toFixed(2)}%, ${loadavg()[1].toFixed(2)}%, ${loadavg()[2].toFixed(2)}%
Lavalink Uptime   :: ${formatters.uptime(lavalinkUptime)}
Lavalink Version  :: ${(ctx.client.aqua as any)?.version || "N/A"}
System Memory     :: ${formatters.memory(usedMemory, true)} / ${formatters.memory(totalMemory, true)} (${memoryPercentage}%)
System Mem Bar    :: ${systemMemoryBar}
Lavalink Memory   :: ${formatters.memory(memoryUsed, true)} / ${formatters.memory(memoryTotal, true)} (${lavalinkMemoryPercentage}%)
Lavalink Mem Bar  :: ${lavalinkMemoryBar}
Lavalink CPU Load :: ${cpuLoad} (${CPU_CACHE.loadAvg[0].toFixed(2)}, ${CPU_CACHE.loadAvg[1].toFixed(2)}, ${CPU_CACHE.loadAvg[2].toFixed(2)}) avg
Lavalink Players  :: ${playingPlayers} playing / ${players} total
Lavalink Nodes    :: ${connectedNodes} connected / ${nodes.length} total
Ping              :: ${pingTime} ms
Process Memory    :: ${formatMemoryUsage(process.memoryUsage().rss)}
\`\`\``);

		await ctx.editOrReply({ embeds: [embed] });
	}
}
