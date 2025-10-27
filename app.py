#!/usr/bin/env python3
# app.py — UI ATL + grid 2x5 + Login (SQLite) + Entrenamiento/Anotación + Upload por split

import os
import time
import threading
import random
import sqlite3
import shutil
import json
import sys, subprocess
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
app.config['MAX_CONTENT_LENGTH'] = 512 * 1024 * 1024  # límite subida (512MB por request)

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

# Carpeta resumen por capa (lámina + copia de imágenes)
IMAGEN_CAPA_ROOT_REL = os.path.join("imagen_capa")          # relativo a /static
IMAGEN_CAPA_ROOT_ABS = os.path.join(app.static_folder, IMAGEN_CAPA_ROOT_REL)
os.makedirs(IMAGEN_CAPA_ROOT_ABS, exist_ok=True)


# ----------------- ESTADO -----------------
state = {
    "images": [],       # rutas RELATIVAS a /static (ej: 'dataset/valid/images/xxx.jpg')
    "running": False,
    "stopped": False,
    "error": None,
    "layer_current": 0,
    "layer_total": LAYER_TOTAL,
    "cancel": False
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
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            role TEXT NOT NULL,
            password_hash TEXT NOT NULL
        );
        """
    )
    # Tabla de capturas (guardamos la RUTA DE LA COPIA bajo static/layers/…)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS captures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL,        -- ruta relativa servible por /static (p.ej: layers/layer_3/abcd.jpg)
            layer INTEGER NOT NULL,    -- nº de capa (1..N)
            split TEXT NOT NULL,       -- 'valid_only' (o el split activo)
            ts INTEGER NOT NULL        -- epoch seconds
        );
        """
    )
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
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
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
    session.clear()
    return redirect(url_for("login"))


# ----------------- SISTEMA -----------------
@app.route("/system")
@login_required
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
    """Devuelve rutas relativas (desde static/) de imágenes válidas del split.
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
    random.shuffle(pool)
    return pool


# ---------- Labels (YOLO) ----------

def _labels_path_for_src(path_rel_src: str) -> Optional[str]:
    """Recibe 'dataset/<split>/images/file.jpg' y devuelve ruta absoluta al TXT en '.../labels/file.txt'"""
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
    """Crea una COPIA de la imagen del dataset en static/layers/layer_<layer>/uuid.ext
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


