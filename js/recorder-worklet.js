/**
 * The tap the recorder listens through.
 *
 * It sits on the audio thread, where nothing may block, so it does the least a
 * node can do: copy the mix into a buffer and hand it over once that buffer is
 * full. The encoding happens two threads away, in js/mp3-worker.js.
 *
 * Blocks arrive 128 frames at a time. Posting each one would be a few hundred
 * messages a second, so they are gathered into BLOCK_FRAMES first and sent as
 * transfers rather than copies.
 *
 * Loaded with audioWorklet.addModule(), so this file must never be a <script>.
 */
class RecorderProcessor extends AudioWorkletProcessor {
  /** ~93ms at 44.1kHz: long enough to keep the message rate low, short enough
   *  that the header timer still looks live. */
  static BLOCK_FRAMES = 4096;

  constructor() {
    super();

    this.filled = 0;
    this.left = new Float32Array(RecorderProcessor.BLOCK_FRAMES);
    this.right = new Float32Array(RecorderProcessor.BLOCK_FRAMES);
    this.isRunning = true;

    // The last partial block would otherwise be lost, and with it the tail of
    // the take. 'end' goes out after it, in order, so the worker knows the
    // stream is complete.
    this.port.onmessage = ({ data }) => {
      if (data !== 'stop' || !this.isRunning) return;

      this.isRunning = false;
      this.send();
      this.port.postMessage({ type: 'end' });
    };
  }

  send() {
    if (this.filled === 0) return;

    const left = this.left.slice(0, this.filled);
    const right = this.right.slice(0, this.filled);
    this.filled = 0;

    this.port.postMessage({ type: 'block', left, right }, [left.buffer, right.buffer]);
  }

  process(inputs) {
    if (!this.isRunning) return false;

    const input = inputs[0];
    if (!input || input.length === 0) return true;

    // Mono sources are recorded as two identical channels rather than half a
    // stereo file
    const left = input[0];
    const right = input[1] || input[0];

    for (let i = 0; i < left.length; i++) {
      this.left[this.filled] = left[i];
      this.right[this.filled] = right[i];
      this.filled++;

      if (this.filled === RecorderProcessor.BLOCK_FRAMES) this.send();
    }

    return true;
  }
}

registerProcessor('recorder-processor', RecorderProcessor);
