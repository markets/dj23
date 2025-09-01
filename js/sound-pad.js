class SoundPad {
  constructor(audioEngine) {
    this.audioEngine = audioEngine;
    this.sounds = {};
    this.volume = 1.0; // Volume level from 0.0 to 1.0
    this.defaultSounds = {
      airhorn: 'sounds/airhorn.mp3',
      siren: 'sounds/siren.mp3', 
      scratch: 'sounds/scratch.mp3',
      clap: 'sounds/clap.mp3',
      boom: 'sounds/boom.mp3',
      laser: 'sounds/laser.mp3',
      applause: 'sounds/applause.mp3',
      drop: 'sounds/drop.mp3',
      whoosh: 'sounds/whoosh.mp3'
    };
    this.setupEventListeners();
    this.loadDefaultSounds();
  }

  async loadDefaultSounds() {
    if (!this.audioEngine.audioContext) {
      await this.audioEngine.initialize();
    }

    for (const [soundName, filePath] of Object.entries(this.defaultSounds)) {
      try {
        await this.loadSoundFile(soundName, filePath);
      } catch (error) {
        console.warn(`Could not load default sound ${soundName}: ${error.message}`);
      }
    }
  }

  async loadSoundFile(soundName, source) {
    if (!this.audioEngine.audioContext) {
      await this.audioEngine.initialize();
    }

    try {
      let arrayBuffer;
      
      if (source instanceof File) {
        arrayBuffer = await source.arrayBuffer();
      } else {
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

  playSound(soundName) {
    if (!this.sounds[soundName] || !this.audioEngine.audioContext) {
      return;
    }

    try {
      const source = this.audioEngine.audioContext.createBufferSource();
      source.buffer = this.sounds[soundName];
      
      const gainNode = this.audioEngine.audioContext.createGain();
      gainNode.gain.value = this.volume;
      
      source.connect(gainNode);
      gainNode.connect(this.audioEngine.masterGain);
      source.start();
    } catch (error) {
      console.error('Error playing sound:', error);
    }
  }

  async handleFileUpload(padNumber, file) {
    if (!file) return;

    const soundName = `pad${padNumber}`;
    const success = await this.loadSoundFile(soundName, file);
    
    if (success) {
      const button = document.getElementById(`soundPad${padNumber}`);
      const label = button.querySelector('.sound-label');
      const fileName = file.name.replace(/\.[^/.]+$/, "");
      label.textContent = fileName;
      
      button.setAttribute('data-sound', soundName);
      
      console.log(`Loaded custom sound: ${fileName} for pad ${padNumber}`);
    } else {
      alert('Could not load the selected audio file. Please try a different file.');
    }
  }

  setupEventListeners() {
    for (let i = 1; i <= 9; i++) {
      const button = document.getElementById(`soundPad${i}`);
      const editButton = document.getElementById(`editPad${i}`);
      const fileInput = document.getElementById(`soundFile${i}`);
      
      if (button && editButton && fileInput) {
        button.addEventListener('click', (e) => {
          const soundName = button.getAttribute('data-sound');
          this.playSound(soundName);
          
          button.style.transform = 'scale(0.95)';
          setTimeout(() => {
            button.style.transform = '';
          }, 100);
        });

        editButton.addEventListener('click', (e) => {
          fileInput.click();
        });

        fileInput.addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (file) {
            await this.handleFileUpload(i, file);
          }
        });

        button.setAttribute('title', 'Click to play sound');
        editButton.setAttribute('title', 'Upload custom audio file');
      }
    }

    const volumeFader = document.getElementById('soundPadVolume');
    if (volumeFader) {
      volumeFader.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        this.volume = value / 100;
        const volumeDisplay = e.target.nextElementSibling;
        if (volumeDisplay) {
          volumeDisplay.textContent = `${value}%`;
        }
      });
    }
  }
}

window.soundPad = null;
