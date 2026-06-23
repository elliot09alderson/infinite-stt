const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  clipboard,
  nativeImage,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const zlib = require('zlib');
const http = require('http');
const { uIOhook, UiohookKey } = require('uiohook-napi');

let mainWindow;
let tray;
let pythonProcess = null;
let sttReady = false;
let isListening = false;
let audioBuffer = Buffer.alloc(0);
let partialTimer = null;

const STT_PORT = 9876;
const VENV_PYTHON = path.join(__dirname, 'venv', 'Scripts', 'python.exe');
const STT_SCRIPT = path.join(__dirname, 'stt_server.py');

// --------------- PNG icon generation ---------------
function crc32(buf) {
  if (!crc32._t) {
    const t = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    crc32._t = t;
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crc32._t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typ = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typ, data])));
  return Buffer.concat([len, typ, data, crcBuf]);
}

function createCircleIcon(r, g, b) {
  const w = 16, h = 16;
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 4);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const px = row + 1 + x * 4;
      const dx = x - 7.5, dy = y - 7.5;
      if (Math.sqrt(dx * dx + dy * dy) <= 6.5) {
        raw[px] = r; raw[px + 1] = g; raw[px + 2] = b; raw[px + 3] = 255;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return nativeImage.createFromBuffer(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

// --------------- Python STT Server ---------------
function startPythonServer() {
  if (!fs.existsSync(VENV_PYTHON)) {
    sendToRenderer('stt-error', 'Python environment not set up. Run: npm run setup');
    return;
  }

  pythonProcess = spawn(VENV_PYTHON, [STT_SCRIPT], {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let outBuf = '';
  pythonProcess.stdout.on('data', (data) => {
    outBuf += data.toString();
    const lines = outBuf.split('\n');
    outBuf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.status === 'ready') {
          sttReady = true;
          sendToRenderer('stt-server-status', 'ready');
        } else if (msg.status === 'loading') {
          sendToRenderer('stt-server-status', msg.message || 'Loading model...');
        } else if (msg.status === 'error') {
          sendToRenderer('stt-error', msg.message);
        }
      } catch {}
    }
  });

  pythonProcess.stderr.on('data', (data) => {
    // NeMo/PyTorch print lots of info to stderr, ignore most of it
    const text = data.toString();
    if (text.includes('Error') || text.includes('error')) {
      console.error('[Python]', text.trim());
    }
  });

  pythonProcess.on('close', (code) => {
    sttReady = false;
    pythonProcess = null;
    if (code !== 0 && code !== null) {
      sendToRenderer('stt-error', `STT server exited (code ${code}). Try: npm run setup`);
    }
  });
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// --------------- Transcription via HTTP ---------------
function transcribeAudio(audioBufferData) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: STT_PORT,
        path: '/transcribe',
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': audioBufferData.length,
        },
        timeout: 30000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const result = JSON.parse(body);
            resolve(result.text || '');
          } catch {
            resolve('');
          }
        });
      }
    );
    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(audioBufferData);
    req.end();
  });
}

// --------------- Listening control ---------------
function toggleListening() {
  if (isListening) {
    stopListening();
  } else {
    startListening();
  }
}

function startListening() {
  if (!sttReady) {
    sendToRenderer('stt-error', 'STT model is still loading. Please wait...');
    mainWindow.show();
    return;
  }

  isListening = true;
  audioBuffer = Buffer.alloc(0);
  updateTrayIcon();
  sendToRenderer('stt-status', 'listening');

  // Send partial transcription every 3 seconds
  partialTimer = setInterval(async () => {
    if (!isListening || audioBuffer.length < 16000 * 2) return; // need at least 1 sec
    try {
      const text = await transcribeAudio(audioBuffer);
      if (text) {
        sendToRenderer('stt-result', { type: 'partial', text });
      }
    } catch {
      // server busy or not ready
    }
  }, 3000);
}

async function stopListening() {
  isListening = false;
  if (partialTimer) {
    clearInterval(partialTimer);
    partialTimer = null;
  }
  updateTrayIcon();
  sendToRenderer('stt-status', 'stopped');

  // Final transcription of all audio
  if (audioBuffer.length > 16000 * 2) {
    try {
      const text = await transcribeAudio(audioBuffer);
      if (text) {
        clipboard.writeText(text);
        sendToRenderer('stt-result', { type: 'final', text });
      }
    } catch (err) {
      sendToRenderer('stt-error', 'Transcription failed: ' + err.message);
    }
  }
  audioBuffer = Buffer.alloc(0);
}

// --------------- Window & Tray ---------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 560,
    minWidth: 360,
    minHeight: 400,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Infinite STT',
    show: false,
  });

  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('close', () => {
    app.isQuitting = true;
    app.quit();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.session.setPermissionRequestHandler((_wc, perm, cb) => {
    cb(perm === 'media');
  });
}

function createTray() {
  tray = new Tray(createCircleIcon(100, 100, 100));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Toggle (Alt+Shift+M)', click: () => toggleListening() },
      { label: 'Show Window', click: () => mainWindow.show() },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
    ])
  );
  tray.setToolTip('Infinite STT');
  tray.on('double-click', () => mainWindow.show());
}

function updateTrayIcon() {
  if (!tray) return;
  tray.setImage(isListening ? createCircleIcon(220, 50, 50) : createCircleIcon(100, 100, 100));
  tray.setToolTip(isListening ? 'Infinite STT - Listening...' : 'Infinite STT');
}

// --------------- IPC handlers ---------------
ipcMain.on('audio-data', (_event, arrayBuffer) => {
  if (isListening) {
    audioBuffer = Buffer.concat([audioBuffer, Buffer.from(arrayBuffer)]);
  }
});

ipcMain.on('toggle-listening', () => toggleListening());

ipcMain.on('copy-to-clipboard', (_event, text) => clipboard.writeText(text));

ipcMain.on('auto-paste', (_event, text) => {
  clipboard.writeText(text);
  // Simulate Ctrl+V in the previously focused window (Windows only)
  const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')`;
  spawn('powershell', ['-Command', ps], { stdio: 'ignore', detached: true }).unref();
});

// --------------- Single instance lock ---------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// --------------- App lifecycle ---------------
app.whenReady().then(() => {
  createWindow();
  createTray();

  // Hold-to-talk: Alt+Shift+M (hold to listen, release to stop)
  let keysHeld = { alt: false, shift: false, m: false };

  uIOhook.on('keydown', (e) => {
    if (e.keycode === UiohookKey.Alt) keysHeld.alt = true;
    if (e.keycode === UiohookKey.Shift) keysHeld.shift = true;
    if (e.keycode === UiohookKey.M) keysHeld.m = true;

    if (keysHeld.alt && keysHeld.shift && keysHeld.m && !isListening) {
      startListening();
    }
  });

  uIOhook.on('keyup', (e) => {
    if (e.keycode === UiohookKey.Alt) keysHeld.alt = false;
    if (e.keycode === UiohookKey.Shift) keysHeld.shift = false;
    if (e.keycode === UiohookKey.M) keysHeld.m = false;

    if (isListening && (!keysHeld.alt || !keysHeld.shift || !keysHeld.m)) {
      stopListening();
    }
  });

  uIOhook.start();

  // Start Python STT server immediately (model loads in background)
  startPythonServer();
});

app.on('will-quit', () => {
  uIOhook.stop();
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }
});

app.on('window-all-closed', () => {
  // Keep running in tray
});
