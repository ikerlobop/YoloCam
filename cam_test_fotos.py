#!/usr/bin/env python3
# app.py — Captura divertida: cada 5s hace 3 fotos, elige 1 aleatoria y llena un grid 2x5 en el front

import os
import time
import threading
import random
from datetime import datetime
from typing import List

import cv2
from flask import Flask, jsonify, send_from_directory, render_template_string

# ----------------- CONFIG -----------------
CAM_INDEX = 0          # cámara integrada
WIDTH, HEIGHT = 640, 480
FPS = 30
SAVE_DIR = os.path.join("static", "capturas")
TOTAL_SLOTS = 10       # 2 filas x 5 columnas
CYCLE_SECONDS = 5      # cada 5s, 3 fotos -> elige 1
# -----------------------------------------

os.makedirs(SAVE_DIR, exist_ok=True)

app = Flask(__name__, static_folder="static")

# Estado compartido
state = {
    "images": [],       # rutas relativas servibles por Flask (por ej: /static/capturas/img_01.jpg)
    "running": False,   # si el hilo de captura está activo
    "stopped": False,   # si ya terminó (al llenar 10 slots)
    "error": None
}
lock = threading.Lock()

INDEX_HTML = """
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Grid 2×5 — Capturas divertidas</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji"; }
    body { margin: 0; background: #0b0d12; color: #e6e8ee; display: grid; place-items: center; min-height: 100dvh; }
    .wrap { width: min(1200px, 95vw); }
    h1 { font-size: 1.25rem; font-weight: 600; letter-spacing: .2px; opacity: .9; }
    .grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      grid-template-rows: repeat(2, 1fr);
      gap: 10px;
      margin-top: 12px;
    }
    /* FILA 2 invertida → derecha a izquierda */
    .grid-row-2{
      direction: rtl;
      display: contents; /* deja que sus hijos (.cell) sean los grid items */
    }
    .cell {
      position: relative;
      aspect-ratio: 16/9;
      background: #141821;
      border: 1px solid #22293a;
      border-radius: 14px;
      overflow: hidden;
      display: grid;
      place-items: center;
    }
    .cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .cell .slot { opacity: .35; font-size: 0.9rem; }
    .bar {
      margin-top: 12px; display: flex; align-items: center; gap: 10px; opacity: .9;
    }
    .pill { padding: 6px 10px; border-radius: 999px; background: #1a2233; border: 1px solid #223052; font-size: .9rem; }
    .ok { color: #7ce38b; }
    .warn { color: #ffd166; }
    .err { color: #ff6b6b; }
    .muted { color: #9aa7bd; }
    footer { margin-top: 10px; font-size: .85rem; color: #8091ad; opacity: .85; }
    a { color: #9dc0ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>🎲 Capturas cada 5s — 3 fotos → 1 elegida (random) · Grid 2×5</h1>

    <div class="grid" id="grid">
      <!-- Se rellenará desde JS -->
    </div>

    <div class="bar">
      <div class="pill" id="status">Estado: <span class="muted">inicializando…</span></div>
      <div class="pill">Completadas: <span id="count">0</span>/10</div>
    </div>

    <footer id="foot"></footer>
  </div>

  <script>
    const grid = document.getElementById('grid');
    const statusEl = document.getElementById('status');
    const countEl = document.getElementById('count');
    const footEl = document.getElementById('foot');

    // Render inicial: 10 celdas vacías (fila 1 normal, fila 2 invertida)
    function emptyGrid() {
      grid.innerHTML = '';

      // --- Primera fila normal (slots 1-5) ---
      for (let i = 0; i < 5; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        const span = document.createElement('div');
        span.className = 'slot';
        span.textContent = 'Slot ' + String(i + 1).padStart(2, '0');
        cell.appendChild(span);
        grid.appendChild(cell);
      }

      // --- Segunda fila invertida (slots 6-10) ---
      const row2Wrapper = document.createElement('div');
      row2Wrapper.className = 'grid-row-2';
      for (let i = 5; i < 10; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        const span = document.createElement('div');
        span.className = 'slot';
        span.textContent = 'Slot ' + String(i + 1).padStart(2, '0');
        cell.appendChild(span);
        row2Wrapper.appendChild(cell);
      }
      grid.appendChild(row2Wrapper);
    }
    emptyGrid();

    async function fetchState() {
      try {
        const res = await fetch('/state');
        const data = await res.json();

        // Estado/contador
        countEl.textContent = data.images.length;
        if (data.error) {
          statusEl.innerHTML = 'Estado: <span class="err">error</span>';
          footEl.textContent = data.error;
        } else if (data.stopped) {
          statusEl.innerHTML = 'Estado: <span class="ok">completado (parado)</span>';
          footEl.textContent = 'La captura terminó tras llenar los 10 slots.';
        } else if (data.running) {
          statusEl.innerHTML = 'Estado: <span class="warn">capturando…</span>';
          footEl.textContent = 'Cada 5s se añaden nuevas imágenes.';
        } else {
          statusEl.innerHTML = 'Estado: <span class="muted">inicial</span>';
          footEl.textContent = '';
        }

        // Pintar grid en orden lógico 1..10 sobre las 10 .cell
        const cells = grid.querySelectorAll('.cell');
        for (let i = 0; i < 10; i++) {
          const cell = cells[i];
          cell.innerHTML = '';
          if (i < data.images.length) {
            const img = document.createElement('img');
            img.src = data.images[i] + '?t=' + Date.now(); // bust cache
            img.alt = 'Captura ' + (i + 1);
            cell.appendChild(img);
          } else {
            const span = document.createElement('div');
            span.className = 'slot';
            span.textContent = 'Slot ' + String(i + 1).padStart(2, '0');
            cell.appendChild(span);
          }
        }

        // Si ya se paró, detenemos el polling
        if (data.stopped) {
          clearInterval(poller);
        }
      } catch (e) {
        statusEl.innerHTML = 'Estado: <span class="err">error de red</span>';
        footEl.textContent = ('' + e).slice(0, 500);
        clearInterval(poller);
      }
    }

    const poller = setInterval(fetchState, 1000);
    fetchState();
  </script>
</body>
</html>
"""

