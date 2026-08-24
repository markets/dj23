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

  loadWaveformData(audioBuffer) {
    if (!audioBuffer) return;
    
    const channelData = audioBuffer.getChannelData(0);
    const samples = 1000; // Number of waveform points
    const blockSize = Math.floor(channelData.length / samples);
    const waveformData = [];

    for (let i = 0; i < samples; i++) {
      const start = i * blockSize;
      const end = start + blockSize;
      let sum = 0;
      let peak = 0; // Track peak amplitude for energy calculation

      for (let j = start; j < end && j < channelData.length; j++) {
        const amplitude = Math.abs(channelData[j]);
        sum += amplitude;
        peak = Math.max(peak, amplitude);
      }

      const average = sum / blockSize;
      
      const energyFactor = Math.pow(average + (peak * 0.2), 1.2);
      
      waveformData.push(energyFactor);
    }

    this.waveformData = waveformData;
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
   * Cue markers: a white line across the waveform with its number against it.
   * Both renderers draw the same marker and differ only in where a cue lands
   * (cueX) and where its label sits (cueLabelY) -- the overview stacks the
   * labels down the waveform so two cues close together in the track still get
   * a readable one each, while the zoomed view has room to keep them in a row.
   * The metrics live in CUE_STYLE so a subclass can restyle without
   * reimplementing the drawing.
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

    Object.entries(deck.cuePoints).forEach(([number, time], index) => {
      if (time === null) return;

      const x = this.cueX(time, width, deck);
      if (x === null) return;

      this.drawCue(x, this.cueLabelY(index, height), height, number);
    });
  }

  /** Where the cue sits on the canvas, or null when it is not on screen. */
  cueX(time, width, deck) {
    return (time / deck.getDuration()) * width;
  }

  cueLabelY(index, height) {
    return 14 + index * 14;
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
}

class WaveformRenderer extends BaseWaveformRenderer {
  constructor(canvasId, deckId) {
    super(canvasId, deckId);        
    this.setupCanvas();
    this.observeResize();
    this.setupEventListeners();
  }

  setupEventListeners() {
    this.canvas.addEventListener('click', (e) => {
      if (!this.waveformData) {
        console.log(`Deck ${this.deckId}: No waveform data available for seeking`);
        return;
      }
            
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = x / rect.width;
            
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck && deck.audioBuffer) {
        const seekTime = percentage * deck.getDuration();
        console.log(`Deck ${this.deckId}: Waveform clicked - seeking to ${seekTime.toFixed(2)}s (${(percentage * 100).toFixed(1)}%)`);
        deck.seek(seekTime);
        this.updatePlayhead();
      } else {
        console.log(`Deck ${this.deckId}: No audio buffer available for seeking`);
      }
    });
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
        
    const barWidth = width / this.waveformData.length;
    const centerY = height / 2;

    this.ctx.fillStyle = Theme.color('border-primary');
    for (let i = 0; i < this.waveformData.length; i++) {
      const barHeight = this.waveformData[i] * centerY;
      const x = i * barWidth;
            
      this.ctx.fillRect(x, centerY - barHeight, barWidth - 1, barHeight);
      this.ctx.fillRect(x, centerY, barWidth - 1, barHeight);
    }

    if (deck && deck.isPlaying) {
      const progress = deck.getCurrentTime() / deck.getDuration();
      const playedWidth = width * progress;
            
      this.ctx.fillStyle = Theme.color('color-primary');
      for (let i = 0; i < this.waveformData.length; i++) {
        const x = i * barWidth;
        if (x > playedWidth) break;
                
        const barHeight = this.waveformData[i] * centerY;
        this.ctx.fillRect(x, centerY - barHeight, barWidth - 1, barHeight);
        this.ctx.fillRect(x, centerY, barWidth - 1, barHeight);
      }
    }

