class Effects {
    constructor(audioContext) {
        this.audioContext = audioContext;
        
        // Effect nodes
        this.filterNode = this.audioContext.createBiquadFilter();
        this.delayNode = this.audioContext.createDelay(5.0);
        this.feedbackNode = this.audioContext.createGain();
        this.reverbNode = this.audioContext.createConvolver();
        
        // Input/output nodes
        this.inputNode = this.audioContext.createGain();
        this.outputNode = this.audioContext.createGain();
        this.dryNode = this.audioContext.createGain();
        this.wetNode = this.audioContext.createGain();
        
        // DOM elements
        this.filterKnob = document.getElementById('filter');
        this.delayKnob = document.getElementById('delay');
        this.reverbKnob = document.getElementById('reverb');
        
        this.init();
    }
    
    init() {
        // Configure filter
        this.filterNode.type = 'lowpass';
        this.filterNode.frequency.value = 20000;
        this.filterNode.Q.value = 1;
        
        // Configure delay
        this.delayNode.delayTime.value = 0.3;
        this.feedbackNode.gain.value = 0.5;
        
        // Create reverb impulse response
        this.createReverbImpulse();
        
        // Set up signal chain
        // Input → Split to dry/wet
        this.inputNode.connect(this.dryNode);
        this.inputNode.connect(this.filterNode);
        
        // Wet signal chain: Filter → Delay → Reverb → Wet Output
        this.filterNode.connect(this.delayNode);
        this.delayNode.connect(this.outputNode);
        this.delayNode.connect(this.feedbackNode);
        this.feedbackNode.connect(this.delayNode);
        
        // Reverb chain
        this.delayNode.connect(this.reverbNode);
        this.reverbNode.connect(this.wetNode);
        
        // Mix dry/wet to output
        this.dryNode.connect(this.outputNode);
        this.wetNode.connect(this.outputNode);
        
        // Initial effect values
        this.wetNode.gain.value = 0; // Start with no wet signal
        this.dryNode.gain.value = 1; // Full dry signal
        
        // Set initial knob values
        this.setFilter(this.filterKnob.value);
        this.setDelay(this.delayKnob.value);
        this.setReverb(this.reverbKnob.value);
        
        // Add event listeners
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        this.filterKnob.addEventListener('input', (e) => {
            this.setFilter(e.target.value);
        });
        
        this.delayKnob.addEventListener('input', (e) => {
            this.setDelay(e.target.value);
        });
        
        this.reverbKnob.addEventListener('input', (e) => {
            this.setReverb(e.target.value);
        });
    }
    
    setFilter(value) {
        // Map 0-100 to frequency range (20Hz - 20kHz, logarithmic)
        const minValue = 20;
        const maxValue = 20000;
        const normalized = value / 100;
        
        // Logarithmic scale for frequency
        const frequency = minValue * Math.pow(maxValue / minValue, normalized);
        this.filterNode.frequency.value = frequency;
    }
    
    setDelay(value) {
        // Set delay wet/dry mix (0-100%)
        const wetGain = value / 100;
        this.delayNode.delayTime.value = 0.1 + (wetGain * 0.5); // 0.1s to 0.6s
        this.feedbackNode.gain.value = wetGain * 0.7; // 0 to 0.7 feedback
    }
    
    setReverb(value) {
        // Set reverb wet/dry mix (0-100%)
        const wetGain = value / 100;
        this.wetNode.gain.value = wetGain;
    }
    
    createReverbImpulse() {
        // Create a simple impulse response for reverb
        const duration = 2;
        const decay = 2;
        const sampleRate = this.audioContext.sampleRate;
        const length = sampleRate * duration;
        const impulse = this.audioContext.createBuffer(2, length, sampleRate);
        const impulseL = impulse.getChannelData(0);
        const impulseR = impulse.getChannelData(1);
        
        for (let i = 0; i < length; i++) {
            const n = i / length;
            // Simple exponential decay
            const value = Math.random() * 2 - 1;
            
            impulseL[i] = value * Math.pow(1 - n, decay);
            impulseR[i] = value * Math.pow(1 - n, decay);
        }
        
        this.reverbNode.buffer = impulse;
    }
    
    getInputNode() {
        return this.inputNode;
    }
    
    getOutputNode() {
        return this.outputNode;
    }
}