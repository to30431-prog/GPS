// ==========================================
// [Module 11] src/bgm-player.js
// 主題連動簡易背景音樂播放器（純 Web Audio API 八音盒合成，0 外部音檔）
// - 常態背景音量輕柔（約 0.05），語音導航播報時自動平滑壓低至 15%（Audio Ducking）
// - 支援聖誕主題《Jingle Bells》、一般／日間輕快小節奏、夜間／暗色柔和低音和弦
// - 極致省電模式 (body.power-saving) 或切至背景 (document.hidden) 自動暫停，切回前景自動恢復
// ==========================================

(function initFestivalBgmPlayer() {
    const STORAGE_KEY = 'yingge_bgm_enabled_v1';
    const NORMAL_VOLUME = 0.05; // 輕柔常態背景音（0.04~0.06）
    const DUCK_RATIO = 0.15;    // 語音播報時壓低至原音量 15%

    // 音名對照頻率表（Hz）
    const NOTE_FREQ = {
        F2: 87.31, G2: 98.00, A2: 110.00, B2: 123.47,
        C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, B3: 246.94,
        C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
        C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00, B5: 987.77,
        C6: 1046.50
    };

    // 各主題對應旋律設定
    const THEME_MELODIES = {
        christmas: {
            stepMs: 245,
            wave: 'sine',
            harmonicWave: 'triangle',
            harmonicGain: 0.22,
            decaySec: 0.42,
            notes: [
                'E5', 'E5', 'E5', '-',
                'E5', 'E5', 'E5', '-',
                'E5', 'G5', 'C5', 'D5', 'E5', '-', '-', '-',
                'F5', 'F5', 'F5', 'F5',
                'F5', 'E5', 'E5', 'E5',
                'E5', 'D5', 'D5', 'E5', 'D5', '-', 'G5', '-'
            ]
        },
        default: {
            stepMs: 275,
            wave: 'sine',
            harmonicWave: 'triangle',
            harmonicGain: 0.16,
            decaySec: 0.36,
            notes: [
                'C5', 'E5', 'G5', '-',
                'A5', 'G5', 'E5', '-',
                'F5', 'A5', 'G5', 'E5',
                'D5', '-', 'G5', '-',
                'C5', 'E5', 'G5', 'C6',
                'A5', 'G5', 'E5', '-',
                'D5', 'F5', 'E5', 'D5',
                'C5', '-', '-', '-'
            ]
        },
        night: {
            stepMs: 720,
            wave: 'sine',
            harmonicWave: 'triangle',
            harmonicGain: 0.10,
            decaySec: 1.35,
            isChordMode: true,
            notes: [
                ['C3', 'G3', 'B3', 'E4'], '-',
                ['A2', 'E3', 'G3', 'C4'], '-',
                ['F2', 'C3', 'E3', 'A3'], '-',
                ['G2', 'D3', 'E3', 'B3'], '-'
            ]
        }
    };

    let audioCtx = null;
    let masterGain = null;
    let stepTimer = null;
    let duckWatchTimer = null;
    let stepIndex = 0;
    let currentThemeKey = 'default';
    let isBgmEnabled = false;
    let isVoiceDucking = false;

    try {
        isBgmEnabled = localStorage.getItem(STORAGE_KEY) === '1';
    } catch (e) {
        isBgmEnabled = false;
    }

    function detectActiveThemeKey() {
        const body = document.body;
        if (!body) return 'default';
        const attrTheme = (body.getAttribute('data-theme') || '').toLowerCase();
        if (attrTheme === 'christmas' || body.classList.contains('theme-christmas')) {
            return 'christmas';
        }
        if (attrTheme === 'night' || attrTheme === 'dark' || body.classList.contains('theme-night') || body.classList.contains('theme-dark')) {
            return 'night';
        }
        return 'default';
    }

    function isPausedBySystemState() {
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

    function playSingleTone(freq, melody, ampScale = 1) {
        if (!audioCtx || !masterGain || !freq) return;
        const now = audioCtx.currentTime;
        const decay = melody.decaySec || 0.4;

        // 主八音盒音色（sine）
        const osc1 = audioCtx.createOscillator();
        const env1 = audioCtx.createGain();
        osc1.type = melody.wave || 'sine';
        osc1.frequency.setValueAtTime(freq, now);

        env1.gain.setValueAtTime(0.0001, now);
        env1.gain.linearRampToValueAtTime(0.85 * ampScale, now + 0.014);
        env1.gain.exponentialRampToValueAtTime(0.0001, now + decay);

        osc1.connect(env1);
        env1.connect(masterGain);
        osc1.start(now);
        osc1.stop(now + decay + 0.04);

        // 輕微泛音增添八音盒清脆感（triangle）
        if (melody.harmonicGain > 0) {
            const osc2 = audioCtx.createOscillator();
            const env2 = audioCtx.createGain();
            osc2.type = melody.harmonicWave || 'triangle';
            osc2.frequency.setValueAtTime(melody.isChordMode ? freq : freq * 2, now);

            const hDecay = Math.min(decay * 0.72, 0.55);
            env2.gain.setValueAtTime(0.0001, now);
            env2.gain.linearRampToValueAtTime(melody.harmonicGain * ampScale, now + 0.012);
            env2.gain.exponentialRampToValueAtTime(0.0001, now + hDecay);

            osc2.connect(env2);
            env2.connect(masterGain);
            osc2.start(now);
            osc2.stop(now + hDecay + 0.04);
        }
    }

    function stopScheduler() {
        if (stepTimer !== null) {
            clearInterval(stepTimer);
            stepTimer = null;
        }
        if (duckWatchTimer !== null) {
            clearInterval(duckWatchTimer);
            duckWatchTimer = null;
        }
    }

    function startScheduler() {
        stopScheduler();
        if (!isBgmEnabled || isPausedBySystemState()) return;

        const ctx = ensureAudioContext();
        if (!ctx) return;

        currentThemeKey = detectActiveThemeKey();
        const melody = THEME_MELODIES[currentThemeKey] || THEME_MELODIES.default;
        applyGainTarget(false);

        const playStep = () => {
            if (!isBgmEnabled || isPausedBySystemState()) {
                stopScheduler();
                applyGainTarget(false);
                return;
            }
            if (!audioCtx || audioCtx.state !== 'running') return;

            const activeKey = detectActiveThemeKey();
            if (activeKey !== currentThemeKey) {
                currentThemeKey = activeKey;
                stepIndex = 0;
                startScheduler();
                return;
            }

            const curMelody = THEME_MELODIES[currentThemeKey] || THEME_MELODIES.default;
            const entry = curMelody.notes[stepIndex % curMelody.notes.length];
            stepIndex = (stepIndex + 1) % curMelody.notes.length;

            if (!entry || entry === '-') return;

            if (Array.isArray(entry)) {
                const perVoiceScale = 0.42;
                entry.forEach(noteName => {
                    const f = NOTE_FREQ[noteName];
                    if (f) playSingleTone(f, curMelody, perVoiceScale);
                });
            } else {
                const f = NOTE_FREQ[entry];
                if (f) playSingleTone(f, curMelody, 1);
            }
        };

        playStep();
        stepTimer = setInterval(playStep, melody.stepMs);

        // 安全監看 speechSynthesis.speaking 狀態，確保任何語音播報都會壓低 BGM
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

    function updateBgmToggleButtonUI() {
        const btn = document.getElementById('bgmToggleBtn');
        const icon = document.getElementById('bgmIcon');
        const label = document.getElementById('bgmLabel');
        if (!btn) return;

        if (isBgmEnabled) {
            btn.className = 'bg-pink-500 text-white w-11 h-11 rounded-2xl shadow-lg flex flex-col items-center justify-center active:scale-95 border border-pink-400';
            if (icon) icon.className = 'fa-solid fa-music text-base';
            if (label) label.textContent = '音樂開';
            btn.title = '背景音樂已開啟（點擊靜音）';
        } else {
            btn.className = 'bg-white text-gray-500 w-11 h-11 rounded-2xl shadow-lg flex flex-col items-center justify-center active:scale-95 border border-gray-200';
            if (icon) icon.className = 'fa-solid fa-music text-base opacity-50';
            if (label) label.textContent = '音樂關';
            btn.title = '背景音樂已靜音（點擊開啟）';
        }
    }

    function setEnabled(enabled) {
        isBgmEnabled = Boolean(enabled);
        try {
            localStorage.setItem(STORAGE_KEY, isBgmEnabled ? '1' : '0');
        } catch (e) {}

        updateBgmToggleButtonUI();

        if (isBgmEnabled) {
            ensureAudioContext();
            stepIndex = 0;
            startScheduler();
        } else {
            stopScheduler();
            applyGainTarget(false);
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
        const normalized = THEME_MELODIES[themeKey] ? themeKey : detectActiveThemeKey();
        if (normalized !== currentThemeKey) {
            currentThemeKey = normalized;
            stepIndex = 0;
            if (isBgmEnabled && !isPausedBySystemState()) {
                startScheduler();
            }
        } else {
            syncPlaybackState();
        }
    }

    function syncPlaybackState() {
        updateBgmToggleButtonUI();
        if (!isBgmEnabled || isPausedBySystemState()) {
            stopScheduler();
            applyGainTarget(false);
            return;
        }
        const ctx = ensureAudioContext();
        if (ctx && stepTimer === null) {
            startScheduler();
        } else {
            applyGainTarget(false);
        }
    }

    function unlockAndSync() {
        if (!isBgmEnabled) return;
        const ctx = ensureAudioContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') {
            ctx.resume().then(() => {
                if (isBgmEnabled && !isPausedBySystemState() && stepTimer === null) {
                    startScheduler();
                }
            }).catch(() => {});
        } else if (!isPausedBySystemState() && stepTimer === null) {
            startScheduler();
        }
    }

    // 綁定工具列背景音樂按鈕
    const bgmBtn = document.getElementById('bgmToggleBtn');
    if (bgmBtn) {
        bgmBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggle();
        });
    }

    // 行動裝置首次互動解鎖 AudioContext（若使用者先前已記憶開啟音樂）
    const onFirstUserGesture = () => {
        if (isBgmEnabled) {
            unlockAndSync();
        }
    };
    ['pointerdown', 'touchstart', 'click'].forEach(evt => {
        document.addEventListener(evt, onFirstUserGesture, { passive: true });
    });

    // 切至背景自動暫停、回前景自動恢復
    document.addEventListener('visibilitychange', () => {
        syncPlaybackState();
    });

    updateBgmToggleButtonUI();

    window.BgmPlayer = {
        toggle,
        setEnabled,
        isEnabled: () => isBgmEnabled,
        setTheme,
        setVoiceDucking,
        syncPlaybackState,
        unlockAndSync,
        updateUI: updateBgmToggleButtonUI
    };
})();
