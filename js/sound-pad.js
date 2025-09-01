class SoundPad {
  constructor(audioEngine) {
    this.audioEngine = audioEngine;
    this.sounds = {};
    this.defaultSounds = {
      airhorn: 'sounds/airhorn.mp3',
      siren: 'sounds/siren.mp3', 
      scratch: 'sounds/scratch.mp3',
      clap: 'sounds/clap.mp3',
      boom: 'sounds/boom.mp3',
      laser: 'sounds/laser.mp3'
    };
    this.setupEventListeners();
    this.loadDefaultSounds();
  }

  // Load default sound files
  async loadDefaultSounds() {
    if (!this.audioEngine.audioContext) {
      await this.audioEngine.initialize();
    }

    // Try to load each default sound file
    for (const [soundName, filePath] of Object.entries(this.defaultSounds)) {
      try {
        await this.loadSoundFile(soundName, filePath);
      } catch (error) {
        console.warn(`Could not load default sound ${soundName}: ${error.message}`);
      }
    }
  }

  // Load a sound file from URL or File object
  async loadSoundFile(soundName, source) {
    if (!this.audioEngine.audioContext) {
      await this.audioEngine.initialize();
    }

    try {
      let arrayBuffer;
      
      if (source instanceof File) {
        // Handle uploaded file
        arrayBuffer = await source.arrayBuffer();
      } else {
        // Handle URL (default sounds)
        const response = await fetch(source);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        arrayBuffer = await response.arrayBuffer();
      }

      const audioBuffer = await this.audioEngine.audioContext.decodeAudioData(arrayBuffer);
      this.sounds[soundName] = audioBuffer;
      
      return true;
    } catch (error) {
      console.error(`Error loading sound ${soundName}:`, error);
      return false;
    }
  }

  // Play a sound
  playSound(soundName) {
    if (!this.sounds[soundName] || !this.audioEngine.audioContext) {
      return;
    }

    try {
      const source = this.audioEngine.audioContext.createBufferSource();
      source.buffer = this.sounds[soundName];
      
      // Connect to master gain
      source.connect(this.audioEngine.masterGain);
      source.start();
    } catch (error) {
      console.error('Error playing sound:', error);
    }
  }

  // Handle custom file upload
  async handleFileUpload(padNumber, file) {
    if (!file) return;

    const soundName = `pad${padNumber}`;
    const success = await this.loadSoundFile(soundName, file);
    
    if (success) {
      // Update button label with filename (without extension)
      const button = document.getElementById(`soundPad${padNumber}`);
      const label = button.querySelector('.sound-label');
      const fileName = file.name.replace(/\.[^/.]+$/, ""); // Remove file extension
      label.textContent = fileName;
      
      // Update data-sound attribute
      button.setAttribute('data-sound', soundName);
      
      console.log(`Loaded custom sound: ${fileName} for pad ${padNumber}`);
    } else {
      alert('Could not load the selected audio file. Please try a different file.');
    }
  }

  // Setup event listeners for sound pad buttons and file inputs
  setupEventListeners() {
    // Add event listeners for each sound pad button
    for (let i = 1; i <= 6; i++) {
      const button = document.getElementById(`soundPad${i}`);
      const fileInput = document.getElementById(`soundFile${i}`);
      
      if (button && fileInput) {
        // Button click - check if Shift is held for file upload, otherwise play sound
        button.addEventListener('click', async (e) => {
          if (e.shiftKey) {
            // Shift+click to upload custom file
            fileInput.click();
          } else {
            // Regular click to play sound
            const soundName = button.getAttribute('data-sound');
            this.playSound(soundName);
            
            // Visual feedback
            button.style.transform = 'scale(0.95)';
            setTimeout(() => {
              button.style.transform = '';
            }, 100);
          }
        });

        // File input change event
        fileInput.addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (file) {
            await this.handleFileUpload(i, file);
          }
        });

        // Add tooltip to indicate Shift+click for upload
        button.setAttribute('title', 'Click to play sound, Shift+click to upload custom audio file');
      }
    }
  }
}

// Global sound pad instance
window.soundPad = null;