/**
 * The one connection to the analysis worker, shared by the track list and the
 * decks. Where it cannot start there is no analysis: doing this work on the
 * main thread would stall the mixer for as long as it takes.
 */
class TrackAnalyser {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.nextId = 0;
  }

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
   * `{ bpm, key }` for a decoded buffer. Decks pass `tempo: false`: they measured
   * it themselves while building their beat map.
   */
  analyse(audioBuffer, { tempo = true } = {}) {
    if (!this.ensureWorker() || !audioBuffer) return Promise.resolve({ bpm: null, key: null });

    // Long enough for the key; the worker takes its shorter tempo stretch out of
    // the same samples
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
