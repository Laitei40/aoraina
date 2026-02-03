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
    setStatus('Uploading and preparing temporary link…');

    const uploadUrl = '/api/upload';

    const resp = await fetch(uploadUrl, {
      method: 'POST',
      // We send only the raw file bytes as the body. The Node server
      // reads it into memory and associates it with a unique token.
      body: file,
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Filename': encodeURIComponent(file.name || 'audio'),
        'X-Mime-Type': file.type || 'audio/mpeg',
      },
    });

    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || 'Upload failed');
    }

    const data = await resp.json();
    if (!data.token) throw new Error('Server did not return a token');

    return data.token;
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

    try {
      const token = await uploadFile(file);
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

    if (isUploader) {
      setStatus('Your uploaded audio is ready. You can delete it anytime.');
    } else {
      setStatus('You are listening to a temporary shared track.');
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