    this.drawCues(width, height, deck);
    this.updatePlayhead();
  }

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
        
    this.ctx.fillStyle = Theme.color('border-light');
    this.ctx.font = '12px Inter';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Load a track to see waveform', width / 2, height / 2 - 10);
  }

  updatePlayhead() {
    const deck = window.audioEngine.getDeck(this.deckId);
    const playhead = document.getElementById(`playhead${this.deckId}`);
        
    if (deck && deck.getDuration() > 0) {
      const progress = deck.getCurrentTime() / deck.getDuration();
      const position = Math.min(progress * 100, 100);
      playhead.style.left = `${position}%`;
      playhead.style.opacity = deck.isPlaying ? '1' : '0.7';
    } else {
      playhead.style.left = '0%';
      playhead.style.opacity = '0.3';
    }
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
   * Target horizontal scale. The zoom window follows the canvas width so a beat
   * occupies the same number of pixels on any screen — roughly 22px at 128bpm,
   * whether that is a phone or a full-width desktop canvas.
   *
   * Every zoom figure below is a span of real time, not of track time. See
   * visibleSeconds().
   */
  static TARGET_PIXELS_PER_SECOND = 48;
  static MIN_ZOOM_SECONDS = 4;
  /** Widest window. Room to see a whole intro or breakdown at once, without
   *  going so far out that the waveform stops being a beat reference. */
  static MAX_ZOOM_SECONDS = 150;
  /** Zoom moves by a proportion, not by seconds: a notch has to feel the same
   *  whether the window is two bars or six minutes wide. */
  static ZOOM_STEP = 1.15;
  /** Below this the beat grid stops being a reference and becomes a haze. */
  static MIN_PIXELS_PER_BEAT = 5;

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
    return Math.max(
      BeatWaveformRenderer.MIN_ZOOM_SECONDS,
      Math.min(
        BeatWaveformRenderer.MAX_ZOOM_SECONDS,
        width / BeatWaveformRenderer.TARGET_PIXELS_PER_SECOND
      )
    );
  }

  /**
   * Splits the track into low / mid / high peak envelopes at a fixed time
   * resolution.
   *
   * Colouring the waveform by frequency content is what makes beat matching
   * work visually: the kick lands in the low band, so it shows up as a tall
   * saturated column that is easy to line up against the other deck. One pass
   * over the PCM with two one-pole filters, no large temporaries.
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
    // Satisfies the inherited "is a track loaded" checks in the drag handlers
    this.waveformData = low;
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
  }

  /**
   * How much track fits in the window right now, in seconds of the track.
   *
   * The zoom is a span of *real* time, so a deck running fast shows more of its
   * track in the same width. That is the whole point: two decks at the same BPM
   * then draw a beat the same number of pixels wide and scroll at the same
   * speed, whatever their pitch faders say, and you can line up a drop by eye.
   * Scale by track seconds instead and the faster deck runs away from the other.
   */
  visibleSeconds(deck) {
    return this.zoomLevel * (deck?.playbackRate || 1);
  }

  /** How much of the track one horizontal pixel covers at the current zoom. */
  secondsPerPixel() {
    const deck = window.audioEngine.getDeck(this.deckId);
    if (!deck || !deck.audioBuffer) return 0;

    // The laid-out width, not the attribute: a hidden canvas measures zero
    const width = this.canvas.getBoundingClientRect().width;
    if (!width) return 0;

    const visible = Math.min(this.visibleSeconds(deck), deck.getDuration() - this.offsetSeconds);
    return Math.max(0, visible) / width;
  }

  updateZoomWindow() {
    const deck = window.audioEngine.getDeck(this.deckId);
    if (!deck || !deck.audioBuffer) {
      this.offsetSeconds = this.zoomLevel / 2;
      return;
    }

    const currentTime = deck.getCurrentTime();
    const duration = deck.getDuration();
    const visible = this.visibleSeconds(deck);

    this.offsetSeconds = currentTime - visible / 2;

    if (this.offsetSeconds + visible > duration) {
      this.offsetSeconds = Math.max(0, duration - visible);
    }
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
    const centerY = height / 2;

    this.ctx.clearRect(0, 0, width, height);

    const pixelsPerSecond = width / this.visibleSeconds(deck);
    const windowStart = this.offsetSeconds;
    const playedUntil = deck.isPlaying || deck.isPaused ? deck.getCurrentTime() : -Infinity;

    // One bar per whole pixel column: fractional ones get re-antialiased as the
    // window scrolls, which reads as a shimmer
    this.drawBands(width, centerY, pixelsPerSecond, windowStart, playedUntil);
    this.drawBeatGrid(width, height, deck);
    this.drawLoop(width, height, deck);
    this.drawCues(width, height, deck);

    this.ctx.strokeStyle = Theme.color('color-playhead');
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(width / 2, 0);
    this.ctx.lineTo(width / 2, height);
    this.ctx.stroke();

    this.updatePlayhead();
  }

  /**
   * Draws the three bands back to front, each with its own height, so the low
   * band paints over the others where it dominates. A kick therefore reads as a
   * tall saturated column, while a hi-hat stays a short pale tick.
   *
   * Each band is a single batched path, so the cost per frame stays flat no
   * matter how many columns are on screen.
   */
  drawBands(width, centerY, pixelsPerSecond, windowStart, playedUntil) {
    const { low, mid, high, bucketsPerSecond } = this.bands;
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
        this.ctx.fillRect(0, 0, until, centerY * 2);
        this.ctx.globalAlpha = 1;
      }
    }

    this.ctx.globalAlpha = 1;
  }

  /**
   * Faint, evenly weighted tick per beat, sitting behind the waveform as a
   * metric reference. Every beat is drawn the same on purpose: without downbeat
   * detection there is no way to know which one is the "one", so emphasising
   * every fourth would put a strong line wherever the count happened to start.
   */
  drawBeatGrid(width, height, deck) {
    const beats = deck.getBeatPositions();
    if (beats.length < 2) return; // BPM unknown, nothing trustworthy to draw

    const pixelsPerSecond = width / this.visibleSeconds(deck);
    const windowStart = this.offsetSeconds;
    const windowEnd = windowStart + this.visibleSeconds(deck);

    // Beats are evenly spaced, so the first visible one can be indexed directly
    const interval = beats[1] - beats[0];

    // Zoomed out over a whole track the ticks land a pixel or two apart and
    // read as a grey wash over the waveform. No grid says more than that.
    if (interval * pixelsPerSecond < BeatWaveformRenderer.MIN_PIXELS_PER_BEAT) return;

    const from = Math.max(0, Math.floor((windowStart - beats[0]) / interval));
    const tick = height * 0.16;

    this.ctx.strokeStyle = Theme.color('border-primary');
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();

    for (let i = from; i < beats.length && beats[i] <= windowEnd; i++) {
      if (beats[i] < windowStart) continue;
      const x = Math.round((beats[i] - windowStart) * pixelsPerSecond) + 0.5;
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, tick);
      this.ctx.moveTo(x, height - tick);
      this.ctx.lineTo(x, height);
    }

    this.ctx.stroke();
  }

  /**
   * The loop as a region rather than as two marks: a wash over the stretch that
   * is repeating, with a firmer line at each end. Coral because that is the
   * colour the loop controls already wear, and a flat wash over the bars is not
   * something the waveform itself ever looks like.
   */
  drawLoop(width, height, deck) {
    if (!deck.isLooping || deck.loopStart === null || deck.loopEnd === null) return;

    const pixelsPerSecond = width / this.visibleSeconds(deck);
    const windowStart = this.offsetSeconds;
    const windowEnd = windowStart + this.visibleSeconds(deck);
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
   * The zoomed view keeps the same marker as the overview, only smaller and
   * pinned to the bottom: with no stacking needed here, the labels sit in a row
   * out of the waveform's way. Cues outside the window are skipped, which is
   * what makes them useful -- you can see the cue you are heading for.
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
    const windowStart = this.offsetSeconds;
    const windowEnd = windowStart + this.visibleSeconds(deck);
    if (time < windowStart || time > windowEnd) return null;

    return Math.round((time - windowStart) * (width / this.visibleSeconds(deck))) + 0.5;
  }

  cueLabelY(index, height) {
    return height - 4;
  }

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
        
    this.ctx.strokeStyle = Theme.color('color-playhead');
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(width / 2, 0);
    this.ctx.lineTo(width / 2, height);
    this.ctx.stroke();
    
    this.ctx.fillStyle = Theme.color('border-light');
    this.ctx.font = '12px Inter';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Load track for beat view', width / 2, height / 2 - 6);
  }

  updatePlayhead() {
    const deck = window.audioEngine.getDeck(this.deckId);
    const playhead = document.getElementById(`beatPlayhead${this.deckId}`);
        
    if (deck && deck.getDuration() > 0) {
      playhead.style.left = '50%';
      playhead.style.opacity = deck.isPlaying ? '1' : '0.7';
    } else {
      playhead.style.left = '50%';
      playhead.style.opacity = '0.3';
    }
  }

  /** Positive steps widen the window (zoom out), negative ones narrow it. */
  zoom(steps) {
    const target = this.zoomLevel * Math.pow(BeatWaveformRenderer.ZOOM_STEP, steps);
    const seconds = BeatWaveformRenderer.clampZoom(target);
    if (seconds === this.zoomLevel) return;

    BeatWaveformRenderer.shareZoom(seconds, { fromUser: true })
      .forEach(renderer => renderer.render());

    console.log(`Beat waveform zoom changed to ${seconds.toFixed(1)} seconds on both decks`);
  }
}

window.waveformRenderers = { A: null, B: null };
window.beatWaveformRenderers = { A: null, B: null };
