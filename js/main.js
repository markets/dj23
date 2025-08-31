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
  // Don't handle shortcuts if modal is open
  if (document.getElementById('keyboardShortcutsModal').classList.contains('show')) {
    if (e.code === 'Escape') {
      hideShortcutsModal();
    }
    return;
  }

  // Prevent default for our shortcuts
  const shortcuts = [
    'Space', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyA', 'KeyS', 'KeyD', 'KeyF',
    'KeyT', 'KeyY', 'KeyU', 'KeyG', 'KeyH', 'KeyJ',
    'Digit1', 'Digit2', 'Digit3', 'Digit4',
    'Minus', 'Equal', 'BracketLeft', 'BracketRight',
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    'Slash'
  ];
  
  if (shortcuts.includes(e.code) || 
      (e.ctrlKey && ['KeyS', 'KeyD', 'KeyO', 'KeyP'].includes(e.code))) {
    e.preventDefault();
  }

  // Handle Ctrl combinations
  if (e.ctrlKey) {
    switch (e.code) {
      case 'KeyS':
        // Sync A → B
        document.getElementById('syncAB')?.click();
        break;
      case 'KeyD':
        // Sync B → A
        document.getElementById('syncBA')?.click();
        break;
      case 'KeyO':
        // Load track to Deck A
        document.getElementById('fileInputA')?.click();
        break;
      case 'KeyP':
        // Load track to Deck B
        document.getElementById('fileInputB')?.click();
        break;
    }
    return;
  }

  switch (e.code) {
    case 'Space':
      // Toggle play/pause for active deck (default to A if none active)
      // This could be enhanced to track which deck was last used
      window.mixerController.playDeck('A');
      break;
    
    // Deck A Controls
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
    
    // Deck B Controls
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
    
    // Cue Points
    case 'Digit1':
      if (e.shiftKey) {
        document.getElementById('setCue1A')?.click();
      } else {
        document.getElementById('cue1A')?.click();
      }
      break;
    case 'Digit2':
      if (e.shiftKey) {
        document.getElementById('setCue2A')?.click();
      } else {
        document.getElementById('cue2A')?.click();
      }
      break;
    case 'Digit3':
      if (e.shiftKey) {
        document.getElementById('setCue1B')?.click();
      } else {
        document.getElementById('cue1B')?.click();
      }
      break;
    case 'Digit4':
      if (e.shiftKey) {
        document.getElementById('setCue2B')?.click();
      } else {
        document.getElementById('cue2B')?.click();
      }
      break;
    
    // Loop Controls - Deck A
    case 'KeyT':
      document.getElementById('loopInA')?.click();
      break;
    case 'KeyY':
      document.getElementById('loopOutA')?.click();
      break;
    case 'KeyU':
      document.getElementById('loopToggleA')?.click();
      break;
    
    // Loop Controls - Deck B
    case 'KeyG':
      document.getElementById('loopInB')?.click();
      break;
    case 'KeyH':
      document.getElementById('loopOutB')?.click();
      break;
    case 'KeyJ':
      document.getElementById('loopToggleB')?.click();
      break;
    
    // Pitch Bend - Deck A
    case 'Equal': // + key
      document.getElementById('pitchBendPlusA')?.click();
      break;
    case 'Minus': // - key
      document.getElementById('pitchBendMinusA')?.click();
      break;
    
    // Pitch Bend - Deck B
    case 'BracketRight': // ] key
      document.getElementById('pitchBendPlusB')?.click();
      break;
    case 'BracketLeft': // [ key
      document.getElementById('pitchBendMinusB')?.click();
      break;
    
    // Crossfader and Master Volume
    case 'ArrowLeft':
      adjustCrossfader(-5);
      break;
    case 'ArrowRight':
      adjustCrossfader(5);
      break;
    case 'ArrowUp':
      adjustMasterVolume(5);
      break;
    case 'ArrowDown':
      adjustMasterVolume(-5);
      break;
    
    // Show shortcuts modal
    case 'Slash':
      if (e.shiftKey) { // ? key (Shift + /)
        showShortcutsModal();
      }
      break;
  }
});

// Helper functions for crossfader and master volume
function adjustCrossfader(delta) {
  const crossfader = document.getElementById('crossfader');
  if (crossfader) {
    const currentValue = parseInt(crossfader.value);
    const newValue = Math.max(0, Math.min(100, currentValue + delta));
    crossfader.value = newValue;
    crossfader.dispatchEvent(new Event('input'));
  }
}

function adjustMasterVolume(delta) {
  const masterVolume = document.getElementById('masterVolume');
  if (masterVolume) {
    const currentValue = parseInt(masterVolume.value);
    const newValue = Math.max(0, Math.min(100, currentValue + delta));
    masterVolume.value = newValue;
    masterVolume.dispatchEvent(new Event('input'));
    
    // Update display
    const display = masterVolume.parentElement.querySelector('.volume-display');
    if (display) {
      display.textContent = newValue + '%';
    }
  }
}

// Modal functions
function showShortcutsModal() {
  const modal = document.getElementById('keyboardShortcutsModal');
  modal.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function hideShortcutsModal() {
  const modal = document.getElementById('keyboardShortcutsModal');
  modal.classList.remove('show');
  document.body.style.overflow = 'auto';
}

// Initialize modal event listeners
document.addEventListener('DOMContentLoaded', () => {
  // Close modal when clicking outside
  document.getElementById('keyboardShortcutsModal').addEventListener('click', (e) => {
    if (e.target.id === 'keyboardShortcutsModal') {
      hideShortcutsModal();
    }
  });
  
  // Close modal with close button
  document.getElementById('closeShortcutsModal').addEventListener('click', hideShortcutsModal);
  
  // Open modal with help button
  document.getElementById('showShortcutsBtn').addEventListener('click', showShortcutsModal);
});

// Error handling
window.addEventListener('error', (e) => {
  console.error('Application error:', e.error);
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
});