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

  /** Quiet onsets are left out: the beat is carried by the biggest hits. */
  static STRONG_ONSET_SHARE = 0.5;

  /** Corner frequency of the band the kick is looked for in. */
  static LOW_BAND_HZ = 150;

  /**
   * Below this nothing explains the music, so the tracker probably missed the
   * period rather than its multiple, and overriding it only makes it worse.
   */
  static CONFIDENCE_FLOOR = 0.3;

  /**
   * How much better one octave has to explain the kick before the prior is
   * ignored. Four on the floor beats its half by half again; a dembow, whose
   * syncopation fits both grids, barely separates them at all.
   */
  static EVIDENCE_DECISIVE = 1.25;

  /** Where listeners hear tempo, and how wide that is, in octaves. */
  static TEMPO_PRIOR_CENTRE = 110;
  static TEMPO_PRIOR_WIDTH = 0.9;

  /** Outside this a reading is an octave error, not a genre. */
  static MIN_BPM = 60;
  static MAX_BPM = 220;

  constructor(audioContext, deckId) {
    this.audioContext = audioContext;
    this.deckId = deckId;
    
    this.beatPositions = []; // Array of beat positions in seconds
    this.lastBeatTime = 0;   // Time of the last detected beat
    this.beatInterval = 0.5; // Current beat interval in seconds (will be calculated)
    
    this.baseBPM = 120; // Default BPM, will be updated when track loads
    
    this.audioStartOffset = 0; // Time when actual audio content starts (after silence)
    
    this.bpmSource = null; // Can be: null, 'auto-detected', 'manual'
    this.lastManualTapTime = 0; // Track when user last used TAP
  }

  detectAudioStart(audioBuffer) {
    if (!audioBuffer || !audioBuffer.getChannelData) {
      return 0;
    }
    
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    
    const silenceThreshold = 0.01; // 1% of max amplitude
    
    const chunkSize = sampleRate * 0.1; // 100ms chunks
    
    for (let i = 0; i < channelData.length; i += chunkSize) {
      const chunkEnd = Math.min(i + chunkSize, channelData.length);
      
      let sumSquares = 0;
      for (let j = i; j < chunkEnd; j++) {
        sumSquares += channelData[j] * channelData[j];
      }
      const rms = Math.sqrt(sumSquares / (chunkEnd - i));
      
      if (rms > silenceThreshold) {
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
    
    this.audioStartOffset = this.detectAudioStart(audioBuffer);
    
    this.beatInterval = 60 / this.baseBPM;
    
    this.beatPositions = [];
    const duration = audioBuffer.duration;
    
    for (let time = this.audioStartOffset; time < duration; time += this.beatInterval) {
      this.beatPositions.push(time);
    }
    
    console.log(`Generated ${this.beatPositions.length} beats for ${duration.toFixed(2)}s track at ${this.baseBPM} BPM, starting from ${this.audioStartOffset.toFixed(3)}s`);
  }

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

  getNextBeat(currentTime) {
    for (const beatTime of this.beatPositions) {
      if (beatTime > currentTime) {
        return beatTime;
      }
    }
    return currentTime; // If no next beat found, return current time
  }

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
    this.bpmSource = null;
    this.lastManualTapTime = 0;

    if (!audioBuffer || !audioBuffer.getChannelData) {
      console.warn(`BPM Analyzer: Invalid audio buffer for deck ${this.deckId}`);
      this.baseBPM = 0;
      return 0;
    }

    try {
      const detected = this.analyseWindow(
        BPMAnalyzer.buildAnalysisWindow(audioBuffer),
        audioBuffer.sampleRate
      );

      if (!detected) {
        console.warn(`BPM Analyzer: no tempo found for deck ${this.deckId}, use TAP`);
        this.baseBPM = 0;
        return 0;
      }

      this.baseBPM = detected;
      this.bpmSource = 'auto-detected';
      return detected;
    } catch (error) {
      // Unknown beats a guess: SYNC and the beat map skip a zero BPM, TAP fills it
      console.error(`BPM Analyzer: Detection failed for deck ${this.deckId}, use TAP:`, error);
      this.baseBPM = 0;
      return 0;
    }
  }

  /**
   * The stretch the tempo detector wants out of a longer run of samples. Key
   * detection needs far more, so the worker is sent that and slices here.
   */
  static tempoSlice(samples, sampleRate) {
    const length = Math.floor(BPMAnalyzer.ANALYSIS_WINDOW_SECONDS * sampleRate);
    if (samples.length <= length) return samples;

    const start = Math.min(Math.floor(BPMAnalyzer.ANALYSIS_SKIP_SECONDS * sampleRate), samples.length - length);
    return samples.subarray(start, start + length);
  }

  /** Enough samples for the key, starting at the top so tempoSlice can find
   *  its own stretch inside. */
  static buildWorkerWindow(audioBuffer, seconds) {
    return BPMAnalyzer.buildAnalysisWindow(audioBuffer, Float32Array, { seconds, startSeconds: 0 });
  }

  /**
   * Tempo of one prepared window, in beats per minute, or 0 if none was found.
   * Touches no audio context and no DOM, which is what lets js/bpm-worker.js
   * run it off the main thread for a whole folder at a time.
   */
  analyseWindow(audioData, sampleRate) {
    const mt = new MusicTempo(audioData);
    // MusicTempo reports tempo as a formatted string, e.g. "128.000"
    const detectedBPM = parseFloat(mt.tempo);
    if (!Number.isFinite(detectedBPM) || detectedBPM <= 0) return 0;

    const corrected = this.correctTempoOctave(detectedBPM, mt, audioData, sampleRate);
    console.log(`BPM Analyzer: Detected ${detectedBPM} -> Validated ${corrected} BPM for deck ${this.deckId}`);
    return corrected;
  }

  /**
   * The stretch of audio the detector looks at, mixed to mono. Tempo is
   * effectively constant, so a window answers the same as the whole track at a
   * cost that does not grow with the file.
   *
   * `Output` is the only thing that varies by caller. MusicTempo needs a plain
   * Array and converts a Float32Array into one internally, so on the main
   * thread it is cheaper to build the Array directly; the worker wants
   * Float32Array, which transfers without a copy and converts off-thread.
   */
  static buildAnalysisWindow(audioBuffer, Output = Array, {
    seconds = BPMAnalyzer.ANALYSIS_WINDOW_SECONDS,
    // A little in, since intros often have no drums to lock onto
    startSeconds = BPMAnalyzer.ANALYSIS_SKIP_SECONDS
  } = {}) {
    const { sampleRate, length, numberOfChannels } = audioBuffer;

    const windowLength = Math.min(length, Math.floor(seconds * sampleRate));
    const start = Math.max(0, Math.min(Math.floor(startSeconds * sampleRate), length - windowLength));

    const left = audioBuffer.getChannelData(0);
    const right = numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;

    const samples = new Output(windowLength);
    for (let i = 0; i < windowLength; i++) {
      const s = start + i;
      samples[i] = right ? (left[s] + right[s]) / 2 : left[s];
    }

    return samples;
  }

  /**
   * Which octave of the detected tempo is the real one. Trackers are reliable
   * about the period and unreliable about which multiple of it a listener would
   * call the tempo, so each octave is scored against the onsets on two counts
   * that pull opposite ways: recall punishes grids too slow to explain every
   * kick, precision punishes grids so fast that half of them is silence.
   */
  correctTempoOctave(detectedBPM, mt, audioData, sampleRate) {
    let bpm = detectedBPM;
    while (bpm < BPMAnalyzer.MIN_BPM) bpm *= 2;
    while (bpm > BPMAnalyzer.MAX_BPM) bpm /= 2;

    // The kick, and the whole mix only where there is no usable kick: a dembow's
    // snares syncopate off the beat and fit the half-note grid well enough to
    // pull the answer to twice the tempo.
    const onsets = this.lowBandOnsets(audioData, sampleRate)
      || this.strongOnsets(this.collectOnsets(mt));
    if (!onsets) return Math.round(bpm);

    const scored = [];
    for (const multiple of BPMAnalyzer.OCTAVE_CANDIDATES) {
      const candidate = bpm * multiple;
      if (candidate < BPMAnalyzer.MIN_BPM || candidate > BPMAnalyzer.MAX_BPM) continue;

      scored.push({ bpm: candidate, evidence: this.scoreGrid(onsets, candidate) });
    }
    if (!scored.length) return Math.round(bpm);

    scored.sort((a, b) => b.evidence - a.evidence);

    // Where the kick plainly picks an octave that is the answer; the prior only
    // settles ties, which is most of what a dembow produces.
    const [leader, runnerUp] = scored;
    if (!runnerUp || runnerUp.evidence <= 0 ||
        leader.evidence / runnerUp.evidence >= BPMAnalyzer.EVIDENCE_DECISIVE) {
      return Math.round(leader.bpm);
    }

    let best = null;
    for (const entry of scored) {
      const score = entry.evidence * BPMAnalyzer.tempoPrior(entry.bpm);
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

    // Normalised to zero mean, so it runs negative and needs shifting first
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
   * Onsets from the low end only, which is what settles reggaeton: a dembow
   * lands on sixteenths 0, 3, 6, 8, 11, 14 and no grid fits that, but below a
   * couple of hundred hertz only the kick is left, on 0 and 8. Spectral flux
   * covers the whole spectrum, where a broadband snare outweighs a low kick.
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

  getBPM(playbackRate = 1) {
    return Math.round(this.baseBPM * playbackRate);
  }

  getBaseBPM() {
    return this.baseBPM;
  }

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

  getAudioStartOffset() {
    return this.audioStartOffset;
  }

  updateManualTapTime(currentTime) {
    if (this.bpmSource === 'manual') {
      this.lastManualTapTime = currentTime;
    }
  }
}
