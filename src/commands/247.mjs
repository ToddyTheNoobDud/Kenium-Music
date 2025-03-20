import { EmbedBuilder } from 'discord.js';
import { SimpleDB } from '../utils/simpleDB.mjs';

const db = new SimpleDB();
const settingsCollection = db.collection('guildSettings');

export const Command = {
    name: "24_7",
    description: "Enables/disables 24/7 mode to keep the bot in voice channel",
    run: async (client, interaction) => {
        if (!interaction.member.voice.channel) {
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setDescription("You need to be in a voice channel to use this command")
                        .setColor(0xFF0000)
                ],
                flags: 64
            });
        }
        
        await client.aqua.players.get(interaction.guildId) || await client.aqua.createConnection({
            guildId: interaction.guildId,
            voiceChannel: interaction.member.voice.channelId,
            textChannel: interaction.channelId
        });
        
        if (interaction.guild.members.me.voice.channelId && 
            interaction.guild.members.me.voice.channelId !== interaction.member.voice.channelId) {
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setDescription("You need to be in the same voice channel as me")
                        .setColor(0xFF0000)
                ],
                flags: 64
            });
        }
        
        const guildId = interaction.guildId;
        let guildSettings = settingsCollection.findOne({ guildId });
        
        if (!guildSettings) {
            guildSettings = {
                guildId,
                twentyFourSevenEnabled: false,
                voiceChannelId: null,
                textChannelId: null
            };
            settingsCollection.insert(guildSettings);
        }
        
        const isEnabled = guildSettings.twentyFourSevenEnabled;
        
        if (isEnabled) {
            settingsCollection.update(
                { guildId }, 
                { 
                    twentyFourSevenEnabled: false,
                    voiceChannelId: null,
                    textChannelId: null
                }
            );
            
            const botMember = interaction.guild.members.me;
            const newNickname = botMember.nickname?.replace(/ ?\[24\/7\]/u, "") || botMember.user.username;
            await botMember.setNickname(newNickname);
            
            const embed = new EmbedBuilder()
                .setTitle("24/7 Mode")
                .setDescription("24/7 mode has been disabled")
                .setColor(0xFF0000)
                .setTimestamp();
                
            return interaction.reply({ embeds: [embed] });
        } else {
            settingsCollection.update(
                { guildId }, 
                { 
                    twentyFourSevenEnabled: true,
                    voiceChannelId: interaction.member.voice.channelId,
                    textChannelId: interaction.channelId
                }
            );
            
            const botMember = interaction.guild.members.me;
            const newNickname = botMember.nickname ? `${botMember.nickname} [24/7]` : `${botMember.user.username} [24/7]`;
            await botMember.setNickname(newNickname);
            
            const embed = new EmbedBuilder()
                .setTitle("24/7 Mode")
                .setDescription("24/7 mode has been enabled")
                .setColor(0x00FF00)
                .setTimestamp();
                
            return interaction.reply({ embeds: [embed] });
        }
    }
};

export function isTwentyFourSevenEnabled(guildId) {
    const guildSettings = settingsCollection.findOne({ guildId });
    return guildSettings?.twentyFourSevenEnabled || false;
}

export function getChannelIds(guildId) {
    const guildSettings = settingsCollection.findOne({ guildId });
    if (guildSettings?.twentyFourSevenEnabled) {
        return {
            voiceChannelId: guildSettings.voiceChannelId,
            textChannelId: guildSettings.textChannelId
        };
    }
    return null;
}
