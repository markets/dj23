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

      // Flipped on purpose: a DJ pitch fader reads + at the bottom and − at
      // the top, the opposite of the number the hardware sends
      add('Pitch', `deck${deckId}.pitch`, `Deck ${deckId} · Pitch fader`, 'range',
        amount => slide(`pitch${deckId}`, 1 - amount));
      add('Pitch', `deck${deckId}.bendDown`, `Deck ${deckId} · Pitch bend −`, 'hold',
        () => deck(deckId)?.pitchBend(-1),
        () => deck(deckId)?.stopPitchBend());
      add('Pitch', `deck${deckId}.bendUp`, `Deck ${deckId} · Pitch bend +`, 'hold',
        () => deck(deckId)?.pitchBend(1),
        () => deck(deckId)?.stopPitchBend());
      add('Pitch', `deck${deckId}.jog`, `Deck ${deckId} · Jog (pitch bend)`, 'relative',
        delta => MidiActions.nudge(deckId, delta));
    }

    add('Mixer', 'mixer.crossfader', 'Crossfader', 'range', amount => slide('crossfader', amount));
    add('Mixer', 'mixer.master', 'Master volume', 'range', amount => slide('masterVolume', amount));
    add('Mixer', 'mixer.cue', 'Cue volume', 'range', amount => slide('cueVolume', amount));

    return actions;
  }

  /**
   * How hard a jog bends, per unit of turn, and how long it may sit still
   * before the bend is let go of.
   *
   * A wheel reports turns and never a release, so the release has to be
   * inferred: the bend holds while the wheel keeps talking and springs back
   * once it goes quiet.
   */
  static JOG_PERCENT_PER_STEP = 1.2;
  static JOG_RELEASE_MS = 140;

  static jogTimers = {};

  /** Bend by how hard the wheel was turned, so a nudge and a shove differ. */
  static nudge(deckId, delta) {
    const deck = window.audioEngine?.getDeck(deckId);
    if (!delta || !deck?.audioBuffer) return;

    const amount = Math.min(Deck.BEND_PERCENT, Math.abs(delta) * MidiActions.JOG_PERCENT_PER_STEP);
    deck.pitchBend(delta > 0 ? 1 : -1, amount);

    clearTimeout(MidiActions.jogTimers[deckId]);
    MidiActions.jogTimers[deckId] = setTimeout(() => deck.stopPitchBend(), MidiActions.JOG_RELEASE_MS);
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

window.MidiActions = MidiActions;
