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
			playingPlayers = 0,
		} = stats;


		const guilds = client.cache.guilds.values() || [];
		const userCount = guilds.reduce(
			(total, guild) => total + (guild.memberCount || 0),
			0,
		);

		const banner = client.me?.fetch()

		const embed = new Embed()
			.setImage((await banner).bannerURL({ size: 4096}) || "")
			.setColor(0x100e09)
			.setDescription(`Hello, I am **${client.me?.username}**, a music bot created by [\`mushroom0162\`](https://github.com/ToddyTheNoobDud). Here is my current status:`)
			.addFields(
				{
					inline: true,
					name: "\`📋\` Info",
					value: `\`📦\` Guilds: ${guilds.length}\n\`👤\`Users: ${userCount}\n\`🎤\`Players: ${client.aqua.players.size} / Playing: ${playingPlayers}`
				},
				{
					inline: true,
					name: "\`🖥️\` System",
					value: `\`💻\` Memory Usage: ${formatMemoryUsage(process.memoryUsage().rss)}\n\`🕛\`Uptime: <t:${Math.floor((Date.now() - process.uptime() * 1000) / 1000)}:R>\n\`🛜\` Ping: ${client.gateway.latency}`
				}
			)

		await ctx.editOrReply({ embeds: [embed] });
	}
}
;
