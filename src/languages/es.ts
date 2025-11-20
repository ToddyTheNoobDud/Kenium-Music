import type English from "./en";

export default {
    hello: "hola",
    ping: {
        description: "**Gateway**: {wsPing}ms\n**Shard**: {shardPing}ms\n**Reproductor**: {playerPing}ms",
        descriptionNoPlayer: "**Gateway**: {wsPing}ms\n**Shard**: {shardPing}ms",
        title: "Información de Ping"
    },
    language: {
        set: "Idioma establecido a {lang}",
        name: "Idioma",
        description: "Establecer el idioma del bot"
    },
    commands: {
        ping: {
            name: "ping",
            description: "Mostrar el ping con discord"
        },
        language: {
            name: "idioma",
            description: "Establecer el idioma del bot"
        },
        play: {
            name: "reproducir",
            description: "Reproducir una canción por búsqueda o URL."
        },
        "play-file": {
            name: "reproducir-archivo",
            description: "Reproducir un archivo de tu computadora."
        },
        pause: {
            name: "pausar",
            description: "Pausar la música"
        },
        resume: {
            name: "reanudar",
            description: "Reanudar la música"
        },
        stop: {
            name: "detener",
            description: "Detener la música"
        },
        skip: {
            name: "saltar",
            description: "Saltar la canción actual"
        },
        previous: {
            name: "anterior",
            description: "Reproducir la canción anterior"
        },
        queue: {
            name: "cola",
            description: "Mostrar la cola de música con controles"
        },
        nowplaying: {
            name: "reproduciendo",
            description: "Mostrar la canción que se está reproduciendo"
        },
        volume: {
            name: "volumen",
            description: "Establecer el volumen"
        },
        clear: {
            name: "limpiar",
            description: "Limpiar la cola de música"
        },
        shuffle: {
            name: "mezclar",
            description: "Mezclar la cola"
        },
        loop: {
            name: "bucle",
            description: "Establecer modo de bucle"
        },
        autoplay: {
            name: "autoreproducir",
            description: "Activar/desactivar reproducción automática"
        },
        filters: {
            name: "filtros",
            description: "Aplicar filtros de audio"
        },
        jump: {
            name: "saltar-a",
            description: "Saltar a una posición específica en la cola"
        },
        remove: {
            name: "eliminar",
            description: "Eliminar una canción de la cola"
        },
        grab: {
            name: "tomar",
            description: "Tomar la canción actual y enviar a DM"
        },
        lyrics: {
            name: "letra",
            description: "Obtener la letra de la canción actual"
        },
        loadlyrics: {
            name: "cargar-letra",
            description: "Cargar letra para una pista codificada específica"
        },
        export: {
            name: "exportar",
            description: "Exportar la cola"
        },
        import: {
            name: "importar",
            description: "Importar una cola desde un archivo"
        },
        destroy: {
            name: "destruir",
            description: "Destruir el reproductor de música"
        },
        "247": {
            name: "247",
            description: "Activar/desactivar modo 24/7"
        },
        changelog: {
            name: "changelog",
            description: "Mostrar el changelog del bot"
        },
        help: {
            name: "ayuda",
            description: "Mostrar comandos disponibles"
        },
        invite: {
            name: "invitar",
            description: "Obtener enlace de invitación del bot"
        },
        search: {
            name: "buscar",
            description: "Buscar una canción en plataformas de música"
        },
        seek: {
            name: "buscar-posicion",
            description: "Buscar una posición específica en la canción"
        },
        restart: {
            name: "reiniciar",
            description: "Reiniciar la música"
        },
        status: {
            name: "estado",
            description: "Mostrar estado del bot"
        },
        tts: {
            name: "tts",
            description: "Generar y enviar un mensaje TTS"
        },
        karaoke: {
            name: "karaoke",
            description: "Iniciar una sesión de karaoke con letras sincronizadas"
        },
        roulette: {
            name: "ruleta",
            description: "Reproducir una pista aleatoria de la cola"
        }
    },
    // Mensajes del reproductor de música
    player: {
        noVoiceChannel: "Debes estar en un canal de voz para usar este comando.",
        noPlayer: "No se encontró reproductor de música.",
        noTrack: "No se está reproduciendo ninguna pista actualmente.",
        alreadyPaused: "La canción ya está pausada.",
        alreadyResumed: "La canción ya se está reproduciendo.",
        paused: "Canción pausada.",
        resumed: "Canción reanudada.",
        stopped: "Música detenida.",
        destroyed: "Reproductor de música destruido.",
        queueEmpty: "La cola está vacía.",
        queueCleared: "Cola limpiada.",
        trackAdded: "Añadido **[{title}]({uri})** a la cola.",
        playlistAdded: "Añadida la playlist **[`{name}`]({uri})** ({count} pistas) a la cola.",
        noTracksFound: "No se encontraron pistas para la consulta dada.",
        invalidPosition: "La posición debe estar entre 1 y {max}.",
        jumpedTo: "Saltó a la canción {position}.",
        jumpedToSong: "Saltó a la canción \"{title}\".",
        songNotFound: "No se pudo encontrar \"{title}\" en la cola.",
        alreadyAtPosition: "Ya está en la posición 1.",
        alreadyPlaying: "\"{title}\" ya se está reproduciendo.",
        volumeSet: "Volumen establecido a {volume}%.",
        invalidVolume: "El volumen debe estar entre 0 y 100.",
        autoplayEnabled: "La reproducción automática ha sido **activada**.",
        autoplayDisabled: "La reproducción automática ha sido **desactivada**.",
        loopEnabled: "El bucle ha sido **activado**.",
        loopDisabled: "El bucle ha sido **desactivado**.",
        filterApplied: "Filtro **{filter}** aplicado.",
        filtersCleared: "Todos los filtros han sido eliminados.",
        filterInvalid: "Filtro inválido.",
        nowPlaying: "Reproduciendo Ahora",
        requestedBy: "Solicitado por",
        duration: "Duración",
        author: "Autor",
        position: "Posición",
        volume: "Volumen",
        loop: "Bucle",
        autoplay: "Reproducción Automática",
        queueSize: "Tamaño de Cola",
        enabled: "Activado",
        disabled: "Desactivado",
        none: "Ninguno",
        track: "Pista",
        queue: "Cola",
        restarted: "Música reiniciada",
        shuffled: "Cola mezclada",
        skipped: "Canción saltada",
        previousPlayed: "Reproduciendo canción anterior",
        previousAdded: "Canción anterior añadida",
        volumeChanged: "Volumen cambiado",
        removedSong: "Canción eliminada",
        seeked: "Posición buscada en la canción",
        fileAdded: "Añadido a la cola",
        noTrackFound: "No se encontró pista"
    },
    // Modo 24/7
    mode247: {
        title: "Modo 24/7",
        enabled: "El modo 24/7 ha sido activado",
        disabled: "El modo 24/7 ha sido desactivado"
    },
    // Exportar/Importar
    export: {
        emptyQueue: "La cola está vacía",
        success: "Cola exportada con URLs para importación"
    },
    import: {
        emptyFile: "El archivo está vacío",
        noValidTracks: "No se encontraron pistas válidas en el archivo",
        importing: "Importando {count} pistas...",
        complete: "Importación Completa",
        successfullyImported: "Importado exitosamente: **{count}** pistas",
        failedToImport: "Falló al importar: **{count}** pistas",
        totalQueueSize: "Tamaño total de la cola: **{count}** pistas"
    },
    // Comando tomar (grab)
    grab: {
        title: "Reproduciendo Ahora: **{title}**",
        listenHere: "[Escuchar Aquí]({uri})",
        duration: "Duración",
        author: "Autor",
        server: "Servidor",
        footer: "Tomado de tu sesión actual",
        sentToDm: "Te he enviado los detalles de la pista por DM.",
        dmError: "No pude enviarte un DM. Por favor verifica tu configuración de privacidad.",
        noSongPlaying: "No se está reproduciendo ninguna canción actualmente."
    },
    // Comando ayuda (help)
    help: {
        pageTitle: "Página {current} de {total}",
        previous: "Anterior",
        next: "Siguiente"
    },
    // Comando letra (lyrics)
    lyrics: {
        title: "Letra",
        error: "Error de Letra",
        noLyricsFound: "No se encontró letra",
        serviceUnavailable: "Servicio de letras no disponible",
        syncedLyrics: "Letra Sincronizada",
        textLyrics: "Letra de Texto",
        artist: "Artista",
        noActivePlayer: "No se encontró reproductor activo"
    },
    // Comando saltar-a (jump)
    jump: {
        noSongsInQueue: "No hay canciones en la cola",
        specifyPositionOrName: "Por favor especifica un número de posición o nombre de canción"
    },
    // Nombres de filtros
    filters: {
        "8d": "8D",
        equalizer: "Ecualizador",
        karaoke: "Karaoke",
        timescale: "Escala de Tiempo",
        tremolo: "Trémolo",
        vibrato: "Vibrato",
        rotation: "Rotación",
        distortion: "Distorsión",
        channelMix: "Mezcla de Canales",
        lowPass: "Paso Bajo",
        bassboost: "Refuerzo de Graves",
        slowmode: "Modo Lento",
        nightcore: "Nightcore",
        vaporwave: "Vaporwave",
        clear: "Limpiar",
        invalidFilter: "Filtro seleccionado inválido."
    },
    // Comando buscar (search)
    search: {
        noVoiceChannel: "🎵 ¡Únete a un canal de voz primero!",
        alreadyConnected: "🎵 Ya estoy reproduciendo música en este canal",
        noResults: "🔍 No se encontraron resultados. ¡Prueba otra plataforma!",
        trackAdded: "✅ Añadido a la cola",
        searchError: "❌ La búsqueda falló. Por favor intenta de nuevo.",
        genericError: "❌ Ocurrió un error. Por favor intenta de nuevo.",
        invalidQuery: "❌ Consulta muy corta o caracteres inválidos",
        multiSearchStarted: "🔍 Buscando en múltiples plataformas...",
        failedToJoinVoice: "❌ Falló al unirse al canal de voz."
    },
    // Comando estado
    status: {
        title: "Estado del Bot",
        systemUptime: "Tiempo de Actividad del Sistema",
        systemCpuModel: "Modelo de CPU del Sistema",
        systemCpuLoad: "Carga de CPU del Sistema",
        lavalinkUptime: "Tiempo de Actividad de Lavalink",
        lavalinkVersion: "Versión de Lavalink",
        systemMemory: "Memoria del Sistema",
        systemMemBar: "Barra de Memoria del Sistema",
        lavalinkMemory: "Memoria de Lavalink",
        lavalinkMemBar: "Barra de Memoria de Lavalink",
        lavalinkCpuLoad: "Carga de CPU de Lavalink",
        lavalinkPlayers: "Reproductores de Lavalink",
        lavalinkNodes: "Nodos de Lavalink",
        ping: "Ping",
        processMemory: "Memoria del Proceso"
    },
    // Comando tts
    tts: {
        generated: "Mensaje TTS generado"
    },
    // Comando karaoke
    karaoke: {
        error: "Error de Karaoke",
        sessionEnded: "Sesión de karaoke terminada",
        noActivePlayer: "No se encontró reproductor activo",
        sessionAlreadyActive: "Ya existe una sesión de karaoke activa en este servidor. Espera a que termine o usa el comando nuevamente para detener la sesión actual.",
        noLyricsAvailable: "No hay letras sincronizadas disponibles. Prueba con una canción diferente.",
        playing: "Reproduciendo",
        paused: "Pausado",
        noLyrics: "No hay letras disponibles"
    },
    // Comando roulette
    roulette: {
        playingRandom: "🎲 Reproduciendo pista aleatoria: **{title}** por **{author}**",
        error: "¡Ocurrió un error al reproducir pista aleatoria!"
    },
    // Comando volumen
    volume: {
        rangeError: "Usa un número entre `0 - 200`."
    },
    // Comando invitar (invite)
    invite: {
        title: "Sin Paywall. Sin Votación. Solo Música.",
        description: `¿Cansado de bots que bloquean características detrás de paywalls o requisitos de voto? Kenium es diferente:

- **Gratis Para Siempre**: Todas las características, todas las plataformas (YouTube, Spotify, SoundCloud, Vimeo) — sin tarifas, sin anuncios.
- **Música 24/7**: Audio de alta calidad, respuestas rápidas, cero tiempo de inactividad.
- **Fácil de Usar**: Solo escribe /reproducir — cola instantánea, sin configuración complicada.
- **Código Abierto**: Código transparente, siempre disponible para revisión.
- **Características Ilimitadas**: Playlists, filtros, refuerzo de graves — todo gratis.
- **Impulsado por Aqualink**: Manejador de lavalink rápido, estable y confiable

Sin estafas. Sin votación. Solo presiona reproducir y disfruta.

**¿Quieres más?** ¡Haz clic en los botones de abajo!
¿No quieres más? [\`Haz clic aquí para invitarme\`](https://discord.com/oauth2/authorize?client_id=1202232935311495209)`,
        supportServer: "Servidor de Soporte",
        github: "GitHub",
        website: "Sitio Web"
    },
    // Comando cola (queue)
    queue: {
        title: "Cola",
        page: "Página {current} de {total}",
        nowPlaying: "🎵 Reproduciendo Ahora",
        comingUp: "📋 Próximas",
        queueEmpty: "Cola Vacía",
        noTracksInQueue: "🔭 **No hay pistas en la cola**\n\n¡Usa `/reproducir` para añadir música!",
        tip: "*Consejo: Puedes buscar o usar URLs*",
        pause: "Pausar",
        resume: "Reanudar",
        shuffleOn: "Mezclar: Activado",
        shuffleOff: "Mezclar: Desactivado",
        loopOn: "Bucle: Activado",
        loopOff: "Bucle: Desactivado",
        refresh: "Actualizar",
        clear: "Limpiar",
        noActivePlayerFound: "❌ No se encontró reproductor activo",
        errorDisplayingQueue: "❌ Ocurrió un error al mostrar la cola"
    },
    // Mensajes de error
    errors: {
        general: "Ocurrió un error",
        notFound: "No encontrado",
        noPermission: "No tienes permiso para usar este comando",
        invalidLanguage: "Idioma seleccionado inválido",
        databaseError: "Falló al guardar configuraciones",
        commandError: "Ocurrió un error al ejecutar el comando",
        unsupportedContentType: "Tipo de contenido no soportado."
    },
    // Mensajes de éxito
    success: {
        languageSet: "¡Idioma cambiado exitosamente a **{lang}**!",
        settingsSaved: "Configuraciones guardadas exitosamente",
        settingAlradySet: "Esta configuración ya ha sido establecida"
    },
    // Sistema de playlist
    playlist: {
        create: {
            invalidName: "Nombre Inválido",
            nameTooLong: "El nombre de la playlist debe tener menos de {maxLength} caracteres.",
            limitReached: "Límite de Playlist Alcanzado",
            maxPlaylists: "Solo puedes tener un máximo de {max} playlists.",
            exists: "La Playlist Existe",
            alreadyExists: "¡Una playlist llamada \"{name}\" ya existe!",
            created: "Playlist Creada",
            name: "Nombre",
            status: "Estado",
            readyForTracks: "¡Lista para pistas!",
            addTracks: "Añadir Pistas",
            viewPlaylist: "Ver Playlist"
        },
        add: {
            notFound: "Playlist No Encontrada",
            notFoundDesc: "¡No existe una playlist llamada \"{name}\"!",
            full: "Playlist Llena",
            fullDesc: "¡Esta playlist ha alcanzado el límite de {max} pistas!",
            nothingAdded: "Nada Añadido",
            nothingAddedDesc: "No se añadieron pistas nuevas. Pueden ya existir en la playlist o no se encontraron coincidencias.",
            tracksAdded: "Pistas Añadidas",
            trackAdded: "Pista Añadida",
            tracks: "Pistas",
            track: "Pista",
            artist: "Artista",
            source: "Fuente",
            added: "Añadida",
            total: "Total",
            duration: "Duración",
            addMore: "Añadir Más",
            playNow: "Reproducir Ahora",
            viewAll: "Ver Todo",
            addFailed: "Falló al Añadir",
            addFailedDesc: "No se pudieron añadir pistas: {error}"
        },
        view: {
            noPlaylists: "Sin Playlists",
            noPlaylistsDesc: "¡Aún no has creado ninguna playlist!",
            gettingStarted: "Empezando",
            gettingStartedDesc: "¡Usa `/playlist create` para hacer tu primera playlist!",
            createPlaylist: "Crear Playlist",
            yourPlaylists: "Tus Playlists",
            yourPlaylistsDesc: "Tienes **{count}** playlist{plural}",
            choosePlaylist: "Elige una playlist para ver...",
            notFound: "Playlist No Encontrada",
            notFoundDesc: "¡No existe una playlist llamada \"{name}\"!",
            playlistTitle: "Playlist: {name}",
            empty: "Esta playlist está vacía",
            description: "Descripción",
            noDescription: "Sin descripción",
            info: "Info",
            tracks: "Pistas",
            plays: "Reproducciones",
            tracksPage: "Pistas (Página {current}/{total})",
            play: "Reproducir",
            shuffle: "Mezclar",
            manage: "Gestionar",
            previous: "Anterior",
            next: "Siguiente"
        },
        delete: {
            notFound: "Playlist No Encontrada",
            notFoundDesc: "¡No existe una playlist llamada \"{name}\"!",
            deleted: "Playlist Eliminada",
            deletedDesc: "Playlist \"{name}\" eliminada exitosamente"
        },
        play: {
            notFound: "Playlist No Encontrada",
            notFoundDesc: "¡No existe una playlist llamada \"{name}\"!",
            empty: "Playlist Vacía",
            emptyDesc: "¡Esta playlist no tiene pistas para reproducir!",
            noVoiceChannel: "Sin Canal de Voz",
            noVoiceChannelDesc: "Únete a un canal de voz para reproducir una playlist",
            loadFailed: "Falló la Carga",
            loadFailedDesc: "No se pudieron cargar pistas de esta playlist",
            shuffling: "Mezclando Playlist",
            playing: "Reproduciendo Playlist",
            playlist: "Playlist",
            loaded: "Cargada",
            duration: "Duración",
            channel: "Canal",
            mode: "Modo",
            shuffled: "Mezclada",
            sequential: "Secuencial",
            playFailed: "Falló la Reproducción",
            playFailedDesc: "No se pudo reproducir la playlist. Por favor intenta más tarde."
        },
        remove: {
            notFound: "Playlist No Encontrada",
            notFoundDesc: "¡No existe una playlist llamada \"{name}\"!",
            invalidIndex: "Índice Inválido",
            invalidIndexDesc: "El índice de la pista debe estar entre 1 y {max}",
            removed: "Pista Eliminada",
            removedTrack: "Eliminada",
            artist: "Artista",
            source: "Fuente",
            remaining: "Restantes"
        },
        import: {
            invalidFile: "Archivo Inválido",
            invalidFileDesc: "El archivo debe contener una playlist válida con nombre y array de pistas.",
            nameConflict: "Conflicto de Nombre",
            nameConflictDesc: "¡Una playlist llamada \"{name}\" ya existe!",
            imported: "Playlist Importada",
            system: "Sistema de Playlist",
            importFailed: "Falló la Importación",
            importFailedDesc: "No se pudo importar la playlist: {error}",
            name: "Nombre",
            tracks: "Pistas",
            duration: "Duración"
        }
    },
    // Palabras comunes
    common: {
        enabled: "activado",
        disabled: "desactivado",
        unknown: "Desconocido",
        loading: "Cargando...",
        page: "Página",
        of: "de",
        close: "Cerrar",
        previous: "Anterior",
        next: "Siguiente"
    }
} satisfies typeof English
