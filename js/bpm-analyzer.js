class BPMAnalyzer {
  constructor(audioContext, deckId) {
    this.audioContext = audioContext;
    this.deckId = deckId;
    
    // Beat tracking properties
    this.beatPositions = []; // Array of beat positions in seconds
    this.lastBeatTime = 0;   // Time of the last detected beat
    this.beatInterval = 0.5; // Current beat interval in seconds (will be calculated)
    
    // Continuous BPM analysis
    this.bpmAnalysisHistory = []; // Store BPM readings over time
    this.lastBpmAnalysisTime = 0;
    this.bpmAnalysisInterval = 5; // Analyze BPM every 5 seconds during playback
    
    // Store original BPM for pitch-adjusted calculations
    this.baseBPM = 120; // Default BPM, will be updated when track loads
    
    // BPM source tracking for priority system
    this.bpmSource = 'default'; // Can be: 'default', 'metadata', 'auto-detected', 'manual'
    this.metadataBPM = null; // Store BPM from metadata
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

  // Continuously refine BPM during playback
  refineBPMDuringPlayback(audioBuffer, currentTime, isPlaying) {
    if (!isPlaying || !audioBuffer) return;
    
    // Smart refinement logic based on BPM source and timing
    const timeSinceManualTap = currentTime - this.lastManualTapTime;
    
    // If user manually set BPM via TAP, allow brief refinement window (2-3 seconds) then protect
    if (this.bpmSource === 'manual' && timeSinceManualTap > 3) {
      return; // Protect manual BPM after 3 seconds
    }
    
    // If we have metadata BPM, only allow very brief refinement (1 second) to verify accuracy
    if (this.bpmSource === 'metadata' && currentTime > 1) {
      return;
    }
    
    // For auto-detected BPM, allow longer refinement window (10 seconds)
    if (this.bpmSource === 'auto-detected' && currentTime > 10) {
      return;
    }
    
    // Default case: allow refinement for first 10 seconds
    if (currentTime > 10) return;
    
    // Analyze every 1.5 seconds for frequent updates during critical period
    if (currentTime - this.lastBpmAnalysisTime >= 1.5) {
      this.lastBpmAnalysisTime = currentTime;
      
      const analysisWindow = 20; // 20 seconds
      const startTime = Math.max(0, currentTime - analysisWindow / 2);
      const endTime = Math.min(audioBuffer.duration, currentTime + analysisWindow / 2);
      
      const sampleRate = audioBuffer.sampleRate;
      const startSample = Math.floor(startTime * sampleRate);
      const endSample = Math.floor(endTime * sampleRate);
      
      const audioData = audioBuffer.getChannelData(0);
      const windowData = audioData.slice(startSample, endSample);
      
      if (windowData.length > sampleRate * 2) { // Need at least 2 seconds of data
        const refinedBPM = this.detectBPMFromAudio(windowData, sampleRate);
        
        // Add to history
        this.bpmAnalysisHistory.push({
          time: currentTime,
          bpm: refinedBPM
        });
        
        // Keep only recent history (last 1 minute)
        this.bpmAnalysisHistory = this.bpmAnalysisHistory.filter(
          entry => currentTime - entry.time <= 60
        );
        
        // Update BPM if we have enough data and there's a consistent change
        if (this.bpmAnalysisHistory.length >= 3) {
          const recentBPMs = this.bpmAnalysisHistory.slice(-3).map(entry => entry.bpm);
          const avgRecentBPM = recentBPMs.reduce((sum, bpm) => sum + bpm, 0) / recentBPMs.length;
          
          // Adjust threshold based on BPM source - be more conservative with manual/metadata BPM
          let threshold = 3; // Default threshold
          if (this.bpmSource === 'metadata') {
            threshold = 8; // Very conservative for metadata BPM
          } else if (this.bpmSource === 'manual') {
            threshold = 6; // Conservative for manual BPM
          }
          
          if (Math.abs(avgRecentBPM - this.baseBPM) > threshold) {
            console.log(`Refining BPM for deck ${this.deckId}: ${this.baseBPM} -> ${avgRecentBPM.toFixed(1)} (source: ${this.bpmSource})`);
            this.baseBPM = avgRecentBPM;
            // Only update source if it was auto-detected, preserve higher priority sources
            if (this.bpmSource === 'auto-detected' || this.bpmSource === 'default') {
              this.bpmSource = 'auto-detected';
            }
            this.generateBeatMap(audioBuffer); // Regenerate beat map with new BPM
          }
        }
      }
    }
  }

  calculateBPM(audioBuffer) {
    // Reset BPM source tracking when calculating BPM for a new track
    this.bpmSource = 'default';
    this.metadataBPM = null;
    this.lastManualTapTime = 0;
    
    // Reset analysis history for new track
    this.bpmAnalysisHistory = [];
    this.lastBpmAnalysisTime = 0;
    
    if (!audioBuffer || !audioBuffer.getChannelData) {
      console.warn(`BPM Analyzer: Invalid audio buffer for deck ${this.deckId}`);
      return 120;
    }
    
    try {
      // Get audio data from the buffer
      const audioData = audioBuffer.getChannelData(0);
      const sampleRate = audioBuffer.sampleRate;
      
      if (!audioData || audioData.length === 0 || !sampleRate) {
        console.warn(`BPM Analyzer: Invalid audio data for deck ${this.deckId}`);
        return 120;
      }
      
      // Detect BPM using onset detection
      const bpm = this.detectBPMFromAudio(audioData, sampleRate);
      
      console.log(`BPM Analyzer: Calculated BPM ${bpm} for deck ${this.deckId}`);
      this.baseBPM = bpm;
      this.bpmSource = 'auto-detected';
      return bpm;
    } catch (error) {
      console.error(`BPM Analyzer: Detection failed for deck ${this.deckId}:`, error);
      return 120; // Default fallback
    }
  }

  // Consolidated BPM validation with genre-aware correction
  validateAndCorrectBPM(detectedBPM) {
    if (!detectedBPM || detectedBPM <= 0) return 120;
    
    let validatedBPM = detectedBPM;
    
    // Handle extreme cases with smart correction
    if (detectedBPM < 60) {
      validatedBPM = detectedBPM * 2; // Likely half-time detection
    } else if (detectedBPM > 200) {
      validatedBPM = detectedBPM / 2; // Likely double-time detection
    }
    
    // Additional check for common double-time patterns in faster genres
    if (validatedBPM > 160) {
      const halfTime = validatedBPM / 2;
      // Prefer half-time if it falls in common DJ music range
      if (halfTime >= 80 && halfTime <= 140) {
        validatedBPM = halfTime;
      }
    }
    
    // Final bounds check
    if (validatedBPM < 50) validatedBPM = 120;
    if (validatedBPM > 250) validatedBPM = 120;
    
    return Math.round(validatedBPM);
  }

  detectBPMFromAudio(audioData, sampleRate) {
    if (!audioData || audioData.length === 0 || !sampleRate) return 120;
    
    // Calculate energy levels to detect beats
    const hopSize = 512;
    const energyValues = [];
    
    // Calculate RMS energy for each frame
    for (let i = 0; i < audioData.length - hopSize; i += hopSize) {
      let energy = 0;
      for (let j = 0; j < hopSize; j++) {
        energy += audioData[i + j] * audioData[i + j];
      }
      energyValues.push(Math.sqrt(energy / hopSize));
    }
    
    // Detect onset peaks
    const onsets = this.detectOnsets(energyValues, hopSize, sampleRate);
    
    // Calculate tempo from onset intervals
    if (onsets.length < 4) {
      return 120; // Not enough data, return default
    }
    
    // Calculate intervals between consecutive onsets
    const intervals = [];
    for (let i = 1; i < onsets.length; i++) {
      intervals.push(onsets[i] - onsets[i - 1]);
    }
    
    // Remove outliers (intervals that are too short or too long)
    const filteredIntervals = intervals.filter(interval => 
      interval >= 0.2 && interval <= 2.0 // Between 30 BPM and 300 BPM
    );
    
    if (filteredIntervals.length === 0) {
      return 120;
    }
    
    // Find the most common interval (tempo)
    const detectedBPM = this.findMostLikelyTempo(filteredIntervals);
    
    // Apply consolidated validation
    const validatedBPM = this.validateAndCorrectBPM(detectedBPM);
    
    console.log(`BPM Analyzer: Detected ${detectedBPM.toFixed(1)} -> Validated ${validatedBPM} BPM for deck ${this.deckId || 'unknown'}`);
    return validatedBPM;
  }

  detectOnsets(energyValues, hopSize, sampleRate) {
    const onsets = [];
    const baseThreshold = 1.3; // Base threshold for onset detection
    
    // Apply moving average for smoothing
    const smoothed = this.applyMovingAverage(energyValues, 2);
    
    // Calculate spectral flux (energy differences between frames)
    const spectralFlux = [];
    for (let i = 1; i < smoothed.length; i++) {
      const diff = Math.max(0, smoothed[i] - smoothed[i - 1]);
      spectralFlux.push(diff);
    }
    
    if (spectralFlux.length === 0) return onsets;
    
    // Calculate adaptive threshold based on signal characteristics
    const meanFlux = spectralFlux.reduce((sum, val) => sum + val, 0) / spectralFlux.length;
    const stdFlux = Math.sqrt(spectralFlux.reduce((sum, val) => sum + Math.pow(val - meanFlux, 2), 0) / spectralFlux.length);
    
    // Improved adaptive threshold calculation
    const minThreshold = 0.01;
    const adaptiveMultiplier = Math.max(0.3, Math.min(0.8, stdFlux / meanFlux)); // Dynamic based on signal variation
    const adaptiveThreshold = Math.max(meanFlux + stdFlux * adaptiveMultiplier, minThreshold);
    
    // Find peaks in spectral flux with improved peak detection
    for (let i = 1; i < spectralFlux.length - 1; i++) {
      const current = spectralFlux[i];
      const previous = spectralFlux[i - 1];
      const next = spectralFlux[i + 1];
      
      // Multi-criteria peak detection
      const isLocalPeak = current > previous * baseThreshold && current > next;
      const isAboveThreshold = current > adaptiveThreshold;
      const isSignificantPeak = current > meanFlux * 1.2; // Additional significance check
      
      if (isLocalPeak && isAboveThreshold && isSignificantPeak) {
        const timeInSeconds = ((i + 1) * hopSize) / sampleRate;
        onsets.push(timeInSeconds);
      }
    }
    
    return onsets;
  }

  applyMovingAverage(data, windowSize) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - windowSize); j <= Math.min(data.length - 1, i + windowSize); j++) {
        sum += data[j];
        count++;
      }
      result.push(sum / count);
    }
    return result;
  }

  findMostLikelyTempo(intervals) {
    if (intervals.length === 0) return 120;
    
    // Convert intervals to BPM (cache the conversion for performance)
    const bpmValues = intervals.map(interval => 60 / interval);
    
    // Create histogram with optimized grouping
    const histogram = new Map();
    const tolerance = 4; // BPM grouping tolerance
    
    for (const bpm of bpmValues) {
      // Round to nearest tolerance value for grouping
      const roundedBpm = Math.round(bpm / tolerance) * tolerance;
      if (!histogram.has(roundedBpm)) {
        histogram.set(roundedBpm, []);
      }
      histogram.get(roundedBpm).push(bpm);
    }
    
    // Find the group with the best score (frequency + genre preference)
    let maxScore = 0;
    let mostLikelyBPM = 120;
    
    for (const [key, group] of histogram) {
      const avgBpm = group.reduce((sum, bpm) => sum + bpm, 0) / group.length;
      
      // Base score from frequency
      let score = group.length;
      
      // Apply genre preference multipliers for better DJ music support
      if (avgBpm >= 120 && avgBpm <= 140) {
        score *= 1.3; // Electronic & Dance music boost
      } else if (avgBpm >= 100 && avgBpm <= 130) {
        score *= 1.2; // Commercial & Mainstream boost  
      } else if (avgBpm >= 80 && avgBpm <= 110) {
        score *= 1.1; // Urban music boost
      } else if (avgBpm >= 90 && avgBpm <= 150) {
        score *= 1.05; // Alternative music slight boost
      }
      
      if (score > maxScore) {
        maxScore = score;
        mostLikelyBPM = avgBpm;
      }
    }
    
    // Check for common double/half-time patterns
    const candidates = [mostLikelyBPM, mostLikelyBPM * 2, mostLikelyBPM / 2];
    
    // Return the candidate that makes most sense musically
    for (const candidate of candidates) {
      if (candidate >= 70 && candidate <= 180) {
        return candidate;
      }
    }
    
    return mostLikelyBPM;
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

  // Method to set BPM from metadata (called when reading file metadata)
  setMetadataBPM(bpm, audioBuffer) {
    if (!bpm || typeof bpm !== 'number' || bpm <= 0 || bpm > 300) {
      console.warn(`BPM Analyzer: Invalid metadata BPM value ${bpm} for deck ${this.deckId}`);
      return false;
    }
    
    this.metadataBPM = Math.round(bpm);
    this.baseBPM = this.metadataBPM;
    this.bpmSource = 'metadata';
    console.log(`BPM Analyzer: Metadata BPM set to ${this.baseBPM} for deck ${this.deckId} - very limited auto-refinement`);
    
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
      source: this.bpmSource,
      metadataBPM: this.metadataBPM
    };
  }

  // Extract BPM from metadata tags (moved from DeckController for better organization)
  extractBPMFromTags(tags) {
    if (!tags || typeof tags !== 'object') return null;
    
    // Try various common BPM tag formats
    const bpmFields = ['BPM', 'TBPM', 'bpm', 'Bpm', 'BeatsPerMinute', 'BEATS_PER_MINUTE'];
    
    for (const field of bpmFields) {
      if (tags[field] && typeof tags[field] === 'string') {
        const bpmValue = parseFloat(tags[field]);
        if (!isNaN(bpmValue) && bpmValue > 0 && bpmValue <= 300) {
          console.log(`BPM Analyzer: Found metadata BPM ${bpmValue} in field '${field}'`);
          return Math.round(bpmValue);
        }
      }
    }
    
    // Try to extract BPM from comment or description fields
    const textFields = ['comment', 'Comment', 'COMMENT', 'description', 'Description'];
    for (const field of textFields) {
      if (tags[field] && typeof tags[field] === 'string') {
        const bpmMatch = tags[field].match(/(?:BPM|bpm|tempo)[\s:=]*(\d+(?:\.\d+)?)/i);
        if (bpmMatch) {
          const bpmValue = parseFloat(bpmMatch[1]);
          if (!isNaN(bpmValue) && bpmValue > 0 && bpmValue <= 300) {
            console.log(`BPM Analyzer: Found metadata BPM ${bpmValue} in ${field} field`);
            return Math.round(bpmValue);
          }
        }
      }
    }
    
    return null; // No BPM found in metadata
  }
}