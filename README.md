# Infinite STT

Free, unlimited, offline speech-to-text desktop app powered by **NVIDIA Parakeet** + **Electron**.

**Hold `Alt + Shift + M` anywhere** to speak. Release to stop. Text is auto-copied to clipboard.

![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Windows-blue)
![STT](https://img.shields.io/badge/model-NVIDIA%20Parakeet-green)

## Features

- **100% Free & Offline** — no API keys, no usage limits, runs entirely on your machine
- **NVIDIA Parakeet** — state-of-the-art STT model (~6% word error rate)
- **GPU Accelerated** — runs on NVIDIA GPU via CUDA (CPU fallback available)
- **Global Hotkey** — hold `Alt+Shift+M` from any app to dictate
- **Auto-copy** — transcribed text is automatically copied to clipboard
- **Auto-paste** — optional auto-paste into the focused app
- **System Tray** — runs in background, single-instance enforced
- **Desktop Shortcut** — double-click to launch, no terminal needed

## Requirements

- **Windows 10/11** (x64)
- **Node.js** 18+ and npm
- **Python** 3.10+
- **NVIDIA GPU** with 4GB+ VRAM (for GPU mode) — or CPU-only mode available

## Installation

### 1. Clone and install Node dependencies

```bash
git clone https://github.com/elliot09alderson/infinite-stt.git
cd infinite-stt
npm install
```

### 2. Setup Python environment

Choose **GPU** or **CPU** variant below.

---

### GPU Variant (Recommended — requires NVIDIA GPU)

```bash
# Create Python virtual environment
python -m venv venv

# Activate it
# Windows CMD:
venv\Scripts\activate
# Git Bash:
source venv/Scripts/activate

# Install PyTorch with CUDA 12.4
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124

# Install sherpa-onnx with GPU support
pip install sherpa-onnx==1.13.3+cuda12.cudnn9 -f https://k2-fsa.github.io/sherpa/onnx/cuda.html

# Install other dependencies
pip install numpy soundfile
```

**Copy CUDA DLLs** (required for GPU inference):

```bash
# From Git Bash:
cp venv/Lib/site-packages/torch/lib/cublas*.dll venv/Lib/site-packages/sherpa_onnx/lib/
cp venv/Lib/site-packages/torch/lib/cudnn*.dll venv/Lib/site-packages/sherpa_onnx/lib/
cp venv/Lib/site-packages/torch/lib/cudart*.dll venv/Lib/site-packages/sherpa_onnx/lib/
cp venv/Lib/site-packages/torch/lib/cufft*.dll venv/Lib/site-packages/sherpa_onnx/lib/
cp venv/Lib/site-packages/torch/lib/curand*.dll venv/Lib/site-packages/sherpa_onnx/lib/
cp venv/Lib/site-packages/torch/lib/cusparse*.dll venv/Lib/site-packages/sherpa_onnx/lib/
```

The `stt_server.py` is pre-configured for GPU (`provider="cuda"`).

---

### CPU Variant (No GPU required)

```bash
# Create Python virtual environment
python -m venv venv

# Activate it
# Windows CMD:
venv\Scripts\activate
# Git Bash:
source venv/Scripts/activate

# Install sherpa-onnx (CPU only — much smaller download)
pip install sherpa-onnx

# Install other dependencies
pip install numpy soundfile
```

**Edit `stt_server.py`** — change these two lines:

```python
# Change this:
import torch
# To this:
# import torch  (comment out or remove)

# Change this:
provider="cuda",
# To this:
provider="cpu",
```

---

### 3. Download the Parakeet model

```bash
# Activate venv first, then:
pip install huggingface_hub

python -c "
from huggingface_hub import snapshot_download
snapshot_download('csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8', local_dir='model-parakeet')
print('Done!')
"
```

This downloads the **INT8 quantized** Parakeet model (~660MB, one-time).

### 4. Run the app

```bash
npm start
```

Or create a desktop shortcut — see [Desktop Shortcut](#desktop-shortcut) below.

## Usage

| Action | How |
|--------|-----|
| Start listening | **Hold** `Alt + Shift + M` |
| Stop & transcribe | **Release** the keys |
| Copy text | Auto-copied on transcribe, or click **Copy** |
| Auto-paste | Enable checkbox, text pastes into focused app |
| Clear text | Click **Clear** |
| Quit | Close the window or right-click tray icon > Quit |

## Desktop Shortcut

Create `InfiniteSTT.vbs` in the project folder:

```vbs
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "D:\path\to\infinite-stt"
WshShell.Run """" & WshShell.CurrentDirectory & "\node_modules\.bin\electron.cmd"" .", 0, False
```

Update the path, then create a shortcut to this file on your desktop. Double-click to launch without a terminal.

## Architecture

```
Electron App (UI + Global Hotkey)
  |
  |-- Audio capture (Web Audio API, 16kHz PCM16)
  |-- IPC to main process
  |
  v
Python STT Server (localhost:9876)
  |
  |-- sherpa-onnx + Parakeet ONNX model
  |-- GPU (CUDA) or CPU inference
  |
  v
Transcription -> Clipboard
```

## Tech Stack

- **[NVIDIA Parakeet TDT 0.6B v2](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2)** — speech recognition model (CC-BY-4.0)
- **[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)** — ONNX Runtime inference
- **[Electron](https://www.electronjs.org/)** — desktop app framework
- **[uiohook-napi](https://github.com/nickolaev/uiohook-napi)** — global keyboard hooks (hold-to-talk)

## License

MIT
