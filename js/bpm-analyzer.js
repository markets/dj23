class BPMAnalyzer {
  // How much audio the tempo detector looks at, and how far in it starts
  static ANALYSIS_WINDOW_SECONDS = 90;
  static ANALYSIS_SKIP_SECONDS = 15;

  /** Seconds per frame of the onset envelope MusicTempo hands back. */
  static FLUX_TIME_STEP = 0.01;

  /** Multiples of the detected tempo that get scored against the onsets. */
  static OCTAVE_CANDIDATES = [0.25, 0.5, 1, 2, 4];

  /** How far an onset may sit from a grid position and still count. */
  static ONSET_TOLERANCE_SECONDS = 0.07;

  /**
   * Onsets weaker than this share of the loudest ones are left out of the
   * scoring. The beat is carried by the biggest hits: in a dembow the kicks sit
   * on the quarter notes while the snares syncopate off them, so judging every
   * onset equally is what makes reggaeton look like a track at twice its tempo.
   */
  static STRONG_ONSET_SHARE = 0.5;

  /** Corner frequency of the band the kick is looked for in. */
  static LOW_BAND_HZ = 150;

  /**
   * How well the whole mix has to fit some grid before it is trusted over the
   * kick alone. A two-step break puts kick and snare on alternate beats, which
   * fits a grid almost perfectly; a dembow syncopates and fits nothing well.
   */
  static FULL_BAND_TRUST = 0.7;

  /**
   * Below this, no octave explains the music and the tracker has most likely
   * missed the period itself rather than its multiple — in which case there is
   * nothing to choose between and second-guessing it only moves the answer
   * further away.
   */
  static CONFIDENCE_FLOOR = 0.45;

  /** Where listeners hear tempo, and how wide that is, in octaves. */
  static TEMPO_PRIOR_CENTRE = 120;
  static TEMPO_PRIOR_WIDTH = 0.9;

  /** Outside this a reading is an octave error, not a genre. */
  static MIN_BPM = 60;
  static MAX_BPM = 220;

  constructor(audioContext, deckId) {
    this.audioContext = audioContext;
    this.deckId = deckId;
    
    // Beat tracking properties
    this.beatPositions = []; // Array of beat positions in seconds
    this.lastBeatTime = 0;   // Time of the last detected beat
    this.beatInterval = 0.5; // Current beat interval in seconds (will be calculated)
    
    // Store original BPM for pitch-adjusted calculations
    this.baseBPM = 120; // Default BPM, will be updated when track loads
    
    // Audio start detection
    this.audioStartOffset = 0; // Time when actual audio content starts (after silence)
    
    // BPM source tracking for priority system
    this.bpmSource = null; // Can be: null, 'auto-detected', 'manual'
    this.lastManualTapTime = 0; // Track when user last used TAP
  }

  detectAudioStart(audioBuffer) {
    if (!audioBuffer || !audioBuffer.getChannelData) {
      return 0;
    }
    
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    
    // Threshold for detecting "silence" - adjust as needed
    const silenceThreshold = 0.01; // 1% of max amplitude
    
    // Look for the first sample that exceeds the threshold
    // Check samples in chunks to be more efficient
    const chunkSize = sampleRate * 0.1; // 100ms chunks
    
    for (let i = 0; i < channelData.length; i += chunkSize) {
      const chunkEnd = Math.min(i + chunkSize, channelData.length);
      
      // Calculate RMS for this chunk
      let sumSquares = 0;
      for (let j = i; j < chunkEnd; j++) {
        sumSquares += channelData[j] * channelData[j];
      }
      const rms = Math.sqrt(sumSquares / (chunkEnd - i));
      
      // If this chunk has significant audio content
      if (rms > silenceThreshold) {
        // Go back and find the more precise start within this chunk
        for (let k = i; k < chunkEnd; k++) {
          if (Math.abs(channelData[k]) > silenceThreshold * 0.5) {
            const startTime = k / sampleRate;
            console.log(`Deck ${this.deckId}: Detected audio start at ${startTime.toFixed(3)}s`);
            return startTime;
          }
        }
      }
    }
    
    console.log(`Deck ${this.deckId}: No significant audio detected, using time 0`);
    return 0;
  }

  generateBeatMap(audioBuffer) {
    if (!audioBuffer || this.baseBPM <= 0) return;
    
    // Detect when actual audio content starts
    this.audioStartOffset = this.detectAudioStart(audioBuffer);
    
    // Calculate beat interval from BPM
    this.beatInterval = 60 / this.baseBPM;
    
    // Generate beat positions throughout the track, starting from audio start
    this.beatPositions = [];
    const duration = audioBuffer.duration;
    
    // Start from the first beat at the audio start offset
    for (let time = this.audioStartOffset; time < duration; time += this.beatInterval) {
      this.beatPositions.push(time);
    }
    
    console.log(`Generated ${this.beatPositions.length} beats for ${duration.toFixed(2)}s track at ${this.baseBPM} BPM, starting from ${this.audioStartOffset.toFixed(3)}s`);
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

  // Get the previous beat before current time
  getPreviousBeat(currentTime) {
    let previousBeat = 0; // Start from beginning if no previous beat found
    for (const beatTime of this.beatPositions) {
      if (beatTime >= currentTime) {
        break;
      }
      previousBeat = beatTime;
    }
    return previousBeat;
  }

  calculateBPM(audioBuffer) {
    // Reset BPM source tracking when calculating BPM for a new track
    this.bpmSource = null;
    this.lastManualTapTime = 0;

    if (!audioBuffer || !audioBuffer.getChannelData) {
      console.warn(`BPM Analyzer: Invalid audio buffer for deck ${this.deckId}`);
      this.baseBPM = 0;
      return 0;
    }

    try {
      const audioData = this.buildAnalysisWindow(audioBuffer);
      const mt = new MusicTempo(audioData);
      // MusicTempo reports tempo as a formatted string, e.g. "128.000"
      const detectedBPM = parseFloat(mt.tempo);

      // It leaves tempo undefined when it can't find a beat
      if (!Number.isFinite(detectedBPM) || detectedBPM <= 0) {
        console.warn(`BPM Analyzer: no tempo found for deck ${this.deckId}, use TAP`);
        this.baseBPM = 0;
        return 0;
      }

      // Half-time readings are the common failure, not a wrong number
      const validatedBPM = this.correctTempoOctave(detectedBPM, mt, audioData, audioBuffer.sampleRate);
      
      console.log(`BPM Analyzer: Detected ${detectedBPM} -> Validated ${validatedBPM} BPM for deck ${this.deckId}`);
      this.baseBPM = validatedBPM;
      this.bpmSource = 'auto-detected';
      return validatedBPM;
    } catch (error) {
      // Leave the BPM unknown rather than guessing or keeping the previous
      // track's value: SYNC and the beat map already skip a zero BPM, and TAP
      // fills it in. The deck stays fully playable either way.
      console.error(`BPM Analyzer: Detection failed for deck ${this.deckId}, use TAP:`, error);
      this.baseBPM = 0;
      return 0;
    }
  }

  /**
   * MusicTempo wants a plain Array — it copies a Float32Array internally, which
   * would double the peak memory — and its defaults assume 44.1kHz, so the rate
   * is left untouched. Memory is bounded by analysing a window instead: tempo is
   * effectively constant, so a slice gives the same answer as the whole track
   * while keeping cost flat regardless of how long the file is.
   */
  buildAnalysisWindow(audioBuffer) {
    const { sampleRate, length, numberOfChannels } = audioBuffer;

    const windowLength = Math.min(length, Math.floor(BPMAnalyzer.ANALYSIS_WINDOW_SECONDS * sampleRate));
    // Start a little in, since intros often have no drums to lock onto
    const start = Math.min(Math.floor(BPMAnalyzer.ANALYSIS_SKIP_SECONDS * sampleRate), length - windowLength);

    const left = audioBuffer.getChannelData(0);
    const right = numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;

    const audioData = new Array(windowLength);
    for (let i = 0; i < windowLength; i++) {
      const s = start + i;
      audioData[i] = right ? (left[s] + right[s]) / 2 : left[s];
    }

    return audioData;
  }

  // Consolidated BPM validation with genre-aware correction
  /**
   * Which octave of the detected tempo is the real one.
   *
   * Beat trackers are reliable about the *period* and unreliable about which
   * multiple of it a listener would call the tempo. Deciding that from a BPM
   * range is what this used to do — anything over 160 was assumed to be a
   * double-time error — and it turned every makina track into half its tempo.
   *
   * So each candidate octave is scored against the onsets the tracker already
   * found, on two counts that pull in opposite directions:
   *
   *   recall    how much onset energy lands on the grid. A grid that is too
   *             slow scores badly here: it explains every other kick and
   *             ignores the rest.
   *   precision how many grid positions actually have an onset. A grid that is
   *             too fast scores badly here: half of it is silence.
   *
   * Neither alone is enough — recall prefers ever-faster grids, precision
   * prefers ever-slower ones — so the two are combined, and the result is
   * weighted by where listeners hear tempo at all. That last part is what
   * settles reggaeton: the dembow puts real snares off the beat, so the
   * eighth-note grid explains the onsets nearly as well as the quarter-note
   * one, and the tie is broken towards the tempo a person would count.
   */
  correctTempoOctave(detectedBPM, mt, audioData, sampleRate) {
    let bpm = detectedBPM;
    while (bpm < BPMAnalyzer.MIN_BPM) bpm *= 2;
    while (bpm > BPMAnalyzer.MAX_BPM) bpm /= 2;

    const fullBand = this.strongOnsets(this.collectOnsets(mt));
    const lowBand = this.lowBandOnsets(audioData, sampleRate);
    if (!fullBand && !lowBand) return Math.round(bpm);

    const candidates = [];
    for (const multiple of BPMAnalyzer.OCTAVE_CANDIDATES) {
      const candidate = bpm * multiple;
      if (candidate < BPMAnalyzer.MIN_BPM || candidate > BPMAnalyzer.MAX_BPM) continue;

      candidates.push({
        bpm: candidate,
        full: fullBand ? this.scoreGrid(fullBand, candidate) : 0,
        low: lowBand ? this.scoreGrid(lowBand, candidate) : 0,
        prior: BPMAnalyzer.tempoPrior(candidate)
      });
    }

    if (!candidates.length) return Math.round(bpm);

    // Whether the whole mix lands on a grid at all decides which layer to
    // believe. A two-step break fits one tightly, and there the snares are as
    // much part of the pulse as the kick; a dembow fits none, and there only
    // the kick is on the beat at all.
    const bestFit = Math.max(...candidates.map((entry) => entry.full));
    const trustFullBand = bestFit >= BPMAnalyzer.FULL_BAND_TRUST || !lowBand;

    let best = null;
    for (const entry of candidates) {
      const score = (trustFullBand ? entry.full : entry.low) * entry.prior;
      if (!best || score > best.score) best = { bpm: entry.bpm, score };
    }

    if (best.score < BPMAnalyzer.CONFIDENCE_FLOOR) {
      console.log(`BPM Analyzer: nothing fits deck ${this.deckId} well (best ${best.score.toFixed(2)}), keeping the tracker's own tempo`);
      return Math.round(bpm);
    }

    return Math.round(best.bpm);
  }

  /** Onset times and strengths, as the tracker itself saw them. */
  collectOnsets(mt) {
    const flux = mt && mt.spectralFlux;
    const peaks = mt && mt.peaks;
    const events = mt && mt.events;

    if (!Array.isArray(flux) || !Array.isArray(peaks) || !Array.isArray(events)) return null;
    if (peaks.length < 12) return null;

    // The envelope is normalised to zero mean, so it runs negative and has to
    // be shifted before anything is weighted by it
    let floor = Infinity;
    for (const value of flux) if (value < floor) floor = value;

    const times = [];
    const strengths = [];
    let total = 0;

    for (let i = 0; i < peaks.length; i++) {
      const strength = flux[peaks[i]] - floor;
      if (!(strength > 0)) continue;

      times.push(events[i]);
      strengths.push(strength);
      total += strength;
    }

    if (times.length < 12 || total <= 0) return null;

    return { times, strengths, total, span: times[times.length - 1] - times[0] };
  }

  /**
   * Onsets from the low end of the mix only.
   *
   * This is what settles reggaeton. A dembow syncopates its snares off the beat
   * — the pattern lands on sixteenths 0, 3, 6, 8, 11 and 14 — and no grid fits
   * that, so judged on the full mix the eighth-note grid explains more of it
   * than the quarter-note grid does and the tempo comes out doubled. Below a
   * couple of hundred hertz the snares are gone and the kick is left on
   * sixteenths 0 and 8, which only the quarter-note grid fits.
   *
   * Spectral flux would not do: it is computed across the whole spectrum, where
   * a broadband snare outweighs a low kick.
   */
  lowBandOnsets(audioData, sampleRate) {
    if (!audioData || !audioData.length || !sampleRate) return null;

    // One-pole low pass, then the rise in energy frame to frame
    const coefficient = 1 - Math.exp(-2 * Math.PI * BPMAnalyzer.LOW_BAND_HZ / sampleRate);
    const frameLength = Math.max(1, Math.round(BPMAnalyzer.FLUX_TIME_STEP * sampleRate));
    const frames = Math.floor(audioData.length / frameLength);
    if (frames < 100) return null;

    const energy = new Float32Array(frames);
    let filtered = 0;

    for (let frame = 0; frame < frames; frame++) {
      let sum = 0;
      const start = frame * frameLength;

      for (let i = 0; i < frameLength; i++) {
        filtered += (audioData[start + i] - filtered) * coefficient;
        sum += filtered * filtered;
      }

      energy[frame] = Math.sqrt(sum / frameLength);
    }

    const rise = new Float32Array(frames);
    let mean = 0;
    for (let frame = 1; frame < frames; frame++) {
      rise[frame] = Math.max(0, energy[frame] - energy[frame - 1]);
      mean += rise[frame];
    }
    mean /= frames;

    let variance = 0;
    for (const value of rise) variance += (value - mean) * (value - mean);
    const deviation = Math.sqrt(variance / frames);
    const threshold = mean + deviation * 0.5;

    const times = [];
    const strengths = [];
    let total = 0;

    for (let frame = 2; frame < frames - 2; frame++) {
      const value = rise[frame];
      if (value < threshold) continue;
      // Local maximum, so one kick counts once
      if (value < rise[frame - 1] || value < rise[frame - 2]) continue;
      if (value < rise[frame + 1] || value < rise[frame + 2]) continue;

      times.push(frame * BPMAnalyzer.FLUX_TIME_STEP);
      strengths.push(value);
      total += value;
    }

    if (times.length < 8 || total <= 0) return null;

    return { times, strengths, total, span: times[times.length - 1] - times[0] };
  }

  /**
   * Just the loud onsets, measured against the top of the range rather than the
   * mean, so a dense track of quiet hits does not raise its own bar.
   */
  strongOnsets(onsets) {
    if (!onsets) return null;
    const sorted = [...onsets.strengths].sort((a, b) => b - a);
    const top = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.2)));
    const loudest = top.reduce((sum, value) => sum + value, 0) / top.length;
    const threshold = loudest * BPMAnalyzer.STRONG_ONSET_SHARE;

    const times = [];
    const strengths = [];
    let total = 0;

    for (let i = 0; i < onsets.times.length; i++) {
      if (onsets.strengths[i] < threshold) continue;
      times.push(onsets.times[i]);
      strengths.push(onsets.strengths[i]);
      total += onsets.strengths[i];
    }

    if (times.length < 8 || total <= 0) return null;

    return { times, strengths, total, span: times[times.length - 1] - times[0] };
  }

  /**
   * How well a tempo explains the onsets, at its best phase. Returns the
   * harmonic mean of recall and precision, so a grid has to both catch the
   * onsets and not be mostly empty.
   */
  scoreGrid(onsets, bpm) {
    const period = 60 / bpm;
    const tolerance = Math.min(BPMAnalyzer.ONSET_TOLERANCE_SECONDS, period / 6);
    const gridCount = Math.max(1, Math.floor(onsets.span / period) + 1);

    let bestScore = 0;

    // One period of phases is enough; beyond that the grid repeats
    for (let phase = 0; phase < period; phase += BPMAnalyzer.FLUX_TIME_STEP) {
      let explained = 0;
      const filled = new Set();

      for (let i = 0; i < onsets.times.length; i++) {
        const steps = Math.round((onsets.times[i] - onsets.times[0] - phase) / period);
        const drift = Math.abs(onsets.times[i] - onsets.times[0] - phase - steps * period);
        if (drift > tolerance) continue;

        explained += onsets.strengths[i];
        filled.add(steps);
      }

      const recall = explained / onsets.total;
      const precision = filled.size / gridCount;
      if (recall <= 0 || precision <= 0) continue;

      const score = (2 * recall * precision) / (recall + precision);
      if (score > bestScore) bestScore = score;
    }

    return bestScore;
  }

  /**
   * Where listeners hear tempo. Log-normal about a middling BPM, which is the
   * standard shape for this: it barely touches anything from drum and bass to
   * hip-hop, and only asserts itself when two octaves explain the onsets about
   * equally well.
   */
  static tempoPrior(bpm) {
    const octavesFromCentre = Math.log2(bpm / BPMAnalyzer.TEMPO_PRIOR_CENTRE);
    return Math.exp(-0.5 * Math.pow(octavesFromCentre / BPMAnalyzer.TEMPO_PRIOR_WIDTH, 2));
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

  // Get the audio start offset (time when actual content begins)
  getAudioStartOffset() {
    return this.audioStartOffset;
  }

  // Update the manual tap time (should be called with current playback time)
  updateManualTapTime(currentTime) {
    if (this.bpmSource === 'manual') {
      this.lastManualTapTime = currentTime;
    }
  }
}
