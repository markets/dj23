/**
 * What a controller is allowed to do, and what the built-in setups send.
 *
 * Every action carries its own way of reaching the mixer. Continuous ones move
 * the real slider and let its `input` handler do the work, so the display and
 * the audio can never drift apart from what the hardware says.
 */
class MidiActions {
  /**
   * `button` fires on press, `hold` also needs the release, `range` is
   * continuous. The kind is what tells the engine how to read a message.
   */
  static ALL = MidiActions.build();

  static build() {
    const controller = deckId => window.mixerController?.deckControllers?.[deckId];
    const deck = deckId => window.audioEngine?.getDeck(deckId);
    const pads = deckId => controller(deckId)?.pads;

    /** Drive the control the user would have dragged, rather than the audio
     *  node behind it: one path, one set of side effects. */
    const slide = (id, amount) => {
      const el = document.getElementById(id);
      if (!el) return;

      const min = Number(el.min);
      const max = Number(el.max);
      el.value = min + amount * (max - min);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const knob = (deckId, band, amount) => {
      const eq = controller(deckId)?.eqKnobs?.find(k => k.band === band);
      eq?.set((amount * 2 - 1) * EqKnob.RANGE);
    };

    const actions = [];
    const add = (group, id, label, kind, run, release) =>
      actions.push({ group, id, label, kind, run, release });

    for (const deckId of ['A', 'B']) {
      add('Transport', `deck${deckId}.playPause`, `Deck ${deckId} · Play / Pause`, 'button', () => {
        const target = controller(deckId);
        deck(deckId)?.isPlaying ? target?.pause() : target?.play();
      });
      add('Transport', `deck${deckId}.cue`, `Deck ${deckId} · Cue`, 'hold',
        () => deck(deckId)?.startCueMode(),
        () => deck(deckId)?.stopCueMode());
      // SYNC A is the button that pulls deck A onto deck B, so the deck it
      // belongs to is the one it moves
      add('Transport', `deck${deckId}.sync`, `Deck ${deckId} · Sync`, 'button',
        () => document.getElementById(deckId === 'A' ? 'syncAB' : 'syncBA')?.click());

      for (const number of [1, 2, 3, 4]) {
        add('Hot cues', `deck${deckId}.cue${number}`, `Deck ${deckId} · Cue ${number}`, 'button',
          () => pads(deckId)?.handleCue(number, MidiActions.isClearing(deckId)));
      }
      // Held rather than pressed: it turns the four pads into erasers while it
      // is down, which is the same bargain as shift-clicking them
      add('Hot cues', `deck${deckId}.clearCue`, `Deck ${deckId} · Clear cue (hold)`, 'hold',
        () => MidiActions.clearing.add(deckId),
        () => MidiActions.clearing.delete(deckId));

      add('Loops', `deck${deckId}.loop4`, `Deck ${deckId} · Loop 4 beats`, 'button',
        () => pads(deckId)?.pressLength(4));
      add('Loops', `deck${deckId}.loopHalve`, `Deck ${deckId} · Halve loop`, 'button',
        () => pads(deckId)?.resize(0.5));
      add('Loops', `deck${deckId}.loopDouble`, `Deck ${deckId} · Double loop`, 'button',
        () => pads(deckId)?.resize(2));
      add('Loops', `deck${deckId}.loopExit`, `Deck ${deckId} · Exit loop`, 'button',
        () => pads(deckId)?.stopLoop());

      add('Mixer', `deck${deckId}.volume`, `Deck ${deckId} · Volume`, 'range',
        amount => slide(`volume${deckId}`, amount));
      add('Mixer', `deck${deckId}.preListen`, `Deck ${deckId} · Pre-listen`, 'button',
        () => window.mixerController?.togglePreListen(deckId));

      for (const band of EqKnob.BANDS) {
        const name = band.charAt(0).toUpperCase() + band.slice(1);
        add('EQ', `deck${deckId}.eq.${band}`, `Deck ${deckId} · ${name}`, 'range',
          amount => knob(deckId, band, amount));
      }

      add('Pitch', `deck${deckId}.pitch`, `Deck ${deckId} · Pitch fader`, 'range',
        amount => slide(`pitch${deckId}`, amount));
      add('Pitch', `deck${deckId}.bendDown`, `Deck ${deckId} · Pitch bend −`, 'hold',
        () => deck(deckId)?.pitchBend(-1),
        () => deck(deckId)?.stopPitchBend());
      add('Pitch', `deck${deckId}.bendUp`, `Deck ${deckId} · Pitch bend +`, 'hold',
        () => deck(deckId)?.pitchBend(1),
        () => deck(deckId)?.stopPitchBend());
    }

    add('Mixer', 'mixer.crossfader', 'Crossfader', 'range', amount => slide('crossfader', amount));
    add('Mixer', 'mixer.master', 'Master volume', 'range', amount => slide('masterVolume', amount));
    add('Mixer', 'mixer.cue', 'Cue volume', 'range', amount => slide('cueVolume', amount));

    return actions;
  }

  /** Decks whose clear button is being held right now. */
  static clearing = new Set();

  static isClearing(deckId) {
    return MidiActions.clearing.has(deckId);
  }

  static byId(id) {
    return MidiActions.ALL.find(action => action.id === id);
  }

  /** Action ids in display order, grouped the way the mixer is laid out. */
  static groups() {
    const groups = new Map();

    for (const action of MidiActions.ALL) {
      if (!groups.has(action.group)) groups.set(action.group, []);
      groups.get(action.group).push(action);
    }

    return groups;
  }
}

/**
 * Built-in setups.
 *
 * The Mixtrack Pro numbers are translated from the Mixxx project's mapping for
 * that controller, which is where they were verified against real hardware:
 * https://github.com/mixxxdj/mixxx/blob/main/res/controllers/Numark%20Mixtrack%20Pro.midi.xml
 *
 * Note the channel: this controller puts everything on channel 1 and tells the
 * decks apart by number, so a mapping cannot assume deck equals channel.
 */
class MidiPresets {
  static NOTE = 'note';
  static CC = 'cc';

