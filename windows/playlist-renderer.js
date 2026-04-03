/**
 * playlist-renderer.js — Playlist management window.
 * Receives tracks from browser, tells player what to play.
 *
 * Interactions:
 *   - Single click → select (does NOT play)
 *   - Double click → play track
 *   - Shift+click → range select
 *   - Ctrl+click → toggle individual selection
 *   - Ctrl+Shift+click → extend range
 *   - ✕ on selected items → remove all selected
 *   - Drag items → reorder playlist
 *   - Next/Prev when empty → forward to browser folder
 */

const playlistList = document.getElementById('playlist-list');
const btnClear = document.getElementById('btn-clear');
const blobBody = document.querySelector('.blob-body');

let tracks = [];
let currentIndex = -1;
let shuffle = false;
let repeat = false;

// ── Selection state ─────────────────────────────────────────
let selectedIndices = new Set();
let lastClickedIndex = -1;
let anchorIndex = -1;

// ── Drag reorder state ──────────────────────────────────────
let dragFromIdx = -1;
let dragOverIdx = -1;

// ── IPC: receive tracks from browser ────────────────────────
window.gel.onAddTracks((newTracks) => {
    newTracks.forEach(t => {
        tracks.push({ name: t.name, path: t.path });
    });

    const playNow = newTracks.find(t => t.playImmediately);
    if (playNow) {
        playTrack(tracks.length - 1);
    }

    renderPlaylist();
    broadcastPlaylist();
});

// ── IPC: track ended → advance ──────────────────────────────
window.gel.onTrackEnded(() => {
    if (tracks.length === 0) return;

    if (repeat) {
        playTrack(currentIndex);
    } else if (shuffle) {
        playTrack(Math.floor(Math.random() * tracks.length));
    } else if (currentIndex < tracks.length - 1) {
        playTrack(currentIndex + 1);
    }
});

// ── IPC: next/prev from player ──────────────────────────────
window.gel.onNext(() => {
    if (tracks.length === 0) {
        window.gel.browserNext();
        return;
    }
    if (shuffle) {
        playTrack(Math.floor(Math.random() * tracks.length));
    } else {
        playTrack((currentIndex + 1) % tracks.length);
    }
});

window.gel.onPrev(() => {
    if (tracks.length === 0) {
        window.gel.browserPrev();
        return;
    }
    if (shuffle) {
        playTrack(Math.floor(Math.random() * tracks.length));
    } else {
        playTrack((currentIndex - 1 + tracks.length) % tracks.length);
    }
});

// ── IPC: player state (for shuffle/repeat toggles) ──────────
window.gel.onPlayerState((state) => {
    if (state.action === 'toggleShuffle') shuffle = !shuffle;
    if (state.action === 'toggleRepeat') repeat = !repeat;
});

// ── Play a track ────────────────────────────────────────────
function playTrack(idx) {
    if (idx < 0 || idx >= tracks.length) return;
    currentIndex = idx;
    const track = tracks[idx];
    window.gel.playTrack({ name: track.name, path: track.path });
    renderPlaylist();
}

// ── Clear playlist (does NOT stop current playback) ─────────
btnClear.addEventListener('click', () => {
    tracks = [];
    currentIndex = -1;
    selectedIndices.clear();
    lastClickedIndex = -1;
    anchorIndex = -1;
    // Don't call window.gel.stop() — let current song keep playing
    renderPlaylist();
    broadcastPlaylist();
});

// ── Close (hide window) ─────────────────────────────────────
document.getElementById('btn-close').addEventListener('click', () => {
    window.gel.closeWindow();
});

// ── Remove selected ─────────────────────────────────────────
function removeSelected() {
    if (selectedIndices.size === 0) return;

    const toRemove = [...selectedIndices].sort((a, b) => b - a);
    toRemove.forEach(idx => {
        tracks.splice(idx, 1);
        if (idx < currentIndex) currentIndex--;
        else if (idx === currentIndex) currentIndex = -1;
    });

    selectedIndices.clear();
    lastClickedIndex = -1;
    anchorIndex = -1;
    renderPlaylist();
    broadcastPlaylist();
}

// ── Selection logic ─────────────────────────────────────────
function handleSelect(idx, e) {
    if (e.ctrlKey && e.shiftKey) {
        if (anchorIndex >= 0) {
            const start = Math.min(anchorIndex, idx);
            const end = Math.max(anchorIndex, idx);
            for (let i = start; i <= end; i++) selectedIndices.add(i);
        } else {
            selectedIndices.add(idx);
            anchorIndex = idx;
        }
    } else if (e.shiftKey) {
        selectedIndices.clear();
        const from = anchorIndex >= 0 ? anchorIndex : 0;
        const start = Math.min(from, idx);
        const end = Math.max(from, idx);
        for (let i = start; i <= end; i++) selectedIndices.add(i);
    } else if (e.ctrlKey) {
        if (selectedIndices.has(idx)) {
            selectedIndices.delete(idx);
        } else {
            selectedIndices.add(idx);
        }
        anchorIndex = idx;
    } else {
        selectedIndices.clear();
        selectedIndices.add(idx);
        anchorIndex = idx;
    }

    lastClickedIndex = idx;
    renderPlaylist();
}

