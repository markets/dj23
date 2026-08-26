class AudioEngine {
  /**
   * 'main' sends the full stereo mix to the output. 'cue-split' puts the cue
   * bus on the left channel and the main mix on the right, which is how you
   * pre-listen through one headphone without a second sound card. 'split-4'
   * is for an interface with four outputs — a DJ controller with its own sound
   * card, typically — and gives the mix its own stereo pair and the cue
   * another, so the headphones hear the cue in full.
   */
  static ROUTINGS = ['main', 'cue-split', 'split-4'];
  static DEFAULT_ROUTING = 'main';

  /** Stereo, and generous enough that a mix survives the one encode it gets. */
  static RECORDING_BITRATE = 192;

  constructor() {
    this.audioContext = null;
    this.masterGain = null;
    this.decks = {
      A: null,
      B: null
    };
    this.isInitialized = false;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.isRecording = false;
    this.recordingStartTime = null;
    this.recorderNode = null;
    this.recorderSink = null;
    this.mp3Worker = null;
    this.recordedFrames = 0;
    this.outputRouting = AudioEngine.DEFAULT_ROUTING;
  }

  /**
   * `sinkId` names the sound card to open against, and it has to be given here
   * rather than switched later: how many outputs a card offers is read when the
   * context is built, so one asked for afterwards still only ever admits to two.
   */
  async initialize(sinkId = '') {
    if (this.isInitialized) return;

    try {
      const sink = await AudioEngine.resolveSink(sinkId);
      this.audioContext = AudioEngine.createContext(sink);
      this.sinkId = sink;

      this.channelMerger = this.audioContext.createChannelMerger(2);

      // Four-output kit: the mix keeps 1/2 and the cue gets 3/4, which needs
      // both buses broken back out into left and right first
      this.splitMerger = this.audioContext.createChannelMerger(4);
      this.masterSplitter = this.audioContext.createChannelSplitter(2);
      this.cueSplitter = this.audioContext.createChannelSplitter(2);

      this.cueGain = this.audioContext.createGain();
      this.masterGain = this.audioContext.createGain();

      this.cueGain.gain.value = 0.5;
      this.masterGain.gain.value = 0.75;

      this.mediaStreamDestination = this.audioContext.createMediaStreamDestination();

      this.setOutputRouting(this.outputRouting);

      this.decks.A = new Deck(this.audioContext, this.masterGain, this.cueGain, 'A');
      this.decks.B = new Deck(this.audioContext, this.masterGain, this.cueGain, 'B');

      this.decks.A.setVolume(100);
      this.decks.B.setVolume(0);

      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize audio context:', error);
    }
  }

  /**
   * Checks the saved card is still there before opening against it.
   *
   * A context will happily be built naming a card that has been unplugged —
   * nothing throws, and the sound goes nowhere. Falling back to the system
   * output is the difference between a missing headphone feed and total
   * silence. A card whose permission has lapsed reads as gone, which is the
   * right answer too: its id is no longer usable.
   */
  static async resolveSink(sinkId) {
    if (!sinkId) return '';

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const present = devices.some(d => d.kind === 'audiooutput' && d.deviceId === sinkId);

      if (!present) console.warn('The saved sound card is not there, using the system output');
      return present ? sinkId : '';
    } catch (error) {
      console.warn('Could not check the saved sound card:', error);
      return '';
    }
  }

  /** 44100 is also one of the three sample rates MP3 is defined at, which is
   *  what lets a take be encoded without being resampled first. */
  static createContext(sinkId) {
    const options = { sampleRate: 44100 };
    if (!sinkId) return new AudioContext(options);

    try {
      return new AudioContext({ ...options, sinkId });
    } catch (error) {
      // The card may be unplugged, or its id may have gone stale with the
      // permission that revealed it. Better the default output than silence.
      console.warn('Could not open the saved sound card, using the system output:', error);
      return new AudioContext(options);
    }
  }

  /** True when the card being asked for is not the one the context was built
   *  against, which is the only time a reload actually buys anything. */
  needsReloadFor(deviceId) {
    return (deviceId || '') !== (this.sinkId || '');
  }

  async resumeContext() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  /**
   * Rewire the output stage. Safe to call at any time — only the output side
   * of the gain nodes is touched, so the decks feeding them stay connected.
   */
  setOutputRouting(routing) {
    this.outputRouting = AudioEngine.ROUTINGS.includes(routing)
      ? routing
      : AudioEngine.DEFAULT_ROUTING;

    if (!this.audioContext) return this.outputRouting;

    this.cueGain.disconnect();
    this.masterGain.disconnect();
    this.channelMerger.disconnect();
    this.splitMerger.disconnect();
    this.masterSplitter.disconnect();
    this.cueSplitter.disconnect();

    // Anything but the four-output mode wants the destination back in stereo
    const destination = this.audioContext.destination;
    destination.channelCount = this.outputRouting === 'split-4'
      ? Math.min(4, destination.maxChannelCount)
      : Math.min(2, destination.maxChannelCount);

    if (this.outputRouting === 'split-4') {
      destination.channelCountMode = 'explicit';
      destination.channelInterpretation = 'discrete';

      this.masterGain.connect(this.masterSplitter);
      this.masterSplitter.connect(this.splitMerger, 0, 0);   // MAIN L  -> out 1
      this.masterSplitter.connect(this.splitMerger, 1, 1);   // MAIN R  -> out 2

      this.cueGain.connect(this.cueSplitter);
      this.cueSplitter.connect(this.splitMerger, 0, 2);      // CUE L   -> out 3
      this.cueSplitter.connect(this.splitMerger, 1, 3);      // CUE R   -> out 4

      this.splitMerger.connect(destination);

      // The take is the mix, never the cue: what the room hears is what gets
      // recorded, whatever the headphones are doing
      this.captureTaps().forEach(tap => this.masterGain.connect(tap));
    } else if (this.outputRouting === 'cue-split') {
      destination.channelInterpretation = 'speakers';
      this.cueGain.connect(this.channelMerger, 0, 0);    // CUE -> Left channel
      this.masterGain.connect(this.channelMerger, 0, 1); // MAIN -> Right channel
      this.channelMerger.connect(this.audioContext.destination);
      this.captureTaps().forEach(tap => this.channelMerger.connect(tap));
    } else {
      // Straight through, so the main mix keeps its stereo image
      destination.channelInterpretation = 'speakers';
      this.masterGain.connect(this.audioContext.destination);
      this.captureTaps().forEach(tap => this.masterGain.connect(tap));
    }

    return this.outputRouting;
  }

  /** Everything listening in on the output stage. Rewiring goes through here so
   *  that changing the routing mid-take keeps the recorder on the mix rather
   *  than on whatever the previous routing left connected. */
  captureTaps() {
    return [this.mediaStreamDestination, this.recorderNode].filter(Boolean);
  }

  isCueAvailable() {
    return this.outputRouting === 'cue-split';
  }

  setMasterVolume(value) {
    if (this.masterGain) {
      this.masterGain.gain.value = value / 100;
    }
  }

  setCueVolume(value) {
    if (this.cueGain) {
      this.cueGain.gain.value = value / 100;
    }
  }

  /** Outputs the current device can take. Four is what a DJ controller with a
   *  sound card of its own reports, and what 'split-4' needs. */
  get outputChannels() {
    return this.audioContext?.destination.maxChannelCount ?? 2;
  }

  /**
   * Point the output at a particular sound card.
   *
   * This is what unlocks the four-output mode: the browser hands the *default*
   * device over as plain stereo, so a controller with four outputs only admits
   * to them when it is asked for by name. Passing an empty id goes back to
   * following the system default.
   */
  async setOutputDevice(deviceId = '') {
    if (!this.audioContext || typeof this.audioContext.setSinkId !== 'function') return false;

    try {
      await this.audioContext.setSinkId(deviceId);
    } catch (error) {
      console.warn('Could not switch the output device:', error);
      return false;
    }

    // The channel count belongs to the sink, so the routing has to be rebuilt
    // against whatever the new one can take
    this.setOutputRouting(this.outputRouting);
    return true;
  }

  /**
   * Sound cards the browser will name.
   *
   * Output devices come back nameless and without ids until the page holds an
   * audio permission, which is why this asks for one and hands the stream
   * straight back — the microphone is never listened to, it is the only key
   * the browser offers to the list.
   */
  static async listOutputs() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());

    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'audiooutput');
  }

  getMasterVolume() {
    return this.masterGain ? this.masterGain.gain.value : 0.75;
  }

  getCueVolume() {
    return this.cueGain ? this.cueGain.gain.value : 0.75;
  }

  getDeck(deckId) {
    return this.decks[deckId];
  }

  /**
   * Records the mix straight to MP3. An AudioWorklet copies the output stage
   * and a worker encodes it as it arrives, so the take is only ever lossy once
   * and stopping costs nothing — the file is already written. Browsers that
   * cannot do that fall back to MediaRecorder and a WebM take, which is better
   * than losing the mix.
   */
  async startRecording() {
    if (!this.isInitialized || this.isRecording) return false;

    if (await this.startMp3Recording()) return true;
    return this.startMediaRecorder();
  }

  async startMp3Recording() {
    if (!this.audioContext.audioWorklet || typeof Worker === 'undefined') return false;

    try {
      await this.audioContext.audioWorklet.addModule('js/recorder-worklet.js');

      this.mp3Worker = new Worker('js/mp3-worker.js');
      this.mp3Worker.postMessage({
        type: 'start',
        sampleRate: this.audioContext.sampleRate,
        bitRate: AudioEngine.RECORDING_BITRATE
      });

      this.recorderNode = new AudioWorkletNode(this.audioContext, 'recorder-processor', {
        numberOfOutputs: 1,
        outputChannelCount: [1]
      });

      this.recordedFrames = 0;
      this.recorderNode.port.onmessage = ({ data }) => {
        if (data.type !== 'block') {
          this.mp3Worker.postMessage({ type: 'end' });
          return;
        }

        // Counted before the buffers leave, because after the transfer they are
        // no longer ours to read
        this.recordedFrames += data.left.length;
        this.mp3Worker.postMessage(data, [data.left.buffer, data.right.buffer]);
      };

      // A worklet whose output goes nowhere is never pulled by the graph, and a
      // node that is never pulled never runs. The silence keeps it turning.
      this.recorderSink = this.audioContext.createGain();
      this.recorderSink.gain.value = 0;
      this.recorderNode.connect(this.recorderSink);
      this.recorderSink.connect(this.audioContext.destination);

      this.setOutputRouting(this.outputRouting); // puts the tap on the mix

      this.isRecording = true;
      console.log('Recording started (MP3)');
      return true;
    } catch (error) {
      console.warn('Recording: no MP3 encoder, falling back to WebM:', error);
      this.teardownMp3Recording();
      return false;
    }
  }

  startMediaRecorder() {
    try {
      this.recordedChunks = [];

      const options = { mimeType: 'audio/webm;codecs=opus' };

      // Fallback for browsers that don't support the preferred codec
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
          options.mimeType = '';
        }
      }

      this.mediaRecorder = new MediaRecorder(this.mediaStreamDestination.stream, options);

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        console.log('Recording stopped');
      };

      this.mediaRecorder.start(1000); // Collect data every second
      this.isRecording = true;
      this.recordingStartTime = Date.now();

      console.log('Recording started (WebM)');
      return true;
    } catch (error) {
      console.error('Failed to start recording:', error);
      return false;
    }
  }

  stopRecording() {
    if (!this.isRecording) return null;
    if (this.recorderNode) return this.stopMp3Recording();
    if (this.mediaRecorder) return this.stopMediaRecorder();

    return null;
  }

  stopMp3Recording() {
    return new Promise((resolve) => {
      this.mp3Worker.onmessage = ({ data }) => {
        this.isRecording = false;
        this.teardownMp3Recording();
        console.log('Recording stopped, blob size:', data.blob ? data.blob.size : 0);
        resolve(data.type === 'done' ? data.blob : null);
      };

      // Stops the tap. The last partial block, and the end of stream behind it,
      // reach the worker through the handler already listening.
      this.recorderNode.port.postMessage('stop');
    });
  }

  teardownMp3Recording() {
    if (this.recorderNode) {
      this.recorderNode.port.onmessage = null;
      this.recorderNode.disconnect();
    }
    this.recorderSink?.disconnect();
    this.mp3Worker?.terminate();

    this.recorderNode = null;
    this.recorderSink = null;
    this.mp3Worker = null;
    this.recordedFrames = 0;

    // Rewires the output stage without the tap on it
    if (this.audioContext) this.setOutputRouting(this.outputRouting);
  }

  stopMediaRecorder() {
    return new Promise((resolve) => {
      this.mediaRecorder.onstop = () => {
        this.isRecording = false;
        this.recordingStartTime = null;
        const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
        this.recordedChunks = [];
        this.mediaRecorder = null;
        console.log('Recording stopped, blob size:', blob.size);
        resolve(blob);
      };

      this.mediaRecorder.stop();
    });
  }

  getRecordingDuration() {
    if (!this.isRecording) return 0;

    // While encoding, the take is counted in the samples that reached the
    // encoder: its own clock, which cannot drift away from the finished file
    if (this.recorderNode) {
      return Math.floor(this.recordedFrames / this.audioContext.sampleRate);
    }

    if (!this.recordingStartTime) return 0;
    return Math.floor((Date.now() - this.recordingStartTime) / 1000);
  }

  isCurrentlyRecording() {
    return this.isRecording;
  }

  hasActiveSession() {
    if (!this.isInitialized) return false;
    
    const deckA = this.getDeck('A');
    const deckB = this.getDeck('B');
    
    return (deckA && (deckA.audioBuffer || deckA.isPlaying)) || 
           (deckB && (deckB.audioBuffer || deckB.isPlaying));
  }
}

window.audioEngine = new AudioEngine();
