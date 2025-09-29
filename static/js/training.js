// --- refs UI ---
const splitSelect = document.getElementById('splitSelect');
const imageSelect = document.getElementById('imageSelect');
const loadImageBtn = document.getElementById('loadImageBtn');
const classSelect = document.getElementById('classSelect');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const resetViewBtn = document.getElementById('resetViewBtn');
const undoBoxBtn = document.getElementById('undoBoxBtn');
const clearBoxesBtn = document.getElementById('clearBoxesBtn');
const saveAnnBtn = document.getElementById('saveAnnBtn');
const hud = document.getElementById('hud');

const fileInput = document.getElementById('fileInput');
const uploadBtn  = document.getElementById('uploadBtn');
const uploadInfo = document.getElementById('uploadInfo');

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
  imageSelect.innerHTML = '';
  (data.images || []).forEach(name => {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    imageSelect.appendChild(opt);
  });
  hud.textContent = `(${currentSplit}) ${data.images?.length || 0} imágenes`;
}

function fitToCanvas() {
  const iw = tImg.width, ih = tImg.height;
  const cw = tCanvas.width, ch = tCanvas.height;
  tScale = Math.min(cw/iw, ch/ih);
  tOffX = (cw - iw * tScale) / 2;
  tOffY = (ch - ih * tScale) / 2;
}

function screenToImage(px, py) {
  return { ix: (px - tOffX) / tScale, iy: (py - tOffY) / tScale };
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

// eventos
splitSelect.addEventListener('change', async () => {
  await loadImageList();
  currentImage = null; tLoaded = false; tBoxes = []; redrawTrain();
});

loadImageBtn.addEventListener('click', () => {
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

// zoom botones
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

// zoom rueda
tCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 1/1.1;
  zoomAt(factor, tMouseX, tMouseY);
}, {passive:false});

// edición
undoBoxBtn.addEventListener('click', () => { tBoxes.pop(); redrawTrain(); });
clearBoxesBtn.addEventListener('click', () => { tBoxes = []; redrawTrain(); });

// guardar anotación -> usa /annotate/save (label por nombre; cajas en PIXELES)
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

// subir imágenes al split seleccionado (opcional label_data normalizado)
uploadBtn?.addEventListener('click', async () => {
  const files = fileInput?.files;
  if (!files || files.length === 0) {
    alert("Selecciona al menos una imagen (.jpg/.png).");
    return;
  }
  const split = splitSelect.value || 'train';
  const fd = new FormData();
  fd.append('split', split);
  for (const f of files) fd.append('image', f, f.name); // se envía una a una (este botón sube la primera)
  // Si quisieras enviar label_data normalizado, añade: fd.append('label_data', JSON.stringify([...]));

  uploadBtn.disabled = true;
  uploadInfo.textContent = "Subiendo...";
  try {
    // subimos una a una para feedback claro
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
    // auto-cargar la última si hay
    if (imageSelect.options.length > 0) {
      imageSelect.selectedIndex = imageSelect.options.length - 1;
      loadImageBtn.click();
    }
  } catch (e) {
    console.error(e);
    uploadInfo.textContent = "Error al subir.";
  } finally {
    uploadBtn.disabled = false;
    fileInput.value = "";
  }
});

// init
window.addEventListener('DOMContentLoaded', async () => {
  await loadClasses();
  await loadImageList();
});

function buildImageUrl(split, name) {
  // Ruta directa al archivo en /static
  return `/static/dataset/${split}/images/${encodeURIComponent(name)}`;
}

function updatePreview() {
  const split = document.getElementById('splitSelect')?.value || 'train';
  const imgName = document.getElementById('imageSelect')?.value;
  const thumb = document.getElementById('imgThumb');
  if (!thumb) return;

  if (!imgName) {
    thumb.classList.remove('show');
    thumb.removeAttribute('src');
    thumb.removeAttribute('data-full');
    return;
  }
  const url = buildImageUrl(split, imgName);
  thumb.src = url;
  thumb.dataset.full = url;
  thumb.classList.add('show');
}

// Abrir / cerrar lightbox
document.getElementById('imgThumb')?.addEventListener('click', () => {
  const full = document.getElementById('imgFull');
  full.src = document.getElementById('imgThumb').dataset.full || '';
  document.getElementById('imgLightbox').classList.remove('hidden');
});

function closePreview(e) {
  e.stopPropagation();
  document.getElementById('imgLightbox').classList.add('hidden');
}

// Reaccionar a cambios del split y de la imagen
document.getElementById('splitSelect')?.addEventListener('change', () => {
  // si al cambiar split recargas las opciones de imágenes vía fetch,
  // llama a updatePreview() después de rellenar el <select>.
  setTimeout(updatePreview, 0);
});
document.getElementById('imageSelect')?.addEventListener('change', updatePreview);

// Llamada inicial (cuando ya llenaste el select de imágenes)
window.addEventListener('DOMContentLoaded', () => {
  // si ya cargas la lista vía /annotate/images, invoca updatePreview al terminar.
  updatePreview();
});
