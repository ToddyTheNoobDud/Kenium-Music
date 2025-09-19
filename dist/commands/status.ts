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

			const parts = [];
			if (days > 0) parts.push(`**${days}** day${days !== 1 ? 's' : ''}`);
			if (hours > 0) parts.push(`**${hours}** hour${hours !== 1 ? 's' : ''}`);
			if (minutes > 0) parts.push(`**${minutes}** min${minutes !== 1 ? 's' : ''}`);
			if (secs > 0 || parts.length === 0) parts.push(`**${secs}** sec${secs !== 1 ? 's' : ''}`);

			const result = parts.join(', ');

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
	if (total <= 0) return "⬜".repeat(length);
	const percentage = (used / total) * 100;
	const progress = Math.min(Math.round((used / total) * length), length);

	// Color-coded bars based on usage
	let filled = "🟩";
	if (percentage > 50) filled = "🟨";
	if (percentage > 75) filled = "🟧";
	if (percentage > 90) filled = "🟥";

	return filled.repeat(progress) + "⬜".repeat(length - progress);
};

const getStatusEmoji = (percentage: number): string => {
	if (percentage < 50) return "🟢";
	if (percentage < 75) return "🟡";
	if (percentage < 90) return "🟠";
	return "🔴";
};

const getConnectionEmoji = (connected: boolean): string => {
	return connected ? "✅" : "❌";
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
		const memoryPercentage = ((usedMemory / totalMemory) * 100);

		const pingTime = Date.now() - interaction.createdTimestamp;
		const nodes = [...client.aqua.nodeMap.values()];
		const connectedNodes = nodes.filter((node) => node.connected).length;

		const sortedNodes = [...nodes].sort((a, b) => {
			if (a.connected !== b.connected) return a.connected ? -1 : 1;
			return (a.options?.name || "").localeCompare(
				b.options?.name || "",
			);
		});

		const activeNode = sortedNodes.find((node) => node.connected);
		const { stats = {} } = activeNode || {};
		const {
			memory = {},
			cpu = {},
			players = 0,
			playingPlayers = 0,
			uptime: lavalinkUptime = 0,
		} = stats;

		const cpuLoadPercent = cpu?.lavalinkLoadPercentage ? cpu.lavalinkLoadPercentage * 100 : 0;
		const memoryUsed = memory?.used || 0;
		const memoryTotal = memory?.reservable || 0;
		const lavalinkMemoryPercentage = memoryTotal > 0 ? ((memoryUsed / memoryTotal) * 100) : 0;
		// Determine ping status
		const pingStatus = (() => {
			if (pingTime < 100) return "🟢 Excellent";
			if (pingTime < 200) return "🟡 Good";
			if (pingTime < 500) return "🟠 Fair";
			return "🔴 Poor";
		})();

		const embed = new Embed()
			.setColor(0x000000)
			.setAuthor({
				name: `${client.me.username} • ${connectedNodes > 0 ? 'Lavalink Connected' : 'No Active Nodes'}`,
				iconUrl: client.me.avatarURL(),
			})
			.addFields([
				{
					name: "⏱️ **Uptime**",
					value: [
						`> **System:** ${formatters.uptime(process.uptime() * 1000)}`,
						`> **Lavalink:** ${formatters.uptime(lavalinkUptime)}`
					].join('\n'),
					inline: true
				},
				{
					name: "🎵 **Music Status**",
					value: [
						`> **Playing:** \`${playingPlayers}\` tracks`,
						`> **Total Players:** \`${players}\``,
						`> **Nodes:** ${getConnectionEmoji(connectedNodes > 0)} \`${connectedNodes}/${nodes.length}\``
					].join('\n'),
					inline: true
				},
				{
					name: "🌐 **Network**",
					value: [
						`> **Latency:** ${pingStatus}`,
						`> **Response:** \`${pingTime}ms\``,
						`> **Version:** \`${(ctx.client.aqua as any)?.version || "N/A"}\``
					].join('\n'),
					inline: true
				},
				{
					name: `💻 **System CPU** ${getStatusEmoji(cpuLoadPercent)}`,
					value: [
						`> **Model:** \`${CPU_CACHE.model[0] || "Unknown"}\``,
						`> **Cores:** \`${CPU_CACHE.cores}\` @ \`${cpus()[0]?.speed}MHz\``,
						`> **Load Average:** \`${loadavg().map(l => l.toFixed(2)).join('%, ')}%\``,
					].join('\n'),
					inline: false
				},
				{
					name: `💾 **System Memory** ${getStatusEmoji(memoryPercentage)}`,
					value: [
						`> ${createProgressBar(usedMemory, totalMemory, 15)} **${memoryPercentage.toFixed(1)}%**`,
						`> **Used:** \`${formatters.memory(usedMemory, true)}\` / \`${formatters.memory(totalMemory, true)}\``,
						`> **Process:** \`${formatMemoryUsage(process.memoryUsage().rss)}\``
					].join('\n'),
					inline: false
				}
			]);
		if (activeNode && connectedNodes > 0) {
			embed.addFields([
				{
					name: `**Lavalink Resources**`,
					value: [
						`> **CPU Load:** ${getStatusEmoji(cpuLoadPercent)} \`${cpuLoadPercent.toFixed(1)}%\``,
						`> **Memory:** ${createProgressBar(memoryUsed, memoryTotal, 15)} **${lavalinkMemoryPercentage.toFixed(1)}%**`,
						`> **Used:** \`${formatters.memory(memoryUsed, true)}\` / \`${formatters.memory(memoryTotal, true)}\``
					].join('\n'),
					inline: false
				}
			]);
		}

		await ctx.editOrReply({ embeds: [embed] });
	}
}
;
