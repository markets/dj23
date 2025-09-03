/**
 * Unified button handler system to reduce repetitive code
 * Provides common patterns for button behaviors across mouse, touch, and keyboard
 */

class ButtonHandler {
  constructor() {
    this.activeButtons = new Set();
  }

  /**
   * Creates a unified press-and-hold handler for buttons
   * @param {string} buttonId - The button element ID
   * @param {Function} onStart - Function to call when press starts
   * @param {Function} onStop - Function to call when press stops
   * @param {Object} options - Configuration options
   */
  createPressAndHoldHandler(buttonId, onStart, onStop, options = {}) {
    const button = document.getElementById(buttonId);
    if (!button) return;

    const config = {
      preventContextMenu: true,
      updateActiveState: true,
      ...options
    };

    const startPress = (e) => {
      if (e) e.preventDefault();
      if (this.activeButtons.has(buttonId)) return; // Already active
      
      this.activeButtons.add(buttonId);
      if (config.updateActiveState) {
        button.classList.add('active');
      }
      onStart();
    };

    const stopPress = (e) => {
      if (e) e.preventDefault();
      if (!this.activeButtons.has(buttonId)) return; // Not active
      
      this.activeButtons.delete(buttonId);
      if (config.updateActiveState) {
        button.classList.remove('active');
      }
      onStop();
    };

    // Mouse events
    button.addEventListener('mousedown', startPress);
    button.addEventListener('mouseup', stopPress);
    button.addEventListener('mouseleave', stopPress);

    // Touch events
    button.addEventListener('touchstart', startPress);
    button.addEventListener('touchend', stopPress);
    button.addEventListener('touchcancel', stopPress);

    if (config.preventContextMenu) {
      button.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    return { startPress, stopPress };
  }

  /**
   * Creates a simple click handler for buttons
   * @param {string} buttonId - The button element ID
   * @param {Function} onClick - Function to call on click
   */
  createClickHandler(buttonId, onClick) {
    const button = document.getElementById(buttonId);
    if (!button) return;

    button.addEventListener('click', onClick);
  }

  /**
   * Helper function for common deck operations
   * @param {string} deckId - The deck identifier ('A' or 'B')
   * @param {string} method - The method name to call on the deck
   * @param {...any} args - Arguments to pass to the method
   */
  callDeckMethod(deckId, method, ...args) {
    const deck = window.audioEngine?.getDeck(deckId);
    if (deck && typeof deck[method] === 'function') {
      return deck[method](...args);
    }
    return null;
  }

  /**
   * Helper function for deck operations with controller state updates
   * @param {string} deckId - The deck identifier ('A' or 'B')
   * @param {string} method - The method name to call on the deck
   * @param {string} controllerMethod - Optional controller method to call
   * @param {...any} args - Arguments to pass to the methods
   */
  callDeckWithController(deckId, method, controllerMethod = null, ...args) {
    const result = this.callDeckMethod(deckId, method, ...args);
    
    if (controllerMethod) {
      const controller = window.mixerController?.deckControllers[deckId];
      if (controller && typeof controller[controllerMethod] === 'function') {
        controller[controllerMethod](...args);
      }
    }
    
    return result;
  }
}

// Create global instance
window.buttonHandler = new ButtonHandler();