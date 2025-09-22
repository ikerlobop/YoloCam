#!/usr/bin/env python3
# Backend API (Flask) — Captura cada 5s: toma 3 fotos y guarda 1 aleatoria en slots 1..10

import os, time, threading, random
from typing import List
from datetime import datetime

import cv2
from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS  # pip install flask-cors

# ----------------- CONFIG -----------------
CAM_INDEX = 0
WIDTH, HEIGHT = 640, 480
FPS = 30
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SAVE_DIR = os.path.join(BASE_DIR, "static", "capturas")
TOTAL_SLOTS = 10
CYCLE_SECONDS = 5
HOST = "127.0.0.1"
PORT = 5000
# -----------------------------------------

os.makedirs(SAVE_DIR, exist_ok=True)

app = Flask(__name__, static_folder="static")
CORS(app, resources={r"/*": {"origins": "*"}})  # permite que el frontend se sirva aparte

state = {
    "images": [],       # rutas ABSOLUTAS del backend para servir, ej: /captures/img_01.jpg
    "running": False,
    "stopped": False,
    "error": None
}
lock = threading.Lock()
cap_thread: threading.Thread | None = None

def filename_for_slot(slot_idx: int) -> str:
    return f"img_{slot_idx:02d}.jpg"

def capture_loop():
    try:
        cap = cv2.VideoCapture(CAM_INDEX)
        if not cap.isOpened():
            raise RuntimeError(f"No pude abrir la cámara (index={CAM_INDEX})")

        cap.set(cv2.CAP_PROP_FRAME_WIDTH, WIDTH)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, HEIGHT)
        cap.set(cv2.CAP_PROP_FPS, FPS)

        while True:
            with lock:
                if len(state["images"]) >= TOTAL_SLOTS:
                    state["running"] = False
                    state["stopped"] = True
                    break

            t0 = time.time()
            frames = []

            for _ in range(3):
                ok, frame = cap.read()
                if ok:
                    frames.append(frame.copy())
                time.sleep(0.15)

            if not frames:
                time.sleep(max(0, CYCLE_SECONDS - (time.time() - t0)))
                continue

            chosen = random.choice(frames)

            with lock:
                slot_idx = len(state["images"]) + 1
            rel_name = filename_for_slot(slot_idx)
            abs_path = os.path.join(SAVE_DIR, rel_name)
            cv2.imwrite(abs_path, chosen, [int(cv2.IMWRITE_JPEG_QUALITY), 92])

            # Importante: exponemos un path de API para imágenes, no /static directo
            rel_api_url = f"/captures/{rel_name}"
            with lock:
                state["images"].append(rel_api_url)

            elapsed = time.time() - t0
            time.sleep(max(0.0, CYCLE_SECONDS - elapsed))

        cap.release()
    except Exception as e:
        with lock:
            state["error"] = str(e)
            state["running"] = False
            state["stopped"] = True

# ----------------- Rutas API (sin HTML) -----------------

@app.get("/state")
def get_state():
    with lock:
        return jsonify({
            "images": list(state["images"]),  # rutas relativas a este backend
            "running": state["running"],
            "stopped": state["stopped"],
            "error": state["error"],
            "total_slots": TOTAL_SLOTS,
            "cycle_seconds": CYCLE_SECONDS
        })

@app.post("/start")
def start_capture():
    global cap_thread
    with lock:
        if state["running"] or state["stopped"]:
            return jsonify({"ok": True, "already": True})
        state["running"] = True
        state["stopped"] = False
        state["error"] = None
    cap_thread = threading.Thread(target=capture_loop, daemon=True)
    cap_thread.start()
    return jsonify({"ok": True})

@app.post("/reset")
def reset():
    # borra imágenes y reinicia estado (no arranca automáticamente)
    for f in os.listdir(SAVE_DIR):
        if f.lower().endswith(".jpg"):
            try:
                os.remove(os.path.join(SAVE_DIR, f))
            except Exception:
                pass
    with lock:
        state.update({"images": [], "running": False, "stopped": False, "error": None})
    return jsonify({"ok": True})

@app.get("/captures/<path:filename>")
def serve_capture(filename: str):
    # servir imágenes con una ruta "bonita" independiente del árbol de ficheros
    return send_from_directory(SAVE_DIR, filename)

if __name__ == "__main__":
    # arranque limpio
    for f in os.listdir(SAVE_DIR):
        if f.lower().endswith(".jpg"):
            try:
                os.remove(os.path.join(SAVE_DIR, f))
            except Exception:
                pass
    with lock:
        state.update({"images": [], "running": False, "stopped": False, "error": None})
    # No arrancamos auto; que el front llame a /start
    app.run(host=HOST, port=PORT, debug=False)
