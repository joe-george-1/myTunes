/**
 * player-renderer.js — Audio engine + transport controls.
 * This window owns the <audio> element and Web Audio API.
 * Sends state/viz data to other windows via IPC.
 */

const audio = document.getElementById('audio-element');
const btnPlay = document.getElementById('btn-play');
const btnStop = document.getElementById('btn-stop');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const btnShuffle = document.getElementById('btn-shuffle');
const btnRepeat = document.getElementById('btn-repeat');
const seekBar = document.getElementById('seek-bar');
const seekProgress = document.getElementById('seek-progress');
const volumeTrack = document.getElementById('volume-track');
const volumeFill = document.getElementById('volume-fill');
const trackTitle = document.getElementById('track-title');
const trackTime = document.getElementById('track-time');
const miniViz = document.getElementById('mini-viz');

// ── Web Audio API setup ─────────────────────────────────────
let audioCtx, analyser, source, freqData, waveData, gainNode;

function ensureAudioContext() {
    if (audioCtx) return;
    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    gainNode = audioCtx.createGain();
    gainNode.gain.value = audio.volume; // sync with initial HTML volume
    source = audioCtx.createMediaElementSource(audio);
    source.connect(gainNode);
    gainNode.connect(analyser);
    analyser.connect(audioCtx.destination);
    freqData = new Uint8Array(analyser.frequencyBinCount);
    waveData = new Uint8Array(analyser.fftSize);
}

// ── Current track URL ───────────────────────────────────────
let currentObjectUrl = null;

function loadTrack(track) {
    ensureAudioContext();

    // Clean up previous object URL
    if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
        currentObjectUrl = null;
    }

    // track.data can be:
    //   - an ArrayBuffer (Electron IPC)
    //   - a data URL string (Tauri: "data:audio/mpeg;base64,...")
    if (track.data) {
        if (typeof track.data === 'string' && track.data.startsWith('data:')) {
            // Data URL from Tauri — use directly
            audio.src = track.data;
        } else {
            // ArrayBuffer from Electron — create blob
            const blob = new Blob([track.data], { type: track.type || 'audio/mpeg' });
            currentObjectUrl = URL.createObjectURL(blob);
            audio.src = currentObjectUrl;
        }
    } else if (track.path) {
        audio.src = 'file://' + track.path;
    }

    const name = cleanName(track.name || 'Unknown');
    const titleSpan = trackTitle.querySelector('span');
    titleSpan.textContent = name;

    // Check if marquee needed
    trackTitle.classList.remove('scrolling');
    requestAnimationFrame(() => {
        if (titleSpan.scrollWidth > trackTitle.clientWidth) {
            trackTitle.classList.add('scrolling');
        }
    });

    audio.play().catch(() => { });
    btnPlay.classList.add('playing');
    window.gel.nuclearFlush(); // Heavy reset for Linux skins
    broadcastState('playing');
}

// ── Transport ───────────────────────────────────────────────
btnPlay.addEventListener('click', () => {
    ensureAudioContext();
    if (audio.paused) {
        audio.play().catch(() => { });
        btnPlay.classList.add('playing');
        window.gel.nuclearFlush(); // Heavy reset for Linux skins
        broadcastState('playing');
    } else {
        audio.pause();
        btnPlay.classList.remove('playing');
        window.gel.nuclearFlush(); // Heavy reset for Linux skins
        broadcastState('paused');
    }
});

btnStop.addEventListener('click', () => {
    audio.pause();
    audio.currentTime = 0;
    btnPlay.classList.remove('playing');
    seekProgress.style.width = '0%';
    trackTime.textContent = '—:—';
    window.gel.nuclearFlush(); // Heavy reset for Linux skins
    broadcastState('stopped');
});

btnPrev.addEventListener('click', () => window.gel.prev());
btnNext.addEventListener('click', () => window.gel.next());
btnShuffle.addEventListener('click', () => {
    btnShuffle.classList.toggle('active');
    window.gel.forceClearWindow(); // Fix additive ghosting
    window.gel.playerState({ action: 'toggleShuffle' });
});
btnRepeat.addEventListener('click', () => {
    btnRepeat.classList.toggle('active');
    window.gel.forceClearWindow(); // Fix additive ghosting
    window.gel.playerState({ action: 'toggleRepeat' });
});

