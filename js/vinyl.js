/**
 * The feel of a turntable, shared by the two surfaces you can grab: the vinyl
 * platter and the beat-matching waveform. Each surface only has to report how
 * far the record moved; everything about what that does to the audio lives
 * here, so the two behave identically by construction rather than by anyone
 * remembering to keep them in step.
 *
 * What a real deck does and this reproduces: a hand on the record stops it
 * dead, pushing it forward plays at the speed of your hand, and letting go of a
 * running deck lets the motor pull it back up to pitch.
 *
 * Pulling back is audible too, though not cheaply: an AudioBufferSourceNode
 * does not reverse on a negative rate — it freezes its read head and emits DC —
 * so the deck keeps a reversed copy of a few seconds around the needle and
 * plays that instead. Owning the read head in an AudioWorklet would make the
 * direction stop being a special case, which is the next step, and the reason
 * every decision below is phrased as "the record moved N seconds" rather than
 * as a playback rate. Swapping the engine should not touch a line of gesture
 * code.
 */
class Platter {
  /** 33⅓ rpm, the same 1.8s per turn the CSS spin animation uses. */
  static SECONDS_PER_REVOLUTION = 1.8;

  /** Ceiling on how fast a shove can make the audio run. */
  static MAX_RATE = 4;

  /** How long the motor takes to drag the record back up to pitch. */
  static SPIN_UP_SECONDS = 0.2;

  /** Below this the needle is not tracking anything worth hearing. */
  static MIN_AUDIBLE_RATE = 0.06;

  /** How fast the smoothed hand speed chases the raw one, per frame. */
  static VELOCITY_SMOOTHING = 0.4;

  /** Drift between hand and audio that is worth a resync, in seconds. */
  static MAX_DRIFT = 0.05;

  constructor(deckId) {
    this.deckId = deckId;

    this.isHeld = false;
    this.wasPlaying = false;
    this.headTime = 0;       // where the record is while it is in your hand
    this.pendingDelta = 0;   // gesture collected since the last frame
    this.velocity = 0;       // smoothed hand speed, in seconds of audio a second
    this.isAudible = false;
    this.frameId = null;
    this.lastFrameAt = 0;

    this.vinylElement = document.getElementById(`vinyl${deckId}`);
    if (this.vinylElement) {
      new PlatterSurface(this.vinylElement, this, PlatterSurface.angularGesture(this.vinylElement));
    }
  }

  get deck() {
    return window.audioEngine?.getDeck(this.deckId);
  }

  get controller() {
    return window.mixerController?.deckControllers?.[this.deckId];
  }

  /** Nothing to grab until a track is loaded. */
  canGrab() {
    return Boolean(this.deck?.audioBuffer);
  }

  grab() {
    const deck = this.deck;
    if (!deck) return;

    this.cancelFrames();

    this.isHeld = true;
    this.wasPlaying = deck.isPlaying;
    this.headTime = deck.getCurrentTime();
    this.pendingDelta = 0;
    this.velocity = 0;
    this.lastFrameAt = Platter.now();

    // The controller checks this before restarting the CSS spin
    if (this.controller) this.controller.isScratching = true;

    // A hand landing on a spinning record stops it: silent until it is pushed
    this.silence();
    this.showHeldAngle();

    this.frameId = requestAnimationFrame(() => this.tick());
  }

  /**
   * Called by a surface for every scrap of movement it sees. Non-finite input
   * is dropped rather than trusted: velocity is a running average, so a single
   * Infinity would turn into NaN on the next frame and stick to the rate for
   * the rest of the session.
   */
  moveBy(deltaSeconds) {
    if (!this.isHeld || !Number.isFinite(deltaSeconds)) return;
    this.pendingDelta += deltaSeconds;
  }

