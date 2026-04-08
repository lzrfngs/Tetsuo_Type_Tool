/* ── Tetsuo Type Tool — Main ────────────────────────────────────────────
   Libraries: Vanilla JS + Canvas 2D + WebGL (GLSL shaders)
   Architecture: Scene graph of word objects → Canvas 2D render → WebGL pipeline
   ──────────────────────────────────────────────────────────────────── */

import './style.css';

// ── Font registry ─────────────────────────────────────────────────────
// 11 curated Google Fonts — loaded via <link> in index.html.
// Each entry: { family, weights[] }
const FONTS = [
  { family: 'DM Sans',         weights: [300, 400, 500, 700] },
  { family: 'Cormorant',       weights: [300, 400, 500, 600, 700] },
  { family: 'Fira Sans',       weights: [100, 300, 400, 700, 900] },
  { family: 'Eczar',           weights: [400, 500, 600, 700, 800] },
  { family: 'Inknut Antiqua',  weights: [300, 400, 700, 900] },
  { family: 'Poppins',         weights: [100, 300, 400, 700, 900] },
  { family: 'Spectral',        weights: [200, 400, 700, 800] },
  { family: 'IBM Plex Sans',   weights: [100, 200, 300, 400, 500, 600, 700] },
  { family: 'Rubik',           weights: [300, 400, 500, 600, 700, 800, 900] },
  { family: 'Archivo Black',   weights: [400] },
  { family: 'Syne',            weights: [400, 500, 600, 700, 800] },
];

// ── Scene graph ───────────────────────────────────────────────────────
// Each word is an object with position, size, font, and text.
// This is the single source of truth for what's on the canvas.

let nextId = 1;
const scene = [];        // Array of WordObject
let selected = null;     // currently selected WordObject (or null)
let dragState = null;    // { mode: 'move'|'resize', offsetX, offsetY, corner }
let darkCanvas = false;  // true = dark background, light text

function createWord(text, fontFamily, fontWeight, fontSize, x, y) {
  return {
    id: nextId++,
    text,
    fontFamily,
    fontWeight,
    fontSize,
    x,
    y,
    width: 0,
    height: 0,
    color: '#000000',
    letterSpacing: 0,
    rotation: 0,   // degrees
    scaleX: 1,     // horizontal scale (negative = flip)
    scaleY: 1,     // vertical scale (negative = flip)
  };
}

// ── Canvas setup ──────────────────────────────────────────────────────

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('canvas-wrap');
const overlayCanvas = document.getElementById('overlay');
const overlayCtx = overlayCanvas.getContext('2d');

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = wrap.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  overlayCanvas.width = rect.width * dpr;
  overlayCanvas.height = rect.height * dpr;
  overlayCanvas.style.width = rect.width + 'px';
  overlayCanvas.style.height = rect.height + 'px';
  overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
  if (hasActiveEffects() && glState) renderGL();
}

window.addEventListener('resize', resizeCanvas);

// ── Measure a word's bounding box ─────────────────────────────────────
// Uses canvas text metrics to get width/height for hit testing and selection.

function measureWord(word) {
  ctx.font = `${word.fontWeight} ${word.fontSize}px '${word.fontFamily}'`;
  ctx.letterSpacing = `${word.letterSpacing || 0}px`;
  const metrics = ctx.measureText(word.text);
  word.width = metrics.width;
  word.ascent = metrics.actualBoundingBoxAscent;
  word.descent = metrics.actualBoundingBoxDescent;
  word.height = word.ascent + word.descent;
  ctx.letterSpacing = '0px';
}

// ── Render loop ───────────────────────────────────────────────────────
// Draws all words in the scene, plus selection UI for the selected word.

function render() {
  const rect = wrap.getBoundingClientRect();
  ctx.fillStyle = darkCanvas ? '#000000' : '#ffffff';
  ctx.fillRect(0, 0, rect.width, rect.height);

  // Draw each word
  for (const word of scene) {
    ctx.save();
    const cx = word.x + word.width / 2;
    const cy = word.y + word.height / 2;
    ctx.translate(cx, cy);
    if (word.rotation) ctx.rotate(word.rotation * Math.PI / 180);
    ctx.scale(word.scaleX || 1, word.scaleY || 1);
    ctx.translate(-cx, -cy);
    ctx.font = `${word.fontWeight} ${word.fontSize}px '${word.fontFamily}'`;
    ctx.letterSpacing = `${word.letterSpacing || 0}px`;
    ctx.fillStyle = word.color;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(word.text, word.x, word.y + (word.ascent || 0));
    ctx.letterSpacing = '0px';
    ctx.restore();

    // Re-measure (in case font just loaded)
    measureWord(word);
  }

  // Selection UI is drawn on the overlay canvas (visible even when GL effects are active)
  renderOverlay();
}

// ── Selection overlay ─────────────────────────────────────────────────
// Draws selection handles on a separate canvas that sits above both
// the 2D and GL canvases, so it's always visible during interaction.

function renderOverlay() {
  const rect = wrap.getBoundingClientRect();
  overlayCtx.clearRect(0, 0, rect.width, rect.height);

  if (selected) {
    const s = selected;
    const pad = 6;
    const uiColor = darkCanvas ? '#aaa' : '#111';

    // Dashed outline
    overlayCtx.strokeStyle = uiColor;
    overlayCtx.lineWidth = 1;
    overlayCtx.setLineDash([4, 3]);
    overlayCtx.strokeRect(s.x - pad, s.y - pad, s.width + pad * 2, s.height + pad * 2);
    overlayCtx.setLineDash([]);

    // Resize handles — small squares at corners
    const handleSize = 5;
    const corners = getCorners(s, pad);
    overlayCtx.fillStyle = uiColor;
    for (const c of corners) {
      overlayCtx.fillRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
    }
  }
}

function getCorners(word, pad = 6) {
  const x1 = word.x - pad;
  const y1 = word.y - pad;
  const x2 = word.x + word.width + pad;
  const y2 = word.y + word.height + pad;
  return [
    { x: x1, y: y1, corner: 'tl' },
    { x: x2, y: y1, corner: 'tr' },
    { x: x1, y: y2, corner: 'bl' },
    { x: x2, y: y2, corner: 'br' },
  ];
}

// ── Hit testing ───────────────────────────────────────────────────────
// Check if a point is inside a word's bounding box.

