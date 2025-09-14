class EffectsEngine {
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.effectNodes = {};
    this.initializeEffects();
  }

  initializeEffects() {
    this.effectNodes.reverb = this.audioContext.createConvolver();
    this.effectNodes.reverbGain = this.audioContext.createGain();
    this.effectNodes.reverbGain.gain.value = 0;
    this.effectNodes.reverbDry = this.audioContext.createGain();
    this.effectNodes.reverbDry.gain.value = 1;

    this.effectNodes.delay = this.audioContext.createDelay(1);
    this.effectNodes.delay.delayTime.value = 0.3;
    this.effectNodes.delayGain = this.audioContext.createGain();
    this.effectNodes.delayGain.gain.value = 0;
    this.effectNodes.delayFeedback = this.audioContext.createGain();
    this.effectNodes.delayFeedback.gain.value = 0.3;

    this.effectNodes.phaser = [];
    this.effectNodes.phaserLFO = this.audioContext.createOscillator();
    this.effectNodes.phaserLFO.type = 'sine';
    this.effectNodes.phaserLFO.frequency.value = 0.3;
    this.effectNodes.phaserLFOGain = this.audioContext.createGain();
    this.effectNodes.phaserLFOGain.gain.value = 0;
    this.effectNodes.phaserGain = this.audioContext.createGain();
    this.effectNodes.phaserGain.gain.value = 0;
    this.effectNodes.phaserDry = this.audioContext.createGain();
    this.effectNodes.phaserDry.gain.value = 1;
    
    // Add feedback for more character
    this.effectNodes.phaserFeedback = this.audioContext.createGain();
    this.effectNodes.phaserFeedback.gain.value = 0.3; // Moderate feedback for warmth
    
    // Use 6 filters with more musical frequency distribution
    // Based on common phaser pedal designs - covering a wider frequency range
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
    this.effectNodes.flangerDry = this.audioContext.createGain();
    this.effectNodes.flangerDry.gain.value = 1;

    this.connectEffectChain();
    this.createReverbImpulse();
    this.startEffectOscillators();
  }

  connectEffectChain() {
    // Connect delay feedback loop
    this.effectNodes.delay.connect(this.effectNodes.delayFeedback);
    this.effectNodes.delayFeedback.connect(this.effectNodes.delay);
    this.effectNodes.delay.connect(this.effectNodes.delayGain);

    // Connect phaser
    for (let i = 0; i < this.effectNodes.phaser.length; i++) {
      if (i === 0) {
        // First filter connects from source (will be connected in play method)
      } else {
        this.effectNodes.phaser[i - 1].connect(this.effectNodes.phaser[i]);
      }
    }
    
    // Add feedback from the last phaser stage back to the first for more character
    if (this.effectNodes.phaser.length > 0) {
      const lastPhaser = this.effectNodes.phaser[this.effectNodes.phaser.length - 1];
      lastPhaser.connect(this.effectNodes.phaserFeedback);
      this.effectNodes.phaserFeedback.connect(this.effectNodes.phaser[0]);
    }
    
    // Connect phaser LFO through gain node for proper modulation to all filters
    this.effectNodes.phaserLFO.connect(this.effectNodes.phaserLFOGain);
    for (let i = 0; i < this.effectNodes.phaser.length; i++) {
      this.effectNodes.phaserLFOGain.connect(this.effectNodes.phaser[i].frequency);
    }
    
    // Connect flanger feedback loop
    this.effectNodes.flanger.connect(this.effectNodes.flangerFeedback);
    this.effectNodes.flangerFeedback.connect(this.effectNodes.flanger);

    // Connect flanger LFO through gain node for proper modulation
    this.effectNodes.flangerLFO.connect(this.effectNodes.flangerLFOGain);
    this.effectNodes.flangerLFOGain.connect(this.effectNodes.flanger.delayTime);

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
    // Create a more dramatic reverb impulse for better audibility
    const length = this.audioContext.sampleRate * 3; // Longer reverb tail (3 seconds)
    const impulse = this.audioContext.createBuffer(2, length, this.audioContext.sampleRate);
        
    for (let channel = 0; channel < 2; channel++) {
      const channelData = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const decay = Math.pow(1 - i / length, 1.2); // Slower decay for more prominent reverb
        const noise = (Math.random() * 2 - 1);
        
        // Add some early reflections for more character
        let amplitude = decay;
        if (i < this.audioContext.sampleRate * 0.1) { // First 100ms
          amplitude *= (1 + Math.sin(i / 1000) * 0.3); // Add early reflection pattern
        }
        
        channelData[i] = noise * amplitude;
      }
    }
        
    this.effectNodes.reverb.buffer = impulse;
  }

  // Effect parameter control methods
  setReverb(value) {
    if (this.effectNodes.reverbGain) {
      const wetLevel = Math.pow(value / 100, 0.7) * 1.2; // Exponential curve, max 120%
      this.effectNodes.reverbGain.gain.value = Math.min(wetLevel, 1.2);
      this.effectNodes.reverbDry.gain.value = Math.max(1 - (wetLevel * 0.8), 0.2); // Keep some dry signal
    }
  }

  setDelay(value) {
    if (this.effectNodes.delayGain) {
      this.effectNodes.delayGain.gain.value = value / 100;
    }
  }

  setPhaser(value) {
    if (this.effectNodes.phaserGain) {
      // Smoother wet/dry mix for more musical phasing
      const wetLevel = (value / 100) * 0.8;
      const dryLevel = Math.max(1 - (wetLevel * 0.5), 0.3);
      this.effectNodes.phaserGain.gain.value = wetLevel;
      this.effectNodes.phaserDry.gain.value = dryLevel;
      
      // More musical LFO modulation with exponential curve
      if (this.effectNodes.phaserLFOGain) {
        // Use exponential curve for more natural sweep
        const modDepth = Math.pow(value / 100, 0.6) * 600; // Slightly increased modulation depth
        this.effectNodes.phaserLFOGain.gain.value = modDepth;
      }
      
      // Dynamic feedback based on effect intensity for more character
      if (this.effectNodes.phaserFeedback) {
        const feedbackAmount = (value / 100) * 0.4; // Increase feedback with effect intensity
        this.effectNodes.phaserFeedback.gain.value = feedbackAmount;
      }
      
      // Slower, more musical LFO frequency range
      if (this.effectNodes.phaserLFO) {
        const minFreq = 0.08;
        const maxFreq = 0.5;
        this.effectNodes.phaserLFO.frequency.value = minFreq + (value / 100) * (maxFreq - minFreq);
      }
    }
  }

  setFlanger(value) {
    if (this.effectNodes.flangerGain) {
      this.effectNodes.flangerGain.gain.value = value / 100;
      this.effectNodes.flangerDry.gain.value = 1 - (value / 100);
    }
  }

  // Get effect nodes for connection in audio chain
  getEffectNodes() {
    return this.effectNodes;
  }
}

class EffectsController {
  constructor(deckId) {
    this.deckId = deckId;
    this.setupEffectControls();
  }

  // Utility function for creating effect slider handlers
  createEffectSliderHandler(effectName, deckMethod) {
    const slider = document.getElementById(`${effectName}${this.deckId}`);
    if (!slider) return;

    slider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck && typeof deck[deckMethod] === 'function') {
        deck[deckMethod](value);
      }
    });
  }

  setupEffectControls() {
    this.createEffectSliderHandler('filter', 'setFilter');
    this.createEffectSliderHandler('reverb', 'setReverb');
    this.createEffectSliderHandler('delay', 'setDelay');
    this.createEffectSliderHandler('phaser', 'setPhaser');
    this.createEffectSliderHandler('flanger', 'setFlanger');
  }
}

window.EffectsEngine = EffectsEngine;
window.EffectsController = EffectsController;
