class AudioAnalyzer {
  constructor(audioContext) {
      this.audioContext = audioContext;
      this.offlineContext = null;
  }
  
  async analyzeTrack(file) {
      const arrayBuffer = await this.readFileAsArrayBuffer(file);
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      
      // Create offline context for analysis
      this.offlineContext = new OfflineAudioContext(
          audioBuffer.numberOfChannels,
          audioBuffer.length,
          audioBuffer.sampleRate
      );
      
      // Create source node
      const source = this.offlineContext.createBufferSource();
      source.buffer = audioBuffer;
      
      // Create analyzer node
      const analyzer = this.offlineContext.createAnalyser();
      analyzer.fftSize = 2048;
      
      // Connect and start
      source.connect(analyzer);
      analyzer.connect(this.offlineContext.destination);
      source.start(0);
      
      // Render and analyze
      const renderedBuffer = await this.offlineContext.startRendering();
      
      // Results
      const duration = audioBuffer.duration;
      const bpm = await this.detectBPM(audioBuffer);
      const waveformData = this.generateWaveformData(audioBuffer);
      const peaks = this.detectPeaks(audioBuffer);
      
      return {
          duration,
          bpm,
          waveformData,
          peaks,
          buffer: audioBuffer
      };
  }
  
  readFileAsArrayBuffer(file) {
      return new Promise((resolve, reject) => {
          const reader = new FileReader();
          
          reader.onload = (event) => {
              resolve(event.target.result);
          };
          
          reader.onerror = (error) => {
              reject(error);
          };
          
          reader.readAsArrayBuffer(file);
      });
  }
  
  async detectBPM(audioBuffer) {
      // Basic beat detection using auto-correlation
      const data = this.getMonoChannel(audioBuffer);
      const sampleRate = audioBuffer.sampleRate;
      
      // Work with a manageable chunk (first 20 seconds or full track if shorter)
      const maxLength = Math.min(20 * sampleRate, data.length);
      const samples = data.slice(0, maxLength);
      
      // Process samples to enhance beats
      const processedSamples = this.preprocessSamples(samples);
      
      // Find auto-correlation
      const correlation = this.getAutoCorrelation(processedSamples, sampleRate);
      
      // Find peaks in correlation (potential BPM candidates)
      const peaks = this.findPeaks(correlation);
      
      // Convert peaks to BPM values
      const bpmCandidates = peaks.map(peak => 60 / (peak / sampleRate));
      
      // Filter BPM to reasonable range (70-180 BPM)
      const filteredBPM = bpmCandidates.filter(bpm => bpm >= 70 && bpm <= 180);
      
      if (filteredBPM.length === 0) {
          return 120; // Default if no BPM found
      }
      
      // Return the most likely BPM (median of candidates)
      const sortedBPM = [...filteredBPM].sort((a, b) => a - b);
      const medianBPM = sortedBPM[Math.floor(sortedBPM.length / 2)];
      
      return parseFloat(medianBPM.toFixed(1));
  }
  
  getMonoChannel(audioBuffer) {
      // Mix down to mono for analysis
      const numberOfChannels = audioBuffer.numberOfChannels;
      const length = audioBuffer.length;
      const monoData = new Float32Array(length);
      
      // Mix all channels
      for (let channel = 0; channel < numberOfChannels; channel++) {
          const channelData = audioBuffer.getChannelData(channel);
          for (let i = 0; i < length; i++) {
              monoData[i] += channelData[i] / numberOfChannels;
          }
      }
      
      return monoData;
  }
  
  preprocessSamples(samples) {
      const processed = new Float32Array(samples.length);
      
      // Apply simple filtering and normalization
      // This enhances beats for detection
      let max = 0;
      
      // Simple low-pass filter to focus on beat frequencies
      for (let i = 2; i < samples.length - 2; i++) {
          processed[i] = Math.abs(
              (samples[i-2] + samples[i-1] + samples[i] + samples[i+1] + samples[i+2]) / 5
          );
          
          // Track maximum for normalization
          if (processed[i] > max) {
              max = processed[i];
          }
      }
      
      // Normalize
      if (max > 0) {
          for (let i = 0; i < processed.length; i++) {
              processed[i] /= max;
          }
      }
      
      return processed;
  }
  
  getAutoCorrelation(samples, sampleRate) {
      // Calculate auto-correlation to find repeating patterns
      const minBPM = 70;
      const maxBPM = 180;
      
      // Convert BPM to sample intervals
      const minInterval = Math.floor(sampleRate * 60 / maxBPM);
      const maxInterval = Math.ceil(sampleRate * 60 / minBPM);
      
      const correlation = new Float32Array(maxInterval - minInterval + 1);
      
      for (let offset = minInterval; offset <= maxInterval; offset++) {
          let sum = 0;
          
          // Calculate correlation at this offset
          for (let i = 0; i < samples.length - offset; i++) {
              sum += samples[i] * samples[i + offset];
          }
          
          correlation[offset - minInterval] = sum;
      }
      
      return correlation;
  }
  
  findPeaks(data) {
      const peaks = [];
      
      // Find local maxima
      for (let i = 1; i < data.length - 1; i++) {
          if (data[i] > data[i-1] && data[i] > data[i+1]) {
              // Found a local maximum
              peaks.push(i);
          }
      }
      
      // Sort peaks by correlation strength
      peaks.sort((a, b) => data[b] - data[a]);
      
      // Return top 5 peaks
      return peaks.slice(0, 5).map(i => i + (60 * this.audioContext.sampleRate / 180));
  }
  
  generateWaveformData(audioBuffer) {
      const rawData = this.getMonoChannel(audioBuffer);
      const samples = 1000; // Number of data points for the waveform
      const blockSize = Math.floor(rawData.length / samples);
      const waveform = [];
      
      for (let i = 0; i < samples; i++) {
          let blockStart = blockSize * i;
          let sum = 0;
          let max = 0;
          let min = 0;
          
          // Find average, min, max in this block
          for (let j = 0; j < blockSize; j++) {
              const sample = rawData[blockStart + j];
              sum += Math.abs(sample);
              max = Math.max(max, sample);
              min = Math.min(min, sample);
          }
          
          waveform.push({
              average: sum / blockSize,
              min: min,
              max: max
          });
      }
      
      return waveform;
  }
  
  detectPeaks(audioBuffer) {
      const data = this.getMonoChannel(audioBuffer);
      const peaks = [];
      
      // Find significant peaks in audio for potential cue points
      let threshold = 0.7;
      const minDistance = audioBuffer.sampleRate * 0.5; // Min 0.5s between peaks
      
      let lastPeakIndex = -minDistance;
      
      for (let i = 0; i < data.length; i++) {
          if (Math.abs(data[i]) > threshold && (i - lastPeakIndex) > minDistance) {
              peaks.push({
                  position: i / audioBuffer.sampleRate,
                  amplitude: Math.abs(data[i])
              });
              lastPeakIndex = i;
          }
      }
      
      // If we found too many or too few peaks, adjust threshold and try again
      if (peaks.length > 10 || peaks.length < 3) {
          if (peaks.length > 10) threshold += 0.1;
          if (peaks.length < 3) threshold -= 0.1;
          
          if (threshold > 0.3 && threshold < 0.95) {
              return this.detectPeaks(audioBuffer, threshold);
          }
      }
      
      return peaks.slice(0, 8); // Return at most 8 peaks
  }
}