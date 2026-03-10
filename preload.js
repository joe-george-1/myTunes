/**
 * preload.js — Exposes IPC channels via contextBridge.
 * Each window uses the same preload but calls different channels.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gel', {
    // ── Send to main process ──────────────────────────────
    addTracks: (tracks) => ipcRenderer.send('gel:addTracks', tracks),
    playTrack: (track) => ipcRenderer.send('gel:playTrack', track),
    directPlay: (track) => ipcRenderer.send('gel:directPlay', track),
    stop: () => ipcRenderer.send('gel:stop'),
    next: () => ipcRenderer.send('gel:next'),
    prev: () => ipcRenderer.send('gel:prev'),
    playerState: (state) => ipcRenderer.send('gel:playerState', state),
    trackEnded: () => ipcRenderer.send('gel:trackEnded'),
    browserNext: () => ipcRenderer.send('gel:browserNext'),
    browserPrev: () => ipcRenderer.send('gel:browserPrev'),
    vizData: (data) => ipcRenderer.send('gel:vizData', data),
    playlistUpdate: (data) => ipcRenderer.send('gel:playlistUpdate', data),

    // ── Window toggle ─────────────────────────────────────
    toggleWindow: (name) => ipcRenderer.send('gel:toggleWindow', name),
    closeWindow: () => ipcRenderer.send('gel:closeWindow'),
    openExternal: (url) => ipcRenderer.send('gel:openExternal', url),
    onWindowVisibility: (cb) => ipcRenderer.on('gel:windowVisibility', (_e, d) => cb(d)),

    // ── Filesystem ────────────────────────────────────────
    readDir: (dirPath) => ipcRenderer.invoke('gel:readDir', dirPath),
    readFile: (filePath) => ipcRenderer.invoke('gel:readFile', filePath),

    // ── Listen from main process ──────────────────────────
    onAddTracks: (cb) => ipcRenderer.on('gel:addTracks', (_e, d) => cb(d)),
    onPlayTrack: (cb) => ipcRenderer.on('gel:playTrack', (_e, d) => cb(d)),
    onStop: (cb) => ipcRenderer.on('gel:stop', () => cb()),
    onNext: (cb) => ipcRenderer.on('gel:next', () => cb()),
    onPrev: (cb) => ipcRenderer.on('gel:prev', () => cb()),
    onPlayerState: (cb) => ipcRenderer.on('gel:playerState', (_e, d) => cb(d)),
    onTrackEnded: (cb) => ipcRenderer.on('gel:trackEnded', () => cb()),
    onVizData: (cb) => ipcRenderer.on('gel:vizData', (_e, d) => cb(d)),
    onPlaylistUpdate: (cb) => ipcRenderer.on('gel:playlistUpdate', (_e, d) => cb(d)),
    onBrowserNext: (cb) => ipcRenderer.on('gel:browserNext', () => cb()),
    onBrowserPrev: (cb) => ipcRenderer.on('gel:browserPrev', () => cb()),
    onTrackEndedInBrowser: (cb) => ipcRenderer.on('gel:trackEnded', () => cb()),

    // ── Skins ────────────────────────────────────────────────
    listSkins: () => ipcRenderer.invoke('gel:listSkins'),
    loadSkin: (name) => ipcRenderer.invoke('gel:loadSkin', name),
    applySkin: (name) => ipcRenderer.send('gel:applySkin', name),
    onApplySkin: (cb) => ipcRenderer.on('gel:applySkin', (_e, name) => cb(name)),

    // ── Window dragging ───────────────────────────────────
    windowDrag: (dx, dy) => ipcRenderer.send('gel:windowDrag', { dx, dy })
});
