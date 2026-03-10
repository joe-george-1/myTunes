/**
 * player.js — Audio engine using Web Audio API
 * Manages playback, seeking, volume, and exposes AnalyserNode for visualization
 */

class Player extends EventTarget {
    constructor() {
        super();
        this.audio = document.getElementById('audio-element');
        this.audioCtx = null;
        this.analyser = null;
        this.sourceNode = null;
        this.isPlaying = false;
        this.currentTrack = null;
        this.volume = 0.75;

        this.audio.volume = this.volume;

        // Bind update loop
        this._updateLoop = this._updateLoop.bind(this);
        this._onEnded = this._onEnded.bind(this);
        this.audio.addEventListener('ended', this._onEnded);
        this.audio.addEventListener('timeupdate', () => {
            this.dispatchEvent(new CustomEvent('timeupdate', {
                detail: { currentTime: this.audio.currentTime, duration: this.audio.duration }
            }));
        });
    }

    _initAudioContext() {
        if (this.audioCtx) return;
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.8;

        this.sourceNode = this.audioCtx.createMediaElementSource(this.audio);
        this.sourceNode.connect(this.analyser);
        this.analyser.connect(this.audioCtx.destination);
    }

    async loadTrack(fileOrUrl) {
        this._initAudioContext();

        if (fileOrUrl instanceof File) {
            const url = URL.createObjectURL(fileOrUrl);
            this.audio.src = url;
            this.currentTrack = { name: fileOrUrl.name, file: fileOrUrl, url };
        } else {
            this.audio.src = fileOrUrl;
            this.currentTrack = { name: fileOrUrl.split('/').pop(), url: fileOrUrl };
        }

        this.dispatchEvent(new CustomEvent('trackchange', { detail: this.currentTrack }));
    }

    async play() {
        this._initAudioContext();
        if (this.audioCtx.state === 'suspended') {
            await this.audioCtx.resume();
        }
        await this.audio.play();
        this.isPlaying = true;
        this.dispatchEvent(new Event('play'));
        this._updateLoop();
    }

    pause() {
        this.audio.pause();
        this.isPlaying = false;
        this.dispatchEvent(new Event('pause'));
    }

    stop() {
        this.audio.pause();
        this.audio.currentTime = 0;
        this.isPlaying = false;
        this.dispatchEvent(new Event('stop'));
    }

    togglePlay() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    seek(fraction) {
        if (!isNaN(this.audio.duration)) {
            this.audio.currentTime = fraction * this.audio.duration;
        }
    }

    setVolume(v) {
        this.volume = Math.max(0, Math.min(1, v));
        this.audio.volume = this.volume;
        this.dispatchEvent(new CustomEvent('volumechange', { detail: this.volume }));
    }

    getAnalyserData() {
        if (!this.analyser) return null;
        const data = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(data);
        return data;
    }

    getWaveformData() {
        if (!this.analyser) return null;
        const data = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteTimeDomainData(data);
        return data;
    }

    _updateLoop() {
        if (!this.isPlaying) return;
        this.dispatchEvent(new Event('frame'));
        requestAnimationFrame(this._updateLoop);
    }

    _onEnded() {
        this.isPlaying = false;
        this.dispatchEvent(new Event('ended'));
    }

    get currentTime() { return this.audio.currentTime; }
    get duration() { return this.audio.duration || 0; }
}

// Singleton
export const player = new Player();
