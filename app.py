#!/usr/bin/env python3
# app.py — UI ATL + grid 2x5 + Login (SQLite) + Entrenamiento/Anotación + Upload por split

import os
import time
import threading
import random
import sqlite3
import shutil
import json
from uuid import uuid4
from typing import List, Optional

import psutil
from flask import (
    Flask, jsonify, render_template,
    session, redirect, request, url_for
)
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from functools import wraps

# ----------------- APP (debe ir primero) -----------------
app = Flask(__name__, static_folder="static", template_folder="templates")
SECRET_DEFAULT = "dev-secret-change-me"
app.secret_key = os.environ.get("FLASK_SECRET", SECRET_DEFAULT)

# ----------------- CONFIG -----------------
# Cámara (desactivada en esta versión)
CAM_INDEX = 0
WIDTH, HEIGHT = 640, 480
FPS = 30

# Dataset bajo static/dataset
DATASET_DIR = os.path.join("static", "dataset")
DATASET_ROOT = os.path.join(app.static_folder, "dataset")  # abs

# Split fuente para el grid (simulación)
SPLIT_MODE = os.environ.get("SPLIT_MODE", "valid_only").lower()

# En simulación NO exigimos labels
REQUIRE_LABEL = False

TOTAL_SLOTS = 10      # 2×5
CYCLE_SECONDS = 2     # segundos entre slots

DB_PATH = "users.db"

# Capas
LAYER_TOTAL = int(os.environ.get("LAYER_TOTAL", "32"))

# Carpeta segura para COPIAS por capa (biblioteca)
LAYERS_ROOT_REL = os.path.join("layers")                 # relativo a /static
LAYERS_ROOT_ABS = os.path.join(app.static_folder, LAYERS_ROOT_REL)
os.makedirs(LAYERS_ROOT_ABS, exist_ok=True)

# ----------------- ESTADO -----------------
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

def _safe_add_column(conn: sqlite3.Connection, table: str, colspec: str):
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {colspec}")
        conn.commit()
    except Exception:
        pass  # ya existe

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
    # Tabla de capturas (guardamos la RUTA DE LA COPIA bajo static/layers/…)
    conn.execute("""
    CREATE TABLE IF NOT EXISTS captures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,        -- ruta relativa servible por /static (p.ej: layers/layer_3/abcd.jpg)
        layer INTEGER NOT NULL,    -- nº de capa (1..N)
        split TEXT NOT NULL,       -- 'valid_only' (o el split activo)
        ts INTEGER NOT NULL        -- epoch seconds
    );
    """)
    _safe_add_column(conn, "captures", "src_path TEXT")      # p.ej: dataset/valid/images/foo.jpg
    _safe_add_column(conn, "captures", "labels_json TEXT")   # JSON con cajas normalizadas
    conn.execute("CREATE INDEX IF NOT EXISTS idx_captures_layer_ts ON captures(layer, ts DESC);")
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

# ----------------- LOGIN -----------------
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
            return render_template("login.html", error="Credenciales inválidas", next_url=next_url)
    else:
        return render_template("login.html", error=None, next_url=next_url)

@app.route("/logout")
def logout():
    session.clear
    return redirect(url_for("login"))

# ----------------- SISTEMA -----------------
@app.route("/system")
def get_system_info():
    cpu_percent = psutil.cpu_percent(interval=None)
    ram = psutil.virtual_memory()
    ram_used = round(ram.used / (1024 ** 3), 2)
    ram_total = round(ram.total / (1024 ** 3), 2)

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

# ----------------- DATASET UTILS (SIMULACIÓN) -----------------
def _images_dir_for(split: str) -> str:
    return os.path.join(DATASET_DIR, split, "images")

def _labels_dir_for(split: str) -> str:
    return os.path.join(DATASET_DIR, split, "labels")

def _has_label(split: str, image_filename: str) -> bool:
    if not REQUIRE_LABEL:
        return True
    stem, _ = os.path.splitext(image_filename)
    label_path = os.path.join(_labels_dir_for(split), stem + ".txt")
    return os.path.isfile(label_path)