  /**
   * Hand movement becomes audio here, once per frame rather than once per
   * event. That is deliberate: holding the record perfectly still produces no
   * events at all, and only a frame loop can notice the absence and let the
   * speed decay to a stop.
   */
  tick() {
    if (!this.isHeld) return;

    const deck = this.deck;
    if (!deck) return;

    const now = Platter.now();
    const elapsed = Math.max(now - this.lastFrameAt, 1 / 240);
    this.lastFrameAt = now;

    const moved = this.pendingDelta;
    this.pendingDelta = 0;

    this.headTime = Math.max(0, Math.min(this.headTime + moved, deck.getDuration()));

    const rawVelocity = moved / elapsed;
    this.velocity += (rawVelocity - this.velocity) * Platter.VELOCITY_SMOOTHING;

    this.applyVelocity();
    this.showHeldAngle();

    this.frameId = requestAnimationFrame(() => this.tick());
  }

  applyVelocity() {
    const deck = this.deck;

    if (this.velocity > Platter.MIN_AUDIBLE_RATE) {
      this.follow(false);
      deck.setScratchRate(Math.min(this.velocity, Platter.MAX_RATE));
      return;
    }

    if (this.velocity < -Platter.MIN_AUDIBLE_RATE) {
      this.follow(true);
      // The sign belongs to the reported position: the source itself plays the
      // reversed window forwards, which is what makes the track run back
      deck.setScratchRate(Math.max(this.velocity, -Platter.MAX_RATE));
      return;
    }

    // A hand holding the record still stops it, and the sound with it
    this.silence();
  }

  /** Keep the audio starting where the hand is, running the way it is going. */
  follow(reversed) {
    const deck = this.deck;
    const restart = () => (reversed
      ? deck.playReverseFrom(this.headTime)
      : deck.playFrom(this.headTime));

    if (!this.isAudible || deck.isReversed !== reversed) {
      restart();
      this.isAudible = true;
      return;
    }

    // Audio runs at its own rate and slides away from the hand; pulling it back
    // is what keeps the gesture mapped one to one onto the track
    if (Math.abs(deck.getCurrentTime() - this.headTime) > Platter.MAX_DRIFT) restart();
  }

  /** Stop the sound but keep reporting where the record is. */
  silence() {
    const deck = this.deck;

    if (this.isAudible || deck.source) deck.stopSource();
    this.isAudible = false;

    // Rate zero pins the reported position, so the playhead and the waveforms
    // follow the hand instead of drifting on while nothing is audible
    deck.setScratchRate(0, this.headTime);
  }

  release() {
    const deck = this.deck;

    this.isHeld = false;
    this.cancelFrames();

    if (this.controller) this.controller.isScratching = false;
    if (!deck) return;

    if (!this.wasPlaying) {
      // It was not turning when you grabbed it, so it stays where you left it
      if (this.isAudible) deck.stopSource();
      this.isAudible = false;
      deck.pauseAt(this.headTime);
      deck.setScratchRate(null, this.headTime);
      this.clearHeldAngle(false);
      return;
    }

    // Reversed counts as needing a restart: letting go of a backwards pull has
    // to put the track the right way round again, not ramp the reversed window
    // up to full speed
    if (!this.isAudible || deck.isReversed) {
      deck.playFrom(this.headTime);
      this.isAudible = true;
    }

    this.clearHeldAngle(true);
    this.spinUp();
  }

  /** The motor never stopped, so it drags the record back up to pitch. */
  spinUp() {
    const deck = this.deck;
    const from = Math.max(0, Math.min(this.velocity, Platter.MAX_RATE));
    const to = deck.playbackRate;
    const startedAt = Platter.now();

    const step = () => {
      if (this.isHeld) return; // grabbed again mid-ramp

      const progress = (Platter.now() - startedAt) / Platter.SPIN_UP_SECONDS;

      if (progress >= 1) {
        deck.setScratchRate(null); // rate goes back to the pitch fader
        this.frameId = null;
        return;
      }

      deck.setScratchRate(from + (to - from) * progress);
      this.frameId = requestAnimationFrame(step);
    };

    this.frameId = requestAnimationFrame(step);
  }

