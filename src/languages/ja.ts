import type English from "./en";

export default {
    hello: "こんにちは",
    ping: {
        description: "**ゲートウェイ**: {wsPing}ms\n**シャード**: {shardPing}ms\n**プレイヤー**: {playerPing}ms",
        descriptionNoPlayer: "**ゲートウェイ**: {wsPing}ms\n**シャード**: {shardPing}ms",
        title: "Ping情報"
    },
    language: {
        set: "言語を{lang}に設定しました",
        name: "言語",
        description: "ボットの言語を設定"
    },
    commands: {
        ping: {
            name: "ピング",
            description: "Discordとのpingを表示"
        },
        language: {
            name: "言語",
            description: "ボットの言語を設定"
        },
        play: {
            name: "再生",
            description: "検索またはURLで曲を再生します。"
        },
        "play-file": {
            name: "ファイル再生",
            description: "コンピュータからファイルを再生します。"
        },
        pause: {
            name: "一時停止",
            description: "音楽を一時停止"
        },
        resume: {
            name: "再開",
            description: "音楽を再開"
        },
        stop: {
            name: "停止",
            description: "音楽を停止"
        },
        skip: {
            name: "スキップ",
            description: "現在の曲をスキップ"
        },
        previous: {
            name: "前の曲",
            description: "前の曲を再生"
        },
        queue: {
            name: "キュー",
            description: "コントロール付きの音楽キューを表示"
        },
        nowplaying: {
            name: "現在再生中",
            description: "現在再生中の曲を表示"
        },
        volume: {
            name: "音量",
            description: "音量を設定"
        },
        clear: {
            name: "クリア",
            description: "音楽キューをクリア"
        },
        shuffle: {
            name: "シャッフル",
            description: "キューをシャッフル"
        },
        loop: {
            name: "ループ",
            description: "ループモードを設定"
        },
        autoplay: {
            name: "自動再生",
            description: "自動再生を切り替え"
        },
        filters: {
            name: "フィルター",
            description: "オーディオフィルターを適用"
        },
        jump: {
            name: "ジャンプ",
            description: "キューの特定の位置にジャンプ"
        },
        remove: {
            name: "削除",
            description: "キューから曲を削除"
        },
        grab: {
            name: "取得",
            description: "現在の曲を取得してDMに送信"
        },
        lyrics: {
            name: "歌詞",
            description: "現在の曲の歌詞を取得"
        },
        export: {
            name: "エクスポート",
            description: "キューをエクスポート"
        },
        import: {
            name: "インポート",
            description: "ファイルからキューをインポート"
        },
        destroy: {
            name: "破棄",
            description: "音楽プレイヤーを破棄"
        },
        "247": {
            name: "247",
            description: "24/7モードを切り替え"
        },
        changelog: {
            name: "変更履歴",
            description: "ボットの変更履歴を表示"
        },
        help: {
            name: "ヘルプ",
            description: "利用可能なコマンドを表示"
        },
        invite: {
            name: "招待",
            description: "ボット招待リンクを取得"
        },
        search: {
            name: "検索",
            description: "音楽プラットフォームで曲を検索"
        },
        seek: {
            name: "シーク",
            description: "曲の特定の位置にシーク"
        },
        restart: {
            name: "再起動",
            description: "音楽を再起動"
        },
        status: {
            name: "ステータス",
            description: "ボットのステータスを表示"
        },
        tts: {
            name: "TTS",
            description: "TTSメッセージを生成して送信"
        },
        karaoke: {
            name: "カラオケ",
            description: "同期された歌詞でカラオケセッションを開始"
        },
        roulette: {
            name: "ルーレット",
            description: "キューからランダムなトラックを再生"
        }
    },
    // 音楽プレイヤーメッセージ
    player: {
        noVoiceChannel: "このコマンドを使用するにはボイスチャンネルにいる必要があります。",
        noPlayer: "音楽プレイヤーが見つかりません。",
        noTrack: "現在再生中のトラックがありません。",
        alreadyPaused: "曲は既に一時停止中です。",
        alreadyResumed: "曲は既に再生中です。",
        paused: "曲を一時停止しました。",
        resumed: "曲を再開しました。",
        stopped: "音楽を停止しました。",
        destroyed: "音楽プレイヤーを破棄しました。",
        queueEmpty: "キューが空です。",
        queueCleared: "キューをクリアしました。",
        trackAdded: "**[{title}]({uri})** をキューに追加しました。",
        playlistAdded: "プレイリスト **[`{name}`]({uri})** ({count} トラック) をキューに追加しました。",
        noTracksFound: "指定されたクエリのトラックが見つかりません。",
        invalidPosition: "位置は1から{max}の間である必要があります。",
        jumpedTo: "曲{position}にジャンプしました。",
        jumpedToSong: "曲 \"{title}\" にジャンプしました。",
        songNotFound: "キューで \"{title}\" を見つけることができませんでした。",
        alreadyAtPosition: "既に位置1にあります。",
        alreadyPlaying: "\"{title}\" は既に再生中です。",
        volumeSet: "音量を{volume}%に設定しました。",
        invalidVolume: "音量は0から100の間である必要があります。",
        autoplayEnabled: "自動再生が**有効**になりました。",
        autoplayDisabled: "自動再生が**無効**になりました。",
        loopEnabled: "ループが**有効**になりました。",
        loopDisabled: "ループが**無効**になりました。",
        filterApplied: "**{filter}** フィルターを適用しました。",
        filtersCleared: "すべてのフィルターをクリアしました。",
        filterInvalid: "無効なフィルターです。",
        nowPlaying: "現在再生中",
        requestedBy: "リクエスト者",
        duration: "再生時間",
        author: "作成者",
        position: "位置",
        volume: "音量",
        loop: "ループ",
        autoplay: "自動再生",
        queueSize: "キューサイズ",
        enabled: "有効",
        disabled: "無効",
        none: "なし",
        track: "トラック",
        queue: "キュー",
        restarted: "音楽を再起動しました",
        shuffled: "キューをシャッフルしました",
        skipped: "曲をスキップしました",
        previousPlayed: "前の曲を再生中",
        previousAdded: "前の曲を追加しました",
        volumeChanged: "音量を変更しました",
        removedSong: "曲を削除しました",
        seeked: "曲をシークしました",
        fileAdded: "キューに追加しました",
        noTrackFound: "トラックが見つかりません"
    },
    // 24/7モード
    mode247: {
        title: "24/7モード",
        enabled: "24/7モードが有効になりました",
        disabled: "24/7モードが無効になりました"
    },
    // エクスポート/インポート
    export: {
        emptyQueue: "キューが空です",
        success: "インポート用URLでキューをエクスポートしました"
    },
    import: {
        emptyFile: "ファイルが空です",
        noValidTracks: "ファイルに有効なトラックが見つかりません",
        importing: "{count} トラックをインポート中...",
        complete: "インポート完了",
        successfullyImported: "正常にインポートされました: **{count}** トラック",
        failedToImport: "インポートに失敗しました: **{count}** トラック",
        totalQueueSize: "総キューサイズ: **{count}** トラック"
    },
    // 取得コマンド (grab)
    grab: {
        title: "現在再生中: **{title}**",
        listenHere: "[ここで聴く]({uri})",
        duration: "再生時間",
        author: "作成者",
        server: "サーバー",
        footer: "現在のセッションから取得",
        sentToDm: "トラックの詳細をDMに送信しました。",
        dmError: "DMを送信できませんでした。プライバシー設定を確認してください。",
        noSongPlaying: "現在再生中の曲がありません。"
    },
    // ヘルプコマンド (help)
    help: {
        pageTitle: "ページ {current} / {total}",
        previous: "前へ",
        next: "次へ"
    },
    // 歌詞コマンド (lyrics)
    lyrics: {
        title: "歌詞",
        error: "歌詞エラー",
        noLyricsFound: "歌詞が見つかりません",
        serviceUnavailable: "歌詞サービスが利用できません",
        syncedLyrics: "同期歌詞",
        textLyrics: "テキスト歌詞",
        artist: "アーティスト",
        noActivePlayer: "アクティブなプレイヤーが見つかりません"
    },
    // ジャンプコマンド (jump)
    jump: {
        noSongsInQueue: "キューに曲がありません",
        specifyPositionOrName: "位置番号または曲名を指定してください"
    },
    // フィルター名
    filters: {
        "8d": "8D",
        equalizer: "イコライザー",
        karaoke: "カラオケ",
        timescale: "タイムスケール",
        tremolo: "トレモロ",
        vibrato: "ビブラート",
        rotation: "ローテーション",
        distortion: "ディストーション",
        channelMix: "チャンネルミックス",
        lowPass: "ローパス",
        bassboost: "ベースブースト",
        slowmode: "スローモード",
        nightcore: "ナイトコア",
        vaporwave: "ベイパーウェーブ",
        clear: "クリア",
        invalidFilter: "無効なフィルターが選択されました。"
    },
    // 検索コマンド (search)
    search: {
        noVoiceChannel: "🎵 まずボイスチャンネルに参加してください！",
        alreadyConnected: "🎵 既にこのチャンネルで音楽を再生しています",
        noResults: "🔍 結果が見つかりません。他のプラットフォームを試してください！",
        trackAdded: "✅ キューに追加しました",
        searchError: "❌ 検索に失敗しました。もう一度お試しください。",
        genericError: "❌ エラーが発生しました。もう一度お試しください。",
        invalidQuery: "❌ クエリが短すぎるか無効な文字が含まれています",
        multiSearchStarted: "🔍 複数のプラットフォームで検索中...",
        failedToJoinVoice: "❌ ボイスチャンネルへの参加に失敗しました。"
    },
    // ステータスコマンド
    status: {
        title: "ボットステータス",
        systemUptime: "システム稼働時間",
        systemCpuModel: "システムCPUモデル",
        systemCpuLoad: "システムCPU負荷",
        lavalinkUptime: "Lavalink稼働時間",
        lavalinkVersion: "Lavalinkバージョン",
        systemMemory: "システムメモリ",
        systemMemBar: "システムメモリバー",
        lavalinkMemory: "Lavalinkメモリ",
        lavalinkMemBar: "Lavalinkメモリバー",
        lavalinkCpuLoad: "Lavalink CPU負荷",
        lavalinkPlayers: "Lavalinkプレイヤー",
        lavalinkNodes: "Lavalinkノード",
        ping: "Ping",
        processMemory: "プロセスメモリ"
    },
    // TTSコマンド
    tts: {
        generated: "TTSメッセージを生成しました"
    },
    // karaokeコマンド
    karaoke: {
        error: "カラオケエラー",
        sessionEnded: "カラオケセッションが終了しました",
        noActivePlayer: "アクティブなプレイヤーが見つかりません",
        sessionAlreadyActive: "このサーバーでは既にアクティブなカラオケセッションがあります。終了するまで待つか、現在のセッションを停止するためにコマンドを再度使用してください。",
        noLyricsAvailable: "同期された歌詞が利用できません。別の曲を試してください。",
        playing: "再生中",
        paused: "一時停止",
        noLyrics: "歌詞が利用できません"
    },
    // rouletteコマンド
    roulette: {
        playingRandom: "🎲 ランダムなトラックを再生中: **{title}** - **{author}**",
        error: "ランダムなトラックの再生中にエラーが発生しました!"
    },
    // 音量コマンド
    volume: {
        rangeError: "`0 - 200`の間の数字を使用してください。"
    },
    // 招待コマンド (invite)
    invite: {
        title: "ペイウォールなし。投票なし。音楽のみ。",
        description: `ペイウォールや投票要件の背後に機能をロックするボットにうんざりしていませんか？Keniumは違います：

- **永遠に無料**: すべての機能、すべてのプラットフォーム（YouTube、Spotify、SoundCloud、Vimeo）— 料金なし、広告なし。
- **24/7音楽**: 高品質オーディオ、高速レスポンス、ダウンタイムゼロ。
- **使いやすい**: /再生と入力するだけ — 即座のキュー、複雑な設定なし。
- **オープンソース**: 透明なコード、常にレビュー可能。
- **無制限の機能**: プレイリスト、フィルター、ベースブースト — すべて無料。
- **Aqualinkで動作**: 高速、安定、信頼性の高いlavalink handler

現金稼ぎなし。投票なし。再生ボタンを押して楽しむだけ。

**もっと欲しいですか？** 下のボタンをクリックしてください！
もう要らない？ [\`私を招待するにはここをクリック\`](https://discord.com/oauth2/authorize?client_id=1202232935311495209)`,
        supportServer: "サポートサーバー",
        github: "GitHub",
        website: "ウェブサイト"
    },
    // キューコマンド (queue)
    queue: {
        title: "キュー",
        page: "ページ {current} / {total}",
        nowPlaying: "🎵 現在再生中",
        comingUp: "📋 次の曲",
        queueEmpty: "キューが空です",
        noTracksInQueue: "🔭 **キューにトラックがありません**\n\n音楽を追加するには `/再生` を使用してください！",
        tip: "*ヒント: 検索やURLを使用できます*",
        pause: "一時停止",
        resume: "再開",
        shuffleOn: "シャッフル: オン",
        shuffleOff: "シャッフル: オフ",
        loopOn: "ループ: オン",
        loopOff: "ループ: オフ",
        refresh: "更新",
        clear: "クリア",
        noActivePlayerFound: "❌ アクティブなプレイヤーが見つかりません",
        errorDisplayingQueue: "❌ キューの表示中にエラーが発生しました"
    },
    // エラーメッセージ
    errors: {
        general: "エラーが発生しました",
        notFound: "見つかりません",
        noPermission: "このコマンドを使用する権限がありません",
        invalidLanguage: "無効な言語が選択されました",
        databaseError: "設定の保存に失敗しました",
        commandError: "コマンドの実行中にエラーが発生しました",
        unsupportedContentType: "サポートされていないコンテンツタイプです。"
    },
    // 成功メッセージ
    success: {
        languageSet: "言語が正常に**{lang}**に変更されました！",
        settingsSaved: "設定が正常に保存されました",
        settingAlradySet: "この設定は既に設定されています"
    },
    // プレイリストシステム
    playlist: {
        create: {
            invalidName: "無効な名前",
            nameTooLong: "プレイリスト名は{maxLength}文字未満である必要があります。",
            limitReached: "プレイリスト制限に達しました",
            maxPlaylists: "最大{max}個のプレイリストしか作成できません。",
            exists: "プレイリストが存在します",
            alreadyExists: "\"{name}\"という名前のプレイリストが既に存在します！",
            created: "プレイリストが作成されました",
            name: "名前",
            status: "ステータス",
            readyForTracks: "トラックの準備完了！",
            addTracks: "トラックを追加",
            viewPlaylist: "プレイリストを表示"
        },
        add: {
            notFound: "プレイリストが見つかりません",
            notFoundDesc: "\"{name}\"という名前のプレイリストは存在しません！",
            full: "プレイリストが満杯です",
            fullDesc: "このプレイリストは{max}トラックの制限に達しています！",
            nothingAdded: "何も追加されませんでした",
            nothingAddedDesc: "新しいトラックは追加されませんでした。プレイリストに既に存在するか、一致するものが見つかりませんでした。",
            tracksAdded: "トラックが追加されました",
            trackAdded: "トラックが追加されました",
            tracks: "トラック",
            track: "トラック",
            artist: "アーティスト",
            source: "ソース",
            added: "追加済み",
            total: "合計",
            duration: "再生時間",
            addMore: "さらに追加",
            playNow: "今すぐ再生",
            viewAll: "すべて表示",
            addFailed: "追加に失敗しました",
            addFailedDesc: "トラックを追加できませんでした: {error}"
        },
        view: {
            noPlaylists: "プレイリストがありません",
            noPlaylistsDesc: "まだプレイリストを作成していません！",
            gettingStarted: "はじめに",
            gettingStartedDesc: "最初のプレイリストを作成するには `/playlist create` を使用してください！",
            createPlaylist: "プレイリストを作成",
            yourPlaylists: "あなたのプレイリスト",
            yourPlaylistsDesc: "**{count}**個のプレイリスト{plural}があります",
            choosePlaylist: "表示するプレイリストを選択してください...",
            notFound: "プレイリストが見つかりません",
            notFoundDesc: "\"{name}\"という名前のプレイリストは存在しません！",
            playlistTitle: "プレイリスト: {name}",
            empty: "このプレイリストは空です",
            description: "説明",
            noDescription: "説明なし",
            info: "情報",
            tracks: "トラック",
            plays: "再生回数",
            tracksPage: "トラック (ページ {current}/{total})",
            play: "再生",
            shuffle: "シャッフル",
            manage: "管理",
            previous: "前へ",
            next: "次へ"
        },
        delete: {
            notFound: "プレイリストが見つかりません",
            notFoundDesc: "\"{name}\"という名前のプレイリストは存在しません！",
            deleted: "プレイリストが削除されました",
            deletedDesc: "プレイリスト \"{name}\" が正常に削除されました"
        },
        play: {
            notFound: "プレイリストが見つかりません",
            notFoundDesc: "\"{name}\"という名前のプレイリストは存在しません！",
            empty: "空のプレイリスト",
            emptyDesc: "このプレイリストには再生するトラックがありません！",
            noVoiceChannel: "ボイスチャンネルがありません",
            noVoiceChannelDesc: "プレイリストを再生するにはボイスチャンネルに参加してください",
            loadFailed: "読み込みに失敗しました",
            loadFailedDesc: "このプレイリストからトラックを読み込めませんでした",
            shuffling: "プレイリストをシャッフル中",
            playing: "プレイリストを再生中",
            playlist: "プレイリスト",
            loaded: "読み込み済み",
            duration: "再生時間",
            channel: "チャンネル",
            mode: "モード",
            shuffled: "シャッフル済み",
            sequential: "順序",
            playFailed: "再生に失敗しました",
            playFailedDesc: "プレイリストを再生できませんでした。後でもう一度お試しください。"
        },
        remove: {
            notFound: "プレイリストが見つかりません",
            notFoundDesc: "\"{name}\"という名前のプレイリストは存在しません！",
            invalidIndex: "無効なインデックス",
            invalidIndexDesc: "トラックインデックスは1から{max}の間である必要があります",
            removed: "トラックが削除されました",
            removedTrack: "削除済み",
            artist: "アーティスト",
            source: "ソース",
            remaining: "残り"
        },
        import: {
            invalidFile: "無効なファイル",
            invalidFileDesc: "ファイルには名前とトラック配列を含む有効なプレイリストが含まれている必要があります。",
            nameConflict: "名前の競合",
            nameConflictDesc: "\"{name}\"という名前のプレイリストが既に存在します！",
            imported: "プレイリストがインポートされました",
            system: "プレイリストシステム",
            importFailed: "インポートに失敗しました",
            importFailedDesc: "プレイリストをインポートできませんでした: {error}",
            name: "名前",
            tracks: "トラック",
            duration: "再生時間"
        }
    },
    // 一般的な単語
    common: {
        enabled: "有効",
        disabled: "無効",
        unknown: "不明",
        loading: "読み込み中...",
        page: "ページ",
        of: "/",
        close: "閉じる",
        previous: "前へ",
        next: "次へ"
    }
} satisfies typeof English
