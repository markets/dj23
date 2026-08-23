/**
 * The FX unit in the deck panel: a chip per effect, an XY pad, a dry/wet fader
 * and HOLD.
 *
 * Press the pad and the selected effect opens; let go and it shuts again,
 * unless HOLD is lit. Every effect keeps its own position, its own dry/wet and
 * its own on-or-off, so you can hold a delay, move to the filter, and come
 * back to find the delay exactly where you left it.
 *
 * It knows nothing about audio: positions go out normalised, and the labels
 * come back from the parameter map in js/effects.js.
 */
class FxPad {
  /** How far an arrow key moves an axis. */
  static KEY_STEP = 0.04;

  /** Half the handle, in CSS pixels. See render(). */
  static INSET = 10;

  /** Where a normalised value sits along the pad, handle radius allowed for. */
  static position(normalised) {
    return `calc(${FxPad.INSET}px + ${normalised} * (100% - ${FxPad.INSET * 2}px))`;
  }

  constructor(deckId) {
    this.deckId = deckId;
    this.root = document.getElementById(`fxUnit${deckId}`);
    if (!this.root) return;

    this.current = 'filter';
    this.values = {};
    EffectsEngine.ORDER.forEach(effect => {
      this.values[effect] = { ...EffectsEngine.DEFAULTS[effect], on: false };
    });

    this.cacheElements();
    this.setupEventListeners();
    this.select(this.current);
  }

  cacheElements() {
    const role = name => this.root.querySelector(`[data-role="${name}"]`);

    this.pad = role('pad');
    this.glow = role('glow');
    this.handle = role('handle');
    this.xLabel = role('x-label');
    this.xValue = role('x-value');
    this.yLabel = role('y-label');
    this.yValue = role('y-value');
    this.hold = role('hold');
    this.wet = role('wet');
    this.wetValue = role('wet-value');
    this.chips = Array.from(this.root.querySelectorAll('.fx-chip'));
  }

  setupEventListeners() {
    this.chips.forEach(chip => {
      chip.addEventListener('click', () => this.select(chip.dataset.fx));
    });

    this.pointerId = null;

    this.pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.pointerId = e.pointerId;
      // Best effort: the gesture is tracked by id either way, and a press that
      // ends off the pad still has to close the effect
      try { this.pad.setPointerCapture(e.pointerId); } catch (error) { /* no capture */ }
      this.engage(true);
      this.moveTo(e);
    });

    this.pad.addEventListener('pointermove', (e) => {
      if (this.pointerId === e.pointerId) this.moveTo(e);
    });

    const release = (e) => {
      if (this.pointerId !== e.pointerId) return;
      this.pointerId = null;
      try { this.pad.releasePointerCapture(e.pointerId); } catch (error) { /* never held */ }

      // End of gesture: the reverb rebuilds its tail here, not on every pixel
      this.moveTo(e, { final: true });
      if (!this.isHeld()) this.engage(false);
    };

    this.pad.addEventListener('pointerup', release);
    this.pad.addEventListener('pointercancel', release);
    // A press that gets away — capture refused, pointer lost — must not leave
    // the effect stuck open
    window.addEventListener('pointerup', release);

    // The pad is a control, so it answers to the keyboard like one
    this.pad.addEventListener('keydown', (e) => this.handleKey(e));

    this.hold.addEventListener('click', () => {
      const held = !this.isHeld();
      this.hold.setAttribute('aria-pressed', String(held));
      // Letting go of HOLD lets go of the effect too — otherwise the only way
      // out of a latched chop would be to find the pad again
      if (!held) this.engage(false);
      this.render();
    });

    this.wet.addEventListener('input', () => {
      const value = Number(this.wet.value);
      this.values[this.current].wet = value;
      this.deck()?.setEffectWet(this.current, value);
      this.renderWet();
    });
  }

  deck() {
    return window.audioEngine?.getDeck(this.deckId);
  }

  isHeld() {
    return this.hold.getAttribute('aria-pressed') === 'true';
  }

  select(effect) {
    if (!EffectsEngine.PARAMS[effect]) return;

    this.current = effect;
    this.render();
  }

  /** Opens or shuts the selected effect. */
  engage(on) {
    this.values[this.current].on = on;
    this.deck()?.setEffectEngaged(this.current, on);
    this.pad.classList.toggle('engaged', on);
    this.renderChips();
  }

  moveTo(event, { final = false } = {}) {
    const rect = this.pad.getBoundingClientRect();
    const span = { x: rect.width - FxPad.INSET * 2, y: rect.height - FxPad.INSET * 2 };
    if (span.x <= 0 || span.y <= 0) return;

    this.set(
      (event.clientX - rect.left - FxPad.INSET) / span.x,
      1 - (event.clientY - rect.top - FxPad.INSET) / span.y,
      { final }
    );
  }

  handleKey(event) {
    const value = this.values[this.current];

    // Space and Enter are the keyboard's press-and-hold: they latch, since a
    // key repeat is not a finger resting on a pad
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      this.engage(!value.on);
      return;
    }

    const moves = {
      ArrowLeft: [-FxPad.KEY_STEP, 0],
      ArrowRight: [FxPad.KEY_STEP, 0],
      ArrowDown: [0, -FxPad.KEY_STEP],
      ArrowUp: [0, FxPad.KEY_STEP]
    };

    const move = moves[event.key];
    if (!move) return;

    event.preventDefault();
    this.set(value.x + move[0], value.y + move[1], { final: true });
  }

  set(x, y, { final = false } = {}) {
    const effect = this.current;
    const clamp = value => Math.min(1, Math.max(0, value));

    Object.assign(this.values[effect], { x: clamp(x), y: clamp(y) });
    this.deck()?.setEffectPad(effect, this.values[effect], { final });

    this.render();
  }

  reset() {
    if (!this.root) return;

    EffectsEngine.ORDER.forEach(effect => {
      this.values[effect] = { ...EffectsEngine.DEFAULTS[effect], on: false };
    });

    this.hold.setAttribute('aria-pressed', 'false');
    this.pad.classList.remove('engaged');
    this.render();
  }

  render() {
    const effect = this.current;
    const { x, y } = this.values[effect];

    this.xLabel.textContent = EffectsEngine.axis(effect, 'x').label;
    this.yLabel.textContent = EffectsEngine.axis(effect, 'y').label;
    this.xValue.textContent = EffectsEngine.label(effect, 'x', x);
    this.yValue.textContent = EffectsEngine.label(effect, 'y', y);

    // Inset by the handle's radius, so it never gets sliced in half against
    // the pad's edge at the ends of a range
    const left = FxPad.position(x);
    const top = FxPad.position(1 - y);
    this.handle.style.left = left;
    this.handle.style.top = top;
    this.glow.style.left = left;
    this.glow.style.top = top;

    this.pad.classList.toggle('engaged', this.values[effect].on);
    this.renderWet();
    this.renderChips();
  }

  renderWet() {
    const { wet } = this.values[this.current];
    if (Number(this.wet.value) !== wet) this.wet.value = wet;
    this.wetValue.textContent = `${Math.round(wet)}%`;
  }

  renderChips() {
    this.chips.forEach(chip => {
      const effect = chip.dataset.fx;
      chip.classList.toggle('active', effect === this.current);
      chip.classList.toggle('on', this.values[effect].on);
      chip.setAttribute('aria-pressed', String(effect === this.current));
    });
  }
}

window.FxPad = FxPad;