  /**
   * While the record is in your hand the CSS animation is a lie, so the angle
   * comes straight off the position instead. Dragging the waveform turns the
   * record too, which falls out of both surfaces sharing this object.
   */
  showHeldAngle() {
    if (!this.vinylElement) return;

    this.vinylElement.classList.remove('spinning');
    const turns = this.headTime / Platter.SECONDS_PER_REVOLUTION;
    this.vinylElement.style.transform = `rotate(${(turns * 360).toFixed(1)}deg)`;
  }

  clearHeldAngle(resumeSpinning) {
    if (!this.vinylElement) return;

    this.vinylElement.style.transform = '';
    if (!resumeSpinning) return;

    // Start the animation at the angle the hand left it at, so the record picks
    // up where it was rather than snapping back to zero
    const phase = this.headTime % Platter.SECONDS_PER_REVOLUTION;
    this.vinylElement.style.animationDelay = `-${phase.toFixed(3)}s`;
    this.vinylElement.classList.add('spinning');
  }

  cancelFrames() {
    if (this.frameId === null) return;
    cancelAnimationFrame(this.frameId);
    this.frameId = null;
  }

  static now() {
    return performance.now() / 1000;
  }
}

/**
 * Pointer plumbing for one grabbable surface. Pointer events cover mouse and
 * touch in a single path, and pointer capture keeps the gesture alive once the
 * cursor leaves the element — which is most of any real scratch — so none of
 * this needs document-level listeners.
 */
class PlatterSurface {
  constructor(element, platter, toSeconds) {
    this.element = element;
    this.platter = platter;
    this.toSeconds = toSeconds;
    this.pointerId = null;
    this.lastEvent = null;

    element.addEventListener('pointerdown', (e) => this.onDown(e));
    element.addEventListener('pointermove', (e) => this.onMove(e));
    element.addEventListener('pointerup', (e) => this.onUp(e));
    element.addEventListener('pointercancel', (e) => this.onUp(e));
  }

  onDown(event) {
    if (this.pointerId !== null) return; // one pointer owns the record
    if (!this.platter.canGrab()) return;

    this.pointerId = event.pointerId;
    this.lastEvent = event;

    // Capture can be refused if the pointer is already gone; losing it costs
    // events once the cursor leaves the element, not the whole gesture
    try {
      this.element.setPointerCapture(event.pointerId);
    } catch (error) {
      // carry on uncaptured
    }

    this.platter.grab();
  }

  onMove(event) {
    if (event.pointerId !== this.pointerId) return;

    this.platter.moveBy(this.toSeconds(this.lastEvent, event));
    this.lastEvent = event;
  }

  onUp(event) {
    if (event.pointerId !== this.pointerId) return;

    this.pointerId = null;
    this.lastEvent = null;
    if (this.element.hasPointerCapture(event.pointerId)) {
      this.element.releasePointerCapture(event.pointerId);
    }
    this.platter.release();
  }

  /** Turning a disc: angle swept maps to time by the rotation speed. */
  static angularGesture(element) {
    const angleOf = (event) => {
      const rect = element.getBoundingClientRect();
      return Math.atan2(
        event.clientY - (rect.top + rect.height / 2),
        event.clientX - (rect.left + rect.width / 2)
      );
    };

    return (previous, current) => {
      let swept = angleOf(current) - angleOf(previous);

      // Crossing the ±π seam is a small move, not most of a turn backwards
      if (swept > Math.PI) swept -= 2 * Math.PI;
      if (swept < -Math.PI) swept += 2 * Math.PI;

      return (swept / (2 * Math.PI)) * Platter.SECONDS_PER_REVOLUTION;
    };
  }

  /** Dragging a timeline: pulling right drags the record backwards. */
  static horizontalGesture(secondsPerPixel) {
    return (previous, current) => -(current.clientX - previous.clientX) * secondsPerPixel();
  }
}

window.platters = { A: null, B: null };
