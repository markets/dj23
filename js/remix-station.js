/**
 * A small, sample-based drum machine mixed directly into the master bus.
 *
 * Web Audio sources are scheduled slightly ahead of the playhead. UI timers
 * are allowed to be late; audio is not. Deck sync follows tempo continuously,
 * while RESYNC is the deliberate way to choose a new downbeat after a seek.
 */
class RemixStationEngine {
  static STEPS = 16;
  static LOOKAHEAD_SECONDS = 0.1;
  static SCHEDULER_MS = 25;
  static DEFAULT_BPM = 124;
  static MIN_BPM = 60;
  static MAX_BPM = 200;

  static LANE_DEFINITIONS = [
    {
      id: 'kick',
      label: 'Kick',
      url: 'sounds/remix/kick.mp3',
      steps: [0, 4, 8, 12],
      volume: 0.9
    },
    {
      id: 'snare',
      label: 'Snare',
      url: 'sounds/remix/snare.mp3',
      steps: [4, 12],
      volume: 0.78
    },
    {
      id: 'hihat',
      label: 'Hi-hat',
      url: 'sounds/remix/hihat.mp3',
      steps: [2, 6, 10, 14],
      volume: 0.58
    },
    {
      id: 'custom',
      label: 'Custom',
      url: null,
      steps: [],
      volume: 0.8
    }
  ];

  constructor(audioEngine) {
    this.audioEngine = audioEngine;
    this.audioContext = audioEngine.audioContext;
    this.manualBpm = RemixStationEngine.DEFAULT_BPM;
    this.syncSource = 'manual';
    this.isPlaying = false;
    this.currentStep = 0;
    this.nextStepTime = 0;
    this.schedulerId = null;
    this.rollSchedulerId = null;
    this.selectedLane = 'kick';
    this.rollDivision = null;
    this.nextRollTime = 0;
    this.echoDivision = 8;
    this.echoAmount = 0.58;
    this.reverbAmount = 0.55;
    this.uiTimers = new Set();
    this.activeSources = new Set();

    this.onStep = null;
    this.onTransportChange = null;

    this.lanes = {};
    RemixStationEngine.LANE_DEFINITIONS.forEach(definition => {
      this.lanes[definition.id] = {
        ...definition,
        buffer: null,
        muted: false,
        steps: Array.from({ length: RemixStationEngine.STEPS }, (_, step) =>
          definition.steps.includes(step))
      };
    });

    this.createAudioGraph();
    this.audioEngine.remixStation = this;
  }

  createAudioGraph() {
    const context = this.audioContext;

    this.inputBus = context.createGain();
    this.dryGain = context.createGain();
    this.outputGain = context.createGain();
    this.limiter = context.createDynamicsCompressor();
    this.outputGain.gain.value = 0.78;
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 8;
    this.limiter.ratio.value = 6;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.15;

    this.inputBus.connect(this.dryGain);
    this.dryGain.connect(this.outputGain);

    this.echoSend = context.createGain();
    this.echoSend.gain.value = 0;
    this.echoDelay = context.createDelay(2);
    this.echoTone = context.createBiquadFilter();
    this.echoTone.type = 'lowpass';
    this.echoTone.frequency.value = 4200;
    this.echoFeedback = context.createGain();
    this.echoFeedback.gain.value = 0.48;
    this.echoWet = context.createGain();
    this.echoWet.gain.value = this.echoAmount;

    this.inputBus.connect(this.echoSend);
    this.echoSend.connect(this.echoDelay);
    this.echoDelay.connect(this.echoTone);
    this.echoTone.connect(this.echoWet);
    this.echoTone.connect(this.echoFeedback);
    this.echoFeedback.connect(this.echoDelay);
    this.echoWet.connect(this.outputGain);

    this.reverbSend = context.createGain();
    this.reverbSend.gain.value = 0;
    this.reverb = context.createConvolver();
    this.reverbTone = context.createBiquadFilter();
    this.reverbTone.type = 'lowpass';
    this.reverbTone.frequency.value = 9000;
    this.reverbWet = context.createGain();
    this.reverbWet.gain.value = this.reverbAmount;

    this.inputBus.connect(this.reverbSend);
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.reverbTone);
    this.reverbTone.connect(this.reverbWet);
    this.reverbWet.connect(this.outputGain);

