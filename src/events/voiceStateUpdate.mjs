import { EmbedBuilder } from "discord.js";

const disconnectionCooldowns = new Map();

export const Event = {
    name: "voiceStateUpdate",
    runOnce: false,
    async run(client, oldState, newState) {
        const guildId = oldState.guild.id;
        const player = client.aqua.players.get(guildId);
        if (!player) return;

        if (oldState.channelId && !newState.channelId) {
            const now = Date.now();
            const lastDisconnection = disconnectionCooldowns.get(guildId) || 0;
            
            if (now - lastDisconnection < 120000) {
                console.warn(`Anti spam: ${guildId}`);
                return;
            }

            try {
                const textChannel = await client.channels.fetch(player.textChannel).catch(() => null);

                if (!textChannel) {
                    console.warn(`No text channel found for guild: ${guildId}`);
                    player.destroy();
                    return;
                }

                const dis = new EmbedBuilder()
                    .setColor("Red")
                    .setDescription("No music detected, disconnecting...")
                    .setFooter({ text: "Automatically destroying player in 30 seconds" });

                const message = await textChannel.send({ embeds: [dis] });

                disconnectionCooldowns.set(guildId, now);

                if (disconnectionCooldowns.size > 100) {
                    for (const [key, timestamp] of disconnectionCooldowns.entries()) {
                        if (now - timestamp > 180000) {
                            disconnectionCooldowns.delete(key);
                        }
                    }
                }

                await Promise.race([
                    new Promise(resolve => setTimeout(resolve, 30000)),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 35000))
                ]);

                await Promise.all([
                    message.delete().catch(() => { }),
                    player.destroy()
                ]);

            } catch (error) {
                console.error(`Voice state update error in guild ${guildId}:`, error);
                try {
                    player.destroy();
                } catch (destroyError) {
                    console.error(`Fallback player destruction failed:`, destroyError);
                }
            }
        }
    },
};
