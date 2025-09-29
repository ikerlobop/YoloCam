async function fetchDataset() {
  const res = await fetch('/dataset/list');
  if (!res.ok) return;
  const data = await res.json();
  renderSplit('train', data.train);
  renderSplit('valid', data.valid);
  renderSplit('test',  data.test);
}

function renderSplit(split, payload) {
  const grid = document.getElementById(`grid-${split}`);
  const count = document.getElementById(`count-${split}`);
  grid.innerHTML = '';
  count.textContent = `(${payload.count})`;
  (payload.items || []).forEach(it => {
    const card = document.createElement('div');
    card.className = 'thumb';
    card.innerHTML = `
      <img src="${it.url}" alt="${it.name}" loading="lazy">
      <div class="name" title="${it.name}">${it.name}</div>
    `;
    card.onclick = () => window.open(it.url, '_blank');
    grid.appendChild(card);
  });
}

function openAll(split) {
  // Abre la carpeta virtual (mostrando una imagen) — opcional
  const first = document.querySelector(`#grid-${split} img`);
  if (first) window.open(first.src, '_blank');
}

document.getElementById('refreshBtn')?.addEventListener('click', fetchDataset);
window.addEventListener('DOMContentLoaded', fetchDataset);
