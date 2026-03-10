/**
 * main.js — Entry point: wires all modules together
 */

import { initDrag } from './modules/drag.js';
import { player } from './modules/player.js';
import { initFileBrowser } from './modules/filebrowser.js';
import { playlist } from './modules/playlist.js';
import { initVisualizer } from './modules/visualizer.js';

// ── DOM refs ────────────────────────────────────────────────
const btnPlay = document.getElementById('btn-play');
const btnStop = document.getElementById('btn-stop');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const btnShuffle = document.getElementById('btn-shuffle');
const btnRepeat = document.getElementById('btn-repeat');
const btnClearPlaylist = document.getElementById('btn-clear-playlist');
const trackTitle = document.getElementById('track-title');
const trackTime = document.getElementById('track-time');
const seekBar = document.getElementById('seek-bar');
const seekProgress = document.getElementById('seek-progress');
const volumeTrack = document.getElementById('volume-track');
const volumeFill = document.getElementById('volume-fill');
const playlistList = document.getElementById('playlist-list');
const playlistCount = document.getElementById('playlist-count');

// ── Initialize modules ──────────────────────────────────────
initDrag();
initFileBrowser();
initVisualizer();

// ── Transport controls ──────────────────────────────────────
btnPlay.addEventListener('click', () => {
    if (player.currentTrack) {
        player.togglePlay();
    } else if (playlist.tracks.length > 0) {
        playlist.playTrack(0);
    }
});

btnStop.addEventListener('click', () => player.stop());
btnPrev.addEventListener('click', () => playlist.prev());
btnNext.addEventListener('click', () => playlist.next());

// ── Shuffle / Repeat ────────────────────────────────────────
btnShuffle.addEventListener('click', () => playlist.toggleShuffle());
btnRepeat.addEventListener('click', () => playlist.toggleRepeat());

playlist.addEventListener('modechange', () => {
    btnShuffle.classList.toggle('active', playlist.shuffle);
    btnRepeat.classList.toggle('active', playlist.repeat);
});

// ── Clear playlist ──────────────────────────────────────────
btnClearPlaylist.addEventListener('click', () => playlist.clear());

// ── Player events → UI updates ──────────────────────────────
player.addEventListener('trackchange', (e) => {
    const name = cleanName(e.detail.name);
    const titleSpan = trackTitle.querySelector('span');
    titleSpan.textContent = name;

    trackTitle.classList.remove('scrolling');
    requestAnimationFrame(() => {
        if (titleSpan.scrollWidth > trackTitle.clientWidth) {
            trackTitle.classList.add('scrolling');
        }
    });
});

player.addEventListener('play', () => {
    btnPlay.textContent = '⏸';
    btnPlay.classList.add('playing');
});
player.addEventListener('pause', () => {
    btnPlay.textContent = '▶';
    btnPlay.classList.remove('playing');
});
player.addEventListener('stop', () => {
    btnPlay.textContent = '▶';
    btnPlay.classList.remove('playing');
    seekProgress.style.width = '0%';
    trackTime.textContent = '—:—';
});

player.addEventListener('timeupdate', (e) => {
    const { currentTime, duration } = e.detail;
    if (!isNaN(duration) && duration > 0) {
        const pct = (currentTime / duration) * 100;
        seekProgress.style.width = pct + '%';
        trackTime.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    }
});

// ── Seek bar interaction ────────────────────────────────────
let isSeeking = false;

seekBar.addEventListener('pointerdown', (e) => {
    isSeeking = true;
    seekBar.classList.add('seeking');
    seekBar.setPointerCapture(e.pointerId);
    doSeek(e);
});
seekBar.addEventListener('pointermove', (e) => {
    if (isSeeking) doSeek(e);
});
seekBar.addEventListener('pointerup', () => {
    isSeeking = false;
    seekBar.classList.remove('seeking');
});

function doSeek(e) {
    const rect = seekBar.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    player.seek(frac);
    seekProgress.style.width = (frac * 100) + '%';
}

// ── Volume bar interaction ──────────────────────────────────
let isVolumeAdjusting = false;

volumeTrack.addEventListener('pointerdown', (e) => {
    isVolumeAdjusting = true;
    volumeTrack.setPointerCapture(e.pointerId);
    doVolume(e);
    e.stopPropagation();
});
volumeTrack.addEventListener('pointermove', (e) => {
    if (isVolumeAdjusting) doVolume(e);
});
volumeTrack.addEventListener('pointerup', () => {
    isVolumeAdjusting = false;
});

function doVolume(e) {
    const rect = volumeTrack.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    player.setVolume(frac);
    volumeFill.style.width = (frac * 100) + '%';
}

// ── Playlist UI ─────────────────────────────────────────────
playlist.addEventListener('change', renderPlaylist);

function renderPlaylist() {
    playlistList.innerHTML = '';
    playlistCount.textContent = playlist.tracks.length;

    if (playlist.tracks.length === 0) {
        playlistList.innerHTML = '<div class="playlist-empty">✦ empty ✦</div>';
        return;
    }

    playlist.tracks.forEach((track, idx) => {
        const item = document.createElement('div');
        item.className = 'playlist-item' + (idx === playlist.currentIndex ? ' current' : '');
        item.innerHTML = `
      <span class="pl-num">${String(idx + 1).padStart(2, '0')}</span>
      <span class="pl-name">${cleanName(track.name)}</span>
      <span class="pl-rm" title="Remove">✕</span>
    `;

        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('pl-rm')) {
                playlist.removeTrack(idx);
                return;
            }
            playlist.playTrack(idx);
        });

        playlistList.appendChild(item);
    });
}

// ── Helpers ─────────────────────────────────────────────────
function formatTime(sec) {
    if (isNaN(sec)) return '—:—';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function cleanName(name) {
    return name.replace(/\.(mp3|wav|ogg|flac|aac|m4a|wma|opus|webm)$/i, '');
}
