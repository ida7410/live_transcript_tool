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

  const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
  const speechSupported = !!SpeechRecognitionImpl;
  const recorderSupported = !!(navigator.mediaDevices && window.MediaRecorder);

  if (!speechSupported && !recorderSupported) {
    unsupportedBanner.textContent = 'This browser supports neither live transcription nor audio recording. Please use a recent Chrome or Edge.';
    unsupportedBanner.classList.remove('hidden');
  } else if (!speechSupported) {
    unsupportedBanner.textContent = 'Live transcription (Web Speech API) is not supported in this browser. Recording will still work. Try Chrome or Edge for live transcript.';
    unsupportedBanner.classList.remove('hidden');
  }

  // ---------- State ----------
  let mode = 'live';
  let recognition = null;
  let recognitionShouldRun = false;
  let sessionStartTime = null;

  let mediaStream = null;
  let mediaRecorder = null;
  let currentChunkBlobs = [];
  let recordedFiles = []; // {name, blob, url, size, duration}
  let chunkTimer = null;
  let countdownTimer = null;
  let chunkIndex = 0;
  let chunkStartTime = null;
  let chunkDeadline = null;
  let isRecordingActive = false;

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

  // ---------- Speech recognition (live transcript) ----------
  function createRecognition() {
    const rec = new SpeechRecognitionImpl();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event) => {
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
    };

    rec.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        permissionBanner.classList.remove('hidden');
        recognitionShouldRun = false;
        syncUiToState();
      }
      // 'no-speech' and similar are transient; onend will restart us if needed.
    };

    rec.onend = () => {
      interimIndicator.textContent = '';
      if (recognitionShouldRun) {
        try { rec.start(); } catch (e) { /* already starting */ }
      } else {
        setStatus(liveStatus, false, 'Live: idle');
      }
    };

    return rec;
  }

  function startLive() {
    if (!speechSupported) return;
    permissionBanner.classList.add('hidden');
    recognitionShouldRun = true;
    recognition = createRecognition();
    try {
      recognition.start();
      setStatus(liveStatus, true, 'Live: listening');
    } catch (e) {
      console.error(e);
    }
  }

  function stopLive() {
    recognitionShouldRun = false;
    interimIndicator.textContent = '';
    if (recognition) {
      try { recognition.stop(); } catch (e) { /* noop */ }
    }
    setStatus(liveStatus, false, 'Live: idle');
  }

  // ---------- Recording (auto-split files) ----------
  function pickSupportedMimeType() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];
    for (const type of candidates) {
      if (window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return '';
  }

  function extForMime(mime) {
    if (mime.includes('mp4')) return 'm4a';
    if (mime.includes('ogg')) return 'ogg';
    return 'webm';
  }

  async function startRecording() {
    if (!recorderSupported) return;
    permissionBanner.classList.add('hidden');
    const deviceId = micSelect.value || undefined;
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    });
    await refreshMicList(); // labels become available after permission grant
    isRecordingActive = true;
    chunkIndex = 0;
    startNewChunkRecorder();
    setStatus(recordStatus, true, 'Recording: active');
    splitNowBtn.disabled = false;
  }

  function startNewChunkRecorder() {
    currentChunkBlobs = [];
    chunkStartTime = Date.now();
    const mimeType = pickSupportedMimeType();
    mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) currentChunkBlobs.push(e.data);
    };

    mediaRecorder.onstop = () => {
      finalizeChunk(mediaRecorder.mimeType || mimeType || 'audio/webm');
      if (isRecordingActive) {
        startNewChunkRecorder();
      } else {
        chunkCountdownEl.textContent = '';
      }
    };

    mediaRecorder.start();
    chunkIndex += 1;
    scheduleChunkSplit();
  }

  function scheduleChunkSplit() {
    clearTimeout(chunkTimer);
    clearInterval(countdownTimer);
    const minutes = parseInt(chunkDurationSelect.value, 10) || 5;
    const durationMs = minutes * 60 * 1000;
    chunkDeadline = Date.now() + durationMs;

    chunkTimer = setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
    }, durationMs);

    countdownTimer = setInterval(() => {
      const remaining = Math.max(0, chunkDeadline - Date.now());
      chunkCountdownEl.textContent = `next split in ${formatElapsed(remaining)}`;
    }, 500);
  }

  function finalizeChunk(mimeType) {
    if (currentChunkBlobs.length === 0) return;
    const blob = new Blob(currentChunkBlobs, { type: mimeType });
    const durationSec = Math.round((Date.now() - chunkStartTime) / 1000);
    const ext = extForMime(mimeType);
    const name = `recording_${formatFileTimestamp(new Date(chunkStartTime))}_part${pad(chunkIndex)}.${ext}`;
    const url = URL.createObjectURL(blob);
    recordedFiles.push({ name, blob, url, size: blob.size, duration: durationSec });
    renderFileList();
  }

  function splitNow() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
  }

  function stopRecording() {
    isRecordingActive = false;
    splitNowBtn.disabled = true;
    clearTimeout(chunkTimer);
    clearInterval(countdownTimer);
    chunkCountdownEl.textContent = '';
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
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
    const running = recognitionShouldRun || isRecordingActive;
    startBtn.disabled = running;
    stopBtn.disabled = !running;
    document.querySelectorAll('input[name="mode"]').forEach((el) => { el.disabled = running; });
  }

  async function handleStart() {
    mode = document.querySelector('input[name="mode"]:checked').value;
    sessionStartTime = Date.now();
    try {
      if (mode === 'live' || mode === 'both') {
        if (!speechSupported) {
          alert('Live transcription is not supported in this browser.');
        } else {
          startLive();
        }
      }
      if (mode === 'record' || mode === 'both') {
        if (!recorderSupported) {
          alert('Audio recording is not supported in this browser.');
        } else {
          await startRecording();
        }
      }
    } catch (err) {
      console.error(err);
      if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
        permissionBanner.classList.remove('hidden');
      }
      stopLive();
      stopRecording();
    }
    syncUiToState();
  }

  function handleStop() {
    stopLive();
    stopRecording();
    syncUiToState();
  }

  // ---------- Wire up events ----------
  startBtn.addEventListener('click', handleStart);
  stopBtn.addEventListener('click', handleStop);
  splitNowBtn.addEventListener('click', splitNow);
  refreshMicsBtn.addEventListener('click', refreshMicList);
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
    if (recognitionShouldRun || isRecordingActive) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Init
  refreshMicList();
  renderFileList();
  syncUiToState();
  if (!recorderSupported) {
    document.querySelector('input[name="mode"][value="record"]').disabled = true;
    document.querySelector('input[name="mode"][value="both"]').disabled = true;
  }
  if (!speechSupported) {
    document.querySelector('input[name="mode"][value="live"]').checked = false;
    document.querySelector('input[name="mode"][value="record"]').checked = true;
  }
})();
