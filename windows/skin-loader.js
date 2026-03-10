/**
 * skin-loader.js — Shared by all window renderers.
 * Handles loading and applying skin PNG images as background.
 *
 * Skin structure:
 *   skins/<skinName>/player.png
 *   skins/<skinName>/browser.png
 *   skins/<skinName>/playlist.png
 *   skins/<skinName>/visualizer.png
 *
 * When a skin PNG exists, it replaces the CSS blob gradient.
 * When no PNG exists for a window, the CSS default (blob gradient) is used.
 * The "default" skin = pure CSS blobs (no PNGs needed).
 */

(function () {
    // Detect which window this is from the body class
    const body = document.body;
    let windowName = 'player';
    if (body.classList.contains('blob-browser-window')) windowName = 'browser';
    else if (body.classList.contains('blob-playlist-window')) windowName = 'playlist';
    else if (body.classList.contains('blob-viz-window')) windowName = 'visualizer';
    else if (body.classList.contains('blob-settings-window')) windowName = 'settings';

    const blobBody = document.querySelector('.blob-body');
    const highlight = document.querySelector('.gel-highlight');
    const scanlines = document.querySelector('.scanlines');

    let currentSkin = 'default';

    // ── Apply a skin by name ────────────────────────────────
    async function applySkin(skinName) {
        currentSkin = skinName;

        if (skinName === 'default') {
            // Restore CSS defaults
            restoreCSSDefaults();
            return;
        }

        // Load skin data from main process
        const skinData = await window.gel.loadSkin(skinName);
        const imageData = skinData[windowName];
        
        if (imageData) {
            currentSkin = skinName;
            
            // Apply the skin PNG as background
            const bg = document.querySelector('.blob-bg');
            if (bg) {
                bg.style.backgroundImage = `url("${imageData}")`;
                bg.style.display = 'block';
            }
            blobBody.classList.add('skin-active');
            blobBody.style.setProperty('--skin-image', `url("${imageData}")`);

            // Hide the CSS gel effects
            if (highlight) highlight.style.display = 'none';
            if (scanlines) scanlines.style.display = 'none';

            // Tell Rust to physically resize the window momentarily to clear X11 buffer
            if (window.gel && window.gel.forceClearWindow) {
                window.gel.forceClearWindow(windowName);
            }
        } else {
            // Reverting to CSS Defaults
            currentSkin = 'default';
            
            // Switch off the PNG background
            const bg = document.querySelector('.blob-bg');
            if (bg) {
                bg.style.backgroundImage = 'none';
                bg.style.display = '';
            }

            restoreCSSDefaults();

            // Tell Rust to physically resize the window momentarily to clear X11 buffer
            if (window.gel && window.gel.forceClearWindow) {
                window.gel.forceClearWindow(windowName);
            }
        }
    }

    function restoreCSSDefaults() {
        blobBody.classList.remove('skin-active');
        blobBody.style.removeProperty('--skin-image');
        if (highlight) highlight.style.display = '';
        if (scanlines) scanlines.style.display = '';
    }

    // ── Listen for skin changes from main process ───────────
    window.gel.onApplySkin((skinName) => {
        applySkin(skinName);
    });

    // Expose for other scripts in this window
    window._skinLoader = { applySkin, windowName };
})();
