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
const BANNER_CACHE = {
	url: null as string | null,
	lastFetch: 0,
	ttl: 7 * 24 * 60 * 60 * 1000, // 7 days
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

async function getBannerURL(client: any): Promise<string | null> {
	const now = Date.now();

	// Check if we have a cached banner and it's still valid
	if (BANNER_CACHE.url && (now - BANNER_CACHE.lastFetch) < BANNER_CACHE.ttl) {
		return BANNER_CACHE.url;
	}

	try {
		// Only fetch if cache is expired or empty
		const user = await client.me?.fetch();
		const bannerURL = user?.bannerURL({ size: 4096 }) || null;

		// Update cache
		BANNER_CACHE.url = bannerURL;
		BANNER_CACHE.lastFetch = now;

		return bannerURL;
	} catch (error) {
		console.error('Failed to fetch banner:', error);
		// Return cached URL if fetch fails, or null if no cache
		return BANNER_CACHE.url;
	}
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
		const { client } = ctx;
		await ctx.deferReply();

		const now = Date.now();
		if (now - CPU_CACHE.lastCheck > 5000) {
			CPU_CACHE.loadAvg = loadavg();
			CPU_CACHE.lastCheck = now;
		}

		const totalMemory = totalmem();
		const freeMemory = freemem();
		const usedMemory = totalMemory - freeMemory;

		const nodes = [...client.aqua.nodeMap.values()];

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

		// Use cached banner URL
		const bannerURL = await getBannerURL(client);

		const embed = new Embed()
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
			);

		// Only set image if banner URL exists
		if (bannerURL) {
			embed.setImage(bannerURL);
		}

		await ctx.editOrReply({ embeds: [embed] });
	}
}