function hitTest(x, y) {
  // Iterate in reverse so topmost (last added) words are hit first
  for (let i = scene.length - 1; i >= 0; i--) {
    const w = scene[i];
    if (x >= w.x && x <= w.x + w.width && y >= w.y && y <= w.y + w.height) {
      return w;
    }
  }
  return null;
}

// Check if a point is near a resize handle of the selected word
function hitHandle(x, y) {
  if (!selected) return null;
  const corners = getCorners(selected);
  const threshold = 8;
  for (const c of corners) {
    if (Math.abs(x - c.x) < threshold && Math.abs(y - c.y) < threshold) {
      return c.corner;
    }
  }
  return null;
}

// ── Pointer interaction ───────────────────────────────────────────────
// Handles click-to-select, drag-to-move, and drag-handles-to-resize.

canvas.addEventListener('pointerdown', (e) => {
  const rect = wrap.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // Check resize handles first (only if something is selected)
  const corner = hitHandle(x, y);
  if (corner && selected) {
    dragState = {
      mode: 'resize',
      corner,
      startX: x,
      startY: y,
      origFontSize: selected.fontSize,
      origX: selected.x,
      origY: selected.y,
    };
    canvas.setPointerCapture(e.pointerId);
    return;
  }

  // Check if clicking on a word
  const hit = hitTest(x, y);
  if (hit) {
    selected = hit;
    dragState = {
      mode: 'move',
      offsetX: x - hit.x,
      offsetY: y - hit.y,
    };
    canvas.setPointerCapture(e.pointerId);
    // Move selected word to top of scene (render on top)
    const idx = scene.indexOf(hit);
    if (idx !== -1) {
      scene.splice(idx, 1);
      scene.push(hit);
    }
  } else {
    selected = null;
    if (editingWord) {
      editingWord = false;
      btnAdd.textContent = 'Add to canvas';
    }
  }

  // Sync toolbar controls with the selected word
  if (selected) {
    fontPicker.value = selected.fontFamily;
    updateWeightPicker();
    weightPicker.value = selected.fontWeight;
    sizePicker.value = selected.fontSize;
    colorPicker.value = selected.color;
    trackingPicker.value = selected.letterSpacing || 0;
    // Exit editing mode when clicking a different word
    if (editingWord) {
      editingWord = false;
      btnAdd.textContent = 'Add to canvas';
    }
  }

  render();
  if (hasActiveEffects() && glState) renderGL();
});

canvas.addEventListener('pointermove', (e) => {
  if (!dragState) return;
  const rect = wrap.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (dragState.mode === 'move' && selected) {
    canvas.style.cursor = 'grabbing';
    selected.x = x - dragState.offsetX;
    selected.y = y - dragState.offsetY;
    render();
    if (hasActiveEffects() && glState) renderGL();
  }

  if (dragState.mode === 'resize' && selected) {
    // Scale font size based on drag distance from starting point.
    // Dragging the bottom-right corner outward = bigger.
    const dx = x - dragState.startX;
    const dy = y - dragState.startY;
    // Use the larger of horizontal/vertical movement for uniform scale
    const delta = (Math.abs(dx) > Math.abs(dy)) ? dx : dy;
    const newSize = Math.max(12, Math.round(dragState.origFontSize + delta));
    selected.fontSize = newSize;
    sizePicker.value = newSize;
    measureWord(selected);
    render();
    if (hasActiveEffects() && glState) renderGL();
  }
});

canvas.addEventListener('pointerup', () => {
  if (dragState && dragState.mode === 'move') {
    canvas.style.cursor = 'grab';
  }
  dragState = null;
});

// ── Double-click to edit a word's text ────────────────────────────────
canvas.addEventListener('dblclick', (e) => {
  const rect = wrap.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const hit = hitTest(x, y);
  if (hit) {
    selected = hit;
    editingWord = true;
    textInput.value = hit.text;
    textInput.focus();
    textInput.select();
    btnAdd.textContent = 'Editing…';
    fontPicker.value = hit.fontFamily;
    updateWeightPicker();
    weightPicker.value = hit.fontWeight;
    sizePicker.value = hit.fontSize;
    colorPicker.value = hit.color;
    trackingPicker.value = hit.letterSpacing || 0;
    render();
    updateStatus(`Editing "${hit.text}"`);
  }
});

