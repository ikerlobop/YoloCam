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
    // opcional: feedback sutil
    console.log(`Carpeta de ${split} abierta en el sistema`);
  } catch (e) {
    alert(`Error de red: ${e}`);
  }
}


document.getElementById('refreshBtn')?.addEventListener('click', fetchDataset);
window.addEventListener('DOMContentLoaded', fetchDataset);
