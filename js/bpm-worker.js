/**
 * Tempo and key detection off the main thread, so a dropped folder can be analysed
 * without the mixer stuttering. Decoding still has to happen on the main
 * thread — there is no AudioContext in a worker — so what arrives here is an
 * already-prepared window of samples, transferred rather than copied.
 *
 * Started with new Worker(), so this file must never be a <script>.
 */
// music-tempo also brings the FFT that KeyAnalyzer uses
importScripts('../vendor/music-tempo.min.js', 'bpm-analyzer.js', 'key-analyzer.js');

const analyzer = new BPMAnalyzer(null, 'queue');

// Separately, because they fail for different reasons: MusicTempo throws when
// it finds no onsets, and that must not cost the key as well.
const attempt = (label, run) => {
  try {
    return run();
  } catch (error) {
    console.warn(`Analysis worker: ${label} failed:`, error);
    return null;
  }
};

self.onmessage = ({ data }) => {
  self.postMessage({
    id: data.id,
    bpm: attempt('tempo', () => analyzer.analyseWindow(
      BPMAnalyzer.tempoSlice(data.samples, data.sampleRate), data.sampleRate)) || 0,
    key: attempt('key', () => KeyAnalyzer.detect(data.samples, data.sampleRate))
  });
};
