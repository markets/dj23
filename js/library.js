class TrackLibrary {
    constructor() {
        this.tracks = [];
        this.playlists = {
            'Favorites': [],
            'Recently Added': []
        };
        this.currentPlaylist = 'Recently Added';
        
        // DOM elements
        this.libraryElement = document.getElementById('track-library');
        this.playlistsElement = document.getElementById('playlists');
        this.trackListElement = document.getElementById('track-list');
        this.createPlaylistBtn = document.getElementById('create-playlist-btn');
        this.searchInput = document.getElementById('search-tracks');
        
        this.init();
    }
    
    init() {
        this.loadFromLocalStorage();
        this.renderPlaylists();
        this.renderTracks(this.currentPlaylist);
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Create new playlist
        this.createPlaylistBtn.addEventListener('click', () => {
            const playlistName = prompt('Enter playlist name:');
            if (playlistName && !this.playlists[playlistName]) {
                this.playlists[playlistName] = [];
                this.saveToLocalStorage();
                this.renderPlaylists();
            }
        });
        
        // Search functionality
        this.searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            this.filterTracks(searchTerm);
        });
    }
    
    loadFromLocalStorage() {
        try {
            const savedTracks = localStorage.getItem('dj-mixer-tracks');
            const savedPlaylists = localStorage.getItem('dj-mixer-playlists');
            
            if (savedTracks) {
                this.tracks = JSON.parse(savedTracks);
            }
            
            if (savedPlaylists) {
                this.playlists = JSON.parse(savedPlaylists);
            }
        } catch (e) {
            console.error('Error loading from localStorage', e);
        }
    }
    
    saveToLocalStorage() {
        try {
            localStorage.setItem('dj-mixer-tracks', JSON.stringify(this.tracks));
            localStorage.setItem('dj-mixer-playlists', JSON.stringify(this.playlists));
        } catch (e) {
            console.error('Error saving to localStorage', e);
        }
    }
    
    addTrack(file, metadata = {}) {
        // Generate unique ID
        const trackId = 'track_' + Date.now();
        
        // Extract metadata if not provided
        const fileName = file.name;
        const title = metadata.title || fileName.replace(/\.[^/.]+$/, "");
        
        // Create track object
        const track = {
            id: trackId,
            file: file, // Store File object
            fileName: fileName,
            title: title,
            artist: metadata.artist || 'Unknown Artist',
            bpm: metadata.bpm || null,
            duration: metadata.duration || 0,
            dateAdded: new Date().toISOString()
        };
        
        // Add to tracks array
        this.tracks.push(track);
        
        // Add to Recently Added playlist
        this.playlists['Recently Added'].unshift(trackId);
        
        this.saveToLocalStorage();
        this.renderTracks(this.currentPlaylist);
        
        return track;
    }
    
    removeTrack(trackId) {
        // Remove from tracks array
        this.tracks = this.tracks.filter(track => track.id !== trackId);
        
        // Remove from all playlists
        for (const playlist in this.playlists) {
            this.playlists[playlist] = this.playlists[playlist].filter(id => id !== trackId);
        }
        
        this.saveToLocalStorage();
        this.renderTracks(this.currentPlaylist);
    }
    
    addToPlaylist(trackId, playlistName) {
        if (this.playlists[playlistName] && !this.playlists[playlistName].includes(trackId)) {
            this.playlists[playlistName].push(trackId);
            this.saveToLocalStorage();
        }
    }
    
    removeFromPlaylist(trackId, playlistName) {
        if (this.playlists[playlistName]) {
            this.playlists[playlistName] = this.playlists[playlistName].filter(id => id !== trackId);
            this.saveToLocalStorage();
            this.renderTracks(this.currentPlaylist);
        }
    }
    
    selectPlaylist(playlistName) {
        if (this.playlists[playlistName]) {
            this.currentPlaylist = playlistName;
            this.renderTracks(playlistName);
            
            // Update UI to show selected playlist
            const playlistItems = this.playlistsElement.querySelectorAll('.playlist-item');
            playlistItems.forEach(item => {
                item.classList.remove('active');
                if (item.dataset.playlist === playlistName) {
                    item.classList.add('active');
                }
            });
        }
    }
    
    renderPlaylists() {
        this.playlistsElement.innerHTML = '';
        
        // Create playlist items
        for (const playlistName in this.playlists) {
            const playlistItem = document.createElement('div');
            playlistItem.className = 'playlist-item';
            playlistItem.dataset.playlist = playlistName;
            if (playlistName === this.currentPlaylist) {
                playlistItem.classList.add('active');
            }
            
            playlistItem.innerHTML = `
                <span class="playlist-name">${playlistName}</span>
                <span class="track-count">${this.playlists[playlistName].length}</span>
            `;
            
            playlistItem.addEventListener('click', () => {
                this.selectPlaylist(playlistName);
            });
            
            // Add context menu for playlist (except for default playlists)
            if (playlistName !== 'Favorites' && playlistName !== 'Recently Added') {
                playlistItem.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    if (confirm(`Delete playlist "${playlistName}"?`)) {
                        delete this.playlists[playlistName];
                        this.saveToLocalStorage();
                        this.renderPlaylists();
                        if (this.currentPlaylist === playlistName) {
                            this.selectPlaylist('Recently Added');
                        }
                    }
                });
            }
            
            this.playlistsElement.appendChild(playlistItem);
        }
    }
    
    renderTracks(playlistName) {
        this.trackListElement.innerHTML = '';
        
        if (!this.playlists[playlistName]) return;
        
        const trackIds = this.playlists[playlistName];
        
        if (trackIds.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.className = 'empty-playlist';
            emptyMessage.textContent = 'No tracks in this playlist';
            this.trackListElement.appendChild(emptyMessage);
            return;
        }
        
        trackIds.forEach(trackId => {
            const track = this.tracks.find(t => t.id === trackId);
            if (!track) return;
            
            const trackItem = document.createElement('div');
            trackItem.className = 'track-item';
            trackItem.dataset.trackId = track.id;
            
            const formattedDuration = track.duration ? 
                `${Math.floor(track.duration / 60)}:${String(Math.floor(track.duration % 60)).padStart(2, '0')}` : 
                '--:--';
            
            trackItem.innerHTML = `
                <div class="track-info">
                    <div class="track-title">${track.title}</div>
                    <div class="track-artist">${track.artist}</div>
                </div>
                <div class="track-meta">
                    ${track.bpm ? `<div class="track-bpm">${track.bpm} BPM</div>` : ''}
                    <div class="track-duration">${formattedDuration}</div>
                </div>
                <div class="track-actions">
                    <button class="load-deck-1">Deck 1</button>
                    <button class="load-deck-2">Deck 2</button>
                </div>
            `;
            
            // Load to deck buttons
            trackItem.querySelector('.load-deck-1').addEventListener('click', () => {
                const event = new CustomEvent('loadTrackToDeck', {
                    detail: { track, deckId: 1 }
                });
                document.dispatchEvent(event);
            });
            
            trackItem.querySelector('.load-deck-2').addEventListener('click', () => {
                const event = new CustomEvent('loadTrackToDeck', {
                    detail: { track, deckId: 2 }
                });
                document.dispatchEvent(event);
            });
            
            // Context menu for track item
            trackItem.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showTrackContextMenu(e, track);
            });
            
            this.trackListElement.appendChild(trackItem);
        });
    }
    
    filterTracks(searchTerm) {
        const trackItems = this.trackListElement.querySelectorAll('.track-item');
        
        trackItems.forEach(item => {
            const trackId = item.dataset.trackId;
            const track = this.tracks.find(t => t.id === trackId);
            
            if (track) {
                const titleMatches = track.title.toLowerCase().includes(searchTerm);
                const artistMatches = track.artist.toLowerCase().includes(searchTerm);
                
                if (titleMatches || artistMatches) {
                    item.style.display = '';
                } else {
                    item.style.display = 'none';
                }
            }
        });
    }
    
    showTrackContextMenu(event, track) {
        // Remove any existing context menus
        const existingMenu = document.querySelector('.context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }
        
        const contextMenu = document.createElement('div');
        contextMenu.className = 'context-menu';
        contextMenu.style.left = `${event.clientX}px`;
        contextMenu.style.top = `${event.clientY}px`;
        
        // Add to playlist option
        const addToPlaylistOption = document.createElement('div');
        addToPlaylistOption.className = 'context-menu-item';
        addToPlaylistOption.innerHTML = 'Add to playlist ▶';
        
        const playlistSubmenu = document.createElement('div');
        playlistSubmenu.className = 'context-submenu';
        
        for (const playlistName in this.playlists) {
            if (playlistName !== 'Recently Added') {
                const playlistOption = document.createElement('div');
                playlistOption.className = 'context-menu-item';
                playlistOption.textContent = playlistName;
                
                playlistOption.addEventListener('click', () => {
                    this.addToPlaylist(track.id, playlistName);
                    contextMenu.remove();
                });
                
                playlistSubmenu.appendChild(playlistOption);
            }
        }
        
        addToPlaylistOption.appendChild(playlistSubmenu);
        contextMenu.appendChild(addToPlaylistOption);
        
        // Remove from current playlist option (except Recently Added)
        if (this.currentPlaylist !== 'Recently Added') {
            const removeOption = document.createElement('div');
            removeOption.className = 'context-menu-item';
            removeOption.textContent = `Remove from ${this.currentPlaylist}`;
            
            removeOption.addEventListener('click', () => {
                this.removeFromPlaylist(track.id, this.currentPlaylist);
                contextMenu.remove();
            });
            
            contextMenu.appendChild(removeOption);
        }
        
        // Delete track option
        const deleteOption = document.createElement('div');
        deleteOption.className = 'context-menu-item';
        deleteOption.textContent = 'Delete track';
        
        deleteOption.addEventListener('click', () => {
            if (confirm('Delete this track from your library?')) {
                this.removeTrack(track.id);
            }
            contextMenu.remove();
        });
        
        contextMenu.appendChild(deleteOption);
        
        // Add the context menu to the document
        document.body.appendChild(contextMenu);
        
        // Close the context menu when clicking elsewhere
        const closeContextMenu = () => {
            contextMenu.remove();
            document.removeEventListener('click', closeContextMenu);
        };
        
        // Small delay to prevent immediate closing
        setTimeout(() => {
            document.addEventListener('click', closeContextMenu);
        }, 100);
    }
    
    // Method to update track metadata after analysis
    updateTrackMetadata(trackId, metadata) {
        const trackIndex = this.tracks.findIndex(track => track.id === trackId);
        
        if (trackIndex !== -1) {
            this.tracks[trackIndex] = {
                ...this.tracks[trackIndex],
                ...metadata
            };
            
            this.saveToLocalStorage();
            this.renderTracks(this.currentPlaylist);
        }
    }
}