def filename_for_slot(slot_idx: int) -> str:
    # img_01.jpg ... img_10.jpg
    return f"img_{slot_idx:02d}.jpg"

def capture_loop():
    """Hilo que realiza el ciclo: cada 5s captura 3 fotos y elige 1 al azar. Para al llenar 10 slots."""
    try:
        cap = cv2.VideoCapture(CAM_INDEX)
        if not cap.isOpened():
            raise RuntimeError(f"No pude abrir la cámara (index={CAM_INDEX})")

        # Sugerir resolución/FPS (no siempre garantizado por el driver)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, WIDTH)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, HEIGHT)
        cap.set(cv2.CAP_PROP_FPS, FPS)

        while True:
            with lock:
                if len(state["images"]) >= TOTAL_SLOTS:
                    state["running"] = False
                    state["stopped"] = True
                    break

            cycle_t0 = time.time()
            frames = []

            # Capturar 3 frames (suave: pequeña pausa entre tomas)
            for _ in range(3):
                ok, frame = cap.read()
                if ok:
                    frames.append(frame.copy())
                time.sleep(0.15)  # micro-espacio para evitar duplicados idénticos

            if not frames:
                # si no hay frames, espera el ciclo y reintenta
                time.sleep(max(0, CYCLE_SECONDS - (time.time() - cycle_t0)))
                continue

            # Elegir 1 al azar
            chosen = random.choice(frames)

            # Guardar en el siguiente slot
            with lock:
                slot_idx = len(state["images"]) + 1
            rel_name = filename_for_slot(slot_idx)
            abs_path = os.path.join(SAVE_DIR, rel_name)
            cv2.imwrite(abs_path, chosen, [int(cv2.IMWRITE_JPEG_QUALITY), 92])

            rel_url = f"/static/capturas/{rel_name}"
            with lock:
                state["images"].append(rel_url)

            # Mantener período de 5s por ciclo (incluido el tiempo de captura)
            elapsed = time.time() - cycle_t0
            sleep_left = max(0.0, CYCLE_SECONDS - elapsed)
            time.sleep(sleep_left)

        cap.release()
    except Exception as e:
        with lock:
            state["error"] = str(e)
            state["running"] = False
            state["stopped"] = True

@app.route("/")
def index():
    return render_template_string(INDEX_HTML)

@app.route("/state")
def get_state():
    with lock:
        return jsonify({
            "images": list(state["images"]),
            "running": state["running"],
            "stopped": state["stopped"],
            "error": state["error"]
        })

@app.route("/static/capturas/<path:filename>")
def serve_capture(filename: str):
    return send_from_directory(SAVE_DIR, filename)

def ensure_thread():
    with lock:
        if not state["running"] and not state["stopped"]:
            state["running"] = True
            t = threading.Thread(target=capture_loop, daemon=True)
            t.start()

if __name__ == "__main__":
    # Retirar capturas previas para empezar limpio
    for f in os.listdir(SAVE_DIR):
        if f.lower().endswith(".jpg"):
            try:
                os.remove(os.path.join(SAVE_DIR, f))
            except Exception:
                pass

    with lock:
        state.update({"images": [], "running": False, "stopped": False, "error": None})

    ensure_thread()
    # Arranca Flask
    # En Windows puedes usar debug=True si quieres recarga; cuidado con hilos dobles; mejor debug=False.
    app.run(host="127.0.0.1", port=5000, debug=False)
