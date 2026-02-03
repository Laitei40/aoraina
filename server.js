// Simple Node HTTP server storing audio in memory only (no DB, no disk)
// Serves static front-end and exposes minimal API for temporary audio sharing.

const http = require('http');
const path = require('path');
const fs = require('fs');
const { randomBytes } = require('crypto');

const PUBLIC_DIR = path.join(__dirname, 'public');

/**
 * In-memory store for uploaded audio.
 * Shape: {
 *   [token]: {
 *     buffer: Buffer,
 *     mimeType: string,
 *     filename: string,
 *     createdAt: number,
 *     deleted: boolean
 *   }
 * }
 */
const audioStore = Object.create(null);

// Max in-memory size per upload (e.g., 25 MB)
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
// Lifetime for audio in memory (ms) – purely for safety auto-expiry
const AUDIO_TTL_MS = 60 * 60 * 1000; // 1 hour

function generateToken() {
  return randomBytes(16).toString('hex');
}

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

function notFound(res) {
  sendJson(res, 404, { error: 'Not found' });
}

function cleanExpiredAudio() {
  const now = Date.now();
  for (const [token, entry] of Object.entries(audioStore)) {
    if (entry.deleted) {
      delete audioStore[token];
      continue;
    }
    if (now - entry.createdAt > AUDIO_TTL_MS) {
      delete audioStore[token];
    }
  }
}

setInterval(cleanExpiredAudio, 10 * 60 * 1000).unref();

function serveStaticFile(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;

  // Prevent directory traversal
  filePath = path.normalize(filePath).replace(/^([.\\/])+/, '');
  const fullPath = path.join(PUBLIC_DIR, filePath);

  fs.stat(fullPath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.ico': 'image/x-icon',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(fullPath).pipe(res);
  });
}

function handleUpload(req, res) {
  // Only accept POST with multipart/form-data but parse manually into buffer.
  // For simplicity and to avoid frameworks, we'll read the whole body
  // limited by MAX_AUDIO_BYTES and rely on the front-end sending just the
  // raw file via fetch with body set to the File/Blob.

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const contentType = req.headers['content-type'] || '';
  const filenameHeader = req.headers['x-filename'] || 'audio';
  const mimeHeader = req.headers['x-mime-type'] || 'audio/mpeg';

  let received = 0;
  const chunks = [];

  req.on('data', (chunk) => {
    received += chunk.length;
    if (received > MAX_AUDIO_BYTES) {
      // Too large – destroy the connection and respond once finished
      req.destroy();
    } else {
      chunks.push(chunk);
    }
  });

  req.on('end', () => {
    if (received > MAX_AUDIO_BYTES) {
      sendJson(res, 413, { error: 'Audio file too large' });
      return;
    }

    const buffer = Buffer.concat(chunks);
    if (!buffer.length) {
      sendJson(res, 400, { error: 'No audio data received' });
      return;
    }

    const token = generateToken();
    audioStore[token] = {
      buffer,
      mimeType: mimeHeader || contentType || 'application/octet-stream',
      filename: filenameHeader,
      createdAt: Date.now(),
      deleted: false,
    };

    sendJson(res, 200, { token });
  });

  req.on('error', () => {
    sendJson(res, 500, { error: 'Upload failed' });
  });
}

function getAudioEntry(token) {
  const entry = audioStore[token];
  if (!entry || entry.deleted) return null;
  return entry;
}

function handleCheck(req, res, token) {
  const entry = getAudioEntry(token);
  if (!entry) {
    sendJson(res, 404, { exists: false, message: 'This audio is no longer available.' });
    return;
  }
  sendJson(res, 200, {
    exists: true,
    filename: entry.filename,
    createdAt: entry.createdAt,
  });
}

function handleDelete(req, res, token) {
  if (req.method !== 'DELETE' && req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const entry = getAudioEntry(token);
  if (!entry) {
    // Already gone – treat as success so UI can clean up
    sendJson(res, 200, { ok: true, message: 'Already deleted or expired' });
    return;
  }
  entry.deleted = true;
  delete audioStore[token];
  sendJson(res, 200, { ok: true });
}

function handleStream(req, res, token) {
  const entry = getAudioEntry(token);
  if (!entry) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('This audio is no longer available.');
    return;
  }

  const { buffer, mimeType } = entry;

  // Basic streaming with support for range requests so the browser
  // can seek within the audio.
  const total = buffer.length;
  const range = req.headers.range;

  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    if (!match) {
      res.writeHead(416, { 'Content-Type': 'text/plain' });
      res.end('Invalid range');
      return;
    }
    const start = parseInt(match[1], 10);
    let end = match[2] ? parseInt(match[2], 10) : total - 1;
    if (isNaN(start) || isNaN(end) || start >= total || end >= total || start > end) {
      res.writeHead(416, { 'Content-Type': 'text/plain' });
      res.end('Invalid range');
      return;
    }

    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mimeType,
      'Cache-Control': 'no-store',
    });
    res.end(buffer.slice(start, end + 1));
  } else {
    res.writeHead(200, {
      'Content-Length': total,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    });
    res.end(buffer);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // API routes – all under /api
  if (url.pathname === '/api/upload') {
    return handleUpload(req, res);
  }

  if (url.pathname.startsWith('/api/check/')) {
    const token = url.pathname.split('/').pop();
    return handleCheck(req, res, token);
  }

  if (url.pathname.startsWith('/api/delete/')) {
    const token = url.pathname.split('/').pop();
    return handleDelete(req, res, token);
  }

  if (url.pathname.startsWith('/stream/')) {
    const token = url.pathname.split('/').pop();
    return handleStream(req, res, token);
  }

  // Otherwise serve static files from public/
  return serveStaticFile(req, res);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Temp music player server running at http://localhost:${PORT}`);
});
