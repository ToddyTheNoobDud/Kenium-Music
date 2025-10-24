import {
	Command,
	type CommandContext,
	Container,
	createStringOption,
	Declare,
	Middlewares,
	Options,
} from "seyfert";
import { MUSIC_PLATFORMS } from "../shared/emojis";
import { getContextLanguage } from "../utils/i18n";

const CONFIG = Object.freeze({
	INTERACTION_TIMEOUT: 45000,
	MAX_RESULTS: 5,
	DEFAULT_PLATFORM: "youtube" as keyof typeof MUSIC_PLATFORMS,
	BUTTON_STYLE_SELECTION: 2,
	MAX_QUERY_LENGTH: 100,
	MIN_QUERY_LENGTH: 2,
});

const REGEX_PATTERNS = Object.freeze({
	CUSTOM_EMOJI: /^<:([a-zA-Z0-9_]+):(\d+)>$/,
	DURATION_PARTS: /(\d+):(\d+)/,
	CLEAN_QUERY: /[^\w\s-]/g,
	WHITESPACE: /\s+/g,
});

const formatDuration = (ms: number): string => {
	if (ms <= 0) return "0:00";
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const parseEmoji = (emoji: string): { name: string; id?: string } | null => {
	const match = REGEX_PATTERNS.CUSTOM_EMOJI.exec(emoji);
	return match ? { name: match[1], id: match[2] } : { name: emoji };
};

const sanitizeQuery = (query: string): string => {
	return query
		.replace(REGEX_PATTERNS.CLEAN_QUERY, "")
		.replace(REGEX_PATTERNS.WHITESPACE, " ")
		.trim()
		.slice(0, CONFIG.MAX_QUERY_LENGTH);
};

@Options({
	query: createStringOption({
		description: "The song you want to search for",
		required: true,
	}),
	platform: createStringOption({
		description: "Choose which platform to search first",
		required: false,
		choices: [
			{ name: "YouTube", value: "youtube" },
			{ name: "SoundCloud", value: "soundcloud" },
			{ name: "Spotify", value: "spotify" },
			{ name: "Deezer", value: "deezer" },
		],
	}),
})
@Middlewares(["checkVoice"])
@Declare({
	name: "search",
	description: "Search for a song on music platforms",
})
export default class SearchCommand extends Command {
	private activeCollectors = new WeakSet<any>();

	public override async run(ctx: CommandContext): Promise<void> {
		const lang = getContextLanguage(ctx);
		const thele = ctx.t.get(lang);
		const { query, platform = "youtube" } = ctx.options as {
			query: string;
			platform?: string;
		};

		// Validate and sanitize query
		const cleanQuery = sanitizeQuery(query);
		if (cleanQuery.length < CONFIG.MIN_QUERY_LENGTH) {
			await ctx.write({ content: thele.search.invalidQuery, flags: 64 });
			return;
		}

		try {
			const player = await this.getOrCreatePlayer(ctx, thele);
			if (!player) return;

			// Get the selected platform or default to YouTube
			const platformKey = platform as keyof typeof MUSIC_PLATFORMS;
			const selectedPlatform =
				MUSIC_PLATFORMS[platformKey] || MUSIC_PLATFORMS.youtube;

			const tracks = await this.searchTracks(
				ctx,
				cleanQuery,
				selectedPlatform.source,
			);

			if (!tracks.length) {
				await ctx.write({ content: thele.search.noResults, flags: 64 });
				return;
			}

			const searchContainer = this.createSearchContainer(
				cleanQuery,
				tracks,
				selectedPlatform,
				thele,
			);
			const message = await ctx.write(
				{ components: [searchContainer], flags: 32768 | 64 },
				true,
			);

			this.setupInteractionHandler(
				message,
				ctx,
				player,
				cleanQuery,
				tracks,
				selectedPlatform,
				thele,
			);
		} catch (error) {
			console.error("Search command error:", error);
			await ctx.write({ content: thele.search.genericError, flags: 64 });
		}
	}

	private async getOrCreatePlayer(ctx: CommandContext, thele: any): Promise<any> {
		let player = ctx.client.aqua.players.get(ctx.interaction.guildId);

		if (!player) {
			const voiceChannel = (await ctx.interaction.member?.voice())?.channelId;
			if (!voiceChannel) {
				await ctx.write({ content: thele.search.noVoiceChannel, flags: 64 });
				return null;
			}

			try {
				player = await ctx.client.aqua.createConnection({
					guildId: ctx.guildId!,
					voiceChannel,
					textChannel: ctx.channelId,
					deaf: true,
					defaultVolume: 65,
				});
			} catch (error) {
				console.error("Failed to create player:", error);
				await ctx.write({
					content: thele.search.failedToJoinVoice,
					flags: 64,
				});
				return null;
			}
		}

		return player;
	}

	private async searchTracks(
		ctx: CommandContext,
		query: string,
		source: string,
	): Promise<any[]> {
		try {
			const result = await ctx.client.aqua.resolve({
				query,
				source,
				requester: ctx.interaction.user,
			});
			return result.tracks?.slice(0, CONFIG.MAX_RESULTS) || [];
		} catch (error) {
			console.error(`Search tracks error for ${source}:`, error);
			return [];
		}
	}

	private createTrackList(tracks: any[], platform: any, thele: any): string {
		return tracks
			.map((track, i) => {
				const emoji = track.platform?.emoji || platform.emoji;
				const title =
					track.info.title.slice(0, 50) +
					(track.info.title.length > 50 ? "..." : "");
				const author = track.info.author || thele.common.unknown;
				return `**${i + 1}.** ${emoji} [\`${title}\`](${track.info.uri}) \`[${formatDuration(track.info.length)}]\`- ${thele.player.author}: ${author}`;
			})
			.join("\n");
	}

	private createSearchContainer(
		query: string,
		tracks: any[],
		platform: any,
		thele: any,
	): Container {
		return new Container({
			components: [
				{
					type: 10,
					content: `### ${platform.emoji} **${platform.name} ${thele.commands.search.name.toUpperCase()}**\n> \`${query}\``,
				},
				{ type: 14, divider: true, spacing: 1 },
				{ type: 10, content: this.createTrackList(tracks, platform, thele) },
				{ type: 14, divider: true, spacing: 2 },
				{ type: 1, components: this.createSelectionButtons(tracks.length) },
				{ type: 14, divider: true, spacing: 2 },
				{ type: 1, components: this.createPlatformButtons(platform) },
			],
			accent_color: platform.color,
		});
	}

	private createMultiPlatformContainer(
		query: string,
		tracks: any[],
		thele: any,
	): Container {
		return new Container({
			components: [
				{
					type: 10,
					content: `### 🎵 **${thele.commands.search.name.toUpperCase()}**\n> \`${query}\``,
				},
				{ type: 14, divider: true, spacing: 1 },
				{ type: 10, content: this.createTrackList(tracks, { emoji: "🎵" }, thele) },
				{ type: 14, divider: true, spacing: 2 },
				{
					type: 1,
					components: this.createSelectionButtons(
						Math.min(tracks.length, CONFIG.MAX_RESULTS),
					),
				},
			],
			accent_color: 0x5865f2,
		});
	}

	private createPlatformButtons(currentPlatform: any): any[] {
		return Object.entries(MUSIC_PLATFORMS).map(([key, platform]) => {
			const emoji = parseEmoji(platform.emoji) || parseEmoji(platform.icon);
			const isActive = platform.name === currentPlatform.name;

			return {
				type: 2,
				custom_id: `ignore_platform_${key.toLowerCase()}`,
				label: platform.name,
				...(emoji && { emoji }),
				style: isActive ? 4 : platform.style,
				disabled: isActive,
			};
		});
	}

	private createSelectionButtons(count: number): any[] {
		return Array.from(
			{ length: Math.min(count, CONFIG.MAX_RESULTS) },
			(_, i) => ({
				type: 2,
				custom_id: `ignore_select_${i}`,
				label: `${i + 1}`,
				emoji: { name: "▶️" },
				style: CONFIG.BUTTON_STYLE_SELECTION,
			}),
		);
	}

	private setupInteractionHandler(
		message: any,
		ctx: CommandContext,
		player: any,
		query: string,
		tracks: any[],
		currentPlatform: any,
		thele: any,
	): void {
		const collector = message.createComponentCollector({
			filter: (i: any) => i.user.id === ctx.interaction.user.id,
			idle: CONFIG.INTERACTION_TIMEOUT,
			onStop: () => {
				this.activeCollectors.delete(collector);
				message
					.delete?.()
					.catch(() => message.edit?.({ components: [] }).catch(() => {}));
			},
		});

		this.activeCollectors.add(collector);

		// Handle track selection
		for (let i = 0; i < Math.min(tracks.length, CONFIG.MAX_RESULTS); i++) {
			collector.run(`ignore_select_${i}`, async (interaction: any) => {
				try {
					await interaction.deferUpdate();
					await this.handleTrackSelection(interaction, player, tracks, thele);
				} catch (error) {
					console.error("Track selection error:", error);
				}
			});
		}

		// Handle platform switching
		Object.keys(MUSIC_PLATFORMS).forEach((key) => {
			collector.run(
				`ignore_platform_${key.toLowerCase()}`,
				async (interaction: any) => {
					try {
						await interaction.deferUpdate();
						await this.handlePlatformSwitch(
							interaction,
							ctx,
							query,
							tracks,
							currentPlatform,
							message,
							thele,
						);
					} catch (error) {
						console.error("Platform switch error:", error);
					}
				},
			);
		});
	}

	private setupMultiPlatformHandler(
		message: any,
		ctx: CommandContext,
		player: any,
		tracks: any[],
		thele: any,
	): void {
		const collector = message.createComponentCollector({
			filter: (i: any) => i.user.id === ctx.interaction.user.id,
			idle: CONFIG.INTERACTION_TIMEOUT,
			onStop: () => {
				this.activeCollectors.delete(collector);
				message
					.delete?.()
					.catch(() => message.edit?.({ components: [] }).catch(() => {}));
			},
		});

		this.activeCollectors.add(collector);

		// Handle track selection for multi-platform
		for (let i = 0; i < Math.min(tracks.length, CONFIG.MAX_RESULTS); i++) {
			collector.run(`ignore_select_${i}`, async (interaction: any) => {
				try {
					await interaction.deferUpdate();
					await this.handleTrackSelection(interaction, player, tracks, thele);
				} catch (error) {
					console.error("Multi-platform track selection error:", error);
				}
			});
		}
	}

	private async handleTrackSelection(
		i: any,
		player: any,
		tracks: any[],
		thele: any,
	): Promise<void> {
		const trackIndex = parseInt(i.customId.split("_")[2], 10);
		const track = tracks[trackIndex];

		if (track) {
			player.queue.add(track);
			await i.followup(
				{
					content: `${thele.search.trackAdded}: **${track.info.title.slice(0, 30)}${track.info.title.length > 30 ? "..." : ""}**`,
					flags: 64,
				},
				true,
			);

			if (!player.playing && !player.paused && player.queue.size > 0) {
				player.play();
			}
		}
	}

	private async handlePlatformSwitch(
		i: any,
		ctx: CommandContext,
		query: string,
		tracks: any[],
		currentPlatform: any,
		_message: any,
		thele: any,
	): Promise<void> {
		const platformKey = i.customId.split("_")[2] as keyof typeof MUSIC_PLATFORMS;
		const newPlatform = MUSIC_PLATFORMS[platformKey];
		if (!newPlatform || newPlatform.name.toUpperCase() === currentPlatform.name.toUpperCase()) {
			return;
		}

		try {
			const newTracks = await this.searchTracks(ctx, query, newPlatform.source);

			if (newTracks.length) {
				tracks.length = 0;
				tracks.push(...newTracks);

				const searchContainer = this.createSearchContainer(
					query,
					newTracks,
					newPlatform,
					thele,
				)
				await i.editOrReply({ components: [searchContainer], flags: 32768 });
			} else {
				await i.followup({ content: thele.search.noResults, flags: 64 }, true);
			}
		} catch (error) {
			console.error(`Platform switch error:`, error);
			await i.followup({ content: thele.search.searchError, flags: 64 }, true);
		}
	}
}