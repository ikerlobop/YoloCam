#!/usr/bin/env python3
# app.py — UI ATL + grid 2x5 + Login (SQLite) + Botón Arrancar + Botón Reset
# - /start_capture: SIEMPRE reinicia y arranca nuevas capturas
# - /reset_capture: limpia fotos y estado sin arrancar
# - /state: devuelve URLs con url_for (guardamos solo nombres de archivo en memoria)

import os
import time
import threading
import random
import sqlite3

from flask import (
    Flask, jsonify, render_template_string,
    session, redirect, request, url_for
)
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
import cv2

# ----------------- CONFIG -----------------
CAM_INDEX = 0          # cámara integrada
WIDTH, HEIGHT = 640, 480
FPS = 30
SAVE_DIR = os.path.join("static", "capturas")
TOTAL_SLOTS = 10       # 2 filas x 5 columnas
CYCLE_SECONDS = 5      # cada 5s, 3 fotos -> elige 1

DB_PATH = "users.db"
SECRET_DEFAULT = "dev-secret-change-me"  # cámbialo en producción
# -----------------------------------------

os.makedirs(SAVE_DIR, exist_ok=True)

app = Flask(__name__, static_folder="static")
app.secret_key = os.environ.get("FLASK_SECRET", SECRET_DEFAULT)

