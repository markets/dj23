/**
 * Header settings menu. Owns the two preferences that change how the mixer
 * behaves — pitch fader range and output routing — and persists them.
 */
class Settings {
  static STORAGE_KEY = 'dj23.settings';

  static DEFAULTS = {
    pitchRange: Deck.DEFAULT_PITCH_RANGE,
    outputRouting: AudioEngine.DEFAULT_ROUTING
  };

  constructor() {
    this.values = { ...Settings.DEFAULTS, ...this.read() };

    this.toggleButton = document.getElementById('settingsBtn');
    this.menu = document.getElementById('settingsMenu');
  }

  init() {
    this.setupMenu();
    this.setupOptions();
    this.apply();
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
        this.set(setting, setting === 'pitchRange' ? Number(value) : value);
      });
    });
  }

  // --- applying -------------------------------------------------------------

  apply() {
    this.applyPitchRange();
    this.applyOutputRouting();
    this.markSelectedOptions();
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
    const cueAvailable = routing === 'cue-split';

    // Without the cue bus in the graph the pre-listen controls do nothing,
    // so hide them rather than leaving dead buttons on screen
    document.querySelectorAll('.cue-volume, .prelisten-btn').forEach(el => {
      el.hidden = !cueAvailable;
    });

    if (!cueAvailable) {
      ['A', 'B'].forEach(deckId => {
        const deck = window.audioEngine.getDeck(deckId);
        if (deck?.isPreListenEnabled) window.mixerController?.togglePreListen(deckId);
      });
    }
  }
}
