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

/**
 * Crea (si no existe) y devuelve un contenedor overlay relativo al área real que ocupa la imagen
 * dentro del cell/thumbnail cuando object-fit=contain.
 * Devuelve {layer, left, top, width, height} en px relativo al cell.
 */
function getOrCreateBBoxLayerForImg(cell, img) {
  // Medidas del contenedor (cell) y naturales de la imagen
  const cellRect = cell.getBoundingClientRect();
  const cw = cellRect.width;
  const ch = cellRect.height;

  const iw = img.naturalWidth || 1;
  const ih = img.naturalHeight || 1;

  // Escala tipo contain
  const scale = Math.min(cw / iw, ch / ih);
  const dispW = iw * scale;
  const dispH = ih * scale;

  const offsetX = (cw - dispW) / 2;
  const offsetY = (ch - dispH) / 2;

  // layer
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

  // limpia cajas previas
  layer.innerHTML = '';

  return { layer, left: offsetX, top: offsetY, width: dispW, height: dispH };
}

/**
 * Dibuja cajas normalizadas YOLO sobre el layer.
 * boxes: [{cls, xc, yc, w, h}]
 */
function drawBoxesOnLayer(layer, boxes) {
  if (!boxes || !boxes.length) return;
  for (const b of boxes) {
    const xc = b.xc ?? 0.5;
    const yc = b.yc ?? 0.5;
    const w  = b.w  ?? 0.0;
    const h  = b.h  ?? 0.0;

    const left = (xc - w/2) * 100;
    const top  = (yc - h/2) * 100;
    const box = document.createElement('div');
    box.className = 'bbox';
    box.style.left = left + '%';
    box.style.top = top + '%';
    box.style.width = (w * 100) + '%';
    box.style.height = (h * 100) + '%';

    // etiqueta
    const label = document.createElement('div');
    label.className = 'bbox-label';
    label.textContent = (typeof b.cls === 'number' ? `C${b.cls}` : '');
    box.appendChild(label);

    layer.appendChild(box);
  }
}

// Para casos en que la imagen aún no está cargada
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

// recomponer overlay al redimensionar ventana
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
    img.addEventListener('click', () => openLightbox(it));  // <-- pasa también boxes
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
    // Preferimos items (con cajas). Si no, caemos a images.
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

    // Compat: construimos items si no vienen
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
      } else {
        const span = document.createElement('div');
        span.className = 'slot';
        span.textContent = 'Slot ' + String(i + 1).padStart(2, '0');
        cell.appendChild(span);
      }
    }

    let activeIndex = (data.running && items.length > 0)
      ? Math.min(items.length - 1, 9)
      : -1;

    if (activeIndex !== -1) {
      if (activeIndex !== lastActiveIndex) {
        moveScanOverlayToCell(activeIndex);
        lastActiveIndex = activeIndex;
      } else {
        moveScanOverlayToCell(activeIndex);
      }
    } else {
      hideScanOverlay();
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
  optAll.value = '0';
  optAll.textContent = 'Todas';
  sel.appendChild(optAll);
  for (let i = 1; i <= total; i++) {
    const op = document.createElement('option');
    op.value = String(i);
    op.textContent = 'Capa ' + i;
    sel.appendChild(op);
  }
  // Selecciona por defecto la capa actual si existe en el DOM
  const lcEl = document.getElementById('layerCurrent');
  const current = lcEl ? parseInt(lcEl.textContent || '0', 10) : 0;
  if (current > 0 && current <= total) sel.value = String(current);
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
  if (startBtn) { startBtn.disabled = true; startBtn.textContent = '⏳ Iniciando...'; }

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
      if (startBtn) { startBtn.textContent = '✅ Captura en marcha'; }
      await bootPollingIfNeeded();
      await loadLibraryForSelectedLayer();   // refresca biblioteca por capa
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
      await loadLibraryForSelectedLayer();   // refresca biblioteca tras limpiar
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

      // Reposiciona selector y refresca biblioteca
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

  if (!layer || layer <= 0) {
    alert('Selecciona una capa concreta (no "Todas").');
    return;
  }
  const alsoFiles = !!(deleteFilesChk && deleteFilesChk.checked);
  const sure = confirm(`¿Borrar TODAS las capturas de la capa ${layer}${alsoFiles ? ' y sus archivos' : ''}? Esta acción no se puede deshacer.`);
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
      // refrescar biblioteca y (opcional) resumen de capas si lo usas
      await loadLibraryForSelectedLayer();
      alert(`Capa ${layer} borrada. Registros eliminados: ${j.deleted_db}${alsoFiles ? ` | archivos: ${j.deleted_files}` : ''}.`);
    } else {
      alert('No se pudo borrar la capa.');
    }
  } catch (e) {
    console.error('deleteSelectedLayer error', e);
    alert('Error al borrar la capa.');
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