// ── Render ───────────────────────────────────────────────────
function renderPlaylist() {
    playlistList.innerHTML = '';

    if (tracks.length === 0) {
        playlistList.innerHTML = '<div class="playlist-empty">✦ empty ✦</div>';
        return;
    }

    tracks.forEach((track, idx) => {
        const item = document.createElement('div');
        const classes = ['playlist-item'];
        if (idx === currentIndex) classes.push('current');
        if (selectedIndices.has(idx)) classes.push('selected');
        item.className = classes.join(' ');
        item.dataset.idx = idx;

        item.innerHTML = `
      <span class="pl-grip" title="Drag to reorder">⠿</span>
      <span class="pl-num">${String(idx + 1).padStart(2, '0')}</span>
      <span class="pl-name">${cleanName(track.name)}</span>
      <span class="pl-rm" title="Remove">\uff0d</span>
    `;

        // ── Mouse-based drag reorder (replaces HTML5 drag which is broken on Windows WebView2) ──
        item.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;

            // Remove button
            if (e.target.classList.contains('pl-rm')) {
                e.stopPropagation();
                if (selectedIndices.has(idx) && selectedIndices.size > 1) {
                    removeSelected();
                } else {
                    tracks.splice(idx, 1);
                    if (idx < currentIndex) currentIndex--;
                    else if (idx === currentIndex) currentIndex = -1;
                    selectedIndices.delete(idx);
                    const newSelected = new Set();
                    selectedIndices.forEach(i => {
                        if (i > idx) newSelected.add(i - 1);
                        else newSelected.add(i);
                    });
                    selectedIndices = newSelected;
                    renderPlaylist();
                    broadcastPlaylist();
                }
                return;
            }

            // Grip drag
            if (e.target.classList.contains('pl-grip')) {
                e.preventDefault();
                e.stopPropagation();
                dragFromIdx = idx;
                item.classList.add('dragging');

                const onMove = (e2) => {
                    const target = document.elementFromPoint(e2.clientX, e2.clientY);
                    const overItem = target?.closest('.playlist-item');
                    playlistList.querySelectorAll('.drag-above, .drag-below').forEach(el => {
                        el.classList.remove('drag-above', 'drag-below');
                    });
                    if (overItem && overItem !== item) {
                        const overIdx = parseInt(overItem.dataset.idx);
                        const rect = overItem.getBoundingClientRect();
                        const midY = rect.top + rect.height / 2;
                        if (e2.clientY < midY) {
                            overItem.classList.add('drag-above');
                            dragOverIdx = overIdx;
                        } else {
                            overItem.classList.add('drag-below');
                            dragOverIdx = overIdx + 1;
                        }
                    }
                };

                const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    item.classList.remove('dragging');
                    playlistList.querySelectorAll('.drag-above, .drag-below').forEach(el => {
                        el.classList.remove('drag-above', 'drag-below');
                    });

                    if (dragFromIdx >= 0 && dragOverIdx >= 0 && dragFromIdx !== dragOverIdx) {
                        const [movedTrack] = tracks.splice(dragFromIdx, 1);
                        let targetIdx = dragOverIdx;
                        if (dragFromIdx < targetIdx) targetIdx--;
                        tracks.splice(targetIdx, 0, movedTrack);

                        if (currentIndex === dragFromIdx) {
                            currentIndex = targetIdx;
                        } else if (dragFromIdx < currentIndex && targetIdx >= currentIndex) {
                            currentIndex--;
                        } else if (dragFromIdx > currentIndex && targetIdx <= currentIndex) {
                            currentIndex++;
                        }
                        selectedIndices.clear();
                        renderPlaylist();
                        broadcastPlaylist();
                    }
                    dragFromIdx = -1;
                    dragOverIdx = -1;
                };

                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
                return;
            }

            // Selection via mousedown (more reliable than click for modifier keys on Windows)
            handleSelect(idx, e);
        });

        // Hover → highlight
        item.addEventListener('mouseenter', () => {
            item.style.background = 'rgba(255, 255, 255, 0.1)';
        });
        item.addEventListener('mouseleave', () => {
            item.style.background = '';
        });

        // Double click → play
        item.addEventListener('dblclick', (e) => {
            if (e.target.classList.contains('pl-rm')) return;
            if (e.target.classList.contains('pl-grip')) return;
            playTrack(idx);
        });

        playlistList.appendChild(item);
    });
}

function broadcastPlaylist() {
    window.gel.playlistUpdate({ count: tracks.length });
}

function cleanName(name) {
    return name.replace(/\.(mp3|wav|ogg|flac|aac|m4a|wma|opus|webm)$/i, '');
}

// ── Window drag ─────────────────────────────────────────────
initWindowDrag();

function initWindowDrag() {
    blobBody.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; // Left click only
        if (e.target.closest('button, input, .playlist-scroll')) return;

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
