// ======= Reloj =======
function updateTime() {
  const now = new Date();
  const el = document.getElementById('currentTime');
  if (el) el.textContent = now.toTimeString().slice(0, 8);
}
setInterval(updateTime, 1000); updateTime();

// ======= Operario desde /me =======
async function fillOperator() {
  try {
    const r = await fetch('/me');
    const u = await r.json();
    if (u.auth) {
      const avatar = document.querySelector('.operator-avatar');
      const nameEl = document.querySelector('.operator-name');
      const roleEl = document.querySelector('.operator-role');
      if (avatar && u.name) {
        const ini = u.name.split(' ').map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
        avatar.textContent = ini || 'OP';
      }
      if (nameEl) nameEl.textContent = u.name || 'Operario';
      if (roleEl) roleEl.textContent = u.role || '—';
    }
  } catch (e) { console.warn('no /me', e); }
}

// ======= Grid vacío inicial =======
const grid = document.getElementById('grid');
const scanOverlay = document.getElementById('scanOverlay');

function emptyGrid() {
  const overlay = document.getElementById('scanOverlay');
  grid.textContent = '';
  grid.appendChild(overlay);

  for (let i = 0; i < 5; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    const span = document.createElement('div');
    span.className = 'slot';
    span.textContent = 'Slot ' + String(i + 1).padStart(2, '0');
    cell.appendChild(span);
    grid.appendChild(cell);
  }

  const row2 = document.createElement('div');
  row2.className = 'grid-row-2';
  for (let i = 5; i < 10; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    const span = document.createElement('div');
    span.className = 'slot';
    span.textContent = 'Slot ' + String(i + 1).padStart(2, '0');
    cell.appendChild(span);
    row2.appendChild(cell);
  }
  grid.appendChild(row2);
}
emptyGrid();

// ======= Simulación de posición máquina para el feed =======
const SIM_POS = {
  Y_MM: 180,   // fijo como acordamos
  X0: 0,
  Z0: 0,
  X_STEP: 50,  // mm entre columnas
  Z_STEP: 30   // mm entre filas
};
function simXZForSlot(slotIndex) {
  const col = slotIndex % 5;           // 0..4
  const row = slotIndex < 5 ? 0 : 1;   // 0..1
  return {
    X: SIM_POS.X0 + col * SIM_POS.X_STEP,
    Z: SIM_POS.Z0 + row * SIM_POS.Z_STEP
  };
}

// ======= Lightbox =======
// guardamos boxes actuales para recolocarlos en resize
let _lbBoxes = [];
function openLightbox(itemOrUrl) {
  // aceptar tanto {url, boxes} como string url
  const { url, boxes } = (typeof itemOrUrl === 'string')
    ? { url: itemOrUrl, boxes: [] }
    : { url: itemOrUrl.url, boxes: itemOrUrl.boxes || [] };

  const lb = document.getElementById('lightbox');
  const img = document.getElementById('lightboxImg');
  const overlay = document.getElementById('lightboxOverlay');

  _lbBoxes = boxes || [];
  if (img) img.src = url + '?t=' + Date.now();
  if (overlay) overlay.innerHTML = '';

  const draw = () => layoutLightboxOverlayAndDraw();
  if (img && (img.complete && img.naturalWidth)) {
    draw();
  } else if (img) {
    img.addEventListener('load', draw, { once: true });
  }

  lb.classList.remove('hidden');
}

function closeLightbox(ev) {
  // no cerrar si el click fue sobre la imagen u overlay
  const id = ev && ev.target && ev.target.id;
  if (id === 'lightboxImg' || id === 'lightboxOverlay') return;
  document.getElementById('lightbox').classList.add('hidden');
  const overlay = document.getElementById('lightboxOverlay');
  if (overlay) overlay.innerHTML = '';
  _lbBoxes = [];
}

// ======= Helpers de overlay de BBoxes (grid/thumb) =======
function getOrCreateBBoxLayerForImg(cell, img) {
  const cellRect = cell.getBoundingClientRect();
  const cw = cellRect.width;
  const ch = cellRect.height;

  const iw = img.naturalWidth || 1;
  const ih = img.naturalHeight || 1;

  const scale = Math.min(cw / iw, ch / ih);
  const dispW = iw * scale;
  const dispH = ih * scale;

  const offsetX = (cw - dispW) / 2;
  const offsetY = (ch - dispH) / 2;

  let layer = cell.querySelector('.bbox-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'bbox-layer';
    cell.appendChild(layer);
  }
  layer.style.left = offsetX + 'px';
  layer.style.top = offsetY + 'px';
  layer.style.width = dispW + 'px';
  layer.style.height = dispH + 'px';
  layer.innerHTML = ''; // limpiar

  return { layer, left: offsetX, top: offsetY, width: dispW, height: dispH };
}

