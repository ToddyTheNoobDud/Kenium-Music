import { Command, type CommandContext, Container, Declare } from "seyfert";
import { getContextLanguage } from "../utils/i18n";
@Declare({
	name: "invite",
	description: "invite kenium cuz yes.",
})
export default class iunvitecmds extends Command {
	public override async run(ctx: CommandContext) {
		const t = ctx.t.get(getContextLanguage(ctx));
		const embedsv2 = new Container({
			components: [
				{ type: 14, divider: true, spacing: 2 },
				{
					type: 10,
					content: `${t.invite.description}
                `.trim(),
				},
				{ type: 14, divider: true, spacing: 2 },
				{
					type: 1,
					components: [
						{
							type: 2,
							style: 5,
							label: t.invite.supportServer,
							emoji: { id: "1413636390415241298", name: "website" },
							url: "https://discord.com/invite/K4CVv84VBC",
						},
						{
							type: 2,
							style: 5,
							emoji: { id: "1413636321557217280", name: "Github" },
							label: "GitHub",
							url: "https://github.com/ToddyTheNoobDud/Kenium-Music",
						},
						{
							type: 2,
							style: 5,
							label: "Website",
							emoji: { id: "1413636728283201566", name: "DiscordI" },
							url: "https://toddythenoobdud.github.io/",
						},
					],
				},
				{ type: 14, divider: true, spacing: 2 },
			],
		});

		await ctx.write({ components: [embedsv2], flags: 64 | 32768 });
	}
}
