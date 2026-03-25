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

function createWord(text, fontFamily, fontWeight, fontSize, x, y) {
  return {
    id: nextId++,
    text,
    fontFamily,
    fontWeight,
    fontSize,
    x,
    y,
    width: 0,   // measured after first render
    height: 0,
    color: '#000000',
  };
}

// ── Canvas setup ──────────────────────────────────────────────────────

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('canvas-wrap');

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = wrap.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
}

window.addEventListener('resize', resizeCanvas);

// ── Measure a word's bounding box ─────────────────────────────────────
// Uses canvas text metrics to get width/height for hit testing and selection.

function measureWord(word) {
  ctx.font = `${word.fontWeight} ${word.fontSize}px '${word.fontFamily}'`;
  const metrics = ctx.measureText(word.text);
  word.width = metrics.width;
  // Use actual glyph metrics for precise height — gives the real top and bottom of the letterforms
  word.ascent = metrics.actualBoundingBoxAscent;
  word.descent = metrics.actualBoundingBoxDescent;
  word.height = word.ascent + word.descent;
}

// ── Render loop ───────────────────────────────────────────────────────
// Draws all words in the scene, plus selection UI for the selected word.

function render() {
  const rect = wrap.getBoundingClientRect();
  // Fill with white background (clearRect leaves transparent, which reads as black in WebGL)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, rect.width, rect.height);

  // Draw each word
  for (const word of scene) {
    ctx.font = `${word.fontWeight} ${word.fontSize}px '${word.fontFamily}'`;
    ctx.fillStyle = word.color;
    ctx.textBaseline = 'alphabetic';
    // word.x, word.y is the top-left of the bounding box.
    // Draw text at (x, y + ascent) so the baseline sits correctly.
    ctx.fillText(word.text, word.x, word.y + (word.ascent || 0));

    // Re-measure (in case font just loaded)
    measureWord(word);
  }

  // Draw selection box around selected word
  if (selected) {
    const s = selected;
    const pad = 6;

    // Dashed outline
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(s.x - pad, s.y - pad, s.width + pad * 2, s.height + pad * 2);
    ctx.setLineDash([]);

    // Resize handles — small squares at corners
    const handleSize = 5;
    const corners = getCorners(s, pad);
    ctx.fillStyle = '#111';
    for (const c of corners) {
      ctx.fillRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
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
  }

  render();
});

canvas.addEventListener('pointermove', (e) => {
  if (!dragState) return;
  const rect = wrap.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (dragState.mode === 'move' && selected) {
    selected.x = x - dragState.offsetX;
    selected.y = y - dragState.offsetY;
    render();
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
    measureWord(selected);
    render();
  }
});

canvas.addEventListener('pointerup', () => {
  dragState = null;
});

// ── Keyboard shortcuts ────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  // Delete selected word with Delete or Backspace (only if text input not focused)
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected && document.activeElement !== textInput) {
    const idx = scene.indexOf(selected);
    if (idx !== -1) scene.splice(idx, 1);
    selected = null;
    render();
    e.preventDefault();
  }

  // Ctrl+Z — undo last added word (simple undo)
  if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
    if (scene.length > 0) {
      const removed = scene.pop();
      if (selected === removed) selected = null;
      render();
      updateStatus(`Removed "${removed.text}"`);
    }
    e.preventDefault();
  }

  // Enter — add word to canvas (same as clicking the button)
  if (e.key === 'Enter' && document.activeElement === textInput) {
    addWordToCanvas();
  }
});

// ── UI wiring ─────────────────────────────────────────────────────────

const textInput = document.getElementById('text-input');
const fontPicker = document.getElementById('font-picker');
const weightPicker = document.getElementById('weight-picker');
const sizePicker = document.getElementById('size-picker');
const btnAdd = document.getElementById('btn-add');
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

fontPicker.addEventListener('change', updateWeightPicker);
updateWeightPicker();

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
  measureWord(word);
  scene.push(word);
  selected = word;
  render();

  updateStatus(`Added "${text}" — ${fontFamily} ${weightLabel(fontWeight)}`);
}

btnAdd.addEventListener('click', addWordToCanvas);

// Clear canvas
btnClear.addEventListener('click', () => {
  scene.length = 0;
  selected = null;
  render();
  updateStatus('Canvas cleared');
});

