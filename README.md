# Kenium 🎧 Your Friendly Discord Music Bot

<p align="center">
  <a href="https://github.com/ToddyTheNoobDud/Kenium-Music">
    <img src="https://img.shields.io/github/stars/ToddyTheNoobDud/Kenium-Music?style=social" alt="GitHub Stars">
  </a>
  <a href="https://github.com/ToddyTheNoobDud/Kenium-Music/fork">
    <img src="https://img.shields.io/github/forks/ToddyTheNoobDud/Kenium-Music?style=social" alt="GitHub Forks">
  </a>
  <a href="https://github.com/ToddyTheNoobDud/Kenium-Music/issues">
    <img src="https://img.shields.io/github/issues/ToddyTheNoobDud/Kenium-Music" alt="Open Issues">
  </a>
  <a href="https://github.com/ToddyTheNoobDud/Kenium-Music/graphs/contributors">
    <img src="https://img.shields.io/github/contributors/ToddyTheNoobDud/Kenium-Music" alt="Contributors">
  </a>
</p>

## What is Kenium?

Kenium is a free, open-source Discord music bot. No paywalls, no vote prompts. Play music with your friends, queue tracks, look up lyrics, or change the sound with filters.

## Features 🚀

| Feature                | Details                                                                                          |
|------------------------|--------------------------------------------------------------------------------------------------|
| **Free sources**       | Play from YouTube, Spotify, SoundCloud, Vimeo, or your own files. No ads.                        |
| **Simple commands**    | `/play [song]`, `/shuffle`, `/clear`, and more, with autocomplete to find songs fast.            |
| **Extras**             | On-the-fly lyrics, playlist export and import, and audio filters like bass boost.                |
| **Fast audio**         | Built on Aqualink, our own Lavalink/Nodelink wrapper, made for speed and stability.                       |
| **Lightweight**        | Written in TypeScript with Seyfert. Low memory use and recovers cleanly from errors.             |

## Project Growth Over Time

<p align="center">
  <a href="https://star-history.com/#ToddyTheNoobDud/Kenium-Music&Date">
    <img src="https://api.star-history.com/svg?repos=ToddyTheNoobDud/Kenium-Music&type=Date&theme=dark" alt="Star History Chart">
  </a>
</p>

## Setup (for self-hosting)

You need three things before starting:

- **Bun** — the bot only runs on Bun, not Node.js. - for now.
- **A running Lavalink v4 server Or Nodelink v3 server** — this is what actually plays the audio.
- **A Discord bot token** and its client ID.

Steps:

1. **Clone the repo:**
   ```bash
   git clone https://github.com/ToddyTheNoobDud/Kenium-Music.git
   ```

2. **Open the folder:**
   ```bash
   cd Kenium-Music
   ```

3. **Install dependencies:**
   ```bash
   bun install
   ```

4. **Copy the example config and fill in your values:**
   ```bash
   cp .env.example .env
   # Open .env and add your Discord token, client ID, and Lavalink/Nodelink details
   ```

5. **Start the bot:**
   ```bash
   bun run startBun
   ```

## Quick Demo Video

<p align="center">
  <a href="https://www.youtube.com/watch?v=tSFp2ESLxyU" target="_blank">
    <img src="https://i3.ytimg.com/vi/tSFp2ESLxyU/hqdefault.jpg" alt="Kenium Tutorial - Click to watch on YouTube" width="560">
  </a>
</p>

> **🎥 Tap the thumbnail for a short tutorial that walks through the basics!**

## What's Next

Planned: more settings you can change per server, and better stability during long sessions without restarts.

## Ways to Help

- ⭐ **Star the repo** if you like it.
- 🍴 **Fork it** and change whatever you want.
- 🔧 **Open issues or send pull requests** with ideas or fixes.

## 🌐 Translations

<p align="center">

| Language                  | Flag | Status                                                           |
|---------------------------|------|------------------------------------------------------------------|
| **English (EN)**          | 🇺🇸   | ![100%](https://img.shields.io/badge/100%25-brightgreen)         |
| **Brazilian Portuguese (BR)** | 🇧🇷   | ![100%](https://img.shields.io/badge/100%25-brightgreen)         |
| **Japanese (JA)**         | 🇯🇵   | ![100%](https://img.shields.io/badge/100%25-brightgreen)         |
| **Russian (RU)**          | 🇷🇺   | ![100%](https://img.shields.io/badge/100%25-brightgreen)         |
| **Arabic (AR)**           | 🇸🇦   | ![100%](https://img.shields.io/badge/100%25-brightgreen)         |
| **Bengali (BN)**          | 🇧🇩   | ![100%](https://img.shields.io/badge/100%25-brightgreen)         |
| **Spanish (ES)**          | 🇪🇸   | ![100%](https://img.shields.io/badge/100%25-brightgreen)         |
| **French (FR)**           | 🇫🇷   | ![100%](https://img.shields.io/badge/100%25-brightgreen)         |
| **Turkish (TR)**          | 🇹🇷   | ![100%](https://img.shields.io/badge/100%25-brightgreen)         |
| **Thai (TH)**             | 🇹🇭   | ![100%](https://img.shields.io/badge/100%25-brightgreen)         |
| **Hindi (HI)**            | 🇮🇳   | ![100%](https://img.shields.io/badge/100%25-brightgreen)         |

</p>

## License

Kenium is under the **[MIT License](LICENSE)**. You can use, change, or share it, just keep the credits ❤️.

---

<p align="center">
  Made by a solo developer, for the community.
</p>
