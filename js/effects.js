/**
 * The per-deck effect rack, and the parameter map the FX pad drives it with.
 *
 * One effect at a time under your hand, but any number of them left running:
 * each keeps its own pad position, its own dry/wet and whether it is engaged,
 * so holding a delay and then reaching for the filter leaves the delay alone.
 */
class EffectsEngine {
  /** Filter fully open. Anything lower is audible as lost air. */
  static FILTER_OPEN_HZ = 20000;
  static FILTER_LOW_HZ = 100;      // low pass, all the way down
  static FILTER_HIGH_HZ = 8000;    // high pass, all the way up
  static FILTER_BOTTOM_HZ = 20;    // high pass at rest: under hearing

  /** Longest delay the node can hold, in seconds. Two beats at 60 BPM. */
  static MAX_DELAY_SECONDS = 2;

  /** Beat length assumed while a deck has no BPM. */
  static FALLBACK_BEAT_SECONDS = 0.5;

  /** Rise time for continuous parameters: long enough to swallow the step
   *  between two pointer positions, short enough to feel immediate. */
  static GLIDE_SECONDS = 0.02;

  /** Engaging and letting go of an effect. Slower than a parameter, so a
   *  momentary press opens and closes instead of clicking. */
  static ENGAGE_SECONDS = 0.05;

  /** Samples in the gate's shape. Enough for a clean edge, cheap to rebuild. */
  static GATE_CURVE_SAMPLES = 512;

  /**
   * What the pad's axes mean, per effect. Normalised 0–1 goes in, real units
   * come out: the pad never learns what a hertz is, and the audio never learns
   * what a pixel is.
   *
   * Every axis is continuous. Musical values are held in beats and bars rather
   * than seconds, so the tempo — pitch fader included — turns them into time.
   */
  static PARAMS = {
    filter: {
      // One bipolar sweep: left closes a low pass, right opens a high pass,
      // and the middle is out of the way
      x: { label: 'Sweep', min: 0, max: 1, unit: 'sweep' },
      y: { label: 'Resonance', min: 0.7, max: 12, unit: 'Q' }
    },
    reverb: {
      x: { label: 'Size', min: 0.6, max: 6, unit: 's' },
      y: { label: 'Tone', min: 900, max: 12000, unit: 'Hz', log: true }
    },
    delay: {
      x: { label: 'Time', min: 1 / 32, max: 2, unit: 'beats', log: true },
      y: { label: 'Feedback', min: 0, max: 0.85, unit: '%' }
    },
    phaser: {
      // Left is a slow eight-bar sweep, right half a bar
      x: { label: 'Rate', min: 8, max: 0.5, unit: 'bars', log: true },
      y: { label: 'Depth', min: 0, max: 1, unit: '%' }
    },
    flanger: {
      x: { label: 'Rate', min: 8, max: 0.5, unit: 'bars', log: true },
      y: { label: 'Depth', min: 0, max: 1, unit: '%' }
    },
    gate: {
      x: { label: 'Rate', min: 2, max: 1 / 16, unit: 'beats', log: true },
      y: { label: 'Shape', min: 0, max: 1, unit: '%' }
    }
  };

  /**
   * Where each effect starts: the pad position that flatters it first time,
   * and how much of it you get the moment you press the pad. The two that sit
   * in series arrive fully wet, since a half-filtered signal is just a shelf.
   */
  static DEFAULTS = {
    filter: { x: 0.5, y: 0, wet: 100 },     // centred: out of the way until you sweep
    reverb: { x: 0.45, y: 0.55, wet: 45 },  // a room, not a cathedral
    delay: { x: 2 / 3, y: 0.35, wet: 45 },  // half a beat, a couple of repeats
    phaser: { x: 0.35, y: 0.5, wet: 60 },
    flanger: { x: 0.5, y: 0.45, wet: 55 },
    gate: { x: 0.4, y: 0.6, wet: 100 }      // eighth notes, fairly hard edges
  };

  /** Chip order in the UI, and the order Reset walks. */
  static ORDER = ['filter', 'reverb', 'delay', 'phaser', 'flanger', 'gate'];

  // --- Reading the map ------------------------------------------------------

  static axis(effect, axis) {
    return EffectsEngine.PARAMS[effect]?.[axis] || null;
  }

