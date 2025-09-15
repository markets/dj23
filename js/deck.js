class Deck {
  constructor(audioContext, mainOutput, cueOutput, deckId) {
    this.audioContext = audioContext;
    this.mainOutput = mainOutput;
    this.cueOutput = cueOutput;
    this.deckId = deckId;

    this.audioBuffer = null;
    this.source = null;
    this.gainNode = null;
    this.cueGainNode = null;
    this.eqNodes = {};
    this.effectNodes = {};

    this.isPlaying = false;
    this.isPaused = false;
    this.startTime = 0;
    this.pauseTime = 0;
    this.playbackRate = 1;
    this.volume = 0.75;

    // Pre-listen functionality
    this.isPreListenEnabled = false;

    // Initialize BPM analyzer
    this.bpmAnalyzer = new BPMAnalyzer(audioContext, deckId);

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

    // Back-spin properties
    this.isBackSpinning = false;

    // CUE points
    this.cuePoints = { 1: null, 2: null };
    this.isCueActive = false; // Track if CUE is currently being held/active
    this.defaultCuePoint = null; // Auto-set cue point for when no manual cue points exist

    // Loop points
    this.loopStart = null;
    this.loopEnd = null;
    this.originalLoopEnd = null; // Store the original loop end point
    this.loopLengthPercentage = 100; // Current loop length as percentage
    this.isLooping = false;
    this.loopCheckInterval = null;

    this.setupAudioNodes();
  }

  get controller() {
    return window.mixerController.deckControllers[this.deckId];
  }

  setupAudioNodes() {
    // Main output gain node
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = this.volume;

    // Cue output gain node
    this.cueGainNode = this.audioContext.createGain();
    this.cueGainNode.gain.value = 0; // Start with pre-listen disabled

    this.globalGainNode = this.audioContext.createGain();
    this.globalGainNode.gain.value = 1.0;

    // Create splitter and merger nodes that will be reused
    this.splitter = this.audioContext.createChannelSplitter(2);
    this.merger = this.audioContext.createChannelMerger(2);

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
      this.bpmAnalyzer.calculateBPM(this.audioBuffer);
      this.bpmAnalyzer.generateBeatMap(this.audioBuffer);
      return true;
    } catch (error) {
      console.error('Error loading audio file:', error);
      return false;
    }
  }

  // Find the nearest beat position to the current time
  findNearestBeat(currentTime) {
    return this.bpmAnalyzer.findNearestBeat(currentTime);
  }

  // Get the next beat after current time
  getNextBeat(currentTime) {
    return this.bpmAnalyzer.getNextBeat(currentTime);
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

    // Use the persistent splitter and merger nodes
    this.eqNodes.high.connect(this.splitter);

    // Main dry signal path
    this.eqNodes.high.connect(this.globalGainNode);
    this.globalGainNode.connect(this.gainNode);

    // Connect reverb send (wet/dry mix)
    this.splitter.connect(this.effectNodes.reverb);
    this.effectNodes.reverb.connect(this.effectNodes.reverbGain);
    this.effectNodes.reverbGain.connect(this.globalGainNode);

    // Connect delay send
    this.splitter.connect(this.effectNodes.delay);
    this.effectNodes.delayGain.connect(this.globalGainNode);

    // Connect phaser effect chain
    if (this.effectNodes.phaser && this.effectNodes.phaser.length > 0) {
      let phaserInput = this.splitter;

      // Connect phaser chain
      for (let i = 0; i < this.effectNodes.phaser.length; i++) {
        phaserInput.connect(this.effectNodes.phaser[i]);
        phaserInput = this.effectNodes.phaser[i];
      }

      // Connect phaser output through gain control
      phaserInput.connect(this.effectNodes.phaserGain);
      this.effectNodes.phaserGain.connect(this.globalGainNode);
    }

    // Connect flanger effect
    if (this.effectNodes.flanger) {
      this.splitter.connect(this.effectNodes.flanger);
      this.effectNodes.flanger.connect(this.effectNodes.flangerGain);
      this.effectNodes.flangerGain.connect(this.globalGainNode);
    }

    // Route to both main and cue outputs
    this.globalGainNode.connect(this.gainNode);
    this.globalGainNode.connect(this.cueGainNode);
    
    this.gainNode.connect(this.mainOutput);
    this.cueGainNode.connect(this.cueOutput);

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
    
    // Disconnect all audio nodes to prevent multiple connections accumulating
    // This prevents audio degradation when loading new tracks after using gain controls
    if (this.globalGainNode) {
      this.globalGainNode.disconnect();
    }
    if (this.gainNode) {
      this.gainNode.disconnect();
      // Reconnect analyser if it exists (for VU meters)
      if (this.analyser) this.gainNode.connect(this.analyser);
    }
    
    // Disconnect EQ nodes which also connect to gain nodes
    if (this.eqNodes) {
      if (this.eqNodes.high) this.eqNodes.high.disconnect();
      if (this.eqNodes.mid) this.eqNodes.mid.disconnect();
      if (this.eqNodes.low) this.eqNodes.low.disconnect();
      if (this.eqNodes.filter) this.eqNodes.filter.disconnect();
    }
    
    // Disconnect the splitter which is the source of multiple effect connections
    if (this.splitter) this.splitter.disconnect();
    if (this.merger) this.merger.disconnect();

    // Disconnect the output effect nodes that connect to gain nodes
    if (this.effectNodes) {
      if (this.effectNodes.filter) this.effectNodes.filter.disconnect();
      if (this.effectNodes.reverbGain) this.effectNodes.reverbGain.disconnect();
      if (this.effectNodes.delayGain) this.effectNodes.delayGain.disconnect();
      if (this.effectNodes.phaserGain) this.effectNodes.phaserGain.disconnect();
      if (this.effectNodes.flangerGain) this.effectNodes.flangerGain.disconnect();
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

    // Update cue mixdown when volume changes
    window.mixerController.updateCueMixdown();
  }

  // Pre-listen functionality
  enablePreListen() {
    this.isPreListenEnabled = true;
    console.log(`Deck ${this.deckId}: Pre-listen enabled`);

    // Update the cue mixdown
    window.mixerController.updateCueMixdown();
  }

  disablePreListen() {
    this.isPreListenEnabled = false;
    console.log(`Deck ${this.deckId}: Pre-listen disabled`);

    // Update the cue mixdown
    window.mixerController.updateCueMixdown();
  }

  togglePreListen() {
    console.log(`Deck ${this.deckId}: Toggle Pre-listen - current state:`, this.isPreListenEnabled);
    if (this.isPreListenEnabled) {
      this.disablePreListen();
    } else {
      this.enablePreListen();
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
      // Use logarithmic scale for more musical frequency response
      // Map 0-100% in INVERSE direction for traditional DJ filter behavior
      const minFreq = 100; // 100Hz minimum (full filtering at 100%)
      const maxFreq = 15000; // 15kHz maximum (no filtering at 0%)
      
      // Invert the value so slider works as expected
      // 0% = no filtering (15kHz), 100% = heavy filtering (100Hz)
      const invertedValue = (100 - value) / 100;
      const logMin = Math.log(minFreq);
      const logMax = Math.log(maxFreq);
      const frequency = Math.exp(logMin + invertedValue * (logMax - logMin));
      
      this.effectNodes.filter.frequency.value = frequency;
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
    this.defaultCuePoint = null;
    console.log(`Deck ${this.deckId}: CUE points reset`);
  }

  // Loop cleanup method
  resetLoopPoints() {
    // Stop any active looping
    if (this.isLooping) {
      this.stopLoopMonitoring();
      this.isLooping = false;
    }
    
    // Reset loop points
    this.loopStart = null;
    this.loopEnd = null;
    this.originalLoopEnd = null;
    this.loopLengthPercentage = 100;
    
    // Update UI to reflect cleared loop state
    this.controller.updateLoopToggleState(false);
    this.controller.updateLoopInState(false);
    this.controller.updateLoopOutState(false);
    this.controller.updateLoopButtonsDisabledState(false);
    
    console.log(`Deck ${this.deckId}: Loop points reset`);
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

  // Helper method to find the most recently set cue point
  getLastCueTime() {
    // Check for manual cue points (prioritize CUE 2 over CUE 1)
    if (this.cuePoints[2] !== null) return this.cuePoints[2];
    if (this.cuePoints[1] !== null) return this.cuePoints[1];
    
    // If no manual cue points are set, use the default cue point
    if (this.defaultCuePoint !== null) {
      console.log(`Deck ${this.deckId}: Using default CUE at ${this.defaultCuePoint}s`);
      return this.defaultCuePoint;
    }
    
    return 0;
  }

  // CUE mode methods for press-and-hold behavior
  startCueMode() {
    if (!this.audioBuffer) return;
    
    // Ensure we have a default cue point set
    this.ensureDefaultCuePoint();
    
    // If not playing, go to cue point and start playing
    if (!this.isPlaying) {
      this.seek(this.getLastCueTime());
    }
    
    // Start playing and mark as cue active
    this.isCueActive = true;
    this.play();
    
    // Update CUE button visual state
    this.controller.updateCueState(true);
    
    console.log(`Deck ${this.deckId}: CUE mode started`);
  }

  ensureDefaultCuePoint() {
    // Only set default cue point if no manual cue points exist and no default exists
    const hasManualCues = this.cuePoints[1] !== null || this.cuePoints[2] !== null;
    
    if (!hasManualCues && this.defaultCuePoint === null) {
      this.defaultCuePoint = this.getCurrentTime();
      console.log(`Deck ${this.deckId}: Auto-set default CUE at current position ${this.defaultCuePoint}s`);
    }
  }

  stopCueMode() {
    if (!this.isCueActive) return;
    
    // Stop playing and return to cue point
    this.pause();
    this.seek(this.getLastCueTime());
    
    this.isCueActive = false;
    
    // Update CUE button visual state
    this.controller.updateCueState(false);
    
    console.log(`Deck ${this.deckId}: CUE mode stopped`);
  }

  // Loop methods
  setLoopIn() {
    this.loopStart = this.findNearestBeat(this.getCurrentTime());
    console.log(`Deck ${this.deckId}: Loop IN set at ${this.loopStart}s`);
    
    // Show only IN as active
    this.controller.updateLoopInState(true);
    this.controller.updateLoopOutState(false);
    this.controller.updateLoopToggleState(false);
  }

  setLoopOut() {
    // Only allow setting OUT if IN is already set
    if (this.loopStart === null) {
      console.log(`Deck ${this.deckId}: Cannot set Loop OUT - Loop IN must be set first`);
      // Ensure UI state remains correct when validation fails
      this.controller.updateLoopOutState(false);
      return;
    }
    
    this.loopEnd = this.findNearestBeat(this.getCurrentTime());
    this.originalLoopEnd = this.loopEnd; // Store original loop end
    this.loopLengthPercentage = 100; // Reset to 100% when setting new loop out
    console.log(`Deck ${this.deckId}: Loop OUT set at ${this.loopEnd}s`);
    
    // Show only OUT as active (indicates you have a saved loop)
    this.controller.updateLoopInState(false);
    this.controller.updateLoopOutState(true);
    this.controller.updateLoopToggleState(false);
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
        
        // When loop is active: only LOOP button is active, IN/OUT are disabled
        this.controller.updateLoopToggleState(true);
        this.controller.updateLoopInState(false);
        this.controller.updateLoopOutState(false);
        this.controller.updateLoopButtonsDisabledState(true);
      } else {
        this.stopLoopMonitoring();
        console.log(`Deck ${this.deckId}: Loop disabled`);
        
        // When loop is disabled: restore IN/OUT to their normal state
        this.controller.updateLoopToggleState(false);
        this.controller.updateLoopButtonsDisabledState(false);
        this.controller.updateLoopOutState(false);
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
    const newPitch = Math.max(-30, Math.min(30, currentPitch + bendAmount));
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

  // Back-spin method
  async startBackSpin() {
    if (this.isBackSpinning || !this.audioBuffer || !this.source) return;

    this.isBackSpinning = true;
    const currentTime = this.getCurrentTime();

    // Stop the current source
    this.stopSource();

    // Create reversed buffer
    const reversedBuffer = this.audioContext.createBuffer(
      this.audioBuffer.numberOfChannels,
      this.audioBuffer.length,
      this.audioBuffer.sampleRate
    );

    for (let ch = 0; ch < this.audioBuffer.numberOfChannels; ch++) {
      let channelData = this.audioBuffer.getChannelData(ch);
      let reversedData = reversedBuffer.getChannelData(ch);
      for (let i = 0; i < channelData.length; i++) {
        reversedData[i] = channelData[channelData.length - 1 - i];
      }
    }

    // Create new source for reversed playback
    this.source = this.audioContext.createBufferSource();
    this.source.buffer = reversedBuffer;

    // Connect audio chain
    this.source.connect(this.effectNodes.filter);
    this.effectNodes.filter.connect(this.eqNodes.low);
    this.eqNodes.low.connect(this.eqNodes.mid);
    this.eqNodes.mid.connect(this.eqNodes.high);
    this.eqNodes.high.connect(this.globalGainNode);
    this.globalGainNode.connect(this.gainNode);
    this.gainNode.connect(this.mainOutput);

    // Start with fast reverse playback then slow down
    const now = this.audioContext.currentTime;
    const duration = 3.5; // 3 second back-spin effect
    
    this.source.playbackRate.setValueAtTime(2.5, now);
    this.source.playbackRate.exponentialRampToValueAtTime(0.15, now + duration);

    // Start from current position in reversed buffer
    const reversedStartTime = Math.max(0, reversedBuffer.duration - currentTime);
    this.source.start(now, reversedStartTime, duration);

    // Stop and pause after effect
    setTimeout(() => {
      this.isBackSpinning = false;
      // Call controller's pause method to properly update UI state
      this.controller.pause();
    }, duration * 1000);
  }

  getDuration() {
    return this.audioBuffer ? this.audioBuffer.duration : 0;
  }

  getBPM() {
    // Return the current BPM adjusted for pitch changes
    return this.bpmAnalyzer.getBPM(this.playbackRate);
  }

  getBaseBPM() {
    // Return the original BPM without pitch adjustments
    return this.bpmAnalyzer.getBaseBPM();
  }

  getAudioStartOffset() {
    // Return the time when actual audio content starts
    return this.bpmAnalyzer.getAudioStartOffset();
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

  // Get the current global gain value (from EQ gain control)
  getGlobalGain() {
    return this.globalGainNode ? this.globalGainNode.gain.value : 1.0;
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

  // Reset TAP functionality when loading a new track
  resetTapState() {
    this.tapTimes = [];
    if (this.tapTimeout) {
      clearTimeout(this.tapTimeout);
      this.tapTimeout = null;
    }
  }

  // Utility function for creating deck method button handlers
  createDeckMethodHandler(buttonName, deckMethod, ...args) {
    window.buttonHandler.createClickHandler(`${buttonName}${this.deckId}`, () => {
      window.buttonHandler.callDeckMethod(this.deckId, deckMethod, ...args);
    });
  }

  // Utility function for creating controller method button handlers
  createControllerMethodHandler(buttonName, controllerMethod) {
    window.buttonHandler.createClickHandler(`${buttonName}${this.deckId}`, () => {
      this[controllerMethod]();
    });
  }

  // Utility function for creating slider handlers with unified pattern
  createSliderHandler(sliderId, deckMethod, displayOptions = {}) {
    const slider = document.getElementById(sliderId);
    if (!slider) return;

    slider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck && typeof deck[deckMethod] === 'function') {
        deck[deckMethod](value);
      }

      // Update display element if configured
      if (displayOptions.updateDisplay !== false) {
        const displayElement = displayOptions.displayElement || e.target.nextElementSibling;
        if (displayElement) {
          const suffix = displayOptions.suffix || '';
          displayElement.textContent = `${value}${suffix}`;
        }
      }

      // Call additional callback if provided
      if (displayOptions.callback && typeof displayOptions.callback === 'function') {
        displayOptions.callback(value);
      }
    });
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

    // Drag and drop functionality
    this.setupDragAndDrop();

    // Transport controls
    this.createControllerMethodHandler('play', 'play');
    this.createControllerMethodHandler('pause', 'pause');
    this.createControllerMethodHandler('stop', 'stop');

    // Back-spin button
    this.createDeckMethodHandler('backSpin', 'startBackSpin');

    // CUE button - press and hold behavior
    window.buttonHandler.createPressAndHoldHandler(
      `cue${this.deckId}`,
      () => {
        window.buttonHandler.callDeckMethod(this.deckId, 'startCueMode');
      },
      () => {
        window.buttonHandler.callDeckMethod(this.deckId, 'stopCueMode');
      }
    );

    // Vinyl scratching
    this.vinylElement = document.getElementById(`vinyl${this.deckId}`);
    this.setupVinylControls();

    // Pitch control (vertical)
    this.createSliderHandler(`pitch${this.deckId}`, 'setPitch', {
      displayElement: document.getElementById(`pitchDisplay${this.deckId}`),
      suffix: '%',
      callback: () => this.updateBPMDisplay()
    });

    // EQ controls
    ['high', 'mid', 'low', 'gain'].forEach(band => {
      this.createSliderHandler(`${band}${this.deckId}`, 'setEQ', {
        updateDisplay: false, // We'll handle display manually because setEQ needs band parameter
        callback: (value) => {
          const deck = window.audioEngine.getDeck(this.deckId);
          if (deck) {
            deck.setEQ(band, value);
          }
          // Update display manually
          const slider = document.getElementById(`${band}${this.deckId}`);
          if (slider && slider.parentNode && slider.parentNode.nextElementSibling) {
            slider.parentNode.nextElementSibling.textContent = value;
          }
        }
      });

      // EQ KILL button - press and hold behavior
      window.buttonHandler.createPressAndHoldHandler(
        `${band}Kill${this.deckId}`,
        () => {
          const deck = window.audioEngine.getDeck(this.deckId);
          const slider = document.getElementById(`${band}${this.deckId}`);
          if (deck && slider) {
            // Store original value before killing
            slider.dataset.originalValue = slider.value;
            // Set to minimum value (-25) to "kill" the band
            slider.value = -25;
            deck.setEQ(band, -25);
            // Update display
            if (slider.parentNode && slider.parentNode.nextElementSibling) {
              slider.parentNode.nextElementSibling.textContent = '-25';
            }
          }
        },
        () => {
          const deck = window.audioEngine.getDeck(this.deckId);
          const slider = document.getElementById(`${band}${this.deckId}`);
          if (deck && slider && slider.dataset.originalValue !== undefined) {
            // Restore original value when kill button is released
            const originalValue = parseInt(slider.dataset.originalValue);
            slider.value = originalValue;
            deck.setEQ(band, originalValue);
            // Update display
            if (slider.parentNode && slider.parentNode.nextElementSibling) {
              slider.parentNode.nextElementSibling.textContent = originalValue.toString();
            }
            // Clean up stored value
            delete slider.dataset.originalValue;
          }
        },
        { updateActiveState: true }
      );

      // EQ RESET button - click behavior
      window.buttonHandler.createClickHandler(`${band}Reset${this.deckId}`, () => {
        const deck = window.audioEngine.getDeck(this.deckId);
        const slider = document.getElementById(`${band}${this.deckId}`);
        if (deck && slider) {
          // Reset to 0
          slider.value = 0;
          deck.setEQ(band, 0);
          // Update display
          if (slider.parentNode && slider.parentNode.nextElementSibling) {
            slider.parentNode.nextElementSibling.textContent = '0';
          }
        }
      });
    });

    // Volume control
    this.createSliderHandler(`volume${this.deckId}`, 'setVolume', { suffix: '%' });

    // Effects controls
    ['filter', 'reverb', 'delay', 'phaser', 'flanger'].forEach(effect => {
      this.createSliderHandler(`${effect}${this.deckId}`, `set${effect.charAt(0).toUpperCase() + effect.slice(1)}`);
    });

    // Pitch bend buttons - press and hold behavior
    window.buttonHandler.createPressAndHoldHandler(
      `pitchBendPlus${this.deckId}`,
      () => window.buttonHandler.callDeckMethod(this.deckId, 'pitchBend', 1),
      () => window.buttonHandler.callDeckMethod(this.deckId, 'stopPitchBend'),
      { updateActiveState: false }
    );

    window.buttonHandler.createPressAndHoldHandler(
      `pitchBendMinus${this.deckId}`,
      () => window.buttonHandler.callDeckMethod(this.deckId, 'pitchBend', -1),
      () => window.buttonHandler.callDeckMethod(this.deckId, 'stopPitchBend'),
      { updateActiveState: false }
    );

    // Pitch reset button
    window.buttonHandler.createClickHandler(`pitchReset${this.deckId}`, () => {
      this.resetPitch();
    });

    // CUE point controls
    this.createDeckMethodHandler('cue1', 'jumpToCue', 1);
    this.createDeckMethodHandler('cue2', 'jumpToCue', 2);
    this.createDeckMethodHandler('setCue1', 'setCuePoint', 1);
    this.createDeckMethodHandler('setCue2', 'setCuePoint', 2);

    // TAP
    this.createControllerMethodHandler('tap', 'handleTap');

    // Loop controls
    this.createDeckMethodHandler('loopIn', 'setLoopIn');
    this.createDeckMethodHandler('loopOut', 'setLoopOut');
    // Custom handler for loop toggle
    window.buttonHandler.createClickHandler(`loopToggle${this.deckId}`, () => {
      const deck = window.audioEngine.getDeck(this.deckId);
      deck.toggleLoop();
    });
    this.createSliderHandler(`loopLength${this.deckId}`, 'setLoopLength', {
      displayElement: document.getElementById(`loopLengthValue${this.deckId}`),
      suffix: '%'
    });

    // Reset effects
    this.createControllerMethodHandler('resetFilters', 'resetFilters');
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

  setupDragAndDrop() {
    const deckElement = document.getElementById(`deck${this.deckId}`);
    if (!deckElement) return;

    // Helper function to check if file is audio
    const isAudioFile = (file) => {
      return file && file.type && file.type.startsWith('audio/');
    };

    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      deckElement.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    // Handle drag enter
    deckElement.addEventListener('dragenter', (e) => {
      // Check if dragged item contains files
      if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        deckElement.classList.add('drag-active');
      }
    });

    // Handle drag over (hovering)
    deckElement.addEventListener('dragover', (e) => {
      if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        // Check if the files appear to be audio (we can't fully validate without dropping)
        const hasValidFile = Array.from(e.dataTransfer.items || []).some(item => 
          item.kind === 'file' && item.type.startsWith('audio/')
        );
        
        if (hasValidFile) {
          deckElement.classList.add('drag-over');
          deckElement.classList.remove('drag-invalid');
        } else if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
          // Has files but not audio
          deckElement.classList.add('drag-invalid');
          deckElement.classList.remove('drag-over');
        }
      }
    });

    // Handle drag leave
    deckElement.addEventListener('dragleave', (e) => {
      // Only remove classes if we're leaving the deck element itself
      // (not just moving between child elements)
      if (!deckElement.contains(e.relatedTarget)) {
        deckElement.classList.remove('drag-active', 'drag-over', 'drag-invalid');
      }
    });

    // Handle file drop
    deckElement.addEventListener('drop', async (e) => {
      // Remove all drag classes
      deckElement.classList.remove('drag-active', 'drag-over', 'drag-invalid');
      
      const files = Array.from(e.dataTransfer.files);
      
      if (files.length === 0) return;
      
      // Find the first audio file
      const audioFile = files.find(isAudioFile);
      
      if (audioFile) {
        await this.loadTrack(audioFile);
        
        console.log(`Deck ${this.deckId}: Successfully loaded track via drag and drop: ${audioFile.name}`);
      } else {
        // Show error feedback for invalid file types
        deckElement.classList.add('drag-invalid');
        setTimeout(() => {
          deckElement.classList.remove('drag-invalid');
        }, 2000);
        
        // Provide user-friendly error message
        const trackInfo = document.getElementById(`trackInfo${this.deckId}`);
        const originalContent = trackInfo.innerHTML;
        trackInfo.style.color = '#ff6b6b';
        trackInfo.innerHTML = '<div class="track-details"><div class="track-name">Invalid file type</div><div class="track-time">Audio files only</div></div>';
        
        setTimeout(() => {
          trackInfo.style.color = '';
          trackInfo.innerHTML = originalContent;
        }, 3000);
        
        console.warn(`Deck ${this.deckId}: No valid audio files found. Supported types: audio/*. Found: ${files.map(f => f.name + ' (' + (f.type || 'unknown') + ')').join(', ')}`);
      }
    });
  }

  async loadTrack(file) {
    await window.audioEngine.initialize();
        
    const deck = window.audioEngine.getDeck(this.deckId);
    const trackInfo = document.getElementById(`trackInfo${this.deckId}`);
        
    // Stop current track if playing before loading new one
    this.stop();
    
    // Reset TAP state for new track
    this.resetTapState();
    
    // Reset pitch to 0% when loading new track for consistent BPM calculation
    this.resetPitch();
        
    // Show loading state
    trackInfo.classList.add('loading');
    trackInfo.querySelector('.track-name').textContent = 'Loading...';
        
    const success = await deck.loadFile(file);
        
    if (success) {
      // Reset cues
      deck.resetCuePoints();
      
      // Reset loops
      deck.resetLoopPoints();
      
      // Reset loop length slider UI
      const loopLengthSlider = document.getElementById(`loopLength${this.deckId}`);
      const loopLengthDisplay = document.getElementById(`loopLengthValue${this.deckId}`);
      if (loopLengthSlider) loopLengthSlider.value = 100;
      if (loopLengthDisplay) loopLengthDisplay.textContent = '100%';
      
      // Extract metadata and update track display
      await this.extractAndDisplayMetadata(file);
      this.updateTrackTime();
            
      // Generate main waveform
      const waveformRenderer = window.waveformRenderers[this.deckId];
      await waveformRenderer.generateWaveform(deck.audioBuffer);
      
      // Generate beat matching waveforms
      const beatWaveformRenderer = window.beatWaveformRenderers[this.deckId];
      await beatWaveformRenderer.generateWaveform(deck.audioBuffer);
            
      // Update BPM display
      this.updateBPMDisplay();
    } else {
      trackInfo.querySelector('.track-name').textContent = 'Failed to load';
    }
        
    trackInfo.classList.remove('loading');
  }

  async extractAndDisplayMetadata(file) {
    return new Promise((resolve) => {
      // Store reference to this context for use in callback
      const self = this;
      
      // Get deck instance to access bpmAnalyzer
      const deck = window.audioEngine.getDeck(self.deckId);
      
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
            displayTitle = self.parseFilenameForMetadata(file.name);
          }
          
          // Update track name display
          const trackNameElement = document.querySelector(`#trackInfo${self.deckId} .track-name`);
          trackNameElement.textContent = displayTitle;
          
          // Add album info if available
          if (album) {
            trackNameElement.title = `Album: ${album}`;
          }
          
          // Handle album cover
          self.displayAlbumCover(tags.picture);
          
          resolve();
        },
        onError: (error) => {
          console.log('Metadata extraction failed:', error);
          // Fallback to filename parsing
          const trackNameElement = document.querySelector(`#trackInfo${self.deckId} .track-name`);
          trackNameElement.textContent = self.parseFilenameForMetadata(file.name);
          self.displayAlbumCover(null);
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
      /^(\d+[\s\-_]*)?(.+?)\s*[\-_]\s*(.+)$/, // "01 - Artist - Title" or "Artist - Title"
      /^(.+?)[\s\-_]+(.+)$/                   // "Artist Title" or "Artist_Title"
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

  updatePlayingState(isPlaying) {
    const deckElement = document.getElementById(`deck${this.deckId}`);
    const playButton = document.getElementById(`play${this.deckId}`);
    deckElement.classList.toggle('playing', isPlaying);
    playButton.classList.toggle('active', isPlaying);
  }

  updatePauseState(isPaused) {
    const pauseButton = document.getElementById(`pause${this.deckId}`);
    pauseButton.classList.toggle('active', isPaused);
  }

  updateCueState(isCueActive) {
    const cueButton = document.getElementById(`cue${this.deckId}`);
    cueButton.classList.toggle('active', isCueActive);
  }

  updateTrackTime() {
    const deck = window.audioEngine.getDeck(this.deckId);
    if (!deck || !deck.audioBuffer) return;

    const currentTime = deck.getCurrentTime();
    const duration = deck.getDuration();
    const trackTimeElement = document.getElementById(`trackInfo${this.deckId}`).querySelector('.track-time');
    
    trackTimeElement.textContent = `${this.formatTime(currentTime)} / ${this.formatTime(duration)}`;
    
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

    // Reset effects controls only (not EQ)
    const effects = [
      { id: 'filter', defaultValue: 0 },
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

  resetPitch() {
    const deck = window.audioEngine.getDeck(this.deckId);

    // Reset pitch to 0%
    deck.setPitch(0);
    
    // Update the slider and display
    document.getElementById(`pitch${this.deckId}`).value = 0;
    document.getElementById(`pitchDisplay${this.deckId}`).textContent = '0%';
    
    // Update BPM display
    this.updateBPMDisplay();
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
    
    // Need at least 3 taps to calculate reliable BPM with outlier detection
    if (this.tapTimes.length < 3) return;
    
    // Calculate intervals between taps
    const intervals = [];
    for (let i = 1; i < this.tapTimes.length; i++) {
      intervals.push(this.tapTimes[i] - this.tapTimes[i - 1]);
    }
    
    // Apply outlier detection and robust averaging
    const robustBPM = this.calculateRobustBPM(intervals);
    
    // Validate BPM range
    if (robustBPM >= 60 && robustBPM <= 200) {
      deck.bpmAnalyzer.setBPM(robustBPM, deck.audioBuffer);
      // Update the manual tap time with current playback time for refinement protection
      const currentTime = deck.getCurrentTime();
      deck.bpmAnalyzer.updateManualTapTime(currentTime);
      this.updateBPMDisplay();
      console.log(`TAP: Manual BPM set to ${robustBPM} for deck ${this.deckId} at ${currentTime.toFixed(1)}s (${intervals.length} intervals processed)`);
    }
  }

  // Robust BPM calculation with outlier detection
  calculateRobustBPM(intervals) {
    if (intervals.length === 0) return 120;
    
    // For small number of intervals, use simple average
    if (intervals.length < 4) {
      const avgInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
      return Math.round(60000 / avgInterval);
    }
    
    // Sort intervals to find median and quartiles
    const sortedIntervals = [...intervals].sort((a, b) => a - b);
    const median = this.getMedian(sortedIntervals);
    
    // Calculate MAD (Median Absolute Deviation) for robust outlier detection
    const deviations = intervals.map(interval => Math.abs(interval - median));
    const mad = this.getMedian(deviations.sort((a, b) => a - b));
    
    // Filter outliers using MAD-based method (more robust than standard deviation)
    // An interval is considered an outlier if it's more than 2.5 MADs from the median
    const threshold = 2.5 * mad;
    const filteredIntervals = intervals.filter(interval => 
      Math.abs(interval - median) <= threshold
    );
    
    // If too many intervals were filtered, fall back to median
    if (filteredIntervals.length < Math.max(2, intervals.length / 2)) {
      console.log(`TAP: Using median (${median}ms) - too many outliers detected for deck ${this.deckId}`);
      return Math.round(60000 / median);
    }
    
    // Use weighted average: give more weight to recent intervals and those closer to median
    let weightedSum = 0;
    let totalWeight = 0;
    
    for (let i = 0; i < filteredIntervals.length; i++) {
      const interval = filteredIntervals[i];
      // Recent intervals get higher weight (recency bias)
      const recencyWeight = (i + 1) / filteredIntervals.length;
      // Intervals closer to median get higher weight (consistency bias)
      const consistencyWeight = 1 - (Math.abs(interval - median) / (median + 1));
      // Combined weight
      const weight = recencyWeight * consistencyWeight;
      
      weightedSum += interval * weight;
      totalWeight += weight;
    }
    
    const robustAvgInterval = weightedSum / totalWeight;
    const robustBPM = Math.round(60000 / robustAvgInterval);
    
    console.log(`TAP: Filtered ${intervals.length - filteredIntervals.length} outliers for deck ${this.deckId}, median: ${median}ms, robust avg: ${robustAvgInterval.toFixed(1)}ms`);
    
    return robustBPM;
  }

  // Helper function to calculate median
  getMedian(sortedArray) {
    const length = sortedArray.length;
    if (length === 0) return 0;
    if (length % 2 === 0) {
      return (sortedArray[length / 2 - 1] + sortedArray[length / 2]) / 2;
    } else {
      return sortedArray[Math.floor(length / 2)];
    }
  }

  updateLoopToggleState(isActive) {
    const loopToggleButton = document.getElementById(`loopToggle${this.deckId}`);
    loopToggleButton.classList.toggle('active', isActive);
  }

  updateLoopInState(isActive) {
    const loopInButton = document.getElementById(`loopIn${this.deckId}`);
    loopInButton.classList.toggle('active', isActive);
  }

  updateLoopOutState(isActive) {
    const loopOutButton = document.getElementById(`loopOut${this.deckId}`);
    loopOutButton.classList.toggle('active', isActive);
  }

  updateLoopButtonsDisabledState(disabled) {
    const loopInButton = document.getElementById(`loopIn${this.deckId}`);
    const loopOutButton = document.getElementById(`loopOut${this.deckId}`);
    loopInButton.classList.toggle('disabled', disabled);
    loopOutButton.classList.toggle('disabled', disabled);
  }
}