// ── Seek ───────────────────────────────────────────────────
let isSeeking = false;
seekBar.addEventListener('pointerdown', (e) => {
    isSeeking = true;
    seekBar.classList.add('seeking');
    seekBar.setPointerCapture(e.pointerId);
    doSeek(e);
});
seekBar.addEventListener('pointermove', (e) => { if (isSeeking) doSeek(e); });
seekBar.addEventListener('pointerup', () => {
    isSeeking = false;
    seekBar.classList.remove('seeking');
});

function doSeek(e) {
    const rect = seekBar.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (!isNaN(audio.duration)) {
        audio.currentTime = frac * audio.duration;
        seekProgress.style.width = (frac * 100) + '%';
    }
}

// ── Volume ──────────────────────────────────────────────────
let isVolumeAdj = false;
volumeTrack.addEventListener('pointerdown', (e) => {
    isVolumeAdj = true;
    volumeTrack.setPointerCapture(e.pointerId);
    doVolume(e);
    e.stopPropagation();
});
volumeTrack.addEventListener('pointermove', (e) => { if (isVolumeAdj) doVolume(e); });
volumeTrack.addEventListener('pointerup', () => { isVolumeAdj = false; });

function doVolume(e) {
    const rect = volumeTrack.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (gainNode) {
        gainNode.gain.value = frac;
    } else {
        audio.volume = frac;
    }
    volumeFill.style.width = (frac * 100) + '%';
}

// ── Time updates → UI + broadcast ───────────────────────────
audio.addEventListener('timeupdate', () => {
    if (!isNaN(audio.duration) && audio.duration > 0) {
        const pct = (audio.currentTime / audio.duration) * 100;
        seekProgress.style.width = pct + '%';
        trackTime.textContent = `${fmt(audio.currentTime)} / ${fmt(audio.duration)}`;
    }
});

audio.addEventListener('ended', () => {
    btnPlay.classList.remove('playing');
    window.gel.forceClearWindow(); // Fix additive ghosting
    window.gel.trackEnded();
});

// ── Visualizer data loop ────────────────────────────────────
const vizCtx = miniViz.getContext('2d');
let vizRaf;

function vizLoop() {
    vizRaf = requestAnimationFrame(vizLoop);
    if (!analyser) return;

    analyser.getByteFrequencyData(freqData);
    analyser.getByteTimeDomainData(waveData);

    // Send to visualizer window (~30fps throttle)
    if (Math.random() < 0.5) {
        window.gel.vizData({
            freq: Array.from(freqData),
            wave: Array.from(waveData)
        });
    }

    // Mini viz in this window
    drawMiniViz();
}
vizLoop();

function drawMiniViz() {
    const w = miniViz.width = miniViz.offsetWidth * devicePixelRatio;
    const h = miniViz.height = miniViz.offsetHeight * devicePixelRatio;
    vizCtx.clearRect(0, 0, w, h);

    if (!freqData) return;

    const bars = 32;
    const barW = w / bars;
    for (let i = 0; i < bars; i++) {
        const val = freqData[i] / 255;
        const barH = val * h * 0.85;
        vizCtx.fillStyle = `hsla(210, 5%, ${60 + val * 30}%, ${0.4 + val * 0.4})`;
        vizCtx.fillRect(i * barW + 1, h - barH, barW - 2, barH);
    }
}

// ── IPC listeners ───────────────────────────────────────────
window.gel.onPlayTrack((track) => loadTrack(track));
window.gel.onStop(() => {
    audio.pause();
    audio.currentTime = 0;
    btnPlay.textContent = '▶';
    btnPlay.classList.remove('playing');
    seekProgress.style.width = '0%';
    trackTime.textContent = '—:—';
});

// ── Window dragging ─────────────────────────────────────────
initWindowDrag();

