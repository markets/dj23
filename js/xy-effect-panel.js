class XYEffectPanel {
  constructor(deckId, audioEngine) {
    this.deckId = deckId;
    this.audioEngine = audioEngine;
    this.isActive = false;
    this.isDragging = false;
    
    // XY position normalized from -1 to 1
    this.xPosition = 0;
    this.yPosition = 0;
    
    // Current effect
    this.selectedEffect = 'delay';
    
    // Persistent XY positions for each effect
    this.effectPositions = {
      delay: { x: 0, y: 0 },
      phaser: { x: 0, y: 0 },
      flanger: { x: 0, y: 0 },
      filter: { x: 0, y: 0 }
    };
    
    // Persistent filter type configuration
    this.filterType = 'lowpass'; // Default to lowpass
    
    // Track last applied parameter values to prevent redundant updates
    this.lastAppliedValues = {
      delay: { x: null, y: null },
      phaser: { x: null, y: null },
      flanger: { x: null, y: null },
      filter: { x: null, y: null }
    };
    
    // Update the UI to reflect the initial state
    setTimeout(() => {
      if (this.selectedEffect === 'filter') {
        this.updateFilterTypeButtons();
      }
    }, 0);
    
    // Default values for reset functionality
    this.defaultValues = {
      x: 0,
      y: 0
    };
    
    // Note values for delay quantization
    this.noteValues = [
      { name: '1/64', multiplier: 1/64 },
      { name: '1/32', multiplier: 1/32 },
      { name: '1/16', multiplier: 1/16 },
      { name: '1/8', multiplier: 1/8 },
      { name: '1/4', multiplier: 1/4 },
      { name: '1/2', multiplier: 1/2 },
      { name: '1', multiplier: 1 }
    ];
    
    // Parameter smoothing for audio glitch prevention
    this.smoothingFactor = 0.3; // Lower = smoother, higher = more responsive
    this.lastUpdateTime = 0;
    this.updateThrottleMs = 8; // ~120fps max update rate for smoother interaction
    
    // Effect parameter configurations with fixed X/Y mappings
    this.effectConfigs = {
      delay: {
        displayName: 'Delay',
        xParam: {
          name: 'Delay Time',
          range: [0, 6], // Index range for note values (0 = 1/64, 6 = 1)
          default: 2,    // Default to 1/16 note
          unit: '',      // Will show note value
          effectMethod: 'setDelayTime',
          quantized: true
        },
        yParam: {
          name: 'Feedback',
          range: [0, 0.9],
          default: 0.3,
          unit: '',
          effectMethod: 'setDelayFeedback',
          quantized: false
        }
      },
      phaser: {
        displayName: 'Phaser',
        xParam: {
          name: 'LFO Rate',
          range: [0.08, 2.0],
          default: 0.3,
          unit: 'Hz',
          effectMethod: 'setPhaserRate'
        },
        yParam: {
          name: 'Depth',
          range: [0, 1000],
          default: 600,
          unit: '',
          effectMethod: 'setPhaserDepth'
        }
      },
      flanger: {
        displayName: 'Flanger',
        xParam: {
          name: 'LFO Rate',
          range: [0.1, 5.0],
          default: 0.25,
          unit: 'Hz',
          effectMethod: 'setFlangerRate'
        },
        yParam: {
          name: 'Depth',
          range: [0.001, 0.020],
          default: 0.005,
          unit: '',
          effectMethod: 'setFlangerDepth'
        }
      },
      filter: {
        displayName: 'Filter',
        xParam: {
          name: 'Cutoff Freq',
          range: [100, 15000],
          default: 15000,
          unit: 'Hz',
          effectMethod: 'setFilterFrequency'
        },
        yParam: {
          name: 'Resonance',
          range: [0.1, 30],
          default: 1,
          unit: '',
          effectMethod: 'setFilterResonance'
        }
      }
    };
    
    this.initializePanel();
    this.setupEventListeners();
  }

  initializePanel() {
    // Create the XY panel container
    this.container = document.createElement('div');
    this.container.className = 'xy-effect-panel';
    this.container.innerHTML = `
      <div class="xy-panel-header">
        <label>XY Effects</label>
        <button class="xy-reset-btn" title="Reset to defaults">Reset</button>
      </div>
      <div class="xy-panel-controls">
        <div class="xy-effect-selector">
          <label>Effect:</label>
          <select class="xy-effect-select">
            ${Object.entries(this.effectConfigs).map(([key, config]) => 
              `<option value="${key}" ${key === this.selectedEffect ? 'selected' : ''}>${config.displayName}</option>`
            ).join('')}
          </select>
        </div>
        <div class="xy-filter-type-controls" style="display: ${this.selectedEffect === 'filter' ? 'block' : 'none'};">
          <div class="xy-filter-type-toggles">
            <button class="xy-filter-type-btn ${this.filterType === 'lowpass' ? 'active' : ''}" data-type="lowpass">LP</button>
            <button class="xy-filter-type-btn ${this.filterType === 'highpass' ? 'active' : ''}" data-type="highpass">HP</button>
          </div>
        </div>
      </div>
      <div class="xy-canvas-container">
        <canvas class="xy-canvas" width="200" height="200"></canvas>
        <div class="xy-axis-labels">
          <div class="xy-x-label">${this.getCurrentXParamName()}</div>
          <div class="xy-y-label">${this.getCurrentYParamName()}</div>
        </div>
      </div>
      <div class="xy-value-display">
        <span class="xy-x-value">X: ${this.getCurrentXValue()}</span>
        <span class="xy-y-value">Y: ${this.getCurrentYValue()}</span>
      </div>
    `;

    // Get references to elements
    this.canvas = this.container.querySelector('.xy-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.effectSelect = this.container.querySelector('.xy-effect-select');
    this.resetBtn = this.container.querySelector('.xy-reset-btn');
    this.xValueDisplay = this.container.querySelector('.xy-x-value');
    this.yValueDisplay = this.container.querySelector('.xy-y-value');
    this.xLabel = this.container.querySelector('.xy-x-label');
    this.yLabel = this.container.querySelector('.xy-y-label');
    this.filterTypeControls = this.container.querySelector('.xy-filter-type-controls');
    this.filterTypeBtns = this.container.querySelectorAll('.xy-filter-type-btn');

    this.updateCanvasSize();
    this.drawCanvas();
  }

  getCurrentXParamName() {
    const effect = this.effectConfigs[this.selectedEffect];
    return effect ? effect.xParam.name : 'X';
  }

  getCurrentYParamName() {
    const effect = this.effectConfigs[this.selectedEffect];
    return effect ? effect.yParam.name : 'Y';
  }

  getCurrentXValue() {
    const effect = this.effectConfigs[this.selectedEffect];
    if (!effect) return '0';
    
    const param = effect.xParam;
    
    // Special handling for quantized delay time
    if (param.quantized && this.selectedEffect === 'delay') {
      // Map from normalized position [-1, 1] to note index [0, 6]
      const zeroToOne = (this.xPosition + 1) / 2;
      const noteIndex = zeroToOne * (this.noteValues.length - 1);
      const quantizedIndex = Math.round(Math.max(0, Math.min(this.noteValues.length - 1, noteIndex)));
      
      // Ensure we have a valid note value
      if (quantizedIndex < 0 || quantizedIndex >= this.noteValues.length || !this.noteValues[quantizedIndex]) {
        return '1/16 (0.125s)'; // Fallback display
      }
      
      const noteValue = this.noteValues[quantizedIndex];
      
      // Get current BPM from the deck
      const deck = this.audioEngine.getDeck(this.deckId);
      const bpm = deck ? deck.getBPM() : 120;
      const beatDuration = 60 / bpm; // Duration of one beat in seconds
      const delayTime = beatDuration * noteValue.multiplier;
      
      return `${noteValue.name} (${delayTime.toFixed(3)}s)`;
    }
    
    const value = this.mapParameterValue(this.xPosition, param);
    const unit = param.unit;
    
    // Determine decimal places based on parameter type and value range
    let decimals = 0;
    if (unit === 'Hz' || unit === 's') {
      decimals = 2;
    } else if (value < 10) {
      decimals = 2; // Show 2 decimals for small values
    } else if (value < 100) {
      decimals = 1; // Show 1 decimal for medium values
    }
    
    return `${value.toFixed(decimals)}${unit}`;
  }

  getCurrentYValue() {
    const effect = this.effectConfigs[this.selectedEffect];
    if (!effect) return '0';
    
    const value = this.mapParameterValue(this.yPosition, effect.yParam);
    const unit = effect.yParam.unit;
    
    // Determine decimal places based on parameter type and value range
    let decimals = 0;
    if (unit === 'Hz' || unit === 's') {
      decimals = 2;
    } else if (value < 10) {
      decimals = 2; // Show 2 decimals for small values
    } else if (value < 100) {
      decimals = 1; // Show 1 decimal for medium values
    }
    
    return `${value.toFixed(decimals)}${unit}`;
  }

  setupEventListeners() {
    // Effect selection change
    this.effectSelect.addEventListener('change', (e) => {
      // Save current position for the old effect
      this.effectPositions[this.selectedEffect] = {
        x: this.xPosition,
        y: this.yPosition
      };
      
      // Switch to new effect
      this.selectedEffect = e.target.value;
      
      // Reset last applied values for the new effect to ensure parameters are applied
      this.lastAppliedValues[this.selectedEffect] = { x: null, y: null };
      
      // Load saved position for the new effect
      const savedPosition = this.effectPositions[this.selectedEffect];
      this.xPosition = savedPosition.x;
      this.yPosition = savedPosition.y;
      
      // Show/hide filter type controls
      const isFilter = this.selectedEffect === 'filter';
      this.filterTypeControls.style.display = isFilter ? 'block' : 'none';
      
      // Update filter type buttons if switching to filter
      if (isFilter) {
        this.updateFilterTypeButtons();
      }
      
      this.updateLabels();
      this.updateValueDisplay();
      this.applyEffectParametersSmooth();
      this.drawCanvas();
    });

    // Reset button
    this.resetBtn.addEventListener('click', () => {
      this.reset();
    });

    // Filter type button clicks
    this.filterTypeBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const newType = e.target.dataset.type;
        if (newType !== this.filterType) {
          this.setFilterType(newType);
        }
      });
    });

    // Canvas interaction
    this.setupCanvasInteraction();
  }

  setupCanvasInteraction() {
    const canvasContainer = this.container.querySelector('.xy-canvas-container');
    
    const startDrag = (e) => {
      this.isDragging = true;
      this.updatePositionFromEvent(e);
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd);
    };

    const onMouseMove = (e) => {
      if (this.isDragging) {
        e.preventDefault();
        this.updatePositionFromEvent(e);
      }
    };

    const onTouchMove = (e) => {
      if (this.isDragging) {
        e.preventDefault();
        this.updatePositionFromEvent(e.touches[0]);
      }
    };

    const onMouseUp = () => {
      this.isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };

    const onTouchEnd = () => {
      this.isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };

    canvasContainer.addEventListener('mousedown', startDrag);
    canvasContainer.addEventListener('touchstart', (e) => {
      e.preventDefault();
      startDrag(e.touches[0]);
    }, { passive: false });
  }

  updatePositionFromEvent(e) {
    // Throttle updates to prevent audio glitches
    const now = Date.now();
    if (now - this.lastUpdateTime < this.updateThrottleMs) {
      return;
    }
    this.lastUpdateTime = now;

    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Convert to normalized coordinates (-1 to 1)
    let newXPosition = Math.max(-1, Math.min(1, (x / rect.width) * 2 - 1));
    const newYPosition = Math.max(-1, Math.min(1, 1 - (y / rect.height) * 2)); // Flip Y axis
    
    // Quantize X position for delay time
    if (this.selectedEffect === 'delay') {
      const effect = this.effectConfigs[this.selectedEffect];
      if (effect && effect.xParam.quantized) {
        // Map to 0-1 range, then to note index, quantize, then back to -1 to 1
        const zeroToOne = (newXPosition + 1) / 2;
        const noteIndex = zeroToOne * (this.noteValues.length - 1);
        const quantizedIndex = Math.round(Math.max(0, Math.min(this.noteValues.length - 1, noteIndex)));
        const quantizedZeroToOne = quantizedIndex / (this.noteValues.length - 1);
        newXPosition = quantizedZeroToOne * 2 - 1;
      }
    }
    
    // Apply more responsive smoothing when actively dragging
    const smoothing = this.isDragging ? 0.9 : this.smoothingFactor;
    this.xPosition = this.xPosition + (newXPosition - this.xPosition) * smoothing;
    this.yPosition = this.yPosition + (newYPosition - this.yPosition) * smoothing;
    
    this.updateValueDisplay();
    this.applyEffectParametersSmooth();
    this.drawCanvas();
  }

  updateCanvasSize() {
    const rect = this.canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * scale;
    this.canvas.height = rect.height * scale;
    this.ctx.scale(scale, scale);
    
    // Redraw after resizing
    this.drawCanvas();
  }

  drawCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    
    this.ctx.clearRect(0, 0, width, height);
    
    // Draw background with a darker color to make it visible
    this.ctx.fillStyle = '#0f0f0f';
    this.ctx.fillRect(0, 0, width, height);
    
    // Draw grid lines
    this.ctx.strokeStyle = '#444';
    this.ctx.lineWidth = 1;
    
    // Vertical center line
    this.ctx.beginPath();
    this.ctx.moveTo(width / 2, 0);
    this.ctx.lineTo(width / 2, height);
    this.ctx.stroke();
    
    // Horizontal center line
    this.ctx.beginPath();
    this.ctx.moveTo(0, height / 2);
    this.ctx.lineTo(width, height / 2);
    this.ctx.stroke();
    
    // Draw quarter lines for better reference
    this.ctx.strokeStyle = '#333';
    this.ctx.lineWidth = 0.5;
    
    // Vertical quarter lines
    this.ctx.beginPath();
    this.ctx.moveTo(width / 4, 0);
    this.ctx.lineTo(width / 4, height);
    this.ctx.moveTo(3 * width / 4, 0);
    this.ctx.lineTo(3 * width / 4, height);
    this.ctx.stroke();
    
    // Horizontal quarter lines
    this.ctx.beginPath();
    this.ctx.moveTo(0, height / 4);
    this.ctx.lineTo(width, height / 4);
    this.ctx.moveTo(0, 3 * height / 4);
    this.ctx.lineTo(width, 3 * height / 4);
    this.ctx.stroke();
    
    // Draw current position indicator (single handle)
    const x = (this.xPosition + 1) * width / 2;
    const y = (1 - this.yPosition) * height / 2;
    
    // Draw the main handle
    this.ctx.fillStyle = '#4ecdc4';
    this.ctx.beginPath();
    this.ctx.arc(x, y, 10, 0, 2 * Math.PI);
    this.ctx.fill();
    
    // Add a white border for better visibility
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.arc(x, y, 10, 0, 2 * Math.PI);
    this.ctx.stroke();
    
    // Draw border around the canvas
    this.ctx.strokeStyle = '#666';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(1, 1, width - 2, height - 2);
  }

  updateValueDisplay() {
    const effect = this.effectConfigs[this.selectedEffect];
    if (effect) {
      this.xValueDisplay.textContent = `${effect.xParam.name} (X): ${this.getCurrentXValue()}`;
      this.yValueDisplay.textContent = `${effect.yParam.name} (Y): ${this.getCurrentYValue()}`;
    } else {
      this.xValueDisplay.textContent = `X: ${this.getCurrentXValue()}`;
      this.yValueDisplay.textContent = `Y: ${this.getCurrentYValue()}`;
    }
  }

  updateLabels() {
    this.xLabel.textContent = this.getCurrentXParamName();
    this.yLabel.textContent = this.getCurrentYParamName();
  }

  applyEffectParameters() {
    const deck = this.audioEngine.getDeck(this.deckId);
    if (!deck) return;

    const effectConfig = this.effectConfigs[this.selectedEffect];
    if (!effectConfig) return;

    // Apply X parameter
    const xValue = this.mapParameterValue(this.xPosition, effectConfig.xParam);
    this.applyParameterValue(deck, effectConfig.xParam.effectMethod, xValue);

    // Apply Y parameter  
    const yValue = this.mapParameterValue(this.yPosition, effectConfig.yParam);
    this.applyParameterValue(deck, effectConfig.yParam.effectMethod, yValue);
  }

  updateFilterTypeButtons() {
    this.filterTypeBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.type === this.filterType);
    });
  }

  setFilterType(type) {
    this.filterType = type;
    
    // Update button states
    this.updateFilterTypeButtons();
    
    // Apply the filter type to the deck
    const deck = this.audioEngine.getDeck(this.deckId);
    if (deck && typeof deck.setFilterType === 'function') {
      deck.setFilterType(type);
    }
  }

  applyEffectParametersSmooth() {
    const deck = this.audioEngine.getDeck(this.deckId);
    if (!deck) return;

    const effectConfig = this.effectConfigs[this.selectedEffect];
    if (!effectConfig) return;

    // Apply filter type if this is the filter effect
    if (this.selectedEffect === 'filter' && typeof deck.setFilterType === 'function') {
      deck.setFilterType(this.filterType);
    }

    // Calculate X parameter value
    const xValue = this.mapParameterValue(this.xPosition, effectConfig.xParam);
    
    // Calculate Y parameter value
    const yValue = this.mapParameterValue(this.yPosition, effectConfig.yParam);
    
    // Get last applied values for this effect
    const lastValues = this.lastAppliedValues[this.selectedEffect];
    
    // Apply X parameter only if value has changed (with small tolerance for floating point comparison)
    const xChanged = lastValues.x === null || Math.abs(xValue - lastValues.x) > 0.001;
    if (xChanged) {
      this.applyParameterValueSmooth(deck, effectConfig.xParam.effectMethod, xValue);
      lastValues.x = xValue;
    }

    // Apply Y parameter only if value has changed (with small tolerance for floating point comparison)
    const yChanged = lastValues.y === null || Math.abs(yValue - lastValues.y) > 0.001;
    if (yChanged) {
      this.applyParameterValueSmooth(deck, effectConfig.yParam.effectMethod, yValue);
      lastValues.y = yValue;
    }
  }

  mapParameterValue(normalizedValue, paramConfig) {
    // Map from [-1, 1] to [0, 1] first
    const zeroToOne = (normalizedValue + 1) / 2;
    
    // Special handling for quantized delay time
    if (paramConfig.quantized && paramConfig.name === 'Delay Time') {
      // Map to note value index (0-6)
      const noteIndex = zeroToOne * (this.noteValues.length - 1);
      const quantizedIndex = Math.round(Math.max(0, Math.min(this.noteValues.length - 1, noteIndex)));
      
      // Ensure we have a valid note value
      if (quantizedIndex < 0 || quantizedIndex >= this.noteValues.length || !this.noteValues[quantizedIndex]) {
        console.warn('Invalid note index:', quantizedIndex, 'using 1/16 note as fallback');
        const fallbackIndex = 2; // 1/16 note
        const noteValue = this.noteValues[fallbackIndex] || { multiplier: 0.25 };
        const deck = this.audioEngine.getDeck(this.deckId);
        const bpm = deck ? deck.getBPM() : 120;
        const beatDuration = 60 / bpm;
        return beatDuration * noteValue.multiplier;
      }
      
      // Get actual delay time in seconds based on current BPM
      const deck = this.audioEngine.getDeck(this.deckId);
      const bpm = deck ? deck.getBPM() : 120;
      const beatDuration = 60 / bpm; // Duration of one beat in seconds
      const delayTime = beatDuration * this.noteValues[quantizedIndex].multiplier;
      
      return delayTime; // Return actual delay time in seconds
    }
    
    // Special handling for frequency parameters (logarithmic scale)
    if (paramConfig.name === 'Cutoff Freq') {
      const [min, max] = paramConfig.range;
      const logMin = Math.log(min);
      const logMax = Math.log(max);
      return Math.exp(logMin + zeroToOne * (logMax - logMin));
    }
    
    // Linear mapping for other parameters
    const [min, max] = paramConfig.range;
    return min + zeroToOne * (max - min);
  }

  mapValueToRange(normalizedValue, range) {
    // This method is used for display only
    // Map from [-1, 1] to [0, 1] first
    const zeroToOne = (normalizedValue + 1) / 2;
    
    // Then map to the target range [min, max]
    const [min, max] = range;
    return min + zeroToOne * (max - min);
  }

  applyParameterValue(deck, methodName, value) {
    if (deck && typeof deck[methodName] === 'function') {
      deck[methodName](value);
    } else if (deck.effectsEngine && typeof deck.effectsEngine[methodName] === 'function') {
      deck.effectsEngine[methodName](value);
    }
  }

  applyParameterValueSmooth(deck, methodName, value) {
    // Use smooth parameter automation for Web Audio API AudioParams
    const audioContext = this.audioEngine.audioContext;
    const currentTime = audioContext.currentTime;
    
    // Try to access the actual AudioParam for smooth automation
    let audioParam = null;
    
    if (deck && deck.effectNodes) {
      switch (methodName) {
        case 'setDelayTime':
          audioParam = deck.effectNodes.delay?.delayTime;
          break;
        case 'setDelayFeedback':
          audioParam = deck.effectNodes.delayFeedback?.gain;
          break;
        case 'setPhaserRate':
          audioParam = deck.effectNodes.phaserLFO?.frequency;
          break;
        case 'setPhaserDepth':
          audioParam = deck.effectNodes.phaserLFOGain?.gain;
          break;
        case 'setFlangerRate':
          audioParam = deck.effectNodes.flangerLFO?.frequency;
          break;
        case 'setFlangerDepth':
          audioParam = deck.effectNodes.flangerLFOGain?.gain;
          break;
        case 'setFilterFrequency':
          audioParam = deck.effectNodes.filter?.frequency;
          break;
        case 'setFilterResonance':
          audioParam = deck.effectNodes.filter?.Q;
          break;
      }
    }

    if (audioParam) {
      // Use exponentialRampToValueAtTime for smooth parameter changes
      try {
        audioParam.cancelScheduledValues(currentTime);
        // Ensure value is greater than 0 for exponential ramps
        const safeValue = Math.max(0.001, value);
        audioParam.exponentialRampToValueAtTime(safeValue, currentTime + 0.02); // 20ms ramp
      } catch (e) {
        // Fallback to direct value setting if exponential ramp fails
        audioParam.value = value;
      }
    } else {
      // Fallback to standard method call
      this.applyParameterValue(deck, methodName, value);
    }
  }

  reset() {
    this.xPosition = this.defaultValues.x;
    this.yPosition = this.defaultValues.y;
    
    // Reset persistent position for current effect
    this.effectPositions[this.selectedEffect] = {
      x: this.defaultValues.x,
      y: this.defaultValues.y
    };
    
    // Reset last applied values to ensure parameters are updated
    this.lastAppliedValues[this.selectedEffect] = { x: null, y: null };
    
    // Reset filter type to default if current effect is filter
    if (this.selectedEffect === 'filter') {
      this.setFilterType('lowpass');
    }
    
    this.updateValueDisplay();
    this.updateLabels();
    this.applyEffectParametersSmooth();
    this.drawCanvas();
  }

  appendTo(parentElement) {
    parentElement.appendChild(this.container);
    
    // Initialize canvas after it's in the DOM
    setTimeout(() => {
      this.updateCanvasSize();
      this.updateLabels();
      this.drawCanvas();
      // Update filter type buttons if filter effect is selected
      if (this.selectedEffect === 'filter') {
        this.updateFilterTypeButtons();
        this.applyEffectParametersSmooth();
      }
    }, 100);
  }
}

window.XYEffectPanel = XYEffectPanel;