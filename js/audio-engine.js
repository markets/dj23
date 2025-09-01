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

  getMasterVolume() {
    return this.masterGain ? this.masterGain.gain.value : 0.75;
  }

  getDeck(deckId) {
    return this.decks[deckId];
  }
}

// Global audio engine instance
window.audioEngine = new AudioEngine();
