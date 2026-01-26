export default {
	hello: "hello",
	ping: {
		description:
			"**Gateway**: {wsPing}ms\n**Shard**: {shardPing}ms\n**Player**: {playerPing}ms",
		descriptionNoPlayer: "**Gateway**: {wsPing}ms\n**Shard**: {shardPing}ms",
		title: "Ping Information",
	},
	language: {
		set: "Language set to {lang}",
		name: "Language",
		description: "Set the bot's language",
	},
	commands: {
		ping: {
			name: "ping",
			description: "Show the ping with discord",
		},
		language: {
			name: "language",
			description: "Set the bot's language",
		},
		play: {
			name: "play",
			description: "Play a song by search query or URL.",
		},
		"play-file": {
			name: "play-file",
			description: "Play a file from your computer.",
		},
		pause: {
			name: "pause",
			description: "Pause the music",
		},
		resume: {
			name: "resume",
			description: "Resume the music",
		},
		stop: {
			name: "stop",
			description: "Stop the music",
		},
		skip: {
			name: "skip",
			description: "Skip the current song",
		},
		previous: {
			name: "previous",
			description: "Play the previous song",
		},
		queue: {
			name: "queue",
			description: "Show the music queue with controls",
		},
		nowplaying: {
			name: "nowplaying",
			description: "Show currently playing song",
		},
		volume: {
			name: "volume",
			description: "Set the volume",
		},
		clear: {
			name: "clear",
			description: "Clear the music queue",
		},
		shuffle: {
			name: "shuffle",
			description: "Shuffle the queue",
		},
		loop: {
			name: "loop",
			description: "Set loop mode",
		},
		autoplay: {
			name: "autoplay",
			description: "Toggle autoplay",
		},
		filters: {
			name: "filters",
			description: "Apply audio filters",
		},
		jump: {
			name: "jump",
			description: "Jump to a specific position in the queue",
		},
		remove: {
			name: "remove",
			description: "Remove a song from the queue",
		},
		grab: {
			name: "grab",
			description: "Grab current song and send to DMs",
		},
		lyrics: {
			name: "lyrics",
			description: "Get lyrics for the current song",
		},
		export: {
			name: "export",
			description: "Export the queue",
		},
		import: {
			name: "import",
			description: "Import a queue from a file",
		},
		destroy: {
			name: "destroy",
			description: "Destroy the music player",
		},
		"247": {
			name: "247",
			description: "Toggle 24/7 mode",
		},
		changelog: {
			name: "changelog",
			description: "Show bot changelog",
		},
		help: {
			name: "help",
			description: "Show available commands",
		},
		invite: {
			name: "invite",
			description: "Get bot invite link",
		},
		search: {
			name: "search",
			description: "Search for a song on music platforms",
		},
		seek: {
			name: "seek",
			description: "Seek to a specific position in the song",
		},
		restart: {
			name: "restart",
			description: "Restart the music",
		},
		status: {
			name: "status",
			description: "Show bot status",
		},
		tts: {
			name: "tts",
			description: "Generate and send a TTS message",
		},
		karaoke: {
			name: "karaoke",
			description: "Start a karaoke session with synced lyrics",
		},
		roulette: {
			name: "roulette",
			description: "Play a random track from the queue",
		},
	},
	// Music player messages
	player: {
		noVoiceChannel: "You must be in a voice channel to use this command.",
		noPlayer: "No music player found.",
		noTrack: "No track is currently playing.",
		alreadyPaused: "The song is already paused.",
		alreadyResumed: "The song is already playing.",
		paused: "Paused the song.",
		resumed: "Resumed the song.",
		stopped: "Stopped the music.",
		destroyed: "Destroyed the music player.",
		queueEmpty: "The queue is empty.",
		queueCleared: "Cleared the queue.",
		trackAdded: "Added **[{title}]({uri})** to the queue.",
		playlistAdded:
			"Added **[`{name}`]({uri})** playlist ({count} tracks) to the queue.",
		noTracksFound: "No tracks found for the given query.",
		invalidPosition: "Position must be between 1 and {max}.",
		jumpedTo: "Jumped to song {position}.",
		jumpedToSong: 'Jumped to song "{title}".',
		songNotFound: 'Couldn\'t find "{title}" in the queue.',
		alreadyAtPosition: "Already at position 1.",
		alreadyPlaying: '"{title}" is already playing.',
		volumeSet: "Volume set to {volume}%.",
		invalidVolume: "Volume must be between 0 and 100.",
		autoplayEnabled: "Autoplay has been **enabled**.",
		autoplayDisabled: "Autoplay has been **disabled**.",
		loopEnabled: "Loop has been **enabled**.",
		loopDisabled: "Loop has been **disabled**.",
		filterApplied: "Applied **{filter}** filter.",
		filtersCleared: "Cleared all filters.",
		filterInvalid: "Invalid filter.",
		nowPlaying: "Now Playing",
		requestedBy: "Requested by",
		duration: "Duration",
		author: "Author",
		position: "Position",
		volume: "Volume",
		loop: "Loop",
		autoplay: "Autoplay",
		queueSize: "Queue Size",
		enabled: "Enabled",
		disabled: "Disabled",
		none: "None",
		track: "Track",
		queue: "Queue",
		restarted: "Restarted the music",
		shuffled: "Shuffled the queue",
		skipped: "Skipped the song",
		previousPlayed: "Playing the previous song",
		previousAdded: "Added the previous song to the queue",
		volumeChanged: "Changed the volume",
		removedSong: "Removed the song",
		seeked: "Seeked the song",
		fileAdded: "Added to queue",
		noTrackFound: "No track found",
	},
	// 24/7 mode
	mode247: {
		title: "24/7 Mode",
		enabled: "24/7 mode has been enabled",
		disabled: "24/7 mode has been disabled",
	},
	// Export/Import
	export: {
		emptyQueue: "The queue is empty",
		success: "Exported the queue with URLs for import",
	},
	import: {
		emptyFile: "The file is empty",
		noValidTracks: "No valid tracks found in the file",
		importing: "Importing {count} tracks...",
		complete: "Import Complete",
		successfullyImported: "Successfully imported: **{count}** tracks",
		failedToImport: "Failed to import: **{count}** tracks",
		totalQueueSize: "Total queue size: **{count}** tracks",
	},
	// Grab command
	grab: {
		title: "Now Playing: **{title}**",
		listenHere: "[Listen Here]({uri})",
		duration: "Duration",
		author: "Author",
		server: "Server",
		footer: "Grabbed from your current session",
		sentToDm: "I've sent you the track details in your DMs.",
		dmError: "I couldn't send you a DM. Please check your privacy settings.",
		noSongPlaying: "No song is currently playing.",
	},
	// Help command
	help: {
		pageTitle: "Page {current} of {total}",
		previous: "Previous",
		next: "Next",
	},
	// Lyrics command
	lyrics: {
		title: "Lyrics",
		error: "Lyrics Error",
		noLyricsFound: "No lyrics found",
		serviceUnavailable: "Lyrics service unavailable",
		syncedLyrics: "Synced Lyrics",
		textLyrics: "Text Lyrics",
		artist: "Artist",
		noActivePlayer: "No active player found",
	},
	// Jump command
	jump: {
		noSongsInQueue: "No songs in queue",
		specifyPositionOrName:
			"Please specify either a position number or song name",
	},
	// Filter names
	filters: {
		"8d": "8D",
		equalizer: "Equalizer",
		karaoke: "Karaoke",
		timescale: "Timescale",
		tremolo: "Tremolo",
		vibrato: "Vibrato",
		rotation: "Rotation",
		distortion: "Distortion",
		channelMix: "Channel Mix",
		lowPass: "Low Pass",
		bassboost: "Bassboost",
		slowmode: "Slowmode",
		nightcore: "Nightcore",
		vaporwave: "Vaporwave",
		clear: "Clear",
		invalidFilter: "Invalid filter selected.",
	},
	// Search command
	search: {
		noVoiceChannel: "🎵 Join a voice channel first!",
		alreadyConnected: "🎵 I'm already playing music in this channel",
		noResults: "🔍 No results found. Try another platform!",
		trackAdded: "✅ Added to queue",
		searchError: "❌ Search failed. Please try again.",
		genericError: "❌ An error occurred. Please try again.",
		invalidQuery: "❌ Query too short or invalid characters",
		multiSearchStarted: "🔍 Searching across multiple platforms...",
		failedToJoinVoice: "❌ Failed to join voice channel.",
	},
	// Status command
	status: {
		title: "Bot Status",
		systemUptime: "System Uptime",
		systemCpuModel: "System CPU Model",
		systemCpuLoad: "System CPU Load",
		lavalinkUptime: "Lavalink Uptime",
		lavalinkVersion: "Lavalink Version",
		systemMemory: "System Memory",
		systemMemBar: "System Mem Bar",
		lavalinkMemory: "Lavalink Memory",
		lavalinkMemBar: "Lavalink Mem Bar",
		lavalinkCpuLoad: "Lavalink CPU Load",
		lavalinkPlayers: "Lavalink Players",
		lavalinkNodes: "Lavalink Nodes",
		ping: "Ping",
		processMemory: "Process Memory",
	},
	// TTS command
	tts: {
		generated: "Generated TTS message",
	},
	// Karaoke command
	karaoke: {
		error: "Karaoke Error",
		sessionEnded: "Karaoke session ended",
		noActivePlayer: "No active player found",
		sessionAlreadyActive:
			"There is already an active karaoke session in this server. Please wait for it to finish or use the command again to stop the current session.",
		noLyricsAvailable: "No synced lyrics available. Try a different song.",
		playing: "Playing",
		paused: "Paused",
		noLyrics: "No lyrics available",
	},
	// Roulette command
	roulette: {
		playingRandom: "🎲 Playing random track: **{title}** by **{author}**",
		error: "An error occurred while playing random track!",
	},
	// Volume command
	volume: {
		rangeError: "Use a number between `0 - 200`.",
	},
	// Invite command
	invite: {
		title: "No Paywalls. No Voting. Just Music.",
		description: `Tired of bots locking features behind paywalls or vote requirements? Kenium is different:

- **Free Forever**: All features, all platforms (YouTube, Spotify, SoundCloud, Vimeo) – no fees, no ads.
- **24/7 Music**: High-quality audio, fast responses, zero downtime.
- **Easy to Use**: Just type /play – instant queue, no complicated setup.
- **Open Source**: Transparent code, always available for review.
- **Unlimited Features**: Playlists, filters, bass boost – all free.
- **Powered by Aqualink**: Fast, stable, and reliable lavalink handler

No cash grabs. No voting. Just press play and enjoy.

**Want more?** Click on the buttons below!
Don't want more? [\`Click here to invite me\`](https://discord.com/oauth2/authorize?client_id=1202232935311495209)`,
		supportServer: "Support Server",
		github: "GitHub",
		website: "Website",
	},
	// Queue command
	queue: {
		title: "Queue",
		page: "Page {current} of {total}",
		nowPlaying: "🎵 Now Playing",
		comingUp: "📋 Coming Up",
		queueEmpty: "Queue Empty",
		noTracksInQueue:
			"🔭 **No tracks in queue**\n\nUse `/play` to add some music!",
		tip: "*Tip: You can search or use URLs*",
		pause: "Pause",
		resume: "Resume",
		shuffleOn: "Shuffle: On",
		shuffleOff: "Shuffle: Off",
		loopOn: "Loop: On",
		loopOff: "Loop: Off",
		refresh: "Refresh",
		clear: "Clear",
		noActivePlayerFound: "❌ No active player found",
		errorDisplayingQueue: "❌ An error occurred while displaying the queue",
	},
	// Error messages
	errors: {
		general: "An error occurred",
		notFound: "Not found",
		noPermission: "You don't have permission to use this command",
		invalidLanguage: "Invalid language selected",
		databaseError: "Failed to save settings",
		commandError: "An error occurred while executing the command",
		unsupportedContentType: "Unsupported content type.",
	},
	// Success messages
	success: {
		languageSet: "Language successfully changed to **{lang}**!",
		settingsSaved: "Settings saved successfully",
		settingAlradySet: "This setting has already been set",
	},
	// Playlist system
	playlist: {
		create: {
			invalidName: "Invalid Name",
			nameTooLong: "Playlist name must be less than {maxLength} characters.",
			limitReached: "Playlist Limit Reached",
			maxPlaylists: "You can only have a maximum of {max} playlists.",
			exists: "Playlist Exists",
			alreadyExists: 'A playlist named "{name}" already exists!',
			created: "Playlist Created",
			name: "Name",
			status: "Status",
			readyForTracks: "Ready for tracks!",
			addTracks: "Add Tracks",
			viewPlaylist: "View Playlist",
		},
		add: {
			notFound: "Playlist Not Found",
			notFoundDesc: 'No playlist named "{name}" exists!',
			full: "Playlist Full",
			fullDesc: "This playlist has reached the {max}-track limit!",
			nothingAdded: "Nothing Added",
			nothingAddedDesc:
				"No new tracks were added. They may already exist in the playlist or no matches were found.",
			tracksAdded: "Tracks Added",
			trackAdded: "Track Added",
			tracks: "Tracks",
			track: "Track",
			artist: "Artist",
			source: "Source",
			added: "Added",
			total: "Total",
			duration: "Duration",
			addMore: "Add More",
			playNow: "Play Now",
			viewAll: "View All",
			addFailed: "Add Failed",
			addFailedDesc: "Could not add tracks: {error}",
		},
		view: {
			noPlaylists: "No Playlists",
			noPlaylistsDesc: "You haven't created any playlists yet!",
			gettingStarted: "Getting Started",
			gettingStartedDesc: "Use `/playlist create` to make your first playlist!",
			createPlaylist: "Create Playlist",
			yourPlaylists: "Your Playlists",
			yourPlaylistsDesc: "You have **{count}** playlist{plural}",
			choosePlaylist: "Choose a playlist to view...",
			notFound: "Playlist Not Found",
			notFoundDesc: 'No playlist named "{name}" exists!',
			playlistTitle: "Playlist: {name}",
			empty: "This playlist is empty",
			description: "Description",
			noDescription: "No description",
			info: "Info",
			tracks: "Tracks",
			plays: "Plays",
			tracksPage: "Tracks (Page {current}/{total})",
			play: "Play",
			shuffle: "Shuffle",
			manage: "Manage",
			previous: "Previous",
			next: "Next",
		},
		delete: {
			notFound: "Playlist Not Found",
			notFoundDesc: 'No playlist named "{name}" exists!',
			deleted: "Playlist Deleted",
			deletedDesc: 'Successfully deleted playlist "{name}"',
		},
		play: {
			notFound: "Playlist Not Found",
			notFoundDesc: 'No playlist named "{name}" exists!',
			empty: "Empty Playlist",
			emptyDesc: "This playlist has no tracks to play!",
			noVoiceChannel: "No Voice Channel",
			noVoiceChannelDesc: "Join a voice channel to play a playlist",
			loadFailed: "Load Failed",
			loadFailedDesc: "Could not load any tracks from this playlist",
			shuffling: "Shuffling Playlist",
			playing: "Playing Playlist",
			playlist: "Playlist",
			loaded: "Loaded",
			duration: "Duration",
			channel: "Channel",
			mode: "Mode",
			shuffled: "Shuffled",
			sequential: "Sequential",
			playFailed: "Play Failed",
			playFailedDesc: "Could not play playlist. Please try again later.",
		},
		remove: {
			notFound: "Playlist Not Found",
			notFoundDesc: 'No playlist named "{name}" exists!',
			invalidIndex: "Invalid Index",
			invalidIndexDesc: "Track index must be between 1 and {max}",
			removed: "Track Removed",
			removedTrack: "Removed",
			artist: "Artist",
			source: "Source",
			remaining: "Remaining",
		},
		import: {
			invalidFile: "Invalid File",
			invalidFileDesc:
				"The file must contain a valid playlist with name and tracks array.",
			nameConflict: "Name Conflict",
			nameConflictDesc: 'A playlist named "{name}" already exists!',
			imported: "Playlist Imported",
			system: "Playlist System",
			importFailed: "Import Failed",
			importFailedDesc: "Could not import playlist: {error}",
			name: "Name",
			tracks: "Tracks",
			duration: "Duration",
		},
	},
	// Common words
	common: {
		enabled: "enabled",
		disabled: "disabled",
		unknown: "Unknown",
		loading: "Loading...",
		page: "Page",
		of: "of",
		close: "Close",
		previous: "Previous",
		next: "Next",
	},
};
