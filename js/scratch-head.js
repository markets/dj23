/**
 * A read head this app owns, for as long as a record is in someone's hand.
 *
 * An AudioBufferSourceNode only runs forwards at a steady rate, and a scratch
 * needs the opposite: stopping dead, reversing, changing speed every few
 * milliseconds. Here the position is a fractional sample index and the rate is
 * an audio-rate parameter, so zero is silence in place, negative is backwards,
 * and nothing is spliced. Only a window of the track is held.
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
   * Rate below which the output fades away. A stationary record is silent, and
   * repeating one sample forever is a DC offset rather than a hold; fading with
   * speed instead of cutting at a threshold keeps it click-free.
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
   * Four-point Hermite interpolation: linear is fine at a steady 1x, but turns
   * to audible grit at the rates a scratch spends its time at.
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

      // A hand dragging the record past its edge: stay put rather than wrap
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
