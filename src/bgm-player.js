// ==========================================
// [Module 11] src/bgm-player.js
// 耶誕節主題專屬「擬真鐵琴（Vibraphone）＋ 雙手交錯琶音和弦」合成器（純 Web Audio API，0 外部音檔）
// - 毛氈琴槌敲擊與金屬共鳴頻譜：sine 主基頻 ＋ 12% 4倍頻 ＋ 3% 10倍頻（前 25ms 快速衰減）
// - 經典鐵琴共鳴管微顫音（4.8Hz 柔和 LFO）＋ 輕量空間殘響（ConvolverNode）
// - 左手和弦伴奏以 30ms 間隔交錯滾奏短琶音（音量為主旋律 42%）
// - 兩首完整版聖誕曲目無限循環：《Jingle Bells》→ 留白 1 秒 →《We Wish You a Merry Christmas》
// - 常態音量輕柔（0.05），語音播報自動平滑壓低至 15%（Audio Ducking），省電／背景自動暫停
// ==========================================

(function initChristmasVibraphoneBgmPlayer() {
    const STORAGE_KEY = 'yingge_bgm_enabled_v1';
    const NORMAL_VOLUME = 0.05; // 輕柔背景陪襯音量（0.04~0.06）
    const DUCK_RATIO = 0.15;    // 語音播報時平滑壓低至原音量 15%
    const CHORD_VOL_RATIO = 0.42; // 左手琶音和弦為主旋律音量的 42%
    const CHORD_ROLL_SEC = 0.030; // 雙手琴槌交錯滾奏間隔 30ms

    // 完整音名對照頻率表（Hz，涵蓋左手伴奏低中音域與右手鐵琴主旋律）
    const NOTE_FREQ = {
        G2: 98.00, A2: 110.00, B2: 123.47,
        C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, Fs3: 185.00, G3: 196.00, Gs3: 207.65, A3: 220.00, B3: 246.94,
        C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, Fs4: 369.99, G4: 392.00, A4: 440.00, B4: 493.88,
        C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00, B5: 987.77,
        C6: 1046.50
    };

    // 左手伴奏和弦音階定義（溫暖鐵琴中低音排列）
    const CHORDS = {
        C:   ['C3', 'G3', 'C4', 'E4'],
        F:   ['F3', 'C4', 'F4', 'A4'],
        G:   ['G3', 'B3', 'D4', 'G4'],
        G7:  ['G3', 'B3', 'D4', 'F4'],
        Am:  ['A3', 'C4', 'E4', 'A4'],
        Dm:  ['D3', 'A3', 'D4', 'F4'],
        D7:  ['D3', 'Fs3', 'C4', 'D4'],
        E7:  ['E3', 'Gs3', 'B3', 'D4']
    };

    // 1. 完整版《Jingle Bells》（主歌 + 副歌，含左手和弦節拍對應）
    const JINGLE_BELLS_NOTES = [
        // 主歌 A (0..31)
        'G4', 'E5', 'D5', 'C5', 'G4', '-', '-', '-',
        'G4', 'E5', 'D5', 'C5', 'A4', '-', '-', '-',
        'A4', 'F5', 'E5', 'D5', 'B4', '-', '-', '-',
        'G5', 'G5', 'F5', 'D5', 'E5', '-', '-', '-',
        // 主歌 B (32..63)
        'G4', 'E5', 'D5', 'C5', 'G4', '-', '-', '-',
        'G4', 'E5', 'D5', 'C5', 'A4', '-', '-', 'A4',
        'A4', 'F5', 'E5', 'D5', 'G5', 'G5', 'G5', 'G5',
        'A5', 'G5', 'F5', 'D5', 'C5', '-', 'G5', '-',
        // 副歌 1 (64..95)
        'E5', 'E5', 'E5', '-', 'E5', 'E5', 'E5', '-',
        'E5', 'G5', 'C5', 'D5', 'E5', '-', '-', '-',
        'F5', 'F5', 'F5', 'F5', 'F5', 'E5', 'E5', 'E5',
        'E5', 'D5', 'D5', 'E5', 'D5', '-', 'G5', '-',
        // 副歌 2 (96..127)
        'E5', 'E5', 'E5', '-', 'E5', 'E5', 'E5', '-',
        'E5', 'G5', 'C5', 'D5', 'E5', '-', '-', '-',
        'F5', 'F5', 'F5', 'F5', 'F5', 'E5', 'E5', 'E5',
        'G5', 'G5', 'F5', 'D5', 'C5', '-', '-', '-'
    ];
    const JINGLE_BELLS_CHORDS = {
        0: 'C', 8: 'C', 12: 'F', 16: 'Dm', 20: 'G7', 24: 'G7', 28: 'C',
        32: 'C', 40: 'C', 44: 'F', 48: 'F', 52: 'G7', 56: 'G7', 60: 'C',
        64: 'C', 72: 'C', 80: 'F', 84: 'C', 88: 'D7', 94: 'G7',
        96: 'C', 104: 'C', 112: 'F', 116: 'C', 120: 'G7', 124: 'C'
    };

    // 2. 完整版《We Wish You a Merry Christmas》（副歌 + 主歌 + 尾聲副歌，含左手和弦對應）
    const WE_WISH_YOU_NOTES = [
        // 副歌 (0..49)
        'G4', '-', 'C5', '-', 'C5', 'D5', 'C5', 'B4', 'A4', '-', 'A4', '-', 'A4', '-',
        'D5', '-', 'D5', 'E5', 'D5', 'C5', 'B4', '-', 'G4', '-', 'G4', '-',
        'E5', '-', 'E5', 'F5', 'E5', 'D5', 'C5', '-', 'A4', '-', 'G4', 'G4',
        'A4', '-', 'D5', '-', 'B4', '-', 'C5', '-', '-', '-',
        // 主歌 Good tidings (48..95)
        'G4', '-', 'C5', '-', 'C5', '-', 'C5', '-', 'B4', '-', '-', '-',
        'B4', '-', 'C5', '-', 'B4', '-', 'A4', '-', 'G4', '-', '-', '-',
        'D5', '-', 'E5', '-', 'D5', '-', 'C5', '-', 'G5', '-', 'G4', 'G4',
        'A4', '-', 'D5', '-', 'B4', '-', 'C5', '-', '-', '-',
        // 尾聲副歌 (96..143)
        'G4', '-', 'C5', '-', 'C5', 'D5', 'C5', 'B4', 'A4', '-', 'A4', '-', 'A4', '-',
        'D5', '-', 'D5', 'E5', 'D5', 'C5', 'B4', '-', 'G4', '-', 'G4', '-',
        'E5', '-', 'E5', 'F5', 'E5', 'D5', 'C5', '-', 'A4', '-', 'G4', 'G4',
        'A4', '-', 'D5', '-', 'B4', '-', 'C5', '-', '-', '-'
    ];
    const WE_WISH_YOU_CHORDS = {
        2: 'C', 8: 'F', 14: 'D7', 20: 'G', 26: 'E7', 32: 'Am', 38: 'F', 42: 'G7', 44: 'C',
        50: 'C', 56: 'G', 62: 'Dm', 68: 'C', 72: 'G', 78: 'C', 84: 'F', 88: 'G7', 90: 'C',
        98: 'C', 104: 'F', 110: 'D7', 116: 'G', 122: 'E7', 128: 'Am', 134: 'F', 138: 'G7', 140: 'C'
    };

    const PLAYLIST = [
        { name: 'Jingle Bells', stepMs: 255, notes: JINGLE_BELLS_NOTES, chords: JINGLE_BELLS_CHORDS },
        { name: 'We Wish You a Merry Christmas', stepMs: 245, notes: WE_WISH_YOU_NOTES, chords: WE_WISH_YOU_CHORDS }
    ];
    const INTER_SONG_GAP_MS = 1000; // 曲間留白約 1 秒

    let audioCtx = null;
    let masterGain = null;
    let vibBusGain = null;     // 共用鐵琴共鳴匯流排（經由 4.8Hz 微顫音 LFO 調變）
    let tremoloLfo = null;
    let tremoloDepth = null;
    let reverbNode = null;
    let reverbSendGain = null;

    let stepTimer = null;
    let gapTimer = null;
    let duckWatchTimer = null;
    let songIndex = 0;
    let stepIndex = 0;
    let isBgmEnabled = true; // 預設開啟（使用者手動關閉將記憶於 localStorage）
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

    // 產生輕量柔和空間殘響脈衝響應（約 1.05 秒自然指數衰減，零外部音檔）
    function createWarmReverbImpulse(ctx, durationSec = 1.05, decay = 2.6) {
        const rate = ctx.sampleRate;
        const length = Math.floor(rate * durationSec);
        const impulse = ctx.createBuffer(2, length, rate);
        for (let ch = 0; ch < 2; ch++) {
            const data = impulse.getChannelData(ch);
            let lp = 0;
            for (let i = 0; i < length; i++) {
                const env = Math.pow(1 - i / length, decay);
                const white = (Math.random() * 2 - 1);
                // 簡易低通濾波讓殘響更溫暖柔順不刺耳
                lp = lp * 0.72 + white * 0.28;
                data[i] = lp * env;
            }
        }
        return impulse;
    }

    function ensureAudioContext() {
        if (!audioCtx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return null;
            try {
                audioCtx = new Ctx();

                // 1. 總音量控制（支援 Audio Ducking）
                masterGain = audioCtx.createGain();
                masterGain.gain.setValueAtTime(
                    isVoiceDucking ? NORMAL_VOLUME * DUCK_RATIO : NORMAL_VOLUME,
                    audioCtx.currentTime
                );
                masterGain.connect(audioCtx.destination);

                // 2. 鐵琴共鳴管經典微顫音匯流排（4.8Hz 極輕微振幅調變，模擬共鳴管葉片旋轉）
                vibBusGain = audioCtx.createGain();
                vibBusGain.gain.setValueAtTime(0.92, audioCtx.currentTime);

                tremoloLfo = audioCtx.createOscillator();
                tremoloLfo.type = 'sine';
                tremoloLfo.frequency.setValueAtTime(4.8, audioCtx.currentTime);

                tremoloDepth = audioCtx.createGain();
                tremoloDepth.gain.setValueAtTime(0.08, audioCtx.currentTime); // 柔和微顫深度（0.84 ~ 1.00）

                tremoloLfo.connect(tremoloDepth);
                tremoloDepth.connect(vibBusGain.gain);
                tremoloLfo.start();

                // 乾聲直通主輸出
                vibBusGain.connect(masterGain);

                // 3. 輕量空間殘響（濕聲約 24%）
                try {
                    reverbNode = audioCtx.createConvolver();
                    reverbNode.buffer = createWarmReverbImpulse(audioCtx, 1.05, 2.6);
                    reverbSendGain = audioCtx.createGain();
                    reverbSendGain.gain.setValueAtTime(0.24, audioCtx.currentTime);
                    vibBusGain.connect(reverbSendGain);
                    reverbSendGain.connect(reverbNode);
                    reverbNode.connect(masterGain);
                } catch (revErr) {
                    reverbNode = null;
                }
            } catch (e) {
                audioCtx = null;
                masterGain = null;
                vibBusGain = null;
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

    // 擬真鐵琴（Vibraphone）單音合成：
    // - 主基頻：溫暖清亮 sine（attack ~10ms，中長自然衰減 release 1.05~1.25s）
    // - 4倍頻金屬共鳴泛音（~12%）：前 25ms 快速衰減後留極輕尾韻
    // - 10倍頻毛氈敲擊金屬瞬態（~3%）：25ms 內極快衰減，呈現清脆敲擊感
    function playVibraphoneTone(freq, startOffsetSec = 0, ampScale = 1.0, releaseSec = 1.15) {
        if (!audioCtx || !vibBusGain || !freq) return;
        const t0 = audioCtx.currentTime + Math.max(0, startOffsetSec);
        const attack = 0.010;

        // 1. 主基頻 sine（溫暖圓潤共鳴尾韻）
        const osc1 = audioCtx.createOscillator();
        const env1 = audioCtx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(freq, t0);

        env1.gain.setValueAtTime(0.0001, t0);
        env1.gain.linearRampToValueAtTime(0.84 * ampScale, t0 + attack);
        env1.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + releaseSec);

        osc1.connect(env1);
        env1.connect(vibBusGain);
        osc1.start(t0);
        osc1.stop(t0 + attack + releaseSec + 0.05);

        // 2. 4 倍頻金屬琴鍵泛音（約 12%，起音前 25ms 快速收斂並保留輕微共鳴）
        const osc4 = audioCtx.createOscillator();
        const env4 = audioCtx.createGain();
        osc4.type = 'sine';
        osc4.frequency.setValueAtTime(freq * 4, t0);

        env4.gain.setValueAtTime(0.0001, t0);
        env4.gain.linearRampToValueAtTime(0.12 * ampScale, t0 + 0.004);
        env4.gain.exponentialRampToValueAtTime(0.018 * ampScale, t0 + 0.029);
        env4.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);

        osc4.connect(env4);
        env4.connect(vibBusGain);
        osc4.start(t0);
        osc4.stop(t0 + 0.27);

        // 3. 10 倍頻毛氈琴槌敲擊瞬間泛音（約 3%，25ms 內極速衰減）
        const overtone10 = freq * 10;
        if (overtone10 < (audioCtx.sampleRate * 0.45)) {
            const osc10 = audioCtx.createOscillator();
            const env10 = audioCtx.createGain();
            osc10.type = 'sine';
            osc10.frequency.setValueAtTime(overtone10, t0);

            env10.gain.setValueAtTime(0.0001, t0);
            env10.gain.linearRampToValueAtTime(0.03 * ampScale, t0 + 0.002);
            env10.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.027);

            osc10.connect(env10);
            env10.connect(vibBusGain);
            osc10.start(t0);
            osc10.stop(t0 + 0.035);
        }
    }

    // 左手雙手琴槌交錯滾奏短琶音（和弦音間隔 30ms 依序敲擊，音量約為主旋律 42%）
    function playRolledChord(chordName) {
        const chordNotes = CHORDS[chordName];
        if (!Array.isArray(chordNotes) || chordNotes.length === 0) return;
        const perNoteAmp = CHORD_VOL_RATIO * 0.52; // 多音疊加後總和約為主旋律 42%
        chordNotes.forEach((noteName, idx) => {
            const freq = NOTE_FREQ[noteName];
            if (freq) {
                playVibraphoneTone(freq, idx * CHORD_ROLL_SEC, perNoteAmp, 1.25);
            }
        });
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
                // 本曲播畢：留白約 1 秒後自動切換下一首並無限循環
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

            const curStep = stepIndex;
            const noteName = song.notes[curStep];
            const chordName = song.chords && song.chords[curStep];
            stepIndex += 1;

            // 先觸發左手滾奏短琶音和弦托底
            if (chordName) {
                playRolledChord(chordName);
            }

            // 再敲擊右手鐵琴主旋律
            if (noteName && noteName !== '-') {
                const freq = NOTE_FREQ[noteName];
                if (freq) playVibraphoneTone(freq, 0, 1.0, 1.15);
            }
        };

        tick();
        stepTimer = setInterval(tick, song.stepMs);

        // 安全監看 speechSynthesis.speaking 狀態，確保任何語音播報必觸發 Audio Ducking
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
