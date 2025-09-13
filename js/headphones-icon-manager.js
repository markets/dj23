/**
 * Headphones Icon Manager
 * Handles switching between different headphones icon styles
 */

class HeadphonesIconManager {
    constructor() {
        this.styles = {
            current: `<path d="M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9zM7 12v6H6c-.55 0-1-.45-1-1v-5h2zm12 5c0 .55-.45 1-1 1h-1v-6h2v5z"/>`,
            
            modern: `<path d="M12 2C7.58 2 4 5.58 4 10v8c0 1.1.9 2 2 2h2c.55 0 1-.45 1-1v-6c0-.55-.45-1-1-1H6v-2c0-3.31 2.69-6 6-6s6 2.69 6 6v2h-2c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h2c1.1 0 2-.9 2-2v-8c0-4.42-3.58-8-8-8z"/>`,
            
            professional: `<path d="M12 1.5C6.75 1.5 2.5 5.75 2.5 11v6.5c0 1.38 1.12 2.5 2.5 2.5h1.5c.83 0 1.5-.67 1.5-1.5v-5c0-.83-.67-1.5-1.5-1.5H5V11c0-3.86 3.14-7 7-7s7 3.14 7 7v1h-1.5c-.83 0-1.5.67-1.5 1.5v5c0 .83.67 1.5 1.5 1.5H19c1.38 0 2.5-1.12 2.5-2.5V11c0-5.25-4.25-9.5-9.5-9.5z"/>
            <circle cx="6.5" cy="15.5" r="1"/>
            <circle cx="17.5" cy="15.5" r="1"/>
            <path d="M7 4.5h10c.28 0 .5.22.5.5s-.22.5-.5.5H7c-.28 0-.5-.22-.5-.5s.22-.5.5-.5z"/>`,
            
            dj: `<path d="M12 1C6.48 1 2 5.48 2 11v6c0 2.21 1.79 4 4 4h3c.55 0 1-.45 1-1v-7c0-.55-.45-1-1-1H4v-1c0-4.42 3.58-8 8-8s8 3.58 8 8v1h-5c-.55 0-1 .45-1 1v7c0 .55.45 1 1 1h3c2.21 0 4-1.79 4-4v-6c0-5.52-4.48-10-10-10z"/>
            <rect x="4" y="13" width="4" height="6" rx="1"/>
            <rect x="16" y="13" width="4" height="6" rx="1"/>
            <path d="M8 3h8c1.1 0 2 .9 2 2s-.9 2-2 2H8C6.9 7 6 6.1 6 5s.9-2 2-2z"/>`,
            
            retro: `<path d="M12 2c-4.97 0-9 4.03-9 9v6c0 1.66 1.34 3 3 3h2.5c.83 0 1.5-.67 1.5-1.5v-4c0-.83-.67-1.5-1.5-1.5H6v-2c0-3.31 2.69-6 6-6s6 2.69 6 6v2h-2.5c-.83 0-1.5.67-1.5 1.5v4c0 .83.67 1.5 1.5 1.5H18c1.66 0 3-1.34 3-3v-6c0-4.97-4.03-9-9-9z"/>
            <circle cx="7" cy="15" r="2.5" fill="none" stroke="currentColor" stroke-width="0.5"/>
            <circle cx="17" cy="15" r="2.5" fill="none" stroke="currentColor" stroke-width="0.5"/>
            <path d="M9 3.5c0-.28.22-.5.5-.5h5c.28 0 .5.22.5.5v1c0 .28-.22.5-.5.5h-5c-.28 0-.5-.22-.5-.5v-1z"/>
            <path d="M8.5 4h7c.28 0 .5.22.5.5s-.22.5-.5.5h-7c-.28 0-.5-.22-.5-.5s.22-.5.5-.5z"/>`,
            
            futuristic: `<path d="M12 1l-2 2H6l-4 4v6l2 2h2l2 2v4h2v-4l2-2h2l2-2v-6l-4-4h-4L12 1z"/>
            <path d="M4 10v6l1 1h2v-8H6l-2 2z"/>
            <path d="M20 10l-2-2h-1v8h2l1-1v-6z"/>
            <polygon points="12,2 10,4 14,4"/>
            <polygon points="7,14 9,16 7,18 5,16"/>
            <polygon points="17,14 19,16 17,18 15,16"/>
            <path d="M8 4h8l1 1v1H7V5l1-1z"/>`
        };
        
        this.init();
    }

    init() {
        // Apply saved style on page load
        this.applySavedStyle();
        
        // Check for style changes periodically (in case user changes selection)
        setInterval(() => {
            this.applySavedStyle();
        }, 1000);
    }

    applySavedStyle() {
        const savedStyle = localStorage.getItem('selectedHeadphonesStyle');
        if (savedStyle && this.styles[savedStyle]) {
            this.updateIcons(savedStyle);
        }
    }

    updateIcons(style) {
        if (!this.styles[style]) {
            console.warn(`Headphones style "${style}" not found`);
            return;
        }

        // Find all headphones icons and update them
        const headphonesIcons = document.querySelectorAll('.headphones-icon');
        headphonesIcons.forEach(icon => {
            icon.innerHTML = this.styles[style];
        });

        console.log(`🎧 Updated headphones icons to ${style} style`);
    }

    getAvailableStyles() {
        return Object.keys(this.styles);
    }

    setStyle(style) {
        if (!this.styles[style]) {
            console.warn(`Headphones style "${style}" not found`);
            return false;
        }

        localStorage.setItem('selectedHeadphonesStyle', style);
        this.updateIcons(style);
        return true;
    }

    getCurrentStyle() {
        return localStorage.getItem('selectedHeadphonesStyle') || 'current';
    }
}

// Initialize the icon manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.headphonesIconManager = new HeadphonesIconManager();
});

// Export for use in other modules if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = HeadphonesIconManager;
}