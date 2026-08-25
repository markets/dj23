class BaseWaveformRenderer {
  constructor(canvasId, deckId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.deckId = deckId;
    this.waveformData = null;
    this.animationId = null;
  }

  /**
   * Match the canvas backing store to its CSS size. The element is sized by
   * the stylesheet, so nothing is written back to canvas.style — writing an
   * inline width there would freeze the canvas at whatever it measured first.
   * Returns true when the size actually changed and a re-render is needed.
   */
  setupCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;

    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);

    if (this.canvas.width === width && this.canvas.height === height) return false;

    this.canvas.width = width;
    this.canvas.height = height;
    // setTransform, not scale — scale would compound on every resize
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    return true;
  }

  /** Keep the backing store in sync with the fluid layout. */
  observeResize() {
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.setupCanvas()) return;
      this.onCanvasResized?.();
      this.render();
    });

    this.resizeObserver.observe(this.canvas);
  }

  async generateWaveform(audioBuffer) {
    this.loadWaveformData(audioBuffer);
    this.render();
  }

  startAnimation() {
    if (this.animationId) return;
    
    const animate = () => {
      this.render();
      this.animationId = requestAnimationFrame(animate);
    };
    animate();
  }

  /**
   * Cue markers: a white line with its number against it. Both views draw the
   * same marker and differ only in where a cue lands (cueX), where its label
   * sits (cueLabelY) and these metrics.
   */
  static CUE_STYLE = {
    lineWidth: 2,
    font: 'bold 10px Inter',
    labelOffset: 6,
    labelPadding: 4,
    textInset: 2,
    boxAscent: 10,
    boxHeight: 12,
    boxAlpha: 0.7,
  };

  drawCues(width, height, deck) {
    if (!deck || !deck.audioBuffer) return;

    const cues = Object.entries(deck.cuePoints);

    cues.forEach(([number, time], index) => {
      if (time === null) return;

      const x = this.cueX(time, width, deck);
      if (x === null) return;

      this.drawCue(x, this.cueLabelY(index, height, cues.length), height, number);
    });
  }

  /** Where the cue sits on the canvas, or null when it is not on screen. */
  cueX(time, width, deck) {
    return (time / deck.getDuration()) * width;
  }

  /** Labels stacked down the waveform so two cues close together in the track
   *  still get a readable one each, tightening up on a short canvas rather than
   *  running off the bottom of it. */
  cueLabelY(index, height, count) {
    const top = 14;
    const step = count > 1 ? Math.min(14, Math.max(0, height - top - 2) / (count - 1)) : 0;

    return top + index * step;
  }

  drawCue(x, textY, height, label) {
    const style = this.constructor.CUE_STYLE;
    const color = Theme.color('text-primary');

    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = style.lineWidth;
    this.ctx.setLineDash([]);
    this.ctx.beginPath();
    this.ctx.moveTo(x, 0);
    this.ctx.lineTo(x, height);
    this.ctx.stroke();

    this.ctx.font = style.font;
    this.ctx.textAlign = 'left';

    const boxX = x + style.labelOffset;
    const boxWidth = this.ctx.measureText(label).width + style.labelPadding;

    this.ctx.fillStyle = `rgba(0, 0, 0, ${style.boxAlpha})`;
    this.ctx.fillRect(boxX, textY - style.boxAscent, boxWidth, style.boxHeight);

    this.ctx.fillStyle = color;
    this.ctx.fillText(label, boxX + style.textInset, textY);
  }

  /** How far the placeholder's baseline sits above the middle line. */
  static EMPTY_TEXT_OFFSET = 6;

  /** Placeholder for a deck with nothing loaded: a baseline and a prompt, plus
   *  whatever else the view keeps on screen when it is empty. */
  renderEmpty() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;

    this.ctx.clearRect(0, 0, width, height);

    this.ctx.strokeStyle = Theme.color('border-primary');
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(0, height / 2);
    this.ctx.lineTo(width, height / 2);
    this.ctx.stroke();

    this.drawEmptyMarks?.(width, height);

    this.ctx.fillStyle = Theme.color('border-light');
    this.ctx.font = '12px Inter';
    this.ctx.textAlign = 'center';
    // On the middle line, but never so high that a short canvas clips it
    const textY = Math.max(12, height / 2 - BaseWaveformRenderer.EMPTY_TEXT_OFFSET);
    this.ctx.fillText(this.constructor.EMPTY_MESSAGE, width / 2, textY);
  }

  /** The DOM playhead over the canvas: the overview's runs with the track, the
   *  beat view's is nailed to the centre with the waveform moving under it. */
  updatePlayhead() {
    const deck = window.audioEngine.getDeck(this.deckId);
    const playhead = document.getElementById(this.playheadId);
    const loaded = deck && deck.getDuration() > 0;

    playhead.style.left = `${this.playheadPercent(loaded ? deck : null)}%`;
    playhead.style.opacity = loaded ? (deck.isPlaying ? '1' : '0.7') : '0.3';
  }
}