// ── Keyboard shortcuts ────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  // Delete selected word with Delete or Backspace (only if text input not focused)
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected && document.activeElement !== textInput) {
    const idx = scene.indexOf(selected);
    if (idx !== -1) scene.splice(idx, 1);
    selected = null;
    render();
    if (hasActiveEffects() && glState) renderGL();
    e.preventDefault();
  }

  // Ctrl+Z — undo last added word (simple undo)
  if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
    if (scene.length > 0) {
      const removed = scene.pop();
      if (selected === removed) selected = null;
      render();
      if (hasActiveEffects() && glState) renderGL();
      updateStatus(`Removed "${removed.text}"`);
    }
    e.preventDefault();
  }

  // Enter — add word to canvas or finish editing
  if (e.key === 'Enter' && document.activeElement === textInput) {
    if (editingWord) {
      editingWord = false;
      btnAdd.textContent = 'Add to canvas';
      textInput.blur();
      updateStatus(`Updated "${selected.text}"`);
    } else {
      addWordToCanvas();
    }
  }

  // Escape — deselect and exit editing mode
  if (e.key === 'Escape') {
    if (editingWord) {
      editingWord = false;
      btnAdd.textContent = 'Add to canvas';
      textInput.blur();
    }
    if (selected) {
      selected = null;
      render();
      if (hasActiveEffects() && glState) renderGL();
    }
  }

  // Arrow keys — nudge selected word (Shift = 10px, normal = 1px)
  if (selected && document.activeElement !== textInput &&
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowUp')    selected.y -= step;
    if (e.key === 'ArrowDown')  selected.y += step;
    if (e.key === 'ArrowLeft')  selected.x -= step;
    if (e.key === 'ArrowRight') selected.x += step;
    render();
    if (hasActiveEffects() && glState) renderGL();
    e.preventDefault();
  }

  // Ctrl+D — duplicate selected word (offset by 20px)
  if (e.key === 'd' && (e.ctrlKey || e.metaKey) && selected) {
    const dupe = createWord(selected.text, selected.fontFamily, selected.fontWeight, selected.fontSize, selected.x + 20, selected.y + 20);
    dupe.color = selected.color;
    dupe.letterSpacing = selected.letterSpacing;
    dupe.rotation = selected.rotation;
    dupe.scaleX = selected.scaleX;
    dupe.scaleY = selected.scaleY;
    measureWord(dupe);
    scene.push(dupe);
    selected = dupe;
    render();
    if (hasActiveEffects() && glState) renderGL();
    updateStatus(`Duplicated "${dupe.text}"`);
    e.preventDefault();
  }

  // R / Shift+R — rotate selected word (15° increments, Shift = 1°)
  if (e.key === 'r' && selected && document.activeElement !== textInput && !e.ctrlKey && !e.metaKey) {
    const step = e.shiftKey ? 1 : 15;
    selected.rotation = ((selected.rotation || 0) + step) % 360;
    render();
    if (hasActiveEffects() && glState) renderGL();
    updateStatus(`Rotated ${selected.rotation}°`);
    e.preventDefault();
  }

  // H — flip horizontally
  if (e.key === 'h' && selected && document.activeElement !== textInput && !e.ctrlKey && !e.metaKey) {
    selected.scaleX = (selected.scaleX || 1) * -1;
    render();
    if (hasActiveEffects() && glState) renderGL();
    updateStatus(selected.scaleX < 0 ? 'Flipped horizontal' : 'Unflipped horizontal');
    e.preventDefault();
  }

  // V — flip vertically
  if (e.key === 'v' && selected && document.activeElement !== textInput && !e.ctrlKey && !e.metaKey) {
    selected.scaleY = (selected.scaleY || 1) * -1;
    render();
    if (hasActiveEffects() && glState) renderGL();
    updateStatus(selected.scaleY < 0 ? 'Flipped vertical' : 'Unflipped vertical');
    e.preventDefault();
  }

  // [ / ] — change layer order of selected word
  if (e.key === '[' && selected && document.activeElement !== textInput) {
    const idx = scene.indexOf(selected);
    if (idx > 0) {
      scene.splice(idx, 1);
      scene.splice(idx - 1, 0, selected);
      render();
      if (hasActiveEffects() && glState) renderGL();
      updateStatus('Moved back');
    }
    e.preventDefault();
  }
  if (e.key === ']' && selected && document.activeElement !== textInput) {
    const idx = scene.indexOf(selected);
    if (idx < scene.length - 1) {
      scene.splice(idx, 1);
      scene.splice(idx + 1, 0, selected);
      render();
      if (hasActiveEffects() && glState) renderGL();
      updateStatus('Moved forward');
    }
    e.preventDefault();
  }
});

// ── UI wiring ─────────────────────────────────────────────────────────

const textInput = document.getElementById('text-input');
const fontPicker = document.getElementById('font-picker');
const weightPicker = document.getElementById('weight-picker');
const sizePicker = document.getElementById('size-picker');
const colorPicker = document.getElementById('color-picker');
const trackingPicker = document.getElementById('tracking-picker');
const btnAdd = document.getElementById('btn-add');
const btnClear = document.getElementById('btn-clear');
const btnExport = document.getElementById('btn-export');
const statusEl = document.getElementById('status');

// ── Editing mode ──────────────────────────────────────────────────────
// When true, typing in the text input updates the selected word live
// instead of preparing text for a new word.
let editingWord = false;

textInput.addEventListener('input', () => {
  if (editingWord && selected) {
    selected.text = textInput.value || ' ';
    measureWord(selected);
    render();
    if (hasActiveEffects() && glState) renderGL();
  }
});

// Exit editing mode when text input loses focus
textInput.addEventListener('blur', () => {
  if (editingWord) {
    editingWord = false;
    btnAdd.textContent = 'Add to canvas';
  }
});

// Populate font picker
for (const f of FONTS) {
  const opt = document.createElement('option');
  opt.value = f.family;
  opt.textContent = f.family;
  opt.style.fontFamily = `'${f.family}'`;
  fontPicker.appendChild(opt);
}

// Update weight picker when font changes
function updateWeightPicker() {
  const font = FONTS.find(f => f.family === fontPicker.value);
  weightPicker.innerHTML = '';
  if (!font) return;
  for (const w of font.weights) {
    const opt = document.createElement('option');
    opt.value = w;
    opt.textContent = weightLabel(w);
    weightPicker.appendChild(opt);
  }
  // Default to 400 if available, otherwise first weight
  const has400 = font.weights.includes(400);
  weightPicker.value = has400 ? '400' : font.weights[0];
}

function weightLabel(w) {
  const labels = {
    100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular',
    500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black',
  };
  return labels[w] || String(w);
}

fontPicker.addEventListener('change', () => {
  updateWeightPicker();
  // If a word is selected, update its font
  if (selected) {
    selected.fontFamily = fontPicker.value;
    selected.fontWeight = parseInt(weightPicker.value, 10);
    measureWord(selected);
    render();
    if (hasActiveEffects() && glState) renderGL();
  }
});
updateWeightPicker();

// Update selected word when weight changes
weightPicker.addEventListener('change', () => {
  if (selected) {
    selected.fontWeight = parseInt(weightPicker.value, 10);
    measureWord(selected);
    render();
    if (hasActiveEffects() && glState) renderGL();
  }
});

// Update selected word when size changes
sizePicker.addEventListener('change', () => {
  if (selected) {
    selected.fontSize = parseInt(sizePicker.value, 10) || 120;
    measureWord(selected);
    render();
    if (hasActiveEffects() && glState) renderGL();
  }
});

// Update selected word when color changes
colorPicker.addEventListener('input', () => {
  if (selected) {
    selected.color = colorPicker.value;
    render();
    if (hasActiveEffects() && glState) renderGL();
  }
});

// Update selected word when letter spacing changes
trackingPicker.addEventListener('change', () => {
  if (selected) {
    selected.letterSpacing = parseInt(trackingPicker.value, 10) || 0;
    measureWord(selected);
    render();
    if (hasActiveEffects() && glState) renderGL();
  }
});