  static clamp(normalised) {
    return Math.min(1, Math.max(0, normalised));
  }

  /**
   * Real value behind a normalised position: Hz, seconds, Q, beats. Log where
   * the ear hears ratios rather than differences, which is most of the time.
   */
  static value(effect, axis, normalised) {
    const spec = EffectsEngine.axis(effect, axis);
    if (!spec) return 0;

    if (spec.log) {
      const from = Math.log(spec.min);
      const to = Math.log(spec.max);
      return Math.exp(from + normalised * (to - from));
    }

    return spec.min + normalised * (spec.max - spec.min);
  }

  /** What the readout under the pad shows. */
  static label(effect, axis, normalised) {
    const spec = EffectsEngine.axis(effect, axis);
    if (!spec) return '';

    const value = EffectsEngine.value(effect, axis, normalised);

    switch (spec.unit) {
      case '%': return `${Math.round(normalised * 100)}%`;
      case 's': return `${value.toFixed(1)} s`;
      case 'Q': return `${value.toFixed(1)} Q`;
      case 'beats': return `${value.toFixed(2)} beat${value === 1 ? '' : 's'}`;
      case 'bars': return `${value.toFixed(1)} bars`;
      case 'Hz': return value >= 1000
        ? `${(value / 1000).toFixed(1)} kHz`
        : `${Math.round(value)} Hz`;
      // A bipolar sweep: name the direction it is heading, or say it is idle
      case 'sweep': {
        const travel = Math.round((normalised - 0.5) * 200);
        if (Math.abs(travel) < 3) return 'Open';
        if (Math.abs(travel) > 97) return travel > 0 ? 'High pass' : 'Low pass';
        return travel > 0 ? `High ${travel}%` : `Low ${-travel}%`;
      }
      default: return value.toFixed(2);
    }
  }

  constructor(audioContext) {
    this.audioContext = audioContext;
    this.effectNodes = {};

    // Pad position, amount and whether it is sounding, per effect. The audio is
    // rebuilt from this whenever the tempo moves, so it is the source of truth.
    this.state = {};
    EffectsEngine.ORDER.forEach(effect => {
      this.state[effect] = { ...EffectsEngine.DEFAULTS[effect], on: false };
    });

    this.beatSeconds = EffectsEngine.FALLBACK_BEAT_SECONDS;

    this.initializeEffects();
  }