function drawBoxesOnLayer(layer, boxes, paletteByClass = {}) {
  for (const b of boxes) {
    const color = paletteByClass[b.cls] || 'var(--accent)';
    const box = document.createElement('div');
    box.className = 'bbox';
    box.style.borderColor = color;
    const label = document.createElement('div');
    label.className = 'bbox-label';
    label.style.background = color;
    label.textContent = (typeof b.cls === 'number' ? `C${b.cls}` : '');
    box.appendChild(label);
    layer.appendChild(box);
    // …posicionamiento igual que ahora…
  }
}



function drawBoxesForCellWhenReady(cell, img, boxes) {
  const draw = () => {
    const frame = getOrCreateBBoxLayerForImg(cell, img);
    drawBoxesOnLayer(frame.layer, boxes);
  };
  if (img.complete && img.naturalWidth) {
    draw();
  } else {
    img.addEventListener('load', draw, { once: true });
  }
}

let _palette = {};
fetch('/annotate/classes_meta').then(r=>r.json()).then(j=>{
  j.classes?.forEach((c,idx)=>{ _palette[idx]=c.color; });
});

// ======= Helpers de overlay para Lightbox =======
function _computeContainRect(containerEl, imgEl) {
  const cw = containerEl.clientWidth;
  const ch = containerEl.clientHeight;
  const iw = imgEl.naturalWidth || 1;
  const ih = imgEl.naturalHeight || 1;
  const scale = Math.min(cw / iw, ch / ih);
  const dispW = iw * scale;
  const dispH = ih * scale;
  const offsetX = (cw - dispW) / 2;
  const offsetY = (ch - dispH) / 2;
  return { left: offsetX, top: offsetY, width: dispW, height: dispH };
}

function layoutLightboxOverlayAndDraw() {
  const inner = document.getElementById('lightboxInner');
  const img = document.getElementById('lightboxImg');
  const overlay = document.getElementById('lightboxOverlay');
  if (!inner || !img || !overlay) return;
  if (!img.naturalWidth) return;

  const rect = _computeContainRect(inner, img);
  overlay.style.left = rect.left + 'px';
  overlay.style.top = rect.top + 'px';
  overlay.style.width = rect.width + 'px';
  overlay.style.height = rect.height + 'px';

  overlay.innerHTML = '';
  drawBoxesOnLayer(overlay, _lbBoxes);
}

window.addEventListener('resize', () => {
  const lb = document.getElementById('lightbox');
  if (lb && !lb.classList.contains('hidden')) {
    layoutLightboxOverlayAndDraw();
  }
});

// ======= Biblioteca (thumbnails) =======
function renderLibrary(dataOrUrls) {
  const thumbs = document.getElementById('thumbs');
  thumbs.innerHTML = '';

  // Admitimos [{url, boxes}] o [url]
  const items = (dataOrUrls && dataOrUrls.length && typeof dataOrUrls[0] === 'object')
    ? dataOrUrls
    : (dataOrUrls || []).map(u => ({ url: u, boxes: [] }));

  for (const it of items) {
    const wrap = document.createElement('div');
    wrap.className = 'thumb-wrap';

    const img = document.createElement('img');
    img.className = 'thumb';
    img.src = it.url + '?t=' + Date.now();
    img.alt = 'Captura';

    img.addEventListener('click', () => openLightbox(it));
    wrap.appendChild(img);
    thumbs.appendChild(wrap);

    // Overlay de bboxes en thumb
    drawBoxesForCellWhenReady(wrap, img, it.boxes || []);
  }
}

async function fetchLibraryByLayer(layer) {
  const params = new URLSearchParams();
  if (layer && Number(layer) > 0) params.set('layer', String(layer));
  params.set('limit', '200');
  const res = await fetch('/library?' + params.toString());
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json(); // {images: [...], items:[{url,boxes}], layer}
}

