class MixerController {
  constructor() {
    this.crossfaderValue = 50;
    this.vuMeters = {
      A: null,
      B: null,
      master: null
    };
    this.beatMeters = {
      A: null,
      B: null
    };
    this.beatStates = {
      A: { currentBeat: 0, lastBeatTime: 0 },
      B: { currentBeat: 0, lastBeatTime: 0 }
    };
    this.deckControllers = {};
    this.setupEventListeners();
    this.initializeVUMeters();
    this.initializeBeatMeters();
    this.startVUAnimation();
  }

  // Utility function to calculate average of analyser data
  getAnalyserAverage(analyserData) {
    return analyserData.reduce((sum, value) => sum + value, 0) / analyserData.length;
  }

  // Utility function for creating slider event handlers
  createSliderHandler(sliderId, callback, displayOptions = {}) {
    const slider = document.getElementById(sliderId);
    if (!slider) return;

    slider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      callback(value);

      // Update display element if configured
      if (displayOptions.updateDisplay !== false) {
        const displayElement = displayOptions.displayElement || e.target.nextElementSibling;
        if (displayElement) {
          const suffix = displayOptions.suffix || '';
          displayElement.textContent = `${value}${suffix}`;
        }
      }
    });
  }

  setupEventListeners() {
    // Master volume control
    this.createSliderHandler('masterVolume', (value) => {
      window.audioEngine.setMasterVolume(value);
    }, { suffix: '%' });

    const crossfader = document.getElementById('crossfader');
    crossfader.addEventListener('input', (e) => {
      this.crossfaderValue = parseInt(e.target.value);
      this.updateCrossfader();
    });

    this.deckControllers.A = new DeckController('A');
    this.deckControllers.B = new DeckController('B');

    // Sync buttons
    window.buttonHandler.createClickHandler('syncAB', () => this.syncDecks('A', 'B'));
    window.buttonHandler.createClickHandler('syncBA', () => this.syncDecks('B', 'A'));
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
        // Match the BPM by adjusting pitch
        const pitchAdjustment = ((sourceBPM / targetBPM) - 1) * 100;
        target.setPitch(pitchAdjustment);
                
        // Update UI to reflect pitch change
        const pitchSlider = document.getElementById(`pitch${targetDeck}`);
        const pitchDisplay = document.getElementById(`pitchDisplay${targetDeck}`);
        pitchSlider.value = pitchAdjustment;
        pitchDisplay.textContent = `${pitchAdjustment.toFixed(1)}%`;

        // Match the beat timing
        this.syncBeatTiming(source, target);
        
        console.log(`Synced deck ${targetDeck} to deck ${sourceDeck}: BPM ${targetBPM} -> ${sourceBPM}, pitch: ${pitchAdjustment.toFixed(1)}%`);
      }
    }
  }

  syncBeatTiming(sourceDeck, targetDeck) {
    // Get current playback positions
    const sourceTime = sourceDeck.getCurrentTime();
    const targetTime = targetDeck.getCurrentTime();
    
    // Find the nearest beats for both decks
    const sourceNearestBeat = sourceDeck.findNearestBeat(sourceTime);
    const targetNearestBeat = targetDeck.findNearestBeat(targetTime);
    
    // Calculate how far each deck is from its nearest beat
    const sourceToNearestBeat = sourceTime - sourceNearestBeat;
    const targetToNearestBeat = targetTime - targetNearestBeat;
    
    // Calculate beat phase difference
    const beatPhaseDifference = sourceToNearestBeat - targetToNearestBeat;
    
    // If the phase difference is significant, adjust target deck position
    if (Math.abs(beatPhaseDifference) > 0.05) { // 50ms tolerance
      // Calculate the adjustment needed
      let adjustment = beatPhaseDifference;
      
      // Determine if we should sync to current beat or next beat
      const sourceBeatInterval = 60 / sourceDeck.getBPM();
      
      // If adjustment is more than half a beat, sync to the next beat instead
      if (Math.abs(adjustment) > sourceBeatInterval / 2) {
        if (adjustment > 0) {
          adjustment -= sourceBeatInterval;
        } else {
          adjustment += sourceBeatInterval;
        }
      }
      
      // Apply the timing adjustment
      const newTargetTime = targetTime + adjustment;
      
      // Ensure we don't seek to negative time or beyond track duration
      if (newTargetTime >= 0 && newTargetTime < targetDeck.getDuration()) {
        targetDeck.seek(newTargetTime);
        console.log(`Beat sync: adjusted deck ${targetDeck.deckId} by ${adjustment.toFixed(3)}s for beat alignment`);
      }
    }
  }

  initializeVUMeters() {
    ['A', 'B', 'master'].forEach(id => {
      const container = document.getElementById(`vu${id === 'master' ? 'Master' : id}`);
      const bars = [];
            
      for (let i = 0; i < 12; i++) {
        const bar = document.createElement('div');
        bar.className = 'vu-bar';
        container.appendChild(bar);
        bars.push(bar);
      }
            
      this.vuMeters[id] = bars;
    });
  }

  initializeBeatMeters() {
    ['A', 'B'].forEach(deckId => {
      const container = document.getElementById(`beatMeter${deckId}`);
      if (container) {
        const bars = Array.from(container.querySelectorAll('.beat-bar'));
        this.beatMeters[deckId] = bars;
      }
    });
  }

  // Helper function to get VU bar class based on position
  getVUBarClass(index, totalBars) {
    if (index < totalBars * 0.6) return 'active-low';
    if (index < totalBars * 0.8) return 'active-mid';
    return 'active-high';
  }

  updateVUMeter(deckId, level) {
    const bars = this.vuMeters[deckId];
    if (!bars) return;
        
    const activeCount = Math.floor((level / 255) * bars.length);
        
    bars.forEach((bar, index) => {
      bar.classList.remove('active-low', 'active-mid', 'active-high');
            
      if (index < activeCount) {
        bar.classList.add(this.getVUBarClass(index, bars.length));
      }
    });
  }

  updateBeatMeter(deckId) {
    const deck = window.audioEngine.getDeck(deckId);
    const bars = this.beatMeters[deckId];
    
    if (!deck || !bars || !deck.audioBuffer || !deck.isPlaying) {
      // Clear all bars if deck is not playing
      bars.forEach(bar => {
        bar.classList.remove('active');
      });
      return;
    }

    const currentTime = deck.getCurrentTime();
    const beatInterval = 60 / deck.getBPM(); // Time between beats in seconds
    const timeSinceLastBeat = currentTime % beatInterval;
    const currentBeat = Math.floor(currentTime / beatInterval) % 4; // 4 beats per measure

    // Update beat state
    const beatState = this.beatStates[deckId];
    
    // Check if we're close to a beat (within 100ms)
    const isOnBeat = timeSinceLastBeat < 0.1 || timeSinceLastBeat > (beatInterval - 0.1);
    
    // Update the bars
    bars.forEach((bar, index) => {
      bar.classList.remove('active');
      
      if (index === currentBeat && isOnBeat) {
        bar.classList.add('active');
      }
    });
  }



  startVUAnimation() {
    const updateVU = () => {
      // Get master volume for VU meter scaling
      const masterVolume = window.audioEngine.getMasterVolume();
      
      ['A', 'B'].forEach(deckId => {
        const deck = window.audioEngine.getDeck(deckId);
        if (deck && deck.isPlaying) {
          const analyserData = deck.getAnalyserData();
          const average = this.getAnalyserAverage(analyserData);
          const scaledLevel = average * masterVolume;
          this.updateVUMeter(deckId, scaledLevel);
        } else {
          this.updateVUMeter(deckId, 0);
        }
        
        // Update beat meters
        this.updateBeatMeter(deckId);
      });
            
      const deckA = window.audioEngine.getDeck('A');
      const deckB = window.audioEngine.getDeck('B');
      let masterLevel = 0;
            
      if (deckA && deckA.isPlaying) {
        const dataA = deckA.getAnalyserData();
        masterLevel += this.getAnalyserAverage(dataA);
      }
            
      if (deckB && deckB.isPlaying) {
        const dataB = deckB.getAnalyserData();
        masterLevel += this.getAnalyserAverage(dataB);
      }
      
      const scaledMasterLevel = (masterLevel / 2) * masterVolume;
      this.updateVUMeter('master', scaledMasterLevel);
            
      if (this.deckControllers.A) this.deckControllers.A.updateTrackTime();
      if (this.deckControllers.B) this.deckControllers.B.updateTrackTime();
            
      requestAnimationFrame(updateVU);
    };
        
    updateVU();
  }
}

window.mixerController = new MixerController();
