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
    
    // Manual BPM override tracking
    this.isManualBPMSet = false; // Flag to track if user has manually set BPM via TAP
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
    
    // Stop refinement if user has manually set BPM via TAP
    if (this.isManualBPMSet) return;
    
    // Limit refinement analysis to first 10 seconds of the track for better accuracy
    if (currentTime > 10) return;
    
    // Analyze every 1.5 seconds for more frequent updates (faster convergence)
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
          
          // More conservative threshold for BPM updates (3 BPM difference)
          if (Math.abs(avgRecentBPM - this.baseBPM) > 3) {
            console.log(`Refining BPM for deck ${this.deckId}: ${this.baseBPM} -> ${avgRecentBPM.toFixed(1)}`);
            this.baseBPM = avgRecentBPM;
            this.generateBeatMap(audioBuffer); // Regenerate beat map with new BPM
          }
        }
      }
    }
  }

  calculateBPM(audioBuffer) {
    // Reset manual BPM flag when calculating BPM for a new track
    this.isManualBPMSet = false;
    
    if (!audioBuffer) return 120;
    
    try {
      // Get audio data from the buffer
      const audioData = audioBuffer.getChannelData(0);
      const sampleRate = audioBuffer.sampleRate;
      
      // Analyze the full track for maximum accuracy
      const analysisData = audioData;
      
      // Detect BPM using onset detection and autocorrelation
      const bpm = this.detectBPMFromAudio(analysisData, sampleRate);
      
      console.log(`Detected BPM: ${bpm} for deck ${this.deckId}`);
      this.baseBPM = bpm;
      return bpm;
    } catch (error) {
      console.error('BPM detection failed:', error);
      return 120; // Default fallback
    }
  }

  detectBPMFromAudio(audioData, sampleRate) {
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
    
    // Detect onset peaks (significant energy increases)
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
    const bpm = this.findMostLikelyTempo(filteredIntervals);
    
    // BPM validation for better genre support
    let validatedBPM = bpm;
    
    // Handle extreme cases
    if (bpm < 60) {
      validatedBPM = bpm * 2; // Likely half-time detection
    } else if (bpm > 200) {
      validatedBPM = bpm / 2; // Likely double-time detection
    }
    
    // Additional check for common double-time patterns in faster genres
    if (validatedBPM > 160 && validatedBPM / 2 >= 80) {
      const halfTime = validatedBPM / 2;
      if (halfTime >= 80 && halfTime <= 140) {
        validatedBPM = halfTime;
      }
    }
    
    console.log(`Detected BPM: ${bpm.toFixed(1)} -> Validated: ${validatedBPM.toFixed(1)} for deck ${this.deckId || 'unknown'}`);
    return Math.round(validatedBPM);
  }

  detectOnsets(energyValues, hopSize, sampleRate) {
    const onsets = [];
    const threshold = 1.3; // Balanced threshold for good sensitivity across genres
    
    // Apply moving average for smoothing
    const smoothed = this.applyMovingAverage(energyValues, 2);
    
    // Calculate spectral flux (energy differences between frames)
    const spectralFlux = [];
    for (let i = 1; i < smoothed.length; i++) {
      const diff = Math.max(0, smoothed[i] - smoothed[i - 1]);
      spectralFlux.push(diff);
    }
    
    // Calculate adaptive threshold based on signal characteristics
    const meanFlux = spectralFlux.reduce((sum, val) => sum + val, 0) / spectralFlux.length;
    const stdFlux = Math.sqrt(spectralFlux.reduce((sum, val) => sum + Math.pow(val - meanFlux, 2), 0) / spectralFlux.length);
    
    // Find peaks in spectral flux
    for (let i = 1; i < spectralFlux.length - 1; i++) {
      const current = spectralFlux[i];
      const previous = spectralFlux[i - 1];
      const next = spectralFlux[i + 1];
      
      // Dynamic threshold that adapts to signal characteristics
      const dynamicThreshold = Math.max(meanFlux + stdFlux * 0.5, 0.01);
      
      // Detect peaks that are significantly higher than neighbors
      if (current > previous * threshold && current > next && current > dynamicThreshold) {
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
    
    // Convert intervals to BPM
    const bpmValues = intervals.map(interval => 60 / interval);
    
    // Create histogram of BPM values with genre-aware grouping
    const histogram = {};
    const tolerance = 4; // Slightly larger tolerance for better grouping
    
    bpmValues.forEach(bpm => {
      // Round to nearest tolerance value for grouping
      const roundedBpm = Math.round(bpm / tolerance) * tolerance;
      if (!histogram[roundedBpm]) {
        histogram[roundedBpm] = [];
      }
      histogram[roundedBpm].push(bpm);
    });
    
    // Find the group with most occurrences, with genre preference scoring
    let maxScore = 0;
    let mostLikelyBPM = 120;
    
    Object.keys(histogram).forEach(key => {
      const group = histogram[key];
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
    });
    
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
    this.baseBPM = bpm;
    this.isManualBPMSet = true; // Mark that user has manually set BPM
    console.log(`Manual BPM override set for deck ${this.deckId}: ${bpm} BPM - auto-refinement disabled`);
    
    if (audioBuffer) {
      this.generateBeatMap(audioBuffer);
    }
  }
}