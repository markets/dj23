/**
 * DJ23 Deck UI Controller
 * Handles UI interactions and visual updates for deck controls
 */
class DeckUIController {
  constructor(deckId) {
    this.deckId = deckId;
    this.setupEventListeners();
    
    // Initialize sub-controllers
    this.trackMetadata = new TrackMetadata(deckId);
    this.vinylController = new VinylController(deckId);
    
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

    this.setupControlEventListeners();
    this.setupCueEventListeners();
    this.setupLoopEventListeners();
  }

  setupControlEventListeners() {
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

    this.setupPitchBendControls();
    this.setupResetControls();
  }

  setupPitchBendControls() {
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
  }

  setupResetControls() {
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

    // Reset filters button
    document.getElementById(`resetFilters${this.deckId}`).addEventListener('click', () => {
      this.resetFilters();
    });
  }

  setupCueEventListeners() {
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
  }

  setupLoopEventListeners() {
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
  }

  async loadTrack(file) {
    const deck = window.audioEngine.getDeck(this.deckId);
    return await this.trackMetadata.loadTrack(file, deck, this);
  }

  play() {
    const deck = window.audioEngine.getDeck(this.deckId);
    if (deck) {
      deck.play();
      this.updatePlayingState(true);
      this.updatePauseState(false);
      // Start vinyl animation
      this.vinylController.startSpinning();
      // Resume waveform animations
      this.startWaveformAnimations();
    }
  }

  pause() {
    const deck = window.audioEngine.getDeck(this.deckId);
    if (deck) {
      deck.pause();
      this.updatePlayingState(false);
      this.updatePauseState(true);
      // Stop vinyl animation
      this.vinylController.stopSpinning();
      // Stop waveform animations
      this.stopWaveformAnimations();
    }
  }

  stop() {
    const deck = window.audioEngine.getDeck(this.deckId);
    if (deck) {
      deck.stop();
      this.updatePlayingState(false);
      this.updatePauseState(false);
      // Stop vinyl animation
      this.vinylController.stopSpinning();
      // Force waveform update to show position at beginning
      this.updateWaveformsAtStop();
    }
  }

  cue() {
    const deck = window.audioEngine.getDeck(this.deckId);
    if (deck) {
      deck.cue();
    }
  }

  startWaveformAnimations() {
    if (window.waveformRenderers && window.waveformRenderers[this.deckId]) {
      window.waveformRenderers[this.deckId].startAnimation();
    }
    if (window.beatWaveformRenderers && window.beatWaveformRenderers[this.deckId]) {
      window.beatWaveformRenderers[this.deckId].startAnimation();
    }
  }

  stopWaveformAnimations() {
    if (window.waveformRenderers && window.waveformRenderers[this.deckId]) {
      window.waveformRenderers[this.deckId].stopAnimation();
    }
    if (window.beatWaveformRenderers && window.beatWaveformRenderers[this.deckId]) {
      window.beatWaveformRenderers[this.deckId].stopAnimation();
    }
  }

  updateWaveformsAtStop() {
    if (window.waveformRenderers && window.waveformRenderers[this.deckId]) {
      window.waveformRenderers[this.deckId].updatePlayhead();
      window.waveformRenderers[this.deckId].render();
    }
    if (window.beatWaveformRenderers && window.beatWaveformRenderers[this.deckId]) {
      window.beatWaveformRenderers[this.deckId].updatePlayhead();
      window.beatWaveformRenderers[this.deckId].render();
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
}

// Export for use in other modules
window.DeckUIController = DeckUIController;