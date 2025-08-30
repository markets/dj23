class Deck {
  constructor(deckId, audioContext) {
      this.deckId = deckId;
      this.audioContext = audioContext;
      this.audioSource = null;
      this.audioBuffer = null;
      this.gainNode = null;
      this.lowEQ = null;
      this.midEQ = null;
      this.highEQ = null;
      this.isPlaying = false;
      this.currentTime = 0;
      this.startTime = 0;
      this.playbackRate = 1;

      // Advanced features
      this.analyzer = null;
      this.bpm = 0;
      this.waveformData = null;
      this.beatGridPositions = [];
      this.hotCues = [null, null, null, null]; // 4 hot cues
      this.loopIn = null;
      this.loopOut = null;
      this.loopActive = false;
      this.loopSize = 4; // 4 beats by default

      // Sync-related properties
      this.isSynced = false;
      this.syncSource = null;

      // Animation frame for UI updates
      this.animationFrame = null;

      // DOM elements
      this.loadTrackBtn = document.getElementById(`load-track-btn-${deckId}`);
      this.trackInput = document.getElementById(`track-input-${deckId}`);
      this.playBtn = document.getElementById(`play${deckId}`);
      this.cueBtn = document.getElementById(`cue${deckId}`);
      this.syncBtn = document.getElementById(`sync${deckId}`);
      this.pitchSlider = document.getElementById(`pitch${deckId}`);
      this.pitchDisplay = document.getElementById(`pitch-display-${deckId}`);
      this.pitchBendMinusBtn = document.getElementById(`pitch-bend-minus-${deckId}`);
      this.pitchBendPlusBtn = document.getElementById(`pitch-bend-plus-${deckId}`);
      this.pitchResetBtn = document.getElementById(`pitch-reset-${deckId}`);
      this.volumeSlider = document.getElementById(`volume${deckId}`);
      this.lowEQKnob = document.getElementById(`low${deckId}`);
      this.midEQKnob = document.getElementById(`mid${deckId}`);
      this.highEQKnob = document.getElementById(`high${deckId}`);
      this.vinylElement = document.getElementById(`vinyl${deckId}`);
      this.waveformElement = document.getElementById(`waveform${deckId}`);
      this.playheadElement = document.getElementById(`playhead${deckId}`);
      this.beatGridElement = document.getElementById(`beat-grid-${deckId}`);
      this.bpmValueElement = document.getElementById(`bpm-value-${deckId}`);
      this.trackTitleElement = document.getElementById(`track-title-${deckId}`);
      this.trackArtistElement = document.getElementById(`track-artist-${deckId}`);
      this.levelMeterElement = document.getElementById(`level-meter-${deckId}`);

      // Loop controls
      this.loopInBtn = document.getElementById(`loop-in-${deckId}`);
      this.loopOutBtn = document.getElementById(`loop-out-${deckId}`);
      this.loopActiveBtn = document.getElementById(`loop-active-${deckId}`);
      this.loopHalfBtn = document.getElementById(`loop-half-${deckId}`);
      this.loopDoubleBtn = document.getElementById(`loop-double-${deckId}`);

      // Hot cue buttons
      this.hotCueButtons = document.querySelectorAll(`.hot-cue[data-deck="${deckId}"]`);

      // Initialize track analyzer
      this.trackAnalyzer = new AudioAnalyzer(this.audioContext);

      this.init();
  }

  init() {
      // Initialize Web Audio API
      try {

          // Create audio nodes
          this.gainNode = this.audioContext.createGain();

          // Create analyzer node for level meter
          this.analyzer = this.audioContext.createAnalyser();
          this.analyzer.fftSize = 256;

          // Create EQ (3-band)
          this.lowEQ = this.audioContext.createBiquadFilter();
          this.lowEQ.type = 'lowshelf';
          this.lowEQ.frequency.value = 320;

          this.midEQ = this.audioContext.createBiquadFilter();
          this.midEQ.type = 'peaking';
          this.midEQ.frequency.value = 1000;
          this.midEQ.Q.value = 0.5;

          this.highEQ = this.audioContext.createBiquadFilter();
          this.highEQ.type = 'highshelf';
          this.highEQ.frequency.value = 3200;

          // Connect nodes
          this.lowEQ.connect(this.midEQ);
          this.midEQ.connect(this.highEQ);
          this.highEQ.connect(this.gainNode);
          this.gainNode.connect(this.analyzer);

          // Set initial values
          this.gainNode.gain.value = this.volumeSlider.value / 100;

          // Add event listeners
          this.setupEventListeners();

          // Start the animation loop for UI updates
          this.updateUI();

      } catch (e) {
          console.error('Web Audio API is not supported in this browser', e);
      }
  }

  setupEventListeners() {
      // Load Track Button
      this.loadTrackBtn.addEventListener('click', () => {
          this.trackInput.click();
      });

      // Track Input Change
      this.trackInput.addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (file) {
              this.loadTrack(file);
          }
      });

      // Listen for track load events from library
      document.addEventListener('loadTrackToDeck', (e) => {
          if (e.detail.deckId === this.deckId && e.detail.track) {
              // Get file from the track object
              const file = e.detail.track.file;
              if (file) {
                  this.loadTrack(file, e.detail.track);
              }
          }
      });

      // Play Button
      this.playBtn.addEventListener('click', () => {
          this.togglePlay();
      });

      // Cue Button
      this.cueBtn.addEventListener('click', () => {
          this.cue();
      });

      // Sync Button
      this.syncBtn.addEventListener('click', () => {
          this.toggleSync();
      });

      // Pitch Slider
      this.pitchSlider.addEventListener('input', (e) => {
          const pitchValue = parseFloat(e.target.value);
          this.setPitch(pitchValue);
      });

      // Pitch Bend Buttons
      this.pitchBendMinusBtn.addEventListener('mousedown', () => {
          this.startPitchBend(-1);
      });
      this.pitchBendMinusBtn.addEventListener('mouseup', () => {
          this.stopPitchBend();
      });
      this.pitchBendMinusBtn.addEventListener('mouseleave', () => {
          this.stopPitchBend();
      });

      this.pitchBendPlusBtn.addEventListener('mousedown', () => {
          this.startPitchBend(1);
      });
      this.pitchBendPlusBtn.addEventListener('mouseup', () => {
          this.stopPitchBend();
      });
      this.pitchBendPlusBtn.addEventListener('mouseleave', () => {
          this.stopPitchBend();
      });

      // Pitch Reset
      this.pitchResetBtn.addEventListener('click', () => {
          this.resetPitch();
      });

      // Volume Slider
      this.volumeSlider.addEventListener('input', (e) => {
          const volumeValue = e.target.value / 100;
          this.setVolume(volumeValue);
      });

      // EQ Knobs
      this.lowEQKnob.addEventListener('input', (e) => {
          const eqValue = parseFloat(e.target.value);
          this.setEQ('low', eqValue);

          // Update display
          const displayElement = e.target.nextElementSibling;
          displayElement.textContent = `${eqValue > 0 ? '+' : ''}${eqValue} dB`;
      });

      this.midEQKnob.addEventListener('input', (e) => {
          const eqValue = parseFloat(e.target.value);
          this.setEQ('mid', eqValue);

          // Update display
          const displayElement = e.target.nextElementSibling;
          displayElement.textContent = `${eqValue > 0 ? '+' : ''}${eqValue} dB`;
      });

      this.highEQKnob.addEventListener('input', (e) => {
          const eqValue = parseFloat(e.target.value);
          this.setEQ('high', eqValue);

          // Update display
          const displayElement = e.target.nextElementSibling;
          displayElement.textContent = `${eqValue > 0 ? '+' : ''}${eqValue} dB`;
      });

      // Loop Controls
      this.loopInBtn.addEventListener('click', () => {
          this.setLoopIn();
      });

      this.loopOutBtn.addEventListener('click', () => {
          this.setLoopOut();
      });

      this.loopActiveBtn.addEventListener('click', () => {
          this.toggleLoop();
      });

      this.loopHalfBtn.addEventListener('click', () => {
          this.changeLoopSize(0.5);
      });

      this.loopDoubleBtn.addEventListener('click', () => {
          this.changeLoopSize(2);
      });

      // Hot Cue Buttons
      this.hotCueButtons.forEach(button => {
          const cueIndex = parseInt(button.dataset.cue) - 1;

          // Set cue on click with shift, jump to cue without shift
          button.addEventListener('click', (e) => {
              if (e.shiftKey) {
                  this.setHotCue(cueIndex);
              } else {
                  this.jumpToHotCue(cueIndex);
              }
          });

          // Delete cue with alt+click
          button.addEventListener('contextmenu', (e) => {
              e.preventDefault();
              this.deleteHotCue(cueIndex);
          });
      });

      // Vinyl Scratch and Seek
      this.vinylElement.addEventListener('mousedown', this.handleScratchStart.bind(this));

      // Waveform Seek
      this.waveformElement.addEventListener('click', this.handleWaveformSeek.bind(this));
  }

  async loadTrack(file, trackMetadata = null) {
      try {
          // Show loading state
          this.trackTitleElement.textContent = 'Loading...';
          this.trackArtistElement.textContent = '';

          // Analyze the track
          const analysis = await this.trackAnalyzer.analyzeTrack(file);

          // Store the results
          this.audioBuffer = analysis.buffer;
          this.bpm = analysis.bpm;
          this.waveformData = analysis.waveformData;

          // Reset playback state
          this.currentTime = 0;
          this.playbackRate = 1;
          this.isPlaying = false;
          this.loopIn = null;
          this.loopOut = null;
          this.loopActive = false;
          this.hotCues = [null, null, null, null];

          // Generate beat grid
          this.generateBeatGrid(analysis.bpm, analysis.buffer.duration);

          // Draw waveform
          this.drawWaveform(this.waveformData);

          // Reset UI elements
          this.playBtn.innerHTML = '<i class="fas fa-play"></i>';
          this.vinylElement.classList.remove('playing');
          this.resetPitch();

          // Update track info display
          if (trackMetadata) {
              this.trackTitleElement.textContent = trackMetadata.title;
              this.trackArtistElement.textContent = trackMetadata.artist;

              // If BPM wasn't detected or is very different from metadata, use metadata BPM
              if (trackMetadata.bpm && (!this.bpm || Math.abs(this.bpm - trackMetadata.bpm) > 5)) {
                  this.bpm = trackMetadata.bpm;
                  this.generateBeatGrid(this.bpm, analysis.buffer.duration);
              }

              // Update metadata with detected BPM if needed
              if (this.bpm && (!trackMetadata.bpm || Math.abs(this.bpm - trackMetadata.bpm) > 5)) {
                  const updatedMetadata = {
                      ...trackMetadata,
                      bpm: this.bpm,
                      duration: analysis.buffer.duration
                  };

                  // Dispatch event to update library
                  const updateEvent = new CustomEvent('updateTrackMetadata', {
                      detail: { trackId: trackMetadata.id, metadata: updatedMetadata }
                  });
                  document.dispatchEvent(updateEvent);
              }
          } else {
              // Extract filename without extension
              const fileName = file.name.replace(/\.[^/.]+$/, "");
              this.trackTitleElement.textContent = fileName;
              this.trackArtistElement.textContent = 'Unknown Artist';
          }

          // Update BPM display
          this.bpmValueElement.textContent = this.bpm.toFixed(1);

          // Reset hot cue buttons
          this.updateHotCueButtons();

          // Reset loop buttons
          this.loopInBtn.classList.remove('active');
          this.loopOutBtn.classList.remove('active');
          this.loopActiveBtn.classList.remove('active');

          console.log(`Track loaded on Deck ${this.deckId} - BPM: ${this.bpm}`);

      } catch (error) {
          console.error('Error loading track:', error);
          this.trackTitleElement.textContent = 'Error loading track';
      }
  }

  togglePlay() {
      if (!this.audioBuffer) return;

      if (this.isPlaying) {
          // Stop playback
          this.stop();
          this.playBtn.innerHTML = '<i class="fas fa-play"></i>';
          this.vinylElement.classList.remove('playing');
      } else {
          // Start playback
          this.play();
          this.playBtn.innerHTML = '<i class="fas fa-pause"></i>';
          this.vinylElement.classList.add('playing');
      }

      this.isPlaying = !this.isPlaying;
  }

  play() {
      if (!this.audioBuffer) return;

      // Create new source
      this.audioSource = this.audioContext.createBufferSource();
      this.audioSource.buffer = this.audioBuffer;
      this.audioSource.playbackRate.value = this.playbackRate;
      this.audioSource.loop = this.loopActive;

      // Set loop points if active
      if (this.loopActive && this.loopIn !== null && this.loopOut !== null) {
          this.audioSource.loopStart = this.loopIn;
          this.audioSource.loopEnd = this.loopOut;
      }

      // Connect source to audio chain
      this.audioSource.connect(this.lowEQ);

      // Connect analyzer to destination (output)
      this.analyzer.connect(this.audioContext.destination);

      // Start playback from current time
      this.audioSource.start(0, this.currentTime);
      this.startTime = this.audioContext.currentTime - this.currentTime;

      // Set up ended event
      this.audioSource.onended = () => {
          // Only handle this if it's not a stop() call
          if (this.isPlaying && !this.loopActive) {
              this.isPlaying = false;
              this.playBtn.innerHTML = '<i class="fas fa-play"></i>';
              this.vinylElement.classList.remove('playing');
          }
      };
  }

  stop() {
      if (this.audioSource) {
          this.audioSource.stop();
          // Store current time for resuming
          this.currentTime = this.audioContext.currentTime - this.startTime;

          // Prevent going beyond track length
          if (this.audioBuffer && this.currentTime > this.audioBuffer.duration) {
              this.currentTime = 0;
          }

          // Disconnect analyzer
          this.analyzer.disconnect();
      }
  }

  cue() {
      // Stop playback and reset to beginning or cue point
      if (this.audioSource) {
          this.stop();
      }

      this.currentTime = 0;
      this.isPlaying = false;
      this.playBtn.innerHTML = '<i class="fas fa-play"></i>';
      this.vinylElement.classList.remove('playing');
  }

  toggleSync() {
      if (!this.audioBuffer) return;
      
      this.isSynced = !this.isSynced;
      
      if (this.isSynced) {
          this.syncBtn.classList.add('active');
          
          // Get master tempo
          const masterBPM = parseFloat(document.getElementById('master-bpm').textContent);
          
          // Calculate pitch adjustment needed
          if (this.bpm > 0 && masterBPM > 0) {
              const pitchAdjustment = ((masterBPM / this.bpm) - 1) * 100;
              
              // Apply pitch adjustment (within slider range)
              const clampedAdjustment = Math.max(-8, Math.min(8, pitchAdjustment));
              this.pitchSlider.value = clampedAdjustment;
              this.setPitch(clampedAdjustment);
          }
          
          // Dispatch sync event
          const syncEvent = new CustomEvent('deckSync', {
              detail: { deckId: this.deckId, sync: true }
          });
          document.dispatchEvent(syncEvent);
      } else {
          this.syncBtn.classList.remove('active');
          
          // Dispatch sync off event
          const syncEvent = new CustomEvent('deckSync', {
              detail: { deckId: this.deckId, sync: false }
          });
          document.dispatchEvent(syncEvent);
      }
  }
  
  setPitch(value) {
      // Convert percentage to playback rate (-8% to +8%)
      this.playbackRate = 1 + (value / 100);
      
      // Update pitch display
      this.pitchDisplay.textContent = `${value.toFixed(1)}%`;
      
      // Update effective BPM display
      if (this.bpm > 0) {
          const effectiveBPM = this.bpm * this.playbackRate;
          this.bpmValueElement.textContent = effectiveBPM.toFixed(1);
      }
      
      if (this.audioSource && this.isPlaying) {
          // Update current playback if playing
          this.audioSource.playbackRate.value = this.playbackRate;
      }
  }
  
  resetPitch() {
      this.pitchSlider.value = 0;
      this.setPitch(0);
  }
  
  startPitchBend(direction) {
      // Temporarily adjust pitch for beat matching
      // direction: 1 for faster, -1 for slower
      const pitchBendAmount = direction * 3; // 3% change
      
      // Store original pitch value
      this.originalPitch = parseFloat(this.pitchSlider.value);
      
      // Apply temporary bend
      this.setPitch(this.originalPitch + pitchBendAmount);
      
      // Visual feedback
      if (direction > 0) {
          this.pitchBendPlusBtn.classList.add('active');
      } else {
          this.pitchBendMinusBtn.classList.add('active');
      }
  }
  
  stopPitchBend() {
      // Restore original pitch
      if (this.originalPitch !== undefined) {
          this.setPitch(this.originalPitch);
          this.originalPitch = undefined;
      }
      
      // Remove visual feedback
      this.pitchBendPlusBtn.classList.remove('active');
      this.pitchBendMinusBtn.classList.remove('active');
  }
  
  setVolume(value) {
      if (this.gainNode) {
          this.gainNode.gain.value = value;
      }
  }
  
  setEQ(band, value) {
      // Convert value from -12 to +12 dB
      const gainValue = value;
      
      switch (band) {
          case 'low':
              this.lowEQ.gain.value = gainValue;
              break;
          case 'mid':
              this.midEQ.gain.value = gainValue;
              break;
          case 'high':
              this.highEQ.gain.value = gainValue;
              break;
      }
  }
  
  // Hot Cue Methods
  setHotCue(index) {
      if (!this.audioBuffer) return;
      
      // Get current position
      const currentPosition = this.isPlaying 
          ? this.audioContext.currentTime - this.startTime 
          : this.currentTime;
          
      // Store cue point
      this.hotCues[index] = currentPosition;
      
      // Update button state
      this.updateHotCueButtons();
  }
  
  jumpToHotCue(index) {
      if (!this.audioBuffer || this.hotCues[index] === null) return;
      
      // Jump to cue point
      const wasPlaying = this.isPlaying;
      
      if (wasPlaying) {
          this.stop();
      }
      
      this.currentTime = this.hotCues[index];
      
      if (wasPlaying) {
          this.play();
      }
  }
  
  deleteHotCue(index) {
      if (!this.audioBuffer || this.hotCues[index] === null) return;
      
      // Clear cue point
      this.hotCues[index] = null;
      
      // Update button state
      this.updateHotCueButtons();
  }
  
  updateHotCueButtons() {
      // Update hot cue button appearance based on set cues
      this.hotCueButtons.forEach((button, index) => {
          if (this.hotCues[index] !== null) {
              button.classList.add('active');
          } else {
              button.classList.remove('active');
          }
      });
  }
  
  // Loop Methods
  setLoopIn() {
      if (!this.audioBuffer) return;
      
      // Get current position
      const currentPosition = this.isPlaying 
          ? this.audioContext.currentTime - this.startTime 
          : this.currentTime;
          
      // Store loop in point
      this.loopIn = currentPosition;
      
      // Update button state
      this.loopInBtn.classList.add('active');
      
      // If loop out is already set, activate loop
      if (this.loopOut !== null) {
          this.activateLoop();
      }
  }
  
  setLoopOut() {
      if (!this.audioBuffer || this.loopIn === null) return;
      
      // Get current position
      const currentPosition = this.isPlaying 
          ? this.audioContext.currentTime - this.startTime 
          : this.currentTime;
          
      // Store loop out point
      this.loopOut = currentPosition;
      
      // Update button state
      this.loopOutBtn.classList.add('active');
      
      // Activate loop
      this.activateLoop();
  }
  
  activateLoop() {
      if (!this.audioBuffer || this.loopIn === null || this.loopOut === null) return;
      
      // Make sure loop out is after loop in
      if (this.loopOut <= this.loopIn) {
          // Calculate a default loop length (4 beats)
          const beatLength = 60 / this.bpm;
          this.loopOut = this.loopIn + (beatLength * 4);
      }
      
      // Enable loop
      this.loopActive = true;
      this.loopActiveBtn.classList.add('active');
      
      // If currently playing, update source
      if (this.isPlaying) {
          // Need to restart with loop settings
          const currentPosition = this.audioContext.currentTime - this.startTime;
          
          // If we're past the loop out point, jump to loop in
          if (currentPosition >= this.loopOut) {
              this.stop();
              this.currentTime = this.loopIn;
              this.play();
          } else {
              this.stop();
              this.play();
          }
      }
  }
  
  toggleLoop() {
      if (!this.audioBuffer) return;
      
      if (this.loopActive) {
          // Disable loop
          this.loopActive = false;
          this.loopActiveBtn.classList.remove('active');
          
          // If currently playing, update source
          if (this.isPlaying) {
              this.stop();
              this.play();
          }
      } else if (this.loopIn !== null && this.loopOut !== null) {
          // Enable existing loop
          this.activateLoop();
      } else {
          // Create automatic loop based on current position and BPM
          const currentPosition = this.isPlaying 
              ? this.audioContext.currentTime - this.startTime 
              : this.currentTime;
              
          // Calculate beat length
          const beatLength = 60 / this.bpm;
          
          // Set loop in at nearest beat before current position
          const nearestBeat = Math.floor(currentPosition / beatLength) * beatLength;
          this.loopIn = nearestBeat;
          
          // Set loop out 4 beats later
          this.loopOut = nearestBeat + (beatLength * this.loopSize);
          
          // Update button states
          this.loopInBtn.classList.add('active');
          this.loopOutBtn.classList.add('active');
          
          // Activate loop
          this.activateLoop();
      }
  }
  
  changeLoopSize(multiplier) {
      if (!this.audioBuffer || !this.loopActive || this.loopIn === null || this.loopOut === null) return;
      
      // Calculate current loop length
      const currentLoopLength = this.loopOut - this.loopIn;
      
      // Apply multiplier
      const newLoopLength = currentLoopLength * multiplier;
      
      // Update loop out point
      this.loopOut = this.loopIn + newLoopLength;
      
      // If currently playing, update source
      if (this.isPlaying) {
          this.stop();
          this.play();
      }
  }
  
  handleScratchStart(e) {
      if (!this.audioBuffer) return;
      
      const initialY = e.clientY;
      let previousY = initialY;
      
      const handleScratchMove = (moveEvent) => {
          const currentY = moveEvent.clientY;
          const diff = currentY - previousY;
          
          // Adjust current time based on scratch movement
          if (this.audioBuffer) {
              // Slower movement for more precise scratching
              const scratchOffset = diff * 0.01;
              
              if (this.isPlaying) {
                  this.stop();
              }
              
              // Update time
              this.currentTime = Math.max(0, Math.min(this.audioBuffer.duration, this.currentTime + scratchOffset));
              
              // Update vinyl rotation
              const rotation = (this.currentTime / this.audioBuffer.duration) * 360;
              this.vinylElement.style.transform = `rotate(${rotation}deg)`;
          }
          
          previousY = currentY;
      };
      
      const handleScratchEnd = () => {
          document.removeEventListener('mousemove', handleScratchMove);
          document.removeEventListener('mouseup', handleScratchEnd);
          this.vinylElement.style.cursor = 'grab';
          
          // Resume playback if was playing
          if (this.isPlaying) {
              this.play();
          }
      };
      
      document.addEventListener('mousemove', handleScratchMove);
      document.addEventListener('mouseup', handleScratchEnd);
      this.vinylElement.style.cursor = 'grabbing';
  }
  
  handleWaveformSeek(e) {
      if (!this.audioBuffer || !this.waveformElement) return;
      
      // Calculate seek position
      const rect = this.waveformElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const seekPercentage = x / rect.width;
      
      // Calculate time position
      const seekTime = seekPercentage * this.audioBuffer.duration;
      
      // Seek to position
      const wasPlaying = this.isPlaying;
      
      if (wasPlaying) {
          this.stop();
      }
      
      this.currentTime = seekTime;
      
      if (wasPlaying) {
          this.play();
      }
  }
  
  drawWaveform(waveformData) {
      if (!this.waveformElement) return;
      
      // Create canvas for waveform
      const canvas = document.createElement('canvas');
      canvas.width = this.waveformElement.clientWidth;
      canvas.height = this.waveformElement.clientHeight;
      
      this.waveformElement.innerHTML = '';
      this.waveformElement.appendChild(canvas);
      
      const ctx = canvas.getContext('2d');
      const width = canvas.width;
      const height = canvas.height;
      const centerY = height / 2;
      
      // Draw background
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, width, height);
      
      // Draw waveform
      ctx.lineWidth = 1;
      
      // Calculate scale to fit all data points
      const scaleX = width / waveformData.length;
      
      // Draw top half (peaks)
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      
      for (let i = 0; i < waveformData.length; i++) {
          const x = i * scaleX;
          const y = centerY - (waveformData[i].max * centerY * 0.95);
          ctx.lineTo(x, y);
      }
      
      // Complete the path back to center
      ctx.lineTo(width, centerY);
      ctx.closePath();
      
      // Fill with gradient
      const gradient1 = ctx.createLinearGradient(0, 0, 0, centerY);
      gradient1.addColorStop(0, 'rgba(0, 180, 255, 0.8)');
      gradient1.addColorStop(1, 'rgba(0, 180, 255, 0.2)');
      ctx.fillStyle = gradient1;
      ctx.fill();
      
      // Draw bottom half (inverted peaks)
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      
      for (let i = 0; i < waveformData.length; i++) {
          const x = i * scaleX;
          const y = centerY + (waveformData[i].min * centerY * -0.95); // Invert
          ctx.lineTo(x, y);
      }
      
      // Complete the path back to center
      ctx.lineTo(width, centerY);
      ctx.closePath();
      
      // Fill with gradient
      const gradient2 = ctx.createLinearGradient(0, centerY, 0, height);
      gradient2.addColorStop(0, 'rgba(0, 180, 255, 0.2)');
      gradient2.addColorStop(1, 'rgba(0, 180, 255, 0.8)');
      ctx.fillStyle = gradient2;
      ctx.fill();
  }
  
  generateBeatGrid(bpm, duration) {
      if (!bpm || !duration) return;
      
      // Clear existing beat grid
      this.beatGridPositions = [];
      this.beatGridElement.innerHTML = '';
      
      // Calculate beat interval in seconds
      const beatInterval = 60 / bpm;
      
      // Generate beat positions
      let currentBeat = 0;
      while (currentBeat < duration) {
          this.beatGridPositions.push(currentBeat);
          currentBeat += beatInterval;
      }
      
      // Draw beat grid markers
      const containerWidth = this.waveformElement.clientWidth;
      
      this.beatGridPositions.forEach((position, index) => {
          const isMeasureStart = index % 4 === 0;
          const marker = document.createElement('div');
          marker.className = `beat-marker ${isMeasureStart ? 'measure-start' : ''}`;
          marker.style.left = `${(position / duration) * 100}%`;
          this.beatGridElement.appendChild(marker);
      });
  }
  
  updateUI() {
      // Update UI elements based on current state
      if (!this.audioBuffer) {
          cancelAnimationFrame(this.animationFrame);
          this.animationFrame = requestAnimationFrame(this.updateUI.bind(this));
          return;
      }
      
      // Update playhead position
      if (this.isPlaying) {
          const currentTime = this.audioContext.currentTime - this.startTime;
          const position = (currentTime / this.audioBuffer.duration) * 100;
          
          // Update playhead
          this.playheadElement.style.left = `${position}%`;
          
          // Update vinyl rotation
          const rotation = (currentTime / this.audioBuffer.duration) * 360;
          this.vinylElement.style.transform = `rotate(${rotation}deg)`;
          
          // Handle loop
          if (this.loopActive && this.loopIn !== null && this.loopOut !== null) {
              if (currentTime >= this.loopOut) {
                  // Jump back to loop in point
                  this.stop();
                  this.currentTime = this.loopIn;
                  this.play();
              }
          }
          
          // Update level meter
          this.updateLevelMeter();
      } else {
          // Update playhead for non-playing state
          const position = (this.currentTime / this.audioBuffer.duration) * 100;
          this.playheadElement.style.left = `${position}%`;
      }
      
      this.animationFrame = requestAnimationFrame(this.updateUI.bind(this));
  }
  
  updateLevelMeter() {
      // Get audio data for level meter
      const bufferLength = this.analyzer.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      this.analyzer.getByteFrequencyData(dataArray);
      
      // Calculate average level
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
      }
      const average = sum / bufferLength;
      
      // Update level meter display (0-100%)
      const level = Math.min(100, average * 1.5); // Scale for better visual
      this.levelMeterElement.querySelector('.level-indicator').style.height = `${level}%`;
  }
  
  getAudioNode() {
      return this.analyzer;
  }
}
