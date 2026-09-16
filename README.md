# Live Transcript Tool

A single-page, client-side web app for live English transcription and
auto-splitting audio recordings. No backend or build step required — audio
and transcript data stay in your browser unless you explicitly download or
copy them.

## Features

1. **Live transcript (English only)** — real-time speech-to-text, with two
   selectable engines (see below): the browser's built-in Web Speech API,
   or a local, in-browser AI model (Vosk) that can listen through whichever
   microphone you pick.
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

## Live transcript engines

Pick the engine in Settings → "Live transcript engine":

- **Browser built-in** (default) — uses the Web Speech API
  (`SpeechRecognition`). Fast and quite accurate, but comes with two hard
  platform limitations that no amount of app-side code can work around:
  - It only works in **official Google Chrome or Microsoft Edge** — under
    the hood it streams audio to a cloud speech service tied to a
    proprietary API key baked into those specific builds. Open-source
    Chromium, Brave, and other Chromium forks look identical but do
    **not** have that key, so recognition fails immediately. Firefox and
    Safari don't support the API at all.
  - It **always listens on your OS's default microphone** and gives web
    pages no way to target a different device — so the Microphone dropdown
    in this app is disabled while this engine is selected in "Live
    transcript only" mode, since it would have no effect.
  - Because it depends on that cloud service, it also **requires an active
    internet connection**, even though the page itself is fully local.
- **Local AI model (beta)** — runs [Vosk](https://alphacephei.com/vosk/)
  entirely inside your browser via WebAssembly (bundled as
  `vendor/vosk.js`), processing audio from whichever mic you pick in the
  dropdown — including in "Live transcript only" mode. Trade-offs:
  - The first time you click Start with this engine, it downloads a speech
    model (~40MB, English) from the URL in Settings → Advanced → "local AI
    model URL"; after that it's cached by the browser and runs fully
    offline. This needs an internet connection *once*.
  - Noticeably less accurate than the browser's built-in engine, and adds
    a short delay before each phrase is finalized.
  - The default model URL points at a third-party demo host
    (`ccoreilly.github.io`). If it's slow, blocked on your network, or
    goes offline, host your own copy of a Vosk model (packaged as
    `.tar.gz`, see [vosk-browser's model
    docs](https://github.com/ccoreilly/vosk-browser)) and paste its URL
    into that same field.

In either case, **recording** uses the Web Audio API plus a bundled MP3
encoder (`vendor/lame.min.js`) and works in all modern browsers, fully
offline, using whichever mic you pick in the dropdown.

The app must be served over `https://` (or `http://localhost`) for
microphone access to be granted — opening `index.html` directly via
`file://` will not work.

### If live transcript "doesn't detect your voice"

1. Click Start, then watch the **"Mic input" meter and glowing dot** in the
   Controls panel while you speak.
   - If it **never** lights up, the browser isn't receiving any audio at
     all — check the Microphone dropdown and your OS's privacy/sound
     settings, or that the mic is muted/unplugged.
   - If it **does** light up but the transcript still shows "listening (no
     speech detected yet)" and you're using the **browser built-in**
     engine: the mic it's actually listening to isn't the one you're
     speaking into (see the hard limitation above). There are **three
     independent places** a "default" microphone gets decided, and any one
     of them can be the culprit — check all three, not just one:
     1. **Chrome's own mic setting**, separate from the OS entirely:
        `chrome://settings/content/microphone` (or click the icon left of
        the address bar → Microphone). Chrome can have its own default
        pinned here that overrides everything else.
     2. **The OS default *and* default communications device** — Windows
        exposes these as two separate roles that can point at different
        devices (Settings → System → Sound → Input on Windows 11; on
        Windows 10/11 you can also press Win+R → `mmsys.cpl` →
        Recording tab → right-click a device → "Set as Default Device" /
        "Set as Default Communication Device"). macOS: System Settings →
        Sound → Input. Linux: e.g. `pavucontrol` → Input Devices.
     3. As a fallback that sidesteps all of the above, switch the engine
        to **Local AI model**, which listens through whichever device is
        explicitly picked in this app's own Microphone dropdown, ignoring
        every OS/Chrome-level "default" setting.
   - Also confirm you're on real Chrome or Edge if using the built-in
     engine (see above), and check the address bar for a blocked
     microphone icon.
2. Any other failure is surfaced as a banner message at the top of the
   page (blocked permission, no mic found, network error, model failed to
   download, etc.) instead of failing silently.

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

## Third-party components

- `vendor/lame.min.js` — LAME MP3 encoder (via `lamejs`), LGPL. See
  `vendor/LAME-LICENSE.txt`.
- `vendor/jszip.min.js` — JSZip, MIT.
- `vendor/vosk.js` — [vosk-browser](https://github.com/ccoreilly/vosk-browser),
  Apache-2.0, a WebAssembly build of [Vosk](https://alphacephei.com/vosk/).
  The speech model it loads at runtime (not included in this repo, fetched
  from the URL in Settings) is also Apache-2.0.
