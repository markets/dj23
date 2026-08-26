/**
 * Web MIDI: the devices, what each one is mapped to, and the routing in
 * between.
 *
 * A mapping belongs to a device, keyed by the name Web MIDI reports, so
 * plugging a second controller in never overwrites the first one's work.
 * Nothing here draws anything — the modal in js/midi-ui.js listens instead.
 */
class MidiController {
  static STORAGE_KEY = 'dj23.midi';

  /** A note-on with no push behind it is how most controllers say note-off. */
  static NOTE_ON = 0x90;
  static NOTE_OFF = 0x80;
  static CONTROL_CHANGE = 0xb0;

  /** Messages worth showing in the monitor before it starts repeating itself. */
  static MONITOR_KEEP = 1;

  constructor() {
    this.access = null;
    this.devices = new Map();     // name -> { input, connected }
    this.mappings = this.read();  // name -> { actionId: binding }
    this.routes = new Map();      // name -> Map('cc:1:16' -> actionId)
    this.learning = null;         // { device, actionId }
    this.lastMessage = null;
    this.listeners = new Set();
    this.error = null;
  }

  get isSupported() {
    return typeof navigator.requestMIDIAccess === 'function';
  }

  get isConnected() {
    return !!this.access;
  }

  /** Devices the app has ever mapped, whether or not they are plugged in now. */
  list() {
    const names = new Set([...this.devices.keys(), ...Object.keys(this.mappings)]);

    return [...names].map(name => ({
      name,
      connected: !!this.devices.get(name)?.connected,
      preset: MidiPresets.forDevice(name),
      mapped: Object.keys(this.mappings[name] || {}).length
    }));
  }

  // --- access ---------------------------------------------------------------

  /**
   * Asked for on the way into the panel rather than at startup: a permission
   * prompt nobody went looking for is a permission that gets denied.
   */
  async connect() {
    if (this.access) return true;

    if (!this.isSupported) {
      this.error = 'This browser has no Web MIDI support.';
      this.announce();
      return false;
    }

    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (error) {
      this.error = 'Permission denied, so no controller can be read.';
      console.warn('MIDI: access refused:', error);
      this.announce();
      return false;
    }

    this.error = null;
    this.access.onstatechange = () => this.collect();
    this.collect();

    return true;
  }

  /** Rebuilt on every state change, so unplugging is just another sweep. */
  collect() {
    const seen = new Set();

    for (const input of this.access.inputs.values()) {
      const name = input.name || 'Unnamed device';
      seen.add(name);

      const known = this.devices.get(name);
      if (known?.input === input) {
        known.connected = input.state === 'connected';
        continue;
      }

      input.onmidimessage = event => this.handleMessage(name, event);
      this.devices.set(name, { input, connected: input.state === 'connected' });

      // A controller with a setup of its own arrives ready to play
      if (!this.mappings[name]) {
        const preset = MidiPresets.forDevice(name);
        if (preset) this.applyPreset(name, preset.id, { quiet: true });
      }
      console.log(`MIDI: ${name} connected`);
    }

    for (const [name, device] of this.devices) {
      if (!seen.has(name)) device.connected = false;
    }

    this.rebuildRoutes();
    this.announce();
  }

  // --- mappings -------------------------------------------------------------

  read() {
    try {
      return JSON.parse(localStorage.getItem(MidiController.STORAGE_KEY)) || {};
    } catch (error) {
      console.warn('MIDI: could not read saved mappings:', error);
      return {};
    }
  }

  write() {
    try {
      localStorage.setItem(MidiController.STORAGE_KEY, JSON.stringify(this.mappings));
    } catch (error) {
      console.warn('MIDI: could not save mappings:', error);
    }
  }

  mappingFor(deviceName) {
    return this.mappings[deviceName] || {};
  }

  applyPreset(deviceName, presetId, { quiet = false } = {}) {
    const preset = MidiPresets.byId(presetId);
    if (!preset) return;

    this.mappings[deviceName] = { ...preset.bindings };
    this.write();
    this.rebuildRoutes();
    if (!quiet) this.announce();

    console.log(`MIDI: ${deviceName} set up as ${preset.name}`);
  }

  bind(deviceName, actionId, binding) {
    const mapping = { ...this.mappingFor(deviceName) };

    // One message drives one action: leaving the old owner in place would make
    // a single knob fire two things at once
    for (const [id, existing] of Object.entries(mapping)) {
      if (MidiController.key(existing) === MidiController.key(binding)) delete mapping[id];
    }

    mapping[actionId] = binding;
    this.mappings[deviceName] = mapping;
    this.write();
    this.rebuildRoutes();
    this.announce();
  }

