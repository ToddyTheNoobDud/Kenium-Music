import { AttachmentBuilder } from "discord.js";

export const Command = {
    name: "export",
    description: "Export the queue",
    options: [],
    run: async (client, interaction) => {
        try {
            const player = client.manager.players.get(interaction.guildId);
            if (!player) {
                return interaction.reply({ content: "Nothing is playing", ephemeral: true });
            }

            if (player.queue.length == 0) {
                return interaction.reply({ content: "Queue is empty", ephemeral: true });
            }

            const queue = player.queue.map((track, i) => {
                return `${track.uri}`;
            }).join('\n');

            const attachment = new AttachmentBuilder(Buffer.from(queue), { name: `ToddysMusicV2.3.0.txt` });
            await interaction.reply({ files: [attachment], content: 'This will be Deleted after 1 minute!\n Pro tip: You can use </import:1305541038496153660> to import the queue' });
            
            setTimeout(() => {
                interaction.deleteReply();
            }, 60000);
        } catch(error) {
            if(error.code !== 10008) {
                throw error;
            }
            console.log(error);
        }
    }
};

