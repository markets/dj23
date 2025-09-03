class KeyboardShortcuts {
  constructor() {
    this.modalElement = null;
    this.isModalOpen = false;
    this.cueKeysPressed = new Set(); // Track which CUE keys are currently pressed
    this.initialize();
  }

  initialize() {
    this.setupEventListeners();
    this.setupModal();
  }

  setupEventListeners() {
    document.addEventListener('keydown', (e) => this.handleKeyDown(e));
    document.addEventListener('keyup', (e) => this.handleKeyUp(e));
  }

  // Helper function for deck transport controls
  controlDeck(deckId, action) {
    const mixerController = window.mixerController;
    if (!mixerController) return;

    switch (action) {
      case 'play':
        mixerController.playDeck(deckId);
        break;
      case 'pause':
        mixerController.pauseDeck(deckId);
        break;
      case 'stop':
        mixerController.stopDeck(deckId);
        break;
    }
  }

  // Helper function for CUE press-and-hold behavior
  handleCuePress(deckId, keyCode) {
    if (this.cueKeysPressed.has(keyCode)) return; // Already pressed

    this.cueKeysPressed.add(keyCode);
    const deck = window.audioEngine.getDeck(deckId);
    if (deck) {
      deck.startCueMode();
    }
  }

  // Helper function for CUE release
  handleCueRelease(deckId, keyCode) {
    if (!this.cueKeysPressed.has(keyCode)) return; // Not pressed

    this.cueKeysPressed.delete(keyCode);
    const deck = window.audioEngine.getDeck(deckId);
    if (deck) {
      deck.stopCueMode();
    }
  }

  // Helper function for button clicks
  clickButton(buttonId) {
    document.getElementById(buttonId)?.click();
  }

  setupModal() {
    const modal = document.getElementById('keyboardShortcutsModal');
    if (modal) {
      this.modalElement = modal;
      
      modal.addEventListener('click', (e) => {
        if (e.target.id === 'keyboardShortcutsModal') {
          this.hideModal();
        }
      });
      
      const closeBtn = document.getElementById('closeShortcutsModal');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => this.hideModal());
      }
      
      const showBtn = document.getElementById('showShortcutsBtn');
      if (showBtn) {
        showBtn.addEventListener('click', () => this.showModal());
      }
    }
  }

  handleKeyDown(e) {
    if (this.isModalOpen) {
      if (e.code === 'Escape') {
        this.hideModal();
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

    if (e.ctrlKey) {
      this.handleCtrlCombinations(e);
      return;
    }

    this.handleRegularShortcuts(e);
  }

  handleCtrlCombinations(e) {
    const ctrlActions = {
      'KeyS': () => this.clickButton('syncAB'),
      'KeyD': () => this.clickButton('syncBA'),
      'KeyO': () => this.clickButton('fileInputA'),
      'KeyP': () => this.clickButton('fileInputB')
    };

    const action = ctrlActions[e.code];
    if (action) action();
  }

  handleRegularShortcuts(e) {
    // Define keyboard mappings for easier maintenance
    const shortcuts = {
      // General controls
      'Space': () => this.controlDeck('A', 'play'),
      
      // Deck A Controls
      'KeyQ': () => this.controlDeck('A', 'play'),
      'KeyW': () => this.controlDeck('A', 'pause'),
      'KeyE': () => this.controlDeck('A', 'stop'),
      'KeyR': () => this.handleCuePress('A', 'KeyR'),
      
      // Deck B Controls
      'KeyA': () => this.controlDeck('B', 'play'),
      'KeyS': () => this.controlDeck('B', 'pause'),
      'KeyD': () => this.controlDeck('B', 'stop'),
      'KeyF': () => this.handleCuePress('B', 'KeyF'),
      
      // Cue Points
      'Digit1': () => this.handleCuePoint(e, 'A', 1),
      'Digit2': () => this.handleCuePoint(e, 'A', 2),
      'Digit3': () => this.handleCuePoint(e, 'B', 1),
      'Digit4': () => this.handleCuePoint(e, 'B', 2),
      
      // Loop Controls
      'KeyT': () => this.clickButton('loopInA'),
      'KeyY': () => this.clickButton('loopOutA'),
      'KeyU': () => this.clickButton('loopToggleA'),
      'KeyG': () => this.clickButton('loopInB'),
      'KeyH': () => this.clickButton('loopOutB'),
      'KeyJ': () => this.clickButton('loopToggleB'),
      
      // Pitch Bend
      'Equal': () => this.clickButton('pitchBendPlusA'),
      'Minus': () => this.clickButton('pitchBendMinusA'),
      'BracketRight': () => this.clickButton('pitchBendPlusB'),
      'BracketLeft': () => this.clickButton('pitchBendMinusB'),
      
      // Crossfader and Master Volume
      'ArrowLeft': () => this.adjustCrossfader(-5),
      'ArrowRight': () => this.adjustCrossfader(5),
      'ArrowUp': () => this.adjustMasterVolume(5),
      'ArrowDown': () => this.adjustMasterVolume(-5),
      
      // Show shortcuts modal
      'Slash': () => {
        if (e.shiftKey) this.showModal();
      }
    };

    const action = shortcuts[e.code];
    if (action) action();
  }

  handleCuePoint(e, deck, cueNumber) {
    if (e.shiftKey) {
      document.getElementById(`setCue${cueNumber}${deck}`)?.click();
    } else {
      document.getElementById(`cue${cueNumber}${deck}`)?.click();
    }
  }

  adjustCrossfader(delta) {
    const crossfader = document.getElementById('crossfader');
    if (crossfader) {
      const currentValue = parseInt(crossfader.value);
      const newValue = Math.max(0, Math.min(100, currentValue + delta));
      crossfader.value = newValue;
      crossfader.dispatchEvent(new Event('input'));
    }
  }

  adjustMasterVolume(delta) {
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

  showModal() {
    if (this.modalElement) {
      this.modalElement.classList.add('show');
      document.body.style.overflow = 'hidden';
      this.isModalOpen = true;
    }
  }

  hideModal() {
    if (this.modalElement) {
      this.modalElement.classList.remove('show');
      document.body.style.overflow = 'auto';
      this.isModalOpen = false;
    }
  }

  handleKeyUp(e) {
    // Handle CUE key releases for press-and-hold behavior
    const cueKeyMappings = {
      'KeyR': 'A',
      'KeyF': 'B'
    };

    const deckId = cueKeyMappings[e.code];
    if (deckId) {
      this.handleCueRelease(deckId, e.code);
    }
  }
}

// Export for use in other modules
window.KeyboardShortcuts = KeyboardShortcuts;
