# Live Transcript Tool

A single-page, client-side web app for live English transcription and
auto-splitting audio recordings. No backend or build step required — audio
and transcript data stay in your browser unless you explicitly download or
copy them.

## Features

1. **Live transcript (English only)** — real-time speech-to-text using the
   browser's Web Speech API (`en-US`), with automatic restart so long
   sessions keep transcribing.
2. **Auto-split recording** — records microphone audio and automatically
   cuts it into separate files at a configurable interval (1–30 minutes, or
   manually via "Split file now"), so you can hand the resulting files to an
   AI transcription/summarization service.
3. **Copy / save transcript** — copy the transcript to the clipboard or save
   it as a `.txt` file. The transcript box is a plain editable textarea, so
   you can fix mistakes before exporting.
4. **Flexible modes** — choose "Live transcript only", "Record audio only",
   or "Live + Record" to run both simultaneously.

## Running locally

No build step is needed. Serve the folder over HTTP (the microphone APIs
require a secure context — `https://` or `localhost`):

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open the printed URL (e.g. `http://localhost:8080`) in Chrome or Edge.

## Browser support

- **Live transcription** uses the Web Speech API (`SpeechRecognition`),
  which is supported in Chrome and Edge. Firefox and Safari currently lack
  reliable support — in those browsers, recording still works, but the live
  transcript panel will be disabled.
- **Recording** uses `MediaRecorder` and works in all modern browsers.
- The app must be served over `https://` (or `http://localhost`) for
  microphone access to be granted.

## Deployment

This is a static site (`index.html`, `style.css`, `app.js`), so it can be
hosted on any static host that serves over HTTPS — GitHub Pages, Netlify,
Vercel, Cloudflare Pages, S3 + CloudFront, etc. Just upload the three files.

## Notes on file formats

Recorded chunks are saved as `.webm` (or `.m4a`/`.ogg` depending on browser
codec support) rather than `.mp3`, since that's what browsers can encode
natively without extra libraries. Most AI transcription services (e.g.
Whisper-based tools) accept these formats directly.
