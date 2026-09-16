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
2. Click Start, then watch the **"Mic input" meter and glowing dot** in the
   Controls panel while you speak.
   - If it **never** lights up, the browser isn't receiving any audio at
     all — check the Microphone dropdown and your OS's privacy/sound
     settings, or that the mic is muted/unplugged.
   - If it **does** light up but the transcript still shows "listening (no
     speech detected yet)": the Web Speech API used for live transcription
     has **no way to target a specific input device** — it always listens
     on whatever your **operating system's default microphone** is,
     completely ignoring the Microphone dropdown in this app (that
     dropdown only controls which device gets *recorded*). If the mic
     you're actually speaking into isn't your OS default input device,
     live transcript will hear silence even though the meter reacts fine.
     Fix it by making your mic the system default:
     - **Windows**: Settings → System → Sound → Input → set your mic as default
     - **macOS**: System Settings → Sound → Input → select your mic
     - **Linux**: e.g. `pavucontrol` → Input Devices, or your desktop's
       Sound settings
     Once that's done, live transcript should pick it up (the dropdown
     can stay on "Default microphone" at that point, since it'll now match).
3. Any other failure is surfaced as a banner message at the top of the
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