    this.outputGain.connect(this.limiter);
    this.limiter.connect(this.audioEngine.masterGain);

    this.laneGains = {};
    Object.values(this.lanes).forEach(lane => {
      const gain = context.createGain();
      gain.gain.value = lane.volume;
      gain.connect(this.inputBus);
      this.laneGains[lane.id] = gain;
    });

    this.createReverbImpulse();
    this.updateTempoEffects();
  }

  createReverbImpulse() {
    const seconds = 2.8;
    const length = Math.floor(this.audioContext.sampleRate * seconds);
    const impulse = this.audioContext.createBuffer(2, length, this.audioContext.sampleRate);

    for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
      const samples = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const envelope = Math.pow(1 - i / length, 2.2);
        samples[i] = (Math.random() * 2 - 1) * envelope;
      }
    }

    this.reverb.buffer = impulse;
  }

  async loadDefaultSamples() {
    const builtIns = Object.values(this.lanes).filter(lane => lane.url);
    await Promise.all(builtIns.map(async lane => {
      const response = await fetch(lane.url);
      if (!response.ok) throw new Error(`Could not load ${lane.label}: HTTP ${response.status}`);
      lane.buffer = await this.audioContext.decodeAudioData(await response.arrayBuffer());
    }));
  }

  async loadCustomSample(file) {
    if (!file) return false;

    try {
      const buffer = await this.audioContext.decodeAudioData(await file.arrayBuffer());
      this.lanes.custom.buffer = buffer;
      this.lanes.custom.label = file.name.replace(/\.[^/.]+$/, '') || 'Custom';
      this.selectedLane = 'custom';
      return true;
    } catch (error) {
      console.error('Could not decode custom drum sample:', error);
      return false;
    }
  }

  setStep(laneId, step, enabled) {
    const lane = this.lanes[laneId];
    if (!lane || step < 0 || step >= RemixStationEngine.STEPS) return;
    lane.steps[step] = enabled;
  }

  clearPattern() {
    Object.values(this.lanes).forEach(lane => lane.steps.fill(false));
  }

  selectLane(laneId) {
    if (this.lanes[laneId]) this.selectedLane = laneId;
  }

  setLaneMuted(laneId, muted) {
    const lane = this.lanes[laneId];
    if (!lane) return;
    lane.muted = muted;
    this.updateLaneGain(laneId);
  }

  setLaneVolume(laneId, volume) {
    const lane = this.lanes[laneId];
    if (!lane) return;
    lane.volume = Math.min(1, Math.max(0, volume));
    this.updateLaneGain(laneId);
  }

  updateLaneGain(laneId) {
    const lane = this.lanes[laneId];
    const gain = this.laneGains[laneId];
    if (!lane || !gain) return;
    gain.gain.setTargetAtTime(lane.muted ? 0 : lane.volume, this.audioContext.currentTime, 0.01);
  }

  setVolume(volume) {
    const value = Math.min(1, Math.max(0, volume));
    this.outputGain.gain.setTargetAtTime(value, this.audioContext.currentTime, 0.01);
  }

  setManualBpm(bpm) {
    if (!Number.isFinite(bpm)) return this.manualBpm;
    this.manualBpm = Math.min(RemixStationEngine.MAX_BPM,
      Math.max(RemixStationEngine.MIN_BPM, bpm));
    this.updateTempoEffects();
    return this.manualBpm;
  }

  setSyncSource(source) {
    this.syncSource = ['manual', 'A', 'B'].includes(source) ? source : 'manual';
    this.updateTempoEffects();
  }

  getReferenceDeck() {
    if (this.syncSource === 'manual') return null;
    return this.audioEngine.getDeck(this.syncSource);
  }

  getBpm() {
    const deckBpm = this.getReferenceDeck()?.getBPM();
    const bpm = deckBpm > 0 ? deckBpm : this.manualBpm;
    return Math.min(RemixStationEngine.MAX_BPM,
      Math.max(RemixStationEngine.MIN_BPM, bpm));
  }

  getAlignedStartTime() {
    const now = this.audioContext.currentTime;
    const deck = this.getReferenceDeck();
    if (!deck?.isPlaying || !deck.audioBuffer || deck.getBPM() <= 0) return now + 0.05;

    const currentPosition = deck.getCurrentTime();
    const nextBeat = deck.getNextBeat(currentPosition);
    const bufferDelta = nextBeat - currentPosition;
    const rate = deck.getEffectiveRate?.() || deck.playbackRate || 1;

    return bufferDelta > 0.01 && bufferDelta < 2
      ? now + bufferDelta / Math.abs(rate)
      : now + 0.05;
  }

  start() {
    if (this.isPlaying) return;

    this.audioEngine.resumeContext();
    this.isPlaying = true;
    this.currentStep = 0;
    this.nextStepTime = this.getAlignedStartTime();
    this.schedulerId = window.setInterval(() => this.schedule(), RemixStationEngine.SCHEDULER_MS);
    this.schedule();
    this.onTransportChange?.(true);
  }

  stop() {
    if (this.schedulerId !== null) window.clearInterval(this.schedulerId);
    this.schedulerId = null;
    this.isPlaying = false;
    this.currentStep = 0;
    this.setRoll(false);
    this.activeSources.forEach(source => {
      try { source.stop(); } catch (error) { /* already ended */ }
    });
    this.clearUiTimers();
    this.onStep?.(-1);
    this.onTransportChange?.(false);
  }

  resync() {
    const shouldRestart = this.isPlaying;
    this.stop();
    if (shouldRestart) this.start();
  }

  schedule() {
    if (!this.isPlaying) return;

    const horizon = this.audioContext.currentTime + RemixStationEngine.LOOKAHEAD_SECONDS;
    let guard = 0;
    while (this.nextStepTime < horizon && guard < 32) {
      this.scheduleStep(this.currentStep, this.nextStepTime);
      this.queueStepDisplay(this.currentStep, this.nextStepTime);

      const stepSeconds = (60 / this.getBpm()) / 4;
      this.nextStepTime += stepSeconds;
      this.currentStep = (this.currentStep + 1) % RemixStationEngine.STEPS;
      guard++;
    }

    if (this.rollDivision) this.scheduleRoll(horizon);
    this.updateTempoEffects();
  }

  scheduleStep(step, when) {
    Object.values(this.lanes).forEach(lane => {
      if (lane.steps[step]) this.playLane(lane.id, when);
    });
  }

  scheduleRoll(horizon) {
    let guard = 0;
    while (this.nextRollTime < horizon && guard < 64) {
      this.playLane(this.selectedLane, this.nextRollTime, 0.88);
      this.nextRollTime += (60 / this.getBpm()) * (4 / this.rollDivision);
      guard++;
    }
  }

  queueStepDisplay(step, when) {
    const delay = Math.max(0, (when - this.audioContext.currentTime) * 1000);
    const timer = window.setTimeout(() => {
      this.uiTimers.delete(timer);
      if (this.isPlaying) this.onStep?.(step);
    }, delay);
    this.uiTimers.add(timer);
  }

  clearUiTimers() {
    this.uiTimers.forEach(timer => window.clearTimeout(timer));
    this.uiTimers.clear();
  }

  playLane(laneId, when = this.audioContext.currentTime, velocity = 1) {
    const lane = this.lanes[laneId];
    if (!lane?.buffer || lane.muted) return false;

    const source = this.audioContext.createBufferSource();
    const velocityGain = this.audioContext.createGain();
    source.buffer = lane.buffer;
    velocityGain.gain.value = velocity;
    source.connect(velocityGain);
    velocityGain.connect(this.laneGains[laneId]);
    source.addEventListener('ended', () => {
      source.disconnect();
      velocityGain.disconnect();
      this.activeSources.delete(source);
    });

    this.activeSources.add(source);
    source.start(Math.max(when, this.audioContext.currentTime));
    return true;
  }

  setRoll(active, division = this.rollDivision || 16) {
    if (!active) {
      this.rollDivision = null;
      if (this.rollSchedulerId !== null) window.clearInterval(this.rollSchedulerId);
      this.rollSchedulerId = null;
      return;
    }

    this.rollDivision = Number(division);
    this.nextRollTime = this.audioContext.currentTime + 0.01;
    this.scheduleRoll(this.audioContext.currentTime + RemixStationEngine.LOOKAHEAD_SECONDS);
    if (!this.isPlaying && this.rollSchedulerId === null) {
      this.rollSchedulerId = window.setInterval(() => {
        this.scheduleRoll(this.audioContext.currentTime + RemixStationEngine.LOOKAHEAD_SECONDS);
      }, RemixStationEngine.SCHEDULER_MS);
    }
  }

  setEchoDivision(division) {
    this.echoDivision = Number(division);
    this.updateTempoEffects();
  }

  setEchoAmount(amount) {
    this.echoAmount = Math.min(1, Math.max(0, amount));
  }

  setEchoActive(active) {
    const now = this.audioContext.currentTime;
    this.echoSend.gain.cancelScheduledValues(now);
    this.echoWet.gain.cancelScheduledValues(now);
    this.echoFeedback.gain.cancelScheduledValues(now);

    if (active) {
      this.echoSend.gain.setTargetAtTime(this.echoAmount, now, 0.015);
      this.echoWet.gain.setTargetAtTime(this.echoAmount * 0.9, now, 0.015);
      this.echoFeedback.gain.setTargetAtTime(0.28 + this.echoAmount * 0.5, now, 0.02);
    } else {
      // Close only the input. The repeats already inside the feedback loop
      // continue decaying instead of being chopped off on release.
      this.echoSend.gain.setTargetAtTime(0, now, 0.02);
    }
  }

  setReverbAmount(amount) {
    this.reverbAmount = Math.min(1, Math.max(0, amount));
  }

  setReverbActive(active) {
    const now = this.audioContext.currentTime;
    this.reverbSend.gain.cancelScheduledValues(now);
    this.reverbWet.gain.cancelScheduledValues(now);

    if (active) {
      this.reverbSend.gain.setTargetAtTime(this.reverbAmount, now, 0.02);
      this.reverbWet.gain.setTargetAtTime(this.reverbAmount, now, 0.02);
    } else {
      // Stop feeding the convolver and let its existing tail ring out.
      this.reverbSend.gain.setTargetAtTime(0, now, 0.03);
    }
  }

  updateTempoEffects() {
    if (!this.echoDelay) return;
    const delaySeconds = Math.min(2, (60 / this.getBpm()) * (4 / this.echoDivision));
    this.echoDelay.delayTime.setTargetAtTime(delaySeconds, this.audioContext.currentTime, 0.02);
  }
}

