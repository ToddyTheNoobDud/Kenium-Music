import { Command, Declare, type CommandContext, Embed, Container } from 'seyfert'

@Declare({
    name: 'invite',
    description: 'invite kenium cuz yes.'
})

export default class iunvitecmds extends Command {
    public override async run(ctx: CommandContext) {
        const embedsv2 = new Container({
            components: [
            { type: 14, divider: true, spacing: 2 },
            {
                type: 10,
                content: `
### **[No Paywalls. No Voting. Just Music.](https://discord.com/oauth2/authorize?client_id=1202232935311495209)**

?? Tired of bots locking features behind paywalls or vote requirements? Kenium is different:

- **Free Forever**: All features, all platforms (YouTube, Spotify, SoundCloud, Vimeo) — no fees, no ads.
- **24/7 Music** : High-quality audio, fast responses, zero downtime.
- **Easy to Use**: Just type /play — instant queue, no complicated setup.
- **Open Source**: Transparent code, always available for review.
- **Unlimited Features**: Playlists, filters, bass boost — all free.
- **Powered by Aqualink**: Fast, stable, and reliable lavalink handler

No cash grabs. No voting. Just press play and enjoy.

**Want more?** Click on the buttons below !
### Don't want more? [\`Click here to invite me\`](https://discord.com/oauth2/authorize?client_id=1202232935311495209)
                `.trim(),
            },
                    { type: 14, divider: true, spacing: 2 },
            {
                type: 1,
                components: [
                {
                    type: 2,
                    style: 5,
                    label: "Support Server",
                    emoji: { id: "1413636390415241298", name: "website" },
                    url: "https://discord.com/invite/K4CVv84VBC"
                },
                {
                    type: 2,
                    style: 5,
                    emoji: { id: "1413636321557217280", name: "Github" },
                    label: "GitHub",
                    url: "https://github.com/ToddyTheNoobDud/Kenium-Music"
                },
                {
                    type: 2,
                    style: 5,
                    label: "Website",
                    emoji: { id: "1413636728283201566", name: "DiscordI" },
                    url: "https://toddythenoobdud.github.io/"
                }
                ],
            },
            { type: 14, divider: true, spacing: 2 },
            ]
        });

        await ctx.write({ components: [embedsv2], flags: 64 | 32768 });
    }
}
