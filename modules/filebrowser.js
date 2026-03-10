/**
 * filebrowser.js — File browser module
 * Supports drag-and-drop and file input
 */

import { playlist } from './playlist.js';

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma', '.opus', '.webm'];

let fileListEl, browseBtn, fileInput, folderInput, browserBlob;
let currentFiles = [];

export function initFileBrowser() {
    fileListEl = document.getElementById('file-list');
    browseBtn = document.getElementById('btn-browse');
    fileInput = document.getElementById('file-input');
    folderInput = document.getElementById('folder-input');
    browserBlob = document.getElementById('browser-blob');

    browseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.shiftKey) {
            folderInput.click();
        } else {
            fileInput.click();
        }
    });

    fileInput.addEventListener('change', (e) => {
        handleFiles(Array.from(e.target.files));
    });

    folderInput.addEventListener('change', (e) => {
        handleFiles(Array.from(e.target.files));
    });

    // Drag and drop on browser blob
    browserBlob.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        browserBlob.classList.add('drag-over');
        document.body.classList.add('file-dragging');
    });

    browserBlob.addEventListener('dragleave', (e) => {
        e.preventDefault();
        browserBlob.classList.remove('drag-over');
        document.body.classList.remove('file-dragging');
    });

    browserBlob.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        browserBlob.classList.remove('drag-over');
        document.body.classList.remove('file-dragging');

        const items = e.dataTransfer.items;
        if (items) {
            const files = [];
            for (let i = 0; i < items.length; i++) {
                if (items[i].kind === 'file') {
                    const file = items[i].getAsFile();
                    if (file && isAudioFile(file.name)) {
                        files.push(file);
                    }
                }
            }
            handleFiles(files);
        }
    });

    // Body drops
    document.body.addEventListener('dragover', (e) => {
        e.preventDefault();
        document.body.classList.add('file-dragging');
    });
    document.body.addEventListener('dragleave', (e) => {
        if (e.target === document.body || !document.body.contains(e.relatedTarget)) {
            document.body.classList.remove('file-dragging');
        }
    });
    document.body.addEventListener('drop', (e) => {
        e.preventDefault();
        document.body.classList.remove('file-dragging');
    });
}

function isAudioFile(name) {
    const lower = name.toLowerCase();
    return AUDIO_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function handleFiles(files) {
    const audioFiles = files.filter(f => isAudioFile(f.name));
    if (audioFiles.length === 0) return;
    currentFiles = audioFiles;
    renderFileList();
}

function renderFileList() {
    fileListEl.innerHTML = '';

    currentFiles.forEach((file, idx) => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = `
      <span class="file-icon">🎵</span>
      <span class="file-name">${cleanFileName(file.name)}</span>
    `;

        item.addEventListener('click', () => {
            playlist.addTrack(file);
            item.style.background = 'rgba(255, 255, 255, 0.15)';
            setTimeout(() => { item.style.background = ''; }, 300);
        });

        item.addEventListener('dblclick', () => {
            playlist.addTrack(file);
            playlist.playTrack(playlist.tracks.length - 1);
        });

        fileListEl.appendChild(item);
    });
}

function cleanFileName(name) {
    return name.replace(/\.(mp3|wav|ogg|flac|aac|m4a|wma|opus|webm)$/i, '');
}