  unbind(deviceName, actionId) {
    const mapping = { ...this.mappingFor(deviceName) };
    delete mapping[actionId];

    this.mappings[deviceName] = mapping;
    this.write();
    this.rebuildRoutes();
    this.announce();
  }

  forget(deviceName) {
    delete this.mappings[deviceName];
    this.devices.delete(deviceName);
    this.write();
    this.rebuildRoutes();
    this.announce();
  }

  static key(binding) {
    return `${binding.type}:${binding.channel}:${binding.number}`;
  }

  rebuildRoutes() {
    this.routes.clear();

    for (const [name, mapping] of Object.entries(this.mappings)) {
      const routes = new Map();
      for (const [actionId, binding] of Object.entries(mapping)) {
        routes.set(MidiController.key(binding), actionId);
      }
      this.routes.set(name, routes);
    }
  }

  // --- incoming -------------------------------------------------------------

  handleMessage(deviceName, event) {
    const [status, number, value] = event.data;
    const command = status & 0xf0;
    const channel = (status & 0x0f) + 1;

    let type = null;
    if (command === MidiController.CONTROL_CHANGE) type = MidiPresets.CC;
    else if (command === MidiController.NOTE_ON || command === MidiController.NOTE_OFF) type = MidiPresets.NOTE;
    if (!type) return;

    const isRelease = command === MidiController.NOTE_OFF ||
      (command === MidiController.NOTE_ON && value === 0);

    this.lastMessage = { deviceName, type, channel, number, value };

    if (this.learning) return this.captureLearn(deviceName, { type, channel, number }, isRelease);

    const actionId = this.routes.get(deviceName)?.get(MidiController.key({ type, channel, number }));
    if (!actionId) return this.announce();

    this.fire(actionId, value, isRelease);
    this.announce();
  }

  fire(actionId, value, isRelease) {
    const action = MidiActions.byId(actionId);
    if (!action) return;

    if (action.kind === 'range') return action.run(value / 127);

    // A hold needs both edges; everything else only cares about the press
    if (action.kind === 'hold') {
      isRelease ? action.release?.() : action.run();
      return;
    }

    if (!isRelease) action.run();
  }

  // --- learn ----------------------------------------------------------------

  startLearn(deviceName, actionId) {
    this.learning = { deviceName, actionId };
    this.announce();
  }

  cancelLearn() {
    this.learning = null;
    this.announce();
  }

  /**
   * A release is not an assignment: buttons send a press and a release, and
   * binding the release would leave the action firing on the way up.
   */
  captureLearn(deviceName, binding, isRelease) {
    if (isRelease) return this.announce();
    if (this.learning.deviceName !== deviceName) return this.announce();

    const { actionId } = this.learning;
    this.learning = null;
    this.bind(deviceName, actionId, binding);

    console.log(`MIDI: ${actionId} ← ${MidiController.key(binding)}`);
  }

  // --- import / export ------------------------------------------------------

  export(deviceName) {
    return {
      app: 'dj23',
      kind: 'midi-mapping',
      device: deviceName,
      bindings: this.mappingFor(deviceName)
    };
  }

  /** Returns what went wrong, or null when the file was taken. */
  import(deviceName, payload) {
    if (!payload || payload.kind !== 'midi-mapping' || typeof payload.bindings !== 'object') {
      return 'That file is not a DJ23 mapping.';
    }

    const bindings = {};
    for (const [actionId, binding] of Object.entries(payload.bindings)) {
      if (!MidiActions.byId(actionId)) continue;               // an action we dropped
      if (!binding || typeof binding.number !== 'number') continue;
      bindings[actionId] = {
        type: binding.type === MidiPresets.CC ? MidiPresets.CC : MidiPresets.NOTE,
        channel: Number(binding.channel) || 1,
        number: binding.number
      };
    }

    if (!Object.keys(bindings).length) return 'That mapping has nothing this version understands.';

    this.mappings[deviceName] = bindings;
    this.write();
    this.rebuildRoutes();
    this.announce();

    return null;
  }

  // --- listeners ------------------------------------------------------------

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  announce() {
    this.listeners.forEach(listener => listener(this));
  }
}

window.midiController = new MidiController();
