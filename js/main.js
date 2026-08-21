document.addEventListener('DOMContentLoaded', async () => {
  console.log('🎧 Initializing...');
    
  await window.audioEngine.initialize();
    
  // Before the renderers: the beat waveforms attach themselves to these
  window.platters.A = new Platter('A');
  window.platters.B = new Platter('B');

  window.waveformRenderers.A = new WaveformRenderer('waveformA', 'A');
  window.waveformRenderers.B = new WaveformRenderer('waveformB', 'B');
    
  window.beatWaveformRenderers.A = new BeatWaveformRenderer('beatWaveformA', 'A');
  window.beatWaveformRenderers.B = new BeatWaveformRenderer('beatWaveformB', 'B');
    
  window.waveformRenderers.A.startAnimation();
  window.waveformRenderers.B.startAnimation();
  
  window.beatWaveformRenderers.A.startAnimation();
  window.beatWaveformRenderers.B.startAnimation();
  
  window.soundPad = new SoundPad(window.audioEngine);

  window.keyboardShortcuts = new KeyboardShortcuts();

  // After the decks exist, so saved preferences can be applied to them
  window.settings = new Settings();
  window.settings.init();

  setupStickyTopbar();

  console.log('✅ Ready to mix!');
    
  // Mobile suspends the audio context until a gesture, and again on backgrounding.
  // Every gesture, not just the first, so a stray tap cannot swallow the chance.
  const resume = () => window.audioEngine?.resumeContext();
  document.addEventListener('pointerdown', resume);
  document.addEventListener('keydown', resume);
});

function setupStickyTopbar() {
  const topbar = document.getElementById('appTopbar');
  if (!topbar) return;

  const update = () => topbar.classList.toggle('is-stuck', window.scrollY > 0);

  update();
  window.addEventListener('scroll', update, { passive: true });
  // The browser restores the scroll position after DOMContentLoaded, without
  // firing a scroll event — re-check once the page is fully shown
  window.addEventListener('pageshow', update);
}

window.addEventListener('error', (e) => {
  console.error('Application error:', e.error);
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
});

// Prevent accidental tab closure or navigation away from the page
window.addEventListener('beforeunload', (e) => {
  if (window.audioEngine && window.audioEngine.hasActiveSession()) {
    e.preventDefault();
  }
});
