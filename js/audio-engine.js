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
    
    // Store original BPM for pitch-adjusted calculations
    this.baseBPM = 120; // Default BPM, will be updated when track loads
    
    // Scratching properties
    this.isScratching = false;
    this.originalPlaybackRate = 1;
    this.wasPlayingBeforeScratch = false;
    
    // CUE points
    this.cuePoints = { 1: null, 2: null };
    
    // Loop points
    this.loopStart = null;
    this.loopEnd = null;
    this.originalLoopEnd = null; // Store the original loop end point
    this.loopLengthPercentage = 100; // Current loop length as percentage
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

    // Initialize effects engine
    this.effectsEngine = new EffectsEngine(this.audioContext);
    // Merge effects engine nodes with our effect nodes
    Object.assign(this.effectNodes, this.effectsEngine.getEffectNodes());
  }

  async loadFile(file) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      // Calculate and store the base BPM
      this.baseBPM = this.calculateBPM();
      return true;
    } catch (error) {
      console.error('Error loading audio file:', error);
      return false;
    }
  }

  play() {
    if (!this.audioBuffer) return;

    // Store the pauseTime before stopping, since stop() will reset it
    const resumeTime = this.isPaused ? this.pauseTime : 0;
    
    this.stopSource(); // Use stopSource instead of stop() to preserve pause state
        
    this.source = this.audioContext.createBufferSource();
    this.source.buffer = this.audioBuffer;
    this.source.playbackRate.value = this.playbackRate;

    // Connect the main effect chain
    this.source.connect(this.effectNodes.filter);
    this.effectNodes.filter.connect(this.eqNodes.low);
    this.eqNodes.low.connect(this.eqNodes.mid);
    this.eqNodes.mid.connect(this.eqNodes.high);
    
    // Create a splitter for effect sends after EQ
    const splitter = this.audioContext.createChannelSplitter(2);
    const merger = this.audioContext.createChannelMerger(2);
    this.eqNodes.high.connect(splitter);
    
    // Main dry signal path
    this.eqNodes.high.connect(this.gainNode);
        
    // Connect reverb send (wet/dry mix)
    splitter.connect(this.effectNodes.reverb);
    this.effectNodes.reverb.connect(this.effectNodes.reverbGain);
    this.effectNodes.reverbGain.connect(this.gainNode);
        
    // Connect delay send
    splitter.connect(this.effectNodes.delay);
    this.effectNodes.delayGain.connect(this.gainNode);
    
    // Connect phaser effect chain
    if (this.effectNodes.phaser && this.effectNodes.phaser.length > 0) {
      let phaserInput = splitter;
      
      // Connect phaser chain
      for (let i = 0; i < this.effectNodes.phaser.length; i++) {
        phaserInput.connect(this.effectNodes.phaser[i]);
        phaserInput = this.effectNodes.phaser[i];
      }
      
      // Connect LFO to modulate phaser frequencies through gain node
      if (this.effectNodes.phaserLFOGain) {
        for (let i = 0; i < this.effectNodes.phaser.length; i++) {
          this.effectNodes.phaserLFOGain.connect(this.effectNodes.phaser[i].frequency);
        }
      }
      
      // Connect phaser output through gain control
      phaserInput.connect(this.effectNodes.phaserGain);
      this.effectNodes.phaserGain.connect(this.gainNode);
    }
    
    // Connect flanger effect
    if (this.effectNodes.flanger) {
      splitter.connect(this.effectNodes.flanger);
      this.effectNodes.flanger.connect(this.effectNodes.flangerGain);
      this.effectNodes.flangerGain.connect(this.gainNode);
      
      // LFO connection is already set up in connectEffectChain
    }
        
    this.gainNode.connect(this.masterGain);

    // Start from the saved resume time
    this.source.start(0, resumeTime);
    this.startTime = this.audioContext.currentTime - resumeTime;
    this.isPlaying = true;
    this.isPaused = false;
  }

  pause() {
    if (this.isPlaying && !this.isPaused) {
      this.pauseTime = this.audioContext.currentTime - this.startTime;
      this.stopSource(); // Use helper method that doesn't reset pauseTime
      this.isPlaying = false;
      this.isPaused = true;
    }
  }

  stop() {
    this.stopSource();
    this.isPlaying = false;
    this.isPaused = false;
    this.pauseTime = 0;
  }

  stopSource() {
    if (this.source) {
      this.source.stop();
      this.source.disconnect();
      this.source = null;
    }
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
    if (this.effectsEngine) {
      this.effectsEngine.setReverb(value);
    }
  }

  setDelay(value) {
    if (this.effectsEngine) {
      this.effectsEngine.setDelay(value);
    }
  }

  setPhaser(value) {
    if (this.effectsEngine) {
      this.effectsEngine.setPhaser(value);
    }
  }

  setFlanger(value) {
    if (this.effectsEngine) {
      this.effectsEngine.setFlanger(value);
    }
  }

  getCurrentTime() {
    if (!this.isPlaying) return this.isPaused ? this.pauseTime : 0;
    return this.audioContext.currentTime - this.startTime;
  }

  seek(time) {
    if (!this.audioBuffer) {
      console.log(`Deck ${this.deckId}: Cannot seek - no audio buffer loaded`);
      return;
    }
    
    const wasPlaying = this.isPlaying;
    const duration = this.getDuration();
    
    // Clamp time to valid range
    time = Math.max(0, Math.min(time, duration));
    
    console.log(`Deck ${this.deckId}: Seeking to ${time.toFixed(2)}s (duration: ${duration.toFixed(2)}s, was playing: ${wasPlaying})`);
    
    if (wasPlaying) {
      this.stop();
      this.pauseTime = time;
      this.isPaused = true;
      this.play();
    } else {
      this.pauseTime = time;
      this.isPaused = true;
    }
    
    console.log(`Deck ${this.deckId}: Seek completed - current time: ${this.getCurrentTime().toFixed(2)}s`);
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

  // Main CUE function - prioritizes cue1 or goes to start
  cue() {
    // If playing, pause and return to cue1 or beginning
    if (this.isPlaying) {
      this.pause();
      // Prioritize cue1, fallback to beginning
      const cueTime = this.cuePoints[1] !== null ? this.cuePoints[1] : 0;
      this.seek(cueTime);
      console.log(`Deck ${this.deckId}: CUE - returned to ${cueTime}s`);
    } else {
      // If paused, go to cue1 or beginning
      const cueTime = this.cuePoints[1] !== null ? this.cuePoints[1] : 0;
      this.seek(cueTime);
      console.log(`Deck ${this.deckId}: CUE - moved to ${cueTime}s`);
    }
  }

  // Loop methods
  setLoopIn() {
    this.loopStart = this.getCurrentTime();
    console.log(`Deck ${this.deckId}: Loop IN set at ${this.loopStart}s`);
  }

  setLoopOut() {
    this.loopEnd = this.getCurrentTime();
    this.originalLoopEnd = this.loopEnd; // Store original loop end
    this.loopLengthPercentage = 100; // Reset to 100% when setting new loop out
    console.log(`Deck ${this.deckId}: Loop OUT set at ${this.loopEnd}s`);
  }

  setLoopLength(percentage) {
    if (this.loopStart !== null && this.originalLoopEnd !== null) {
      this.loopLengthPercentage = percentage;
      const loopDuration = this.originalLoopEnd - this.loopStart;
      const adjustedLoopDuration = loopDuration * (percentage / 100);
      this.loopEnd = this.loopStart + adjustedLoopDuration;
      console.log(`Deck ${this.deckId}: Loop length set to ${percentage}% (${this.loopEnd}s)`);
    }
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
    // Return the current BPM adjusted for pitch changes
    return Math.round(this.baseBPM * this.playbackRate);
  }

  getBaseBPM() {
    // Return the original BPM without pitch adjustments
    return this.baseBPM;
  }

  calculateBPM() {
    // Simplified BPM detection - in a real implementation, you'd use more sophisticated analysis
    if (!this.audioBuffer) return 120;
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