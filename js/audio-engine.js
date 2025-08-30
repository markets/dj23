class AudioEngine {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.decks = {
            A: null,
            B: null
        };
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) return;

        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.audioContext.createGain();
            this.masterGain.connect(this.audioContext.destination);
            this.masterGain.gain.value = 0.75;

            this.decks.A = new Deck(this.audioContext, this.masterGain, 'A');
            this.decks.B = new Deck(this.audioContext, this.masterGain, 'B');

            this.isInitialized = true;
        } catch (error) {
            console.error('Failed to initialize audio context:', error);
        }
    }

    async resumeContext() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    setMasterVolume(value) {
        if (this.masterGain) {
            this.masterGain.gain.value = value / 100;
        }
    }

    getDeck(deckId) {
        return this.decks[deckId];
    }
}

class Deck {
    constructor(audioContext, masterGain, deckId) {
        this.audioContext = audioContext;
        this.masterGain = masterGain;
        this.deckId = deckId;
        
        this.audioBuffer = null;
        this.source = null;
        this.gainNode = null;
        this.eqNodes = {};
        this.effectNodes = {};
        
        this.isPlaying = false;
        this.isPaused = false;
        this.startTime = 0;
        this.pauseTime = 0;
        this.playbackRate = 1;
        this.volume = 0.75;
        
        this.setupAudioNodes();
    }

    setupAudioNodes() {
        // Main gain node
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = this.volume;

        // EQ nodes
        this.eqNodes.high = this.audioContext.createBiquadFilter();
        this.eqNodes.high.type = 'highshelf';
        this.eqNodes.high.frequency.value = 8000;

        this.eqNodes.mid = this.audioContext.createBiquadFilter();
        this.eqNodes.mid.type = 'peaking';
        this.eqNodes.mid.frequency.value = 1000;
        this.eqNodes.mid.Q.value = 1;

        this.eqNodes.low = this.audioContext.createBiquadFilter();
        this.eqNodes.low.type = 'lowshelf';
        this.eqNodes.low.frequency.value = 200;

        // Effect nodes
        this.effectNodes.filter = this.audioContext.createBiquadFilter();
        this.effectNodes.filter.type = 'lowpass';
        this.effectNodes.filter.frequency.value = 20000;

        this.effectNodes.reverb = this.audioContext.createConvolver();
        this.effectNodes.reverbGain = this.audioContext.createGain();
        this.effectNodes.reverbGain.gain.value = 0;

        this.effectNodes.delay = this.audioContext.createDelay(1);
        this.effectNodes.delay.delayTime.value = 0.3;
        this.effectNodes.delayGain = this.audioContext.createGain();
        this.effectNodes.delayGain.gain.value = 0;
        this.effectNodes.delayFeedback = this.audioContext.createGain();
        this.effectNodes.delayFeedback.gain.value = 0.3;

        // Connect effect chain
        this.connectEffectChain();
        this.createReverbImpulse();
    }

    connectEffectChain() {
        // Connect delay feedback loop
        this.effectNodes.delay.connect(this.effectNodes.delayFeedback);
        this.effectNodes.delayFeedback.connect(this.effectNodes.delay);
        this.effectNodes.delay.connect(this.effectNodes.delayGain);

        // Main effect chain will be connected when source is created
    }

    createReverbImpulse() {
        const length = this.audioContext.sampleRate * 2;
        const impulse = this.audioContext.createBuffer(2, length, this.audioContext.sampleRate);
        
        for (let channel = 0; channel < 2; channel++) {
            const channelData = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
            }
        }
        
        this.effectNodes.reverb.buffer = impulse;
    }

    async loadFile(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            return true;
        } catch (error) {
            console.error('Error loading audio file:', error);
            return false;
        }
    }

    play() {
        if (!this.audioBuffer) return;

        this.stop();
        
        this.source = this.audioContext.createBufferSource();
        this.source.buffer = this.audioBuffer;
        this.source.playbackRate.value = this.playbackRate;

        // Connect the effect chain
        this.source.connect(this.effectNodes.filter);
        this.effectNodes.filter.connect(this.eqNodes.low);
        this.eqNodes.low.connect(this.eqNodes.mid);
        this.eqNodes.mid.connect(this.eqNodes.high);
        this.eqNodes.high.connect(this.gainNode);
        
        // Connect reverb send
        this.eqNodes.high.connect(this.effectNodes.reverb);
        this.effectNodes.reverb.connect(this.effectNodes.reverbGain);
        this.effectNodes.reverbGain.connect(this.gainNode);
        
        // Connect delay send
        this.eqNodes.high.connect(this.effectNodes.delay);
        this.effectNodes.delayGain.connect(this.gainNode);
        
        this.gainNode.connect(this.masterGain);

        const offset = this.isPaused ? this.pauseTime : 0;
        this.source.start(0, offset);
        this.startTime = this.audioContext.currentTime - offset;
        this.isPlaying = true;
        this.isPaused = false;
    }

    pause() {
        if (this.isPlaying && !this.isPaused) {
            this.pauseTime = this.audioContext.currentTime - this.startTime;
            this.stop();
            this.isPaused = true;
        }
    }

    stop() {
        if (this.source) {
            this.source.stop();
            this.source.disconnect();
            this.source = null;
        }
        this.isPlaying = false;
        this.isPaused = false;
        this.pauseTime = 0;
    }

    setVolume(value) {
        this.volume = value / 100;
        if (this.gainNode) {
            this.gainNode.gain.value = this.volume;
        }
    }

    setPitch(value) {
        this.playbackRate = 1 + (value / 100);
        if (this.source) {
            this.source.playbackRate.value = this.playbackRate;
        }
    }

    setEQ(band, value) {
        if (this.eqNodes[band]) {
            this.eqNodes[band].gain.value = value;
        }
    }

    setFilter(value) {
        if (this.effectNodes.filter) {
            const frequency = 20000 * (value / 100);
            this.effectNodes.filter.frequency.value = Math.max(20, frequency);
        }
    }

    setReverb(value) {
        if (this.effectNodes.reverbGain) {
            this.effectNodes.reverbGain.gain.value = value / 100;
        }
    }

    setDelay(value) {
        if (this.effectNodes.delayGain) {
            this.effectNodes.delayGain.gain.value = value / 100;
        }
    }

    getCurrentTime() {
        if (!this.isPlaying) return this.isPaused ? this.pauseTime : 0;
        return this.audioContext.currentTime - this.startTime;
    }

    getDuration() {
        return this.audioBuffer ? this.audioBuffer.duration : 0;
    }

    getBPM() {
        // Simplified BPM detection - in a real implementation, you'd use more sophisticated analysis
        if (!this.audioBuffer) return 0;
        return Math.floor(120 + Math.random() * 60); // Placeholder
    }

    getAnalyserData() {
        if (!this.source) return new Uint8Array(256);
        
        if (!this.analyser) {
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.gainNode.connect(this.analyser);
        }
        
        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(dataArray);
        return dataArray;
    }
}

// Global audio engine instance
window.audioEngine = new AudioEngine();