class KeyboardShortcuts {
  constructor(deck1, deck2, mixer) {
      this.deck1 = deck1;
      this.deck2 = deck2;
      this.mixer = mixer;
      
      // Modal elements
      this.shortcutsModal = document.getElementById('shortcuts-modal');
      this.showShortcutsBtn = document.getElementById('show-keyboard-shortcuts');
      this.closeShortcutsBtn = document.getElementById('close-shortcuts-modal');
      
      this.init();
  }
  
  init() {
      // Set up keyboard event listeners
      document.addEventListener('keydown', this.handleKeyDown.bind(this));
      
      // Modal toggle
      this.showShortcutsBtn.addEventListener('click', () => {
          this.shortcutsModal.classList.add('show');
      });
      
      this.closeShortcutsBtn.addEventListener('click', () => {
          this.shortcutsModal.classList.remove('show');
      });
      
      // Close modal when clicking outside
      this.shortcutsModal.addEventListener('click', (e) => {
          if (e.target === this.shortcutsModal) {
              this.shortcutsModal.classList.remove('show');
          }
      });
  }
  
  handleKeyDown(e) {
      // Ignore if user is typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
          return;
      }
      
      // Get key (lowercase)
      const key = e.key.toLowerCase();
      
      // DECK 1 SHORTCUTS
      
      // Play/Pause (Q)
      if (key === 'q') {
          this.deck1.togglePlay();
          e.preventDefault();
      }
      
      // Cue (W)
      if (key === 'w') {
          this.deck1.cue();
          e.preventDefault();
      }
      
      // Hot Cues (1-4)
      if (['1', '2', '3', '4'].includes(key)) {
          const cueIndex = parseInt(key) - 1;
          if (e.shiftKey) {
              this.deck1.setHotCue(cueIndex);
          } else {
              this.deck1.jumpToHotCue(cueIndex);
          }
          e.preventDefault();
      }
      
      // Loop controls (D, F, G)
      if (key === 'd') {
          this.deck1.setLoopIn();
          e.preventDefault();
      }
      
      if (key === 'f') {
          this.deck1.toggleLoop();
          e.preventDefault();
      }
      
      if (key === 'g') {
          this.deck1.setLoopOut();
          e.preventDefault();
      }
      
      // Pitch bend (Z, X)
      if (key === 'z') {
          if (e.type === 'keydown') {
              this.deck1.startPitchBend(-1);
          }
          e.preventDefault();
      }
      
      if (key === 'x') {
          if (e.type === 'keydown') {
              this.deck1.startPitchBend(1);
          }
          e.preventDefault();
      }
      
      // DECK 2 SHORTCUTS
      
      // Play/Pause (P)
      if (key === 'p') {
          this.deck2.togglePlay();
          e.preventDefault();
      }
      
      // Cue (O)
      if (key === 'o') {
          this.deck2.cue();
          e.preventDefault();
      }
      
      // Hot Cues (7-0)
      if (['7', '8', '9', '0'].includes(key)) {
          const cueMap = { '7': 0, '8': 1, '9': 2, '0': 3 };
          const cueIndex = cueMap[key];
          if (e.shiftKey) {
              this.deck2.setHotCue(cueIndex);
          } else {
              this.deck2.jumpToHotCue(cueIndex);
          }
          e.preventDefault();
      }
      
      // Loop controls (H, J, K)
      if (key === 'h') {
          this.deck2.setLoopIn();
          e.preventDefault();
      }
      
      if (key === 'j') {
          this.deck2.toggleLoop();
          e.preventDefault();
      }
      
      if (key === 'k') {
          this.deck2.setLoopOut();
          e.preventDefault();
      }
      
      // Pitch bend (N, M)
      if (key === 'n') {
          if (e.type === 'keydown') {
              this.deck2.startPitchBend(-1);
          }
          e.preventDefault();
      }
      
      if (key === 'm') {
          if (e.type === 'keydown') {
              this.deck2.startPitchBend(1);
          }
          e.preventDefault();
      }
      
      // MIXER SHORTCUTS
      
      // Crossfader (Left/Right Arrows)
      if (key === 'arrowleft') {
          const currentValue = parseInt(this.mixer.crossfaderSlider.value);
          const newValue = Math.max(0, currentValue - 5);
          this.mixer.crossfaderSlider.value = newValue;
          this.mixer.setCrossfader(newValue);
          e.preventDefault();
      }
      
      if (key === 'arrowright') {
          const currentValue = parseInt(this.mixer.crossfaderSlider.value);
          const newValue = Math.min(100, currentValue + 5);
          this.mixer.crossfaderSlider.value = newValue;
          this.mixer.setCrossfader(newValue);
          e.preventDefault();
      }
      
      // Center crossfader (Space)
      if (key === ' ') {
          this.mixer.crossfaderSlider.value = 50;
          this.mixer.setCrossfader(50);
          e.preventDefault();
      }
      
      // Tap tempo (T)
      if (key === 't') {
          document.getElementById('tap-tempo').click();
          e.preventDefault();
      }
  }
  
  handleKeyUp(e) {
      const key = e.key.toLowerCase();
      
      // Stop pitch bend when key is released
      if (key === 'z' || key === 'x') {
          this.deck1.stopPitchBend();
          e.preventDefault();
      }
      
      if (key === 'n' || key === 'm') {
          this.deck2.stopPitchBend();
          e.preventDefault();
      }
  }
}