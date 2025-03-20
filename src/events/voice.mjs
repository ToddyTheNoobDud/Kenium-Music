import { EmbedBuilder } from "discord.js";

const NO_SONG_ADDED_TIMEOUT = 180000; // 3 minutes
const noSongAddedTimeouts = new Map();

export const Event = {
    name: "voiceStateUpdate",
    runOnce: false,
    async run(client, oldState, newState) {
        if (!client || !oldState || !oldState.guild) return;
        
        const guildId = oldState.guild.id;
        if (!guildId) return;
        
        const player = client.aqua?.players?.get(guildId);
        if (!player) return;

        const botVoiceChannel = player.voiceChannel;
        const botMember = oldState.guild.members.cache.get(client.user.id);
        if (!botMember || !botVoiceChannel) return;
        
        const botVoiceState = botMember.voice;
        if (!botVoiceState?.channelId || botVoiceState.channelId !== botVoiceChannel) {
            return player.destroy();
        }
        
        const voiceChannel = botMember.voice.channel;
        if (voiceChannel && voiceChannel.members.filter(m => !m.user.bot).size === 0) {
            startNoSongAddedTimeout(client, guildId, player);
        } else {
            clearNoSongAddedTimeout(guildId);
        }

        if (!client.aqua._eventListenersRegistered) {
            client.aqua.on('trackStart', (player) => {
                clearNoSongAddedTimeout(player.guild);
            });
            
            client.aqua.on('queueEnd', (player) => {
                startNoSongAddedTimeout(client, player.guild, player);
            });
            client.aqua._eventListenersRegistered = true;
        }

        if (player && !player.playing && !player.paused) {
            startNoSongAddedTimeout(client, guildId, player);
        } else if (player && player.playing) {
            clearNoSongAddedTimeout(guildId);
        }
    },
};

function clearNoSongAddedTimeout(guildId) {
    if (noSongAddedTimeouts.has(guildId)) {
        clearTimeout(noSongAddedTimeouts.get(guildId));
        noSongAddedTimeouts.delete(guildId);
    }
}

async function startNoSongAddedTimeout(client, guildId, player) {
    clearNoSongAddedTimeout(guildId);
    
    noSongAddedTimeouts.set(guildId, setTimeout(async () => {
        try {
            const currentPlayer = client.aqua?.players?.get(guildId);
            if (!currentPlayer) return;
            
            if (currentPlayer.playing) {
                clearNoSongAddedTimeout(guildId);
                return;
            }
            
            if (!currentPlayer.textChannel) return currentPlayer.destroy();
            
            const textChannel = await client.channels.fetch(currentPlayer.textChannel).catch(() => null);
            if (textChannel && textChannel.isTextBased()) {
                const embed = new EmbedBuilder()
                    .setColor(0)
                    .setDescription("No song added in 3 minutes, disconnecting...")
                    .setFooter({ text: "Automatically destroying player" });
                    
                const message = await textChannel.send({ embeds: [embed] }).catch(err => {
                    console.error(`[Music] Failed to send disconnect message: ${err.message}`);
                    return null;
                });
                
                if (message) {
                    setTimeout(() => {
                        message.delete().catch(err => {
                            console.error(`[Music] Failed to delete message: ${err.message}`);
                        });
                    }, 10000);
                }
            }
            
            currentPlayer.destroy();
        } catch (error) {
            console.error(`[Music] Error in disconnect timeout handler: ${error.message}`);
        }
    }, NO_SONG_ADDED_TIMEOUT));
}