// Add word to canvas
function addWordToCanvas() {
  const text = textInput.value.trim();
  if (!text) return;

  const fontFamily = fontPicker.value;
  const fontWeight = parseInt(weightPicker.value, 10);
  const fontSize = parseInt(sizePicker.value, 10) || 120;

  // Place new words near center with slight random offset so they don't stack exactly
  const rect = wrap.getBoundingClientRect();
  const x = rect.width / 2 - (text.length * fontSize * 0.3) / 2 + (Math.random() - 0.5) * 40;
  const y = rect.height / 2 - fontSize / 2 + (Math.random() - 0.5) * 40;

  const word = createWord(text, fontFamily, fontWeight, fontSize, x, y);
  word.color = colorPicker.value;
  word.letterSpacing = parseInt(trackingPicker.value, 10) || 0;
  measureWord(word);
  scene.push(word);
  selected = word;
  render();
  if (hasActiveEffects() && glState) renderGL();

  updateStatus(`Added "${text}" — ${fontFamily} ${weightLabel(fontWeight)}`);
}

btnAdd.addEventListener('click', () => {
  if (editingWord) {
    // Finish editing
    editingWord = false;
    btnAdd.textContent = 'Add to canvas';
    textInput.blur();
    if (selected) updateStatus(`Updated "${selected.text}"`);
  } else {
    addWordToCanvas();
  }
});

// Clear canvas
btnClear.addEventListener('click', () => {
  scene.length = 0;
  selected = null;
  if (editingWord) {
    editingWord = false;
    btnAdd.textContent = 'Add to canvas';
  }
  render();
  if (hasActiveEffects() && glState) renderGL();
  updateStatus('Canvas cleared');
});

// Invert canvas (dark mode toggle)
const btnInvert = document.getElementById('btn-invert');
btnInvert.addEventListener('click', () => {
  darkCanvas = !darkCanvas;
  wrap.style.background = darkCanvas ? '#000' : '#fff';
  btnInvert.style.opacity = darkCanvas ? '1' : '0.5';
  // Auto-invert new word color when switching modes
  colorPicker.value = darkCanvas ? '#ffffff' : '#000000';
  render();
  if (hasActiveEffects() && glState) renderGL();
  updateStatus(darkCanvas ? 'Dark canvas' : 'Light canvas');
});

// Export PNG
btnExport.addEventListener('click', () => {
  // Temporarily deselect to hide selection UI
  const prevSelected = selected;
  selected = null;
  render();

  // Stop animation during export to get a clean frame
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }

  // If effects are active, export from the GL canvas; otherwise from the 2D canvas
  const exportCanvas = hasActiveEffects() && glState ? glCanvas : canvas;
  if (hasActiveEffects()) renderGL();  // ensure GL canvas is up to date

  // Generate timestamped filename from content
  const words = scene.map(w => w.text).join('-').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'tetsuo';
  const ts = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  const filename = `${words}-${ts}.png`;

  exportCanvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    updateStatus('PNG exported');
  }, 'image/png');

  selected = prevSelected;
  render();
  // Restart animation if effects were running
  if (hasActiveEffects() && glState) renderGL();
});

// Status bar
function updateStatus(msg) {
  statusEl.textContent = msg;
}

// ── Cursor management ─────────────────────────────────────────────────
// Change cursor based on what's under it.

canvas.addEventListener('mousemove', (e) => {
  if (dragState) return; // don't change cursor while dragging

  const rect = wrap.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const corner = hitHandle(x, y);
  if (corner) {
    canvas.style.cursor = (corner === 'tl' || corner === 'br') ? 'nwse-resize' : 'nesw-resize';
    return;
  }

  const hit = hitTest(x, y);
  canvas.style.cursor = hit ? 'grab' : 'default';
});

// ── Scroll-to-resize ──────────────────────────────────────────────────
// Mouse wheel over a selected word scales it smoothly
canvas.addEventListener('wheel', (e) => {
  if (!selected) return;
  const rect = wrap.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const hit = hitTest(x, y);
  if (hit !== selected) return;

  e.preventDefault();
  const delta = e.deltaY > 0 ? -2 : 2;
  selected.fontSize = Math.max(12, selected.fontSize + delta);
  sizePicker.value = selected.fontSize;
  measureWord(selected);
  render();
  if (hasActiveEffects() && glState) renderGL();
}, { passive: false });

// ── WebGL effects pipeline ────────────────────────────────────────────
// Six stackable effects in a single shader pass:
//   1. Grain — film grain noise, concentrated in midtones
//   2. Chromatic Aberration — RGB channel separation
//   3. Edge Erosion — dissolves letterform boundaries with noise
//   4. Ink Bleed — gaussian-style bloom simulating oversaturated ink
//   5. Organic Warp — slow viscous displacement via FBM noise
//   6. Duotone — maps luminance to a two-color gradient

const glCanvas = document.getElementById('gl');

// ── Palettes — Mantle Creep-inspired color ramps ──────────────────────
const PALETTES = [
  { name:'mono',     bg:[0,0,0],      dark:[30,30,30],     mid:[128,128,128],  light:[255,255,255] },
  { name:'ivory',    bg:[10,8,5],      dark:[20,14,6],      mid:[185,135,55],   light:[228,210,172] },
  { name:'amber',    bg:[8,5,2],       dark:[10,5,2],       mid:[210,95,15],    light:[235,195,140] },
  { name:'ink',      bg:[238,232,220], dark:[8,6,4],        mid:[60,45,90],     light:[238,232,220] },
  { name:'jade',     bg:[4,10,6],      dark:[3,8,5],        mid:[30,160,100],   light:[180,225,195] },
  { name:'rust',     bg:[9,4,2],       dark:[8,3,1],        mid:[210,60,20],    light:[230,185,155] },
  { name:'lavender', bg:[8,7,14],      dark:[55,15,90],     mid:[175,130,230],  light:[210,200,240] },
  { name:'glacier',  bg:[5,8,12],      dark:[10,40,80],     mid:[115,175,200],  light:[195,215,228] },
  { name:'solar',    bg:[12,8,2],      dark:[180,40,10],    mid:[240,180,20],   light:[255,240,200] },
  { name:'neon',     bg:[2,2,8],       dark:[0,200,120],    mid:[0,255,200],    light:[180,255,240] },
];
let paletteIdx = 0;

// Effect uniforms — expanded
const fx = {
  stress: 0,
  noise: 0,
  blur: 0,
  erode: 0,
  warp: 0,
  threshold: 0.5,
  gradient: 0,     // 0-1 — palette color through type
  solarize: 0,     // 0-1 — Sabattier tone inversion
  chroma: 0,       // 0-1 — chromatic aberration
  halftone: 0,     // 0-1 — dot screen
  shimmer: 0,      // 0-1 — heat shimmer
  emboss: 0,       // 0-1 — directional lighting emboss
  glitch: 0,       // 0-1 — scan line displacement
};

