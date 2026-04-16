/* ── Tetsuo Type Tool — Main ────────────────────────────────────────────
   Libraries: Vanilla JS + Canvas 2D + WebGL (GLSL shaders) + Three.js (particles)
   Architecture: Scene graph of word objects → Canvas 2D render → WebGL pipeline
                 → Three.js particle overlay (optional)

   RENDER PIPELINE (DO NOT CHANGE ORDER):
   1. render()            — draws text to 2D canvas (visible when no effects active)
   2. createDataTexture() — draws blurred text to OFFSCREEN canvas for shader input
   3. renderGL()          — processes data texture through shader pipeline
   4. renderOverlay()     — draws selection UI + live cursor on top of everything
   
   CRITICAL: The data texture must ALWAYS be rendered from a SEPARATE offscreen
   canvas with gaussian blur applied. NEVER feed the main canvas directly into
   the shader — its binary black/white pixels produce blocky, aliased output.
   The offscreen canvas blur creates smooth gradients that the shader needs.
   ──────────────────────────────────────────────────────────────────── */

import './style.css';
import * as THREE from 'three';

// ── Font registry ─────────────────────────────────────────────────────
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
let nextId = 1;
const scene = [];
let selected = null;
let dragState = null;
let darkCanvas = false;

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
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
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
  if (particleSystem) resizeParticles();
  if (liquifyCanvas) resizeLiquify();
  render();
  if (hasActiveEffects() && glState) renderGL();
}

window.addEventListener('resize', resizeCanvas);

// ── Measure a word's bounding box ─────────────────────────────────────
// Pure measurement function — no side effects during render.
// Call BEFORE render(), not during it.

function measureWord(word) {
  ctx.save();
  ctx.font = `${word.fontWeight} ${word.fontSize}px '${word.fontFamily}'`;
  ctx.letterSpacing = `${word.letterSpacing || 0}px`;
  const metrics = ctx.measureText(word.text);
  word.width = metrics.width;
  word.ascent = metrics.actualBoundingBoxAscent;
  word.descent = metrics.actualBoundingBoxDescent;
  word.height = word.ascent + word.descent;
  ctx.letterSpacing = '0px';
  ctx.restore();
}

// ── Render loop ───────────────────────────────────────────────────────
// ANTI-BLOCKY FIX: render() only draws to the visible 2D canvas.
// It does NOT re-measure words during rendering — measurements are
// done separately when words are created, edited, or fonts load.

function render() {
  const rect = wrap.getBoundingClientRect();

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.fillStyle = darkCanvas ? '#000000' : '#ffffff';
  ctx.fillRect(0, 0, rect.width, rect.height);

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
  }

  renderOverlay();
}

// ── Selection overlay + live type cursor ──────────────────────────────

