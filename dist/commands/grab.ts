import { Command, Declare, type CommandContext, Embed, Middlewares  } from "seyfert";

@Declare({
    name: 'grab',
    description: 'Grab current song and send to dms. (No VC needed)',
})
@Middlewares(['checkPlayer'])
export default class Grab extends Command {
    private formatDuration(ms: number): string {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    public override async run(ctx: CommandContext) {
        try {
            const { client } = ctx;
            const player = client.aqua.players.get(ctx.guildId!);

            if (!player?.current) {
                return ctx.write({ content: "No song is currently playing.", flags: 64 });
            }

            const song = player.current;
            const guild = await ctx.guild();
            const trackEmbed = new Embed()
                .setTitle(`🎵 Now Playing: **${song.title}**`)
                .setDescription(`[🔗 Listen Here](${song.uri})`)
                .addFields(
                    { name: "⏱️ Duration", value: `\`${this.formatDuration(song.length)}\``, inline: true },
                    { name: "👤 Author", value: `\`${song.author}\``, inline: true },
                    { name: "🏠 Server", value: `\`${guild.name}\``, inline: true },
                )
                .setColor(0)
                .setThumbnail(song.thumbnail)
                .setFooter({ text: "Grabbed from your current session" })
                .setTimestamp();

            try {
                await ctx.author.write({ embeds: [trackEmbed] });
                return ctx.write({ content: "✅ I've sent you the track details in your DMs.", flags: 64 });
            } catch (error) {
                console.error('DM Error:', error);
                return ctx.write({ content: "❌ I couldn't send you a DM. Please check your privacy settings.", flags: 64 });
            }

        } catch (error) {
            console.error('Grab Command Error:', error);
            if (error.code === 10065) return;
            return ctx.write({ content: "An error occurred while grabbing the song.", flags: 64 });
        }
    }
}