function initGL() {
  const gl = glCanvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: true });
  if (!gl) {
    console.warn('WebGL not available — effects pipeline disabled');
    return null;
  }

  const vsSource = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() {
      vUv = aPos * 0.5 + 0.5;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }`;

  // ═══════════════════════════════════════════════════════════════════
  // FRAGMENT SHADER — 13 stackable effects + palette color mapping
  //
  // Pipeline: warp → sample → erode → noise → threshold → solarize
  //           → emboss → halftone → glitch → chroma → gradient color
  // ═══════════════════════════════════════════════════════════════════
  const fsSource = `
    precision highp float;
    uniform sampler2D uTex;
    uniform vec2 uRes;
    uniform float uTime;
    uniform float uInvert;
    // Texture effects
    uniform float uStress;
    uniform float uNoise;
    uniform float uBlur;
    uniform float uErode;
    // Distortion
    uniform float uWarp;
    uniform float uHalftone;
    uniform float uShimmer;
    // Tone
    uniform float uThreshold;
    uniform float uEmboss;
    uniform float uGlitch;
    // Color
    uniform float uGradient;
    uniform float uSolarize;
    uniform float uChroma;
    // Palette colors (normalized 0-1)
    uniform vec3 uPalDark;
    uniform vec3 uPalMid;
    uniform vec3 uPalLight;
    varying vec2 vUv;

    // ── Noise ─────────────────────────────────────────────────────
    float hash(vec2 p) {
      p = fract(p * vec2(127.1, 311.7));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
                 mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
      for (int i = 0; i < 5; i++) {
        v += vnoise(p) * a;
        p = rot * p * 2.1 + vec2(1.7, 9.2);
        a *= 0.5;
      }
      return v;
    }
    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

    void main() {
      vec2 px = 1.0 / uRes;
      vec2 uv = vec2(vUv.x, 1.0 - vUv.y);

      // ── SHIMMER: heat-haze refraction ───────────────────────────
      // Animated sine waves at different scales — like air above asphalt
      vec2 shimUv = uv;
      if (uShimmer > 0.001) {
        float t = uTime * 0.8;
        float sx = sin(uv.y * 60.0 + t * 2.3) * sin(uv.y * 23.0 - t * 1.1);
        float sy = sin(uv.x * 45.0 + t * 1.7) * sin(uv.x * 31.0 - t * 2.1);
        shimUv += vec2(sx, sy) * uShimmer * 0.008;
      }

      // ── GLITCH: scan-line displacement ──────────────────────────
      // Random horizontal bands shift sideways — digital signal corruption
      vec2 glitchUv = shimUv;
      if (uGlitch > 0.001) {
        float band = floor(shimUv.y * uRes.y / (3.0 + uGlitch * 8.0));
        float shift = (hash(vec2(band, floor(uTime * 4.0))) - 0.5);
        float active = step(0.85 - uGlitch * 0.3, hash(vec2(band * 0.1, floor(uTime * 6.0))));
        glitchUv.x += shift * uGlitch * 0.08 * active;
      }

      // ── WARP: animated FBM displacement ─────────────────────────
      vec2 dataUv = glitchUv;
      if (uWarp > 0.001) {
        float warpAmt = uWarp * 0.06;
        float t = uTime * 0.12;
        float wx = (fbm(glitchUv * 6.0 + vec2(7.3 + t, 13.1 - t * 0.7)) - 0.5) * warpAmt;
        float wy = (fbm(glitchUv * 6.0 + vec2(41.7 - t * 0.5, 3.9 + t * 0.8)) - 0.5) * warpAmt;
        float wx2 = (fbm(glitchUv * 18.0 + vec2(3.1 - t * 0.3, 7.7 + t * 0.4)) - 0.5) * warpAmt * 0.3;
        float wy2 = (fbm(glitchUv * 18.0 + vec2(23.3 + t * 0.2, 11.1 - t * 0.5)) - 0.5) * warpAmt * 0.3;
        dataUv = glitchUv + vec2(wx + wx2, wy + wy2);
      }

      // ── NOISE: substrate displacement ───────────────────────────
      if (uNoise > 0.001) {
        float displaceAmt = uNoise * 0.012;
        float dx = (fbm(dataUv * 30.0 + vec2(7.3, 13.1 + uTime * 0.08)) - 0.5) * displaceAmt;
        float dy = (fbm(dataUv * 30.0 + vec2(41.7, 3.9 - uTime * 0.06)) - 0.5) * displaceAmt;
        dataUv += vec2(dx, dy);
      }

      float data = 1.0 - luma(texture2D(uTex, dataUv).rgb);

      // ── ERODE ───────────────────────────────────────────────────
      if (uErode > 0.001) {
        float sd = 2.0 + uErode * 4.0;
        float L  = 1.0 - luma(texture2D(uTex, dataUv + vec2(-px.x * sd, 0.0)).rgb);
        float R  = 1.0 - luma(texture2D(uTex, dataUv + vec2( px.x * sd, 0.0)).rgb);
        float U  = 1.0 - luma(texture2D(uTex, dataUv + vec2(0.0, -px.y * sd)).rgb);
        float D  = 1.0 - luma(texture2D(uTex, dataUv + vec2(0.0,  px.y * sd)).rgb);
        float TL = 1.0 - luma(texture2D(uTex, dataUv + vec2(-px.x, -px.y) * sd * 0.7).rgb);
        float TR = 1.0 - luma(texture2D(uTex, dataUv + vec2( px.x, -px.y) * sd * 0.7).rgb);
        float BL = 1.0 - luma(texture2D(uTex, dataUv + vec2(-px.x,  px.y) * sd * 0.7).rgb);
        float BR = 1.0 - luma(texture2D(uTex, dataUv + vec2( px.x,  px.y) * sd * 0.7).rgb);
        float mn = min(min(min(L, R), min(U, D)), min(min(TL, TR), min(BL, BR)));
        float exposure = 1.0 - smoothstep(0.0, 0.35, mn);
        float en = fbm(dataUv * 25.0 + vec2(19.3, 7.1)) * 0.5
                 + vnoise(dataUv * 80.0 + vec2(3.1, 17.3)) * 0.3
                 + hash(dataUv * uRes * 0.3 + vec2(11.1, 43.7)) * 0.2;
        data = max(0.0, data - uErode * (exposure * 0.9 + en * 0.6));
      }

      // ── NOISE: grain isolated to type area ──────────────────────
      // KEY FIX: textPresence masks noise so background stays clean
      if (uNoise > 0.001) {
        float textPresence = smoothstep(0.02, 0.12, data);
        float edgePeak = 4.0 * data * (1.0 - data);
        float midtoneMask = smoothstep(0.0, 0.3, data) * smoothstep(1.0, 0.6, data);
        float fullMask = (edgePeak * 0.5 + midtoneMask * 0.3 + data * 0.2) * textPresence;

        float n1 = hash(dataUv * uRes + uTime * 7.3) - 0.5;
        float n2 = hash(dataUv * uRes * 0.414 + vec2(73.1, 41.9) + uTime * 3.1) - 0.5;
        float n3 = hash(dataUv * uRes * 1.73 + vec2(17.3, 89.1) + uTime * 1.7) - 0.5;
        float n4 = (fbm(dataUv * 45.0 + vec2(3.7 + uTime * 0.04, 11.3)) - 0.5);
        float grain = n1 * 0.35 + n2 * 0.25 + n3 * 0.2 + n4 * 0.2;
        data += grain * uNoise * 16.0 * fullMask;
      }

      // ── THRESHOLD + GAMMA ───────────────────────────────────────
      data = clamp(data, 0.0, 1.0);
      float tNorm = uThreshold;
      if (tNorm < 0.49) {
        float blackPt = (0.5 - tNorm) * 1.0;
        data = smoothstep(blackPt, 1.0, data);
      } else if (tNorm > 0.51) {
        float whitePt = 1.0 - (tNorm - 0.5) * 1.5;
        data = smoothstep(0.0, max(0.05, whitePt), data);
      }
      float gamma = mix(0.8, 0.45, uStress);
      data = pow(clamp(data, 0.0, 1.0), gamma);

      // ── EMBOSS: directional lighting on the surface ─────────────
      // Samples the data field gradient to simulate raised letterforms
      // lit from the upper-left — like debossed paper or stamped metal
      if (uEmboss > 0.001) {
        float eL = 1.0 - luma(texture2D(uTex, dataUv + vec2(-px.x * 2.0, 0.0)).rgb);
        float eR = 1.0 - luma(texture2D(uTex, dataUv + vec2( px.x * 2.0, 0.0)).rgb);
        float eU = 1.0 - luma(texture2D(uTex, dataUv + vec2(0.0, -px.y * 2.0)).rgb);
        float eD = 1.0 - luma(texture2D(uTex, dataUv + vec2(0.0,  px.y * 2.0)).rgb);
        // Gradient → surface normal approximation
        float gx = eR - eL;
        float gy = eD - eU;
        // Light from upper-left
        float light = (gx * 0.707 + gy * -0.707) * 0.5 + 0.5;
        data = mix(data, data * light * 1.8, uEmboss * 0.8);
        data = clamp(data, 0.0, 1.0);
      }

      // ── SOLARIZE: Sabattier effect ──────────────────────────────
      // Partially inverts tones — darkroom technique where light hits
      // the print during development. Creates eerie tone reversals.
      if (uSolarize > 0.001) {
        float curve = sin(data * 3.14159 * (1.0 + uSolarize * 2.0));
        data = mix(data, abs(curve), uSolarize);
        data = clamp(data, 0.0, 1.0);
      }

      // ── HALFTONE: dot screen pattern ────────────────────────────
      // Classic CMYK-style dot grid. At low values: fine dots.
      // At high values: large graphic dots that eat into each other.
      float halftoneData = data;
      if (uHalftone > 0.001) {
        float dotSize = 3.0 + uHalftone * 15.0;
        // Rotate grid 15° to avoid moiré with screen pixels
        float angle = 0.2618;
        float ca = cos(angle), sa = sin(angle);
        vec2 rotUv = vec2(ca * uv.x - sa * uv.y, sa * uv.x + ca * uv.y);
        vec2 cell = rotUv * uRes / dotSize;
        vec2 cellCenter = (floor(cell) + 0.5) * dotSize / uRes;
        // Undo rotation to sample original data at cell center
        vec2 origCenter = vec2(ca * cellCenter.x + sa * cellCenter.y,
                              -sa * cellCenter.x + ca * cellCenter.y);
        float cellData = 1.0 - luma(texture2D(uTex, vec2(origCenter.x, 1.0 - origCenter.y)).rgb);
        // Apply threshold + gamma to the cell data too
        cellData = pow(clamp(cellData, 0.0, 1.0), gamma);

        float dist = length(fract(cell) - 0.5);
        float radius = sqrt(cellData) * 0.5;
        float dot = 1.0 - smoothstep(radius - 0.04, radius + 0.04, dist);
        halftoneData = mix(data, dot, uHalftone);
      }
      data = halftoneData;

      // ── COLOR OUTPUT ────────────────────────────────────────────
      // Start with monochrome, then blend in palette gradient
      float brightness = 1.0 - data;
      if (uInvert > 0.5) brightness = 1.0 - brightness;

      vec3 col = vec3(brightness);

      // ── GRADIENT: palette color through the type ────────────────
      // Maps data luminance to a 3-stop palette ramp (dark→mid→light).
      // Only applies to text areas, background stays clean.
      if (uGradient > 0.001) {
        float textMask = smoothstep(0.02, 0.08, data);
        // 3-stop color ramp: dark (data=1) → mid (data=0.5) → light (data=0)
        vec3 palColor;
        if (data > 0.5) {
          palColor = mix(uPalMid, uPalDark, (data - 0.5) * 2.0);
        } else {
          palColor = mix(uPalLight, uPalMid, data * 2.0);
        }
        // For inverted mode, swap the ramp direction
        if (uInvert > 0.5) {
          if (data > 0.5) {
            palColor = mix(uPalMid, uPalLight, (data - 0.5) * 2.0);
          } else {
            palColor = mix(uPalDark, uPalMid, data * 2.0);
          }
        }
        col = mix(col, palColor * textMask + col * (1.0 - textMask), uGradient);
      }

      // ── CHROMA: chromatic aberration ────────────────────────────
      // Shifts RGB channels apart — like a cheap lens or risograph
      // misregistration. Each channel reads from a slightly offset UV.
      if (uChroma > 0.001) {
        float chromaAmt = uChroma * 0.015;
        // Offset from center — aberration increases toward edges
        vec2 center = vec2(0.5);
        vec2 dir = dataUv - center;
        float rData = 1.0 - luma(texture2D(uTex, dataUv + dir * chromaAmt).rgb);
        float bData = 1.0 - luma(texture2D(uTex, dataUv - dir * chromaAmt).rgb);
        // Apply same gamma/threshold
        rData = pow(clamp(rData, 0.0, 1.0), gamma);
        bData = pow(clamp(bData, 0.0, 1.0), gamma);
        float rBright = 1.0 - rData;
        float bBright = 1.0 - bData;
        if (uInvert > 0.5) { rBright = 1.0 - rBright; bBright = 1.0 - bBright; }
        col.r = mix(col.r, rBright, uChroma);
        col.b = mix(col.b, bBright, uChroma);
      }

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`;

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  const vs = compileShader(gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
  if (!vs || !fs) return null;

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    return null;
  }

  gl.useProgram(program);

  // Fullscreen quad geometry
  const quadVerts = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  // Texture from 2D canvas
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  // Cache uniform locations
  const uniforms = {
    uTex: gl.getUniformLocation(program, 'uTex'),
    uRes: gl.getUniformLocation(program, 'uRes'),
    uTime: gl.getUniformLocation(program, 'uTime'),
    uInvert: gl.getUniformLocation(program, 'uInvert'),
    uStress: gl.getUniformLocation(program, 'uStress'),
    uNoise: gl.getUniformLocation(program, 'uNoise'),
    uBlur: gl.getUniformLocation(program, 'uBlur'),
    uErode: gl.getUniformLocation(program, 'uErode'),
    uWarp: gl.getUniformLocation(program, 'uWarp'),
    uHalftone: gl.getUniformLocation(program, 'uHalftone'),
    uShimmer: gl.getUniformLocation(program, 'uShimmer'),
    uThreshold: gl.getUniformLocation(program, 'uThreshold'),
    uEmboss: gl.getUniformLocation(program, 'uEmboss'),
    uGlitch: gl.getUniformLocation(program, 'uGlitch'),
    uGradient: gl.getUniformLocation(program, 'uGradient'),
    uSolarize: gl.getUniformLocation(program, 'uSolarize'),
    uChroma: gl.getUniformLocation(program, 'uChroma'),
    uPalDark: gl.getUniformLocation(program, 'uPalDark'),
    uPalMid: gl.getUniformLocation(program, 'uPalMid'),
    uPalLight: gl.getUniformLocation(program, 'uPalLight'),
  };

  return { gl, program, tex, uniforms };
}

const glState = initGL();

// Check if any effect is active
function hasActiveEffects() {
  return fx.stress > 0 || fx.noise > 0 || fx.blur > 0 ||
         fx.erode > 0 || fx.warp > 0 || Math.abs(fx.threshold - 0.5) > 0.01 ||
         fx.gradient > 0 || fx.solarize > 0 || fx.chroma > 0 ||
         fx.halftone > 0 || fx.shimmer > 0 || fx.emboss > 0 || fx.glitch > 0;
}

// Render the 2D canvas through the WebGL shader pipeline
let animFrame = null;

// ── Data canvas: smooth, pre-blurred text for the shader ──────────────
// The shader needs CONTINUOUS data, not binary black/white.
// This offscreen canvas renders the same text but with a generous blur,
// creating smooth gradients around every edge — like Mantle Creep's
// simulation data had natural gradients from the reaction-diffusion.
let dataCanvas = null;
let dataCtx = null;

function createDataTexture() {
  const dpr = window.devicePixelRatio || 1;
  const rect = wrap.getBoundingClientRect();
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);

  if (!dataCanvas) {
    dataCanvas = document.createElement('canvas');
    dataCtx = dataCanvas.getContext('2d');
  }
  dataCanvas.width = w;
  dataCanvas.height = h;

  // Fill white background
  dataCtx.fillStyle = '#ffffff';
  dataCtx.fillRect(0, 0, w, h);

  // Scale for DPR
  dataCtx.save();
  dataCtx.scale(dpr, dpr);

  // Apply CSS blur filter — scales with Stress and Blur sliders.
  // Canvas 2D blur is a proper gaussian with no pixel gaps.
  // This does the heavy lifting that the shader was doing poorly.
  const stressBlur = fx.stress * 40;  // up to 40px blur for Stress
  const softBlur = fx.blur * 25;      // up to 25px blur for Blur
  const totalBlur = 3 + stressBlur + softBlur;  // 3px base for smooth data
  dataCtx.filter = `blur(${totalBlur}px)`;

  // Draw text — always black on white for the shader's luminance pipeline.
  // The shader handles inversion for dark mode at the output stage.
  for (const word of scene) {
    dataCtx.save();
    const cx = word.x + word.width / 2;
    const cy = word.y + word.height / 2;
    dataCtx.translate(cx, cy);
    if (word.rotation) dataCtx.rotate(word.rotation * Math.PI / 180);
    dataCtx.scale(word.scaleX || 1, word.scaleY || 1);
    dataCtx.translate(-cx, -cy);
    dataCtx.font = `${word.fontWeight} ${word.fontSize}px '${word.fontFamily}'`;
    dataCtx.letterSpacing = `${word.letterSpacing || 0}px`;
    dataCtx.fillStyle = '#000000';
    dataCtx.textBaseline = 'alphabetic';
    dataCtx.fillText(word.text, word.x, word.y + (word.ascent || 0));
    dataCtx.letterSpacing = '0px';
    dataCtx.restore();
  }

  dataCtx.restore();

  return dataCanvas;
}

function renderGL() {
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }

  if (!glState || !hasActiveEffects()) {
    glCanvas.style.visibility = 'hidden';
    canvas.style.opacity = '1';
    return;
  }

  glCanvas.style.visibility = 'visible';
  canvas.style.opacity = '0';

  const { gl, tex, uniforms } = glState;

  const dpr = window.devicePixelRatio || 1;
  const rect = wrap.getBoundingClientRect();
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (glCanvas.width !== w || glCanvas.height !== h) {
    glCanvas.width = w;
    glCanvas.height = h;
    glCanvas.style.width = rect.width + 'px';
    glCanvas.style.height = rect.height + 'px';
  }

  gl.viewport(0, 0, w, h);

  // Create the pre-blurred data texture and upload it
  const dataTex = createDataTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, dataTex);

  gl.uniform1i(uniforms.uTex, 0);
  gl.uniform2f(uniforms.uRes, w, h);
  gl.uniform1f(uniforms.uTime, performance.now() / 1000);
  gl.uniform1f(uniforms.uInvert, darkCanvas ? 1.0 : 0.0);
  gl.uniform1f(uniforms.uStress, fx.stress);
  gl.uniform1f(uniforms.uNoise, fx.noise);
  gl.uniform1f(uniforms.uBlur, fx.blur);
  gl.uniform1f(uniforms.uErode, fx.erode);
  gl.uniform1f(uniforms.uWarp, fx.warp);
  gl.uniform1f(uniforms.uHalftone, fx.halftone);
  gl.uniform1f(uniforms.uShimmer, fx.shimmer);
  gl.uniform1f(uniforms.uThreshold, fx.threshold);
  gl.uniform1f(uniforms.uEmboss, fx.emboss);
  gl.uniform1f(uniforms.uGlitch, fx.glitch);
  gl.uniform1f(uniforms.uGradient, fx.gradient);
  gl.uniform1f(uniforms.uSolarize, fx.solarize);
  gl.uniform1f(uniforms.uChroma, fx.chroma);
  // Pass palette colors as normalized vec3
  const pal = PALETTES[paletteIdx];
  gl.uniform3f(uniforms.uPalDark, pal.dark[0]/255, pal.dark[1]/255, pal.dark[2]/255);
  gl.uniform3f(uniforms.uPalMid, pal.mid[0]/255, pal.mid[1]/255, pal.mid[2]/255);
  gl.uniform3f(uniforms.uPalLight, pal.light[0]/255, pal.light[1]/255, pal.light[2]/255);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Continuous animation when time-dependent effects are active
  if (fx.warp > 0 || fx.noise > 0 || fx.shimmer > 0 || fx.glitch > 0) {
    animFrame = requestAnimationFrame(() => {
      renderGL();
      renderOverlay();
    });
  } else {
    animFrame = null;
  }
}

// ── Effects panel wiring ──────────────────────────────────────────────

const sliderMap = [
  { id: 'fx-gradient',  valId: 'v-gradient',  key: 'gradient' },
  { id: 'fx-solarize',  valId: 'v-solarize',  key: 'solarize' },
  { id: 'fx-chroma',    valId: 'v-chroma',    key: 'chroma' },
  { id: 'fx-stress',    valId: 'v-stress',    key: 'stress' },
  { id: 'fx-noise',     valId: 'v-noise',     key: 'noise' },
  { id: 'fx-blur',      valId: 'v-blur',      key: 'blur' },
  { id: 'fx-erode',     valId: 'v-erode',     key: 'erode' },
  { id: 'fx-warp',      valId: 'v-warp',      key: 'warp' },
  { id: 'fx-halftone',  valId: 'v-halftone',  key: 'halftone' },
  { id: 'fx-shimmer',   valId: 'v-shimmer',   key: 'shimmer' },
  { id: 'fx-threshold', valId: 'v-threshold', key: 'threshold' },
  { id: 'fx-emboss',    valId: 'v-emboss',    key: 'emboss' },
  { id: 'fx-glitch',    valId: 'v-glitch',    key: 'glitch' },
];

for (const s of sliderMap) {
  const slider = document.getElementById(s.id);
  const valEl = document.getElementById(s.valId);
  slider.addEventListener('input', () => {
    const raw = parseInt(slider.value, 10);
    valEl.textContent = raw;
    fx[s.key] = raw / 100;  // normalize to 0-1
    render();               // re-render 2D canvas (to update texture)
    renderGL();             // push through shader pipeline
  });
}

// Reset all effects
document.getElementById('btn-reset-fx').addEventListener('click', () => {
  for (const s of sliderMap) {
    const slider = document.getElementById(s.id);
    // Threshold resets to 50 (neutral); all others to 0
    const resetVal = s.key === 'threshold' ? 50 : 0;
    slider.value = resetVal;
    document.getElementById(s.valId).textContent = String(resetVal);
    fx[s.key] = resetVal / 100;
  }
  render();
  renderGL();
  updateStatus('Effects reset');
});

// ── Palette UI ────────────────────────────────────────────────────────
const palRow = document.getElementById('palette-row');
PALETTES.forEach((p, i) => {
  const sw = document.createElement('button');
  sw.className = 'palette-swatch' + (i === paletteIdx ? ' active' : '');
  // Use a gradient swatch showing dark→mid→light
  const c = `linear-gradient(135deg, rgb(${p.dark}), rgb(${p.mid}), rgb(${p.light}))`;
  sw.style.background = c;
  sw.title = p.name;
  sw.addEventListener('click', () => {
    palRow.querySelectorAll('.palette-swatch').forEach(s => s.classList.remove('active'));
    sw.classList.add('active');
    paletteIdx = i;
    if (hasActiveEffects() && glState) renderGL();
    updateStatus(`Palette: ${p.name}`);
  });
  palRow.appendChild(sw);
});

// ── Init ──────────────────────────────────────────────────────────────

resizeCanvas();

// Wait for fonts to load before placing hero text — prevents fallback font
// from appearing briefly and then jumping when the real font arrives.
document.fonts.ready.then(() => {
  // Set font picker to match the hero text
  fontPicker.value = 'Archivo Black';
  updateWeightPicker();

  const rect = wrap.getBoundingClientRect();
  const hero = createWord('TETSUO', 'Archivo Black', 400, 300, 0, 0);
  measureWord(hero);
  hero.x = (rect.width - hero.width) / 2;
  hero.y = (rect.height - hero.height) / 2;
  scene.push(hero);
  render();
  updateStatus('Ready — dbl-click edit · arrows nudge · R rotate · H/V flip · Ctrl+D dupe');
});

// Re-render when any font finishes loading (catches late-loading weights)
document.fonts.addEventListener('loadingdone', () => {
  for (const word of scene) measureWord(word);
  render();
  if (hasActiveEffects() && glState) renderGL();
});