  static note = number => ({ type: MidiPresets.NOTE, channel: 1, number });
  static cc = number => ({ type: MidiPresets.CC, channel: 1, number });

  /** Matched against the device name Web MIDI reports, lowercased. */
  static ALL = [
    {
      id: 'numark-mixtrack-pro',
      name: 'Numark Mixtrack Pro',
      matches: ['mixtrack pro', 'mix track pro'],
      verified: true,
      source: 'Mixxx',
      bindings: {
        'deckA.playPause': MidiPresets.note(59),
        'deckA.cue': MidiPresets.note(51),
        'deckA.sync': MidiPresets.note(64),
        'deckA.cue1': MidiPresets.note(90),
        'deckA.cue2': MidiPresets.note(91),
        'deckA.cue3': MidiPresets.note(92),
        'deckA.clearCue': MidiPresets.note(89),
        'deckA.loop4': MidiPresets.note(85),
        'deckA.loopHalve': MidiPresets.note(83),
        'deckA.loopDouble': MidiPresets.note(84),
        'deckA.loopExit': MidiPresets.note(97),
        'deckA.volume': MidiPresets.cc(8),
        'deckA.preListen': MidiPresets.note(101),
        'deckA.eq.high': MidiPresets.cc(16),
        'deckA.eq.mid': MidiPresets.cc(18),
        'deckA.eq.low': MidiPresets.cc(20),
        'deckA.eq.gain': MidiPresets.cc(29),
        'deckA.pitch': MidiPresets.cc(13),
        'deckA.bendDown': MidiPresets.note(67),
        'deckA.bendUp': MidiPresets.note(68),

        'deckB.playPause': MidiPresets.note(66),
        'deckB.cue': MidiPresets.note(60),
        'deckB.sync': MidiPresets.note(71),
        'deckB.cue1': MidiPresets.note(94),
        'deckB.cue2': MidiPresets.note(95),
        'deckB.cue3': MidiPresets.note(96),
        'deckB.clearCue': MidiPresets.note(93),
        'deckB.loop4': MidiPresets.note(88),
        'deckB.loopHalve': MidiPresets.note(86),
        'deckB.loopDouble': MidiPresets.note(87),
        'deckB.loopExit': MidiPresets.note(98),
        'deckB.volume': MidiPresets.cc(9),
        'deckB.preListen': MidiPresets.note(102),
        'deckB.eq.high': MidiPresets.cc(17),
        'deckB.eq.mid': MidiPresets.cc(19),
        'deckB.eq.low': MidiPresets.cc(21),
        'deckB.eq.gain': MidiPresets.cc(32),
        'deckB.pitch': MidiPresets.cc(14),
        'deckB.bendDown': MidiPresets.note(69),
        'deckB.bendUp': MidiPresets.note(70),

        'mixer.crossfader': MidiPresets.cc(10),
        'mixer.master': MidiPresets.cc(23),
        'mixer.cue': MidiPresets.cc(11)
      }
    },
    {
      id: 'generic',
      name: 'Generic MIDI',
      matches: [],
      bindings: {}
    }
  ];

  static byId(id) {
    return MidiPresets.ALL.find(preset => preset.id === id);
  }

  /** The setup whose name the device answers to, if any. */
  static forDevice(deviceName = '') {
    const needle = deviceName.toLowerCase();
    return MidiPresets.ALL.find(preset => preset.matches.some(match => needle.includes(match))) || null;
  }
}

window.MidiActions = MidiActions;
window.MidiPresets = MidiPresets;
