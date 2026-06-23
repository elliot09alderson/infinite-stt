let audioContext = null;
let mediaStream = null;
let workletNode = null;
let isListening = false;
let fullText = '';
let serverReady = false;

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const output = document.getElementById('output');
const partial = document.getElementById('partial');
const placeholder = document.getElementById('placeholder');
const errorBar = document.getElementById('errorBar');
const toggleBtn = document.getElementById('toggleBtn');
const copyBtn = document.getElementById('copyBtn');
const clearBtn = document.getElementById('clearBtn');
const autoPasteCheckbox = document.getElementById('autoPaste');
const serverBar = document.getElementById('serverBar');
const serverText = document.getElementById('serverText');

// --------------- Server status ---------------
window.electronAPI.onServerStatus((msg) => {
  if (msg === 'ready') {
    serverReady = true;
    serverBar.className = 'server-bar ready';
    serverText.textContent = 'Parakeet model loaded - Ready';
    statusText.textContent = 'Ready';
    toggleBtn.disabled = false;
  } else {
    serverText.textContent = msg;
  }
});

// --------------- Listening status ---------------
window.electronAPI.onStatusChange((status) => {
  isListening = status === 'listening';

  statusDot.className = 'status-dot' + (isListening ? ' listening' : '');
  statusText.className = 'status-text' + (isListening ? ' listening' : '');
  statusText.textContent = isListening ? 'Listening...' : (serverReady ? 'Ready' : 'Waiting for model...');

  toggleBtn.className = 'btn-toggle' + (isListening ? ' listening' : '');
  toggleBtn.textContent = isListening ? 'Stop Listening' : 'Start Listening';

  if (isListening) {
    placeholder.style.display = 'none';
    errorBar.classList.remove('show');
    startAudioCapture();
  } else {
    stopAudioCapture();
    // Auto-paste if enabled
    if (autoPasteCheckbox.checked && fullText.trim()) {
      window.electronAPI.autoPaste(fullText.trim());
    }
  }
});

// --------------- Transcription results ---------------
window.electronAPI.onResult((result) => {
  if (result.type === 'partial') {
    partial.textContent = result.text;
    output.parentElement.scrollTop = output.parentElement.scrollHeight;
  } else if (result.type === 'final' && result.text) {
    // Final result replaces partial with definitive transcription
    fullText += (fullText ? '\n' : '') + result.text;
    output.textContent = fullText;
    partial.textContent = '';
    output.parentElement.scrollTop = output.parentElement.scrollHeight;
  }
});

window.electronAPI.onError((msg) => {
  errorBar.textContent = msg;
  errorBar.classList.add('show');
});

// --------------- Audio capture ---------------
async function startAudioCapture() {
  try {
    audioContext = new AudioContext({ sampleRate: 16000 });
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true },
    });

    await audioContext.audioWorklet.addModule('audio-processor.js');
    const source = audioContext.createMediaStreamSource(mediaStream);
    workletNode = new AudioWorkletNode(audioContext, 'audio-processor');

    workletNode.port.onmessage = (e) => {
      if (isListening) {
        window.electronAPI.sendAudio(e.data);
      }
    };

    source.connect(workletNode);
  } catch (err) {
    console.error('Audio capture failed:', err);
    errorBar.textContent = 'Microphone access denied or unavailable.';
    errorBar.classList.add('show');
  }
}

function stopAudioCapture() {
  if (workletNode) { workletNode.disconnect(); workletNode = null; }
  if (mediaStream) { mediaStream.getTracks().forEach((t) => t.stop()); mediaStream = null; }
  if (audioContext) { audioContext.close(); audioContext = null; }
}

// --------------- Button handlers ---------------
toggleBtn.addEventListener('click', () => window.electronAPI.toggleListening());

copyBtn.addEventListener('click', () => {
  if (fullText.trim()) {
    window.electronAPI.copyToClipboard(fullText.trim());
    copyBtn.textContent = 'Copied!';
    setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
  }
});

clearBtn.addEventListener('click', () => {
  fullText = '';
  output.textContent = '';
  partial.textContent = '';
  placeholder.style.display = 'block';
});
