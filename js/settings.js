/**
 * Header settings menu. Owns the preferences that change how the mixer behaves
 * — pitch fader range, phrase length, and where the sound goes — and persists
 * them.
 *
 * The output settings are the one copy of the truth: the audio engine is told
 * what to apply and never keeps its own opinion.
 */
class Settings {
  static STORAGE_KEY = 'dj23.settings';

  /** An empty card id means whatever the system is pointing at. */
  static SYSTEM_OUTPUT = '';

  static DEFAULTS = {
    pitchRange: Deck.DEFAULT_PITCH_RANGE,
    phraseLength: BeatWaveformRenderer.DEFAULT_PHRASE_BARS,
    outputRouting: AudioEngine.DEFAULT_ROUTING,
    outputDevice: Settings.SYSTEM_OUTPUT,
    channelMap: { ...AudioEngine.DEFAULT_CHANNEL_MAP }
  };

  /** Settings whose value is a number rather than a name. */
  static NUMERIC = ['pitchRange', 'phraseLength'];

  /** Read before any instance exists: the audio context is built at startup and
   *  has to know which card to open against. */
  static savedOutputDevice() {
    try {
      return JSON.parse(localStorage.getItem(Settings.STORAGE_KEY))?.outputDevice || Settings.SYSTEM_OUTPUT;
    } catch (error) {
      return Settings.SYSTEM_OUTPUT;
    }
  }

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

  // --- external audio -------------------------------------------------------

  setupOutputDevice() {
    this.deviceSelect = document.getElementById('outputDeviceSelect');
    this.external = document.getElementById('routingExternal');
    this.routingNote = document.getElementById('routingNote');
    if (!this.deviceSelect) return;

    // Naming the cards costs a permission, so it waits for someone to reach for
    // the list rather than happening on the way past
    const reveal = () => this.revealCards();
    this.deviceSelect.addEventListener('pointerdown', reveal, { once: true });
    this.deviceSelect.addEventListener('focus', reveal, { once: true });

    this.deviceSelect.addEventListener('change', () => this.useOutputDevice(this.deviceSelect.value));

    this.external.addEventListener('change', (e) => {
      const bus = e.target.dataset.pair;
      if (bus) this.setPair(bus, Number(e.target.value));
    });

    this.showSavedCard();

    // Asked for again quietly: the browser still knows the id, so re-listing
    // would mean re-asking for the permission
    this.useOutputDevice(this.values.outputDevice, { quiet: true });
  }

  /**
   * Names the cards, which costs an audio permission.
   *
   * Output devices come back nameless until the page holds one, and the
   * microphone is the only key the browser offers — so it is asked for, the
   * stream is handed straight back, and nothing is ever listened to.
   */
  /** Something to read before the list has been earned. */
  showSavedCard() {
    const saved = this.values.outputDevice;
    this.deviceSelect.innerHTML =
      `<option value="${saved}">${saved ? 'Saved card' : 'System output'}</option>`;
  }

  async revealCards() {
    let outputs;
    try {
      outputs = await AudioEngine.listOutputs();
    } catch (error) {
      console.warn('Could not list the sound cards:', error);
      this.routingNote.textContent = 'Your browser would not name the cards without audio access.';
      return;
    }

    this.deviceSelect.innerHTML = [
      '<option value="">System output</option>',
      ...outputs.map(device => `<option value="${device.deviceId}">${device.label || 'Unnamed card'}</option>`)
    ].join('');
    this.deviceSelect.value = this.values.outputDevice;
  }

  async useOutputDevice(deviceId, { quiet = false } = {}) {
    const applied = await window.audioEngine.setOutputDevice(deviceId);
    if (!applied && !quiet) {
      this.routingNote.textContent = 'That card would not take the audio.';
      return;
    }

    // Asked directly rather than read off the live context, which is still
    // stuck with the count of whatever it was built against
    this.cardChannels = await AudioEngine.probeChannels(deviceId);

    this.set('outputDevice', deviceId);
  }

  setPair(bus, pair) {
    this.values.channelMap = { ...this.values.channelMap, [bus]: pair };
    this.write();
    this.apply();
  }

  /**
   * Buses move in stereo pairs, so the pickers offer pairs. It is also the only
   * honest place to show how many outputs the browser found: a card giving one
   * pair says so here rather than through a routing that quietly does nothing.
   */
  describeExternal() {
    if (!this.external) return;

    const engine = window.audioEngine;

    // What the chosen card can do, which is not always what the running context
    // can reach: the two only agree once it has been rebuilt against the card
    const channels = this.cardChannels ?? engine.outputChannels;
    const pairs = Math.max(1, Math.floor(channels / 2));
    const live = engine.outputPairs;

    this.external.hidden = this.values.outputRouting !== 'split-4';
    document.getElementById('routingSplit4')?.classList.toggle('is-unavailable', pairs < 2);

    this.external.querySelectorAll('[data-pair]').forEach(select => {
      const bus = select.dataset.pair;
      select.innerHTML = Array.from({ length: pairs }, (_, index) =>
        `<option value="${index}">${index * 2 + 1}/${index * 2 + 2}</option>`).join('');
      select.value = String(Math.min(engine.channelMap[bus] ?? 0, pairs - 1));
    });

    const sharing = engine.channelMap.main === engine.channelMap.cue;

    if (pairs < 2) {
      this.routingNote.textContent = 'This card has one pair of outputs, so the cue has nowhere of its own to go.';
    } else if (live < pairs) {
      this.routingNote.textContent = `${pairs} pairs on this card. Reload to reach them.`;
    } else if (sharing) {
      this.routingNote.textContent = 'The mix and the cue share a pair, so the headphones hear both.';
    } else {
      this.routingNote.textContent = `${pairs} pairs on this card.`;
    }
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
    // Handed over first so the routing wires against it: the saved settings are
    // the one copy of the map, and the engine only ever applies it
    window.audioEngine.useChannelMap(this.values.channelMap);
    const routing = window.audioEngine.setOutputRouting(this.values.outputRouting);

    // Every routing but the plain one carries a cue bus, whether it rides the
    // left channel or a pair of outputs of its own
    const cueAvailable = routing !== 'main';

    // Without the cue bus in the graph the pre-listen controls do nothing,
    // so hide them rather than leaving dead buttons on screen
    document.querySelectorAll('.cue-volume, .prelisten-btn').forEach(el => {
      el.hidden = !cueAvailable;
    });

    this.describeExternal();

    if (!cueAvailable) {
      ['A', 'B'].forEach(deckId => {
        const deck = window.audioEngine.getDeck(deckId);
        if (deck?.isPreListenEnabled) window.mixerController?.togglePreListen(deckId);
      });
    }
  }
}
