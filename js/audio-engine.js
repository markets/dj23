class AudioEngine {
  /** 'main' sends the full stereo mix to the output; 'cue-split' puts the cue
   *  bus on the left channel and the main mix on the right, which is how you
   *  pre-listen through one headphone without a second sound card. */
  static ROUTINGS = ['main', 'cue-split'];
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

  async initialize() {
    if (this.isInitialized) return;

    try {
      // 44100 is also one of the three sample rates MP3 is defined at, which is
      // what lets a take be encoded without being resampled first
      this.audioContext = new AudioContext({ sampleRate: 44100 });

      this.channelMerger = this.audioContext.createChannelMerger(2);

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

    if (this.outputRouting === 'cue-split') {
      this.cueGain.connect(this.channelMerger, 0, 0);    // CUE -> Left channel
      this.masterGain.connect(this.channelMerger, 0, 1); // MAIN -> Right channel
      this.channelMerger.connect(this.audioContext.destination);
      this.captureTaps().forEach(tap => this.channelMerger.connect(tap));
    } else {
      // Straight through, so the main mix keeps its stereo image
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