// Export PNG
btnExport.addEventListener('click', () => {
  // Temporarily deselect to hide selection UI
  const prevSelected = selected;
  selected = null;
  render();

  // If effects are active, export from the GL canvas; otherwise from the 2D canvas
  const exportCanvas = hasActiveEffects() && glState ? glCanvas : canvas;
  if (hasActiveEffects()) renderGL();  // ensure GL canvas is up to date

  exportCanvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tetsuo-export.png';
    a.click();
    URL.revokeObjectURL(url);
    updateStatus('PNG exported');
  }, 'image/png');

  selected = prevSelected;
  render();
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

// ── WebGL effects pipeline ────────────────────────────────────────────
// Six stackable effects in a single shader pass:
//   1. Grain — film grain noise, concentrated in midtones
//   2. Chromatic Aberration — RGB channel separation
//   3. Edge Erosion — dissolves letterform boundaries with noise
//   4. Ink Bleed — gaussian-style bloom simulating oversaturated ink
//   5. Organic Warp — slow viscous displacement via FBM noise
//   6. Duotone — maps luminance to a two-color gradient

const glCanvas = document.getElementById('gl');

// Effect uniforms
const fx = {
  stress: 0,     // 0-1 — spread/expand dark areas (data canvas blur)
  noise: 0,      // 0-1 — edge-modulated grain
  blur: 0,       // 0-1 — smooth gaussian blur (data canvas blur)
  erode: 0,      // 0-1 — shrink letterforms inward
  warp: 0,       // 0-1 — FBM spatial distortion
  threshold: 0.5,// 0-1 — ink/paper cutoff (0.5 = neutral)
};

