import { createMiddleware, Embed } from "seyfert";

export const checkPlayer = createMiddleware<void>(
	async ({ context, pass, next }) => {
		if (!context.inGuild()) return next();

		const { client } = context;

		const player = client.aqua.players.get(context.guildId!);

		if (!player) {
			await context.editOrReply({
				flags: 64,
				embeds: [
					new Embed()
						.setColor(0)
						.setDescription(
							`**[❌ | No active \`player\` found.](https://discord.com/oauth2/authorize?client_id=1202232935311495209)**`,
						),
				],
			});
			return pass();
		}

		next();
	},
);

export const checkVoice = createMiddleware<void>(
	async ({ context, pass, next }) => {
		if (!context.inGuild()) return next();

		const memberVoice = await context.member?.voice().catch(() => null);
		const botvoice = await (await context.me()).voice().catch(() => null);
		if (
			!memberVoice ||
			(botvoice && botvoice.channelId !== memberVoice.channelId)
		)
			return pass();

		next();
	},
);

export const checkTrack = createMiddleware<void>(
	async ({ context, pass, next }) => {
		if (!context.inGuild()) return next();

		const { client } = context;

		const player = client.aqua.players.get(context.guildId!);

		if (!player?.current) {
			await context.editOrReply({
				flags: 64,
				embeds: [
					new Embed()
						.setColor(0)
						.setDescription(
							`**[❌ | No active \`track\` found.](https://discord.com/oauth2/authorize?client_id=1202232935311495209)**`,
						),
				],
			});
			return pass();
		}

		next();
	},
);
