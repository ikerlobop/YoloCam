// =======================================================
// 1) REFS UI
// =======================================================
const splitSelect   = document.getElementById('splitSelect');
const loadImageBtn  = document.getElementById('loadImageBtn');
const classSelect   = document.getElementById('classSelect');
const zoomInBtn     = document.getElementById('zoomInBtn');
const zoomOutBtn    = document.getElementById('zoomOutBtn');
const resetViewBtn  = document.getElementById('resetViewBtn');
const undoBoxBtn    = document.getElementById('undoBoxBtn');
const clearBoxesBtn = document.getElementById('clearBoxesBtn');
const saveAnnBtn    = document.getElementById('saveAnnBtn');
const hud           = document.getElementById('hud');

const fileInput  = document.getElementById('fileInput');
const uploadBtn  = document.getElementById('uploadBtn');
const uploadInfo = document.getElementById('uploadInfo');

const tCanvas = document.getElementById('trainCanvas');
const tCtx    = tCanvas.getContext('2d');

// Filmstrip
const stripPrev   = document.getElementById('stripPrev');
const stripNext   = document.getElementById('stripNext');
const stripTrack  = document.getElementById('stripTrack');
const stripScroll = document.getElementById('stripScroll');

// Lightbox
const imgFull     = document.getElementById('imgFull');
const imgLightbox = document.getElementById('imgLightbox');

// Desactivar menú contextual para permitir pan con botón derecho
tCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

// =======================================================
// 2) ESTADO
// =======================================================
let tImg     = new Image();
let tLoaded  = false;
let tScale   = 1, tOffX = 0, tOffY = 0;
let tBoxes   = [];
let tDrawing = false;
let tStartX  = 0, tStartY = 0;
let tPrevW   = 0, tPrevH = 0;
let tMouseX  = 0, tMouseY  = 0;

let currentSplit  = 'train';
let currentImage  = null;

let imageListCache = []; // nombres archivo del split
let currentIndex   = -1; // índice activo en imageListCache

// Estado de arrastre para filmstrip
let fsDragging = false;
let fsStartX = 0;
let fsScrollLeft = 0;

// Estado de pan (arrastre de la imagen al hacer zoom)
let panning = false;
let panStart = { x:0, y:0 };
let panOffStart = { x:0, y:0 };

let DPR = 1;


// =======================================================
// 3) UTILS CANVAS & DIBUJO
// =======================================================
function buildImageUrl(split, name) {
  return `/static/dataset/${split}/images/${encodeURIComponent(name)}`;
}

// Ajusta el canvas a su tamaño en CSS y al devicePixelRatio
function syncCanvasDPI() {
  DPR = window.devicePixelRatio || 1;
  const rect = tCanvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width  * DPR));
  const h = Math.max(1, Math.round(rect.height * DPR));
  if (tCanvas.width !== w || tCanvas.height !== h) {
    tCanvas.width  = w;
    tCanvas.height = h;
  }
}

function fitToCanvas() {
  const iw = tImg.naturalWidth  || tImg.width;
  const ih = tImg.naturalHeight || tImg.height;
  syncCanvasDPI();
  const cw = tCanvas.width, ch = tCanvas.height;
  tScale = Math.min(cw/iw, ch/ih);
  tOffX  = (cw - iw * tScale) / 2;
  tOffY  = (ch - ih * tScale) / 2;
}

function screenToImage(px, py) {
  return { ix: (px - tOffX) / tScale, iy: (py - tOffY) / tScale };
}
function imageToScreen(ix, iy) {
  return { sx: ix * tScale + tOffX, sy: iy * tScale + tOffY };
}

// Recorta a los límites de la imagen cargada
function clampToImage(ix, iy) {
  const iw = tImg?.naturalWidth  || 0;
  const ih = tImg?.naturalHeight || 0;
  return {
    ix: Math.min(Math.max(ix, 0), iw),
    iy: Math.min(Math.max(iy, 0), ih)
  };
}

