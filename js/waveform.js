class BaseWaveformRenderer {
  constructor(canvasId, deckId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.deckId = deckId;
    this.waveformData = null;
    this.animationId = null;
  }

  setupCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * window.devicePixelRatio;
    this.canvas.height = rect.height * window.devicePixelRatio;
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
  }

  loadWaveformData(audioBuffer) {
    if (!audioBuffer) return;
    
    const channelData = audioBuffer.getChannelData(0);
    const samples = 1000; // Number of waveform points
    const blockSize = Math.floor(channelData.length / samples);
    const waveformData = [];

    for (let i = 0; i < samples; i++) {
      const start = i * blockSize;
      const end = start + blockSize;
      let sum = 0;
      let peak = 0; // Track peak amplitude for energy calculation

      for (let j = start; j < end && j < channelData.length; j++) {
        const amplitude = Math.abs(channelData[j]);
        sum += amplitude;
        peak = Math.max(peak, amplitude);
      }

      const average = sum / blockSize;
      
      // Enhanced energy calculation: Combine average and peak for better beat emphasis
      const energyFactor = Math.pow(average + (peak * 0.2), 1.2);
      
      waveformData.push(energyFactor);
    }

    this.waveformData = waveformData;
  }

  async generateWaveform(audioBuffer) {
    this.loadWaveformData(audioBuffer);
    this.render();
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
}

class WaveformRenderer extends BaseWaveformRenderer {
  constructor(canvasId, deckId) {
    super(canvasId, deckId);        
    this.setupCanvas();
    this.setupEventListeners();
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
      const barHeight = this.waveformData[i] * centerY;
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
                
        const barHeight = this.waveformData[i] * centerY;
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
    
    // Draw CUE 1
    if (deck.cuePoints[1] !== null) {
      this.drawSingleCuePoint(deck.cuePoints[1], duration, width, height, 'CUE 1', 14);
    }
    
    // Draw CUE 2
    if (deck.cuePoints[2] !== null) {
      this.drawSingleCuePoint(deck.cuePoints[2], duration, width, height, 'CUE 2', 28);
    }
  }

  drawSingleCuePoint(cueTime, duration, width, height, label, textY) {
    const cuePointColor = '#fff';
    const cuePosition = (cueTime / duration) * width;
    
    // Draw cue line
    this.ctx.strokeStyle = cuePointColor;
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([]);
    this.ctx.beginPath();
    this.ctx.moveTo(cuePosition, 0);
    this.ctx.lineTo(cuePosition, height);
    this.ctx.stroke();
    
    // Improved text positioning with background for better readability
    this.ctx.font = 'bold 10px Inter';
    const textMetrics = this.ctx.measureText(label);
    
    // Simple positioning: always render text to the right
    const textOffset = 8;
    const textWidth = textMetrics.width + 4;
    const textX = cuePosition + textOffset;
    
    // Draw text background for better readability
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this.ctx.fillRect(textX - 2, textY - 10, textWidth, 12);
    
    // Draw text
    this.ctx.fillStyle = cuePointColor;
    this.ctx.textAlign = 'left';
    this.ctx.fillText(label, textX, textY);
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
      playhead.style.opacity = deck.isPlaying ? '1' : '0.7';
    } else {
      playhead.style.left = '0%';
      playhead.style.opacity = '0.3';
    }
  }
}

class ZoomedWaveformRenderer extends BaseWaveformRenderer {
  constructor(canvasId, deckId) {
    super(canvasId, deckId);
    this.zoomLevel = 30; // Shows about 30 seconds of audio for beat matching
    this.offsetSeconds = 0; // Current offset from track start
        
    this.setupCanvas();
    this.setupEventListeners();
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

    // Mouse wheel zoom functionality
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      
      if (!this.waveformData) return;
      
      // Determine zoom direction (zoom out on wheel down, zoom in on wheel up)
      const direction = e.deltaY > 0 ? 1 : -1;
      this.zoom(direction);
    });

    // Setup zoom button event listeners
    document.getElementById('zoomInA').addEventListener('click', () => {
      this.zoom(-5);
    });
    document.getElementById('zoomOutA').addEventListener('click', () => {
      this.zoom(5);
    });
    document.getElementById('zoomInB').addEventListener('click', () => {
      this.zoom(-5);
    });
    document.getElementById('zoomOutB').addEventListener('click', () => {
      this.zoom(5);
    });

    window.addEventListener('resize', () => {
      this.setupCanvas();
      this.render();
    });
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
      
      const barHeight = this.waveformData[sampleIndex] * centerY * 1.1;
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
                
          const barHeight = this.waveformData[sampleIndex] * centerY * 1.1;
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

  // Method to handle zoom changes from buttons
  zoom(direction) {
    if (!this.waveformData) return;
    
    const zoomSensitivity = 0.4;
    const minZoom = 8;
    const maxZoom = 80;
    
    // direction: 1 for zoom in (-), -1 for zoom out (+)
    const zoomDelta = direction * zoomSensitivity;
    const newZoomLevel = Math.max(minZoom, Math.min(maxZoom, this.zoomLevel + zoomDelta));
    
    // Only update if zoom level actually changed
    if (newZoomLevel !== this.zoomLevel) {
      this.zoomLevel = newZoomLevel;
      // Re-render with new zoom level
      this.render();
      console.log(`Beat waveform zoom changed to ${this.zoomLevel.toFixed(1)} seconds on deck ${this.deckId}`);
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
