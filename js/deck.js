// Simple ID3 tag reader for basic metadata extraction
class SimpleID3Reader {
  static async readMetadata(file) {
    try {
      const buffer = await file.arrayBuffer();
      const view = new DataView(buffer);
      
      // Check for ID3v2 header
      if (view.getUint8(0) === 0x49 && view.getUint8(1) === 0x44 && view.getUint8(2) === 0x33) {
        return this.readID3v2(view);
      }
      
      // Check for ID3v1 at the end of file
      if (buffer.byteLength > 128) {
        const id3v1Offset = buffer.byteLength - 128;
        const tagView = new DataView(buffer, id3v1Offset);
        if (tagView.getUint8(0) === 0x54 && tagView.getUint8(1) === 0x41 && tagView.getUint8(2) === 0x47) {
          return this.readID3v1(tagView);
        }
      }
      
      return null;
    } catch (error) {
      console.warn('Error reading ID3 tags:', error);
      return null;
    }
  }
  
  static readID3v1(view) {
    const decoder = new TextDecoder('latin1');
    
    const title = decoder.decode(view.buffer.slice(view.byteOffset + 3, view.byteOffset + 33)).replace(/\0/g, '').trim();
    const artist = decoder.decode(view.buffer.slice(view.byteOffset + 33, view.byteOffset + 63)).replace(/\0/g, '').trim();
    const album = decoder.decode(view.buffer.slice(view.byteOffset + 63, view.byteOffset + 93)).replace(/\0/g, '').trim();
    const year = decoder.decode(view.buffer.slice(view.byteOffset + 93, view.byteOffset + 97)).replace(/\0/g, '').trim();
    
    return {
      title: title || null,
      artist: artist || null,
      album: album || null,
      year: year || null,
      picture: null
    };
  }
  
  static readID3v2(view) {
    // Simple ID3v2 reader - just extract basic text frames
    const version = view.getUint8(3);
    let headerSize = 10;
    
    // Calculate tag size
    const tagSize = (view.getUint8(6) << 21) | (view.getUint8(7) << 14) | (view.getUint8(8) << 7) | view.getUint8(9);
    
    const metadata = {
      title: null,
      artist: null,
      album: null,
      year: null,
      picture: null
    };
    
    let offset = headerSize;
    const endOffset = Math.min(headerSize + tagSize, view.buffer.byteLength);
    
    while (offset < endOffset - 10) {
      try {
        // Read frame header
        const frameId = String.fromCharCode(
          view.getUint8(offset),
          view.getUint8(offset + 1),
          view.getUint8(offset + 2),
          view.getUint8(offset + 3)
        );
        
        if (frameId === '\0\0\0\0') break;
        
        let frameSize;
        if (version >= 4) {
          frameSize = (view.getUint8(offset + 4) << 21) | (view.getUint8(offset + 5) << 14) | (view.getUint8(offset + 6) << 7) | view.getUint8(offset + 7);
        } else {
          frameSize = (view.getUint8(offset + 4) << 24) | (view.getUint8(offset + 5) << 16) | (view.getUint8(offset + 6) << 8) | view.getUint8(offset + 7);
        }
        
        if (frameSize === 0 || offset + 10 + frameSize > endOffset) break;
        
        const dataOffset = offset + 10;
        const encoding = view.getUint8(dataOffset);
        
        // Skip encoding byte and read text
        let text = '';
        try {
          if (encoding === 0 || encoding === 3) {
            // ISO-8859-1 or UTF-8
            const decoder = new TextDecoder(encoding === 0 ? 'latin1' : 'utf-8');
            text = decoder.decode(view.buffer.slice(dataOffset + 1, dataOffset + frameSize)).replace(/\0/g, '').trim();
          } else if (encoding === 1 || encoding === 2) {
            // UTF-16
            const decoder = new TextDecoder('utf-16');
            text = decoder.decode(view.buffer.slice(dataOffset + 1, dataOffset + frameSize)).replace(/\0/g, '').trim();
          }
        } catch (e) {
          // Fallback to latin1
          const decoder = new TextDecoder('latin1');
          text = decoder.decode(view.buffer.slice(dataOffset + 1, dataOffset + frameSize)).replace(/\0/g, '').trim();
        }
        
        // Map frame IDs to metadata
        switch (frameId) {
          case 'TIT2':
          case 'TT2\0':
            metadata.title = text;
            break;
          case 'TPE1':
          case 'TP1\0':
            metadata.artist = text;
            break;
          case 'TALB':
          case 'TAL\0':
            metadata.album = text;
            break;
          case 'TYER':
          case 'TYE\0':
          case 'TDRC':
            metadata.year = text;
            break;
          case 'APIC':
          case 'PIC\0':
            // Skip image parsing for now to keep it simple
            break;
        }
        
        offset += 10 + frameSize;
      } catch (e) {
        break;
      }
    }
    
    return metadata;
  }
}