function renderOverlay() {
  const rect = wrap.getBoundingClientRect();
  overlayCtx.clearRect(0, 0, rect.width, rect.height);

  if (selected) {
    const s = selected;
    const pad = 6;
    const uiColor = darkCanvas ? '#aaa' : '#111';

    overlayCtx.strokeStyle = uiColor;
    overlayCtx.lineWidth = 1;
    overlayCtx.setLineDash([4, 3]);
    overlayCtx.strokeRect(s.x - pad, s.y - pad, s.width + pad * 2, s.height + pad * 2);
    overlayCtx.setLineDash([]);

    const handleSize = 5;
    const corners = getCorners(s, pad);
    overlayCtx.fillStyle = uiColor;
    for (const c of corners) {
      overlayCtx.fillRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
    }
  }

  // Live type cursor (blinking caret)
  if (liveTyping && liveTypeWord) {
    const w = liveTypeWord;
    ctx.save();
    ctx.font = `${w.fontWeight} ${w.fontSize}px '${w.fontFamily}'`;
    ctx.letterSpacing = `${w.letterSpacing || 0}px`;
    const textWidth = ctx.measureText(w.text).width;
    ctx.letterSpacing = '0px';
    ctx.restore();

    const cursorX = w.x + textWidth + 2;
    const cursorY = w.y;
    const cursorH = w.height || w.fontSize;

    const blink = Math.floor(performance.now() / 530) % 2 === 0;
    if (blink) {
      overlayCtx.strokeStyle = darkCanvas ? '#fff' : '#000';
      overlayCtx.lineWidth = 2;
      overlayCtx.beginPath();
      overlayCtx.moveTo(cursorX, cursorY);
      overlayCtx.lineTo(cursorX, cursorY + cursorH);
      overlayCtx.stroke();
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

function hitTest(x, y) {
  for (let i = scene.length - 1; i >= 0; i--) {
    const w = scene[i];
    if (x >= w.x && x <= w.x + w.width && y >= w.y && y <= w.y + w.height) {
      return w;
    }
  }
  return null;
}

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

// ── Live type system ──────────────────────────────────────────────────
// Click on the canvas to start typing directly. Text appears at the
// click position in real time. Double-click to edit existing words.

let liveTyping = false;
let liveTypeWord = null;
const liveInput = document.getElementById('live-type-input');
let cursorAnimFrame = null;

function startLiveType(x, y) {
  const fontFamily = fontPicker.value;
  const fontWeight = parseInt(weightPicker.value, 10);
  const fontSize = parseInt(sizePicker.value, 10) || 120;

  const word = createWord('', fontFamily, fontWeight, fontSize, x, y);
  word.color = colorPicker.value;
  word.letterSpacing = parseInt(trackingPicker.value, 10) || 0;

  // Pre-measure to get ascent/height using a reference character
  ctx.save();
  ctx.font = `${fontWeight} ${fontSize}px '${fontFamily}'`;
  const m = ctx.measureText('M');
  word.ascent = m.actualBoundingBoxAscent;
  word.descent = m.actualBoundingBoxDescent;
  word.height = word.ascent + word.descent;
  word.width = 0;
  ctx.restore();

  // Place baseline at click position
  word.y = y - word.ascent;

  scene.push(word);
  selected = word;
  liveTyping = true;
  liveTypeWord = word;

  liveInput.value = '';
  // Defer focus to next frame so pointerdown finishes first
  requestAnimationFrame(() => {
    liveInput.focus({ preventScroll: true });
  });

  startCursorBlink();

  render();
  if (hasActiveEffects() && glState) renderGL();
  updateStatus('Type on canvas — Enter to confirm, Escape to cancel');
}

function editWordLive(word) {
  selected = word;
  liveTyping = true;
  liveTypeWord = word;
  liveInput.value = word.text;
  requestAnimationFrame(() => {
    liveInput.focus({ preventScroll: true });
    // Place cursor at end of text
    liveInput.setSelectionRange(word.text.length, word.text.length);
  });
  startCursorBlink();
  render();
  if (hasActiveEffects() && glState) renderGL();
  updateStatus(`Editing "${word.text}"`);
}

function confirmLiveType() {
  if (!liveTypeWord) return;

  if (!liveTypeWord.text.trim()) {
    const idx = scene.indexOf(liveTypeWord);
    if (idx !== -1) scene.splice(idx, 1);
    if (selected === liveTypeWord) selected = null;
  } else {
    updateStatus(`"${liveTypeWord.text}" placed`);
  }

  liveTyping = false;
  liveTypeWord = null;
  liveInput.blur();
  stopCursorBlink();
  render();
  if (hasActiveEffects() && glState) renderGL();
}

function cancelLiveType() {
  if (!liveTypeWord) return;

  const idx = scene.indexOf(liveTypeWord);
  if (idx !== -1) scene.splice(idx, 1);
  if (selected === liveTypeWord) selected = null;

  liveTyping = false;
  liveTypeWord = null;
  liveInput.blur();
  stopCursorBlink();
  render();
  if (hasActiveEffects() && glState) renderGL();
  updateStatus('Cancelled');
}

function startCursorBlink() {
  stopCursorBlink();
  function blink() {
    renderOverlay();
    cursorAnimFrame = requestAnimationFrame(blink);
  }
  cursorAnimFrame = requestAnimationFrame(blink);
}

function stopCursorBlink() {
  if (cursorAnimFrame) {
    cancelAnimationFrame(cursorAnimFrame);
    cursorAnimFrame = null;
  }
}

liveInput.addEventListener('input', () => {
  if (!liveTyping || !liveTypeWord) return;
  liveTypeWord.text = liveInput.value || '';
  measureWord(liveTypeWord);
  render();
  if (hasActiveEffects() && glState) renderGL();
});

liveInput.addEventListener('keydown', (e) => {
  if (!liveTyping) return;

  if (e.key === 'Enter') {
    e.preventDefault();
    confirmLiveType();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cancelLiveType();
  }
});

liveInput.addEventListener('blur', () => {
  // Delay to let pointerdown events on canvas/toolbar process first.
  // If the user clicked on the canvas again or on a toolbar control,
  // those handlers will manage the typing state directly.
  setTimeout(() => {
    if (liveTyping && document.activeElement !== liveInput) {
      confirmLiveType();
    }
  }, 200);
});

// ── Pointer interaction ───────────────────────────────────────────────

canvas.addEventListener('pointerdown', (e) => {
  if (liquifyMode) return; // Handled by liquify brush in capture phase

  const rect = wrap.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (liveTyping) {
    confirmLiveType();
    // Small delay so the blur handler doesn't race with a new startLiveType
    return;
  }

  // Check resize handles first
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
    const idx = scene.indexOf(hit);
    if (idx !== -1) {
      scene.splice(idx, 1);
      scene.push(hit);
    }
    // Sync toolbar
    fontPicker.value = hit.fontFamily;
    updateWeightPicker();
    weightPicker.value = hit.fontWeight;
    sizePicker.value = hit.fontSize;
    colorPicker.value = hit.color;
    trackingPicker.value = hit.letterSpacing || 0;
  } else {
    selected = null;
    // Start live typing at click position
    startLiveType(x, y);
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
    const dx = x - dragState.startX;
    const dy = y - dragState.startY;
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

// Double-click to edit existing word inline
canvas.addEventListener('dblclick', (e) => {
  const rect = wrap.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const hit = hitTest(x, y);
  if (hit) {
    e.preventDefault();
    editWordLive(hit);
    fontPicker.value = hit.fontFamily;
    updateWeightPicker();
    weightPicker.value = hit.fontWeight;
    sizePicker.value = hit.fontSize;
    colorPicker.value = hit.color;
    trackingPicker.value = hit.letterSpacing || 0;
  }
});

// ── Keyboard shortcuts ────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  const isTyping = liveTyping;
  const isFocusedInput = document.activeElement && (
    document.activeElement.tagName === 'INPUT' ||
    document.activeElement.tagName === 'SELECT'
  ) && document.activeElement !== liveInput;

  // Delete selected word
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected && !isTyping && !isFocusedInput) {
    const idx = scene.indexOf(selected);
    if (idx !== -1) scene.splice(idx, 1);
    selected = null;
    render();
    if (hasActiveEffects() && glState) renderGL();
    e.preventDefault();
  }

  // Ctrl+Z — undo
  if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !isTyping) {
    if (scene.length > 0) {
      const removed = scene.pop();
      if (selected === removed) selected = null;
      render();
      if (hasActiveEffects() && glState) renderGL();
      updateStatus(`Removed "${removed.text}"`);
    }
    e.preventDefault();
  }

  // Escape
  if (e.key === 'Escape' && !isTyping) {
    if (selected) {
      selected = null;
      render();
      if (hasActiveEffects() && glState) renderGL();
    }
  }

  // Arrow keys — nudge
  if (selected && !isTyping && !isFocusedInput &&
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

  // Ctrl+D — duplicate
  if (e.key === 'd' && (e.ctrlKey || e.metaKey) && selected && !isTyping) {
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

  // R — rotate
  if (e.key === 'r' && selected && !isTyping && !isFocusedInput && !e.ctrlKey && !e.metaKey) {
    const step = e.shiftKey ? 1 : 15;
    selected.rotation = ((selected.rotation || 0) + step) % 360;
    render();
    if (hasActiveEffects() && glState) renderGL();
    updateStatus(`Rotated ${selected.rotation}°`);
    e.preventDefault();
  }

  // H — flip horizontal
  if (e.key === 'h' && selected && !isTyping && !isFocusedInput && !e.ctrlKey && !e.metaKey) {
    selected.scaleX = (selected.scaleX || 1) * -1;
    render();
    if (hasActiveEffects() && glState) renderGL();
    e.preventDefault();
  }

  // V — flip vertical
  if (e.key === 'v' && selected && !isTyping && !isFocusedInput && !e.ctrlKey && !e.metaKey) {
    selected.scaleY = (selected.scaleY || 1) * -1;
    render();
    if (hasActiveEffects() && glState) renderGL();
    e.preventDefault();
  }

  // [ / ] — layer order
  if (e.key === '[' && selected && !isTyping && !isFocusedInput) {
    const idx = scene.indexOf(selected);
    if (idx > 0) {
      scene.splice(idx, 1);
      scene.splice(idx - 1, 0, selected);
      render();
      if (hasActiveEffects() && glState) renderGL();
    }
    e.preventDefault();
  }
  if (e.key === ']' && selected && !isTyping && !isFocusedInput) {
    const idx = scene.indexOf(selected);
    if (idx < scene.length - 1) {
      scene.splice(idx, 1);
      scene.splice(idx + 1, 0, selected);
      render();
      if (hasActiveEffects() && glState) renderGL();
    }
    e.preventDefault();
  }
});

// ── UI wiring ─────────────────────────────────────────────────────────

const fontPicker = document.getElementById('font-picker');
const weightPicker = document.getElementById('weight-picker');
const sizePicker = document.getElementById('size-picker');
const colorPicker = document.getElementById('color-picker');
const trackingPicker = document.getElementById('tracking-picker');
const btnClear = document.getElementById('btn-clear');
const btnExport = document.getElementById('btn-export');
const statusEl = document.getElementById('status');

// Populate font picker
for (const f of FONTS) {
  const opt = document.createElement('option');
  opt.value = f.family;
  opt.textContent = f.family;
  opt.style.fontFamily = `'${f.family}'`;
  fontPicker.appendChild(opt);
}

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
  if (selected) {
    selected.fontFamily = fontPicker.value;
    selected.fontWeight = parseInt(weightPicker.value, 10);
    measureWord(selected);
    render();
    if (hasActiveEffects() && glState) renderGL();
  }
});
updateWeightPicker();

weightPicker.addEventListener('change', () => {
  if (selected) {
    selected.fontWeight = parseInt(weightPicker.value, 10);
    measureWord(selected);
    render();
    if (hasActiveEffects() && glState) renderGL();
  }
});

sizePicker.addEventListener('change', () => {
  if (selected) {
    selected.fontSize = parseInt(sizePicker.value, 10) || 120;
    measureWord(selected);
    render();
    if (hasActiveEffects() && glState) renderGL();
  }
});

colorPicker.addEventListener('input', () => {
  // Update the live-typing word if active, otherwise the selected word
  const target = (liveTyping && liveTypeWord) ? liveTypeWord : selected;
  if (target) {
    target.color = colorPicker.value;
    render();
    if (hasActiveEffects() && glState) renderGL();
  }
});

trackingPicker.addEventListener('change', () => {
  if (selected) {
    selected.letterSpacing = parseInt(trackingPicker.value, 10) || 0;
    measureWord(selected);
    render();
    if (hasActiveEffects() && glState) renderGL();
  }
});

// Clear canvas
btnClear.addEventListener('click', () => {
  if (liveTyping) confirmLiveType();
  scene.length = 0;
  selected = null;
  render();
  if (hasActiveEffects() && glState) renderGL();
  updateStatus('Canvas cleared');
});

// Invert canvas
const btnInvert = document.getElementById('btn-invert');
btnInvert.addEventListener('click', () => {
  darkCanvas = !darkCanvas;
  wrap.style.background = darkCanvas ? '#000' : '#fff';
  btnInvert.style.opacity = darkCanvas ? '1' : '0.5';
  colorPicker.value = darkCanvas ? '#ffffff' : '#000000';
  render();
  if (hasActiveEffects() && glState) renderGL();
  updateStatus(darkCanvas ? 'Dark canvas' : 'Light canvas');
});

// Export PNG
btnExport.addEventListener('click', () => {
  const prevSelected = selected;
  if (liveTyping) confirmLiveType();
  selected = null;
  render();

  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }

  const exportCanvas = hasActiveEffects() && glState ? glCanvas : canvas;
  if (hasActiveEffects()) renderGL();

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
  if (hasActiveEffects() && glState) renderGL();
});

function updateStatus(msg) {
  statusEl.textContent = msg;
}

// ── Cursor management ─────────────────────────────────────────────────

// ── Cursor management + mouse position tracking ──────────────────────
// Track mouse for cursor display AND for mouse-reactive shader effects.

let mouseX = -1.0, mouseY = -1.0; // Normalized 0-1, -1 = not on canvas yet
let mouseOnCanvas = false;

canvas.addEventListener('mousemove', (e) => {
  const rect = wrap.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  mouseX = x / rect.width;
  mouseY = y / rect.height;
  mouseOnCanvas = true;

  if (dragState || liquifyMode) return;

  const corner = hitHandle(x, y);
  if (corner) {
    canvas.style.cursor = (corner === 'tl' || corner === 'br') ? 'nwse-resize' : 'nesw-resize';
    return;
  }

  const hit = hitTest(x, y);
  canvas.style.cursor = hit ? 'grab' : 'text';
});

canvas.addEventListener('mouseleave', () => {
  mouseOnCanvas = false;
});

// Scroll-to-resize
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
// 16 stackable effects in a single shader pass.
// ANTI-BLOCKY: Uses a SEPARATE pre-blurred offscreen canvas as
// the data texture — never the main canvas.

const glCanvas = document.getElementById('gl');

// ── Palettes ──────────────────────────────────────────────────────────
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

// Effect uniforms
const fx = {
  stress: 0,
  noise: 0,
  noiseSpeed: 0.3,
  noiseScale: 0.5,
  noiseOrganic: 0.4,
  blur: 0,
  erode: 0,
  warp: 0,
  threshold: 0.5,
  gradient: 0,
  solarize: 0,
  chroma: 0,
  halftone: 0,
  shimmer: 0,
  emboss: 0,
  glitch: 0,
  pixelsort: 0,
  bloom: 0,
  scanlines: 0,
  vignette: 0,
};

// ── Liquify brush ─────────────────────────────────────────────────────
// Writes mouse velocity into a displacement texture. The shader reads
// this texture and offsets UVs before all other effects. The texture
// decays each frame for an organic, slow-fade feel.

let liquifyMode = false;
let liquifyCanvas = null;
let liquifyCtx = null;
let liquifyTexture = null;
let liquifyPrev = null; // { x, y } last mouse position
const LIQUIFY_RADIUS = 40;
const LIQUIFY_STRENGTH = 12;
const LIQUIFY_DECAY = 0.985;

