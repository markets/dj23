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
    this.effectNodes.phaserLFOGain.gain.value = 800;
    this.effectNodes.phaserGain = this.audioContext.createGain();
    this.effectNodes.phaserGain.gain.value = 0;
    this.effectNodes.phaserDry = this.audioContext.createGain();
    this.effectNodes.phaserDry.gain.value = 1;
    
    for (let i = 0; i < 8; i++) {
      this.effectNodes.phaser[i] = this.audioContext.createBiquadFilter();
      this.effectNodes.phaser[i].type = 'allpass';
      this.effectNodes.phaser[i].frequency.value = 500 + (i * 200);
      this.effectNodes.phaser[i].Q.value = 5;
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

    // Connect phaser chain
    for (let i = 0; i < this.effectNodes.phaser.length; i++) {
      if (i === 0) {
        // First filter connects from source (will be connected in play method)
      } else {
        this.effectNodes.phaser[i - 1].connect(this.effectNodes.phaser[i]);
      }
    }
    
    // Connect phaser LFO through gain node for proper modulation
    this.effectNodes.phaserLFO.connect(this.effectNodes.phaserLFOGain);
    
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

  // Effect parameter control methods
  setReverb(value) {
    if (this.effectNodes.reverbGain) {
      this.effectNodes.reverbGain.gain.value = value / 100;
      this.effectNodes.reverbDry.gain.value = 1 - (value / 100);
    }
  }

  setDelay(value) {
    if (this.effectNodes.delayGain) {
      this.effectNodes.delayGain.gain.value = value / 100;
    }
  }

  setPhaser(value) {
    if (this.effectNodes.phaserGain) {
      // Better wet/dry mix curve for more musical phasing
      const wetLevel = (value / 100) * 0.7; // Max 70% wet for better balance
      const dryLevel = 1 - (wetLevel * 0.5); // Keep some dry signal for punch
      this.effectNodes.phaserGain.gain.value = wetLevel;
      this.effectNodes.phaserDry.gain.value = dryLevel;
      
      // Adjust LFO depth based on effect intensity
      if (this.effectNodes.phaserLFOGain) {
        this.effectNodes.phaserLFOGain.gain.value = 400 + (value * 8); // Dynamic modulation depth
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

  setupEffectControls() {
    // Filter effect
    const filterSlider = document.getElementById(`filter${this.deckId}`);
    filterSlider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        deck.setFilter(value);
      }
    });

    // Reverb effect
    const reverbSlider = document.getElementById(`reverb${this.deckId}`);
    reverbSlider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        deck.setReverb(value);
      }
    });

    // Delay effect
    const delaySlider = document.getElementById(`delay${this.deckId}`);
    delaySlider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        deck.setDelay(value);
      }
    });

    // Phaser effect
    const phaserSlider = document.getElementById(`phaser${this.deckId}`);
    phaserSlider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        deck.setPhaser(value);
      }
    });

    // Flanger effect
    const flangerSlider = document.getElementById(`flanger${this.deckId}`);
    flangerSlider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        deck.setFlanger(value);
      }
    });
  }
}

// Make both classes available globally
window.EffectsEngine = EffectsEngine;
window.EffectsController = EffectsController;