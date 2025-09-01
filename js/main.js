// Initialize the DJ23 application
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🎧 DJ23 - Initializing...');
    
  // Initialize audio engine
  await window.audioEngine.initialize();
    
  // Initialize waveform renderers
  window.waveformRenderers.A = new WaveformRenderer('waveformA', 'A');
  window.waveformRenderers.B = new WaveformRenderer('waveformB', 'B');
    
  // Initialize beat matching waveform renderers
  window.beatWaveformRenderers.A = new ZoomedWaveformRenderer('beatWaveformA', 'A', 1);
  window.beatWaveformRenderers.B = new ZoomedWaveformRenderer('beatWaveformB', 'B', 1);
    
  // Start waveform animations
  window.waveformRenderers.A.startAnimation();
  window.waveformRenderers.B.startAnimation();
  
  // Start beat waveform animations
  window.beatWaveformRenderers.A.startAnimation();
  window.beatWaveformRenderers.B.startAnimation();
  
  // Set initial deck volumes (Deck A: 100%, Deck B: 0%)
  const deckA = window.audioEngine.getDeck('A');
  const deckB = window.audioEngine.getDeck('B');
  if (deckA) deckA.setVolume(100);
  if (deckB) deckB.setVolume(0);
  
  // Initialize sound pad
  window.soundPad = new SoundPad(window.audioEngine);
    
  console.log('✅ DJ23 - Ready to mix!');
    
  // Add some helpful tips to console
  console.log('💡 Tips:');
  console.log('- Load audio files using the "Load Track" buttons');
  console.log('- Use the crossfader to blend between decks');
  console.log('- Adjust pitch to match BPMs for seamless mixing');
  console.log('- Click on waveforms to seek to position');
  console.log('- Use beat matching waveforms for precise mixing');
  console.log('- Use EQ and effects to shape your sound');
  
  // Handle audio context resume on user interaction (setup once after initialization)
  document.addEventListener('click', async () => {
    if (window.audioEngine && window.audioEngine.audioContext) {
      await window.audioEngine.resumeContext();
    }
  }, { once: true });

  // Initialize keyboard shortcuts controller
  window.keyboardShortcuts = new KeyboardShortcuts();
});

// Error handling
window.addEventListener('error', (e) => {
  console.error('Application error:', e.error);
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
});