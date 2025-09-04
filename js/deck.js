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
    
    // Beat tracking properties
    this.beatPositions = []; // Array of beat positions in seconds
    this.lastBeatTime = 0;   // Time of the last detected beat
    this.beatInterval = 0.5; // Current beat interval in seconds (will be calculated)
    
    // Continuous BPM analysis
    this.bpmAnalysisHistory = []; // Store BPM readings over time
    this.lastBpmAnalysisTime = 0;
    this.bpmAnalysisInterval = 5; // Analyze BPM every 5 seconds during playback

    // Scratching properties
    this.isScratching = false;
    this.originalPlaybackRate = 1;
    this.wasPlayingBeforeScratch = false;
    this.scratchMomentum = 0;
    this.currentScratchRate = 0;
    this.lastScratchInput = 0;
    this.lastScratchTime = 0;
    this.scratchDecelerationInterval = null;

    // Pitch bend properties
    this.isPitchBending = false;
    this.originalPitchBeforeBend = undefined;

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
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = this.volume;

    this.globalGainNode = this.audioContext.createGain();
    this.globalGainNode.gain.value = 1.0;

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

    this.effectNodes.filter = this.audioContext.createBiquadFilter();
    this.effectNodes.filter.type = 'lowpass';
    this.effectNodes.filter.frequency.value = 20000;

    this.effectNodes.reverb = this.audioContext.createConvolver();
    this.effectNodes.reverbGain = this.audioContext.createGain();
    this.effectNodes.reverbGain.gain.value = 0;

    this.effectsEngine = new EffectsEngine(this.audioContext);
    Object.assign(this.effectNodes, this.effectsEngine.getEffectNodes());
  }

  async loadFile(file) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.baseBPM = this.calculateBPM();
      this.generateBeatMap();
      return true;
    } catch (error) {
      console.error('Error loading audio file:', error);
      return false;
    }
  }

  generateBeatMap() {
    if (!this.audioBuffer || this.baseBPM <= 0) return;
    
    // Calculate beat interval from BPM
    this.beatInterval = 60 / this.baseBPM;
    
    // Generate beat positions throughout the track
    this.beatPositions = [];
    const duration = this.audioBuffer.duration;
    
    // Start from the first beat (we assume it starts on beat 1)
    for (let time = 0; time < duration; time += this.beatInterval) {
      this.beatPositions.push(time);
    }
    
    console.log(`Generated ${this.beatPositions.length} beats for ${duration.toFixed(2)}s track at ${this.baseBPM} BPM`);
  }

  // Find the nearest beat position to the current time
  findNearestBeat(currentTime) {
    if (this.beatPositions.length === 0) return currentTime;
    
    let nearestBeat = this.beatPositions[0];
    let minDistance = Math.abs(currentTime - nearestBeat);
    
    for (const beatTime of this.beatPositions) {
      const distance = Math.abs(currentTime - beatTime);
      if (distance < minDistance) {
        minDistance = distance;
        nearestBeat = beatTime;
      }
    }
    
    return nearestBeat;
  }

  // Get the next beat after current time
  getNextBeat(currentTime) {
    for (const beatTime of this.beatPositions) {
      if (beatTime > currentTime) {
        return beatTime;
      }
    }
    return currentTime; // If no next beat found, return current time
  }

  // Continuously refine BPM during playback (only for first 10 seconds)
  refineBPMDuringPlayback() {
    if (!this.isPlaying || !this.audioBuffer) return;
    
    const currentTime = this.getCurrentTime();
    
    // Only refine BPM for the first 10 seconds of the track
    if (currentTime > 10) return;
    
    // Only analyze every few seconds to avoid performance issues
    if (currentTime - this.lastBpmAnalysisTime >= this.bpmAnalysisInterval) {
      this.lastBpmAnalysisTime = currentTime;
      
      // Analyze a small window around current position
      const analysisWindow = 10; // 10 seconds
      const startTime = Math.max(0, currentTime - analysisWindow / 2);
      const endTime = Math.min(this.audioBuffer.duration, currentTime + analysisWindow / 2);
      
      const sampleRate = this.audioBuffer.sampleRate;
      const startSample = Math.floor(startTime * sampleRate);
      const endSample = Math.floor(endTime * sampleRate);
      
      const audioData = this.audioBuffer.getChannelData(0);
      const windowData = audioData.slice(startSample, endSample);
      
      if (windowData.length > sampleRate) { // Need at least 1 second of data
        const refinedBPM = this.detectBPMFromAudio(windowData, sampleRate);
        
        // Add to history
        this.bpmAnalysisHistory.push({
          time: currentTime,
          bpm: refinedBPM
        });
        
        // Keep only recent history (last 1 minute)
        this.bpmAnalysisHistory = this.bpmAnalysisHistory.filter(
          entry => currentTime - entry.time <= 60
        );
        
        // Update BPM if we have enough data and there's a consistent change
        if (this.bpmAnalysisHistory.length >= 3) {
          const recentBPMs = this.bpmAnalysisHistory.slice(-3).map(entry => entry.bpm);
          const avgRecentBPM = recentBPMs.reduce((sum, bpm) => sum + bpm, 0) / recentBPMs.length;
          
          // If the recent average differs significantly from current baseBPM, update it
          if (Math.abs(avgRecentBPM - this.baseBPM) > 2) {
            console.log(`Refining BPM for deck ${this.deckId}: ${this.baseBPM} -> ${avgRecentBPM.toFixed(1)}`);
            this.baseBPM = avgRecentBPM;
            this.generateBeatMap(); // Regenerate beat map with new BPM
          }
        }
      }
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
    this.eqNodes.high.connect(this.globalGainNode);
    this.globalGainNode.connect(this.gainNode);

    // Connect reverb send (wet/dry mix)
    splitter.connect(this.effectNodes.reverb);
    this.effectNodes.reverb.connect(this.effectNodes.reverbGain);
    this.effectNodes.reverbGain.connect(this.globalGainNode);

    // Connect delay send
    splitter.connect(this.effectNodes.delay);
    this.effectNodes.delayGain.connect(this.globalGainNode);

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
      this.effectNodes.phaserGain.connect(this.globalGainNode);
    }

    // Connect flanger effect
    if (this.effectNodes.flanger) {
      splitter.connect(this.effectNodes.flanger);
      this.effectNodes.flanger.connect(this.effectNodes.flangerGain);
      this.effectNodes.flangerGain.connect(this.globalGainNode);

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
    
    // Clean up scratch deceleration if active
    if (this.scratchDecelerationInterval) {
      clearInterval(this.scratchDecelerationInterval);
      this.scratchDecelerationInterval = null;
    }
    this.currentScratchRate = 0;
    this.scratchMomentum = 0;
  }

  stopSource() {
    if (this.source) {
      this.source.stop();
      this.source.disconnect();
      this.source = null;
    }
    
    // Also clean up scratch deceleration when source is stopped
    if (this.scratchDecelerationInterval) {
      clearInterval(this.scratchDecelerationInterval);
      this.scratchDecelerationInterval = null;
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
    if (band === 'gain') {
      // Handle global gain - convert dB to linear gain
      if (this.globalGainNode) {
        const gainValue = Math.pow(10, value / 20);
        this.globalGainNode.gain.value = gainValue;
      }
    } else if (this.eqNodes[band]) {
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
  resetCuePoints() {
    this.cuePoints = { 1: null, 2: null };
    console.log(`Deck ${this.deckId}: CUE points reset`);
  }

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

  // Main CUE function - returns to last cue point or beginning
  cue() {
    // If playing, pause and return to last cue point
    if (this.isPlaying) {
      this.pause();
      // Find the most recently set cue point
      let lastCueTime = null;
      for (let i = 1; i <= 2; i++) {
        if (this.cuePoints[i] !== null) {
          lastCueTime = this.cuePoints[i];
        }
      }
      // Go to last cue point or beginning
      const cueTime = lastCueTime !== null ? lastCueTime : 0;
      this.seek(cueTime);
      console.log(`Deck ${this.deckId}: CUE - returned to ${cueTime}s`);
    } else {
      // If paused, just go to beginning or last cue point
      let lastCueTime = null;
      for (let i = 1; i <= 2; i++) {
        if (this.cuePoints[i] !== null) {
          lastCueTime = this.cuePoints[i];
        }
      }
      const cueTime = lastCueTime !== null ? lastCueTime : 0;
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
    
    // Initialize scratch properties
    this.scratchMomentum = 0;
    this.currentScratchRate = 0;
    this.lastScratchTime = Date.now();
    
    // Stop any existing deceleration
    if (this.scratchDecelerationInterval) {
      clearInterval(this.scratchDecelerationInterval);
      this.scratchDecelerationInterval = null;
    }
  }

  scratch(speed) {
    if (!this.isScratching || !this.source) return;

    const currentTime = Date.now();
    const deltaTime = Math.max(currentTime - this.lastScratchTime, 1); // Minimum 1ms to avoid division by zero
    this.lastScratchTime = currentTime;
    
    // Store the raw input for momentum calculation
    this.lastScratchInput = speed;
    
    // Apply a more realistic speed curve - exponential for better feel
    let mappedSpeed = speed;
    if (Math.abs(speed) > 0.1) {
      const sign = Math.sign(speed);
      const absSpeed = Math.abs(speed);
      // Use a power curve for more natural feel at different speeds
      mappedSpeed = sign * Math.pow(absSpeed / 10, 0.7) * 8;
    }
    
    // Apply momentum and interpolation for smoother transitions
    const momentumFactor = 0.15; // How much momentum to apply
    const interpolationFactor = Math.min(deltaTime / 16, 1); // Smooth interpolation based on time (16ms = 60fps)
    
    // Calculate target scratch rate with momentum
    const targetRate = mappedSpeed + (this.scratchMomentum * momentumFactor);
    
    // Smooth interpolation towards target rate
    this.currentScratchRate += (targetRate - this.currentScratchRate) * interpolationFactor * 0.3;
    
    // Update momentum based on current input
    this.scratchMomentum += (speed - this.scratchMomentum) * 0.2;
    
    // Clamp the final rate to prevent extreme values
    const finalRate = Math.max(-5, Math.min(5, this.currentScratchRate));

    if (this.source.playbackRate) {
      this.source.playbackRate.value = this.originalPlaybackRate + finalRate;
    }
  }

  stopScratch() {
    this.isScratching = false;
    
    // Start realistic deceleration instead of instant stop
    this.startScratchDeceleration();
    
    this.wasPlayingBeforeScratch = false;
  }
  
  startScratchDeceleration() {
    // Clear any existing deceleration
    if (this.scratchDecelerationInterval) {
      clearInterval(this.scratchDecelerationInterval);
    }
    
    // Start deceleration process
    const decelerationRate = 0.85; // How quickly it slows down (0.8 = 20% reduction per frame)
    const minSpeed = 0.01; // Minimum speed threshold before stopping
    
    this.scratchDecelerationInterval = setInterval(() => {
      if (!this.source || !this.source.playbackRate) {
        clearInterval(this.scratchDecelerationInterval);
        this.scratchDecelerationInterval = null;
        return;
      }
      
      // Apply deceleration to current scratch rate and momentum
      this.currentScratchRate *= decelerationRate;
      this.scratchMomentum *= decelerationRate;
      
      // If speed is very low, stop the deceleration
      if (Math.abs(this.currentScratchRate) < minSpeed) {
        this.source.playbackRate.value = this.originalPlaybackRate || this.playbackRate;
        this.currentScratchRate = 0;
        this.scratchMomentum = 0;
        clearInterval(this.scratchDecelerationInterval);
        this.scratchDecelerationInterval = null;
      } else {
        // Continue applying the decelerating rate
        const finalRate = Math.max(-5, Math.min(5, this.currentScratchRate));
        this.source.playbackRate.value = this.originalPlaybackRate + finalRate;
      }
    }, 16); // ~60fps for smooth deceleration
  }

  // Pitch bend methods
  pitchBend(direction) {
    // Store the original pitch when starting pitch bend
    if (!this.isPitchBending) {
      this.originalPitchBeforeBend = ((this.playbackRate - 1) * 100);
      this.isPitchBending = true;
    }

    const bendAmount = direction > 0 ? 6 : -6; // +/- 6% pitch bend for more noticeable effect
    const currentPitch = this.originalPitchBeforeBend;
    const newPitch = Math.max(-50, Math.min(50, currentPitch + bendAmount));
    this.setPitch(newPitch);
  }

  stopPitchBend() {
    if (this.isPitchBending && this.originalPitchBeforeBend !== undefined) {
      // Restore the original pitch
      this.setPitch(this.originalPitchBeforeBend);
      this.isPitchBending = false;
      this.originalPitchBeforeBend = undefined;
    }
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
    if (!this.audioBuffer) return 120;
    
    try {
      // Get audio data from the buffer
      const audioData = this.audioBuffer.getChannelData(0);
      const sampleRate = this.audioBuffer.sampleRate;
      
      // Analyze only first 30 seconds for performance (or full track if shorter)
      const analysisLength = Math.min(30 * sampleRate, audioData.length);
      const analysisData = audioData.slice(0, analysisLength);
      
      // Detect BPM using onset detection and autocorrelation
      const bpm = this.detectBPMFromAudio(analysisData, sampleRate);
      
      console.log(`Detected BPM: ${bpm} for deck ${this.deckId}`);
      return bpm;
    } catch (error) {
      console.error('BPM detection failed:', error);
      return 120; // Default fallback
    }
  }

  detectBPMFromAudio(audioData, sampleRate) {
    // Calculate energy levels to detect beats
    const hopSize = 512;
    const energyValues = [];
    
    // Calculate RMS energy for each frame
    for (let i = 0; i < audioData.length - hopSize; i += hopSize) {
      let energy = 0;
      for (let j = 0; j < hopSize; j++) {
        energy += audioData[i + j] * audioData[i + j];
      }
      energyValues.push(Math.sqrt(energy / hopSize));
    }
    
    // Detect onset peaks (significant energy increases)
    const onsets = this.detectOnsets(energyValues, hopSize, sampleRate);
    
    // Calculate tempo from onset intervals
    if (onsets.length < 4) {
      return 120; // Not enough data, return default
    }
    
    // Calculate intervals between consecutive onsets
    const intervals = [];
    for (let i = 1; i < onsets.length; i++) {
      intervals.push(onsets[i] - onsets[i - 1]);
    }
    
    // Remove outliers (intervals that are too short or too long)
    const filteredIntervals = intervals.filter(interval => 
      interval >= 0.2 && interval <= 2.0 // Between 30 BPM and 300 BPM
    );
    
    if (filteredIntervals.length === 0) {
      return 120;
    }
    
    // Find the most common interval (tempo)
    const bpm = this.findMostLikelyTempo(filteredIntervals);
    
    // Validate BPM range (typical electronic music range)
    if (bpm < 60) return Math.round(bpm * 2);    // Double-time
    if (bpm > 200) return Math.round(bpm / 2);   // Half-time
    if (bpm < 80) return Math.round(bpm * 1.5);  // Adjust if too slow
    
    return Math.round(bpm);
  }

  detectOnsets(energyValues, hopSize, sampleRate) {
    const onsets = [];
    const threshold = 1.2; // Lower threshold for better sensitivity
    
    // Apply moving average for smoothing
    const smoothed = this.applyMovingAverage(energyValues, 2); // Smaller window
    
    // Calculate spectral flux (energy differences between frames)
    const spectralFlux = [];
    for (let i = 1; i < smoothed.length; i++) {
      const diff = Math.max(0, smoothed[i] - smoothed[i - 1]);
      spectralFlux.push(diff);
    }
    
    // Find peaks in spectral flux
    for (let i = 1; i < spectralFlux.length - 1; i++) {
      const current = spectralFlux[i];
      const previous = spectralFlux[i - 1];
      const next = spectralFlux[i + 1];
      
      // Detect peaks that are significantly higher than neighbors
      if (current > previous * threshold && current > next && current > 0.01) {
        const timeInSeconds = ((i + 1) * hopSize) / sampleRate;
        onsets.push(timeInSeconds);
      }
    }
    
    return onsets;
  }

  applyMovingAverage(data, windowSize) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - windowSize); j <= Math.min(data.length - 1, i + windowSize); j++) {
        sum += data[j];
        count++;
      }
      result.push(sum / count);
    }
    return result;
  }

  findMostLikelyTempo(intervals) {
    if (intervals.length === 0) return 120;
    
    // Convert intervals to BPM
    const bpmValues = intervals.map(interval => 60 / interval);
    
    // Create histogram of BPM values
    const histogram = {};
    const tolerance = 3; // Smaller tolerance for more precision
    
    bpmValues.forEach(bpm => {
      // Round to nearest tolerance value for grouping
      const roundedBpm = Math.round(bpm / tolerance) * tolerance;
      if (!histogram[roundedBpm]) {
        histogram[roundedBpm] = [];
      }
      histogram[roundedBpm].push(bpm);
    });
    
    // Find the group with most occurrences
    let maxCount = 0;
    let mostLikelyBPM = 120;
    
    Object.keys(histogram).forEach(key => {
      const group = histogram[key];
      if (group.length > maxCount) {
        maxCount = group.length;
        // Average the BPM values in the winning group
        mostLikelyBPM = group.reduce((sum, bpm) => sum + bpm, 0) / group.length;
      }
    });
    
    // Also check for double-time and half-time patterns
    const candidates = [mostLikelyBPM, mostLikelyBPM * 2, mostLikelyBPM / 2];
    
    // Return the candidate that makes most sense musically
    for (const candidate of candidates) {
      if (candidate >= 80 && candidate <= 180) {
        return candidate;
      }
    }
    
    return mostLikelyBPM;
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

class DeckController {
  constructor(deckId) {
    this.deckId = deckId;
    this.isScratching = false;
    this.vinylElement = null;
    
    // TAP functionality
    this.tapTimes = [];
    this.tapTimeout = null;
    
    this.setupEventListeners();
    
    // Initialize effects controller for this deck
    this.effectsController = new EffectsController(deckId);
  }

  setupEventListeners() {
    // File input
    const fileInput = document.getElementById(`fileInput${this.deckId}`);
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        await this.loadTrack(file);
      }
    });

    // Transport controls
    document.getElementById(`play${this.deckId}`).addEventListener('click', () => {
      this.play();
    });

    document.getElementById(`pause${this.deckId}`).addEventListener('click', () => {
      this.pause();
    });

    document.getElementById(`stop${this.deckId}`).addEventListener('click', () => {
      this.stop();
    });

    document.getElementById(`cue${this.deckId}`).addEventListener('click', () => {
      this.cue();
    });

    // Vinyl scratching
    this.vinylElement = document.getElementById(`vinyl${this.deckId}`);
    this.setupVinylControls();

    // Pitch control (vertical)
    const pitchSlider = document.getElementById(`pitch${this.deckId}`);
    pitchSlider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        deck.setPitch(value);
        // Update BPM display to reflect pitch change
        this.updateBPMDisplay();
      }
      document.getElementById(`pitchDisplay${this.deckId}`).textContent = `${value}%`;
    });

    // EQ controls
    ['high', 'mid', 'low', 'gain'].forEach(band => {
      const eqSlider = document.getElementById(`${band}${this.deckId}`);
      eqSlider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        const deck = window.audioEngine.getDeck(this.deckId);
        if (deck) {
          deck.setEQ(band, value);
        }
        e.target.nextElementSibling.textContent = value;
      });
    });

    // Volume control
    const volumeSlider = document.getElementById(`volume${this.deckId}`);
    volumeSlider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        deck.setVolume(value);
      }
      e.target.nextElementSibling.textContent = `${value}%`;
    });

    // Pitch bend buttons (vertical layout)
    document.getElementById(`pitchBendPlus${this.deckId}`).addEventListener('mousedown', () => {
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        deck.pitchBend(1);
      }
    });

    document.getElementById(`pitchBendMinus${this.deckId}`).addEventListener('mousedown', () => {
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        deck.pitchBend(-1);
      }
    });

    // Stop pitch bend on mouse up
    ['pitchBendPlus', 'pitchBendMinus'].forEach(buttonId => {
      const button = document.getElementById(`${buttonId}${this.deckId}`);
      button.addEventListener('mouseup', () => {
        const deck = window.audioEngine.getDeck(this.deckId);
        if (deck) {
          deck.stopPitchBend();
        }
      });
      
      // Also stop pitch bend when mouse leaves the button
      button.addEventListener('mouseleave', () => {
        const deck = window.audioEngine.getDeck(this.deckId);
        if (deck) {
          deck.stopPitchBend();
        }
      });
    });

    // Pitch reset button
    document.getElementById(`pitchReset${this.deckId}`).addEventListener('click', () => {
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        deck.setPitch(0);
        // Update the slider and display
        document.getElementById(`pitch${this.deckId}`).value = 0;
        document.getElementById(`pitchDisplay${this.deckId}`).textContent = '0%';
        // Update BPM display
        if (deck.bpm) {
          document.getElementById(`bpm${this.deckId}`).textContent = deck.bpm.toFixed(1);
        }
      }
    });

    // CUE point controls
    document.getElementById(`cue1${this.deckId}`).addEventListener('click', () => {
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        deck.jumpToCue(1);
      }
    });

    document.getElementById(`cue2${this.deckId}`).addEventListener('click', () => {
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        deck.jumpToCue(2);
      }
    });

    document.getElementById(`setCue1${this.deckId}`).addEventListener('click', () => {
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        deck.setCuePoint(1);
      }
    });

    document.getElementById(`setCue2${this.deckId}`).addEventListener('click', () => {
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        deck.setCuePoint(2);
      }
    });

    // TAP button for manual BPM setting
    document.getElementById(`tap${this.deckId}`).addEventListener('click', () => {
      this.handleTap();
    });

    // Loop controls
    document.getElementById(`loopIn${this.deckId}`).addEventListener('click', () => {
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        deck.setLoopIn();
      }
    });

    document.getElementById(`loopOut${this.deckId}`).addEventListener('click', () => {
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        deck.setLoopOut();
      }
    });

    document.getElementById(`loopToggle${this.deckId}`).addEventListener('click', () => {
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        deck.toggleLoop();
      }
    });

    // Loop length slider
    const loopLengthSlider = document.getElementById(`loopLength${this.deckId}`);
    const loopLengthValue = document.getElementById(`loopLengthValue${this.deckId}`);
    
    loopLengthSlider.addEventListener('input', (e) => {
      const percentage = parseInt(e.target.value);
      loopLengthValue.textContent = `${percentage}%`;
      
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        deck.setLoopLength(percentage);
      }
    });

    // Reset filters button
    document.getElementById(`resetFilters${this.deckId}`).addEventListener('click', () => {
      this.resetFilters();
    });
  }

  setupVinylControls() {
    if (!this.vinylElement) return;

    let isDragging = false;
    let lastAngle = 0;
    let startAngle = 0;

    // Mouse events for scratching
    this.vinylElement.addEventListener('mousedown', (e) => {
      isDragging = true;
      this.isScratching = true;
      const rect = this.vinylElement.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
      lastAngle = startAngle;
      
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        deck.startScratch();
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging || !this.isScratching) return;

      const rect = this.vinylElement.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const currentAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
      
      let angleDiff = currentAngle - lastAngle;
      
      // Handle angle wrap-around
      if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        // Convert angle difference to scratch speed
        const scratchSpeed = angleDiff * 10; // Adjust multiplier for sensitivity
        deck.scratch(scratchSpeed);
      }
      
      lastAngle = currentAngle;
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        this.isScratching = false;
        
        const deck = window.audioEngine.getDeck(this.deckId);
        if (deck) {
          deck.stopScratch();
        }
      }
    });

    // Touch events for mobile scratching
    this.vinylElement.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const rect = this.vinylElement.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      isDragging = true;
      this.isScratching = true;
      startAngle = Math.atan2(touch.clientY - centerY, touch.clientX - centerX);
      lastAngle = startAngle;
      
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        deck.startScratch();
      }
    });

    this.vinylElement.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (!isDragging || !this.isScratching) return;

      const touch = e.touches[0];
      const rect = this.vinylElement.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const currentAngle = Math.atan2(touch.clientY - centerY, touch.clientX - centerX);
      
      let angleDiff = currentAngle - lastAngle;
      
      // Handle angle wrap-around
      if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        const scratchSpeed = angleDiff * 10;
        deck.scratch(scratchSpeed);
      }
      
      lastAngle = currentAngle;
    });

    this.vinylElement.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (isDragging) {
        isDragging = false;
        this.isScratching = false;
        
        const deck = window.audioEngine.getDeck(this.deckId);
        if (deck) {
          deck.stopScratch();
        }
      }
    });
  }

  async loadTrack(file) {
    await window.audioEngine.initialize();
        
    const deck = window.audioEngine.getDeck(this.deckId);
    const trackInfo = document.getElementById(`trackInfo${this.deckId}`);
        
    // Stop current track if playing before loading new one
    this.stop();
        
    // Show loading state
    trackInfo.classList.add('loading');
    trackInfo.querySelector('.track-name').textContent = 'Loading...';
        
    const success = await deck.loadFile(file);
        
    if (success) {
      // Reset cues
      deck.resetCuePoints();
      
      // Extract metadata and update track display
      await this.extractAndDisplayMetadata(file);
      this.updateTrackTime();
            
      // Generate main waveform
      const waveformRenderer = window.waveformRenderers[this.deckId];
      if (waveformRenderer) {
        await waveformRenderer.generateWaveform(deck.audioBuffer);
      }
      
      // Generate beat matching waveforms
      const beatWaveformRenderer = window.beatWaveformRenderers[this.deckId];
      
      if (beatWaveformRenderer) {
        await beatWaveformRenderer.generateWaveform(deck.audioBuffer);
      }
            
      // Update BPM display
      this.updateBPMDisplay();
    } else {
      trackInfo.querySelector('.track-name').textContent = 'Failed to load';
    }
        
    trackInfo.classList.remove('loading');
  }

  async extractAndDisplayMetadata(file) {
    return new Promise((resolve) => {
      // Use jsmediatags to extract metadata
      window.jsmediatags.read(file, {
        onSuccess: (tag) => {
          const tags = tag.tags;
          let displayTitle = '';
          
          // Extract artist and title
          const artist = tags.artist || '';
          const title = tags.title || '';
          const album = tags.album || '';
          
          // Format display title
          if (artist && title) {
            displayTitle = `${artist} - ${title}`;
          } else if (title) {
            displayTitle = title;
          } else {
            // Fallback to filename parsing
            displayTitle = this.parseFilenameForMetadata(file.name);
          }
          
          // Update track name display
          const trackNameElement = document.querySelector(`#trackInfo${this.deckId} .track-name`);
          trackNameElement.textContent = displayTitle;
          
          // Add album info if available
          if (album) {
            trackNameElement.title = `Album: ${album}`;
          }
          
          // Handle album cover
          this.displayAlbumCover(tags.picture);
          
          resolve();
        },
        onError: (error) => {
          console.log('Metadata extraction failed:', error);
          // Fallback to filename parsing
          const trackNameElement = document.querySelector(`#trackInfo${this.deckId} .track-name`);
          trackNameElement.textContent = this.parseFilenameForMetadata(file.name);
          this.displayAlbumCover(null);
          resolve();
        }
      });
    });
  }

  parseFilenameForMetadata(filename) {
    // Remove file extension
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
    
    // Try to parse common patterns
    const patterns = [
      /^(\d+[\s\-_]*)?(.+?)\s*[\-_]\s*(.+)$/,  // "01 - Artist - Title" or "Artist - Title"
      /^(.+?)[\s\-_]+(.+)$/                     // "Artist Title" or "Artist_Title"
    ];
    
    for (const pattern of patterns) {
      const match = nameWithoutExt.match(pattern);
      if (match) {
        const parts = match.slice(1).filter(part => part && !part.match(/^\d+$/));
        if (parts.length >= 2) {
          return `${parts[0].trim()} - ${parts[1].trim()}`;
        }
      }
    }
    
    // If no pattern matches, return cleaned filename
    return nameWithoutExt.trim();
  }

  displayAlbumCover(pictureData) {
    const albumCoverElement = document.getElementById(`albumCover${this.deckId}`);
    
    if (pictureData && pictureData.data) {
      try {
        // Create blob from picture data
        const byteArray = new Uint8Array(pictureData.data);
        const blob = new Blob([byteArray], { type: pictureData.format });
        const imageUrl = URL.createObjectURL(blob);
        
        // Set image source and show it
        albumCoverElement.src = imageUrl;
        albumCoverElement.style.display = 'block';
        
        // Clean up previous blob URL
        if (albumCoverElement.dataset.blobUrl) {
          URL.revokeObjectURL(albumCoverElement.dataset.blobUrl);
        }
        albumCoverElement.dataset.blobUrl = imageUrl;
      } catch (error) {
        console.log('Error displaying album cover:', error);
        this.hideAlbumCover();
      }
    } else {
      this.hideAlbumCover();
    }
  }

  hideAlbumCover() {
    const albumCoverElement = document.getElementById(`albumCover${this.deckId}`);
    albumCoverElement.style.display = 'none';
    
    // Clean up blob URL if exists
    if (albumCoverElement.dataset.blobUrl) {
      URL.revokeObjectURL(albumCoverElement.dataset.blobUrl);
      delete albumCoverElement.dataset.blobUrl;
    }
  }

  play() {
    const deck = window.audioEngine.getDeck(this.deckId);
    if (deck) {
      deck.play();
      this.updatePlayingState(true);
      this.updatePauseState(false);
      // Start vinyl animation
      if (this.vinylElement && !this.isScratching) {
        this.vinylElement.classList.add('spinning');
      }
      // Resume waveform animations
      if (window.waveformRenderers && window.waveformRenderers[this.deckId]) {
        window.waveformRenderers[this.deckId].startAnimation();
      }
      if (window.beatWaveformRenderers && window.beatWaveformRenderers[this.deckId]) {
        window.beatWaveformRenderers[this.deckId].startAnimation();
      }
    }
  }

  pause() {
    const deck = window.audioEngine.getDeck(this.deckId);
    if (deck) {
      deck.pause();
      this.updatePlayingState(false);
      this.updatePauseState(true);
      // Stop vinyl animation
      if (this.vinylElement) {
        this.vinylElement.classList.remove('spinning');
      }
    }
  }

  stop() {
    const deck = window.audioEngine.getDeck(this.deckId);
    if (deck) {
      deck.stop();
      this.updatePlayingState(false);
      this.updatePauseState(false);
      // Stop vinyl animation
      if (this.vinylElement) {
        this.vinylElement.classList.remove('spinning');
      }
      // Force waveform update to show position at beginning
      if (window.waveformRenderers && window.waveformRenderers[this.deckId]) {
        window.waveformRenderers[this.deckId].updatePlayhead();
        window.waveformRenderers[this.deckId].render();
      }
      if (window.beatWaveformRenderers && window.beatWaveformRenderers[this.deckId]) {
        window.beatWaveformRenderers[this.deckId].updatePlayhead();
        window.beatWaveformRenderers[this.deckId].render();
      }
    }
  }

  cue() {
    const deck = window.audioEngine.getDeck(this.deckId);
    if (deck) {
      deck.cue();
    }
  }

  updatePlayingState(isPlaying) {
    const deckElement = document.getElementById(`deck${this.deckId}`);
    const playButton = document.getElementById(`play${this.deckId}`);
    
    if (isPlaying) {
      deckElement.classList.add('playing');
      playButton.classList.add('active');
    } else {
      deckElement.classList.remove('playing');
      playButton.classList.remove('active');
    }
  }

  updatePauseState(isPaused) {
    const pauseButton = document.getElementById(`pause${this.deckId}`);
    
    if (isPaused) {
      pauseButton.classList.add('active');
    } else {
      pauseButton.classList.remove('active');
    }
  }

  updateTrackTime() {
    const deck = window.audioEngine.getDeck(this.deckId);
    if (!deck || !deck.audioBuffer) return;

    const currentTime = deck.getCurrentTime();
    const duration = deck.getDuration();
    const trackTimeElement = document.getElementById(`trackInfo${this.deckId}`).querySelector('.track-time');
    
    trackTimeElement.textContent = `${this.formatTime(currentTime)} / ${this.formatTime(duration)}`;
    
    // Continuously refine BPM during playback
    if (deck.isPlaying) {
      deck.refineBPMDuringPlayback();
      this.updateBPMDisplay(); // Update display in case BPM was refined
    }
    
    // Auto-stop when track reaches end (only if playing and not looping)
    if (deck.isPlaying && !deck.isLooping && duration > 0 && currentTime >= duration) {
      console.log(`Deck ${this.deckId}: Auto-stopping at track end (${currentTime.toFixed(2)}s / ${duration.toFixed(2)}s)`);
      this.stop();
    }
  }

  formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  resetFilters() {
    const deck = window.audioEngine.getDeck(this.deckId);
    if (!deck) return;

    // Reset effects controls only (not EQ)
    const effects = [
      { id: 'filter', defaultValue: 50 },
      { id: 'reverb', defaultValue: 0 },
      { id: 'delay', defaultValue: 0 },
      { id: 'phaser', defaultValue: 0 },
      { id: 'flanger', defaultValue: 0 }
    ];

    effects.forEach(effect => {
      const slider = document.getElementById(`${effect.id}${this.deckId}`);
      if (slider) {
        slider.value = effect.defaultValue;
        if (effect.id === 'filter') {
          deck.setFilter(effect.defaultValue);
        } else if (effect.id === 'reverb') {
          deck.setReverb(effect.defaultValue);
        } else if (effect.id === 'delay') {
          deck.setDelay(effect.defaultValue);
        } else if (effect.id === 'phaser') {
          deck.setPhaser(effect.defaultValue);
        } else if (effect.id === 'flanger') {
          deck.setFlanger(effect.defaultValue);
        }
      }
    });

    console.log(`Deck ${this.deckId}: Effects reset to default values`);
  }

  updateBPMDisplay() {
    const deck = window.audioEngine.getDeck(this.deckId);
    if (!deck || !deck.audioBuffer) return;

    const baseBPM = deck.getBaseBPM(); // Get the original BPM
    const pitchPercentage = ((deck.playbackRate - 1) * 100);
    const adjustedBPM = Math.round(baseBPM * deck.playbackRate);
    
    document.getElementById(`bpm${this.deckId}`).textContent = adjustedBPM;
  }

  handleTap() {
    const now = Date.now();
    const deck = window.audioEngine.getDeck(this.deckId);
    if (!deck) return;

    // Add current time to tap history
    this.tapTimes.push(now);
    
    // Keep only the last 8 taps and remove taps older than 3 seconds
    this.tapTimes = this.tapTimes.filter(time => now - time <= 3000).slice(-8);
    
    // Provide visual feedback
    const tapButton = document.getElementById(`tap${this.deckId}`);
    tapButton.classList.add('active');
    
    // Clear previous timeout
    if (this.tapTimeout) {
      clearTimeout(this.tapTimeout);
    }
    
    // Remove active class after 150ms
    this.tapTimeout = setTimeout(() => {
      tapButton.classList.remove('active');
    }, 150);
    
    // Need at least 2 taps to calculate BPM
    if (this.tapTimes.length < 2) return;
    
    // Calculate intervals between taps
    const intervals = [];
    for (let i = 1; i < this.tapTimes.length; i++) {
      intervals.push(this.tapTimes[i] - this.tapTimes[i - 1]);
    }
    
    // Calculate average interval in milliseconds
    const avgInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    
    // Convert to BPM (60000 ms = 1 minute)
    const bpm = Math.round(60000 / avgInterval);
    
    // Validate BPM range
    if (bpm >= 60 && bpm <= 200) {
      deck.baseBPM = bpm;
      deck.generateBeatMap();
      this.updateBPMDisplay();
      console.log(`Manual BPM set via TAP for deck ${this.deckId}: ${bpm} BPM`);
    }
  }
}
