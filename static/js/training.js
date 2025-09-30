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
const stripPrev  = document.getElementById('stripPrev');
const stripNext  = document.getElementById('stripNext');
const stripTrack = document.getElementById('stripTrack');

// Lightbox (opcional)
const imgFull     = document.getElementById('imgFull');
const imgLightbox = document.getElementById('imgLightbox');

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

// =======================================================
/** 3) UTILS CANVAS & DIBUJO */
// =======================================================
function buildImageUrl(split, name) {
  return `/static/dataset/${split}/images/${encodeURIComponent(name)}`;
}

function fitToCanvas() {
  const iw = tImg.width, ih = tImg.height;
  const cw = tCanvas.width, ch = tCanvas.height;
  tScale = Math.min(cw/iw, ch/ih);
  tOffX  = (cw - iw * tScale) / 2;
  tOffY  = (ch - ih * tScale) / 2;
}

function screenToImage(px, py) {
  return { ix: (px - tOffX) / tScale, iy: (py - tOffY) / tScale };
}

function drawCrosshair(x, y) {
  tCtx.strokeStyle = 'lime';
  tCtx.lineWidth   = 1;
  tCtx.beginPath();
  tCtx.moveTo(x - 10, y); tCtx.lineTo(x + 10, y);
  tCtx.moveTo(x, y - 10); tCtx.lineTo(x, y + 10);
  tCtx.stroke();
}

// Obtener array de nombres de clase (index -> nombre)
function getClassListArray(){
  return Array.from(classSelect?.options || []).map(o=>o.value);
}

