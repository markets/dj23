/**
 * DJ23 Track Metadata Handler
 * Handles audio file loading, metadata extraction, and track display
 */
class TrackMetadata {
  constructor(deckId) {
    this.deckId = deckId;
  }

  async loadTrack(file, deck, deckController) {
    await window.audioEngine.initialize();
    
    const trackInfo = document.getElementById(`trackInfo${this.deckId}`);
    
    // Stop current track if playing before loading new one
    deckController.stop();
    
    // Show loading state
    trackInfo.classList.add('loading');
    trackInfo.querySelector('.track-name').textContent = 'Loading...';
    
    const success = await deck.loadFile(file);
    
    if (success) {
      // Extract metadata and update track display
      await this.extractAndDisplayMetadata(file);
      deckController.updateTrackTime();
      
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
      deckController.updateBPMDisplay();
    } else {
      trackInfo.querySelector('.track-name').textContent = 'Failed to load';
    }
    
    trackInfo.classList.remove('loading');
    return success;
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
}

// Export for use in other modules
window.TrackMetadata = TrackMetadata;