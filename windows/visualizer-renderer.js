/**
 * visualizer-renderer.js — Receives frequency data from player via IPC.
 * Renders bars + waveform on a canvas.
 */

const canvas = document.getElementById('main-viz');
const ctx = canvas.getContext('2d');
const blobBody = document.querySelector('.blob-body');

let freqData = null;
let waveData = null;

// ── Receive viz data from player window ─────────────────────
window.gel.onVizData((data) => {
    freqData = data.freq;
    waveData = data.wave;
});

// ── Render loop ─────────────────────────────────────────────
function draw() {
    requestAnimationFrame(draw);

    const w = canvas.width = canvas.offsetWidth * devicePixelRatio;
    const h = canvas.height = canvas.offsetHeight * devicePixelRatio;
    ctx.clearRect(0, 0, w, h);

    if (!freqData || !waveData) {
        // Idle: draw ambient glow
        drawIdle(w, h);
        return;
    }

    drawBars(w, h);
    drawWaveform(w, h);
}
draw();

function drawBars(w, h) {
    const bars = Math.min(freqData.length, 64);
    const barW = w / bars;

    for (let i = 0; i < bars; i++) {
        const val = freqData[i] / 255;
        const barH = val * h * 0.88;
        const themeH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--theme-h')) || 210;
        const themeS = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--theme-s')) || 0;
        
        const light = 60 + val * 35;
        const alpha = 0.4 + val * 0.5;

        ctx.fillStyle = `hsla(${themeH}, ${themeS}%, ${light}%, ${alpha})`;
        ctx.fillRect(i * barW + 1, h - barH, barW - 2, barH);

        // Specular top on tall bars
        if (val > 0.3) {
            const grad = ctx.createLinearGradient(0, h - barH, 0, h - barH + barH * 0.15);
            grad.addColorStop(0, `rgba(255,255,255,${val * 0.2})`);
            grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad;
            ctx.fillRect(i * barW + 1, h - barH, barW - 2, barH * 0.15);
        }
    }
}

function drawWaveform(w, h) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1.5 * devicePixelRatio;
    ctx.beginPath();

    const sliceW = w / waveData.length;
    for (let i = 0; i < waveData.length; i++) {
        const v = waveData[i] / 128.0;
        const y = (v * h) / 2;
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * sliceW, y);
    }
    ctx.stroke();
}

function drawIdle(w, h) {
    // Soft ambient pulse
    const t = Date.now() * 0.001;
    const alpha = 0.03 + Math.sin(t * 0.5) * 0.015;
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.fillRect(0, 0, w, h);

    // Center glow
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.4);
    grad.addColorStop(0, `rgba(255, 255, 255, ${0.04 + Math.sin(t) * 0.02})`);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
}

// ── Close button ────────────────────────────────────────────
document.getElementById('btn-close').addEventListener('click', (e) => {
    e.stopPropagation();
    window.gel.closeWindow();
});

// ── Window drag ─────────────────────────────────────────────
initWindowDrag();

function initWindowDrag() {
    blobBody.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; // Left click only
        if (e.target.closest('button, canvas')) return;

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
