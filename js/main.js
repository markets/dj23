document.addEventListener('DOMContentLoaded', async () => {
  console.log('🎧 DJ23 - Initializing...');
    
  await window.audioEngine.initialize();
    
  window.waveformRenderers.A = new WaveformRenderer('waveformA', 'A');
  window.waveformRenderers.B = new WaveformRenderer('waveformB', 'B');
    
  window.beatWaveformRenderers.A = new ZoomedWaveformRenderer('beatWaveformA', 'A', 1);
  window.beatWaveformRenderers.B = new ZoomedWaveformRenderer('beatWaveformB', 'B', 1);
    
  // Setup zoom button event listeners
  document.getElementById('zoomInA').addEventListener('click', () => {
    window.beatWaveformRenderers.A.zoom(-1); // Zoom in (negative direction)
  });
  document.getElementById('zoomOutA').addEventListener('click', () => {
    window.beatWaveformRenderers.A.zoom(1); // Zoom out (positive direction)
  });
  document.getElementById('zoomInB').addEventListener('click', () => {
    window.beatWaveformRenderers.B.zoom(-1); // Zoom in (negative direction)
  });
  document.getElementById('zoomOutB').addEventListener('click', () => {
    window.beatWaveformRenderers.B.zoom(1); // Zoom out (positive direction)
  });
    
  window.waveformRenderers.A.startAnimation();
  window.waveformRenderers.B.startAnimation();
  
  window.beatWaveformRenderers.A.startAnimation();
  window.beatWaveformRenderers.B.startAnimation();
  
  // Set initial deck volumes (Deck A: 100%, Deck B: 0%)
  const deckA = window.audioEngine.getDeck('A');
  const deckB = window.audioEngine.getDeck('B');
  if (deckA) deckA.setVolume(100);
  if (deckB) deckB.setVolume(0);
  
  window.soundPad = new SoundPad(window.audioEngine);
    
  console.log('✅ DJ23 - Ready to mix!');
    
  // Handle audio context resume on user interaction (setup once after initialization)
  document.addEventListener('click', async () => {
    if (window.audioEngine && window.audioEngine.audioContext) {
      await window.audioEngine.resumeContext();
    }
  }, { once: true });

  window.keyboardShortcuts = new KeyboardShortcuts();
});

window.addEventListener('error', (e) => {
  console.error('Application error:', e.error);
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
});
