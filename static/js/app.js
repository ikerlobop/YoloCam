// ======= Reloj =======
function updateTime(){
  const now=new Date();
  const el=document.getElementById('currentTime');
  if(el) el.textContent=now.toTimeString().slice(0,8);
}
setInterval(updateTime,1000); updateTime();

// ======= Operario desde /me =======
async function fillOperator(){
  try{
    const r = await fetch('/me');
    const u = await r.json();
    if(u.auth){
      const avatar = document.querySelector('.operator-avatar');
      const nameEl = document.querySelector('.operator-name');
      const roleEl = document.querySelector('.operator-role');
      if(avatar && u.name){
        const ini = u.name.split(' ').map(s=>s[0]).filter(Boolean).slice(0,2).join('').toUpperCase();
        avatar.textContent = ini || 'OP';
      }
      if(nameEl) nameEl.textContent = u.name || 'Operario';
      if(roleEl) roleEl.textContent = u.role || '—';
    }
  }catch(e){ console.warn('no /me', e); }
}

// ======= Grid vacío inicial =======
const grid = document.getElementById('grid');
const scanOverlay = document.getElementById('scanOverlay');

function emptyGrid(){
  const overlay = document.getElementById('scanOverlay');
  grid.textContent = '';
  grid.appendChild(overlay);

  for(let i=0;i<5;i++){
    const cell=document.createElement('div');
    cell.className='cell';
    const span=document.createElement('div');
    span.className='slot';
    span.textContent='Slot '+String(i+1).padStart(2,'0');
    cell.appendChild(span);
    grid.appendChild(cell);
  }

  const row2=document.createElement('div');
  row2.className='grid-row-2';
  for(let i=5;i<10;i++){
    const cell=document.createElement('div');
    cell.className='cell';
    const span=document.createElement('div');
    span.className='slot';
    span.textContent='Slot '+String(i+1).padStart(2,'0');
    cell.appendChild(span);
    row2.appendChild(cell);
  }
  grid.appendChild(row2);
}
emptyGrid();

// ======= Lightbox =======
function openLightbox(src){
  const lb = document.getElementById('lightbox');
  const img = document.getElementById('lightboxImg');
  if(img) img.src = src;
  lb.classList.remove('hidden');
}
function closeLightbox(ev){
  if(ev && ev.target && ev.target.id === 'lightboxImg') return;
  document.getElementById('lightbox').classList.add('hidden');
}
window.closeLightbox = closeLightbox; // para el onclick del botón X

// ======= Biblioteca =======
function renderLibrary(urls){
  const thumbs = document.getElementById('thumbs');
  thumbs.innerHTML = '';
  urls.forEach(u=>{
    const img = document.createElement('img');
    img.className = 'thumb';
    img.src = u + '?t=' + Date.now();
    img.alt = 'Captura';
    img.addEventListener('click', ()=> openLightbox(u));
    thumbs.appendChild(img);
  });
}

// ======= Overlay helpers =======
function getCellAt(index){
  const cells = grid.querySelectorAll('.cell');
  return cells[index] || null;
}

function moveScanOverlayToCell(index){
  const cell = getCellAt(index);
  if(!cell){ hideScanOverlay(); return; }

  const refRect  = grid.getBoundingClientRect();
  const cellRect = cell.getBoundingClientRect();

  const w  = cellRect.width;
  const h  = cellRect.height;
  const dx = cellRect.left - refRect.left;
  const dy = cellRect.top  - refRect.top;

  scanOverlay.style.width  = w + 'px';
  scanOverlay.style.height = h + 'px';
  scanOverlay.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
  scanOverlay.classList.remove('hidden');
}

function hideScanOverlay(){
  scanOverlay.classList.add('hidden');
}

// ======= Polling =======
let poller = null;
let lastActiveIndex = -1;

async function fetchState(){
  try{
    const res=await fetch('/state');
    const data=await res.json();

    const cells=Array.from(grid.querySelectorAll('.cell'));
    for(let i=0;i<10;i++){
      const cell=cells[i];
      cell.innerHTML='';
      if(i < data.images.length){
        const img=document.createElement('img');
        img.src=data.images[i]+'?t='+Date.now();
        img.alt='Captura '+(i+1);
        cell.appendChild(img);
      }else{
        const span=document.createElement('div');
        span.className='slot';
        span.textContent='Slot '+String(i+1).padStart(2,'0');
        cell.appendChild(span);
      }
    }

    renderLibrary(data.images);

    let activeIndex = (data.running && data.images.length>0)
                      ? Math.min(data.images.length-1, 9)
                      : -1;

    if(activeIndex !== -1){
      if(activeIndex !== lastActiveIndex){
        moveScanOverlayToCell(activeIndex);
        lastActiveIndex = activeIndex;
      }else{
        moveScanOverlayToCell(activeIndex);
      }
    }else{
      hideScanOverlay();
      lastActiveIndex = -1;
    }

    if(data.stopped){ stopPolling(); }
  }catch(e){
    console.warn('Error fetch /state',e);
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
  cells.forEach((cell, i)=>{
    cell.innerHTML='';
    const span=document.createElement('div');
    span.className='slot';
    span.textContent='Slot '+String(i+1).padStart(2,'0');
    cell.appendChild(span);
  });
  renderLibrary([]);
  hideScanOverlay();
  lastActiveIndex=-1;
}

// ======= Capas =======
async function refreshLayersOnce() {
  try {
    const r = await fetch('/layers');
    const j = await r.json();
    const lc = document.getElementById('layerCurrent');
    const lt = document.getElementById('layerTotal');
    if(lc) lc.textContent = j.current ?? 0;
    if(lt) lt.textContent = j.total ?? 0;
  } catch(e) { console.warn('layers', e); }
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
      if(lc) lc.textContent = data.layer_current;
    }
    if (data.layer_total !== undefined) {
      const lt = document.getElementById('layerTotal');
      if(lt) lt.textContent = data.layer_total;
    }

    if (data.status === 'started' || data.status === 'already_running') {
      if (startBtn) { startBtn.textContent = '✅ Captura en marcha'; }
      await bootPollingIfNeeded();
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

async function resetLayers(){
  try{
    const r = await fetch('/reset_layers', {method:'POST'});
    const j = await r.json();
    if(j.status === 'layers_reset'){
      const lc = document.getElementById('layerCurrent');
      const lt = document.getElementById('layerTotal');
      if(lc) lc.textContent = j.current ?? 0;
      if(lt) lt.textContent = j.total ?? 0;
    }
  }catch(e){ console.warn('reset_layers', e); }
}

// Enganchar listeners
document.addEventListener('DOMContentLoaded', ()=>{
  fillOperator();
  refreshLayersOnce();

  const startBtn = document.getElementById('startBtn');
  const resetBtn = document.getElementById('resetBtn');
  const resetLayersBtn = document.getElementById('resetLayersBtn');

  if(startBtn) startBtn.addEventListener('click', startCapture);
  if(resetBtn) resetBtn.addEventListener('click', resetCapture);
  if(resetLayersBtn) resetLayersBtn.addEventListener('click', resetLayers);
});
