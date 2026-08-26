/**
 * Header settings menu. Owns the preferences that change how the mixer behaves
 * — pitch fader range, phrase length and output routing — and persists them.
 */
class Settings {
  static STORAGE_KEY = 'dj23.settings';

  /** Empty means whatever the system is pointing at. */
  static SYSTEM_OUTPUT = '';

  /** Read before any instance exists: the audio context is built at startup and
   *  needs to know which card to open against. */
  static savedOutputDevice() {
    try {
      return JSON.parse(localStorage.getItem(Settings.STORAGE_KEY))?.outputDevice || '';
    } catch (error) {
      return '';
    }
  }

  static DEFAULTS = {
    pitchRange: Deck.DEFAULT_PITCH_RANGE,
    phraseLength: BeatWaveformRenderer.DEFAULT_PHRASE_BARS,
    outputRouting: AudioEngine.DEFAULT_ROUTING,
    outputDevice: Settings.SYSTEM_OUTPUT
  };

  /** Settings whose value is a number rather than a name. */
  static NUMERIC = ['pitchRange', 'phraseLength'];

  constructor() {
    this.values = { ...Settings.DEFAULTS, ...this.read() };

    this.toggleButton = document.getElementById('settingsBtn');
    this.menu = document.getElementById('settingsMenu');
  }

  init() {
    this.setupMenu();
    this.setupOptions();
    this.setupOutputDevice();
    this.apply();
  }

  // --- output device --------------------------------------------------------

  setupOutputDevice() {
    this.devicePick = document.getElementById('outputDevicePick');
    this.deviceSelect = document.getElementById('outputDeviceSelect');
    this.deviceNote = document.getElementById('outputDeviceNote');
    if (!this.devicePick) return;

    this.devicePick.addEventListener('click', () => this.chooseOutputDevice());
    this.deviceSelect.addEventListener('change', () => this.useOutputDevice(this.deviceSelect.value));

    // A card chosen last time is asked for again, quietly: the browser still
    // knows the id, and re-listing would mean re-asking for a permission
    if (this.values.outputDevice) this.useOutputDevice(this.values.outputDevice, { quiet: true });
  }

  /** Reveals the sound cards, which costs an audio permission — so it happens
   *  on a click, with the reason on screen, and never at startup. */
  async chooseOutputDevice() {
    this.deviceNote.textContent = 'Asking your browser for the list…';

    let outputs;
    try {
      outputs = await AudioEngine.listOutputs();
    } catch (error) {
      console.warn('Could not list the sound cards:', error);
      this.deviceNote.textContent = 'Your browser would not list them without audio access.';
      return;
    }

    this.deviceSelect.innerHTML = [
      `<option value="">System output</option>`,
      ...outputs.map(device =>
        `<option value="${device.deviceId}">${device.label || 'Unnamed output'}</option>`)
    ].join('');

    this.deviceSelect.value = this.values.outputDevice;
    this.deviceSelect.hidden = false;
    this.deviceNote.textContent = `${outputs.length} found — pick the one your headphones are plugged into.`;
  }

  async useOutputDevice(deviceId, { quiet = false } = {}) {
    const applied = await window.audioEngine.setOutputDevice(deviceId);
    if (!applied && !quiet) {
      this.deviceNote.textContent = 'That card would not take the audio.';
      return;
    }

    this.set('outputDevice', deviceId);
    if (quiet) return;

    // The audio moves to the card straight away, but its extra outputs stay out
    // of reach until the context is rebuilt against it
    this.deviceNote.textContent = window.audioEngine.needsReloadFor(deviceId)
      ? 'Sound goes there now. Reload to reach its other outputs.'
      : 'Using this card.';
  }

  // --- persistence ----------------------------------------------------------

  read() {
    try {
      return JSON.parse(localStorage.getItem(Settings.STORAGE_KEY)) || {};
    } catch (error) {
      console.warn('Could not read saved settings:', error);
      return {};
    }
  }

  write() {
    try {
      localStorage.setItem(Settings.STORAGE_KEY, JSON.stringify(this.values));
    } catch (error) {
      console.warn('Could not save settings:', error);
    }
  }

  set(key, value) {
    this.values[key] = value;
    this.write();
    this.apply();
  }

