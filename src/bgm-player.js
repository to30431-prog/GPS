// ==========================================
// [Module 11] src/bgm-player.js
// 耶誕節主題專屬「高音亮晶晶鐵琴（Glockenspiel）＋ 中音域聽得見的和弦」合成器（純 Web Audio API，0 外部音檔）
// 針對手機外放小喇叭調校（小喇叭約 300Hz 以下幾乎發不出聲，原本 E2~E4 的低音和弦會被吃掉）：
// - 主旋律：整首移調上移完全四度（C 大調 → F 大調），落在清脆明亮的 C5～D6 高音域
// - 和弦伴奏：以 C4～G4 為核心的中音域（少數和弦音延伸至 A3/B♭3 以保留完整三和弦色彩），
//   使用帶奇次泛音的 triangle 清透短促分解和弦，音量約為主旋律 50%，手機外放也聽得見又不搶高音
// - 金屬鍵敲擊感：起音前 12ms 疊加高八度（2x）與十二度（3x）泛音快速衰減，主音清亮 sine，延音 0.45s~0.65s
// - 兩首完整版聖誕曲目無限循環：《Jingle Bells》→ 留白 1 秒 →《We Wish You a Merry Christmas》
// - 常態音量輕柔（0.06），語音播報自動平滑壓低至 15%（Audio Ducking），省電／背景自動暫停
// ==========================================

