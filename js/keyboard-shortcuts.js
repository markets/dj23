class KeyboardShortcuts {
  constructor() {
    this.modalElement = null;
    this.isModalOpen = false;
    this.initialize();
  }

  initialize() {
    this.setupEventListeners();
    this.setupModal();
  }

  setupEventListeners() {
    document.addEventListener('keydown', (e) => this.handleKeyDown(e));
  }

  setupModal() {
    // Initialize modal event listeners
    const modal = document.getElementById('keyboardShortcutsModal');
    if (modal) {
      this.modalElement = modal;
      
      // Close modal when clicking outside
      modal.addEventListener('click', (e) => {
        if (e.target.id === 'keyboardShortcutsModal') {
          this.hideModal();
        }
      });
      
      // Close modal with close button
      const closeBtn = document.getElementById('closeShortcutsModal');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => this.hideModal());
      }
      
      // Open modal with help button
      const showBtn = document.getElementById('showShortcutsBtn');
      if (showBtn) {
        showBtn.addEventListener('click', () => this.showModal());
      }
    }
  }

  handleKeyDown(e) {
    // Don't handle shortcuts if modal is open
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

    // Handle Ctrl combinations
    if (e.ctrlKey) {
      this.handleCtrlCombinations(e);
      return;
    }

    this.handleRegularShortcuts(e);
  }

  handleCtrlCombinations(e) {
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
  }

  handleRegularShortcuts(e) {
    switch (e.code) {
      case 'Space':
        // Toggle play/pause for active deck (default to A if none active)
        window.mixerController?.playDeck('A');
        break;
      
      // Deck A Controls
      case 'KeyQ':
        window.mixerController?.playDeck('A');
        break;
      case 'KeyW':
        window.mixerController?.pauseDeck('A');
        break;
      case 'KeyE':
        window.mixerController?.stopDeck('A');
        break;
      case 'KeyR':
        window.mixerController?.cueDeck('A');
        break;
      
      // Deck B Controls
      case 'KeyA':
        window.mixerController?.playDeck('B');
        break;
      case 'KeyS':
        window.mixerController?.pauseDeck('B');
        break;
      case 'KeyD':
        window.mixerController?.stopDeck('B');
        break;
      case 'KeyF':
        window.mixerController?.cueDeck('B');
        break;
      
      // Cue Points
      case 'Digit1':
        this.handleCuePoint(e, 'A', 1);
        break;
      case 'Digit2':
        this.handleCuePoint(e, 'A', 2);
        break;
      case 'Digit3':
        this.handleCuePoint(e, 'B', 1);
        break;
      case 'Digit4':
        this.handleCuePoint(e, 'B', 2);
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
        this.adjustCrossfader(-5);
        break;
      case 'ArrowRight':
        this.adjustCrossfader(5);
        break;
      case 'ArrowUp':
        this.adjustMasterVolume(5);
        break;
      case 'ArrowDown':
        this.adjustMasterVolume(-5);
        break;
      
      // Show shortcuts modal
      case 'Slash':
        if (e.shiftKey) { // ? key (Shift + /)
          this.showModal();
        }
        break;
    }
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
}

// Export for use in other modules
window.KeyboardShortcuts = KeyboardShortcuts;