// ── Helpers ─────────────────────────────────────────────────
function fmt(sec) {
    if (isNaN(sec)) return '—:—';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function cleanName(name) {
    return name.replace(/\.(mp3|wav|ogg|flac|aac|m4a|wma|opus|webm)$/i, '');
}

function broadcastState(state) {
    window.gel.playerState({ state, time: audio.currentTime, duration: audio.duration });
}

function initWindowDrag() {
    const body = document.querySelector('.blob-body');

    body.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; // Left click only
        // Don't drag from interactive elements
        if (e.target.closest('button, input, .seek-bar, .seek-wrapper, .volume-pill, .volume-track, .controls-row, .playlist-scroll, .file-list-scroll, .settings-scroll')) return;

        // Native Tauri drag — smooth, prevents Linux WebKit hover bugs, no IPC lag
        if (window.gel._startNativeDrag) {
            window.gel._startNativeDrag();
            return;
        }

        // IPC-based drag (fallback)
        let dragging = true;
        let startX = e.screenX;
        let startY = e.screenY;
        body.classList.add('dragging');

        const onMove = (e2) => {
            if (!dragging) return;
            const dx = e2.screenX - startX;
            const dy = e2.screenY - startY;
            startX = e2.screenX;
            startY = e2.screenY;
            window.gel.windowDrag(dx, dy);
        };
        const onUp = () => {
            dragging = false;
            body.classList.remove('dragging');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

// ── Window toggle buttons ───────────────────────────────────
const btnToggleBrowser = document.getElementById('btn-toggle-browser');
const btnTogglePlaylist = document.getElementById('btn-toggle-playlist');
const btnToggleViz = document.getElementById('btn-toggle-viz');

btnToggleBrowser.addEventListener('click', () => window.gel.toggleWindow('browser'));
btnTogglePlaylist.addEventListener('click', () => window.gel.toggleWindow('playlist'));
btnToggleViz.addEventListener('click', () => window.gel.toggleWindow('visualizer'));

window.gel.onWindowVisibility((state) => {
    if ('browser' in state) btnToggleBrowser.classList.toggle('active', state.browser);
    if ('playlist' in state) btnTogglePlaylist.classList.toggle('active', state.playlist);
    if ('visualizer' in state) btnToggleViz.classList.toggle('active', state.visualizer);
});

// ── Close (quit app) ────────────────────────────────────────
document.getElementById('btn-close').addEventListener('click', () => {
    window.gel.closeWindow();
});

// ── Settings window toggle ──────────────────────────────────
document.getElementById('btn-settings').addEventListener('click', () => {
    window.gel.toggleWindow('settings');
});

// ── Skin: load saved skin on startup ────────────────────────
(async () => {
    try {
        const savedSkin = localStorage.getItem('gel:skin') || 'default';
        if (savedSkin !== 'default') {
            window.gel.applySkin(savedSkin);
        }
    } catch (e) {
        console.warn('[player] Failed to apply saved skin:', e);
    }
})();

// ── 5-band EQ (filter chain lives here, player owns audio) ──
const EQ_BAND_DEFS = [
    { id: 'eq-bass',     freq: 60,    type: 'lowshelf' },
    { id: 'eq-low-mid',  freq: 250,   type: 'peaking' },
    { id: 'eq-mid',      freq: 1000,  type: 'peaking' },
    { id: 'eq-high-mid', freq: 4000,  type: 'peaking' },
    { id: 'eq-treble',   freq: 12000, type: 'highshelf' },
];

let eqFilters = [];
let eqInitialized = false;

function initEQ() {
    if (eqInitialized || !audioCtx) return;
    eqInitialized = true;

    // Disconnect gainNode → analyser (keep source → gainNode intact)
    gainNode.disconnect();

    // Build chain: gainNode → [eq filters] → analyser → destination
    eqFilters = EQ_BAND_DEFS.map(band => {
        const filter = audioCtx.createBiquadFilter();
        filter.type = band.type;
        filter.frequency.value = band.freq;
        filter.gain.value = 0;
        if (band.type === 'peaking') filter.Q.value = 1.4;
        return filter;
    });

    gainNode.connect(eqFilters[0]);
    for (let i = 0; i < eqFilters.length - 1; i++) {
        eqFilters[i].connect(eqFilters[i + 1]);
    }
    eqFilters[eqFilters.length - 1].connect(analyser);
    // analyser → destination is already connected from ensureAudioContext

    // Load saved EQ values
    EQ_BAND_DEFS.forEach((band, i) => {
        const saved = localStorage.getItem('gel:' + band.id);
        if (saved !== null) {
            eqFilters[i].gain.value = parseFloat(saved);
        }
    });
}

// Initialize EQ when audio context is first created
const origEnsure = ensureAudioContext;
ensureAudioContext = function () {
    origEnsure();
    initEQ();
};

// Listen for EQ changes from settings window
window.gel.onEqChange((data) => {
    ensureAudioContext();
    initEQ();
    if (eqFilters[data.band] != null) {
        eqFilters[data.band].gain.value = data.gain;
    }
});