def bundle_layer_assets(layer: int, grid_cols: int = 5, grid_rows: int = 2, gutter: int = 0):
    """Copia las imágenes de static/layers/layer_<layer>/ a
    static/imagen_capa/layer_<layer>/images/
    y genera una lámina (contact sheet) sin bandas negras (modo COVER) en:
    static/imagen_capa/layer_<layer>/layer_<layer>.jpg
    """
    try:
        from PIL import Image, ImageOps
    except Exception as e:
        print(f"[WARN] Pillow no disponible; omito lámina unificada: {e}")
        return

    # Compat Resampling (Pillow>=9.1) o filtro LANCZOS antiguo
    try:
        RESAMPLE_LANCZOS = Image.Resampling.LANCZOS  # type: ignore[attr-defined]
    except Exception:
        RESAMPLE_LANCZOS = Image.LANCZOS

    # 1) Obtener lista ordenada por tiempo de las COPIAS en layers/ para esta capa
    conn = get_db()
    db_rows = conn.execute(
        "SELECT path FROM captures WHERE layer=? AND path LIKE ? ORDER BY ts ASC",
        (int(layer), f"{LAYERS_ROOT_REL}/%")
    ).fetchall()
    conn.close()

    rel_paths = [(r[0] or "").replace("\\", "/") for r in db_rows]
    if not rel_paths:
        print(f"[INFO] Sin imágenes para layer {layer}, no genero lámina")
        return

    # 2) Preparar destino
    layer_dir_rel = os.path.join(IMAGEN_CAPA_ROOT_REL, f"layer_{int(layer)}").replace("\\", "/")
    layer_dir_abs = os.path.join(app.static_folder, layer_dir_rel)
    images_dst_abs = os.path.join(layer_dir_abs, "images")
    os.makedirs(images_dst_abs, exist_ok=True)

    # 3) Copiar imágenes a imagen_capa/layer_<N>/images/
    abs_list = []
    for rel in rel_paths:
        src_abs = os.path.join(app.static_folder, rel)
        if not os.path.isfile(src_abs):
            continue
        fname = os.path.basename(src_abs)
        dst_abs = os.path.join(images_dst_abs, fname)
        try:
            if not os.path.isfile(dst_abs):
                shutil.copy2(src_abs, dst_abs)
            abs_list.append(dst_abs)
        except Exception as e:
            print(f"[WARN] No se pudo copiar {src_abs} -> {dst_abs}: {e}")

    if not abs_list:
        print(f"[INFO] No hay archivos válidos que copiar en layer {layer}")
        return

    # 4) Parámetros de lámina (2x5 por defecto) y tamaño de tile
    cols = int(grid_cols)
    n_rows = int(grid_rows)
    abs_list = abs_list[: cols * n_rows]  # máximo visibles

    tile_w, tile_h = 320, 240  # relación 4:3. Ajusta si quieres más grande/pequeño

    # 5) Lienzo final sin gaps (gutter=0 por defecto)
    sheet_w = cols * tile_w + (cols - 1) * gutter
    sheet_h = n_rows * tile_h + (n_rows - 1) * gutter
    sheet = Image.new("RGB", (sheet_w, sheet_h), (0, 0, 0))

    # 6) Generar thumbnails en modo COVER (sin bandas; se recorta lo que sobre)
    idx = 0
    for path in abs_list:
        try:
            with Image.open(path) as im:
                im = im.convert("RGB")
                th = ImageOps.fit(im, (tile_w, tile_h), method=RESAMPLE_LANCZOS, centering=(0.5, 0.5))
        except Exception as e:
            print(f"[WARN] No se pudo preparar thumbnail {path}: {e}")
            continue

        r = idx // cols
        c = idx % cols
        x = c * (tile_w + gutter)
        y = r * (tile_h + gutter)
        sheet.paste(th, (x, y))

        # ======= NUEVO: dibujar bounding boxes sobre el tile =======
        try:
            from PIL import ImageDraw, ImageFont
            conn = get_db()
            cur = conn.execute(
                "SELECT labels_json FROM captures WHERE path=?",
                ((path.replace(app.static_folder + os.sep, '').replace('\\', '/')),)
            )
            row = cur.fetchone()
            conn.close()

            if row and row["labels_json"]:
                boxes = json.loads(row["labels_json"])
                draw = ImageDraw.Draw(sheet)
                for b in boxes:
                    cls = b.get("cls", 0)
                    xc, yc, w, h = b.get("xc"), b.get("yc"), b.get("w"), b.get("h")
                    if None in (xc, yc, w, h): 
                        continue
                    # Convertir coords normalizadas a píxeles en el tile
                    x0 = x + (xc - w/2) * tile_w
                    y0 = y + (yc - h/2) * tile_h
                    x1 = x + (xc + w/2) * tile_w
                    y1 = y + (yc + h/2) * tile_h
                    color = (255, 0, 0)
                    try:
                        with open(_classes_json_path(), "r", encoding="utf-8") as cf:
                            j = json.load(cf)
                            palette = [tuple(int(jc[i:i+2], 16) for i in (1,3,5)) for jc in [c["color"] for c in j["classes"]]]
                            color = palette[cls % len(palette)]
                    except Exception:
                        pass
                    draw.rectangle([x0, y0, x1, y1], outline=color, width=2)
        except Exception as e:
            print(f"[WARN] No se pudieron dibujar cajas sobre {path}: {e}")
        # ======= FIN NUEVO =======

        idx += 1

    # 7) Guardar lámina
    out_abs = os.path.join(layer_dir_abs, f"layer_{int(layer)}.jpg")
    try:
        sheet.save(out_abs, quality=92)
        print(f"[OK] Lámina unificada (cover) creada: {out_abs}")
    except Exception as e:
        print(f"[WARN] No se pudo guardar lámina layer {layer}: {e}")


    # 8) Crear marker .done para indicar que la capa está completa (aunque no haya lámina)    

    try:
        marker = os.path.join(layer_dir_abs, ".done")
        with open(marker, "w", encoding="utf-8") as f:
            f.write("ok")
        print(f"[OK] Marker creado: {marker}")
    except Exception as e:
        print(f"[WARN] No se pudo crear marker .done: {e}")