def _list_images(split: str) -> List[str]:
    """
    Devuelve rutas relativas (desde static/) de imágenes válidas del split.
    En simulación tomamos TODAS las de valid/images aunque no haya labels.
    """
    img_dir = _images_dir_for(split)
    if not os.path.isdir(img_dir):
        return []
    with_label = []
    all_imgs = []
    for f in os.listdir(img_dir):
        if f.lower().endswith((".jpg", ".jpeg", ".png")):
            rel = os.path.join("dataset", split, "images", f).replace("\\", "/")
            all_imgs.append(rel)
            if _has_label(split, f):
                with_label.append(rel)

    if REQUIRE_LABEL and not with_label and all_imgs:
        print(f"[WARN] No hay imágenes con label en '{split}'. Usando TODAS para simulación.")
        return all_imgs

    return with_label if REQUIRE_LABEL else all_imgs

def build_pool(mode: str) -> List[str]:
    mode = (mode or "").lower()
    if mode == "train_only":
        pool = _list_images("train")
    elif mode == "test_only":
        pool = _list_images("test")
    elif mode == "all":
        pool = _list_images("train") + _list_images("valid") + _list_images("test")
    else:
        pool = _list_images("valid")  # simulación principal
    print(f"[INFO] SPLIT_MODE={mode} -> {len(pool)} imágenes en pool")
    random.shuffle(pool
    )
    return pool

# ---------- Labels (YOLO) ----------
def _labels_path_for_src(path_rel_src: str) -> Optional[str]:
    """
    Recibe 'dataset/<split>/images/file.jpg' y devuelve ruta absoluta al TXT en '.../labels/file.txt'
    """
    if not path_rel_src:
        return None
    parts = path_rel_src.replace("\\", "/").split("/")
    if len(parts) < 4:
        return None
    split = parts[1]
    fname = parts[-1]
    stem, _ = os.path.splitext(fname)
    abs_txt = os.path.join(app.static_folder, "dataset", split, "labels", stem + ".txt")
    return abs_txt

