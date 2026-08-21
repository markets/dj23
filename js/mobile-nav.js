class MobileNavigation {
  static MOBILE_BREAKPOINT = 768;
  
  constructor() {
    this.nav = document.querySelector('.mobile-bottom-nav');
    this.buttons = document.querySelectorAll('.mobile-nav-btn');
    this.deckA = document.getElementById('deckA');
    this.centerMixer = document.querySelector('.center-mixer');
    this.deckB = document.getElementById('deckB');
    this.currentView = 'mixer';
    this.resizeTimeout = null;
    
    this.init();
  }
  
  init() {
    this.buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        this.switchView(view);
      });
    });
    
    if (window.innerWidth <= MobileNavigation.MOBILE_BREAKPOINT) {
      this.switchView(this.currentView);
    }
    
    window.addEventListener('resize', () => {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = setTimeout(() => {
        this.handleResize();
      }, 150);
    });
  }
  
  handleResize() {
    if (window.innerWidth <= MobileNavigation.MOBILE_BREAKPOINT) {
      this.switchView(this.currentView);
    } else {
      this.deckA.classList.remove('mobile-hidden', 'mobile-visible');
      this.centerMixer.classList.remove('mobile-hidden', 'mobile-visible');
      this.deckB.classList.remove('mobile-hidden', 'mobile-visible');
    }
  }
  
  switchView(view) {
    this.currentView = view;
    
    this.buttons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
    
    this.deckA.classList.toggle('mobile-hidden', view !== 'deckA');
    this.centerMixer.classList.toggle('mobile-hidden', view !== 'mixer');
    this.deckB.classList.toggle('mobile-hidden', view !== 'deckB');
    
    this.deckA.classList.toggle('mobile-visible', view === 'deckA');
    this.centerMixer.classList.toggle('mobile-visible', view === 'mixer');
    this.deckB.classList.toggle('mobile-visible', view === 'deckB');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.mobileNavigation = new MobileNavigation();
});
