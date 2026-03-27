/**
 * skin-loader.js — Shared by all window renderers.
 *
 * Strategy for WebKitGTK transparent windows:
 *   - Keep ONE blob-bg element in the DOM at all times (never remove it).
 *   - Removing elements leaves ghost pixels in the compositor permanently.
 *   - To "clear": set opacity:0 + background:none on the same element.
 *   - To show skin: set background-image, then opacity:1.
 */

(function () {
    const body = document.body;
    let windowName = 'player';
    if (body.classList.contains('blob-browser-window')) windowName = 'browser';
    else if (body.classList.contains('blob-playlist-window')) windowName = 'playlist';
    else if (body.classList.contains('blob-viz-window')) windowName = 'visualizer';
    else if (body.classList.contains('blob-settings-window')) windowName = 'settings';
    else if (body.classList.contains('blob-coverviewer-window')) windowName = 'coverviewer';

    const blobBody = document.querySelector('.blob-body');
    const blobBg = document.querySelector('.blob-bg');
    const highlight = document.querySelector('.gel-highlight');
    const scanlines = document.querySelector('.scanlines');
    const isSettingsWindow = body.classList.contains('blob-settings-window');
    const isCoverviewerWindow = body.classList.contains('blob-coverviewer-window');
    const settingsSkinImg = isSettingsWindow ? document.getElementById('settings-skin-img') : null;

    // Coverviewer: load corner adornments instead of a full skin background
    if (isCoverviewerWindow) {
        const corners = {
            tl: document.querySelector('.cover-corner.corner-tl'),
            tr: document.querySelector('.cover-corner.corner-tr'),
            bl: document.querySelector('.cover-corner.corner-bl'),
            br: document.querySelector('.cover-corner.corner-br'),
        };

        function hideCorners() {
            Object.values(corners).forEach(el => {
                if (el) { el.style.display = 'none'; el.removeAttribute('src'); }
            });
        }

        function showCorners(skinData) {
            const map = {
                tl: skinData.coverTopLeft,
                tr: skinData.coverTopRight,
                bl: skinData.coverBottomLeft,
                br: skinData.coverBottomRight,
            };
            for (const [key, data] of Object.entries(map)) {
                if (corners[key] && data) {
                    corners[key].src = data;
                    corners[key].style.display = 'block';
                }
            }
        }

        let currentSkin = 'default';

        async function applySkin(skinName) {
            currentSkin = skinName;
            hideCorners();
            if (skinName === 'default') return;
            const skinData = await window.gel.loadSkin(skinName);
            if (currentSkin !== skinName) return;
            showCorners(skinData);
        }

        window.gel.onApplySkin((skinName) => applySkin(skinName));

        const savedSkin = localStorage.getItem('gel:skin') || 'default';
        if (savedSkin !== 'default') {
            currentSkin = savedSkin;
            window.gel.loadSkin(savedSkin).then((skinData) => {
                if (currentSkin !== savedSkin) return;
                showCorners(skinData);
            });
        }

        window._skinLoader = { applySkin, windowName };
        return;
    }

    let currentSkin = 'default';

    // ── Hide blob-bg (no skin visible) ───────────────────────
    function hideBg() {
        if (isSettingsWindow) {
            if (settingsSkinImg) {
                settingsSkinImg.style.display = 'none';
                settingsSkinImg.removeAttribute('src');
            }
            return;
        }
        if (!blobBg) return;
        blobBg.style.opacity = '0';
        blobBg.style.backgroundImage = 'none';
        blobBg.style.background = 'transparent';
    }

    // ── Show blob-bg with a skin image ───────────────────────
    function showBg(imageData) {
        if (isSettingsWindow) {
            // Settings: use <img> element — WebKitGTK treats decoded
            // bitmaps as stable layers that don't re-composite on sibling repaints.
            if (settingsSkinImg) {
                settingsSkinImg.src = imageData;
                settingsSkinImg.style.display = 'block';
            }
            return;
        }
        if (!blobBg) return;
        blobBg.style.background = '';
        blobBg.style.backgroundImage = `url("${imageData}")`;
        blobBg.style.backgroundSize = '100% 100%';
        blobBg.style.backgroundPosition = 'center';
        blobBg.style.backgroundRepeat = 'no-repeat';
        blobBg.style.opacity = '1';
    }

    // ── Apply a skin by name ─────────────────────────────────
    async function applySkin(skinName) {
        currentSkin = skinName;

        // Immediately hide old skin
        hideBg();

        if (skinName === 'default') {
            blobBody.classList.remove('skin-active');
            if (highlight) highlight.style.display = 'none';
            if (scanlines) scanlines.style.display = 'none';
            return;
        }

        blobBody.classList.add('skin-active');
        if (highlight) highlight.style.display = 'none';
        if (scanlines) scanlines.style.display = 'none';

        // Load skin PNG (async)
        const skinData = await window.gel.loadSkin(skinName);
        const imageData = skinData[windowName];

        // Bail if a different skin was requested while loading
        if (currentSkin !== skinName) return;

        if (imageData) {
            showBg(imageData);
        } else {
            blobBody.classList.remove('skin-active');
            currentSkin = 'default';
        }
    }

    // ── Listen for skin changes (non-settings windows only) ──
    if (!isSettingsWindow) {
        window.gel.onApplySkin((skinName) => {
            applySkin(skinName);
        });
    }

    // ── Startup ──────────────────────────────────────────────
    const savedSkin = localStorage.getItem('gel:skin') || 'default';

    // Hide blob-bg immediately — no default gradient to show
    hideBg();

    if (savedSkin !== 'default') {
        blobBody.classList.add('skin-active');
        if (highlight) highlight.style.display = 'none';
        if (scanlines) scanlines.style.display = 'none';
        currentSkin = savedSkin;

        window.gel.loadSkin(savedSkin).then((skinData) => {
            if (currentSkin !== savedSkin) return;
            const imageData = skinData[windowName];
            if (imageData) {
                showBg(imageData);
            }
        });
    }

    window._skinLoader = { applySkin, windowName };
})();
