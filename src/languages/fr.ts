import type English from "./en";

export default {
    hello: "bonjour",
    ping: {
        description: "**Passerelle**: {wsPing}ms\n**Fragment**: {shardPing}ms\n**Lecteur**: {playerPing}ms",
        title: "Informations de Ping"
    },
    language: {
        set: "Langue définie sur {lang}",
        name: "Langue",
        description: "Définir la langue du bot"
    },
    commands: {
        ping: {
            name: "ping",
            description: "Afficher le ping avec Discord"
        },
        language: {
            name: "langue",
            description: "Définir la langue du bot"
        },
        play: {
            name: "jouer",
            description: "Jouer une chanson par recherche ou URL."
        },
        "play-file": {
            name: "jouer-fichier",
            description: "Jouer un fichier depuis votre ordinateur."
        },
        pause: {
            name: "pause",
            description: "Mettre en pause la musique"
        },
        resume: {
            name: "reprendre",
            description: "Reprendre la musique"
        },
        stop: {
            name: "arrêter",
            description: "Arrêter la musique"
        },
        skip: {
            name: "passer",
            description: "Passer la chanson actuelle"
        },
        previous: {
            name: "précédent",
            description: "Jouer la chanson précédente"
        },
        queue: {
            name: "file",
            description: "Afficher la file de musique avec contrôles"
        },
        nowplaying: {
            name: "encours",
            description: "Afficher la chanson en cours de lecture"
        },
        volume: {
            name: "volume",
            description: "Définir le volume"
        },
        clear: {
            name: "vider",
            description: "Vider la file de musique"
        },
        shuffle: {
            name: "mélanger",
            description: "Mélanger la file"
        },
        loop: {
            name: "boucle",
            description: "Définir le mode boucle"
        },
        autoplay: {
            name: "lectureauto",
            description: "Basculer la lecture automatique"
        },
        filters: {
            name: "filtres",
            description: "Appliquer des filtres audio"
        },
        jump: {
            name: "aller",
            description: "Aller à une position spécifique dans la file"
        },
        remove: {
            name: "supprimer",
            description: "Supprimer une chanson de la file"
        },
        grab: {
            name: "prendre",
            description: "Prendre la chanson actuelle et envoyer en MP"
        },
        lyrics: {
            name: "paroles",
            description: "Obtenir les paroles de la chanson actuelle"
        },
        export: {
            name: "exporter",
            description: "Exporter la file"
        },
        import: {
            name: "importer",
            description: "Importer une file depuis un fichier"
        },
        destroy: {
            name: "détruire",
            description: "Détruire le lecteur de musique"
        },
        "247": {
            name: "247",
            description: "Basculer le mode 24/7"
        },
        changelog: {
            name: "changelog",
            description: "Afficher le changelog du bot"
        },
        help: {
            name: "aide",
            description: "Afficher les commandes disponibles"
        },
        invite: {
            name: "inviter",
            description: "Obtenir le lien d'invitation du bot"
        },
        search: {
            name: "rechercher",
            description: "Rechercher une chanson sur les plateformes musicales"
        },
        seek: {
            name: "chercher",
            description: "Aller à une position spécifique dans la chanson"
        },
        restart: {
            name: "redémarrer",
            description: "Redémarrer la musique"
        },
        status: {
            name: "statut",
            description: "Afficher le statut du bot"
        },
        tts: {
            name: "tts",
            description: "Générer et envoyer un message TTS"
        }
    },
    // Messages du lecteur de musique
    player: {
        noVoiceChannel: "Vous devez être dans un canal vocal pour utiliser cette commande.",
        noPlayer: "Aucun lecteur de musique trouvé.",
        noTrack: "Aucune piste n'est actuellement en cours de lecture.",
        alreadyPaused: "La chanson est déjà en pause.",
        alreadyResumed: "La chanson est déjà en cours de lecture.",
        paused: "Chanson mise en pause.",
        resumed: "Chanson reprise.",
        stopped: "Musique arrêtée.",
        destroyed: "Lecteur de musique détruit.",
        queueEmpty: "La file est vide.",
        queueCleared: "File vidée.",
        trackAdded: "Ajouté **[{title}]({uri})** à la file.",
        playlistAdded: "Ajouté la playlist **[`{name}`]({uri})** ({count} pistes) à la file.",
        noTracksFound: "Aucune piste trouvée pour la requête donnée.",
        invalidPosition: "La position doit être entre 1 et {max}.",
        jumpedTo: "Sauté à la chanson {position}.",
        jumpedToSong: "Sauté à la chanson \"{title}\".",
        songNotFound: "Impossible de trouver \"{title}\" dans la file.",
        alreadyAtPosition: "Déjà à la position 1.",
        alreadyPlaying: "\"{title}\" est déjà en cours de lecture.",
        volumeSet: "Volume défini à {volume}%.",
        invalidVolume: "Le volume doit être entre 0 et 100.",
        autoplayEnabled: "La lecture automatique a été **activée**.",
        autoplayDisabled: "La lecture automatique a été **désactivée**.",
        loopEnabled: "La boucle a été **activée**.",
        loopDisabled: "La boucle a été **désactivée**.",
        filterApplied: "Filtre **{filter}** appliqué.",
        filtersCleared: "Tous les filtres ont été supprimés.",
        filterInvalid: "Filtre invalide.",
        nowPlaying: "En Cours de Lecture",
        requestedBy: "Demandé par",
        duration: "Durée",
        author: "Auteur",
        position: "Position",
        volume: "Volume",
        loop: "Boucle",
        autoplay: "Lecture Automatique",
        queueSize: "Taille de la File",
        enabled: "Activé",
        disabled: "Désactivé",
        none: "Aucun",
        track: "Piste",
        queue: "File",
        restarted: "Musique redémarrée",
        shuffled: "File mélangée",
        skipped: "Chanson passée",
        previousPlayed: "Lecture de la chanson précédente",
        previousAdded: "Chanson précédente ajoutée",
        volumeChanged: "Volume modifié",
        removedSong: "Chanson supprimée",
        seeked: "Position recherchée dans la chanson",
        fileAdded: "Ajouté à la file",
        noTrackFound: "Aucune piste trouvée"
    },
    // Mode 24/7
    mode247: {
        title: "Mode 24/7",
        enabled: "Le mode 24/7 a été activé",
        disabled: "Le mode 24/7 a été désactivé"
    },
    // Exporter/Importer
    export: {
        emptyQueue: "La file est vide",
        success: "File exportée avec URLs pour l'importation"
    },
    import: {
        emptyFile: "Le fichier est vide",
        noValidTracks: "Aucune piste valide trouvée dans le fichier",
        importing: "Importation de {count} pistes...",
        complete: "Importation Terminée",
        successfullyImported: "Importé avec succès : **{count}** pistes",
        failedToImport: "Échec d'importation : **{count}** pistes",
        totalQueueSize: "Taille totale de la file : **{count}** pistes"
    },
    // Commande prendre (grab)
    grab: {
        title: "En Cours de Lecture : **{title}**",
        listenHere: "[Écouter Ici]({uri})",
        duration: "Durée",
        author: "Auteur",
        server: "Serveur",
        footer: "Pris de votre session actuelle",
        sentToDm: "Je vous ai envoyé les détails de la piste en MP.",
        dmError: "Je n'ai pas pu vous envoyer un MP. Veuillez vérifier vos paramètres de confidentialité.",
        noSongPlaying: "Aucune chanson n'est actuellement en cours de lecture."
    },
    // Commande aide (help)
    help: {
        pageTitle: "Page {current} sur {total}",
        previous: "Précédent",
        next: "Suivant"
    },
    // Commande paroles (lyrics)
    lyrics: {
        title: "Paroles",
        error: "Erreur de Paroles",
        noLyricsFound: "Aucune parole trouvée",
        serviceUnavailable: "Service de paroles indisponible",
        syncedLyrics: "Paroles Synchronisées",
        textLyrics: "Paroles Texte",
        artist: "Artiste",
        noActivePlayer: "Aucun lecteur actif trouvé"
    },
    // Commande aller (jump)
    jump: {
        noSongsInQueue: "Aucune chanson dans la file",
        specifyPositionOrName: "Veuillez spécifier un numéro de position ou un nom de chanson"
    },
    // Noms des filtres
    filters: {
        "8d": "8D",
        equalizer: "Égaliseur",
        karaoke: "Karaoké",
        timescale: "Échelle Temporelle",
        tremolo: "Trémolo",
        vibrato: "Vibrato",
        rotation: "Rotation",
        distortion: "Distorsion",
        channelMix: "Mixage de Canaux",
        lowPass: "Passe-Bas",
        bassboost: "Amplification des Basses",
        slowmode: "Mode Lent",
        nightcore: "Nightcore",
        vaporwave: "Vaporwave",
        clear: "Effacer",
        invalidFilter: "Filtre sélectionné invalide."
    },
    // Commande rechercher (search)
    search: {
        noVoiceChannel: "🎵 Rejoignez d'abord un canal vocal !",
        alreadyConnected: "🎵 Je joue déjà de la musique dans ce canal",
        noResults: "🔍 Aucun résultat trouvé. Essayez une autre plateforme !",
        trackAdded: "✅ Ajouté à la file",
        searchError: "❌ Recherche échouée. Veuillez réessayer.",
        genericError: "❌ Une erreur s'est produite. Veuillez réessayer.",
        invalidQuery: "❌ Requête trop courte ou caractères invalides",
        multiSearchStarted: "🔍 Recherche sur plusieurs plateformes...",
        failedToJoinVoice: "❌ Échec de connexion au canal vocal."
    },
    // Commande statut
    status: {
        title: "Statut du Bot",
        systemUptime: "Temps de Fonctionnement du Système",
        systemCpuModel: "Modèle CPU du Système",
        systemCpuLoad: "Charge CPU du Système",
        lavalinkUptime: "Temps de Fonctionnement Lavalink",
        lavalinkVersion: "Version Lavalink",
        systemMemory: "Mémoire Système",
        systemMemBar: "Barre Mémoire Système",
        lavalinkMemory: "Mémoire Lavalink",
        lavalinkMemBar: "Barre Mémoire Lavalink",
        lavalinkCpuLoad: "Charge CPU Lavalink",
        lavalinkPlayers: "Lecteurs Lavalink",
        lavalinkNodes: "Nœuds Lavalink",
        ping: "Ping",
        processMemory: "Mémoire du Processus"
    },
    // Commande TTS
    tts: {
        generated: "Message TTS généré"
    },
    // Commande volume
    volume: {
        rangeError: "Utilisez un nombre entre `0 - 200`."
    },
    // Commande inviter (invite)
    invite: {
        title: "Pas de Paywall. Pas de Vote. Juste de la Musique.",
        description: `Marre des bots qui verrouillent les fonctionnalités derrière des paywalls ou des exigences de vote ? Kenium est différent :

- **Gratuit Pour Toujours** : Toutes les fonctionnalités, toutes les plateformes (YouTube, Spotify, SoundCloud, Vimeo) — pas de frais, pas de publicités.
- **Musique 24/7** : Audio haute qualité, réponses rapides, zéro temps d'arrêt.
- **Facile à Utiliser** : Tapez simplement /jouer — file instantanée, pas de configuration compliquée.
- **Open Source** : Code transparent, toujours disponible pour révision.
- **Fonctionnalités Illimitées** : Playlists, filtres, amplification des basses — tout gratuit.
- **Propulsé par Aqualink** : Gestionnaire lavalink rapide, stable et fiable

Pas d'arnaques. Pas de vote. Appuyez simplement sur play et profitez.

**Vous en voulez plus ?** Cliquez sur les boutons ci-dessous !
Vous n'en voulez pas plus ? [\`Cliquez ici pour m'inviter\`](https://discord.com/oauth2/authorize?client_id=1202232935311495209)`,
        supportServer: "Serveur de Support",
        github: "GitHub",
        website: "Site Web"
    },
    // Commande file (queue)
    queue: {
        title: "File",
        page: "Page {current} sur {total}",
        nowPlaying: "🎵 En Cours de Lecture",
        comingUp: "📋 À Venir",
        queueEmpty: "File Vide",
        noTracksInQueue: "🔭 **Aucune piste dans la file**\n\nUtilisez `/jouer` pour ajouter de la musique !",
        tip: "*Astuce : Vous pouvez rechercher ou utiliser des URLs*",
        pause: "Pause",
        resume: "Reprendre",
        shuffleOn: "Mélange : Activé",
        shuffleOff: "Mélange : Désactivé",
        loopOn: "Boucle : Activée",
        loopOff: "Boucle : Désactivée",
        refresh: "Actualiser",
        clear: "Vider",
        noActivePlayerFound: "❌ Aucun lecteur actif trouvé",
        errorDisplayingQueue: "❌ Une erreur s'est produite lors de l'affichage de la file"
    },
    // Messages d'erreur
    errors: {
        general: "Une erreur s'est produite",
        notFound: "Non trouvé",
        noPermission: "Vous n'avez pas la permission d'utiliser cette commande",
        invalidLanguage: "Langue sélectionnée invalide",
        databaseError: "Échec de sauvegarde des paramètres",
        commandError: "Une erreur s'est produite lors de l'exécution de la commande",
        unsupportedContentType: "Type de contenu non supporté."
    },
    // Messages de succès
    success: {
        languageSet: "Langue changée avec succès pour **{lang}** !",
        settingsSaved: "Paramètres sauvegardés avec succès",
        settingAlradySet: "Ce paramètre a déjà été défini"
    },
    // Système de playlist
    playlist: {
        create: {
            invalidName: "Nom Invalide",
            nameTooLong: "Le nom de la playlist doit faire moins de {maxLength} caractères.",
            limitReached: "Limite de Playlist Atteinte",
            maxPlaylists: "Vous ne pouvez avoir qu'un maximum de {max} playlists.",
            exists: "La Playlist Existe",
            alreadyExists: "Une playlist nommée \"{name}\" existe déjà !",
            created: "Playlist Créée",
            name: "Nom",
            status: "Statut",
            readyForTracks: "Prêt pour les pistes !",
            addTracks: "Ajouter des Pistes",
            viewPlaylist: "Voir la Playlist"
        },
        add: {
            notFound: "Playlist Non Trouvée",
            notFoundDesc: "Aucune playlist nommée \"{name}\" n'existe !",
            full: "Playlist Pleine",
            fullDesc: "Cette playlist a atteint la limite de {max} pistes !",
            nothingAdded: "Rien Ajouté",
            nothingAddedDesc: "Aucune nouvelle piste n'a été ajoutée. Elles peuvent déjà exister dans la playlist ou aucune correspondance n'a été trouvée.",
            tracksAdded: "Pistes Ajoutées",
            trackAdded: "Piste Ajoutée",
            tracks: "Pistes",
            track: "Piste",
            artist: "Artiste",
            source: "Source",
            added: "Ajoutée",
            total: "Total",
            duration: "Durée",
            addMore: "Ajouter Plus",
            playNow: "Jouer Maintenant",
            viewAll: "Voir Tout",
            addFailed: "Ajout Échoué",
            addFailedDesc: "Impossible d'ajouter des pistes : {error}"
        },
        view: {
            noPlaylists: "Aucune Playlist",
            noPlaylistsDesc: "Vous n'avez encore créé aucune playlist !",
            gettingStarted: "Premiers Pas",
            gettingStartedDesc: "Utilisez `/playlist create` pour créer votre première playlist !",
            createPlaylist: "Créer une Playlist",
            yourPlaylists: "Vos Playlists",
            yourPlaylistsDesc: "Vous avez **{count}** playlist{plural}",
            choosePlaylist: "Choisissez une playlist à voir...",
            notFound: "Playlist Non Trouvée",
            notFoundDesc: "Aucune playlist nommée \"{name}\" n'existe !",
            playlistTitle: "Playlist : {name}",
            empty: "Cette playlist est vide",
            description: "Description",
            noDescription: "Aucune description",
            info: "Info",
            tracks: "Pistes",
            plays: "Lectures",
            tracksPage: "Pistes (Page {current}/{total})",
            play: "Jouer",
            shuffle: "Mélanger",
            manage: "Gérer",
            previous: "Précédent",
            next: "Suivant"
        },
        delete: {
            notFound: "Playlist Non Trouvée",
            notFoundDesc: "Aucune playlist nommée \"{name}\" n'existe !",
            deleted: "Playlist Supprimée",
            deletedDesc: "Playlist \"{name}\" supprimée avec succès"
        },
        play: {
            notFound: "Playlist Non Trouvée",
            notFoundDesc: "Aucune playlist nommée \"{name}\" n'existe !",
            empty: "Playlist Vide",
            emptyDesc: "Cette playlist n'a aucune piste à jouer !",
            noVoiceChannel: "Aucun Canal Vocal",
            noVoiceChannelDesc: "Rejoignez un canal vocal pour jouer une playlist",
            loadFailed: "Chargement Échoué",
            loadFailedDesc: "Impossible de charger des pistes de cette playlist",
            shuffling: "Mélange de la Playlist",
            playing: "Lecture de la Playlist",
            playlist: "Playlist",
            loaded: "Chargée",
            duration: "Durée",
            channel: "Canal",
            mode: "Mode",
            shuffled: "Mélangée",
            sequential: "Séquentiel",
            playFailed: "Lecture Échouée",
            playFailedDesc: "Impossible de jouer la playlist. Veuillez réessayer plus tard."
        },
        remove: {
            notFound: "Playlist Non Trouvée",
            notFoundDesc: "Aucune playlist nommée \"{name}\" n'existe !",
            invalidIndex: "Index Invalide",
            invalidIndexDesc: "L'index de la piste doit être entre 1 et {max}",
            removed: "Piste Supprimée",
            removedTrack: "Supprimée",
            artist: "Artiste",
            source: "Source",
            remaining: "Restantes"
        },
        import: {
            invalidFile: "Fichier Invalide",
            invalidFileDesc: "Le fichier doit contenir une playlist valide avec un nom et un tableau de pistes.",
            nameConflict: "Conflit de Nom",
            nameConflictDesc: "Une playlist nommée \"{name}\" existe déjà !",
            imported: "Playlist Importée",
            system: "Système de Playlist",
            importFailed: "Importation Échouée",
            importFailedDesc: "Impossible d'importer la playlist : {error}",
            name: "Nom",
            tracks: "Pistes",
            duration: "Durée"
        }
    },
    // Mots communs
    common: {
        enabled: "activé",
        disabled: "désactivé",
        unknown: "Inconnu",
        loading: "Chargement...",
        page: "Page",
        of: "sur",
        close: "Fermer",
        previous: "Précédent",
        next: "Suivant"
    }
} satisfies typeof English