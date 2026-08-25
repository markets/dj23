/**
 * One EQ band as a knob.
 *
 * The arc is the readout: it grows from twelve o'clock, green climbing for a
 * boost and red falling for a cut, and disappears when the band is flat. That
 * is why there is no number under it — it would be saying the same thing twice.
 *
 * The gesture is a vertical drag, not a circular one: nobody traces circles on
 * a mixer, and a straight drag is also what works with a finger.
 *
 * Nothing here draws anything. The dial is three custom properties and a pile
 * of gradients in css/eq.css.
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

  constructor(deckId, band) {
    this.deckId = deckId;
    this.band = band;
    this.root = document.querySelector(`#eq${deckId} [data-band="${band}"]`);
    if (!this.root) return;

    this.value = 0;
    this.killed = false;

    this.dial = this.root.querySelector('.knob');

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

  /** Flat again, kill included: a channel should not carry the last track's
   *  EQ into the next one. */
  reset() {
    this.killed = false;
    this.root.classList.remove('is-killed');
    this.set(0);
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

    // Three numbers is all the dial needs: where the pointer looks, and where
    // the arc starts and ends. The drawing is entirely CSS's problem.
    //
    // A killed band draws no arc — and it has to be zeroed here rather than in
    // the stylesheet, since these are inline properties and nothing in a sheet
    // can outrank them.
    const span = this.killed ? 0 : Math.abs(angle);

    this.dial.style.setProperty('--knob-angle', `${angle.toFixed(1)}deg`);
    this.dial.style.setProperty('--knob-from', `${Math.min(0, angle).toFixed(1)}deg`);
    this.dial.style.setProperty('--knob-span', `${span.toFixed(1)}deg`);

    const rounded = Math.round(this.value);
    this.dial.classList.toggle('is-cut', this.value < -0.5);
    this.root.classList.toggle('is-set', rounded !== 0);

    // The number left the screen, not the accessibility tree
    this.dial.setAttribute('aria-valuenow', rounded);
    this.dial.setAttribute('aria-valuetext', rounded === 0 ? 'flat' : `${rounded > 0 ? '+' : ''}${rounded} dB`);
  }
}

window.EqKnob = EqKnob;