# Estado compartido de captura
state = {
    "images": [],       # guardamos SOLO nombres de archivo: ['img_01.jpg', ...]
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

LOGIN_HTML = """
<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Iniciar sesión — ATL RDT</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Arial;background:#0a0e1a;color:#e6e8ee;display:grid;place-items:center;min-height:100vh;margin:0}
  .card{width:min(360px,92vw);background:#121826;border:1px solid #223052;border-radius:14px;padding:20px}
  h1{font-size:1.1rem;margin:0 0 14px}
  label{font-size:.85rem}
  input{width:100%;padding:10px;border-radius:10px;border:1px solid #223052;background:#0f1420;color:#fff;margin-top:6px}
  .row{margin:10px 0}
  .btn{width:100%;padding:12px;border:none;border-radius:10px;background:#00ff41;color:#000;font-weight:800;cursor:pointer}
  .err{color:#ff6b6b;font-size:.9rem;margin:8px 0 0}
  .hint{font-size:.8rem;opacity:.7;margin-top:8px}
</style>
</head><body>
  <div class="card">
    <h1>🔒 Iniciar sesión</h1>
    <form method="post" action="/login">
      <div class="row">
        <label>Email</label>
        <input name="email" type="email" placeholder="user@empresa.com" required>
      </div>
      <div class="row">
        <label>Contraseña</label>
        <input name="password" type="password" placeholder="••••••••" required>
      </div>
      <input type="hidden" name="next" value="{{ next_url }}">
      <button class="btn" type="submit">Entrar</button>
      {% if error %}<div class="err">{{ error }}</div>{% endif %}
      <div class="hint">Demo: miguel@rdt.local / rdt1234</div>
    </form>
  </div>
</body></html>
"""

@app.route("/login", methods=["GET", "POST"])
def login():
    from flask import render_template_string
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
            return render_template_string(LOGIN_HTML, error="Credenciales inválidas", next_url=next_url)
    else:
        return render_template_string(LOGIN_HTML, error=None, next_url=next_url)

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

# ----------------- FRONT (ATL + GRID 2×5 + BOTONES) -----------------
INDEX_HTML = r"""
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>ATL RDT Control System</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Segoe UI,system-ui,-apple-system,Roboto,Ubuntu,Cantarell,Arial;background:#0a0e1a;color:#fff;height:100vh;overflow:hidden}
    .sidebar{position:fixed;left:0;top:0;width:350px;height:100vh;background:linear-gradient(180deg,#1a1f3a 0%,#0f1419 100%);border-right:3px solid #00ff41;z-index:100;overflow-y:auto}
    .sidebar-header{background:linear-gradient(135deg,#00ff41,#00cc34);color:#000;padding:20px;text-align:center}
    .system-title{font-size:20px;font-weight:900;margin-bottom:5px}
    .system-subtitle{font-size:12px;opacity:.8}
    .project-section,.layer-section,.position-section{padding:25px 20px;border-bottom:1px solid #2a3f5f}
    .section-label{font-size:11px;color:#00ff41;font-weight:600;text-transform:uppercase;margin-bottom:8px;letter-spacing:1px}
    .project-name{font-size:18px;font-weight:bold;margin-bottom:12px}
    .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .info-item{background:rgba(0,255,65,.1);padding:8px 12px;border-radius:6px;border-left:3px solid #00ff41}
    .info-label{font-size:10px;color:#8fa8b2;text-transform:uppercase;margin-bottom:2px}
    .info-value{font-size:13px;font-weight:600}
    .current-layer-display{background:linear-gradient(135deg,#ff6b00,#ff8533);padding:20px;border-radius:12px;text-align:center;margin-bottom:20px}
    .layer-number{font-size:36px;font-weight:900;color:#000;line-height:1}
    .layer-total{font-size:14px;color:rgba(0,0,0,.7);margin-top:5px}
    .position-display{background:linear-gradient(135deg,#ff0080,#cc0066);border-radius:20px;padding:25px;margin-bottom:20px;box-shadow:0 10px 30px rgba(255,0,128,.3)}
    .position-title{text-align:center;font-size:16px;font-weight:900;color:#000;margin-bottom:20px;text-transform:uppercase;letter-spacing:2px}
    .position-grid{display:grid;grid-template-columns:1fr 1fr;gap:15px}
    .position-item{background:rgba(0,0,0,.3);border-radius:12px;padding:15px;text-align:center}
    .position-axis{font-size:20px;font-weight:900;color:#000;margin-bottom:8px}
    .position-value{font-size:24px;font-weight:bold;font-family:"Courier New",monospace;margin-bottom:5px}
    .position-unit{font-size:11px;color:rgba(255,255,255,.7);margin-top:3px;font-weight:600}
    .position-status{margin-top:15px;text-align:center;font-size:12px;color:rgba(255,255,255,.8);padding:8px;background:rgba(0,0,0,.2);border-radius:8px;display:flex;align-items:center;justify-content:center;gap:8px}
    .status-dot-position{width:6px;height:6px;background:#00ff41;border-radius:50%;animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
    .main-area{margin-left:350px;height:100vh;display:grid;grid-template-columns:1fr 320px;grid-template-rows:auto 1fr auto}
    .top-bar{grid-column:1/-1;background:linear-gradient(90deg,#1a1f3a 0%,#2a3f5f 100%);padding:15px 30px;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #00ff41}
    .controls-section{display:flex;align-items:center;gap:15px}
    .time-display{font-family:"Courier New",monospace;font-size:18px;font-weight:bold;color:#00ff41}
    .main-content{position:relative;margin:20px 0 0 20px;border-radius:15px;overflow:hidden;background:linear-gradient(135deg,#000 0%,#1a1a1a 100%);border:3px solid #2a3f5f;display:flex;flex-direction:column}
    .video-header{background:rgba(0,0,0,.8);padding:10px 20px;display:flex;justify-content:space-between;align-items:center}
    .video-title{font-size:14px;font-weight:600;color:#00ff41}
    .video-content{height:calc(100% - 50px);position:relative;background:linear-gradient(45deg,#000 0%,#0a0a0a 100%);display:flex;align-items:center;justify-content:center}
    .photo-library{background:linear-gradient(180deg,#1a1f3a 0%,#0f1419 100%);border-left:3px solid #ff0080;display:flex;flex-direction:column;margin:20px 20px 0 20px;border-radius:15px 0 0 0}
    .library-header{background:linear-gradient(135deg,#ff0080,#cc0066);padding:15px;color:#000;font-weight:bold;font-size:14px;text-align:center;text-transform:uppercase}
    .photos-container{flex:1;overflow-y:auto;padding:15px;max-height:calc(100vh - 250px)}
    .bottom-status{grid-column:1/-1;background:#0a0e1a;padding:10px 30px;border-top:1px solid #2a3f5f;display:flex;justify-content:space-between;align-items:center}

    /* Grid 2×5 */
    .grid-wrap{width:min(1200px,96%);margin:16px auto}
    .gridTitle{font-size:13px;letter-spacing:.4px;color:#9dc0ff;opacity:.9;margin:8px 0 6px 8px}
    .grid{display:grid;grid-template-columns:repeat(5,1fr);grid-auto-rows:1fr;gap:10px}
    .grid-row-2{direction:rtl;display:contents}
    .cell{position:relative;aspect-ratio:16/9;background:#141821;border:1px solid #223052;border-radius:14px;overflow:hidden;display:grid;place-items:center}
    .cell img{width:100%;height:100%;object-fit:cover;display:block}
    .slot{opacity:.5;font-size:.9rem;color:#9aa7bd}
    .operator-info{display:flex;align-items:center;gap:20px}
    .operator-selector{display:flex;align-items:center;gap:15px;padding:8px 15px;border-radius:25px;background:rgba(0,255,65,.1)}
    .operator-avatar{width:45px;height:45px;background:linear-gradient(135deg,#00ff41,#00cc34);border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;color:#000;font-size:16px}
    .operator-name{font-size:16px;font-weight:600}
    .operator-role{font-size:12px;color:#8fa8b2}

    /* Botones junto al operario */
    .action-buttons{display:flex;gap:10px;margin-left:12px}
    .btn-small{
      padding:8px 12px;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-size:12px;
      transition:.2s;display:flex;align-items:center;gap:6px
    }
    .btn-small:hover{transform:translateY(-1px)}
    .btn-small:disabled{opacity:.6;cursor:not-allowed}
    .btn-small.success{background:linear-gradient(135deg,#00ff41,#00cc34);color:#000}
    .btn-small.warn{background:linear-gradient(135deg,#ffd166,#ffb703);color:#000}
  </style>
</head>
<body>
  <!-- Sidebar -->
  <div class="sidebar">
    <div class="sidebar-header">
      <div class="system-title">ATL RDT SYSTEM</div>
      <div class="system-subtitle">Quality Control Interface</div>
    </div>

    <div class="project-section">
      <div class="section-label">Proyecto Activo</div>
      <div class="project-name">WING_A320_COMPOSITE_v3.2</div>
      <div class="info-grid">
        <div class="info-item"><div class="info-label">Máquina</div><div class="info-value">ATL-05</div></div>
        <div class="info-item"><div class="info-label">Bobina</div><div class="info-value">CF-945</div></div>
        <div class="info-item"><div class="info-label">Material</div><div class="info-value">T800-CF</div></div>
        <div class="info-item"><div class="info-label">Lote</div><div class="info-value">L-240919</div></div>
      </div>
    </div>

    <div class="layer-section">
      <div class="section-label">Control de Capas</div>
      <div class="current-layer-display">
        <div class="layer-number">18</div>
        <div class="layer-total">de 32 capas</div>
      </div>
    </div>

    <div class="position-section">
      <div class="section-label">Posición ATL en Tiempo Real</div>
      <div class="position-display">
        <div class="position-title">🎯 Coordenadas Máquina</div>
        <div class="position-grid">
          <div class="position-item"><div class="position-axis">X</div><div class="position-value" id="posX">1456.8</div><div class="position-unit">mm</div></div>
          <div class="position-item"><div class="position-axis">Y</div><div class="position-value" id="posY">2134.7</div><div class="position-unit">mm</div></div>
          <div class="position-item"><div class="position-axis">Z</div><div class="position-value" id="posZ">18.5</div><div class="position-unit">mm</div></div>
          <div class="position-item"><div class="position-axis">U</div><div class="position-value" id="posU">45.2</div><div class="position-unit">°</div></div>
        </div>
        <div class="position-status"><div class="status-dot-position"></div>Sistema de posicionamiento ATL activo</div>
      </div>
    </div>
  </div>

  <!-- Área principal -->
  <div class="main-area">
    <div class="top-bar">
      <div class="operator-info">
        <div class="operator-selector">
          <div class="operator-avatar">OP</div>
          <div>
            <div class="operator-name">Operario</div>
            <div class="operator-role">—</div>
          </div>
        </div>
        <div class="action-buttons">
          <button id="startBtn" class="btn-small success" onclick="startCapture()">▶️ Arrancar</button>
          <button id="resetBtn" class="btn-small warn" onclick="resetCapture()">🧹 Reset</button>
        </div>
      </div>
      <div class="controls-section"></div>
      <div class="time-display" id="currentTime">--:--:--</div>
    </div>

    <div class="main-content">
      <div class="main-display">
        <div class="video-header">
          <div class="video-title">🎥 FEED EN VIVO - CÁMARA PRINCIPAL</div>
          <div class="video-stats">640×480 | 30 FPS | Flask Grid</div>
        </div>
        <!-- GRID 2×5 -->
        <div class="grid-wrap">
          <div class="gridTitle">📸 Capturas (2×5)</div>
          <div class="grid" id="grid"></div>
        </div>
      </div>
    </div>

    <div class="photo-library">
      <div class="library-header">📸 BIBLIOTECA DE CAPTURAS</div>
      <div class="photos-container">
        <div style="opacity:.7;font-size:12px;padding:6px 8px;">(Demo UI; el grid funcional está a la izquierda)</div>
        <div style="padding:6px 8px;"><a href="/logout" style="color:#9dc0ff;text-decoration:none">Cerrar sesión</a></div>
      </div>
    </div>

    <div class="bottom-status">
      <div style="font-size:12px;opacity:.8">Estado UI: solo-grid</div>
      <div class="system-performance">GPU: — | CPU: — | RAM: — | Modelo: —</div>
    </div>
  </div>
  <script>
  // Reloj
  function updateTime(){
    const now=new Date();
    document.getElementById('currentTime').textContent=now.toTimeString().slice(0,8);
  }
  setInterval(updateTime,1000); updateTime();

  // Operario desde /me
  async function fillOperator(){
    try{
      const r = await fetch('/me');
      const u = await r.json();
      if(u.auth){
        const avatar = document.querySelector('.operator-avatar');
        const nameEl = document.querySelector('.operator-name');
        const roleEl = document.querySelector('.operator-role');

        if(avatar && u.name){
          const ini = u.name.split(' ').map(s=>s[0]).filter(Boolean).slice(0,2).join('').toUpperCase();
          avatar.textContent = ini || 'OP';
        }
        if(nameEl) nameEl.textContent = u.name || 'Operario';
        if(roleEl) roleEl.textContent = u.role || '—';
      }
    }catch(e){ console.warn('no /me', e); }
  }

  // Grid: render vacío inicial con fila 2 invertida
  const grid = document.getElementById('grid');
  function emptyGrid(){
    grid.innerHTML='';
    // Fila 1 (1..5)
    for(let i=0;i<5;i++){
      const cell=document.createElement('div');
      cell.className='cell';
      const span=document.createElement('div');
      span.className='slot';
      span.textContent='Slot '+String(i+1).padStart(2,'0');
      cell.appendChild(span);
      grid.appendChild(cell);
    }
    // Fila 2 invertida (6..10)
    const row2=document.createElement('div');
    row2.className='grid-row-2';
    for(let i=5;i<10;i++){
      const cell=document.createElement('div');
      cell.className='cell';
      const span=document.createElement('div');
      span.className='slot';
      span.textContent='Slot '+String(i+1).padStart(2,'0');
      cell.appendChild(span);
      row2.appendChild(cell);
    }
    grid.appendChild(row2);
  }
  emptyGrid();

  // Polling
  let poller = null;

  async function fetchState(){
    try{
      const res=await fetch('/state');
      const data=await res.json();

      const cells=grid.querySelectorAll('.cell');
      for(let i=0;i<10;i++){
        const cell=cells[i];
        cell.innerHTML='';
        if(i < data.images.length){
          const img=document.createElement('img');
          img.src=data.images[i]+'?t='+Date.now();
          img.alt='Captura '+(i+1);
          cell.appendChild(img);
        }else{
          const span=document.createElement('div');
          span.className='slot';
          span.textContent='Slot '+String(i+1).padStart(2,'0');
          cell.appendChild(span);
        }
      }
      if(data.stopped){ stopPolling(); }
    }catch(e){
      console.warn('Error fetch /state',e);
      stopPolling();
    }
  }

  async function bootPollingIfNeeded() {
    if (!poller) {
      await fetchState();                 // primer paint
      poller = setInterval(fetchState, 1000);
    }
  }

  function stopPolling() {
    if (poller) { clearInterval(poller); poller = null; }
  }

  function clearGrid() { emptyGrid(); }

  // Botones
  async function startCapture() {
    const startBtn = document.getElementById('startBtn');
    const resetBtn = document.getElementById('resetBtn');
    if (startBtn) { startBtn.disabled = true; startBtn.textContent = '⏳ Iniciando...'; }

    try {
      const res = await fetch('/start_capture', { method: 'POST' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();

      if (data.status === 'started' || data.status === 'already_running') {
        if (startBtn) { startBtn.textContent = '✅ Captura en marcha'; }
        await bootPollingIfNeeded();
      } else {
        if (startBtn) { startBtn.textContent = '❌ Error'; startBtn.disabled = false; }
      }
    } catch (e) {
      console.error('startCapture error', e);
      if (startBtn) { startBtn.textContent = '❌ Error'; startBtn.disabled = false; }
    }
  }

  async function resetCapture() {
    const startBtn = document.getElementById('startBtn');
    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) { resetBtn.disabled = true; resetBtn.textContent = '🧽 Limpiando...'; }

    try {
      const res = await fetch('/reset_capture', { method: 'POST' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();

      if (data.status === 'reset_done') {
        stopPolling();     // detenemos refresco
        clearGrid();       // limpiamos UI
        if (startBtn) { startBtn.disabled = false; startBtn.textContent = '▶️ Arrancar'; }
        if (resetBtn) { resetBtn.textContent = '🧹 Reset'; }
      } else {
        if (resetBtn) { resetBtn.textContent = '❌ Error'; }
      }
    } catch (e) {
      console.error('resetCapture error', e);
      if (resetBtn) { resetBtn.textContent = '❌ Error'; }
    } finally {
      if (resetBtn) { resetBtn.disabled = false; }
    }
  }

  fillOperator();
  // No arrancamos polling hasta pulsar Arrancar (o puedes llamar bootPollingIfNeeded() aquí si quieres auto)
</script>

</body>
</html>
"""

# ----------------- CAPTURA Y RUTAS -----------------
def filename_for_slot(slot_idx: int) -> str:
    return f"img_{slot_idx:02d}.jpg"

def capture_loop():
    """Cada 5s captura 3 fotos, elige 1 al azar. Para al llenar 10 slots."""
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

            cycle_t0 = time.time()
            frames = []

            for _ in range(3):
                ok, frame = cap.read()
                if ok:
                    frames.append(frame.copy())
                time.sleep(0.15)

            if not frames:
                time.sleep(max(0, CYCLE_SECONDS - (time.time() - cycle_t0)))
                continue

            chosen = random.choice(frames)

            with lock:
                slot_idx = len(state["images"]) + 1
            rel_name = filename_for_slot(slot_idx)
            abs_path = os.path.join(SAVE_DIR, rel_name)
            cv2.imwrite(abs_path, chosen, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
            print(f"[SAVE] {abs_path}", flush=True)

            with lock:
                state["images"].append(rel_name)  # guardamos SOLO el nombre

            elapsed = time.time() - cycle_t0
            sleep_left = max(0.0, CYCLE_SECONDS - elapsed)
            time.sleep(sleep_left)

        cap.release()
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

@app.route("/")
@login_required
def index():
    return render_template_string(INDEX_HTML)

@app.route("/state")
def get_state():
    # Devolvemos URLs públicas construidas con url_for
    urls = []
    with lock:
        names = list(state["images"])
        running = state["running"]
        stopped = state["stopped"]
        error = state["error"]
    for name in names:
        urls.append(url_for('static', filename=f'capturas/{name}'))
    return jsonify({
        "images": urls,
        "running": running,
        "stopped": stopped,
        "error": error
    })

@app.route("/start_capture", methods=["POST"])
@login_required
def start_capture():
    # Siempre reinicia para empezar fotos nuevas
    with lock:
        state.update({"images": [], "running": False, "stopped": False, "error": None})
    # borrar capturas previas
    for f in os.listdir(SAVE_DIR):
        if f.lower().endswith(".jpg"):
            try: os.remove(os.path.join(SAVE_DIR, f))
            except: pass
    started = ensure_thread()
    return jsonify({"status": "started" if started else "already_running"})

@app.route("/reset_capture", methods=["POST"])
@login_required
def reset_capture():
    with lock:
        state.update({"images": [], "running": False, "stopped": False, "error": None})
    # borrar capturas previas
    for f in os.listdir(SAVE_DIR):
        if f.lower().endswith(".jpg"):
            try: os.remove(os.path.join(SAVE_DIR, f))
            except: pass
    return jsonify({"status": "reset_done"})

# ----------------- MAIN -----------------
if __name__ == "__main__":
    # Arrancamos limpios (sin empezar a capturar)
    for f in os.listdir(SAVE_DIR):
        if f.lower().endswith(".jpg"):
            try:
                os.remove(os.path.join(SAVE_DIR, f))
            except Exception:
                pass

    with lock:
        state.update({"images": [], "running": False, "stopped": False, "error": None})

    # Inicializa DB y crea usuario demo
    init_db()
    create_user(
        name="Miguel Rodríguez",
        email="miguel@rdt.local",
        role="Operario Senior",
        password="rdt1234"  # ⚠️ cámbialo luego
    )

    # NOTA: ya NO arrancamos el hilo automáticamente.
    app.run(host="127.0.0.1", port=5000, debug=False)

