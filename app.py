#!/usr/bin/env python3
# app.py — UI ATL + grid 2x5 + Login (SQLite) + Botón Arrancar + Botón Reset
# Dataset-aware (train/valid/test): elige imágenes al azar del split elegido,
# valida que tengan su etiqueta en labels y descarta las que no.

import os
import time
import threading
import random
import sqlite3
from views.index import front
from views.login_user import log
from typing import List

# import cv2  # <-- CÁMARA DESACTIVADA, deja import comentado para futuro

from flask import (
    Flask, jsonify, render_template_string,
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

TOTAL_SLOTS = 10       # 2×5
CYCLE_SECONDS = 5      # ritmo de selección

DB_PATH = "users.db"
SECRET_DEFAULT = "dev-secret-change-me"
# -----------------------------------------

app = Flask(__name__, static_folder="static")
app.secret_key = os.environ.get("FLASK_SECRET", SECRET_DEFAULT)

# Estado compartido
state = {
    "images": [],       # rutas RELATIVAS a /static (ej: 'dataset/valid/images/xxx.jpg')
    "running": False,
    "stopped": False,
    "error": None
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
            # 👇 usar log()
            return render_template_string(log(), error="Credenciales inválidas", next_url=next_url)
    else:
        # 👇 usar log()
        return render_template_string(log(), error=None, next_url=next_url)

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))

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
    # barajamos para aleatoriedad
    random.shuffle(pool)
    return pool

# ----------------- CAPTURA (SELECCIÓN ALEATORIA) -----------------
def capture_loop():
    """
    Sin cámara. Selecciona imágenes aleatorias desde el split configurado.
    'Valida' descartando las que no tienen su .txt en labels.
    """
    try:
        pool_remaining = build_pool(SPLIT_MODE)
        if not pool_remaining:
            raise RuntimeError(
                f"No hay imágenes válidas en '{SPLIT_MODE}'. "
                f"Revisa la estructura en {DATASET_DIR}/<split>/images + labels"
            )

        # Evitar repetir: vamos sacando del pool barajado
        while True:
            with lock:
                if len(state["images"]) >= TOTAL_SLOTS:
                    state["running"] = False
                    state["stopped"] = True
                    break

            if not pool_remaining:
                # si se agota el pool antes de completar slots, paramos
                with lock:
                    state["running"] = False
                    state["stopped"] = True
                    state["error"] = None
                break

            cycle_t0 = time.time()

            # Toma 3 candidatos al azar del pool restante (o menos si queda poco)
            k = min(3, len(pool_remaining))
            candidates = random.sample(pool_remaining, k=k)
            chosen = random.choice(candidates)

            # Quitamos el elegido del pool para no repetir
            try:
                pool_remaining.remove(chosen)
            except ValueError:
                pass

            with lock:
                state["images"].append(chosen)

            elapsed = time.time() - cycle_t0
            time.sleep(max(0.0, CYCLE_SECONDS - elapsed))

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
    return render_template_string(front())


@app.route("/state")
def get_state():
    with lock:
        names = list(state["images"])
        running = state["running"]
        stopped = state["stopped"]
        error = state["error"]
    # Devolvemos URLs públicas con url_for, respetando rutas relativas bajo /static
    urls = [url_for('static', filename=rel_path) for rel_path in names]
    return jsonify({
        "images": urls,
        "running": running,
        "stopped": stopped,
        "error": error,
        "mode": SPLIT_MODE
    })

@app.route("/start_capture", methods=["POST"])
@login_required
def start_capture():
    with lock:
        state.update({"images": [], "running": False, "stopped": False, "error": None})
    started = ensure_thread()
    return jsonify({"status": "started" if started else "already_running", "mode": SPLIT_MODE})

@app.route("/reset_capture", methods=["POST"])
@login_required
def reset_capture():
    with lock:
        state.update({"images": [], "running": False, "stopped": False, "error": None})
    return jsonify({"status": "reset_done"})

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