async function loadLibraryForSelectedLayer() {
  const sel = document.getElementById('layerFilter');
  const chosen = sel ? parseInt(sel.value || '0', 10) : 0;
  try {
    const data = await fetchLibraryByLayer(chosen);
    if (data.items && data.items.length) {
      renderLibrary(data.items);
    } else {
      renderLibrary(data.images || []);
    }
    const info = document.getElementById('layerCountInfo');
    if (info) info.textContent = `Mostrando ${data.items?.length ?? data.images?.length ?? 0} imágenes ${chosen > 0 ? ('de capa ' + chosen) : 'de todas las capas'}.`;
  } catch (e) {
    console.warn('library error', e);
    renderLibrary([]);
  }
}

// ======= Marcador de centro + coordenadas simuladas =======
function addCenterMarkerForCell(cell, img, labelText) {
  // Usamos el mismo layer de bboxes (calculado con contain)
  const frame = getOrCreateBBoxLayerForImg(cell, img);
  const layer = frame.layer;

  // Punto central del área visible
  const marker = document.createElement('div');
  marker.className = 'center-marker';
  marker.style.left = '50%';
  marker.style.top = '50%';
  marker.style.transform = 'translate(-50%, -50%)';
  layer.appendChild(marker);

  if (labelText) {
    const lab = document.createElement('div');
    lab.className = 'center-label';
    lab.textContent = labelText;
    lab.style.left = '50%';
    lab.style.top = 'calc(50% - 16px)';
    lab.style.transform = 'translate(-50%, -100%)';
    layer.appendChild(lab);
  }
}

function updateSidebarCoords(x, y, z) {
  const xEl = document.getElementById('posX');
  const yEl = document.getElementById('posY');
  const zEl = document.getElementById('posZ');
  if (xEl) xEl.textContent = (typeof x === 'number') ? x.toFixed(1) : String(x);
  if (yEl) yEl.textContent = (typeof y === 'number') ? y.toFixed(1) : String(y);
  if (zEl) zEl.textContent = (typeof z === 'number') ? z.toFixed(1) : String(z);
}

// ======= Overlay helpers (scan activo) =======
function getCellAt(index) {
  const cells = grid.querySelectorAll('.cell');
  return cells[index] || null;
}

function moveScanOverlayToCell(index) {
  const cell = getCellAt(index);
  if (!cell) { hideScanOverlay(); return; }

  const refRect = grid.getBoundingClientRect();
  const cellRect = cell.getBoundingClientRect();

  const w = cellRect.width;
  const h = cellRect.height;
  const dx = cellRect.left - refRect.left;
  const dy = cellRect.top - refRect.top;

  scanOverlay.style.width = w + 'px';
  scanOverlay.style.height = h + 'px';
  scanOverlay.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
  scanOverlay.classList.remove('hidden');
}

function hideScanOverlay() {
  scanOverlay.classList.add('hidden');
}

// ======= Polling =======
let poller = null;
let lastActiveIndex = -1;

