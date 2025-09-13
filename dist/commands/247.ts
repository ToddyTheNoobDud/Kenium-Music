import { Cooldown, CooldownType } from "@slipher/cooldown";
import {
	Command,
	type CommandContext,
	Declare,
	Embed,
	Middlewares,
} from "seyfert";
import { getGuildSettings, updateGuildSettings } from "../utils/db_helper";
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

			let player = client.aqua.players.get(ctx.guildId!);
			if (!player) {
				player = await client.aqua.createConnection({
					guildId: ctx.guildId!,
					voiceChannel: (await ctx.member.voice()).channelId,
					textChannel: ctx.channelId,
					deaf: true,
					defaultVolume: 65,
				});
			}

			const guildId = ctx.guildId;
			const guildSettings = getGuildSettings(guildId);

			const currentEnabled = guildSettings.twentyFourSevenEnabled === true;
			const newEnabled = !currentEnabled;

			updateGuildSettings(guildId, {
				twentyFourSevenEnabled: newEnabled,
				voiceChannelId: newEnabled
					? (await ctx.member.voice()).channelId
					: null,
				textChannelId: newEnabled ? ctx.channelId : null,
			});

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
				botMember.edit({ nick: newNickname });
			}

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
			console.error(error);
			if (error.code === 10065) return;
		}
	}
}