/** DOM controls for RemixStationEngine. */
class RemixStationController {
  constructor(audioEngine) {
    this.root = document.getElementById('remixStation');
    if (!this.root) return;

    this.engine = new RemixStationEngine(audioEngine);
    this.tapTimes = [];
    this.activeMomentaries = new Set();
    this.cacheElements();
    this.buildGrid();
    this.setupEventListeners();

    this.engine.onStep = step => this.renderPlayhead(step);
    this.engine.onTransportChange = playing => this.renderTransport(playing);
    this.loadDefaults();
  }

  cacheElements() {
    const id = name => document.getElementById(name);
    this.grid = id('remixGrid');
    this.status = id('remixStatus');
    this.startStop = id('remixStartStop');
    this.clear = id('remixClear');
    this.bpm = id('remixBpm');
    this.tap = id('remixTap');
    this.syncSource = id('remixSyncSource');
    this.resync = id('remixResync');
    this.customInput = id('remixCustomFile');
    this.customLoad = id('remixCustomLoad');
    this.echoButton = id('remixEcho');
    this.echoDivision = id('remixEchoDivision');
    this.echoAmount = id('remixEchoAmount');
    this.reverbButton = id('remixReverb');
    this.reverbAmount = id('remixReverbAmount');
    this.volume = id('remixVolume');
    this.rollButtons = Array.from(this.root.querySelectorAll('[data-roll]'));
  }