function initGL() {
  const gl = glCanvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: true });
  if (!gl) {
    console.warn('WebGL not available — effects pipeline disabled');
    return null;
  }

  // Vertex shader: fullscreen quad
  const vsSource = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() {
      vUv = aPos * 0.5 + 0.5;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }`;

  // Fragment shader — clean rewrite based on Mantle Creep pipeline analysis.
  //
  // KEY INSIGHT: In Mantle Creep, effects operate on DATA (raw float values)
  // BEFORE color mapping. We do the same here:
  //   1. Sample texture → extract luminance as "data" (0=black text, 1=white bg)
  //   2. STRESS: Gaussian blur the luminance field (like Tidal Bleed on sim rows)
  //   3. NOISE: Perturb luminance with grain BEFORE thresholding (like Shore Roughness)
  //   4. BLUR: Additional soft blur on final luminance
  //   5. Re-threshold with gamma curve → output as grayscale
  //
  // All effects work on ONE value (luminance) flowing through the pipeline.
  // No separate competing systems. No RGB manipulation. No artifacts.
  const fsSource = `
    precision highp float;
    uniform sampler2D uTex;
    uniform vec2 uRes;
    uniform float uStress;
    uniform float uNoise;
    uniform float uBlur;
    uniform float uErode;     // shrink letterforms inward
    uniform float uWarp;      // FBM spatial distortion
    uniform float uThreshold; // controls ink/paper cutoff point
    varying vec2 vUv;

    // ── Noise functions ───────────────────────────────────────────
    float hash(vec2 p) {
      p = fract(p * vec2(127.1, 311.7));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
                 mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      v += vnoise(p) * a; p = p * 2.13 + vec2(1.7, 9.2); a *= 0.5;
      v += vnoise(p) * a; p = p * 2.07 + vec2(8.3, 2.8); a *= 0.5;
      v += vnoise(p) * a; p = p * 2.11 + vec2(3.1, 6.7); a *= 0.5;
      v += vnoise(p) * a;
      return v;
    }
    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

    void main() {
      vec2 px = 1.0 / uRes;
      vec2 uv = vec2(vUv.x, 1.0 - vUv.y);

      // ══════════════════════════════════════════════════════════════
      // STEP 1: Extract luminance as "data"
      // Black text = 0.0, white background = 1.0
      // We INVERT so dark text = HIGH values (like Mantle Creep's activator)
      // This means blur will SPREAD the high values = dark areas grow
      // ══════════════════════════════════════════════════════════════

      // Substrate displacement: FBM noise shifts WHERE we read from.
      // This makes the edge contour itself wobbly and organic —
      // like Mantle Creep's RO (Substrate Irregularity).
      // Without this, noise only changes values ON the edge but the
      // edge stays geometrically perfect — you can see the straight
      // lines of the original letterforms through any amount of noise.
      // ── WARP: FBM-driven spatial distortion ─────────────────────
      // Displaces WHERE we read from the texture. Letters deform
      // organically like they're printed on a liquid surface.
      vec2 dataUv = uv;
      if (uWarp > 0.001) {
        float warpAmt = uWarp * 0.04;
        float wx = (fbm(uv * 8.0 + vec2(7.3, 13.1)) - 0.5) * warpAmt;
        float wy = (fbm(uv * 8.0 + vec2(41.7, 3.9)) - 0.5) * warpAmt;
        dataUv = uv + vec2(wx, wy);
      }

      // ── NOISE substrate displacement ────────────────────────────
      // Separate from Warp — this is finer, more granular.
      // Makes edges wobbly at a micro scale.
      if (uNoise > 0.001) {
        float displaceAmt = uNoise * 0.008;
        float dx = (fbm(dataUv * 35.0 + vec2(7.3, 13.1)) - 0.5) * displaceAmt;
        float dy = (fbm(dataUv * 35.0 + vec2(41.7, 3.9)) - 0.5) * displaceAmt;
        dataUv = dataUv + vec2(dx, dy);
      }

      float data = 1.0 - luma(texture2D(uTex, dataUv).rgb);

      // ── ERODE: eat away from the OUTSIDE in ────────────────────
      // Samples the data gradient to find edges, then erodes from there.
      // The erosion is noise-modulated so it's uneven — acid on metal.
      // Works on the blurred data, so it erodes the soft gradients,
      // pushing the edge contour inward.
      if (uErode > 0.001) {
        // Sample neighborhood to find how "exposed" this pixel is
        // (how close to the edge). Pixels deep inside text are safe;
        // pixels near the boundary get eaten first.
        float L = 1.0 - luma(texture2D(uTex, dataUv + vec2(-px.x * 2.0, 0.0)).rgb);
        float R = 1.0 - luma(texture2D(uTex, dataUv + vec2( px.x * 2.0, 0.0)).rgb);
        float U = 1.0 - luma(texture2D(uTex, dataUv + vec2(0.0, -px.y * 2.0)).rgb);
        float D = 1.0 - luma(texture2D(uTex, dataUv + vec2(0.0,  px.y * 2.0)).rgb);
        // Minimum of neighbors — if ANY neighbor is background, we're exposed
        float minNeighbor = min(min(L, R), min(U, D));
        // Exposure: 0 = deep inside, 1 = right at the edge
        float exposure = 1.0 - smoothstep(0.0, 0.5, minNeighbor);
        // FBM noise makes erosion uneven — organic, not uniform
        float erosionNoise = fbm(dataUv * 40.0 + vec2(19.3, 7.1));
        float erosionAmt = uErode * (exposure * 0.7 + erosionNoise * 0.5);
        data = max(0.0, data - erosionAmt);
      }

      // ── NOISE: perturb data before thresholding ─────────────────
      if (uNoise > 0.001) {
        float edgePeak = 4.0 * data * (1.0 - data);
        float textPresence = smoothstep(0.02, 0.15, data);
        float edgeMask = edgePeak * 0.75 + textPresence * 0.25 * data;
        float n1 = hash(dataUv * uRes) - 0.5;
        float n2 = hash(dataUv * uRes * 0.4137 + vec2(73.1, 41.9)) - 0.5;
        float n3 = hash(dataUv * uRes * 1.731 + vec2(17.3, 89.1)) - 0.5;
        float n4 = (fbm(dataUv * 55.0 + vec2(3.7, 11.3)) - 0.5);
        float n5 = (fbm(dataUv * 22.0 + vec2(91.2, 7.8)) - 0.5) * 0.7;
        float grain = n1 * 0.35 + n2 * 0.25 + n3 * 0.15 + n4 * 0.15 + n5 * 0.1;
        data += grain * uNoise * 15.0 * edgeMask;
      }

      // ── THRESHOLD + GAMMA → output ──────────────────────────────
      data = clamp(data, 0.0, 1.0);

      // Threshold as a levels crush (like Photoshop Levels).
      // At 50 (neutral): no change.
      // Below 50: pull black point up — light areas vanish, contrast increases.
      //           Text thins out, fine details disappear.
      // Above 50: pull white point down — dark areas expand, contrast increases.
      //           Text thickens, everything commits to ink.
      // This remaps the data range, not just shifts it.
      float tNorm = uThreshold;  // 0-1, 0.5 = neutral
      if (tNorm < 0.49) {
        // Pull black point up: remap [blackPt, 1] → [0, 1]
        float blackPt = (0.5 - tNorm) * 1.0;  // 0 at neutral, 0.5 at min
        data = smoothstep(blackPt, 1.0, data);
      } else if (tNorm > 0.51) {
        // Pull white point down: remap [0, whitePt] → [0, 1]
        float whitePt = 1.0 - (tNorm - 0.5) * 1.5;  // 1 at neutral, 0.25 at max
        data = smoothstep(0.0, max(0.05, whitePt), data);
      }

      // Softer gamma — less aggressive edge snapping
      float gamma = mix(0.8, 0.55, uStress);
      float t = pow(data, gamma);
      float brightness = 1.0 - t;

      gl_FragColor = vec4(vec3(brightness), 1.0);
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
    uStress: gl.getUniformLocation(program, 'uStress'),
    uNoise: gl.getUniformLocation(program, 'uNoise'),
    uBlur: gl.getUniformLocation(program, 'uBlur'),
    uErode: gl.getUniformLocation(program, 'uErode'),
    uWarp: gl.getUniformLocation(program, 'uWarp'),
    uThreshold: gl.getUniformLocation(program, 'uThreshold'),
  };

  return { gl, program, tex, uniforms };
}