class WaveformRenderer extends BaseWaveformRenderer {
  /** Points across the whole track, whatever its length. */
  static SAMPLE_COUNT = 1000;

  static EMPTY_MESSAGE = 'Load a track to see waveform';

  constructor(canvasId, deckId) {
    super(canvasId, deckId);
    this.setupCanvas();
    this.observeResize();
    this.setupEventListeners();
  }

  get playheadId() {
    return `playhead${this.deckId}`;
  }

  playheadPercent(deck) {
    return deck ? Math.min(100, (deck.getCurrentTime() / deck.getDuration()) * 100) : 0;
  }

  setupEventListeners() {
    this.canvas.addEventListener('click', (e) => {
      const deck = window.audioEngine.getDeck(this.deckId);
      if (!this.waveformData || !deck || !deck.audioBuffer) return;

      const rect = this.canvas.getBoundingClientRect();
      deck.seek(((e.clientX - rect.left) / rect.width) * deck.getDuration());
      this.updatePlayhead();
    });
  }

  /** One amplitude per point: the average, lifted by the peak so a transient
   *  still shows, then curved so quiet passages do not flatten out. */
  loadWaveformData(audioBuffer) {
    if (!audioBuffer) return;

    const channelData = audioBuffer.getChannelData(0);
    const blockSize = Math.floor(channelData.length / WaveformRenderer.SAMPLE_COUNT);
    const waveformData = [];

    for (let i = 0; i < WaveformRenderer.SAMPLE_COUNT; i++) {
      const start = i * blockSize;
      const end = Math.min(start + blockSize, channelData.length);
      let sum = 0;
      let peak = 0;

      for (let j = start; j < end; j++) {
        const amplitude = Math.abs(channelData[j]);
        sum += amplitude;
        if (amplitude > peak) peak = amplitude;
      }

      waveformData.push(Math.pow(sum / blockSize + peak * 0.2, 1.2));
    }

    this.waveformData = waveformData;
  }

  /** Tallest point falling in a pixel column, so nothing is lost when the
   *  track has more points than the canvas has pixels. */
  columnPeak(px, width) {
    const bars = this.waveformData;
    const from = Math.floor((px * bars.length) / width);
    const to = Math.max(from + 1, Math.floor(((px + 1) * bars.length) / width));

    let peak = 0;
    for (let i = from; i < to && i < bars.length; i++) {
      if (bars[i] > peak) peak = bars[i];
    }

    return peak;
  }

  render() {
    if (!this.waveformData) {
      this.renderEmpty();
      return;
    }

    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const deck = window.audioEngine.getDeck(this.deckId);

    this.ctx.clearRect(0, 0, width, height);

    const centerY = height / 2;
    const played = deck && deck.isPlaying
      ? Math.round(width * (deck.getCurrentTime() / deck.getDuration()))
      : 0;

    // One column per whole pixel, as the beat view does: a thousand points over
    // a few hundred pixels means sub-pixel bars, and drawing those individually
    // is both blurry and a few thousand canvas calls a frame. Each colour is
    // one batched path, so a redraw costs a pass over the columns on screen.
    for (const [colour, from, to] of [
      [Theme.color('color-primary'), 0, played],
      [Theme.color('border-primary'), played, width]
    ]) {
      if (from >= to) continue;

      this.ctx.fillStyle = colour;
      this.ctx.beginPath();

      for (let px = from; px < to; px++) {
        const barHeight = this.columnPeak(px, width) * centerY;
        this.ctx.rect(px, centerY - barHeight, 1, Math.max(1, barHeight * 2));
      }

      this.ctx.fill();
    }

    this.drawCues(width, height, deck);
    this.updatePlayhead();
  }

}