  // --- menu -----------------------------------------------------------------

  setupMenu() {
    if (!this.toggleButton || !this.menu) return;

    this.toggleButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMenu();
    });

    // Clicking a control inside the menu must not close it
    this.menu.addEventListener('click', (e) => e.stopPropagation());

    document.addEventListener('click', () => this.closeMenu());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeMenu();
    });
  }

  toggleMenu() {
    this.menu.hidden ? this.openMenu() : this.closeMenu();
  }

  openMenu() {
    this.menu.hidden = false;
    this.toggleButton.setAttribute('aria-expanded', 'true');
  }

  closeMenu() {
    if (!this.menu || this.menu.hidden) return;
    this.menu.hidden = true;
    this.toggleButton.setAttribute('aria-expanded', 'false');
  }

  setupOptions() {
    document.querySelectorAll('[data-setting]').forEach(button => {
      button.addEventListener('click', () => {
        const { setting, value } = button.dataset;
        this.set(setting, Settings.NUMERIC.includes(setting) ? Number(value) : value);
      });
    });
  }

  // --- applying -------------------------------------------------------------

  apply() {
    this.applyPitchRange();
    this.applyPhraseLength();
    this.applyOutputRouting();
    this.markSelectedOptions();
  }


  /** Off leaves the beat rows as they were before any of this existed: no
   *  count in the corner, no phrase lines on the waveform. */
  applyPhraseLength() {
    const off = !this.values.phraseLength;

    document.querySelectorAll('.phrase-controls').forEach(el => { el.hidden = off; });
    Object.values(window.beatWaveformRenderers || {}).forEach(renderer => renderer?.render());
  }

  /**
   * The four-output mode needs a card that has four, and how many a card offers
   * is read when the audio context is built — so picking one mid-session moves
   * the sound but not the channel count. The note says what was actually found
   * rather than leaving a setting that silently does nothing.
   */
  describeFourOutputs() {
    const option = document.getElementById('routingSplit4');
    if (!option) return;

    const channels = window.audioEngine.outputChannels;
    const enough = channels >= 4;
    const note = option.querySelector('.settings-choice-note');

    option.classList.toggle('is-unavailable', !enough);
    note.textContent = enough
      ? 'Mix on outputs 1-2, cue on 3-4 — for a controller with its own sound card.'
      : `This card is giving ${channels} channels. Pick it under Sound card above, then reload.`;
  }

  markSelectedOptions() {
    document.querySelectorAll('[data-setting]').forEach(button => {
      const { setting, value } = button.dataset;
      const isSelected = String(this.values[setting]) === value;
      button.classList.toggle('active', isSelected);
      button.setAttribute('aria-checked', String(isSelected));
    });
  }

  applyPitchRange() {
    const range = this.values.pitchRange;

    ['A', 'B'].forEach(deckId => {
      const slider = document.getElementById(`pitch${deckId}`);
      const display = document.getElementById(`pitchDisplay${deckId}`);
      const deck = window.audioEngine?.getDeck(deckId);
      if (!slider || !deck) return;

      slider.min = -range;
      slider.max = range;

      deck.pitchRange = range;

      // A narrower range can leave the deck outside its new limits
      const pitch = deck.setPitch(deck.getPitch());
      slider.value = pitch;
      if (display) display.textContent = `${pitch.toFixed(1)}%`;

      window.mixerController?.deckControllers?.[deckId]?.updateBPMDisplay();
    });
  }

  applyOutputRouting() {
    const routing = window.audioEngine.setOutputRouting(this.values.outputRouting);

    // Every routing but the plain one carries a cue bus, whether it rides the
    // left channel or a pair of outputs of its own
    const cueAvailable = routing !== 'main';

    // Without the cue bus in the graph the pre-listen controls do nothing,
    // so hide them rather than leaving dead buttons on screen
    document.querySelectorAll('.cue-volume, .prelisten-btn').forEach(el => {
      el.hidden = !cueAvailable;
    });

    this.describeFourOutputs();

    if (!cueAvailable) {
      ['A', 'B'].forEach(deckId => {
        const deck = window.audioEngine.getDeck(deckId);
        if (deck?.isPreListenEnabled) window.mixerController?.togglePreListen(deckId);
      });
    }
  }
}
