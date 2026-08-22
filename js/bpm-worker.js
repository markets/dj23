/**
 * Tempo detection off the main thread, so a dropped folder can be analysed
 * without the mixer stuttering. Decoding still has to happen on the main
 * thread — there is no AudioContext in a worker — so what arrives here is an
 * already-prepared window of samples, transferred rather than copied.
 *
 * Started with new Worker(), so this file must never be a <script>.
 */
importScripts('../vendor/music-tempo.min.js', 'bpm-analyzer.js');

const analyzer = new BPMAnalyzer(null, 'queue');

self.onmessage = ({ data }) => {
  try {
    self.postMessage({ id: data.id, bpm: analyzer.analyseWindow(data.samples, data.sampleRate) });
  } catch (error) {
    self.postMessage({ id: data.id, bpm: 0, error: String(error) });
  }
};
