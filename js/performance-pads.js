/**
 * The pad column beside the platter: four hot cues, and a beat loop section
 * that doubles as a loop roll.
 *
 * Cues and loops are deliberately kept apart. The four pads are always cues, so
 * firing one never costs a mode switch, and the LOOP / ROLL selector governs
 * only the block underneath it.
 */
class PerformancePads {
  /** Third operation slot: EXIT ends a loop, but a roll ends when you let go,
   *  so in ROLL the same button latches instead. */
  static LABELS = { loop: 'EXIT', roll: 'HOLD' };

  constructor(deckId) {
    this.deckId = deckId;
    this.mode = 'loop';
    this.isRollLatched = false;

    // The pad a held roll came from, so pointerup knows what to release
    this.heldChip = null;

    this.cacheElements();
    if (!this.column) return;

    this.renderChips();
    this.setupEventListeners();
    this.syncOperations();
  }

  get deck() {
    return window.audioEngine.getDeck(this.deckId);
  }

  get beats() {
    return this.mode === 'roll' ? Deck.ROLL_BEATS : Deck.LOOP_BEATS;
  }

  /** Bounds a ÷2 or ×2 may not step outside, taken from the visible scale. */
  get bounds() {
    const beats = this.beats;
    return { min: beats[0], max: beats[beats.length - 1] };
  }

  cacheElements() {
    this.column = document.getElementById(`pads${this.deckId}`);
    if (!this.column) return;

    this.cueRow = this.column.querySelector('.hot-cues');
    this.chipRow = this.column.querySelector('.loop-lengths');
    this.modeButtons = this.column.querySelectorAll('.loop-mode-btn');
    this.halveButton = this.column.querySelector('[data-op="halve"]');
    this.doubleButton = this.column.querySelector('[data-op="double"]');
    this.thirdButton = this.column.querySelector('[data-op="third"]');
    this.quantizeButton = this.column.querySelector('.quantize-btn');
  }

  /** Loop lengths as a fraction reads better than 0.0625 on a 26px button. */
  formatBeats(beats) {
    if (beats >= 1) return String(beats);
    return `1/${Math.round(1 / beats)}`;
  }

  renderChips() {
    this.chipRow.innerHTML = this.beats
      .map(beats => `<button type="button" class="loop-chip" data-beats="${beats}">${this.formatBeats(beats)}</button>`)
      .join('');
  }

  setupEventListeners() {
    this.cueRow.addEventListener('click', (e) => {
      const pad = e.target.closest('.hot-cue-btn');
      if (pad) this.handleCue(Number(pad.dataset.cue), e.shiftKey);
    });

    this.modeButtons.forEach(button => {
      button.addEventListener('click', () => this.setMode(button.dataset.loopMode));
    });

    // Pointer rather than click: a roll has to start on the way down and end on
    // the way up, and the chips are the only control here that is held
    this.chipRow.addEventListener('pointerdown', (e) => {
      const chip = e.target.closest('.loop-chip');
      if (chip) this.handleChipPress(chip);
    });
    window.addEventListener('pointerup', () => this.releaseHeldChip());
    window.addEventListener('pointercancel', () => this.releaseHeldChip());

    this.halveButton.addEventListener('click', () => this.resize(0.5));
    this.doubleButton.addEventListener('click', () => this.resize(2));
    this.thirdButton.addEventListener('click', () => this.handleThirdSlot());

    this.quantizeButton.addEventListener('click', () => this.toggleQuantize());
  }

  // --- hot cues -------------------------------------------------------------

  /** One pad, three jobs: set an empty one, fire a set one, shift to clear. */
  handleCue(cueNumber, clearing) {
    const deck = this.deck;
    if (!deck || !deck.audioBuffer) return;

    if (clearing) {
      deck.clearCuePoint(cueNumber);
    } else if (deck.hasCuePoint(cueNumber)) {
      deck.jumpToCue(cueNumber);
      this.flashCue(cueNumber);
    } else {
      deck.setCuePoint(cueNumber);
    }

    this.syncCues();
  }

  flashCue(cueNumber) {
    const pad = this.cueRow.querySelector(`[data-cue="${cueNumber}"]`);
    if (!pad) return;

    pad.classList.add('firing');
    setTimeout(() => pad.classList.remove('firing'), 300);
  }

