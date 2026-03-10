/**
 * browser-renderer.js — Real filesystem browser with multi-select.
 *
 * Interactions:
 *   - Click folder → navigate
 *   - Click audio row → select (visual only)
 *   - Shift+click → range select
 *   - Ctrl+click → toggle select
 *   - Ctrl+Shift+click → extend range
 *   - ＋ button → add all selected (or just that one) to playlist
 *   - Double-click audio → direct play in Player (bypass playlist)
 *   - Track ends → auto-play next in folder
 *   - Prev/Next from player → navigate in folder when playlist empty
 */

const fileListEl = document.getElementById('file-list');
const pathEl = document.getElementById('browser-path');
const btnBack = document.getElementById('btn-back');
const btnHome = document.getElementById('btn-home');
const btnPin = document.getElementById('btn-pin');
const searchInput = document.getElementById('browser-search');
const blobBody = document.querySelector('.blob-body');

let currentPath = null;
let historyStack = [];
let allEntries = [];           // all entries in current folder (dirs + audio)
let currentEntries = [];       // audio files only
let currentPlayingIndex = -1;
let directPlayActive = false;

// ── Selection state ─────────────────────────────────────────
let selectedIndices = new Set();  // indices into currentEntries (audio only)
let lastClickedIndex = -1;
let anchorIndex = -1;

// ── Pin state ───────────────────────────────────────────────
function getPinnedDir() {
    return localStorage.getItem('gel:pinnedDir');
}
function setPinnedDir(path) {
    localStorage.setItem('gel:pinnedDir', path);
}
function clearPinnedDir() {
    localStorage.removeItem('gel:pinnedDir');
}
function updatePinIcon() {
    const pinned = getPinnedDir();
    btnPin.textContent = (pinned && pinned === currentPath) ? '★' : '☆';
    btnPin.title = (pinned && pinned === currentPath) ? 'Unpin this folder' : 'Pin this folder as home';
}

// ── Initial load ────────────────────────────────────────────
(async () => {
    const pinned = getPinnedDir();
    if (pinned) {
        // Try the pinned directory first
        const pinnedResult = await window.gel.readDir(pinned);
        if (!pinnedResult.error) {
            navigate(pinned);
            return;
        }
    }
    // Fallback: try ~/Music, then ~
    const musicDir = await window.gel.readDir(null);
    const homePath = musicDir.path;
    const musicResult = await window.gel.readDir(homePath + '/Music');

    if (!musicResult.error && musicResult.entries.length > 0) {
        navigate(homePath + '/Music');
    } else {
        navigate(homePath);
    }
})();

// ── Pin button ──────────────────────────────────────────────
btnPin.addEventListener('click', (e) => {
    e.stopPropagation();
    const pinned = getPinnedDir();
    if (pinned === currentPath) {
        // Unpin
        clearPinnedDir();
    } else {
        // Pin current directory
        setPinnedDir(currentPath);
    }
    updatePinIcon();
});

// ── Navigation ──────────────────────────────────────────────
async function navigate(dirPath) {
    if (currentPath) {
        // Save scroll position before leaving this directory
        historyStack.push({ path: currentPath, scrollTop: fileListEl.scrollTop });
    }
    currentPath = dirPath;
    currentPlayingIndex = -1;
    selectedIndices.clear();
    lastClickedIndex = -1;
    anchorIndex = -1;
    await loadDirectory(dirPath);
    fileListEl.scrollTop = 0; // Start at top of new directory
    window.gel.nuclearFlush(); // Heavy reset for Linux skins
}

async function loadDirectory(dirPath) {
    fileListEl.innerHTML = '<div class="file-empty-state"><div class="empty-icon">⏳</div><div class="empty-text">Loading...</div></div>';
    const result = await window.gel.readDir(dirPath);
    if (result.error) {
        fileListEl.innerHTML = `<div class="file-empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${result.error}</div></div>`;
        return;
    }
    currentPath = result.path;
    allEntries = result.entries;
    currentEntries = result.entries.filter(e => e.isAudio);
    updatePathDisplay(result.path);
    searchInput.value = '';
    renderEntries(result.entries);
    updatePinIcon();
}

// ── Back / Home ─────────────────────────────────────────────
btnBack.addEventListener('click', async (e) => {
    e.stopPropagation();
    selectedIndices.clear();
    if (historyStack.length > 0) {
        const prev = historyStack.pop();
        currentPath = prev.path;
        currentPlayingIndex = -1;
        await loadDirectory(prev.path);
        // Restore scroll position to where user was
        fileListEl.scrollTop = prev.scrollTop || 0;
    } else {
        const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
        if (parent !== currentPath) {
            currentPath = parent;
            currentPlayingIndex = -1;
            await loadDirectory(parent);
        }
    }
});

