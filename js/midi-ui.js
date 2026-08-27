/**
 * The MIDI modal: what is plugged in, which setup it uses, and the mapping
 * table with its learn buttons.
 *
 * It owns no state of its own beyond which device is being edited — everything
 * else is read back from MidiController on every render, so a controller
 * appearing or a message arriving redraws the same way a click does.
 */
class MidiPanel {
  static TABS = ['devices', 'presets', 'mapping'];

  constructor() {
    this.modal = null;
    this.deviceName = null;
    this.tab = 'devices';
    this.filter = '';
    this.notice = null;

    document.addEventListener('DOMContentLoaded', () => this.initialize());
  }

  get midi() {
    return window.midiController;
  }

  initialize() {
    this.modal = document.getElementById('midiModal');
    if (!this.modal) return;

    this.summary = document.getElementById('midiSummary');
    this.body = this.modal.querySelector('[data-midi-body]');
    this.fileInput = document.getElementById('midiImportInput');

    this.setupEventListeners();
    this.midi.onChange(() => this.render());
    this.renderSummary();
  }

  setupEventListeners() {
    this.summary?.addEventListener('click', () => this.open());

    // Opening settings is enough of an intent to look: with the permission
    // already given this is silent, and the summary stops needing a click of
    // its own before it knows what is plugged in
    document.getElementById('settingsBtn')?.addEventListener('click', () => this.warmUp());
    document.getElementById('midiClose')?.addEventListener('click', () => this.close());

    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) return this.close();
      this.handleClick(e);
    });

    this.modal.addEventListener('input', (e) => {
      if (!e.target.matches('[data-midi-search]')) return;
      this.filter = e.target.value;
      this.render();
    });

    this.fileInput?.addEventListener('change', (e) => this.importFile(e.target.files[0]));
  }

  /** Connects only if the browser says the permission is already granted, so
   *  no prompt can appear from merely opening a menu. */
  async warmUp() {
    if (this.midi.isConnected || !this.midi.isSupported) return;

    try {
      const permission = await navigator.permissions.query({ name: 'midi' });
      if (permission.state !== 'granted') return;
    } catch (error) {
      return;   // browsers that cannot be asked are left to the modal
    }

    await this.midi.connect();
    this.pickDevice();
    this.renderSummary();
  }

  // --- open / close ---------------------------------------------------------

  async open() {
    this.modal.classList.add('show');
    document.body.style.overflow = 'hidden';
    this.render();

    // The setups are worth reading with nothing plugged in, so the catalogue
    // does not wait on the permission prompt
    await MidiPresets.load();
    this.render();

    // Asked for here, with the panel already open, so the prompt arrives when
    // the reason for it is on screen
    await this.midi.connect();
    this.pickDevice();
    this.render();
  }

  close() {
    this.midi.cancelLearn();
    this.modal.classList.remove('show');
    document.body.style.overflow = 'auto';
    this.renderSummary();
  }

  pickDevice() {
    const devices = this.midi.list();
    if (this.deviceName && devices.some(d => d.name === this.deviceName)) return;

    this.deviceName = (devices.find(d => d.connected) || devices[0])?.name || null;
  }

  handleClick(e) {
    const tab = e.target.closest('[data-midi-tab]');
    if (tab) {
      this.midi.cancelLearn();
      this.tab = tab.dataset.midiTab;
      return this.render();
    }

    const pick = e.target.closest('[data-midi-device]');
    if (pick) {
      this.deviceName = pick.dataset.midiDevice;
      this.tab = pick.dataset.midiGoto || this.tab;
      return this.render();
    }

    const forget = e.target.closest('[data-midi-forget]');
    if (forget) return this.midi.forget(forget.dataset.midiForget);

    const preset = e.target.closest('[data-midi-preset]');
    if (preset) {
      this.tab = 'mapping';
      return this.midi.applyPreset(this.deviceName, preset.dataset.midiPreset);
    }

    const learn = e.target.closest('[data-midi-learn]');
    if (learn) {
      const actionId = learn.dataset.midiLearn;
      const isLearning = this.midi.learning?.actionId === actionId;
      isLearning ? this.midi.cancelLearn() : this.midi.startLearn(this.deviceName, actionId);
      return;
    }

    const clear = e.target.closest('[data-midi-clear]');
    if (clear) return this.midi.unbind(this.deviceName, clear.dataset.midiClear);

    if (e.target.closest('[data-midi-export]')) return this.exportFile();
    if (e.target.closest('[data-midi-import]')) return this.fileInput?.click();
  }

  // --- import / export ------------------------------------------------------

  exportFile() {
    if (!this.deviceName) return;

    const payload = JSON.stringify(this.midi.export(this.deviceName), null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const link = document.createElement('a');

    link.href = url;
    link.download = `dj23_midi_${this.deviceName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async importFile(file) {
    if (!file || !this.deviceName) return;

    try {
      this.notice = this.midi.import(this.deviceName, JSON.parse(await file.text()));
    } catch (error) {
      this.notice = 'That file could not be read as JSON.';
      console.warn('MIDI: import failed:', error);
    }

    this.fileInput.value = '';
    this.tab = 'mapping';
    this.render();
  }

  // --- rendering ------------------------------------------------------------

  /** The line in the settings menu, which is all most people ever see. */
  renderSummary() {
    if (!this.summary) return;

    const devices = this.midi.list();
    const live = devices.find(d => d.connected);
    const name = this.summary.querySelector('[data-midi-name]');
    const note = this.summary.querySelector('[data-midi-note]');

    this.summary.querySelector('.midi-dot').classList.toggle('is-live', !!live);

    if (!this.midi.isSupported) {
      name.textContent = 'Not available';
      note.textContent = 'This browser has no Web MIDI support';
      return;
    }

    if (!live) {
      name.textContent = 'No controller';
      note.textContent = devices.length ? 'Nothing connected right now' : 'Connect one to get started';
      return;
    }

    name.textContent = live.name;
    note.textContent = `${live.mapped} control${live.mapped === 1 ? '' : 's'} mapped`;
  }

  render() {
    if (!this.modal.classList.contains('show')) return;

    this.modal.querySelectorAll('[data-midi-tab]').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.midiTab === this.tab);
    });

    this.body.innerHTML =
      (this.notice ? `<p class="midi-notice">${this.notice}</p>` : '') +
      (this.midi.error ? `<p class="midi-notice">${this.midi.error}</p>` : '') +
      (this.tab === 'devices' ? this.renderDevices() : '') +
      (this.tab === 'presets' ? this.renderPresets() : '') +
      (this.tab === 'mapping' ? this.renderMapping() : '');

    this.notice = null;
    this.renderSummary();
  }

  renderDevices() {
    const devices = this.midi.list();
    if (!devices.length) {
      return `<p class="midi-empty">Nothing found. Plug a controller in — it shows up here on its own.</p>`;
    }

    return devices.map(device => `
      <div class="midi-device${device.connected ? '' : ' is-offline'}">
        <span class="midi-dot${device.connected ? ' is-live' : ''}"></span>
        <span class="midi-device-text">
          <span class="midi-device-name">${device.name}</span>
          <span class="midi-device-note">
            ${device.connected ? 'Connected' : 'Not connected'} ·
            ${device.mapped ? `${device.mapped} controls mapped` : 'no setup yet'}
          </span>
        </span>
        <button type="button" class="midi-btn" data-midi-device="${device.name}" data-midi-goto="presets">Change setup</button>
        <button type="button" class="midi-btn is-primary" data-midi-device="${device.name}" data-midi-goto="mapping">Edit mapping</button>
        <button type="button" class="midi-btn" data-midi-forget="${device.name}">Forget</button>
      </div>`).join('');
  }

  renderPresets() {
    const needle = this.filter.trim().toLowerCase();
    const matched = MidiPresets.forDevice(this.deviceName);
    const presets = MidiPresets.ALL.filter(p => p.name.toLowerCase().includes(needle));

    const rows = presets.map(preset => `
      <button type="button" class="midi-preset${preset.id === matched?.id ? ' is-match' : ''}"
              data-midi-preset="${preset.id}"${this.deviceName ? '' : ' disabled'}>
        <span class="midi-preset-name">${preset.name}</span>
        ${preset.id === matched?.id ? '<span class="midi-preset-tag is-verified">DETECTED</span>' : ''}
      </button>`).join('');

    return `
      <input class="midi-search" type="search" placeholder="Search controllers…"
             value="${this.filter}" data-midi-search>
      <div class="midi-presets">${rows || '<p class="midi-empty">Nothing matches. Pick Generic MIDI and learn it.</p>'}</div>
      ${this.deviceName ? '' : '<p class="midi-empty">Connect a controller to load one of these.</p>'}`;
  }

  renderMapping() {
    if (!this.deviceName) return `<p class="midi-empty">Connect a controller first.</p>`;

    const mapping = this.midi.mappingFor(this.deviceName);
    const learningId = this.midi.learning?.actionId;

    let html = '';
    for (const [group, actions] of MidiActions.groups()) {
      html += `<div class="midi-group-label">${group}</div>`;
      html += actions.map(action => {
        const binding = mapping[action.id];
        const isLearning = action.id === learningId;
        const label = isLearning ? 'move a control…' : MidiPanel.describe(binding);

        return `
          <div class="midi-map-row${isLearning ? ' is-learning' : ''}">
            <span class="midi-map-name">${action.label}</span>
            <span class="midi-map-msg${binding ? '' : ' is-empty'}${isLearning ? ' is-listening' : ''}">${label}</span>
            <button type="button" class="midi-learn${isLearning ? ' is-learning' : ''}"
                    data-midi-learn="${action.id}">${isLearning ? 'CANCEL' : 'LEARN'}</button>
            <button type="button" class="midi-clear" title="Clear" data-midi-clear="${action.id}">✕</button>
          </div>`;
      }).join('');
    }

    return html;
  }

  static describe(binding) {
    if (!binding) return 'unassigned';

    const kind = binding.type === MidiPresets.CC ? 'CC' : 'Note';
    // The channel is only worth the space when it is not the usual one
    const channel = binding.channel === 1 ? '' : `Ch${binding.channel} · `;

    return `${channel}${kind} ${binding.number}`;
  }
}

window.midiPanel = new MidiPanel();