# ----------------- CAPTURA (SELECCIÓN ALEATORIA) -----------------

def capture_loop():
    try:
        # fijar id de capa para toda la captura (evita carreras)
        with lock:
            layer_id = state["layer_current"]

        pool_remaining = build_pool(SPLIT_MODE)
        if not pool_remaining:
            raise RuntimeError(
                f"No hay imágenes válidas en '{SPLIT_MODE}'. Revisa static/dataset/<split>/images"
            )

        slot_idx = 0
        while slot_idx < TOTAL_SLOTS:
            # --- CANCELACIÓN: salir limpio si se solicita ---
            with lock:
                if state.get("cancel"):
                    state["running"] = False
                    state["stopped"] = True
                    # empaquetar lo que haya si ya existen imágenes
                    pending = len(state["images"]) > 0
            if 'pending' in locals() and pending:
                try:
                    bundle_layer_assets(layer_id)
                except Exception as e:
                    print(f"[WARN] bundle (on cancel) layer {layer_id}: {e}")
            if 'pending' in locals() and state.get("stopped"):
                break

            # --- fin cancelación ---

            with lock:
                if len(state["images"]) >= TOTAL_SLOTS:
                    state["running"] = False
                    state["stopped"] = True
            # fuera del lock: comprobamos y empaquetamos
            if len(state["images"]) >= TOTAL_SLOTS:
                try:
                    bundle_layer_assets(layer_id)
                except Exception as e:
                    print(f"[WARN] bundle layer {layer_id}: {e}")
                break

            if not pool_remaining:
                with lock:
                    state["running"] = False
                    state["stopped"] = True
                    state["error"] = "No quedan imágenes disponibles."
                try:
                    bundle_layer_assets(layer_id)
                except Exception as e:
                    print(f"[WARN] bundle layer {layer_id}: {e}")
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
        try:
            bundle_layer_assets(layer_id)
        except Exception as e2:
            print(f"[WARN] bundle (on error) layer {layer_id}: {e2}")



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
@login_required
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
@login_required
def get_layers():
    current = state["layer_current"]
    total = state["layer_total"]
    # existe marker?
    layer_dir_abs = os.path.join(app.static_folder, IMAGEN_CAPA_ROOT_REL, f"layer_{current}")
    final_ready = os.path.isfile(os.path.join(layer_dir_abs, f"layer_{current}.jpg")) or \
                  os.path.isfile(os.path.join(layer_dir_abs, ".done"))
    return jsonify({
        "current": current,
        "total": total,
        "final_ready": final_ready
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
        state["cancel"] = True
    time.sleep(0.05)  # microyield
    with lock:
        state.update({"images": [], "running": False, "stopped": False, "error": None, "cancel": False})
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
    rows = conn.execute(
        """
        SELECT layer, COUNT(*) AS n
        FROM captures
        GROUP BY layer
        ORDER BY layer ASC
        """
    ).fetchall()
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
    except Exception:
        return jsonify({"error": "layer inválido"}), 400

    conn = get_db()

    files_to_delete = []
    if delete_files:
        if layer == 0:
            rows = conn.execute("SELECT path FROM captures WHERE path LIKE ?", (f"{LAYERS_ROOT_REL}/%",)).fetchall()
        else:
            rows = conn.execute("SELECT path FROM captures WHERE layer= ?", (layer,)).fetchall()
        for (rel_path,) in rows:
            rel_norm = (rel_path or "").replace("\\", "/")
            if rel_norm.startswith(f"{LAYERS_ROOT_REL}/"):
                files_to_delete.append(rel_norm)

    # Borrado en DB
    if layer == 0:
        cur = conn.execute("DELETE FROM captures WHERE path LIKE ?", (f"{LAYERS_ROOT_REL}/%",))
    else:
        cur = conn.execute("DELETE FROM captures WHERE layer=?", (layer,))
    deleted = cur.rowcount or 0
    conn.commit()
    conn.close()

    # Borrado físico opcional
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


@app.route("/imagen_capa/delete_layer", methods=["POST"])
@login_required
def delete_layer_sheet():
    data = request.get_json(silent=True) or {}
    layer = data.get("layer", None)
    if layer is None:
        return jsonify({"error": "layer requerido"}), 400

    try:
        layer = int(layer)
    except Exception:
        return jsonify({"error": "layer inválido"}), 400

    layer_dir_rel = os.path.join(IMAGEN_CAPA_ROOT_REL, f"layer_{layer}")
    layer_dir_abs = os.path.join(app.static_folder, layer_dir_rel)

    removed_files, removed_dirs = 0, 0
    if os.path.isdir(layer_dir_abs):
        for root, dirs, files in os.walk(layer_dir_abs, topdown=False):
            for f in files:
                try:
                    os.remove(os.path.join(root, f))
                    removed_files += 1
                except Exception as e:
                    print(f"[WARN] No se pudo borrar {f}: {e}")
            for d in dirs:
                try:
                    os.rmdir(os.path.join(root, d))
                    removed_dirs += 1
                except Exception as e:
                    print(f"[WARN] No se pudo borrar dir {d}: {e}")
        try:
            os.rmdir(layer_dir_abs)
        except Exception:
            pass

    return jsonify({
        "status": "ok",
        "layer": layer,
        "deleted_files": removed_files,
        "deleted_dirs": removed_dirs
    })


# ----------------- PANTALLA TRAINING -----------------
@app.route("/training")
@login_required
def training():
    return render_template("training.html")


# ====== ENTRENAMIENTO / ANOTACIÓN ======
# Localización robusta de classes.txt
CLASSES_FILE_ENV = os.environ.get("CLASSES_FILE", "").strip()

def _resolve_classes_file():
    """Devuelve la primera ruta existente para classes.txt.
    Orden de búsqueda:
      1) Variable de entorno CLASSES_FILE
      2) Raíz de la app (junto a app.py): app.root_path/classes.txt
      3) Directorio de trabajo actual: cwd/classes.txt
      4) static/dataset/classes.txt
    """
    candidates = []
    if CLASSES_FILE_ENV:
        candidates.append(CLASSES_FILE_ENV)
    # 2) junto a app.py
    candidates.append(os.path.join(app.root_path, "classes.txt"))
    # 3) cwd
    candidates.append(os.path.join(os.getcwd(), "classes.txt"))
    # 4) en static/dataset
    candidates.append(os.path.join(app.static_folder, "dataset", "classes.txt"))

    for p in candidates:
        if p and os.path.isfile(p):
            return p
    # si no existe ninguno, devolvemos la opción por defecto (junto a app.py)
    return os.path.join(app.root_path, "classes.txt")

CLASSES_FILE = _resolve_classes_file()

def _classes_json_path() -> str:
    """Ruta a classes.json, junto a classes.txt (misma carpeta)."""
    base_dir = os.path.dirname(_resolve_classes_file())
    return os.path.join(base_dir, "classes.json")

def _read_classes_json() -> Optional[dict]:
    path = _classes_json_path()
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as e:
        print(f"[WARN] No se pudo leer classes.json: {e}")
        return None

def _write_classes_json(data: dict):
    path = _classes_json_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)

def _write_classes_txt(names: List[str]):
    """Sobrescribe classes.txt con una clase por línea."""
    path = _resolve_classes_file()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        for n in names:
            n = (n or "").strip()
            if n:
                fh.write(n + "\n")

def _classes_list():
    """Lee classes.txt desde la ruta resuelta dinámicamente.
    Si no existe, devuelve [].
    """
    global CLASSES_FILE
    CLASSES_FILE = _resolve_classes_file()
    if not os.path.isfile(CLASSES_FILE):
        return []
    with open(CLASSES_FILE, "r", encoding="utf-8") as fh:
        return [l.strip() for l in fh if l.strip()]

@app.route("/annotate/classes")
@login_required
def annotate_classes():
    # re-resolver cada vez para facilitar debug y hot-reload
    path = _resolve_classes_file()
    classes = []
    exists = os.path.isfile(path)
    mtime = None
    if exists:
        try:
            with open(path, "r", encoding="utf-8") as fh:
                classes = [l.strip() for l in fh if l.strip()]
            mtime = os.path.getmtime(path)
        except Exception:
            classes = []
    return jsonify({
        "classes": classes,
        "path": path,
        "exists": exists,
        "mtime": mtime
    })

# --------- NUEVO: clases con color (JSON) ---------

@app.route("/annotate/classes_meta", methods=["GET"])
@login_required
def classes_meta_get():
    """
    Devuelve: { "classes": [ { "name": "...", "color": "#RRGGBB" }, ... ],
                "path_txt": "<ruta classes.txt>", "path_json": "<ruta classes.json>" }
    Si classes.json no existe, se infiere desde classes.txt con una paleta por defecto.
    """
    txt_path = _resolve_classes_file()
    json_path = _classes_json_path()

    data = _read_classes_json()
    if not data or "classes" not in data:
        names = _classes_list()
        classes = []
        for i, n in enumerate(names):
            color = SUGGESTED_PALETTE[i % len(SUGGESTED_PALETTE)]
            classes.append({"name": n, "color": color})
        data = {"classes": classes}

    return jsonify({
        "classes": data.get("classes", []),
        "path_txt": txt_path,
        "path_json": json_path
    })

@app.route("/annotate/classes_meta", methods=["POST"])
@login_required
def classes_meta_post():
    """
    Espera: { "classes": [ { "name": "grieta", "color": "#ff3b30" }, ... ] }
    Efectos:
      - Guarda classes.json (nombre+color)
      - Reescribe classes.txt con los nombres (una línea por clase)
    """
    payload = request.get_json(silent=True) or {}
    items = payload.get("classes")
    if not isinstance(items, list) or not items:
        return jsonify({"error": "payload inválido; se requiere 'classes' (lista)"}), 400

    # Normaliza lista y valida color (simple)
    normalized = []
    names = []
    for i, it in enumerate(items):
        name = str(it.get("name", "")).strip()
        color = str(it.get("color", "")).strip() or SUGGESTED_PALETTE[i % len(SUGGESTED_PALETTE)]
        if not name:
            return jsonify({"error": f"nombre vacío en índice {i}"}), 400
        # Validación rápida de color #RRGGBB/#RGB
        if not (color.startswith("#") and len(color) in (4, 7)):
            return jsonify({"error": f"color inválido en índice {i}: {color}"}), 400
        normalized.append({"name": name, "color": color})
        names.append(name)

    # Persistir JSON + TXT
    try:
        _write_classes_json({"classes": normalized})
        _write_classes_txt(names)
    except Exception as e:
        return jsonify({"error": f"no se pudo guardar clases: {e}"}), 500

    return jsonify({
        "status": "ok",
        "saved_json": _classes_json_path(),
        "saved_txt": _resolve_classes_file(),
        "count": len(normalized)
    })

# Paleta por defecto para /annotate/classes_meta GET (reutilizamos la del front)
SUGGESTED_PALETTE = [
    "#ff3b30","#ff9500","#ffcc00","#34c759",
    "#00c7be","#30b0ff","#007aff","#5856d6",
    "#af52de","#ff2d55","#64d2ff","#ffd60a"
]

def _dataset_images(split: str):
    """Devuelve la lista de nombres de imagen en static/dataset/<split>/images."""
    split = (split or "train").lower()
    img_dir = os.path.join(app.static_folder, "dataset", split, "images")
    if not os.path.isdir(img_dir):
        return []
    return sorted(
        [f for f in os.listdir(img_dir) if f.lower().endswith((".jpg", ".jpeg", ".png"))]
    )

@app.route("/annotate/images")
@login_required
def annotate_images():
    split = (request.args.get("split") or "train").lower()
    items = _dataset_images(split)            # devuelve sólo los NOMBRES de archivo
    return jsonify({"split": split, "images": items})


@app.route("/annotate/save", methods=["POST"])
@login_required
def annotate_save():
    """
    Body JSON esperado:
      {
        "split": "train|valid|test",
        "image": "nombre.jpg",
        "label": "opcional: nombre de clase por defecto (texto en classes.txt)",
        "boxes": [
          {"x":..,"y":..,"w":..,"h":.., "cls": <int opcional>},
          ...
        ]   # coords en PIXELES de la imagen original
      }

    Escribe/overwrite YOLO TXT en static/dataset/<split>/labels/<stem>.txt
    """
    data = request.get_json(silent=True) or {}
    split = (data.get("split") or "train").lower()
    image = data.get("image")
    default_label_name = (data.get("label") or "").strip()
    boxes = data.get("boxes") or []

    if not image or not isinstance(boxes, list):
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

    # Cargar clases
    classes = _classes_list()
    if not classes:
        return jsonify({"error": "classes.txt no encontrado o vacío"}), 400

    # Clase por defecto (opcional)
    default_cls = None
    if default_label_name:
        try:
            default_cls = classes.index(default_label_name)
        except ValueError:
            return jsonify({"error": f"label '{default_label_name}' no está en classes.txt"}), 400

    def clamp01(v):
        return max(0.0, min(1.0, float(v)))

    lines = []
    for b in boxes:
        # 1) Resolver clase por caja
        cls_from_box = b.get("cls", None)
        if cls_from_box is not None:
            try:
                cls_idx = int(cls_from_box)
            except Exception:
                return jsonify({"error": f"cls inválido en box: {cls_from_box}"}), 400
            if not (0 <= cls_idx < len(classes)):
                return jsonify({"error": f"cls fuera de rango: {cls_idx}"}), 400
        elif default_cls is not None:
            cls_idx = default_cls
        else:
            return jsonify({"error": "cada box debe tener 'cls' o provee 'label' por defecto"}), 400

        # 2) Coords px -> normalizadas YOLO
        try:
            x = float(b.get("x", 0)); y = float(b.get("y", 0))
            w = float(b.get("w", 0)); h = float(b.get("h", 0))
        except Exception:
            return jsonify({"error": "coords no numéricas en alguna box"}), 400

        # recortar a la imagen y asegurar tamaños > 0
        x = max(0, min(x, iw))
        y = max(0, min(y, ih))
        w = max(1, min(w, iw - x))
        h = max(1, min(h, ih - y))

        xc = (x + w/2) / iw
        yc = (y + h/2) / ih
        nw = w / iw
        nh = h / ih

        lines.append(f"{cls_idx} {clamp01(xc):.6f} {clamp01(yc):.6f} {clamp01(nw):.6f} {clamp01(nh):.6f}")

    labels_dir = os.path.join(app.static_folder, "dataset", split, "labels")
    os.makedirs(labels_dir, exist_ok=True)
    stem, _ = os.path.splitext(image)
    txt_abs = os.path.join(labels_dir, stem + ".txt")

    with open(txt_abs, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + ("\n" if lines else ""))

    return jsonify({
        "status": "ok",
        "saved": txt_abs.replace(app.static_folder + os.sep, "").replace("\\", "/"),
        "boxes": len(lines)
    })


# ====== UPLOAD DE IMÁGENES POR SPLIT (opcionalmente con labels ya normalizados) ======
ALLOWED_EXTS = {'.jpg', '.jpeg', '.png'}


def _allowed_ext(filename: str) -> bool:
    return os.path.splitext(filename)[1].lower() in ALLOWED_EXTS


@app.route("/upload_training_image", methods=["POST"])
@login_required
def upload_training_image():
    """Form-Data:
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
                xc, yc, w, h = box.get("bbox", [0, 0, 0, 0])
                f.write(f"{cls} {float(xc):.6f} {float(yc):.6f} {float(w):.6f} {float(h):.6f}\n")
        saved_label = os.path.relpath(abs_txt, app.static_folder).replace("\\", "/")

    return jsonify({
        "status": "ok",
        "split": split,
        "image": os.path.relpath(abs_img, app.static_folder).replace("\\", "/"),
        "label": saved_label
    })


# ====== DATASET BROWSER ======

def _list_split_items(split: str):
    img_dir = os.path.join(app.static_folder, "dataset", split, "images")
    out = []
    if os.path.isdir(img_dir):
        for f in sorted(os.listdir(img_dir)):
            if f.lower().endswith((".jpg", ".jpeg", ".png")):
                url = url_for("static", filename=f"dataset/{split}/images/{f}")
                out.append({"name": f, "url": url})
    return out


@app.route("/dataset_browser")
@login_required
def dataset_browser():
    return render_template("dataset.html")


@app.route("/dataset/list")
@login_required
def dataset_list():
    splits = ["train", "valid", "test"]
    data = {}
    for sp in splits:
        items = _list_split_items(sp)
        data[sp] = {"count": len(items), "items": items}
    return jsonify(data)


# ----------------- NUEVO: UPLOAD MÚLTIPLE POR SPLIT PARA dataset.js -----------------
@app.post("/dataset/upload/<split>")
@login_required
def dataset_upload(split):
    """Endpoint para subir múltiples archivos al split indicado.
    Front: FormData con 'files[]' (o 'files').

    Respuesta:
      { ok: true, added: N, errors: [..] }
    """
    split = (split or "").lower()
    if split not in ("train", "valid", "test"):
        return jsonify(ok=False, error="split inválido"), 400

    images_path = os.path.join(DATASET_ROOT, split, "images")
    os.makedirs(images_path, exist_ok=True)

    files = request.files.getlist("files[]") or request.files.getlist("files")
    if not files:
        return jsonify(ok=False, error="No se recibieron archivos"), 400

    added = 0
    errors = []

    for storage in files:
        fname = secure_filename(storage.filename or "")
        if not fname:
            errors.append("Nombre de archivo vacío")
            continue
        if not _allowed_ext(fname):
            errors.append(f"Extensión no permitida: {fname}")
            continue

        # evitar overwrite
        name, ext = os.path.splitext(fname)
        target = os.path.join(images_path, fname)
        if os.path.exists(target):
            fname = f"{name}_{uuid4().hex[:8]}{ext}"
            target = os.path.join(images_path, fname)

        try:
            storage.save(target)
            added += 1
        except Exception as e:
            errors.append(f"Error guardando {fname}: {e}")

    return jsonify(ok=True, added=added, errors=errors)


@app.route("/dataset/open_folder/<split>", methods=["POST"])
@login_required
def open_folder(split):
    split = (split or "").lower()
    if split not in ("train", "valid", "test"):
        return jsonify({"error": "split inválido"}), 400

    folder = os.path.join(app.static_folder, "dataset", split, "images")
    if not os.path.isdir(folder):
        return jsonify({"error": f"no existe: {folder}"}), 404

    try:
        if sys.platform.startswith("win"):
            os.startfile(folder)  # Explorer (Windows)
        elif sys.platform.startswith("darwin"):
            subprocess.Popen(["open", folder])  # Finder (macOS)
        else:
            subprocess.Popen(["xdg-open", folder])  # Linux
        return jsonify({"status": "ok"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ====== ELIMINACIÓN DE IMÁGENES DEL DATASET ======
@app.route("/dataset/delete/<split>", methods=["DELETE"])
@login_required
def dataset_delete(split):
    """Endpoint para eliminar imágenes del split indicado.
    Body JSON: {"images": ["img1.jpg", "img2.jpg", ...]}
    """
    split = (split or "").lower()
    if split not in ("train", "valid", "test"):
        return jsonify(ok=False, error="split inválido"), 400

    data = request.get_json(silent=True) or {}
    image_names = data.get("images", [])
    
    if not image_names:
        return jsonify(ok=False, error="No se especificaron imágenes para eliminar"), 400

    images_path = os.path.join(DATASET_ROOT, split, "images")
    labels_path = os.path.join(DATASET_ROOT, split, "labels")
    
    deleted_images = 0
    deleted_labels = 0
    errors = []

    for image_name in image_names:
        # Validar nombre seguro
        safe_name = secure_filename(image_name)
        if not safe_name or safe_name != image_name:
            errors.append(f"Nombre de archivo inválido: {image_name}")
            continue

        # Eliminar imagen
        image_path = os.path.join(images_path, image_name)
        if os.path.exists(image_path):
            try:
                os.remove(image_path)
                deleted_images += 1
            except Exception as e:
                errors.append(f"Error eliminando imagen {image_name}: {e}")
        else:
            errors.append(f"Imagen no encontrada: {image_name}")

        # Eliminar etiqueta (si existe)
        stem, _ = os.path.splitext(image_name)
        label_name = f"{stem}.txt"
        label_path = os.path.join(labels_path, label_name)
        if os.path.exists(label_path):
            try:
                os.remove(label_path)
                deleted_labels += 1
            except Exception as e:
                errors.append(f"Error eliminando etiqueta {label_name}: {e}")

    return jsonify({
        "ok": True,
        "message": f"Eliminadas {deleted_images} imágenes y {deleted_labels} etiquetas",
        "deleted_images": deleted_images,
        "deleted_labels": deleted_labels,
        "errors": errors
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

    app.run(host="127.0.0.1", port=5000, debug=True)