// Utility function to extract metadata from audio files
async function extractMetadata(file) {
  // First try to read ID3 tags
  const id3Metadata = await SimpleID3Reader.readMetadata(file);
  
  if (id3Metadata && (id3Metadata.title || id3Metadata.artist)) {
    return id3Metadata;
  }
  
  // Fallback to filename parsing
  const fileName = file.name;
  const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
  
  // Try to parse common filename patterns like "Artist - Title" or "01 - Artist - Title"
  let title = nameWithoutExt;
  let artist = null;
  
  // Remove track numbers (e.g., "01 - ", "1. ", etc.)
  title = title.replace(/^\d+[\s\-\.]+/, '');
  
  // Try to split by " - " to get artist and title
  const dashSplit = title.split(' - ');
  if (dashSplit.length >= 2) {
    artist = dashSplit[0].trim();
    title = dashSplit.slice(1).join(' - ').trim();
  }
  
  return {
    title: title,
    artist: artist,
    album: null,
    year: null,
    picture: null
  };
}

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
        
    // Show loading state
    trackInfo.classList.add('loading');
    trackInfo.querySelector('.track-name').textContent = 'Loading...';
        
    const success = await deck.loadFile(file);
        
    if (success) {
      // Extract metadata from the file
      const metadata = await extractMetadata(file);
      
      // Update track info with metadata
      this.updateTrackInfo(metadata, file);
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

  updateTrackInfo(metadata, file) {
    const trackInfo = document.getElementById(`trackInfo${this.deckId}`);
    const trackNameElement = trackInfo.querySelector('.track-name');
    const albumCoverElement = document.getElementById(`albumCover${this.deckId}`);
    
    // Build track display text with metadata
    let displayText = '';
    if (metadata.artist && metadata.title) {
      displayText = `${metadata.artist} - ${metadata.title}`;
    } else if (metadata.title) {
      displayText = metadata.title;
    } else {
      // Fallback to filename without extension
      displayText = file.name.replace(/\.[^/.]+$/, '');
    }
    
    // Add album information if available
    if (metadata.album) {
      displayText += ` (${metadata.album})`;
    }
    
    trackNameElement.textContent = displayText;
    trackNameElement.title = displayText; // Tooltip for full text if truncated
    
    // Store metadata for potential future use
    trackNameElement.dataset.artist = metadata.artist || '';
    trackNameElement.dataset.title = metadata.title || '';
    trackNameElement.dataset.album = metadata.album || '';
    trackNameElement.dataset.year = metadata.year || '';
    
    // Handle album cover
    if (metadata.picture) {
      albumCoverElement.src = metadata.picture;
      albumCoverElement.style.display = 'block';
      albumCoverElement.style.backgroundColor = '';
      albumCoverElement.style.border = '';
    } else {
      // Show placeholder when no cover is available
      albumCoverElement.style.display = 'block';
      albumCoverElement.style.backgroundColor = 'var(--bg-tertiary)';
      albumCoverElement.style.border = '1px solid var(--border-light)';
      albumCoverElement.alt = 'No album cover';
      albumCoverElement.src = '';
    }
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

  resetFilters() {
    const deck = window.audioEngine.getDeck(this.deckId);
    if (!deck) return;

    // Reset EQ controls
    ['high', 'mid', 'low'].forEach(band => {
      const slider = document.getElementById(`${band}${this.deckId}`);
      const display = slider.nextElementSibling;
      slider.value = '0';
      display.textContent = '0';
      deck.setEQ(band, 0);
    });

    // Reset effects controls
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
        }
        // Note: phaser and flanger methods may need to be implemented in audio-engine.js
      }
    });

    console.log(`Deck ${this.deckId}: All filters reset to default values`);
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