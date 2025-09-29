// --- refs UI ---
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

const classSelect = document.getElementById('classSelect');

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
splitSelect.addEventListener('change', loadImageList);

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

// zoom
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

// rueda
tCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 1/1.1;
  zoomAt(factor, tMouseX, tMouseY);
}, {passive:false});

// edición
undoBoxBtn.addEventListener('click', () => { tBoxes.pop(); redrawTrain(); });
clearBoxesBtn.addEventListener('click', () => { tBoxes = []; redrawTrain(); });

// guardar
saveAnnBtn?.addEventListener('click', async () => {
  if (!tLoaded || !currentImage) { alert("Carga una imagen."); return; }
  const label = classSelect?.value;
  if (!label) { alert("No hay clases disponibles (revisa classes.txt)."); return; }

  const payload = { split: currentSplit, image: currentImage, label, boxes: tBoxes };
  const resp = await fetch('/annotate/save', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });
  const data = await resp.json();
  if (resp.ok) alert(`Etiquetas guardadas: ${data.saved}`);
  else alert(`Error: ${data.error || 'fallo al guardar'}`);
});

// init
window.addEventListener('DOMContentLoaded', () => {
  loadClasses();
  loadImageList();
});

