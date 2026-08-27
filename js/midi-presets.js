/**
 * The built-in controller setups.
 *
 * They live one JSON per controller under mappings/, named after the device,
 * and the build rolls that folder into the single file fetched here. Adding a
 * controller is dropping a file in — there is no index to keep in step, and the
 * id is the filename.
 *
 * Each file is the shape the Export button writes plus the strings to recognise
 * the device by, so a mapping somebody builds with MIDI learn can be sent back
 * as a setup without being rewritten.
 */
class MidiPresets {
  static NOTE = 'note';
  static CC = 'cc';

  static FILE = 'mappings.json';

  /** Always offered, always empty: the way in for a controller nobody has
   *  mapped yet. */
  static GENERIC = { id: 'generic', name: 'Generic MIDI', matches: [], bindings: {} };

  static catalogue = [MidiPresets.GENERIC];
  static loaded = null;

  /** Reads the file once; later calls get the same promise. */
  static load() {
    if (MidiPresets.loaded) return MidiPresets.loaded;

    MidiPresets.loaded = fetch(MidiPresets.FILE)
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

  /** The setup whose name the device answers to, if any. Called with nothing
   *  while the picker is being read with no controller plugged in. */
  static forDevice(deviceName) {
    const needle = (deviceName || '').toLowerCase();
    if (!needle) return null;

    return MidiPresets.catalogue.find(preset =>
      preset.matches?.some(match => needle.includes(match))) || null;
  }

  static bindings(id) {
    return MidiPresets.clean(MidiPresets.byId(id)?.bindings);
  }

  /**
   * Anything read off a file or out of a picker goes through here: a mapping is
   * data from outside, and one bad entry should cost one binding rather than
   * the whole setup.
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
        number: binding.number,
        // Only wheels carry one, and only the mapping knows which way they count
        ...(binding.encoding === 'offset' ? { encoding: 'offset' } : {})
      };
    }

    return clean;
  }
}

window.MidiPresets = MidiPresets;
