/**
 * DJ23 Vinyl Controller
 * Handles vinyl record scratching interactions and animations
 */
class VinylController {
  constructor(deckId) {
    this.deckId = deckId;
    this.vinylElement = null;
    this.isScratching = false;
    this.isDragging = false;
    this.lastAngle = 0;
    this.startAngle = 0;
    this.initialize();
  }

  initialize() {
    this.vinylElement = document.getElementById(`vinyl${this.deckId}`);
    if (this.vinylElement) {
      this.setupVinylControls();
    }
  }

  setupVinylControls() {
    if (!this.vinylElement) return;

    // Mouse events for scratching
    this.vinylElement.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    document.addEventListener('mouseup', () => this.handleMouseUp());

    // Touch events for mobile scratching
    this.vinylElement.addEventListener('touchstart', (e) => this.handleTouchStart(e));
    this.vinylElement.addEventListener('touchmove', (e) => this.handleTouchMove(e));
    this.vinylElement.addEventListener('touchend', (e) => this.handleTouchEnd(e));
  }

  handleMouseDown(e) {
    this.isDragging = true;
    this.isScratching = true;
    
    const centerCoords = this.getVinylCenter();
    this.startAngle = Math.atan2(e.clientY - centerCoords.y, e.clientX - centerCoords.x);
    this.lastAngle = this.startAngle;
    
    const deck = window.audioEngine.getDeck(this.deckId);
    if (deck) {
      deck.startScratch();
    }
  }

  handleMouseMove(e) {
    if (!this.isDragging || !this.isScratching) return;

    const centerCoords = this.getVinylCenter();
    const currentAngle = Math.atan2(e.clientY - centerCoords.y, e.clientX - centerCoords.x);
    
    const angleDiff = this.normalizeAngleDiff(currentAngle - this.lastAngle);
    
    const deck = window.audioEngine.getDeck(this.deckId);
    if (deck) {
      // Convert angle difference to scratch speed
      const scratchSpeed = angleDiff * 10; // Adjust multiplier for sensitivity
      deck.scratch(scratchSpeed);
    }
    
    this.lastAngle = currentAngle;
  }

  handleMouseUp() {
    if (this.isDragging) {
      this.isDragging = false;
      this.isScratching = false;
      
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        deck.stopScratch();
      }
    }
  }

  handleTouchStart(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const centerCoords = this.getVinylCenter();
    
    this.isDragging = true;
    this.isScratching = true;
    this.startAngle = Math.atan2(touch.clientY - centerCoords.y, touch.clientX - centerCoords.x);
    this.lastAngle = this.startAngle;
    
    const deck = window.audioEngine.getDeck(this.deckId);
    if (deck) {
      deck.startScratch();
    }
  }

  handleTouchMove(e) {
    e.preventDefault();
    if (!this.isDragging || !this.isScratching) return;

    const touch = e.touches[0];
    const centerCoords = this.getVinylCenter();
    const currentAngle = Math.atan2(touch.clientY - centerCoords.y, touch.clientX - centerCoords.x);
    
    const angleDiff = this.normalizeAngleDiff(currentAngle - this.lastAngle);
    
    const deck = window.audioEngine.getDeck(this.deckId);
    if (deck) {
      const scratchSpeed = angleDiff * 10;
      deck.scratch(scratchSpeed);
    }
    
    this.lastAngle = currentAngle;
  }

  handleTouchEnd(e) {
    e.preventDefault();
    if (this.isDragging) {
      this.isDragging = false;
      this.isScratching = false;
      
      const deck = window.audioEngine.getDeck(this.deckId);
      if (deck) {
        deck.stopScratch();
      }
    }
  }

  getVinylCenter() {
    const rect = this.vinylElement.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }

  normalizeAngleDiff(angleDiff) {
    // Handle angle wrap-around
    if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
    return angleDiff;
  }

  startSpinning() {
    if (this.vinylElement && !this.isScratching) {
      this.vinylElement.classList.add('spinning');
    }
  }

  stopSpinning() {
    if (this.vinylElement) {
      this.vinylElement.classList.remove('spinning');
    }
  }

  getIsScratching() {
    return this.isScratching;
  }
}

// Export for use in other modules
window.VinylController = VinylController;