class XYEffectPanel {
  constructor(deckId, audioEngine) {
    this.deckId = deckId;
    this.audioEngine = audioEngine;
    this.isActive = false;
    this.isDragging = false;
    
    // XY position normalized from -1 to 1
    this.xPosition = 0;
    this.yPosition = 0;
    
    // Current effect and parameter mappings
    this.selectedEffect = 'reverb';
    this.xParameter = 'wet';
    this.yParameter = 'roomSize';
    
    // Default values for reset functionality
    this.defaultValues = {
      x: 0,
      y: 0
    };
    
    // Effect parameter configurations
    this.effectConfigs = {
      reverb: {
        displayName: 'Reverb',
        parameters: {
          wet: { 
            name: 'Wet/Dry', 
            range: [0, 100], 
            default: 0,
            effectMethod: 'setReverb'
          },
          roomSize: { 
            name: 'Room Size', 
            range: [0.1, 3.0], 
            default: 1.0,
            effectMethod: 'setReverbRoomSize'
          }
        }
      },
      delay: {
        displayName: 'Delay',
        parameters: {
          wet: { 
            name: 'Wet/Dry', 
            range: [0, 100], 
            default: 0,
            effectMethod: 'setDelay'
          },
          time: { 
            name: 'Delay Time', 
            range: [0.05, 1.0], 
            default: 0.3,
            effectMethod: 'setDelayTime'
          },
          feedback: { 
            name: 'Feedback', 
            range: [0, 0.9], 
            default: 0.3,
            effectMethod: 'setDelayFeedback'
          }
        }
      },
      phaser: {
        displayName: 'Phaser',
        parameters: {
          wet: { 
            name: 'Wet/Dry', 
            range: [0, 100], 
            default: 0,
            effectMethod: 'setPhaser'
          },
          rate: { 
            name: 'LFO Rate', 
            range: [0.08, 2.0], 
            default: 0.3,
            effectMethod: 'setPhaserRate'
          },
          depth: { 
            name: 'Depth', 
            range: [0, 1000], 
            default: 600,
            effectMethod: 'setPhaserDepth'
          }
        }
      },
      flanger: {
        displayName: 'Flanger',
        parameters: {
          wet: { 
            name: 'Wet/Dry', 
            range: [0, 100], 
            default: 0,
            effectMethod: 'setFlanger'
          },
          rate: { 
            name: 'LFO Rate', 
            range: [0.1, 5.0], 
            default: 0.25,
            effectMethod: 'setFlangerRate'
          },
          depth: { 
            name: 'Depth', 
            range: [0.001, 0.01], 
            default: 0.003,
            effectMethod: 'setFlangerDepth'
          }
        }
      },
      filter: {
        displayName: 'Filter',
        parameters: {
          frequency: { 
            name: 'Cutoff Freq', 
            range: [100, 15000], 
            default: 15000,
            effectMethod: 'setFilter'
          },
          resonance: { 
            name: 'Resonance', 
            range: [0.1, 30], 
            default: 1,
            effectMethod: 'setFilterResonance'
          }
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
        <div class="xy-parameter-mappings">
          <div class="xy-param-mapping">
            <label>X Axis:</label>
            <select class="xy-x-param-select">
              ${this.getParameterOptions(this.selectedEffect)}
            </select>
          </div>
          <div class="xy-param-mapping">
            <label>Y Axis:</label>
            <select class="xy-y-param-select">
              ${this.getParameterOptions(this.selectedEffect)}
            </select>
          </div>
        </div>
      </div>
      <div class="xy-canvas-container">
        <canvas class="xy-canvas" width="200" height="200"></canvas>
        <div class="xy-handle"></div>
        <div class="xy-axis-labels">
          <div class="xy-x-label">${this.getParameterDisplayName(this.selectedEffect, this.xParameter)}</div>
          <div class="xy-y-label">${this.getParameterDisplayName(this.selectedEffect, this.yParameter)}</div>
        </div>
      </div>
      <div class="xy-value-display">
        <span class="xy-x-value">X: 0</span>
        <span class="xy-y-value">Y: 0</span>
      </div>
    `;

    // Get references to elements
    this.canvas = this.container.querySelector('.xy-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.handle = this.container.querySelector('.xy-handle');
    this.effectSelect = this.container.querySelector('.xy-effect-select');
    this.xParamSelect = this.container.querySelector('.xy-x-param-select');
    this.yParamSelect = this.container.querySelector('.xy-y-param-select');
    this.resetBtn = this.container.querySelector('.xy-reset-btn');
    this.xValueDisplay = this.container.querySelector('.xy-x-value');
    this.yValueDisplay = this.container.querySelector('.xy-y-value');
    this.xLabel = this.container.querySelector('.xy-x-label');
    this.yLabel = this.container.querySelector('.xy-y-label');

    this.updateCanvasSize();
    this.drawCanvas();
    this.updateHandlePosition();
  }

  getParameterOptions(effectKey) {
    const effect = this.effectConfigs[effectKey];
    if (!effect) return '';
    
    return Object.entries(effect.parameters).map(([key, param]) => 
      `<option value="${key}">${param.name}</option>`
    ).join('');
  }

  getParameterDisplayName(effectKey, paramKey) {
    const effect = this.effectConfigs[effectKey];
    if (!effect || !effect.parameters[paramKey]) return paramKey;
    return effect.parameters[paramKey].name;
  }

  setupEventListeners() {
    // Effect selection change
    this.effectSelect.addEventListener('change', (e) => {
      this.selectedEffect = e.target.value;
      this.updateParameterSelectors();
      this.reset();
    });

    // Parameter mapping changes
    this.xParamSelect.addEventListener('change', (e) => {
      this.xParameter = e.target.value;
      this.updateLabels();
      this.applyEffectParameters();
    });

    this.yParamSelect.addEventListener('change', (e) => {
      this.yParameter = e.target.value;
      this.updateLabels();
      this.applyEffectParameters();
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
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Convert to normalized coordinates (-1 to 1)
    this.xPosition = Math.max(-1, Math.min(1, (x / rect.width) * 2 - 1));
    this.yPosition = Math.max(-1, Math.min(1, 1 - (y / rect.height) * 2)); // Flip Y axis
    
    this.updateHandlePosition();
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
    
    // Draw current position indicator
    const x = (this.xPosition + 1) * width / 2;
    const y = (1 - this.yPosition) * height / 2;
    
    // Draw a larger, more visible indicator
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

  updateHandlePosition() {
    const rect = this.canvas.getBoundingClientRect();
    const x = (this.xPosition + 1) * rect.width / 2 - 8;
    const y = (1 - this.yPosition) * rect.height / 2 - 8;
    
    this.handle.style.left = `${x}px`;
    this.handle.style.top = `${y}px`;
  }

  updateValueDisplay() {
    this.xValueDisplay.textContent = `X: ${this.xPosition.toFixed(2)}`;
    this.yValueDisplay.textContent = `Y: ${this.yPosition.toFixed(2)}`;
  }

  updateParameterSelectors() {
    const optionsHtml = this.getParameterOptions(this.selectedEffect);
    this.xParamSelect.innerHTML = optionsHtml;
    this.yParamSelect.innerHTML = optionsHtml;
    
    // Set default parameter mappings
    const params = Object.keys(this.effectConfigs[this.selectedEffect].parameters);
    this.xParameter = params[0] || 'wet';
    this.yParameter = params[1] || params[0]; // Use second parameter for Y, fallback to first
    
    this.xParamSelect.value = this.xParameter;
    this.yParamSelect.value = this.yParameter;
    
    this.updateLabels();
  }

  updateLabels() {
    this.xLabel.textContent = this.getParameterDisplayName(this.selectedEffect, this.xParameter);
    this.yLabel.textContent = this.getParameterDisplayName(this.selectedEffect, this.yParameter);
  }

  applyEffectParameters() {
    const deck = this.audioEngine.getDeck(this.deckId);
    if (!deck) return;

    const effectConfig = this.effectConfigs[this.selectedEffect];
    if (!effectConfig) return;

    // Apply X parameter
    const xParamConfig = effectConfig.parameters[this.xParameter];
    if (xParamConfig) {
      const xValue = this.mapValueToRange(this.xPosition, xParamConfig.range);
      this.applyParameterValue(deck, xParamConfig.effectMethod, xValue);
    }

    // Apply Y parameter
    const yParamConfig = effectConfig.parameters[this.yParameter];
    if (yParamConfig) {
      const yValue = this.mapValueToRange(this.yPosition, yParamConfig.range);
      this.applyParameterValue(deck, yParamConfig.effectMethod, yValue);
    }
  }

  mapValueToRange(normalizedValue, range) {
    // Map from [-1, 1] to [min, max]
    const [min, max] = range;
    return min + (normalizedValue + 1) * (max - min) / 2;
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
    this.updateHandlePosition();
    this.updateValueDisplay();
    this.applyEffectParameters();
    this.drawCanvas();
  }

  appendTo(parentElement) {
    parentElement.appendChild(this.container);
    
    // Initialize canvas after it's in the DOM
    setTimeout(() => {
      this.updateCanvasSize();
      this.drawCanvas();
      this.updateHandlePosition();
    }, 100);
  }
}

window.XYEffectPanel = XYEffectPanel;