(function initChristmasGlockenspielBgmPlayer() {
    const STORAGE_KEY = 'yingge_bgm_enabled_v1';
    const NORMAL_VOLUME = 0.06;   // 輕柔背景陪襯音量（0.05~0.07）
    const DUCK_RATIO = 0.15;      // 語音播報時平滑壓低至原音量 15%
    const CHORD_VOL_RATIO = 0.50; // 中音域分解和弦約為主旋律音量 50%
    const CHORD_ROLL_SEC = 0.022; // 清透短促分解和弦交錯間隔 22ms
    const MELODY_TRANSPOSE = 5;   // 主旋律上移完全四度（+5 半音）：G4~A5 → C5~D6

    // 以 MIDI 公式計算音名頻率（支援 Cs4 / Bb3 這類升降記號），避免手打頻率表出錯
    const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    function noteToFreq(name, transpose = 0) {
        const m = /^([A-G])(s|b)?(\d)$/.exec(name);
        if (!m) return 0;
        let semi = NOTE_INDEX[m[1]];
        if (m[2] === 's') semi += 1;
        if (m[2] === 'b') semi -= 1;
        const midi = (Number(m[3]) + 1) * 12 + semi + transpose;
        return 440 * Math.pow(2, (midi - 69) / 12);
    }

    // 中音域分解和弦配置（以譜面原 C 大調和弦功能標記，實際發聲為移調後 F 大調和弦）
    // 標記 → 實際和弦：C→F、Em→Am、Am→Dm、F→B♭、Dm→Gm、Dm7→Gm7、G→C、G7→C7、D7→G7、E7→A7
    const CHORD_VOICINGS = {
        C:   ['A3', 'C4', 'F4'],   // F
        Em:  ['A3', 'C4', 'E4'],   // Am
        Am:  ['A3', 'D4', 'F4'],   // Dm
        F:   ['Bb3', 'D4', 'F4'],  // B♭
        Dm:  ['Bb3', 'D4', 'G4'],  // Gm
        Dm7: ['Bb3', 'F4', 'G4'],  // Gm7
        G:   ['C4', 'E4', 'G4'],   // C
        G7:  ['Bb3', 'C4', 'E4'],  // C7（E–B♭ 三全音保留屬七張力）
        D7:  ['B3', 'D4', 'F4'],   // G7
        E7:  ['Cs4', 'E4', 'G4']   // A7
    };

    // 1. 完整版《Jingle Bells》（主歌 + 副歌 1 & 2；譜面以 C 大調記譜，播放時移調 +5）
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
        0: 'C', 4: 'Em', 8: 'C', 12: 'F', 16: 'Dm', 20: 'G7', 24: 'G7', 28: 'C',
        32: 'C', 36: 'Am', 40: 'C', 44: 'F', 48: 'Dm7', 52: 'G', 56: 'G7', 60: 'C', 62: 'G7',
        64: 'C', 68: 'Em', 72: 'C', 76: 'Am', 80: 'F', 84: 'C', 88: 'Dm', 90: 'D7', 92: 'G', 94: 'G7',
        96: 'C', 100: 'Em', 104: 'C', 108: 'Am', 112: 'F', 116: 'C', 120: 'Dm', 122: 'G7', 124: 'C'
    };

    // 2. 完整版《We Wish You a Merry Christmas》（副歌 + 主歌 + 尾聲副歌；C 大調記譜，播放時移調 +5）
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
        2: 'C', 8: 'F', 12: 'Dm', 14: 'D7', 20: 'G', 26: 'E7', 32: 'Am', 38: 'F', 40: 'Dm', 42: 'G7', 44: 'C',
        50: 'C', 54: 'Em', 56: 'G', 60: 'Am', 64: 'Dm', 68: 'C', 72: 'G', 76: 'Em', 80: 'Am', 84: 'F', 88: 'G7', 90: 'C',
        98: 'C', 104: 'F', 108: 'Dm', 110: 'D7', 116: 'G', 122: 'E7', 128: 'Am', 134: 'F', 138: 'G7', 140: 'C'
    };

    const PLAYLIST = [
        { name: 'Jingle Bells', stepMs: 248, notes: JINGLE_BELLS_NOTES, chords: JINGLE_BELLS_CHORDS },
        { name: 'We Wish You a Merry Christmas', stepMs: 240, notes: WE_WISH_YOU_NOTES, chords: WE_WISH_YOU_CHORDS }
    ];
    const INTER_SONG_GAP_MS = 1000; // 曲間留白約 1 秒

    let audioCtx = null;
    let masterGain = null;
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

    // 輕量乾淨空間殘響（約 0.55 秒短尾韻，維持顆粒分明）
    function createCleanRoomImpulse(ctx, durationSec = 0.55, decay = 3.4) {
        const rate = ctx.sampleRate;
        const length = Math.floor(rate * durationSec);
        const impulse = ctx.createBuffer(2, length, rate);
        for (let ch = 0; ch < 2; ch++) {
            const data = impulse.getChannelData(ch);
            let lp = 0;
            for (let i = 0; i < length; i++) {
                const env = Math.pow(1 - i / length, decay);
                lp = lp * 0.6 + (Math.random() * 2 - 1) * 0.4;
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

                try {
                    const reverbNode = audioCtx.createConvolver();
                    reverbNode.buffer = createCleanRoomImpulse(audioCtx);
                    reverbSendGain = audioCtx.createGain();
                    reverbSendGain.gain.setValueAtTime(0.14, audioCtx.currentTime);
                    reverbSendGain.connect(reverbNode);
                    reverbNode.connect(masterGain);
                } catch (revErr) {
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
                masterGain.gain.setTargetAtTime(target, now, isVoiceDucking ? 0.06 : 0.16);
            }
        } catch (e) {}
    }

    function routeToOutput(node, withReverb = true) {
        node.connect(masterGain);
        if (withReverb && reverbSendGain) node.connect(reverbSendGain);
    }

    // 建立單一振盪器 + 包絡（共用工具）
    function scheduleOsc(type, freq, t0, peak, attack, decayEnd, withReverb = true) {
        if (!freq || freq >= audioCtx.sampleRate * 0.45) return;
        const osc = audioCtx.createOscillator();
        const env = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        env.gain.setValueAtTime(0.0001, t0);
        env.gain.linearRampToValueAtTime(peak, t0 + attack);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + decayEnd);
        osc.connect(env);
        routeToOutput(env, withReverb);
        osc.start(t0);
        osc.stop(t0 + decayEnd + 0.03);
    }

    // 高音亮晶晶金屬鍵鐵琴（Glockenspiel）主旋律單音：
    // - 主音：清亮 sine，起音 3ms，自然延音約 0.55s
    // - 起音前 12ms：高八度（2x）＋ 十二度（3x）金屬敲擊泛音快速衰減 → 「叮」的亮點
    // - 鐘琴金屬條特有 2.76x 非諧波泛音短暫閃現，增添金屬質感
    function playGlockenspielMelody(freq, releaseSec = 0.55) {
        if (!audioCtx || !masterGain || !freq) return;
        const t0 = audioCtx.currentTime;
        scheduleOsc('sine', freq, t0, 0.80, 0.003, 0.003 + releaseSec);          // 主音
        scheduleOsc('sine', freq * 2, t0, 0.30, 0.0015, 0.012, false);            // 高八度敲擊（12ms 內消散）
        scheduleOsc('sine', freq * 3, t0, 0.16, 0.0015, 0.012, false);            // 十二度敲擊（12ms 內消散）
        scheduleOsc('sine', freq * 2.76, t0, 0.10, 0.002, 0.11);                  // 金屬條非諧波泛音
    }

    // 中音域清透短促和弦單音：triangle 帶奇次泛音（3x、5x），手機小喇叭也能發出聲音
    function playMidChordTone(freq, startOffsetSec, peak) {
        if (!audioCtx || !masterGain || !freq) return;
        const t0 = audioCtx.currentTime + Math.max(0, startOffsetSec);
        scheduleOsc('triangle', freq, t0, peak, 0.006, 0.40);
        scheduleOsc('sine', freq * 2, t0, peak * 0.22, 0.004, 0.14, false);       // 輕微高八度增加穿透力
    }

    // 清透短促分解和弦（2~3 音，約為主旋律 50% 音量）
    function playMidRangeChord(chordName) {
        const voicing = CHORD_VOICINGS[chordName];
        if (!Array.isArray(voicing) || voicing.length === 0) return;
        const perNotePeak = (0.80 * CHORD_VOL_RATIO) / Math.sqrt(voicing.length);
        voicing.forEach((noteName, idx) => {
            playMidChordTone(noteToFreq(noteName), idx * CHORD_ROLL_SEC, perNotePeak);
        });
    }

    function stopTimers() {
        if (stepTimer !== null) { clearInterval(stepTimer); stepTimer = null; }
        if (gapTimer !== null) { clearTimeout(gapTimer); gapTimer = null; }
        if (duckWatchTimer !== null) { clearInterval(duckWatchTimer); duckWatchTimer = null; }
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
                    if (isBgmEnabled && !isPausedBySystemState()) startCurrentSongLoop();
                }, INTER_SONG_GAP_MS);
                return;
            }

            const curStep = stepIndex;
            const noteName = song.notes[curStep];
            const chordName = song.chords && song.chords[curStep];
            stepIndex += 1;

            if (chordName) playMidRangeChord(chordName);

            if (noteName && noteName !== '-') {
                playGlockenspielMelody(noteToFreq(noteName, MELODY_TRANSPOSE), 0.55);
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
            if (speakingNow !== isVoiceDucking) setVoiceDucking(speakingNow);
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
        if (isBgmEnabled && !isPausedBySystemState()) unlockAndSync();
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
