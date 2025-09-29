/**
 * Audio Worklet Processor for Real-time Time Stretching
 * Implements a simplified WSOLA algorithm optimized for DJ use
 */
class TimeStretchWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    this.stretchRatio = 1.0;
    this.frameSize = 1024;
    this.hopSize = 256;
    this.overlapSize = 512;
    
    // Circular buffers for input and output
    this.inputBuffer = [];
    this.outputBuffer = [];
    this.writePosition = 0;
    this.readPosition = 0;
    this.grainPosition = 0;
    
    // Message handler for parameter updates
    this.port.onmessage = (event) => {
      if (event.data.type === 'setStretchRatio') {
        this.stretchRatio = Math.max(0.5, Math.min(2.0, event.data.value));
      }
    };
  }
  
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    
    if (!input || !output || input.length === 0 || output.length === 0) {
      return true;
    }
    
    const inputChannelData = input[0];
    const outputChannelData = output[0];
    const frameLength = inputChannelData.length;
    
    // Initialize buffers if needed
    if (this.inputBuffer.length === 0) {
      this.inputBuffer = new Float32Array(frameLength * 8);
      this.outputBuffer = new Float32Array(frameLength * 8);
    }
    
    // Copy input to circular buffer
    for (let i = 0; i < frameLength; i++) {
      this.inputBuffer[(this.writePosition + i) % this.inputBuffer.length] = inputChannelData[i];
    }
    this.writePosition = (this.writePosition + frameLength) % this.inputBuffer.length;
    
    // Apply time stretching
    this.processTimeStretch(outputChannelData, frameLength);
    
    // Copy processed data to output
    for (let i = 0; i < frameLength; i++) {
      outputChannelData[i] = this.outputBuffer[(this.readPosition + i) % this.outputBuffer.length];
    }
    this.readPosition = (this.readPosition + frameLength) % this.outputBuffer.length;
    
    return true;
  }
  
  processTimeStretch(output, frameLength) {
    const hopInput = Math.floor(this.hopSize / this.stretchRatio);
    const hopOutput = this.hopSize;
    
    for (let i = 0; i < frameLength; i++) {
      // Calculate input position with stretch ratio
      const inputPos = this.grainPosition * this.stretchRatio;
      const inputIndex = Math.floor(inputPos) % this.inputBuffer.length;
      const nextInputIndex = (inputIndex + 1) % this.inputBuffer.length;
      const fraction = inputPos - Math.floor(inputPos);
      
      // Linear interpolation between samples
      const sample = this.inputBuffer[inputIndex] * (1 - fraction) + 
                    this.inputBuffer[nextInputIndex] * fraction;
      
      // Apply windowing to reduce artifacts
      const windowPos = (i / frameLength) * Math.PI;
      const window = 0.5 * (1 - Math.cos(2 * windowPos));
      
      this.outputBuffer[(this.readPosition + i) % this.outputBuffer.length] = sample * window;
      this.grainPosition += 1;
    }
  }
}

registerProcessor('time-stretch-processor', TimeStretchWorkletProcessor);