import { Command, type CommandContext, Container, Declare } from "seyfert";
import { ButtonStyle } from "seyfert/lib/types";

import { getContextLanguage } from "../utils/i18n";

const COMMANDS_PER_PAGE = 9;
const EPHEMERAL_FLAG = 64 | 32768;

@Declare({
	name: "help",
	description: "Displays a list of available commands.",
})
export default class HelpCommand extends Command {
	async run(ctx: CommandContext) {
		const commands = Array.from(ctx.client.commands.values).sort((a, b) =>
			a.name.localeCompare(b.name),
		);

		const registeredCommands = await ctx.client.proxy
			.applications(ctx.client.applicationId)
			.commands.get();

		const commandMap = new Map(
			registeredCommands.map((cmd) => [cmd.name, cmd.id]),
		);
		const totalPages = Math.ceil(commands.length / COMMANDS_PER_PAGE);

		let page = 0;
		const container = this._buildContainer(
			commands,
			commandMap,
			page,
			totalPages,
			ctx,
		);

		const message = await ctx.editOrReply(
			{ components: [container], flags: EPHEMERAL_FLAG },
			true,
		);

		const collector = message.createComponentCollector({
			filter: (i) => i.user.id === ctx.author.id && i.isButton(),
			idle: 60_000,
			onStop: async () => {
				const disabled = this._buildContainer(
					commands,
					commandMap,
					page,
					totalPages,
					ctx,
					true,
				);
				await message.edit({ components: [disabled] }).catch(() => null);
			},
		});

		collector.run("help_prev", async (i) => {
			page = Math.max(page - 1, 0);
			const updated = this._buildContainer(
				commands,
				commandMap,
				page,
				totalPages,
				ctx,
			);
			await i.update({ components: [updated] });
		});

		collector.run("help_next", async (i) => {
			page = Math.min(page + 1, totalPages - 1);
			const updated = this._buildContainer(
				commands,
				commandMap,
				page,
				totalPages,
				ctx,
			);
			await i.update({ components: [updated] });
		});
	}

	private _buildContainer(
		commands: any[],
		commandMap: Map<string, string>,
		page: number,
		totalPages: number,
		ctx: CommandContext,
		disabled = false,
	) {
		const start = page * COMMANDS_PER_PAGE;
		const chunk = commands.slice(start, start + COMMANDS_PER_PAGE);

		const fieldValue = chunk
			.map(
				(cmd) =>
					`</${cmd.name}:${commandMap.get(cmd.name) || "unknown"}>: **${cmd.description}**`,
			)
			.join("\n");

		return new Container({
			components: [
				{
					type: 10,
					content: `### Page ${page + 1} of ${totalPages}`,
				},
				{ type: 14, divider: true, spacing: 2 },
				{
					type: 9,
					components: [{ type: 10, content: fieldValue }],
					accessory: {
						type: 11,
						media: {
							url: ctx.client.me.avatarURL({ extension: "webp" }),
						},
					},
				},
				{ type: 14, divider: true, spacing: 2 },
				{
					type: 1, // button row
					components: [
						{
							type: 2,
							custom_id: "help_prev",
							label: "⬅️ Previous",
							style: ButtonStyle.Secondary,
							disabled: disabled || page === 0,
						},
						{
							type: 2,
							custom_id: "help_next",
							label: "Next ➡️",
							style: ButtonStyle.Secondary,
							disabled: disabled || page === totalPages - 1,
						},
					],
				},
			],
			accent_color: 0,
		});
	}
}
