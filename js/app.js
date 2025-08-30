document.addEventListener('DOMContentLoaded', () => {
    // Initialize audio context
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AudioContext();
    
    // Create decks
    const deck1 = new Deck(1);
    const deck2 = new Deck(2);
    
    // Create mixer
    const mixer = new Mixer(deck1, deck2);
    
    // Create effects processor
    const effects = new Effects(audioContext);
    
    // Connect mixer output to effects
    // Note: In a real implementation, this would need more complex routing
    
    console.log('DJ Mixer initialized');
    
    // Resume audio context on user interaction (needed for some browsers)
    document.body.addEventListener('click', () => {
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
    }, { once: true });
});