class BeatWaveformRenderer extends BaseWaveformRenderer {
  /**
   * Envelope buckets per second, which sets whether a kick is visible at all.
   * At 100/s a beat at 120bpm spans 50 buckets and a kick transient about 5.
   * Resolution is per second rather than per track, so it holds up on a ten
   * minute mix as well as a two minute edit.
   */
  static BUCKETS_PER_SECOND = 100;

  // Crossover points for the three bands, in Hz
  static LOW_HZ = 200;
  static HIGH_HZ = 4000;

  /**
   * Target horizontal scale: the window follows the canvas width so a beat is
   * the same number of pixels on any screen, roughly 22px at 128bpm. Every zoom
   * figure here is a span of real time, not of track time — see visibleSeconds.
   */
  static TARGET_PIXELS_PER_SECOND = 48;
  static MIN_ZOOM_SECONDS = 4;
  /** Widest window. Room to see a whole intro or breakdown at once, without
   *  going so far out that the waveform stops being a beat reference. */
  static MAX_ZOOM_SECONDS = 200;
  /** Zoom moves by a proportion, not by seconds: a notch has to feel the same
   *  whether the window is two bars or six minutes wide. */
  static ZOOM_STEP = 1.15;
  /** Below this the beat grid stops being a reference and becomes a haze. */
  static MIN_PIXELS_PER_BEAT = 5;

  static BEATS_PER_BAR = 4;

  /** Bars per phrase out of the box, and what the settings menu starts on. */
  static DEFAULT_PHRASE_BARS = 16;

  /**
   * The three weights of the metre, dimmest first. Beats stay ticks at the
   * edges — there are too many of them to cross the waveform — while bars and
   * phrases are full-height lines you can count along the row. The phrase line
   * goes quieter while nobody has marked the 1, matching the count's own hedge.
   */
  static BEAT_ALPHA = 0.16;
  static BAR_ALPHA = 0.3;
  static PHRASE_ALPHA = 0.62;
  static PHRASE_ALPHA_GUESS = 0.28;

  static EMPTY_MESSAGE = 'Load track for beat view';

  constructor(canvasId, deckId) {
    super(canvasId, deckId);
    this.offsetSeconds = 0; // Current offset from track start
    this.bands = null; // { low, mid, high } peak envelopes, see loadWaveformData
    this.userZoomed = false; // Once zoomed by hand, stop auto-fitting the window

    this.setupCanvas();
    this.zoomLevel = this.defaultZoom();
    this.observeResize();
    this.setupEventListeners();
  }

  get playheadId() {
    return `beatPlayhead${this.deckId}`;
  }

  /** Always the centre: here it is the waveform that moves. */
  playheadPercent() {
    return 50;
  }

  /** Re-fit the window when the canvas changes size, e.g. on rotation. */
  onCanvasResized() {
    if (!this.userZoomed) BeatWaveformRenderer.shareZoom(this.defaultZoom());
  }

  /**
   * Hands a zoom window to both waveforms. Beat matching is a comparison
   * between the two grids, so they are only readable at the same scale —
   * zooming one deck alone would make the pair meaningless.
   * Returns the renderers, so the caller can redraw them.
   */
  static shareZoom(seconds, { fromUser = false } = {}) {
    const renderers = Object.values(window.beatWaveformRenderers || {}).filter(Boolean);

    for (const renderer of renderers) {
      renderer.zoomLevel = seconds;
      if (fromUser) renderer.userZoomed = true;
    }

    return renderers;
  }

