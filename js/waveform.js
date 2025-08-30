class WaveformRenderer {
  constructor(canvasId, deckId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.deckId = deckId;
    this.waveformData = null;
    this.animationId = null;
        
    this.setupCanvas();
    this.setupEventListeners();
  }

  setupCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * window.devicePixelRatio;
    this.canvas.height = rect.height * window.devicePixelRatio;
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
  }

  setupEventListeners() {
    this.canvas.addEventListener('click', (e) => {
      if (!this.waveformData) return;
            
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = x / rect.width;
            
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck && deck.audioBuffer) {
        const seekTime = percentage * deck.getDuration();
        deck.seek(seekTime);
        console.log(`Seek to ${seekTime}s on deck ${this.deckId}`);
      }
    });

    window.addEventListener('resize', () => {
      this.setupCanvas();
      this.render();
    });
  }

  async generateWaveform(audioBuffer) {
    const channelData = audioBuffer.getChannelData(0);
    const samples = 1000; // Number of waveform points
    const blockSize = Math.floor(channelData.length / samples);
    const waveformData = [];

    for (let i = 0; i < samples; i++) {
      const start = i * blockSize;
      const end = start + blockSize;
      let sum = 0;

      for (let j = start; j < end && j < channelData.length; j++) {
        sum += Math.abs(channelData[j]);
      }

      waveformData.push(sum / blockSize);
    }

    this.waveformData = waveformData;
    this.render();
  }

  render() {
    if (!this.waveformData) {
      this.renderEmpty();
      return;
    }

    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
        
    this.ctx.clearRect(0, 0, width, height);
        
    const barWidth = width / this.waveformData.length;
    const centerY = height / 2;

    // Draw waveform
    this.ctx.fillStyle = '#333';
    for (let i = 0; i < this.waveformData.length; i++) {
      const barHeight = this.waveformData[i] * centerY * 0.8;
      const x = i * barWidth;
            
      // Draw positive part
      this.ctx.fillRect(x, centerY - barHeight, barWidth - 1, barHeight);
      // Draw negative part
      this.ctx.fillRect(x, centerY, barWidth - 1, barHeight);
    }

    // Draw played portion
    const deck = window.audioEngine.getDeck(this.deckId);
    if (deck && deck.isPlaying) {
      const progress = deck.getCurrentTime() / deck.getDuration();
      const playedWidth = width * progress;
            
      this.ctx.fillStyle = '#4ecdc4';
      for (let i = 0; i < this.waveformData.length; i++) {
        const x = i * barWidth;
        if (x > playedWidth) break;
                
        const barHeight = this.waveformData[i] * centerY * 0.8;
        this.ctx.fillRect(x, centerY - barHeight, barWidth - 1, barHeight);
        this.ctx.fillRect(x, centerY, barWidth - 1, barHeight);
      }
    }

    // Update playhead position
    this.updatePlayhead();
  }

  renderEmpty() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
        
    this.ctx.clearRect(0, 0, width, height);
        
    // Draw empty state
    this.ctx.strokeStyle = '#333';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(0, height / 2);
    this.ctx.lineTo(width, height / 2);
    this.ctx.stroke();
        
    // Draw text
    this.ctx.fillStyle = '#666';
    this.ctx.font = '14px Inter';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Load a track to see waveform', width / 2, height / 2 - 10);
  }

  updatePlayhead() {
    const deck = window.audioEngine.getDeck(this.deckId);
    const playhead = document.getElementById(`playhead${this.deckId}`);
        
    if (deck && deck.isPlaying && deck.getDuration() > 0) {
      const progress = deck.getCurrentTime() / deck.getDuration();
      const position = Math.min(progress * 100, 100);
      playhead.style.left = `${position}%`;
    } else {
      playhead.style.left = '0%';
    }
  }

  startAnimation() {
    const animate = () => {
      this.render();
      this.animationId = requestAnimationFrame(animate);
    };
    animate();
  }

  stopAnimation() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }
}

// Global waveform renderers
window.waveformRenderers = {
  A: null,
  B: null
};