import {
	Command,
	type CommandContext,
	Declare,
	Embed,
	Middlewares,
} from "seyfert";
import { getContextLanguage } from "../utils/i18n";

@Declare({
	name: "grab",
	description: "Grab current song and send to dms. (No VC needed)",
})
@Middlewares(["checkPlayer"])
export default class Grab extends Command {
	private formatDuration(ms: number): string {
		const totalSeconds = Math.floor(ms / 1000);
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes}:${seconds.toString().padStart(2, "0")}`;
	}

	public override async run(ctx: CommandContext) {
		try {
			const { client } = ctx;
			const lang = getContextLanguage(ctx);
			const t = ctx.t.get(lang);

			const player = client.aqua.players.get(ctx.guildId!);

			if (!player?.current) {
				return ctx.write({
					content: t.player?.noTrack || "No song is currently playing.",
					flags: 64,
				});
			}

			const song = player.current;
			const guild = await ctx.guild();

			const nowPlayingTitle = t.player?.nowPlaying?.replace('{title}', song.title) || `🎵 Now Playing: **${song.title}**`;
			const listenHere = t.grab?.listenHere || "🔗 Listen Here";
			const durationLabel = t.grab?.duration || "⏱️ Duration";
			const authorLabel = t.grab?.author || "👤 Author";
			const serverLabel = t.grab?.server || "🏠 Server";
			const footerText = t?.grab?.footer || "Grabbed from your current session";

			const trackEmbed = new Embed()
				.setTitle(nowPlayingTitle)
				.setDescription(`[${listenHere}](${song.uri})`)
				.addFields(
					{
						name: durationLabel,
						value: `\`${this.formatDuration(song.length)}\``,
						inline: true,
					},
					{ name: authorLabel, value: `\`${song.author}\``, inline: true },
					{ name: serverLabel, value: `\`${guild.name}\``, inline: true },
				)
				.setColor(0)
				.setThumbnail(song.thumbnail)
				.setFooter({ text: footerText })
				.setTimestamp();

			try {
				await ctx.author.write({ embeds: [trackEmbed] });
				return ctx.write({
					content: t?.grab?.sentToDm || "✅ I've sent you the track details in your DMs.",
					flags: 64,
				});
			} catch (error) {
				console.error("DM Error:", error);
				return ctx.write({
					content: t?.grab?.dmError || "❌ I couldn't send you a DM. Please check your privacy settings.",
					flags: 64,
				});
			}
		} catch (error) {
			console.error("Grab Command Error:", error);
			if (error.code === 10065) return;

			const lang = getContextLanguage(ctx);
			const t = ctx.t.get(lang);

			return ctx.write({
				content: t?.grab?.dmError || "An error occurred while grabbing the song.",
				flags: 64,
			});
		}
	}
}