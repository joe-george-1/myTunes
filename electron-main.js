/**
 * electron-main.js — Spawns 4 frameless transparent windows, one per gel blob.
 * Routes IPC messages between windows for audio state sync.
 * Handles window toggling and filesystem browsing.
 */

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Window references
let playerWin, browserWin, playlistWin, visualizerWin;

// Audio file extensions we recognize
const AUDIO_EXTENSIONS = new Set([
    '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma', '.opus', '.webm'
]);

// Window configs — each blob has unique size and shape
// Extra 80px (40px padding each side) for skin casing artwork
const WINDOW_CONFIGS = {
    player: {
        width: 380,
        height: 530,
        file: 'windows/player.html',
        offset: { x: 60, y: 40 }
    },
    browser: {
        width: 400,
        height: 500,
        file: 'windows/browser.html',
        offset: { x: 30, y: 570 }
    },
    playlist: {
        width: 350,
        height: 560,
        file: 'windows/playlist.html',
        offset: { x: 480, y: 50 }
    },
    visualizer: {
        width: 440,
        height: 350,
        file: 'windows/visualizer.html',
        offset: { x: 460, y: 640 }
    }
};

function createWindow(name, config) {
    const { workArea } = screen.getPrimaryDisplay();

    const win = new BrowserWindow({
        width: config.width,
        height: config.height,
        x: workArea.x + config.offset.x,
        y: workArea.y + config.offset.y,
        transparent: true,
        frame: false,
        hasShadow: false,
        resizable: false,
        skipTaskbar: false,
        alwaysOnTop: false,
        backgroundColor: '#00000000',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    win.loadFile(config.file);

    if (process.argv.includes('--dev')) {
        win.webContents.openDevTools({ mode: 'detach' });
    }

    return win;
}

app.whenReady().then(() => {
    playerWin = createWindow('player', WINDOW_CONFIGS.player);
    browserWin = createWindow('browser', WINDOW_CONFIGS.browser);
    playlistWin = createWindow('playlist', WINDOW_CONFIGS.playlist);
    visualizerWin = createWindow('visualizer', WINDOW_CONFIGS.visualizer);

    // ── Window toggle visibility (from player) ────────────────

    const windowMap = {
        browser: browserWin,
        playlist: playlistWin,
        visualizer: visualizerWin
    };

    ipcMain.on('gel:toggleWindow', (_event, windowName) => {
        const win = windowMap[windowName];
        if (!win) return;
        if (win.isVisible()) {
            win.hide();
        } else {
            win.show();
        }
        // Send visibility state back to player
        playerWin?.webContents.send('gel:windowVisibility', {
            [windowName]: win.isVisible()
        });
    });

    // Close (hide) the calling window
    ipcMain.on('gel:closeWindow', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return;

        // If it's the player, quit the app
        if (win === playerWin) {
            app.quit();
            return;
        }

        win.hide();

        // Find which window this is and notify player of visibility change
        for (const [name, w] of Object.entries(windowMap)) {
            if (w === win) {
                playerWin?.webContents.send('gel:windowVisibility', {
                    [name]: false
                });
                break;
            }
        }
    });

    // Open external URL in system browser
    ipcMain.on('gel:openExternal', (_event, url) => {
        const { shell } = require('electron');
        shell.openExternal(url);
    });

    // Send initial visibility state to player once it's ready
    playerWin.webContents.once('did-finish-load', () => {
        playerWin.webContents.send('gel:windowVisibility', {
            browser: browserWin.isVisible(),
            playlist: playlistWin.isVisible(),
            visualizer: visualizerWin.isVisible()
        });
    });

    // ── Filesystem browsing (for browser window) ──────────────

    ipcMain.handle('gel:readDir', async (_event, dirPath) => {
        try {
            const resolvedPath = dirPath || os.homedir();
            const entries = await fs.promises.readdir(resolvedPath, { withFileTypes: true });
            const results = [];

            for (const entry of entries) {
                // Skip hidden files/dirs
                if (entry.name.startsWith('.')) continue;

                const fullPath = path.join(resolvedPath, entry.name);
                const isDir = entry.isDirectory();
                const ext = path.extname(entry.name).toLowerCase();
                const isAudio = AUDIO_EXTENSIONS.has(ext);

                // Show directories and audio files only
                if (isDir || isAudio) {
                    results.push({
                        name: entry.name,
                        path: fullPath,
                        isDir,
                        isAudio
                    });
                }
            }

            // Sort: directories first, then audio files, alphabetically within each
            results.sort((a, b) => {
                if (a.isDir && !b.isDir) return -1;
                if (!a.isDir && b.isDir) return 1;
                return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
            });

            return { path: resolvedPath, entries: results };
        } catch (err) {
            return { path: dirPath, entries: [], error: err.message };
        }
    });

    // Read an audio file as ArrayBuffer for IPC sending
    ipcMain.handle('gel:readFile', async (_event, filePath) => {
        try {
            const buffer = await fs.promises.readFile(filePath);
            const ext = path.extname(filePath).toLowerCase();
            const mimeMap = {
                '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
                '.flac': 'audio/flac', '.aac': 'audio/aac', '.m4a': 'audio/mp4',
                '.wma': 'audio/x-ms-wma', '.opus': 'audio/opus', '.webm': 'audio/webm'
            };
            return {
                name: path.basename(filePath),
                type: mimeMap[ext] || 'audio/mpeg',
                data: buffer.buffer
            };
        } catch (err) {
            return { error: err.message };
        }
    });

    // ── Existing IPC routing ──────────────────────────────────

    // Browser → Playlist: add tracks
    ipcMain.on('gel:addTracks', (_event, tracks) => {
        playlistWin?.webContents.send('gel:addTracks', tracks);
    });

    // Browser → Player: direct play (bypass playlist)
    ipcMain.on('gel:directPlay', (_event, track) => {
        playerWin?.webContents.send('gel:playTrack', track);
    });

    // Player → Browser: request next file in folder
    ipcMain.on('gel:browserNext', () => {
        browserWin?.webContents.send('gel:browserNext');
    });
    ipcMain.on('gel:browserPrev', () => {
        browserWin?.webContents.send('gel:browserPrev');
    });

    // Playlist → Player: play a track
    ipcMain.on('gel:playTrack', (_event, track) => {
        playerWin?.webContents.send('gel:playTrack', track);
    });

    // Playlist → Player: stop
    ipcMain.on('gel:stop', () => {
        playerWin?.webContents.send('gel:stop');
    });

    // Player → all: state updates
    ipcMain.on('gel:playerState', (_event, state) => {
        playlistWin?.webContents.send('gel:playerState', state);
        browserWin?.webContents.send('gel:playerState', state);
        visualizerWin?.webContents.send('gel:playerState', state);
    });

    // Player → Playlist + Browser: track ended
    ipcMain.on('gel:trackEnded', () => {
        playlistWin?.webContents.send('gel:trackEnded');
        browserWin?.webContents.send('gel:trackEnded');
    });

    // Player → Visualizer: frequency data
    ipcMain.on('gel:vizData', (_event, data) => {
        visualizerWin?.webContents.send('gel:vizData', data);
    });

    // Playlist: next/prev
    ipcMain.on('gel:next', () => {
        playlistWin?.webContents.send('gel:next');
    });
    ipcMain.on('gel:prev', () => {
        playlistWin?.webContents.send('gel:prev');
    });

    // Playlist → all: playlist update
    ipcMain.on('gel:playlistUpdate', (_event, data) => {
        browserWin?.webContents.send('gel:playlistUpdate', data);
        playerWin?.webContents.send('gel:playlistUpdate', data);
    });

    // Window drag
    ipcMain.on('gel:windowDrag', (event, { dx, dy }) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) {
            const [x, y] = win.getPosition();
            win.setPosition(x + dx, y + dy);
        }
    });

    // ── Screenshot export (F5) ──────────────────────────────────
    const { globalShortcut } = require('electron');

    globalShortcut.register('F5', async () => {
        const templateDir = path.join(__dirname, 'skins', 'templates');
        await fs.promises.mkdir(templateDir, { recursive: true });

        const windows = {
            player: playerWin,
            browser: browserWin,
            playlist: playlistWin,
            visualizer: visualizerWin
        };

        console.log('[Skin] Exporting templates to skins/templates/...');

        for (const [name, win] of Object.entries(windows)) {
            if (!win || win.isDestroyed()) continue;
            const config = WINDOW_CONFIGS[name];

            // 1. Capture WITH blob background (full preset)
            const imgFull = await win.webContents.capturePage();
            const fullPath = path.join(templateDir, `${name}-full.png`);
            await fs.promises.writeFile(fullPath, imgFull.toPNG());

            // 2. Inject CSS to hide blob background, capture skeleton
            await win.webContents.insertCSS(`
                .blob-body::before { background: transparent !important; box-shadow: none !important; }
                .gel-highlight { opacity: 0 !important; }
                .scanlines { opacity: 0 !important; }
            `);
            // Wait a frame for the CSS to take effect
            await new Promise(r => setTimeout(r, 100));
            const imgSkel = await win.webContents.capturePage();
            const skelPath = path.join(templateDir, `${name}-skeleton.png`);
            await fs.promises.writeFile(skelPath, imgSkel.toPNG());

            // 3. Restore — reload the page to remove injected CSS
            console.log(`[Skin] Exported: ${name}-full.png, ${name}-skeleton.png`);
        }

        // Reload all windows to restore blob backgrounds
        for (const win of Object.values(windows)) {
            if (win && !win.isDestroyed()) win.reload();
        }

        console.log('[Skin] Templates exported! Check skins/templates/');
    });

    // ── Skin system ─────────────────────────────────────────────

    // List available skins (each subfolder in skins/ is a skin)
    ipcMain.handle('gel:listSkins', async () => {
        const skinsDir = path.join(__dirname, 'skins');
        try {
            const entries = await fs.promises.readdir(skinsDir, { withFileTypes: true });
            const skins = entries
                .filter(e => e.isDirectory() && e.name !== 'templates')
                .map(e => e.name);
            return skins;
        } catch {
            return ['default'];
        }
    });

    // Load a skin — reads the manifest or just checks for PNGs
    ipcMain.handle('gel:loadSkin', async (_event, skinName) => {
        const skinDir = path.join(__dirname, 'skins', skinName);
        const windowNames = ['player', 'browser', 'playlist', 'visualizer'];
        const result = {};

        for (const name of windowNames) {
            const pngPath = path.join(skinDir, `${name}.png`);
            try {
                await fs.promises.access(pngPath);
                // Convert to data URL for CSS background-image
                const buf = await fs.promises.readFile(pngPath);
                result[name] = `data:image/png;base64,${buf.toString('base64')}`;
            } catch {
                result[name] = null; // No skin image, use CSS default
            }
        }

        return result;
    });

    // Apply skin to all windows
    ipcMain.on('gel:applySkin', (_event, skinName) => {
        const allWins = [playerWin, browserWin, playlistWin, visualizerWin];
        allWins.forEach(win => {
            if (win && !win.isDestroyed()) {
                win.webContents.send('gel:applySkin', skinName);
            }
        });
    });
});

app.on('window-all-closed', () => app.quit());

