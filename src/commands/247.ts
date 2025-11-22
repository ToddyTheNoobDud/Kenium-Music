import { Cooldown, CooldownType } from "@slipher/cooldown";
import {
    Command,
    type CommandContext,
    Declare,
    Embed,
    Middlewares,
} from "seyfert";
import { updateGuildSettingsSync, getGuildSettings } from "../utils/db_helper";
import { getContextLanguage } from "../utils/i18n";

@Declare({
    name: "247",
    description: "Toggle 247 mode",
})
@Cooldown({
    type: CooldownType.User,
    interval: 60000,
    uses: { default: 2 },
})
@Middlewares(["cooldown", "checkVoice"])
export default class twentcmds extends Command {
    public override async run(ctx: CommandContext): Promise<void> {
        try {
            const { client } = ctx;
            const lang = getContextLanguage(ctx);
            const t = ctx.t.get(lang);
            const guildId = ctx.guildId!;

            // 1. Get Voice State safely
            // We use '?? null' here to ensure this variable is NEVER undefined
            const voiceState = await ctx.member.voice();
            const currentVoiceId = voiceState?.channelId ?? null;

            // 2. Setup Player
            let player = client.aqua.players.get(guildId);
            if (!player) {
                if (!currentVoiceId) {
                    await ctx.write({ content: "You must be in a voice channel.", flags: 64 });
                    return;
                }

                player = await client.aqua.createConnection({
                    guildId: guildId,
                    voiceChannel: currentVoiceId,
                    textChannel: ctx.channelId,
                    deaf: true,
                    defaultVolume: 65,
                });
            }

            // 3. Get Settings & Toggle
            const guildSettings = getGuildSettings(guildId);
            const currentEnabled = guildSettings.twentyFourSevenEnabled === true;
            const newEnabled = !currentEnabled;

            // 4. Update DB (THE FIX)
            // We check 'newEnabled'. If true, we use the IDs. If false, we use null.
            // Crucially: We add '?? null' again just in case ctx.channelId is undefined.
            updateGuildSettingsSync(guildId, {
                twentyFourSevenEnabled: newEnabled,
                voiceChannelId: newEnabled ? (currentVoiceId ?? null) : null,
                textChannelId: newEnabled ? (ctx.channelId ?? null) : null,
            });

            // 5. Update Nickname
            const botMember = await ctx.me();
            let newNickname: string;

            if (newEnabled) {
                newNickname = botMember.nick
                    ? `${botMember.nick} [24/7]`
                    : `${botMember.user.username} [24/7]`;
            } else {
                newNickname =
                    botMember.nick?.replace(/ ?\[24\/7\]/, "") || botMember.user.username;
            }

            if (botMember.nick !== newNickname) {
                try {
                    await botMember.edit({ nick: newNickname });
                } catch (err) {
                    console.warn('Failed to update nickname:', err);
                }
            }

            // 6. Respond
            const action = newEnabled ? t.common?.enabled : t.common?.disabled;
            const description = newEnabled ? t.mode247?.enabled : t.mode247?.disabled;
            const color = newEnabled ? 0x00ff00 : 0xff0000;

            const embed = new Embed()
                .setTitle(t.mode247?.title || "24/7 Mode")
                .setDescription(description || `24/7 mode has been ${action}`)
                .setColor(color)
                .setTimestamp();

            await ctx.write({ embeds: [embed], flags: 64 });
        } catch (error) {
            console.error("Command Error:", error);
            // Ignore "Unknown Interaction" errors that happen if we take too long
            if ((error as any)?.code === 10062 || (error as any)?.code === 10015) return;
        }
    }
}