  initializeEffects() {
    // Two filters in parallel, not one: the pad's sweep runs down through a low
    // pass on the left of centre and up through a high pass on the right, and
    // the two are crossfaded across the middle, where both are open anyway
    this.effectNodes.filterIn = this.audioContext.createGain();
    this.effectNodes.filterMix = this.audioContext.createGain();
    this.effectNodes.filterOut = this.audioContext.createGain();
    this.effectNodes.filterDry = this.audioContext.createGain();
    this.effectNodes.filterWet = this.audioContext.createGain();
    this.effectNodes.filterWet.gain.value = 0;

    this.effectNodes.filterLow = this.audioContext.createBiquadFilter();
    this.effectNodes.filterLow.type = 'lowpass';
    this.effectNodes.filterLow.frequency.value = EffectsEngine.FILTER_OPEN_HZ;
    this.effectNodes.filterLowGain = this.audioContext.createGain();
    this.effectNodes.filterLowGain.gain.value = 1;

    this.effectNodes.filterHigh = this.audioContext.createBiquadFilter();
    this.effectNodes.filterHigh.type = 'highpass';
    this.effectNodes.filterHigh.frequency.value = EffectsEngine.FILTER_BOTTOM_HZ;
    this.effectNodes.filterHighGain = this.audioContext.createGain();
    this.effectNodes.filterHighGain.gain.value = 0;

    // The gate chops the deck itself, so it sits in the dry path rather than
    // on a send — gating a copy and mixing it back under the full signal would
    // be inaudible. Its modulation is a sawtooth read through a shape curve.
    this.effectNodes.gateIn = this.audioContext.createGain();
    this.effectNodes.gateOut = this.audioContext.createGain();
    this.effectNodes.gateDry = this.audioContext.createGain();
    this.effectNodes.gateWet = this.audioContext.createGain();
    this.effectNodes.gateWet.gain.value = 0;
    this.effectNodes.gateMod = this.audioContext.createGain();
    this.effectNodes.gateMod.gain.value = 0; // the curve drives it from here
    this.effectNodes.gateShaper = this.audioContext.createWaveShaper();
    this.effectNodes.gateShaper.oversample = 'none';
    this.effectNodes.gateLFO = this.audioContext.createOscillator();
    this.effectNodes.gateLFO.type = 'sawtooth';
    this.effectNodes.gateLFO.frequency.value = 4;

    this.effectNodes.reverb = this.audioContext.createConvolver();
    // Tone lives on the wet path only: darkening the tail is what makes a
    // reverb sit behind the track instead of on top of it
    this.effectNodes.reverbTone = this.audioContext.createBiquadFilter();
    this.effectNodes.reverbTone.type = 'lowpass';
    this.effectNodes.reverbTone.frequency.value = 12000;
    this.effectNodes.reverbGain = this.audioContext.createGain();
    this.effectNodes.reverbGain.gain.value = 0;

    this.effectNodes.delay = this.audioContext.createDelay(EffectsEngine.MAX_DELAY_SECONDS);
    this.effectNodes.delay.delayTime.value = 0.25;
    this.effectNodes.delayGain = this.audioContext.createGain();
    this.effectNodes.delayGain.gain.value = 0;
    this.effectNodes.delayFeedback = this.audioContext.createGain();
    this.effectNodes.delayFeedback.gain.value = 0.3;
    // Each repeat comes back darker, the way a tape delay loses the top end.
    // Without it, a long feedback tail turns into a pile of hiss.
    this.effectNodes.delayTone = this.audioContext.createBiquadFilter();
    this.effectNodes.delayTone.type = 'lowpass';
    this.effectNodes.delayTone.frequency.value = 3200;

    this.effectNodes.phaser = [];
    this.effectNodes.phaserLFO = this.audioContext.createOscillator();
    this.effectNodes.phaserLFO.type = 'sine';
    this.effectNodes.phaserLFO.frequency.value = 0.3;
    this.effectNodes.phaserLFOGain = this.audioContext.createGain();
    this.effectNodes.phaserLFOGain.gain.value = 0;
    this.effectNodes.phaserGain = this.audioContext.createGain();
    this.effectNodes.phaserGain.gain.value = 0;
    this.effectNodes.phaserFeedback = this.audioContext.createGain();
    this.effectNodes.phaserFeedback.gain.value = 0.3;

    const phaserFreqs = [200, 400, 800, 1600, 3200, 6400];
    const phaserQs = [2.0, 2.5, 2.8, 2.5, 2.0, 1.5]; // Varying Q values for more natural sound

    for (let i = 0; i < 6; i++) {
      this.effectNodes.phaser[i] = this.audioContext.createBiquadFilter();
      this.effectNodes.phaser[i].type = 'allpass';
      this.effectNodes.phaser[i].frequency.value = phaserFreqs[i];
      this.effectNodes.phaser[i].Q.value = phaserQs[i];
    }

    this.effectNodes.flanger = this.audioContext.createDelay(0.02);
    this.effectNodes.flanger.delayTime.value = 0.005;
    this.effectNodes.flangerLFO = this.audioContext.createOscillator();
    this.effectNodes.flangerLFO.type = 'sine';
    this.effectNodes.flangerLFO.frequency.value = 0.25;
    this.effectNodes.flangerLFOGain = this.audioContext.createGain();
    this.effectNodes.flangerLFOGain.gain.value = 0.003;
    this.effectNodes.flangerGain = this.audioContext.createGain();
    this.effectNodes.flangerGain.gain.value = 0;
    this.effectNodes.flangerFeedback = this.audioContext.createGain();
    this.effectNodes.flangerFeedback.gain.value = 0.7;

    this.connectEffectChain();
    this.createReverbImpulse();
    this.startEffectOscillators();
    this.applyAll();
  }

