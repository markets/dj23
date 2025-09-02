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
      if (!this.waveformData) {
        console.log(`Deck ${this.deckId}: No waveform data available for seeking`);
        return;
      }
            
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = x / rect.width;
            
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck && deck.audioBuffer) {
        const seekTime = percentage * deck.getDuration();
        console.log(`Deck ${this.deckId}: Waveform clicked - seeking to ${seekTime.toFixed(2)}s (${(percentage * 100).toFixed(1)}%)`);
        deck.seek(seekTime);
        // Immediately update playhead position after seeking
        this.updatePlayhead();
      } else {
        console.log(`Deck ${this.deckId}: No audio buffer available for seeking`);
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
    const deck = window.audioEngine.getDeck(this.deckId);
        
    this.ctx.clearRect(0, 0, width, height);
        
    const barWidth = width / this.waveformData.length;
    const centerY = height / 2;

    this.ctx.fillStyle = '#333';
    for (let i = 0; i < this.waveformData.length; i++) {
      const barHeight = this.waveformData[i] * centerY * 0.8;
      const x = i * barWidth;
            
      this.ctx.fillRect(x, centerY - barHeight, barWidth - 1, barHeight);
      this.ctx.fillRect(x, centerY, barWidth - 1, barHeight);
    }

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

    this.drawCuePoints(width, height, deck);

    this.updatePlayhead();
  }

  drawCuePoints(width, height, deck) {
    if (!deck || !deck.audioBuffer) return;
    
    const duration = deck.getDuration();
    
    // Use unified color for both cue points - subtle gray that works with dark theme
    const cueLineColor = '#ccc';
    const cueTextColor = '#fff';
    
    // Draw CUE 1
    if (deck.cuePoints[1] !== null) {
      const cue1Position = (deck.cuePoints[1] / duration) * width;
      this.ctx.strokeStyle = cueLineColor;
      this.ctx.lineWidth = 3;
      this.ctx.setLineDash([]);
      this.ctx.beginPath();
      this.ctx.moveTo(cue1Position, 0);
      this.ctx.lineTo(cue1Position, height);
      this.ctx.stroke();
      
      // Improved text positioning with background for better readability
      this.ctx.font = 'bold 10px Inter';
      const textMetrics = this.ctx.measureText('CUE 1');
      
      // Simple positioning: always render text to the right
      const textOffset = 8;
      const textWidth = textMetrics.width + 4;
      const textX = cue1Position + textOffset;
      const textY = 14;
      
      // Draw text background for better readability
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      this.ctx.fillRect(textX - 2, textY - 10, textWidth, 12);
      
      // Draw text
      this.ctx.fillStyle = cueTextColor;
      this.ctx.textAlign = 'left';
      this.ctx.fillText('CUE 1', textX, textY);
    }
    
    // Draw CUE 2
    if (deck.cuePoints[2] !== null) {
      const cue2Position = (deck.cuePoints[2] / duration) * width;
      this.ctx.strokeStyle = cueLineColor;
      this.ctx.lineWidth = 3;
      this.ctx.setLineDash([]);
      this.ctx.beginPath();
      this.ctx.moveTo(cue2Position, 0);
      this.ctx.lineTo(cue2Position, height);
      this.ctx.stroke();
      
      // Improved text positioning with background for better readability
      this.ctx.font = 'bold 10px Inter';
      const textMetrics = this.ctx.measureText('CUE 2');
      
      // Simple positioning: always render text to the right
      const textOffset = 8;
      const textWidth = textMetrics.width + 4;
      const textX = cue2Position + textOffset;
      const textY = 28;
      
      // Draw text background for better readability
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      this.ctx.fillRect(textX - 2, textY - 10, textWidth, 12);
      
      // Draw text
      this.ctx.fillStyle = cueTextColor;
      this.ctx.textAlign = 'left';
      this.ctx.fillText('CUE 2', textX, textY);
    }
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
        
    if (deck && deck.getDuration() > 0) {
      const progress = deck.getCurrentTime() / deck.getDuration();
      const position = Math.min(progress * 100, 100);
      playhead.style.left = `${position}%`;
      // Set opacity based on play state for visual feedback
      playhead.style.opacity = deck.isPlaying ? '1' : '0.7';
    } else {
      playhead.style.left = '0%';
      playhead.style.opacity = '0.3';
    }
  }

  startAnimation() {
    // Don't start if already animating
    if (this.animationId) return;
    
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
    // Handle scratching for beat view waveforms
    let isDragging = false;
    let lastX = 0;
    let scratchStartTime = 0;
    let wasPlayingBeforeScratch = false;

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.waveformData) return;
      
      isDragging = true;
      this.canvas.style.cursor = 'grabbing';
      
      const rect = this.canvas.getBoundingClientRect();
      lastX = e.clientX - rect.left;
      
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck && deck.audioBuffer) {
        // Start scratching
        wasPlayingBeforeScratch = deck.isPlaying;
        deck.startScratch();
        scratchStartTime = deck.getCurrentTime();
        console.log(`Beat waveform scratch started on deck ${this.deckId}`);
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging || !this.waveformData) return;
      
      const rect = this.canvas.getBoundingClientRect();
      const currentX = e.clientX - rect.left;
      const deltaX = currentX - lastX;
      
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck && deck.audioBuffer) {
        // Convert horizontal movement to both position control AND scratch
        // This provides full control of the record position while scratching
        const sensitivity = 0.02; // Adjust for scratch sensitivity
        const scratchSpeed = deltaX * sensitivity;
        
        // Calculate new position based on scratch movement for position control
        const windowDuration = Math.min(this.zoomLevel, deck.getDuration() - this.offsetSeconds);
        const timePerPixel = windowDuration / rect.width;
        const timeOffset = deltaX * timePerPixel;
        const newTime = Math.max(0, Math.min(deck.getDuration(), deck.getCurrentTime() - timeOffset));
        
        // Seek to new position for full record control
        deck.seek(newTime);
        
        // Also apply scratch effect for audio feedback
        deck.scratch(scratchSpeed * 15); // Scale for audio scratching
      }
      
      lastX = currentX;
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        this.canvas.style.cursor = 'pointer';
        
        const deck = window.audioEngine.getDeck(this.deckId);
        if (deck && deck.audioBuffer) {
          // Stop scratching
          deck.stopScratch();
          
          // Leave track at current position instead of resuming playback
          // This gives full control of the record position
          console.log(`Beat waveform scratch stopped on deck ${this.deckId} - staying at current position`);
        }
      }
    });

    // Touch events for mobile scratching
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (!this.waveformData) return;
      
      const touch = e.touches[0];
      const rect = this.canvas.getBoundingClientRect();
      
      isDragging = true;
      lastX = touch.clientX - rect.left;
      
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck && deck.audioBuffer) {
        wasPlayingBeforeScratch = deck.isPlaying;
        deck.startScratch();
        scratchStartTime = deck.getCurrentTime();
        console.log(`Beat waveform touch scratch started on deck ${this.deckId}`);
      }
    });

    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (!isDragging || !this.waveformData) return;
      
      const touch = e.touches[0];
      const rect = this.canvas.getBoundingClientRect();
      const currentX = touch.clientX - rect.left;
      const deltaX = currentX - lastX;
      
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck && deck.audioBuffer) {
        // Convert horizontal movement to both position control AND scratch for touch
        const sensitivity = 0.02;
        const scratchSpeed = deltaX * sensitivity;
        
        // Calculate new position based on scratch movement for position control
        const windowDuration = Math.min(this.zoomLevel, deck.getDuration() - this.offsetSeconds);
        const timePerPixel = windowDuration / rect.width;
        const timeOffset = deltaX * timePerPixel;
        const newTime = Math.max(0, Math.min(deck.getDuration(), deck.getCurrentTime() - timeOffset));
        
        // Seek to new position for full record control
        deck.seek(newTime);
        
        // Also apply scratch effect for audio feedback
        deck.scratch(scratchSpeed * 15);
      }
      
      lastX = currentX;
    });

    this.canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (isDragging) {
        isDragging = false;
        
        const deck = window.audioEngine.getDeck(this.deckId);
        if (deck && deck.audioBuffer) {
          deck.stopScratch();
          
          // Leave track at current position instead of resuming playback
          // This gives full control of the record position
          console.log(`Beat waveform touch scratch stopped on deck ${this.deckId} - staying at current position`);
        }
      }
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
      this.offsetSeconds = this.zoomLevel / 2;
      return;
    }

    const currentTime = deck.getCurrentTime();
    const duration = deck.getDuration();
    
    // Center current time under the red line
    this.offsetSeconds = currentTime - this.zoomLevel / 2;
    
    // Clamp to track duration bounds
    if (this.offsetSeconds + this.zoomLevel > duration) {
      this.offsetSeconds = Math.max(0, duration - this.zoomLevel);
    }
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
    const currentTime = deck.getCurrentTime();
        
    this.ctx.clearRect(0, 0, width, height);
        
    const totalSamples = this.waveformData.length;
    
    const windowStart = this.offsetSeconds;
    const windowEnd = this.offsetSeconds + this.zoomLevel;
    
    const startRatio = Math.max(0, windowStart) / duration;
    const endRatio = Math.min(1, windowEnd / duration);
    
    const startSample = Math.floor(startRatio * totalSamples);
    const endSample = Math.floor(endRatio * totalSamples);
    const visibleSamples = endSample - startSample;
    
    if (visibleSamples <= 0) return;

    const pixelsPerSecond = width / this.zoomLevel;
    const barWidth = pixelsPerSecond / (totalSamples / duration);
    const centerY = height / 2;

    const drawOffsetPixels = windowStart < 0 ? -windowStart * pixelsPerSecond : 0;

    // Draw waveform with higher detail
    this.ctx.fillStyle = '#444';
    for (let i = 0; i < visibleSamples; i++) {
      const sampleIndex = startSample + i;
      if (sampleIndex >= this.waveformData.length) break;
      
      const barHeight = this.waveformData[sampleIndex] * centerY * 0.9;
      const x = drawOffsetPixels + i * barWidth;
      
      if (x >= 0 && x < width) {
        this.ctx.fillRect(x, centerY - barHeight, barWidth - 0.5, barHeight);
        this.ctx.fillRect(x, centerY, barWidth - 0.5, barHeight);
      }
    }

    // Draw played portion in zoom window
    if (deck.isPlaying) {
      const currentTime = deck.getCurrentTime();
      if (currentTime >= Math.max(0, this.offsetSeconds) && 
          currentTime <= this.offsetSeconds + this.zoomLevel) {
        
        const pixelsPerSecond = width / this.zoomLevel;
        const currentTimePosition = (currentTime - this.offsetSeconds) * pixelsPerSecond;
        
        this.ctx.fillStyle = '#4ecdc4';
        for (let i = 0; i < visibleSamples; i++) {
          const x = drawOffsetPixels + i * barWidth;
          if (x > currentTimePosition || x < 0 || x >= width) continue;
          
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
    
    // Draw red playhead line in center
    const playheadX = width / 2;
    
    this.ctx.strokeStyle = '#ff4757';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(playheadX, 0);
    this.ctx.lineTo(playheadX, height);
    this.ctx.stroke();
    
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
        
    // Draw red playhead line in center
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
      playhead.style.left = '50%';
      playhead.style.opacity = deck.isPlaying ? '1' : '0.7';
    } else {
      playhead.style.left = '50%';
      playhead.style.opacity = '0.3';
    }
  }

  startAnimation() {
    // Don't start if already animating
    if (this.animationId) return;
    
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