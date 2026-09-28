(function() {
  const uploadZone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');
  const status = document.getElementById('status');
  const sectionSelect = document.getElementById('section-select');
  const spectroWrap = document.getElementById('spectro-wrap');
  const spectroCanvas = document.getElementById('spectro-canvas');
  const selectionBox = document.getElementById('selection-box');
  const timelineWrap = document.getElementById('timeline-wrap');
  const timelineCanvas = document.getElementById('timeline-canvas');
  const timelineSelection = document.getElementById('timeline-selection');
  const ringControls = document.getElementById('ring-controls');
  const ringSizeSelect = document.getElementById('ring-size');
  const ringSizeMm = document.getElementById('ring-size-mm');
  const BAND_WIDTH_MM = 7.5;
  const BAND_THICK_MM = 0.6;
  const reliefHeight = document.getElementById('relief-height');
  const reliefHeightOut = document.getElementById('relief-height-out');
  const reliefSmooth = document.getElementById('relief-smooth');
  const reliefSmoothOut = document.getElementById('relief-smooth-out');
  const generateBtn = document.getElementById('generate-btn');
  const canvasWrap = document.getElementById('canvas-wrap');
  const exportRow = document.getElementById('export-row');
  const exportBtn = document.getElementById('export-btn');

  uploadZone.addEventListener('click', () => fileInput.click());

  const FREQ_BINS = 400;
  const TIME_STEPS = 600;
  let spectro = [];
  let maxVal = 1;
  let selRect = null;
  let waveformPeaks = [];
  let durationSec = 0;

  const tcStart = document.getElementById('tc-start');
  const tcEnd = document.getElementById('tc-end');
  const tcApply = document.getElementById('tc-apply');
  const tcReset = document.getElementById('tc-reset');
  const tcDuration = document.getElementById('tc-duration');
  const spectroMaskLeft = document.getElementById('spectro-mask-left');
  const spectroMaskRight = document.getElementById('spectro-mask-right');
  const timelineMaskLeft = document.getElementById('timeline-mask-left');
  const timelineMaskRight = document.getElementById('timeline-mask-right');

  let lockedRange = null; 

  function getLockedPx(rectWidth) {
    if (!lockedRange) return { min: 0, max: rectWidth };
    return {
      min: (lockedRange.tCol0 / TIME_STEPS) * rectWidth,
      max: (lockedRange.tCol1 / TIME_STEPS) * rectWidth,
    };
  }

  function updateLockMasks() {
    const specRect = spectroCanvas.getBoundingClientRect();
    const timeRect = timelineCanvas.getBoundingClientRect();
    if (!lockedRange) {
      [spectroMaskLeft, spectroMaskRight, timelineMaskLeft, timelineMaskRight].forEach(el => el.style.display = 'none');
      return;
    }
    const sp = getLockedPx(specRect.width);
    spectroMaskLeft.style.display = 'block';
    spectroMaskLeft.style.left = '0px'; spectroMaskLeft.style.width = sp.min + 'px';
    spectroMaskRight.style.display = 'block';
    spectroMaskRight.style.left = sp.max + 'px'; spectroMaskRight.style.width = (specRect.width - sp.max) + 'px';

    const tl = getLockedPx(timeRect.width);
    timelineMaskLeft.style.display = 'block';
    timelineMaskLeft.style.left = '0px'; timelineMaskLeft.style.width = tl.min + 'px';
    timelineMaskRight.style.display = 'block';
    timelineMaskRight.style.left = tl.max + 'px'; timelineMaskRight.style.width = (timeRect.width - tl.max) + 'px';
  }

  function lockRange(tCol0, tCol1) {
    lockedRange = { tCol0, tCol1 };
    updateLockMasks();
  }

  tcReset.addEventListener('click', () => {
    lockedRange = null;
    updateLockMasks();
    tcStart.value = '0:00';
    tcEnd.value = formatTimecode(Math.min(durationSec, 5));
    tcDuration.textContent = durationSec ? `durée totale : ${formatTimecode(durationSec)}` : '';
    selectionBox.style.display = 'none';
    timelineSelection.style.display = 'none';
  });

  function syncTimecodeFields(tCol0, tCol1) {
    if (durationSec <= 0) return;
    const startSec = (tCol0 / TIME_STEPS) * durationSec;
    const endSec = (tCol1 / TIME_STEPS) * durationSec;
    tcStart.value = formatTimecode(startSec);
    tcEnd.value = formatTimecode(endSec);
    tcDuration.textContent = `zone : ${formatTimecode(startSec)} → ${formatTimecode(endSec)} (durée totale : ${formatTimecode(durationSec)})`;
  }

  function parseTimecode(str) {
    str = (str || '').trim();
    if (!str) return null;
    if (str.includes(':')) {
      const parts = str.split(':').map(s => parseFloat(s.replace(',', '.')));
      if (parts.some(isNaN)) return null;
      return parts.reduce((acc, v) => acc * 60 + v, 0);
    }
    const v = parseFloat(str.replace(',', '.'));
    return isNaN(v) ? null : v;
  }

  function formatTimecode(sec) {
    sec = Math.max(0, sec);
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(1).padStart(4, '0');
    return `${m}:${s}`;
  }

  function applyTimecodeSelection() {
    const startSec = parseTimecode(tcStart.value);
    const endSec = parseTimecode(tcEnd.value);
    if (startSec === null || endSec === null || endSec <= startSec || durationSec <= 0) {
      tcDuration.textContent = 'timecodes invalides — format: 1:23 ou secondes (ex: 83.5)';
      return;
    }
    const clampedStart = Math.max(0, Math.min(durationSec, startSec));
    const clampedEnd = Math.max(0, Math.min(durationSec, endSec));
    let tCol0 = Math.floor((clampedStart / durationSec) * TIME_STEPS);
    let tCol1 = Math.max(tCol0 + 1, Math.ceil((clampedEnd / durationSec) * TIME_STEPS));
    if (lockedRange) {
      tCol0 = Math.max(lockedRange.tCol0, Math.min(lockedRange.tCol1, tCol0));
      tCol1 = Math.max(lockedRange.tCol0, Math.min(lockedRange.tCol1, tCol1));
      if (tCol1 <= tCol0) tCol1 = Math.min(lockedRange.tCol1, tCol0 + 1);
    }
    selRect = { tCol0, tCol1, fRow0: 0, fRow1: FREQ_BINS };
    ringControls.style.display = 'block';

    const specRect = spectroCanvas.getBoundingClientRect();
    const specLeft = (tCol0 / TIME_STEPS) * specRect.width;
    const specRight = (tCol1 / TIME_STEPS) * specRect.width;
    selectionBox.style.display = 'block';
    selectionBox.style.left = specLeft + 'px';
    selectionBox.style.top = '0px';
    selectionBox.style.width = (specRight - specLeft) + 'px';
    selectionBox.style.height = specRect.height + 'px';

    const timelineRect = timelineCanvas.getBoundingClientRect();
    const timeLeft = (tCol0 / TIME_STEPS) * timelineRect.width;
    const timeRight = (tCol1 / TIME_STEPS) * timelineRect.width;
    timelineSelection.style.display = 'block';
    timelineSelection.style.left = timeLeft + 'px';
    timelineSelection.style.width = (timeRight - timeLeft) + 'px';

    const actualStart = (tCol0 / TIME_STEPS) * durationSec;
    const actualEnd = (tCol1 / TIME_STEPS) * durationSec;
    tcDuration.textContent = `zone : ${formatTimecode(actualStart)} → ${formatTimecode(actualEnd)} (durée totale : ${formatTimecode(durationSec)})`;
    lockRange(tCol0, tCol1);
  }
  tcApply.addEventListener('click', applyTimecodeSelection);
  [tcStart, tcEnd].forEach((el) => {
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyTimecodeSelection(); });
  });

  const RING_SIZES = [
    ['44', 14.0],['45', 14.4],['46', 14.7],['47', 15.0],['48', 15.3],
    ['49', 15.6],['50', 15.9],['51', 16.2],['52', 16.6],['53', 16.9],
    ['54', 17.2],['55', 17.5],['56', 17.8],['57', 18.1],['58', 18.5],
    ['59', 18.8],['60', 19.1],['61', 19.4],['62', 19.7],['63', 20.0]
  ];
  RING_SIZES.forEach(([label, mm]) => {
    const opt = document.createElement('option');
    opt.value = mm; opt.textContent = label;
    if (label === '54') opt.selected = true;
    ringSizeSelect.appendChild(opt);
  });
  function updateRingSizeLabel() {
    ringSizeMm.textContent = `${ringSizeSelect.value} mm de diamètre intérieur`;
  }
  ringSizeSelect.addEventListener('change', updateRingSizeLabel);
  updateRingSizeLabel();

  const SMOOTH_LABELS = ['aucun', 'léger', 'moyen', 'fort', 'très fort'];
  reliefHeight.addEventListener('input', () => { reliefHeightOut.textContent = reliefHeight.value + ' mm'; });
  reliefSmooth.addEventListener('input', () => { reliefSmoothOut.textContent = SMOOTH_LABELS[parseInt(reliefSmooth.value, 10)]; });

  function fft(real) {
    const n = real.length;
    const im = new Float32Array(n);
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [real[i], real[j]] = [real[j], real[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cwr = 1, cwi = 0;
        for (let j = 0; j < len / 2; j++) {
          const ur = real[i+j], ui = im[i+j];
          const vr = real[i+j+len/2]*cwr - im[i+j+len/2]*cwi;
          const vi = real[i+j+len/2]*cwi + im[i+j+len/2]*cwr;
          real[i+j] = ur+vr; im[i+j] = ui+vi;
          real[i+j+len/2] = ur-vr; im[i+j+len/2] = ui-vi;
          const nwr = cwr*wr - cwi*wi, nwi = cwr*wi + cwi*wr;
          cwr = nwr; cwi = nwi;
        }
      }
    }
    const mags = new Float32Array(n/2);
    for (let i = 0; i < n/2; i++) mags[i] = Math.sqrt(real[i]*real[i] + im[i]*im[i]);
    return mags;
  }

  async function processAudio(file) {
    status.style.display = 'block';
    status.textContent = 'Décodage audio...';
    const arrayBuffer = await file.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const data = audioBuffer.getChannelData(0);
    durationSec = audioBuffer.duration;
    tcStart.value = '0:00';
    tcEnd.value = formatTimecode(Math.min(durationSec, 5));
    tcDuration.textContent = `durée totale : ${formatTimecode(durationSec)}`;

    const wfSamplesPerBucket = Math.max(1, Math.floor(data.length / TIME_STEPS));
    waveformPeaks = [];
    for (let t = 0; t < TIME_STEPS; t++) {
      const start = t * wfSamplesPerBucket;
      let peak = 0;
      for (let i = 0; i < wfSamplesPerBucket; i++) {
        const idx = start + i;
        if (idx < data.length) { const v = Math.abs(data[idx]); if (v > peak) peak = v; }
      }
      waveformPeaks.push(peak);
    }

    status.textContent = 'Calcul du spectrogramme...';
    await new Promise(r => setTimeout(r, 30));

    const fftSize = 1024;
    const hop = Math.max(1, Math.floor(data.length / TIME_STEPS));
    spectro = [];
    maxVal = 0;

    for (let t = 0; t < TIME_STEPS; t++) {
      const start = t * hop;
      const frame = new Float32Array(fftSize);
      for (let i = 0; i < fftSize; i++) {
        const idx = start + i;
        const windowVal = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1));
        frame[i] = (idx < data.length ? data[idx] : 0) * windowVal;
      }
      const mags = fft(frame);
      const bins = [];
      for (let f = 0; f < FREQ_BINS; f++) {
        const logIdx = Math.floor(Math.pow(f / FREQ_BINS, 2.1) * (fftSize / 2));
        const v = mags[logIdx] || 0;
        bins.push(v);
        if (v > maxVal) maxVal = v;
      }
      spectro.push(bins);
      if (t % 40 === 0) { status.textContent = `Calcul du spectrogramme... ${Math.round(t/TIME_STEPS*100)}%`; await new Promise(r => setTimeout(r, 0)); }
    }

    status.style.display = 'none';
    sectionSelect.style.display = 'block';
    spectroWrap.style.display = 'block';
    timelineWrap.style.display = 'block';
    drawSpectrogram();
    drawTimeline();
  }

  function drawTimeline() {
    timelineCanvas.width = TIME_STEPS;
    timelineCanvas.height = 64;
    const ctx = timelineCanvas.getContext('2d');
    ctx.fillStyle = '#1a1a18';
    ctx.fillRect(0, 0, TIME_STEPS, 64);
    const mid = 32;
    ctx.fillStyle = '#5DCAA5';
    for (let t = 0; t < TIME_STEPS; t++) {
      const h = Math.max(1, waveformPeaks[t] * 30);
      ctx.fillRect(t, mid - h, 1, h * 2);
    }
  }

  function drawSpectrogram() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = spectroCanvas.getBoundingClientRect();
    spectroCanvas.width = TIME_STEPS;
    spectroCanvas.height = FREQ_BINS;
    const ctx = spectroCanvas.getContext('2d');
    const imgData = ctx.createImageData(TIME_STEPS, FREQ_BINS);
    for (let t = 0; t < TIME_STEPS; t++) {
      for (let f = 0; f < FREQ_BINS; f++) {
        const raw = spectro[t][f] / (maxVal || 1);
        const v = Math.log1p(raw * 30) / Math.log1p(30);
        const row = FREQ_BINS - 1 - f;
        const idx = (row * TIME_STEPS + t) * 4;
        let r, g, b;
        if (v < 0.4) { const k = v/0.4; r=20+15*k; g=25+30*k; b=35+30*k; }
        else if (v < 0.75) { const k=(v-0.4)/0.35; r=35-5*k; g=55+30*k; b=65-10*k; }
        else { const k=(v-0.75)/0.25; r=30+180*k; g=85+150*k; b=55+140*k; }
        imgData.data[idx] = r; imgData.data[idx+1] = g; imgData.data[idx+2] = b; imgData.data[idx+3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  let isSelecting = false, selStartX = 0, selStartY = 0;

  spectroCanvas.addEventListener('pointerdown', (e) => {
    isSelecting = true;
    const rect = spectroCanvas.getBoundingClientRect();
    const bounds = getLockedPx(rect.width);
    selStartX = Math.max(bounds.min, Math.min(bounds.max, e.clientX - rect.left));
    selStartY = e.clientY - rect.top;
    selectionBox.style.display = 'block';
    selectionBox.style.left = selStartX + 'px';
    selectionBox.style.top = selStartY + 'px';
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
  });
  window.addEventListener('pointermove', (e) => {
    if (!isSelecting) return;
    const rect = spectroCanvas.getBoundingClientRect();
    const bounds = getLockedPx(rect.width);
    let x = e.clientX - rect.left, y = e.clientY - rect.top;
    x = Math.max(bounds.min, Math.min(bounds.max, x));
    y = Math.max(0, Math.min(rect.height, y));
    const left = Math.min(x, selStartX), top = Math.min(y, selStartY);
    const w = Math.abs(x - selStartX), h = Math.abs(y - selStartY);
    selectionBox.style.left = left + 'px';
    selectionBox.style.top = top + 'px';
    selectionBox.style.width = w + 'px';
    selectionBox.style.height = h + 'px';
  });
  window.addEventListener('pointerup', (e) => {
    if (!isSelecting) return;
    isSelecting = false;
    const rect = spectroCanvas.getBoundingClientRect();
    const bounds = getLockedPx(rect.width);
    let x = e.clientX - rect.left, y = e.clientY - rect.top;
    x = Math.max(bounds.min, Math.min(bounds.max, x));
    y = Math.max(0, Math.min(rect.height, y));
    const left = Math.min(x, selStartX), top = Math.min(y, selStartY);
    const w = Math.abs(x - selStartX), h = Math.abs(y - selStartY);
    if (w < 8 || h < 8) { selectionBox.style.display = 'none'; return; }
    const tCol0 = Math.floor((left / rect.width) * TIME_STEPS);
    const tCol1 = Math.floor(((left + w) / rect.width) * TIME_STEPS);
    const fRow0 = Math.floor((top / rect.height) * FREQ_BINS);
    const fRow1 = Math.floor(((top + h) / rect.height) * FREQ_BINS);
    selRect = { tCol0, tCol1, fRow0: FREQ_BINS - fRow1, fRow1: FREQ_BINS - fRow0 };
    ringControls.style.display = 'block';
    syncTimecodeFields(tCol0, tCol1);
    lockRange(tCol0, tCol1);

    const timelineRect = timelineCanvas.getBoundingClientRect();
    const selLeftPx = (tCol0 / TIME_STEPS) * timelineRect.width;
    const selRightPx = (tCol1 / TIME_STEPS) * timelineRect.width;
    timelineSelection.style.display = 'block';
    timelineSelection.style.left = selLeftPx + 'px';
    timelineSelection.style.width = (selRightPx - selLeftPx) + 'px';
  });

  let isSelectingTimeline = false, timelineStartX = 0;

  timelineCanvas.addEventListener('pointerdown', (e) => {
    isSelectingTimeline = true;
    const rect = timelineCanvas.getBoundingClientRect();
    const bounds = getLockedPx(rect.width);
    timelineStartX = Math.max(bounds.min, Math.min(bounds.max, e.clientX - rect.left));
    timelineSelection.style.display = 'block';
    timelineSelection.style.left = timelineStartX + 'px';
    timelineSelection.style.width = '0px';
  });
  window.addEventListener('pointermove', (e) => {
    if (!isSelectingTimeline) return;
    const rect = timelineCanvas.getBoundingClientRect();
    const bounds = getLockedPx(rect.width);
    let x = Math.max(bounds.min, Math.min(bounds.max, e.clientX - rect.left));
    const left = Math.min(x, timelineStartX);
    const w = Math.abs(x - timelineStartX);
    timelineSelection.style.left = left + 'px';
    timelineSelection.style.width = w + 'px';

    const specRect = spectroCanvas.getBoundingClientRect();
    const specLeft = (left / rect.width) * specRect.width;
    const specW = (w / rect.width) * specRect.width;
    selectionBox.style.display = 'block';
    selectionBox.style.left = specLeft + 'px';
    selectionBox.style.top = '0px';
    selectionBox.style.width = specW + 'px';
    selectionBox.style.height = specRect.height + 'px';
  });
  window.addEventListener('pointerup', (e) => {
    if (!isSelectingTimeline) return;
    isSelectingTimeline = false;
    const rect = timelineCanvas.getBoundingClientRect();
    const bounds = getLockedPx(rect.width);
    let x = Math.max(bounds.min, Math.min(bounds.max, e.clientX - rect.left));
    const left = Math.min(x, timelineStartX);
    const w = Math.abs(x - timelineStartX);
    if (w < 4) { timelineSelection.style.display = 'none'; selectionBox.style.display = 'none'; return; }

    const tCol0 = Math.floor((left / rect.width) * TIME_STEPS);
    const tCol1 = Math.floor(((left + w) / rect.width) * TIME_STEPS);
    selRect = { tCol0, tCol1, fRow0: 0, fRow1: FREQ_BINS };
    ringControls.style.display = 'block';
    syncTimecodeFields(tCol0, tCol1);
    lockRange(tCol0, tCol1);

    const specRect = spectroCanvas.getBoundingClientRect();
    const specLeft = (tCol0 / TIME_STEPS) * specRect.width;
    const specRight = (tCol1 / TIME_STEPS) * specRect.width;
    selectionBox.style.display = 'block';
    selectionBox.style.left = specLeft + 'px';
    selectionBox.style.top = '0px';
    selectionBox.style.width = (specRight - specLeft) + 'px';
    selectionBox.style.height = specRect.height + 'px';

    const timeLeft = (tCol0 / TIME_STEPS) * rect.width;
    const timeRight = (tCol1 / TIME_STEPS) * rect.width;
    timelineSelection.style.left = timeLeft + 'px';
    timelineSelection.style.width = (timeRight - timeLeft) + 'px';
  });

  function extractSelectionHeights() {
    const tCols = Math.max(2, selRect.tCol1 - selRect.tCol0);
    const fRows = Math.max(2, selRect.fRow1 - selRect.fRow0);
    const heights = new Array(tCols * fRows);
    for (let r = 0; r < fRows; r++) {
      for (let c = 0; c < tCols; c++) {
        const t = selRect.tCol0 + c;
        const f = selRect.fRow0 + r;
        const raw = (spectro[t] && spectro[t][f] !== undefined) ? spectro[t][f] / (maxVal || 1) : 0;
        const v = Math.log1p(raw * 30) / Math.log1p(30);
        heights[r * tCols + c] = v;
      }
    }
    let minV = Infinity, maxVv = -Infinity;
    for (const v of heights) { if (v < minV) minV = v; if (v > maxVv) maxVv = v; }
    const range = (maxVv - minV) || 1;
    for (let i = 0; i < heights.length; i++) heights[i] = (heights[i] - minV) / range;
    return { heights, w: tCols, h: fRows };
  }

  let scene, camera, renderer, ringGroup;
  let rotY = 0.6, rotX = 0.4, dist = 70;
  let isDragging = false, lastX = 0, lastY = 0;
  let lastMeshData = null;

  function initThree() {
    const canvas = document.getElementById('three-canvas');
    const wrap = canvasWrap;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, wrap.clientWidth / wrap.clientHeight, 0.1, 2000);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setClearColor(0x2a2a28, 1);
    renderer.setSize(wrap.clientWidth, wrap.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const light1 = new THREE.DirectionalLight(0xffffff, 1.1);
    light1.position.set(1, 1.2, 0.8);
    scene.add(light1);
    const light2 = new THREE.DirectionalLight(0xffffff, 0.4);
    light2.position.set(-1, 0.4, -0.6);
    scene.add(light2);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    canvas.addEventListener('pointerdown', (e) => { isDragging = true; lastX = e.clientX; lastY = e.clientY; canvas.style.cursor = 'grabbing'; });
    window.addEventListener('pointerup', () => { isDragging = false; canvas.style.cursor = 'grab'; });
    window.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      rotY += (e.clientX - lastX) * 0.008;
      rotX += (e.clientY - lastY) * 0.008;
      rotX = Math.max(-1.3, Math.min(1.3, rotX));
      lastX = e.clientX; lastY = e.clientY;
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      dist = Math.max(20, Math.min(300, dist + e.deltaY * 0.08));
    }, { passive: false });

    animate();
  }

  function animate() {
    requestAnimationFrame(animate);
    if (!scene) return;
    camera.position.x = dist * Math.sin(rotY) * Math.cos(rotX);
    camera.position.z = dist * Math.cos(rotY) * Math.cos(rotX);
    camera.position.y = dist * Math.sin(rotX) + 5;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }

  function buildRingGeometry(innerDiamMm, widthMm, thickMm, reliefMm, selData) {
    const innerR = innerDiamMm / 2;
    const outerR = innerR + thickMm;
    const halfW = widthMm / 2;
    const RADIAL_SEG = 220;

    const { heights, w: relW, h: relH } = selData;

    const patchAngleFrac = 1.0;
    const patchStartSeg = Math.floor(RADIAL_SEG * (1 - patchAngleFrac) / 2);
    const patchSegCount = RADIAL_SEG - patchStartSeg * 2;
    const patchHalfWidth = halfW;

    const positions = [];
    const normals = [];
    const indices = [];

    const FADE_FRAC = 0.18; 
    function fade(t) { return t*t*t*(t*(t*6-15)+10); }
    function lerp(a, b, t) { return a + t * (b - a); }
    function grad(hash, x, y) {
      const h = hash & 3;
      const u = h < 2 ? x : y, v = h < 2 ? y : x;
      return ((h & 1) ? -u : u) + ((h & 2) ? -2*v : 2*v);
    }
    const permTable = (() => {
      const p = new Uint8Array(256);
      for (let i = 0; i < 256; i++) p[i] = i;
      let seed = 1234567;
      for (let i = 255; i > 0; i--) {
        seed = (seed * 16807) % 2147483647;
        const j = seed % (i + 1);
        const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
      }
      const perm = new Uint8Array(512);
      for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
      return perm;
    })();
    function perlin2(x, y) {
      const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
      const xf = x - Math.floor(x), yf = y - Math.floor(y);
      const u = fade(xf), v = fade(yf);
      const aa = permTable[permTable[X] + Y], ab = permTable[permTable[X] + Y + 1];
      const ba = permTable[permTable[X + 1] + Y], bb = permTable[permTable[X + 1] + Y + 1];
      const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
      const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
      return lerp(x1, x2, v);
    }

    function sampleHeightsBilinear(u, v) {
      const fx = u * (relW - 1), fy = v * (relH - 1);
      const c0 = Math.max(0, Math.min(relW - 1, Math.floor(fx)));
      const c1 = Math.max(0, Math.min(relW - 1, c0 + 1));
      const r0 = Math.max(0, Math.min(relH - 1, Math.floor(fy)));
      const r1 = Math.max(0, Math.min(relH - 1, r0 + 1));
      const tx = fx - c0, ty = fy - r0;
      const h00 = heights[r0 * relW + c0], h10 = heights[r0 * relW + c1];
      const h01 = heights[r1 * relW + c0], h11 = heights[r1 * relW + c1];
      const top = lerp(h00, h10, tx), bot = lerp(h01, h11, tx);
      return lerp(top, bot, ty);
    }

    function relielRaw(segIdx, axialFrac) {
  
      if (segIdx < patchStartSeg || segIdx >= patchStartSeg + patchSegCount) return 0;
      const u = (segIdx - patchStartSeg) / (patchSegCount - 1); 
      const v = (axialFrac + 1) / 2; 
      const base = sampleHeightsBilinear(u, v);

      const nx = u * relW * 0.35, ny = v * relH * 0.35;
      const n1 = perlin2(nx, ny);
      const n2 = perlin2(nx * 2.3 + 11, ny * 2.3 + 7) * 0.5;
      const n3 = perlin2(nx * 4.7 + 31, ny * 4.7 + 17) * 0.25;
      const noiseAmt = 0.09 * (0.4 + base);
      const noisy = base + (n1 + n2 + n3) * noiseAmt;

      const fadeV = Math.min(1, Math.min(v, 1 - v) / FADE_FRAC);
      const smoothFadeV = fadeV * fadeV * (3 - 2 * fadeV);

      return noisy * smoothFadeV;
    }

    function relielAt(segIdx, axialFrac) {
      if (patchAngleFrac >= 0.999) {
        const SEAM_BLEND_SEG = Math.max(1, Math.round(RADIAL_SEG * 0.035));
        const seg = ((segIdx % RADIAL_SEG) + RADIAL_SEG) % RADIAL_SEG;
        if (seg < SEAM_BLEND_SEG) {
          const t = seg / SEAM_BLEND_SEG; 
          const smoothT = t * t * (3 - 2 * t);
          const vEnd = relielRaw(RADIAL_SEG - SEAM_BLEND_SEG + seg, axialFrac);
          const vStart = relielRaw(SEAM_BLEND_SEG + seg, axialFrac);
          return lerp(vEnd, vStart, smoothT);
        }
        if (seg >= RADIAL_SEG - SEAM_BLEND_SEG) {
          const t = (seg - (RADIAL_SEG - SEAM_BLEND_SEG)) / SEAM_BLEND_SEG;
          const smoothT = t * t * (3 - 2 * t);
          const vHere = relielRaw(seg, axialFrac);
          const vStart = relielRaw(SEAM_BLEND_SEG, axialFrac);
          return lerp(vHere, vStart, smoothT);
        }
        return relielRaw(seg, axialFrac);
      }
      if (segIdx < patchStartSeg || segIdx >= patchStartSeg + patchSegCount) return 0;
      const u = (segIdx - patchStartSeg) / (patchSegCount - 1); // 0..1 along time
      const v = (axialFrac + 1) / 2; // 0..1 along freq
      const base = sampleHeightsBilinear(u, v);

      // organic gradient noise layered on top of the real data, multi-octave, breaks up the grid-like look
      const nx = u * relW * 0.35, ny = v * relH * 0.35;
      const n1 = perlin2(nx, ny);
      const n2 = perlin2(nx * 2.3 + 11, ny * 2.3 + 7) * 0.5;
      const n3 = perlin2(nx * 4.7 + 31, ny * 4.7 + 17) * 0.25;
      const noiseAmt = 0.09 * (0.4 + base);
      const noisy = base + (n1 + n2 + n3) * noiseAmt;

      // smooth fade along the angular (u) edges
      const fadeU = Math.min(1, Math.min(u, 1 - u) / FADE_FRAC);
      const smoothFadeU = fadeU * fadeU * (3 - 2 * fadeU);
      // smooth fade along the axial (v) edges
      const fadeV = Math.min(1, Math.min(v, 1 - v) / FADE_FRAC);
      const smoothFadeV = fadeV * fadeV * (3 - 2 * fadeV);

      return noisy * smoothFadeU * smoothFadeV;
    }

    // Outer surface with relief bump (this is the visible engraved surface)
    const AXIAL_SEG = 110;
    const outerRing = [];
    for (let s = 0; s <= RADIAL_SEG; s++) {
      const seg = s % RADIAL_SEG;
      const theta = (s / RADIAL_SEG) * Math.PI * 2;
      const row = [];
      for (let a = 0; a <= AXIAL_SEG; a++) {
        const axialFrac = (a / AXIAL_SEG) * 2 - 1;
        const y = axialFrac * halfW;
        const rv = relielAt(seg, axialFrac * (halfW / patchHalfWidth));
        const r = outerR + rv * reliefMm;
        const x = r * Math.cos(theta);
        const z = r * Math.sin(theta);
        row.push([x, y, z]);
      }
      outerRing.push(row);
    }
    // build outer surface triangles
    const vertsPerRing = AXIAL_SEG + 1;
    let baseIndex = 0;
    const outerStart = 0;
    for (let s = 0; s <= RADIAL_SEG; s++) {
      for (let a = 0; a <= AXIAL_SEG; a++) {
        const [x, y, z] = outerRing[s][a];
        positions.push(x, y, z);
        normals.push(0,0,0);
      }
    }
    for (let s = 0; s < RADIAL_SEG; s++) {
      for (let a = 0; a < AXIAL_SEG; a++) {
        const i0 = outerStart + s * vertsPerRing + a;
        const i1 = outerStart + s * vertsPerRing + a + 1;
        const i2 = outerStart + (s+1) * vertsPerRing + a;
        const i3 = outerStart + (s+1) * vertsPerRing + a + 1;
        indices.push(i0, i2, i1, i1, i2, i3);
      }
    }

    // Inner surface (smooth cylinder, finger side)
    const innerStart = positions.length / 3;
    for (let s = 0; s <= RADIAL_SEG; s++) {
      const theta = (s / RADIAL_SEG) * Math.PI * 2;
      for (let a = 0; a <= AXIAL_SEG; a++) {
        const axialFrac = (a / AXIAL_SEG) * 2 - 1;
        const y = axialFrac * halfW;
        const x = innerR * Math.cos(theta);
        const z = innerR * Math.sin(theta);
        positions.push(x, y, z);
        normals.push(0,0,0);
      }
    }
    for (let s = 0; s < RADIAL_SEG; s++) {
      for (let a = 0; a < AXIAL_SEG; a++) {
        const i0 = innerStart + s * vertsPerRing + a;
        const i1 = innerStart + s * vertsPerRing + a + 1;
        const i2 = innerStart + (s+1) * vertsPerRing + a;
        const i3 = innerStart + (s+1) * vertsPerRing + a + 1;
        indices.push(i0, i1, i2, i1, i3, i2);
      }
    }

    // Side rims (top edge a=0, bottom edge a=AXIAL_SEG) connecting outer to inner
    for (const a of [0, AXIAL_SEG]) {
      const flip = a === 0;
      for (let s = 0; s < RADIAL_SEG; s++) {
        const oA = outerStart + s * vertsPerRing + a;
        const oB = outerStart + (s+1) * vertsPerRing + a;
        const iA = innerStart + s * vertsPerRing + a;
        const iB = innerStart + (s+1) * vertsPerRing + a;
        if (flip) indices.push(oA, oB, iA, iB, iA, oB);
        else indices.push(oA, iA, oB, iB, oB, iA);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  function smoothSelectionHeights(src, w, h, passes) {
    if (passes <= 0) return src;
    let arr = src.slice();
    for (let p = 0; p < passes; p++) {
      const out = new Array(w * h);
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          let sum = 0, count = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const rr = r + dr, cc = c + dc;
              if (rr >= 0 && rr < h && cc >= 0 && cc < w) {
                const wgt = (dr === 0 && dc === 0) ? 4 : 1;
                sum += arr[rr * w + cc] * wgt;
                count += wgt;
              }
            }
          }
          out[r * w + c] = sum / count;
        }
      }
      arr = out;
    }
    return arr;
  }

  function renderRing() {
    if (ringGroup) { scene.remove(ringGroup); }
    ringGroup = new THREE.Group();

    const innerDiam = parseFloat(ringSizeSelect.value);
    const width = BAND_WIDTH_MM;
    const thick = BAND_THICK_MM;
    const relief = parseFloat(reliefHeight.value);
    const smoothPasses = parseInt(reliefSmooth.value, 10);
    let selData = extractSelectionHeights();
    selData = { ...selData, heights: smoothSelectionHeights(selData.heights, selData.w, selData.h, smoothPasses) };
    lastMeshData = { innerDiam, width, thick, relief, selData };

    const geometry = buildRingGeometry(innerDiam, width, thick, relief, selData);
    const material = new THREE.MeshStandardMaterial({ color: 0xc9c4b0, roughness: 0.45, metalness: 0.55, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    ringGroup.add(mesh);
    scene.add(ringGroup);

    canvasWrap.style.display = 'block';
    exportRow.style.display = 'block';
    dist = Math.max(dist, (innerDiam/2 + thick) * 4);

    requestAnimationFrame(() => {
      const w = canvasWrap.clientWidth, h = canvasWrap.clientHeight;
      if (w > 0 && h > 0 && renderer) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    });
  }

  generateBtn.addEventListener('click', () => {
    if (!selRect) return;
    canvasWrap.style.display = 'block';
    if (!scene) initThree();
    renderRing();
  });

  [reliefHeight, reliefSmooth, ringSizeSelect].forEach(el => {
    el.addEventListener('input', () => { if (lastMeshData) renderRing(); });
  });

  exportBtn.addEventListener('click', () => {
    if (!ringGroup) return;
    const mesh = ringGroup.children[0];
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const idx = geo.index;
    const triCount = idx.count / 3;

    // Binary STL: 80-byte header + 4-byte triangle count + 50 bytes per triangle
    // (12 bytes normal + 3x12 bytes vertices + 2 bytes attribute byte count)
    const bufferSize = 84 + triCount * 50;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // header left as zeros (80 bytes), triangle count next
    view.setUint32(80, triCount, true);

    let offset = 84;
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i), b = idx.getX(i+1), c = idx.getX(i+2);
      const ax=pos.getX(a), ay=pos.getY(a), az=pos.getZ(a);
      const bx=pos.getX(b), by=pos.getY(b), bz=pos.getZ(b);
      const cx=pos.getX(c), cy=pos.getY(c), cz=pos.getZ(c);

      // compute face normal
      const ux = bx-ax, uy = by-ay, uz = bz-az;
      const vx = cx-ax, vy = cy-ay, vz = cz-az;
      let nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
      const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
      nx /= len; ny /= len; nz /= len;

      view.setFloat32(offset, nx, true); view.setFloat32(offset+4, ny, true); view.setFloat32(offset+8, nz, true);
      view.setFloat32(offset+12, ax, true); view.setFloat32(offset+16, ay, true); view.setFloat32(offset+20, az, true);
      view.setFloat32(offset+24, bx, true); view.setFloat32(offset+28, by, true); view.setFloat32(offset+32, bz, true);
      view.setFloat32(offset+36, cx, true); view.setFloat32(offset+40, cy, true); view.setFloat32(offset+44, cz, true);
      view.setUint16(offset+48, 0, true);
      offset += 50;
    }

    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'bague_spectrogramme.stl';
    a.click();
    URL.revokeObjectURL(url);
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) processAudio(e.target.files[0]);
  });
})();
