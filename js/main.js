// Initialize the DJ23 application
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🎧 DJ23 - Initializing...');
    
  // Initialize audio engine
  await window.audioEngine.initialize();
    
  // Initialize waveform renderers
  window.waveformRenderers.A = new WaveformRenderer('waveformA', 'A');
  window.waveformRenderers.B = new WaveformRenderer('waveformB', 'B');
    
  // Initialize beat matching waveform renderers
  window.beatWaveformRenderers.A1 = new ZoomedWaveformRenderer('beatWaveformA1', 'A', 1);
  window.beatWaveformRenderers.A2 = new ZoomedWaveformRenderer('beatWaveformA2', 'A', 2);
  window.beatWaveformRenderers.B1 = new ZoomedWaveformRenderer('beatWaveformB1', 'B', 1);
  window.beatWaveformRenderers.B2 = new ZoomedWaveformRenderer('beatWaveformB2', 'B', 2);
    
  // Start waveform animations
  window.waveformRenderers.A.startAnimation();
  window.waveformRenderers.B.startAnimation();
  
  // Start beat waveform animations
  window.beatWaveformRenderers.A1.startAnimation();
  window.beatWaveformRenderers.A2.startAnimation();
  window.beatWaveformRenderers.B1.startAnimation();
  window.beatWaveformRenderers.B2.startAnimation();
    
  console.log('✅ DJ23 - Ready to mix!');
    
  // Add some helpful tips to console
  console.log('💡 Tips:');
  console.log('- Load audio files using the "Load Track" buttons');
  console.log('- Use the crossfader to blend between decks');
  console.log('- Adjust pitch to match BPMs for seamless mixing');
  console.log('- Click on waveforms to seek to position');
  console.log('- Use beat matching waveforms for precise mixing');
  console.log('- Use EQ and effects to shape your sound');
});

// Handle audio context resume on user interaction
document.addEventListener('click', async () => {
  if (window.audioEngine && window.audioEngine.audioContext) {
    await window.audioEngine.resumeContext();
  }
}, { once: true });

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Prevent default for our shortcuts
  const shortcuts = ['Space', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyA', 'KeyS', 'KeyD', 'KeyF'];
  if (shortcuts.includes(e.code)) {
    e.preventDefault();
  }
    
  switch (e.code) {
    case 'Space':
      // Toggle play/pause for active deck
      break;
    case 'KeyQ':
      window.mixerController.playDeck('A');
      break;
    case 'KeyW':
      window.mixerController.pauseDeck('A');
      break;
    case 'KeyE':
      window.mixerController.stopDeck('A');
      break;
    case 'KeyR':
      window.mixerController.cueDeck('A');
      break;
    case 'KeyA':
      window.mixerController.playDeck('B');
      break;
    case 'KeyS':
      window.mixerController.pauseDeck('B');
      break;
    case 'KeyD':
      window.mixerController.stopDeck('B');
      break;
    case 'KeyF':
      window.mixerController.cueDeck('B');
      break;
  }
});

// Error handling
window.addEventListener('error', (e) => {
  console.error('Application error:', e.error);
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
});