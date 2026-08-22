/**
 * The one connection to the analysis worker, shared by the track list and the
 * decks. Both want tempo and key computed off the main thread, and neither
 * should own the worker.
 *
 * Falls back to nothing rather than to the main thread: doing this work here
 * would stall the mixer for as long as it takes.
 */
class TrackAnalyser {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.nextId = 0;
  }

  /** The worker, or null if it cannot start. */
  ensureWorker() {
    if (this.worker) return this.worker;

    try {
      this.worker = new Worker('js/bpm-worker.js');
      this.worker.onmessage = ({ data }) => {
        const resolve = this.pending.get(data.id);
        if (!resolve) return;

        this.pending.delete(data.id);
        resolve({ bpm: data.bpm, key: data.key });
      };
    } catch (error) {
      console.warn('Track analyser: no worker, tempo and key stay blank:', error);
      this.worker = null;
    }

    return this.worker;
  }

  /**
   * `{ bpm, key }` for a decoded buffer. Decks pass `tempo: false` — they have
   * already measured it while building their beat map, and the worker would
   * only be repeating the work.
   */
  analyse(audioBuffer, { tempo = true } = {}) {
    if (!this.ensureWorker() || !audioBuffer) return Promise.resolve({ bpm: null, key: null });

    // Long enough for the key, which reads steadier across sections; the worker
    // takes the shorter tempo stretch out of the same samples
    const samples = BPMAnalyzer.buildWorkerWindow(audioBuffer, KeyAnalyzer.ANALYSIS_SECONDS);

    return new Promise((resolve) => {
      const id = this.nextId++;
      this.pending.set(id, resolve);
      // Transferred, not copied: the window is tens of megabytes
      this.worker.postMessage({ id, samples, sampleRate: audioBuffer.sampleRate, tempo }, [samples.buffer]);
    });
  }
}

window.trackAnalyser = new TrackAnalyser();