function initLiquify() {
  const dpr = window.devicePixelRatio || 1;
  const rect = wrap.getBoundingClientRect();
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);

  liquifyCanvas = document.createElement('canvas');
  liquifyCanvas.width = w;
  liquifyCanvas.height = h;
  liquifyCtx = liquifyCanvas.getContext('2d');
  // Initialize to neutral (128,128 = zero displacement)
  liquifyCtx.fillStyle = 'rgb(128,128,128)';
  liquifyCtx.fillRect(0, 0, w, h);
}

function resizeLiquify() {
  if (!liquifyCanvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = wrap.getBoundingClientRect();
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);

  // Preserve existing displacement when resizing
  const oldData = liquifyCtx.getImageData(0, 0, liquifyCanvas.width, liquifyCanvas.height);
  liquifyCanvas.width = w;
  liquifyCanvas.height = h;
  liquifyCtx.fillStyle = 'rgb(128,128,128)';
  liquifyCtx.fillRect(0, 0, w, h);
  liquifyCtx.drawImage(createImageBitmap ? liquifyCanvas : liquifyCanvas, 0, 0);
}

function stampLiquify(x, y, dx, dy) {
  if (!liquifyCanvas) initLiquify();
  const dpr = window.devicePixelRatio || 1;
  const cx = x * dpr;
  // Flip Y: canvas is top-down but GL texture is bottom-up
  const cy = liquifyCanvas.height - (y * dpr);
  const r = LIQUIFY_RADIUS * dpr;

  // Clamp velocity
  const maxV = 30;
  dx = Math.max(-maxV, Math.min(maxV, dx));
  dy = Math.max(-maxV, Math.min(maxV, dy));

  // Stamp a radial gradient encoding the displacement direction
  // R channel = x displacement (128 = neutral)
  // G channel = y displacement (128 = neutral)
  const rVal = Math.round(128 + dx * LIQUIFY_STRENGTH);
  const gVal = Math.round(128 - dy * LIQUIFY_STRENGTH); // Negate Y: canvas Y-down → GL Y-up

  const gradient = liquifyCtx.createRadialGradient(cx, cy, 0, cx, cy, r);
  const col = `rgba(${rVal},${gVal},128,`;
  gradient.addColorStop(0, col + '0.8)');
  gradient.addColorStop(0.5, col + '0.4)');
  gradient.addColorStop(1, col + '0)');

  liquifyCtx.globalCompositeOperation = 'source-over';
  liquifyCtx.fillStyle = gradient;
  liquifyCtx.fillRect(cx - r, cy - r, r * 2, r * 2);
}

function decayLiquify() {
  if (!liquifyCanvas) return;
  const w = liquifyCanvas.width;
  const h = liquifyCanvas.height;
  const imageData = liquifyCtx.getImageData(0, 0, w, h);
  const d = imageData.data;

  // Fade all displacement toward neutral (128)
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = Math.round(128 + (d[i]     - 128) * LIQUIFY_DECAY); // R
    d[i + 1] = Math.round(128 + (d[i + 1] - 128) * LIQUIFY_DECAY); // G
    // B stays at 128, A stays at 255
  }
  liquifyCtx.putImageData(imageData, 0, 0);
}

function clearLiquify() {
  if (!liquifyCanvas) return;
  liquifyCtx.fillStyle = 'rgb(128,128,128)';
  liquifyCtx.fillRect(0, 0, liquifyCanvas.width, liquifyCanvas.height);
}

function hasLiquifyData() {
  if (!liquifyCanvas) return false;
  // Quick check: sample center pixel
  const d = liquifyCtx.getImageData(
    Math.floor(liquifyCanvas.width / 2),
    Math.floor(liquifyCanvas.height / 2), 1, 1
  ).data;
  return d[0] !== 128 || d[1] !== 128;
}

// Liquify brush button
const btnLiquify = document.getElementById('btn-liquify');
btnLiquify.addEventListener('click', () => {
  liquifyMode = !liquifyMode;
  btnLiquify.classList.toggle('active', liquifyMode);
  wrap.classList.toggle('liquify-active', liquifyMode);
  // Clear inline cursor so CSS cursor takes over
  if (liquifyMode) canvas.style.cursor = '';
  updateStatus(liquifyMode ? 'Liquify brush ON — drag to push type' : 'Liquify brush OFF');
});

// L key toggles liquify
document.addEventListener('keydown', (e) => {
  if (e.key === 'l' && !liveTyping && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') {
    liquifyMode = !liquifyMode;
    btnLiquify.classList.toggle('active', liquifyMode);
    wrap.classList.toggle('liquify-active', liquifyMode);
    if (liquifyMode) canvas.style.cursor = '';
    updateStatus(liquifyMode ? 'Liquify brush ON' : 'Liquify brush OFF');
    e.preventDefault();
  }
  // X clears liquify displacement
  if (e.key === 'x' && !liveTyping && document.activeElement.tagName !== 'INPUT') {
    clearLiquify();
    render();
    if (hasActiveEffects() && glState) renderGL();
    updateStatus('Liquify cleared');
    e.preventDefault();
  }
});

// Liquify brush interaction on canvas
canvas.addEventListener('pointerdown', (e) => {
  if (!liquifyMode) return;
  const rect = wrap.getBoundingClientRect();
  liquifyPrev = {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
  canvas.setPointerCapture(e.pointerId);
  e.stopPropagation();
}, true); // capture phase to intercept before normal pointerdown

canvas.addEventListener('pointermove', (e) => {
  if (!liquifyMode || !liquifyPrev) return;
  const rect = wrap.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const dx = x - liquifyPrev.x;
  const dy = y - liquifyPrev.y;

  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
    if (!liquifyCanvas) initLiquify();
    stampLiquify(x, y, dx, dy);
    liquifyPrev = { x, y };
    render();
    renderGL();
  }
});

canvas.addEventListener('pointerup', () => {
  liquifyPrev = null;
});

// ── Preset system ─────────────────────────────────────────────────────

const PRESETS = [
  { name: 'Letterpress', values: { stress: 30, noise: 15, blur: 10, erode: 20, threshold: 55, noiseScale: 60, noiseOrganic: 70, noiseSpeed: 0 } },
  { name: 'Acid Etch', values: { erode: 65, noise: 40, warp: 15, threshold: 45, noiseScale: 80, noiseOrganic: 20, noiseSpeed: 50 } },
  { name: 'Sun-Bleached', values: { stress: 15, erode: 25, solarize: 20, gradient: 40, threshold: 42, bloom: 20, vignette: 30 } },
  { name: 'Darkroom Print', values: { stress: 45, noise: 25, threshold: 60, emboss: 15, vignette: 40, noiseOrganic: 60, noiseSpeed: 10 } },
  { name: 'CRT Monitor', values: { scanlines: 50, chroma: 30, bloom: 25, glitch: 15, noise: 10, noiseSpeed: 80, vignette: 35 } },
  { name: 'Risograph', values: { halftone: 45, chroma: 20, noise: 20, stress: 10, gradient: 50, noiseScale: 40, noiseOrganic: 50 } },
  { name: 'Corrupted', values: { glitch: 60, pixelsort: 40, noise: 50, chroma: 35, shimmer: 20, noiseSpeed: 90, noiseScale: 70 } },
  { name: 'Molten', values: { warp: 55, stress: 40, bloom: 35, shimmer: 30, noise: 20, gradient: 60, noiseOrganic: 80 } },
  { name: 'Ghost', values: { blur: 35, erode: 30, noise: 15, solarize: 15, emboss: 25, threshold: 40, vignette: 45, bloom: 15 } },
  { name: 'Iron Man', values: { stress: 50, erode: 40, warp: 30, noise: 60, emboss: 30, threshold: 60, noiseOrganic: 90, noiseSpeed: 20, noiseScale: 65, vignette: 25 } },
];

const presetPicker = document.getElementById('preset-picker');

// Populate preset dropdown
for (const p of PRESETS) {
  const opt = document.createElement('option');
  opt.value = p.name;
  opt.textContent = p.name;
  presetPicker.appendChild(opt);
}
// Add separator + special options
const optSep = document.createElement('option');
optSep.disabled = true;
optSep.textContent = '───';
presetPicker.appendChild(optSep);
const optShare = document.createElement('option');
optShare.value = '__share';
optShare.textContent = '⟳ Copy link';
presetPicker.appendChild(optShare);

presetPicker.addEventListener('change', () => {
  const val = presetPicker.value;

  if (val === '__share') {
    shareState();
    presetPicker.value = '';
    return;
  }

  const preset = PRESETS.find(p => p.name === val);
  if (!preset) return;

  applyPresetValues(preset.values);
  presetPicker.value = '';
  updateStatus(`Preset: ${preset.name}`);
});

function applyPresetValues(values) {
  // Reset all sliders to defaults first
  for (const s of sliderMap) {
    const resetVal = s.key === 'threshold' ? 50 : 0;
    const slider = document.getElementById(s.id);
    slider.value = resetVal;
    document.getElementById(s.valId).textContent = String(resetVal);
    fx[s.key] = resetVal / 100;
  }
  for (const s of noiseSubSliders) {
    const defaults = { noiseSpeed: 30, noiseScale: 50, noiseOrganic: 40 };
    const val = defaults[s.key] || 50;
    const slider = document.getElementById(s.id);
    slider.value = val;
    document.getElementById(s.valId).textContent = String(val);
    fx[s.key] = val / 100;
  }

  // Apply preset values
  for (const [key, val] of Object.entries(values)) {
    // Check if it's a main slider
    const mainSlider = sliderMap.find(s => s.key === key);
    if (mainSlider) {
      const slider = document.getElementById(mainSlider.id);
      slider.value = val;
      document.getElementById(mainSlider.valId).textContent = String(val);
      fx[key] = val / 100;
      continue;
    }
    // Check noise sub-sliders
    const noiseSub = noiseSubSliders.find(s => s.key === key);
    if (noiseSub) {
      const slider = document.getElementById(noiseSub.id);
      slider.value = val;
      document.getElementById(noiseSub.valId).textContent = String(val);
      fx[key] = val / 100;
    }
  }

  // Show noise sub-controls if noise is active
  document.getElementById('noise-sub-controls').style.display = fx.noise > 0 ? 'block' : 'none';

  render();
  renderGL();
}

