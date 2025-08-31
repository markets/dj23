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

class ZoomedWaveformRenderer {
  constructor(canvasId, deckId, zoomIndex) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.deckId = deckId;
    this.zoomIndex = zoomIndex;
    this.waveformData = null;
    this.animationId = null;
    this.zoomLevel = 20; // Shows about 20 seconds of audio for beat matching
    this.offsetSeconds = 0; // Current offset from track start
        
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
        // Calculate seek time relative to current zoom window
        const windowDuration = Math.min(this.zoomLevel, deck.getDuration() - this.offsetSeconds);
        const seekOffset = percentage * windowDuration;
        const seekTime = this.offsetSeconds + seekOffset;
        deck.seek(seekTime);
        console.log(`Beat waveform seek to ${seekTime}s on deck ${this.deckId}`);
      }
    });

    // Handle dragging for scrubbing
    let isDragging = false;
    this.canvas.addEventListener('mousedown', (e) => {
      isDragging = true;
      this.canvas.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging || !this.waveformData) return;
      
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, x / rect.width));
      
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck && deck.audioBuffer) {
        const windowDuration = Math.min(this.zoomLevel, deck.getDuration() - this.offsetSeconds);
        const seekOffset = percentage * windowDuration;
        const seekTime = this.offsetSeconds + seekOffset;
        deck.seek(seekTime);
      }
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      this.canvas.style.cursor = 'pointer';
    });

    window.addEventListener('resize', () => {
      this.setupCanvas();
      this.render();
    });
  }

  async generateWaveform(audioBuffer) {
    // Generate high resolution waveform data for zoomed view
    const channelData = audioBuffer.getChannelData(0);
    const samples = 2000; // Higher resolution for beat matching
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

  updateZoomWindow() {
    const deck = window.audioEngine.getDeck(this.deckId);
    if (!deck || !deck.audioBuffer) {
      // When no track is loaded, keep offset at 0 to show middle line only
      this.offsetSeconds = 0;
      return;
    }

    const currentTime = deck.getCurrentTime();
    const duration = deck.getDuration();
    
    // For top waveforms: always center the current position so red line stays in middle
    // This makes the waveform move on X-axis while the playhead stays centered
    this.offsetSeconds = Math.max(0, currentTime - this.zoomLevel / 2);
    
    // Ensure we don't go beyond track duration
    this.offsetSeconds = Math.min(this.offsetSeconds, Math.max(0, duration - this.zoomLevel));
  }

  render() {
    if (!this.waveformData) {
      this.renderEmpty();
      return;
    }

    const deck = window.audioEngine.getDeck(this.deckId);
    if (!deck) return;

    this.updateZoomWindow();

    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const duration = deck.getDuration();
        
    this.ctx.clearRect(0, 0, width, height);
        
    // Calculate which part of the waveform to show
    const totalSamples = this.waveformData.length;
    const startRatio = this.offsetSeconds / duration;
    const endRatio = Math.min(1, (this.offsetSeconds + this.zoomLevel) / duration);
    
    const startSample = Math.floor(startRatio * totalSamples);
    const endSample = Math.floor(endRatio * totalSamples);
    const visibleSamples = endSample - startSample;
    
    if (visibleSamples <= 0) return;

    const barWidth = width / visibleSamples;
    const centerY = height / 2;

    // Draw waveform with higher detail
    this.ctx.fillStyle = '#444';
    for (let i = 0; i < visibleSamples; i++) {
      const sampleIndex = startSample + i;
      if (sampleIndex >= this.waveformData.length) break;
      
      const barHeight = this.waveformData[sampleIndex] * centerY * 0.9;
      const x = i * barWidth;
            
      // Draw positive part
      this.ctx.fillRect(x, centerY - barHeight, barWidth - 0.5, barHeight);
      // Draw negative part
      this.ctx.fillRect(x, centerY, barWidth - 0.5, barHeight);
    }

    // Draw played portion in zoom window
    if (deck.isPlaying) {
      const currentTime = deck.getCurrentTime();
      if (currentTime >= this.offsetSeconds && currentTime <= this.offsetSeconds + this.zoomLevel) {
        const progressInWindow = (currentTime - this.offsetSeconds) / Math.min(this.zoomLevel, duration - this.offsetSeconds);
        const playedWidth = width * progressInWindow;
            
        this.ctx.fillStyle = '#4ecdc4';
        for (let i = 0; i < visibleSamples; i++) {
          const x = i * barWidth;
          if (x > playedWidth) break;
          
          const sampleIndex = startSample + i;
          if (sampleIndex >= this.waveformData.length) break;
                
          const barHeight = this.waveformData[sampleIndex] * centerY * 0.9;
          this.ctx.fillRect(x, centerY - barHeight, barWidth - 0.5, barHeight);
          this.ctx.fillRect(x, centerY, barWidth - 0.5, barHeight);
        }
      }
    }

    // Draw beat markers (every second)
    this.drawBeatMarkers(width, height, duration);
    
    // Draw red playhead line always in the center for beat view
    this.ctx.strokeStyle = '#ff4757';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(width / 2, 0);
    this.ctx.lineTo(width / 2, height);
    this.ctx.stroke();
    
    // Update playhead position
    this.updatePlayhead();
  }

  drawBeatMarkers(width, height, duration) {
    const windowDuration = Math.min(this.zoomLevel, duration - this.offsetSeconds);
    const secondsPerPixel = windowDuration / width;
    
    this.ctx.strokeStyle = '#666';
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([2, 2]);
    
    // Draw vertical lines every second
    for (let i = 0; i < windowDuration; i++) {
      const x = (i / windowDuration) * width;
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, height);
      this.ctx.stroke();
    }
    
    this.ctx.setLineDash([]);
  }

  renderEmpty() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
        
    this.ctx.clearRect(0, 0, width, height);
        
    // Draw empty state with just the center line
    this.ctx.strokeStyle = '#333';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(0, height / 2);
    this.ctx.lineTo(width, height / 2);
    this.ctx.stroke();
        
    // Draw red playhead line in the center (50%) for beat view
    this.ctx.strokeStyle = '#ff4757';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(width / 2, 0);
    this.ctx.lineTo(width / 2, height);
    this.ctx.stroke();
    
    // Draw text
    this.ctx.fillStyle = '#666';
    this.ctx.font = '12px Inter';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Load track for beat view', width / 2, height / 2 - 6);
  }

  updatePlayhead() {
    const deck = window.audioEngine.getDeck(this.deckId);
    const playhead = document.getElementById(`beatPlayhead${this.deckId}`);
        
    if (deck && deck.getDuration() > 0) {
      // Always keep the red line in the middle for top waveforms
      // The waveform moves on X-axis instead of the playhead moving
      playhead.style.left = '50%';
      playhead.style.opacity = deck.isPlaying ? '1' : '0.7';
    } else {
      playhead.style.left = '50%';
      playhead.style.opacity = '0.3';
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

// Global beat waveform renderers
window.beatWaveformRenderers = {
  A: null,
  B: null
};