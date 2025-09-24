#!/usr/bin/env python3
# app.py — UI ATL + grid 2x5 + Login (SQLite) + Botón Arrancar + Botón Reset
# Dataset-aware (train/valid/test): elige imágenes al azar del split elegido,
# valida que tengan su etiqueta en labels y descarta las que no.
# + Contador de capas: sube +1 en cada "Arrancar" hasta el total.

import os
import time
import threading
import random
import sqlite3
from typing import List

import psutil
from flask import (
    Flask, jsonify, render_template,
    session, redirect, request, url_for
)
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps

# ----------------- CONFIG -----------------
# Cámara (queda desactivada para el futuro)
CAM_INDEX = 0
WIDTH, HEIGHT = 640, 480
FPS = 30

# Dataset Roboflow exportado bajo static/dataset
DATASET_DIR = os.path.join("static", "dataset")

# Cómo seleccionar las imágenes:
# - "valid_only" (por defecto)
# - "train_only"
# - "test_only"
# - "all" (mezcla los tres)
SPLIT_MODE = os.environ.get("SPLIT_MODE", "valid_only").lower()

# Validación mínima: exigir que exista el .txt de labels con el mismo stem
REQUIRE_LABEL = True

TOTAL_SLOTS = 10      # 2×5
CYCLE_SECONDS = 2     # ritmo de selección

DB_PATH = "users.db"
SECRET_DEFAULT = "dev-secret-change-me"

# Capas
LAYER_TOTAL = int(os.environ.get("LAYER_TOTAL", "32"))
# -----------------------------------------

app = Flask(__name__, static_folder="static")
app.secret_key = os.environ.get("FLASK_SECRET", SECRET_DEFAULT)

# Estado compartido
state = {
    "images": [],       # rutas RELATIVAS a /static (ej: 'dataset/valid/images/xxx.jpg')
    "running": False,
    "stopped": False,
    "error": None,
    "layer_current": 0,
    "layer_total": LAYER_TOTAL,
}
lock = threading.Lock()

