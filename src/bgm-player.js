// ==========================================
// [Module 11] src/bgm-player.js
// 耶誕節主題專屬「水晶八音盒（Celesta / Music Box）」背景音樂播放器（純 Web Audio API 合成，0 外部音檔）
// - 兩首完整曲目依序串接無限循環：
//   1. 完整版《Jingle Bells》（主歌 + 副歌）
//   2. 曲間留白約 1 秒後接續完整版《We Wish You a Merry Christmas》（主歌 + 副歌）
// - 常態音量輕柔（0.05），語音導航播報時自動平滑壓低至 15%（Audio Ducking）
// - 僅在「耶誕節主題」開啟時播放；關閉主題、極致省電模式 (body.power-saving) 或切至背景時自動停止／暫停
// ==========================================

(function initChristmasCrystalBgmPlayer() {
    const STORAGE_KEY = 'yingge_bgm_enabled_v1';
    const NORMAL_VOLUME = 0.05; // 輕柔背景陪襯音量（0.04~0.06）
    const DUCK_RATIO = 0.15;    // 語音播報時平滑壓低至原音量 15%

    // 高音域水晶八音盒音名頻率表（Hz）
    const NOTE_FREQ = {
        G4: 392.00, A4: 440.00, B4: 493.88,
        C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00, B5: 987.77,
        C6: 1046.50
    };

    // 1. 完整版《Jingle Bells》（主歌 Dashing through the snow + 副歌 Jingle bells）
    const JINGLE_BELLS_FULL = [
        // 主歌 A：Dashing through the snow, in a one-horse open sleigh
        'G4', 'E5', 'D5', 'C5', 'G4', '-', '-', '-',
        'G4', 'E5', 'D5', 'C5', 'A4', '-', '-', '-',
        // O'er the fields we go, laughing all the way
        'A4', 'F5', 'E5', 'D5', 'B4', '-', '-', '-',
        'G5', 'G5', 'F5', 'D5', 'E5', '-', '-', '-',
        // 主歌 B：Bells on bobtails ring, making spirits bright
        'G4', 'E5', 'D5', 'C5', 'G4', '-', '-', '-',
        'G4', 'E5', 'D5', 'C5', 'A4', '-', '-', 'A4',
        // What fun it is to ride and sing a sleighing song tonight, Oh!
        'A4', 'F5', 'E5', 'D5', 'G5', 'G5', 'G5', 'G5',
        'A5', 'G5', 'F5', 'D5', 'C5', '-', 'G5', '-',

        // 副歌 1：Jingle bells, jingle bells, jingle all the way
        'E5', 'E5', 'E5', '-', 'E5', 'E5', 'E5', '-',
        'E5', 'G5', 'C5', 'D5', 'E5', '-', '-', '-',
        // Oh what fun it is to ride in a one-horse open sleigh, hey!
        'F5', 'F5', 'F5', 'F5', 'F5', 'E5', 'E5', 'E5',
        'E5', 'D5', 'D5', 'E5', 'D5', '-', 'G5', '-',

        // 副歌 2：Jingle bells, jingle bells, jingle all the way
        'E5', 'E5', 'E5', '-', 'E5', 'E5', 'E5', '-',
        'E5', 'G5', 'C5', 'D5', 'E5', '-', '-', '-',
        // Oh what fun it is to ride in a one-horse open sleigh!
        'F5', 'F5', 'F5', 'F5', 'F5', 'E5', 'E5', 'E5',
        'G5', 'G5', 'F5', 'D5', 'C5', '-', '-', '-'
    ];

    // 2. 完整版《We Wish You a Merry Christmas》（副歌 + 主歌 Good tidings + 尾聲副歌）
    const WE_WISH_YOU_FULL = [
        // 副歌：We wish you a Merry Christmas x3, and a Happy New Year
        'G4', '-', 'C5', '-', 'C5', 'D5', 'C5', 'B4', 'A4', '-', 'A4', '-', 'A4', '-',
        'D5', '-', 'D5', 'E5', 'D5', 'C5', 'B4', '-', 'G4', '-', 'G4', '-',
        'E5', '-', 'E5', 'F5', 'E5', 'D5', 'C5', '-', 'A4', '-', 'G4', 'G4',
        'A4', '-', 'D5', '-', 'B4', '-', 'C5', '-', '-', '-',

        // 主歌：Good tidings we bring to you and your kin; Good tidings for Christmas and a Happy New Year
        'G4', '-', 'C5', '-', 'C5', '-', 'C5', '-', 'B4', '-', '-', '-',
        'B4', '-', 'C5', '-', 'B4', '-', 'A4', '-', 'G4', '-', '-', '-',
        'D5', '-', 'E5', '-', 'D5', '-', 'C5', '-', 'G5', '-', 'G4', 'G4',
        'A4', '-', 'D5', '-', 'B4', '-', 'C5', '-', '-', '-',

        // 尾聲副歌：We wish you a Merry Christmas x3, and a Happy New Year
        'G4', '-', 'C5', '-', 'C5', 'D5', 'C5', 'B4', 'A4', '-', 'A4', '-', 'A4', '-',
        'D5', '-', 'D5', 'E5', 'D5', 'C5', 'B4', '-', 'G4', '-', 'G4', '-',
        'E5', '-', 'E5', 'F5', 'E5', 'D5', 'C5', '-', 'A4', '-', 'G4', 'G4',
        'A4', '-', 'D5', '-', 'B4', '-', 'C5', '-', '-', '-'
    ];

    const PLAYLIST = [
        { name: 'Jingle Bells', stepMs: 245, notes: JINGLE_BELLS_FULL },
        { name: 'We Wish You a Merry Christmas', stepMs: 240, notes: WE_WISH_YOU_FULL }
    ];
    const INTER_SONG_GAP_MS = 1000; // 曲間留白約 1 秒

    let audioCtx = null;
    let masterGain = null;
    let stepTimer = null;
    let gapTimer = null;
    let duckWatchTimer = null;
    let songIndex = 0;
    let stepIndex = 0;
    let isBgmEnabled = true; // 預設開啟（使用者若手動關閉會記憶於 localStorage）
    let isVoiceDucking = false;

    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === '0') isBgmEnabled = false;
        else if (saved === '1') isBgmEnabled = true;
    } catch (e) {}

    function isChristmasThemeActive() {
        const body = document.body;
        if (!body) return false;
        const attrTheme = (body.getAttribute('data-theme') || '').toLowerCase();
        return attrTheme === 'christmas' || body.classList.contains('theme-christmas');
    }

    function isPausedBySystemState() {
        if (!isChristmasThemeActive()) return true;
        if (document.hidden) return true;
        if (document.body && document.body.classList.contains('power-saving')) return true;
        return false;
    }

    function ensureAudioContext() {
        if (!audioCtx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return null;
            try {
                audioCtx = new Ctx();
                masterGain = audioCtx.createGain();
                masterGain.gain.setValueAtTime(
                    isVoiceDucking ? NORMAL_VOLUME * DUCK_RATIO : NORMAL_VOLUME,
                    audioCtx.currentTime
                );
                masterGain.connect(audioCtx.destination);
            } catch (e) {
                audioCtx = null;
                masterGain = null;
                return null;
            }
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
        }
        return audioCtx;
    }

    function applyGainTarget(immediate = false) {
        if (!audioCtx || !masterGain) return;
        const now = audioCtx.currentTime;
        const target = (!isBgmEnabled || isPausedBySystemState())
            ? 0.0001
            : (isVoiceDucking ? NORMAL_VOLUME * DUCK_RATIO : NORMAL_VOLUME);
        try {
            masterGain.gain.cancelScheduledValues(now);
            if (immediate) {
                masterGain.gain.setValueAtTime(target, now);
            } else {
                const timeConst = isVoiceDucking ? 0.06 : 0.16;
                masterGain.gain.setTargetAtTime(target, now, timeConst);
            }
        } catch (e) {}
    }

    // 清脆透亮「水晶八音盒（Celesta / Music Box）」合成音色：
    // - 主音：高音域 sine（attack ~0.008s，release ~0.75s）
    // - 高八度泛音敲擊瞬態：極輕量 2x sine + 3x 晶亮點綴（快速衰減，營造金屬琴鍵／水晶敲擊感）
    function playCrystalNote(freq) {
        if (!audioCtx || !masterGain || !freq) return;
        const now = audioCtx.currentTime;
        const attack = 0.008;
        const release = 0.75;

        // 1. 主正弦波（溫潤清澈延音）
        const oscMain = audioCtx.createOscillator();
        const envMain = audioCtx.createGain();
        oscMain.type = 'sine';
        oscMain.frequency.setValueAtTime(freq, now);

        envMain.gain.setValueAtTime(0.0001, now);
        envMain.gain.linearRampToValueAtTime(0.82, now + attack);
        envMain.gain.exponentialRampToValueAtTime(0.0001, now + attack + release);

        oscMain.connect(envMain);
        envMain.connect(masterGain);
        oscMain.start(now);
        oscMain.stop(now + attack + release + 0.05);

        // 2. 高八度水晶泛音（清脆八音盒共鳴）
        const oscOct = audioCtx.createOscillator();
        const envOct = audioCtx.createGain();
        oscOct.type = 'sine';
        oscOct.frequency.setValueAtTime(freq * 2, now);

        envOct.gain.setValueAtTime(0.0001, now);
        envOct.gain.linearRampToValueAtTime(0.22, now + 0.005);
        envOct.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

        oscOct.connect(envOct);
        envOct.connect(masterGain);
        oscOct.start(now);
        oscOct.stop(now + 0.32);

        // 3. 極輕量高頻敲擊瞬態（3 倍泛音，瞬間消散增加晶透感）
        const oscSparkle = audioCtx.createOscillator();
        const envSparkle = audioCtx.createGain();
        oscSparkle.type = 'triangle';
        oscSparkle.frequency.setValueAtTime(freq * 3, now);

        envSparkle.gain.setValueAtTime(0.0001, now);
        envSparkle.gain.linearRampToValueAtTime(0.075, now + 0.003);
        envSparkle.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);

        oscSparkle.connect(envSparkle);
        envSparkle.connect(masterGain);
        oscSparkle.start(now);
        oscSparkle.stop(now + 0.14);
    }

    function stopTimers() {
        if (stepTimer !== null) {
            clearInterval(stepTimer);
            stepTimer = null;
        }
        if (gapTimer !== null) {
            clearTimeout(gapTimer);
            gapTimer = null;
        }
        if (duckWatchTimer !== null) {
            clearInterval(duckWatchTimer);
            duckWatchTimer = null;
        }
    }

    function startCurrentSongLoop() {
        stopTimers();
        if (!isBgmEnabled || isPausedBySystemState()) return;

        const ctx = ensureAudioContext();
        if (!ctx) return;

        applyGainTarget(false);
        const song = PLAYLIST[songIndex % PLAYLIST.length];

        const tick = () => {
            if (!isBgmEnabled || isPausedBySystemState()) {
                stopTimers();
                applyGainTarget(false);
                return;
            }
            if (!audioCtx || audioCtx.state !== 'running') return;

            if (stepIndex >= song.notes.length) {
                // 本曲播畢：留白約 1 秒後自動切換下一首並循環
                stopTimers();
                songIndex = (songIndex + 1) % PLAYLIST.length;
                stepIndex = 0;
                gapTimer = setTimeout(() => {
                    gapTimer = null;
                    if (isBgmEnabled && !isPausedBySystemState()) {
                        startCurrentSongLoop();
                    }
                }, INTER_SONG_GAP_MS);
                return;
            }

            const noteName = song.notes[stepIndex];
            stepIndex += 1;

            if (noteName && noteName !== '-') {
                const freq = NOTE_FREQ[noteName];
                if (freq) playCrystalNote(freq);
            }
        };

        tick();
        stepTimer = setInterval(tick, song.stepMs);

        // 安全監看 speechSynthesis.speaking 狀態，確保語音播報必觸發 Audio Ducking
        duckWatchTimer = setInterval(() => {
            const speakingNow = Boolean(
                (typeof VoiceQueue !== 'undefined' && VoiceQueue.isSpeaking) ||
                ('speechSynthesis' in window && window.speechSynthesis && window.speechSynthesis.speaking)
            );
            if (speakingNow !== isVoiceDucking) {
                setVoiceDucking(speakingNow);
            }
        }, 180);
    }

    function setEnabled(enabled) {
        isBgmEnabled = Boolean(enabled);
        try {
            localStorage.setItem(STORAGE_KEY, isBgmEnabled ? '1' : '0');
        } catch (e) {}

        if (isBgmEnabled && !isPausedBySystemState()) {
            ensureAudioContext();
            startCurrentSongLoop();
        } else {
            stopTimers();
            applyGainTarget(false);
        }

        if (typeof renderMapLayerMenuOptions === 'function') {
            renderMapLayerMenuOptions();
        }
    }

    function toggle() {
        setEnabled(!isBgmEnabled);
        return isBgmEnabled;
    }

    function setVoiceDucking(ducking) {
        const next = Boolean(ducking);
        if (next === isVoiceDucking) return;
        isVoiceDucking = next;
        applyGainTarget(false);
    }

    function setTheme(themeKey) {
        const isXmas = themeKey === 'christmas' || isChristmasThemeActive();
        if (!isXmas) {
            stopTimers();
            applyGainTarget(false);
            return;
        }
        if (isBgmEnabled && !isPausedBySystemState()) {
            if (stepTimer === null && gapTimer === null) {
                songIndex = 0;
                stepIndex = 0;
                startCurrentSongLoop();
            }
        } else {
            stopTimers();
            applyGainTarget(false);
        }
    }

    function syncPlaybackState() {
        if (!isBgmEnabled || isPausedBySystemState()) {
            stopTimers();
            applyGainTarget(false);
            return;
        }
        const ctx = ensureAudioContext();
        if (ctx && stepTimer === null && gapTimer === null) {
            startCurrentSongLoop();
        } else {
            applyGainTarget(false);
        }
    }

    function unlockAndSync() {
        if (!isBgmEnabled || isPausedBySystemState()) return;
        const ctx = ensureAudioContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') {
            ctx.resume().then(() => {
                if (isBgmEnabled && !isPausedBySystemState() && stepTimer === null && gapTimer === null) {
                    startCurrentSongLoop();
                }
            }).catch(() => {});
        } else if (stepTimer === null && gapTimer === null) {
            startCurrentSongLoop();
        }
    }

    // 行動裝置首次互動解鎖 AudioContext（僅當聖誕主題與音樂皆為開啟時）
    const onFirstUserGesture = () => {
        if (isBgmEnabled && !isPausedBySystemState()) {
            unlockAndSync();
        }
    };
    ['pointerdown', 'touchstart', 'click'].forEach(evt => {
        document.addEventListener(evt, onFirstUserGesture, { passive: true });
    });

    // 切至背景分頁自動暫停，切回前景且非省電模式時自動恢復
    document.addEventListener('visibilitychange', () => {
        syncPlaybackState();
    });

    window.BgmPlayer = {
        toggle,
        setEnabled,
        isEnabled: () => isBgmEnabled,
        setTheme,
        setVoiceDucking,
        syncPlaybackState,
        unlockAndSync
    };
})();