btnHome.addEventListener('click', async (e) => {
    e.stopPropagation();
    historyStack = [];
    currentPlayingIndex = -1;
    selectedIndices.clear();
    const pinned = getPinnedDir();
    if (pinned) {
        navigate(pinned);
    } else {
        const result = await window.gel.readDir(null);
        navigate(result.path);
    }
});

// ── Path display ────────────────────────────────────────────
function updatePathDisplay(fullPath) {
    const home = fullPath.match(/^\/home\/[^/]+/)?.[0] || '';
    const display = home ? fullPath.replace(home, '~') : fullPath;
    const parts = display.split('/');
    pathEl.textContent = parts.length > 3 ? '…/' + parts.slice(-2).join('/') : display;
    pathEl.title = fullPath;
    window.gel.forceClearWindow(); // Fix muddy text on Linux
}

// ── Selection logic ─────────────────────────────────────────
function handleAudioSelect(audioIdx, e) {
    if (e.ctrlKey && e.shiftKey) {
        // Ctrl+Shift: extend range, additive
        if (anchorIndex >= 0) {
            const start = Math.min(anchorIndex, audioIdx);
            const end = Math.max(anchorIndex, audioIdx);
            for (let i = start; i <= end; i++) selectedIndices.add(i);
        } else {
            selectedIndices.add(audioIdx);
            anchorIndex = audioIdx;
        }
    } else if (e.shiftKey) {
        // Shift: range select, replace
        selectedIndices.clear();
        const from = anchorIndex >= 0 ? anchorIndex : 0;
        const start = Math.min(from, audioIdx);
        const end = Math.max(from, audioIdx);
        for (let i = start; i <= end; i++) selectedIndices.add(i);
    } else if (e.ctrlKey) {
        // Ctrl: toggle
        if (selectedIndices.has(audioIdx)) {
            selectedIndices.delete(audioIdx);
        } else {
            selectedIndices.add(audioIdx);
        }
        anchorIndex = audioIdx;
    } else {
        // Plain click: select only this
        selectedIndices.clear();
        selectedIndices.add(audioIdx);
        anchorIndex = audioIdx;
    }
    lastClickedIndex = audioIdx;
    updateSelectionUI();
    // Only clear if selecting a lot or toggling to avoid flicker
    if (e.shiftKey || e.ctrlKey) window.gel.forceClearWindow(); 
}

function updateSelectionUI() {
    const audioItems = fileListEl.querySelectorAll('.audio-item');
    let audioIdx = 0;
    audioItems.forEach(item => {
        const idx = parseInt(item.dataset.audioIdx);
        item.classList.toggle('selected', selectedIndices.has(idx));
    });
}

// ── Render entries ──────────────────────────────────────────
function renderEntries(entries) {
    fileListEl.innerHTML = '';
    if (entries.length === 0) {
        fileListEl.innerHTML = '<div class="file-empty-state"><div class="empty-icon">🔇</div><div class="empty-text">No audio files here</div></div>';
        return;
    }

    entries.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'file-item' + (entry.isDir ? ' dir-item' : ' audio-item');

        if (entry.isAudio) {
            const audioIdx = currentEntries.indexOf(entry);
            item.dataset.audioIdx = audioIdx;
            if (audioIdx === currentPlayingIndex) item.classList.add('now-playing');
            if (selectedIndices.has(audioIdx)) item.classList.add('selected');
        }

        const icon = entry.isDir ? '📁' : '🎵';
        item.innerHTML = `
          <span class="file-icon">${icon}</span>
          <span class="file-name">${entry.isDir ? entry.name : cleanName(entry.name)}</span>
          ${entry.isAudio ? '<span class="file-add" title="Add to playlist">＋</span>' : ''}
        `;

        if (entry.isDir) {
            item.addEventListener('click', () => navigate(entry.path));
        } else if (entry.isAudio) {
            const audioIdx = currentEntries.indexOf(entry);
            
            // Interaction stabilization for Linux
            item.addEventListener('mouseenter', () => {
                if (window.gel.isLinux) window.gel.forceClearWindow();
            });

            // ＋ button → add selected (or just this one) to playlist
            const addBtn = item.querySelector('.file-add');
            if (addBtn) {
                addBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (selectedIndices.has(audioIdx) && selectedIndices.size > 1) {
                        // Add all selected
                        await addMultipleToPlaylist([...selectedIndices].sort((a, b) => a - b));
                    } else {
                        // Add just this one
                        await addToPlaylist(entry.path, entry.name);
                        item.classList.add('added');
                        setTimeout(() => item.classList.remove('added'), 600);
                    }
                });
            }

            // Click → select
            item.addEventListener('click', (e) => {
                if (e.target.closest('.file-add')) return;
                handleAudioSelect(audioIdx, e);
            });

            // Double-click → direct play
            item.addEventListener('dblclick', async () => {
                currentPlayingIndex = audioIdx;
                directPlayActive = true;
                selectedIndices.clear();
                await directPlay(entry.path, entry.name);
                highlightPlaying();
            });
        }

        fileListEl.appendChild(item);
    });
}