  static clampZoom(seconds) {
    return Math.min(
      BeatWaveformRenderer.MAX_ZOOM_SECONDS,
      Math.max(BeatWaveformRenderer.MIN_ZOOM_SECONDS, seconds)
    );
  }

  /** Zoom window that keeps the horizontal scale constant across screen sizes. */
  defaultZoom() {
    const width = this.canvas.clientWidth || 1440;
    return BeatWaveformRenderer.clampZoom(width / BeatWaveformRenderer.TARGET_PIXELS_PER_SECOND);
  }

  /**
   * Low / mid / high peak envelopes at a fixed time resolution. Colouring by
   * frequency is what makes beat matching work by eye: the kick lands in the
   * low band and reads as a tall saturated column to line up against the other
   * deck. One pass over the PCM with two one-pole filters.
   */
  loadWaveformData(audioBuffer) {
    if (!audioBuffer) return;

    const { sampleRate, length } = audioBuffer;
    const samplesPerBucket = Math.max(1, Math.round(sampleRate / BeatWaveformRenderer.BUCKETS_PER_SECOND));
    const buckets = Math.ceil(length / samplesPerBucket);

    const low = new Float32Array(buckets);
    const mid = new Float32Array(buckets);
    const high = new Float32Array(buckets);

    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;

    // One-pole coefficients: y += (x - y) * k
    const kLow = 1 - Math.exp(-2 * Math.PI * BeatWaveformRenderer.LOW_HZ / sampleRate);
    const kHigh = 1 - Math.exp(-2 * Math.PI * BeatWaveformRenderer.HIGH_HZ / sampleRate);

    let lowState = 0;
    let highState = 0;
    let peakLow = 0;
    let peakMid = 0;
    let peakHigh = 0;
    let bucket = 0;
    let inBucket = 0;

    for (let i = 0; i < length; i++) {
      const sample = right ? (left[i] + right[i]) * 0.5 : left[i];

      lowState += (sample - lowState) * kLow;    // below LOW_HZ
      highState += (sample - highState) * kHigh; // below HIGH_HZ

      const lowValue = lowState < 0 ? -lowState : lowState;
      const midSignal = highState - lowState;
      const midValue = midSignal < 0 ? -midSignal : midSignal;
      const highSignal = sample - highState;
      const highValue = highSignal < 0 ? -highSignal : highSignal;

      if (lowValue > peakLow) peakLow = lowValue;
      if (midValue > peakMid) peakMid = midValue;
      if (highValue > peakHigh) peakHigh = highValue;

      if (++inBucket === samplesPerBucket) {
        low[bucket] = peakLow;
        mid[bucket] = peakMid;
        high[bucket] = peakHigh;
        bucket++;
        inBucket = peakLow = peakMid = peakHigh = 0;
      }
    }

    if (inBucket > 0 && bucket < buckets) {
      low[bucket] = peakLow;
      mid[bucket] = peakMid;
      high[bucket] = peakHigh;
    }

    // One shared scale keeps the dynamics — a quiet hi-hat stays shorter than
    // the kick. The per-band gains only offset music's falling energy up high.
    let peak = 0;
    for (let i = 0; i < buckets; i++) {
      if (low[i] > peak) peak = low[i];
      if (mid[i] > peak) peak = mid[i];
      if (high[i] > peak) peak = high[i];
    }

    if (peak > 0) {
      const apply = (data, gain) => {
        const scale = gain / peak;
        for (let i = 0; i < data.length; i++) data[i] = Math.min(1, data[i] * scale);
      };
      apply(low, 1);
      apply(mid, 1.6);
      apply(high, 2.2);
    }

    this.bands = { low, mid, high, bucketsPerSecond: sampleRate / samplesPerBucket };
  }

