# Aoraina - Temporary Music Share

A temporary music sharing app that allows users to upload audio files and share them via unique links for transcription purposes.

## Features

- 🎵 Upload audio files (MP3, WAV, etc.)
- 🔗 Generate unique, shareable links
- 🌍 Stream audio globally via Cloudflare Workers + R2
- 🔄 Links survive page refresh (stored in R2)
- 🗑️ Manual deletion removes audio from R2 and invalidates links
- 📱 Mobile-friendly interface
- 🚫 No database required - uses Cloudflare R2 for temporary storage

## Tech Stack

- **Frontend**: HTML, CSS, Vanilla JavaScript
- **Backend**: Cloudflare Pages Functions (Workers)
- **Storage**: Cloudflare R2 Object Storage
- **Deployment**: Cloudflare Pages

## Local Development

1. Install dependencies:
```bash
npm install -g wrangler
```

2. Create an R2 bucket named `tsd-mm` in your Cloudflare dashboard.

3. Run the development server:
```bash
wrangler pages dev
```

4. Open http://127.0.0.1:8788

## Deployment

Deploy to Cloudflare Pages:

```bash
wrangler pages deploy public --project-name temp-music-share
```

## How It Works

1. **Upload**: User uploads an audio file → stored in R2 with a unique token
2. **Share**: A shareable link is generated: `https://your-domain/?token=<uuid>`
3. **Stream**: Anyone with the link can stream the audio from R2
4. **Delete**: Original uploader can delete the audio, invalidating the link
5. **Persistence**: Audio survives page refresh (stored in R2, tracked via localStorage)

## Project Structure

```
.
├── functions/              # Cloudflare Pages Functions (API routes)
│   ├── api/
│   │   ├── upload.js      # POST /api/upload - Upload audio to R2
│   │   ├── check/
│   │   │   └── [token].js # GET /api/check/:token - Check if audio exists
│   │   └── delete/
│   │       └── [token].js # DELETE /api/delete/:token - Remove from R2
│   └── stream/
│       └── [token].js     # GET /stream/:token - Stream audio with range support
├── public/                # Static frontend files
│   ├── index.html
│   ├── styles.css
│   └── script.js
├── wrangler.toml          # Cloudflare configuration
└── README.md
```

## API Endpoints

### `POST /api/upload`
Upload an audio file to R2.

**Headers:**
- `Content-Type`: Audio MIME type
- `X-Filename`: Original filename (URL-encoded)
- `X-Mime-Type`: Audio MIME type

**Response:**
```json
{
  "token": "uuid-v4-token"
}
```

### `GET /api/check/:token`
Check if audio exists in R2.

**Response:**
```json
{
  "exists": true,
  "filename": "song.mp3",
  "createdAt": "1738540800000"
}
```

### `DELETE /api/delete/:token`
Remove audio from R2.

**Response:**
```json
{
  "ok": true
}
```

### `GET /stream/:token`
Stream audio with HTTP Range support for seeking.

**Headers:**
- `Range: bytes=start-end` (optional)

**Response:**
- `200 OK` (full audio)
- `206 Partial Content` (range request)
- `404 Not Found` (audio deleted/expired)

## Configuration

Edit `wrangler.toml` to customize:

```toml
name = "temp-music-player"
compatibility_date = "2026-02-03"
pages_build_output_dir = "public"

[[r2_buckets]]
binding = "AUDIO_BUCKET"
bucket_name = "tsd-mm"  # Change this to your R2 bucket name
```

## Storage & Privacy

- Audio files are stored temporarily in Cloudflare R2
- No traditional database or permanent storage
- Original uploader can delete anytime
- Optional: Add R2 lifecycle rules for auto-expiry (e.g., 24 hours)

## Use Case

This app is designed for **temporary audio sharing for transcription purposes**:
- Record or upload audio
- Share link with transcription service or colleague
- Recipient streams and transcribes
- Delete after transcription is complete

## License

MIT License - see [LICENSE](LICENSE) file for details

## Live Demo

https://7b200954.temp-music-share.pages.dev

---

Built with ❤️ using Cloudflare Workers + R2
