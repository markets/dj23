class KeyboardShortcuts {
  constructor() {
    this.modalElement = null;
    this.isModalOpen = false;
    this.cueKeysPressed = new Set(); // Track which CUE keys are currently pressed
    this.pitchBendKeysPressed = new Set(); // Track which pitch bend keys are currently pressed
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

  controlDeck(deckId, action) {
    const deckController = window.mixerController.deckControllers[deckId];

    switch (action) {
      case 'play':
        deckController.play();
        break;
      case 'pause':
        deckController.pause();
        break;
      case 'stop':
        deckController.stop();
        break;
    }
  }

  handleCuePress(deckId, keyCode) {
    if (this.cueKeysPressed.has(keyCode)) return; // Already pressed

    this.cueKeysPressed.add(keyCode);
    this.getDeck(deckId).startCueMode();
  }

  handleCueRelease(deckId, keyCode) {
    if (!this.cueKeysPressed.has(keyCode)) return; // Not pressed

    this.cueKeysPressed.delete(keyCode);
    this.getDeck(deckId).stopCueMode();
  }

  handlePitchBendPress(deckId, keyCode, direction) {
    if (this.pitchBendKeysPressed.has(keyCode)) return; // Already pressed

    this.pitchBendKeysPressed.add(keyCode);
    this.getDeck(deckId).pitchBend(direction);
  }

  handlePitchBendRelease(deckId, keyCode) {
    if (!this.pitchBendKeysPressed.has(keyCode)) return; // Not pressed

    this.pitchBendKeysPressed.delete(keyCode);
    this.getDeck(deckId).stopPitchBend();
  }

  clickButton(buttonId) {
    document.getElementById(buttonId)?.click();
  }

  getDeck(deckId) {
    return window.audioEngine.getDeck(deckId);
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

  /** Text fields swallow the shortcuts: typing "search" in a box should not
   *  stop deck A, cue deck B and nudge the pitch on the way through. Faders
   *  and buttons are deliberately not covered — arrow keys on a focused fader
   *  are the browser doing the right thing already. */
  isTypingTarget(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    if (target.tagName === 'TEXTAREA') return true;
    if (target.tagName !== 'INPUT') return false;

    return ['text', 'search', 'email', 'url', 'password', 'number', 'tel']
      .includes(target.type);
  }

  handleKeyDown(e) {
    if (this.isTypingTarget(e.target)) return;

    if (this.isModalOpen) {
      if (e.code === 'Escape') {
        this.hideModal();
      }
      return;
    }

    const shortcuts = [
      'Space', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyA', 'KeyS',
      'KeyU', 'KeyI', 'KeyO', 'KeyP', 'KeyJ', 'KeyK',
      'KeyZ', 'KeyX', 'KeyN', 'KeyM',
      'Digit1', 'Digit2', 'Digit8', 'Digit9',
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'
    ];
    
    if (shortcuts.includes(e.code) || e.key === '?' || (e.ctrlKey && ['KeyS', 'KeyD', 'KeyO', 'KeyP'].includes(e.code))) {
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
    // Handle help modal shortcut first - make "?" the exclusive trigger
    if (e.key === '?') {
      this.showModal();
      return;
    }

    const shortcuts = {
      'Space': () => this.controlDeck('A', 'play'),
      
      'KeyQ': () => this.controlDeck('A', 'play'),
      'KeyW': () => this.controlDeck('A', 'pause'),
      'KeyE': () => this.controlDeck('A', 'stop'),
      'KeyR': () => this.handleCuePress('A', 'KeyR'),
      
      'Digit1': () => this.handleCuePoint(e, 'A', 1),
      'Digit2': () => this.handleCuePoint(e, 'A', 2),
      
      'KeyA': () => this.handlePitchBendPress('A', 'KeyA', -1),
      'KeyS': () => this.handlePitchBendPress('A', 'KeyS', 1),
      
      'KeyZ': () => this.clickButton('loopInA'),
      'KeyX': () => this.clickButton('loopOutA'),
      
      'KeyU': () => this.controlDeck('B', 'play'),
      'KeyI': () => this.controlDeck('B', 'pause'),
      'KeyO': () => this.controlDeck('B', 'stop'),
      'KeyP': () => this.handleCuePress('B', 'KeyP'),
      
      'Digit8': () => this.handleCuePoint(e, 'B', 1),
      'Digit9': () => this.handleCuePoint(e, 'B', 2),
      
      'KeyJ': () => this.handlePitchBendPress('B', 'KeyJ', -1),
      'KeyK': () => this.handlePitchBendPress('B', 'KeyK', 1),
      
      'KeyN': () => this.clickButton('loopInB'),
      'KeyM': () => this.clickButton('loopOutB'),
      
      'ArrowLeft': () => this.adjustCrossfader(-5),
      'ArrowRight': () => this.adjustCrossfader(5),
      'ArrowUp': () => this.adjustMasterVolume(5),
      'ArrowDown': () => this.adjustMasterVolume(-5)
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
    if (this.isTypingTarget(e.target)) return;

    const cueKeyMappings = {
      'KeyR': 'A',
      'KeyP': 'B'
    };

    const deckId = cueKeyMappings[e.code];
    if (deckId) {
      this.handleCueRelease(deckId, e.code);
    }

    const pitchBendKeyMappings = {
      'KeyA': 'A',
      'KeyS': 'A',
      'KeyJ': 'B',
      'KeyK': 'B'
    };

    const pitchBendDeckId = pitchBendKeyMappings[e.code];
    if (pitchBendDeckId) {
      this.handlePitchBendRelease(pitchBendDeckId, e.code);
    }
  }
}

window.KeyboardShortcuts = KeyboardShortcuts;
