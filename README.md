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

- **Live transcription** uses the Web Speech API (`SpeechRecognition`).
  It only works in **official Google Chrome or Microsoft Edge** — under the
  hood it streams audio to a cloud speech service that's tied to a
  proprietary API key baked into those specific builds. Open-source
  Chromium, Brave, and other Chromium forks look identical but do **not**
  have that key, so recognition fails immediately (usually surfaced here as
  "no mic" or a similar error). Firefox and Safari don't support the API at
  all. In any of these cases, recording still works — only the live
  transcript panel is affected.
- Because live transcription depends on that cloud service, it also
  **requires an active internet connection**, even though the page itself
  is fully local.
- **Recording** uses the Web Audio API plus a bundled MP3 encoder
  (`vendor/lame.min.js`) and works in all modern browsers, fully offline.
- The app must be served over `https://` (or `http://localhost`) for
  microphone access to be granted — opening `index.html` directly via
  `file://` will not work.

### If live transcript "doesn't detect your voice"

1. Confirm you're on real Chrome or Edge (see above) and check the address
   bar for a blocked microphone icon.
2. Click Start, then watch the **"Mic input" meter** in the Controls panel
   while you speak. If it moves, the browser is receiving audio — the
   problem is the speech service (check your internet connection, or a
   banner should appear after a few seconds of silence with more detail).
   If it never moves, the wrong microphone is likely selected, or the OS
   is blocking mic access for the browser — check the Microphone dropdown
   and your system's privacy/sound settings.
3. Any failure is now also surfaced as a banner message at the top of the
   page (blocked permission, no mic found, network error, etc.) instead of
   failing silently.

## Deployment

This is a static site (`index.html`, `style.css`, `app.js`), so it can be
hosted on any static host that serves over HTTPS — GitHub Pages, Netlify,
Vercel, Cloudflare Pages, S3 + CloudFront, etc. Just upload the three files.

## Notes on file formats

Recorded chunks are saved as `.mp3`. Browsers can't encode MP3 natively, so
the app captures raw PCM audio via the Web Audio API and encodes it
client-side with a bundled build of the LAME encoder
(`vendor/lame.min.js`, from the `lamejs` project, LGPL — see
`vendor/LAME-LICENSE.txt`). Everything happens locally in the browser; no
audio is uploaded anywhere by this app. `.zip` export uses a vendored copy
of JSZip (`vendor/jszip.min.js`, MIT).
