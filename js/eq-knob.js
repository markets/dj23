/**
 * One EQ band as a knob.
 *
 * The arc is the readout: it grows from twelve o'clock, green climbing for a
 * boost and red falling for a cut, and disappears when the band is flat. That
 * is why there is no number under it — it would be saying the same thing twice.
 *
 * The gesture is a vertical drag, not a circular one: nobody traces circles on
 * a mixer, and a straight drag is also what works with a finger.
 */
class EqKnob {
  /** Decibels either side of flat, matching the filters behind it. */
  static RANGE = 25;

  /** Degrees either side of twelve o'clock. 270° of travel in total. */
  static SWEEP = 135;

  /** Pixels of drag from one end of the range to the other. */
  static DRAG_RANGE = 160;

  /** Arrow keys move a decibel, page keys five. */
  static KEY_STEP = 1;
  static PAGE_STEP = 5;

  static BANDS = ['high', 'mid', 'low', 'gain'];

  /** A point on the dial, in the SVG's own 100×100 space. */
  static polar(radius, degrees) {
    const angle = (degrees - 90) * Math.PI / 180;
    return [50 + radius * Math.cos(angle), 50 + radius * Math.sin(angle)];
  }

  /** Arc path between two angles, both measured from twelve o'clock. */
  static arc(radius, from, to) {
    if (Math.abs(to - from) < 0.15) return '';

    const [x1, y1] = EqKnob.polar(radius, from);
    const [x2, y2] = EqKnob.polar(radius, to);
    const large = Math.abs(to - from) > 180 ? 1 : 0;
    const sweep = to > from ? 1 : 0;

    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 ${large} ${sweep} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }

  constructor(deckId, band) {
    this.deckId = deckId;
    this.band = band;
    this.root = document.querySelector(`#eq${deckId} [data-band="${band}"]`);
    if (!this.root) return;

    this.value = 0;
    this.killed = false;

    this.dial = this.root.querySelector('.knob');
    this.arcPath = this.root.querySelector('.knob-arc');
    this.pointer = this.root.querySelector('.knob-pointer');

    this.setupEventListeners();
    this.render();
  }

  deck() {
    return window.audioEngine?.getDeck(this.deckId);
  }

  setupEventListeners() {
    let startY = 0;
    let startValue = 0;
    let pointerId = null;

    const release = (e) => {
      if (pointerId !== e.pointerId) return;
      pointerId = null;
      try { this.dial.releasePointerCapture(e.pointerId); } catch (error) { /* never held */ }
    };

    this.dial.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pointerId = e.pointerId;
      startY = e.clientY;
      startValue = this.value;
      try { this.dial.setPointerCapture(e.pointerId); } catch (error) { /* no capture */ }
    });

    this.dial.addEventListener('pointermove', (e) => {
      if (pointerId !== e.pointerId) return;
      // A button that is no longer down means the drag ended somewhere we never
      // heard about, and a knob that keeps following the mouse is worse than
      // one that stops early
      if (!(e.buttons & 1)) return release(e);

      const fine = e.shiftKey ? 0.25 : 1;
      const travel = (startY - e.clientY) / EqKnob.DRAG_RANGE * (EqKnob.RANGE * 2) * fine;
      this.set(startValue + travel);
    });

    this.dial.addEventListener('pointerup', release);
    this.dial.addEventListener('pointercancel', release);
    window.addEventListener('pointerup', release);

    this.dial.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.set(this.value + (e.deltaY > 0 ? -1 : 1));
    }, { passive: false });

    this.dial.addEventListener('dblclick', () => this.set(0));

    this.dial.addEventListener('keydown', (e) => {
      const moves = {
        ArrowUp: EqKnob.KEY_STEP, ArrowRight: EqKnob.KEY_STEP,
        ArrowDown: -EqKnob.KEY_STEP, ArrowLeft: -EqKnob.KEY_STEP,
        PageUp: EqKnob.PAGE_STEP, PageDown: -EqKnob.PAGE_STEP
      };

      if (e.key === 'Home') {
        e.preventDefault();
        return this.set(0);
      }

      const move = moves[e.key];
      if (move === undefined) return;

      e.preventDefault();
      this.set(this.value + move);
    });

    window.buttonHandler.createClickHandler(`${this.band}Reset${this.deckId}`, () => this.set(0));

    // Kill is held, not latched, same as it has always been here
    window.buttonHandler.createPressAndHoldHandler(
      `${this.band}Kill${this.deckId}`,
      () => this.kill(true),
      () => this.kill(false),
      { updateActiveState: true }
    );
  }

  /**
   * Drops the band to the bottom of its range, and puts it back on release.
   * The dial stays where the hand left it: a kill is a switch, not a move, and
   * a pointer that swings away and back is noise in the middle of a mix.
   */
  kill(killed) {
    this.killed = killed;
    this.deck()?.setEQ(this.band, killed ? -EqKnob.RANGE : this.value);
    this.root.classList.toggle('is-killed', killed);
    this.render();
  }

  set(value) {
    this.value = Math.max(-EqKnob.RANGE, Math.min(EqKnob.RANGE, Math.round(value * 10) / 10));

    // Turning a killed band sets where it comes back to, rather than fighting
    // the kill for the audio
    if (!this.killed) this.deck()?.setEQ(this.band, this.value);

    this.render();
  }

  render() {
    const angle = (this.value / EqKnob.RANGE) * EqKnob.SWEEP;
    const [x1, y1] = EqKnob.polar(6, angle);
    const [x2, y2] = EqKnob.polar(30, angle);

    // A killed band shows no arc: the red K and the dimmed dial are the state,
    // and the pointer still shows what it will come back to
    this.arcPath.setAttribute('d', this.killed ? '' : EqKnob.arc(42, 0, angle));
    this.pointer.setAttribute('x1', x1.toFixed(2));
    this.pointer.setAttribute('y1', y1.toFixed(2));
    this.pointer.setAttribute('x2', x2.toFixed(2));
    this.pointer.setAttribute('y2', y2.toFixed(2));

    const rounded = Math.round(this.value);
    this.dial.classList.toggle('is-cut', this.value < -0.5);
    this.root.classList.toggle('is-set', rounded !== 0);

    // The number left the screen, not the accessibility tree
    this.dial.setAttribute('aria-valuenow', rounded);
    this.dial.setAttribute('aria-valuetext', rounded === 0 ? 'flat' : `${rounded > 0 ? '+' : ''}${rounded} dB`);
  }
}

window.EqKnob = EqKnob;
