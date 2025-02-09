import { AttachmentBuilder } from "discord.js";

const PLATFORMS = {
    YOUTUBE: 'youtube',
    SOUNDCLOUD: 'soundcloud',
    SPOTIFY: 'spotify',
};

export const Command = {
    name: "export",
    description: "Export the queue",
    options: [],
    run: async (client, interaction) => {
        const player = client.aqua.players.get(interaction.guildId);
        
        if (!player || player.queue.length === 0) {
            return interaction.reply({ content: player ? "Queue is empty" : "Nothing is playing", flags: 64 });
        }

        if (interaction.guild.members.me.voice.channelId !== interaction.member.voice.channelId) {
            return interaction.reply({ content: "You must be in the same voice channel to use this command.", flags: 64 });
        }

        const tracks = player.queue.map(track => track.info.uri);
        let fileName = 'Kenium_2.7.0';

        let hasYouTube = false, hasSoundCloud = false, hasSpotify = false;

        for (const uri of tracks) {
            if (uri.includes(PLATFORMS.YOUTUBE)) hasYouTube = true;
            if (uri.includes(PLATFORMS.SOUNDCLOUD)) hasSoundCloud = true;
            if (uri.includes(PLATFORMS.SPOTIFY)) hasSpotify = true;
        }

        if (hasYouTube) fileName += '_youtube';
        if (hasSoundCloud) fileName += '_soundcloud';
        if (hasSpotify) fileName += '_spotify';
        fileName += '.txt';

        const attachment = new AttachmentBuilder(Buffer.from(tracks.join('\n')), { name: fileName });
        
        const reply = await interaction.reply({
            files: [attachment],
            content: 'This will be Deleted after 1 minute!\n Pro tip: You can use </import:1305541038496153660> to import the queue'
        });

        const deleteTimeout = setTimeout(async () => {
            try {
                await reply.delete();
            } catch (err) {
                console.error("Failed to delete interaction reply:", err);
            }
        }, 60000);

        interaction.client.on('interactionDelete', () => {
            clearTimeout(deleteTimeout);
        });
    }
};
