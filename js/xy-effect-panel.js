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
    
    // Default values for reset functionality
    this.defaultValues = {
      x: 0,
      y: 0
    };
    
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
          range: [0.05, 1.0],
          default: 0.3,
          unit: 's',
          effectMethod: 'setDelayTime'
        },
        yParam: {
          name: 'Feedback',
          range: [0, 0.9],
          default: 0.3,
          unit: '',
          effectMethod: 'setDelayFeedback'
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
          range: [0.001, 0.01],
          default: 0.003,
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
    
    const value = this.mapParameterValue(this.xPosition, effect.xParam);
    const unit = effect.xParam.unit;
    return `${value.toFixed(unit === 'Hz' || unit === 's' ? 2 : 0)}${unit}`;
  }

  getCurrentYValue() {
    const effect = this.effectConfigs[this.selectedEffect];
    if (!effect) return '0';
    
    const value = this.mapParameterValue(this.yPosition, effect.yParam);
    const unit = effect.yParam.unit;
    return `${value.toFixed(unit === 'Hz' || unit === 's' ? 2 : 0)}${unit}`;
  }

  setupEventListeners() {
    // Effect selection change
    this.effectSelect.addEventListener('change', (e) => {
      this.selectedEffect = e.target.value;
      this.updateLabels();
      this.reset();
    });

    // Reset button
    this.resetBtn.addEventListener('click', () => {
      this.reset();
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
    const newXPosition = Math.max(-1, Math.min(1, (x / rect.width) * 2 - 1));
    const newYPosition = Math.max(-1, Math.min(1, 1 - (y / rect.height) * 2)); // Flip Y axis
    
    // Apply more responsive smoothing when actively dragging
    const smoothing = this.isDragging ? 0.7 : this.smoothingFactor;
    this.xPosition = this.xPosition + (newXPosition - this.xPosition) * smoothing;
    this.yPosition = this.yPosition + (newYPosition - this.yPosition) * smoothing;
    
    this.updateValueDisplay();
    this.applyEffectParameters();
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
    this.xValueDisplay.textContent = `X: ${this.getCurrentXValue()}`;
    this.yValueDisplay.textContent = `Y: ${this.getCurrentYValue()}`;
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

  mapParameterValue(normalizedValue, paramConfig) {
    // Map from [-1, 1] to [0, 1] first
    const zeroToOne = (normalizedValue + 1) / 2;
    
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

  reset() {
    this.xPosition = this.defaultValues.x;
    this.yPosition = this.defaultValues.y;
    this.updateValueDisplay();
    this.updateLabels();
    this.applyEffectParameters();
    this.drawCanvas();
  }

  appendTo(parentElement) {
    parentElement.appendChild(this.container);
    
    // Initialize canvas after it's in the DOM
    setTimeout(() => {
      this.updateCanvasSize();
      this.updateLabels();
      this.drawCanvas();
    }, 100);
  }
}

window.XYEffectPanel = XYEffectPanel;