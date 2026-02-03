// Temporary Music Share front-end logic
// - Lets a user upload an audio file
// - Sends it to the server which keeps it only in memory (no DB, no disk)
// - Returns a unique token used to build a share link
// - When the share link is opened, the same audio is streamed over HTTP
// - A delete action (or page refresh of the uploader) invalidates the link

(function () {
  const fileInput = document.getElementById('file-input');
  const fileNameEl = document.getElementById('file-name');
  const uploadSection = document.getElementById('upload-section');
  const playerSection = document.getElementById('player-section');
  const messageSection = document.getElementById('message-section');
  const messageText = document.getElementById('message-text');

  const audio = document.getElementById('audio');
  const playPauseBtn = document.getElementById('play-pause');
  const currentTimeEl = document.getElementById('current-time');
  const durationEl = document.getElementById('duration');
  const seek = document.getElementById('seek');

  const nowPlayingEl = document.getElementById('now-playing');
  const shareLinkInput = document.getElementById('share-link');
  const copyLinkBtn = document.getElementById('copy-link');
  const deleteBtn = document.getElementById('delete-audio');
  const statusEl = document.getElementById('status');

  const uploadProgress = document.getElementById('upload-progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  const volumeSlider = document.getElementById('volume');
  const muteToggle = document.getElementById('mute-toggle');

  // Current audio token issued by the server (for uploader or viewer)
  let currentToken = null;
  let isUploader = false; // true if this page created the token by uploading
  let isDeleting = false;

  // Track uploaded tokens in localStorage so uploader status persists across refresh
  function markAsUploader(token) {
    const uploaded = JSON.parse(localStorage.getItem('uploadedTokens') || '[]');
    if (!uploaded.includes(token)) {
      uploaded.push(token);
      localStorage.setItem('uploadedTokens', JSON.stringify(uploaded));
    }
  }

  function isTokenUploadedByThisBrowser(token) {
    const uploaded = JSON.parse(localStorage.getItem('uploadedTokens') || '[]');
    return uploaded.includes(token);
  }

  function removeFromUploadedTokens(token) {
    const uploaded = JSON.parse(localStorage.getItem('uploadedTokens') || '[]');
    const filtered = uploaded.filter(t => t !== token);
    localStorage.setItem('uploadedTokens', JSON.stringify(filtered));
  }

  function setStatus(message, type) {
    statusEl.textContent = message || '';
    statusEl.classList.remove('error');
    if (type === 'error') {
      statusEl.classList.add('error');
    }
  }

  function formatTime(seconds) {
    if (!isFinite(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function showPlayer() {
    playerSection.classList.remove('hidden');
  }

  function hidePlayer() {
    playerSection.classList.add('hidden');
  }

  function showMessage(message) {
    messageText.textContent = message;
    messageSection.classList.remove('hidden');
  }

  function hideMessage() {
    messageSection.classList.add('hidden');
  }

  function buildShareUrl(token) {
    const url = new URL(window.location.origin);
    url.searchParams.set('token', token);
    return url.toString();
  }

  async function uploadFile(file) {
    return new Promise((resolve, reject) => {
      const uploadUrl = '/api/upload';

      const xhr = new XMLHttpRequest();

      // Track upload progress
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percentComplete = Math.round((e.loaded / e.total) * 100);
          progressFill.style.width = percentComplete + '%';
          progressText.textContent = percentComplete + '%';
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (!data.token) {
              reject(new Error('Server did not return a token'));
            } else {
              resolve(data.token);
            }
          } catch (e) {
            reject(new Error('Invalid server response'));
          }
        } else {
          try {
            const data = JSON.parse(xhr.responseText);
            reject(new Error(data.error || 'Upload failed'));
          } catch (e) {
            reject(new Error('Upload failed'));
          }
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Network error during upload'));
      });

      xhr.addEventListener('abort', () => {
        reject(new Error('Upload cancelled'));
      });

      xhr.open('POST', uploadUrl, true);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name || 'audio'));
      xhr.setRequestHeader('X-Mime-Type', file.type || 'audio/mpeg');

      xhr.send(file);
    });
  }

  async function checkToken(token) {
    const resp = await fetch(`/api/check/${encodeURIComponent(token)}`);
    if (!resp.ok) {
      return { exists: false, message: 'This audio is no longer available.' };
    }
    return resp.json();
  }

  async function deleteToken(token) {
    try {
      isDeleting = true;
      await fetch(`/api/delete/${encodeURIComponent(token)}`, {
        method: 'DELETE',
      });
    } catch (e) {
      // Even if the call fails, treat local state as deleted - the server
      // periodically cleans expired entries and this is best-effort.
    } finally {
      isDeleting = false;
    }
  }

  function attachAudioSourceForToken(token) {
    const streamUrl = `/stream/${encodeURIComponent(token)}`;
    audio.src = streamUrl;
    audio.load();
  }

  function resetPlayerState() {
    audio.pause();
    audio.src = '';
    currentToken = null;
    isUploader = false;
    playPauseBtn.disabled = true;
    copyLinkBtn.disabled = true;
    deleteBtn.disabled = true;
    seek.value = 0;
    currentTimeEl.textContent = '0:00';
    durationEl.textContent = '0:00';
    shareLinkInput.value = '';
    nowPlayingEl.textContent = '';
  }

  // ===== Upload flow (uploader) =====

  fileInput.addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      fileNameEl.textContent = 'No file selected.';
      return;
    }

    fileNameEl.textContent = file.name;
    hideMessage();
    resetPlayerState();

    // Show and reset progress bar
    uploadProgress.classList.remove('hidden');
    progressFill.style.width = '0%';
    progressText.textContent = '0%';
    setStatus('Uploading and preparing temporary link…');

    try {
      const token = await uploadFile(file);
      
      // Hide progress bar after successful upload
      uploadProgress.classList.add('hidden');
      
      currentToken = token;
      isUploader = true;
      markAsUploader(token); // Remember this browser uploaded this token
      const shareUrl = buildShareUrl(token);

      shareLinkInput.value = shareUrl;
      copyLinkBtn.disabled = false;
      deleteBtn.disabled = false;

      nowPlayingEl.textContent = file.name;
      attachAudioSourceForToken(token);
      showPlayer();

      // Add token to browser URL so refresh preserves the audio
      const url = new URL(window.location.href);
      url.searchParams.set('token', token);
      window.history.replaceState({}, '', url.toString());

      setStatus('Upload complete. Audio is ready to play and share.');

      // Automatically start playback when metadata is ready
      audio.addEventListener(
        'canplay',
        () => {
          if (audio.paused) {
            audio.play().catch(() => {
              // If autoplay fails due to browser policies, user can tap play.
            });
          }
        },
        { once: true }
      );
    } catch (err) {
      console.error(err);
      uploadProgress.classList.add('hidden');
      setStatus(err.message || 'Upload failed', 'error');
      resetPlayerState();
    }
  });

  // ===== Shared-link flow (viewer) =====

  async function initFromTokenInUrl() {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('token');
    if (!token) return; // No token – uploader mode only

    currentToken = token;
    
    // Check if this browser uploaded this token
    isUploader = isTokenUploadedByThisBrowser(token);

    // Only hide upload UI for viewers (not the original uploader)
    if (!isUploader) {
      uploadSection.classList.add('hidden');
    }

    const info = await checkToken(token);
    if (!info.exists) {
      showMessage(info.message || 'This audio is no longer available.');
      hidePlayer();
      return;
    }

    nowPlayingEl.textContent = decodeURIComponent(info.filename || 'Shared audio');
    attachAudioSourceForToken(token);
    showPlayer();

    shareLinkInput.value = shareUrl;
    copyLinkBtn.disabled = false;

    // Only the original uploader can delete
    deleteBtn.disabled = !isUploader;

    // Hide share/delete UI for viewers
    const shareRow = document.querySelector('.share-row');
    const actionsRow = document.querySelector('.actions-row');
    
    if (!isUploader) {
      shareRow.style.display = 'none';
      actionsRow.style.display = 'none';
      setStatus('You are listening to a temporary shared track.');
    } else {
      shareRow.style.display = 'flex';
      actionsRow.style.display = 'flex';
      setStatus('Your uploaded audio is ready. You can delete it anytime.');
    }
  }

  // ===== Player controls =====

  playPauseBtn.addEventListener('click', () => {
    if (audio.paused) {
      audio.play().catch((err) => {
        console.error(err);
      });
    } else {
      audio.pause();
    }
  });

  audio.addEventListener('play', () => {
    playPauseBtn.textContent = 'Pause';
    playPauseBtn.disabled = false;
  });

  audio.addEventListener('pause', () => {
    playPauseBtn.textContent = 'Play';
    playPauseBtn.disabled = false;
  });

  audio.addEventListener('loadedmetadata', () => {
    durationEl.textContent = formatTime(audio.duration);
    playPauseBtn.disabled = false;
  });

  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    currentTimeEl.textContent = formatTime(audio.currentTime);
    const progress = (audio.currentTime / audio.duration) * 100;
    seek.value = progress;
  });

  seek.addEventListener('input', () => {
    if (!audio.duration) return;
    const pct = parseFloat(seek.value) || 0;
    audio.currentTime = (pct / 100) * audio.duration;
  });

  // Volume controls
  volumeSlider.addEventListener('input', () => {
    const volume = parseFloat(volumeSlider.value) / 100;
    audio.volume = volume;
    
    // Update mute button icon based on volume
    if (volume === 0) {
      muteToggle.textContent = '🔇';
    } else if (volume < 0.5) {
      muteToggle.textContent = '🔉';
    } else {
      muteToggle.textContent = '🔊';
    }
  });

  muteToggle.addEventListener('click', () => {
    if (audio.muted) {
      audio.muted = false;
      const volume = parseFloat(volumeSlider.value) / 100;
      if (volume === 0) {
        volumeSlider.value = 50;
        audio.volume = 0.5;
      }
      muteToggle.textContent = audio.volume < 0.5 ? '🔉' : '🔊';
    } else {
      audio.muted = true;
      muteToggle.textContent = '🔇';
    }
  });

  copyLinkBtn.addEventListener('click', async () => {
    if (!shareLinkInput.value) return;
    try {
      await navigator.clipboard.writeText(shareLinkInput.value);
      const original = copyLinkBtn.textContent;
      copyLinkBtn.textContent = 'Copied!';
      copyLinkBtn.disabled = true;
      setTimeout(() => {
        copyLinkBtn.textContent = original;
        copyLinkBtn.disabled = false;
      }, 1200);
    } catch (e) {
      console.error(e);
      setStatus('Could not copy link. You can copy it manually.', 'error');
    }
  });

  deleteBtn.addEventListener('click', async () => {
    if (!currentToken) return;
    if (!isUploader) {
      // In this demo, only the uploader page can delete.
      setStatus('Only the original uploader can delete this audio.', 'error');
      return;
    }

    deleteBtn.disabled = true;
    // Remove from localStorage so this token is no longer marked as uploaded
    removeFromUploadedTokens(currentToken);

    setStatus('Deleting audio and invalidating link…');

    await deleteToken(currentToken);

    resetPlayerState();
    hidePlayer();
    showMessage('This audio has been deleted and the link is no longer valid.');
    setStatus('');

    // Also remove token from the URL to avoid confusion on refresh.
    const url = new URL(window.location.href);
    url.searchParams.delete('token');
    window.history.replaceState({}, '', url.toString());
  });

  // Initialize depending on whether a token is present in the URL.
  initFromTokenInUrl().catch((err) => {
    console.error(err);
    showMessage('This audio is no longer available.');
  });
})();
