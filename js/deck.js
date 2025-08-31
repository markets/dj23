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
        // Update BPM display to reflect pitch change
        this.updateBPMDisplay();
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

    // Reset filters button
    document.getElementById(`resetFilters${this.deckId}`).addEventListener('click', () => {
      this.resetFilters();
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
        
    // Stop current track if playing before loading new one
    this.stop();
        
    // Show loading state
    trackInfo.classList.add('loading');
    trackInfo.querySelector('.track-name').textContent = 'Loading...';
        
    const success = await deck.loadFile(file);
        
    if (success) {
      // Extract metadata and update track display
      await this.extractAndDisplayMetadata(file);
      this.updateTrackTime();
            
      // Generate main waveform
      const waveformRenderer = window.waveformRenderers[this.deckId];
      if (waveformRenderer) {
        await waveformRenderer.generateWaveform(deck.audioBuffer);
      }
      
      // Generate beat matching waveforms
      const beatWaveformRenderer = window.beatWaveformRenderers[this.deckId];
      
      if (beatWaveformRenderer) {
        await beatWaveformRenderer.generateWaveform(deck.audioBuffer);
      }
            
      // Update BPM display
      this.updateBPMDisplay();
    } else {
      trackInfo.querySelector('.track-name').textContent = 'Failed to load';
    }
        
    trackInfo.classList.remove('loading');
  }

  async extractAndDisplayMetadata(file) {
    return new Promise((resolve) => {
      // Use jsmediatags to extract metadata
      window.jsmediatags.read(file, {
        onSuccess: (tag) => {
          const tags = tag.tags;
          let displayTitle = '';
          
          // Extract artist and title
          const artist = tags.artist || '';
          const title = tags.title || '';
          const album = tags.album || '';
          
          // Format display title
          if (artist && title) {
            displayTitle = `${artist} - ${title}`;
          } else if (title) {
            displayTitle = title;
          } else {
            // Fallback to filename parsing
            displayTitle = this.parseFilenameForMetadata(file.name);
          }
          
          // Update track name display
          const trackNameElement = document.querySelector(`#trackInfo${this.deckId} .track-name`);
          trackNameElement.textContent = displayTitle;
          
          // Add album info if available
          if (album) {
            trackNameElement.title = `Album: ${album}`;
          }
          
          // Handle album cover
          this.displayAlbumCover(tags.picture);
          
          resolve();
        },
        onError: (error) => {
          console.log('Metadata extraction failed:', error);
          // Fallback to filename parsing
          const trackNameElement = document.querySelector(`#trackInfo${this.deckId} .track-name`);
          trackNameElement.textContent = this.parseFilenameForMetadata(file.name);
          this.displayAlbumCover(null);
          resolve();
        }
      });
    });
  }

  parseFilenameForMetadata(filename) {
    // Remove file extension
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
    
    // Try to parse common patterns
    const patterns = [
      /^(\d+[\s\-_]*)?(.+?)\s*[\-_]\s*(.+)$/,  // "01 - Artist - Title" or "Artist - Title"
      /^(.+?)[\s\-_]+(.+)$/                     // "Artist Title" or "Artist_Title"
    ];
    
    for (const pattern of patterns) {
      const match = nameWithoutExt.match(pattern);
      if (match) {
        const parts = match.slice(1).filter(part => part && !part.match(/^\d+$/));
        if (parts.length >= 2) {
          return `${parts[0].trim()} - ${parts[1].trim()}`;
        }
      }
    }
    
    // If no pattern matches, return cleaned filename
    return nameWithoutExt.trim();
  }

  displayAlbumCover(pictureData) {
    const albumCoverElement = document.getElementById(`albumCover${this.deckId}`);
    
    if (pictureData && pictureData.data) {
      try {
        // Create blob from picture data
        const byteArray = new Uint8Array(pictureData.data);
        const blob = new Blob([byteArray], { type: pictureData.format });
        const imageUrl = URL.createObjectURL(blob);
        
        // Set image source and show it
        albumCoverElement.src = imageUrl;
        albumCoverElement.style.display = 'block';
        
        // Clean up previous blob URL
        if (albumCoverElement.dataset.blobUrl) {
          URL.revokeObjectURL(albumCoverElement.dataset.blobUrl);
        }
        albumCoverElement.dataset.blobUrl = imageUrl;
      } catch (error) {
        console.log('Error displaying album cover:', error);
        this.hideAlbumCover();
      }
    } else {
      this.hideAlbumCover();
    }
  }

  hideAlbumCover() {
    const albumCoverElement = document.getElementById(`albumCover${this.deckId}`);
    albumCoverElement.style.display = 'none';
    
    // Clean up blob URL if exists
    if (albumCoverElement.dataset.blobUrl) {
      URL.revokeObjectURL(albumCoverElement.dataset.blobUrl);
      delete albumCoverElement.dataset.blobUrl;
    }
  }

  play() {
    const deck = window.audioEngine.getDeck(this.deckId);
    if (deck) {
      deck.play();
      this.updatePlayingState(true);
      this.updatePauseState(false);
      // Start vinyl animation
      if (this.vinylElement && !this.isScratching) {
        this.vinylElement.classList.add('spinning');
      }
      // Resume waveform animations
      if (window.waveformRenderers && window.waveformRenderers[this.deckId]) {
        window.waveformRenderers[this.deckId].startAnimation();
      }
      if (window.beatWaveformRenderers && window.beatWaveformRenderers[this.deckId]) {
        window.beatWaveformRenderers[this.deckId].startAnimation();
      }
    }
  }

  pause() {
    const deck = window.audioEngine.getDeck(this.deckId);
    if (deck) {
      deck.pause();
      this.updatePlayingState(false);
      this.updatePauseState(true);
      // Stop vinyl animation
      if (this.vinylElement) {
        this.vinylElement.classList.remove('spinning');
      }
      // Stop waveform animations
      if (window.waveformRenderers && window.waveformRenderers[this.deckId]) {
        window.waveformRenderers[this.deckId].stopAnimation();
      }
      if (window.beatWaveformRenderers && window.beatWaveformRenderers[this.deckId]) {
        window.beatWaveformRenderers[this.deckId].stopAnimation();
      }
    }
  }

  stop() {
    const deck = window.audioEngine.getDeck(this.deckId);
    if (deck) {
      deck.stop();
      this.updatePlayingState(false);
      this.updatePauseState(false);
      // Stop vinyl animation
      if (this.vinylElement) {
        this.vinylElement.classList.remove('spinning');
      }
      // Force waveform update to show position at beginning
      if (window.waveformRenderers && window.waveformRenderers[this.deckId]) {
        window.waveformRenderers[this.deckId].updatePlayhead();
        window.waveformRenderers[this.deckId].render();
      }
      if (window.beatWaveformRenderers && window.beatWaveformRenderers[this.deckId]) {
        window.beatWaveformRenderers[this.deckId].updatePlayhead();
        window.beatWaveformRenderers[this.deckId].render();
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