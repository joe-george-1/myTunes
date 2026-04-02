/**
 * coverviewer-renderer.js — Album cover art viewer window
 */

(function () {
    'use strict';

    const img = document.getElementById('cover-img');
    const blobBody = document.querySelector('.blob-body');
    const blobBg = document.querySelector('.blob-bg');

    // Lazily resolve Tauri window handle (window starts hidden, so
    // getCurrentWindow() at init time can return an unusable handle
    // on Linux/WebKitGTK). Cache after first successful resolution.
    const T = window.__TAURI__;
    const LogicalSize = T?.window?.LogicalSize;
    let _win = null;
    function getWin() {
        if (!_win) {
            const fn = T?.window?.getCurrentWindow;
            if (fn) _win = fn();
        }
        return _win;
    }

    // Ensure the coverviewer always has a visible background
    function ensureBackground() {
        if (blobBg) {
            blobBg.style.background = '';
            blobBg.style.opacity = '1';
        }
        blobBody.classList.remove('skin-active');
    }
    ensureBackground();
    requestAnimationFrame(ensureBackground);

    // ── Theme sync ───────────────────────────────────────────
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

    // ── Cover art loading ────────────────────────────────────
    async function loadCover() {
        try {
            const dirPath = await window.gel.getPendingCoverPath();
            if (!dirPath) return;
            const dataUrl = await window.gel.getCoverArt(dirPath);
            if (dataUrl) {
                img.src = dataUrl;
            }
        } catch (e) {
            console.error('[coverviewer] Failed to load cover art:', e);
        }
    }

    loadCover();

    // Listen for explicit reload event from Rust (visibilitychange is unreliable on Windows)
    if (window.__TAURI__?.event?.listen) {
        window.__TAURI__.event.listen('gel:loadCover', () => {
            applyThemeFromStorage();
            loadCover();
        });
    }

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            applyThemeFromStorage();
            loadCover();
        }
    });

    // Close button
    document.getElementById('btn-close').addEventListener('click', (e) => {
        e.stopPropagation();
        window.gel.closeWindow();
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            window.gel.closeWindow();
        }
    });

    // ── Window drag — native startDragging() with IPC fallback ──
    blobBody.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('button, .coverviewer-resize')) return;

        // Native Tauri drag
        if (window.gel._startNativeDrag) {
            window.gel._startNativeDrag();
            return;
        }

        // IPC-based drag (fallback)
        let dragging = true, startX = e.screenX, startY = e.screenY;
        blobBody.classList.add('dragging');

        const onMove = (e2) => {
            if (!dragging) return;
            window.gel.windowDrag(e2.screenX - startX, e2.screenY - startY);
            startX = e2.screenX; startY = e2.screenY;
        };
        const onUp = () => {
            dragging = false; blobBody.classList.remove('dragging');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    // ── Window resize — via setSize() ──────────────────────────
    // Since resizable:false disables native WM resize, we handle
    // it ourselves with mouse tracking and setSize().
    const MIN_SIZE = 200;

    // Track size synchronously
    let currentSize = Math.max(window.innerWidth, window.innerHeight);
    window.addEventListener('resize', () => {
        currentSize = Math.max(window.innerWidth, window.innerHeight);
    });

    document.querySelectorAll('.coverviewer-resize').forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();

            const win = getWin();
            if (!win || !LogicalSize) return;

            const startX = e.screenX;
            const startY = e.screenY;
            const startSize = currentSize;
            let lastApplied = startSize;
            let rafId = null;
            let pending = startSize;

            const apply = () => {
                rafId = null;
                if (pending !== lastApplied) {
                    lastApplied = pending;
                    win.setSize(new LogicalSize(pending, pending));
                }
            };

            const onMove = (e2) => {
                const dx = e2.screenX - startX;
                const dy = e2.screenY - startY;
                pending = Math.max(MIN_SIZE, Math.round(startSize + (dx + dy) / 2));
                if (!rafId) rafId = requestAnimationFrame(apply);
            };

            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (rafId) cancelAnimationFrame(rafId);
                if (pending !== lastApplied) {
                    win.setSize(new LogicalSize(pending, pending));
                }
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    });
})();
