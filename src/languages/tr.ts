import type English from "./en";

export default {
    hello: "merhaba",
    ping: {
        description: "**Gateway**: {wsPing}ms\n**Shard**: {shardPing}ms\n**Oynatıcı**: {playerPing}ms",
        title: "Ping Bilgileri"
    },
    language: {
        set: "Dil {lang} olarak ayarlandı",
        name: "Dil",
        description: "Botun dilini ayarla"
    },
    commands: {
        ping: {
            name: "ping",
            description: "Discord ile ping'i göster"
        },
        language: {
            name: "dil",
            description: "Botun dilini ayarla"
        },
        play: {
            name: "çal",
            description: "Arama sorgusu veya URL ile müzik çal."
        },
        "play-file": {
            name: "dosya-çal",
            description: "Bilgisayarından bir dosya çal."
        },
        pause: {
            name: "duraklat",
            description: "Müziği duraklat"
        },
        resume: {
            name: "devam",
            description: "Müziği devam ettir"
        },
        stop: {
            name: "durdur",
            description: "Müziği durdur"
        },
        skip: {
            name: "atla",
            description: "Şu anki şarkıyı atla"
        },
        previous: {
            name: "önceki",
            description: "Önceki şarkıyı çal"
        },
        queue: {
            name: "kuyruk",
            description: "Müzik kuyruğunu kontroller ile göster"
        },
        nowplaying: {
            name: "şuançalan",
            description: "Şu an çalan şarkıyı göster"
        },
        volume: {
            name: "ses",
            description: "Ses seviyesini ayarla"
        },
        clear: {
            name: "temizle",
            description: "Müzik kuyruğunu temizle"
        },
        shuffle: {
            name: "karıştır",
            description: "Kuyruğu karıştır"
        },
        loop: {
            name: "döngü",
            description: "Döngü modunu ayarla"
        },
        autoplay: {
            name: "otomatikçal",
            description: "Otomatik çalmayı aç/kapat"
        },
        filters: {
            name: "filtreler",
            description: "Ses filtreleri uygula"
        },
        jump: {
            name: "atla",
            description: "Kuyrukta belirli bir konuma atla"
        },
        remove: {
            name: "kaldır",
            description: "Kuyruktan bir şarkı kaldır"
        },
        grab: {
            name: "al",
            description: "Şu anki şarkıyı al ve DM'e gönder"
        },
        lyrics: {
            name: "şarkısözü",
            description: "Şu anki şarkının sözlerini al"
        },
        export: {
            name: "dışaaktar",
            description: "Kuyruğu dışa aktar"
        },
        import: {
            name: "içeaktar",
            description: "Bir dosyadan kuyruk içe aktar"
        },
        destroy: {
            name: "yoket",
            description: "Müzik oynatıcısını yok et"
        },
        "247": {
            name: "247",
            description: "24/7 modunu aç/kapat"
        },
        changelog: {
            name: "değişikliklog",
            description: "Bot değişiklik günlüğünü göster"
        },
        help: {
            name: "yardım",
            description: "Mevcut komutları göster"
        },
        invite: {
            name: "davet",
            description: "Bot davet linkini al"
        },
        search: {
            name: "ara",
            description: "Müzik platformlarında şarkı ara"
        },
        seek: {
            name: "ilerle",
            description: "Şarkıda belirli bir konuma ilerle"
        },
        restart: {
            name: "yeniden",
            description: "Müziği yeniden başlat"
        },
        status: {
            name: "durum",
            description: "Bot durumunu göster"
        },
        tts: {
            name: "tts",
            description: "TTS mesajı oluştur ve gönder"
        },
        karaoke: {
            name: "karaoke",
            description: "Senkronize şarkı sözleri ile karaoke oturumu başlat"
        },
        roulette: {
            name: "rulet",
            description: "Kuyruktan rastgele bir parça çal"
        }
    },
    // Müzik oynatıcı mesajları
    player: {
        noVoiceChannel: "Bu komutu kullanmak için bir ses kanalında olmalısın.",
        noPlayer: "Müzik oynatıcısı bulunamadı.",
        noTrack: "Şu anda hiçbir parça çalmıyor.",
        alreadyPaused: "Şarkı zaten duraklatılmış.",
        alreadyResumed: "Şarkı zaten çalıyor.",
        paused: "Şarkı duraklatıldı.",
        resumed: "Şarkı devam ettirildi.",
        stopped: "Müzik durduruldu.",
        destroyed: "Müzik oynatıcısı yok edildi.",
        queueEmpty: "Kuyruk boş.",
        queueCleared: "Kuyruk temizlendi.",
        trackAdded: "**[{title}]({uri})** kuyruğa eklendi.",
        playlistAdded: "**[`{name}`]({uri})** oynatma listesi ({count} parça) kuyruğa eklendi.",
        noTracksFound: "Verilen sorgu için parça bulunamadı.",
        invalidPosition: "Konum 1 ile {max} arasında olmalı.",
        jumpedTo: "Şarkı {position} konumuna atlandı.",
        jumpedToSong: "\"{title}\" şarkısına atlandı.",
        songNotFound: "Kuyrukta \"{title}\" bulunamadı.",
        alreadyAtPosition: "Zaten 1. konumda.",
        alreadyPlaying: "\"{title}\" zaten çalıyor.",
        volumeSet: "Ses seviyesi %{volume} olarak ayarlandı.",
        invalidVolume: "Ses seviyesi 0 ile 100 arasında olmalı.",
        autoplayEnabled: "Otomatik çalma **etkinleştirildi**.",
        autoplayDisabled: "Otomatik çalma **devre dışı bırakıldı**.",
        loopEnabled: "Döngü **etkinleştirildi**.",
        loopDisabled: "Döngü **devre dışı bırakıldı**.",
        filterApplied: "**{filter}** filtresi uygulandı.",
        filtersCleared: "Tüm filtreler temizlendi.",
        filterInvalid: "Geçersiz filtre.",
        nowPlaying: "Şu An Çalan",
        requestedBy: "İsteyen",
        duration: "Süre",
        author: "Sanatçı",
        position: "Konum",
        volume: "Ses",
        loop: "Döngü",
        autoplay: "Otomatik Çalma",
        queueSize: "Kuyruk Boyutu",
        enabled: "Etkin",
        disabled: "Devre Dışı",
        none: "Yok",
        track: "Parça",
        queue: "Kuyruk",
        restarted: "Müzik yeniden başlatıldı",
        shuffled: "Kuyruk karıştırıldı",
        skipped: "Şarkı atlandı",
        previousPlayed: "Önceki şarkı çalıyor",
        previousAdded: "Önceki şarkı kuyruğa eklendi",
        volumeChanged: "Ses değiştirildi",
        removedSong: "Şarkı kaldırıldı",
        seeked: "Şarkıda ilerlendi",
        fileAdded: "Kuyruğa eklendi",
        noTrackFound: "Parça bulunamadı"
    },
    // 24/7 modu
    mode247: {
        title: "24/7 Modu",
        enabled: "24/7 modu etkinleştirildi",
        disabled: "24/7 modu devre dışı bırakıldı"
    },
    // Dışa/İçe Aktarma
    export: {
        emptyQueue: "Kuyruk boş",
        success: "Kuyruk içe aktarma için URL'lerle dışa aktarıldı"
    },
    import: {
        emptyFile: "Dosya boş",
        noValidTracks: "Dosyada geçerli parça bulunamadı",
        importing: "{count} parça içe aktarılıyor...",
        complete: "İçe Aktarma Tamamlandı",
        successfullyImported: "Başarıyla içe aktarıldı: **{count}** parça",
        failedToImport: "İçe aktarılamadı: **{count}** parça",
        totalQueueSize: "Toplam kuyruk boyutu: **{count}** parça"
    },
    // Al komutu (grab)
    grab: {
        title: "Şu An Çalan: **{title}**",
        listenHere: "[Burada Dinle]({uri})",
        duration: "Süre",
        author: "Sanatçı",
        server: "Sunucu",
        footer: "Şu anki oturumundan alındı",
        sentToDm: "Parça detaylarını DM'inde gönderdim.",
        dmError: "Size DM gönderemiyorum. Lütfen gizlilik ayarlarınızı kontrol edin.",
        noSongPlaying: "Şu anda hiçbir şarkı çalmıyor."
    },
    // Yardım komutu (help)
    help: {
        pageTitle: "Sayfa {current} / {total}",
        previous: "Önceki",
        next: "Sonraki"
    },
    // Şarkı sözü komutu (lyrics)
    lyrics: {
        title: "Şarkı Sözü",
        error: "Şarkı Sözü Hatası",
        noLyricsFound: "Şarkı sözü bulunamadı",
        serviceUnavailable: "Şarkı sözü servisi kullanılamıyor",
        syncedLyrics: "Senkronize Şarkı Sözü",
        textLyrics: "Metin Şarkı Sözü",
        artist: "Sanatçı",
        noActivePlayer: "Aktif oynatıcı bulunamadı"
    },
    // Atlama komutu (jump)
    jump: {
        noSongsInQueue: "Kuyrukta şarkı yok",
        specifyPositionOrName: "Lütfen bir konum numarası veya şarkı adı belirtin"
    },
    // Filtre adları
    filters: {
        "8d": "8D",
        equalizer: "Ekolayzer",
        karaoke: "Karaoke",
        timescale: "Zaman Ölçeği",
        tremolo: "Tremolo",
        vibrato: "Vibrato",
        rotation: "Döndürme",
        distortion: "Distorsiyon",
        channelMix: "Kanal Karıştırma",
        lowPass: "Düşük Geçiren",
        bassboost: "Bas Güçlendirme",
        slowmode: "Yavaş Mod",
        nightcore: "Nightcore",
        vaporwave: "Vaporwave",
        clear: "Temizle",
        invalidFilter: "Geçersiz filtre seçildi."
    },
    // Arama komutu (search)
    search: {
        noVoiceChannel: "🎵 Önce bir ses kanalına katıl!",
        alreadyConnected: "🎵 Bu kanalda zaten müzik çalıyorum",
        noResults: "🔍 Sonuç bulunamadı. Başka bir platform dene!",
        trackAdded: "✅ Kuyruğa eklendi",
        searchError: "❌ Arama başarısız. Lütfen tekrar dene.",
        genericError: "❌ Bir hata oluştu. Lütfen tekrar dene.",
        invalidQuery: "❌ Sorgu çok kısa veya geçersiz karakterler içeriyor",
        multiSearchStarted: "🔍 Birden fazla platformda aranıyor...",
        failedToJoinVoice: "❌ Ses kanalına katılma başarısız."
    },
    // Durum komutu (status)
    status: {
        title: "Bot Durumu",
        systemUptime: "Sistem Çalışma Süresi",
        systemCpuModel: "Sistem CPU Modeli",
        systemCpuLoad: "Sistem CPU Yükü",
        lavalinkUptime: "Lavalink Çalışma Süresi",
        lavalinkVersion: "Lavalink Sürümü",
        systemMemory: "Sistem Belleği",
        systemMemBar: "Sistem Bellek Çubuğu",
        lavalinkMemory: "Lavalink Belleği",
        lavalinkMemBar: "Lavalink Bellek Çubuğu",
        lavalinkCpuLoad: "Lavalink CPU Yükü",
        lavalinkPlayers: "Lavalink Oynatıcıları",
        lavalinkNodes: "Lavalink Düğümleri",
        ping: "Ping",
        processMemory: "İşlem Belleği"
    },
    // TTS komutu
    tts: {
        generated: "TTS mesajı oluşturuldu"
    },
    // Karaoke komutu
    karaoke: {
        error: "Karaoke Hatası",
        sessionEnded: "Karaoke oturumu sona erdi",
        noActivePlayer: "Aktif oynatıcı bulunamadı",
        sessionAlreadyActive: "Bu sunucuda zaten aktif bir karaoke oturumu var. Bitmesini bekleyin veya mevcut oturumu durdurmak için komutu tekrar kullanın.",
        noLyricsAvailable: "Senkronize şarkı sözü mevcut değil. Farklı bir şarkı deneyin.",
        playing: "Oynatılıyor",
        paused: "Duraklatıldı",
        noLyrics: "Şarkı sözü mevcut değil"
    },
    // Roulette komutu
    roulette: {
        playingRandom: "🎲 Rastgele parça oynatılıyor: **{title}** - **{author}**",
        error: "Rastgele parça oynatılırken bir hata oluştu!"
    },
    // Ses komutu (volume)
    volume: {
        rangeError: "`0 - 200` arası bir sayı kullan."
    },
    // Davet komutu (invite)
    invite: {
        title: "Ücretli Duvar Yok. Oy Verme Yok. Sadece Müzik.",
        description: `Özellikleri ücretli duvarlar veya oy verme gereksinimleri arkasında kilitleyen botlardan bıktınız mı? Kenium farklı:

- **Sonsuza Kadar Ücretsiz**: Tüm özellikler, tüm platformlar (YouTube, Spotify, SoundCloud, Vimeo) – ücret yok, reklam yok.
- **24/7 Müzik**: Yüksek kaliteli ses, hızlı yanıtlar, sıfır kesinti.
- **Kullanımı Kolay**: Sadece /çal yazın – anında kuyruk, karmaşık kurulum yok.
- **Açık Kaynak**: Şeffaf kod, her zaman inceleme için mevcut.
- **Sınırsız Özellikler**: Oynatma listeleri, filtreler, bas güçlendirme – hepsi ücretsiz.
- **Aqualink ile Güçlendirilmiş**: Hızlı, kararlı ve güvenilir lavalink işleyicisi

Para tuzağı yok. Oy verme yok. Sadece çal tuşuna bas ve keyfini çıkar.

**Daha fazlasını mı istiyorsun?** Aşağıdaki butonlara tıkla!
Daha fazlasını istemiyor musun? [\`Beni davet etmek için buraya tıkla\`](https://discord.com/oauth2/authorize?client_id=1202232935311495209)`,
        supportServer: "Destek Sunucusu",
        github: "GitHub",
        website: "Web Sitesi"
    },
    // Kuyruk komutu (queue)
    queue: {
        title: "Kuyruk",
        page: "Sayfa {current} / {total}",
        nowPlaying: "🎵 Şu An Çalan",
        comingUp: "📋 Sırada",
        queueEmpty: "Kuyruk Boş",
        noTracksInQueue: "🔭 **Kuyrukta parça yok**\n\nBiraz müzik eklemek için `/çal` kullan!",
        tip: "*İpucu: Arayabilir veya URL kullanabilirsin*",
        pause: "Duraklat",
        resume: "Devam Et",
        shuffleOn: "Karıştır: Açık",
        shuffleOff: "Karıştır: Kapalı",
        loopOn: "Döngü: Açık",
        loopOff: "Döngü: Kapalı",
        refresh: "Yenile",
        clear: "Temizle",
        noActivePlayerFound: "❌ Aktif oynatıcı bulunamadı",
        errorDisplayingQueue: "❌ Kuyruk görüntülenirken hata oluştu"
    },
    // Hata mesajları
    errors: {
        general: "Bir hata oluştu",
        notFound: "Bulunamadı",
        noPermission: "Bu komutu kullanma yetkiniz yok",
        invalidLanguage: "Geçersiz dil seçildi",
        databaseError: "Ayarları kaydetme başarısız",
        commandError: "Komut çalıştırılırken hata oluştu",
        unsupportedContentType: "Desteklenmeyen içerik türü."
    },
    // Başarı mesajları
    success: {
        languageSet: "Dil başarıyla **{lang}** olarak değiştirildi!",
        settingsSaved: "Ayarlar başarıyla kaydedildi",
        settingAlradySet: "Bu ayar zaten yapılmış"
    },
    // Oynatma listesi sistemi
    playlist: {
        create: {
            invalidName: "Geçersiz İsim",
            nameTooLong: "Oynatma listesi adı {maxLength} karakterden az olmalı.",
            limitReached: "Oynatma Listesi Sınırına Ulaşıldı",
            maxPlaylists: "En fazla {max} oynatma listeniz olabilir.",
            exists: "Oynatma Listesi Mevcut",
            alreadyExists: "\"{name}\" adında bir oynatma listesi zaten var!",
            created: "Oynatma Listesi Oluşturuldu",
            name: "İsim",
            status: "Durum",
            readyForTracks: "Parçalar için hazır!",
            addTracks: "Parça Ekle",
            viewPlaylist: "Oynatma Listesini Görüntüle"
        },
        add: {
            notFound: "Oynatma Listesi Bulunamadı",
            notFoundDesc: "\"{name}\" adında oynatma listesi yok!",
            full: "Oynatma Listesi Dolu",
            fullDesc: "Bu oynatma listesi {max}-parça sınırına ulaştı!",
            nothingAdded: "Hiçbir Şey Eklenmedi",
            nothingAddedDesc: "Yeni parça eklenmedi. Oynatma listesinde zaten var olabilirler veya eşleşme bulunamadı.",
            tracksAdded: "Parçalar Eklendi",
            trackAdded: "Parça Eklendi",
            tracks: "Parçalar",
            track: "Parça",
            artist: "Sanatçı",
            source: "Kaynak",
            added: "Eklendi",
            total: "Toplam",
            duration: "Süre",
            addMore: "Daha Fazla Ekle",
            playNow: "Şimdi Çal",
            viewAll: "Tümünü Görüntüle",
            addFailed: "Ekleme Başarısız",
            addFailedDesc: "Parçalar eklenemedi: {error}"
        },
        view: {
            noPlaylists: "Oynatma Listesi Yok",
            noPlaylistsDesc: "Henüz hiç oynatma listesi oluşturmadın!",
            gettingStarted: "Başlangıç",
            gettingStartedDesc: "İlk oynatma listeni oluşturmak için `/playlist create` kullan!",
            createPlaylist: "Oynatma Listesi Oluştur",
            yourPlaylists: "Oynatma Listeleriniz",
            yourPlaylistsDesc: "**{count}** oynatma listen{plural} var",
            choosePlaylist: "Görüntülemek için bir oynatma listesi seç...",
            notFound: "Oynatma Listesi Bulunamadı",
            notFoundDesc: "\"{name}\" adında oynatma listesi yok!",
            playlistTitle: "Oynatma Listesi: {name}",
            empty: "Bu oynatma listesi boş",
            description: "Açıklama",
            noDescription: "Açıklama yok",
            info: "Bilgi",
            tracks: "Parçalar",
            plays: "Çalmalar",
            tracksPage: "Parçalar (Sayfa {current}/{total})",
            play: "Çal",
            shuffle: "Karıştır",
            manage: "Yönet",
            previous: "Önceki",
            next: "Sonraki"
        },
        delete: {
            notFound: "Oynatma Listesi Bulunamadı",
            notFoundDesc: "\"{name}\" adında oynatma listesi yok!",
            deleted: "Oynatma Listesi Silindi",
            deletedDesc: "\"{name}\" oynatma listesi başarıyla silindi"
        },
        play: {
            notFound: "Oynatma Listesi Bulunamadı",
            notFoundDesc: "\"{name}\" adında oynatma listesi yok!",
            empty: "Boş Oynatma Listesi",
            emptyDesc: "Bu oynatma listesinde çalınacak parça yok!",
            noVoiceChannel: "Ses Kanalı Yok",
            noVoiceChannelDesc: "Oynatma listesi çalmak için bir ses kanalına katıl",
            loadFailed: "Yükleme Başarısız",
            loadFailedDesc: "Bu oynatma listesinden hiçbir parça yüklenemedi",
            shuffling: "Oynatma Listesi Karıştırılıyor",
            playing: "Oynatma Listesi Çalınıyor",
            playlist: "Oynatma Listesi",
            loaded: "Yüklendi",
            duration: "Süre",
            channel: "Kanal",
            mode: "Mod",
            shuffled: "Karıştırılmış",
            sequential: "Sıralı",
            playFailed: "Çalma Başarısız",
            playFailedDesc: "Oynatma listesi çalınamadı. Lütfen daha sonra tekrar dene."
        },
        remove: {
            notFound: "Oynatma Listesi Bulunamadı",
            notFoundDesc: "\"{name}\" adında oynatma listesi yok!",
            invalidIndex: "Geçersiz İndeks",
            invalidIndexDesc: "Parça indeksi 1 ile {max} arasında olmalı",
            removed: "Parça Kaldırıldı",
            removedTrack: "Kaldırıldı",
            artist: "Sanatçı",
            source: "Kaynak",
            remaining: "Kalan"
        },
        import: {
            invalidFile: "Geçersiz Dosya",
            invalidFileDesc: "Dosya, isim ve parçalar dizisi içeren geçerli bir oynatma listesi içermeli.",
            nameConflict: "İsim Çakışması",
            nameConflictDesc: "\"{name}\" adında bir oynatma listesi zaten var!",
            imported: "Oynatma Listesi İçe Aktarıldı",
            system: "Oynatma Listesi Sistemi",
            importFailed: "İçe Aktarma Başarısız",
            importFailedDesc: "Oynatma listesi içe aktarılamadı: {error}",
            name: "İsim",
            tracks: "Parçalar",
            duration: "Süre"
        }
    },
    // Ortak kelimeler
    common: {
        enabled: "etkin",
        disabled: "devre dışı",
        unknown: "Bilinmeyen",
        loading: "Yükleniyor...",
        page: "Sayfa",
        of: "/",
        close: "Kapat",
        previous: "Önceki",
        next: "Sonraki"
    }
} satisfies typeof English
