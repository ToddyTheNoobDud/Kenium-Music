import { SimpleDB } from '../utils/simpleDB.mjs'

const db = new SimpleDB();
const settingsCollection = db.collection('guildSettings');

export const Event = {
    name: "ready",
    runOnce: true,
    run: async (client) => {
        client.aqua.init(client.user.id);

        client.user.setActivity({ name: "🌟Made by mushroom0162, Kenium", type: 2, state: "🌊 Powered by AquaLink" });
 
        client.user.setStatus("idle");
        console.log(`logged in ${client.user.tag}`)
        try {
            const guildsWithTwentyFourSeven = settingsCollection.find({ twentyFourSevenEnabled: true });
            
            if (guildsWithTwentyFourSeven.length > 0) {
                setTimeout(async () => {
                    for (const guildSettings of guildsWithTwentyFourSeven) {
                        const { guildId, voiceChannelId, textChannelId } = guildSettings;
                        if (!voiceChannelId || !textChannelId) continue;
                        
                        try {
                            const guild = await client.guilds.fetch(guildId).catch(() => null);
                            if (!guild) continue;
                            
                            const voiceChannel = await guild.channels.fetch(voiceChannelId).catch(() => null);
                            if (!voiceChannel || !voiceChannel.isVoiceBased()) {
                                continue;
                            }
                            
                            await client.aqua.createConnection({
                                guildId: guildId,
                                voiceChannel: voiceChannelId,
                                textChannel: textChannelId,
                                deaf: true
                            });
                            
                            
                            const botMember = guild.members.me;
                            if (botMember && !botMember.nickname?.includes("[24/7]")) {
                                const newNickname = botMember.nickname 
                                    ? `${botMember.nickname} [24/7]` 
                                    : `${botMember.user.username} [24/7]`;
                                    
                                await botMember.setNickname(newNickname).catch(err => {
                                    console.error(`[Music] Failed to update nickname in guild ${guildId}: ${err.message}`);
                                });
                            }
                        } catch (error) {
                            console.error(`[Music] Error auto-joining voice channel in guild ${guildId}: ${error.message}`);
                        }
                    }
                }, 6000);
            }
        } catch (error) {
            console.error(`[Music] Error during auto-join process: ${error.message}`);
        }
    }
}
