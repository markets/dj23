class Deck {
  /** Pitch fader travel, in percent either side of zero. */
  static PITCH_RANGES = [8, 16, 32, 64];
  static DEFAULT_PITCH_RANGE = 32;

  /** How much of the track is kept reversed for backwards scratching. */
  static REVERSE_WINDOW_SECONDS = 5;

  /** Fade over a source restart, long enough to hide the step, short enough
   *  not to be heard as a gap. */
  static DECLICK_SECONDS = 0.005;

  /** Time constant the scratch rate glides over, instead of stepping. */
  static RATE_GLIDE_SECONDS = 0.004;

  /**
   * How much track the scratch head is handed. It has to be copied, so a whole
   * track would mean holding a second one; no gesture covers twenty seconds.
   */
  static SCRATCH_WINDOW_SECONDS = 20;

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
    this.sourceGain = null;

    this.isPlaying = false;
    this.isPaused = false;
    this.startTime = 0;
    this.pauseTime = 0;
    this.playbackRate = 1;
    this.volume = 0.75;
    this.pitchRange = Deck.DEFAULT_PITCH_RANGE;

    this.lastRateChangeTime = 0;
    this.lastRateChangePosition = 0;
    this.previousPlaybackRate = 1;

    this.isPreListenEnabled = false;

    this.bpmAnalyzer = new BPMAnalyzer(audioContext, deckId);

    // Rate the platter is imposing while the record is held, null when the
    // pitch fader is back in charge. See Platter in js/vinyl.js.
    this.scratchRate = null;
    this.isReversed = false;
    this.reverseWindow = null;

    // The worklet read head, used only while the record is held. Normal
    // playback stays on the buffer source, so this is allowed to be missing:
    // if the module never loads, scratching falls back to splicing sources.
    this.scratchHead = null;
    this.scratchHeadLoading = null;
    this.isScratchHeadEngaged = false;
    this.scratchHeadPosition = 0;
    this.scratchWindow = null;

    this.isPitchBending = false;
    this.originalPitchBeforeBend = undefined;

    this.isBackSpinning = false;

    this.cuePoints = { 1: null, 2: null };
    this.isCueActive = false; // Track if CUE is currently being held/active
    this.defaultCuePoint = null; // Auto-set cue point for when no manual cue points exist

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
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = this.volume;

    this.cueGainNode = this.audioContext.createGain();
    this.cueGainNode.gain.value = 0; // Start with pre-listen disabled

    this.globalGainNode = this.audioContext.createGain();
    this.globalGainNode.gain.value = 1.0;

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
      // Drop the old track first so both buffers are never held at once
      this.audioBuffer = null;
      this.reverseWindow = null;

      const arrayBuffer = await file.arrayBuffer();
      this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    } catch (error) {
      console.error('Error loading audio file:', error);
      return false;
    }

    // Best-effort: this is the memory-hungry part, and losing it costs only the
    // BPM readout, which TAP can fill in.
    try {
      this.bpmAnalyzer.calculateBPM(this.audioBuffer);
      this.bpmAnalyzer.generateBeatMap(this.audioBuffer);
    } catch (error) {
      console.error('Beat analysis failed, BPM unknown — use TAP:', error);
    }

    this.prepareScratchHead();

    return true;
  }

  findNearestBeat(currentTime) {
    return this.bpmAnalyzer.findNearestBeat(currentTime);
  }

  getNextBeat(currentTime) {
    return this.bpmAnalyzer.getNextBeat(currentTime);
  }

  getPreviousBeat(currentTime) {
    return this.bpmAnalyzer.getPreviousBeat(currentTime);
  }

  // Beat times in seconds, empty while the BPM is unknown
  getBeatPositions() {
    return this.bpmAnalyzer.beatPositions;
  }

  play() {
    if (!this.audioBuffer) return;

    // Store the pauseTime before stopping, since stop() will reset it
    const resumeTime = this.isPaused ? this.pauseTime : 0;

    this.stopSource(); // Use stopSource instead of stop() to preserve pause state

    this.isReversed = false;
    this.source = this.audioContext.createBufferSource();
    this.source.buffer = this.audioBuffer;
    this.applySourceRate();

    this.connectSource();

    this.source.start(0, resumeTime);
    this.startTime = this.audioContext.currentTime - resumeTime;
    
    this.lastRateChangeTime = this.audioContext.currentTime;
    this.lastRateChangePosition = resumeTime;
    this.previousPlaybackRate = this.playbackRate;
    
    this.isPlaying = true;
    this.isPaused = false;
  }

  connectSource() {
    this.connectFrom(this.source);
  }

  /** Wire whatever is producing audio through effects, EQ and out to both buses. */
  connectFrom(origin) {
    // Its own gain: globalGainNode is the EQ's GAIN band, which the VU meters
    // read, so fading on it would move the user's knob
    this.sourceGain = this.audioContext.createGain();

    // A restart opens mid-waveform, and that step is the click. Fading in from
    // zero removes it; the outgoing source is still cut abruptly, since the
    // shared effect chain cannot carry both at once.
    const now = this.audioContext.currentTime;
    this.sourceGain.gain.setValueAtTime(0, now);
    this.sourceGain.gain.linearRampToValueAtTime(1, now + Deck.DECLICK_SECONDS);

    origin.connect(this.sourceGain);
    this.sourceGain.connect(this.effectNodes.filter);
    this.effectNodes.filter.connect(this.eqNodes.low);
    this.eqNodes.low.connect(this.eqNodes.mid);
    this.eqNodes.mid.connect(this.eqNodes.high);

    this.eqNodes.high.connect(this.splitter);

    // Main dry signal path
    this.eqNodes.high.connect(this.globalGainNode);
    this.globalGainNode.connect(this.gainNode);

    this.splitter.connect(this.effectNodes.reverb);
    this.effectNodes.reverb.connect(this.effectNodes.reverbGain);
    this.effectNodes.reverbGain.connect(this.globalGainNode);

    this.splitter.connect(this.effectNodes.delay);
    this.effectNodes.delayGain.connect(this.globalGainNode);

    if (this.effectNodes.phaser && this.effectNodes.phaser.length > 0) {
      let phaserInput = this.splitter;

      for (let i = 0; i < this.effectNodes.phaser.length; i++) {
        phaserInput.connect(this.effectNodes.phaser[i]);
        phaserInput = this.effectNodes.phaser[i];
      }

      phaserInput.connect(this.effectNodes.phaserGain);
      this.effectNodes.phaserGain.connect(this.globalGainNode);
    }

    if (this.effectNodes.flanger) {
      this.splitter.connect(this.effectNodes.flanger);
      this.effectNodes.flanger.connect(this.effectNodes.flangerGain);
      this.effectNodes.flangerGain.connect(this.globalGainNode);
    }

    this.globalGainNode.connect(this.gainNode);
    this.globalGainNode.connect(this.cueGainNode);
    
    this.gainNode.connect(this.mainOutput);
    this.cueGainNode.connect(this.cueOutput);
  }

  /**
   * The reversed window plays forwards through backwards audio, so the source
   * takes the size of the rate and the sign stays with the reported position.
   */
  applySourceRate() {
    if (!this.source) return;

    const rate = this.getEffectiveRate();
    const target = this.isReversed ? Math.abs(rate) : rate;
    const param = this.source.playbackRate;

    // Stepping the rate once a frame is audible as zipper noise, so under a hand
    // it glides. The pitch fader still gets an exact value.
    if (this.scratchRate === null) {
      param.cancelScheduledValues(this.audioContext.currentTime);
      param.value = target;
      return;
    }

    param.setTargetAtTime(target, this.audioContext.currentTime, Deck.RATE_GLIDE_SECONDS);
  }

  /**
   * A reversed copy of a short stretch around `position`, built on demand.
   * Reversing a whole track, as the back-spin does, costs a hundred-odd
   * megabytes; five seconds costs under two.
   */
  ensureReverseWindow(position) {
    const existing = this.reverseWindow;
    if (existing && position <= existing.endTime && position >= existing.startTime) {
      return existing;
    }

    const duration = this.getDuration();
    // A little lead, so a stroke turning around here still has audio ahead
    const endTime = Math.min(duration, position + 0.25);
    const startTime = Math.max(0, endTime - Deck.REVERSE_WINDOW_SECONDS);
    if (endTime - startTime < 0.05) return null;

    const rate = this.audioBuffer.sampleRate;
    const firstSample = Math.floor(startTime * rate);
    const length = Math.floor((endTime - startTime) * rate);
    const channels = this.audioBuffer.numberOfChannels;

    const buffer = this.audioContext.createBuffer(channels, length, rate);
    for (let channel = 0; channel < channels; channel++) {
      const source = this.audioBuffer.getChannelData(channel);
      const target = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        target[i] = source[firstSample + length - 1 - i];
      }
    }

    this.reverseWindow = { buffer, startTime, endTime };
    return this.reverseWindow;
  }

  /** Play backwards from `position`, for when the worklet head is unavailable. */
  playReverseFrom(position) {
    if (!this.audioBuffer) return;

    const window = this.ensureReverseWindow(position);
    if (!window) return;

    this.stopSource();

    this.isReversed = true;
    this.source = this.audioContext.createBufferSource();
    this.source.buffer = window.buffer;
    this.applySourceRate();

    this.connectSource();

    // Mirrored: later in the track is earlier in the reversed window
    this.source.start(0, Math.max(0, window.endTime - position));

    this.lastRateChangeTime = this.audioContext.currentTime;
    this.lastRateChangePosition = position;
    this.isPlaying = true;
    this.isPaused = false;
  }

  /**
   * Build the worklet read head, at track load so the first grab does not wait
   * on the module fetch. Any failure leaves scratching on the spliced path.
   */
  prepareScratchHead() {
    if (this.scratchHead || this.scratchHeadLoading) return this.scratchHeadLoading;

    this.scratchHeadLoading = this.audioContext.audioWorklet
      .addModule('js/scratch-head.js')
      .then(() => {
        this.scratchHead = new AudioWorkletNode(this.audioContext, 'scratch-head', {
          numberOfInputs: 0,
          outputChannelCount: [2]
        });

        this.scratchHead.port.onmessage = ({ data }) => {
          if (this.scratchWindow) {
            this.scratchHeadPosition = this.scratchWindow.startTime + data.position;
          }
        };
      })
      .catch((error) => {
        console.warn(`Deck ${this.deckId}: no worklet read head, scratching stays spliced:`, error);
      });

    return this.scratchHeadLoading;
  }

  scratchHeadAvailable() {
    return Boolean(this.scratchHead && this.audioBuffer);
  }

  /** Copy the stretch of track around `position` over to the read head. */
  loadScratchWindow(position) {
    const sampleRate = this.audioBuffer.sampleRate;
    const half = Deck.SCRATCH_WINDOW_SECONDS / 2;
    const startTime = Math.max(0, Math.min(position - half, this.getDuration() - Deck.SCRATCH_WINDOW_SECONDS));
    const clampedStart = Math.max(0, startTime);
    const endTime = Math.min(this.getDuration(), clampedStart + Deck.SCRATCH_WINDOW_SECONDS);

    const first = Math.floor(clampedStart * sampleRate);
    const length = Math.max(1, Math.floor((endTime - clampedStart) * sampleRate));

    const channels = [];
    for (let channel = 0; channel < this.audioBuffer.numberOfChannels; channel++) {
      // A copy: handing over the AudioBuffer's own view would detach it
      const copy = new Float32Array(
        this.audioBuffer.getChannelData(channel).subarray(first, first + length)
      );
      channels.push(copy.buffer);
    }

    this.scratchWindow = { startTime: clampedStart, endTime };
    this.scratchHeadPosition = position;
    this.scratchHead.port.postMessage(
      { type: 'load', channels, position: position - clampedStart },
      channels
    );
  }

  /** Hand the read head over to the worklet, from `position`. */
  engageScratchHead(position) {
    if (!this.scratchHeadAvailable()) return false;

    this.stopSource();
    this.loadScratchWindow(position);
    this.connectFrom(this.scratchHead);
    this.scratchHead.port.postMessage({ type: 'start' });

    this.isScratchHeadEngaged = true;
    this.isReversed = false;
    this.isPlaying = true;
    this.isPaused = false;
    return true;
  }

  /** Signed, and free to be zero or negative: that is the whole point of it. */
  setScratchHeadRate(rate) {
    if (!this.isScratchHeadEngaged) return;

    this.scratchRate = rate;
    this.scratchHead.parameters.get('rate')
      .setTargetAtTime(rate, this.audioContext.currentTime, Deck.RATE_GLIDE_SECONDS);
  }

  /** Pull the head back onto the hand when the two have drifted apart. */
  nudgeScratchHead(position) {
    if (!this.isScratchHeadEngaged || !this.scratchWindow) return;

    this.scratchHead.port.postMessage({
      type: 'seek',
      position: position - this.scratchWindow.startTime
    });
    this.scratchHeadPosition = position;
  }

  /** Slide the window along when a long drag approaches its edge. */
  keepScratchWindow(position) {
    if (!this.isScratchHeadEngaged || !this.scratchWindow) return;

    const { startTime, endTime } = this.scratchWindow;
    const margin = 2;
    const atStart = startTime > 0 && position - startTime < margin;
    const atEnd = endTime < this.getDuration() && endTime - position < margin;

    if (atStart || atEnd) this.loadScratchWindow(position);
  }

  /** Take the head back, and report where the record ended up. */
  releaseScratchHead() {
    if (!this.isScratchHeadEngaged) return null;

    this.scratchHead.port.postMessage({ type: 'stop' });
    this.scratchHead.disconnect();
    this.isScratchHeadEngaged = false;
    this.scratchRate = null;

    return this.scratchHeadPosition;
  }

  pause() {
    if (this.isPlaying && !this.isPaused) {
      this.pauseTime = this.getCurrentTime();
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
    this.scratchRate = null;
  }

  stopSource() {
    if (this.source) {
      this.source.stop();
      this.source.disconnect();
      this.source = null;
    }

    if (this.sourceGain) {
      this.sourceGain.disconnect();
      this.sourceGain = null;
    }
    
    // Every node downstream, or connections accumulate across restarts and the
    // signal degrades
    if (this.globalGainNode) {
      this.globalGainNode.disconnect();
    }
    if (this.gainNode) {
      this.gainNode.disconnect();
      if (this.analyser) this.gainNode.connect(this.analyser);
    }
    
    if (this.eqNodes) {
      if (this.eqNodes.high) this.eqNodes.high.disconnect();
      if (this.eqNodes.mid) this.eqNodes.mid.disconnect();
      if (this.eqNodes.low) this.eqNodes.low.disconnect();
      if (this.eqNodes.filter) this.eqNodes.filter.disconnect();
    }
    
    if (this.splitter) this.splitter.disconnect();
    if (this.merger) this.merger.disconnect();

    if (this.effectNodes) {
      if (this.effectNodes.filter) this.effectNodes.filter.disconnect();
      if (this.effectNodes.reverbGain) this.effectNodes.reverbGain.disconnect();
      if (this.effectNodes.delayGain) this.effectNodes.delayGain.disconnect();
      if (this.effectNodes.phaserGain) this.effectNodes.phaserGain.disconnect();
      if (this.effectNodes.flangerGain) this.effectNodes.flangerGain.disconnect();
    }

  }

  setVolume(value) {
    this.volume = value / 100;
    if (this.gainNode) {
      this.gainNode.gain.value = this.volume;
    }

    window.mixerController.updateCueMixdown();
  }

  enablePreListen() {
    this.isPreListenEnabled = true;
    console.log(`Deck ${this.deckId}: Pre-listen enabled`);

    window.mixerController.updateCueMixdown();
  }

  disablePreListen() {
    this.isPreListenEnabled = false;
    console.log(`Deck ${this.deckId}: Pre-listen disabled`);

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

  /** Applies a pitch in percent, clamped to the configured range.
   *  Returns the value actually applied so callers can mirror it in the UI. */
  setPitch(value) {
    const pitch = Math.max(-this.pitchRange, Math.min(this.pitchRange, value));

    // Snapshot the position before the rate changes under it
    if (this.isPlaying) {
      const currentTime = this.getCurrentTime();
      this.lastRateChangeTime = this.audioContext.currentTime;
      this.lastRateChangePosition = currentTime;
      this.previousPlaybackRate = this.playbackRate;
    }

    this.playbackRate = 1 + (pitch / 100);
    this.applySourceRate();

    return pitch;
  }

  getPitch() {
    return (this.playbackRate - 1) * 100;
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

      const minFreq = 100; // 100Hz minimum (full filtering at 100%)
      const maxFreq = 15000; // 15kHz maximum (no filtering at 0%)
      
      // Inverted, as DJ filters are: 0% is open at 15 kHz, 100% closed at 100 Hz
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
    // Only the worklet knows where the record is; the estimate below assumes a
    // steady rate
    if (this.isScratchHeadEngaged) return this.scratchHeadPosition;

    if (!this.isPlaying) return this.isPaused ? this.pauseTime : 0;
    
    const currentWallClockTime = this.audioContext.currentTime;
    const wallClockElapsedSinceRateChange = currentWallClockTime - this.lastRateChangeTime;
    
    const audioTimeElapsedSinceRateChange = wallClockElapsedSinceRateChange * this.getEffectiveRate();
    
    return this.lastRateChangePosition + audioTimeElapsedSinceRateChange;
  }

  seek(time) {
    if (!this.audioBuffer) {
      console.log(`Deck ${this.deckId}: Cannot seek - no audio buffer loaded`);
      return;
    }

    const wasPlaying = this.isPlaying;
    const duration = this.getDuration();

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

  resetCuePoints() {
    this.cuePoints = { 1: null, 2: null };
    this.defaultCuePoint = null;
    console.log(`Deck ${this.deckId}: CUE points reset`);
  }

  resetLoopPoints() {
    if (this.isLooping) {
      this.stopLoopMonitoring();
      this.isLooping = false;
    }
    
    this.loopStart = null;
    this.loopEnd = null;
    this.originalLoopEnd = null;
    this.loopLengthPercentage = 100;
    
    this.controller.updateLoopInState(false, false);
    this.controller.updateLoopOutState(false);
    
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

  jumpToNextBeat() {
    if (!this.audioBuffer) {
      console.log(`Deck ${this.deckId}: Cannot jump to next beat - no audio buffer loaded`);
      return;
    }
    
    const currentTime = this.getCurrentTime();
    const nextBeatTime = this.getNextBeat(currentTime);
    this.seek(nextBeatTime);
    console.log(`Deck ${this.deckId}: Jumped to next beat at ${nextBeatTime.toFixed(3)}s`);
  }

  jumpToPreviousBeat() {
    if (!this.audioBuffer) {
      console.log(`Deck ${this.deckId}: Cannot jump to previous beat - no audio buffer loaded`);
      return;
    }
    
    const currentTime = this.getCurrentTime();
    const previousBeatTime = this.getPreviousBeat(currentTime);
    this.seek(previousBeatTime);
    console.log(`Deck ${this.deckId}: Jumped to previous beat at ${previousBeatTime.toFixed(3)}s`);
  }

  getLastCueTime() {
    if (this.cuePoints[2] !== null) return this.cuePoints[2];
    if (this.cuePoints[1] !== null) return this.cuePoints[1];
    
    if (this.defaultCuePoint !== null) {
      console.log(`Deck ${this.deckId}: Using default CUE at ${this.defaultCuePoint}s`);
      return this.defaultCuePoint;
    }
    
    return 0;
  }

  startCueMode() {
    if (!this.audioBuffer) return;
    
    this.ensureDefaultCuePoint();
    
    if (!this.isPlaying) {
      this.seek(this.getLastCueTime());
    }
    
    this.isCueActive = true;
    this.play();
    
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
    
    this.pause();
    this.seek(this.getLastCueTime());
    
    this.isCueActive = false;
    
    this.controller.updateCueState(false);
    
    console.log(`Deck ${this.deckId}: CUE mode stopped`);
  }

  setLoopIn() {
    if (this.loopStart !== null || this.loopEnd !== null) {
      this.isLooping = false;
      this.stopLoopMonitoring();
      this.loopStart = null;
      this.loopEnd = null;
      this.originalLoopEnd = null;
      this.loopLengthPercentage = 100;
      console.log(`Deck ${this.deckId}: Loop points cleared for fresh start`);
      
      this.controller.updateLoopInState(false);
      this.controller.updateLoopOutState(false);
      return;
    }
    
    this.loopStart = this.findNearestBeat(this.getCurrentTime());
    console.log(`Deck ${this.deckId}: Loop IN set at ${this.loopStart}s`);
    
    this.controller.updateLoopInState(true);
    this.controller.updateLoopOutState(false);
  }

  setLoopOut() {
    // If loop is already active and has both points set, clear loop points completely
    if (this.isLooping && this.loopStart !== null && this.loopEnd !== null) {
      this.isLooping = false;
      this.stopLoopMonitoring();
      this.loopStart = null;
      this.loopEnd = null;
      this.originalLoopEnd = null;
      this.loopLengthPercentage = 100;
      console.log(`Deck ${this.deckId}: Loop disabled and points cleared`);
      
      this.controller.updateLoopInState(false, false);
      this.controller.updateLoopOutState(false);
      return;
    }
    
    // Only allow setting OUT if IN is already set
    if (this.loopStart === null) {
      console.log(`Deck ${this.deckId}: Cannot set Loop OUT - Loop IN must be set first`);
      this.controller.updateLoopOutState(false);
      return;
    }
    
    this.loopEnd = this.findNearestBeat(this.getCurrentTime());
    this.originalLoopEnd = this.loopEnd; // Store original loop end
    this.loopLengthPercentage = 100; // Reset to 100% when setting new loop out
    console.log(`Deck ${this.deckId}: Loop OUT set at ${this.loopEnd}s`);
    
    this.isLooping = true;
    this.startLoopMonitoring();
    console.log(`Deck ${this.deckId}: Loop started automatically`);
    
    // Show only OUT as active (indicates active loop) and disable IN button
    this.controller.updateLoopInState(false, true);
    this.controller.updateLoopOutState(true);
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

  /** The platter's rate while the record is held, the pitch fader's otherwise. */
  getEffectiveRate() {
    return this.scratchRate === null ? this.playbackRate : this.scratchRate;
  }

  /**
   * Hand the rate to the platter; null gives it back to the pitch fader.
   * `position` pins the reported head, which matters at rate zero — silent, but
   * still moving under a hand.
   */
  setScratchRate(rate, position = null) {
    if (this.isPlaying) {
      this.lastRateChangeTime = this.audioContext.currentTime;
      this.lastRateChangePosition = position === null ? this.getCurrentTime() : position;
    }

    this.scratchRate = rate;
    this.applySourceRate();
  }

  /**
   * Start at an exact position without disturbing transport state, so the
   * platter can restart mid-gesture. Unlike seek() it skips the stop() reset.
   */
  playFrom(position) {
    this.isReversed = false;
    this.pauseTime = position;
    this.isPaused = true;
    this.play();
  }

  /** Leave the deck stopped where the record was left, rather than at zero. */
  pauseAt(position) {
    this.stopSource();
    this.pauseTime = position;
    this.isPlaying = false;
    this.isPaused = true;
  }

  pitchBend(direction) {
    if (!this.isPitchBending) {
      this.originalPitchBeforeBend = this.getPitch();
      this.isPitchBending = true;
    }

    const bendAmount = direction > 0 ? 6 : -6; // +/- 6% pitch bend for more noticeable effect
    this.setPitch(this.originalPitchBeforeBend + bendAmount);
  }

  stopPitchBend() {
    if (this.isPitchBending && this.originalPitchBeforeBend !== undefined) {
      this.setPitch(this.originalPitchBeforeBend);
      this.isPitchBending = false;
      this.originalPitchBeforeBend = undefined;
    }
  }

  async startBackSpin() {
    if (this.isBackSpinning || !this.audioBuffer || !this.source) return;

    this.isBackSpinning = true;
    const currentTime = this.getCurrentTime();

    this.stopSource();

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

    this.source = this.audioContext.createBufferSource();
    this.source.buffer = reversedBuffer;

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

    const reversedStartTime = Math.max(0, reversedBuffer.duration - currentTime);
    this.source.start(now, reversedStartTime, duration);

    setTimeout(() => {
      this.isBackSpinning = false;
      this.controller.pause();
    }, duration * 1000);
  }

  getDuration() {
    return this.audioBuffer ? this.audioBuffer.duration : 0;
  }

  getBPM() {
    return this.bpmAnalyzer.getBPM(this.playbackRate);
  }

  getBaseBPM() {
    return this.bpmAnalyzer.getBaseBPM();
  }

  getAudioStartOffset() {
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

  getGlobalGain() {
    return this.globalGainNode ? this.globalGainNode.gain.value : 1.0;
  }
}

class DeckController {
  /** Decks currently decoding, so other work can wait its turn. */
  static loadsInFlight = 0;

  constructor(deckId) {
    this.deckId = deckId;
    this.isScratching = false;
    this.vinylElement = null;
    
    // TAP functionality - stores intervals between taps in rolling window
    this.tapIntervals = [];
    this.lastTapTime = null;
    this.tapTimeout = null;
    
    this.setupEventListeners();
    
    this.effectsController = new EffectsController(deckId);
  }

  resetTapState() {
    this.tapTimes = [];
    if (this.tapTimeout) {
      clearTimeout(this.tapTimeout);
      this.tapTimeout = null;
    }
  }

  createDeckMethodHandler(buttonName, deckMethod, ...args) {
    window.buttonHandler.createClickHandler(`${buttonName}${this.deckId}`, () => {
      window.buttonHandler.callDeckMethod(this.deckId, deckMethod, ...args);
    });
  }

  createControllerMethodHandler(buttonName, controllerMethod) {
    window.buttonHandler.createClickHandler(`${buttonName}${this.deckId}`, () => {
      this[controllerMethod]();
    });
  }

  createSliderHandler(sliderId, deckMethod, displayOptions = {}) {
    const slider = document.getElementById(sliderId);
    if (!slider) return;

    slider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck && typeof deck[deckMethod] === 'function') {
        deck[deckMethod](value);
      }

      if (displayOptions.updateDisplay !== false) {
        const displayElement = displayOptions.displayElement || e.target.nextElementSibling;
        if (displayElement) {
          const suffix = displayOptions.suffix || '';
          displayElement.textContent = `${value}${suffix}`;
        }
      }

      if (displayOptions.callback && typeof displayOptions.callback === 'function') {
        displayOptions.callback(value);
      }
    });
  }

  setupEventListeners() {
    const fileInput = document.getElementById(`fileInput${this.deckId}`);
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        await this.loadTrack(file);
      }
    });

    this.setupDragAndDrop();

    this.createControllerMethodHandler('play', 'play');
    this.createControllerMethodHandler('pause', 'pause');
    this.createControllerMethodHandler('stop', 'stop');

    this.createDeckMethodHandler('backSpin', 'startBackSpin');

    window.buttonHandler.createPressAndHoldHandler(
      `cue${this.deckId}`,
      () => {
        window.buttonHandler.callDeckMethod(this.deckId, 'startCueMode');
      },
      () => {
        window.buttonHandler.callDeckMethod(this.deckId, 'stopCueMode');
      }
    );

    // The vinyl is grabbable through Platter (js/vinyl.js); all this needs is
    // the element, for the spin animation
    this.vinylElement = document.getElementById(`vinyl${this.deckId}`);

    this.createSliderHandler(`pitch${this.deckId}`, 'setPitch', {
      displayElement: document.getElementById(`pitchDisplay${this.deckId}`),
      suffix: '%',
      callback: () => this.updateBPMDisplay()
    });

    ['high', 'mid', 'low', 'gain'].forEach(band => {
      this.createSliderHandler(`${band}${this.deckId}`, 'setEQ', {
        updateDisplay: false, // We'll handle display manually because setEQ needs band parameter
        callback: (value) => {
          const deck = window.audioEngine.getDeck(this.deckId);
          if (deck) {
            deck.setEQ(band, value);
          }
          const slider = document.getElementById(`${band}${this.deckId}`);
          if (slider && slider.parentNode && slider.parentNode.nextElementSibling) {
            slider.parentNode.nextElementSibling.textContent = value;
          }
        }
      });

      window.buttonHandler.createPressAndHoldHandler(
        `${band}Kill${this.deckId}`,
        () => {
          const deck = window.audioEngine.getDeck(this.deckId);
          const slider = document.getElementById(`${band}${this.deckId}`);
          if (deck && slider) {
            slider.dataset.originalValue = slider.value;
            // Set to minimum value (-25) to "kill" the band
            slider.value = -25;
            deck.setEQ(band, -25);
            if (slider.parentNode && slider.parentNode.nextElementSibling) {
              slider.parentNode.nextElementSibling.textContent = '-25';
            }
          }
        },
        () => {
          const deck = window.audioEngine.getDeck(this.deckId);
          const slider = document.getElementById(`${band}${this.deckId}`);
          if (deck && slider && slider.dataset.originalValue !== undefined) {
            const originalValue = parseInt(slider.dataset.originalValue);
            slider.value = originalValue;
            deck.setEQ(band, originalValue);
            if (slider.parentNode && slider.parentNode.nextElementSibling) {
              slider.parentNode.nextElementSibling.textContent = originalValue.toString();
            }
            delete slider.dataset.originalValue;
          }
        },
        { updateActiveState: true }
      );

      window.buttonHandler.createClickHandler(`${band}Reset${this.deckId}`, () => {
        const deck = window.audioEngine.getDeck(this.deckId);
        const slider = document.getElementById(`${band}${this.deckId}`);
        if (deck && slider) {
          slider.value = 0;
          deck.setEQ(band, 0);
          if (slider.parentNode && slider.parentNode.nextElementSibling) {
            slider.parentNode.nextElementSibling.textContent = '0';
          }
        }
      });
    });

    this.createSliderHandler(`volume${this.deckId}`, 'setVolume', { suffix: '%' });

    ['filter', 'reverb', 'delay', 'phaser', 'flanger'].forEach(effect => {
      this.createSliderHandler(`${effect}${this.deckId}`, `set${effect.charAt(0).toUpperCase() + effect.slice(1)}`);
    });

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

    window.buttonHandler.createClickHandler(`pitchReset${this.deckId}`, () => {
      this.resetPitch();
    });

    this.createDeckMethodHandler('cue1', 'jumpToCue', 1);
    this.createDeckMethodHandler('cue2', 'jumpToCue', 2);
    this.createDeckMethodHandler('setCue1', 'setCuePoint', 1);
    this.createDeckMethodHandler('setCue2', 'setCuePoint', 2);

    this.createDeckMethodHandler('previousBeat', 'jumpToPreviousBeat');
    this.createDeckMethodHandler('nextBeat', 'jumpToNextBeat');

    this.createControllerMethodHandler('tap', 'handleTap');

    this.createDeckMethodHandler('loopIn', 'setLoopIn');
    this.createDeckMethodHandler('loopOut', 'setLoopOut');
    this.createSliderHandler(`loopLength${this.deckId}`, 'setLoopLength', {
      displayElement: document.getElementById(`loopLengthValue${this.deckId}`),
      suffix: '%'
    });

    this.createControllerMethodHandler('resetFilters', 'resetFilters');
  }

  setupDragAndDrop() {
    const deckElement = document.getElementById(`deck${this.deckId}`);
    if (!deckElement) return;

    const isAudioFile = (file) => {
      return file && file.type && file.type.startsWith('audio/');
    };

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      deckElement.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    deckElement.addEventListener('dragenter', (e) => {
      if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        deckElement.classList.add('drag-active');
      }
    });

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
          deckElement.classList.add('drag-invalid');
          deckElement.classList.remove('drag-over');
        }
      }
    });

    deckElement.addEventListener('dragleave', (e) => {
      // Only remove classes if we're leaving the deck element itself
      // (not just moving between child elements)
      if (!deckElement.contains(e.relatedTarget)) {
        deckElement.classList.remove('drag-active', 'drag-over', 'drag-invalid');
      }
    });

    deckElement.addEventListener('drop', async (e) => {
      deckElement.classList.remove('drag-active', 'drag-over', 'drag-invalid');
      
      const files = Array.from(e.dataTransfer.files);
      
      if (files.length === 0) return;
      
      const audioFile = files.find(isAudioFile);
      
      if (audioFile) {
        await this.loadTrack(audioFile);
        
        console.log(`Deck ${this.deckId}: Successfully loaded track via drag and drop: ${audioFile.name}`);
      } else {
        deckElement.classList.add('drag-invalid');
        setTimeout(() => {
          deckElement.classList.remove('drag-invalid');
        }, 2000);
        
        const trackInfo = document.getElementById(`trackInfo${this.deckId}`);
        const originalContent = trackInfo.innerHTML;
        trackInfo.style.color = Theme.color('color-secondary');
        trackInfo.innerHTML = '<div class="track-details"><div class="track-name">Invalid file type</div><div class="track-time">Audio files only</div></div>';
        
        setTimeout(() => {
          trackInfo.style.color = '';
          trackInfo.innerHTML = originalContent;
        }, 3000);
        
        console.warn(`Deck ${this.deckId}: No valid audio files found. Supported types: audio/*. Found: ${files.map(f => f.name + ' (' + (f.type || 'unknown') + ')').join(', ')}`);
      }
    });
  }

  async loadTrack(file, knownKey = null) {
    await window.audioEngine.initialize();
        
    const deck = window.audioEngine.getDeck(this.deckId);
    const trackInfo = document.getElementById(`trackInfo${this.deckId}`);
        
    this.stop();
    
    this.resetTapState();
    
    // Reset pitch to 0% when loading new track for consistent BPM calculation
    this.resetPitch();
        
    trackInfo.classList.add('loading');
    trackInfo.querySelector('.track-name').textContent = 'Loading...';

    // Background analysis steps aside while this runs: the user is waiting on
    // this decode, and two at once doubles the peak memory
    DeckController.loadsInFlight++;

    try {
      const success = await deck.loadFile(file);

      if (success) {
        deck.resetCuePoints();
      
        deck.resetLoopPoints();
      
        const loopLengthSlider = document.getElementById(`loopLength${this.deckId}`);
        const loopLengthDisplay = document.getElementById(`loopLengthValue${this.deckId}`);
        if (loopLengthSlider) loopLengthSlider.value = 100;
        if (loopLengthDisplay) loopLengthDisplay.textContent = '100%';
      
        await this.extractAndDisplayMetadata(file);
        this.updateTrackTime();
            
        const waveformRenderer = window.waveformRenderers[this.deckId];
        await waveformRenderer.generateWaveform(deck.audioBuffer);
      
        const beatWaveformRenderer = window.beatWaveformRenderers[this.deckId];
        await beatWaveformRenderer.generateWaveform(deck.audioBuffer);
            
        this.updateBPMDisplay();
        this.showKey(knownKey);
        // Not awaited: the deck is usable now, and the key arrives when it does
        if (!knownKey) this.detectKey(deck.audioBuffer);
      } else {
        trackInfo.querySelector('.track-name').textContent = 'Failed to load';
      }
    } finally {
      DeckController.loadsInFlight--;
      // Whatever happened, never leave the deck stuck in the loading shimmer
      trackInfo.classList.remove('loading');
    }
  }

  async extractAndDisplayMetadata(file) {
    return new Promise((resolve) => {
      const self = this;
      
      const deck = window.audioEngine.getDeck(self.deckId);
      
      window.jsmediatags.read(file, {
        onSuccess: (tag) => {
          const tags = tag.tags;
          let displayTitle = '';
          
          const artist = tags.artist || '';
          const title = tags.title || '';
          const album = tags.album || '';
          
          if (artist && title) {
            displayTitle = `${artist} - ${title}`;
          } else if (title) {
            displayTitle = title;
          } else {
            displayTitle = self.parseFilenameForMetadata(file.name);
          }
          
          const trackNameElement = document.querySelector(`#trackInfo${self.deckId} .track-name`);
          trackNameElement.textContent = displayTitle;
          
          if (album) {
            trackNameElement.title = `Album: ${album}`;
          }
          
          self.displayAlbumCover(tags.picture);
          
          resolve();
        },
        onError: (error) => {
          console.log('Metadata extraction failed:', error);
          const trackNameElement = document.querySelector(`#trackInfo${self.deckId} .track-name`);
          trackNameElement.textContent = self.parseFilenameForMetadata(file.name);
          self.displayAlbumCover(null);
          resolve();
        }
      });
    });
  }

  parseFilenameForMetadata(filename) {
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
    
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
    
    return nameWithoutExt.trim();
  }

  displayAlbumCover(pictureData) {
    const albumCoverElement = document.getElementById(`albumCover${this.deckId}`);
    
    if (pictureData && pictureData.data) {
      try {
        const byteArray = new Uint8Array(pictureData.data);
        const blob = new Blob([byteArray], { type: pictureData.format });
        const imageUrl = URL.createObjectURL(blob);
        
        albumCoverElement.src = imageUrl;
        albumCoverElement.style.display = 'block';
        
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
      if (this.vinylElement && !this.isScratching) {
        this.vinylElement.classList.add('spinning');
      }
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
      if (this.vinylElement) {
        this.vinylElement.classList.remove('spinning');
      }
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

  /** Key off the worker, so loading a track never waits on it. */
  async detectKey(audioBuffer) {
    const { key } = await window.trackAnalyser.analyse(audioBuffer, { tempo: false });

    // Another track may have landed while this was out
    if (window.audioEngine.getDeck(this.deckId)?.audioBuffer !== audioBuffer) return;

    this.showKey(key);
  }

  showKey(key) {
    const element = document.getElementById(`trackKey${this.deckId}`);
    if (!element) return;

    element.textContent = key ? key.camelot : '';
    element.title = key ? key.name : '';
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

    deck.setPitch(0);
    
    document.getElementById(`pitch${this.deckId}`).value = 0;
    document.getElementById(`pitchDisplay${this.deckId}`).textContent = '0%';
    
    this.updateBPMDisplay();
  }

  updateBPMDisplay() {
    const deck = window.audioEngine.getDeck(this.deckId);
    if (!deck || !deck.audioBuffer) return;

    const baseBPM = deck.getBaseBPM(); // Get the original BPM

    // A zero BPM means detection didn't get there — show it as unknown so the
    // TAP button reads as the thing to do, rather than displaying a made-up number
    document.getElementById(`bpm${this.deckId}`).textContent =
      baseBPM > 0 ? Math.round(baseBPM * deck.playbackRate) : '--';
  }

  handleTap() {
    const now = Date.now();
    const deck = window.audioEngine.getDeck(this.deckId);

    if (!this.tapIntervals) {
      this.tapIntervals = [];
    }

    if (this.lastTapTime) {
      const interval = now - this.lastTapTime;
      this.tapIntervals.push(interval);
      
      this.tapIntervals = this.tapIntervals.slice(-8);
    }
    
    this.lastTapTime = now;
    
    const tapButton = document.getElementById(`tap${this.deckId}`);
    tapButton.classList.add('active');
    
    if (this.tapTimeout) {
      clearTimeout(this.tapTimeout);
    }
    
    this.tapTimeout = setTimeout(() => {
      tapButton.classList.remove('active');
    }, 150);
    
    // Need at least 2 intervals to calculate BPM
    if (this.tapIntervals.length < 2) return;
    
    // Apply outlier filtering and calculate BPM
    const bpm = this.calculateTapBPM(this.tapIntervals);
    
    // Validate BPM range
    if (bpm >= 60 && bpm <= 200) {
      deck.bpmAnalyzer.setBPM(bpm, deck.audioBuffer);
      // Update the manual tap time with current playback time for refinement protection
      const currentTime = deck.getCurrentTime();
      deck.bpmAnalyzer.updateManualTapTime(currentTime);
      this.updateBPMDisplay();
      console.log(`TAP: Manual BPM set to ${bpm} for deck ${this.deckId} at ${currentTime.toFixed(1)}s (${this.tapIntervals.length} intervals)`);
    }
  }

  // BPM calculation using median-first approach with outlier filtering
  // Accounts for pitch changes by converting system time intervals to audio time
  calculateTapBPM(intervals) {
    if (intervals.length === 0) return 120;
    
    const deck = window.audioEngine.getDeck(this.deckId);
    const playbackRate = deck ? deck.playbackRate : 1.0;
    
    // Convert system time intervals to audio time intervals
    // When pitch is +10% (rate=1.1), audio progresses faster, so system intervals need to be stretched
    const audioIntervals = intervals.map(interval => interval * playbackRate);
    
    // Sort intervals to find median
    const sortedIntervals = [...audioIntervals].sort((a, b) => a - b);
    const medianInterval = this.getMedian(sortedIntervals);
    
    // If we only have 1 interval, use it directly
    if (audioIntervals.length === 1) {
      return Math.round(60000 / medianInterval);
    }
    
    // Filter outliers: remove intervals that deviate more than 25% from median
    const deviationThreshold = 0.25;
    const filteredIntervals = audioIntervals.filter(interval => {
      const deviation = Math.abs(interval - medianInterval) / medianInterval;
      return deviation <= deviationThreshold;
    });
    
    // If no intervals pass the filter, use the median
    if (filteredIntervals.length === 0) {
      console.log(`TAP: Using median interval (${medianInterval.toFixed(1)}ms) - all intervals were outliers for deck ${this.deckId}`);
      return Math.round(60000 / medianInterval);
    }
    
    // Use median of filtered intervals for final BPM calculation
    const finalSortedIntervals = [...filteredIntervals].sort((a, b) => a - b);
    const finalMedianInterval = this.getMedian(finalSortedIntervals);
    const bpm = Math.round(60000 / finalMedianInterval);
    
    console.log(`TAP: Used ${filteredIntervals.length}/${intervals.length} intervals for deck ${this.deckId}, playback rate: ${playbackRate.toFixed(2)}, audio median: ${finalMedianInterval.toFixed(1)}ms, BPM: ${bpm}`);
    
    return bpm;
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

  updateLoopInState(isActive, disabled = false) {
    const loopInButton = document.getElementById(`loopIn${this.deckId}`);
    loopInButton.classList.toggle('active', isActive);
    loopInButton.classList.toggle('disabled', disabled);
  }

  updateLoopOutState(isActive) {
    const loopOutButton = document.getElementById(`loopOut${this.deckId}`);
    loopOutButton.classList.toggle('active', isActive);
  }
}
