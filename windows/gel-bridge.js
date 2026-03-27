/**
 * gel-bridge.js — Tauri v2 adapter
 * Wraps __TAURI__ API into the same window.gel shape the renderers expect.
 *
 * Debug: all errors logged to console. Open devtools (Ctrl+Shift+I) to see.
 */

(function () {
    'use strict';

    // ── Verify Tauri is available ────────────────────────────
    if (!window.__TAURI__) {
        console.error('[gel-bridge] window.__TAURI__ not found! withGlobalTauri must be true in tauri.conf.json');
        return;
    }

    const T = window.__TAURI__;

    // Resolve API namespaces — Tauri v2 structure
    const invoke = T.core?.invoke;
    const emit = T.event?.emit;
    const emitTo = T.event?.emitTo;
    const listen = T.event?.listen;
    const getCurrentWindow = T.window?.getCurrentWindow;

    if (!invoke) {
        console.error('[gel-bridge] __TAURI__.core.invoke not found!', Object.keys(T));
        return;
    }
    if (!emit) {
        console.error('[gel-bridge] __TAURI__.event.emit not found!', Object.keys(T));
        return;
    }
    if (!listen) {
        console.error('[gel-bridge] __TAURI__.event.listen not found!', Object.keys(T));
        return;
    }

    console.log('[gel-bridge] Tauri API found. Available namespaces:', Object.keys(T));

    // ── Window label (resolved async, cached) ────────────────
    let _label = null;
    invoke('get_window_label')
        .then(l => {
            _label = l;
            console.log('[gel-bridge] Window label:', l);
        })
        .catch(err => console.error('[gel-bridge] Failed to get window label:', err));

    // ── Platform Detection & CSS Classes ─────────────────────
    const isLinux = /linux/i.test(navigator.userAgent);
    if (isLinux) {
        document.documentElement.classList.add('is-linux');
        document.addEventListener('DOMContentLoaded', () => {
            document.body.classList.add('is-linux');
        });
        // Immediate check if body exists
        if (document.body) document.body.classList.add('is-linux');
    }

    // ── Native window drag ───────────────────────────────────
    // Exposed for mousedown, which avoids WebKitGTK click-swallow bugs on Linux
    let nativeDrag = null;
    if (getCurrentWindow) {
        try {
            const win = getCurrentWindow();
            if (win && win.startDragging) {
                nativeDrag = () => win.startDragging();
                console.log('[gel-bridge] Native drag available');
            }
        } catch (e) {
            console.warn('[gel-bridge] Native drag setup failed:', e);
        }
    }

    // ── Audio file URL helper ────────────────────────────────
    // Converts a filesystem path to a URL served by the custom audiofile:// protocol.
    // This avoids base64-encoding entire audio files and sending them over IPC.
    function audioFileUrl(filePath) {
        return 'audiofile://localhost/' + encodeURIComponent(filePath);
    }

    // ── Build the gel API ────────────────────────────────────
    window.gel = {
        // ── Window drag APIs ─────────────────────────────────
        _startNativeDrag: nativeDrag,
        windowDrag: (dx, dy) => invoke('window_drag', { label: _label, dx, dy }),

        // nuclearFlush / forceClearWindow removed — they caused ghosting.
        // Kept as no-ops so callers don't need to check before calling.
        nuclearFlush: async () => {},
        forceClearWindow: () => {},

        isLinux: isLinux,

        // Audio file URL
        audioFileUrl: audioFileUrl,

        // Theme
        emitThemeColor: (payload) => emit('gel:themeColorChange', payload),
        onThemeColorChange: (callback) => {
            const unlisten = listen('gel:themeColorChange', (event) => {
                callback(event.payload);
            });
            return unlisten;
        },

        // ── Filesystem (Rust commands) ───────────────────────
        readDir: (dirPath) => invoke('read_dir', { path: dirPath })
            .catch(e => { console.error('[gel] readDir error:', e); return { path: dirPath, entries: [], error: String(e) }; }),

        getCoverArt: (dirPath) => invoke('get_cover_art', { path: dirPath })
            .catch(e => { console.error('[gel] getCoverArt error:', e); return null; }),

        getPendingCoverPath: () => invoke('get_pending_cover_path')
            .catch(e => { console.error('[gel] getPendingCoverPath error:', e); return null; }),

        readFile: (filePath) => invoke('read_file', { path: filePath })
            .catch(e => { console.error('[gel] readFile error:', e); return { error: String(e) }; }),

        // ── Inter-window events ──────────────────────────────
        // Low-frequency events: broadcast to all (fine for button clicks)
        addTracks: (tracks) => emit('gel:addTracks', tracks),
        playTrack: (track) => emit('gel:playTrack', track),
        directPlay: (track) => emit('gel:playTrack', track),
        stop: () => emit('gel:stop', null),
        next: () => emit('gel:next', null),
        prev: () => emit('gel:prev', null),
        trackEnded: () => emit('gel:trackEnded', null),
        browserNext: () => emit('gel:browserNext', null),
        browserPrev: () => emit('gel:browserPrev', null),
        playlistUpdate: (data) => emit('gel:playlistUpdate', data),

        // Settings → Player: EQ changes (targeted)
        eqChange: (data) => emitTo('player', 'gel:eqChange', data),

        // High-frequency events: target specific windows only
        // vizData fires at 60fps — only the visualizer needs it
        vizData: (data) => emitTo('visualizer', 'gel:vizData', data),
        // playerState fires frequently — only playlist, browser, visualizer need it
        playerState: (state) => {
            emitTo('playlist', 'gel:playerState', state);
            emitTo('browser', 'gel:playerState', state);
            emitTo('visualizer', 'gel:playerState', state);
        },

        // ── Window management (Rust commands) ────────────────
        toggleWindow: (name) => invoke('toggle_window', { name }),
        showCoverArt: async (dirPath) => {
            // Store path in Rust state and show window.
            // The coverviewer pulls the path itself after loading —
            // no timing dependency on events.
            await invoke('show_cover_art', { dirPath });
        },
        closeWindow: async () => {
            if (!_label) _label = await invoke('get_window_label');
            return invoke('close_window', { label: _label });
        },
        openExternal: (url) => invoke('open_external', { url }),

        // Native drag — use startDragging() if available, fallback to IPC
        windowDrag: nativeDrag
            ? () => {} // noop — native drag handles it
            : async (dx, dy) => {
                if (!_label) _label = await invoke('get_window_label');
                return invoke('window_drag', { label: _label, dx, dy });
            },

        // Expose native drag for renderer drag handlers
        _startNativeDrag: nativeDrag,

        // ── Listeners ────────────────────────────────────────
        onAddTracks: (cb) => listen('gel:addTracks', (e) => cb(e.payload)),
        onPlayTrack: (cb) => listen('gel:playTrack', (e) => cb(e.payload)),
        onStop: (cb) => listen('gel:stop', () => cb()),
        onNext: (cb) => listen('gel:next', () => cb()),
        onPrev: (cb) => listen('gel:prev', () => cb()),
        onPlayerState: (cb) => listen('gel:playerState', (e) => cb(e.payload)),
        onTrackEnded: (cb) => listen('gel:trackEnded', () => cb()),
        onVizData: (cb) => listen('gel:vizData', (e) => cb(e.payload)),
        onPlaylistUpdate: (cb) => listen('gel:playlistUpdate', (e) => cb(e.payload)),
        onBrowserNext: (cb) => listen('gel:browserNext', () => cb()),
        onBrowserPrev: (cb) => listen('gel:browserPrev', () => cb()),
        onTrackEndedInBrowser: (cb) => listen('gel:trackEnded', () => cb()),
        onWindowVisibility: (cb) => listen('gel:windowVisibility', (e) => cb(e.payload)),
        onEqChange: (cb) => listen('gel:eqChange', (e) => cb(e.payload)),
        onCoverArt: (cb) => listen('gel:coverArt', (e) => cb(e.payload)),

        // ── Skins ────────────────────────────────────────────
        listSkins: () => invoke('list_skins'),
        loadSkin: (name) => invoke('load_skin', { name }),
        applySkin: (name) => emit('gel:applySkin', name),
        onApplySkin: (cb) => listen('gel:applySkin', (e) => cb(e.payload)),
    };

    console.log('[gel-bridge] window.gel API ready');

    // ── Global Theme Sync ──────────────────────────────────────

    // Helper: apply HSV theme from localStorage to CSS variables
    function applyThemeFromStorage() {
        const saved = localStorage.getItem('gel:theme');
        if (!saved) return;
        try {
            const { h, s, v } = JSON.parse(saved);
            const s_hsv = s / 100;
            const v_hsv = v / 100;
            let l = v_hsv * (1 - s_hsv / 2);
            let s_hsl = (l === 0 || l === 1) ? 0 : (v_hsv - l) / Math.min(l, 1 - l);

            const root = document.documentElement;
            root.style.setProperty('--theme-h', h);
            root.style.setProperty('--theme-s', (s_hsl * 100).toFixed(1) + '%');
            root.style.setProperty('--theme-l', (l * 100).toFixed(1) + '%');
        } catch (e) {}
    }

    // All windows listen for theme events and apply CSS variables.
    // On Linux, contain:paint on .blob-inner isolates these repaints
    // from reaching .blob-bg (skin PNGs), preventing edge ghosting.
    window.gel.onThemeColorChange((payload) => {
        const root = document.documentElement;
        root.style.setProperty('--theme-h', payload.h);
        root.style.setProperty('--theme-s', payload.s);
        root.style.setProperty('--theme-l', payload.l);
    });

    // Apply saved theme on load
    applyThemeFromStorage();

})();
