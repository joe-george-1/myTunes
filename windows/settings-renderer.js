/**
 * settings-renderer.js — Settings window.
 * Manages skin selection, EQ settings (sent to player via events),
 * and external links.
 */

const blobBody = document.querySelector('.blob-body');
const skinSelect = document.getElementById('skin-select');

// ── Close ───────────────────────────────────────────────────
document.getElementById('btn-close').addEventListener('click', () => {
    window.gel.closeWindow();
});

// ── Skin selector ───────────────────────────────────────────
(async () => {
    try {
        const skins = await window.gel.listSkins();
        const allSkins = ['default', ...skins.filter(s => s !== 'default')];
        skinSelect.innerHTML = '';
        allSkins.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name.charAt(0).toUpperCase() + name.slice(1);
            skinSelect.appendChild(opt);
        });

        const savedSkin = localStorage.getItem('gel:skin') || 'default';
        skinSelect.value = savedSkin;
    } catch (e) {
        console.warn('[settings] Failed to load skins:', e);
    }
})();

skinSelect.addEventListener('change', async () => {
    const skinName = skinSelect.value;
    localStorage.setItem('gel:skin', skinName);
    // Broadcast to other windows
    window.gel.applySkin(skinName);
    // Apply locally directly — don't wait for event round-trip
    if (window._skinLoader) {
        window._skinLoader.applySkin(skinName);
    }
});

// ── EQ sliders → send values to player via event ─────────────
const EQ_BANDS = ['eq-bass', 'eq-low-mid', 'eq-mid', 'eq-high-mid', 'eq-treble'];

// Load saved EQ values into sliders
EQ_BANDS.forEach(id => {
    const saved = localStorage.getItem('gel:' + id);
    if (saved !== null) {
        document.getElementById(id).value = saved;
    }
});

// Send EQ changes to player
EQ_BANDS.forEach((id, i) => {
    const slider = document.getElementById(id);
    slider.addEventListener('input', () => {
        const val = parseFloat(slider.value);
        localStorage.setItem('gel:' + id, slider.value);
        window.gel.eqChange({ band: i, gain: val });
    });
});

// Reset EQ
document.getElementById('eq-reset').addEventListener('click', () => {
    EQ_BANDS.forEach((id, i) => {
        const slider = document.getElementById(id);
        slider.value = 0;
        localStorage.removeItem('gel:' + id);
        window.gel.eqChange({ band: i, gain: 0 });
    });
});

// ── Color Picker ───────────────────────────────────────────
class HSVColorPicker {
    constructor() {
        this.hsvRect = document.getElementById('hsv-rect');
        this.hueCanvas = document.getElementById('hue-canvas');
        this.resetBtn = document.getElementById('btn-reset-color');
        
        this.ctx = this.hsvRect.getContext('2d', { willReadFrequently: true });
        this.hueCtx = this.hueCanvas.getContext('2d', { willReadFrequently: true });

        this.h = 210; // Default silver (blue-ish hue but 0% sat)
        this.s = 0;
        this.v = 100;

        this.isDraggingHSV = false;
        this.isDraggingHue = false;

        this.init();
    }

    init() {
        const saved = localStorage.getItem('gel:theme');
        if (saved) {
            const { h, s, v } = JSON.parse(saved);
            this.h = h; this.s = s; this.v = v;
        }

        this.renderHue();
        this.renderHSV();
        this.updateGlobalTheme();

        this.hsvRect.addEventListener('mousedown', (e) => {
            this.isDraggingHSV = true;
            this.handleHSV(e);
        });
        this.hueCanvas.addEventListener('mousedown', (e) => {
            this.isDraggingHue = true;
            this.handleHue(e);
        });

        window.addEventListener('mousemove', (e) => {
            if (this.isDraggingHSV) this.handleHSV(e);
            if (this.isDraggingHue) this.handleHue(e);
        });

        window.addEventListener('mouseup', () => {
            if (this.isDraggingHSV || this.isDraggingHue) {
                // On Linux, theme was deferred during drag to avoid ghosting
                if (window.gel.isLinux) this.updateGlobalTheme();
                this.save();
            }
            this.isDraggingHSV = false;
            this.isDraggingHue = false;
        });

        this.resetBtn.addEventListener('click', () => {
            this.h = 210; this.s = 0; this.v = 100;
            this.renderHSV();
            this.updateGlobalTheme();
            this.save();
        });
    }