// Dibuja una etiqueta con fondo sobre el canvas principal, escalada
function drawCanvasLabel(imgX, imgY, text) {
  // convertir a coordenadas de pantalla
  const sx = imgX * tScale + tOffX;
  const sy = imgY * tScale + tOffY;

  // tamaño de fuente relativo al zoom (legible a cualquier escala)
  const base = 12;                   // px a escala 1:1
  const fontPx = Math.max(10, base / tScale);
  tCtx.font = `${fontPx}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

  const paddingX = 4 / tScale;
  const paddingY = 2 / tScale;

  const metrics = tCtx.measureText(text);
  const textW = metrics.width;
  const textH = fontPx; // aprox

  // fondo
  tCtx.save();
  tCtx.fillStyle = 'rgba(0,0,0,0.6)';
  tCtx.strokeStyle = 'rgba(255,255,255,0.85)';
  tCtx.lineWidth = 1 / tScale;

  const boxX = sx;
  const boxY = sy - (textH + 6 / tScale); // por encima del bbox
  const boxW = textW + paddingX * 2;
  const boxH = textH + paddingY * 2;

  // Fondo rectangular
  tCtx.beginPath();
  tCtx.rect(boxX, boxY, boxW, boxH);
  tCtx.fill();
  tCtx.stroke();

  // texto
  tCtx.fillStyle = '#ffffff';
  tCtx.fillText(text, boxX + paddingX, boxY + paddingY + textH * 0.8);
  tCtx.restore();
}

function redrawTrain() {
  tCtx.clearRect(0,0,tCanvas.width,tCanvas.height);
  if (!tLoaded) {
    hud.textContent = `(${currentSplit}) listo`;
    return;
  }

  tCtx.save();
  tCtx.translate(tOffX, tOffY);
  tCtx.scale(tScale, tScale);
  tCtx.drawImage(tImg, 0, 0);

  // BBoxes
  tCtx.lineWidth = 2 / tScale;
  const labelNames = getClassListArray();
  tBoxes.forEach(b => {
    // caja
    tCtx.strokeStyle = '#ff3b30';
    tCtx.strokeRect(b.x, b.y, b.w, b.h);

    // etiqueta clase (encima de la caja)
    const clsName = labelNames?.[b.cls] ?? String(b.cls ?? '');
    if (clsName) {
      // punto superior-izquierdo en coord. imagen
      drawCanvasLabel(b.x, b.y, clsName);
    }
  });

  // si estamos dibujando, caja "preview"
  if (tDrawing) {
    tCtx.strokeStyle = 'lime';
    tCtx.strokeRect(tStartX, tStartY, tPrevW, tPrevH);
  }

  tCtx.restore();
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
}

// =======================================================
// 4) YOLO utils + overlay helpers
// =======================================================
function buildLabelUrl(split, name){
  // mismo nombre pero .txt en /labels
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
  // elimina overlay anterior
  let overlay = container.querySelector('.bbox-layer');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.className = 'bbox-layer';
    container.appendChild(overlay);
  }
  overlay.innerHTML = '';

  // medimos cómo la imagen "encaja" (contain) dentro del contenedor
  const cw = container.clientWidth, ch = container.clientHeight;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const scale = Math.min(cw/iw, ch/ih);
  const dispW = iw * scale, dispH = ih * scale;
  const offX = (cw - dispW) / 2;
  const offY = (ch - dispH) / 2;

  // posicionamos overlay para que coincida con el área visible de la imagen
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

    // etiqueta (opcional)
    const lbl = document.createElement('div');
    lbl.className = 'bbox-label';
    const clsName = (labelNames[b.cls] ?? String(b.cls));
    lbl.textContent = clsName;
    node.appendChild(lbl);

    overlay.appendChild(node);
  });
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
    opt.value = c; opt.textContent = `${i} — ${c}`;
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
    loadImageByIndex(currentIndex); // carga la actual/primera
    setActiveThumbByIndex(currentIndex);
  } else {
    currentIndex = -1;
    currentImage = null;
    tLoaded = false; tBoxes = []; redrawTrain();
  }

  hud.textContent = `(${currentSplit}) ${imageListCache.length} imágenes`;
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
    tBoxes = []; // limpia

    // cargar etiquetas YOLO para el canvas principal
    fetchYoloLabels(currentSplit, name).then(labels=>{
      const iw = tImg.naturalWidth, ih = tImg.naturalHeight;
      tBoxes = labels.map(l => yoloToXYWH(l, iw, ih));
      redrawTrain();
    });

    // resalta la miniatura activa si tenemos índice
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
// 7) FILMSTRIP (con interactividad extra)
// =======================================================
function buildFilmstrip(images) {
  if (!stripTrack) return;
  stripTrack.innerHTML = '';

  const split = splitSelect.value || 'train';
  (images || []).forEach((name, i) => {
    const item = document.createElement('div');
    item.className = 'strip-thumb';
    item.title     = name;

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

    // cuando la miniatura esté lista, traemos labels y pintamos overlay
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
    const walk = (x - fsStartX) * 1; // factor de arrastre
    stripTrack.scrollLeft = fsScrollLeft - walk;
  });

  // Scroll con rueda del ratón (horizontal)
  stripTrack.addEventListener('wheel', (e) => {
    // Shift+rueda o rueda normal: desplaza horizontal
    const delta = (Math.abs(e.deltaX) > Math.abs(e.deltaY)) ? e.deltaX : e.deltaY;
    stripTrack.scrollLeft += delta;
    // Evitamos que la página intente hacer scroll vertical
    e.preventDefault();
  }, { passive: false });

  setActiveThumbByIndex(currentIndex);
}

// Botones filmstrip: además de navegar, desplazan la tira una página aprox.
function scrollFilmstripPage(dir = 1) {
  if (!stripTrack) return;
  const page = stripTrack.clientWidth * 0.9;
  stripTrack.scrollLeft += dir * page;
}
stripPrev?.addEventListener('click', () => { goRelative(-1); scrollFilmstripPage(-1); });
stripNext?.addEventListener('click', () => { goRelative(+1); scrollFilmstripPage(+1); });

// =======================================================
// 8) EVENTOS CANVAS / CONTROLES
// =======================================================

// Split cambiado
splitSelect.addEventListener('change', async () => {
  await loadImageList();
});

// Cargar (forzar recarga actual)
loadImageBtn.addEventListener('click', () => {
  if (currentIndex >= 0) loadImageByIndex(currentIndex);
});

// Canvas interacciones
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
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  const {ix, iy} = screenToImage(sx, sy);
  tDrawing = true; tStartX = ix; tStartY = iy; tPrevW = 0; tPrevH = 0;
});

tCanvas.addEventListener('mouseup', () => {
  if (!tDrawing) return;
  tDrawing = false;
  const w = tPrevW, h = tPrevH;
  const box = { x: w>=0 ? tStartX : tStartX+w, y: h>=0 ? tStartY : tStartY+h, w: Math.abs(w), h: Math.abs(h) };
  if (box.w > 2 && box.h > 2) {
    // adjunta la clase seleccionada al nuevo bbox
    const clsIndex = Math.max(0, classSelect.selectedIndex);
    box.cls = clsIndex;
    tBoxes.push(box);
  }
  tPrevW = tPrevH = 0;
  redrawTrain();
});

// Zoom centrado en punto
function zoomAt(factor, cx, cy) {
  // Guardamos punto en coords de imagen ANTES del zoom
  const before = screenToImage(cx, cy);
  // Ajustamos escala
  const newScale = tScale * factor;

  // Limitar zoom
  const minScale = 0.1, maxScale = 20;
  tScale = Math.min(maxScale, Math.max(minScale, newScale));

  // Reposicionar offsets para mantener el punto bajo el cursor
  const after = screenToImage(cx, cy);
  tOffX += (cx - (after.ix * tScale + tOffX)) - (cx - (before.ix * (tScale/factor) + tOffX));
  tOffY += (cy - (after.iy * tScale + tOffY)) - (cy - (before.iy * (tScale/factor) + tOffY));

  redrawTrain();
}

zoomInBtn.addEventListener('click', () => zoomAt(1.1, tCanvas.width/2, tCanvas.height/2));
zoomOutBtn.addEventListener('click', () => zoomAt(1/1.1, tCanvas.width/2, tCanvas.height/2));
resetViewBtn.addEventListener('click', () => { if (tLoaded) { fitToCanvas(); redrawTrain(); } });

tCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 1/1.1;
  zoomAt(factor, tMouseX, tMouseY);
}, {passive:false});

// Edición cajas
undoBoxBtn.addEventListener('click', () => { tBoxes.pop(); redrawTrain(); });
clearBoxesBtn.addEventListener('click', () => { tBoxes = []; redrawTrain(); });

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
  if (resp.ok) alert(`Etiquetas guardadas: ${data.saved}`);
  else alert(`Error: ${data.error || 'fallo al guardar'}`);
});

// Subida
uploadBtn?.addEventListener('click', async () => {
  const files = fileInput?.files;
  if (!files || files.length === 0) {
    alert("Selecciona al menos una imagen (.jpg/.png).");
    return;
  }
  const split = splitSelect.value || 'train';

  uploadBtn.disabled = true;
  uploadInfo.textContent = "Subiendo...";
  try {
    let saved = 0, errs = 0;
    for (const f of files) {
      const per = new FormData();
      per.append('split', split);
      per.append('image', f, f.name);
      const r = await fetch('/upload_training_image', { method: 'POST', body: per });
      if (r.ok) saved++; else errs++;
    }
    await loadImageList();
    uploadInfo.textContent = `Subidas: ${saved} | Errores: ${errs}`;
  } catch (e) {
    console.error(e);
    uploadInfo.textContent = "Error al subir.";
  } finally {
    uploadBtn.disabled = false;
    fileInput.value = "";
  }
});

// Teclado
window.addEventListener('keydown', (e) => {
  if (e.target && ['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
  if (e.key === 'ArrowLeft')  { e.preventDefault(); goRelative(-1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); goRelative(+1); }
  if (e.key === 'PageUp')     { e.preventDefault(); goRelative(-5); }
  if (e.key === 'PageDown')   { e.preventDefault(); goRelative(+5); }
});

// Lightbox helpers (opcional)
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
    // El contenedor del overlay en el lightbox es .modal-inner (padre directo)
    const container = imgFull.closest('.modal-inner');
    drawOverlayBoxes(container, imgFull, boxesPx, { labelNames: getClassListArray() });
  };

  if (imgFull.complete && imgFull.naturalWidth) afterLoad();
  else imgFull.onload = afterLoad;
}

// abrir lightbox desde el canvas actual con doble click
tCanvas.addEventListener('dblclick', () => {
  if (currentImage) openPreview(currentImage);
});

// =======================================================
// 9) INIT
// =======================================================
window.addEventListener('DOMContentLoaded', async () => {
  await loadClasses();
  await loadImageList();  // construye filmstrip y auto-carga
});