  async loadDefaults() {
    try {
      await this.engine.loadDefaultSamples();
      this.status.textContent = 'Samples ready';
    } catch (error) {
      console.error('Remix Station samples failed to load:', error);
      this.status.textContent = 'Sample load failed';
      this.status.classList.add('error');
    }
  }

  buildGrid() {
    const header = document.createElement('div');
    header.className = 'remix-grid-row remix-grid-header';
    const corner = document.createElement('span');
    corner.className = 'remix-lane-heading';
    corner.textContent = 'Voice';
    header.appendChild(corner);

    for (let step = 0; step < RemixStationEngine.STEPS; step++) {
      const label = document.createElement('span');
      label.textContent = String(step + 1);
      label.classList.toggle('beat-start', step % 4 === 0);
      header.appendChild(label);
    }
    this.grid.appendChild(header);

    Object.values(this.engine.lanes).forEach(lane => this.buildLaneRow(lane));
    this.renderSelectedLane();
  }

  buildLaneRow(lane) {
    const row = document.createElement('div');
    row.className = 'remix-grid-row remix-lane-row';
    row.dataset.lane = lane.id;

    const controls = document.createElement('div');
    controls.className = 'remix-lane-controls';

    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'remix-preview';
    preview.dataset.role = 'preview';
    preview.textContent = lane.label;
    preview.title = `Preview and select ${lane.label}`;
    preview.addEventListener('click', () => {
      this.engine.selectLane(lane.id);
      this.engine.playLane(lane.id);
      this.renderSelectedLane();
    });
    controls.appendChild(preview);

    const mute = document.createElement('button');
    mute.type = 'button';
    mute.className = 'remix-mute';
    mute.textContent = 'M';
    mute.title = `Mute ${lane.label}`;
    mute.setAttribute('aria-pressed', 'false');
    mute.addEventListener('click', () => {
      lane.muted = !lane.muted;
      this.engine.setLaneMuted(lane.id, lane.muted);
      mute.classList.toggle('active', lane.muted);
      mute.setAttribute('aria-pressed', String(lane.muted));
    });
    controls.appendChild(mute);

    const level = document.createElement('input');
    level.type = 'range';
    level.min = '0';
    level.max = '100';
    level.value = String(Math.round(lane.volume * 100));
    level.className = 'remix-lane-volume horizontal-fader';
    level.setAttribute('aria-label', `${lane.label} volume`);
    level.addEventListener('input', () => this.engine.setLaneVolume(lane.id, Number(level.value) / 100));
    controls.appendChild(level);

    if (lane.id === 'custom') controls.appendChild(this.customLoad);
    row.appendChild(controls);

    lane.steps.forEach((enabled, step) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'remix-step';
      button.classList.toggle('active', enabled);
      button.classList.toggle('beat-start', step % 4 === 0);
      button.dataset.step = String(step);
      button.setAttribute('aria-label', `${lane.label}, step ${step + 1}`);
      button.setAttribute('aria-pressed', String(enabled));
      button.addEventListener('click', () => {
        const next = !lane.steps[step];
        this.engine.setStep(lane.id, step, next);
        button.classList.toggle('active', next);
        button.setAttribute('aria-pressed', String(next));
      });
      row.appendChild(button);
    });

