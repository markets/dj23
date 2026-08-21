/**
 * A read head this app owns, for as long as a record is in someone's hand.
 *
 * Normal playback stays on an AudioBufferSourceNode, which is good at exactly
 * one thing: running forwards at a steady rate. Everything a scratch needs is
 * the opposite — stopping dead, reversing, changing speed every few
 * milliseconds — and none of it can be expressed as a rate on that node, so the
 * deck used to fake it by splicing a new source in at every direction change.
 * Splices are what clicks are.
 *
 * Here the position is a fractional sample index and the rate is an audio-rate
 * parameter, so zero means silence in place, negative means backwards, and
 * nothing is ever spliced. Only a window of the track is held: enough to
 * scratch through, not a second copy of the whole thing.
 *
 * Loaded through AudioWorklet.addModule, so this file must never be a <script>.
 */
class ScratchHead extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{
      name: 'rate',
      defaultValue: 0,
      minValue: -16,
      maxValue: 16,
      automationRate: 'a-rate'
    }];
  }

  /** Quanta between position reports: ~11 ms, far more often than the eye needs. */
  static REPORT_EVERY = 4;

  /**
   * Rate below which the output fades away. A stationary record is silent — the
   * groove is not moving under the needle — and holding the head still would
   * otherwise repeat one sample forever, which is a DC offset, not a hold.
   * Fading with speed rather than cutting at a threshold keeps it click-free.
   */
  static GATE_RATE = 0.05;

  constructor() {
    super();

    this.channels = null;
    this.position = 0;     // fractional samples into the window
    this.running = false;
    this.sinceReport = 0;

    this.port.onmessage = (event) => this.handle(event.data);
  }

  handle(message) {
    switch (message.type) {
      case 'load':
        // Already copies, handed over as transferables: no allocation here
        this.channels = message.channels.map((data) => new Float32Array(data));
        this.position = message.position * sampleRate;
        break;
      case 'seek':
        this.position = message.position * sampleRate;
        break;
      case 'start':
        this.running = true;
        break;
      case 'stop':
        this.running = false;
        break;
    }
  }

  /**
   * Four-point Hermite interpolation. Linear is fine at a steady 1x, but a
   * scratch spends its time at rates linear interpolation turns into audible
   * grit, and this is the cheapest step up that sounds clean.
   */
  sampleAt(data, position) {
    const index = Math.floor(position);
    const fraction = position - index;
    const last = data.length - 1;

    const x0 = data[index - 1 < 0 ? 0 : index - 1];
    const x1 = data[index < 0 ? 0 : index > last ? last : index];
    const x2 = data[index + 1 > last ? last : index + 1];
    const x3 = data[index + 2 > last ? last : index + 2];

    const c0 = x1;
    const c1 = 0.5 * (x2 - x0);
    const c2 = x0 - 2.5 * x1 + 2 * x2 - 0.5 * x3;
    const c3 = 0.5 * (x3 - x0) + 1.5 * (x1 - x2);

    return ((c3 * fraction + c2) * fraction + c1) * fraction + c0;
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const frames = output[0].length;

    if (!this.running || !this.channels) {
      for (const channel of output) channel.fill(0);
      return true;
    }

    const rate = parameters.rate;
    const steady = rate.length === 1;
    const last = this.channels[0].length - 1;

    for (let frame = 0; frame < frames; frame++) {
      const speed = steady ? rate[0] : rate[frame];
      const gate = Math.min(1, Math.abs(speed) / ScratchHead.GATE_RATE);

      for (let channel = 0; channel < output.length; channel++) {
        const data = this.channels[Math.min(channel, this.channels.length - 1)];
        output[channel][frame] = this.sampleAt(data, this.position) * gate;
      }

      this.position += speed;

      // Running off either end is a hand dragging the record past its edge:
      // stay put rather than wrap or crash
      if (this.position < 0) this.position = 0;
      else if (this.position > last) this.position = last;
    }

    this.sinceReport++;
    if (this.sinceReport >= ScratchHead.REPORT_EVERY) {
      this.sinceReport = 0;
      this.port.postMessage({ position: this.position / sampleRate });
    }

    return true;
  }
}

registerProcessor('scratch-head', ScratchHead);