def _parse_yolo_txt(abs_txt: str) -> List[dict]:
    out = []
    if not abs_txt or not os.path.isfile(abs_txt):
        return out
    try:
        with open(abs_txt, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                parts = line.split()
                if len(parts) < 5:
                    continue
                cls = int(float(parts[0]))
                xc = float(parts[1]); yc = float(parts[2])
                w  = float(parts[3]); h  = float(parts[4])
                xc = max(0.0, min(1.0, xc))
                yc = max(0.0, min(1.0, yc))
                w  = max(0.0, min(1.0, w))
                h  = max(0.0, min(1.0, h))
                out.append({"cls": cls, "xc": xc, "yc": yc, "w": w, "h": h})
    except Exception as e:
        print(f"[WARN] No se pudo parsear labels {abs_txt}: {e}")
    return out

# ----------------- PERSISTENCIA DE CAPTURAS (COPIA A layers/) -----------------
def save_capture(path_rel_src: str, layer: int, split: str):
    """
    Crea una COPIA de la imagen del dataset en static/layers/layer_<layer>/uuid.ext
    y guarda en DB la ruta de la COPIA (relativa a /static) + labels normalizados.
    El dataset original (static/dataset/...) no se toca nunca.
    """
    src_abs = os.path.join(app.static_folder, path_rel_src)
    if not os.path.isfile(src_abs):
        raise FileNotFoundError(f"Fuente no encontrada: {src_abs}")

    ext = os.path.splitext(src_abs)[1].lower() or ".jpg"
    dst_dir_rel = os.path.join(LAYERS_ROOT_REL, f"layer_{int(layer)}")
    dst_dir_abs = os.path.join(app.static_folder, dst_dir_rel)
    os.makedirs(dst_dir_abs, exist_ok=True)

    dst_name = f"{uuid4().hex}{ext}"
    dst_rel = os.path.join(dst_dir_rel, dst_name).replace("\\", "/")
    dst_abs = os.path.join(app.static_folder, dst_rel)

    shutil.copy2(src_abs, dst_abs)

    labels_abs = _labels_path_for_src(path_rel_src)
    boxes = _parse_yolo_txt(labels_abs)
    labels_json = json.dumps(boxes) if boxes else None

    conn = get_db()
    conn.execute(
        "INSERT INTO captures (path, layer, split, ts, src_path, labels_json) "
        "VALUES (?,?,?, strftime('%s','now'), ?, ?)",
        (dst_rel, int(layer), (split or '').lower(), path_rel_src, labels_json)
    )
    conn.commit()
    conn.close()

# ----------------- CAPTURA (SELECCIÓN ALEATORIA) -----------------
def capture_loop():
    try:
        pool_remaining = build_pool(SPLIT_MODE)
        if not pool_remaining:
            raise RuntimeError(
                f"No hay imágenes válidas en '{SPLIT_MODE}'. Revisa static/dataset/<split>/images"
            )

        slot_idx = 0
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

            chosen = pool_remaining.pop(0)  # ruta relativa al dataset (para el grid)
            with lock:
                state["images"].append(chosen)
                current_layer = state["layer_current"]
                slot_idx += 1
                print(f"[DEBUG] Slot {slot_idx} cargado con {chosen}")

            try:
                save_capture(chosen, current_layer, SPLIT_MODE)
            except Exception as e:
                print(f"[WARN] No se pudo guardar la captura en DB: {e}")

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
        state["stopped"] = False
        state["error"] = None
        state["images"] = []
    t = threading.Thread(target=capture_loop, daemon=True)
    t.start()
    return True

# ----------------- RUTAS PRINCIPALES -----------------
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

    items = []
    for rel_path in names:
        abs_txt = _labels_path_for_src(rel_path)
        boxes = _parse_yolo_txt(abs_txt)
        items.append({
            "url": url_for('static', filename=rel_path),
            "boxes": boxes,
            "boxes_count": len(boxes),
            "src_label": abs_txt if abs_txt else None
        })

    return jsonify({
        "images": [url_for('static', filename=p) for p in names],
        "items": items,
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
        state.update({"images": [], "running": False, "stopped": False, "error": None})
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

# --- Biblioteca: SOLO devuelve copias bajo static/layers/ + labels si existen ---
@app.route("/library")
@login_required
def library():
    layer = request.args.get("layer", type=int)
    limit = request.args.get("limit", 200, type=int)
    conn = get_db()
    if layer is None or layer == 0:
        rows = conn.execute(
            "SELECT path, labels_json FROM captures WHERE path LIKE ? ORDER BY ts DESC LIMIT ?",
            (f"{LAYERS_ROOT_REL}/%", limit)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT path, labels_json FROM captures WHERE layer=? AND path LIKE ? ORDER BY ts DESC LIMIT ?",
            (layer, f"{LAYERS_ROOT_REL}/%", limit)
        ).fetchall()
    conn.close()

    items = []
    urls = []
    for r in rows:
        rel = r[0]
        url = url_for('static', filename=rel)
        urls.append(url)
        boxes = []
        if r[1]:
            try:
                boxes = json.loads(r[1])
            except Exception:
                boxes = []
        items.append({"url": url, "boxes": boxes})

    return jsonify({"images": urls, "items": items, "layer": layer or 0})

@app.route("/layers_summary")
@login_required
def layers_summary():
    conn = get_db()
    rows = conn.execute("""
        SELECT layer, COUNT(*) AS n
        FROM captures
        GROUP BY layer
        ORDER BY layer ASC
    """).fetchall()
    conn.close()
    return jsonify({"layers": [{"layer": r[0], "count": r[1]} for r in rows]})

@app.route("/library/delete_layer", methods=["POST"])
@login_required
def library_delete_layer():
    data = request.get_json(silent=True) or {}
    layer = data.get("layer", None)
    delete_files = bool(data.get("delete_files", False))

    if layer is None:
        return jsonify({"error": "layer requerido"}), 400
    try:
        layer = int(layer)
        if layer <= 0:
            return jsonify({"error": "layer debe ser un entero > 0"}), 400
    except Exception:
        return jsonify({"error": "layer inválido"}), 400

    conn = get_db()

    files_to_delete = []
    if delete_files:
        rows = conn.execute("SELECT path FROM captures WHERE layer=?", (layer,)).fetchall()
        for (rel_path,) in rows:
            rel_norm = (rel_path or "").replace("\\", "/")
            if rel_norm.startswith(f"{LAYERS_ROOT_REL}/"):
                files_to_delete.append(rel_norm)

    cur = conn.execute("DELETE FROM captures WHERE layer=?", (layer,))
    deleted = cur.rowcount or 0
    conn.commit()
    conn.close()

    files_removed = 0
    if delete_files and files_to_delete:
        for rel in files_to_delete:
            try:
                abs_path = os.path.join(app.static_folder, rel)
                if os.path.isfile(abs_path):
                    os.remove(abs_path)
                    files_removed += 1
            except Exception as e:
                print(f"[WARN] No se pudo borrar {rel}: {e}")

    return jsonify({
        "status": "ok",
        "layer": layer,
        "deleted_db": deleted,
        "deleted_files": files_removed if delete_files else None
    })

# ----------------- PANTALLA TRAINING -----------------
@app.route("/training")
@login_required
def training():
    return render_template("training.html")

# ====== ENTRENAMIENTO / ANOTACIÓN ======
CLASSES_FILE = os.path.join(os.getcwd(), "classes.txt")

def _dataset_images(split: str):
    split = (split or "train").lower()
    img_dir = os.path.join(app.static_folder, "dataset", split, "images")
    if not os.path.isdir(img_dir):
        return []
    return sorted([f for f in os.listdir(img_dir) if f.lower().endswith((".jpg",".jpeg",".png"))])

@app.route("/annotate/images")
@login_required
def annotate_images():
    split = request.args.get("split", "train").lower()
    items = _dataset_images(split)
    return jsonify({"split": split, "images": items})

def _classes_list():
    if not os.path.isfile(CLASSES_FILE):
        return []
    with open(CLASSES_FILE, "r", encoding="utf-8") as fh:
        return [l.strip() for l in fh if l.strip()]

@app.route("/annotate/classes")
@login_required
def annotate_classes():
    if not os.path.isfile(CLASSES_FILE):
        return jsonify({"classes": []})
    with open(CLASSES_FILE, "r", encoding="utf-8") as fh:
        classes = [l.strip() for l in fh if l.strip()]
    return jsonify({"classes": classes})

@app.route("/annotate/save", methods=["POST"])
@login_required
def annotate_save():
    """
    Body JSON:
      {
        "split": "train|valid|test",
        "image": "nombre.jpg",
        "label": "grieta",             # texto presente en classes.txt
        "boxes": [{"x":..,"y":..,"w":..,"h":..}, ...]  # coords en PIXELES de la imagen original
      }
    Guarda/overwrite el TXT en static/dataset/<split>/labels/<stem>.txt
    """
    data = request.get_json(silent=True) or {}
    split = (data.get("split") or "train").lower()
    image = data.get("image")
    label = (data.get("label") or "").strip()
    boxes = data.get("boxes") or []

    if not image or not label or not isinstance(boxes, list):
        return jsonify({"error": "payload incompleto"}), 400

    img_abs = os.path.join(app.static_folder, "dataset", split, "images", image)
    if not os.path.isfile(img_abs):
        return jsonify({"error": f"imagen no encontrada en {split}/images/{image}"}), 404

    try:
        from PIL import Image
        with Image.open(img_abs) as im:
            iw, ih = im.size
    except Exception as e:
        return jsonify({"error": f"PIL no pudo abrir imagen: {e}"}), 500

    classes = _classes_list()
    if not classes:
        return jsonify({"error": "classes.txt no encontrado o vacío"}), 400
    try:
        class_id = classes.index(label)
    except ValueError:
        return jsonify({"error": f"label '{label}' no está en classes.txt"}), 400

    labels_dir = os.path.join(app.static_folder, "dataset", split, "labels")
    os.makedirs(labels_dir, exist_ok=True)

    stem, _ = os.path.splitext(image)
    txt_abs = os.path.join(labels_dir, stem + ".txt")

    lines = []
    def clamp(v, lo=0.0, hi=1.0): return max(lo, min(hi, v))
    for b in boxes:
        x = float(b.get("x", 0)); y = float(b.get("y", 0))
        w = float(b.get("w", 0)); h = float(b.get("h", 0))
        x = max(0, min(x, iw)); y = max(0, min(y, ih))
        w = max(1, min(w, iw - x)); h = max(1, min(h, ih - y))
        xc = (x + w/2) / iw
        yc = (y + h/2) / ih
        nw = w / iw
        nh = h / ih
        lines.append(f"{class_id} {clamp(xc):.6f} {clamp(yc):.6f} {clamp(nw):.6f} {clamp(nh):.6f}")

    with open(txt_abs, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + ("\n" if lines else ""))

    return jsonify({"status": "ok", "saved": txt_abs.replace(app.static_folder+os.sep, "").replace("\\","/")})

# ====== UPLOAD DE IMÁGENES POR SPLIT (opcionalmente con labels ya normalizados) ======
ALLOWED_EXTS = {'.jpg', '.jpeg', '.png'}

def _allowed_ext(filename: str) -> bool:
    return os.path.splitext(filename)[1].lower() in ALLOWED_EXTS

@app.route("/upload_training_image", methods=["POST"])
@login_required
def upload_training_image():
    """
    Form-Data:
      - split: train|valid|test
      - image: archivo .jpg/.jpeg/.png
      - label_data: JSON opcional con [{"class_id":int,"bbox":[xc,yc,w,h]}, ...] normalizados
    """
    split = (request.form.get("split") or "train").lower()
    file = request.files.get("image")
    label_data = request.form.get("label_data")

    if split not in ["train", "valid", "test"]:
        return jsonify({"error": "split inválido"}), 400
    if not file or not file.filename:
        return jsonify({"error": "no se recibió imagen"}), 400
    if not _allowed_ext(file.filename):
        return jsonify({"error": "extensión no permitida (usa .jpg/.jpeg/.png)"}), 400

    images_path = os.path.join(DATASET_ROOT, split, "images")
    labels_path = os.path.join(DATASET_ROOT, split, "labels")
    os.makedirs(images_path, exist_ok=True)
    os.makedirs(labels_path, exist_ok=True)

    base = secure_filename(file.filename)
    name, ext = os.path.splitext(base)
    candidate = base
    abs_img = os.path.join(images_path, candidate)
    if os.path.exists(abs_img):
        candidate = f"{name}_{uuid4().hex[:8]}{ext}"
        abs_img = os.path.join(images_path, candidate)

    # Guardar imagen
    file.save(abs_img)

    # Guardar label si se envía
    saved_label = None
    if label_data:
        try:
            boxes = json.loads(label_data)
        except Exception as e:
            return jsonify({"error": f"label_data inválido: {e}"}), 400

        stem, _ = os.path.splitext(candidate)
        abs_txt = os.path.join(labels_path, f"{stem}.txt")
        with open(abs_txt, "w", encoding="utf-8") as f:
            for box in boxes or []:
                cls = int(box.get("class_id", 0))
                xc, yc, w, h = box.get("bbox", [0,0,0,0])
                f.write(f"{cls} {float(xc):.6f} {float(yc):.6f} {float(w):.6f} {float(h):.6f}\n")
        saved_label = os.path.relpath(abs_txt, app.static_folder).replace("\\","/")

    return jsonify({
        "status": "ok",
        "split": split,
        "image": os.path.relpath(abs_img, app.static_folder).replace("\\","/"),
        "label": saved_label
    })

# ----------------- MAIN -----------------
if __name__ == "__main__":
    with lock:
        state.update({"images": [], "running": False, "stopped": False, "error": None})

    init_db()
    create_user(
        name="Miguel Rodríguez",
        email="miguel@rdt.local",
        role="Operario Senior",
        password="rdt1234"  # ⚠️ cambia en prod
    )

    app.run(host="127.0.0.1", port=5000, debug=False)