function highlightPlaying() {
    fileListEl.querySelectorAll('.now-playing').forEach(el => el.classList.remove('now-playing'));
    if (currentPlayingIndex >= 0) {
        const item = fileListEl.querySelector(`.audio-item[data-audio-idx="${currentPlayingIndex}"]`);
        if (item) item.classList.add('now-playing');
    }
}

// ── Direct play → Player ────────────────────────────────────
async function directPlay(filePath, fileName) {
    const fileData = await window.gel.readFile(filePath);
    if (fileData.error) return;
    window.gel.directPlay({
        name: fileData.name,
        type: fileData.type,
        data: fileData.data
    });
}

// ── Add to playlist ─────────────────────────────────────────
async function addToPlaylist(filePath, fileName) {
    const fileData = await window.gel.readFile(filePath);
    if (fileData.error) return;
    window.gel.addTracks([{
        name: fileData.name,
        type: fileData.type,
        data: fileData.data,
        playImmediately: false
    }]);
}

async function addMultipleToPlaylist(audioIndices) {
    const tracksToAdd = [];
    for (const idx of audioIndices) {
        const entry = currentEntries[idx];
        if (!entry) continue;
        const fileData = await window.gel.readFile(entry.path);
        if (fileData.error) continue;
        tracksToAdd.push({
            name: fileData.name,
            type: fileData.type,
            data: fileData.data,
            playImmediately: false
        });
    }
    if (tracksToAdd.length > 0) {
        window.gel.addTracks(tracksToAdd);
        // Flash all selected items
        selectedIndices.forEach(idx => {
            const item = fileListEl.querySelector(`.audio-item[data-audio-idx="${idx}"]`);
            if (item) {
                item.classList.add('added');
                setTimeout(() => item.classList.remove('added'), 600);
            }
        });
    }
}

// ── Auto-advance on track end ───────────────────────────────
window.gel.onTrackEndedInBrowser(() => {
    if (!directPlayActive) return;
    if (currentEntries.length === 0) return;
    const nextIdx = currentPlayingIndex + 1;
    if (nextIdx < currentEntries.length) {
        currentPlayingIndex = nextIdx;
        directPlay(currentEntries[nextIdx].path, currentEntries[nextIdx].name);
        highlightPlaying();
    } else {
        directPlayActive = false;
        currentPlayingIndex = -1;
        highlightPlaying();
    }
});

// ── Prev/Next from player (forwarded from playlist when empty) ──
window.gel.onBrowserNext(() => {
    if (currentEntries.length === 0) return;
    directPlayActive = true;
    if (currentPlayingIndex < 0) {
        currentPlayingIndex = 0;
    } else if (currentPlayingIndex < currentEntries.length - 1) {
        currentPlayingIndex++;
    } else {
        return; // at end of folder
    }
    directPlay(currentEntries[currentPlayingIndex].path, currentEntries[currentPlayingIndex].name);
    highlightPlaying();
});

window.gel.onBrowserPrev(() => {
    if (currentEntries.length === 0) return;
    directPlayActive = true;
    if (currentPlayingIndex < 0) {
        currentPlayingIndex = currentEntries.length - 1;
    } else if (currentPlayingIndex > 0) {
        currentPlayingIndex--;
    } else {
        return; // at start of folder
    }
    directPlay(currentEntries[currentPlayingIndex].path, currentEntries[currentPlayingIndex].name);
    highlightPlaying();
});

// ── Search / filter ─────────────────────────────────────────
searchInput.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase().trim();
    const items = fileListEl.querySelectorAll('.file-item');
    let firstMatch = null;

    items.forEach(item => {
        const name = item.querySelector('.file-name')?.textContent.toLowerCase() || '';
        const matches = !query || name.includes(query);
        item.classList.toggle('search-hidden', !matches);
        if (matches && !firstMatch) firstMatch = item;
    });

    // Scroll first match into view
    if (firstMatch && query) {
        firstMatch.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
});

searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input'));
        searchInput.blur();
    }
});

// ── Helpers ─────────────────────────────────────────────────
function cleanName(name) {
    return name.replace(/\.(mp3|wav|ogg|flac|aac|m4a|wma|opus|webm)$/i, '');
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
        if (e.target.closest('button, input, .file-list-scroll, .browser-path')) return;

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
