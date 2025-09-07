class AudioEngine {
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
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.connect(this.audioContext.destination);
      this.masterGain.gain.value = 0.75;

      // Create a media stream destination for recording
      this.mediaStreamDestination = this.audioContext.createMediaStreamDestination();
      this.masterGain.connect(this.mediaStreamDestination);

      this.decks.A = new Deck(this.audioContext, this.masterGain, 'A');
      this.decks.B = new Deck(this.audioContext, this.masterGain, 'B');

      // Set initial deck volumes
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

  setMasterVolume(value) {
    if (this.masterGain) {
      this.masterGain.gain.value = value / 100;
    }
  }

  getMasterVolume() {
    return this.masterGain ? this.masterGain.gain.value : 0.75;
  }

  getDeck(deckId) {
    return this.decks[deckId];
  }

  startRecording() {
    if (!this.isInitialized || this.isRecording) return false;

    try {
      this.recordedChunks = [];
      
      // Use audio/webm;codecs=opus for best compatibility
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
        const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
        this.recordedChunks = [];
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
}

window.audioEngine = new AudioEngine();
