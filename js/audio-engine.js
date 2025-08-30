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
    
    // Scratching properties
    this.isScratching = false;
    this.originalPlaybackRate = 1;
    this.wasPlayingBeforeScratch = false;
    
    // CUE points
    this.cuePoints = { 1: null, 2: null };
    
    // Loop points
    this.loopStart = null;
    this.loopEnd = null;
    this.isLooping = false;
    this.loopCheckInterval = null;
        
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

    // Phaser effect (using multiple allpass filters)
    this.effectNodes.phaser = [];
    this.effectNodes.phaserLFO = this.audioContext.createOscillator();
    this.effectNodes.phaserLFO.type = 'sine';
    this.effectNodes.phaserLFO.frequency.value = 0.5;
    this.effectNodes.phaserGain = this.audioContext.createGain();
    this.effectNodes.phaserGain.gain.value = 0;
    this.effectNodes.phaserDry = this.audioContext.createGain();
    this.effectNodes.phaserDry.gain.value = 1;
    
    // Create 6 allpass filters for phaser
    for (let i = 0; i < 6; i++) {
      this.effectNodes.phaser[i] = this.audioContext.createBiquadFilter();
      this.effectNodes.phaser[i].type = 'allpass';
      this.effectNodes.phaser[i].frequency.value = 1000 + (i * 300);
      this.effectNodes.phaser[i].Q.value = 10;
    }
    
    // Flanger effect (short delay with feedback)
    this.effectNodes.flanger = this.audioContext.createDelay(0.02);
    this.effectNodes.flanger.delayTime.value = 0.005;
    this.effectNodes.flangerLFO = this.audioContext.createOscillator();
    this.effectNodes.flangerLFO.type = 'sine';
    this.effectNodes.flangerLFO.frequency.value = 0.25;
    this.effectNodes.flangerGain = this.audioContext.createGain();
    this.effectNodes.flangerGain.gain.value = 0;
    this.effectNodes.flangerFeedback = this.audioContext.createGain();
    this.effectNodes.flangerFeedback.gain.value = 0.7;
    this.effectNodes.flangerDry = this.audioContext.createGain();
    this.effectNodes.flangerDry.gain.value = 1;

    // Connect effect chain
    this.connectEffectChain();
    this.createReverbImpulse();
    this.startEffectOscillators();
  }

  connectEffectChain() {
    // Connect delay feedback loop
    this.effectNodes.delay.connect(this.effectNodes.delayFeedback);
    this.effectNodes.delayFeedback.connect(this.effectNodes.delay);
    this.effectNodes.delay.connect(this.effectNodes.delayGain);

    // Connect phaser chain
    for (let i = 0; i < this.effectNodes.phaser.length; i++) {
      if (i === 0) {
        // First filter connects from source (will be connected in play method)
      } else {
        this.effectNodes.phaser[i - 1].connect(this.effectNodes.phaser[i]);
      }
    }
    
    // Connect flanger feedback loop
    this.effectNodes.flanger.connect(this.effectNodes.flangerFeedback);
    this.effectNodes.flangerFeedback.connect(this.effectNodes.flanger);

    // Main effect chain will be connected when source is created
  }

  startEffectOscillators() {
    try {
      this.effectNodes.phaserLFO.start();
      this.effectNodes.flangerLFO.start();
    } catch (e) {
      // Oscillators may already be started
      console.log('Effect oscillators already started or failed to start');
    }
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

  setPhaser(value) {
    if (this.effectNodes.phaserGain) {
      this.effectNodes.phaserGain.gain.value = value / 100;
      this.effectNodes.phaserDry.gain.value = 1 - (value / 100);
    }
  }

  setFlanger(value) {
    if (this.effectNodes.flangerGain) {
      this.effectNodes.flangerGain.gain.value = value / 100;
      this.effectNodes.flangerDry.gain.value = 1 - (value / 100);
    }
  }

  getCurrentTime() {
    if (!this.isPlaying) return this.isPaused ? this.pauseTime : 0;
    return this.audioContext.currentTime - this.startTime;
  }

  seek(time) {
    if (!this.audioBuffer) return;
    
    const wasPlaying = this.isPlaying;
    const duration = this.getDuration();
    
    // Clamp time to valid range
    time = Math.max(0, Math.min(time, duration));
    
    if (wasPlaying) {
      this.stop();
      this.pauseTime = time;
      this.isPaused = true;
      this.play();
    } else {
      this.pauseTime = time;
      this.isPaused = true;
    }
  }

  // CUE point methods
  setCuePoint(cueNumber) {
    if (cueNumber === 1 || cueNumber === 2) {
      this.cuePoints[cueNumber] = this.getCurrentTime();
      console.log(`Deck ${this.deckId}: CUE ${cueNumber} set at ${this.cuePoints[cueNumber]}s`);
    }
  }

  jumpToCue(cueNumber) {
    if (this.cuePoints[cueNumber] !== null) {
      this.seek(this.cuePoints[cueNumber]);
      console.log(`Deck ${this.deckId}: Jumped to CUE ${cueNumber} at ${this.cuePoints[cueNumber]}s`);
    }
  }

  // Loop methods
  setLoopIn() {
    this.loopStart = this.getCurrentTime();
    console.log(`Deck ${this.deckId}: Loop IN set at ${this.loopStart}s`);
  }

  setLoopOut() {
    this.loopEnd = this.getCurrentTime();
    console.log(`Deck ${this.deckId}: Loop OUT set at ${this.loopEnd}s`);
  }

  toggleLoop() {
    if (this.loopStart !== null && this.loopEnd !== null) {
      this.isLooping = !this.isLooping;
      
      if (this.isLooping) {
        this.startLoopMonitoring();
        console.log(`Deck ${this.deckId}: Loop enabled`);
      } else {
        this.stopLoopMonitoring();
        console.log(`Deck ${this.deckId}: Loop disabled`);
      }
    } else {
      console.log(`Deck ${this.deckId}: Cannot loop - loop points not set`);
    }
  }

  startLoopMonitoring() {
    if (this.loopCheckInterval) clearInterval(this.loopCheckInterval);
    
    this.loopCheckInterval = setInterval(() => {
      if (this.isLooping && this.isPlaying) {
        const currentTime = this.getCurrentTime();
        if (currentTime >= this.loopEnd) {
          this.seek(this.loopStart);
        }
      }
    }, 10); // Check every 10ms for smooth looping
  }

  stopLoopMonitoring() {
    if (this.loopCheckInterval) {
      clearInterval(this.loopCheckInterval);
      this.loopCheckInterval = null;
    }
  }

  // Scratching functionality
  startScratch() {
    this.isScratching = true;
    this.originalPlaybackRate = this.playbackRate;
    if (this.isPlaying) {
      this.wasPlayingBeforeScratch = true;
    }
  }

  scratch(speed) {
    if (!this.isScratching || !this.source) return;
    
    // Convert scratch speed to playback rate
    // Speed is typically between -10 and 10, map to playback rate
    const scratchRate = Math.max(-4, Math.min(4, speed));
    
    if (this.source.playbackRate) {
      this.source.playbackRate.value = this.originalPlaybackRate + scratchRate;
    }
  }

  stopScratch() {
    this.isScratching = false;
    if (this.source && this.source.playbackRate) {
      this.source.playbackRate.value = this.originalPlaybackRate || this.playbackRate;
    }
    this.wasPlayingBeforeScratch = false;
  }

  // Pitch bend methods
  pitchBend(direction) {
    const bendAmount = direction > 0 ? 0.5 : -0.5; // +/- 0.5% pitch bend
    const currentPitch = ((this.playbackRate - 1) * 100);
    const newPitch = Math.max(-50, Math.min(50, currentPitch + bendAmount));
    this.setPitch(newPitch);
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