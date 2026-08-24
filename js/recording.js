/**
 * The record button in the header, and the take it leaves behind.
 *
 * One control, four states, always the same size: REC → the running timer →
 * the finished take, waiting to be saved → SAVED. Nothing in the header moves
 * while a mix is running, and no take is ever thrown away without being asked for.
 */
class Recording {
  /** A stop this soon after starting is a mis-click, not a take. */
  static MIN_TAKE_SECONDS = 5;

  /** How long SAVED stays up before the control offers to record again. */
  static SAVED_SECONDS = 2;

  /** Grace period on the discard question before it forgets it asked. */
  static ASK_SECONDS = 3;

  static UNAVAILABLE_HINT = 'Load a track first — there is nothing to record yet';

  constructor() {
    this.control = null;
    this.phase = 'idle'; // idle | recording | done | saved
    this.seconds = 0;
    this.takeSeconds = 0;
    this.blob = null;
    this.isAsking = false;

    this.tickTimer = null;
    this.askTimer = null;
    this.savedTimer = null;

    document.addEventListener('DOMContentLoaded', () => this.initialize());
  }

  initialize() {
    this.control = document.getElementById('recControl');
    if (!this.control) return;

    this.control.addEventListener('click', (e) => this.handleClick(e));
    this.render();
  }

  // --- state ----------------------------------------------------------------

  handleClick(e) {
    if (e.target.closest('.rec-drop')) {
      this.handleDiscard();
      return;
    }

    if (e.target.closest('.rec-save')) {
      this.save();
      return;
    }

    if (!e.target.closest('.rec-slot')) return;

    if (this.phase === 'recording') this.stop();
    else if (this.phase === 'idle') this.start();
  }

  start() {
    if (!window.audioEngine?.isInitialized) {
      this.render();
      return;
    }

    if (!window.audioEngine.startRecording()) {
      console.error('Recording: the engine refused to start');
      return;
    }

    this.phase = 'recording';
    this.seconds = 0;
    this.render();

    // Polled four times a second but only drawn when the digit changes, so the
    // clock never sits a whole second behind what has actually been captured
    this.tickTimer = setInterval(() => this.tick(), 250);
  }

  async stop() {
    clearInterval(this.tickTimer);
    this.tickTimer = null;

    this.takeSeconds = window.audioEngine.getRecordingDuration();
    const blob = await window.audioEngine.stopRecording();

    if (this.takeSeconds < Recording.MIN_TAKE_SECONDS) {
      console.log(`Recording: ${this.takeSeconds}s discarded as a mis-click`);
      this.reset();
      return;
    }

    this.blob = blob;
    this.phase = 'done';
    this.render();
  }

  save() {
    if (!this.blob) return;

    const url = URL.createObjectURL(this.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = this.filename();
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log(`Recording: saved ${link.download}, ${(this.blob.size / 1048576).toFixed(1)} MB`);

    this.blob = null;
    this.phase = 'saved';
    this.render();

    this.savedTimer = setTimeout(() => this.reset(), Recording.SAVED_SECONDS * 1000);
  }

  /** Two presses, asked inside the button. A modal dialog in the middle of a
   *  mix is worse than the mistake it prevents. */
  handleDiscard() {
    if (!this.isAsking) {
      this.isAsking = true;
      this.render();
      this.askTimer = setTimeout(() => {
        this.isAsking = false;
        this.render();
      }, Recording.ASK_SECONDS * 1000);
      return;
    }

    clearTimeout(this.askTimer);
    console.log('Recording: take discarded');
    this.reset();
  }

  reset() {
    clearInterval(this.tickTimer);
    clearTimeout(this.askTimer);
    clearTimeout(this.savedTimer);
    this.tickTimer = this.askTimer = this.savedTimer = null;

    this.phase = 'idle';
    this.isAsking = false;
    this.blob = null;
    this.seconds = 0;
    this.render();
  }

  tick() {
    const seconds = window.audioEngine.getRecordingDuration();
    if (seconds === this.seconds) return;

    this.seconds = seconds;
    this.render();
  }

  // --- rendering ------------------------------------------------------------

  formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  filename() {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}-${pad(now.getMinutes())}`;

    return `dj23_${date}_${time}.webm`;
  }

  render() {
    const isAvailable = !!window.audioEngine?.isInitialized;

    this.control.className = 'rec-control';
    this.control.classList.toggle('is-unavailable', !isAvailable && this.phase === 'idle');
    this.control.classList.toggle('is-asking', this.isAsking);
    this.control.title = isAvailable ? '' : Recording.UNAVAILABLE_HINT;

    if (this.phase === 'recording') {
      this.control.classList.add('is-recording');
      this.control.innerHTML =
        `<button type="button" class="rec-slot" title="Stop recording">
          <span class="rec-dot"></span><span class="rec-time">${this.formatTime(this.seconds)}</span>
        </button>`;
      return;
    }

    if (this.phase === 'done') {
      this.control.classList.add('is-done');
      this.control.innerHTML =
        `<button type="button" class="rec-slot rec-save" title="Download this recording">
          ⬇ ${this.formatTime(this.takeSeconds)}
        </button>
        <button type="button" class="rec-slot rec-drop${this.isAsking ? ' is-asking' : ''}"
                title="Discard this recording">${this.isAsking ? 'SURE?' : '✕'}</button>`;
      return;
    }

    if (this.phase === 'saved') {
      this.control.classList.add('is-saved');
      this.control.innerHTML = `<button type="button" class="rec-slot">SAVED</button>`;
      return;
    }

    this.control.innerHTML =
      `<button type="button" class="rec-slot" title="Start recording">
        <span class="rec-dot"></span><span>REC</span>
      </button>`;
  }

  /** The blob lives only in memory, so a take still waiting to be saved dies
   *  with the tab — main.js turns this into a warning on the way out. */
  hasUnsavedTake() {
    return this.phase === 'done' && !!this.blob;
  }
}

window.recordingController = new Recording();
