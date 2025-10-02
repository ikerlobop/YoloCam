    // =========================
    // Dataset Browser + BBoxes
    // =========================

    let currentSplit = null;
    let currentIndex = 0;
    const datasetCache = { train: [], valid: [], test: [] };
    
    // Almacenar selecciones
    const selectedImages = {
      train: new Set(),
      valid: new Set(),
      test: new Set()
    };

    // ====== Clases con color (como Training) ======
    let classMeta = []; // [{name, color}]
    const SUGGESTED_PALETTE = [
      "#ff3b30","#ff9500","#ffcc00","#34c759",
      "#00c7be","#30b0ff","#007aff","#5856d6",
      "#af52de","#ff2d55","#64d2ff","#ffd60a"
    ];
    const defaultColorForIndex = (i)=> SUGGESTED_PALETTE[i % SUGGESTED_PALETTE.length];
    const getClassName  = (i)=> classMeta?.[i]?.name  ?? String(i);
    const getClassColor = (i)=> classMeta?.[i]?.color ?? defaultColorForIndex(i);

    async function loadClassesMetaOnce(){
      try{
        const r = await fetch('/annotate/classes_meta', {cache:'no-store'});
        if (r.ok) {
          const data = await r.json();
          if (Array.isArray(data.classes) && data.classes.length) {
            classMeta = data.classes.map((c,i)=>({
              name: String(c.name ?? `class_${i}`),
              color: String(c.color ?? defaultColorForIndex(i))
            }));
            return;
          }
        }
      }catch{}
      // Fallback a /annotate/classes (solo nombres)
      try{
        const r = await fetch('/annotate/classes', {cache:'no-store'});
        if (r.ok) {
          const data = await r.json();
          const names = Array.isArray(data.classes) ? data.classes : [];
          classMeta = names.map((n,i)=>({ name:n, color: defaultColorForIndex(i) }));
          return;
        }
      }catch{}
      // Último recurso
      classMeta = [{name:'defecto', color:'#ff3b30'}];
    }

    // ====== YOLO helpers (como Training) ======
    function buildLabelUrl(split, imageName){
      const stem = imageName.replace(/\.[^.]+$/, '');
      return `/static/dataset/${split}/labels/${encodeURIComponent(stem)}.txt`;
    }

    async function fetchYoloLabels(split, imageName){
      try{
        const res = await fetch(buildLabelUrl(split, imageName), {cache:'no-store'});
        if (!res.ok) return [];
        const txt = await res.text();
        return txt
          .split(/\r?\n/).map(l=>l.trim()).filter(Boolean)
          .map(l => {
            const [cls, cx, cy, w, h] = l.split(/[\s,]+/).map(Number);
            return { cls, cx, cy, w, h };
          });
      }catch{ return []; }
    }

    function yoloToXYWH(label, iw, ih){
      return {
        x: (label.cx - label.w/2) * iw,
        y: (label.cy - label.h/2) * ih,
        w: label.w * iw,
        h: label.h * ih,
        cls: label.cls
      };
    }

    // ====== Overlay genérico (igual a Training) ======
    function hexToRgba(hex, a=1){
      const h = hex.replace('#','');
      const full = h.length===3 ? h.split('').map(c=>c+c).join('') : h;
      const n = parseInt(full,16);
      const r = (n>>16)&255, g = (n>>8)&255, b = n&255;
      return `rgba(${r},${g},${b},${a})`;
    }

    /**
     * Dibuja boxes dentro de `container` ajustándose como object-fit: contain
     * - container: nodo contenedor (debe ser position:relative)
     * - img: <img> ya cargado
     * - boxesPx: [{x,y,w,h,cls}] en píxeles de la imagen original
     * - opts: {labelNames:string[], colorsByIndex:string[]}
     */
    function drawOverlayBoxes(container, img, boxesPx, {labelNames=[], colorsByIndex=null}={}){
      if (!img.naturalWidth || !img.naturalHeight) return;

      let overlay = container.querySelector('.bbox-layer');
      if (!overlay){
        overlay = document.createElement('div');
        overlay.className = 'bbox-layer';
        container.appendChild(overlay);
      }
      overlay.innerHTML = '';

      const cw = container.clientWidth, ch = container.clientHeight;
      const iw = img.naturalWidth,  ih = img.naturalHeight;
      const scale = Math.min(cw/iw, ch/ih);
      const dispW = iw*scale, dispH = ih*scale;
      const offX = (cw - dispW)/2;
      const offY = (ch - dispH)/2;

      overlay.style.left = offX + 'px';
      overlay.style.top  = offY + 'px';
      overlay.style.width  = dispW + 'px';
      overlay.style.height = dispH + 'px';

      boxesPx.forEach(b=>{
        const bx = b.x * scale, by = b.y * scale, bw = b.w * scale, bh = b.h * scale;

        const node = document.createElement('div');
        node.className = 'bbox';
        node.style.left   = `${bx}px`;
        node.style.top    = `${by}px`;
        node.style.width  = `${bw}px`;
        node.style.height = `${bh}px`;

        const color = colorsByIndex ? colorsByIndex[b.cls] : null;
        if (color){
          node.style.borderColor = color;
          node.style.boxShadow = `0 0 4px ${hexToRgba(color,.35)}`;
        }

        const lbl = document.createElement('div');
        lbl.className = 'bbox-label';
        const clsName = (labelNames[b.cls] ?? String(b.cls));
        lbl.textContent = clsName;
        if (color) lbl.style.background = color;
        node.appendChild(lbl);

        overlay.appendChild(node);
      });
    }

    // =========================
    // Selección múltiple
    // =========================
    function toggleSelection(split, imageName, checkbox) {
      if (checkbox.checked) {
        selectedImages[split].add(imageName);
        checkbox.parentElement.classList.add('selected');
      } else {
        selectedImages[split].delete(imageName);
        checkbox.parentElement.classList.remove('selected');
      }
      
      updateSelectionUI(split);
    }

    function updateSelectionUI(split) {
      const count = selectedImages[split].size;
      const countElement = document.getElementById(`selection-count-${split}`);
      const deleteButton = document.getElementById(`delete-${split}`);
      
      if (countElement) {
        countElement.textContent = `${count} seleccionada${count !== 1 ? 's' : ''}`;
      }
      
      if (deleteButton) {
        deleteButton.disabled = count === 0;
      }
    }

    function clearSelection(split) {
      selectedImages[split].clear();
      
      // Limpiar selecciones visuales
      const grid = document.getElementById(`grid-${split}`);
      if (grid) {
        const checkboxes = grid.querySelectorAll('.thumb-checkbox');
        checkboxes.forEach(cb => {
          cb.checked = false;
          cb.parentElement.classList.remove('selected');
        });
      }
      
      updateSelectionUI(split);
    }

    // =========================
    // Eliminación de imágenes
    // =========================
    async function deleteSelected(split) {
      const selected = Array.from(selectedImages[split]);
      if (selected.length === 0) return;
      
      if (!confirm(`¿Estás seguro de que quieres eliminar ${selected.length} imagen(es) del conjunto ${split}?`)) {
        return;
      }
      
      try {
        const response = await fetch(`/dataset/delete/${split}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ images: selected })
        });
        
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.message || `Error ${response.status}`);
        }
        
        // Actualizar la vista
        await fetchDataset();
        clearSelection(split);
        
      } catch (error) {
        alert(`Error al eliminar imágenes: ${error.message}`);
      }
    }

    // =========================
    // Lightbox
    // =========================
    function openDsLightbox(split, index) {
      currentSplit = split;
      currentIndex = index;

      const img = document.getElementById('dsLightboxImg');
      const modal = document.getElementById('dsLightbox');

      img.onload = async () => {
        const name = datasetCache[split][index].name;
        const labels = await fetchYoloLabels(split, name);
        const iw = img.naturalWidth, ih = img.naturalHeight;
        const boxesPx = (iw && ih) ? labels.map(l => yoloToXYWH(l, iw, ih)) : [];
        const container = img.closest('.modal-inner');
        const colors = classMeta.map(c=>c.color);
        const names  = classMeta.map(c=>c.name);
        drawOverlayBoxes(container, img, boxesPx, { labelNames:names, colorsByIndex:colors });
      };

      img.src = datasetCache[split][index].url;
      modal.classList.add('show');
    }

    function closeDsLightbox() {
      document.getElementById('dsLightbox').classList.remove('show');
      currentSplit = null;
      currentIndex = 0;
    }

    async function refreshLightboxOverlay(){
      const modal = document.getElementById('dsLightbox');
      if (!modal.classList.contains('show') || !currentSplit) return;
      const img = document.getElementById('dsLightboxImg');
      const container = img.closest('.modal-inner');
      if (!img.naturalWidth) return;

      const name = datasetCache[currentSplit][currentIndex].name;
      const labels = await fetchYoloLabels(currentSplit, name);
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const boxesPx = (iw && ih) ? labels.map(l => yoloToXYWH(l, iw, ih)) : [];
      const colors = classMeta.map(c=>c.color);
      const names  = classMeta.map(c=>c.name);
      drawOverlayBoxes(container, img, boxesPx, { labelNames:names, colorsByIndex:colors });
    }

    function prevImage() {
      if (!currentSplit) return;
      currentIndex = (currentIndex - 1 + datasetCache[currentSplit].length) % datasetCache[currentSplit].length;
      const img = document.getElementById('dsLightboxImg');
      img.onload = refreshLightboxOverlay;
      img.src = datasetCache[currentSplit][currentIndex].url;
    }

    function nextImage() {
      if (!currentSplit) return;
      currentIndex = (currentIndex + 1) % datasetCache[currentSplit].length;
      const img = document.getElementById('dsLightboxImg');
      img.onload = refreshLightboxOverlay;
      img.src = datasetCache[currentSplit][currentIndex].url;
    }

    window.addEventListener('keydown', (ev) => {
      if (!currentSplit) return;
      if (ev.key === 'Escape') closeDsLightbox();
      if (ev.key === 'ArrowLeft')  prevImage();
      if (ev.key === 'ArrowRight') nextImage();
    });
    window.addEventListener('resize', refreshLightboxOverlay);

    // =========================
    // Dataset fetch + render
    // =========================
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
      const grid  = document.getElementById(`grid-${split}`);
      const count = document.getElementById(`count-${split}`);
      grid.innerHTML = '';
      count.textContent = `(${payload.count})`;

      (payload.items || []).forEach((it, idx) => {
        const card = document.createElement('div');
        card.className = 'thumb';
        card.style.position = 'relative';
        card.innerHTML = `
          <input type="checkbox" class="thumb-checkbox" onchange="toggleSelection('${split}', '${it.name}', this)">
          <img src="${it.url}" alt="${it.name}" loading="lazy">
          <div class="name" title="${it.name}">${it.name}</div>
        `;
        
        // Click en la imagen abre el lightbox
        const img = card.querySelector('img');
        img.onclick = () => openDsLightbox(split, idx);
        
        // Click en el nombre también abre el lightbox
        const name = card.querySelector('.name');
        name.onclick = () => openDsLightbox(split, idx);
        
        grid.appendChild(card);

        const ensureOverlay = async () => {
          if (!img.naturalWidth) return;
          const labels = await fetchYoloLabels(split, it.name);
          if (!labels.length) { 
            const ov = card.querySelector('.bbox-layer'); 
            if (ov) ov.innerHTML = ''; 
            return; 
          }
          const iw = img.naturalWidth, ih = img.naturalHeight;
          const boxesPx = labels.map(l => yoloToXYWH(l, iw, ih));
          const colors = classMeta.map(c=>c.color);
          const names  = classMeta.map(c=>c.name);
          drawOverlayBoxes(card, img, boxesPx, { labelNames:names, colorsByIndex:colors });
        };

        if (img.complete && img.naturalWidth) ensureOverlay();
        else img.addEventListener('load', ensureOverlay);
      });
      
      // Actualizar UI de selección
      updateSelectionUI(split);
    }

    // =========================
    // Abrir carpeta + uploads
    // =========================
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

    // Dispara el input oculto del split
    function triggerUpload(split) {
      const input = document.getElementById(`upload-${split}`);
      if (!input) return;
      input.value = '';
      input.click();
    }

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

    async function doUpload(split, files) {
      const form = new FormData();
      files.forEach(file => form.append('files[]', file));
      const panel = document.querySelector(`#grid-${split}`).closest('.panel');
      const btns = panel.querySelectorAll('.toolbar button');
      btns.forEach(b => b.disabled = true);

      try {
        const res = await fetch(`/dataset/upload/${split}`, { method:'POST', body: form });
        let payload = {}; try{ payload = await res.json(); }catch{}
        if (!res.ok || payload.ok === false) {
          const msg = payload.error || res.statusText || 'Fallo subiendo archivos';
          alert(`Error al subir a ${split}: ${msg}`); return;
        }
        await fetchDataset(); // re-render y re-overlays
      } catch (e) {
        alert(`Error de red subiendo a ${split}: ${e}`);
      } finally {
        btns.forEach(b => b.disabled = false);
      }
    }

    // =========================
    // INIT
    // =========================
    document.getElementById('refreshBtn')?.addEventListener('click', fetchDataset);
    window.addEventListener('DOMContentLoaded', async () => {
      await loadClassesMetaOnce();
      await fetchDataset();
      attachUploadHandlers();
    });