  connectEffectChain() {
    this.effectNodes.filterIn.connect(this.effectNodes.filterDry);
    this.effectNodes.filterDry.connect(this.effectNodes.filterOut);

    this.effectNodes.filterIn.connect(this.effectNodes.filterLow);
    this.effectNodes.filterLow.connect(this.effectNodes.filterLowGain);
    this.effectNodes.filterLowGain.connect(this.effectNodes.filterMix);

    this.effectNodes.filterIn.connect(this.effectNodes.filterHigh);
    this.effectNodes.filterHigh.connect(this.effectNodes.filterHighGain);
    this.effectNodes.filterHighGain.connect(this.effectNodes.filterMix);

    this.effectNodes.filterMix.connect(this.effectNodes.filterWet);
    this.effectNodes.filterWet.connect(this.effectNodes.filterOut);

    this.effectNodes.gateIn.connect(this.effectNodes.gateDry);
    this.effectNodes.gateDry.connect(this.effectNodes.gateOut);
    this.effectNodes.gateIn.connect(this.effectNodes.gateMod);
    this.effectNodes.gateMod.connect(this.effectNodes.gateWet);
    this.effectNodes.gateWet.connect(this.effectNodes.gateOut);

    this.effectNodes.gateLFO.connect(this.effectNodes.gateShaper);
    this.effectNodes.gateShaper.connect(this.effectNodes.gateMod.gain);

    this.effectNodes.reverb.connect(this.effectNodes.reverbTone);
    this.effectNodes.reverbTone.connect(this.effectNodes.reverbGain);

    this.effectNodes.delay.connect(this.effectNodes.delayTone);
    this.effectNodes.delayTone.connect(this.effectNodes.delayFeedback);
    this.effectNodes.delayFeedback.connect(this.effectNodes.delay);
    this.effectNodes.delay.connect(this.effectNodes.delayGain);

    for (let i = 1; i < this.effectNodes.phaser.length; i++) {
      this.effectNodes.phaser[i - 1].connect(this.effectNodes.phaser[i]);
    }

    if (this.effectNodes.phaser.length > 0) {
      const lastPhaser = this.effectNodes.phaser[this.effectNodes.phaser.length - 1];
      lastPhaser.connect(this.effectNodes.phaserFeedback);
      this.effectNodes.phaserFeedback.connect(this.effectNodes.phaser[0]);
    }

    this.effectNodes.phaserLFO.connect(this.effectNodes.phaserLFOGain);
    for (let i = 0; i < this.effectNodes.phaser.length; i++) {
      this.effectNodes.phaserLFOGain.connect(this.effectNodes.phaser[i].frequency);
    }

    this.effectNodes.flanger.connect(this.effectNodes.flangerFeedback);
    this.effectNodes.flangerFeedback.connect(this.effectNodes.flanger);

    this.effectNodes.flangerLFO.connect(this.effectNodes.flangerLFOGain);
    this.effectNodes.flangerLFOGain.connect(this.effectNodes.flanger.delayTime);
  }

  startEffectOscillators() {
    try {
      this.effectNodes.phaserLFO.start();
      this.effectNodes.flangerLFO.start();
      this.effectNodes.gateLFO.start();
    } catch (e) {
      // Oscillators may already be started
      console.log('Effect oscillators already started or failed to start');
    }
  }

  /** Noise with a decay envelope, as long as the size parameter asks for. */
  createReverbImpulse() {
    const seconds = EffectsEngine.value('reverb', 'x', this.state.reverb.x);
    const length = Math.floor(this.audioContext.sampleRate * seconds);
    const impulse = this.audioContext.createBuffer(2, length, this.audioContext.sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const channelData = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const decay = Math.pow(1 - i / length, 1.2); // Slower decay for more prominent reverb
        const noise = (Math.random() * 2 - 1);

        let amplitude = decay;
        if (i < this.audioContext.sampleRate * 0.1) { // First 100ms
          amplitude *= (1 + Math.sin(i / 1000) * 0.3); // Add early reflection pattern
        }

        channelData[i] = noise * amplitude;
      }
    }

