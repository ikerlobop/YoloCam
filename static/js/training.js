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

// =======================================================
// 3) UTILS
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
function redrawTrain() {
  tCtx.clearRect(0,0,tCanvas.width,tCanvas.height);
  if (!tLoaded) return;

  tCtx.save();
  tCtx.translate(tOffX, tOffY);
  tCtx.scale(tScale, tScale);
  tCtx.drawImage(tImg, 0, 0);

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
  hud.textContent = currentImage
    ? `img: ${currentImage} | zoom ${(tScale*100).toFixed(0)}% | cajas ${tBoxes.length}`
    : `(${currentSplit}) listo`;
}
function setActiveThumbByIndex(i) {
  if (!stripTrack) return;
  stripTrack.querySelectorAll('.strip-thumb').forEach((el, k) => {
    el.classList.toggle('active', k === i);
  });
  const active = stripTrack.children[i];
  if (active) active.scrollIntoView({ inline:'center', behavior:'smooth', block:'nearest' });
}

// =======================================================
// 4) CARGA DE CLASES E IMÁGENES
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
    currentIndex = 0;              // <-- antes: length - 1
    loadImageByIndex(currentIndex); // carga la primera
    setActiveThumbByIndex(currentIndex, { scroll:false }); // <-- no hacer scroll
  } else {
    currentIndex = -1;
    currentImage = null;
    tLoaded = false; tBoxes = []; redrawTrain();
  }

  hud.textContent = `(${currentSplit}) ${imageListCache.length} imágenes`;
}


// =======================================================
// 5) CARGA Y NAVEGACIÓN
// =======================================================
function loadImageByName(name) {
  if (!name) return;
  currentImage = name;
  tImg = new Image();
  tImg.src = buildImageUrl(currentSplit, name);
  tImg.onload = () => {
    tLoaded = true;
    fitToCanvas();
    tBoxes = []; // limpia cajas al cargar
    redrawTrain();
    currentIndex = imageListCache.findIndex(n => n === name);
    setActiveThumbByIndex(currentIndex);
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
  }
}

// =======================================================
// 6) FILMSTRIP
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

    item.addEventListener('click', () => {
      currentIndex = i;
      loadImageByIndex(currentIndex);
    });

    stripTrack.appendChild(item);
  });

  setActiveThumbByIndex(currentIndex);
}

// =======================================================
// 7) EVENTOS
// =======================================================

// Split cambiado
splitSelect.addEventListener('change', async () => {
  await loadImageList();
});

// Cargar (por si quieres forzar recarga de la actual)
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
  if (box.w > 2 && box.h > 2) tBoxes.push(box);
  tPrevW = tPrevH = 0;
  redrawTrain();
});

// Zoom
function zoomAt(factor, cx, cy) {
  const before = screenToImage(cx, cy);
  tScale *= factor;
  const after = screenToImage(cx, cy);
  tOffX += (after.ix - before.ix) * tScale;
  tOffY += (after.iy - before.iy) * tScale;
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

// Botones filmstrip
stripPrev?.addEventListener('click', () => goRelative(-1));
stripNext?.addEventListener('click', () => goRelative(+1));

// Lightbox helpers (opcional)
function closePreview(e) {
  e.stopPropagation();
  imgLightbox?.classList.add('hidden');
}

// =======================================================
// 8) INIT
// =======================================================
window.addEventListener('DOMContentLoaded', async () => {
  await loadClasses();
  await loadImageList();  // construye filmstrip y auto-carga una imagen
});
