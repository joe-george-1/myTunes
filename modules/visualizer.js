/**
 * visualizer.js — Frequency bar + oscilloscope visualizations
 * Renders to both the mini circular canvas and the large blob canvas
 */

import { player } from './player.js';

let miniCanvas, miniCtx;
let mainCanvas, mainCtx;
let isRunning = false;

export function initVisualizer() {
    miniCanvas = document.getElementById('mini-viz');
    miniCtx = miniCanvas.getContext('2d');

    mainCanvas = document.getElementById('main-viz');
    mainCtx = mainCanvas.getContext('2d');

    // Size canvases properly
    resizeCanvas(miniCanvas, miniCtx);
    resizeCanvas(mainCanvas, mainCtx);

    // Start render loop when playing
    player.addEventListener('play', startLoop);
    player.addEventListener('pause', stopLoop);
    player.addEventListener('stop', () => {
        stopLoop();
        clearCanvases();
    });
}

function resizeCanvas(canvas, ctx) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
}

function startLoop() {
    if (isRunning) return;
    isRunning = true;
    renderFrame();
}

function stopLoop() {
    isRunning = false;
}

function clearCanvases() {
    if (miniCtx) {
        miniCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
    }
    if (mainCtx) {
        mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
    }
}

function renderFrame() {
    if (!isRunning) return;
    requestAnimationFrame(renderFrame);

    const freqData = player.getAnalyserData();
    const waveData = player.getWaveformData();

    if (freqData) {
        drawMiniViz(freqData);
        drawMainViz(freqData, waveData);
    }
}

/* ── Mini Visualizer (circular, upper-right of skin) ────── */
function drawMiniViz(data) {
    const w = miniCanvas.clientWidth;
    const h = miniCanvas.clientHeight;
    miniCtx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) / 2 - 4;
    const bars = 32;
    const sliceAngle = (Math.PI * 2) / bars;

    for (let i = 0; i < bars; i++) {
        const dataIndex = Math.floor(i * data.length / bars);
        const value = data[dataIndex] / 255;
        const barLength = value * radius * 0.7;

        const angle = i * sliceAngle - Math.PI / 2;
        const x1 = cx + Math.cos(angle) * (radius * 0.3);
        const y1 = cy + Math.sin(angle) * (radius * 0.3);
        const x2 = cx + Math.cos(angle) * (radius * 0.3 + barLength);
        const y2 = cy + Math.sin(angle) * (radius * 0.3 + barLength);

        miniCtx.beginPath();
        miniCtx.moveTo(x1, y1);
        miniCtx.lineTo(x2, y2);
        miniCtx.strokeStyle = `rgba(200, 160, 216, ${0.3 + value * 0.7})`;
        miniCtx.lineWidth = 2;
        miniCtx.lineCap = 'round';
        miniCtx.stroke();
    }
}

/* ── Main Visualizer (rectangular, in blob panel) ────────── */
function drawMainViz(freqData, waveData) {
    const w = mainCanvas.clientWidth;
    const h = mainCanvas.clientHeight;
    mainCtx.clearRect(0, 0, w, h);

    // Background frequency bars
    const barCount = 64;
    const barWidth = w / barCount;
    const barGap = 1;

    for (let i = 0; i < barCount; i++) {
        const dataIndex = Math.floor(i * freqData.length / barCount);
        const value = freqData[dataIndex] / 255;
        const barHeight = value * h * 0.85;

        const x = i * barWidth;
        const y = h - barHeight;

        // Gradient bar
        const gradient = mainCtx.createLinearGradient(x, h, x, y);
        gradient.addColorStop(0, 'rgba(120, 80, 160, 0.6)');
        gradient.addColorStop(0.5, 'rgba(180, 140, 200, 0.5)');
        gradient.addColorStop(1, 'rgba(220, 190, 240, 0.3)');

        mainCtx.fillStyle = gradient;
        mainCtx.fillRect(x + barGap / 2, y, barWidth - barGap, barHeight);

        // Specular cap
        if (barHeight > 4) {
            mainCtx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            mainCtx.fillRect(x + barGap / 2, y, barWidth - barGap, 2);
        }
    }

    // Overlay waveform line
    if (waveData) {
        mainCtx.beginPath();
        const sliceWidth = w / waveData.length;
        let x = 0;

        for (let i = 0; i < waveData.length; i++) {
            const v = waveData[i] / 255;
            const y = v * h;
            if (i === 0) {
                mainCtx.moveTo(x, y);
            } else {
                mainCtx.lineTo(x, y);
            }
            x += sliceWidth;
        }

        mainCtx.strokeStyle = 'rgba(255, 230, 255, 0.25)';
        mainCtx.lineWidth = 1.5;
        mainCtx.stroke();
    }
}