async function fetchState() {
  try {
    const res = await fetch('/state');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    const items = (data.items && data.items.length)
      ? data.items
      : (data.images || []).map(u => ({ url: u, boxes: [] }));

    const cells = Array.from(grid.querySelectorAll('.cell'));
    for (let i = 0; i < 10; i++) {
      const cell = cells[i];
      cell.innerHTML = '';
      if (i < items.length) {
        const img = document.createElement('img');
        img.src = items[i].url + '?t=' + Date.now();
        img.alt = 'Captura ' + (i + 1);
        cell.appendChild(img);

        // BBoxes alineados con contain
        drawBoxesForCellWhenReady(cell, img, items[i].boxes || []);

        // === Marcador de centro + etiqueta con X/Y/Z simulados ===
        const sim = simXZForSlot(i);
        const label = `X ${sim.X.toFixed(1)} mm | Y ${SIM_POS.Y_MM.toFixed(0)} mm | Z ${sim.Z.toFixed(1)} mm`;
        const drawCenter = () => addCenterMarkerForCell(cell, img, label);
        if (img.complete && img.naturalWidth) {
          drawCenter();
        } else {
          img.addEventListener('load', drawCenter, { once: true });
        }
      } else {
        const span = document.createElement('div');
        span.className = 'slot';
        span.textContent = 'Slot ' + String(i + 1).padStart(2, '0');
        cell.appendChild(span);
      }
    }

    // Índice activo (última imagen si está corriendo)
    let activeIndex = (data.running && items.length > 0)
      ? Math.min(items.length - 1, 9)
      : -1;

    if (activeIndex !== -1) {
      moveScanOverlayToCell(activeIndex);

      // Actualiza panel lateral con la última posición activa
      const sim = simXZForSlot(activeIndex);
      updateSidebarCoords(sim.X, SIM_POS.Y_MM, sim.Z);

      lastActiveIndex = activeIndex;
    } else {
      hideScanOverlay();
      lastActiveIndex = -1;
    }

    if (data.stopped) { stopPolling(); }
  } catch (e) {
    console.warn('Error fetch /state', e);
    stopPolling();
    hideScanOverlay();
    lastActiveIndex = -1;
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

function clearGrid() {
  const cells = grid.querySelectorAll('.cell');
  cells.forEach((cell, i) => {
    cell.innerHTML = '';
    const span = document.createElement('div');
    span.className = 'slot';
    span.textContent = 'Slot ' + String(i + 1).padStart(2, '0');
    cell.appendChild(span);
  });
  renderLibrary([]);
  hideScanOverlay();
  lastActiveIndex = -1;
}

// ======= Capas =======
function populateLayerFilter(total) {
  const sel = document.getElementById('layerFilter');
  if (!sel) return;
  sel.innerHTML = '';

  const optAll = document.createElement('option');
  optAll.value = '0';                 // <-- antes '1'
  optAll.textContent = 'Todas';
  sel.appendChild(optAll);

  for (let i = 1; i <= total; i++) {
    const op = document.createElement('option');
    op.value = String(i);
    op.textContent = 'Capa ' + i;
    sel.appendChild(op);
  }

  const lcEl = document.getElementById('layerCurrent');
  const current = lcEl ? parseInt(lcEl.textContent || '0', 10) : 0;
  if (current > 0 && current <= total) sel.value = String(current);
  else sel.value = '0'; // por defecto, Todas
}

async function refreshLayersOnce() {
  try {
    const r = await fetch('/layers');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const lc = document.getElementById('layerCurrent');
    const lt = document.getElementById('layerTotal');
    if (lc) lc.textContent = j.current ?? 0;
    if (lt) lt.textContent = j.total ?? 0;
    populateLayerFilter(j.total ?? 0);
  } catch (e) { console.warn('layers', e); }
}

// ======= Botones =======
async function startCapture() {
  const startBtn = document.getElementById('startBtn');
  const resetBtn = document.getElementById('resetBtn');
  if (startBtn) { startBtn.disabled = true; startBtn.textContent = 'Iniciando...'; }

  try {
    const res = await fetch('/start_capture', { method: 'POST' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    if (data.layer_current !== undefined) {
      const lc = document.getElementById('layerCurrent');
      if (lc) lc.textContent = data.layer_current;
    }
    if (data.layer_total !== undefined) {
      const lt = document.getElementById('layerTotal');
      if (lt) lt.textContent = data.layer_total;
    }

    if (data.status === 'started' || data.status === 'already_running') {
      if (startBtn) { startBtn.textContent = 'Arrancar Captura'; }
      await bootPollingIfNeeded();
      await loadLibraryForSelectedLayer(); 
      startSheetWatcher();  // arranca vigilancia de hoja
      // refresca biblioteca por capa
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
  if (resetBtn) { resetBtn.disabled = true; resetBtn.textContent = 'Limpiando...'; }

  try {
    const res = await fetch('/reset_capture', { method: 'POST' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    if (data.status === 'reset_done') {
      stopPolling();
      stopSheetWatcher(); 
      clearGrid();
      
      await loadLibraryForSelectedLayer();      
      if (sheetFinal) sheetFinal.classList.add('hidden');
      if (sheetCanvas) sheetCanvas.classList.remove('hidden');
      if (sheetStatus) sheetStatus.textContent = 'Lámina: en espera';
      if (startBtn) { startBtn.disabled = false; startBtn.textContent = 'Arrancar Captura'; }
      if (resetBtn) { resetBtn.textContent = 'Reset'; }
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

async function resetLayers() {
  try {
    const res = await fetch('/reset_layers', { method: 'POST' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    if (j.status === 'layers_reset') {
      const lc = document.getElementById('layerCurrent');
      const lt = document.getElementById('layerTotal');
      if (lc) lc.textContent = j.current ?? 0;
      if (lt) lt.textContent = j.total ?? 0;

      populateLayerFilter(j.total ?? 0);
      await loadLibraryForSelectedLayer();
    }
  } catch (e) {
    console.warn('reset_layers', e);
  }
}

async function deleteSelectedLayer() {
  const sel = document.getElementById('layerFilter');
  const delBtn = document.getElementById('deleteLayerBtn');
  const deleteFilesChk = document.getElementById('deleteFilesChk');
  const layer = sel ? parseInt(sel.value || '0', 10) : 0;

  const alsoFiles = !!(deleteFilesChk && deleteFilesChk.checked);
  const scopeText = (layer === 0) ? 'TODAS las capas' : `la capa ${layer}`;
  const sure = confirm(`¿Borrar ${scopeText}${alsoFiles ? ' y sus archivos' : ''}? Esta acción no se puede deshacer.`);
  if (!sure) return;

  if (delBtn) { delBtn.disabled = true; delBtn.textContent = '⏳ Borrando...'; }
  try {
    const res = await fetch('/library/delete_layer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layer, delete_files: alsoFiles })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    if (j.status === 'ok') {
      await loadLibraryForSelectedLayer();
      alert(`${scopeText} borrada(s). Registros eliminados: ${j.deleted_db}${alsoFiles ? ` | archivos: ${j.deleted_files}` : ''}.`);
    } else {
      alert('No se pudo borrar.');
    }
  } catch (e) {
    console.error('deleteSelectedLayer error', e);
    alert('Error al borrar.');
  } finally {
    if (delBtn) { delBtn.disabled = false; delBtn.textContent = '🗑️ Borrar capa'; }
  }
}


// ======= Enganchar listeners =======
document.addEventListener('DOMContentLoaded', () => {
  fillOperator();
  refreshLayersOnce().then(loadLibraryForSelectedLayer);  // carga biblioteca al inicio

  const startBtn = document.getElementById('startBtn');
  const resetBtn = document.getElementById('resetBtn');
  const resetLayersBtn = document.getElementById('resetLayersBtn');
  const layerFilter = document.getElementById('layerFilter');
  const refreshLibraryBtn = document.getElementById('refreshLibraryBtn');

  if (startBtn) startBtn.addEventListener('click', startCapture);
  if (resetBtn) resetBtn.addEventListener('click', resetCapture);
  if (resetLayersBtn) resetLayersBtn.addEventListener('click', resetLayers);

  if (layerFilter) layerFilter.addEventListener('change', loadLibraryForSelectedLayer);
  if (refreshLibraryBtn) refreshLibraryBtn.addEventListener('click', loadLibraryForSelectedLayer);

  const deleteLayerBtn = document.getElementById('deleteLayerBtn');
  if (deleteLayerBtn) deleteLayerBtn.addEventListener('click', deleteSelectedLayer);
});

// ====== PESTAÑA ENTRENAMIENTO ======
const tabTrainingBtn = document.getElementById('tabTrainingBtn');
const trainingPane = document.getElementById('trainingPane');

// referencias UI entrenamiento
const splitSelect = document.getElementById('splitSelect');
const imageSelect = document.getElementById('imageSelect');
const loadImageBtn = document.getElementById('loadImageBtn');
const classInput = document.getElementById('classInput');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const resetViewBtn = document.getElementById('resetViewBtn');
const undoBoxBtn = document.getElementById('undoBoxBtn');
const clearBoxesBtn = document.getElementById('clearBoxesBtn');
const saveAnnBtn = document.getElementById('saveAnnBtn');
const hud = document.getElementById('hud');

const tCanvas = document.getElementById('trainCanvas');
const tCtx = tCanvas.getContext('2d');

let tImg = new Image();
let tLoaded = false;
let tScale = 1, tOffX = 0, tOffY = 0;
let tBoxes = [];
let tDrawing = false;
let tStartX = 0, tStartY = 0;
let tPrevW = 0, tPrevH = 0;
let tMouseX = 0, tMouseY = 0;
let currentSplit = 'train';
let currentImage = null;

// abrir/cerrar panel
if (tabTrainingBtn) {
  tabTrainingBtn.addEventListener('click', async () => {
    trainingPane.classList.toggle('hidden');
    if (!trainingPane.classList.contains('hidden')) {
      await loadImageList(); // carga lista al abrir
    }
  });
}

async function loadImageList() {
  currentSplit = splitSelect.value || 'train';
  const resp = await fetch(`/annotate/images?split=${encodeURIComponent(currentSplit)}`);
  const data = await resp.json();
  imageSelect.innerHTML = '';
  (data.images || []).forEach(name => {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    imageSelect.appendChild(opt);
  });
  hud.textContent = `(${currentSplit}) ${data.images?.length || 0} imágenes`;
}

splitSelect?.addEventListener('change', loadImageList);

loadImageBtn?.addEventListener('click', () => {
  const name = imageSelect.value;
  if (!name) return;
  currentImage = name;
  tImg = new Image();
  tImg.src = `/static/dataset/${currentSplit}/images/${name}`;
  tImg.onload = () => {
    tLoaded = true;
    fitToCanvas();
    tBoxes = [];
    redrawTrain();
  };
});

// fit inicial
function fitToCanvas() {
  const iw = tImg.width, ih = tImg.height;
  const cw = tCanvas.width, ch = tCanvas.height;
  tScale = Math.min(cw/iw, ch/ih);
  tOffX = (cw - iw * tScale) / 2;
  tOffY = (ch - ih * tScale) / 2;
}

function screenToImage(px, py) {
  return {
    ix: (px - tOffX) / tScale,
    iy: (py - tOffY) / tScale
  };
}

function drawCrosshair(x, y) {
  tCtx.strokeStyle = 'lime';
  tCtx.lineWidth = 1;
  tCtx.beginPath();
  tCtx.moveTo(x - 10, y); tCtx.lineTo(x + 10, y);
  tCtx.moveTo(x, y - 10); tCtx.lineTo(x, y + 10);
  tCtx.stroke();
}

function redrawTrain() {
  tCtx.clearRect(0,0,tCanvas.width,tCanvas.height);
  if (!tLoaded) return;

  tCtx.save();
  tCtx.translate(tOffX, tOffY);
  tCtx.scale(tScale, tScale);
  tCtx.drawImage(tImg, 0, 0);

  // cajas
  tCtx.lineWidth = 2 / tScale;
  tBoxes.forEach(b => {
    tCtx.strokeStyle = 'red';
    tCtx.strokeRect(b.x, b.y, b.w, b.h);
  });

  if (tDrawing) {
    tCtx.strokeStyle = 'lime';
    tCtx.strokeRect(tStartX, tStartY, tPrevW, tPrevH);
  }

  tCtx.restore();

  drawCrosshair(tMouseX, tMouseY);

  // HUD
  hud.textContent = currentImage
    ? `img: ${currentImage} | zoom ${(tScale*100).toFixed(0)}% | cajas ${tBoxes.length}`
    : `(${currentSplit}) listo`;
}

// eventos canvas
tCanvas.addEventListener('mousemove', (e) => {
  const r = tCanvas.getBoundingClientRect();
  tMouseX = e.clientX - r.left; tMouseY = e.clientY - r.top;

  if (tDrawing) {
    const {ix, iy} = screenToImage(tMouseX, tMouseY);
    tPrevW = ix - tStartX; tPrevH = iy - tStartY;
  }
  redrawTrain();
});

tCanvas.addEventListener('mousedown', (e) => {
  if (!tLoaded) return;
  const r = tCanvas.getBoundingClientRect();
  const sx = e.clientX - r.left;
  const sy = e.clientY - r.top;
  const {ix, iy} = screenToImage(sx, sy);
  tDrawing = true;
  tStartX = ix; tStartY = iy;
  tPrevW = 0; tPrevH = 0;
});

tCanvas.addEventListener('mouseup', () => {
  if (!tDrawing) return;
  tDrawing = false;

  const w = tPrevW, h = tPrevH;
  const box = {
    x: w >= 0 ? tStartX : tStartX + w,
    y: h >= 0 ? tStartY : tStartY + h,
    w: Math.abs(w),
    h: Math.abs(h)
  };
  if (box.w > 2 && box.h > 2) tBoxes.push(box);
  tPrevW = tPrevH = 0;
  redrawTrain();
});

// zoom
function zoomAt(factor, cx, cy) {
  const before = screenToImage(cx, cy);
  tScale *= factor;
  const after = screenToImage(cx, cy);
  tOffX += (after.ix - before.ix) * tScale;
  tOffY += (after.iy - before.iy) * tScale;
  redrawTrain();
}
zoomInBtn?.addEventListener('click', () => zoomAt(1.1, tCanvas.width/2, tCanvas.height/2));
zoomOutBtn?.addEventListener('click', () => zoomAt(1/1.1, tCanvas.width/2, tCanvas.height/2));
resetViewBtn?.addEventListener('click', () => { if (tLoaded) { fitToCanvas(); redrawTrain(); } });

// rueda
tCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 1/1.1;
  zoomAt(factor, tMouseX, tMouseY);
}, {passive:false});

// edición
undoBoxBtn?.addEventListener('click', () => { tBoxes.pop(); redrawTrain(); });
clearBoxesBtn?.addEventListener('click', () => { tBoxes = []; redrawTrain(); });

// guardar
saveAnnBtn?.addEventListener('click', async () => {
  const label = (classInput?.value || '').trim();
  if (!tLoaded || !currentImage) { alert("Carga una imagen."); return; }
  if (!label) { alert("Escribe la clase (de classes.txt)."); return; }

  const payload = {
    split: currentSplit,
    image: currentImage,
    label: label,
    boxes: tBoxes
  };
  const resp = await fetch('/annotate/save', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });
  const data = await resp.json();
  if (resp.ok) {
    alert(`Etiquetas guardadas: ${data.saved}`);
  } else {
    alert(`Error: ${data.error || 'fallo al guardar'}`);
  }
});

// ==============================
// Lámina en directo (front-only)
// ==============================
const SHEET_COLS = 5;
const SHEET_ROWS = 2;
const TILE_W     = 320; // mantener igual que servidor (ImageOps.fit 320x240)
const TILE_H     = 240;

const sheetCanvas = document.getElementById('layerSheetCanvas');
const sheetCtx    = sheetCanvas?.getContext('2d');
const sheetFinal  = document.getElementById('layerSheetFinal');
const sheetStatus = document.getElementById('layerSheetStatus');

let sheetLayerId  = 0;
let sheetTimer    = null;
let sheetWatching = false;
let lastWatchedLayer = 0;

function startSheetWatcher() {
  if (sheetTimer) return;
  sheetTimer = setInterval(tickLayerSheet, 1000);
  sheetWatching = true;
  // primer tick inmediato
  tickLayerSheet();
}

function stopSheetWatcher() {
  if (sheetTimer) {
    clearInterval(sheetTimer);
    sheetTimer = null;
  }
  sheetWatching = false;
}


// Ajusta tamaño lógico del canvas al layout (mantener múltiplos de TILE)
function resizeSheetCanvas() {
  if (!sheetCanvas) return;
  // ancho visual del contenedor
  const wrap = sheetCanvas.parentElement;
  const viewW = wrap ? wrap.clientWidth : 1600;
  // mantener aspecto (cols*tile_w : rows*tile_h)
  const targetW = Math.min(1600, Math.max(800, viewW)); // límites razonables
  const targetH = Math.round(targetW * (SHEET_ROWS*TILE_H) / (SHEET_COLS*TILE_W));

  sheetCanvas.width  = SHEET_COLS * TILE_W;
  sheetCanvas.height = SHEET_ROWS * TILE_H;
  // usamos CSS para escalar suavemente
  sheetCanvas.style.width  = `${targetW}px`;
  sheetCanvas.style.height = `${targetH}px`;
}

// Dibuja una imagen "cover" dentro del tile (sin bandas)
function drawCover(ctx, img, dx, dy, tw, th) {
  const iw = img.naturalWidth  || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;

  const scale = Math.max(tw / iw, th / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const sx = Math.floor((dw - tw) / 2);
  const sy = Math.floor((dh - th) / 2);

  // Para evitar artefactos, dibujamos en offscreen si es necesario, pero aquí basta:
  // drawImage(img, sx/scale, sy/scale, tw/scale, th/scale, dx, dy, tw, th)
  ctx.drawImage(
    img,
    sx / scale, sy / scale,
    tw / scale, th / scale,
    dx, dy, tw, th
  );
}

// Construye la URL de la imagen del grid (ya vienen completas en /state, pero por si acaso)
function toAbsUrl(u){ return u; }

// Renderiza N imágenes del grid al canvas (en directo)
async function drawLiveSheet(imagesAbs) {
  if (!sheetCtx || !sheetCanvas) return;
  sheetCtx.fillStyle = '#000';
  sheetCtx.fillRect(0, 0, sheetCanvas.width, sheetCanvas.height);

  const maxTiles = SHEET_COLS * SHEET_ROWS;
  const list = imagesAbs.slice(0, maxTiles);

  // Cargamos todas en paralelo
  const imgs = await Promise.all(list.map(src => new Promise(res => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = toAbsUrl(src);
  })));

  // Pintamos en cuadrícula COVER
  let idx = 0;
  for (const im of imgs) {
    const r = Math.floor(idx / SHEET_COLS);
    const c = idx % SHEET_COLS;
    const dx = c * TILE_W;
    const dy = r * TILE_H;

    if (im) drawCover(sheetCtx, im, dx, dy, TILE_W, TILE_H);
    else {
      // celda vacía
      sheetCtx.fillStyle = '#111';
      sheetCtx.fillRect(dx, dy, TILE_W, TILE_H);
    }
    idx++;
  }

  // HUD sutil
  if (sheetStatus) {
    sheetStatus.textContent = `Lámina en directo — capa ${sheetLayerId} · slots ${list.length}/${SHEET_COLS*SHEET_ROWS}`;
  }
}

// Comprueba si ya existe la lámina final del servidor para la capa actual
async function checkFinalSheet(layerId) {
  const url = `/static/imagen_capa/layer_${layerId}/layer_${layerId}.jpg?cb=${Date.now()}`;
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    return r.ok ? url : null;
  } catch {
    return null;
  }
}

// Bucle de actualización: lee /layers, /state y decide qué mostrar
async function tickLayerSheet() {
  if (!sheetWatching) return;
  try {
    // 1) Capa actual
    const lr = await fetch('/layers', { cache: 'no-store' });
    const ldata = await lr.json();
    sheetLayerId = ldata.current || 0;

    // 2) ¿Existe lámina final?
    const finalUrl = await checkFinalSheet(sheetLayerId);

    if (finalUrl) {
    // Mostrar imagen final y ocultar canvas live
    if (sheetFinal) {
      // Evita volver a recargar la misma imagen si ya la estamos mostrando
      const cleanSrc = sheetFinal.src.split('?')[0];
      if (!cleanSrc.endsWith(`/layer_${sheetLayerId}.jpg`)) {
        sheetFinal.src = finalUrl;
      }
      sheetFinal.classList.remove('hidden');
    }
    if (sheetCanvas) sheetCanvas.classList.add('hidden');
    if (sheetStatus) sheetStatus.textContent = `Lámina final generada — capa ${sheetLayerId}`;

    // ⚠️ Paramos watcher: ya no tiene sentido seguir pidiendo /layers + HEAD/GET
    stopSheetWatcher();
    lastWatchedLayer = sheetLayerId;
    return;
}


    // 3) No existe final: pintar live desde el grid actual (/state.images)
    const sr = await fetch('/state', { cache: 'no-store' });
    const sdata = await sr.json();
    const images = Array.isArray(sdata.images) ? sdata.images : [];

    if (sheetFinal) sheetFinal.classList.add('hidden');
    if (sheetCanvas) sheetCanvas.classList.remove('hidden');

        await drawLiveSheet(images);

  } catch (e) {
    console.warn('tickLayerSheet error:', e);
    if (sheetStatus) sheetStatus.textContent = 'Lámina: error al actualizar';
  }
}

// Init
window.addEventListener('DOMContentLoaded', () => {
  resizeSheetCanvas();
  window.addEventListener('resize', resizeSheetCanvas);
  // refresco suave: 1s. Puedes subir/bajar.
  // sheetTimer = setInterval(tickLayerSheet, 1000);
  // tickLayerSheet();
  stopSheetWatcher();
});
const deleteSheetBtn = document.getElementById('deleteSheetBtn');
deleteSheetBtn?.addEventListener('click', async () => {
  if (!sheetLayerId) { alert("No hay capa activa."); return; }
  if (!confirm(`¿Borrar lámina e imágenes de capa_${sheetLayerId}?`)) return;

  try {
    const resp = await fetch('/imagen_capa/delete_layer', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ layer: sheetLayerId })
    });
    const data = await resp.json();
    if (resp.ok) {
      alert(`Lámina de capa ${sheetLayerId} borrada (${data.deleted_files} ficheros).`);
      // Reset visual
      if (sheetFinal) sheetFinal.classList.add('hidden');
      if (sheetCanvas) {
        sheetCtx.clearRect(0,0,sheetCanvas.width,sheetCanvas.height);
        sheetCanvas.classList.remove('hidden');
      }
      if (sheetStatus) sheetStatus.textContent = "Lámina borrada.";
    } else {
      alert("Error: " + (data.error || "fallo en borrado"));
    }
  } catch (e) {
    console.error(e);
    alert("Error de red al borrar lámina.");
  }
});