# ----------------- AUTH / USERS (SQLite) -----------------
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL,
        password_hash TEXT NOT NULL
    );
    """)
    conn.commit()
    conn.close()

def create_user(name: str, email: str, role: str, password: str):
    conn = get_db()
    conn.execute(
        "INSERT OR IGNORE INTO users (name, email, role, password_hash) VALUES (?,?,?,?)",
        (name, email.lower().strip(), role, generate_password_hash(password))
    )
    conn.commit()
    conn.close()

def find_user_by_email(email: str):
    conn = get_db()
    cur = conn.execute("SELECT * FROM users WHERE email=?", (email.lower().strip(),))
    row = cur.fetchone()
    conn.close()
    return row

def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login", next=request.path))
        return fn(*args, **kwargs)
    return wrapper

# from views.login_user import log   # ❌ quita esto

from flask import (
    Flask, jsonify, render_template,  # ✅ ya usas render_template
    session, redirect, request, url_for
)

@app.route("/login", methods=["GET", "POST"])
def login():
    next_url = request.values.get("next") or "/"
    if request.method == "POST":
        email = request.form.get("email","").strip().lower()
        password = request.form.get("password","")
        user = find_user_by_email(email)
        if user and check_password_hash(user["password_hash"], password):
            session["user_id"] = user["id"]
            session["user_name"] = user["name"]
            session["user_role"] = user["role"]
            session["user_email"] = user["email"]
            return redirect(next_url)
        else:
            return render_template("login.html", error="Credenciales inválidas", next_url=next_url)  # ✅
    else:
        return render_template("login.html", error=None, next_url=next_url)  # ✅


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))

# ----------------- SISTEMA -----------------
@app.route("/system")
def get_system_info():
    """
    Devuelve información del sistema: CPU, RAM, GPU (si disponible)
    """
    # CPU usage
    cpu_percent = psutil.cpu_percent(interval=None)

    # RAM
    ram = psutil.virtual_memory()
    ram_used = round(ram.used / (1024 ** 3), 2)   # en GB
    ram_total = round(ram.total / (1024 ** 3), 2) # en GB

    # GPU (opcional: si tienes NVIDIA y pynvml instalado)
    try:
        import pynvml
        pynvml.nvmlInit()
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        gpu_name = pynvml.nvmlDeviceGetName(handle).decode()
        gpu_util = pynvml.nvmlDeviceGetUtilizationRates(handle).gpu
        pynvml.nvmlShutdown()
    except Exception:
        gpu_name = "N/A"
        gpu_util = None

    # Modelo actual (split que estás usando)
    model = SPLIT_MODE.upper()

    return jsonify({
        "cpu": cpu_percent,
        "ram": {"used": ram_used, "total": ram_total},
        "gpu": {"name": gpu_name, "usage": gpu_util},
        "model": model
    })

@app.route("/me")
def me():
    if "user_id" not in session:
        return jsonify({"auth": False})
    return jsonify({
        "auth": True,
        "id": session["user_id"],
        "name": session["user_name"],
        "email": session["user_email"],
        "role": session["user_role"]
    })

# ----------------- DATASET UTILS -----------------
def _labels_dir_for(split: str) -> str:
    return os.path.join(DATASET_DIR, split, "labels")

def _images_dir_for(split: str) -> str:
    return os.path.join(DATASET_DIR, split, "images")

def _has_label(split: str, image_filename: str) -> bool:
    """Comprueba si existe el .txt correspondiente en labels."""
    if not REQUIRE_LABEL:
        return True
    stem, _ = os.path.splitext(image_filename)
    label_path = os.path.join(_labels_dir_for(split), stem + ".txt")
    return os.path.isfile(label_path)

def _list_images(split: str) -> List[str]:
    """Devuelve rutas relativas (desde static/) de imágenes válidas del split."""
    img_dir = _images_dir_for(split)
    if not os.path.isdir(img_dir):
        return []
    out = []
    for f in os.listdir(img_dir):
        if f.lower().endswith((".jpg", ".jpeg", ".png")) and _has_label(split, f):
            rel = os.path.join("dataset", split, "images", f)  # relativo a /static
            out.append(rel.replace("\\", "/"))
    return out

def build_pool(mode: str) -> List[str]:
    """Construye el pool según el modo (valid_only/train_only/test_only/all)."""
    mode = (mode or "").lower()
    if mode == "train_only":
        pool = _list_images("train")
    elif mode == "test_only":
        pool = _list_images("test")
    elif mode == "all":
        pool = _list_images("train") + _list_images("valid") + _list_images("test")
    else:  # default: valid_only
        pool = _list_images("valid")
    random.shuffle(pool)  # barajar
    return pool

# ----------------- CAPTURA (SELECCIÓN ALEATORIA) -----------------
def capture_loop():
    """
    Selecciona imágenes 1 a 1 desde el dataset y las coloca en cada slot
    hasta llenar los 10. No se repiten imágenes dentro de un ciclo.
    """
    try:
        pool_remaining = build_pool(SPLIT_MODE)
        if not pool_remaining:
            raise RuntimeError(
                f"No hay imágenes válidas en '{SPLIT_MODE}'. "
                f"Revisa la estructura en {DATASET_DIR}/<split>/images + labels"
            )

        slot_idx = 0  # índice para controlar en qué slot estamos

        while slot_idx < TOTAL_SLOTS:
            with lock:
                if len(state["images"]) >= TOTAL_SLOTS:
                    state["running"] = False
                    state["stopped"] = True
                    break

            if not pool_remaining:
                with lock:
                    state["running"] = False
                    state["stopped"] = True
                    state["error"] = "No quedan imágenes disponibles."
                break

            chosen = pool_remaining.pop(0)  # FIFO
            with lock:
                state["images"].append(chosen)
                slot_idx += 1
                print(f"[DEBUG] Slot {slot_idx} cargado con {chosen}")

            time.sleep(CYCLE_SECONDS)

    except Exception as e:
        with lock:
            state["error"] = str(e)
            state["running"] = False
            state["stopped"] = True

def ensure_thread():
    with lock:
        if state["running"]:
            return False
        state["running"] = True
    t = threading.Thread(target=capture_loop, daemon=True)
    t.start()
    return True

# ----------------- RUTAS -----------------
@app.route("/")
@login_required
def index():
    return render_template("index.html")

@app.route("/state")
def get_state():
    with lock:
        names = list(state["images"])
        running = state["running"]
        stopped = state["stopped"]
        error = state["error"]
    urls = [url_for('static', filename=rel_path) for rel_path in names]
    return jsonify({
        "images": urls,
        "running": running,
        "stopped": stopped,
        "error": error,
        "mode": SPLIT_MODE
    })

@app.route("/layers")
def get_layers():
    with lock:
        return jsonify({
            "current": state["layer_current"],
            "total": state["layer_total"]
        })

@app.route("/start_capture", methods=["POST"])
@login_required
def start_capture():
    with lock:
        # limpiar ciclo de imágenes
        state.update({"images": [], "running": False, "stopped": False, "error": None})
        # subir capa al arrancar (una por ciclo de capturas)
        if state["layer_current"] < state["layer_total"]:
            state["layer_current"] += 1

        lc = state["layer_current"]
        lt = state["layer_total"]

    started = ensure_thread()
    return jsonify({
        "status": "started" if started else "already_running",
        "mode": SPLIT_MODE,
        "layer_current": lc,
        "layer_total": lt
    })

@app.route("/reset_capture", methods=["POST"])
@login_required
def reset_capture():
    with lock:
        state.update({"images": [], "running": False, "stopped": False, "error": None})
    return jsonify({"status": "reset_done"})

@app.route("/reset_layers", methods=["POST"])
@login_required
def reset_layers():
    with lock:
        state["layer_current"] = 0
    return jsonify({"status": "layers_reset", "current": 0, "total": state["layer_total"]})

# ----------------- MAIN -----------------
if __name__ == "__main__":
    # Estado limpio
    with lock:
        state.update({"images": [], "running": False, "stopped": False, "error": None})

    # Inicializa DB + usuario demo
    init_db()
    create_user(
        name="Miguel Rodríguez",
        email="miguel@rdt.local",
        role="Operario Senior",
        password="rdt1234"  # ⚠️ cambia en prod
    )

    # Nota: no arrancamos hilo automáticamente
    app.run(host="127.0.0.1", port=5000, debug=False)
