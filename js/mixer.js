class Mixer {
    constructor(deck1, deck2) {
        this.deck1 = deck1;
        this.deck2 = deck2;
        this.audioContext = deck1.audioContext || deck2.audioContext;
        
        // Create separate gain nodes for crossfading
        this.crossfadeGain1 = this.audioContext.createGain();
        this.crossfadeGain2 = this.audioContext.createGain();
        
        // DOM elements
        this.crossfaderSlider = document.getElementById('crossfader');
        
        this.init();
    }
    
    init() {
        // Connect decks to crossfade gain nodes
        this.deck1.gainNode.connect(this.crossfadeGain1);
        this.deck2.gainNode.connect(this.crossfadeGain2);
        
        // Connect crossfade gain nodes to output
        this.crossfadeGain1.connect(this.audioContext.destination);
        this.crossfadeGain2.connect(this.audioContext.destination);
        
        // Set initial crossfader values
        this.setCrossfader(this.crossfaderSlider.value);
        
        // Add event listeners
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Crossfader
        this.crossfaderSlider.addEventListener('input', (e) => {
            this.setCrossfader(e.target.value);
        });
    }
    
    setCrossfader(value) {
        // Convert value to 0-1 range
        const position = value / 100;
        
        // Equal power crossfade curve
        const gain1 = Math.cos(position * 0.5 * Math.PI);
        const gain2 = Math.cos((1.0 - position) * 0.5 * Math.PI);
        
        this.crossfadeGain1.gain.value = gain1;
        this.crossfadeGain2.gain.value = gain2;
    }
}