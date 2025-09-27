import { Cooldown, CooldownType } from "@slipher/cooldown";
import {
	Command,
	type CommandContext,
	Container,
	Declare,
	Embed,
	Middlewares,
} from "seyfert";
import { getContextLanguage } from "../utils/i18n";

const CONFIG = {
	GITHUB: {
		API_URL:
			"https://api.github.com/repos/ToddyTheNoobDud/Kenium-Music/commits?per_page=7",
		REPO_URL: "https://github.com/ToddyTheNoobDud/Kenium-Music",
		COMMITS_URL: "https://github.com/ToddyTheNoobDud/Kenium-Music/commits/main",
		ISSUES_URL: "https://github.com/ToddyTheNoobDud/Kenium-Music/issues/new",
	},
	BOT: {
		VERSION: "4.8.0",
		DEVELOPER: "mushroom0162",
		CHANGELOG: `
### Added
- Added new translations: Hindi, French, Arabic, Bengali, Russian and Japanese

### Changed
- Updated dependencies
- Rewrited the db_helper for better performance and speed.
- Misc optimizations for typescript
- Reworked the status UI

### Removed
- Nothing

### Fixed
- Fixed play cache sorting
- Fixed some bugs related to database handling on languages
- Fixed special texts not working.
`,
	},
	COLORS: {
		PRIMARY: 0,
		ERROR: 0xff5252,
	},
	DISPLAY: {
		COMMIT_MESSAGE_MAX_LENGTH: 77, // Optimized for ...
		EMOJIS: {
			RELEASE: "🚀",
			GITHUB: "🔆",
			REPO: "📁",
			COMMITS: "📜",
			ISSUE: "🐛",
		},
	},
} as const;

// Optimized regex patterns (compiled once)
const COMMIT_TYPE_REGEX = /^([a-z]+)(?:\([^)]+\))?:\s*/i;
const COMMIT_MESSAGE_CLEANUP_REGEX = /^\w+(?:\([^)]+\))?:\s*/;

async function fetchCommits(): Promise<any[]> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 4000); // Reduced timeout

	try {
		const response = await fetch(CONFIG.GITHUB.API_URL, {
			headers: {
				Accept: "application/vnd.github.v3+json",
				"User-Agent": "Kenium-Music-Bot",
			},
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			throw new Error(`API Error: ${response.status}`);
		}

		return await response.json();
	} catch (error) {
		clearTimeout(timeoutId);
		if (error.name === "AbortError") {
			throw new Error("Request timeout");
		}
		throw error;
	}
}

function formatCommitMessage(message: string): string {
	if (!message?.trim()) return "No message";

	// Single regex operation instead of match + slice
	const cleanMessage = message.replace(COMMIT_MESSAGE_CLEANUP_REGEX, "");
	const typeMatch = COMMIT_TYPE_REGEX.exec(message);

	// Optimized truncation
	const truncated =
		cleanMessage.length > CONFIG.DISPLAY.COMMIT_MESSAGE_MAX_LENGTH
			? `${cleanMessage.slice(0, CONFIG.DISPLAY.COMMIT_MESSAGE_MAX_LENGTH)}...`
			: cleanMessage;

	return typeMatch
		? `\`${typeMatch[1].toUpperCase()}\` ${truncated}`
		: truncated;
}

function createChangelogEmbed(ctx: CommandContext, commits: any[], thele: any): Container {
	// Pre-calculate timestamp to avoid repeated calls
	const _now = Math.floor(Date.now() / 1000);

	// Build commits string in single pass
	const commitsText = commits
		.map((commit) => {
			const shortSha = commit.sha.slice(0, 7);
			const message = formatCommitMessage(commit.commit.message);
			const author = commit.commit.author.name;
			const timestamp = Math.floor(
				new Date(commit.commit.author.date).getTime() / 1000,
			);

			return `> [\`${shortSha}\`](${commit.html_url}) ${message} by **${author}** <t:${timestamp}:R>`;
		})
		.join("\n");

	const description = `
${CONFIG.BOT.CHANGELOG}

## ${CONFIG.DISPLAY.EMOJIS.GITHUB} ${thele.common.loading}
${commitsText}`;

	return new Container({
		components: [
			{
				type: 10,
				content: `### ${CONFIG.DISPLAY.EMOJIS.RELEASE} Kenium Music v${CONFIG.BOT.VERSION}`,
			},
			{ type: 14, divider: true, spacing: 2 },
			{
				type: 9,
				components: [
					{
						type: 10,
						content: `${description}`,
					},
				],
				accessory: {
					type: 11,
					media: { url: ctx.client.me.avatarURL({ extension: "webp" }) || "" },
				},
			},
			{ type: 14, divider: true, spacing: 2 },
			{
				type: 1,
				components: [
					{
						type: 2,
						label: `${thele.invite.github}${CONFIG.DISPLAY.EMOJIS.REPO}`,
						style: 5,
						url: CONFIG.GITHUB.REPO_URL,
					},
					{
						type: 2,
						label: `${thele.common.next}${CONFIG.DISPLAY.EMOJIS.COMMITS}`,
						style: 5,
						url: CONFIG.GITHUB.COMMITS_URL,
					},
					{
						type: 2,
						label: `${thele.invite.supportServer}${CONFIG.DISPLAY.EMOJIS.ISSUE}`,
						style: 5,
						url: CONFIG.GITHUB.ISSUES_URL,
					},
				],
			},
		],
	});
}

@Declare({
	name: "changelog",
	description: "stuff that my owner coded on me.",
})
@Cooldown({
	type: CooldownType.User,
	interval: 60000, // 1 minute
	uses: {
		default: 2,
	},
})
@Middlewares(["cooldown"])
export default class Changelog extends Command {
	public override async run(ctx: CommandContext): Promise<void> {
		const lang = getContextLanguage(ctx);
		const thele = ctx.t.get(lang);

		try {
			await ctx.deferReply(true);

			const commits = await fetchCommits();
			const embed = createChangelogEmbed(ctx, commits, thele);

			await ctx.editOrReply({
				components: [embed],
				flags: 64 | 32768,
			});
		} catch (error) {
			console.error("Changelog error:", error);

			const errorEmbed = new Embed()
				.setColor(CONFIG.COLORS.ERROR)
				.setTitle(thele.errors.general)
				.setDescription(
					`${thele.errors.commandError}\n\`\`\`\n${error.message || thele.common.unknown}\n\`\`\``,
				)
				.setFooter({
					text: `Made with ❤️ by ${CONFIG.BOT.DEVELOPER}`,
					iconUrl: ctx.client.me.avatarURL(),
				});

			await ctx.editOrReply({ embeds: [errorEmbed] });
		}
	}
}