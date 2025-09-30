let currentSplit = null;
let currentIndex = 0;
const datasetCache = { train: [], valid: [], test: [] };

function openDsLightbox(split, index) {
  currentSplit = split;
  currentIndex = index;

  const img = document.getElementById('dsLightboxImg');
  img.src = datasetCache[split][index].url;
  document.getElementById('dsLightbox').classList.add('show');
}

function closeDsLightbox() {
  document.getElementById('dsLightbox').classList.remove('show');
  currentSplit = null;
  currentIndex = 0;
}

function prevImage() {
  if (!currentSplit) return;
  currentIndex = (currentIndex - 1 + datasetCache[currentSplit].length) % datasetCache[currentSplit].length;
  document.getElementById('dsLightboxImg').src = datasetCache[currentSplit][currentIndex].url;
}

function nextImage() {
  if (!currentSplit) return;
  currentIndex = (currentIndex + 1) % datasetCache[currentSplit].length;
  document.getElementById('dsLightboxImg').src = datasetCache[currentSplit][currentIndex].url;
}

window.addEventListener('keydown', (ev) => {
  if (!currentSplit) return;
  if (ev.key === 'Escape') closeDsLightbox();
  if (ev.key === 'ArrowLeft') prevImage();
  if (ev.key === 'ArrowRight') nextImage();
});

async function fetchDataset() {
  const res = await fetch('/dataset/list');
  if (!res.ok) return;
  const data = await res.json();
  datasetCache.train = data.train.items;
  datasetCache.valid = data.valid.items;
  datasetCache.test  = data.test.items;

  renderSplit('train', data.train);
  renderSplit('valid', data.valid);
  renderSplit('test',  data.test);
}

function renderSplit(split, payload) {
  const grid = document.getElementById(`grid-${split}`);
  const count = document.getElementById(`count-${split}`);
  grid.innerHTML = '';
  count.textContent = `(${payload.count})`;

  (payload.items || []).forEach((it, idx) => {
    const card = document.createElement('div');
    card.className = 'thumb';
    card.innerHTML = `
      <img src="${it.url}" alt="${it.name}" loading="lazy">
      <div class="name" title="${it.name}">${it.name}</div>
    `;
    card.onclick = () => openDsLightbox(split, idx);
    grid.appendChild(card);
  });
}

async function openAll(split) {
  try {
    const res = await fetch(`/dataset/open_folder/${split}`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(`No se pudo abrir la carpeta: ${err.error || res.statusText}`);
      return;
    }
    console.log(`Carpeta de ${split} abierta en el sistema`);
  } catch (e) {
    alert(`Error de red: ${e}`);
  }
}

/* =========================
   SUBIDA POR SPLIT
   ========================= */

// Dispara el input oculto del split
function triggerUpload(split) {
  const input = document.getElementById(`upload-${split}`);
  if (!input) return;
  input.value = ''; // reset para que pueda seleccionar lo mismo
  input.click();
}

// Maneja el change de cada input oculto
function attachUploadHandlers() {
  ['train', 'valid', 'test'].forEach(split => {
    const input = document.getElementById(`upload-${split}`);
    if (!input) return;
    input.addEventListener('change', async (ev) => {
      const files = Array.from(ev.target.files || []);
      if (!files.length) return;
      await doUpload(split, files);
    });
  });
}

// Sube los ficheros al endpoint del split
async function doUpload(split, files) {
  const form = new FormData();
  files.forEach(file => form.append('files[]', file));

  // deshabilitar botones mientras sube
  const panel = document.querySelector(`#grid-${split}`).closest('.panel');
  const btns = panel.querySelectorAll('.toolbar button');
  btns.forEach(b => b.disabled = true);

  try {
    const res = await fetch(`/dataset/upload/${split}`, {
      method: 'POST',
      body: form
    });

    let payload = {};
    try { payload = await res.json(); } catch (_) {}

    if (!res.ok || payload.ok === false) {
      const msg = payload.error || res.statusText || 'Fallo subiendo archivos';
      alert(`Error al subir a ${split}: ${msg}`);
      return;
    }

    // Refresca conteo y grillas
    await fetchDataset();

    // Aviso corto
    const added = payload.added ?? files.length;
    console.log(`Subida a ${split} completada. Añadidos: ${added}`);
  } catch (e) {
    alert(`Error de red subiendo a ${split}: ${e}`);
  } finally {
    btns.forEach(b => b.disabled = false);
  }
}

document.getElementById('refreshBtn')?.addEventListener('click', fetchDataset);
window.addEventListener('DOMContentLoaded', () => {
  fetchDataset();
  attachUploadHandlers();
});
