class MixerController {
  constructor() {
    this.crossfaderValue = 50;
    this.vuMeters = {
      A: null,
      B: null,
      master: null
    };
    this.setupEventListeners();
    this.initializeVUMeters();
    this.startVUAnimation();
  }

  setupEventListeners() {
    // Master volume
    const masterVolume = document.getElementById('masterVolume');
    masterVolume.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      window.audioEngine.setMasterVolume(value);
      e.target.nextElementSibling.textContent = `${value}%`;
    });

    // Crossfader
    const crossfader = document.getElementById('crossfader');
    crossfader.addEventListener('input', (e) => {
      this.crossfaderValue = parseInt(e.target.value);
      this.updateCrossfader();
    });

    // Setup deck controls
    this.setupDeckControls('A');
    this.setupDeckControls('B');

    // Sync buttons
    document.getElementById('syncAB').addEventListener('click', () => {
      this.syncDecks('A', 'B');
    });

    document.getElementById('syncBA').addEventListener('click', () => {
      this.syncDecks('B', 'A');
    });
  }

  setupDeckControls(deckId) {
    // File input
    const fileInput = document.getElementById(`fileInput${deckId}`);
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        await this.loadTrack(deckId, file);
      }
    });

    // Transport controls
    document.getElementById(`play${deckId}`).addEventListener('click', () => {
      this.playDeck(deckId);
    });

    document.getElementById(`pause${deckId}`).addEventListener('click', () => {
      this.pauseDeck(deckId);
    });

    document.getElementById(`stop${deckId}`).addEventListener('click', () => {
      this.stopDeck(deckId);
    });

    document.getElementById(`cue${deckId}`).addEventListener('click', () => {
      this.cueDeck(deckId);
    });

    // Pitch control
    const pitchSlider = document.getElementById(`pitch${deckId}`);
    pitchSlider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      const deck = window.audioEngine.getDeck(deckId);
      if (deck) {
        deck.setPitch(value);
      }
      document.getElementById(`pitchDisplay${deckId}`).textContent = `${value}%`;
    });

    // EQ controls
    ['high', 'mid', 'low'].forEach(band => {
      const eqSlider = document.getElementById(`${band}${deckId}`);
      eqSlider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        const deck = window.audioEngine.getDeck(deckId);
        if (deck) {
          deck.setEQ(band, value);
        }
        e.target.nextElementSibling.textContent = value;
      });
    });

    // Effect controls
    const filterSlider = document.getElementById(`filter${deckId}`);
    filterSlider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      const deck = window.audioEngine.getDeck(deckId);
      if (deck) {
        deck.setFilter(value);
      }
    });

    const reverbSlider = document.getElementById(`reverb${deckId}`);
    reverbSlider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      const deck = window.audioEngine.getDeck(deckId);
      if (deck) {
        deck.setReverb(value);
      }
    });

    const delaySlider = document.getElementById(`delay${deckId}`);
    delaySlider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      const deck = window.audioEngine.getDeck(deckId);
      if (deck) {
        deck.setDelay(value);
      }
    });

    // Volume control
    const volumeSlider = document.getElementById(`volume${deckId}`);
    volumeSlider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      const deck = window.audioEngine.getDeck(deckId);
      if (deck) {
        deck.setVolume(value);
      }
      e.target.nextElementSibling.textContent = `${value}%`;
    });

    // New controls added per user feedback
    
    // Pitch bend buttons
    document.getElementById(`pitchBendPlus${deckId}`).addEventListener('mousedown', () => {
      const deck = window.audioEngine.getDeck(deckId);
      if (deck) {
        deck.pitchBend(1);
      }
    });

    document.getElementById(`pitchBendMinus${deckId}`).addEventListener('mousedown', () => {
      const deck = window.audioEngine.getDeck(deckId);
      if (deck) {
        deck.pitchBend(-1);
      }
    });

    // CUE point controls
    document.getElementById(`cue1${deckId}`).addEventListener('click', () => {
      const deck = window.audioEngine.getDeck(deckId);
      if (deck) {
        deck.jumpToCue(1);
      }
    });

    document.getElementById(`cue2${deckId}`).addEventListener('click', () => {
      const deck = window.audioEngine.getDeck(deckId);
      if (deck) {
        deck.jumpToCue(2);
      }
    });

    document.getElementById(`setCue1${deckId}`).addEventListener('click', () => {
      const deck = window.audioEngine.getDeck(deckId);
      if (deck) {
        deck.setCuePoint(1);
      }
    });

    document.getElementById(`setCue2${deckId}`).addEventListener('click', () => {
      const deck = window.audioEngine.getDeck(deckId);
      if (deck) {
        deck.setCuePoint(2);
      }
    });

    // Loop controls
    document.getElementById(`loopIn${deckId}`).addEventListener('click', () => {
      const deck = window.audioEngine.getDeck(deckId);
      if (deck) {
        deck.setLoopIn();
      }
    });

    document.getElementById(`loopOut${deckId}`).addEventListener('click', () => {
      const deck = window.audioEngine.getDeck(deckId);
      if (deck) {
        deck.setLoopOut();
      }
    });

    document.getElementById(`loopToggle${deckId}`).addEventListener('click', () => {
      const deck = window.audioEngine.getDeck(deckId);
      if (deck) {
        deck.toggleLoop();
      }
    });

    // New effects: Phaser and Flanger
    const phaserSlider = document.getElementById(`phaser${deckId}`);
    phaserSlider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      const deck = window.audioEngine.getDeck(deckId);
      if (deck) {
        deck.setPhaser(value);
      }
    });

    const flangerSlider = document.getElementById(`flanger${deckId}`);
    flangerSlider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      const deck = window.audioEngine.getDeck(deckId);
      if (deck) {
        deck.setFlanger(value);
      }
    });
  }

  async loadTrack(deckId, file) {
    await window.audioEngine.initialize();
        
    const deck = window.audioEngine.getDeck(deckId);
    const trackInfo = document.getElementById(`trackInfo${deckId}`);
        
    // Show loading state
    trackInfo.classList.add('loading');
    trackInfo.querySelector('.track-name').textContent = 'Loading...';
        
    const success = await deck.loadFile(file);
        
    if (success) {
      // Update track info
      trackInfo.querySelector('.track-name').textContent = file.name;
      this.updateTrackTime(deckId);
            
      // Generate waveform
      const waveformRenderer = window.waveformRenderers[deckId];
      if (waveformRenderer) {
        await waveformRenderer.generateWaveform(deck.audioBuffer);
      }
            
      // Update BPM display
      document.getElementById(`bpm${deckId}`).textContent = deck.getBPM();
    } else {
      trackInfo.querySelector('.track-name').textContent = 'Failed to load';
    }
        
    trackInfo.classList.remove('loading');
  }

  async playDeck(deckId) {
    await window.audioEngine.resumeContext();
        
    const deck = window.audioEngine.getDeck(deckId);
    if (deck) {
      deck.play();
      this.updateTransportButtons(deckId);
      this.updateDeckVisuals(deckId, true);
    }
  }

  pauseDeck(deckId) {
    const deck = window.audioEngine.getDeck(deckId);
    if (deck) {
      deck.pause();
      this.updateTransportButtons(deckId);
      this.updateDeckVisuals(deckId, false);
    }
  }

  stopDeck(deckId) {
    const deck = window.audioEngine.getDeck(deckId);
    if (deck) {
      deck.stop();
      this.updateTransportButtons(deckId);
      this.updateDeckVisuals(deckId, false);
    }
  }

  cueDeck(deckId) {
    const deck = window.audioEngine.getDeck(deckId);
    if (deck) {
      deck.stop();
      deck.pauseTime = 0;
      this.updateTransportButtons(deckId);
      this.updateDeckVisuals(deckId, false);
    }
  }

  updateTransportButtons(deckId) {
    const deck = window.audioEngine.getDeck(deckId);
    const playBtn = document.getElementById(`play${deckId}`);
    const pauseBtn = document.getElementById(`pause${deckId}`);
        
    // Remove active class from all buttons
    document.querySelectorAll(`#deck${deckId} .transport-controls button`).forEach(btn => {
      btn.classList.remove('active');
    });
        
    if (deck.isPlaying) {
      playBtn.classList.add('active');
    }
  }

  updateDeckVisuals(deckId, isPlaying) {
    const deckElement = document.getElementById(`deck${deckId}`);
    if (isPlaying) {
      deckElement.classList.add('playing');
    } else {
      deckElement.classList.remove('playing');
    }
  }

  updateCrossfader() {
    const deckA = window.audioEngine.getDeck('A');
    const deckB = window.audioEngine.getDeck('B');
        
    if (deckA && deckB) {
      const fadeA = Math.cos((this.crossfaderValue / 100) * Math.PI / 2);
      const fadeB = Math.sin((this.crossfaderValue / 100) * Math.PI / 2);
            
      // Apply crossfader curve
      deckA.gainNode.gain.value = deckA.volume * fadeA;
      deckB.gainNode.gain.value = deckB.volume * fadeB;
    }
  }

  syncDecks(sourceDeck, targetDeck) {
    const source = window.audioEngine.getDeck(sourceDeck);
    const target = window.audioEngine.getDeck(targetDeck);
        
    if (source && target && source.audioBuffer && target.audioBuffer) {
      const sourceBPM = source.getBPM();
      const targetBPM = target.getBPM();
            
      if (sourceBPM > 0 && targetBPM > 0) {
        const pitchAdjustment = ((sourceBPM / targetBPM) - 1) * 100;
        target.setPitch(pitchAdjustment);
                
        // Update UI
        const pitchSlider = document.getElementById(`pitch${targetDeck}`);
        const pitchDisplay = document.getElementById(`pitchDisplay${targetDeck}`);
        pitchSlider.value = pitchAdjustment;
        pitchDisplay.textContent = `${pitchAdjustment.toFixed(1)}%`;
      }
    }
  }

  updateTrackTime(deckId) {
    const deck = window.audioEngine.getDeck(deckId);
    const trackInfo = document.getElementById(`trackInfo${deckId}`);
    const timeDisplay = trackInfo.querySelector('.track-time');
        
    if (deck && deck.audioBuffer) {
      const currentTime = deck.getCurrentTime();
      const duration = deck.getDuration();
            
      const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      };
            
      timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    }
  }

  initializeVUMeters() {
    ['A', 'B', 'master'].forEach(id => {
      const container = document.getElementById(`vu${id === 'master' ? 'Master' : id}`);
      const bars = [];
            
      for (let i = 0; i < 20; i++) {
        const bar = document.createElement('div');
        bar.className = 'vu-bar';
        bar.style.height = '3px';
        container.appendChild(bar);
        bars.push(bar);
      }
            
      this.vuMeters[id] = bars;
    });
  }

  updateVUMeter(deckId, level) {
    const bars = this.vuMeters[deckId];
    if (!bars) return;
        
    const activeCount = Math.floor((level / 255) * bars.length);
        
    bars.forEach((bar, index) => {
      bar.classList.remove('active-low', 'active-mid', 'active-high');
            
      if (index < activeCount) {
        if (index < bars.length * 0.6) {
          bar.classList.add('active-low');
        } else if (index < bars.length * 0.8) {
          bar.classList.add('active-mid');
        } else {
          bar.classList.add('active-high');
        }
      }
    });
  }

  startVUAnimation() {
    const updateVU = () => {
      // Update deck VU meters
      ['A', 'B'].forEach(deckId => {
        const deck = window.audioEngine.getDeck(deckId);
        if (deck && deck.isPlaying) {
          const analyserData = deck.getAnalyserData();
          const average = analyserData.reduce((sum, value) => sum + value, 0) / analyserData.length;
          this.updateVUMeter(deckId, average);
        } else {
          this.updateVUMeter(deckId, 0);
        }
      });
            
      // Update master VU meter (simplified)
      const deckA = window.audioEngine.getDeck('A');
      const deckB = window.audioEngine.getDeck('B');
      let masterLevel = 0;
            
      if (deckA && deckA.isPlaying) {
        const dataA = deckA.getAnalyserData();
        masterLevel += dataA.reduce((sum, value) => sum + value, 0) / dataA.length;
      }
            
      if (deckB && deckB.isPlaying) {
        const dataB = deckB.getAnalyserData();
        masterLevel += dataB.reduce((sum, value) => sum + value, 0) / dataB.length;
      }
            
      this.updateVUMeter('master', masterLevel / 2);
            
      // Update track times
      this.updateTrackTime('A');
      this.updateTrackTime('B');
            
      requestAnimationFrame(updateVU);
    };
        
    updateVU();
  }
}

// Global mixer controller
window.mixerController = new MixerController();