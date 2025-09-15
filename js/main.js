document.addEventListener('DOMContentLoaded', async () => {
  console.log('🎧 Initializing...');
    
  await window.audioEngine.initialize();
    
  window.waveformRenderers.A = new WaveformRenderer('waveformA', 'A');
  window.waveformRenderers.B = new WaveformRenderer('waveformB', 'B');
    
  window.beatWaveformRenderers.A = new BeatWaveformRenderer('beatWaveformA', 'A');
  window.beatWaveformRenderers.B = new BeatWaveformRenderer('beatWaveformB', 'B');
    
  window.waveformRenderers.A.startAnimation();
  window.waveformRenderers.B.startAnimation();
  
  window.beatWaveformRenderers.A.startAnimation();
  window.beatWaveformRenderers.B.startAnimation();
  
  window.soundPad = new SoundPad(window.audioEngine);

  // Initialize XY Effect Panels
  window.xyEffectPanelA = new XYEffectPanel('A', window.audioEngine);
  window.xyEffectPanelB = new XYEffectPanel('B', window.audioEngine);
  
  // Append XY panels to their respective sections
  const xyEffectSectionA = document.getElementById('xyEffectSectionA');
  const xyEffectSectionB = document.getElementById('xyEffectSectionB');
  
  if (xyEffectSectionA) {
    window.xyEffectPanelA.appendTo(xyEffectSectionA);
  }
  
  if (xyEffectSectionB) {
    window.xyEffectPanelB.appendTo(xyEffectSectionB);
  }

  window.keyboardShortcuts = new KeyboardShortcuts();
    
  console.log('✅ Ready to mix!');
    
  // Handle audio context resume on user interaction (setup once after initialization)
  document.addEventListener('click', async () => {
    if (window.audioEngine && window.audioEngine.audioContext) {
      await window.audioEngine.resumeContext();
    }
  }, { once: true });
});

window.addEventListener('error', (e) => {
  console.error('Application error:', e.error);
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
});

// Prevent accidental tab closure or navigation away from the page
window.addEventListener('beforeunload', (e) => {
  // Check if there's an active session (audio loaded or playing)
  const hasActiveSession = () => {
    if (!window.audioEngine || !window.audioEngine.isInitialized) return false;
    
    const deckA = window.audioEngine.getDeck('A');
    const deckB = window.audioEngine.getDeck('B');
    
    return (deckA && (deckA.audioBuffer || deckA.isPlaying)) || 
           (deckB && (deckB.audioBuffer || deckB.isPlaying));
  };
  
  if (hasActiveSession()) {
    e.preventDefault();
  }
});
