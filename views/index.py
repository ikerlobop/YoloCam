def front():

 return r"""
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
    .action-buttons{display:flex;gap:10px;margin-left:12px}
    .btn-small{padding:8px 12px;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-size:12px;transition:.2s;display:flex;align-items:center;gap:6px}
    .btn-small:hover{transform:translateY(-1px)}
    .btn-small:disabled{opacity:.6;cursor:not-allowed}
    .btn-small.success{background:linear-gradient(135deg,#00ff41,#00cc34);color:#000}
    .btn-small.warn{background:linear-gradient(135deg,#ffd166,#ffb703);color:#000}
  </style>
</head>
<body>
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
  function updateTime(){
    const now=new Date();
    document.getElementById('currentTime').textContent=now.toTimeString().slice(0,8);
  }
  setInterval(updateTime,1000); updateTime();

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

  const grid = document.getElementById('grid');
  function emptyGrid(){
    grid.innerHTML='';
    for(let i=0;i<5;i++){
      const cell=document.createElement('div');
      cell.className='cell';
      const span=document.createElement('div');
      span.className='slot';
      span.textContent='Slot '+String(i+1).padStart(2,'0');
      cell.appendChild(span);
      grid.appendChild(cell);
    }
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
      await fetchState();
      poller = setInterval(fetchState, 1000);
    }
  }

  function stopPolling() {
    if (poller) { clearInterval(poller); poller = null; }
  }

  function clearGrid() { emptyGrid(); }

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
        stopPolling();
        clearGrid();
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
</script>

</body>
</html>
"""
