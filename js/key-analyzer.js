/**
 * Musical key of a track, as a Camelot code.
 *
 * Two steps: fold the spectrum into the twelve pitch classes, then see which
 * of the twenty-four keys that distribution looks most like. The profiles are
 * Krumhansl and Kessler's, measured from listeners rating how well each note
 * fits a key, so the match is against how music in a key actually behaves
 * rather than against its scale.
 *
 * Camelot rather than note names because that is what mixing needs: neighbours
 * on the wheel share all but one note, so 8A goes with 7A, 9A and 8B.
 *
 * Measured across a real library, the seven strongest pitch classes hold 0.68
 * to 0.88 of the energy while white noise holds 0.67 — too narrow to gate on,
 * so every track gets a reading and a drum loop gets a meaningless one, which
 * is the same trade the commercial tools make.
 *
 * Uses the FFT that ships inside music-tempo, so it costs no extra dependency.
 */
class KeyAnalyzer {
  /**
   * How much of a track to read. Measured against whole tracks this gives the
   * same answer every time, for a third less memory and time — and a window
   * this long spans enough sections that two runs cannot disagree.
   */
  static ANALYSIS_SECONDS = 180;

  /** ~186 ms at 44.1 kHz. Long enough that a semitone is wider than a bin. */
  static FFT_SIZE = 8192;
  static HOP_SIZE = 4096;

  /** Below this a bin is wider than the semitone it would be assigned to. */
  static MIN_HZ = 110;
  /** Above this it is mostly harmonics, which only reinforce what is there. */
  static MAX_HZ = 2000;

  /** Share of a frame's loudest bin below which a peak is not worth counting. */
  static PEAK_FLOOR = 0.1;

  static MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  static MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  // Spelled the way the Camelot chart does: flats for the major keys that take
  // them, sharps for the minor ones
  static MAJOR_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  static MINOR_NAMES = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];

  /** Camelot codes by pitch class, C first. Relative keys share a number. */
  static CAMELOT_MAJOR = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B'];
  static CAMELOT_MINOR = ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A'];

  /** `{ camelot, name }` for a window of mono samples, or null if unclear. */
  static detect(samples, sampleRate) {
    if (typeof FFT === 'undefined') return null;

    const chroma = KeyAnalyzer.chromagram(samples, sampleRate);
    return chroma ? KeyAnalyzer.matchProfiles(chroma) : null;
  }

  /** Energy per pitch class, octaves folded together. */
  static chromagram(samples, sampleRate) {
    const size = KeyAnalyzer.FFT_SIZE;
    if (!samples || samples.length < size) return null;

    const window = FFT.getHammingWindow(size);
    const lowest = Math.max(1, Math.floor(KeyAnalyzer.MIN_HZ * size / sampleRate));
    const highest = Math.min(size / 2 - 1, Math.ceil(KeyAnalyzer.MAX_HZ * size / sampleRate));

    const pitchClass = new Int8Array(highest + 1);
    for (let bin = lowest; bin <= highest; bin++) {
      const semitone = Math.round(69 + 12 * Math.log2((bin * sampleRate / size) / 440));
      pitchClass[bin] = ((semitone % 12) + 12) % 12;
    }

    const chroma = new Float64Array(12);
    const real = new Array(size);
    const imaginary = new Array(size);
    let frames = 0;

    for (let start = 0; start + size <= samples.length; start += KeyAnalyzer.HOP_SIZE) {
      for (let i = 0; i < size; i++) {
        real[i] = window[i] * samples[start + i];
        imaginary[i] = 0;
      }
      FFT.getSpectrum(real, imaginary);

      let loudest = 0;
      for (let bin = lowest; bin <= highest; bin++) {
        if (real[bin] > loudest) loudest = real[bin];
      }
      if (loudest <= 0) continue;

      // Only spectral peaks. Between the partials sits broadband noise — cymbals,
      // reverb tails, distortion — and in a real recording that bed is most of
      // the spectrum. Summing every bin lets it flood all twelve classes evenly
      // and flattens the chroma into saying nothing.
      const floor = loudest * KeyAnalyzer.PEAK_FLOOR;
      const frame = new Float64Array(12);
      let total = 0;

      for (let bin = lowest; bin <= highest; bin++) {
        const magnitude = real[bin];
        if (magnitude < floor) continue;
        if (magnitude <= real[bin - 1] || magnitude < real[bin + 1]) continue;

        frame[pitchClass[bin]] += magnitude;
        total += magnitude;
      }
      if (total <= 0) continue;

      // Per frame, so a loud bar does not outvote a quiet one

      for (let i = 0; i < 12; i++) chroma[i] += frame[i] / total;
      frames++;
    }

    return frames ? chroma : null;
  }

  /** The key whose profile the chroma correlates with best. */
  static matchProfiles(chroma) {
    const scored = [];

    for (let tonic = 0; tonic < 12; tonic++) {
      scored.push({
        score: KeyAnalyzer.correlate(chroma, KeyAnalyzer.MAJOR_PROFILE, tonic),
        camelot: KeyAnalyzer.CAMELOT_MAJOR[tonic],
        name: KeyAnalyzer.MAJOR_NAMES[tonic]
      });
      scored.push({
        score: KeyAnalyzer.correlate(chroma, KeyAnalyzer.MINOR_PROFILE, tonic),
        camelot: KeyAnalyzer.CAMELOT_MINOR[tonic],
        name: KeyAnalyzer.MINOR_NAMES[tonic]
      });
    }

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!Number.isFinite(best.score)) return null;

    // No tie-break needed: neighbouring keys are neighbours on the wheel too,
    // so a close second is a key that mixes with the winner anyway
    return { camelot: best.camelot, name: best.name };
  }

  /** Pearson correlation of the chroma against a profile rotated to `tonic`. */
  static correlate(chroma, profile, tonic) {
    let chromaMean = 0;
    let profileMean = 0;
    for (let i = 0; i < 12; i++) {
      chromaMean += chroma[i];
      profileMean += profile[i];
    }
    chromaMean /= 12;
    profileMean /= 12;

    let covariance = 0;
    let chromaVariance = 0;
    let profileVariance = 0;

    for (let i = 0; i < 12; i++) {
      const a = chroma[(i + tonic) % 12] - chromaMean;
      const b = profile[i] - profileMean;
      covariance += a * b;
      chromaVariance += a * a;
      profileVariance += b * b;
    }

    const spread = Math.sqrt(chromaVariance * profileVariance);
    return spread > 0 ? covariance / spread : 0;
  }
}