// ── URL state sharing ─────────────────────────────────────────────────

function serializeState() {
  const state = {};
  // Collect all non-default slider values
  for (const s of sliderMap) {
    const defaultVal = s.key === 'threshold' ? 50 : 0;
    const val = parseInt(document.getElementById(s.id).value, 10);
    if (val !== defaultVal) state[s.key] = val;
  }
  for (const s of noiseSubSliders) {
    const defaults = { noiseSpeed: 30, noiseScale: 50, noiseOrganic: 40 };
    const val = parseInt(document.getElementById(s.id).value, 10);
    if (val !== (defaults[s.key] || 50)) state[s.key] = val;
  }
  // Include text + font if present
  if (scene.length > 0) {
    state.text = scene.map(w => w.text).join('|');
    state.font = scene[0].fontFamily;
  }
  if (darkCanvas) state.dark = 1;
  if (paletteIdx > 0) state.pal = paletteIdx;
  return state;
}

function shareState() {
  const state = serializeState();
  const encoded = btoa(JSON.stringify(state));
  const url = `${window.location.origin}${window.location.pathname}#${encoded}`;
  navigator.clipboard.writeText(url).then(() => {
    updateStatus('Link copied to clipboard');
  }).catch(() => {
    updateStatus('Could not copy link');
  });
}

function loadStateFromURL() {
  const hash = window.location.hash.slice(1);
  if (!hash) return false;
  try {
    const state = JSON.parse(atob(hash));
    if (typeof state !== 'object') return false;

    // Apply palette
    if (state.pal !== undefined) {
      paletteIdx = state.pal;
      const swatches = document.querySelectorAll('.palette-swatch');
      swatches.forEach((s, i) => s.classList.toggle('active', i === paletteIdx));
    }
    if (state.dark) {
      darkCanvas = true;
      wrap.style.background = '#000';
      document.getElementById('btn-invert').style.opacity = '1';
      colorPicker.value = '#ffffff';
    }

    // Build values object from state (exclude non-fx keys)
    const fxValues = {};
    for (const [k, v] of Object.entries(state)) {
      if (['text', 'font', 'dark', 'pal'].includes(k)) continue;
      fxValues[k] = v;
    }
    applyPresetValues(fxValues);

    return true;
  } catch (e) {
    return false;
  }
}

initLiquify();

