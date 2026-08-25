/**
 * MP3 encoding off the main thread, so a mix can be recorded straight to a
 * playable file without the mixer stuttering. No browser records MP3 natively —
 * MediaRecorder offers WebM/Opus or MP4/AAC and nothing else — so the take is
 * encoded here, frame by frame, as it is played.
 *
 * What arrives is a window of already-captured samples from
 * js/recorder-worklet.js, transferred rather than copied. Encoding keeps well
 * ahead of real time, so by the time the take is stopped the file is finished.
 *
 * Started with new Worker(), so this file must never be a <script>.
 */
importScripts('../vendor/lamejs.iife.js');

/** One MP3 granule pair. lamejs is happiest fed exactly this, so blocks are
 *  cut to it and whatever is left over waits for the next one. */
const BLOCK = 1152;

let encoder = null;
let frames = [];

// Grown to fit the largest block seen, then reused: the conversion runs on
// every sample of the mix and should not also be allocating
let scratchLeft = new Int16Array(0);
let scratchRight = new Int16Array(0);

// The samples of a block that did not fill a whole granule pair
const carryLeft = new Int16Array(BLOCK);
const carryRight = new Int16Array(BLOCK);
let carried = 0;

const toInt16 = (samples, out) => {
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
};

/** lamejs hands back a view onto a buffer it reuses, so what is kept has to be
 *  a copy of it and not the view itself. */
const keep = (data) => {
  if (data && data.length > 0) frames.push(new Int8Array(data));
};

const encode = (left, right) => keep(encoder.encodeBuffer(left, right));

const push = (left, right) => {
  const count = left.length;

  if (scratchLeft.length < count) {
    scratchLeft = new Int16Array(count);
    scratchRight = new Int16Array(count);
  }

  toInt16(left, scratchLeft);
  toInt16(right, scratchRight);

  let offset = 0;

  if (carried > 0) {
    const take = Math.min(BLOCK - carried, count);
    carryLeft.set(scratchLeft.subarray(0, take), carried);
    carryRight.set(scratchRight.subarray(0, take), carried);
    carried += take;
    offset = take;

    if (carried < BLOCK) return;

    encode(carryLeft, carryRight);
    carried = 0;
  }

  while (count - offset >= BLOCK) {
    encode(
      scratchLeft.subarray(offset, offset + BLOCK),
      scratchRight.subarray(offset, offset + BLOCK)
    );
    offset += BLOCK;
  }

  if (offset < count) {
    carryLeft.set(scratchLeft.subarray(offset, count), 0);
    carryRight.set(scratchRight.subarray(offset, count), 0);
    carried = count - offset;
  }
};

/** Without the flush the encoder keeps its last frames, and the take loses its
 *  final moment. */
const finish = () => {
  if (carried > 0) {
    encode(carryLeft.subarray(0, carried), carryRight.subarray(0, carried));
    carried = 0;
  }

  keep(encoder.flush());

  const blob = new Blob(frames, { type: 'audio/mpeg' });
  frames = [];
  encoder = null;

  return blob;
};

self.onmessage = ({ data }) => {
  try {
    if (data.type === 'start') {
      frames = [];
      carried = 0;
      encoder = new lamejs.Mp3Encoder(2, data.sampleRate, data.bitRate);
      return;
    }

    if (!encoder) return;

    if (data.type === 'block') {
      push(data.left, data.right);
      return;
    }

    if (data.type === 'end') {
      self.postMessage({ type: 'done', blob: finish() });
    }
  } catch (error) {
    console.error('MP3 worker: encoding failed:', error);
    frames = [];
    carried = 0;
    encoder = null;
    self.postMessage({ type: 'failed' });
  }
};