    this.effectNodes.reverb.buffer = impulse;
  }

  /**
   * One cycle of the gate, read by the sawtooth. Half the cycle is open, and
   * the shape parameter decides how sharp the edges are: soft is a tremolo you
   * can ride under a track, hard is a chop with silence in the gaps.
   */
  createGateCurve(hardness) {
    const samples = EffectsEngine.GATE_CURVE_SAMPLES;
    const curve = new Float32Array(samples);

    const duty = 0.5;
    const edge = 0.25 - 0.24 * hardness; // how long the open and the shut take
    const ease = t => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));

    for (let i = 0; i < samples; i++) {
      const phase = i / (samples - 1); // the sawtooth sweeps this once a cycle
      curve[i] = phase > duty
        ? 0
        : Math.min(ease(phase / edge), ease((duty - phase) / edge));
    }

    this.effectNodes.gateShaper.curve = curve;
  }

  // --- State ----------------------------------------------------------------

  getState(effect) {
    return { ...this.state[effect] };
  }

  /**
   * Moves the pad for one effect. Both axes at once, so a gesture costs one
   * pass over the nodes; `final` marks the end of it, where the reverb rebuilds
   * its impulse rather than on every pointer move — that is half a million
   * samples of noise per frame otherwise.
   */
  setPad(effect, { x, y }, { final = false } = {}) {
    const state = this.state[effect];
    if (!state) return;

    state.x = EffectsEngine.clamp(x);
    state.y = EffectsEngine.clamp(y);
    this.applyParams(effect, { final });
  }

  /** How much of this effect you hear once it is engaged, 0–100. */
  setWet(effect, wet) {
    const state = this.state[effect];
    if (!state) return;

    state.wet = Math.min(100, Math.max(0, wet));
    this.applyWet(effect);
  }

  /** Opens or closes an effect. Everything else about it stays where it was. */
  setEngaged(effect, on) {
    const state = this.state[effect];
    if (!state) return;

    const opening = Boolean(on) && !state.on;
    state.on = Boolean(on);

    // A chop that starts wherever a free-running oscillator happened to be is
    // a chop out of time. Restarting it puts the first opening under the hand
    // that pressed the pad.
    if (effect === 'gate' && opening) this.restartGate();

    this.applyWet(effect);
  }

  /** An oscillator cannot be rewound, so a fresh one is how the gate re-phases. */
  restartGate() {
    const previous = this.effectNodes.gateLFO;

    const lfo = this.audioContext.createOscillator();
    lfo.type = 'sawtooth';
    lfo.frequency.value = previous.frequency.value;
    lfo.connect(this.effectNodes.gateShaper);
    lfo.start();

    try {
      previous.stop();
      previous.disconnect();
    } catch (error) {
      console.warn('Gate oscillator would not stop:', error);
    }

    this.effectNodes.gateLFO = lfo;
  }

  reset() {
    EffectsEngine.ORDER.forEach(effect => {
      this.state[effect] = { ...EffectsEngine.DEFAULTS[effect], on: false };
    });
    this.applyAll();
  }

  applyAll() {
    EffectsEngine.ORDER.forEach(effect => {
      this.applyParams(effect, { final: true });
      this.applyWet(effect);
    });
  }

  /** A new tempo moves every parameter measured in beats. */
  setBeatSeconds(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    if (Math.abs(seconds - this.beatSeconds) < 0.0005) return;

    this.beatSeconds = seconds;
    ['delay', 'phaser', 'flanger', 'gate'].forEach(effect => this.applyParams(effect));
  }

  // --- Applying it to the nodes ---------------------------------------------

  glide(param, value, seconds = EffectsEngine.GLIDE_SECONDS) {
    param.setTargetAtTime(value, this.audioContext.currentTime, seconds);
  }

  applyParams(effect, { final = false } = {}) {
    const { x, y } = this.state[effect];

    switch (effect) {
      case 'filter': return this.applyFilterParams(x, y);
      case 'reverb': return this.applyReverbParams(y, final);
      case 'delay': return this.applyDelayParams(x, y);
      case 'phaser': return this.applyPhaserParams(x, y);
      case 'flanger': return this.applyFlangerParams(x, y);
      case 'gate': return this.applyGateParams(x, y);
    }
  }

  applyFilterParams(x, y) {
    // Left of centre sweeps the low pass down, right of centre sweeps the high
    // pass up, and the two swap over a narrow band in the middle where both are
    // wide open — so the changeover is silent
    const travel = (x - 0.5) * 2;
    const blend = Math.min(1, Math.max(0, (travel + 0.05) / 0.1));

    this.glide(this.effectNodes.filterLowGain.gain, 1 - blend);
    this.glide(this.effectNodes.filterHighGain.gain, blend);

    const sweep = (from, to, amount) =>
      Math.exp(Math.log(from) + amount * (Math.log(to) - Math.log(from)));

    this.glide(
      this.effectNodes.filterLow.frequency,
      sweep(EffectsEngine.FILTER_OPEN_HZ, EffectsEngine.FILTER_LOW_HZ, Math.max(0, -travel))
    );
    this.glide(
      this.effectNodes.filterHigh.frequency,
      sweep(EffectsEngine.FILTER_BOTTOM_HZ, EffectsEngine.FILTER_HIGH_HZ, Math.max(0, travel))
    );

    const resonance = EffectsEngine.value('filter', 'y', y);
    this.glide(this.effectNodes.filterLow.Q, resonance);
    this.glide(this.effectNodes.filterHigh.Q, resonance);
  }

  applyReverbParams(y, final) {
    this.glide(this.effectNodes.reverbTone.frequency, EffectsEngine.value('reverb', 'y', y));

    // Swapping the buffer mid-tail cuts it off, so only do it once the hand
    // has left the pad
    if (final) this.createReverbImpulse();
  }

  applyDelayParams(x, y) {
    const beats = EffectsEngine.value('delay', 'x', x);
    const seconds = Math.min(beats * this.beatSeconds, EffectsEngine.MAX_DELAY_SECONDS);

    this.glide(this.effectNodes.delay.delayTime, seconds);
    this.glide(this.effectNodes.delayFeedback.gain, EffectsEngine.value('delay', 'y', y));
  }

  /** Bars per sweep into an LFO frequency, four beats to the bar. */
  lfoFrequency(bars) {
    return 1 / Math.max(0.05, bars * 4 * this.beatSeconds);
  }

  applyPhaserParams(x, y) {
    const depth = EffectsEngine.value('phaser', 'y', y);

    this.glide(this.effectNodes.phaserLFO.frequency, this.lfoFrequency(EffectsEngine.value('phaser', 'x', x)));
    // How far the allpass corners travel, in Hz
    this.glide(this.effectNodes.phaserLFOGain.gain, 120 + depth * 1100);
    this.glide(this.effectNodes.phaserFeedback.gain, depth * 0.5);
  }

  applyFlangerParams(x, y) {
    const depth = EffectsEngine.value('flanger', 'y', y);

    this.glide(this.effectNodes.flangerLFO.frequency, this.lfoFrequency(EffectsEngine.value('flanger', 'x', x)));
    this.glide(this.effectNodes.flangerLFOGain.gain, 0.0004 + depth * 0.0045);
    this.glide(this.effectNodes.flangerFeedback.gain, 0.3 + depth * 0.55);
  }

  applyGateParams(x, y) {
    const beats = EffectsEngine.value('gate', 'x', x);
    // Straight to the value: gliding the rate would smear the rhythm
    this.effectNodes.gateLFO.frequency.value = 1 / Math.max(0.01, beats * this.beatSeconds);

    this.createGateCurve(EffectsEngine.value('gate', 'y', y));
  }

  /** Engaged or not, times how much of it: one number per effect. */
  applyWet(effect) {
    const { wet, on } = this.state[effect];
    const amount = on ? wet / 100 : 0;
    const engage = EffectsEngine.ENGAGE_SECONDS;

    switch (effect) {
      case 'filter':
        this.glide(this.effectNodes.filterWet.gain, amount, engage);
        this.glide(this.effectNodes.filterDry.gain, 1 - amount, engage);
        return;
      case 'gate':
        this.glide(this.effectNodes.gateWet.gain, amount, engage);
        this.glide(this.effectNodes.gateDry.gain, 1 - amount, engage);
        return;
      case 'reverb':
        // Exponential curve, and a little past unity: a reverb needs room
        this.glide(this.effectNodes.reverbGain.gain, Math.pow(amount, 0.7) * 1.2, engage);
        return;
      case 'delay':
        this.glide(this.effectNodes.delayGain.gain, amount, engage);
        return;
      case 'phaser':
        this.glide(this.effectNodes.phaserGain.gain, amount * 0.8, engage);
        return;
      case 'flanger':
        this.glide(this.effectNodes.flangerGain.gain, amount, engage);
        return;
    }
  }

  getEffectNodes() {
    return this.effectNodes;
  }
}

window.EffectsEngine = EffectsEngine;
