class DeckController {
  constructor(deckId) {
    this.deckId = deckId;
    this.isScratching = false;
    this.vinylElement = null;
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
      }
      document.getElementById(`pitchDisplay${this.deckId}`).textContent = `${value}%`;
    });

    // EQ controls
    ['high', 'mid', 'low'].forEach(band => {
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

    // Effect controls
    const filterSlider = document.getElementById(`filter${this.deckId}`);
    filterSlider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        deck.setFilter(value);
      }
    });

    const reverbSlider = document.getElementById(`reverb${this.deckId}`);
    reverbSlider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        deck.setReverb(value);
      }
    });

    const delaySlider = document.getElementById(`delay${this.deckId}`);
    delaySlider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        deck.setDelay(value);
      }
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
      document.getElementById(`${buttonId}${this.deckId}`).addEventListener('mouseup', () => {
        const deck = window.audioEngine.getDeck(this.deckId);
        if (deck) {
          deck.pitchBend(0);
        }
      });
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
        
    // Show loading state
    trackInfo.classList.add('loading');
    trackInfo.querySelector('.track-name').textContent = 'Loading...';
        
    const success = await deck.loadFile(file);
        
    if (success) {
      // Update track info
      trackInfo.querySelector('.track-name').textContent = file.name;
      this.updateTrackTime();
            
      // Generate waveform
      const waveformRenderer = window.waveformRenderers[this.deckId];
      if (waveformRenderer) {
        await waveformRenderer.generateWaveform(deck.audioBuffer);
      }
            
      // Update BPM display
      document.getElementById(`bpm${this.deckId}`).textContent = deck.getBPM();
    } else {
      trackInfo.querySelector('.track-name').textContent = 'Failed to load';
    }
        
    trackInfo.classList.remove('loading');
  }

  play() {
    const deck = window.audioEngine.getDeck(this.deckId);
    if (deck) {
      deck.play();
      this.updatePlayingState(true);
      // Start vinyl animation
      if (this.vinylElement && !this.isScratching) {
        this.vinylElement.classList.add('spinning');
      }
    }
  }

  pause() {
    const deck = window.audioEngine.getDeck(this.deckId);
    if (deck) {
      deck.pause();
      this.updatePlayingState(false);
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
      // Stop vinyl animation
      if (this.vinylElement) {
        this.vinylElement.classList.remove('spinning');
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

  updateTrackTime() {
    const deck = window.audioEngine.getDeck(this.deckId);
    if (!deck || !deck.audioBuffer) return;

    const currentTime = deck.getCurrentTime();
    const duration = deck.getDuration();
    const trackTimeElement = document.getElementById(`trackInfo${this.deckId}`).querySelector('.track-time');
    
    trackTimeElement.textContent = `${this.formatTime(currentTime)} / ${this.formatTime(duration)}`;
  }

  formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
}