const glState = initGL();

// Check if any effect is active
function hasActiveEffects() {
  return fx.stress > 0 || fx.noise > 0 || fx.blur > 0 ||
         fx.erode > 0 || fx.warp > 0 || Math.abs(fx.threshold - 0.5) > 0.01;
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
  const stressBlur = fx.stress * 30;  // up to 30px blur for Stress
  const softBlur = fx.blur * 20;      // up to 20px blur for Blur
  const totalBlur = 3 + stressBlur + softBlur;  // 3px base for smooth data
  dataCtx.filter = `blur(${totalBlur}px)`;

  // Draw text — same as the main render but without selection UI
  for (const word of scene) {
    dataCtx.font = `${word.fontWeight} ${word.fontSize}px '${word.fontFamily}'`;
    dataCtx.fillStyle = word.color;
    dataCtx.textBaseline = 'alphabetic';
    dataCtx.fillText(word.text, word.x, word.y + (word.ascent || 0));
  }

  dataCtx.restore();

  return dataCanvas;
}

function renderGL() {
  if (!glState || !hasActiveEffects()) {
    glCanvas.style.visibility = 'hidden';
    canvas.style.visibility = 'visible';
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    return;
  }

  glCanvas.style.visibility = 'visible';
  canvas.style.visibility = 'hidden';

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
  gl.uniform1f(uniforms.uStress, fx.stress);
  gl.uniform1f(uniforms.uNoise, fx.noise);
  gl.uniform1f(uniforms.uBlur, fx.blur);
  gl.uniform1f(uniforms.uErode, fx.erode);
  gl.uniform1f(uniforms.uWarp, fx.warp);
  gl.uniform1f(uniforms.uThreshold, fx.threshold);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  animFrame = null;
}

// ── Effects panel wiring ──────────────────────────────────────────────

const sliderMap = [
  { id: 'fx-stress',    valId: 'v-stress',    key: 'stress' },
  { id: 'fx-noise',     valId: 'v-noise',     key: 'noise' },
  { id: 'fx-blur',      valId: 'v-blur',      key: 'blur' },
  { id: 'fx-erode',     valId: 'v-erode',     key: 'erode' },
  { id: 'fx-warp',      valId: 'v-warp',      key: 'warp' },
  { id: 'fx-threshold', valId: 'v-threshold', key: 'threshold' },
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
    slider.value = 0;
    document.getElementById(s.valId).textContent = '0';
    fx[s.key] = 0;
  }
  render();
  renderGL();
  updateStatus('Effects reset');
});

// ── Init ──────────────────────────────────────────────────────────────

resizeCanvas();

// Place "TETSUO" in Archivo Black at 300px, dead center on load
{
  const rect = wrap.getBoundingClientRect();
  const hero = createWord('TETSUO', 'Archivo Black', 400, 300, 0, 0);
  measureWord(hero);
  hero.x = (rect.width - hero.width) / 2;
  hero.y = (rect.height - hero.height) / 2;
  scene.push(hero);
  render();
}

updateStatus('Ready — type a word and press Add to canvas');
