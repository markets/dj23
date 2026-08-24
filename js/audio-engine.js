class AudioEngine {
  /** 'main' sends the full stereo mix to the output; 'cue-split' puts the cue
   *  bus on the left channel and the main mix on the right, which is how you
   *  pre-listen through one headphone without a second sound card. */
  static ROUTINGS = ['main', 'cue-split'];
  static DEFAULT_ROUTING = 'main';

  constructor() {
    this.audioContext = null;
    this.masterGain = null;
    this.masterAnalyser = null;
    this.remixStation = null;
    this.decks = {
      A: null,
      B: null
    };
    this.isInitialized = false;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.isRecording = false;
    this.recordingStartTime = null;
    this.outputRouting = AudioEngine.DEFAULT_ROUTING;
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      this.audioContext = new AudioContext({ sampleRate: 44100 });

      this.channelMerger = this.audioContext.createChannelMerger(2);

      this.cueGain = this.audioContext.createGain();
      this.masterGain = this.audioContext.createGain();
      this.masterAnalyser = this.audioContext.createAnalyser();
      this.masterAnalyser.fftSize = 256;

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
    this.masterAnalyser.disconnect();
    this.channelMerger.disconnect();

    // Meter the real summed bus, including sound pads and the Remix Station.
    // The analyser passes audio through unchanged.
    this.masterGain.connect(this.masterAnalyser);

    if (this.outputRouting === 'cue-split') {
      this.cueGain.connect(this.channelMerger, 0, 0);    // CUE -> Left channel
      this.masterAnalyser.connect(this.channelMerger, 0, 1); // MAIN -> Right channel
      this.channelMerger.connect(this.audioContext.destination);
      this.channelMerger.connect(this.mediaStreamDestination);
    } else {
      // Straight through, so the main mix keeps its stereo image
      this.masterAnalyser.connect(this.audioContext.destination);
      this.masterAnalyser.connect(this.mediaStreamDestination);
    }

    return this.outputRouting;
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

  getMasterAnalyserData() {
    if (!this.masterAnalyser) return new Uint8Array(0);

    const data = new Uint8Array(this.masterAnalyser.frequencyBinCount);
    this.masterAnalyser.getByteFrequencyData(data);
    return data;
  }

  startRecording() {
    if (!this.isInitialized || this.isRecording) return false;

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
      
      console.log('Recording started');
      return true;
    } catch (error) {
      console.error('Failed to start recording:', error);
      return false;
    }
  }

  stopRecording() {
    if (!this.isRecording || !this.mediaRecorder) return null;

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
    if (!this.isRecording || !this.recordingStartTime) return 0;
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
           (deckB && (deckB.audioBuffer || deckB.isPlaying)) ||
           Boolean(this.remixStation?.isPlaying);
  }
}

window.audioEngine = new AudioEngine();
