#!/usr/bin/env python3
"""Local STT server using NVIDIA Parakeet via sherpa-onnx. Runs on localhost."""

import sys
import json
import os
import threading
import numpy as np
from http.server import HTTPServer, BaseHTTPRequestHandler
import socketserver

SAMPLE_RATE = 16000
PORT = 9876
MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "model-parakeet")


def log(data):
    print(json.dumps(data), flush=True)


log({"status": "loading", "message": "Loading Parakeet STT model on GPU..."})

import torch  # registers CUDA DLL paths
import sherpa_onnx

recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
    encoder=os.path.join(MODEL_DIR, "encoder.int8.onnx"),
    decoder=os.path.join(MODEL_DIR, "decoder.int8.onnx"),
    joiner=os.path.join(MODEL_DIR, "joiner.int8.onnx"),
    tokens=os.path.join(MODEL_DIR, "tokens.txt"),
    num_threads=4,
    provider="cuda",
    model_type="nemo_transducer",
)

model_lock = threading.Lock()

log({"status": "ready", "port": PORT})


class ThreadedHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True


class STTHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length < SAMPLE_RATE:  # less than 0.5s of 16-bit audio
            self.send_json({"text": ""})
            return

        audio_bytes = self.rfile.read(content_length)

        # Convert PCM16 to float32 [-1, 1]
        audio = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0

        if len(audio) < SAMPLE_RATE * 0.3:
            self.send_json({"text": ""})
            return

        try:
            with model_lock:
                stream = recognizer.create_stream()
                stream.accept_waveform(SAMPLE_RATE, audio)
                recognizer.decode_stream(stream)
                text = stream.result.text

            self.send_json({"text": text.strip()})
        except Exception as e:
            log({"status": "error", "message": str(e)})
            self.send_json({"text": "", "error": str(e)})

    def do_GET(self):
        self.send_json({"status": "ok"})

    def send_json(self, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    server = ThreadedHTTPServer(("127.0.0.1", PORT), STTHandler)
    log({"status": "ready", "message": f"STT server listening on port {PORT}"})
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
