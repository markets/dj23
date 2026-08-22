class Playlist {
  /** Files whose tags are read at once. Without a cap, dropping a 300-track
   *  folder opens 300 concurrent reads and the tab stalls. */
  static METADATA_CONCURRENCY = 4;

  static AUDIO_EXTENSIONS = /\.(mp3|m4a|aac|wav|flac|ogg|opus|aif|aiff)$/i;

  constructor() {
    // Session-only: a dropped File cannot be reopened after a reload, so a
    // restored list would be rows that refuse to play
    this.tracks = [];
    this.rowsById = new Map();
    this.filter = '';
    this.isOpen = false;

    this.analysisQueue = [];
    this.isAnalysing = false;

    this.cacheElements();
    if (!this.panel) return;

    this.setupCoverObserver();
    this.setupEventListeners();
    this.render();
  }

  cacheElements() {
    this.panel = document.getElementById('playlistPanel');
    this.toggleBtn = document.getElementById('playlistToggle');
    this.closeBtn = document.getElementById('playlistClose');
    this.clearBtn = document.getElementById('playlistClear');
    this.searchInput = document.getElementById('playlistSearch');
    this.folderInput = document.getElementById('playlistFolderInput');
    this.rowsElement = document.getElementById('playlistRows');
    this.emptyElement = document.getElementById('playlistEmpty');
    this.countElement = document.getElementById('playlistCount');
  }

  setupEventListeners() {
    this.toggleBtn.addEventListener('click', () => this.toggle());
    this.closeBtn.addEventListener('click', () => this.close());
    this.clearBtn.addEventListener('click', () => this.clear());

    this.searchInput.addEventListener('input', (e) => {
      this.filter = e.target.value.trim().toLowerCase();
      this.applyFilter();
    });

    // Shortcuts are suppressed while typing, so Escape is the way out
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      this.searchInput.value = '';
      this.filter = '';
      this.applyFilter();
      this.searchInput.blur();
    });

    this.folderInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []).map(file => ({
        file,
        path: file.webkitRelativePath || file.name
      }));
      this.ingest(files);
      e.target.value = ''; // so picking the same folder twice still fires
    });

    // Load buttons live in rows that come and go, so the click is delegated
    this.rowsElement.addEventListener('click', (e) => {
      const button = e.target.closest('[data-deck]');
      if (!button) return;
      const row = button.closest('.playlist-row');
      this.loadToDeck(row.dataset.id, button.dataset.deck);
    });

    // Dropped anywhere on the window, since the point is that you drag a folder
    // in and it appears. Decks stop 'drop' bubbling, so those never reach here.
    ['dragenter', 'dragover'].forEach(name => {
      window.addEventListener(name, (e) => {
        if (!this.dragCarriesFiles(e)) return;
        e.preventDefault();
        this.panel.classList.add('drag-over');
      });
    });

    window.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null) this.panel.classList.remove('drag-over');
    });

    window.addEventListener('drop', async (e) => {
      if (!this.dragCarriesFiles(e)) return;
      e.preventDefault();
      this.panel.classList.remove('drag-over');
      const dropped = await this.collectFromDataTransfer(e.dataTransfer);
      if (dropped.length) this.ingest(dropped);
    });
  }

  dragCarriesFiles(event) {
    return Boolean(event.dataTransfer) && Array.from(event.dataTransfer.types).includes('Files');
  }

  /** Covers are the memory-hungry part of a long list, so each one is decoded
   *  only while its row is on screen and released the moment it scrolls away. */
  setupCoverObserver() {
    this.coverObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const track = this.tracks.find(t => t.id === entry.target.dataset.id);
        if (!track) continue;
        if (entry.isIntersecting) {
          this.loadCover(track);
        } else {
          this.releaseCover(track);
        }
      }
    }, { root: this.rowsElement, rootMargin: '200px' });
  }

  // --- Reading folders -------------------------------------------------

  async collectFromDataTransfer(dataTransfer) {
    const entries = Array.from(dataTransfer.items || [])
      .map(item => item.webkitGetAsEntry && item.webkitGetAsEntry())
      .filter(Boolean);

    // No entry API (or plain files dragged from elsewhere): take the files
    if (!entries.length) {
      return Array.from(dataTransfer.files || [])
        .filter(file => Playlist.AUDIO_EXTENSIONS.test(file.name))
        .map(file => ({ file, path: file.name }));
    }

    const collected = [];
    for (const entry of entries) {
      await this.walkEntry(entry, collected);
    }
    return collected;
  }

  async walkEntry(entry, collected) {
    if (entry.isFile) {
      if (!Playlist.AUDIO_EXTENSIONS.test(entry.name)) return;
      const file = await new Promise((resolve) => entry.file(resolve, () => resolve(null)));
      if (file) collected.push({ file, path: entry.fullPath || file.name });
      return;
    }

    if (!entry.isDirectory) return;

    // readEntries hands back batches of 100 and signals the end with an empty
    // one, so it has to be drained
    const reader = entry.createReader();
    while (true) {
      const batch = await new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));
      if (!batch.length) break;
      for (const child of batch) {
        await this.walkEntry(child, collected);
      }
    }
  }

  // --- Building the list -----------------------------------------------

  async ingest(incoming) {
    if (!incoming.length) return;

    const fresh = [];
    for (const { file, path } of incoming) {
      const id = path || file.name;

      // Dropping the same folder twice should not double the list
      if (this.tracks.some(track => track.id === id)) continue;

      const track = {
        id,
        name: file.name,
        title: '',
        artist: '',
        album: '',
        duration: null,
        bpm: null,
        key: null,
        file,
        coverState: 'idle',
        coverUrl: null
      };
      fresh.push(track);
    }

    // Newest first: after a second folder you want what you just added
    this.tracks = [...fresh, ...this.tracks];

    this.render();
    this.open();
    await this.hydrate(fresh);
    this.startAnalysis();
  }

  // --- Tempo in the background ------------------------------------------

  /** Queue every track that has no tempo yet. */
  startAnalysis() {
    const waiting = this.tracks.filter(track => track.file && track.bpm === null);
    this.analysisQueue = waiting;
    this.updateChrome();

    if (waiting.length && !this.isAnalysing) this.runAnalysis();
  }

  async runAnalysis() {
    if (!window.trackAnalyser.ensureWorker()) return;

    this.isAnalysing = true;

    while (this.analysisQueue.length) {
      // A deck being loaded comes first
      while (DeckController.loadsInFlight > 0) {
        await new Promise((resolve) => setTimeout(resolve, 120));
      }

      const track = this.analysisQueue.shift();
      // The list can be cleared or replaced from under the queue
      if (!this.tracks.includes(track) || !track.file || track.bpm !== null) continue;

      const { bpm, key } = await this.analyseTrack(track);
      track.bpm = bpm;
      track.key = key;
      this.updateRow(track);
      this.updateChrome();

      // Hand a frame back to the mixer between decodes
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    this.isAnalysing = false;
    this.updateChrome();
  }

  /**
   * One decode, one analysis, one release. Sequential on purpose: a decoded
   * track is tens of megabytes, and holding several at once is what makes
   * mobile give up. A failure here costs one BPM cell, nothing else.
   */
  async analyseTrack(track) {
    const context = window.audioEngine?.audioContext;
    if (!context) return { bpm: null, key: null };

    try {
      const buffer = await context.decodeAudioData(await track.file.arrayBuffer());
      return await window.trackAnalyser.analyse(buffer);
    } catch (error) {
      console.warn(`Playlist: could not analyse ${track.name}:`, error);
      return { bpm: 0, key: null };
    }
  }


  /** Tags and duration for every new track, a few files at a time. */
  async hydrate(tracks) {
    const queue = tracks.slice();

    const worker = async () => {
      while (queue.length) {
        const track = queue.shift();
        await this.readTags(track);
        track.duration = await this.readDuration(track);
        this.updateRow(track);
      }
    };

    await Promise.all(
      Array.from({ length: Playlist.METADATA_CONCURRENCY }, worker)
    );
  }

  /** Title and artist only — the embedded picture is deliberately dropped
   *  here and fetched later per visible row, so a big folder does not park
   *  hundreds of decoded images in memory. */
  readTags(track) {
    return new Promise((resolve) => {
      if (!track.file || !window.jsmediatags) return resolve();

      window.jsmediatags.read(track.file, {
        onSuccess: ({ tags }) => {
          track.title = tags.title || '';
          track.artist = tags.artist || '';
          track.album = tags.album || '';
          resolve();
        },
        onError: () => resolve()
      });
    });
  }

  /** Duration without decoding: the media element reads the header and stops. */
  readDuration(track) {
    return new Promise((resolve) => {
      if (!track.file) return resolve(null);

      const url = URL.createObjectURL(track.file);
      const audio = new Audio();

      const finish = (value) => {
        URL.revokeObjectURL(url);
        audio.removeAttribute('src');
        resolve(value);
      };

      audio.addEventListener('loadedmetadata', () => {
        finish(Number.isFinite(audio.duration) ? audio.duration : null);
      }, { once: true });
      audio.addEventListener('error', () => finish(null), { once: true });

      audio.preload = 'metadata';
      audio.src = url;
    });
  }

  loadCover(track) {
    if (!track.file || track.coverState !== 'idle' || !window.jsmediatags) return;
    track.coverState = 'loading';

    window.jsmediatags.read(track.file, {
      onSuccess: ({ tags }) => {
        const picture = tags.picture;
        if (!picture || !picture.data) {
          track.coverState = 'none';
          return;
        }

        const blob = new Blob([new Uint8Array(picture.data)], { type: picture.format });
        track.coverUrl = URL.createObjectURL(blob);
        track.coverState = 'loaded';

        const image = this.rowsById.get(track.id)?.querySelector('.playlist-cover img');
        if (image) {
          image.src = track.coverUrl;
          image.hidden = false;
        }
      },
      onError: () => { track.coverState = 'none'; }
    });
  }

  releaseCover(track) {
    if (track.coverState !== 'loaded') return;

    const image = this.rowsById.get(track.id)?.querySelector('.playlist-cover img');
    if (image) {
      image.hidden = true;
      image.removeAttribute('src');
    }

    URL.revokeObjectURL(track.coverUrl);
    track.coverUrl = null;
    track.coverState = 'idle';
  }

  // --- Rendering --------------------------------------------------------

  render() {
    this.coverObserver.disconnect();
    this.rowsById.clear();
    this.rowsElement.textContent = '';

    for (const track of this.tracks) {
      const row = this.buildRow(track);
      this.rowsById.set(track.id, row);
      this.rowsElement.appendChild(row);
      this.coverObserver.observe(row);
    }

    this.applyFilter();
    this.updateChrome();
  }

  buildRow(track) {
    const row = document.createElement('li');
    row.className = 'playlist-row';
    row.dataset.id = track.id;
    row.innerHTML = `
      <div class="playlist-cover"><img alt="" hidden></div>
      <div class="playlist-meta">
        <span class="playlist-track-title"></span>
        <span class="playlist-track-artist"></span>
      </div>
      <span class="playlist-key"></span>
      <span class="playlist-bpm"></span>
      <span class="playlist-duration"></span>
      <div class="playlist-load">
        <button class="playlist-load-btn" data-deck="A">A</button>
        <button class="playlist-load-btn" data-deck="B">B</button>
      </div>`;
    this.fillRow(row, track);
    return row;
  }

  fillRow(row, track) {
    row.title = track.name;
    row.querySelector('.playlist-track-title').textContent = track.title || track.name;
    row.querySelector('.playlist-track-artist').textContent = track.artist || '';
    row.querySelector('.playlist-duration').textContent = this.formatDuration(track.duration);
    row.querySelector('.playlist-bpm').textContent = track.bpm > 0 ? `${Math.round(track.bpm)} BPM` : '';

    // Camelot on the row, the musical name on hover
    const keyCell = row.querySelector('.playlist-key');
    keyCell.textContent = track.key ? track.key.camelot : '';
    keyCell.title = track.key ? track.key.name : '';
  }

  updateRow(track) {
    const row = this.rowsById.get(track.id);
    if (row) this.fillRow(row, track);
    this.updateChrome();
  }

  applyFilter() {
    for (const track of this.tracks) {
      const row = this.rowsById.get(track.id);
      if (!row) continue;
      const haystack = `${track.title} ${track.artist} ${track.name}`.toLowerCase();
      row.hidden = Boolean(this.filter) && !haystack.includes(this.filter);
    }
    this.updateChrome();
  }

  updateChrome() {
    const visible = this.tracks.filter(track => !this.rowsById.get(track.id)?.hidden).length;
    this.countElement.textContent = this.tracks.length ? `${visible}/${this.tracks.length}` : '';
    this.emptyElement.hidden = this.tracks.length > 0;
  }

  formatDuration(seconds) {
    if (!seconds && seconds !== 0) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // --- Actions ----------------------------------------------------------

  async loadToDeck(trackId, deckId) {
    const track = this.tracks.find(t => t.id === trackId);
    if (!track) return;

    const controller = window.mixerController?.deckControllers?.[deckId];
    if (!controller) return;

    await controller.loadTrack(track.file, track.key);

    // The deck analyses on load, so this is the one moment the row can learn the
    // tempo; it sticks, so the second reach for a track already shows it
    track.bpm = window.audioEngine.getDeck(deckId)?.getBaseBPM() || null;
    this.updateRow(track);
  }

  clear() {
    this.tracks.forEach(track => this.releaseCover(track));
    this.tracks = [];
    this.analysisQueue = [];
    this.render();
  }

  open() {
    this.isOpen = true;
    this.panel.hidden = false;
    this.toggleBtn.setAttribute('aria-expanded', 'true');
  }

  close() {
    this.isOpen = false;
    this.panel.hidden = true;
    this.toggleBtn.setAttribute('aria-expanded', 'false');
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.playlist = new Playlist();
});
