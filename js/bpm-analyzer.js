class BPMAnalyzer {
  constructor(audioContext, deckId) {
    this.audioContext = audioContext;
    this.deckId = deckId;
    
    // Beat tracking properties
    this.beatPositions = []; // Array of beat positions in seconds
    this.lastBeatTime = 0;   // Time of the last detected beat
    this.beatInterval = 0.5; // Current beat interval in seconds (will be calculated)
    
    // Store original BPM for pitch-adjusted calculations
    this.baseBPM = 120; // Default BPM, will be updated when track loads
    
    // BPM source tracking for priority system
    this.bpmSource = null; // Can be: null, 'auto-detected', 'manual'
    this.lastManualTapTime = 0; // Track when user last used TAP
  }

  generateBeatMap(audioBuffer) {
    if (!audioBuffer || this.baseBPM <= 0) return;
    
    // Calculate beat interval from BPM
    this.beatInterval = 60 / this.baseBPM;
    
    // Generate beat positions throughout the track
    this.beatPositions = [];
    const duration = audioBuffer.duration;
    
    // Start from the first beat (we assume it starts on beat 1)
    for (let time = 0; time < duration; time += this.beatInterval) {
      this.beatPositions.push(time);
    }
    
    console.log(`Generated ${this.beatPositions.length} beats for ${duration.toFixed(2)}s track at ${this.baseBPM} BPM`);
  }

  // Find the nearest beat position to the current time
  findNearestBeat(currentTime) {
    if (this.beatPositions.length === 0) return currentTime;
    
    let nearestBeat = this.beatPositions[0];
    let minDistance = Math.abs(currentTime - nearestBeat);
    
    for (const beatTime of this.beatPositions) {
      const distance = Math.abs(currentTime - beatTime);
      if (distance < minDistance) {
        minDistance = distance;
        nearestBeat = beatTime;
      }
    }
    
    return nearestBeat;
  }

  // Get the next beat after current time
  getNextBeat(currentTime) {
    for (const beatTime of this.beatPositions) {
      if (beatTime > currentTime) {
        return beatTime;
      }
    }
    return currentTime; // If no next beat found, return current time
  }

  calculateBPM(audioBuffer) {
    // Reset BPM source tracking when calculating BPM for a new track
    this.bpmSource = null;
    this.lastManualTapTime = 0;
    
    if (!audioBuffer || !audioBuffer.getChannelData) {
      console.warn(`BPM Analyzer: Invalid audio buffer for deck ${this.deckId}`);
      return 120;
    }
    
    try {
      // Prepare audio data for music-tempo library
      let audioData = [];
      
      // Take the average of the two channels if stereo, otherwise use mono
      if (audioBuffer.numberOfChannels == 2) {
        const channel1Data = audioBuffer.getChannelData(0);
        const channel2Data = audioBuffer.getChannelData(1);
        const length = channel1Data.length;
        for (let i = 0; i < length; i++) {
          audioData[i] = (channel1Data[i] + channel2Data[i]) / 2;
        }
      } else {
        audioData = audioBuffer.getChannelData(0);
      }
      
      // Use music-tempo library for BPM detection
      const mt = new MusicTempo(audioData);
      const detectedBPM = mt.tempo;
      
      // Use detected BPM directly without validation/correction
      const finalBPM = detectedBPM && detectedBPM > 0 ? Math.round(detectedBPM) : 120;
      
      console.log(`BPM Analyzer: Detected ${detectedBPM} -> Final ${finalBPM} BPM for deck ${this.deckId}`);
      this.baseBPM = finalBPM;
      this.bpmSource = 'auto-detected';
      return finalBPM;
    } catch (error) {
      console.error(`BPM Analyzer: Detection failed for deck ${this.deckId}:`, error);
      return 120; // Default fallback
    }
  }

  // Public methods to access BPM information
  getBPM(playbackRate = 1) {
    // Return the current BPM adjusted for pitch changes
    return Math.round(this.baseBPM * playbackRate);
  }

  getBaseBPM() {
    // Return the original BPM without pitch adjustments
    return this.baseBPM;
  }

  // Method to manually set BPM (used by TAP functionality)
  setBPM(bpm, audioBuffer) {
    if (!bpm || typeof bpm !== 'number' || bpm <= 0 || bpm > 300) {
      console.warn(`BPM Analyzer: Invalid BPM value ${bpm} for deck ${this.deckId}`);
      return false;
    }
    
    this.baseBPM = Math.round(bpm);
    this.bpmSource = 'manual';
    this.lastManualTapTime = 0; // Will be updated to current playback time when called
    console.log(`BPM Analyzer: Manual BPM set to ${this.baseBPM} for deck ${this.deckId} - limited auto-refinement for 3 seconds`);
    
    if (audioBuffer && audioBuffer.duration) {
      this.generateBeatMap(audioBuffer);
    }
    return true;
  }

  // Update the manual tap time (should be called with current playback time)
  updateManualTapTime(currentTime) {
    if (this.bpmSource === 'manual') {
      this.lastManualTapTime = currentTime;
    }
  }

  // Get information about current BPM source
  getBPMInfo() {
    return {
      bpm: this.baseBPM,
      source: this.bpmSource
    };
  }
}