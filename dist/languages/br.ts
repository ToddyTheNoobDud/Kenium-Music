import type English from "./en";

export default {
    hello: "olá",
    ping: {
        description: "**Gateway**: {wsPing}ms\n**Shard**: {shardPing}ms\n**Reprodutor**: {playerPing}ms",
        title: "Informações de Ping"
    },
    language: {
        set: "Idioma definido para {lang}",
        name: "Idioma",
        description: "Define o idioma do bot"
    },
    commands: {
        ping: {
            name: "ping",
            description: "Mostra o ping com o discord"
        },
        language: {
            name: "idioma",
            description: "Define o idioma do bot"
        },
        play: {
            name: "tocar",
            description: "Toca uma música por pesquisa ou URL."
        },
        "play-file": {
            name: "tocar-arquivo",
            description: "Toca um arquivo do seu computador."
        },
        pause: {
            name: "pausar",
            description: "Pausa a música"
        },
        resume: {
            name: "retomar",
            description: "Retoma a música"
        },
        stop: {
            name: "parar",
            description: "Para a música"
        },
        skip: {
            name: "pular",
            description: "Pula a música atual"
        },
        previous: {
            name: "anterior",
            description: "Toca a música anterior"
        },
        queue: {
            name: "fila",
            description: "Mostra a fila de músicas com controles"
        },
        nowplaying: {
            name: "tocando",
            description: "Mostra a música que está tocando"
        },
        volume: {
            name: "volume",
            description: "Define o volume"
        },
        clear: {
            name: "limpar",
            description: "Limpa a fila de músicas"
        },
        shuffle: {
            name: "embaralhar",
            description: "Embaralha a fila"
        },
        loop: {
            name: "loop",
            description: "Define o modo de repetição"
        },
        autoplay: {
            name: "autoplay",
            description: "Ativa/desativa a reprodução automática"
        },
        filters: {
            name: "filtros",
            description: "Aplica filtros de áudio"
        },
        jump: {
            name: "pularpara",
            description: "Pula para uma posição específica na fila"
        },
        remove: {
            name: "remover",
            description: "Remove uma música da fila"
        },
        grab: {
            name: "pegar",
            description: "Pega a música atual e envia para suas DMs"
        },
        lyrics: {
            name: "letra",
            description: "Obtém a letra da música atual"
        },
        export: {
            name: "exportar",
            description: "Exporta a fila"
        },
        import: {
            name: "importar",
            description: "Importa uma fila de um arquivo"
        },
        destroy: {
            name: "destruir",
            description: "Destrói o reprodutor de música"
        },
        "247": {
            name: "247",
            description: "Ativa/desativa o modo 24/7"
        },
        changelog: {
            name: "changelog",
            description: "Mostra o log de alterações do bot"
        },
        help: {
            name: "ajuda",
            description: "Mostra os comandos disponíveis"
        },
        invite: {
            name: "convite",
            description: "Obtém o link de convite do bot"
        },
        search: {
            name: "buscar",
            description: "Busca uma música nas plataformas de música"
        },
        seek: {
            name: "avançar",
            description: "Avança para uma posição específica na música"
        },
        restart: {
            name: "reiniciar",
            description: "Reinicia a música"
        },
        status: {
            name: "status",
            description: "Mostra o status do bot"
        },
        tts: {
            name: "tts",
            description: "Gera e envia uma mensagem TTS"
        }
    },
    // Mensagens do reprodutor de música
    player: {
        noVoiceChannel: "Você precisa estar em um canal de voz para usar este comando.",
        noPlayer: "Nenhum reprodutor de música encontrado.",
        noTrack: "Nenhuma faixa está tocando no momento.",
        alreadyPaused: "A música já está pausada.",
        alreadyResumed: "A música já está tocando.",
        paused: "Música pausada.",
        resumed: "Música retomada.",
        stopped: "Música parada.",
        destroyed: "Reprodutor de música destruído.",
        queueEmpty: "A fila está vazia.",
        queueCleared: "Fila limpa.",
        trackAdded: "Adicionou **[{title}]({uri})** à fila.",
        playlistAdded: "Adicionou a playlist **[`{name}`]({uri})** ({count} faixas) à fila.",
        noTracksFound: "Nenhuma faixa encontrada para a pesquisa fornecida.",
        invalidPosition: "A posição deve ser entre 1 e {max}.",
        jumpedTo: "Pulou para a música {position}.",
        jumpedToSong: "Pulou para a música \"{title}\".",
        songNotFound: "Não foi possível encontrar \"{title}\" na fila.",
        alreadyAtPosition: "Já está na posição 1.",
        alreadyPlaying: "\"{title}\" já está tocando.",
        volumeSet: "Volume definido para {volume}%.",
        invalidVolume: "O volume deve ser entre 0 e 100.",
        autoplayEnabled: "A reprodução automática foi **ativada**.",
        autoplayDisabled: "A reprodução automática foi **desativada**.",
        loopEnabled: "A repetição foi **ativada**.",
        loopDisabled: "A repetição foi **desativada**.",
        filterApplied: "Filtro **{filter}** aplicado.",
        filtersCleared: "Todos os filtros foram removidos.",
        filterInvalid: "Filtro inválido.",
        nowPlaying: "Tocando Agora",
        requestedBy: "Pedido por",
        duration: "Duração",
        author: "Autor",
        position: "Posição",
        volume: "Volume",
        loop: "Repetição",
        autoplay: "Reprodução Automática",
        queueSize: "Tamanho da Fila",
        enabled: "Ativado",
        disabled: "Desativado",
        none: "Nenhum",
        track: "Faixa",
        queue: "Fila",
        restarted: "Música reiniciada",
        shuffled: "Fila embaralhada",
        skipped: "Música pulada",
        previousAdded: "Tocando/Adicionada a música anterior",
        volumeChanged: "Volume alterado",
        removedSong: "Música removida",
        seeked: "Avançou na música",
        fileAdded: "Adicionado à fila",
        noTrackFound: "Nenhuma faixa encontrada"
    },
    // Modo 24/7
    mode247: {
        title: "Modo 24/7",
        enabled: "O modo 24/7 foi ativado",
        disabled: "O modo 24/7 foi desativado"
    },
    // Exportar/Importar
    export: {
        emptyQueue: "A fila está vazia",
        success: "Fila exportada com URLs para importação"
    },
    import: {
        emptyFile: "O arquivo está vazio",
        noValidTracks: "Nenhuma faixa válida encontrada no arquivo",
        importing: "Importando {count} faixas...",
        complete: "Importação Concluída",
        successfullyImported: "Importado com sucesso: **{count}** faixas",
        failedToImport: "Falha ao importar: **{count}** faixas",
        totalQueueSize: "Tamanho total da fila: **{count}** faixas"
    },
    // Comando pegar (grab)
    grab: {
        title: "Tocando Agora: **{title}**",
        listenHere: "[Ouça Aqui]({uri})",
        duration: "Duração",
        author: "Autor",
        server: "Servidor",
        footer: "Obtido da sua sessão atual",
        sentToDm: "Enviei os detalhes da faixa para suas DMs.",
        dmError: "Não consegui te enviar uma DM. Por favor, verifique suas configurações de privacidade.",
        noSongPlaying: "Nenhuma música está tocando no momento."
    },
    // Comando ajuda (help)
    help: {
        pageTitle: "Página {current} de {total}",
        previous: "Anterior",
        next: "Próximo"
    },
    // Comando letra (lyrics)
    lyrics: {
        title: "Letra",
        error: "Erro na Letra",
        noLyricsFound: "Nenhuma letra encontrada",
        serviceUnavailable: "Serviço de letras indisponível",
        syncedLyrics: "Letra Sincronizada",
        textLyrics: "Letra em Texto",
        artist: "Artista",
        noActivePlayer: "Nenhum reprodutor ativo encontrado"
    },
    // Comando pularpara (jump)
    jump: {
        noSongsInQueue: "Nenhuma música na fila",
        specifyPositionOrName: "Por favor, especifique um número de posição ou o nome da música"
    },
    // Nomes dos filtros
    filters: {
        "8d": "8D",
        equalizer: "Equalizador",
        karaoke: "Karaokê",
        timescale: "Escala de Tempo",
        tremolo: "Tremolo",
        vibrato: "Vibrato",
        rotation: "Rotação",
        distortion: "Distorção",
        channelMix: "Mixagem de Canais",
        lowPass: "Filtro Passa-Baixa",
        bassboost: "Reforço de Graves",
        slowmode: "Modo Lento",
        nightcore: "Nightcore",
        vaporwave: "Vaporwave",
        clear: "Limpar",
        invalidFilter: "Filtro selecionado inválido."
    },
    // Comando buscar (search)
    search: {
        noVoiceChannel: "🎵 Entre em um canal de voz primeiro!",
        alreadyConnected: "🎵 Eu já estou tocando música neste canal",
        noResults: "🔍 Nenhum resultado encontrado. Tente outra plataforma!",
        trackAdded: "✅ Adicionado à fila",
        searchError: "❌ Falha na busca. Por favor, tente novamente.",
        genericError: "❌ Ocorreu um erro. Por favor, tente novamente.",
        invalidQuery: "❌ Pesquisa muito curta ou com caracteres inválidos",
        multiSearchStarted: "🔍 Buscando em múltiplas plataformas...",
        failedToJoinVoice: "❌ Falha ao entrar no canal de voz."
    },
    // Comando status
    status: {
        title: "Status do Bot",
        systemUptime: "Tempo de Atividade do Sistema",
        systemCpuModel: "Modelo da CPU do Sistema",
        systemCpuLoad: "Carga da CPU do Sistema",
        lavalinkUptime: "Tempo de Atividade do Lavalink",
        lavalinkVersion: "Versão do Lavalink",
        systemMemory: "Memória do Sistema",
        systemMemBar: "Barra de Memória do Sistema",
        lavalinkMemory: "Memória do Lavalink",
        lavalinkMemBar: "Barra de Memória do Lavalink",
        lavalinkCpuLoad: "Carga da CPU do Lavalink",
        lavalinkPlayers: "Reprodutores do Lavalink",
        lavalinkNodes: "Nós do Lavalink",
        ping: "Ping",
        processMemory: "Memória do Processo"
    },
    // Comando tts
    tts: {
        generated: "Mensagem TTS gerada"
    },
    // Comando volume
    volume: {
        rangeError: "Use um número entre `0 - 200`."
    },
    // Comando convite (invite)
    invite: {
        title: "Sem Paywalls. Sem Votação. Apenas Música.",
        description: `Cansado de bots que bloqueiam recursos atrás de paywalls ou requisitos de voto? O Kenium é diferente:

- **Grátis para Sempre**: Todos os recursos, todas as plataformas (YouTube, Spotify, SoundCloud, Vimeo) – sem taxas, sem anúncios.
- **Música 24/7**: Áudio de alta qualidade, respostas rápidas, zero tempo de inatividade.
- **Fácil de Usar**: Apenas digite /tocar – fila instantânea, sem configuração complicada.
- **Código Aberto**: Código transparente, sempre disponível para revisão.
- **Recursos Ilimitados**: Playlists, filtros, reforço de graves – tudo gratuito.
- **Desenvolvido com Aqualink**: Gerenciador de lavalink rápido, estável e confiável.

Sem caça-níqueis. Sem votação. Apenas aperte o play e divirta-se.

**Quer mais?** Clique nos botões abaixo!
Não quer mais? [\`Clique aqui para me convidar\`](https://discord.com/oauth2/authorize?client_id=1202232935311495209)`,
        supportServer: "Servidor de Suporte",
        github: "GitHub",
        website: "Site"
    },
    // Comando fila (queue)
    queue: {
        title: "Fila",
        page: "Página {current} de {total}",
        nowPlaying: "🎵 Tocando Agora",
        comingUp: "📋 A Seguir",
        queueEmpty: "Fila Vazia",
        noTracksInQueue: "🔭 **Nenhuma faixa na fila**\n\nUse `/tocar` para adicionar algumas músicas!",
        tip: "*Dica: Você pode pesquisar ou usar URLs*",
        pause: "Pausar",
        resume: "Retomar",
        shuffleOn: "Embaralhar: Ativado",
        shuffleOff: "Embaralhar: Desativado",
        loopOn: "Repetir: Ativado",
        loopOff: "Repetir: Desativado",
        refresh: "Atualizar",
        clear: "Limpar",
        noActivePlayerFound: "❌ Nenhum reprodutor ativo encontrado",
        errorDisplayingQueue: "❌ Ocorreu um erro ao exibir a fila"
    },
    // Mensagens de erro
    errors: {
        general: "Ocorreu um erro",
        notFound: "Não encontrado",
        noPermission: "Você não tem permissão para usar este comando",
        invalidLanguage: "Idioma selecionado inválido",
        databaseError: "Falha ao salvar as configurações",
        commandError: "Ocorreu um erro ao executar o comando",
        unsupportedContentType: "Tipo de conteúdo não suportado."
    },
    // Mensagens de sucesso
    success: {
        languageSet: "Idioma alterado com sucesso para **{lang}**!",
        settingsSaved: "Configurações salvas com sucesso",
        settingAlradySet: "Esta configuração ja foi definida"
    },
    // Palavras comuns
    common: {
        enabled: "ativado",
        disabled: "desativado",
        unknown: "Desconhecido",
        loading: "Carregando...",
        page: "Página",
        of: "de",
        close: "Fechar",
        previous: "Anterior",
        next: "Próximo"
    }
} satisfies typeof English