class SoundPad {
  constructor(audioEngine) {
    this.audioEngine = audioEngine;
    this.sounds = {};
    this.setupEventListeners();
  }

  // Generate air horn sound
  generateAirHorn(audioContext, duration = 0.8) {
    const sampleRate = audioContext.sampleRate;
    const length = sampleRate * duration;
    const buffer = audioContext.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const time = i / sampleRate;
      // Descending frequency from 1200Hz to 400Hz
      const frequency = 1200 - (800 * time / duration);
      const sample = Math.sin(2 * Math.PI * frequency * time) * Math.exp(-time * 2);
      data[i] = sample * 0.3;
    }

    return buffer;
  }

  // Generate siren sound
  generateSiren(audioContext, duration = 1.5) {
    const sampleRate = audioContext.sampleRate;
    const length = sampleRate * duration;
    const buffer = audioContext.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const time = i / sampleRate;
      // Oscillating frequency between 400Hz and 800Hz
      const frequency = 600 + 200 * Math.sin(2 * Math.PI * 2 * time);
      const sample = Math.sin(2 * Math.PI * frequency * time);
      data[i] = sample * 0.2;
    }

    return buffer;
  }

  // Generate scratch sound
  generateScratch(audioContext, duration = 0.5) {
    const sampleRate = audioContext.sampleRate;
    const length = sampleRate * duration;
    const buffer = audioContext.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const time = i / sampleRate;
      // High frequency noise with envelope
      const noise = (Math.random() - 0.5) * 2;
      const envelope = Math.exp(-time * 8) * Math.sin(2 * Math.PI * 1000 * time);
      data[i] = noise * envelope * 0.15;
    }

    return buffer;
  }

  // Generate clap sound
  generateClap(audioContext, duration = 0.3) {
    const sampleRate = audioContext.sampleRate;
    const length = sampleRate * duration;
    const buffer = audioContext.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const time = i / sampleRate;
      // White noise with quick decay
      const noise = (Math.random() - 0.5) * 2;
      const envelope = Math.exp(-time * 15);
      data[i] = noise * envelope * 0.25;
    }

    return buffer;
  }

  // Generate explosion sound
  generateExplosion(audioContext, duration = 1.0) {
    const sampleRate = audioContext.sampleRate;
    const length = sampleRate * duration;
    const buffer = audioContext.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const time = i / sampleRate;
      // Low frequency rumble with noise
      const rumble = Math.sin(2 * Math.PI * 60 * time) * 0.5;
      const noise = (Math.random() - 0.5) * 2 * 0.3;
      const envelope = Math.exp(-time * 3);
      data[i] = (rumble + noise) * envelope * 0.4;
    }

    return buffer;
  }

  // Generate laser sound
  generateLaser(audioContext, duration = 0.6) {
    const sampleRate = audioContext.sampleRate;
    const length = sampleRate * duration;
    const buffer = audioContext.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const time = i / sampleRate;
      // Descending high frequency with harmonics
      const baseFreq = 2000 - (1500 * time / duration);
      const sample = Math.sin(2 * Math.PI * baseFreq * time) * 0.5 +
                    Math.sin(2 * Math.PI * baseFreq * 2 * time) * 0.3;
      const envelope = Math.exp(-time * 4);
      data[i] = sample * envelope * 0.2;
    }

    return buffer;
  }

  // Initialize sound buffers
  async initializeSounds() {
    if (!this.audioEngine.audioContext) {
      await this.audioEngine.initialize();
    }

    const audioContext = this.audioEngine.audioContext;
    
    this.sounds = {
      airhorn: this.generateAirHorn(audioContext),
      siren: this.generateSiren(audioContext),
      scratch: this.generateScratch(audioContext),
      clap: this.generateClap(audioContext),
      explosion: this.generateExplosion(audioContext),
      laser: this.generateLaser(audioContext)
    };
  }

  // Play a sound
  playSound(soundName) {
    if (!this.sounds[soundName] || !this.audioEngine.audioContext) {
      return;
    }

    try {
      const source = this.audioEngine.audioContext.createBufferSource();
      source.buffer = this.sounds[soundName];
      
      // Connect to master gain
      source.connect(this.audioEngine.masterGain);
      source.start();
    } catch (error) {
      console.error('Error playing sound:', error);
    }
  }

  // Setup event listeners for sound pad buttons
  setupEventListeners() {
    // Add event listeners for each sound pad button
    for (let i = 1; i <= 6; i++) {
      const button = document.getElementById(`soundPad${i}`);
      if (button) {
        button.addEventListener('click', async () => {
          // Initialize sounds if not done yet
          if (Object.keys(this.sounds).length === 0) {
            await this.initializeSounds();
          }
          
          const soundName = button.getAttribute('data-sound');
          this.playSound(soundName);
          
          // Visual feedback
          button.style.transform = 'scale(0.95)';
          setTimeout(() => {
            button.style.transform = '';
          }, 100);
        });
      }
    }
  }
}

// Global sound pad instance
window.soundPad = null;