/**
 * The catalogue of built-in controller mappings, which live as JSON under
 * mappings/.
 *
 * Adding a controller means dropping a file in there and adding a line to
 * mappings/index.json — no code. The files are the same shape the Export button
 * writes, so one downloaded from the repo can be imported as-is, and one a user
 * exports can be sent back to it.
 *
 * The index carries only what the picker needs to draw itself; the bindings are
 * fetched when a setup is actually chosen, so a catalogue of fifty controllers
 * still costs one small request at startup.
 */
class MidiPresets {
  static NOTE = 'note';
  static CC = 'cc';

  static FOLDER = 'mappings';
  static INDEX = `${MidiPresets.FOLDER}/index.json`;

  /** Always offered, always empty: the way in for a controller nobody has
   *  mapped yet. */
  static GENERIC = { id: 'generic', name: 'Generic MIDI', matches: [], bindings: {} };

  static catalogue = [MidiPresets.GENERIC];
  static bindingsById = new Map([['generic', {}]]);
  static loaded = null;

  /** Reads the index once; later calls get the same promise. */
  static load() {
    if (MidiPresets.loaded) return MidiPresets.loaded;

    MidiPresets.loaded = fetch(MidiPresets.INDEX)
      .then(response => response.ok ? response.json() : Promise.reject(response.status))
      .then(entries => {
        MidiPresets.catalogue = [...entries, MidiPresets.GENERIC];
        console.log(`MIDI: ${entries.length} built-in setup${entries.length === 1 ? '' : 's'}`);
      })
      .catch(error => {
        console.warn('MIDI: could not read the mapping catalogue:', error);
      });

    return MidiPresets.loaded;
  }

  static get ALL() {
    return MidiPresets.catalogue;
  }

  static byId(id) {
    return MidiPresets.catalogue.find(preset => preset.id === id) || null;
  }

  /** The setup whose name the device answers to, if any. */
  static forDevice(deviceName = '') {
    const needle = deviceName.toLowerCase();

    return MidiPresets.catalogue.find(preset =>
      preset.matches?.some(match => needle.includes(match))) || null;
  }

  /** Bindings for a setup, fetched the first time they are asked for. */
  static async bindings(id) {
    if (MidiPresets.bindingsById.has(id)) return MidiPresets.bindingsById.get(id);

    const preset = MidiPresets.byId(id);
    if (!preset?.file) return {};

    try {
      const response = await fetch(`${MidiPresets.FOLDER}/${preset.file}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const bindings = MidiPresets.clean((await response.json()).bindings);
      MidiPresets.bindingsById.set(id, bindings);
      return bindings;
    } catch (error) {
      console.warn(`MIDI: could not read ${preset.file}:`, error);
      return {};
    }
  }

  /**
   * Anything read off disk or out of a file picker goes through here: a
   * mapping is data from outside, and one bad entry should cost one binding
   * rather than the whole setup.
   */
  static clean(bindings) {
    const clean = {};
    if (!bindings || typeof bindings !== 'object') return clean;

    for (const [actionId, binding] of Object.entries(bindings)) {
      if (!MidiActions.byId(actionId)) continue;               // an action this version dropped
      if (!binding || typeof binding.number !== 'number') continue;

      clean[actionId] = {
        type: binding.type === MidiPresets.CC ? MidiPresets.CC : MidiPresets.NOTE,
        channel: Number(binding.channel) || 1,
        number: binding.number
      };
    }

    return clean;
  }
}

window.MidiPresets = MidiPresets;
