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
      this.bpmSource = 'auto-detected';
      return bpm;
    } catch (error) {
      console.error('BPM detection failed:', error);
      return 120; // Default fallback
    }
  }

  detectBPMFromAudio(audioData, sampleRate) {
    // Enhanced BPM detection with multi-band analysis and autocorrelation
    const hopSize = 512;
    const frameTime = hopSize / sampleRate;
    
    // Multi-band onset detection for better accuracy
    const lowBandOnsets = this.detectMultiBandOnsets(audioData, sampleRate, hopSize, 'low');
    const midBandOnsets = this.detectMultiBandOnsets(audioData, sampleRate, hopSize, 'mid');
    const highBandOnsets = this.detectMultiBandOnsets(audioData, sampleRate, hopSize, 'high');
    
    // Combine onset detections with weighting (bass frequencies are most important for beat)
    const combinedOnsets = this.combineOnsetDetections([
      { onsets: lowBandOnsets, weight: 0.5 },   // Bass most important
      { onsets: midBandOnsets, weight: 0.3 },   // Mid frequencies moderate importance
      { onsets: highBandOnsets, weight: 0.2 }   // High frequencies least important
    ]);
    
    // Calculate tempo from onset intervals if we have enough data
    if (combinedOnsets.length < 4) {
      return 120; // Not enough data, return default
    }
    
    // Calculate intervals between consecutive onsets
    const intervals = [];
    for (let i = 1; i < combinedOnsets.length; i++) {
      intervals.push(combinedOnsets[i] - combinedOnsets[i - 1]);
    }
    
    // Remove outliers (intervals that are too short or too long)
    const filteredIntervals = intervals.filter(interval => 
      interval >= 0.2 && interval <= 2.0 // Between 30 BPM and 300 BPM
    );
    
    if (filteredIntervals.length === 0) {
      return 120;
    }
    
    // Enhanced tempo detection using both interval analysis and autocorrelation
    const intervalBPM = this.findMostLikelyTempo(filteredIntervals);
    const autocorrelationBPM = this.calculateBPMFromAutocorrelation(combinedOnsets);
    
    // Calculate confidence scores for both methods
    const intervalConfidence = this.calculateIntervalConfidence(filteredIntervals);
    const autocorrelationConfidence = this.calculateAutocorrelationConfidence(combinedOnsets, autocorrelationBPM);
    
    // Choose best BPM based on confidence scores
    let bestBPM;
    if (autocorrelationConfidence > intervalConfidence * 1.2) {
      bestBPM = autocorrelationBPM;
      console.log(`Using autocorrelation BPM: ${autocorrelationBPM} (confidence: ${autocorrelationConfidence.toFixed(2)})`);
    } else {
      bestBPM = intervalBPM;
      console.log(`Using interval BPM: ${intervalBPM} (confidence: ${intervalConfidence.toFixed(2)})`);
    }
    
    // Enhanced BPM validation with genre awareness
    const validatedBPM = this.validateAndCorrectBPM(bestBPM, intervalConfidence + autocorrelationConfidence);
    
    console.log(`Detected BPM: ${bestBPM.toFixed(1)} -> Validated: ${validatedBPM.toFixed(1)} for deck ${this.deckId || 'unknown'}`);
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

  // Enhanced multi-band onset detection
  detectMultiBandOnsets(audioData, sampleRate, hopSize, band = 'full') {
    // Apply frequency band filtering
    const filteredData = this.applyFrequencyBandFilter(audioData, sampleRate, band);
    
    // Calculate energy values for the filtered band
    const energyValues = [];
    for (let i = 0; i < filteredData.length - hopSize; i += hopSize) {
      let energy = 0;
      for (let j = 0; j < hopSize; j++) {
        energy += filteredData[i + j] * filteredData[i + j];
      }
      energyValues.push(Math.sqrt(energy / hopSize));
    }
    
    // Enhanced onset detection with spectral centroid
    const onsets = [];
    const threshold = band === 'low' ? 1.2 : 1.4; // Lower threshold for bass frequencies
    
    // Apply moving average for smoothing
    const smoothed = this.applyMovingAverage(energyValues, 3);
    
    // Calculate spectral flux with enhanced sensitivity
    const spectralFlux = [];
    for (let i = 1; i < smoothed.length; i++) {
      const diff = Math.max(0, smoothed[i] - smoothed[i - 1]);
      spectralFlux.push(diff);
    }
    
    // Calculate adaptive threshold based on signal characteristics
    const meanFlux = spectralFlux.reduce((sum, val) => sum + val, 0) / spectralFlux.length;
    const stdFlux = Math.sqrt(spectralFlux.reduce((sum, val) => sum + Math.pow(val - meanFlux, 2), 0) / spectralFlux.length);
    
    // Enhanced peak detection with local maximum consideration
    for (let i = 2; i < spectralFlux.length - 2; i++) {
      const current = spectralFlux[i];
      const localMax = Math.max(spectralFlux[i-2], spectralFlux[i-1], current, spectralFlux[i+1], spectralFlux[i+2]);
      
      // Dynamic threshold based on band characteristics
      let dynamicThreshold = meanFlux + stdFlux * (band === 'low' ? 0.3 : 0.5);
      if (band === 'high') dynamicThreshold *= 1.2; // Higher threshold for high frequencies
      
      // Detect peaks that are local maxima and above threshold
      if (current === localMax && current > spectralFlux[i - 1] * threshold && 
          current > spectralFlux[i + 1] && current > dynamicThreshold) {
        const timeInSeconds = ((i + 1) * hopSize) / sampleRate;
        onsets.push(timeInSeconds);
      }
    }
    
    return onsets;
  }

  // Simple frequency band filtering using basic high/low pass concepts
  applyFrequencyBandFilter(audioData, sampleRate, band) {
    if (band === 'full') return audioData;
    
    const filtered = new Float32Array(audioData.length);
    
    if (band === 'low') {
      // Simple low-pass filter approximation (focus on bass frequencies)
      let previous = 0;
      const alpha = 0.15; // Low-pass cutoff approximation
      for (let i = 0; i < audioData.length; i++) {
        filtered[i] = previous + alpha * (audioData[i] - previous);
        previous = filtered[i];
      }
    } else if (band === 'high') {
      // Simple high-pass filter approximation
      let previous = 0;
      const alpha = 0.85; // High-pass cutoff approximation
      for (let i = 0; i < audioData.length; i++) {
        const current = audioData[i];
        filtered[i] = alpha * (previous + current - (i > 0 ? audioData[i-1] : 0));
        previous = filtered[i];
      }
    } else { // 'mid'
      // Band-pass approximation (combine low and high pass)
      const lowPass = this.applyFrequencyBandFilter(audioData, sampleRate, 'low');
      const highPass = this.applyFrequencyBandFilter(audioData, sampleRate, 'high');
      for (let i = 0; i < audioData.length; i++) {
        filtered[i] = (audioData[i] - lowPass[i] - highPass[i]) * 2; // Emphasize mid frequencies
      }
    }
    
    return filtered;
  }

  // Combine multiple onset detections with weighting
  combineOnsetDetections(onsetSets) {
    const allOnsets = [];
    
    // Collect all onsets with their weights
    onsetSets.forEach(({ onsets, weight }) => {
      onsets.forEach(onset => {
        allOnsets.push({ time: onset, weight });
      });
    });
    
    // Sort by time
    allOnsets.sort((a, b) => a.time - b.time);
    
    // Merge nearby onsets (within 50ms) and combine weights
    const mergedOnsets = [];
    const mergeThreshold = 0.05; // 50ms
    
    for (const onset of allOnsets) {
      const lastMerged = mergedOnsets[mergedOnsets.length - 1];
      
      if (lastMerged && Math.abs(onset.time - lastMerged.time) < mergeThreshold) {
        // Merge with previous onset - use weighted average for time and sum weights
        const totalWeight = lastMerged.weight + onset.weight;
        lastMerged.time = (lastMerged.time * lastMerged.weight + onset.time * onset.weight) / totalWeight;
        lastMerged.weight = totalWeight;
      } else {
        mergedOnsets.push({ time: onset.time, weight: onset.weight });
      }
    }
    
    // Filter onsets by minimum weight (remove weak detections)
    const minWeight = Math.max(...mergedOnsets.map(o => o.weight)) * 0.3; // Keep onsets with at least 30% of max weight
    const filteredOnsets = mergedOnsets
      .filter(onset => onset.weight >= minWeight)
      .map(onset => onset.time);
    
    return filteredOnsets;
  }

  // Calculate BPM using autocorrelation method
  calculateBPMFromAutocorrelation(onsets) {
    if (onsets.length < 8) return 120; // Need enough onsets for autocorrelation
    
    // Create onset detection function (binary signal)
    const maxTime = onsets[onsets.length - 1];
    const resolution = 0.01; // 10ms resolution
    const samples = Math.floor(maxTime / resolution);
    const onsetFunction = new Array(samples).fill(0);
    
    // Fill onset function
    onsets.forEach(onset => {
      const index = Math.floor(onset / resolution);
      if (index < samples) onsetFunction[index] = 1;
    });
    
    // Calculate autocorrelation for tempo detection
    const minLag = Math.floor(60 / 200 / resolution); // 200 BPM max
    const maxLag = Math.floor(60 / 60 / resolution);  // 60 BPM min
    
    let maxCorrelation = 0;
    let bestLag = minLag;
    
    for (let lag = minLag; lag < Math.min(maxLag, samples / 2); lag++) {
      let correlation = 0;
      let count = 0;
      
      for (let i = 0; i < samples - lag; i++) {
        correlation += onsetFunction[i] * onsetFunction[i + lag];
        count++;
      }
      
      if (count > 0) {
        correlation /= count;
        if (correlation > maxCorrelation) {
          maxCorrelation = correlation;
          bestLag = lag;
        }
      }
    }
    
    const bestPeriod = bestLag * resolution;
    const bpm = 60 / bestPeriod;
    
    return Math.max(60, Math.min(200, bpm)); // Clamp to reasonable range
  }

  // Calculate confidence score for interval-based detection
  calculateIntervalConfidence(intervals) {
    if (intervals.length === 0) return 0;
    
    const mean = intervals.reduce((sum, val) => sum + val, 0) / intervals.length;
    const variance = intervals.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    
    // Lower standard deviation = higher confidence
    const variabilityScore = Math.max(0, 1 - (stdDev / mean));
    
    // More intervals = higher confidence (up to a point)
    const countScore = Math.min(1, intervals.length / 10);
    
    return (variabilityScore * 0.7 + countScore * 0.3);
  }

  // Calculate confidence score for autocorrelation-based detection
  calculateAutocorrelationConfidence(onsets, bpm) {
    if (onsets.length < 4) return 0;
    
    // Check how well the detected BPM matches the onset pattern
    const expectedInterval = 60 / bpm;
    const actualIntervals = [];
    
    for (let i = 1; i < onsets.length; i++) {
      actualIntervals.push(onsets[i] - onsets[i - 1]);
    }
    
    // Calculate how many intervals are close to expected or its multiples/divisions
    let matchingIntervals = 0;
    const tolerance = expectedInterval * 0.1; // 10% tolerance
    
    actualIntervals.forEach(interval => {
      const ratios = [1, 2, 0.5, 4, 0.25]; // Check for beat, half-beat, double-beat patterns
      for (const ratio of ratios) {
        const expectedForRatio = expectedInterval * ratio;
        if (Math.abs(interval - expectedForRatio) < tolerance) {
          matchingIntervals++;
          break;
        }
      }
    });
    
    const matchRatio = matchingIntervals / actualIntervals.length;
    const densityScore = Math.min(1, onsets.length / (onsets[onsets.length - 1] - onsets[0]) * expectedInterval);
    
    return (matchRatio * 0.8 + densityScore * 0.2);
  }

  // Enhanced BPM validation with confidence-based correction
  validateAndCorrectBPM(bpm, confidence) {
    let validatedBPM = bpm;
    
    // Handle extreme cases with confidence consideration
    if (bpm < 60) {
      validatedBPM = bpm * 2; // Likely half-time detection
      if (confidence < 0.3) validatedBPM = bpm * 4; // Very low confidence, try quarter-time
    } else if (bpm > 200) {
      validatedBPM = bpm / 2; // Likely double-time detection
      if (confidence < 0.3) validatedBPM = bpm / 4; // Very low confidence, try quarter-time
    }
    
    // Genre-aware validation with confidence weighting
    if (confidence > 0.6) {
      // High confidence - minimal adjustment
      if (validatedBPM > 160 && validatedBPM / 2 >= 80) {
        const halfTime = validatedBPM / 2;
        if (halfTime >= 80 && halfTime <= 140) {
          validatedBPM = halfTime;
        }
      }
    } else if (confidence > 0.3) {
      // Medium confidence - moderate adjustment
      if (validatedBPM < 80 && validatedBPM * 2 <= 160) {
        validatedBPM = validatedBPM * 2;
      } else if (validatedBPM > 160 && validatedBPM / 2 >= 70) {
        validatedBPM = validatedBPM / 2;
      }
    } else {
      // Low confidence - fall back to common tempo ranges
      if (validatedBPM < 90) {
        validatedBPM = Math.max(validatedBPM * 2, 120);
      } else if (validatedBPM > 150) {
        validatedBPM = Math.min(validatedBPM / 2, 130);
      }
    }
    
    // Final validation - ensure reasonable range
    return Math.max(70, Math.min(180, validatedBPM));
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
    this.bpmSource = 'manual';
    this.lastManualTapTime = 0; // Will be updated to current playback time when called
    console.log(`Manual BPM override set for deck ${this.deckId}: ${bpm} BPM - limited auto-refinement for 3 seconds`);
    
    if (audioBuffer) {
      this.generateBeatMap(audioBuffer);
    }
  }

  // Method to set BPM from metadata (called when reading file metadata)
  setMetadataBPM(bpm, audioBuffer) {
    if (bpm && bpm > 0) {
      this.metadataBPM = bpm;
      this.baseBPM = bpm;
      this.bpmSource = 'metadata';
      console.log(`Metadata BPM set for deck ${this.deckId}: ${bpm} BPM - very limited auto-refinement`);
      
      if (audioBuffer) {
        this.generateBeatMap(audioBuffer);
      }
      return true;
    }
    return false;
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
}