function initGL() {
  const gl = glCanvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: true });
  if (!gl) {
    console.warn('WebGL not available');
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
  // FRAGMENT SHADER — 16 effects + palette + anti-banding dither
  //
  // Pipeline:
  //   shimmer → glitch → warp → noise displacement → multi-sample →
  //   erode → noise grain → threshold → emboss → solarize →
  //   halftone → pixel sort → bloom → chroma → gradient → dither
  //
  // ANTI-BLOCKY: Input is pre-blurred, sampling is multi-tap,
  // output has dithering to prevent banding.
  // ═══════════════════════════════════════════════════════════════════
  const fsSource = `
    precision highp float;
    uniform sampler2D uTex;
    uniform sampler2D uLiquify;
    uniform float uLiquifyActive;
    uniform vec2 uRes;
    uniform float uTime;
    uniform float uInvert;
    uniform float uStress;
    uniform float uNoise;
    uniform float uNoiseSpeed;
    uniform float uNoiseScale;
    uniform float uNoiseOrganic;
    uniform float uBlur;
    uniform float uErode;
    uniform float uWarp;
    uniform float uHalftone;
    uniform float uShimmer;
    uniform float uPixelsort;
    uniform float uThreshold;
    uniform float uEmboss;
    uniform float uGlitch;
    uniform float uBloom;
    uniform float uScanlines;
    uniform float uVignette;
    uniform float uGradient;
    uniform float uSolarize;
    uniform float uChroma;
    uniform vec3 uPalDark;
    uniform vec3 uPalMid;
    uniform vec3 uPalLight;
    varying vec2 vUv;

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
      for (int i = 0; i < 6; i++) {
        v += vnoise(p) * a;
        p = rot * p * 2.1 + vec2(1.7, 9.2);
        a *= 0.5;
      }
      return v;
    }

    float fbmFast(vec2 p) {
      float v = 0.0, a = 0.5;
      mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
      for (int i = 0; i < 3; i++) {
        v += vnoise(p) * a;
        p = rot * p * 2.1 + vec2(1.7, 9.2);
        a *= 0.5;
      }
      return v;
    }

    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

    float dither(vec2 coord) {
      return (hash(coord + fract(uTime * 0.1)) - 0.5) / 255.0;
    }

    void main() {
      vec2 px = 1.0 / uRes;
      vec2 uv = vec2(vUv.x, 1.0 - vUv.y);

      // ── LIQUIFY DISPLACEMENT ────────────────────────────────────
      // Read displacement from the liquify texture (R=dx, G=dy, 128=neutral)
      // Stamp coords and directions are pre-flipped to match GL space.
      if (uLiquifyActive > 0.5) {
        vec4 liq = texture2D(uLiquify, vUv);
        vec2 disp = (liq.rg - 0.5) * 2.0;
        float dispMag = length(disp);
        if (dispMag > 0.005) {
          uv += disp * 0.04;
        }
      }

      // ── SHIMMER ─────────────────────────────────────────────────
      vec2 shimUv = uv;
      if (uShimmer > 0.001) {
        float t = uTime * 0.8;
        float sx = sin(uv.y * 60.0 + t * 2.3) * sin(uv.y * 23.0 - t * 1.1);
        float sy = sin(uv.x * 45.0 + t * 1.7) * sin(uv.x * 31.0 - t * 2.1);
        shimUv += vec2(sx, sy) * uShimmer * 0.008;
      }

      // ── GLITCH ──────────────────────────────────────────────────
      vec2 glitchUv = shimUv;
      if (uGlitch > 0.001) {
        float band = floor(shimUv.y * uRes.y / (3.0 + uGlitch * 8.0));
        float shift = (hash(vec2(band, floor(uTime * 4.0))) - 0.5);
        float active = step(0.85 - uGlitch * 0.3, hash(vec2(band * 0.1, floor(uTime * 6.0))));
        glitchUv.x += shift * uGlitch * 0.08 * active;
      }

      // ── WARP ────────────────────────────────────────────────────
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

      // ── NOISE DISPLACEMENT ──────────────────────────────────────
      if (uNoise > 0.001) {
        float displaceAmt = uNoise * 0.012;
        float noiseFreq = mix(15.0, 60.0, uNoiseScale);
        float timeScale = uNoiseSpeed * 0.15;

        float dxHash = (hash(dataUv * noiseFreq * 1.1 + vec2(7.3, 13.1 + uTime * timeScale)) - 0.5);
        float dyHash = (hash(dataUv * noiseFreq * 0.9 + vec2(41.7, 3.9 - uTime * timeScale * 0.8)) - 0.5);
        float dxFbm = (fbmFast(dataUv * noiseFreq * 0.3 + vec2(7.3, 13.1 + uTime * timeScale * 0.5)) - 0.5);
        float dyFbm = (fbmFast(dataUv * noiseFreq * 0.3 + vec2(41.7, 3.9 - uTime * timeScale * 0.4)) - 0.5);

        float dx = mix(dxHash, dxFbm, uNoiseOrganic) * displaceAmt;
        float dy = mix(dyHash, dyFbm, uNoiseOrganic) * displaceAmt;
        dataUv += vec2(dx, dy);
      }

      // ── MULTI-SAMPLE (ANTI-BLOCKY) ──────────────────────────────
      float data;
      {
        float center = 1.0 - luma(texture2D(uTex, dataUv).rgb);
        float s1 = 1.0 - luma(texture2D(uTex, dataUv + vec2(px.x * 0.5, 0.0)).rgb);
        float s2 = 1.0 - luma(texture2D(uTex, dataUv - vec2(px.x * 0.5, 0.0)).rgb);
        float s3 = 1.0 - luma(texture2D(uTex, dataUv + vec2(0.0, px.y * 0.5)).rgb);
        float s4 = 1.0 - luma(texture2D(uTex, dataUv - vec2(0.0, px.y * 0.5)).rgb);
        data = (center * 2.0 + s1 + s2 + s3 + s4) / 6.0;
      }

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
        float en = fbmFast(dataUv * 25.0 + vec2(19.3, 7.1)) * 0.5
                 + vnoise(dataUv * 80.0 + vec2(3.1, 17.3)) * 0.3
                 + hash(dataUv * uRes * 0.3 + vec2(11.1, 43.7)) * 0.2;
        data = max(0.0, data - uErode * (exposure * 0.9 + en * 0.6));
      }

      // ── NOISE GRAIN ─────────────────────────────────────────────
      if (uNoise > 0.001) {
        float textPresence = smoothstep(0.02, 0.12, data);
        float edgePeak = 4.0 * data * (1.0 - data);
        float midtoneMask = smoothstep(0.0, 0.3, data) * smoothstep(1.0, 0.6, data);
        float fullMask = (edgePeak * 0.5 + midtoneMask * 0.3 + data * 0.2) * textPresence;

        float timeVal = uTime * uNoiseSpeed;
        float grainFreq = mix(0.3, 3.0, uNoiseScale);

        float h1 = hash(dataUv * uRes * grainFreq + timeVal * 7.3) - 0.5;
        float h2 = hash(dataUv * uRes * grainFreq * 0.414 + vec2(73.1, 41.9) + timeVal * 3.1) - 0.5;
        float h3 = hash(dataUv * uRes * grainFreq * 1.73 + vec2(17.3, 89.1) + timeVal * 1.7) - 0.5;
        float hashGrain = h1 * 0.45 + h2 * 0.35 + h3 * 0.2;

        float fbmFreq = mix(20.0, 80.0, uNoiseScale);
        float f1 = (fbmFast(dataUv * fbmFreq + vec2(3.7 + timeVal * 0.04, 11.3)) - 0.5);
        float f2 = (vnoise(dataUv * fbmFreq * 2.0 + vec2(17.1 - timeVal * 0.06, 31.7)) - 0.5);
        float organicGrain = f1 * 0.6 + f2 * 0.4;

        float grain = mix(hashGrain, organicGrain, uNoiseOrganic);
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
      // Stress gamma: gentler curve to avoid banding.
      // The heavy lifting is done by the pre-blur on the data texture,
      // not by a harsh gamma curve. Keep gamma above 0.6 to stay smooth.
      float gamma = mix(0.85, 0.6, uStress);
      data = pow(clamp(data, 0.0, 1.0), gamma);

      // ── EMBOSS ──────────────────────────────────────────────────
      if (uEmboss > 0.001) {
        float eL = 1.0 - luma(texture2D(uTex, dataUv + vec2(-px.x * 2.0, 0.0)).rgb);
        float eR = 1.0 - luma(texture2D(uTex, dataUv + vec2( px.x * 2.0, 0.0)).rgb);
        float eU = 1.0 - luma(texture2D(uTex, dataUv + vec2(0.0, -px.y * 2.0)).rgb);
        float eD = 1.0 - luma(texture2D(uTex, dataUv + vec2(0.0,  px.y * 2.0)).rgb);
        float gx = eR - eL;
        float gy = eD - eU;
        float light = (gx * 0.707 + gy * -0.707) * 0.5 + 0.5;
        data = mix(data, data * light * 1.8, uEmboss * 0.8);
        data = clamp(data, 0.0, 1.0);
      }

      // ── SOLARIZE ────────────────────────────────────────────────
      if (uSolarize > 0.001) {
        float curve = sin(data * 3.14159 * (1.0 + uSolarize * 2.0));
        data = mix(data, abs(curve), uSolarize);
        data = clamp(data, 0.0, 1.0);
      }

      // ── HALFTONE ────────────────────────────────────────────────
      if (uHalftone > 0.001) {
        float dotSize = 3.0 + uHalftone * 15.0;
        float angle = 0.2618;
        float ca = cos(angle), sa = sin(angle);
        vec2 rotUv = vec2(ca * dataUv.x - sa * dataUv.y, sa * dataUv.x + ca * dataUv.y);
        vec2 cell = rotUv * uRes / dotSize;
        vec2 cellCenter = (floor(cell) + 0.5) * dotSize / uRes;
        vec2 origCenter = vec2(ca * cellCenter.x + sa * cellCenter.y,
                              -sa * cellCenter.x + ca * cellCenter.y);
        float cellData = 1.0 - luma(texture2D(uTex, origCenter).rgb);
        cellData = pow(clamp(cellData, 0.0, 1.0), gamma);
        float dist = length(fract(cell) - 0.5);
        float radius = sqrt(cellData) * 0.5;
        float dot = 1.0 - smoothstep(radius - 0.04, radius + 0.04, dist);
        data = mix(data, dot, uHalftone);
      }

      // ── PIXEL SORT ──────────────────────────────────────────────
      if (uPixelsort > 0.001) {
        float sortThresh = 0.15;
        float sortRange = uPixelsort * 0.15;
        float sortedData = data;
        float maxData = data;
        float accumWeight = 1.0;
        for (int i = 1; i <= 8; i++) {
          float offset = float(i) * sortRange * px.x * uRes.x * 0.05;
          float sampleL = 1.0 - luma(texture2D(uTex, dataUv + vec2(-offset * px.x, 0.0)).rgb);
          float sampleR = 1.0 - luma(texture2D(uTex, dataUv + vec2( offset * px.x, 0.0)).rgb);
          sampleL = pow(clamp(sampleL, 0.0, 1.0), gamma);
          sampleR = pow(clamp(sampleR, 0.0, 1.0), gamma);
          float wL = step(sortThresh, sampleL) * (1.0 - float(i) * 0.1);
          float wR = step(sortThresh, sampleR) * (1.0 - float(i) * 0.1);
          sortedData += sampleL * wL + sampleR * wR;
          accumWeight += wL + wR;
          maxData = max(maxData, max(sampleL * wL, sampleR * wR));
        }
        sortedData /= accumWeight;
        float sortBlend = smoothstep(sortThresh, sortThresh + 0.2, data);
        data = mix(data, mix(sortedData, maxData, uPixelsort * 0.4), uPixelsort * sortBlend);
        data = clamp(data, 0.0, 1.0);
      }

      // ── BLOOM ───────────────────────────────────────────────────
      if (uBloom > 0.001) {
        float bloomAcc = 0.0;
        float bloomSamples = 0.0;
        float bloomRadius = uBloom * 20.0;
        for (int i = 0; i < 12; i++) {
          float angle = float(i) * 0.5236;
          for (int r = 1; r <= 3; r++) {
            float rd = float(r) * bloomRadius;
            vec2 off = vec2(cos(angle), sin(angle)) * rd * px;
            float s = 1.0 - luma(texture2D(uTex, dataUv + off).rgb);
            s = pow(clamp(s, 0.0, 1.0), gamma);
            float weight = 1.0 / (1.0 + float(r) * 0.5);
            bloomAcc += s * weight;
            bloomSamples += weight;
          }
        }
        bloomAcc /= bloomSamples;
        data = data + bloomAcc * uBloom * 0.6;
        data = clamp(data, 0.0, 1.0);
      }

      // ── COLOR OUTPUT ────────────────────────────────────────────
      float brightness = 1.0 - data;
      if (uInvert > 0.5) brightness = 1.0 - brightness;
      vec3 col = vec3(brightness);

      // ── SCANLINES ───────────────────────────────────────────────
      // CRT monitor scan lines — dark lines at regular intervals
      // with slight phosphor glow between them
      if (uScanlines > 0.001) {
        float scanY = gl_FragCoord.y;
        float lineSpacing = mix(4.0, 2.0, uScanlines);
        float scanLine = smoothstep(0.0, 0.5, abs(sin(scanY / lineSpacing * 3.14159)));
        float scanDim = mix(1.0, 0.65, uScanlines);
        float scanMask = mix(1.0, scanLine * scanDim + (1.0 - scanDim), uScanlines);
        col *= scanMask;
        // Slight green phosphor tint at high values
        if (uScanlines > 0.5) {
          float tint = (uScanlines - 0.5) * 0.15;
          col.g += tint * brightness * 0.3;
        }
      }

      // ── GRADIENT ────────────────────────────────────────────────
      if (uGradient > 0.001) {
        float textMask = smoothstep(0.02, 0.08, data);
        vec3 palColor;
        if (data > 0.5) {
          palColor = mix(uPalMid, uPalDark, (data - 0.5) * 2.0);
        } else {
          palColor = mix(uPalLight, uPalMid, data * 2.0);
        }
        if (uInvert > 0.5) {
          if (data > 0.5) {
            palColor = mix(uPalMid, uPalLight, (data - 0.5) * 2.0);
          } else {
            palColor = mix(uPalDark, uPalMid, data * 2.0);
          }
        }
        col = mix(col, palColor * textMask + col * (1.0 - textMask), uGradient);
      }

      // ── CHROMA ──────────────────────────────────────────────────
      if (uChroma > 0.001) {
        float chromaAmt = uChroma * 0.015;
        vec2 center = vec2(0.5);
        vec2 dir = dataUv - center;
        float rData = 1.0 - luma(texture2D(uTex, dataUv + dir * chromaAmt).rgb);
        float bData = 1.0 - luma(texture2D(uTex, dataUv - dir * chromaAmt).rgb);
        rData = pow(clamp(rData, 0.0, 1.0), gamma);
        bData = pow(clamp(bData, 0.0, 1.0), gamma);
        float rBright = 1.0 - rData;
        float bBright = 1.0 - bData;
        if (uInvert > 0.5) { rBright = 1.0 - rBright; bBright = 1.0 - bBright; }
        col.r = mix(col.r, rBright, uChroma);
        col.b = mix(col.b, bBright, uChroma);
      }

      // ── VIGNETTE ───────────────────────────────────────────────
      // Camera lens falloff — darkens edges for a cinematic look
      if (uVignette > 0.001) {
        vec2 vigUv = uv - 0.5;
        float vigDist = length(vigUv) * 1.4;
        float vig = 1.0 - smoothstep(0.4, 1.2, vigDist) * uVignette;
        col *= vig;
      }

      // ── DITHERING (ANTI-BLOCKY) ─────────────────────────────────
      col += dither(gl_FragCoord.xy);

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

  const quadVerts = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  // Liquify displacement texture (texture unit 1)
  const liquifyTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, liquifyTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const uniforms = {
    uTex: gl.getUniformLocation(program, 'uTex'),
    uLiquify: gl.getUniformLocation(program, 'uLiquify'),
    uLiquifyActive: gl.getUniformLocation(program, 'uLiquifyActive'),
    uRes: gl.getUniformLocation(program, 'uRes'),
    uTime: gl.getUniformLocation(program, 'uTime'),
    uInvert: gl.getUniformLocation(program, 'uInvert'),
    uStress: gl.getUniformLocation(program, 'uStress'),
    uNoise: gl.getUniformLocation(program, 'uNoise'),
    uNoiseSpeed: gl.getUniformLocation(program, 'uNoiseSpeed'),
    uNoiseScale: gl.getUniformLocation(program, 'uNoiseScale'),
    uNoiseOrganic: gl.getUniformLocation(program, 'uNoiseOrganic'),
    uBlur: gl.getUniformLocation(program, 'uBlur'),
    uErode: gl.getUniformLocation(program, 'uErode'),
    uWarp: gl.getUniformLocation(program, 'uWarp'),
    uHalftone: gl.getUniformLocation(program, 'uHalftone'),
    uShimmer: gl.getUniformLocation(program, 'uShimmer'),
    uPixelsort: gl.getUniformLocation(program, 'uPixelsort'),
    uThreshold: gl.getUniformLocation(program, 'uThreshold'),
    uEmboss: gl.getUniformLocation(program, 'uEmboss'),
    uGlitch: gl.getUniformLocation(program, 'uGlitch'),
    uBloom: gl.getUniformLocation(program, 'uBloom'),
    uScanlines: gl.getUniformLocation(program, 'uScanlines'),
    uVignette: gl.getUniformLocation(program, 'uVignette'),
    uGradient: gl.getUniformLocation(program, 'uGradient'),
    uSolarize: gl.getUniformLocation(program, 'uSolarize'),
    uChroma: gl.getUniformLocation(program, 'uChroma'),
    uPalDark: gl.getUniformLocation(program, 'uPalDark'),
    uPalMid: gl.getUniformLocation(program, 'uPalMid'),
    uPalLight: gl.getUniformLocation(program, 'uPalLight'),
  };

  return { gl, program, tex, liquifyTex, uniforms };
}

const glState = initGL();

function hasActiveEffects() {
  return fx.stress > 0 || fx.noise > 0 || fx.blur > 0 ||
         fx.erode > 0 || fx.warp > 0 || Math.abs(fx.threshold - 0.5) > 0.01 ||
         fx.gradient > 0 || fx.solarize > 0 || fx.chroma > 0 ||
         fx.halftone > 0 || fx.shimmer > 0 || fx.emboss > 0 || fx.glitch > 0 ||
         fx.pixelsort > 0 || fx.bloom > 0 || fx.scanlines > 0 || fx.vignette > 0 ||
         (liquifyCanvas !== null);
}

let animFrame = null;

// ── Data texture (ANTI-BLOCKY) ────────────────────────────────────────
// CRITICAL: Separate offscreen canvas with gaussian blur.
// DO NOT replace with main canvas — causes blockiness.

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

  dataCtx.imageSmoothingEnabled = true;
  dataCtx.imageSmoothingQuality = 'high';

  dataCtx.fillStyle = '#ffffff';
  dataCtx.fillRect(0, 0, w, h);

  dataCtx.save();
  dataCtx.scale(dpr, dpr);

  // ANTI-BLOCKY: Always 4px minimum base blur for smooth gradients.
  // Stress adds extra blur to spread the ink — this is the main visual
  // mechanism for stress, NOT the gamma curve (which stays gentle).
  const stressBlur = fx.stress * 50;
  const softBlur = fx.blur * 25;
  const totalBlur = 4 + stressBlur + softBlur;
  dataCtx.filter = `blur(${totalBlur}px)`;

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

  const { gl, tex, liquifyTex, uniforms } = glState;

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

  // Upload main text data texture (unit 0)
  gl.activeTexture(gl.TEXTURE0);
  const dataTex = createDataTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, dataTex);

  // Upload liquify displacement texture (unit 1)
  const hasLiquify = liquifyCanvas && liquifyCanvas.width > 0;
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, liquifyTex);
  if (hasLiquify) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, liquifyCanvas);
  }

  // Decay liquify each frame
  decayLiquify();

  gl.uniform1i(uniforms.uTex, 0);
  gl.uniform1i(uniforms.uLiquify, 1);
  gl.uniform1f(uniforms.uLiquifyActive, hasLiquify ? 1.0 : 0.0);
  gl.uniform2f(uniforms.uRes, w, h);
  gl.uniform1f(uniforms.uTime, performance.now() / 1000);
  gl.uniform1f(uniforms.uInvert, darkCanvas ? 1.0 : 0.0);
  gl.uniform1f(uniforms.uStress, fx.stress);
  gl.uniform1f(uniforms.uNoise, fx.noise);
  gl.uniform1f(uniforms.uNoiseSpeed, fx.noiseSpeed);
  gl.uniform1f(uniforms.uNoiseScale, fx.noiseScale);
  gl.uniform1f(uniforms.uNoiseOrganic, fx.noiseOrganic);
  gl.uniform1f(uniforms.uBlur, fx.blur);
  gl.uniform1f(uniforms.uErode, fx.erode);
  gl.uniform1f(uniforms.uWarp, fx.warp);
  gl.uniform1f(uniforms.uHalftone, fx.halftone);
  gl.uniform1f(uniforms.uShimmer, fx.shimmer);
  gl.uniform1f(uniforms.uPixelsort, fx.pixelsort);
  gl.uniform1f(uniforms.uThreshold, fx.threshold);
  gl.uniform1f(uniforms.uEmboss, fx.emboss);
  gl.uniform1f(uniforms.uGlitch, fx.glitch);
  gl.uniform1f(uniforms.uBloom, fx.bloom);
  gl.uniform1f(uniforms.uScanlines, fx.scanlines);
  gl.uniform1f(uniforms.uVignette, fx.vignette);
  gl.uniform1f(uniforms.uGradient, fx.gradient);
  gl.uniform1f(uniforms.uSolarize, fx.solarize);
  gl.uniform1f(uniforms.uChroma, fx.chroma);

  const pal = PALETTES[paletteIdx];
  gl.uniform3f(uniforms.uPalDark, pal.dark[0]/255, pal.dark[1]/255, pal.dark[2]/255);
  gl.uniform3f(uniforms.uPalMid, pal.mid[0]/255, pal.mid[1]/255, pal.mid[2]/255);
  gl.uniform3f(uniforms.uPalLight, pal.light[0]/255, pal.light[1]/255, pal.light[2]/255);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  if (fx.warp > 0 || fx.noise > 0 || fx.shimmer > 0 || fx.glitch > 0 || fx.bloom > 0) {
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
  { id: 'fx-pixelsort', valId: 'v-pixelsort', key: 'pixelsort' },
  { id: 'fx-bloom',     valId: 'v-bloom',     key: 'bloom' },
  { id: 'fx-scanlines', valId: 'v-scanlines', key: 'scanlines' },
  { id: 'fx-vignette',  valId: 'v-vignette',  key: 'vignette' },
];

const noiseSubSliders = [
  { id: 'fx-noise-speed',   valId: 'v-noise-speed',   key: 'noiseSpeed' },
  { id: 'fx-noise-scale',   valId: 'v-noise-scale',   key: 'noiseScale' },
  { id: 'fx-noise-organic', valId: 'v-noise-organic',  key: 'noiseOrganic' },
];

for (const s of sliderMap) {
  const slider = document.getElementById(s.id);
  const valEl = document.getElementById(s.valId);
  slider.addEventListener('input', () => {
    const raw = parseInt(slider.value, 10);
    valEl.textContent = raw;
    fx[s.key] = raw / 100;

    // Show/hide noise sub-controls
    if (s.key === 'noise') {
      document.getElementById('noise-sub-controls').style.display = raw > 0 ? 'block' : 'none';
    }

    render();
    renderGL();
  });
}

for (const s of noiseSubSliders) {
  const slider = document.getElementById(s.id);
  const valEl = document.getElementById(s.valId);
  slider.addEventListener('input', () => {
    const raw = parseInt(slider.value, 10);
    valEl.textContent = raw;
    fx[s.key] = raw / 100;
    render();
    renderGL();
  });
}

// Initially hide noise sub-controls
document.getElementById('noise-sub-controls').style.display = 'none';

// Reset all effects
document.getElementById('btn-reset-fx').addEventListener('click', () => {
  for (const s of sliderMap) {
    const slider = document.getElementById(s.id);
    const resetVal = s.key === 'threshold' ? 50 : 0;
    slider.value = resetVal;
    document.getElementById(s.valId).textContent = String(resetVal);
    fx[s.key] = resetVal / 100;
  }
  const noiseDefaults = { noiseSpeed: 30, noiseScale: 50, noiseOrganic: 40 };
  for (const s of noiseSubSliders) {
    const slider = document.getElementById(s.id);
    const val = noiseDefaults[s.key] || 50;
    slider.value = val;
    document.getElementById(s.valId).textContent = String(val);
    fx[s.key] = val / 100;
  }
  document.getElementById('noise-sub-controls').style.display = 'none';
  render();
  renderGL();
  updateStatus('Effects reset');
});

// ── Palette UI ────────────────────────────────────────────────────────
const palRow = document.getElementById('palette-row');
PALETTES.forEach((p, i) => {
  const sw = document.createElement('button');
  sw.className = 'palette-swatch' + (i === paletteIdx ? ' active' : '');
  // Simple solid swatch using the palette's mid color
  sw.style.background = `rgb(${p.mid})`;
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


// ═══════════════════════════════════════════════════════════════════════
// THREE.JS CHAOS ENGINE — FUCK IT MODE
// Samples text pixels, then detonates them into 15,000+ particles with
// multiple physics layers: shockwave, vortex, gravity wells, electric
// arcs, afterburn trails. Full Tetsuo energy.
// ═══════════════════════════════════════════════════════════════════════

let particleSystem = null;
let particlesActive = false;

function initParticles() {
  const threeCanvas = document.getElementById('three-overlay');
  const rect = wrap.getBoundingClientRect();

  const renderer = new THREE.WebGLRenderer({
    canvas: threeCanvas,
    alpha: true,
    antialias: false, // raw, not polished
  });
  renderer.setSize(rect.width, rect.height);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x000000, 0);

  const camera = new THREE.OrthographicCamera(
    -rect.width / 2, rect.width / 2,
    rect.height / 2, -rect.height / 2,
    0.1, 2000
  );
  camera.position.z = 500;

  const threeScene = new THREE.Scene();

  // Main particle material — multi-phase chaos shader
  const chaosMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 1.0 },
      uDark: { value: 0.0 },
      uShockwave: { value: 0.0 },
      uRes: { value: new THREE.Vector2(rect.width, rect.height) },
    },
    vertexShader: `
      attribute float aSize;
      attribute float aLife;
      attribute vec3 aVelocity;
      attribute float aDelay;
      attribute float aPhase;
      attribute float aSpin;
      uniform float uTime;
      uniform float uShockwave;
      uniform vec2 uRes;
      varying float vLife;
      varying float vAlpha;
      varying float vPhase;
      varying float vHeat;

      // Noise for turbulence
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      float noise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float n = i.x + i.y * 57.0 + i.z * 113.0;
        return mix(mix(mix(hash(n), hash(n + 1.0), f.x),
                       mix(hash(n + 57.0), hash(n + 58.0), f.x), f.y),
                   mix(mix(hash(n + 113.0), hash(n + 114.0), f.x),
                       mix(hash(n + 170.0), hash(n + 171.0), f.x), f.y), f.z);
      }

      void main() {
        float t = max(0.0, uTime - aDelay);
        float lifeNorm = clamp(t / aLife, 0.0, 1.0);

        // PHASE 1: Shockwave — everything blasts outward
        float shockT = clamp(t * 3.0, 0.0, 1.0);
        float shockForce = shockT * (1.0 - shockT) * 4.0; // peaks then dies

        // PHASE 2: Vortex — particles spiral into a cyclone
        float vortexT = clamp((t - 0.3) * 1.5, 0.0, 1.0);
        float vortexAngle = aSpin * t * 8.0 + aPhase * 6.28;

        // PHASE 3: Gravity collapse — everything pulls to random wells
        float collapseT = clamp((t - 1.5) * 0.8, 0.0, 1.0);

        // Base explosion
        vec3 pos = position;
        vec3 vel = aVelocity * (1.5 + shockForce * 2.0);
        pos += vel * t * (1.0 - lifeNorm * 0.3);

        // Vortex rotation
        float dist = length(pos.xy);
        float vortexRadius = dist * (1.0 - vortexT * 0.5);
        float angle = atan(pos.y, pos.x) + vortexAngle * vortexT;
        pos.x = mix(pos.x, cos(angle) * vortexRadius, vortexT * 0.6);
        pos.y = mix(pos.y, sin(angle) * vortexRadius, vortexT * 0.6);

        // Turbulence — 3D noise displacement
        float turbScale = 0.003;
        float turbAmt = 40.0 + 80.0 * lifeNorm;
        pos.x += (noise(vec3(pos.xy * turbScale, t * 0.7)) - 0.5) * turbAmt;
        pos.y += (noise(vec3(pos.xy * turbScale + 100.0, t * 0.5)) - 0.5) * turbAmt;
        pos.z += (noise(vec3(pos.xy * turbScale + 200.0, t * 0.9)) - 0.5) * turbAmt * 0.5;

        // Gravity wells — pull toward 3 random attractors
        vec2 well1 = vec2(sin(t * 0.7) * 200.0, cos(t * 1.1) * 150.0);
        vec2 well2 = vec2(cos(t * 0.9) * 250.0, sin(t * 0.6) * 200.0);
        vec2 well3 = vec2(sin(t * 1.3) * 180.0, cos(t * 0.4) * 280.0);
        float grav = collapseT * 50.0;
        vec2 toW1 = well1 - pos.xy; pos.xy += normalize(toW1) * grav / (1.0 + length(toW1) * 0.01);
        vec2 toW2 = well2 - pos.xy; pos.xy += normalize(toW2) * grav / (1.0 + length(toW2) * 0.01);
        vec2 toW3 = well3 - pos.xy; pos.xy += normalize(toW3) * grav * 0.5 / (1.0 + length(toW3) * 0.01);

        // Shake — screen-wide vibration in first 0.5s
        float shake = max(0.0, 1.0 - t * 2.0);
        pos.x += sin(t * 120.0) * shake * 8.0;
        pos.y += cos(t * 90.0) * shake * 6.0;

        // Z-depth for size variation
        pos.z += sin(aPhase * 20.0 + t * 2.0) * 100.0;

        vLife = lifeNorm;
        vPhase = aPhase;

        // Heat — particles glow brighter at high velocity moments
        vHeat = shockForce + vortexT * 0.3;

        // Alpha: fast attack, complex decay
        vAlpha = 1.0 - lifeNorm;
        vAlpha = pow(vAlpha, 0.5); // slower falloff
        vAlpha *= smoothstep(0.0, 0.05, t); // quick fade-in

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        float sizeMultiplier = 1.0 + shockForce * 3.0 + sin(t * 15.0 + aPhase * 6.28) * 0.3;
        gl_PointSize = aSize * sizeMultiplier * (500.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      uniform float uTime;
      uniform float uDark;
      varying float vLife;
      varying float vAlpha;
      varying float vPhase;
      varying float vHeat;

      void main() {
        vec2 uv = gl_PointCoord - vec2(0.5);
        float dist = length(uv);

        // Hard-core particle shape — sharp center, soft edge
        float core = 1.0 - smoothstep(0.0, 0.15, dist);
        float glow = exp(-dist * 6.0);
        float ring = smoothstep(0.35, 0.38, dist) * (1.0 - smoothstep(0.38, 0.5, dist));

        // Color based on phase and heat
        vec3 col;
        float phase = fract(vPhase * 3.0 + vLife * 0.5);

        if (uDark > 0.5) {
          // Dark mode: white → orange → red → void
          vec3 white = vec3(1.0, 1.0, 1.0);
          vec3 orange = vec3(1.0, 0.5, 0.1);
          vec3 red = vec3(1.0, 0.1, 0.0);
          vec3 blue = vec3(0.2, 0.4, 1.0);
          col = mix(white, orange, vLife);
          col = mix(col, red, vLife * vLife);
          col = mix(col, blue * 0.5, step(0.7, phase) * 0.4);
        } else {
          // Light mode: black → dark red → ember
          vec3 black = vec3(0.0);
          vec3 darkRed = vec3(0.4, 0.0, 0.0);
          vec3 ember = vec3(0.6, 0.2, 0.0);
          col = mix(black, darkRed, vLife * 0.5);
          col = mix(col, ember, vHeat * 0.6);
        }

        // Electric flash on high-heat particles
        col += vec3(1.0) * core * vHeat * 0.5;

        // Flicker
        float flicker = 0.8 + 0.2 * sin(uTime * 30.0 + vPhase * 100.0);

        float alpha = (core * 0.8 + glow * 0.6 + ring * 0.3) * vAlpha * uOpacity * flicker;

        if (alpha < 0.005) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  // Secondary — debris streaks (line segments)
  const streakMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 1.0 },
      uDark: { value: 0.0 },
    },
    vertexShader: `
      attribute float aSpeed;
      attribute float aDelay;
      attribute vec3 aDir;
      uniform float uTime;
      varying float vAlpha;
      varying float vSpeed;

      void main() {
        float t = max(0.0, uTime - aDelay);
        float life = clamp(t / 3.0, 0.0, 1.0);
        vec3 pos = position + aDir * aSpeed * t;
        pos.x += sin(t * 5.0 + position.y * 0.02) * 15.0 * life;
        pos.y += cos(t * 4.0 + position.x * 0.02) * 12.0 * life;

        vAlpha = (1.0 - life) * (1.0 - life);
        vSpeed = aSpeed;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = mix(1.0, 4.0, aSpeed / 200.0) * (400.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      uniform float uDark;
      varying float vAlpha;
      varying float vSpeed;

      void main() {
        float dist = length(gl_PointCoord - vec2(0.5));
        float a = (1.0 - smoothstep(0.0, 0.5, dist)) * vAlpha * uOpacity;
        vec3 col = uDark > 0.5 ? vec3(1.0, 0.8, 0.5) : vec3(0.2, 0.1, 0.0);
        col *= 1.0 + vSpeed * 0.003;
        if (a < 0.01) discard;
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  particleSystem = {
    renderer,
    camera,
    scene: threeScene,
    chaosMaterial,
    streakMaterial,
    particles: null,
    streaks: null,
    threeCanvas,
    startTime: 0,
    animFrame: null,
  };

  return particleSystem;
}

function sampleTextPixels(targetCount) {
  const rect = wrap.getBoundingClientRect();
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = rect.width;
  sampleCanvas.height = rect.height;
  const sCtx = sampleCanvas.getContext('2d');

  sCtx.fillStyle = '#ffffff';
  sCtx.fillRect(0, 0, rect.width, rect.height);

  for (const word of scene) {
    sCtx.save();
    const cx = word.x + word.width / 2;
    const cy = word.y + word.height / 2;
    sCtx.translate(cx, cy);
    if (word.rotation) sCtx.rotate(word.rotation * Math.PI / 180);
    sCtx.scale(word.scaleX || 1, word.scaleY || 1);
    sCtx.translate(-cx, -cy);
    sCtx.font = `${word.fontWeight} ${word.fontSize}px '${word.fontFamily}'`;
    sCtx.letterSpacing = `${word.letterSpacing || 0}px`;
    sCtx.fillStyle = '#000000';
    sCtx.textBaseline = 'alphabetic';
    sCtx.fillText(word.text, word.x, word.y + (word.ascent || 0));
    sCtx.letterSpacing = '0px';
    sCtx.restore();
  }

  const imageData = sCtx.getImageData(0, 0, rect.width, rect.height);
  const pixels = imageData.data;
  const positions = [];

  const step = Math.max(1, Math.floor(Math.sqrt(rect.width * rect.height / targetCount)));

  for (let y = 0; y < rect.height; y += step) {
    for (let x = 0; x < rect.width; x += step) {
      const idx = (y * rect.width + x) * 4;
      const brightness = (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3;
      if (brightness < 128) {
        positions.push({
          x: x - rect.width / 2,
          y: -(y - rect.height / 2),
          z: 0,
        });
      }
    }
  }

  return positions;
}

function spawnParticles() {
  if (!particleSystem) initParticles();
  const ps = particleSystem;

  // Nuke previous
  if (ps.particles) { ps.scene.remove(ps.particles); ps.particles.geometry.dispose(); }
  if (ps.streaks) { ps.scene.remove(ps.streaks); ps.streaks.geometry.dispose(); }

  // ── MAIN PARTICLES: 15000 sampled from text ──
  const textPositions = sampleTextPixels(15000);
  if (textPositions.length === 0) return;

  const count = textPositions.length;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const lives = new Float32Array(count);
  const velocities = new Float32Array(count * 3);
  const delays = new Float32Array(count);
  const phases = new Float32Array(count);
  const spins = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const p = textPositions[i];
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 50;

    sizes[i] = 1.0 + Math.random() * 5.0 + Math.pow(Math.random(), 3) * 10.0;
    lives[i] = 2.0 + Math.random() * 4.0;
    delays[i] = Math.random() * 0.3; // tight burst
    phases[i] = Math.random();
    spins[i] = (Math.random() - 0.5) * 2.0;

    // Explosion: radial outward + random chaos
    const angle = Math.atan2(p.y, p.x) + (Math.random() - 0.5) * 2.0;
    const speed = 40 + Math.random() * 150 + Math.pow(Math.random(), 2) * 200;
    velocities[i * 3] = Math.cos(angle) * speed + (Math.random() - 0.5) * 80;
    velocities[i * 3 + 1] = Math.sin(angle) * speed + (Math.random() - 0.5) * 80;
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 100;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geom.setAttribute('aLife', new THREE.BufferAttribute(lives, 1));
  geom.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));
  geom.setAttribute('aDelay', new THREE.BufferAttribute(delays, 1));
  geom.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geom.setAttribute('aSpin', new THREE.BufferAttribute(spins, 1));

  ps.chaosMaterial.uniforms.uDark.value = darkCanvas ? 1.0 : 0.0;
  ps.particles = new THREE.Points(geom, ps.chaosMaterial);
  ps.scene.add(ps.particles);

  // ── DEBRIS STREAKS: 3000 fast-moving sparks ──
  const streakCount = 3000;
  const sPos = new Float32Array(streakCount * 3);
  const sSpeeds = new Float32Array(streakCount);
  const sDelays = new Float32Array(streakCount);
  const sDirs = new Float32Array(streakCount * 3);

  for (let i = 0; i < streakCount; i++) {
    // Spawn from random text positions
    const src = textPositions[Math.floor(Math.random() * textPositions.length)];
    sPos[i * 3] = src.x + (Math.random() - 0.5) * 10;
    sPos[i * 3 + 1] = src.y + (Math.random() - 0.5) * 10;
    sPos[i * 3 + 2] = (Math.random() - 0.5) * 20;

    sSpeeds[i] = 80 + Math.random() * 200;
    sDelays[i] = Math.random() * 0.5;

    const a = Math.random() * Math.PI * 2;
    const elev = (Math.random() - 0.5) * 0.5;
    sDirs[i * 3] = Math.cos(a);
    sDirs[i * 3 + 1] = Math.sin(a);
    sDirs[i * 3 + 2] = elev;
  }

  const sGeom = new THREE.BufferGeometry();
  sGeom.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  sGeom.setAttribute('aSpeed', new THREE.BufferAttribute(sSpeeds, 1));
  sGeom.setAttribute('aDelay', new THREE.BufferAttribute(sDelays, 1));
  sGeom.setAttribute('aDir', new THREE.BufferAttribute(sDirs, 3));

  ps.streakMaterial.uniforms.uDark.value = darkCanvas ? 1.0 : 0.0;
  ps.streaks = new THREE.Points(sGeom, ps.streakMaterial);
  ps.scene.add(ps.streaks);

  ps.startTime = performance.now() / 1000;
  ps.threeCanvas.style.visibility = 'visible';
  ps.threeCanvas.style.pointerEvents = 'none';

  // Slam all effects to max for chaos
  const chaosEffects = { stress: 60, noise: 80, warp: 50, shimmer: 40, glitch: 70, bloom: 40 };
  for (const [key, val] of Object.entries(chaosEffects)) {
    const slider = document.getElementById(`fx-${key}`);
    const valEl = document.getElementById(`v-${key}`);
    if (slider && valEl) {
      slider.value = val;
      valEl.textContent = val;
      fx[key] = val / 100;
    }
  }
  if (fx.noise > 0) document.getElementById('noise-sub-controls').style.display = 'block';
  render();
  renderGL();

  function animate() {
    const elapsed = performance.now() / 1000 - ps.startTime;
    ps.chaosMaterial.uniforms.uTime.value = elapsed;
    ps.streakMaterial.uniforms.uTime.value = elapsed;

    // Global fade in last 2 seconds
    const globalFade = elapsed > 4.0 ? Math.max(0, 1.0 - (elapsed - 4.0) / 2.0) : 1.0;
    ps.chaosMaterial.uniforms.uOpacity.value = globalFade;
    ps.streakMaterial.uniforms.uOpacity.value = globalFade;

    // Camera shake
    const shakeAmt = Math.max(0, 1.0 - elapsed * 0.5) * 5.0;
    ps.camera.position.x = Math.sin(elapsed * 47) * shakeAmt;
    ps.camera.position.y = Math.cos(elapsed * 53) * shakeAmt;

    ps.renderer.render(ps.scene, ps.camera);

    if (elapsed < 6.0) {
      ps.animFrame = requestAnimationFrame(animate);
    } else {
      // Clean up
      ps.threeCanvas.style.visibility = 'hidden';
      ps.scene.remove(ps.particles);
      ps.particles.geometry.dispose();
      ps.particles = null;
      ps.scene.remove(ps.streaks);
      ps.streaks.geometry.dispose();
      ps.streaks = null;
      ps.camera.position.set(0, 0, 500);
      particlesActive = false;
    }
  }

  particlesActive = true;
  if (ps.animFrame) cancelAnimationFrame(ps.animFrame);
  animate();
}

function resizeParticles() {
  if (!particleSystem) return;
  const rect = wrap.getBoundingClientRect();
  particleSystem.renderer.setSize(rect.width, rect.height);
  particleSystem.camera.left = -rect.width / 2;
  particleSystem.camera.right = rect.width / 2;
  particleSystem.camera.top = rect.height / 2;
  particleSystem.camera.bottom = -rect.height / 2;
  particleSystem.camera.updateProjectionMatrix();
  particleSystem.chaosMaterial.uniforms.uRes.value.set(rect.width, rect.height);
}

// Particle button
const btnParticles = document.getElementById('btn-particles');
btnParticles.addEventListener('click', () => {
  if (scene.length === 0) {
    updateStatus('Add text first');
    return;
  }
  if (particlesActive) return;
  spawnParticles();
  updateStatus('⬡ CHAOS');
});


// ── Init ──────────────────────────────────────────────────────────────

resizeCanvas();

// ── Splash screen ───────────────────────────────────────────────────────
// Shows on load, fades out after app is ready or on any click.
const splash = document.getElementById('splash');
let splashDismissed = false;
function dismissSplash() {
  if (splashDismissed || !splash) return;
  splashDismissed = true;
  splash.classList.add('out');
  splash.addEventListener('transitionend', () => splash.remove(), { once: true });
}
window.addEventListener('pointerdown', dismissSplash, { once: true });
window.addEventListener('keydown', dismissSplash, { once: true });

document.fonts.ready.then(() => {
  fontPicker.value = 'Archivo Black';
  updateWeightPicker();

  const rect = wrap.getBoundingClientRect();
  const hero = createWord('TETSUO', 'Archivo Black', 400, 300, 0, 0);
  measureWord(hero);
  hero.x = (rect.width - hero.width) / 2;
  hero.y = (rect.height - hero.height) / 2;
  scene.push(hero);
  selected = hero;
  render();
  updateStatus('Click canvas to type · dbl-click edit · R rotate · L liquify · ⬡ chaos');

  // Load state from URL if present
  loadStateFromURL();

  // Auto-dismiss splash after a short pause
  setTimeout(dismissSplash, 2500);
});

document.fonts.addEventListener('loadingdone', () => {
  for (const word of scene) measureWord(word);
  render();
  if (hasActiveEffects() && glState) renderGL();
});
