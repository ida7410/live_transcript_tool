(() => {
  'use strict';

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const startBtn = $('startBtn');
  const stopBtn = $('stopBtn');
  const splitNowBtn = $('splitNowBtn');
  const liveStatus = $('liveStatus');
  const recordStatus = $('recordStatus');
  const micSelect = $('micSelect');
  const refreshMicsBtn = $('refreshMicsBtn');
  const micDeviceNote = $('micDeviceNote');
  const chunkDurationSelect = $('chunkDuration');
  const timestampToggle = $('timestampToggle');
  const transcriptArea = $('transcriptArea');
  const interimIndicator = $('interimIndicator');
  const copyBtn = $('copyBtn');
  const saveTxtBtn = $('saveTxtBtn');
  const clearTranscriptBtn = $('clearTranscriptBtn');
  const fileListEl = $('fileList');
  const chunkCountdownEl = $('chunkCountdown');
  const downloadAllBtn = $('downloadAllBtn');
  const clearFilesBtn = $('clearFilesBtn');
  const unsupportedBanner = $('unsupportedBanner');
  const permissionBanner = $('permissionBanner');
  const micMeterFill = $('micMeterFill');
  const voiceDot = $('voiceDot');
  const micMeterEl = document.querySelector('.mic-meter');
  const liveEngineSelect = $('liveEngine');
  const engineNote = $('engineNote');
  const voskModelUrlInput = $('voskModelUrl');

  const VOICE_THRESHOLD = 0.15;
  const VOICE_HOLD_MS = 250;

  const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
  const speechSupported = !!SpeechRecognitionImpl;
  const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
  const recordingSupported = !!(navigator.mediaDevices && AudioContextImpl && typeof lamejs !== 'undefined');
  const voskSupported = typeof Vosk !== 'undefined' && typeof Worker !== 'undefined' && !!AudioContextImpl;
  const liveTranscriptSupported = speechSupported || voskSupported;

  if (!liveTranscriptSupported && !recordingSupported) {
    unsupportedBanner.textContent = 'This browser supports neither live transcription nor audio recording. Please use a recent Chrome, Edge, or Firefox.';
    unsupportedBanner.classList.remove('hidden');
  } else if (!liveTranscriptSupported) {
    unsupportedBanner.textContent = 'Live transcription is not supported in this browser (no speech engine and no WebAssembly worker support). Recording will still work.';
    unsupportedBanner.classList.remove('hidden');
  } else if (!recordingSupported) {
    unsupportedBanner.textContent = 'Audio recording is not supported in this browser. Live transcription will still work.';
    unsupportedBanner.classList.remove('hidden');
  }

  // ---------- State ----------
  let mode = 'live';
  let recognition = null;
  let recognitionShouldRun = false;
  let sessionStartTime = null;
  let noSpeechStreak = 0;
  let isLiveActive = false;
  let activeLiveEngine = null; // 'native' | 'vosk' | null

  let voskModelPromise = null;
  let voskRecognizer = null;
  let voskProcessorNode = null;
  let voskSilentGain = null;
  let voskStopRequested = false;

  let mediaStream = null;
  let audioCtx = null;
  let sourceNode = null;
  let analyserNode = null;
  let meterRAF = null;
  let lastVoiceDetectedAt = 0;
  let processorNode = null;
  let silentGain = null;
  let pcmChunks = [];
  let chunkTimer = null;
  let countdownTimer = null;
  let chunkIndex = 0;
  let chunkStartTime = null;
  let chunkDeadline = null;
  let isRecordingActive = false;
  let recordedFiles = []; // {name, blob, url, size, duration}

  // ---------- Helpers ----------
  function pad(n) { return String(n).padStart(2, '0'); }

  function formatElapsed(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  function formatFileTimestamp(date) {
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function setStatus(el, active, label) {
    el.classList.toggle('active', active);
    el.innerHTML = `<span class="dot"></span> ${label}`;
  }

  function showBanner(message) {
    permissionBanner.textContent = message;
    permissionBanner.classList.remove('hidden');
  }

  function hideBanner() {
    permissionBanner.classList.add('hidden');
  }

  function appendTranscriptLine(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    let line = trimmed;
    if (timestampToggle.checked && sessionStartTime) {
      line = `[${formatElapsed(Date.now() - sessionStartTime)}] ${trimmed}`;
    }
    transcriptArea.value += (transcriptArea.value ? '\n' : '') + line;
    transcriptArea.scrollTop = transcriptArea.scrollHeight;
  }

  // ---------- Live transcript: engine dispatch ----------
  async function startLive() {
    activeLiveEngine = liveEngineSelect.value === 'vosk' ? 'vosk' : 'native';
    if (activeLiveEngine === 'vosk') {
      await startVoskLive();
    } else {
      startNativeLive();
    }
  }

  function stopLive() {
    if (activeLiveEngine === 'vosk') {
      stopVoskLive();
    } else {
      stopNativeLive();
    }
    activeLiveEngine = null;
  }

  // ---------- Native engine: Web Speech API (Chrome/Edge, OS default mic only) ----------
  function createRecognition() {
    const rec = new SpeechRecognitionImpl();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event) => {
      noSpeechStreak = 0;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          appendTranscriptLine(transcript);
        } else {
          interim += transcript;
        }
      }
      interimIndicator.textContent = interim ? `listening: "${interim}"` : '';
      setStatus(liveStatus, true, 'Live: listening');
    };

    rec.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        showBanner('Microphone access was blocked for live transcription. Allow microphone access in your browser (check the icon in the address bar) and click Start again.');
        recognitionShouldRun = false;
        isLiveActive = false;
        setStatus(liveStatus, false, 'Live: mic blocked');
        syncUiToState();
      } else if (event.error === 'audio-capture') {
        showBanner('No microphone was found for live transcription. Check that a mic is connected and selected in Settings, then try again.');
        recognitionShouldRun = false;
        isLiveActive = false;
        setStatus(liveStatus, false, 'Live: no mic');
        syncUiToState();
      } else if (event.error === 'network') {
        showBanner('Live transcription needs an internet connection (your browser sends audio to a cloud speech service to transcribe it). Check your connection and try again.');
        setStatus(liveStatus, false, 'Live: network error');
      } else if (event.error === 'no-speech') {
        noSpeechStreak += 1;
        setStatus(liveStatus, true, 'Live: listening (no speech detected yet)');
        if (noSpeechStreak >= 3) {
          showBanner('Live transcription is running but has not detected any speech yet. Check the "Mic input" meter below — if it never moves when you talk, the browser is not receiving audio from this microphone (try a different one in Settings).');
        }
      } else if (event.error === 'aborted') {
        // Expected when we call recognition.stop() ourselves; ignore.
      } else {
        setStatus(liveStatus, true, `Live: error (${event.error})`);
      }
    };

    rec.onend = () => {
      interimIndicator.textContent = '';
      if (recognitionShouldRun) {
        try { rec.start(); } catch (e) { /* already starting */ }
      } else {
        isLiveActive = false;
        setStatus(liveStatus, false, 'Live: idle');
      }
    };

    return rec;
  }

  function startNativeLive() {
    if (!speechSupported) return;
    noSpeechStreak = 0;
    recognitionShouldRun = true;
    isLiveActive = true;
    recognition = createRecognition();
    try {
      recognition.start();
      setStatus(liveStatus, true, 'Live: listening');
    } catch (e) {
      console.error(e);
      showBanner(`Could not start live transcription (${e.message || e.name || 'unknown error'}). Try clicking Start again.`);
      recognitionShouldRun = false;
      isLiveActive = false;
      setStatus(liveStatus, false, 'Live: failed to start');
      syncUiToState();
    }
  }

  function stopNativeLive() {
    recognitionShouldRun = false;
    isLiveActive = false;
    interimIndicator.textContent = '';
    if (recognition) {
      try { recognition.stop(); } catch (e) { /* noop */ }
    }
    setStatus(liveStatus, false, 'Live: idle');
  }

  // ---------- Local AI engine: Vosk (WASM, runs on our own selected mic stream) ----------
  const VOSK_MODEL_LOAD_TIMEOUT_MS = 90000;

  function timeoutRejection(ms, message) {
    return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
  }

  function getVoskModel() {
    if (!voskModelPromise) {
      const url = (voskModelUrlInput.value || '').trim();
      if (!url) return Promise.reject(new Error('No model URL set in Advanced settings'));
      voskModelPromise = Vosk.createModel(url).catch((err) => {
        voskModelPromise = null; // allow retrying with a fixed URL next time
        throw err;
      });
    }
    return voskModelPromise;
  }

  async function startVoskLive() {
    if (!voskSupported || !sourceNode || !audioCtx) {
      showBanner('Local AI transcription needs microphone access. Allow microphone access and try again.');
      isLiveActive = false;
      syncUiToState();
      return;
    }
    voskStopRequested = false;
    isLiveActive = true;
    setStatus(liveStatus, true, 'Live: downloading speech model (first time only)…');
    syncUiToState();

    try {
      // The model loader can hang forever (no reject) if the fetch fails deep
      // inside its worker, so race it against our own timeout as a backstop.
      const model = await Promise.race([
        getVoskModel(),
        timeoutRejection(VOSK_MODEL_LOAD_TIMEOUT_MS, 'Timed out waiting for the speech model to download. Check your connection, or set a different model URL under Advanced settings.'),
      ]);
      if (voskStopRequested) {
        isLiveActive = false;
        setStatus(liveStatus, false, 'Live: idle');
        return;
      }

      const recognizer = new model.KaldiRecognizer(audioCtx.sampleRate);
      voskRecognizer = recognizer;

      recognizer.on('result', (message) => {
        if (message.result && message.result.text) {
          appendTranscriptLine(message.result.text);
        }
        interimIndicator.textContent = '';
      });
      recognizer.on('partialresult', (message) => {
        const partial = message.result && message.result.partial;
        interimIndicator.textContent = partial ? `listening: "${partial}"` : '';
      });
      recognizer.on('error', (message) => {
        showBanner(`Local AI transcription error: ${message.error}`);
      });

      voskSilentGain = audioCtx.createGain();
      voskSilentGain.gain.value = 0;
      voskProcessorNode = audioCtx.createScriptProcessor(4096, 1, 1);
      sourceNode.connect(voskProcessorNode);
      voskProcessorNode.connect(voskSilentGain);
      voskSilentGain.connect(audioCtx.destination);
      voskProcessorNode.onaudioprocess = (e) => {
        if (!voskRecognizer) return;
        try { voskRecognizer.acceptWaveform(e.inputBuffer); } catch (err) { console.error(err); }
      };

      setStatus(liveStatus, true, 'Live: listening (local AI)');
    } catch (err) {
      console.error(err);
      isLiveActive = false;
      voskModelPromise = null; // the hung/failed load can't be reused; force a fresh attempt next time
      showBanner(err && err.message ? err.message : 'Could not load the local AI speech model. Check your connection, or set a different model URL under Advanced settings.');
      setStatus(liveStatus, false, 'Live: model failed to load');
    }
    syncUiToState();
  }

  function stopVoskLive() {
    voskStopRequested = true;
    isLiveActive = false;
    interimIndicator.textContent = '';
    if (voskProcessorNode) {
      voskProcessorNode.onaudioprocess = null;
      try { voskProcessorNode.disconnect(); } catch (e) {}
      voskProcessorNode = null;
    }
    if (voskSilentGain) { try { voskSilentGain.disconnect(); } catch (e) {} voskSilentGain = null; }
    if (voskRecognizer) {
      try { voskRecognizer.remove(); } catch (e) {}
      voskRecognizer = null;
    }
    setStatus(liveStatus, false, 'Live: idle');
  }

  // ---------- Mic acquisition + level meter ----------
  async function acquireStream() {
    const deviceId = micSelect.value || undefined;
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    });
    await refreshMicList(); // labels become available after permission grant
    setupAudioGraph();
  }

  function setupAudioGraph() {
    audioCtx = new AudioContextImpl();
    sourceNode = audioCtx.createMediaStreamSource(mediaStream);
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 512;
    sourceNode.connect(analyserNode);
    startMeterLoop();
  }

  function startMeterLoop() {
    const data = new Uint8Array(analyserNode.fftSize);
    const tick = () => {
      if (!analyserNode) return;
      analyserNode.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sumSquares += v * v;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      const level = Math.min(1, rms * 4);
      micMeterFill.style.width = `${Math.round(level * 100)}%`;

      const now = Date.now();
      if (level > VOICE_THRESHOLD) lastVoiceDetectedAt = now;
      const voiceActive = now - lastVoiceDetectedAt < VOICE_HOLD_MS;
      voiceDot.classList.toggle('active', voiceActive);
      micMeterEl.classList.toggle('voice-active', voiceActive);

      meterRAF = requestAnimationFrame(tick);
    };
    tick();
  }

  function stopMeterAndStream() {
    if (meterRAF) cancelAnimationFrame(meterRAF);
    meterRAF = null;
    if (sourceNode) { try { sourceNode.disconnect(); } catch (e) {} sourceNode = null; }
    if (analyserNode) { try { analyserNode.disconnect(); } catch (e) {} analyserNode = null; }
    if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
    micMeterFill.style.width = '0%';
    voiceDot.classList.remove('active');
    micMeterEl.classList.remove('voice-active');
    lastVoiceDetectedAt = 0;
  }

  // ---------- Recording: PCM capture -> MP3 encoding (lamejs), auto-split ----------
  function floatTo16BitPCM(float32Array) {
    const out = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  function startAudioRecording() {
    isRecordingActive = true;
    chunkIndex = 0;
    pcmChunks = [];
    chunkStartTime = Date.now();

    processorNode = audioCtx.createScriptProcessor(4096, 1, 1);
    silentGain = audioCtx.createGain();
    silentGain.gain.value = 0; // avoid audible feedback while still driving the processor
    sourceNode.connect(processorNode);
    processorNode.connect(silentGain);
    silentGain.connect(audioCtx.destination);

    processorNode.onaudioprocess = (e) => {
      if (!isRecordingActive) return;
      pcmChunks.push(floatTo16BitPCM(e.inputBuffer.getChannelData(0)));
    };

    chunkIndex += 1;
    scheduleChunkSplit();
    setStatus(recordStatus, true, 'Recording: active');
    splitNowBtn.disabled = false;
  }

  function scheduleChunkSplit() {
    clearTimeout(chunkTimer);
    clearInterval(countdownTimer);
    const minutes = parseInt(chunkDurationSelect.value, 10) || 5;
    const durationMs = minutes * 60 * 1000;
    chunkDeadline = Date.now() + durationMs;

    chunkTimer = setTimeout(() => splitNow(), durationMs);

    countdownTimer = setInterval(() => {
      const remaining = Math.max(0, chunkDeadline - Date.now());
      chunkCountdownEl.textContent = `next split in ${formatElapsed(remaining)}`;
    }, 500);
  }

  function finalizeChunkToMp3() {
    if (pcmChunks.length === 0) return;
    const sampleRate = audioCtx.sampleRate;
    const encoder = new lamejs.Mp3Encoder(1, sampleRate, 128);
    const mp3Parts = [];
    for (const chunk of pcmChunks) {
      const enc = encoder.encodeBuffer(chunk);
      if (enc.length > 0) mp3Parts.push(new Uint8Array(enc));
    }
    const end = encoder.flush();
    if (end.length > 0) mp3Parts.push(new Uint8Array(end));

    const totalSamples = pcmChunks.reduce((n, c) => n + c.length, 0);
    const durationSec = Math.round(totalSamples / sampleRate);
    const blob = new Blob(mp3Parts, { type: 'audio/mpeg' });
    const name = `recording_${formatFileTimestamp(new Date(chunkStartTime))}_part${pad(chunkIndex)}.mp3`;
    const url = URL.createObjectURL(blob);
    recordedFiles.push({ name, blob, url, size: blob.size, duration: durationSec });
    renderFileList();
  }

  function splitNow() {
    if (!isRecordingActive) return;
    finalizeChunkToMp3();
    chunkIndex += 1;
    chunkStartTime = Date.now();
    pcmChunks = [];
    scheduleChunkSplit();
  }

  function stopRecording() {
    if (!isRecordingActive) {
      clearTimeout(chunkTimer);
      clearInterval(countdownTimer);
      return;
    }
    isRecordingActive = false;
    splitNowBtn.disabled = true;
    clearTimeout(chunkTimer);
    clearInterval(countdownTimer);
    chunkCountdownEl.textContent = '';
    finalizeChunkToMp3();
    if (processorNode) {
      processorNode.onaudioprocess = null;
      try { processorNode.disconnect(); } catch (e) {}
      processorNode = null;
    }
    if (silentGain) { try { silentGain.disconnect(); } catch (e) {} silentGain = null; }
    setStatus(recordStatus, false, 'Recording: idle');
  }

  function renderFileList() {
    fileListEl.innerHTML = '';
    if (recordedFiles.length === 0) {
      fileListEl.innerHTML = '<li class="empty-note">No recorded files yet.</li>';
      downloadAllBtn.disabled = true;
      clearFilesBtn.disabled = true;
      return;
    }
    downloadAllBtn.disabled = false;
    clearFilesBtn.disabled = false;
    recordedFiles.forEach((file) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="file-info">
          <span class="file-name">${file.name}</span>
          <span class="file-meta">${formatElapsed(file.duration * 1000)} · ${formatBytes(file.size)}</span>
        </div>
        <div class="file-actions">
          <a href="${file.url}" download="${file.name}">Download</a>
        </div>
      `;
      fileListEl.appendChild(li);
    });
  }

  async function downloadAllAsZip() {
    if (recordedFiles.length === 0 || typeof JSZip === 'undefined') return;
    const zip = new JSZip();
    recordedFiles.forEach((file) => zip.file(file.name, file.blob));
    const content = await zip.generateAsync({ type: 'blob' });
    triggerDownload(content, `recordings_${formatFileTimestamp(new Date())}.zip`);
  }

  function clearFiles() {
    recordedFiles.forEach((f) => URL.revokeObjectURL(f.url));
    recordedFiles = [];
    renderFileList();
  }

  // ---------- Transcript export ----------
  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function saveTranscriptTxt() {
    const blob = new Blob([transcriptArea.value], { type: 'text/plain;charset=utf-8' });
    triggerDownload(blob, `transcript_${formatFileTimestamp(new Date())}.txt`);
  }

  async function copyTranscript() {
    try {
      await navigator.clipboard.writeText(transcriptArea.value);
      const original = copyBtn.textContent;
      copyBtn.textContent = '✔ Copied';
      setTimeout(() => { copyBtn.textContent = original; }, 1500);
    } catch (e) {
      transcriptArea.select();
      document.execCommand('copy');
    }
  }

  // ---------- Mic device list ----------
  async function refreshMicList() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter((d) => d.kind === 'audioinput');
    const previousValue = micSelect.value;
    micSelect.innerHTML = '<option value="">Default microphone</option>';
    mics.forEach((mic, i) => {
      const opt = document.createElement('option');
      opt.value = mic.deviceId;
      opt.textContent = mic.label || `Microphone ${i + 1}`;
      micSelect.appendChild(opt);
    });
    if (mics.some((m) => m.deviceId === previousValue)) {
      micSelect.value = previousValue;
    }
  }

  // ---------- Start / Stop orchestration ----------
  function syncUiToState() {
    const running = isLiveActive || isRecordingActive;
    startBtn.disabled = running;
    stopBtn.disabled = !running;
    document.querySelectorAll('input[name="mode"]').forEach((el) => { el.disabled = running; });
    liveEngineSelect.disabled = running;
  }

  async function handleStart() {
    mode = document.querySelector('input[name="mode"]:checked').value;
    const engine = liveEngineSelect.value;
    sessionStartTime = Date.now();
    hideBanner();
    try {
      try {
        await acquireStream();
      } catch (streamErr) {
        const needsOwnStream = mode === 'record' || mode === 'both' || (mode === 'live' && engine === 'vosk');
        if (needsOwnStream) throw streamErr;
        console.warn('Mic level meter unavailable (native live transcript can still work):', streamErr);
      }

      if (mode === 'live' || mode === 'both') {
        if (engine === 'vosk' && !voskSupported) {
          alert('Local AI transcription is not supported in this browser.');
        } else if (engine === 'native' && !speechSupported) {
          alert('Live transcription is not supported in this browser. Try Chrome/Edge, or switch the Live transcript engine to "Local AI model".');
        } else {
          await startLive();
        }
      }
      if (mode === 'record' || mode === 'both') {
        if (!recordingSupported) {
          alert('Audio recording is not supported in this browser.');
        } else {
          startAudioRecording();
        }
      }
    } catch (err) {
      console.error(err);
      if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
        showBanner('Microphone permission was denied. Allow microphone access for this site and click Start again.');
      } else if (err && err.name === 'NotFoundError') {
        showBanner('No microphone was found. Connect a microphone and click Start again.');
      } else {
        showBanner('Could not access the microphone. Check your browser and OS microphone permissions and try again.');
      }
      stopLive();
      stopRecording();
      stopMeterAndStream();
    }
    syncUiToState();
  }

  function handleStop() {
    stopLive();
    stopRecording();
    stopMeterAndStream();
    syncUiToState();
  }

  // ---------- Wire up events ----------
  startBtn.addEventListener('click', handleStart);
  stopBtn.addEventListener('click', handleStop);
  splitNowBtn.addEventListener('click', splitNow);
  refreshMicsBtn.addEventListener('click', refreshMicList);
  micSelect.addEventListener('change', updateMicNoteAndAvailability);
  document.querySelectorAll('input[name="mode"]').forEach((el) => {
    el.addEventListener('change', updateMicNoteAndAvailability);
  });
  liveEngineSelect.addEventListener('change', () => {
    updateEngineNote();
    updateMicNoteAndAvailability();
  });

  function updateEngineNote() {
    if (liveEngineSelect.value === 'vosk') {
      engineNote.textContent = 'First use downloads a ~40MB speech model (needs internet once); after that it runs fully offline in your browser. Expect lower accuracy and a short delay per phrase compared to the browser built-in engine.';
      engineNote.classList.remove('hidden');
    } else {
      engineNote.classList.add('hidden');
    }
  }

  function updateMicNoteAndAvailability() {
    const currentMode = document.querySelector('input[name="mode"]:checked').value;
    const liveUsesOwnMic = liveEngineSelect.value === 'vosk';
    if (currentMode === 'live' && !liveUsesOwnMic) {
      micSelect.disabled = true;
      micDeviceNote.textContent = 'Disabled: not used in "Live transcript only" mode with the browser built-in engine (it always listens on your OS default microphone). Switch the engine above to "Local AI model" to pick a specific mic for live transcript.';
      micDeviceNote.classList.remove('hidden');
    } else {
      micSelect.disabled = false;
      if (currentMode === 'both' && !liveUsesOwnMic && micSelect.value) {
        micDeviceNote.textContent = '⚠ Live transcript (browser built-in engine) still uses your OS default microphone regardless of this selection — only the recorded files will use the device chosen here.';
        micDeviceNote.classList.remove('hidden');
      } else {
        micDeviceNote.classList.add('hidden');
      }
    }
  }
  copyBtn.addEventListener('click', copyTranscript);
  saveTxtBtn.addEventListener('click', saveTranscriptTxt);
  clearTranscriptBtn.addEventListener('click', () => {
    if (transcriptArea.value && !confirm('Clear the current transcript?')) return;
    transcriptArea.value = '';
  });
  downloadAllBtn.addEventListener('click', downloadAllAsZip);
  clearFilesBtn.addEventListener('click', () => {
    if (recordedFiles.length && !confirm('Remove all recorded files from this list? (Already downloaded files on your computer are unaffected.)')) return;
    clearFiles();
  });

  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', refreshMicList);
  }

  window.addEventListener('beforeunload', (e) => {
    if (isLiveActive || isRecordingActive) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Init
  refreshMicList();
  renderFileList();
  syncUiToState();
  updateEngineNote();
  updateMicNoteAndAvailability();
  if (!recordingSupported) {
    document.querySelector('input[name="mode"][value="record"]').disabled = true;
    document.querySelector('input[name="mode"][value="both"]').disabled = true;
  }
  if (!speechSupported) {
    const nativeOption = liveEngineSelect.querySelector('option[value="native"]');
    if (nativeOption) nativeOption.disabled = true;
    if (voskSupported) {
      liveEngineSelect.value = 'vosk';
      updateEngineNote();
      updateMicNoteAndAvailability();
    } else {
      document.querySelector('input[name="mode"][value="live"]').disabled = true;
      if (document.querySelector('input[name="mode"]:checked').value === 'live') {
        document.querySelector('input[name="mode"][value="record"]').checked = true;
      }
    }
  }
})();
