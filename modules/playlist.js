/**
 * playlist.js — Playlist management with shuffle/repeat
 */

import { player } from './player.js';

class Playlist extends EventTarget {
    constructor() {
        super();
        this.tracks = [];       // Array of File objects
        this.currentIndex = -1;
        this.shuffle = false;
        this.repeat = false;    // false = off, true = repeat all
        this.shuffleOrder = [];
        this.shufflePos = -1;

        // Listen for track end to auto-advance
        player.addEventListener('ended', () => this.next());
    }

    addTrack(file) {
        // Avoid duplicates by name
        if (this.tracks.some(t => t.name === file.name)) return;

        this.tracks.push(file);
        this._rebuildShuffle();
        this.dispatchEvent(new Event('change'));
    }

    removeTrack(index) {
        if (index < 0 || index >= this.tracks.length) return;

        const wasCurrent = index === this.currentIndex;
        this.tracks.splice(index, 1);

        if (wasCurrent) {
            if (this.tracks.length > 0) {
                this.currentIndex = Math.min(this.currentIndex, this.tracks.length - 1);
                this.playTrack(this.currentIndex);
            } else {
                this.currentIndex = -1;
                player.stop();
            }
        } else if (index < this.currentIndex) {
            this.currentIndex--;
        }

        this._rebuildShuffle();
        this.dispatchEvent(new Event('change'));
    }

    clear() {
        this.tracks = [];
        this.currentIndex = -1;
        this.shuffleOrder = [];
        this.shufflePos = -1;
        player.stop();
        this.dispatchEvent(new Event('change'));
    }

    async playTrack(index) {
        if (index < 0 || index >= this.tracks.length) return;
        this.currentIndex = index;
        await player.loadTrack(this.tracks[index]);
        await player.play();
        this.dispatchEvent(new Event('change'));
    }

    async next() {
        if (this.tracks.length === 0) return;

        if (this.shuffle) {
            this.shufflePos++;
            if (this.shufflePos >= this.shuffleOrder.length) {
                if (this.repeat) {
                    this._rebuildShuffle();
                    this.shufflePos = 0;
                } else {
                    player.stop();
                    return;
                }
            }
            await this.playTrack(this.shuffleOrder[this.shufflePos]);
        } else {
            let nextIdx = this.currentIndex + 1;
            if (nextIdx >= this.tracks.length) {
                if (this.repeat) {
                    nextIdx = 0;
                } else {
                    player.stop();
                    return;
                }
            }
            await this.playTrack(nextIdx);
        }
    }

    async prev() {
        if (this.tracks.length === 0) return;

        // If more than 3 seconds in, restart current track
        if (player.currentTime > 3) {
            player.seek(0);
            return;
        }

        if (this.shuffle) {
            this.shufflePos = Math.max(0, this.shufflePos - 1);
            await this.playTrack(this.shuffleOrder[this.shufflePos]);
        } else {
            let prevIdx = this.currentIndex - 1;
            if (prevIdx < 0) prevIdx = this.repeat ? this.tracks.length - 1 : 0;
            await this.playTrack(prevIdx);
        }
    }

    toggleShuffle() {
        this.shuffle = !this.shuffle;
        if (this.shuffle) this._rebuildShuffle();
        this.dispatchEvent(new Event('modechange'));
    }

    toggleRepeat() {
        this.repeat = !this.repeat;
        this.dispatchEvent(new Event('modechange'));
    }

    _rebuildShuffle() {
        this.shuffleOrder = [...Array(this.tracks.length).keys()];
        // Fisher-Yates
        for (let i = this.shuffleOrder.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.shuffleOrder[i], this.shuffleOrder[j]] = [this.shuffleOrder[j], this.shuffleOrder[i]];
        }
        this.shufflePos = -1;
    }
}

export const playlist = new Playlist();