function drawCrosshair(x, y) {
  const extra = 0; // pon 50 si quieres prolongar derecha/abajo 50px
  tCtx.save();
  tCtx.strokeStyle = 'lime';
  tCtx.lineWidth   = 1;

  tCtx.beginPath();
  // Horizontal: de 0 hasta ancho canvas (+extra si quieres)
  tCtx.moveTo(0, y);
  tCtx.lineTo(tCanvas.width + extra, y);

  // Vertical: de 0 hasta alto canvas (+extra si quieres)
  tCtx.moveTo(x, 0);
  tCtx.lineTo(x, tCanvas.height + extra);

  tCtx.stroke();
  tCtx.restore();
}


// Obtener array de nombres de clase (index -> nombre)
function getClassListArray(){
  return Array.from(classSelect?.options || []).map(o=>o.value);
}

// Dibuja el texto centrado encima del bbox (usa coords de imagen -> pantalla)
function drawCanvasLabelOnTop(b, text) {
  const cxImg = b.x + b.w / 2;  // centro horizontal de la caja
  const topImg = b.y;           // borde superior de la caja
  drawCanvasLabel(cxImg, topImg, text, { align: 'center', margin: 4 });
}

// Dibuja una etiqueta en pantalla a partir de coords de imagen
function drawCanvasLabel(imgX, imgY, text, { align='left', margin=4 } = {}) {
  // Convertimos a coords de pantalla (px de canvas, ya corregidos por DPR)
  const { sx, sy } = imageToScreen(imgX, imgY);

  // Tipografía estable con zoom
  const base = 12;
  const fontPx = Math.max(10, base / tScale);
  tCtx.save();
  tCtx.setTransform(1,0,0,1,0,0); // aseguramos NO hay transformaciones activas
  tCtx.font = `${fontPx}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

  const padX = 4 / tScale;
  const padY = 2 / tScale;
  const metrics = tCtx.measureText(text);
  const textW = metrics.width;
  const textH = fontPx;

  const boxW = textW + padX * 2;
  const boxH = textH + padY * 2;

  // Posición de la caja del label (encima del bbox, con margen)
  let boxX = sx;
  if (align === 'center') boxX = sx - boxW / 2;
  const boxY = sy - boxH - (margin / tScale);

  // Fondo + borde
  tCtx.fillStyle = 'rgba(0,0,0,0.7)';
  tCtx.strokeStyle = 'rgba(255,255,255,0.85)';
  tCtx.lineWidth = 1; // ya estamos en espacio pantalla
  tCtx.beginPath();
  tCtx.rect(boxX, boxY, boxW, boxH);
  tCtx.fill();
  tCtx.stroke();

  // Texto
  tCtx.fillStyle = '#fff';
  tCtx.fillText(text, boxX + padX, boxY + padY + textH * 0.8);
  tCtx.restore();
}


function redrawTrain() {
  syncCanvasDPI();
  tCtx.clearRect(0,0,tCanvas.width,tCanvas.height);

  if (!tLoaded) {
    hud.textContent = `(${currentSplit}) listo`;
    return;
  }

  // 1) IMAGEN + CAJAS (en espacio de imagen)
  tCtx.save();
  tCtx.translate(tOffX, tOffY);
  tCtx.scale(tScale, tScale);

  tCtx.drawImage(tImg, 0, 0);

  tCtx.lineWidth = 2 / tScale;
  tCtx.strokeStyle = '#ff3b30';
  for (const b of tBoxes) {
    tCtx.strokeRect(b.x, b.y, b.w, b.h);
  }

  // caja provisional mientras dibujas
  if (tDrawing) {
    tCtx.strokeStyle = 'lime';
    tCtx.strokeRect(tStartX, tStartY, tPrevW, tPrevH);
  }

  tCtx.restore();

  // 2) LABELS (en espacio de pantalla, sin transformaciones)
  const labelNames = getClassListArray();
  for (const b of tBoxes) {
    const clsName = labelNames?.[b.cls] ?? String(b.cls ?? '');
    if (clsName) drawCanvasLabelOnTop(b, clsName);
  }

  // 3) CROSSHAIR (pantalla)
  drawCrosshair(tMouseX, tMouseY);

  hud.textContent = currentImage
    ? `img: ${currentImage} | zoom ${(tScale*100).toFixed(0)}% | cajas ${tBoxes.length}`
    : `(${currentSplit}) listo`;
}


// Centrar una miniatura en la vista del filmstrip
function centerThumbInView(i) {
  if (!stripTrack) return;
  const el = stripTrack.children[i];
  if (!el) return;

  const trackRect = stripTrack.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();

  const current = stripTrack.scrollLeft;
  const delta = (elRect.left + elRect.width/2) - (trackRect.left + trackRect.width/2);
  stripTrack.scrollLeft = current + delta;
}

// Marca activa y centra
function setActiveThumbByIndex(i) {
  if (!stripTrack) return;
  stripTrack.querySelectorAll('.strip-thumb').forEach((el, k) => {
    el.classList.toggle('active', k === i);
  });
  centerThumbInView(i);
  updateStripScrollbar(); // mantener range sincronizado
}

// =======================================================
// 4) YOLO utils + overlay helpers
// =======================================================
function buildLabelUrl(split, name){
  const base = name.replace(/\.[^.]+$/, '');
  return `/static/dataset/${split}/labels/${encodeURIComponent(base)}.txt`;
}

// devuelve [{cls, cx, cy, w, h}] en unidades normalizadas [0..1]
async function fetchYoloLabels(split, name){
  try{
    const url = buildLabelUrl(split, name);
    const res = await fetch(url, { cache: 'no-store' });
    if(!res.ok) return [];
    const txt = await res.text();
    const lines = txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    return lines.map(l => {
      const [cls, cx, cy, w, h] = l.split(/[\s,]+/).map(Number);
      return { cls, cx, cy, w, h };
    });
  }catch(e){ console.warn('labels fail', e); return []; }
}

// convierte YOLO (norm.) a {x,y,w,h} en píxeles de la imagen original
function yoloToXYWH(label, iw, ih){
  const x = (label.cx - label.w/2) * iw;
  const y = (label.cy - label.h/2) * ih;
  return { x, y, w: label.w * iw, h: label.h * ih, cls: label.cls };
}

// ====== Overlays HTML (filmstrip y lightbox) ======
function drawOverlayBoxes(container, img, boxesPx, {labelNames=[]}={}){
  let overlay = container.querySelector('.bbox-layer');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.className = 'bbox-layer';
    container.appendChild(overlay);
  }
  overlay.innerHTML = '';

  const cw = container.clientWidth, ch = container.clientHeight;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const scale = Math.min(cw/iw, ch/ih);
  const dispW = iw * scale, dispH = ih * scale;
  const offX = (cw - dispW) / 2;
  const offY = (ch - dispH) / 2;

  overlay.style.left = offX + 'px';
  overlay.style.top  = offY + 'px';
  overlay.style.width  = dispW + 'px';
  overlay.style.height = dispH + 'px';

  boxesPx.forEach(b=>{
    const bx = b.x * scale;
    const by = b.y * scale;
    const bw = b.w * scale;
    const bh = b.h * scale;

    const node = document.createElement('div');
    node.className = 'bbox';
    node.style.left = `${bx}px`;
    node.style.top  = `${by}px`;
    node.style.width  = `${bw}px`;
    node.style.height = `${bh}px`;

    const lbl = document.createElement('div');
    lbl.className = 'bbox-label';
    const clsName = (labelNames[b.cls] ?? String(b.cls));
    lbl.textContent = clsName;
    node.appendChild(lbl);

    overlay.appendChild(node);
  });
}

// Refresca solo la miniatura indicada (sin reconstruir toda la tira)
async function refreshThumbOverlay(name, split = currentSplit) {
  if (!stripTrack) return;
  const el = stripTrack.querySelector(`.strip-thumb[data-name="${name}"]`);
  if (!el) return;

  const img = el.querySelector('img');
  if (!img) return;

  if (!img.complete || !img.naturalWidth) {
    await new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
    });
  }

  const labels = await fetchYoloLabels(split, name);
  const overlay = el.querySelector('.bbox-layer');
  if (!labels.length || !img.naturalWidth || !img.naturalHeight) {
    if (overlay) overlay.innerHTML = '';
    return;
  }

  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const boxesPx = labels.map(l => yoloToXYWH(l, iw, ih));
  drawOverlayBoxes(el, img, boxesPx, { labelNames: getClassListArray() });
}

// Refresca el overlay del lightbox si está abierto
async function refreshLightboxOverlay() {
  if (!imgLightbox || !imgFull) return;
  const isOpen = !imgLightbox.classList.contains('hidden');
  if (!isOpen || !currentImage) return;

  const labels = await fetchYoloLabels(currentSplit, currentImage);
  const iw = imgFull.naturalWidth || 0;
  const ih = imgFull.naturalHeight || 0;
  const boxesPx = (iw && ih) ? labels.map(l => yoloToXYWH(l, iw, ih)) : [];
  const container = imgFull.closest('.modal-inner');
  drawOverlayBoxes(container, imgFull, boxesPx, { labelNames: getClassListArray() });
}

// =======================================================
// 5) CARGA DE CLASES E IMÁGENES
// =======================================================
async function loadClasses() {
  const resp = await fetch('/annotate/classes');
  const data = await resp.json();
  classSelect.innerHTML = '';
  (data.classes || []).forEach((c, i) => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = `${i} — ${c}`;
    classSelect.appendChild(opt);
  });
}

async function loadImageList() {
  currentSplit = splitSelect.value || 'train';
  const resp = await fetch(`/annotate/images?split=${encodeURIComponent(currentSplit)}`);
  const data = await resp.json();

  imageListCache = data.images || [];
  buildFilmstrip(imageListCache);

  if (imageListCache.length > 0) {
    currentIndex = Math.max(0, Math.min(currentIndex, imageListCache.length - 1));
    if (currentIndex < 0) currentIndex = 0;
    loadImageByIndex(currentIndex);
    setActiveThumbByIndex(currentIndex);
  } else {
    currentIndex = -1;
    currentImage = null;
    tLoaded = false; tBoxes = []; redrawTrain();
  }

  hud.textContent = `(${currentSplit}) ${imageListCache.length} imágenes`;
  updateStripScrollbar();
}

// =======================================================
// 6) CARGA Y NAVEGACIÓN
// =======================================================
function loadImageByName(name) {
  if (!name) return;
  currentImage = name;
  tImg = new Image();
  tImg.src = buildImageUrl(currentSplit, name);
  tImg.onload = () => {
    tLoaded = true;
    fitToCanvas();
    tBoxes = [];

    fetchYoloLabels(currentSplit, name).then(labels=>{
      const iw = tImg.naturalWidth, ih = tImg.naturalHeight;
      tBoxes = labels.map(l => yoloToXYWH(l, iw, ih));
      redrawTrain();
    });

    if (currentIndex >= 0) setActiveThumbByIndex(currentIndex);
  };
}

function loadImageByIndex(i) {
  if (i < 0 || i >= imageListCache.length) return;
  const name = imageListCache[i];
  loadImageByName(name);
}

function goRelative(step) {
  if (!imageListCache.length) return;
  if (currentIndex < 0) currentIndex = 0;
  let next = currentIndex + step;
  next = Math.max(0, Math.min(next, imageListCache.length - 1));
  if (next !== currentIndex) {
    currentIndex = next;
    loadImageByIndex(currentIndex);
    setActiveThumbByIndex(currentIndex);
  }
}

// =======================================================
// 7) FILMSTRIP (con interactividad extra + range sincronizado)
// =======================================================
function buildFilmstrip(images) {
  if (!stripTrack) return;
  stripTrack.innerHTML = '';

  const split = splitSelect.value || 'train';
  (images || []).forEach((name, i) => {
    const item = document.createElement('div');
    item.className = 'strip-thumb';
    item.title     = name;
    item.dataset.name  = name;   // para refresh focalizado
    item.dataset.split = split;  // para refresh focalizado

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src     = buildImageUrl(split, name);

    const label = document.createElement('div');
    label.className = 'name';
    label.textContent = name;

    item.appendChild(img);
    item.appendChild(label);
    stripTrack.appendChild(item);

    // click: seleccionar imagen
    item.addEventListener('click', () => {
      currentIndex = i;
      loadImageByIndex(currentIndex);
      setActiveThumbByIndex(currentIndex);
    });

    // doble click: abrir ampliación (lightbox) con cajas
    item.addEventListener('dblclick', () => {
      openPreview(name);
    });

    // pintar overlay en la miniatura al cargar
    const ensureOverlay = async () => {
      const labels = await fetchYoloLabels(split, name);
      if (!labels.length) return;

      const iw = img.naturalWidth || 0;
      const ih = img.naturalHeight || 0;
      if (!iw || !ih) return;

      const boxesPx = labels.map(l => yoloToXYWH(l, iw, ih));
      drawOverlayBoxes(item, img, boxesPx, { labelNames: getClassListArray() });
    };

    if (img.complete && img.naturalWidth) ensureOverlay();
    else img.addEventListener('load', ensureOverlay);
  });

  // Interacción “drag to scroll”
  stripTrack.addEventListener('mousedown', (e) => {
    fsDragging = true;
    stripTrack.classList.add('grabbing');
    fsStartX = e.pageX - stripTrack.offsetLeft;
    fsScrollLeft = stripTrack.scrollLeft;
  });
  window.addEventListener('mouseup', () => {
    fsDragging = false;
    stripTrack.classList.remove('grabbing');
  });
  stripTrack.addEventListener('mouseleave', () => {
    fsDragging = false;
    stripTrack.classList.remove('grabbing');
  });
  stripTrack.addEventListener('mousemove', (e) => {
    if (!fsDragging) return;
    e.preventDefault();
    const x = e.pageX - stripTrack.offsetLeft;
    const walk = (x - fsStartX) * 1;
    stripTrack.scrollLeft = fsScrollLeft - walk;
    updateStripScrollbar();
  });

  // Scroll con rueda del ratón (horizontal)
  stripTrack.addEventListener('wheel', (e) => {
    const delta = (Math.abs(e.deltaX) > Math.abs(e.deltaY)) ? e.deltaX : e.deltaY;
    stripTrack.scrollLeft += delta;
    updateStripScrollbar();
    e.preventDefault();
  }, { passive: false });

  setActiveThumbByIndex(currentIndex);
  updateStripScrollbar();
}

// Botones filmstrip
function scrollFilmstripPage(dir = 1) {
  if (!stripTrack) return;
  const page = stripTrack.clientWidth * 0.9;
  stripTrack.scrollLeft += dir * page;
  updateStripScrollbar();
}
stripPrev?.addEventListener('click', () => { goRelative(-1); scrollFilmstripPage(-1); });
stripNext?.addEventListener('click', () => { goRelative(+1); scrollFilmstripPage(+1); });

// ===== sincronización del range inferior =====
function updateStripScrollbar(){
  if (!stripTrack || !stripScroll) return;
  const max = Math.max(0, stripTrack.scrollWidth - stripTrack.clientWidth);
  stripScroll.max = String(Math.floor(max));
  stripScroll.value = String(Math.floor(stripTrack.scrollLeft));
  stripScroll.style.visibility = max > 0 ? 'visible' : 'hidden';
}

function initStripScrollbarSync(){
  if (!stripTrack || !stripScroll) return;

  stripScroll.addEventListener('input', () => {
    stripTrack.scrollLeft = Number(stripScroll.value || 0);
  });

  stripTrack.addEventListener('scroll', () => {
    stripScroll.value = String(Math.floor(stripTrack.scrollLeft));
  });

  const ro = new ResizeObserver(() => updateStripScrollbar());
  ro.observe(stripTrack);

  window.addEventListener('resize', updateStripScrollbar);

  updateStripScrollbar();
}

// =======================================================
// 8) EVENTOS CANVAS / CONTROLES (Pointer + DPI + Pan/Zoom)
// =======================================================
let rafId = null;
function scheduleRedraw() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => { rafId = null; redrawTrain(); });
}

// Resync canvas cuando cambie el viewport
window.addEventListener('resize', () => {
  if (!tLoaded) { syncCanvasDPI(); scheduleRedraw(); return; }
  syncCanvasDPI();
  // re-centrar imagen al nuevo tamaño
  fitToCanvas();
  scheduleRedraw();
});

// Split cambiado
splitSelect.addEventListener('change', loadImageList);

// Cargar actual
loadImageBtn.addEventListener('click', () => {
  if (currentIndex >= 0) loadImageByIndex(currentIndex);
});

// Estado para pointer
let pointerId = null;

tCanvas.addEventListener('pointermove', (e) => {
  const r = tCanvas.getBoundingClientRect();
  tMouseX = (e.clientX - r.left) * DPR;  // ← antes: sin *DPR
  tMouseY = (e.clientY - r.top)  * DPR;  // ← antes: sin *DPR
  if (panning) {
    const dx = tMouseX - panStart.x;
    const dy = tMouseY - panStart.y;
    tOffX = panOffStart.x + dx;
    tOffY = panOffStart.y + dy;
    scheduleRedraw();
    return;
  }

  if (tDrawing) {
    const { ix, iy } = screenToImage(tMouseX, tMouseY);
    const clamped = clampToImage(ix, iy);
    tPrevW = clamped.ix - tStartX;
    tPrevH = clamped.iy - tStartY;
  }
  scheduleRedraw();
});

tCanvas.addEventListener('pointerdown', (e) => {
  if (!tLoaded) return;
  if (e.detail > 1) return; // evita conflicto con dblclick/lightbox

  pointerId = e.pointerId;
  tCanvas.setPointerCapture(pointerId);

  const r = tCanvas.getBoundingClientRect();
  const sx = (e.clientX - r.left) * DPR;
  const sy = (e.clientY - r.top)  * DPR;

  // PAN con botón central (1), derecho (2) o con modificadores (Shift/Ctrl/Alt/Cmd/Espacio)
  const wantsPan =
    (e.button === 1) ||
    (e.button === 2) ||
    (e.button === 0 && (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || (e.getModifierState && e.getModifierState('Space'))));

  if (wantsPan) {
    panning = true;
    panStart.x = sx;
    panStart.y = sy;
    panOffStart.x = tOffX;
    panOffStart.y = tOffY;
    return; // no iniciamos caja
  }

  const { ix, iy } = screenToImage(sx, sy);
  const clamped = clampToImage(ix, iy);

  tDrawing = true;
  tStartX = clamped.ix;
  tStartY = clamped.iy;
  tPrevW = 0; tPrevH = 0;

  scheduleRedraw();
});

function finishBox() {
  if (!tDrawing) return;
  tDrawing = false;

  const endX = tStartX + tPrevW;
  const endY = tStartY + tPrevH;

  const a = clampToImage(tStartX, tStartY);
  const b = clampToImage(endX, endY);

  const x = Math.min(a.ix, b.ix);
  const y = Math.min(a.iy, b.iy);
  const w = Math.abs(a.ix - b.ix);
  const h = Math.abs(a.iy - b.iy);

  if (w >= 2 && h >= 2) {
    const clsIndex = Math.max(0, classSelect.selectedIndex);
    tBoxes.push({ x, y, w, h, cls: clsIndex });
  }

  tPrevW = tPrevH = 0;
  scheduleRedraw();
}

tCanvas.addEventListener('pointerup', (e) => {
  try { if (pointerId != null) tCanvas.releasePointerCapture(pointerId); } catch {}
  pointerId = null;
  if (panning) { panning = false; scheduleRedraw(); return; }
  finishBox();
});

window.addEventListener('pointerup', () => {
  if (panning) { panning = false; scheduleRedraw(); }
  else if (tDrawing) finishBox();
});

// Zoom centrado y estable en el punto del cursor
function zoomAt(factor, cx, cy) {
  const before = screenToImage(cx, cy);

  const minScale = 0.1, maxScale = 20;
  const newScale = Math.min(maxScale, Math.max(minScale, tScale * factor));

  tOffX = cx - (before.ix * newScale);
  tOffY = cy - (before.iy * newScale);
  tScale = newScale;

  scheduleRedraw();
}

zoomInBtn.addEventListener('click', () => zoomAt(1.1, tCanvas.width/2, tCanvas.height/2));
zoomOutBtn.addEventListener('click', () => zoomAt(1/1.1, tCanvas.width/2, tCanvas.height/2));
resetViewBtn.addEventListener('click', () => { if (tLoaded) { fitToCanvas(); scheduleRedraw(); } });

// Rueda: zoom por defecto; si mantienes Shift, hace pan fino con rueda
tCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();

  if (e.shiftKey) {
    // Pan fino con rueda: desplaza offsets en px de pantalla
    tOffY -= e.deltaY;
    tOffX -= e.deltaX;
    scheduleRedraw();
    return;
  }

  // Zoom centrado en el cursor
  const factor = e.deltaY < 0 ? 1.1 : 1/1.1;
  zoomAt(factor, tMouseX, tMouseY);
}, { passive: false });

// Edición cajas
undoBoxBtn.addEventListener('click', () => { tBoxes.pop(); scheduleRedraw(); });
clearBoxesBtn.addEventListener('click', () => { tBoxes = []; scheduleRedraw(); });

// Guardado
saveAnnBtn?.addEventListener('click', async () => {
  if (!tLoaded || !currentImage) { alert("Carga una imagen."); return; }
  const label = classSelect?.value;
  if (!label) { alert("No hay clases disponibles (revisa classes.txt)."); return; }

  const payload = { split: currentSplit, image: currentImage, label, boxes: tBoxes };
  const resp = await fetch('/annotate/save', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });
  const data = await resp.json();

  if (resp.ok) {
    alert(`Etiquetas guardadas: ${data.saved}`);
    // Refresca overlay de la miniatura actual y lightbox si procede
    await refreshThumbOverlay(currentImage, currentSplit);
    await refreshLightboxOverlay();
  } else {
    alert(`Error: ${data.error || 'fallo al guardar'}`);
  }
});

// Teclado
window.addEventListener('keydown', (e) => {
  if (e.target && ['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
  if (e.key === 'Escape') {
    if (tDrawing) { tDrawing = false; tPrevW = tPrevH = 0; scheduleRedraw(); return; }
    if (panning)  { panning  = false; scheduleRedraw(); return; }
  }
  if (e.key === 'ArrowLeft')  { e.preventDefault(); goRelative(-1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); goRelative(+1); }
  if (e.key === 'PageUp')     { e.preventDefault(); goRelative(-5); }
  if (e.key === 'PageDown')   { e.preventDefault(); goRelative(+5); }
});

// Lightbox helpers
function closePreview(e) {
  e.stopPropagation();
  imgLightbox?.classList.add('hidden');
}
function openPreview(name){
  const split = splitSelect.value || 'train';
  if (!imgLightbox || !imgFull) return;

  imgFull.src = buildImageUrl(split, name);
  imgLightbox.classList.remove('hidden');

  const afterLoad = async () => {
    const labels = await fetchYoloLabels(split, name);
    const iw = imgFull.naturalWidth || 0;
    const ih = imgFull.naturalHeight || 0;
    const boxesPx = (iw && ih) ? labels.map(l => yoloToXYWH(l, iw, ih)) : [];
    const container = imgFull.closest('.modal-inner');
    drawOverlayBoxes(container, imgFull, boxesPx, { labelNames: getClassListArray() });
  };

  if (imgFull.complete && imgFull.naturalWidth) afterLoad();
  else imgFull.onload = afterLoad;
}

// abrir lightbox desde el canvas actual con doble click (sin conflicto con dibujo)
tCanvas.addEventListener('dblclick', () => {
  if (tDrawing || panning) return;
  if (currentImage) openPreview(currentImage);
});

// =======================================================
// 9) INIT
// =======================================================
window.addEventListener('DOMContentLoaded', async () => {
  syncCanvasDPI();
  await loadClasses();
  await loadImageList();            // construye filmstrip y auto-carga
  initStripScrollbarSync();         // activar sincronización range <-> scroll
  scheduleRedraw();
});
