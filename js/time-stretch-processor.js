/**
 * TimeStretchProcessor - Implements time-stretching for Key Lock functionality
 * Uses AudioWorkletNode for modern browsers, with ScriptProcessorNode fallback
 */
class TimeStretchProcessor {
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.workletLoaded = false;
    this.frameSize = 1024;
    this.hopSize = 256;
    this.overlapSize = 512;
    this.analysisBuffer = [];
    this.synthesisBuffer = [];
    this.crossfadeLength = 128;
    
    // Try to load the AudioWorklet processor
    this.loadWorklet();
  }

  async loadWorklet() {
    try {
      if (this.audioContext.audioWorklet) {
        await this.audioContext.audioWorklet.addModule('js/time-stretch-worklet.js');
        this.workletLoaded = true;
        console.log('Time-stretch worklet loaded successfully');
      }
    } catch (error) {
      console.warn('Failed to load time-stretch worklet, using ScriptProcessorNode fallback:', error);
      this.workletLoaded = false;
    }
  }

  /**
   * Creates a time-stretch node for real-time processing
   * @param {number} stretchRatio - The time-stretch ratio (1.0 = no stretch, 2.0 = double speed)
   * @returns {AudioNode}
   */
  createTimeStretchNode(stretchRatio = 1.0) {
    if (this.workletLoaded && this.audioContext.audioWorklet) {
      return this.createWorkletNode(stretchRatio);
    } else {
      return this.createScriptProcessorNode(stretchRatio);
    }
  }

  createWorkletNode(stretchRatio) {
    try {
      const workletNode = new AudioWorkletNode(this.audioContext, 'time-stretch-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 2
      });
      
      workletNode.stretchRatio = stretchRatio;
      
      workletNode.setStretchRatio = (newRatio) => {
        workletNode.stretchRatio = Math.max(0.5, Math.min(2.0, newRatio));
        workletNode.port.postMessage({
          type: 'setStretchRatio',
          value: workletNode.stretchRatio
        });
      };
      
      // Initialize with the stretch ratio
      workletNode.setStretchRatio(stretchRatio);
      
      return workletNode;
    } catch (error) {
      console.warn('Failed to create AudioWorkletNode, falling back to ScriptProcessorNode:', error);
      return this.createScriptProcessorNode(stretchRatio);
    }
  }

  /**
   * Creates a ScriptProcessorNode for real-time time-stretching (fallback)
   * @param {number} stretchRatio - The time-stretch ratio (1.0 = no stretch, 2.0 = double speed)
   * @returns {ScriptProcessorNode}
   */
  createScriptProcessorNode(stretchRatio = 1.0) {
    // Use a buffer size that provides good latency vs quality trade-off
    const bufferSize = 4096;
    const processor = this.audioContext.createScriptProcessor(bufferSize, 2, 2);
    
    // Initialize processing state
    let inputBuffer = [];
    let outputBuffer = [];
    let inputPointer = 0;
    let outputPointer = 0;
    let lastGrainPosition = 0;
    
    processor.stretchRatio = stretchRatio;
    
    // Update stretch ratio method
    processor.setStretchRatio = (newRatio) => {
      processor.stretchRatio = Math.max(0.5, Math.min(2.0, newRatio));
    };
    
    processor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer;
      const outputData = event.outputBuffer;
      const bufferLength = inputData.length;
      
      // Process each channel
      for (let channel = 0; channel < inputData.numberOfChannels; channel++) {
        const input = inputData.getChannelData(channel);
        const output = outputData.getChannelData(channel);
        
        // Initialize channel buffers if needed
        if (!inputBuffer[channel]) {
          inputBuffer[channel] = new Float32Array(bufferSize * 4);
          outputBuffer[channel] = new Float32Array(bufferSize * 4);
        }
        
        // Copy input to circular buffer
        for (let i = 0; i < bufferLength; i++) {
          inputBuffer[channel][(inputPointer + i) % inputBuffer[channel].length] = input[i];
        }
        
        // Process with time-stretching
        this.processTimeStretch(
          inputBuffer[channel],
          outputBuffer[channel],
          output,
          processor.stretchRatio,
          bufferLength,
          inputPointer,
          outputPointer
        );
      }
      
      inputPointer = (inputPointer + bufferLength) % inputBuffer[0].length;
      outputPointer = (outputPointer + bufferLength) % outputBuffer[0].length;
    };
    
    return processor;
  }
  
  /**
   * Process audio with time-stretching using a simplified overlap-add approach
   */
  processTimeStretch(inputBuffer, outputBuffer, output, stretchRatio, bufferLength, inputPtr, outputPtr) {
    const grainSize = 1024;
    const hopInput = Math.floor(grainSize / stretchRatio);
    const hopOutput = grainSize;
    
    // Simple time-stretching: overlap-add with linear interpolation
    for (let i = 0; i < bufferLength; i++) {
      const inputIndex = Math.floor((inputPtr + i) * stretchRatio) % inputBuffer.length;
      const nextInputIndex = (inputIndex + 1) % inputBuffer.length;
      const fraction = ((inputPtr + i) * stretchRatio) % 1;
      
      // Linear interpolation between samples
      const interpolatedSample = inputBuffer[inputIndex] * (1 - fraction) + 
                                inputBuffer[nextInputIndex] * fraction;
      
      output[i] = interpolatedSample;
    }
  }
  
  /**
   * Apply windowing function to reduce artifacts
   */
  applyWindow(buffer, windowType = 'hann') {
    const length = buffer.length;
    const windowed = new Float32Array(length);
    
    for (let i = 0; i < length; i++) {
      let window;
      switch (windowType) {
        case 'hann':
          window = 0.5 * (1 - Math.cos(2 * Math.PI * i / (length - 1)));
          break;
        case 'hamming':
          window = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (length - 1));
          break;
        default:
          window = 1; // rectangular window
      }
      windowed[i] = buffer[i] * window;
    }
    
    return windowed;
  }
  
  /**
   * Find the best correlation point for grain alignment (simplified)
   */
  findBestCorrelation(buffer1, buffer2, maxOffset = 512) {
    let bestCorrelation = -Infinity;
    let bestOffset = 0;
    
    for (let offset = 0; offset < maxOffset; offset++) {
      let correlation = 0;
      const compareLength = Math.min(buffer1.length, buffer2.length - offset);
      
      for (let i = 0; i < compareLength; i++) {
        correlation += buffer1[i] * buffer2[i + offset];
      }
      
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = offset;
      }
    }
    
    return bestOffset;
  }
}

// Export for use in other modules
window.TimeStretchProcessor = TimeStretchProcessor;