  syncCues() {
    const deck = this.deck;

    this.cueRow.querySelectorAll('.hot-cue-btn').forEach(pad => {
      pad.classList.toggle('set', !!deck && deck.hasCuePoint(Number(pad.dataset.cue)));
    });
  }

  // --- loops and rolls ------------------------------------------------------

  setMode(mode) {
    if (mode === this.mode) return;

    this.stopLoop();
    this.mode = mode;
    this.isRollLatched = false;

    this.modeButtons.forEach(button => {
      button.classList.toggle('active', button.dataset.loopMode === mode);
    });

    this.renderChips();
    this.syncOperations();
  }

  handleChipPress(chip) {
    const deck = this.deck;
    if (!deck || !deck.audioBuffer) return;

    const beats = Number(chip.dataset.beats);

    // Pressing the running length again is how you get out of it
    if (chip.classList.contains('active')) {
      this.stopLoop();
      return;
    }

    if (this.mode === 'roll') {
      if (!deck.startRoll(beats)) return;

      // Release is watched on the window rather than the chip, so a roll ends
      // even if the pointer wandered off the button first. Nothing may run
      // between starting the roll and arming that release: a roll that cannot
      // be let go of is the one failure the DJ cannot mix out of.
      if (!this.isRollLatched) this.heldChip = chip;
    } else if (!deck.setBeatLoop(beats)) {
      return;
    }

    this.highlightChip(chip);
    this.syncOperations();
  }

  /** Fire a length as if its chip had been pressed, for callers that have a
   *  number rather than a button — the keyboard and MIDI. */
  pressLength(beats) {
    const chip = this.chipRow.querySelector(`[data-beats="${beats}"]`);
    if (chip) this.handleChipPress(chip);
  }

  releaseHeldChip() {
    if (!this.heldChip) return;

    this.heldChip = null;
    this.stopLoop();
  }

  stopLoop() {
    const deck = this.deck;
    if (!deck) return;

    if (deck.rollAnchor) {
      deck.stopRoll();
    } else {
      deck.exitLoop();
    }

    this.highlightChip(null);
    this.syncOperations();
  }

  resize(factor) {
    const deck = this.deck;
    if (!deck) return;

    const beats = deck.resizeLoop(factor, this.bounds);
    if (beats === null) return;

    this.highlightChip(this.chipRow.querySelector(`[data-beats="${beats}"]`));
    this.syncOperations();
  }

  /** EXIT in LOOP, HOLD in ROLL — same slot either way, so nothing shifts. */
  handleThirdSlot() {
    if (this.mode !== 'roll') {
      this.stopLoop();
      return;
    }

    this.isRollLatched = !this.isRollLatched;
    if (!this.isRollLatched) this.stopLoop();

    this.syncOperations();
  }

  highlightChip(active) {
    this.chipRow.querySelectorAll('.loop-chip').forEach(chip => {
      chip.classList.toggle('active', chip === active);
    });
  }

  /** With nothing running there is nothing to halve or double, so the two ops
   *  go dim in place. Dimming rather than hiding keeps the grid from jumping. */
  syncOperations() {
    const deck = this.deck;
    const isLooping = !!deck && deck.isLooping;
    const isLive = isLooping || (this.mode === 'roll' && this.isRollLatched);

    this.halveButton.classList.toggle('is-idle', !isLive);
    this.doubleButton.classList.toggle('is-idle', !isLive);

    this.thirdButton.textContent = PerformancePads.LABELS[this.mode];
    this.thirdButton.classList.toggle('is-idle', this.mode === 'loop' && !isLooping);
    // The latch belongs to ROLL: switching to LOOP turns it off, and the slot
    // has to stop looking held the moment it stops being it
    this.thirdButton.classList.toggle('latched', this.mode === 'roll' && this.isRollLatched);
  }

  toggleQuantize() {
    const deck = this.deck;
    if (!deck) return;

    deck.setQuantize(!deck.isQuantizeEnabled);
    this.quantizeButton.classList.toggle('active', deck.isQuantizeEnabled);
  }

  /** A new track keeps the mode and the quantize setting, but not the cues or
   *  the loop the previous one left behind. */
  reset() {
    this.heldChip = null;
    this.isRollLatched = false;

    this.highlightChip(null);
    this.syncCues();
    this.syncOperations();
  }
}