  setupEventListeners() {
    // Grabbing the waveform is grabbing the record: same object, same physics.
    // All this surface adds is how much track a horizontal drag covers.
    const platter = window.platters[this.deckId];
    if (platter) {
      new PlatterSurface(
        this.canvas,
        platter,
        PlatterSurface.horizontalGesture(() => this.secondsPerPixel())
      );
    }

    // Half a step per notch, so a wheel is finer grained than the buttons
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom(e.deltaY > 0 ? 0.5 : -0.5);
    });

    // Scoped to this deck: every renderer runs this method, so a hardcoded id
    // here would wire one button up twice. Either pair drives both waveforms
    // all the same — the zoom itself is shared.
    document.getElementById(`zoomIn${this.deckId}`).addEventListener('click', () => {
      this.zoom(-2);
    });
    document.getElementById(`zoomOut${this.deckId}`).addEventListener('click', () => {
      this.zoom(2);
    });

    this.phraseCount = document.getElementById(`phraseCount${this.deckId}`);

    // Tapping the count says "the 1 is here"; the arrows move it a beat, which
    // is what a tap in a live set is usually out by
    this.phraseCount.addEventListener('click', () => {
      const deck = window.audioEngine.getDeck(this.deckId);
      if (!deck?.audioBuffer) return;

      deck.setPhraseAnchor(deck.getCurrentTime());
      this.phraseCount.classList.add('is-set');
      setTimeout(() => this.phraseCount.classList.remove('is-set'), 260);
      this.render();
    });

    for (const [id, beats] of [[`phraseBack${this.deckId}`, -1], [`phraseForward${this.deckId}`, 1]]) {
      document.getElementById(id).addEventListener('click', () => {
        const deck = window.audioEngine.getDeck(this.deckId);
        if (!deck?.audioBuffer) return;

        deck.nudgePhraseAnchor(beats);
        this.render();
      });
    }
  }

  /** Bars per phrase, or 0 when the count is switched off. */
  phraseBars() {
    const bars = window.settings?.values?.phraseLength;
    return bars === undefined ? BeatWaveformRenderer.DEFAULT_PHRASE_BARS : bars;
  }

  /** Seconds a phrase lasts, or 0 when there is nothing to count. */
  phraseSeconds(deck) {
    const beats = this.phraseBars() * BeatWaveformRenderer.BEATS_PER_BAR;
    return deck.getBeatPositions().length < 2 ? 0 : beats * deck.getBeatInterval();
  }

  /**
   * How much track fits in the window, in seconds of the track. The zoom is a
   * span of *real* time, so a deck running fast shows more of its track in the
   * same width — which is the point: two decks at the same BPM then draw a beat
   * the same width and scroll together, whatever their pitch faders say.
   */
  visibleSeconds(deck) {
    return this.zoomLevel * (deck?.playbackRate || 1);
  }

  /**
   * The stretch of track on screen right now, and its horizontal scale. Every
   * layer draws against this, so none of them can disagree about where a
   * second lands.
   */
  view(width, deck) {
    const seconds = this.visibleSeconds(deck);

    return {
      start: this.offsetSeconds,
      end: this.offsetSeconds + seconds,
      pixelsPerSecond: width / seconds
    };
  }

  /** How much of the track one horizontal pixel covers at the current zoom. */
  secondsPerPixel() {
    const deck = window.audioEngine.getDeck(this.deckId);
    if (!deck || !deck.audioBuffer) return 0;

    // The laid-out width, not the attribute: a hidden canvas measures zero
    const width = this.canvas.getBoundingClientRect().width;
    if (!width) return 0;

    return this.visibleSeconds(deck) / width;
  }

  updateZoomWindow() {
    const deck = window.audioEngine.getDeck(this.deckId);
    if (!deck || !deck.audioBuffer) {
      this.offsetSeconds = this.zoomLevel / 2;
      return;
    }

    // The playhead owns the centre for the whole track, including the head and
    // the tail: pinning the window to the last screenful instead would freeze
    // the waveform while the played wash kept crawling across it. Past the ends
    // the canvas is simply empty, which reads as "no track left".
    const visible = this.visibleSeconds(deck);
    const start = deck.getCurrentTime() - visible / 2;
    // Zero while the canvas is off screen, which leaves the window unsnapped
    // until it has a width to snap to
    const secondsPerPixel = this.canvas.clientWidth ? visible / this.canvas.clientWidth : 0;

    // Snapped to whole pixels, so every column always covers the same stretch
    // of track and scrolling slides the picture instead of resampling it.
    // Unsnapped, a column zoomed out spans hundreds of envelope buckets and a
    // sub-pixel shift can swap which one is its peak — that is the shimmer.
    // The playhead is then up to half a pixel off centre, which is invisible.
    this.offsetSeconds = secondsPerPixel > 0
      ? Math.round(start / secondsPerPixel) * secondsPerPixel
      : start;
  }

  render() {
    if (!this.bands) {
      this.renderEmpty();
      return;
    }

    const deck = window.audioEngine.getDeck(this.deckId);
    if (!deck) return;

    this.updateZoomWindow();

    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;

    this.ctx.clearRect(0, 0, width, height);

    this.drawBands(width, height, deck);
    this.drawBeatGrid(width, height, deck);
    this.drawPhraseLines(width, height, deck);
    this.drawLoop(width, height, deck);
    this.drawCues(width, height, deck);
    this.drawPlayheadLine(width, height);

    this.updatePlayhead();
    this.updatePhraseCount(deck);
  }

  /**
   * A full-height line wherever a phrase starts, counted off the deck's anchor.
   * It is the only line on the canvas that says something about the music
   * rather than the metre, which is why it earns the whole height.
   */
  drawPhraseLines(width, height, deck) {
    const span = this.phraseSeconds(deck);
    if (!span) return;

    const { start, end, pixelsPerSecond } = this.view(width, deck);
    const anchor = deck.getPhraseAnchor();
    const first = anchor + Math.ceil((start - anchor) / span) * span;

    this.ctx.strokeStyle = Theme.color('text-primary');
    this.ctx.globalAlpha = deck.isPhraseConfirmed
      ? BeatWaveformRenderer.PHRASE_ALPHA
      : BeatWaveformRenderer.PHRASE_ALPHA_GUESS;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();

    for (let at = first; at <= end; at += span) {
      if (at < 0) continue;
      const x = Math.round((at - start) * pixelsPerSecond) + 0.5;
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, height);
    }

    this.ctx.stroke();
    this.ctx.globalAlpha = 1;
  }

  /** Bars left of the phrase, in the corner. Counts down to 1, which is the
   *  bar you act on: four beats later the next one starts. */
  updatePhraseCount(deck) {
    if (!this.phraseCount) return;

    const span = this.phraseSeconds(deck);
    if (!span) {
      this.phraseCount.textContent = '–';
      this.phraseCount.classList.remove('is-last', 'is-guess');
      return;
    }

    const bars = this.phraseBars();

    // Parked between two beats the answer is the beat you are parked on: mark
    // the 1 while paused and the count has to read a full phrase, not the tail
    // of the one before. Playing, the exact time is what keeps the number
    // turning over on the line rather than just before it.
    const now = deck.isPlaying ? deck.getCurrentTime() : deck.findNearestBeat(deck.getCurrentTime());
    const from = (now - deck.getPhraseAnchor()) / (span / bars);

    // The anchor snaps to the nearest beat, which can be a few milliseconds
    // ahead of the playhead that set it. Sitting inside that beat is being on
    // the 1, not at the tail of the phrase before it — without this the count
    // flashes 1 before settling on a full phrase.
    const counted = from < 0 && from > -1 ? 0 : from;
    const left = bars - Math.floor(((counted % bars) + bars) % bars);

    this.phraseCount.textContent = left;
    this.phraseCount.classList.toggle('is-last', left === 1);
    this.phraseCount.classList.toggle('is-guess', !deck.isPhraseConfirmed);
  }

  drawPlayheadLine(width, height) {
    this.ctx.strokeStyle = Theme.color('color-playhead');
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(width / 2, 0);
    this.ctx.lineTo(width / 2, height);
    this.ctx.stroke();
  }

  /**
   * The three bands back to front, so the low band paints over the others where
   * it dominates: a kick reads as a tall saturated column, a hi-hat as a short
   * pale tick. One batched path per band keeps the per-frame cost flat.
   */
  drawBands(width, height, deck) {
    const { low, mid, high, bucketsPerSecond } = this.bands;
    const { start: windowStart, pixelsPerSecond } = this.view(width, deck);
    const centerY = height / 2;
    const playedUntil = deck.isPlaying || deck.isPaused ? deck.getCurrentTime() : -Infinity;

    // One column per whole pixel: fractional ones get re-antialiased as the
    // window scrolls, which reads as a shimmer
    const secondsPerPixel = 1 / pixelsPerSecond;

    const layers = [
      { data: high, colour: Theme.color('text-secondary') },
      { data: mid, colour: Theme.color('color-primary') },
      { data: low, colour: Theme.color('color-secondary') }
    ];

    for (const { data, colour } of layers) {
      this.ctx.fillStyle = colour;
      this.ctx.beginPath();

      for (let px = 0; px < width; px++) {
        const time = windowStart + px * secondsPerPixel;
        if (time < 0) continue;

        const from = Math.floor(time * bucketsPerSecond);
        const to = Math.floor((time + secondsPerPixel) * bucketsPerSecond);
        if (from >= data.length) break;

        let peak = 0;
        for (let b = from; b <= to && b < data.length; b++) {
          if (data[b] > peak) peak = data[b];
        }
        if (peak <= 0) continue;

        const h = Math.max(1, peak * centerY);
        this.ctx.rect(px, centerY - h, 1, h * 2);
      }

      this.ctx.fill();
    }

    // One wash over the finished layers, so only brightness changes at the
    // playhead. Fading bands separately would shift the hue and break the
    // colour comparison between decks.
    if (playedUntil > windowStart) {
      const until = Math.min(width, Math.round((playedUntil - windowStart) * pixelsPerSecond));
      if (until > 0) {
        this.ctx.globalAlpha = 0.55;
        this.ctx.fillStyle = Theme.color('bg-primary');
        this.ctx.fillRect(0, 0, until, height);
        this.ctx.globalAlpha = 1;
      }
    }
  }

  /**
   * The metre behind the waveform: a short faint tick per beat, and a full
   * height line per bar so the bars can be counted along the row rather than
   * squinted at in the corners. Bars are counted off the deck's phrase anchor,
   * so marking the 1 moves them with it — without that anchor there is no way
   * to know which beat starts a bar, and a bar line in the wrong place is
   * worse than none.
   */
  drawBeatGrid(width, height, deck) {
    const beats = deck.getBeatPositions();
    if (beats.length < 2) return; // BPM unknown, nothing trustworthy to draw

    const { start, end, pixelsPerSecond } = this.view(width, deck);

    // Beats are evenly spaced, so the first visible one can be indexed directly
    const interval = beats[1] - beats[0];
    const spacing = interval * pixelsPerSecond;
    const perBar = BeatWaveformRenderer.BEATS_PER_BAR;

    // Zoomed out the ticks land a pixel or two apart and read as a grey wash
    // over the waveform. Bar ticks survive four times longer than beat ones, so
    // each level is measured on its own spacing.
    const levels = [];
    if (spacing >= BeatWaveformRenderer.MIN_PIXELS_PER_BEAT) {
      levels.push({
        every: 1,
        tick: height * 0.16,
        colour: Theme.color('text-primary'),
        alpha: BeatWaveformRenderer.BEAT_ALPHA
      });
    }
    if (this.phraseBars() && spacing * perBar >= BeatWaveformRenderer.MIN_PIXELS_PER_BEAT) {
      // Held back while the 1 is only a guess: the bar lines are no better
      // than the anchor they are counted from
      levels.push({
        every: perBar,
        tick: height / 2,
        colour: Theme.color('text-primary'),
        alpha: deck.isPhraseConfirmed
          ? BeatWaveformRenderer.BAR_ALPHA
          : BeatWaveformRenderer.BAR_ALPHA * 0.55
      });
    }
    if (!levels.length) return;

    const anchor = deck.getPhraseAnchor();
    const from = Math.max(0, Math.floor((start - beats[0]) / interval));

    for (const level of levels) {
      this.ctx.strokeStyle = level.colour;
      this.ctx.globalAlpha = level.alpha;
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();

      for (let i = from; i < beats.length && beats[i] <= end; i++) {
        if (beats[i] < start) continue;
        if (level.every > 1 && this.beatInBar(beats[i], anchor, interval) !== 0) continue;

        const x = Math.round((beats[i] - start) * pixelsPerSecond) + 0.5;
        this.ctx.moveTo(x, 0);
        this.ctx.lineTo(x, level.tick);
        this.ctx.moveTo(x, height - level.tick);
        this.ctx.lineTo(x, height);
      }

      this.ctx.stroke();
      this.ctx.globalAlpha = 1;
    }
  }

  /** Where a beat falls inside its bar, counting from the anchor: 0 is the one. */
  beatInBar(time, anchor, interval) {
    const beat = Math.round((time - anchor) / interval);
    const perBar = BeatWaveformRenderer.BEATS_PER_BAR;

    return ((beat % perBar) + perBar) % perBar;
  }

  /**
   * The loop as a region rather than as two marks: a wash over the stretch that
   * is repeating, with a firmer line at each end. Coral because that is the
   * colour the loop controls already wear, and a flat wash over the bars is not
   * something the waveform itself ever looks like.
   */
  drawLoop(width, height, deck) {
    if (!deck.isLooping || deck.loopStart === null || deck.loopEnd === null) return;

    const { start: windowStart, end: windowEnd, pixelsPerSecond } = this.view(width, deck);
    if (deck.loopEnd < windowStart || deck.loopStart > windowEnd) return;

    const from = (deck.loopStart - windowStart) * pixelsPerSecond;
    const to = (deck.loopEnd - windowStart) * pixelsPerSecond;
    const left = Math.max(0, from);
    const right = Math.min(width, to);

    this.ctx.globalAlpha = 0.16;
    this.ctx.fillStyle = Theme.color('color-secondary');
    this.ctx.fillRect(left, 0, Math.max(1, right - left), height);
    this.ctx.globalAlpha = 1;

    // Only the ends that are actually on screen: a line at the edge of the
    // canvas would read as a loop point that is not there
    this.ctx.strokeStyle = Theme.color('color-secondary');
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();

    for (const edge of [from, to]) {
      if (edge < 0 || edge > width) continue;
      const x = Math.round(edge) + 0.5;
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, height);
    }

    this.ctx.stroke();
  }

  /**
   * The same marker as the overview, smaller and pinned to the bottom out of
   * the waveform's way. Only cues inside the window are drawn, which is what
   * makes them useful: you can see the cue you are heading for.
   */
  static CUE_STYLE = {
    lineWidth: 1.5,
    font: '600 9px Inter',
    labelOffset: 2,
    labelPadding: 6,
    textInset: 3,
    boxAscent: 9,
    boxHeight: 11,
    boxAlpha: 0.75,
  };

  cueX(time, width, deck) {
    const { start, end, pixelsPerSecond } = this.view(width, deck);
    if (time < start || time > end) return null;

    return Math.round((time - start) * pixelsPerSecond) + 0.5;
  }

  cueLabelY(index, height) {
    return height - 4;
  }

  /** The centre line stays even with no track: it is where the music will be. */
  drawEmptyMarks(width, height) {
    this.drawPlayheadLine(width, height);
  }

  /** Positive steps widen the window (zoom out), negative ones narrow it. */
  zoom(steps) {
    const target = this.zoomLevel * Math.pow(BeatWaveformRenderer.ZOOM_STEP, steps);
    const seconds = BeatWaveformRenderer.clampZoom(target);
    if (seconds === this.zoomLevel) return;

    BeatWaveformRenderer.shareZoom(seconds, { fromUser: true })
      .forEach(renderer => renderer.render());
  }
}

window.waveformRenderers = { A: null, B: null };
window.beatWaveformRenderers = { A: null, B: null };