    this.grid.appendChild(row);
  }

  setupEventListeners() {
    this.startStop.addEventListener('click', () => {
      this.engine.isPlaying ? this.engine.stop() : this.engine.start();
    });

    this.clear.addEventListener('click', () => {
      this.engine.clearPattern();
      this.root.querySelectorAll('.remix-step.active').forEach(step => {
        step.classList.remove('active');
        step.setAttribute('aria-pressed', 'false');
      });
    });

    this.bpm.addEventListener('change', () => {
      this.bpm.value = String(Math.round(this.engine.setManualBpm(Number(this.bpm.value))));
    });
    this.tap.addEventListener('click', () => this.tapTempo());

    this.syncSource.addEventListener('change', () => {
      this.engine.setSyncSource(this.syncSource.value);
      this.bpm.disabled = this.syncSource.value !== 'manual';
      this.tap.disabled = this.syncSource.value !== 'manual';
      this.engine.resync();
      this.renderTempo();
    });
    this.resync.addEventListener('click', () => this.engine.resync());

    this.customLoad.addEventListener('click', () => this.customInput.click());
    this.customInput.addEventListener('change', async () => {
      const file = this.customInput.files[0];
      if (!file) return;

      this.customLoad.disabled = true;
      this.customLoad.textContent = 'Loading…';
      const loaded = await this.engine.loadCustomSample(file);
      this.customLoad.disabled = false;
      this.customLoad.textContent = loaded ? 'Replace' : 'Try again';

      if (loaded) {
        const preview = this.root.querySelector('[data-lane="custom"] [data-role="preview"]');
        preview.textContent = this.engine.lanes.custom.label;
        preview.title = `Preview and select ${this.engine.lanes.custom.label}`;
        this.engine.playLane('custom');
        this.renderSelectedLane();
        this.status.textContent = `${this.engine.lanes.custom.label} loaded`;
      } else {
        this.status.textContent = 'Could not decode that sample';
      }
    });

    this.rollButtons.forEach(button => this.bindMomentary(button,
      () => {
        button.classList.add('active');
        this.engine.setRoll(true, Number(button.dataset.roll));
      },
      () => {
        button.classList.remove('active');
        this.engine.setRoll(false);
      }));

    this.echoDivision.addEventListener('change', () =>
      this.engine.setEchoDivision(Number(this.echoDivision.value)));
    this.echoAmount.addEventListener('input', () =>
      this.engine.setEchoAmount(Number(this.echoAmount.value) / 100));
    this.reverbAmount.addEventListener('input', () =>
      this.engine.setReverbAmount(Number(this.reverbAmount.value) / 100));
    this.volume.addEventListener('input', () =>
      this.engine.setVolume(Number(this.volume.value) / 100));

    this.bindMomentary(this.echoButton,
      () => this.engine.setEchoActive(true),
      () => this.engine.setEchoActive(false));
    this.bindMomentary(this.reverbButton,
      () => this.engine.setReverbActive(true),
      () => this.engine.setReverbActive(false));

    window.addEventListener('blur', () => {
      this.activeMomentaries.forEach(release => release());
      this.activeMomentaries.clear();
    });
  }

  bindMomentary(button, press, release) {
    let active = false;
    const down = event => {
      if (active) return;
      if (event.type === 'keydown') {
        if (![' ', 'Enter'].includes(event.key) || event.repeat) return;
        event.preventDefault();
      }
      active = true;
      button.classList.add('active');
      button.setAttribute('aria-pressed', 'true');
      press();
      this.activeMomentaries.add(up);
    };
    const up = event => {
      if (!active) return;
      if (event?.type === 'keyup' && ![' ', 'Enter'].includes(event.key)) return;
      active = false;
      button.classList.remove('active');
      button.setAttribute('aria-pressed', 'false');
      release();
      this.activeMomentaries.delete(up);
    };

    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('pointerleave', event => {
      if (event.buttons) up(event);
    });
    button.addEventListener('keydown', down);
    button.addEventListener('keyup', up);
  }

  tapTempo() {
    const now = performance.now();
    const previous = this.tapTimes[this.tapTimes.length - 1];
    if (previous && now - previous > 2000) this.tapTimes = [];
    this.tapTimes.push(now);
    this.tapTimes = this.tapTimes.slice(-5);
    if (this.tapTimes.length < 2) return;

    const intervals = this.tapTimes.slice(1).map((time, index) => time - this.tapTimes[index]);
    const average = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    const bpm = this.engine.setManualBpm(60000 / average);
    this.bpm.value = String(Math.round(bpm));
  }

  renderTransport(playing) {
    this.startStop.textContent = playing ? 'Stop' : 'Start';
    this.startStop.classList.toggle('active', playing);
    this.startStop.setAttribute('aria-pressed', String(playing));
    this.status.textContent = playing ? 'Playing' : 'Ready';
    if (!playing) this.renderPlayhead(-1);
  }

  renderPlayhead(step) {
    this.root.querySelectorAll('.remix-step.playing').forEach(button => button.classList.remove('playing'));
    if (step >= 0) {
      this.root.querySelectorAll(`.remix-step[data-step="${step}"]`)
        .forEach(button => button.classList.add('playing'));
      this.renderTempo();
    }
  }

  renderTempo() {
    const bpm = this.engine.getBpm();
    if (this.syncSource.value !== 'manual') this.bpm.value = bpm.toFixed(1);
    this.status.textContent = this.engine.isPlaying
      ? `Playing · ${bpm.toFixed(1)} BPM`
      : `Ready · ${bpm.toFixed(1)} BPM`;
  }

  renderSelectedLane() {
    this.root.querySelectorAll('.remix-lane-row').forEach(row =>
      row.classList.toggle('selected', row.dataset.lane === this.engine.selectedLane));
    const label = this.engine.lanes[this.engine.selectedLane].label;
    document.getElementById('remixRollLane').textContent = label;
  }
}

window.RemixStationEngine = RemixStationEngine;
window.RemixStationController = RemixStationController;
