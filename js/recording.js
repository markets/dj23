class Recording {
  constructor() {
    this.recordBtn = null;
    this.downloadBtn = null;
    this.recordingStatus = null;
    this.recordingTime = null;
    this.recordingTimer = null;
    this.lastRecordedBlob = null;
    this.setupEventListeners();
  }

  setupEventListeners() {
    document.addEventListener('DOMContentLoaded', () => {
      this.recordBtn = document.getElementById('recordBtn');
      this.downloadBtn = document.getElementById('downloadBtn');
      this.recordingStatus = document.getElementById('recordingStatus');
      this.recordingTime = document.getElementById('recordingTime');

      if (this.recordBtn) {
        this.recordBtn.addEventListener('click', () => this.toggleRecording());
      }

      if (this.downloadBtn) {
        this.downloadBtn.addEventListener('click', () => this.downloadRecording());
      }
    });
  }

  async toggleRecording() {
    if (!window.audioEngine || !window.audioEngine.isInitialized) {
      alert('Audio engine not initialized. Please load a track first.');
      return;
    }

    if (window.audioEngine.isCurrentlyRecording()) {
      await this.stopRecording();
    } else {
      this.startRecording();
    }
  }

  startRecording() {
    const success = window.audioEngine.startRecording();
    
    if (success) {
      this.recordBtn.classList.add('recording');
      this.recordBtn.title = 'Stop Recording';
      this.recordingStatus.style.display = 'flex';
      this.downloadBtn.style.display = 'none';
      
      this.startTimer();
    } else {
      alert('Failed to start recording. Please check your browser permissions.');
    }
  }

  async stopRecording() {
    const blob = await window.audioEngine.stopRecording();
    
    if (blob) {
      this.recordBtn.classList.remove('recording');
      this.recordBtn.title = 'Start Recording';
      this.recordingStatus.style.display = 'none';
      this.downloadBtn.style.display = 'inline-block';
      this.lastRecordedBlob = blob;
      
      this.stopTimer();
      
      console.log('Recording completed, size:', blob.size, 'bytes');
    }
  }

  startTimer() {
    this.recordingTimer = setInterval(() => {
      const duration = window.audioEngine.getRecordingDuration();
      this.updateTimerDisplay(duration);
    }, 1000);
  }

  stopTimer() {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }
  }

  updateTimerDisplay(seconds) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    let timeString;
    if (hours > 0) {
      timeString = `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      timeString = `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    if (this.recordingTime) {
      this.recordingTime.textContent = timeString;
    }
  }

  downloadRecording() {
    if (!this.lastRecordedBlob) {
      alert('No recording available to download.');
      return;
    }

    const url = URL.createObjectURL(this.lastRecordedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dj-mix-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log('Recording download initiated');
    
    // Always reset for new recording after download
    this.downloadBtn.style.display = 'none';
    this.lastRecordedBlob = null;
  }
}

window.recordingController = new Recording();
