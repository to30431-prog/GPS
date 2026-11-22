// ==========================================
// [Module 11] src/bgm-player.js
// 耶誕節主題專屬「明亮金屬鍵鐵琴（Glockenspiel）＋ 豐富低音和弦伴奏」合成器（純 Web Audio API，0 外部音檔）
// - 乾淨透亮金屬鍵鐵琴音色：清晰敲擊瞬態、自然短中延音（0.48s~0.62s）、無重度馬達顫音
// - 豐富和弦進行（C / Em / Am / F / Dm / Dm7 / G / G7 / D7 / E7），低音域輕柔托底（約為主旋律 38%）不搶高音
// - 兩首完整版聖誕曲目無限循環：《Jingle Bells》→ 留白 1 秒 →《We Wish You a Merry Christmas》
// - 常態音量輕柔（0.05），語音播報自動平滑壓低至 15%（Audio Ducking），省電／背景自動暫停
// ==========================================

(function initChristmasGlockenspielBgmPlayer() {
    const STORAGE_KEY = 'yingge_bgm_enabled_v1';
    const NORMAL_VOLUME = 0.05;  // 輕柔背景陪襯音量（0.04~0.06）
    const DUCK_RATIO = 0.15;     // 語音播報時平滑壓低至原音量 15%
    const CHORD_VOL_RATIO = 0.38; // 低音和弦伴奏為主旋律音量的 38%（35%~45%，不搶高音）
    const CHORD_ROLL_SEC = 0.026; // 輕柔短琶音交錯間隔 26ms

    // 完整音名頻率表（Hz）
    const NOTE_FREQ = {
        E2: 82.41, F2: 87.31, G2: 98.00, A2: 110.00, B2: 123.47,
        C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, Fs3: 185.00, G3: 196.00, Gs3: 207.65, A3: 220.00, B3: 246.94,
        C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, Fs4: 369.99, G4: 392.00, A4: 440.00, B4: 493.88,
        C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00, B5: 987.77,
        C6: 1046.50
    };

    // 低中音域乾淨和弦排列（嚴格置於 C3~E4，與 G4~C6 主旋律清楚分層不混濁）
    const CHORDS = {
        C:   ['C3', 'G3', 'C4', 'E4'],
        Em:  ['E3', 'B3', 'E4'],
        Am:  ['A2', 'E3', 'A3', 'C4'],
        F:   ['F2', 'C3', 'F3', 'A3'],
        Dm:  ['D3', 'A3', 'D4'],
        Dm7: ['D3', 'A3', 'C4', 'F4'],
        G:   ['G2', 'D3', 'G3', 'B3'],
        G7:  ['G2', 'D3', 'F3', 'B3'],
        D7:  ['D3', 'Fs3', 'A3', 'C4'],
        E7:  ['E2', 'B2', 'D3', 'Gs3']
    };

    // 1. 完整版《Jingle Bells》（主歌 + 副歌 1 & 2，搭配豐富和弦色彩進行）
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
        // 主歌 A：C -> Em -> C -> F -> Dm -> G7 -> G7 -> C
        0: 'C', 4: 'Em', 8: 'C', 12: 'F', 16: 'Dm', 20: 'G7', 24: 'G7', 28: 'C',
        // 主歌 B：C -> Am -> C -> F -> Dm7 -> G -> G7 -> C -> G7
        32: 'C', 36: 'Am', 40: 'C', 44: 'F', 48: 'Dm7', 52: 'G', 56: 'G7', 60: 'C', 62: 'G7',
        // 副歌 1：C -> Em -> C -> Am -> F -> C -> Dm -> D7 -> G -> G7
        64: 'C', 68: 'Em', 72: 'C', 76: 'Am', 80: 'F', 84: 'C', 88: 'Dm', 90: 'D7', 92: 'G', 94: 'G7',
        // 副歌 2：C -> Em -> C -> Am -> F -> C -> Dm -> G7 -> C
        96: 'C', 100: 'Em', 104: 'C', 108: 'Am', 112: 'F', 116: 'C', 120: 'Dm', 122: 'G7', 124: 'C'
    };

    // 2. 完整版《We Wish You a Merry Christmas》（副歌 + 主歌 + 尾聲副歌，搭配完整和弦色彩）
    const WE_WISH_YOU_NOTES = [
        // 副歌 (0..47)
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
        // 副歌：C -> F -> Dm -> D7 -> G -> E7 -> Am -> F -> Dm -> G7 -> C
        2: 'C', 8: 'F', 12: 'Dm', 14: 'D7', 20: 'G', 26: 'E7', 32: 'Am', 38: 'F', 40: 'Dm', 42: 'G7', 44: 'C',
        // 主歌：C -> Em -> G -> Am -> Dm -> C -> G -> Em -> Am -> F -> G7 -> C
        50: 'C', 54: 'Em', 56: 'G', 60: 'Am', 64: 'Dm', 68: 'C', 72: 'G', 76: 'Em', 80: 'Am', 84: 'F', 88: 'G7', 90: 'C',
        // 尾聲副歌：C -> F -> Dm -> D7 -> G -> E7 -> Am -> F -> G7 -> C
        98: 'C', 104: 'F', 108: 'Dm', 110: 'D7', 116: 'G', 122: 'E7', 128: 'Am', 134: 'F', 138: 'G7', 140: 'C'
    };

    const PLAYLIST = [
        { name: 'Jingle Bells', stepMs: 248, notes: JINGLE_BELLS_NOTES, chords: JINGLE_BELLS_CHORDS },
        { name: 'We Wish You a Merry Christmas', stepMs: 240, notes: WE_WISH_YOU_NOTES, chords: WE_WISH_YOU_CHORDS }
    ];
    const INTER_SONG_GAP_MS = 1000; // 曲間留白約 1 秒

    let audioCtx = null;
    let masterGain = null;
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

    // 輕量乾淨空間殘響（約 0.65 秒短自然尾韻，不拖泥帶水）
    function createCleanRoomImpulse(ctx, durationSec = 0.65, decay = 3.2) {
        const rate = ctx.sampleRate;
        const length = Math.floor(rate * durationSec);
        const impulse = ctx.createBuffer(2, length, rate);
        for (let ch = 0; ch < 2; ch++) {
            const data = impulse.getChannelData(ch);
            let lp = 0;
            for (let i = 0; i < length; i++) {
                const env = Math.pow(1 - i / length, decay);
                const white = (Math.random() * 2 - 1);
                lp = lp * 0.65 + white * 0.35;
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

                masterGain = audioCtx.createGain();
                masterGain.gain.setValueAtTime(
                    isVoiceDucking ? NORMAL_VOLUME * DUCK_RATIO : NORMAL_VOLUME,
                    audioCtx.currentTime
                );
                masterGain.connect(audioCtx.destination);

                // 輕量空間殘響（濕聲約 16%，讓金屬鍵音色更清透立體）
                try {
                    reverbNode = audioCtx.createConvolver();
                    reverbNode.buffer = createCleanRoomImpulse(audioCtx, 0.65, 3.2);
                    reverbSendGain = audioCtx.createGain();
                    reverbSendGain.gain.setValueAtTime(0.16, audioCtx.currentTime);
                    reverbSendGain.connect(reverbNode);
                    reverbNode.connect(masterGain);
                } catch (revErr) {
                    reverbNode = null;
                    reverbSendGain = null;
                }
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

    function routeToOutput(node) {
        node.connect(masterGain);
        if (reverbSendGain) {
            node.connect(reverbSendGain);
        }
    }

    // 明亮清脆「金屬鍵鐵琴（Glockenspiel）」主旋律單音：
    // - 乾淨透亮、敲擊點清楚（attack 4ms）、自然短中延音（0.52s~0.60s）、無重度馬達顫音
    function playGlockenspielMelody(freq, releaseSec = 0.56) {
        if (!audioCtx || !masterGain || !freq) return;
        const t0 = audioCtx.currentTime;
        const attack = 0.004;

        // 1. 清亮主基頻 sine
        const osc1 = audioCtx.createOscillator();
        const env1 = audioCtx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(freq, t0);

        env1.gain.setValueAtTime(0.0001, t0);
        env1.gain.linearRampToValueAtTime(0.88, t0 + attack);
        env1.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + releaseSec);

        osc1.connect(env1);
        routeToOutput(env1);
        osc1.start(t0);
        osc1.stop(t0 + attack + releaseSec + 0.04);

        // 2. 金屬鍵鐵琴特有的清脆高頻敲擊泛音（2.76 倍頻，模擬鐘琴金屬條第二振動模態）
        const overtoneBar = freq * 2.76;
        if (overtoneBar < audioCtx.sampleRate * 0.45) {
            const oscBar = audioCtx.createOscillator();
            const envBar = audioCtx.createGain();
            oscBar.type = 'sine';
            oscBar.frequency.setValueAtTime(overtoneBar, t0);

            envBar.gain.setValueAtTime(0.0001, t0);
            envBar.gain.linearRampToValueAtTime(0.15, t0 + 0.002);
            envBar.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);

            oscBar.connect(envBar);
            routeToOutput(envBar);
            oscBar.start(t0);
            oscBar.stop(t0 + 0.17);
        }

        // 3. 極微亮點瞬態（4 倍頻，25ms 快速消散，讓每個音符敲擊顆粒分明）
        const overtone4 = freq * 4;
        if (overtone4 < audioCtx.sampleRate * 0.45) {
            const osc4 = audioCtx.createOscillator();
            const env4 = audioCtx.createGain();
            osc4.type = 'sine';
            osc4.frequency.setValueAtTime(overtone4, t0);

            env4.gain.setValueAtTime(0.0001, t0);
            env4.gain.linearRampToValueAtTime(0.06, t0 + 0.002);
            env4.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.032);

            osc4.connect(env4);
            env4.connect(masterGain);
            osc4.start(t0);
            osc4.stop(t0 + 0.045);
        }
    }

    // 輕柔低音域和弦伴奏單音（乾淨柔和 sine，極少高頻泛音，絕不搶高音或混濁）
    function playSoftChordTone(freq, startOffsetSec = 0, ampScale = 0.2, releaseSec = 0.64) {
        if (!audioCtx || !masterGain || !freq) return;
        const t0 = audioCtx.currentTime + Math.max(0, startOffsetSec);
        const attack = 0.012;

        const osc = audioCtx.createOscillator();
        const env = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t0);

        env.gain.setValueAtTime(0.0001, t0);
        env.gain.linearRampToValueAtTime(ampScale, t0 + attack);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + releaseSec);

        osc.connect(env);
        routeToOutput(env);
        osc.start(t0);
        osc.stop(t0 + attack + releaseSec + 0.04);
    }

    // 輕柔低音和弦短琶音（音量約為主旋律 38%，低音域托底不搶高音）
    function playAccompanimentChord(chordName) {
        const chordNotes = CHORDS[chordName];
        if (!Array.isArray(chordNotes) || chordNotes.length === 0) return;
        const perNoteAmp = (CHORD_VOL_RATIO / Math.sqrt(chordNotes.length)) * 0.85;
        chordNotes.forEach((noteName, idx) => {
            const freq = NOTE_FREQ[noteName];
            if (freq) {
                playSoftChordTone(freq, idx * CHORD_ROLL_SEC, perNoteAmp, 0.64);
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
                // 本曲播畢：留白約 1 秒後自動接續下一首並無限循環
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

            if (chordName) {
                playAccompanimentChord(chordName);
            }

            if (noteName && noteName !== '-') {
                const freq = NOTE_FREQ[noteName];
                if (freq) playGlockenspielMelody(freq, 0.56);
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