    renderHue() {
        const w = this.hueCanvas.width;
        const h = this.hueCanvas.height;
        const grad = this.hueCtx.createLinearGradient(0, 0, 0, h);
        for (let i = 0; i <= 360; i += 30) {
            grad.addColorStop(i / 360, `hsl(${i}, 100%, 50%)`);
        }
        this.hueCtx.fillStyle = grad;
        this.hueCtx.fillRect(0, 0, w, h);
    }

    renderHSV() {
        const w = this.hsvRect.width;
        const h = this.hsvRect.height;

        // Base color (Hue)
        this.ctx.fillStyle = `hsl(${this.h}, 100%, 50%)`;
        this.ctx.fillRect(0, 0, w, h);

        // Saturation gradient (White to transparent)
        const gradS = this.ctx.createLinearGradient(0, 0, w, 0);
        gradS.addColorStop(0, 'rgba(255,255,255,1)');
        gradS.addColorStop(1, 'rgba(255,255,255,0)');
        this.ctx.fillStyle = gradS;
        this.ctx.fillRect(0, 0, w, h);

        // Value gradient (Transparent to black)
        const gradV = this.ctx.createLinearGradient(0, 0, 0, h);
        gradV.addColorStop(0, 'rgba(0,0,0,0)');
        gradV.addColorStop(1, 'rgba(0,0,0,1)');
        this.ctx.fillStyle = gradV;
        this.ctx.fillRect(0, 0, w, h);

        // Draw cursor
        const x = (this.s / 100) * w;
        const y = (1 - (this.v / 100)) * h;
        this.ctx.strokeStyle = '#fff';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(x, y, 4, 0, Math.PI * 2);
        this.ctx.stroke();
        this.ctx.strokeStyle = '#000';
        this.ctx.lineWidth = 1;
        this.ctx.stroke();
    }

    handleHue(e) {
        const rect = this.hueCanvas.getBoundingClientRect();
        let y = e.clientY - rect.top;
        y = Math.max(0, Math.min(rect.height, y));
        this.h = (y / rect.height) * 360;
        this.renderHSV();
        // On Linux, defer CSS variable updates to mouseup to prevent ghosting.
        // The canvas preview still updates live via renderHSV().
        if (!window.gel.isLinux) this.updateGlobalTheme();
    }

    handleHSV(e) {
        const rect = this.hsvRect.getBoundingClientRect();
        let x = e.clientX - rect.left;
        let y = e.clientY - rect.top;
        x = Math.max(0, Math.min(rect.width, x));
        y = Math.max(0, Math.min(rect.height, y));

        this.s = (x / rect.width) * 100;
        this.v = (1 - (y / rect.height)) * 100;

        this.renderHSV();
        if (!window.gel.isLinux) this.updateGlobalTheme();
    }

    updateGlobalTheme() {
        // Convert HSV to HSL (CSS is easier with HSL)
        // HSV s, v are 0-100.
        const s_hsv = this.s / 100;
        const v_hsv = this.v / 100;
        let l = v_hsv * (1 - s_hsv / 2);
        let s_hsl = (l === 0 || l === 1) ? 0 : (v_hsv - l) / Math.min(l, 1 - l);

        const payload = {
            h: this.h,
            s: (s_hsl * 100).toFixed(1) + '%',
            l: (l * 100).toFixed(1) + '%'
        };

        // Broadcast to all windows (including this one via gel-bridge listener)
        if (window.gel.emitThemeColor) {
            window.gel.emitThemeColor(payload);
        }

        // Apply locally too (immediate, don't wait for event round-trip)
        document.documentElement.style.setProperty('--theme-h', payload.h);
        document.documentElement.style.setProperty('--theme-s', payload.s);
        document.documentElement.style.setProperty('--theme-l', payload.l);
    }

    save() {
        localStorage.setItem('gel:theme', JSON.stringify({ h: this.h, s: this.s, v: this.v }));
    }
}

new HSVColorPicker();

// ── Links ───────────────────────────────────────────────────
document.getElementById('link-github').addEventListener('click', () => {
    window.gel.openExternal('https://github.com/joe-george-1');
});
document.getElementById('link-kofi').addEventListener('click', () => {
    window.gel.openExternal('mailto:1123.jpg@gmail.com');
});

// ── Window drag ─────────────────────────────────────────────
initWindowDrag();

function initWindowDrag() {
    blobBody.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; // Left click only
        if (e.target.closest('button, input, select, .settings-scroll')) return;

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
}
