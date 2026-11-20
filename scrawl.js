// The "Scrawlface" wordmark is set in a different typeface on every page
// load, the same way the scrawl itself is different every time. It also
// changes when you come back after a break (an app is rarely reloaded) and
// when the wordmark is tapped (see nextWordmark). The typefaces take turns
// in the order below, starting at the first on a first visit and going
// back to it after the last; the one shown last is remembered.
// Each entry: [family, file in fonts/ (.woff2), CSS weight, CSS style, size scale].
// The files are bundled (not fetched from Google Fonts) so the app works
// offline: each holds only the letters of "Scrawlface" (see fonts/README.md).
const wordmarkFonts = [
  ['Pacifico', 'pacifico', 400, 'normal', 1],                           // script
  ['Monoton', 'monoton', 400, 'normal', 0.95],                          // decorative
  ['Caveat', 'caveat', 700, 'normal', 1.35],                            // handwritten
  ['UnifrakturMaguntia', 'unifrakturmaguntia', 400, 'normal', 1.15],    // blackletter
  ['Lobster', 'lobster', 400, 'normal', 1.1],                           // flamboyant
  ['Bungee Shade', 'bungee-shade', 400, 'normal', 0.9],                 // display
  ['Permanent Marker', 'permanent-marker', 400, 'normal', 1],           // marker
  ['Press Start 2P', 'press-start-2p', 400, 'normal', 0.6]              // pixel
];

let wordmarkIndex = -1;      // the typeface on show (index in wordmarkFonts)

// The next typeface in turn after the one on show (or, on a page load, the
// one shown last); the first, on a first visit
function pickWordmark() {
  let last = wordmarkIndex;
  if (last === -1) {
    try { last = parseInt(localStorage.getItem('wordmarkFont')); } catch (e) {}
  }
  if (!(last >= 0 && last < wordmarkFonts.length)) return 0;
  return (last + 1) % wordmarkFonts.length;
}

function applyWordmark(i) {
  const [family, , weight, style, scale] = wordmarkFonts[i];
  wordmarkIndex = i;
  try { localStorage.setItem('wordmarkFont', i); } catch (e) {}
  const root = document.documentElement.style;
  root.setProperty('--wordmark-font', `'${family}', sans-serif`);
  root.setProperty('--wordmark-weight', weight);
  root.setProperty('--wordmark-style', style);
  root.setProperty('--wordmark-scale', scale);
}

// Runs while the <head> is still being parsed, so the font is on its way
// before the header is painted. The wordmark stays invisible for a moment
// while it loads (font-display: block) rather than flashing another font;
// if it can't load, the header falls back to the system font.
function loadWordmarkFont() {
  const i = pickWordmark();
  const [family, file, weight, style] = wordmarkFonts[i];
  const face = document.createElement('style');
  face.textContent = `@font-face {
    font-family: '${family}';
    src: url('fonts/${file}.woff2') format('woff2');
    font-weight: ${weight};
    font-style: ${style};
    font-display: block;
  }`;
  document.head.appendChild(face);
  applyWordmark(i);
}
loadWordmarkFont();

// A new typeface for the wordmark, once it has loaded (so the wordmark
// never blinks). trigger: tap, return, or other (a shell), for the
// wordmark_changed event. Resolves to the new family, or null.
let wordmarkLoading = false;

async function nextWordmark(trigger = 'other') {
  if (wordmarkLoading) return null;
  wordmarkLoading = true;
  const i = pickWordmark();
  const [family, file, weight, style] = wordmarkFonts[i];
  try {
    const face = new FontFace(family, `url('fonts/${file}.woff2') format('woff2')`, { weight: String(weight), style });
    await face.load();
    document.fonts.add(face);
  } catch (e) {
    wordmarkLoading = false;
    return null;
  }
  applyWordmark(i);
  wordmarkLoading = false;
  track('wordmark_changed', { trigger, font: family });
  stateChanged();
  return family;
}

// Back after a break (the page hidden for 30 minutes or more): a new one,
// like a fresh visit
const wordmarkBreakMs = 30 * 60 * 1000;
let wordmarkHiddenAt = null;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    wordmarkHiddenAt = Date.now();
  } else if (wordmarkHiddenAt !== null && Date.now() - wordmarkHiddenAt >= wordmarkBreakMs) {
    wordmarkHiddenAt = null;
    nextWordmark('return');
  }
});

// The header is one line: the wordmark, My Scrawls and ?. Some wordmark
// typefaces are wide; when the line doesn't fit, the wordmark gets a little
// smaller (down to 60%), so My Scrawls keeps its label. Only if that isn't
// enough (the narrowest phones) does My Scrawls drop its label instead and
// become an icon key like ?, with the wordmark at its full size.
function fitHeader() {
  const header = document.querySelector('header');
  if (!header) return;
  const wordmark = header.querySelector('h1');
  const overflows = () => header.scrollWidth > header.clientWidth;
  header.classList.remove('header-compact');
  wordmark.style.fontSize = '';
  const full = parseFloat(getComputedStyle(wordmark).fontSize);
  for (let size = full - 1; overflows() && size >= full * 0.6; size--) {
    wordmark.style.fontSize = `${size}px`;
  }
  if (overflows()) {
    wordmark.style.fontSize = '';
    header.classList.add('header-compact');
  }
}
// The wordmark's typeface can arrive after the page is ready, so check
// again whenever the wordmark changes size (and on resize)
document.addEventListener('DOMContentLoaded', () => {
  fitHeader();
  const wordmark = document.querySelector('header h1');
  if (wordmark && window.ResizeObserver) new ResizeObserver(fitHeader).observe(wordmark);
  // A hidden toy: tap the wordmark for another typeface
  if (wordmark) wordmark.addEventListener('click', () => nextWordmark('tap'));
});
window.addEventListener('resize', fitHeader);

// Canvas-only mode, for a native shell that draws its own controls: open
// the page with ?embedded (or the shell adds the class itself). Set while
// the <head> is parsed, so the web controls never show.
if (new URLSearchParams(location.search).has('embedded')) {
  document.documentElement.classList.add('embedded');
}

let canvas;
const bgColor = [255, 255, 255];
let strokeColor = [0, 0, 0];
let rotation = 0;      // degrees; quarter turns from the Rotate button, any angle from a pinch
let viewZoom = 1;      // 1 = whole canvas visible; pinch zooms in up to maxZoom
let viewPan = { x: 0, y: 0 }; // units the zoomed view is shifted by
const maxZoom = 8;
let pinch = null;      // two-finger gesture in progress: the view and fingers when it started
let pressChangedDrawing = false; // the current press started a stroke or filled
let showScrawl = true;
// Hide paint: a way to look at the scribble and eyes without the paint.
// Only the view: Save and Share keep the paint, and picking a paint tool,
// Undo, Redo or Clear shows it again (see showPaintAgain).
let showPaint = true;
let moveEyesMode = false;
let drawMode = false;
let eraseMode = false;
let bucketMode = false;
let baseScrawlGraphics;
let drawingGraphics;
let eyePositions = [];
let draggedEyeIndex = -1;
let dragOffset = { x: 0, y: 0 }; // eye centre minus grab point, so the eye doesn't jump to the finger
let dragStart = null; // where the dragged eye was when grabbed, to tell a drag from a tap
let hasDrawings = false;
let isDrawing = false;
const eyeRadius = 35;
const canvasSize = 800;
// The picture is a fixed 4:5 portrait frame (Instagram's portrait post)
// around the scrawl square, upright in the view: what Share and Download
// give is always exactly this frame, at zoom 1, in the current rotation.
const frameWidth = canvasSize;
const frameHeight = canvasSize * 5 / 4;
// Sizes and positions are in units (the frame is 800 x 1000 units), but
// the picture and its layers have `res` pixels per unit: 1080 x 1350, the
// size of an Instagram portrait post, and sharp on phone screens.
const res = 1080 / canvasSize;
// The paint layer covers the frame at any rotation (its side is at least
// the frame's diagonal). The scrawl is a canvasSize square in its middle.
// Positions on the drawing (getTransformedCoords) are relative to the
// scrawl square, so the layer starts at -layerOffset. layerOffset is a
// multiple of 20, so it's a whole number of pixels too (res = 27/20).
const layerOffset = 20 * Math.ceil((Math.hypot(frameWidth, frameHeight) - canvasSize) / 40);
const layerSize = canvasSize + 2 * layerOffset;
// The layer's width in pixels. Rounded: 1320 * 1.35 isn't exact in floating
// point, and the fill's pixel arithmetic needs a whole number.
const layerPixels = Math.round(layerSize * res);
const eyeMargin = 200;
const eyeSize = 70;
const scrawlStrokeWeight = 1;

let intensity = 15; // loops in the next scrawl (the faders go 1-30)
let eyeStyles = ['classic', 'classic']; // style of each eye (see drawEye)
let brushSize = 16; // the 4th of the 6 size keys
let brushColor = '#000000';
let eraserSize = 16; // the 4th size key too
let brushSizesShown = false; // mobile strip: brush sizes instead of colours

// Scrawl segments still to be drawn by the draw-in animation
let scrawlQueue = [];
// The draw-in takes a short fixed start plus a little per segment, so a
// simple scrawl appears quickly and a dense one takes longer
// (at 60fps: intensity 1 ~0.3s, 15 ~0.75s, 30 ~1.25s)
const scrawlDrawInBaseFrames = 15;
const scrawlDrawInFramesPerSegment = 2;
let scrawlDrawInRate = 0;      // segments per frame (can be a fraction)
let scrawlDrawInProgress = 0;  // fraction of a segment carried to the next frame

// Memento pattern for undo/redo. Each memento is the part of the paint
// layer a change touched, as it was before (see saveState).
let historyStack = [];
let redoStack = [];
// A whole-layer copy (a background fill) is ~3.2M pixels, ~13MB, so the
// history is limited by area as well as by count: at most 16M pixels
// (~64MB, about five whole-layer steps), and never fewer than the last step.
// Undo and redo swap mementos of the same size, so the total stays put.
const maxHistorySize = 25;
const maxHistoryPixels = 16e6;

// Brush stroke tracking for easing
let strokePoints = 0;
let maxStrokePoints = 20; // Points to reach full size
let currentBrushSize = 0;
let strokeLength = 0; // Units travelled on screen in the current stroke
let strokeBounds = null; // layer area the current stroke has painted (see dab)
const tapSlop = 10;   // Strokes shorter than this count as a tap

function setup() {
  // A fixed resolution (see res) rather than the screen's, so the picture,
  // the layers and the saved image all match; mouse and touch positions
  // stay in units (p5 scales them)
  pixelDensity(res);

  // Exactly the picture frame; CSS scales it to fit (fitCanvasToContainer)
  canvas = createCanvas(frameWidth, frameHeight);
  canvas.parent("scrawl-container");

  // Prevent default touch behavior on canvas to avoid scrolling/zooming while drawing
  const canvasElement = canvas.elt;
  // Two fingers on the canvas zoom, rotate and pan the view (see startPinch).
  // These listeners run before p5's window-level ones, so mousePressed
  // already sees the pinch.
  canvasElement.addEventListener('touchstart', (e) => {
    if (e.targetTouches.length === 1) {
      startLinesPeekTimer(e.targetTouches[0]);
    } else {
      cancelLinesPeekTimer();
    }
    if (e.targetTouches.length === 2) {
      startPinch(e.targetTouches);
    }
    if (pinch || drawMode || eraseMode || bucketMode || moveEyesMode) {
      e.preventDefault();
    }
  }, { passive: false });

  canvasElement.addEventListener('touchmove', (e) => {
    moveLinesPeekTimer(e.targetTouches[0]);
    if (pinch && e.targetTouches.length === 2) {
      movePinch(e.targetTouches);
    }
    if (pinch || drawMode || eraseMode || moveEyesMode) {
      e.preventDefault();
    }
  }, { passive: false });

  const onTouchEnd = (e) => {
    if (pinch || drawMode || eraseMode || bucketMode || moveEyesMode) {
      e.preventDefault();
    }
    if (e.targetTouches.length === 0) endLinesPeek();
    if (pinch && e.targetTouches.length < 2) {
      endPinch();
    }
  };
  canvasElement.addEventListener('touchend', onTouchEnd, { passive: false });
  canvasElement.addEventListener('touchcancel', onTouchEnd, { passive: false });

  // Trackpad and mouse: pinch and two-finger moves, and press and hold to
  // peek under the lines (see the Trackpad and Touch and hold sections)
  canvasElement.addEventListener('wheel', onCanvasWheel, { passive: false });
  canvasElement.addEventListener('gesturestart', onGestureStart);
  canvasElement.addEventListener('gesturechange', onGestureChange);
  canvasElement.addEventListener('gestureend', onGestureEnd);
  canvasElement.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' && e.button === 0) startLinesPeekTimer(e);
  });
  canvasElement.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch') moveLinesPeekTimer(e);
  });
  window.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch') endLinesPeek();
  });

  // Drawn on in units; their pixels (getImageData, undo, fill) are at res
  baseScrawlGraphics = createGraphics(canvasSize, canvasSize);
  baseScrawlGraphics.pixelDensity(res);
  drawingGraphics = createGraphics(layerSize, layerSize);
  drawingGraphics.pixelDensity(res);
  drawingGraphics.clear();
  background(bgColor);

  // Match the canvas to its container now and whenever the layout changes
  // (window resize, phone rotation, the mobile address bar sliding away)
  fitCanvasToContainer();
  new ResizeObserver(fitCanvasToContainer).observe(document.getElementById('scrawl-container'));

  // Desktop and mobile keys that do the same thing
  select("#generate-btn").mousePressed(() => requestNewScrawl('sidebar'));
  select("#generate-btn-sheet").mousePressed(() => requestNewScrawl('drawer'));
  select("#rotate-btn").mousePressed(rotateCanvas);
  select("#toggle-eyes-btn").mousePressed(toggleEyes);
  select("#toggle-eyes-btn-mobile").mousePressed(toggleEyes);
  select("#toggle-paint-btn").mousePressed(togglePaint);
  select("#toggle-paint-btn-mobile").mousePressed(togglePaint);
  select("#blank-cta-btn").mousePressed(() => requestNewScrawl('blank_start'));
  select("#canvas-new-btn").mousePressed(() => requestNewScrawl('canvas_button'));
  select("#clear-drawings-btn").mousePressed(clearDrawings);
  // On click, not press: Clear disables itself, and a disabled key gets no
  // click, so the sheet (which closes on its keys' clicks) would stay open
  document.getElementById('clear-drawings-btn-mobile').addEventListener('click', clearDrawings);
  select("#undo-btn").mousePressed(undo);
  select("#undo-btn-mobile").mousePressed(undo);
  select("#redo-btn").mousePressed(redo);
  select("#redo-btn-mobile").mousePressed(redo);

  // Loops faders (sidebar and sheet); see setLoops
  ['intensity-slider', 'intensity-slider-mobile'].forEach(id => {
    const slider = document.getElementById(id);
    slider.addEventListener('input', () => setLoops(parseInt(slider.value)));
  });

  // Tool, size and colour keys, Share
  setupToolbar();

  // Mobile bottom sheet: open/close
  setupMobileSheet();

  // Eye set keys (desktop and mobile share data-eye-set)
  setupEyeSetButtons();

  // A short buzz when a control key is tapped, so the keys feel physical
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    const key = e.target.closest('.sidebar button, .bottom-toolbar button');
    if (key && !key.disabled) haptic('tap');
  });

  // The app opens on a blank canvas with a "create" call to action
  // (#blank-cta) in the middle; the first Generate removes it. A faint
  // scrawl sits behind the button so the canvas doesn't look empty;
  // Generate clears it.
  baseScrawlGraphics.stroke(200);
  baseScrawlGraphics.strokeWeight(scrawlStrokeWeight);
  baseScrawlGraphics.noFill();
  const preview = scrawlSegments(intensity);
  fitScrawlToCanvas(preview);
  preview.forEach(seg => baseScrawlGraphics.bezier(...seg));

  // "first" only fits someone who has never made one on this device
  let created = false;
  try { created = localStorage.getItem('createdScrawlface') === '1'; } catch (e) {}
  if (created) {
    document.getElementById('blank-cta-btn').lastChild.textContent = 'Create a new scrawlface';
  }

  setTool('eyes');
  redrawCanvas();

  // Save, the gallery, and last time's unsaved work (see the Gallery section)
  setupGallery();

  trackAppOpened();

  // Help key, intro on first launch, tooltips (see the Onboarding section)
  setupOnboarding();
}

// Replaces the scrawlface on the canvas with a new one. The keys go through
// requestNewScrawl, which first offers to save unsaved changes. source says
// where it came from, for the scribble_generated event.
function generateScrawlface(source = 'other') {
  canvasPressed = false;
  startScrawlfaceStats(true);

  drawingGraphics.clear();
  hasDrawings = false;
  disableClearButton();

  // Generate can come mid-press (N key): drop the stroke or eye drag in progress
  isDrawing = false;
  pressChangedDrawing = false;
  draggedEyeIndex = -1;

  // A new scrawl starts with the whole canvas in view
  viewZoom = 1;
  viewPan = { x: 0, y: 0 };

  // ...and with the Eyes tool, because placing the eyes is the first step
  setTool('eyes');

  // Clear undo/redo history
  clearHistory();

  leaveBlankStart();
  try { localStorage.setItem('createdScrawlface', '1'); } catch (e) {}

  // A new scrawlface: not in the gallery, nothing unsaved, no draft
  scrawlfaceToken++;
  galleryId = null;
  savedVersion = editVersion;
  paintSavedVersion = paintVersion;
  forgetDraft();
  restartAutoSave();
  updateGallerySaveButtons();

  // Ensure scrawl is visible when generating new scrawl
  if (!showScrawl) {
    showScrawl = true;
    updateScrawlToggleButtons();
  }
  showPaintAgain();

  // Transparent, not white: the scrawl is drawn on top of the paint, so
  // the lines stay visible to follow (the canvas background is the white)
  baseScrawlGraphics.clear();
  scrawlVersion++;
  strokeColor = getComplementaryColor(bgColor);
  baseScrawlGraphics.stroke(strokeColor);
  baseScrawlGraphics.strokeWeight(scrawlStrokeWeight);
  baseScrawlGraphics.noFill();

  // Each segment is one bezier curve; draw() draws them in a few per frame
  scrawlQueue = scrawlSegments(intensity);
  fitScrawlToCanvas(scrawlQueue);
  scrawlDrawInRate = scrawlQueue.length /
    (scrawlDrawInBaseFrames + scrawlDrawInFramesPerSegment * scrawlQueue.length);
  scrawlDrawInProgress = 0;
  loop(); // draw() animates the draw-in
  // Reduced motion: draw the whole scrawl straight away
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) {
    finishScrawlDrawIn();
  }

  // First scrawl: once it has drawn in, the one tip on what to do
  const drawInMs = reducedMotion ? 0 :
    (scrawlDrawInBaseFrames + scrawlDrawInFramesPerSegment * scrawlQueue.length) / 60 * 1000;
  setTimeout(tipFirstScrawl, drawInMs + 300);

  const eye1X = random(eyeMargin, canvasSize - eyeMargin - eyeSize - 60);
  const eye1Y = random(eyeMargin, canvasSize - eyeMargin - eyeSize);
  const eye2X = random(eye1X + eyeSize, min(eye1X + 130, canvasSize - eyeMargin - eyeSize));
  const eye2Y = random(eyeMargin, canvasSize - eyeMargin - eyeSize);

  eyePositions = [
    {x: eye1X, y: eye1Y, scale: 1.0},
    {x: eye2X, y: eye2Y, scale: 0.9}
  ];

  redrawCanvas();
  track('scribble_generated', { source, loops: intensity });
}

// One continuous line, like a pen that never leaves the paper: each
// segment starts where the last one ended and wanders off across the
// canvas. Most joins are smooth (the pen keeps its direction), some are
// sharp corners, and now and then a segment curls into a loop.
function scrawlSegments(count) {
  const lo = 100;
  const hi = canvasSize - 100;
  const segments = [];
  let x = random(lo, hi);
  let y = random(lo, hi);
  let tangent = random(TWO_PI); // direction the pen leaves (x, y) in

  for (let i = 0; i < count; i++) {
    const loop = random() < 0.15;
    const side = random([-1, 1]);
    // The chord (start to end) roughly follows the pen; a loop sets off
    // at an angle to its chord, so turn the chord to match
    let heading = loop ? tangent - side * 0.46 : tangent + random(-0.8, 0.8);
    let len = random(120, 340);
    let x2 = x + cos(heading) * len;
    let y2 = y + sin(heading) * len;

    // Heading off the page: aim at a random spot instead, so the line
    // turns back and keeps roaming the whole canvas
    if (x2 < lo || x2 > hi || y2 < lo || y2 > hi) {
      x2 = random(lo, hi);
      y2 = random(lo, hi);
      heading = atan2(y2 - y, x2 - x);
      len = dist(x, y, x2, y2);
    }

    let cx1, cy1, cx2, cy2, endTangent;
    if (loop) {
      // Control points crossed over: the curve swings out past its end,
      // comes back behind its start and crosses itself
      const ux = cos(heading), uy = sin(heading);
      const px = -uy * side, py = ux * side;
      cx1 = x + (ux * 2 + px) * len;
      cy1 = y + (uy * 2 + py) * len;
      cx2 = x + (-ux + px) * len;
      cy2 = y + (-uy + py) * len;
      endTangent = atan2(y2 - cy2, x2 - cx2);
    } else {
      endTangent = heading + random(-0.9, 0.9);
      const h1 = random(0.25, 0.6) * len;
      const h2 = random(0.25, 0.6) * len;
      cx1 = x + cos(tangent) * h1;
      cy1 = y + sin(tangent) * h1;
      cx2 = x2 - cos(endTangent) * h2;
      cy2 = y2 - sin(endTangent) * h2;
    }
    segments.push([x, y, cx1, cy1, cx2, cy2, x2, y2]);

    // Next segment carries on smoothly, or doubles back at a sharp corner
    tangent = random() < 0.3
      ? endTangent + random([-1, 1]) * random(1.8, 2.8)
      : endTangent;
    x = x2;
    y = y2;
  }
  return segments;
}

// The random curves rarely fill the canvas exactly, so scale them
// evenly (same shape) until the scrawl's longer side spans
// the canvas, less a margin, and centre it
function fitScrawlToCanvas(segments) {
  const margin = 40;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  // Bounds of the curves themselves (control points lie further out)
  segments.forEach(([x1, y1, cx1, cy1, cx2, cy2, x2, y2]) => {
    for (let i = 0; i <= 20; i++) {
      const x = bezierPoint(x1, cx1, cx2, x2, i / 20);
      const y = bezierPoint(y1, cy1, cy2, y2, i / 20);
      minX = min(minX, x);
      maxX = max(maxX, x);
      minY = min(minY, y);
      maxY = max(maxY, y);
    }
  });

  const available = canvasSize - 2 * margin;
  const scale = min(available / (maxX - minX), available / (maxY - minY));
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  // Every segment is [x, y] pairs: scaling the points scales the curve
  segments.forEach(seg => {
    for (let i = 0; i < seg.length; i += 2) {
      seg[i] = canvasSize / 2 + (seg[i] - midX) * scale;
      seg[i + 1] = canvasSize / 2 + (seg[i + 1] - midY) * scale;
    }
  });
}

// Draws the next `count` queued scrawl segments onto the scrawl layer
function drawScrawlSegments(count) {
  scrawlQueue.splice(0, count).forEach(seg => baseScrawlGraphics.bezier(...seg));
}

// Skips the rest of the draw-in. Fill and export need the whole scrawl:
// a fill started mid-animation would leak through lines not drawn yet.
function finishScrawlDrawIn() {
  drawScrawlSegments(scrawlQueue.length);
}

// Loops in the next scrawl (1-30). Keeps both faders, their readouts and
// the folded "Loops: n" lines in sync. Only applies at the next New.
function setLoops(n) {
  intensity = constrain(Math.round(n), 1, 30);
  ['', '-mobile'].forEach(suffix => {
    document.getElementById('intensity-slider' + suffix).value = intensity;
    document.getElementById('intensity-value' + suffix).textContent = intensity;
    tickLcd('intensity-value' + suffix);
  });
  document.querySelectorAll('.loops-value').forEach(el => { el.textContent = intensity; });
  stateChanged();
}

// Flashes an intensity readout so the change is noticed
function tickLcd(id) {
  const lcd = document.getElementById(id);
  lcd.classList.remove('tick');
  void lcd.offsetWidth; // restart the animation
  lcd.classList.add('tick');
}

function draw() {
  // Scrawl draw-in after Generate: spread evenly over its duration, so
  // a low-intensity scrawl gets a new segment only every few frames
  if (scrawlQueue.length > 0) {
    scrawlDrawInProgress += scrawlDrawInRate;
    const count = floor(scrawlDrawInProgress + 1e-9);
    if (count > 0) {
      scrawlDrawInProgress -= count;
      drawScrawlSegments(count);
      redrawCanvas();
    }
  }

  if (draggedEyeIndex !== -1 && mouseIsPressed) {
    const transformed = getTransformedCoords(mouseX, mouseY);
    // Keep the whole eye in the scrawl square, and where it can be seen
    // (and grabbed again), so it can't be dragged out of reach
    eyePositions[draggedEyeIndex] = {
      ...eyePositions[draggedEyeIndex],
      ...keepInView({
        x: constrain(transformed.x + dragOffset.x, eyeRadius, canvasSize - eyeRadius),
        y: constrain(transformed.y + dragOffset.y, eyeRadius, canvasSize - eyeRadius)
      })
    };
    redrawCanvas();
    return;
  }

  if ((drawMode || eraseMode) && isDrawing && mouseIsPressed && isMouseInCanvas()) {
    const current = getTransformedCoords(mouseX, mouseY);
    // On the first frame of a touch stroke pmouseX/Y still hold the previous
    // touch position, so start the stroke where the finger actually is
    const previous = strokePoints === 0 ? current : getTransformedCoords(pmouseX, pmouseY);

    // Calculate easing for brush
    const targetSize = eraseMode ? eraserSize : brushSize;

    // Calculate velocity for ease-out
    const distance = dist(previous.x, previous.y, current.x, current.y);
    // Measured as it looks on screen, so the brush feels the same when zoomed in
    strokeLength += distance * viewZoom;
    const velocity = constrain(distance * viewZoom, 0, 20);
    const velocityFactor = map(velocity, 0, 20, 0.3, 1.0); // Slow = taper, fast = full size

    // Ease in: gradually increase size at start of stroke
    let sizeFactor = 1.0;
    if (strokePoints < maxStrokePoints) {
      strokePoints++;
      const easeIn = strokePoints / maxStrokePoints;
      // Use smooth easing function (smoothstep)
      sizeFactor = easeIn * easeIn * (3 - 2 * easeIn);
    }

    // Combine ease-in and velocity-based tapering
    currentBrushSize = targetSize * sizeFactor * velocityFactor;

    // Draw brush stroke as circles along the path
    const steps = max(1, floor(distance / 2)); // More steps for smoother strokes

    if (eraseMode) {
      drawingGraphics.erase();
    } else {
      drawingGraphics.fill(brushColor);
      drawingGraphics.noStroke();
    }

    for (let i = 0; i <= steps; i++) {
      const t = steps > 0 ? i / steps : 0;
      dab(lerp(previous.x, current.x, t), lerp(previous.y, current.y, t), currentBrushSize);
    }

    if (eraseMode) {
      drawingGraphics.noErase();
    }

    if (!hasDrawings) {
      hasDrawings = true;
      enableClearButton();
    }

    redrawCanvas();
  }

  // Nothing to animate or follow: stop the frame loop, so an idle page costs
  // nothing (60 wake-ups a second otherwise). Whatever starts something
  // calls loop() again: a press (mousePressed) and New (the draw-in). Pinch,
  // undo, fill, the keys and opening a scrawlface redraw directly.
  if (scrawlQueue.length === 0 && !mouseIsPressed && draggedEyeIndex === -1 && !isDrawing) {
    noLoop();
  }
}

// One round mark of the brush or eraser at a position on the drawing (the
// pen is set by the caller). Grows strokeBounds to cover it, so the stroke's
// undo memento only keeps the area it painted.
function dab(x, y, size) {
  const lx = x + layerOffset;
  const ly = y + layerOffset;
  drawingGraphics.ellipse(lx, ly, size, size);
  // In layer pixels, + the anti-aliased edge
  const r = size / 2 * res + 2;
  strokeBounds = unionRect(strokeBounds, { x: lx * res - r, y: ly * res - r, w: 2 * r, h: 2 * r });
}

// The part of the canvas the window shows, in canvas units: its container
// masks the picture's edges when the window isn't 4:5
function visibleCanvasRect() {
  const c = canvas.elt.getBoundingClientRect();
  const b = document.getElementById('scrawl-container').getBoundingClientRect();
  const k = width / c.width;
  return {
    x0: (Math.max(c.left, b.left) - c.left) * k,
    x1: (Math.min(c.right, b.right) - c.left) * k,
    y0: (Math.max(c.top, b.top) - c.top) * k,
    y1: (Math.min(c.bottom, b.bottom) - c.top) * k
  };
}

// Moves a position on the drawing just enough that an eye there is wholly
// in view
function keepInView(pos) {
  const view = visibleCanvasRect();
  const r = eyeRadius * viewZoom;
  const screen = getRotatedPosition(pos.x, pos.y);
  const sx = view.x1 - view.x0 > 2 * r ? constrain(screen.x, view.x0 + r, view.x1 - r) : (view.x0 + view.x1) / 2;
  const sy = view.y1 - view.y0 > 2 * r ? constrain(screen.y, view.y0 + r, view.y1 - r) : (view.y0 + view.y1) / 2;
  if (sx === screen.x && sy === screen.y) return pos;
  return getTransformedCoords(sx, sy);
}

// The pointer over the eyes (desktop): while the loop is paused, draw()
// doesn't run, so this follows the mouse instead
function mouseMoved() {
  if (moveEyesMode && !drawMode && !eraseMode && !bucketMode) updateCursor();
}

function updateCursor() {
  const transformed = getTransformedCoords(mouseX, mouseY);
  const overEye = findEyeAt(transformed.x, transformed.y) !== -1;
  cursor(overEye ? 'pointer' : ARROW);
}

// Index of the eye nearest to a point (canvas coords), or -1 if none is in reach.
// The canvas is scaled down on small screens, so the reach grows to keep a
// touch target at least 48px across (Apple's minimum is 44pt), and shrinks
// again when zoomed in.
function findEyeAt(x, y) {
  let reach = max(eyeRadius, 24 * width / canvas.elt.clientWidth / viewZoom);
  let found = -1;
  eyePositions.forEach((pos, i) => {
    const d = dist(x, y, pos.x, pos.y);
    if (d < reach) {
      reach = d;
      found = i;
    }
  });
  return found;
}

function isMouseInCanvas() {
  return mouseX >= 0 && mouseX <= width && mouseY >= 0 && mouseY <= height;
}

function mousePressed(event) {
  // Any press may start a stroke or a drag, which draw() follows frame by frame
  loop();

  // mousePressed is window-wide. Ignore presses on anything other than the
  // canvas (e.g. mobile toolbar buttons that overlap it when the menu is open),
  // even if their coordinates fall inside the canvas bounds.
  if (event && event.target !== canvas.elt) return;

  // Working on the canvas puts any one-off tip away, and keeps the
  // first scrawl's tip from turning up late (see tipFirstScrawl)
  dismissTip();
  canvasPressed = true;

  // A second finger is a pinch, not another press
  if (pinch) return;

  // Blank start: nothing to draw on until the first scrawl is created
  if (document.body.classList.contains('is-blank')) return;

  if (!drawMode && !eraseMode && !bucketMode && moveEyesMode) {
    const transformed = getTransformedCoords(mouseX, mouseY);
    const eyeIndex = findEyeAt(transformed.x, transformed.y);

    if (eyeIndex !== -1) {
      draggedEyeIndex = eyeIndex;
      dragStart = { x: eyePositions[eyeIndex].x, y: eyePositions[eyeIndex].y };
      dragOffset = {
        x: eyePositions[eyeIndex].x - transformed.x,
        y: eyePositions[eyeIndex].y - transformed.y
      };
      cursor(MOVE);
    }
  }

  if ((drawMode || eraseMode) && isMouseInCanvas()) {
    isDrawing = true;
    // Reset stroke for easing in
    strokePoints = 0;
    currentBrushSize = 0;
    strokeLength = 0;
    // Keep the layer as it is BEFORE drawing, to undo to (see beginStroke)
    beginStroke();
    pressChangedDrawing = true;
  }

  if (bucketMode && isMouseInCanvas()) {
    // floodFill saves undo state itself, only when it actually fills
    const lastState = historyStack[historyStack.length - 1];
    const pos = getTransformedCoords(mouseX, mouseY);
    floodFill(pos.x, pos.y, brushColor);
    pressChangedDrawing = historyStack[historyStack.length - 1] !== lastState;
  }
}

// ---- Two-finger pinch: zoom, rotate and pan the view ----
// The view is only how the canvas is shown; the drawing itself isn't changed,
// so none of this is part of the undo history.

// A touch in canvas coordinates (the canvas element is scaled by CSS)
function touchPoint(touch) {
  const rect = canvas.elt.getBoundingClientRect();
  const k = width / rect.width;
  return { x: (touch.clientX - rect.left) * k, y: (touch.clientY - rect.top) * k };
}

// The press had already started a stroke or filled, but turned out to be a
// gesture (a pinch, or a touch and hold to peek): take its mark back. It
// isn't a change to the scrawlface, so it doesn't count as unsaved.
function cancelPressMark() {
  if (pressChangedDrawing && isDrawing) {
    // A stroke: it isn't in the history yet, so just paint over it
    restoreStrokeArea();
    pressChangedDrawing = false;
  } else if (pressChangedDrawing) {
    // A fill: already a history step
    const version = editVersion;
    const paint = paintVersion;
    undo();
    redoStack.pop(); // undo() queued the cancelled mark for redo
    updateUndoRedoButtons();
    editVersion = version;
    paintVersion = paint;
    updateGallerySaveButtons();
    pressChangedDrawing = false;
  }
  isDrawing = false;
}

function startPinch(touches) {
  // The first finger had already started a stroke or filled: take it back,
  // the gesture turned out to be a pinch. An eye being dragged is let go.
  cancelPressMark();
  draggedEyeIndex = -1;

  const a = touchPoint(touches[0]);
  const b = touchPoint(touches[1]);
  pinch = {
    // At least 1px: two touches reported at the same point would divide by zero
    distance: max(1, dist(a.x, a.y, b.x, b.y)),
    angle: atan2(b.y - a.y, b.x - a.x),
    // The point of the drawing between the fingers; it stays between them
    anchor: getTransformedCoords((a.x + b.x) / 2, (a.y + b.y) / 2),
    zoom: viewZoom,
    rotation: rotation
  };
  track('canvas_zoomed', { input: 'touch' });
}

function movePinch(touches) {
  const a = touchPoint(touches[0]);
  const b = touchPoint(touches[1]);

  viewZoom = constrain(pinch.zoom * dist(a.x, a.y, b.x, b.y) / pinch.distance, 1, maxZoom);
  rotation = pinch.rotation + degrees(atan2(b.y - a.y, b.x - a.x) - pinch.angle);

  // Shift the view so the anchor point is back between the fingers
  viewPan = { x: 0, y: 0 };
  const anchorOnScreen = getRotatedPosition(pinch.anchor.x, pinch.anchor.y);
  viewPan = {
    x: (a.x + b.x) / 2 - anchorOnScreen.x,
    y: (a.y + b.y) / 2 - anchorOnScreen.y
  };
  clampViewPan();

  redrawCanvas();
}

function endPinch() {
  pinch = null;
  settleView();
}

// After a pinch (touch or trackpad): settle on a quarter turn when close to
// one, and on the full view when barely zoomed, so it's easy to get back to
// a straight, whole canvas
function settleView() {
  const quarterTurn = round(rotation / 90) * 90;
  if (abs(rotation - quarterTurn) < 8) rotation = quarterTurn;
  rotation = ((rotation % 360) + 360) % 360;
  if (viewZoom < 1.05) viewZoom = 1;
  clampViewPan();

  if (drawMode || eraseMode) setBrushCursor();
  redrawCanvas();
}

// ---- Trackpad (desktop): the same view gestures as on a touch screen ----
// A trackpad pinch zooms the view about the pointer: browsers report it as
// a wheel event with ctrlKey (Chrome, Edge, Firefox), and Safari also as
// gesture events, which carry the two-finger turn too. Moving two fingers
// pans the view while it's zoomed in. The view settles (as after a touch
// pinch) a moment after the fingers stop. Turning needs Safari: other
// browsers don't report a trackpad turn (Rotate in the sidebar does it).
let trackpadActive = false;
let trackpadSettleTimer = null;
let safariGesture = null; // { anchor, point, zoom, rotation } at its start

function startTrackpadGesture() {
  if (!trackpadActive) {
    trackpadActive = true;
    // The pointer may have been pressed: the gesture wins, as with a pinch
    cancelPressMark();
    draggedEyeIndex = -1;
    track('canvas_zoomed', { input: 'trackpad' });
  }
  clearTimeout(trackpadSettleTimer);
  trackpadSettleTimer = setTimeout(() => {
    trackpadActive = false;
    settleView();
  }, 250);
}

// Shifts the view so the drawing's point `anchor` is on screen at `point`
function placeView(anchor, point) {
  viewPan = { x: 0, y: 0 };
  const onScreen = getRotatedPosition(anchor.x, anchor.y);
  viewPan = { x: point.x - onScreen.x, y: point.y - onScreen.y };
  clampViewPan();
  redrawCanvas();
}

function onCanvasWheel(e) {
  if (isBlankStart() || pinch) return;
  const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1; // to pixels
  if (e.ctrlKey) {
    // A pinch (Ctrl + mouse wheel does the same)
    e.preventDefault(); // not the browser's page zoom
    if (safariGesture) return; // Safari's gesture events have it
    startTrackpadGesture();
    const point = touchPoint(e);
    const anchor = getTransformedCoords(point.x, point.y);
    viewZoom = constrain(viewZoom * Math.exp(-e.deltaY * lines * 0.01), 1, maxZoom);
    placeView(anchor, point);
  } else if (viewZoom > 1) {
    // Two fingers moving over the zoomed view: move it with them
    e.preventDefault();
    startTrackpadGesture();
    const k = width / canvas.elt.getBoundingClientRect().width;
    viewPan = { x: viewPan.x - e.deltaX * lines * k, y: viewPan.y - e.deltaY * lines * k };
    clampViewPan();
    redrawCanvas();
  }
}

// Safari: a trackpad pinch and turn. (On an iPad, Safari sends these for a
// touch pinch as well; the touch pinch has it, so they're ignored then.)
function onGestureStart(e) {
  if (isBlankStart() || pinch) return;
  e.preventDefault();
  startTrackpadGesture();
  const point = touchPoint(e);
  safariGesture = { anchor: getTransformedCoords(point.x, point.y), point, zoom: viewZoom, rotation };
}

function onGestureChange(e) {
  if (!safariGesture) return;
  e.preventDefault();
  startTrackpadGesture();
  viewZoom = constrain(safariGesture.zoom * e.scale, 1, maxZoom);
  rotation = safariGesture.rotation + e.rotation;
  placeView(safariGesture.anchor, safariGesture.point);
}

function onGestureEnd(e) {
  if (!safariGesture) return;
  e.preventDefault();
  safariGesture = null;
}

// The view can only be shifted as far as the zoom has pushed the picture
// past the canvas edges: none at zoom 1, so zooming all the way out
// re-centres it
function clampViewPan() {
  const limitX = (viewZoom - 1) * frameWidth / 2;
  const limitY = (viewZoom - 1) * frameHeight / 2;
  viewPan.x = constrain(viewPan.x, -limitX, limitX);
  viewPan.y = constrain(viewPan.y, -limitY, limitY);
}

// ---- Touch and hold: peek under the lines ----
// Holding one finger still on the canvas hides the scrawl lines until the
// finger lifts, to see the drawing without them; on a desktop, pressing and
// holding the trackpad or mouse still does the same. It is only a view:
// Hide lines (sheet / sidebar) is what hides them for good.
const linesPeekMs = 500;
let linesPeekTimer = null;
let linesPeekStart = null; // where the finger went down (page px)
let peekingLines = false;

function startLinesPeekTimer(touch) {
  cancelLinesPeekTimer();
  if (isBlankStart() || !showScrawl) return;
  linesPeekStart = { x: touch.clientX, y: touch.clientY };
  linesPeekTimer = setTimeout(startLinesPeek, linesPeekMs);
}

// A finger that moves is drawing or dragging, not holding
function moveLinesPeekTimer(touch) {
  if (!linesPeekTimer || !touch) return;
  if (Math.hypot(touch.clientX - linesPeekStart.x, touch.clientY - linesPeekStart.y) > tapSlop) {
    cancelLinesPeekTimer();
  }
}

function cancelLinesPeekTimer() {
  clearTimeout(linesPeekTimer);
  linesPeekTimer = null;
}

function startLinesPeek() {
  linesPeekTimer = null;
  // Holding an eye still is part of moving it, not a peek
  if (pinch || draggedEyeIndex !== -1) return;
  cancelPressMark();
  peekingLines = true;
  haptic('hold');
  redrawCanvas();
  track('lines_peeked');
}

function endLinesPeek() {
  cancelLinesPeekTimer();
  if (!peekingLines) return;
  peekingLines = false;
  redrawCanvas();
}

function mouseReleased() {
  // A stroke, fill or eye drag is a change to the scrawlface (for Save and
  // the draft). Tapping an eye without moving it isn't.
  const eye = eyePositions[draggedEyeIndex];
  const eyeMoved = eye && (eye.x !== dragStart.x || eye.y !== dragStart.y);
  const changed = pressChangedDrawing || eyeMoved;
  const painted = pressChangedDrawing;

  if (draggedEyeIndex !== -1) {
    draggedEyeIndex = -1;
    cursor(ARROW);
  }

  // A tap leaves a full-size dot. The eased stroke alone is too thin to see,
  // which made taps invisible while still costing an undo step.
  if (isDrawing && strokeLength < tapSlop) {
    const pos = getTransformedCoords(mouseX, mouseY);
    const size = eraseMode ? eraserSize : brushSize;

    if (eraseMode) {
      drawingGraphics.erase();
    } else {
      drawingGraphics.fill(brushColor);
      drawingGraphics.noStroke();
    }
    dab(pos.x, pos.y, size);
    if (eraseMode) {
      drawingGraphics.noErase();
    }

    if (!hasDrawings && !eraseMode) {
      hasDrawings = true;
      enableClearButton();
    }

    redrawCanvas();
  }
  if (isDrawing && pressChangedDrawing) commitStroke();

  if (pressChangedDrawing) usedTool(bucketMode ? 'fill' : eraseMode ? 'eraser' : 'brush');
  else if (eyeMoved) usedTool('eyes');

  isDrawing = false;
  pressChangedDrawing = false;
  if (changed) markChanged(painted);
}

function keyPressed() {
  // A dialog (Save / Discard, My Scrawls, Delete) has the keyboard: the
  // canvas behind it doesn't react, and N can't open a second prompt
  if (document.querySelector('dialog[open]')) return;

  // Ctrl (Windows/Linux) or Cmd (Mac; key codes 91/93 are the left/right Cmd keys)
  const cmd = keyIsDown(CONTROL) || keyIsDown(91) || keyIsDown(93);

  // Undo: Cmd+Z. Redo: Cmd+Shift+Z or Cmd+Y
  if (cmd && (keyCode === 90 || keyCode === 89)) {
    if (keyCode === 89 || keyIsDown(SHIFT)) {
      redo();
    } else {
      undo();
    }
    return false; // Prevent default browser behavior
  }

  // Tool shortcuts (desktop): B brush, E eraser, F fill, V eyes, N new scrawl
  if (cmd || keyIsDown(ALT)) return;
  const tool = { b: 'brush', e: 'eraser', f: 'fill', v: 'eyes' }[key.toLowerCase()];
  if (tool) setTool(tool);
  if (key.toLowerCase() === 'n') requestNewScrawl('key_n');
}

// Screen (canvas element) position -> position on the drawing
function getTransformedCoords(mx, my) {
  const cx = (mx - width / 2 - viewPan.x) / viewZoom;
  const cy = (my - height / 2 - viewPan.y) / viewZoom;
  const angle = -radians(rotation);
  const cosA = cos(angle);
  const sinA = sin(angle);

  return {
    x: cx * cosA - cy * sinA + canvasSize / 2,
    y: cx * sinA + cy * cosA + canvasSize / 2
  };
}

function redrawCanvas() {
  background(bgColor);

  push();
  translate(width / 2 + viewPan.x, height / 2 + viewPan.y);
  rotate(radians(rotation));
  scale(viewZoom);
  imageMode(CENTER);

  // Draw the layers straight onto the canvas (no intermediate composite),
  // so each frame while drawing only copies what's needed. The scrawl goes
  // on top of the paint so its lines can still be followed; Hide lines
  // takes them away, and Hide paint the paint.
  if (showPaint) image(drawingGraphics, 0, 0);
  if (showScrawl && !peekingLines) {
    image(baseScrawlGraphics, 0, 0);
  }

  pop();

  // Always show eyes (window = the main canvas in p5 global mode)
  const onScreen = eyePositions.map(pos => getRotatedPosition(pos.x, pos.y));
  eyePositions.forEach((pos, i) => {
    // Whichever eye is further right is drawn as the right-hand one, so
    // slanted eyes keep facing each other when they're dragged past each other
    const isRight = onScreen[i].x > onScreen[1 - i].x ? 1 : 0;
    drawEye(window, onScreen[i].x, onScreen[i].y, pos.scale * viewZoom, eyeStyles[i], isRight);
  });
}

// Position on the drawing -> screen (canvas element) position
function getRotatedPosition(x, y) {
  const cx = (x - canvasSize / 2) * viewZoom;
  const cy = (y - canvasSize / 2) * viewZoom;
  const angle = radians(rotation);
  const cosA = cos(angle);
  const sinA = sin(angle);

  return {
    x: cx * cosA - cy * sinA + width / 2 + viewPan.x,
    y: cx * sinA + cy * cosA + height / 2 + viewPan.y
  };
}

// ---- Eye styles ----
// Swappable eye styles, drawn as bold hand-drawn doodles. Each eye has its
// own style, so the two can differ. A set is a ready-made pair (Patch is an
// open eye and an eye patch); Mix picks a random pair.
// `g` is what to draw on: the main canvas (window) or a preview graphic.
//
// House style, so the set reads as one family:
// - black and white only
// - main lines 3 wide; detail lines (second pen pass, hatching, veins,
//   flecks) 1.5 wide
// - every outline is drawn twice, the second pass thinner and a little off
// - every pupil is solid black with a white glint inside it, up and right
// - every lid is white, shaded with hatching (closer hatching = darker)
const eyeSets = {
  classic: ['classic', 'classic'],
  lashes: ['lashes', 'lashes'],
  sleepy: ['sleepy', 'sleepy'],
  glam: ['glam', 'glam'],
  spiky: ['spiky', 'spiky'],
  patch: ['lashes', 'patch'],
  dot: ['dot', 'dot'],
  side: ['side', 'side'],
  goat: ['goat', 'goat'],
  sunny: ['sunny', 'sunny'],
  frog: ['frog', 'frog'],
  cat: ['cat', 'cat']
};
let doodleSeed = 0;  // set per eye, so two eyes of one style aren't identical

// Every eye is two curves meeting in a point at each side. A shape says how
// wide it is (w = half the width), how far the top and bottom curves bulge,
// how rounded each end is (kl/kr: 0.5 = pointed almond, towards 1 = round)
// and how much it slants (tilt, in radians; positive = outer corner up).
const eyeShapes = {
  almond:   { w: 40, top: 33, bottom: 33, kl: 0.5, kr: 0.5 },
  lens:     { w: 48, top: 22, bottom: 24, kl: 0.5, kr: 0.5, tilt: -0.12 }, // wide, flat, drooping
  upturned: { w: 44, top: 40, bottom: 18, kl: 0.35, kr: 0.6, tilt: 0.2 },
  round:    { w: 32, top: 46, bottom: 46, kl: 0.95, kr: 0.95 },
  slit:     { w: 48, top: 14, bottom: 14, kl: 0.5, kr: 0.5 },    // long and narrowed
  teardrop: { w: 42, top: 36, bottom: 36, kl: 0.05, kr: 1.1 },   // pointed left, round right
  wide:     { w: 46, top: 28, bottom: 28, kl: 0.6, kr: 0.6 },    // broad, soft-cornered
  dome:     { w: 42, top: 52, bottom: 8, kl: 0.7, kr: 0.7 },     // deep top, flat bottom
  orb:      { w: 31, top: 39, bottom: 39, kl: 0.9, kr: 0.9 },    // small and round
  slanted:  { w: 46, top: 24, bottom: 24, kl: 0.3, kr: 0.7, tilt: 0.3 }
};
const eyeStyleShapes = {
  lashes: 'almond', sleepy: 'lens', glam: 'upturned',
  spiky: 'round', dot: 'slit', side: 'teardrop', goat: 'wide',
  sunny: 'dome', frog: 'orb', cat: 'slanted'
};
let eyeShape = eyeShapes.almond; // shape of the eye being drawn

// `seed` is 0 for the left-hand eye and 1 for the right-hand one: it varies
// the hand-drawn wobble and mirrors the slant, so a slanted pair faces each other
function drawEye(g, x, y, scale, style, seed = 0) {
  doodleSeed = seed * 100;
  eyeShape = eyeShapes[eyeStyleShapes[style]] || eyeShapes.almond;

  g.push();
  g.translate(x, y);
  g.scale(scale);
  g.rotate((eyeShape.tilt || 0) * (seed === 1 ? -1 : 1));
  g.stroke(0);
  g.strokeWeight(3);
  g.strokeCap(ROUND);
  g.strokeJoin(ROUND);

  if (style === 'classic') {
    // The original googly eye
    g.fill(255);
    doodleEllipse(g, 0, 0, eyeSize, eyeSize, 1);
    // The pen going round a second time
    g.noFill();
    g.strokeWeight(1.5);
    doodleEllipse(g, 0.5, -0.5, eyeSize + 3, eyeSize + 2, 2);
    g.noStroke();
    g.fill(0);
    doodleEllipse(g, 1, 1, 40, 40, 3);
    glint(g, 7, -6, 10);
  } else if (style === 'patch') {
    // Pirate eye patch: a black shield with its strap running off both sides
    g.line(-26, -20, -64, -40);
    g.line(26, -20, 64, -40);
    g.fill(0);
    const patch = [[-30, -22], [0, -27], [30, -22], [33, 0], [20, 24], [0, 31], [-20, 24], [-33, 0]];
    g.beginShape();
    for (let i = 0; i < patch.length + 3; i++) {
      const k = i % patch.length;
      g.curveVertex(patch[k][0] + 2 * wobble(70 + k), patch[k][1] + 2 * wobble(80 + k));
    }
    g.endShape();
    // The pen going round a second time
    g.noFill();
    g.strokeWeight(1.5);
    doodleEllipse(g, 1, 1, 72, 64, 2);
    // A glint, so the black doesn't read as a hole
    g.stroke(255);
    g.strokeWeight(2);
    g.bezier(-18, -10, -15, -17, -8, -19, -2, -19);
  } else {
    // Open eyes: the outline, then everything inside it (clipped to the
    // shape so nothing pokes out), then the outline again and the lashes
    if (style === 'frog') {
      // The bump a frog's eye sits in, showing above and beside it
      g.fill(255);
      doodleEllipse(g, 0, -5, 76, 71, 8);
    }
    eyeOutline(g, 255);

    const ctx = g.drawingContext;
    ctx.save();
    clipToEye(ctx);
    if (style === 'lashes') {
      iris(g, 0, 0, 26);
    } else if (style === 'sleepy') {
      // Heavy lid covering the top half
      iris(g, 0, 6, 26);
      lid(g, 0, 7);
    } else if (style === 'glam') {
      // Crescent lid with heavy eyeshadow (close hatching)
      iris(g, 0, 0, 26);
      lid(g, 0.35, 3.5);
    } else if (style === 'spiky') {
      // Bloodshot: veins on the white
      veins(g);
      iris(g, 0, 0, 26);
    } else if (style === 'dot') {
      // Small dot pupil
      g.noStroke();
      g.fill(0);
      doodleEllipse(g, 0, 0, 13, 13, 3);
      glint(g, 2, -2, 4);
    } else if (style === 'side') {
      // Big black iris pushed against the round end
      g.noStroke();
      g.fill(0);
      doodleEllipse(g, 18, 0, 44, 44, 3);
      glint(g, 26, -8, 10);
    } else if (style === 'goat') {
      // A goat's flat, bar-shaped pupil, hand-drawn: short flecks
      // scratched in around a wobbly bar
      g.stroke(0);
      g.strokeWeight(1.5);
      for (let i = 0; i < 10; i++) {
        const angle = TWO_PI * (i + 0.3 * wobble(40 + i)) / 10;
        const near = 1.25 + 0.1 * wobble(50 + i);
        const far = near + 0.35 + 0.15 * wobble(60 + i);
        g.line(cos(angle) * 18 * near, sin(angle) * 8 * near, cos(angle) * 18 * far, sin(angle) * 8 * far);
      }
      g.noStroke();
      g.fill(0);
      // The bar: eight points round a rectangle, each nudged off true
      const bar = [[-17, -5], [0, -6.5], [17, -5], [18.5, 0], [17, 5], [0, 6.5], [-17, 5], [-18.5, 0]];
      g.beginShape();
      for (let i = 0; i < bar.length + 3; i++) {
        const k = i % bar.length;
        g.curveVertex(bar[k][0] + 1.5 * wobble(70 + k), bar[k][1] + 1.2 * wobble(80 + k));
      }
      g.endShape();
      glint(g, 10, -1.5, 4.5);
    } else if (style === 'frog') {
      // A wide oval pupil
      g.noStroke();
      g.fill(0);
      doodleEllipse(g, 0, 2, 31, 13, 3);
      glint(g, 7, 0.5, 4.5);
    } else if (style === 'cat') {
      // A vertical slit pupil
      g.noStroke();
      g.fill(0);
      doodleEllipse(g, 0, 0, 10, 40, 3);
      glint(g, 0.5, -8, 4);
    } else if (style === 'sunny') {
      // Deep lid over a black iris
      iris(g, 0, -6, 26);
      lid(g, 0.45, 7);
    }
    ctx.restore();

    // ctx.restore() also put the pen back, so set it again
    g.stroke(0);
    g.strokeWeight(3);
    eyeOutline(g, null);

    if (style === 'lashes') lashes(g, -1, 5, 14);
    if (style === 'goat') {
      // A heavy brow line sketched above the eye
      const { w, top, kl, kr } = eyeShape;
      g.noFill();
      g.bezier(-w * 0.8, -top * 0.55, -w * kl, -top - 7, w * kr, -top - 8, w * 0.85, -top * 0.5);
    }
    if (style === 'glam' || style === 'sunny') lashes(g, 1, 4, 10);
  }

  g.pop();
}

// The unevenness of a hand: a fixed value between -1 and 1 for each n.
// Fixed rather than random(), so the eyes don't shimmer as the canvas redraws.
function wobble(n) {
  const s = Math.sin((n + doodleSeed) * 127.1) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

// A hand-drawn ellipse: a little uneven all the way round. `n` picks which
// unevenness, so shapes drawn on top of each other differ.
function doodleEllipse(g, x, y, w, h, n) {
  const points = 10;
  g.beginShape();
  // Three extra points close the curve smoothly
  for (let i = 0; i < points + 3; i++) {
    const k = i % points;
    const angle = TWO_PI * k / points;
    const r = 1 + 0.045 * wobble(n * 10 + k);
    g.curveVertex(x + cos(angle) * w / 2 * r, y + sin(angle) * h / 2 * r);
  }
  g.endShape();
}

// The outline of the current eye shape (fillColor null = outline only)
function eyeOutline(g, fillColor) {
  const { w, top, bottom, kl, kr } = eyeShape;
  fillColor === null ? g.noFill() : g.fill(fillColor);
  g.beginShape();
  g.vertex(-w, 0);
  g.bezierVertex(-w * kl, -top, w * kr, -top, w, 0);
  g.bezierVertex(w * kr, bottom, -w * kl, bottom, -w, 0);
  g.endShape(CLOSE);

  // The pen going round a second time: thinner, a little off the first line,
  // and overshooting the corners
  g.push();
  g.noFill();
  g.strokeWeight(1.5);
  const o = (n) => 2.5 * wobble(n);
  g.bezier(-w - 4, 2 + o(11), -w * kl, -top - 2 + o(12), w * kr, -top + 2 + o(13), w + 3, -1 + o(14));
  g.bezier(w + 4, -2 + o(15), w * kr, bottom + 2 + o(16), -w * kl, bottom - 2 + o(17), -w - 3, 1 + o(18));
  g.pop();
}

// Limits drawing to the inside of the current eye shape (until ctx.restore())
function clipToEye(ctx) {
  const { w, top, bottom, kl, kr } = eyeShape;
  ctx.beginPath();
  ctx.moveTo(-w, 0);
  ctx.bezierCurveTo(-w * kl, -top, w * kr, -top, w, 0);
  ctx.bezierCurveTo(w * kr, bottom, -w * kl, bottom, -w, 0);
  ctx.clip();
}

// The round pupil most eyes have: solid black with a glint
function iris(g, x, y, size) {
  g.noStroke();
  g.fill(0);
  doodleEllipse(g, x, y, size, size, 5);
  glint(g, x + size * 0.2, y - size * 0.2, size * 0.27);
  g.stroke(0);
}

// The white glint inside a pupil
function glint(g, x, y, size) {
  g.noStroke();
  g.fill(255);
  doodleEllipse(g, x, y, size * 1.1, size, 7);
}

// Thin veins creeping in from the edge of the eye white. Drawn inside
// the eye's clip, before the iris, so both trim them.
function veins(g) {
  const { w, top, bottom } = eyeShape;
  const count = 9;
  g.push();
  g.noFill();
  g.stroke(0);
  g.strokeWeight(1.5);
  for (let i = 0; i < count; i++) {
    const angle = TWO_PI * (i + 0.3 * wobble(40 + i)) / count;
    // Start on the edge and head for the middle, stopping part of the way
    const x0 = cos(angle) * w;
    const y0 = sin(angle) * (sin(angle) < 0 ? top : bottom) * 0.8;
    const reach = 0.45 + 0.15 * wobble(50 + i);
    // Sideways wiggle, so no vein is a straight line
    const bx = -sin(angle) * 6 * wobble(60 + i);
    const by = cos(angle) * 6 * wobble(60 + i);
    g.bezier(x0, y0, x0 * 0.85 + bx, y0 * 0.85 + by, x0 * 0.65 - bx, y0 * 0.65 - by, x0 * reach, y0 * reach);
    // A short branch forking off part of the way in
    g.line(x0 * 0.72, y0 * 0.72, x0 * 0.58 + 5 * wobble(70 + i), y0 * 0.58 + 5 * wobble(80 + i));
  }
  g.pop();
}

// Upper lid: from the top curve down to a lower curve at `depth`
// (0 = straight across the middle, 1 = no lid), shaded with slanting pen
// strokes `spacing` apart
function lid(g, depth, spacing) {
  const { w, top, kl, kr } = eyeShape;
  g.fill(255);
  g.beginShape();
  g.vertex(-w, 0);
  g.bezierVertex(-w * kl, -top, w * kr, -top, w, 0);
  g.bezierVertex(w * kr, -top * depth, -w * kl, -top * depth, -w, 0);
  g.endShape(CLOSE);

  // Hatching, kept inside the lid
  const ctx = g.drawingContext;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-w, 0);
  ctx.bezierCurveTo(-w * kl, -top, w * kr, -top, w, 0);
  ctx.bezierCurveTo(w * kr, -top * depth, -w * kl, -top * depth, -w, 0);
  ctx.clip();
  g.strokeWeight(1.5);
  let n = 0;
  for (let x = -w - top * 0.6; x < w; x += spacing) {
    const off = 1.2 * wobble(90 + n++);
    g.line(x + off, 0, x + top * 0.6 - off, -top);
  }
  ctx.restore();
  // ctx.restore() also put the pen back, so set it again
  g.stroke(0);
  g.strokeWeight(3);
}

// Lashes along the top (side -1) or bottom (side 1) curve, pointing outwards.
// Each one is a slightly different length and angle, as if flicked in by hand.
function lashes(g, side, count, length, curve = 1) {
  const { w, top, bottom, kl, kr } = eyeShape;
  const c = (side < 0 ? -top : bottom) * curve;
  for (let i = 0; i < count; i++) {
    const t = 0.2 + 0.6 * i / (count - 1);
    const x = bezierPoint(-w, -w * kl, w * kr, w, t);
    const y = bezierPoint(0, c, c, 0, t);
    // Fan out from a point on the other side of the eye
    const dx = x + 5 * wobble(20 + i + side);
    const dy = y + 20 * side;
    const d = Math.hypot(dx, dy);
    const len = length * (1 + 0.25 * wobble(30 + i + side));
    g.line(x, y, x + dx / d * len, y + dy / d * len);
  }
}

// Each key shows a preview of its set (the patch for Patch); picking one
// restyles both eyes. Eye styles are not part of the undo history.
function setupEyeSetButtons() {
  const previews = {};

  document.querySelectorAll('[data-eye-set]').forEach(btn => {
    const set = btn.dataset.eyeSet;
    if (!previews[set]) {
      const g = createGraphics(64, 64);
      g.pixelDensity(2);
      drawEye(g, 32, 32, 0.6, eyeSets[set][1]);
      previews[set] = g.elt.toDataURL();
      g.remove();
    }
    const img = document.createElement('img');
    img.src = previews[set];
    img.alt = '';
    btn.prepend(img);
    btn.addEventListener('click', () => pickEyeSet(set));
  });

  document.querySelectorAll('.mix-eyes-btn').forEach(btn => {
    btn.addEventListener('click', mixEyes);
  });

  updateEyeSetButtons();
}

// Gives each eye a different random style (never the
// same pair as now, so every press visibly changes something)
function mixEyes() {
  const styles = ['classic', 'lashes', 'sleepy', 'glam', 'spiky', 'patch',
                  'dot', 'side', 'goat', 'frog', 'sunny', 'cat'];
  let pair;
  do {
    pair = shuffle(styles).slice(0, 2);
  } while (pair[0] === eyeStyles[0] && pair[1] === eyeStyles[1]);
  setEyeStyles(pair);
  markChanged();
  track('eye_style_changed', { style: 'mix' });
}

// The user picks one of the eye sets (eyeSets) for both eyes. A change to
// the scrawlface, unlike setEyeStyles on its own (also used when opening
// a saved one).
function pickEyeSet(name) {
  setEyeStyles(eyeSets[name]);
  markChanged();
  track('eye_style_changed', { style: name });
}

function setEyeStyles(styles) {
  eyeStyles = [...styles];
  updateEyeSetButtons();
  redrawCanvas();
}

// A set key is lit only while the eyes are exactly that set
function updateEyeSetButtons() {
  document.querySelectorAll('[data-eye-set]').forEach(btn => {
    const [a, b] = eyeSets[btn.dataset.eyeSet];
    const on = eyeStyles[0] === a && eyeStyles[1] === b;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on);
  });
  stateChanged();
}

function rotateCanvas() {
  rotation = (rotation + 90) % 360;
  redrawCanvas();
  markChanged();
  track('canvas_rotated', { rotation });
}

// The picture Share and Download give: the frame (frameWidth x
// frameHeight) at zoom 1, with the drawing in its rotation, its eyes and its
// scrawl visibility, whatever the zoom on screen. Always the same size.
// Returns a canvas.
function exportImage() {
  finishScrawlDrawIn();

  const g = createGraphics(frameWidth, frameHeight);
  g.pixelDensity(res);
  g.background(bgColor);
  const cx = frameWidth / 2;
  const cy = frameHeight / 2;
  g.push();
  g.translate(cx, cy);
  g.rotate(radians(rotation));
  g.imageMode(CENTER);
  g.image(drawingGraphics, 0, 0);
  if (showScrawl) g.image(baseScrawlGraphics, 0, 0);
  g.pop();

  // The eyes, as redrawCanvas places them at zoom 1
  const angle = radians(rotation);
  const turned = eyePositions.map(pos => {
    const dx = pos.x - canvasSize / 2;
    const dy = pos.y - canvasSize / 2;
    return { x: cx + dx * cos(angle) - dy * sin(angle), y: cy + dx * sin(angle) + dy * cos(angle) };
  });
  eyePositions.forEach((pos, i) => {
    const isRight = turned[i].x > turned[1 - i].x ? 1 : 0;
    drawEye(g, turned[i].x, turned[i].y, pos.scale, eyeStyles[i], isRight);
  });

  // A plain canvas to hand on; the p5 graphic is removed from the page
  const out = document.createElement('canvas');
  out.width = g.elt.width;
  out.height = g.elt.height;
  out.getContext('2d').drawImage(g.elt, 0, 0);
  g.remove();
  return out;
}

// The picture as a PNG: what Share and Download give, and what a native
// shell would hand to its own share sheet or Photos. Resolves null if the
// browser couldn't encode it.
function exportPNG() {
  return new Promise(resolve => exportImage().toBlob(resolve, 'image/png'));
}

// Saves the image as a PNG file (desktop)
function downloadImage() {
  exportPNG().then(blob => {
    if (!blob) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'scrawlface.png';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    track('scrawlface_downloaded', { from: 'canvas' });
  });
}

// Hands the image to the phone's share sheet (messages, socials, ...)
function shareImage() {
  exportPNG().then(blob => {
    if (!blob) return;
    const file = new File([blob], 'scrawlface.png', { type: 'image/png' });
    // Rejects when the share sheet is dismissed
    navigator.share({ files: [file] })
      .then(() => track('scrawlface_shared', { from: 'canvas' }))
      .catch(() => track('share_cancelled', { from: 'canvas' }));
  });
}

// ---- Swap points for a native shell ----
// Each browser-only feature goes through one function, so a native shell
// replaces one function per feature (see plans/native-shell-readiness.md).

// A short buzz: 'tap' for a key, 'hold' for a touch-and-hold. Android
// Chrome only; iPhones have no navigator.vibrate (a shell uses haptics).
function haptic(kind) {
  if (navigator.vibrate) navigator.vibrate(kind === 'hold' ? 15 : 8);
}

// Something went wrong that the user should know about
function showError(message) {
  alert(message);
}

// showError, plus an error event; where: save, open or export
function reportError(where, message) {
  track('error', { where });
  showError(message);
}

function toggleEyes() {
  showScrawl = !showScrawl;
  updateScrawlToggleButtons();
  redrawCanvas();
  markChanged();
  track('lines_hidden', { hidden: !showScrawl });
}

function togglePaint() {
  if (!hasDrawings && showPaint) return;
  showPaint = !showPaint;
  updatePaintToggleButtons();
  redrawCanvas();
  track('paint_hidden', { hidden: !showPaint });
}

// Paint on show again (if it was hidden)
function showPaintAgain() {
  if (showPaint) return;
  showPaint = true;
  updatePaintToggleButtons();
  redrawCanvas();
}

function updatePaintToggleButtons() {
  const label = showPaint ? 'Hide paint' : 'Show paint';
  document.querySelectorAll('.toggle-paint-btn').forEach(btn => { btn.textContent = label; });
  stateChanged();
}

// The buttons name what pressing them will do, rather than lighting up when
// the scrawl is hidden
function updateScrawlToggleButtons() {
  const label = showScrawl ? "Hide lines" : "Show lines";
  select("#toggle-eyes-btn").html(label);
  select("#toggle-eyes-btn-mobile").html(label);
  stateChanged();
}

// ---- Tools ----
// Exactly one tool is selected: brush, eraser, fill or eyes (drag the eyes).
function setTool(tool) {
  drawMode = tool === 'brush';
  eraseMode = tool === 'eraser';
  bucketMode = tool === 'fill';
  moveEyesMode = tool === 'eyes';
  brushSizesShown = false;

  if (drawMode || eraseMode) {
    setBrushCursor();
  } else {
    cursor(bucketMode ? CROSS : ARROW);
  }
  // Painting on paint you can't see would be guesswork
  if (tool !== 'eyes') showPaintAgain();
  updateToolButtons();
  tipForTool(tool);
}

function currentTool() {
  if (drawMode) return 'brush';
  if (eraseMode) return 'eraser';
  if (bucketMode) return 'fill';
  return 'eyes';
}

// Cursor for the brush and eraser: a ring the size the tool draws on screen
function setBrushCursor() {
  const size = eraseMode ? eraserSize : brushSize;
  // Even diameter (min 4px) so the hotspot lands on a whole pixel
  const d = max(4, 2 * round(size * viewZoom * canvas.elt.clientWidth / width / 2));
  const box = d + 4;
  const c = box / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}">` +
    `<circle cx="${c}" cy="${c}" r="${d / 2 + 1}" fill="none" stroke="white"/>` +
    `<circle cx="${c}" cy="${c}" r="${d / 2}" fill="none" stroke="black"/></svg>`;
  canvas.elt.style.cursor = `url('data:image/svg+xml,${encodeURIComponent(svg)}') ${c} ${c}, crosshair`;
}

// The canvas is the picture frame (frameWidth x frameHeight). It covers its
// container, centred, and the container masks what doesn't fit, so no empty
// space shows whatever the window's shape (the CSS reads the size from
// --canvas-width / --canvas-height). The masked edges are still part of
// the saved picture.
function fitCanvasToContainer() {
  const box = document.getElementById('scrawl-container');
  if (box.clientWidth === 0 || box.clientHeight === 0) return;

  const k = max(box.clientWidth / frameWidth, box.clientHeight / frameHeight);
  box.style.setProperty('--canvas-width', `${Math.ceil(frameWidth * k)}px`);
  box.style.setProperty('--canvas-height', `${Math.ceil(frameHeight * k)}px`);
  if (drawMode || eraseMode) setBrushCursor();
}

function clearDrawings() {
  if (!hasDrawings) return;
  showPaintAgain();

  // Save state BEFORE clearing so Clear can be undone (only the painted
  // area: it's all Clear changes). Paint that was all erased leaves nothing.
  const bounds = drawingBounds();
  if (bounds) saveState(bounds);

  drawingGraphics.clear();
  hasDrawings = false;
  disableClearButton();

  redrawCanvas();
  markChanged(true);
  track('clear_used');
}

// Enables or disables the buttons with the given ids (sidebar and mobile twins)
function setButtonsDisabled(ids, disabled) {
  ids.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = disabled;
  });
}

// Clear and Hide paint: on while there's paint
function enableClearButton() {
  setButtonsDisabled(['clear-drawings-btn', 'clear-drawings-btn-mobile', 'toggle-paint-btn', 'toggle-paint-btn-mobile'], false);
  stateChanged();
}

function disableClearButton() {
  setButtonsDisabled(['clear-drawings-btn', 'clear-drawings-btn-mobile', 'toggle-paint-btn', 'toggle-paint-btn-mobile'], true);
  showPaintAgain();
  stateChanged();
}

// startX/startY are a position on the drawing (see getTransformedCoords).
// The fill works on the unrotated, unzoomed layers, so the view doesn't matter.
// It spreads over the whole paint layer, past the scrawl square too.
function floodFill(startX, startY, fillColor) {

  finishScrawlDrawIn();

  // Max per-channel difference from the clicked colour that still counts as
  // "the same area". Absorbs the soft anti-aliased edges of lines without
  // leaking through them (measured: higher values start crossing 1px lines).
  const fillTolerance = 64;

  // Don't fill if clicking on a scrawl line. The scrawl layer is
  // transparent apart from its lines; alpha above 21 matches the old
  // "darker than near-white" test on the faint anti-aliased edges.
  const onScrawl = startX >= 0 && startX < canvasSize && startY >= 0 && startY < canvasSize;
  if (showScrawl && onScrawl &&
      baseScrawlGraphics.drawingContext.getImageData(Math.floor(startX * res), Math.floor(startY * res), 1, 1).data[3] > 21) {
    return;
  }

  // From here on, positions are pixels on the paint layer
  const N = layerPixels;
  const sx = Math.floor((startX + layerOffset) * res);
  const sy = Math.floor((startY + layerOffset) * res);
  if (sx < 0 || sx >= N || sy < 0 || sy >= N) return;

  // Build a temporary canvas of everything that bounds a fill, stacked as
  // on screen: background, drawings, then the scrawl (if shown) on top.
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = N;
  tempCanvas.height = N;
  const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

  tempCtx.fillStyle = `rgb(${bgColor.join(',')})`;
  tempCtx.fillRect(0, 0, N, N);
  tempCtx.drawImage(drawingGraphics.canvas, 0, 0);
  if (showScrawl) {
    // (rounded: a fractional offset would blur the lines)
    const offset = Math.round(layerOffset * res);
    tempCtx.drawImage(baseScrawlGraphics.canvas, offset, offset);
  }

  const data = tempCtx.getImageData(0, 0, N, N).data;

  // Target color (the color we're replacing) is whatever was clicked
  const clickIndex = (sy * N + sx) * 4;
  const targetR = data[clickIndex];
  const targetG = data[clickIndex + 1];
  const targetB = data[clickIndex + 2];

  // Convert fill color
  const fillR = parseInt(fillColor.slice(1, 3), 16);
  const fillG = parseInt(fillColor.slice(3, 5), 16);
  const fillB = parseInt(fillColor.slice(5, 7), 16);

  // Largest per-channel difference between a pixel and the target color
  const distanceFromTarget = (idx) => Math.max(
    Math.abs(data[idx] - targetR),
    Math.abs(data[idx + 1] - targetG),
    Math.abs(data[idx + 2] - targetB)
  );

  // Nothing to do if the area is already (close to) the fill color
  if (Math.max(Math.abs(fillR - targetR), Math.abs(fillG - targetG), Math.abs(fillB - targetB)) <= fillTolerance) {
    return;
  }

  // Flood fill to find all pixels to fill: a scanline fill, which takes each
  // row run in one go and only queues the start of each run above and below
  // it, so it's quick even across the whole layer on a phone. Pixels are
  // addressed by flat index (y * N + x).
  const totalPixels = N * N;
  const inRegion = new Uint8Array(totalPixels); // 1 = in the fill region, 2 = edge done
  // Most of an area is exactly the clicked colour: compare whole pixels first
  const data32 = new Uint32Array(data.buffer);
  const target32 = data32[sy * N + sx];
  const matches = (i) => !inRegion[i] &&
    (data32[i] === target32 || distanceFromTarget(i * 4) <= fillTolerance);

  const seeds = [sy * N + sx];
  const runs = [];  // [first, last] index of each row run in the region
  const edges = []; // pixels next to the region (some may join it later)
  let minX = sx, maxX = sx, minY = sy, maxY = sy;

  while (seeds.length > 0) {
    const i = seeds.pop();
    if (inRegion[i]) continue; // queued twice, already filled
    const y = (i / N) | 0;
    const rowStart = y * N;
    let l = i;
    let r = i;
    while (l > rowStart && matches(l - 1)) l--;
    while (r < rowStart + N - 1 && matches(r + 1)) r++;
    inRegion.fill(1, l, r + 1);
    runs.push(l, r);
    if (l > rowStart) edges.push(l - 1);
    if (r < rowStart + N - 1) edges.push(r + 1);

    if (l - rowStart < minX) minX = l - rowStart;
    if (r - rowStart > maxX) maxX = r - rowStart;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;

    // Queue the start of every matching run in the rows above and below;
    // the rest of those rows' pixels here are edge
    for (const dy of [-N, N]) {
      if (rowStart + dy < 0 || rowStart + dy >= totalPixels) continue;
      let inRun = false;
      for (let k = l + dy; k <= r + dy; k++) {
        if (inRegion[k]) {
          inRun = false;
        } else if (matches(k)) {
          if (!inRun) seeds.push(k);
          inRun = true;
        } else {
          edges.push(k);
          inRun = false;
        }
      }
    }
  }

  // The area the fill changes: the region plus the 1px edge ring around it
  const rect = unionRect(null, { x: minX - 1, y: minY - 1, w: maxX - minX + 3, h: maxY - minY + 3 });

  // Save state BEFORE filling - only now that we know a fill will happen
  saveState(rect);

  // Write the region into the drawing layer
  const ctx = drawingGraphics.drawingContext;
  const image = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
  const px = image.data;
  // Position of a layer pixel in `image`
  const local = (i) => {
    const x = i % N;
    return ((i - x) / N - rect.y) * rect.w + x - rect.x;
  };

  // The region: whole runs at a time (RGBA bytes read as one little-endian
  // number, so alpha is the high byte)
  const px32 = new Uint32Array(px.buffer);
  const fill32 = ((255 << 24) | (fillB << 16) | (fillG << 8) | fillR) >>> 0;
  for (let k = 0; k < runs.length; k += 2) {
    const start = local(runs[k]);
    px32.fill(fill32, start, start + runs[k + 1] - runs[k] + 1);
  }

  // The 1px ring just outside the region is the soft edge of whatever bounds it.
  // Blend the fill into those pixels, more strongly the closer they are to the
  // target color, so no white halo is left along lines but the lines stay visible.
  // This ring never spreads further, so it can't leak through a line.
  for (const j of edges) {
    if (inRegion[j]) continue; // joined the region, or already blended
    inRegion[j] = 2;
    const a = (255 - distanceFromTarget(j * 4)) / 255;
    if (a <= 0) continue;

    // Composite the fill at partial opacity over what's already drawn
    const idx = local(j) * 4;
    const existingA = px[idx + 3] / 255;
    const outA = a + existingA * (1 - a);
    px[idx] = (fillR * a + px[idx] * existingA * (1 - a)) / outA;
    px[idx + 1] = (fillG * a + px[idx + 1] * existingA * (1 - a)) / outA;
    px[idx + 2] = (fillB * a + px[idx + 2] * existingA * (1 - a)) / outA;
    px[idx + 3] = outA * 255;
  }

  ctx.putImageData(image, rect.x, rect.y);

  if (!hasDrawings) {
    hasDrawings = true;
    enableClearButton();
  }

  redrawCanvas();
}

function getComplementaryColor(color) {
  return [255 - color[0], 255 - color[1], 255 - color[2]];
}

// ---- Undo / redo (memento pattern) ----
// A memento is { x, y, w, h, img }: a copy of that rectangle of the paint
// layer (img is a canvas). Undo puts it back and keeps what it replaces as
// the redo memento, so only the changed area is ever copied.

// The smallest rectangle (in pixels on the paint layer, whole pixels)
// covering a and b, trimmed to the layer. Either may be null; null if
// nothing is left. Undo mementos and their rectangles are all in pixels.
function unionRect(a, b) {
  if (!a) a = b;
  if (!b) b = a;
  if (!a) return null;
  const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x)));
  const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y)));
  const x1 = Math.min(layerPixels, Math.ceil(Math.max(a.x + a.w, b.x + b.w)));
  const y1 = Math.min(layerPixels, Math.ceil(Math.max(a.y + a.h, b.y + b.h)));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// A memento of rect (default: the whole layer), copied from source (default:
// the paint layer; the source's corner sits at sourceX, sourceY on it)
function copyRegion(rect, source = drawingGraphics.elt, sourceX = 0, sourceY = 0) {
  const img = document.createElement('canvas');
  img.width = rect.w;
  img.height = rect.h;
  img.getContext('2d').drawImage(source, rect.x - sourceX, rect.y - sourceY, rect.w, rect.h, 0, 0, rect.w, rect.h);
  return { ...rect, img };
}

// Puts a memento back on the paint layer, replacing what's in its rectangle
function putRegion(m) {
  const ctx = drawingGraphics.drawingContext;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over'; // not the eraser's mode
  ctx.clearRect(m.x, m.y, m.w, m.h);
  ctx.drawImage(m.img, m.x, m.y);
  ctx.restore();
}

// Call BEFORE a change (fill, Clear), with the area it will change
function saveState(rect) {
  pushState(copyRegion(rect));
}

function pushState(memento) {
  historyStack.push(memento);
  trimHistory();

  // Clear redo stack when new action is performed
  redoStack = [];

  updateUndoRedoButtons();
}

// A stroke doesn't know where it will go when it starts, so the whole layer
// is copied aside (into one canvas kept for this, so it's quick), and the
// stroke's memento is cut from that copy once it's done
let strokeBackup = null;

function beginStroke() {
  if (!strokeBackup) {
    strokeBackup = document.createElement('canvas');
    strokeBackup.width = strokeBackup.height = layerPixels;
  }
  const ctx = strokeBackup.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, layerPixels, layerPixels);
  ctx.drawImage(drawingGraphics.elt, 0, 0);
  strokeBounds = null;
}

// The stroke is done: it becomes one undo step covering what it painted
// (none if it painted nothing)
function commitStroke() {
  if (strokeBounds) pushState(copyRegion(strokeBounds, strokeBackup));
}

// Takes back the stroke in progress
function restoreStrokeArea() {
  if (strokeBounds) putRegion(copyRegion(strokeBounds, strokeBackup));
  strokeBounds = null;
  hasDrawings = checkIfDrawingHasContent();
  hasDrawings ? enableClearButton() : disableClearButton();
  redrawCanvas();
}

// Drops the oldest steps once there are too many or they take too much memory
function trimHistory() {
  let pixels = historyStack.reduce((sum, m) => sum + m.w * m.h, 0);
  while (historyStack.length > 1 &&
         (historyStack.length > maxHistorySize || pixels > maxHistoryPixels)) {
    const m = historyStack.shift();
    pixels -= m.w * m.h;
  }
}

// Swaps the memento on top of `from` with that area of the layer, which
// goes on top of `to`
function swapState(from, to) {
  const m = from.pop();
  to.push(copyRegion(m));
  putRegion(m);

  // Redoing a Clear (or undoing the first mark) leaves the drawing empty
  hasDrawings = checkIfDrawingHasContent();
  hasDrawings ? enableClearButton() : disableClearButton();

  redrawCanvas();
  updateUndoRedoButtons();
  markChanged(true);
}

// Not mid-stroke: the stroke isn't a step yet, and its "before" copy
// would no longer match the layer
function undo() {
  if (historyStack.length === 0 || isDrawing) return;
  showPaintAgain();
  swapState(historyStack, redoStack);
  track('undo_used');
}

function redo() {
  if (redoStack.length === 0 || isDrawing) return;
  showPaintAgain();
  swapState(redoStack, historyStack);
  track('redo_used');
}

// Read in bands, stopping at the first paint found: reading the whole
// layer back at once is slow on a phone
function checkIfDrawingHasContent() {
  const band = 100;
  for (let y = 0; y < layerPixels; y += band) {
    const alpha = drawingGraphics.drawingContext.getImageData(0, y, layerPixels, Math.min(band, layerPixels - y)).data;
    for (let i = 3; i < alpha.length; i += 4) {
      if (alpha[i] > 0) return true;
    }
  }
  return false;
}

// The part of the paint layer that has paint on it (pixels), or null
function drawingBounds() {
  const n = layerPixels;
  const alpha = drawingGraphics.drawingContext.getImageData(0, 0, n, n).data;
  let minX = n, minY = n, maxX = -1, maxY = -1;
  for (let y = 0; y < n; y++) {
    const row = y * n * 4;
    for (let x = 0; x < n; x++) {
      if (alpha[row + x * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function updateUndoRedoButtons() {
  setButtonsDisabled(['undo-btn', 'undo-btn-mobile'], historyStack.length === 0);
  setButtonsDisabled(['redo-btn', 'redo-btn-mobile'], redoStack.length === 0);
  stateChanged();
}

function clearHistory() {
  historyStack = [];
  redoStack = [];
  updateUndoRedoButtons();
}

// The sidebar and the mobile bar share data-tool, data-size and data-color,
// so one handler drives both and their state never drifts apart.
function setupToolbar() {
  document.querySelectorAll('button[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });

  // Size keys set the size of the tool in use (they show for brush and eraser)
  document.querySelectorAll('[data-size]').forEach(btn => {
    btn.addEventListener('click', () => {
      brushSizesShown = false; // mobile: back to the colours
      const size = parseInt(btn.dataset.size);
      eraseMode ? setEraserSize(size) : setBrushSize(size);
    });
  });

  document.querySelectorAll('[data-color]').forEach(swatch => {
    swatch.addEventListener('click', () => setBrushColor(swatch.dataset.color));
  });

  // Mobile strip, brush only: the leading chip swaps between the colours
  // and the sizes (it shows the current value of the other one)
  document.getElementById('size-chip').addEventListener('click', () => {
    brushSizesShown = true;
    updateToolButtons();
  });
  document.getElementById('colour-chip').addEventListener('click', () => {
    brushSizesShown = false;
    updateToolButtons();
  });

  // Getting the picture out: Share on touch screens (the phone's share
  // sheet: Instagram, WhatsApp, Save to Photos...), Download image with a
  // mouse, where people expect a file. A touch browser that can't share
  // image files gets Download too.
  const testFile = new File([], 'scrawlface.png', { type: 'image/png' });
  const canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [testFile] }));
  const touchScreen = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const share = touchScreen && canShareFiles;
  document.querySelectorAll('.image-btn').forEach(btn => {
    btn.textContent = share ? 'Share' : 'Download image';
    btn.title = share ? 'Share the image' : 'Download as PNG';
    btn.addEventListener('click', share ? shareImage : downloadImage);
    btn.hidden = false;
  });

  // Sidebar ⋯ menu (holds the image key there). Closes on picking an item,
  // a click elsewhere or Escape.
  const moreBtn = document.getElementById('save-more-btn');
  const moreList = document.getElementById('save-more-list');
  const setMoreOpen = (open) => {
    moreList.hidden = !open;
    moreBtn.setAttribute('aria-expanded', open);
    if (open) moreList.querySelector('button:not([hidden])').focus();
  };
  moreBtn.addEventListener('click', () => setMoreOpen(moreList.hidden));
  moreList.addEventListener('click', e => {
    if (e.target.closest('button')) setMoreOpen(false);
  });
  document.addEventListener('click', e => {
    if (!moreList.hidden && !e.target.closest('.more-menu')) setMoreOpen(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !moreList.hidden) {
      setMoreOpen(false);
      moreBtn.focus();
    }
  });
}

// Brush and eraser sizes (in units; the size keys offer 4-32)
function setBrushSize(size) {
  brushSize = size;
  if (drawMode) setBrushCursor();
  updateToolButtons();
}

function setEraserSize(size) {
  eraserSize = size;
  if (eraseMode) setBrushCursor();
  updateToolButtons();
}

// The paint colour for the brush and fill (#RRGGBB)
function setBrushColor(hex) {
  brushColor = hex;
  document.querySelectorAll('[data-color]').forEach(s => {
    s.classList.toggle('selected', s.dataset.color === brushColor);
  });
  // Size dots and the mobile colour chip are drawn in the brush colour
  document.documentElement.style.setProperty('--brush-color', brushColor);
  stateChanged();
}

// Reflects the selected tool and its size on every key, and shows only the
// options that apply to it
function updateToolButtons() {
  const tool = currentTool();
  document.body.dataset.activeTool = tool;

  document.querySelectorAll('button[data-tool]').forEach(btn => {
    const on = btn.dataset.tool === tool;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on);
  });

  const size = eraseMode ? eraserSize : brushSize;
  document.querySelectorAll('[data-size]').forEach(btn => {
    btn.classList.toggle('selected', parseInt(btn.dataset.size) === size);
  });

  // Mobile size chip: a dot at the brush size (capped to fit the chip)
  const chipDot = document.querySelector('#size-chip .dot');
  const d = min(brushSize, 24) + 'px';
  chipDot.style.width = d;
  chipDot.style.height = d;

  // Sidebar option groups and strip chips: data-for lists their tools
  document.querySelectorAll('[data-for]').forEach(el => {
    el.hidden = !el.dataset.for.split(' ').includes(tool);
  });

  // Mobile strip: one row of options for the tool
  let strip = 'colours';
  if (tool === 'eyes') strip = 'eyes';
  if (tool === 'eraser' || (tool === 'brush' && brushSizesShown)) strip = 'sizes';
  document.querySelectorAll('[data-strip]').forEach(row => {
    row.hidden = row.dataset.strip !== strip;
  });
  stateChanged();
}

// Mobile bottom sheet. Collapsed it shows the options strip and the tool
// row; expanded, the less frequent controls slide up above them.
function setupMobileSheet() {
  const bar = document.getElementById('bottom-toolbar');
  const handle = document.getElementById('toggle-mobile-menu');
  const sheet = document.getElementById('mobile-expanded-menu');
  const scrim = document.getElementById('sheet-scrim');

  const setOpen = (open) => {
    bar.classList.toggle('open', open);
    scrim.classList.toggle('show', open);
    handle.setAttribute('aria-expanded', open);
    handle.setAttribute('aria-label', open ? 'Fewer options' : 'More options');
    sheet.inert = !open; // closed: its keys can't be focused or tapped
  };
  setOpen(false);

  // Tapping the handle (or Enter/Space on it) toggles the sheet
  handle.addEventListener('click', () => setOpen(!bar.classList.contains('open')));

  // A swipe up anywhere on the bar opens it and a swipe down closes it, so
  // the small handle doesn't have to be hit exactly. Swipes that start in
  // the open sheet's own content are left alone: that content scrolls.
  let start = null;
  let swiped = false;
  bar.addEventListener('pointerdown', (e) => {
    swiped = false;
    start = sheet.contains(e.target) ? null : { x: e.clientX, y: e.clientY };
  });
  bar.addEventListener('pointermove', (e) => {
    if (!start || swiped) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    // Clearly vertical, so scrolling the options strip sideways doesn't count
    if (Math.abs(dy) > 16 && Math.abs(dy) > Math.abs(dx) * 1.5) {
      swiped = true;
      setOpen(dy < 0);
    }
  });
  bar.addEventListener('pointerup', () => { start = null; });
  bar.addEventListener('pointercancel', () => { start = null; });
  // The finger may lift on the key it started on: that is the end of the
  // swipe, not a press of the key
  bar.addEventListener('click', (e) => {
    if (swiped) {
      swiped = false;
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);

  scrim.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });
  // New scribble with unsaved work asks Save / Discard first; the prompt
  // opens as the key is pressed, so the key's click (which would close the
  // sheet) never comes. Close it once the prompt is answered.
  document.getElementById('leave-dialog').addEventListener('close', () => setOpen(false));

  // Picking a tool, colour or size means "back to the canvas", and so do
  // the sheet keys marked .closes-sheet (their result shows on the canvas,
  // which the open sheet covers)
  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn === handle) return;
    if (!sheet.contains(btn) || btn.classList.contains('closes-sheet')) {
      setOpen(false);
    }
  });
}

// ---- Gallery: saved scrawlfaces and the draft ----
// Saved scrawlfaces live in IndexedDB, in this browser only. The gallery
// holds only what the user saved; the scrawlface in progress is also kept
// in a single hidden draft (while it has unsaved changes), so a reload or a
// tab the phone killed doesn't lose it. Undo history is never stored.

let galleryId = null;    // gallery entry the current scrawlface is saved as
let editVersion = 0;     // bumped on every change...
let savedVersion = 0;    // ...and copied here when saved: unsaved = they differ
// Paint (Brush, Fill, Eraser, Clear, and undoing / redoing them) is the work
// worth protecting: only unsaved paint asks Save / Discard on leaving, gets
// saved on its own and brings the Save tip. Moving or restyling the eyes,
// rotating or hiding the lines can still be saved by hand.
let paintVersion = 0;
let paintSavedVersion = 0;
let scrawlfaceToken = 0; // bumped when another scrawlface takes the canvas
let draftTimer = null;
const autoSaveMs = 5 * 60 * 1000; // see autoSave
let autoSaveTimer = null;
let dbPromise = null;
let thumbUrls = [];      // object URLs of thumbnails on screen, freed on redraw
let gallerySelection = null; // ids picked in the gallery's select mode, else null
const longPressMs = 500;     // touch: press and hold a gallery tile to start selecting

function hasUnsavedChanges() {
  return editVersion !== savedVersion;
}

function hasUnsavedPaint() {
  return paintVersion !== paintSavedVersion;
}

// Leaves the blank start (New, or opening a saved scrawlface): the create
// button goes, and the keys that need a scrawlface on the canvas come on.
// Save follows its own rule (updateGallerySaveButtons).
function leaveBlankStart() {
  document.body.classList.remove('is-blank');
  setButtonsDisabled(['rotate-btn', 'toggle-eyes-btn', 'toggle-eyes-btn-mobile',
                      'save-more-btn', 'image-btn', 'image-btn-mobile'], false);
  stateChanged();
}

function isBlankStart() {
  return document.body.classList.contains('is-blank');
}

// Runs fn(store) in one transaction; resolves with its request's result
// once the transaction has completed
function dbRequest(storeName, mode, fn) {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('scrawlface', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('gallery', { keyPath: 'id' });
        req.result.createObjectStore('draft'); // one record, key 'current'
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise.then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  }));
}

function canvasToBlob(canvasEl, type) {
  return new Promise(resolve => canvasEl.toBlob(resolve, type, 0.85));
}

// The scrawl layer as a PNG. It doesn't change while a scrawlface is being
// worked on, so it's encoded once (per scrawlVersion) instead of on every
// draft and save.
let scrawlVersion = 0; // bumped whenever the scrawl layer is replaced
let scrawlBlobCache = null; // { version, blob: Promise }

function scrawlBlob() {
  if (!scrawlBlobCache || scrawlBlobCache.version !== scrawlVersion) {
    scrawlBlobCache = { version: scrawlVersion, blob: canvasToBlob(baseScrawlGraphics.elt, 'image/png') };
  }
  return scrawlBlobCache.blob;
}

// Everything needed to carry on with the current scrawlface. The layers are
// read when this is called, so changes made while it encodes aren't mixed in.
async function captureScrawlface(withThumb) {
  finishScrawlDrawIn();
  const record = {
    scrawl: scrawlBlob(),
    drawing: canvasToBlob(drawingGraphics.elt, 'image/png'),
    eyes: eyePositions.map(pos => ({ ...pos })),
    eyeStyles: [...eyeStyles],
    showScrawl,
    rotation,
    updatedAt: Date.now()
  };
  if (withThumb) {
    // The square middle of what Share sends (the scrawl square, for the
    // square gallery tiles), scaled down
    const image = exportImage();
    const thumb = document.createElement('canvas');
    thumb.width = thumb.height = 320; // sharp on a 2x phone screen
    const ctx = thumb.getContext('2d');
    ctx.imageSmoothingQuality = 'high'; // keeps the 1px lines from breaking up
    ctx.drawImage(image, 0, (image.height - image.width) / 2, image.width, image.width, 0, 0, 320, 320);
    record.thumb = canvasToBlob(thumb, 'image/jpeg');
  }
  for (const key of ['scrawl', 'drawing', 'thumb']) {
    if (record[key]) record[key] = await record[key];
  }
  return record;
}

// Draws a saved layer image onto a layer `size` units wide, centred.
// Scrawlfaces saved before the layers had res pixels per unit have one
// pixel per unit (and, older still, a canvasSize drawing): those are
// scaled up; newer ones come back pixel for pixel.
function drawSavedLayer(g, img, size) {
  const k = img.width > size ? res : 1; // pixels per unit in the image
  const w = img.width / k;
  const h = img.height / k;
  // The layer's context draws in units (p5 scales it by res)
  g.drawingContext.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
}

// Puts a saved scrawlface (or the draft) on the canvas, as if just opened:
// whole view, Eyes tool, empty undo history
async function restoreScrawlface(record) {
  const [scrawl, drawing] = await Promise.all([
    createImageBitmap(record.scrawl),
    createImageBitmap(record.drawing)
  ]);

  scrawlQueue = [];
  baseScrawlGraphics.clear();
  scrawlVersion++;
  drawSavedLayer(baseScrawlGraphics, scrawl, canvasSize);
  drawingGraphics.clear();
  drawSavedLayer(drawingGraphics, drawing, layerSize);

  eyePositions = record.eyes.map(pos => ({ ...pos }));
  setEyeStyles(record.eyeStyles);
  showScrawl = record.showScrawl;
  updateScrawlToggleButtons();
  showPaintAgain();
  rotation = record.rotation;
  viewZoom = 1;
  viewPan = { x: 0, y: 0 };

  isDrawing = false;
  pressChangedDrawing = false;
  draggedEyeIndex = -1;
  setTool('eyes');
  clearHistory();
  hasDrawings = checkIfDrawingHasContent();
  hasDrawings ? enableClearButton() : disableClearButton();

  leaveBlankStart();
  redrawCanvas();
}

// Called after every change to the scrawlface: it now has unsaved changes,
// and the draft is written once the changes settle
// paint: the change is to the paint (see paintVersion)
function markChanged(paint = false) {
  if (isBlankStart()) return;
  editVersion++;
  if (paint) paintVersion++;
  updateGallerySaveButtons();
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 1000);
  if (!autoSaveTimer && hasUnsavedPaint()) autoSaveTimer = setTimeout(autoSave, autoSaveMs);
  tipSave();
}

// Long sessions are saved to My Scrawls on their own: 5 minutes after the
// first unsaved change, and again 5 minutes after the next one, so unsaved
// work is never older than that. Quick shuffles with New never get there.
function autoSave() {
  autoSaveTimer = null;
  if (isBlankStart() || !hasUnsavedPaint()) return;
  saveToGallery('auto').catch(() => {}); // the draft still has the work
}

// Called when the scrawlface was saved or replaced: the 5 minutes start
// again from its next change (or now, if it still has unsaved changes)
function restartAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = hasUnsavedPaint() ? setTimeout(autoSave, autoSaveMs) : null;
}

async function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = null;
  if (!hasUnsavedChanges()) return;
  const token = scrawlfaceToken;
  const record = await captureScrawlface(false);
  // Saved, discarded or replaced while encoding: this draft is stale
  if (token !== scrawlfaceToken || !hasUnsavedChanges()) return;
  record.galleryId = galleryId;
  await dbRequest('draft', 'readwrite', store => store.put(record, 'current')).catch(() => {});
}

// The scrawlface on the canvas is now saved, or replaced by another one
function forgetDraft() {
  clearTimeout(draftTimer);
  draftTimer = null;
  dbRequest('draft', 'readwrite', store => store.delete('current')).catch(() => {});
}

// Saves run one after another: two at once (a double tap on Save, or
// Save during an autosave) would both see galleryId unset and make two
// entries. The second one then updates the entry the first one made.
let saveQueue = Promise.resolve();
// trigger: what asked for the save (button, auto, leave_prompt, my_scrawls),
// for the scrawlface_saved event
function saveToGallery(trigger = 'button') {
  const next = saveQueue.then(() => saveToGalleryNow(trigger));
  saveQueue = next.catch(() => {}); // a failed save doesn't block later ones
  return next;
}

async function saveToGalleryNow(trigger = 'button') {
  if (isBlankStart()) return;
  dismissTip('save');
  const version = editVersion;
  const paint = paintVersion;
  const token = scrawlfaceToken;
  const record = await captureScrawlface(true);
  if (token !== scrawlfaceToken) return;
  const firstSave = !galleryId;
  record.id = galleryId || Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  await dbRequest('gallery', 'readwrite', store => store.put(record));
  galleryId = record.id;
  track('scrawlface_saved', {
    trigger,
    first_save: firstSave,
    seconds_since_generated: scrawlfaceStats.generatedAt === null ? null
      : Math.round((performance.now() - scrawlfaceStats.generatedAt) / 1000),
    tools_used: [...scrawlfaceStats.tools],
    strokes: scrawlfaceStats.strokes,
    fills: scrawlfaceStats.fills
  });
  savedVersion = version;
  paintSavedVersion = paint;
  if (!hasUnsavedChanges()) forgetDraft();
  restartAutoSave();
  updateGallerySaveButtons();
  flashSaved();
}

// Save is offered for a scrawlface that was never saved, or that changed
// since it was
function updateGallerySaveButtons() {
  const canSave = !isBlankStart() && (galleryId === null || hasUnsavedChanges());
  document.querySelectorAll('.gallery-save-btn').forEach(btn => {
    btn.disabled = !canSave;
  });
  stateChanged();
}

function flashSaved() {
  document.querySelectorAll('.gallery-save-btn').forEach(btn => {
    btn.textContent = 'Saved';
    clearTimeout(btn.savedTimer);
    btn.savedTimer = setTimeout(() => { btn.textContent = 'Save'; }, 1500);
  });
}

// Leaving a scrawlface with unsaved changes (New, or opening another one)
// asks first: Save, Discard or Cancel. Resolves true to go ahead.
// Only unsaved paint asks (see paintVersion); other changes go quietly.
function confirmLeave() {
  if (isBlankStart() || !hasUnsavedPaint()) return Promise.resolve(true);
  // No storage, so nothing to save to
  if (document.body.classList.contains('no-storage')) {
    const go = confirm('Start a new scribble? Your drawing will be lost.');
    track('leave_prompt_answered', { answer: go ? 'discard' : 'cancel' });
    return Promise.resolve(go);
  }
  const dialog = document.getElementById('leave-dialog');
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise(resolve => {
    dialog.addEventListener('close', async () => {
      track('leave_prompt_answered', { answer: dialog.returnValue || 'cancel' });
      if (dialog.returnValue === 'save') {
        // If saving fails, stay: going ahead would lose the work
        try {
          await saveToGallery('leave_prompt');
          resolve(true);
        } catch (e) {
          reportError('save', 'Sorry, this scrawlface couldn\'t be saved.');
          resolve(false);
        }
      } else {
        resolve(dialog.returnValue === 'discard'); // '' = Esc or backdrop
      }
    }, { once: true });
  });
}

// New scribble from the keys and the N shortcut: asks first if needed.
// source: where it was asked for (see generateScrawlface).
async function requestNewScrawl(source = 'other') {
  if (await confirmLeave()) generateScrawlface(source);
}

async function openFromGallery(id) {
  if (!(await confirmLeave())) return;
  const record = await dbRequest('gallery', 'readonly', store => store.get(id));
  if (!record) return;
  // restoreScrawlface decodes the images before it changes anything, so
  // if they're damaged the current scrawlface (and its draft) stay put
  try {
    await restoreScrawlface(record);
  } catch (e) {
    reportError('open', 'Sorry, this scrawlface couldn\'t be opened.');
    return;
  }
  scrawlfaceToken++;
  forgetDraft();
  startScrawlfaceStats(false);
  track('scrawlface_reopened');
  galleryId = record.id;
  savedVersion = editVersion;
  paintSavedVersion = paintVersion;
  restartAutoSave();
  updateGallerySaveButtons();
  document.getElementById('gallery-dialog').close();
  try { localStorage.setItem('createdScrawlface', '1'); } catch (e) {}
}

// Saved scrawlfaces, most recently saved first
async function listGallery() {
  const records = await dbRequest('gallery', 'readonly', store => store.getAll());
  return records.sort((a, b) => b.updatedAt - a.updatedAt);
}

function thumbImage(record) {
  const url = URL.createObjectURL(record.thumb);
  thumbUrls.push(url);
  const img = document.createElement('img');
  img.src = url;
  img.alt = 'Saved scrawlface';
  img.draggable = false; // a mouse press-and-hold would start a drag instead
  return img;
}

// Redraws the gallery grid and the pile of recents on the blank start
async function renderGallery() {
  const records = await listGallery();
  thumbUrls.forEach(url => URL.revokeObjectURL(url));
  thumbUrls = [];

  const grid = document.getElementById('gallery-grid');
  grid.replaceChildren(...records.map(record => {
    const item = document.createElement('li');
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'gallery-tile';
    tile.dataset.id = record.id;
    tile.append(thumbImage(record));

    // The tick circle picks / unpicks this one, starting select mode on
    // the first pick: works the same with a mouse, a finger or the keyboard
    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'gallery-check';
    check.dataset.id = record.id;
    check.setAttribute('aria-label', 'Select');
    check.addEventListener('click', () => toggleGalleryPick(record.id));

    // Touch shortcut, as in phone photo galleries: press and hold to pick
    addLongPress(tile, () => {
      if (!gallerySelection || !gallerySelection.has(record.id)) toggleGalleryPick(record.id);
      haptic('hold');
    });
    // A tap opens it, or in select mode picks / unpicks it
    tile.addEventListener('click', () => {
      if (gallerySelection) {
        toggleGalleryPick(record.id);
      } else {
        openFromGallery(record.id);
      }
    });
    item.append(tile, check);
    return item;
  }));
  // First tile: start a new scrawlface from here, without going back to the
  // sidebar or the sheet (disabled while selecting). Empty: that tile (or
  // "Save this scrawlface", with one on the canvas), then the example and a
  // line on what goes here.
  if (records.length > 0) {
    grid.prepend(newScrawlTile());
  } else {
    const note = document.createElement('li');
    note.className = 'gallery-note subtitle';
    note.textContent = 'Your saved scrawlfaces show up here.';
    grid.append(isBlankStart() ? newScrawlTile() : saveThisTile(), exampleTile(), note);
  }
  updateGallerySelection();

  // Blank start: the latest three as a pile of prints (newest last, on
  // top) and the count; the pile opens My Scrawls (.gallery-open-btn)
  const recents = document.getElementById('recents');
  document.getElementById('recents-list').replaceChildren(...records.slice(0, 3).reverse().map(thumbImage));
  const count = records.length === 1 ? '1 scrawlface' : `${records.length} scrawlfaces`;
  document.getElementById('recents-label').textContent = `My Scrawls · ${records.length}`;
  recents.setAttribute('aria-label', `My Scrawls, ${count}`);
  recents.hidden = records.length === 0;
}

// A gallery tile that does something rather than open a saved scrawlface:
// an icon and a label in the primary colour (see .gallery-action-tile)
function actionTile(icon, label, onClick) {
  const item = document.createElement('li');
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'gallery-tile gallery-action-tile';
  tile.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icon + '</svg>';
  tile.append(label);
  tile.addEventListener('click', onClick);
  item.append(tile);
  return item;
}

// "New scribble": back to the canvas with a new scribble, asking to save
// unsaved paint first (requestNewScrawl). The same icon as the New keys.
function newScrawlTile() {
  const item = actionTile('<path d="M5 14.5c-2-4 1-9 5-9s5 6 2 8-5-2-2-5 8-3 10 1-1 8-5 8"/>', 'New scribble', () => {
    document.getElementById('gallery-dialog').close();
    requestNewScrawl('my_scrawls');
  });
  item.firstChild.classList.add('gallery-new-tile'); // off while selecting
  return item;
}

// "Save this scrawlface" (empty gallery, a scrawlface on the canvas): saves
// it, so its thumbnail shows up right here. The My Scrawls icon.
function saveThisTile() {
  return actionTile('<path d="M8.2 4.1c3.7-.6 7.4-.5 11.1-.1.5 3.6.4 7.2-.1 10.8"/>' +
    '<path d="M3.8 7.6c3.9-.6 7.9-.5 11.8 0 .4 4.1.3 8.2-.2 12.3-3.8.4-7.6.3-11.3-.2-.5-4-.6-8.1-.1-12.6"/>' +
    '<path d="M6.4 16.4c.3-2.8 2.1-5 3.6-4.5 1.4.5-.5 3.6.9 3.9 1.2.2 1.6-2.2 2.6-1.6"/>', 'Save this scrawlface', () => {
    saveToGallery('my_scrawls')
      .then(renderGallery)
      .catch(() => reportError('save', 'Sorry, this scrawlface couldn\'t be saved.'));
  });
}

// ---- The example scrawlface ----
// An empty My Scrawls shows one finished scrawlface (bundled in examples/,
// so it works offline) to show what goes here. Tapping it opens a copy on
// the canvas to play with; the example itself never changes. It steps aside
// once anything is saved.
const exampleDir = 'examples/fox/';

function exampleTile() {
  const item = document.createElement('li');
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'gallery-tile gallery-example-tile';
  const img = document.createElement('img');
  img.src = exampleDir + 'thumb.jpg';
  img.alt = 'Example scrawlface';
  img.draggable = false;
  const tag = document.createElement('span');
  tag.className = 'gallery-example-tag';
  tag.textContent = 'Example';
  tile.append(img, tag);
  tile.addEventListener('click', openExample);
  item.append(tile);
  return item;
}

// A copy of the example on the canvas: a new scrawlface, not in My Scrawls
// and with nothing unsaved until it's changed
async function openExample() {
  if (!(await confirmLeave())) return;
  const get = async (file, as) => {
    const response = await fetch(exampleDir + file);
    if (!response.ok) throw new Error(file);
    return response[as]();
  };
  try {
    const [meta, scrawl, drawing] = await Promise.all([
      get('scrawlface.json', 'json'), get('scrawl.png', 'blob'), get('drawing.png', 'blob')
    ]);
    await restoreScrawlface({ ...meta, scrawl, drawing });
  } catch (e) {
    reportError('open', 'Sorry, the example couldn\'t be opened.');
    return;
  }
  scrawlfaceToken++;
  forgetDraft();
  startScrawlfaceStats(false);
  galleryId = null;
  savedVersion = editVersion;
  paintSavedVersion = paintVersion;
  restartAutoSave();
  updateGallerySaveButtons();
  document.getElementById('gallery-dialog').close();
  track('example_opened');
}

function openGallery() {
  renderGallery();
  document.getElementById('gallery-dialog').showModal();
  listGallery().then(records => track('my_scrawls_opened', { count: records.length })).catch(() => {});
}

// Picks or unpicks one gallery tile. The first pick starts select mode;
// unpicking the last one ends it.
function toggleGalleryPick(id) {
  if (!gallerySelection) gallerySelection = new Set();
  if (gallerySelection.has(id)) {
    gallerySelection.delete(id);
  } else {
    gallerySelection.add(id);
  }
  if (gallerySelection.size === 0) gallerySelection = null;
  updateGallerySelection();
}

// Calls onLongPress when a finger presses and holds the element (touch
// only: a mouse picks with the tick circle). Moving the finger (scrolling)
// cancels it, and the click that ends a long press is swallowed so it
// doesn't also tap.
function addLongPress(el, onLongPress) {
  let timer = null;
  let start = null;
  let fired = false;
  const cancel = () => {
    clearTimeout(timer);
    start = null;
  };
  el.addEventListener('pointerdown', e => {
    fired = false;
    if (e.pointerType !== 'touch') return;
    start = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => {
      fired = true;
      onLongPress();
    }, longPressMs);
  });
  el.addEventListener('pointermove', e => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
  });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
  // No browser menu ("Save image" etc.) on a long press
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('click', e => {
    if (fired) {
      fired = false;
      e.stopImmediatePropagation();
    }
  });
}

// Select mode (started from a tick circle, or a long press on touch): taps
// pick tiles, and Delete removes the picked ones. The header swaps Close
// for Cancel / Delete (n).
function setGallerySelecting(on) {
  gallerySelection = on ? new Set() : null;
  updateGallerySelection();
}

function updateGallerySelection() {
  const dialog = document.getElementById('gallery-dialog');
  const selecting = gallerySelection !== null;
  const count = selecting ? gallerySelection.size : 0;
  dialog.classList.toggle('selecting', selecting);
  dialog.querySelectorAll('.gallery-tile').forEach(tile => {
    tile.classList.toggle('selected', selecting && gallerySelection.has(tile.dataset.id));
  });
  dialog.querySelectorAll('.gallery-check').forEach(check => {
    check.setAttribute('aria-pressed', selecting && gallerySelection.has(check.dataset.id));
  });
  // The New scrawl tile stays in place while selecting (so the tiles don't
  // shift), but is disabled: it isn't something to select or delete
  dialog.querySelectorAll('.gallery-new-tile').forEach(tile => { tile.disabled = selecting; });
  document.getElementById('gallery-title').textContent =
    selecting ? `${count} selected` : 'My Scrawls';
  const del = document.getElementById('gallery-delete');
  del.disabled = count === 0;
  del.textContent = count ? `Delete (${count})` : 'Delete';
}

// Asks to delete the picked scrawlfaces. Resolves true for Delete; Cancel,
// Esc and the backdrop resolve false.
function confirmDelete(count) {
  const dialog = document.getElementById('delete-dialog');
  document.getElementById('delete-title').textContent =
    count === 1 ? 'Delete this scrawlface?' : `Delete these ${count} scrawlfaces?`;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'delete'), { once: true });
  });
}

async function deleteSelected() {
  const ids = [...gallerySelection];
  if (!ids.length || !(await confirmDelete(ids.length))) return;
  await dbRequest('gallery', 'readwrite', store => {
    let req;
    ids.forEach(id => { req = store.delete(id); });
    return req;
  });
  track('scrawlface_deleted', { count: ids.length });
  // The open scrawlface was one of them: a later Save makes a new entry
  if (ids.includes(galleryId)) {
    galleryId = null;
    updateGallerySaveButtons();
  }
  gallerySelection = null;
  renderGallery();
}

function setupGallery() {
  document.querySelectorAll('.gallery-save-btn').forEach(btn => btn.addEventListener('click', () => {
    saveToGallery('button').catch(() => reportError('save', 'Sorry, this scrawlface couldn\'t be saved.'));
  }));
  document.querySelectorAll('.gallery-open-btn').forEach(btn => btn.addEventListener('click', openGallery));
  document.getElementById('gallery-close').addEventListener('click', () => {
    document.getElementById('gallery-dialog').close();
  });
  document.getElementById('gallery-cancel').addEventListener('click', () => setGallerySelecting(false));
  document.getElementById('gallery-delete').addEventListener('click', deleteSelected);
  // Closing (Close, Esc, backdrop) always leaves Select mode
  document.getElementById('gallery-dialog').addEventListener('close', () => setGallerySelecting(false));
  // Tapping the dimmed backdrop closes a dialog, like Esc (the click lands
  // on the dialog itself only outside its content)
  ['leave-dialog', 'delete-dialog', 'gallery-dialog'].forEach(id => {
    const dialog = document.getElementById(id);
    dialog.addEventListener('click', e => {
      if (e.target === dialog) dialog.close();
    });
  });
  updateGallerySaveButtons();

  // Write the draft straight away when the page is hidden: the phone may
  // kill the tab after that
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && draftTimer) saveDraft();
  });

  // Without IndexedDB (or if it fails to open) the app works as before,
  // just without Save and the gallery
  if (!window.indexedDB) {
    document.body.classList.add('no-storage');
    return;
  }
  dbRequest('draft', 'readonly', store => store.get('current'))
    .then(async draft => {
      // Unsaved work from last time (a reload, or a tab the phone killed)
      if (draft && isBlankStart()) {
        try {
          await restoreScrawlface(draft);
          startScrawlfaceStats(false);
          track('draft_restored');
          galleryId = draft.galleryId;
          editVersion = savedVersion + 1;
          if (hasDrawings) paintVersion = paintSavedVersion + 1;
          restartAutoSave();
          updateGallerySaveButtons();
        } catch (e) {
          // Damaged: drop it, or it would fail on every visit
          forgetDraft();
        }
      }
      renderGallery();
    })
    .catch(() => document.body.classList.add('no-storage'));
}

// ---- Onboarding: Understand -> Discover -> Learn -> Experience ----
// An intro (three screens) on first launch, a help key to replay it or step
// through tips on the controls, and one-off tips when a feature first
// matters. See plans/onboarding.md. Progress is kept in localStorage:
// onboarding_completed / onboarding_skipped hold the intro version
// completed / skipped, onboarding_version_seen the highest version shown,
// and tips_seen the one-off tips already shown. Raising ONBOARDING_VERSION
// shows the intro once more to everyone. Nothing shows in canvas-only mode
// (a native shell does its own onboarding, with the same state).
const ONBOARDING_VERSION = 1;

// Not a drawing tutorial: an invitation to find the unexpected in random
// lines. Three screens, each with its own key; the last one brings the
// first scribble (and its tip, see tipFirstScrawl).
const introScreens = [
  { step: 'Look closer', art: 'reveal', title: 'Train your imagination.',
    text: 'Find faces, creatures and characters hiding in every scribble.', next: 'Let\'s look' },
  { step: 'Make it yours', art: 'example', title: 'Every scribble holds a possibility.',
    text: 'Explore the canvas, spot a face, and add your own details.', next: 'Show me' },
  { step: 'Find something unexpected', art: 'mystery', title: 'Your first scribble is waiting.',
    text: 'Look closely. What do you see?', next: 'Surprise me!' }
];

function storageGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch (e) {}
}

function isEmbedded() {
  return document.documentElement.classList.contains('embedded');
}

function isTouchScreen() {
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

function onboardingState() {
  let tipsSeen = [];
  try { tipsSeen = JSON.parse(storageGet('tips_seen')) || []; } catch (e) {}
  return {
    version: ONBOARDING_VERSION,
    completed: parseInt(storageGet('onboarding_completed')) || 0,
    skipped: parseInt(storageGet('onboarding_skipped')) || 0,
    versionSeen: parseInt(storageGet('onboarding_version_seen')) || 0,
    tipsSeen
  };
}

// outcome: 'completed' or 'skipped'
function markOnboarding(outcome) {
  storageSet('onboarding_' + outcome, ONBOARDING_VERSION);
  markIntroSeen();
}

function markIntroSeen() {
  storageSet('onboarding_version_seen', Math.max(onboardingState().versionSeen, ONBOARDING_VERSION));
}

function markTipSeen(id) {
  const seen = onboardingState().tipsSeen;
  if (!seen.includes(id)) storageSet('tips_seen', JSON.stringify([...seen, id]));
}

// Clears all of it (as if the app had never been opened)
function resetOnboarding() {
  ['onboarding_completed', 'onboarding_skipped', 'onboarding_version_seen', 'tips_seen']
    .forEach(key => { try { localStorage.removeItem(key); } catch (e) {} });
}

function setupOnboarding() {
  if (isEmbedded()) return;
  setupHelp();
  setupIntro();
  setupCoach();

  // First launch of this version of the intro: show it. People who made a
  // scrawlface before onboarding existed get a tip on the help key instead.
  const state = onboardingState();
  if (Math.max(state.completed, state.skipped) >= ONBOARDING_VERSION) return;
  const createdBefore = storageGet('createdScrawlface') === '1';
  if (createdBefore && state.versionSeen === 0) {
    setTimeout(() => showTip('help-key', { el: document.getElementById('help-btn') },
      'New: Take a quick tour or explore tool tips whenever you need them.'), 800);
    return;
  }
  openIntro('first_launch');
}

// -- Help key and menu --

function setupHelp() {
  const btn = document.getElementById('help-btn');
  const menu = document.getElementById('help-menu');
  btn.addEventListener('click', () => (menu.hidden ? openHelpMenu() : closeHelpMenu()));
  document.getElementById('help-tour').addEventListener('click', () => {
    closeHelpMenu();
    openIntro('help_menu');
  });
  document.getElementById('help-explore').addEventListener('click', () => {
    closeHelpMenu();
    exploreFeatures();
  });
  document.addEventListener('click', e => {
    if (!menu.hidden && !e.target.closest('#help-menu, #help-btn')) closeHelpMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !menu.hidden) {
      closeHelpMenu();
      btn.focus();
    }
  });
  window.addEventListener('resize', () => { if (!menu.hidden) placeHelpMenu(); });
}

function openHelpMenu() {
  dismissTip('help-key');
  const menu = document.getElementById('help-menu');
  menu.hidden = false;
  placeHelpMenu();
  document.getElementById('help-btn').setAttribute('aria-expanded', 'true');
  menu.querySelector('button').focus();
}

function closeHelpMenu() {
  document.getElementById('help-menu').hidden = true;
  document.getElementById('help-btn').setAttribute('aria-expanded', 'false');
}

// Under the help key, right edges lined up
function placeHelpMenu() {
  const r = document.getElementById('help-btn').getBoundingClientRect();
  const menu = document.getElementById('help-menu');
  menu.style.top = `${r.bottom + 8}px`;
  menu.style.right = `${Math.max(12, innerWidth - r.right)}px`;
}

// -- Intro --

let introIndex = 0;
let introStart = 0;      // when the screen on show started (ms)
let introFrame = null;   // requestAnimationFrame id
let introArt = null;     // p5 graphic the illustrations are drawn on (800 units)
let introScene = null;   // the scribble and eyes the generated illustrations use
let introRound = 0;      // screens that repeat: which round is on show

function setupIntro() {
  const dialog = document.getElementById('intro-dialog');
  document.getElementById('intro-next').addEventListener('click', () => {
    if (introIndex < introScreens.length - 1) {
      slideIntro(introIndex + 1);
    } else {
      finishIntro('completed');
    }
  });
  document.getElementById('intro-back').addEventListener('click', () => {
    if (introIndex > 0) slideIntro(introIndex - 1);
  });
  document.getElementById('intro-skip').addEventListener('click', () => finishIntro('skipped'));
  // Esc skips
  dialog.addEventListener('cancel', e => {
    e.preventDefault();
    finishIntro('skipped');
  });
  dialog.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' && introIndex < introScreens.length - 1) slideIntro(introIndex + 1);
    if (e.key === 'ArrowLeft' && introIndex > 0) slideIntro(introIndex - 1);
  });
  setupIntroSwipe(dialog);
  const dots = document.getElementById('intro-dots');
  dots.replaceChildren(...introScreens.map(() => document.createElement('span')));
}

// Swipe like a carousel: the screen follows the finger, then slides on to
// the next one (or back into place). Left for the next screen, right for
// the one before; past the first or last it only gives a little. A swipe
// on the last screen doesn't finish the intro (only its key does).
function setupIntroSwipe(dialog) {
  const slide = document.getElementById('intro-slide');
  let start = null;    // { x, y, t } of the touch
  let dragging = false;
  let last = null;     // recent { x, t }, for the flick speed
  let dx = 0;

  const offset = () => {
    // Nothing that way: resist, like a rubber band
    const blocked = (dx < 0 && introIndex === introScreens.length - 1) || (dx > 0 && introIndex === 0);
    return blocked ? dx * 0.25 : dx;
  };

  dialog.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || introSliding) return;
    start = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    last = { x: e.clientX, t: e.timeStamp };
    dragging = false;
    dx = 0;
  });
  dialog.addEventListener('pointermove', e => {
    if (!start) return;
    dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!dragging) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dx) < Math.abs(dy)) { start = null; return; } // a scroll
      dragging = true;
      dialog.setPointerCapture(e.pointerId);
      slide.getAnimations().forEach(a => a.cancel());
    }
    const o = offset();
    slide.style.transform = `translateX(${o}px)`;
    slide.style.opacity = 1 - Math.min(Math.abs(o) / slide.offsetWidth, 1) * 0.5;
    if (e.timeStamp - last.t > 30) last = { x: e.clientX, t: e.timeStamp, prev: last };
  });
  const end = e => {
    if (!start) return;
    const wasDragging = dragging;
    start = null;
    dragging = false;
    if (!wasDragging) return;
    // A quick flick counts even if it's short
    const ref = last.prev || last;
    const speed = (e.clientX - ref.x) / Math.max(e.timeStamp - ref.t, 1); // px per ms
    const far = Math.abs(dx) > slide.offsetWidth * 0.25;
    const flick = Math.abs(speed) > 0.4 && Math.sign(speed) === Math.sign(dx);
    const target = introIndex + (dx < 0 ? 1 : -1);
    const go = e.type === 'pointerup' && (far || flick) && target >= 0 && target < introScreens.length;
    if (go) {
      slideIntro(target, offset());
    } else {
      // Back into place
      const from = slide.style.transform;
      const fromOpacity = slide.style.opacity;
      slide.style.transform = '';
      slide.style.opacity = '';
      slide.animate([{ transform: from, opacity: fromOpacity }, { transform: 'none', opacity: 1 }],
        { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    }
  };
  dialog.addEventListener('pointerup', end);
  dialog.addEventListener('pointercancel', end);
}

let introSliding = false;

// Moves to screen i with a slide: the one on show leaves the way it's going
// (from `from` px, where a swipe left it), the next comes in from the other
// side. From a key, the screen changes straight away and the new one slides in.
async function slideIntro(i, from = null) {
  const slide = document.getElementById('intro-slide');
  const dir = i > introIndex ? 1 : -1; // 1: forwards, content moves left
  const w = slide.offsetWidth;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  slide.getAnimations().forEach(a => a.cancel());
  slide.style.transform = '';
  slide.style.opacity = '';
  if (reduced) {
    showIntroScreen(i);
    return;
  }
  if (from !== null) {
    // Finish the swipe: off the side, quickly
    introSliding = true;
    const startOpacity = 1 - Math.min(Math.abs(from) / w, 1) * 0.5;
    await slide.animate([{ transform: `translateX(${from}px)`, opacity: startOpacity },
      { transform: `translateX(${-dir * w}px)`, opacity: 0 }],
      { duration: 140, easing: 'ease-in', fill: 'forwards' }).finished.catch(() => {});
    introSliding = false;
    if (!introOpen()) return;
  }
  showIntroScreen(i);
  slide.getAnimations().forEach(a => a.cancel());
  slide.animate([{ transform: `translateX(${dir * w * 0.6}px)`, opacity: 0 },
    { transform: 'none', opacity: 1 }],
    { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
}

function introOpen() {
  return document.getElementById('intro-dialog').open;
}

// source: first_launch, help_menu, or other (a shell)
function openIntro(source = 'other') {
  if (isEmbedded() || introOpen()) return;
  track('onboarding_started', { source });
  closeHelpMenu();
  hideCoach('end');
  introScene = makeIntroScene();
  loadTourExample();
  markIntroSeen();
  showIntroScreen(0);
  document.getElementById('intro-dialog').showModal();
  introFrame = requestAnimationFrame(animateIntro);
}

function finishIntro(outcome) {
  markOnboarding(outcome);
  track('onboarding_' + outcome, outcome === 'skipped' ? { at_step: introIndex + 1 } : {});
  cancelAnimationFrame(introFrame);
  document.getElementById('intro-dialog').close();
  // The last key creates the first scribble
  if (outcome === 'completed' && isBlankStart()) requestNewScrawl('tour');
}

function showIntroScreen(i) {
  introIndex = i;
  introStart = performance.now();
  introRound = 0;
  // A fresh scribble for the screens that draw one in again
  if (introScene && i > 0) introScene = makeIntroScene();
  const screen = introScreens[i];
  const last = i === introScreens.length - 1;
  document.getElementById('intro-step').textContent = `0${i + 1} · ${screen.step}`;
  document.getElementById('intro-title').textContent = screen.title;
  document.getElementById('intro-text').textContent = screen.text;
  document.querySelectorAll('#intro-dots span').forEach((dot, k) => dot.classList.toggle('on', k === i));
  document.getElementById('intro-back').style.visibility = i === 0 ? 'hidden' : '';
  // Replayed over a scrawlface, the last key just closes the tour
  document.getElementById('intro-next').textContent = last && !isBlankStart() ? 'Done' : screen.next;
}

// The illustrations' material: one scribble, and where the eyes go
function makeIntroScene() {
  if (!introArt) {
    introArt = createGraphics(canvasSize, canvasSize);
    introArt.pixelDensity(0.6);
    introArt.elt.style.display = '';
    document.getElementById('intro-art').append(introArt.elt);
  }
  const segments = scrawlSegments(9);
  fitScrawlToCanvas(segments);
  return { segments, eyes: [{ x: 335, y: 340, scale: 1 }, { x: 470, y: 330, scale: 0.9 }] };
}

// Draws one moment of a generated illustration. Each part goes from 0 (not
// there) to 1 (all there): lines (the scribble drawing itself in), eyes
// (popping in, one after the other).
function drawIntroArt(g, scene, { lines = 1, eyes = 0 }) {
  g.clear();
  g.background(255);
  g.push();
  const n = Math.ceil(scene.segments.length * lines);
  g.noFill();
  g.stroke(0);
  g.strokeWeight(2.5);
  scene.segments.slice(0, n).forEach(seg => g.bezier(...seg));
  g.pop();
  scene.eyes.forEach((eye, k) => {
    const pop = popIn(eyes * 1.5 - k * 0.5);
    if (pop > 0.01) drawEye(g, eye.x, eye.y, eye.scale * pop, 'classic', k);
  });
}

// 0 to 1, fast then gently: how the eyes pop in
function popIn(x) {
  return 1 - Math.pow(1 - constrain(x, 0, 1), 3);
}

// Screen 02's illustration: a real scrawlface made in the app (bundled in
// examples/tour/, like a saved one: its lines, its paint, its eyes and
// rotation). Loaded when the tour opens; blank until it has.
const tourExampleDir = 'examples/tour/';
let tourExample = null;

function loadTourExample() {
  if (tourExample) return;
  tourExample = { ready: false };
  const image = file => new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = fail;
    img.src = tourExampleDir + file;
  });
  Promise.all([fetch(tourExampleDir + 'scrawlface.json').then(r => r.json()), image('scrawl.png'), image('drawing.png')])
    .then(([meta, scrawl, drawing]) => Object.assign(tourExample, meta, { scrawl, drawing, ready: true }))
    .catch(() => { tourExample = null; }); // tried again next time
}

// One moment of it: lines, eyes and paint each from 0 (not there) to 1.
// Laid out as on the canvas: the paint under the lines, both turned by its
// rotation about the middle, and the eyes upright at their turned spots.
function drawTourExample(g, { lines, eyes, paint }) {
  g.clear();
  g.background(255);
  if (!tourExample || !tourExample.ready) return;
  const ctx = g.drawingContext;
  const mid = canvasSize / 2;
  const angle = radians(tourExample.rotation);
  ctx.save();
  ctx.translate(mid, mid);
  ctx.rotate(angle);
  ctx.globalAlpha = paint;
  if (paint > 0) ctx.drawImage(tourExample.drawing, -layerSize / 2, -layerSize / 2, layerSize, layerSize);
  ctx.globalAlpha = lines;
  if (lines > 0) ctx.drawImage(tourExample.scrawl, -mid, -mid, canvasSize, canvasSize);
  ctx.restore();
  const spots = tourExample.eyes.map(eye => ({
    x: mid + (eye.x - mid) * Math.cos(angle) - (eye.y - mid) * Math.sin(angle),
    y: mid + (eye.x - mid) * Math.sin(angle) + (eye.y - mid) * Math.cos(angle)
  }));
  tourExample.eyes.forEach((eye, k) => {
    const pop = popIn(eyes * 1.5 - k * 0.5);
    // Whichever eye is further right is drawn as the right-hand one, as on the canvas
    const isRight = spots[k].x > spots[1 - k].x ? 1 : 0;
    if (pop > 0.01) drawEye(g, spots[k].x, spots[k].y, eye.scale * pop, tourExample.eyeStyles[k], isRight);
  });
}

// The parts of the illustration `art` at t seconds into its screen
function introMoment(art, t) {
  const at = (from, length) => constrain((t - from) / length, 0, 1);
  // 01: a scribble draws itself in... and turns out to be someone
  if (art === 'reveal') return { lines: at(0, 1.6), eyes: at(2.1, 0.5) };
  // 02: the example comes together: its lines fade in, then its eyes, then its paint
  if (art === 'example') return { lines: at(0, 1), eyes: at(1.3, 0.5), paint: at(2.2, 0.8) };
  // 03: scribble after scribble: what's in this one?
  return { lines: at(0, 1.6) };
}

function animateIntro() {
  if (!introOpen()) return;
  const art = introScreens[introIndex].art;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let t = (performance.now() - introStart) / 1000;
  // Screens that repeat: 02 plays again; 03 draws a new scribble each round
  const round = art === 'example' ? 6 : art === 'mystery' ? 3.5 : 0;
  if (round && !reduced) {
    const n = Math.floor(t / round);
    if (n !== introRound) {
      introRound = n;
      if (n > 0 && art === 'mystery') introScene = makeIntroScene();
    }
    t %= round;
  }
  if (reduced) t = 99;
  if (art === 'example') drawTourExample(introArt, introMoment(art, t));
  else drawIntroArt(introArt, introScene, introMoment(art, t));
  introFrame = requestAnimationFrame(animateIntro);
}

// -- Tooltips: the feature tour and the one-off tips share one bubble --

let coachResolve = null;  // ends the step or tip on show
let coachAnchor = null;   // { el } or { rect: () => DOMRect }, plus ring
let currentTip = null;    // id of the one-off tip on show
let touring = false;

function setupCoach() {
  document.getElementById('coach-next').addEventListener('click', () => hideCoach('next'));
  document.getElementById('coach-skip').addEventListener('click', () => hideCoach('end'));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('coach').hidden) hideCoach('end');
  });
  window.addEventListener('resize', placeCoach);
  // A press anywhere but the bubble puts a one-off tip away (the canvas
  // does this too, in mousePressed; the tour stays until it's ended)
  document.addEventListener('pointerdown', e => {
    if (currentTip && !e.target.closest('#coach')) dismissTip();
  });
}

// Shows the bubble at `anchor`; resolves 'next' (its key), 'end' (End tour
// or Esc) or 'dismissed' (put away, e.g. by working on the canvas)
function showCoach({ anchor, title = '', text, count = '', next = 'Next', canEnd = false }) {
  hideCoach('dismissed');
  document.getElementById('coach-title').textContent = title;
  document.getElementById('coach-title').hidden = !title;
  document.getElementById('coach-text').textContent = text;
  document.getElementById('coach-count').textContent = count;
  document.getElementById('coach-next').textContent = next;
  document.getElementById('coach-skip').hidden = !canEnd;
  document.getElementById('coach').hidden = false;
  coachAnchor = anchor;
  document.getElementById('coach-box').hidden = !anchor.box;
  placeCoach();
  return new Promise(resolve => { coachResolve = resolve; });
}

// The box around several elements on screen
function boxAround(els) {
  const rects = els.map(el => el.getBoundingClientRect());
  const left = Math.min(...rects.map(r => r.left));
  const top = Math.min(...rects.map(r => r.top));
  return new DOMRect(left, top, Math.max(...rects.map(r => r.right)) - left, Math.max(...rects.map(r => r.bottom)) - top);
}

function hideCoach(result) {
  const coach = document.getElementById('coach');
  if (coach.hidden) return;
  coach.hidden = true;
  document.getElementById('coach-box').hidden = true;
  coachAnchor = null;
  if (currentTip) {
    track('tip_closed', { tip_id: currentTip, via: { next: 'button', end: 'escape' }[result] || 'dismissed' });
  }
  currentTip = null;
  const resolve = coachResolve;
  coachResolve = null;
  if (resolve) resolve(result);
}

// Below what it points at, or above if there's no room; over the middle of
// something big (the canvas). The arrow points at the anchor's centre.
function placeCoach() {
  const coach = document.getElementById('coach');
  if (coach.hidden || !coachAnchor) return;
  const r = coachAnchor.el ? coachAnchor.el.getBoundingClientRect() : coachAnchor.rect();
  if (coachAnchor.box) {
    // The tour step's outline: a rounded box just outside what it points
    // at, kept on screen (the canvas can be as wide as the window)
    const box = document.getElementById('coach-box').style;
    const x0 = Math.max(r.left - 6, 2);
    const y0 = Math.max(r.top - 6, 2);
    const x1 = Math.min(r.right + 6, innerWidth - 2);
    const y1 = Math.min(r.bottom + 6, innerHeight - 2);
    box.left = `${x0}px`;
    box.top = `${y0}px`;
    box.width = `${x1 - x0}px`;
    box.height = `${y1 - y0}px`;
  }
  const w = coach.offsetWidth;
  const h = coach.offsetHeight;
  const gap = 12;
  const margin = 12;
  let side;
  let top;
  if (coachAnchor.free) {
    // Over the canvas, near its foot, out of the way of what's on it
    side = 'inside';
    top = Math.min(r.bottom, innerHeight) - h - 16;
  } else if (r.height > innerHeight * 0.4) {
    side = 'inside';
    top = r.top + (r.height - h) / 2;
  } else if (r.bottom + gap + h + margin <= innerHeight) {
    side = 'below';
    top = r.bottom + gap;
  } else {
    side = 'above';
    top = r.top - gap - h;
  }
  top = constrain(top, margin, innerHeight - h - margin);
  const centre = r.left + r.width / 2;
  const left = constrain(centre - w / 2, margin, innerWidth - w - margin);
  coach.dataset.side = side;
  coach.style.top = `${top}px`;
  coach.style.left = `${left}px`;
  document.getElementById('coach-arrow').style.left = `${constrain(centre - left - 6, 14, w - 26)}px`;
}

// The first element matching `selector` that's on screen
function shownElement(selector) {
  return [...document.querySelectorAll(selector)].find(el => el.getClientRects().length > 0) || null;
}

// Explore features: a tip on each control in turn (sidebar or phone bar)
async function exploreFeatures() {
  if (isEmbedded() || touring) return;
  closeHelpMenu();
  dismissTip();
  touring = true;
  const desktop = shownElement('.sidebar') !== null;
  // [what it points at, title, text]; the tools step covers the tool keys
  // and the selected tool's options together (on phones, Undo and Redo too)
  const steps = (desktop ? [
    ['#generate-btn', 'New scribble and Loops', 'Get a fresh scribble. Use Loops to make it more or less tangled.'],
    [['.sidebar .tool-keys', '.sidebar-section > .tool-options'], 'Your creative tools', 'Add eyes and colour to bring your discoveries to life.'],
    ['.sidebar .history-keys', 'Undo, Redo & Clear', 'Undo or redo changes. Clear removes all paint from the canvas.'],
    ['#scrawl-container', 'The canvas', isTouchScreen() ? 'Pinch to zoom and rotate. Touch and hold to peek under the lines.'
      : 'Move the eyes, draw with Brush or tap to Fill. Find Rotate and Hide lines under View.'],
    ['.header-gallery-btn', 'My Scrawls', 'All your saved scrawlfaces in one place.']
  ] : [
    [['.options-strip', '.tool-row'], 'Your creative tools', 'Add eyes and colour to bring your discoveries to life.'],
    ['#scrawl-container', 'The canvas', 'Pinch to zoom and rotate. Touch and hold to peek under the lines.'],
    ['#toggle-mobile-menu', 'More tools', 'Swipe up for New scribble, Loops, Hide lines, Clear, Save and Share.'],
    ['.header-gallery-btn', 'My Scrawls', 'All your saved scrawlfaces in one place.']
  ]).map(([selectors, title, text]) => ({ els: [].concat(selectors).map(shownElement).filter(Boolean), title, text }))
    .filter(step => step.els.length);

  track('explore_features_started');
  for (let i = 0; i < steps.length; i++) {
    const last = i === steps.length - 1;
    const result = await showCoach({
      anchor: { rect: () => boxAround(steps[i].els), box: true },
      title: steps[i].title,
      text: steps[i].text,
      count: `${i + 1} of ${steps.length}`,
      next: last ? 'Done' : 'Next',
      canEnd: !last
    });
    if (result !== 'next') {
      track('explore_features_ended', { at_step: i + 1 });
      break;
    }
    if (last) track('explore_features_completed');
  }
  touring = false;
}

// A one-off tip, shown once ever (then remembered), and not over the intro
// or the tour. Any press on the canvas puts it away.
function showTip(id, anchor, text, next = 'Got it') {
  if (isEmbedded() || touring || introOpen() || currentTip) return;
  if (onboardingState().tipsSeen.includes(id)) return;
  if (!anchor || (!anchor.el && !anchor.rect) || (anchor.el && anchor.el.getClientRects().length === 0)) return;
  markTipSeen(id);
  showCoach({ anchor, text, next });
  currentTip = id;
  track('tip_shown', { tip_id: id });
}

// Puts the tip on show away (only tip `id`, if given)
function dismissTip(id) {
  if (currentTip && (!id || currentTip === id)) hideCoach('dismissed');
}

// -- The first scrawl: one tip, pointing at the eyes --
// Shown once ever, after the draw-in, unless they're already at work on the
// canvas. Let's go!, or a press anywhere else, closes it.

let canvasPressed = false; // the canvas was pressed since this scrawl came

function tipFirstScrawl() {
  if (canvasPressed) return;
  if (isBlankStart() || eyePositions.length === 0) return;
  showTip('drag-eyes', { rect: () => eyeScreenRect(0) },
    'There\'s more than meets the eye. Move the eyes and rotate the canvas. Can you spot a face? Add colour to make it yours.',
    'Let\'s go!');
}

// An eye's box on screen
function eyeScreenRect(i) {
  const c = canvas.elt.getBoundingClientRect();
  const k = c.width / width;
  const p = getRotatedPosition(eyePositions[i].x, eyePositions[i].y);
  const r = eyeRadius * viewZoom * k;
  return new DOMRect(c.left + p.x * k - r, c.top + p.y * k - r, 2 * r, 2 * r);
}

// First time on a tool that has a trick to it
function tipForTool(tool) {
  if (isBlankStart()) return;
  if (tool === 'brush' && isTouchScreen()) {
    showTip('gestures', { el: document.getElementById('scrawl-container') },
      'Pinch to zoom and turn the canvas. Touch and hold to peek under the lines.');
  }
  if (tool === 'fill') {
    showTip('fill', { el: shownElement('[data-tool="fill"]') },
      'Tap an enclosed area to colour it. Tap outside the scribble to colour the background.');
  }
}

// After a handful of changes to a scrawlface that was never saved
function tipSave() {
  if (galleryId !== null || editVersion - savedVersion < 6 || !hasUnsavedPaint()) return;
  if (document.body.classList.contains('no-storage')) return;
  const saveKey = shownElement('.sidebar .gallery-save-btn');
  if (saveKey) {
    showTip('save', { el: saveKey }, 'Like what you\'ve made? Save it to My Scrawls to keep it.');
  } else {
    showTip('save', { el: document.getElementById('toggle-mobile-menu') },
      'Like what you\'ve made? Swipe up and save it to My Scrawls to keep it.');
  }
}

// ---- Analytics events ----
// What people do, as named events with a few properties (see
// plans/analytics.md). Events go to listeners (a native shell forwards them
// to its analytics through window.scrawlface.onEvent; the website sends
// them to Vercel Web Analytics, see below) and the last few are kept for
// checking. Never put the drawing, image data or personal details in an
// event.

const eventListeners = [];
const recentEvents = [];
const appVersion = (document.querySelector('script[src*="scrawl.js"]')?.src.match(/[?&]v=(\d+)/) || [])[1] || null;

function track(name, props = {}) {
  const event = {
    name,
    props: {
      ...props,
      platform: isEmbedded() ? 'shell' : 'web',
      app_version: appVersion,
      onboarding_version: ONBOARDING_VERSION
    },
    time: Date.now()
  };
  recentEvents.push(event);
  if (recentEvents.length > 50) recentEvents.shift();
  eventListeners.forEach(fn => {
    try { fn(event); } catch (e) {}
  });
}

// Returns a function that stops listening
function onEvent(fn) {
  eventListeners.push(fn);
  return () => {
    const i = eventListeners.indexOf(fn);
    if (i !== -1) eventListeners.splice(i, 1);
  };
}

// An event's properties as plain values, as analytics services take them:
// lists become comma-separated text, anything else that isn't plain is left out
function plainProps(props) {
  const data = {};
  Object.entries(props).forEach(([key, value]) => {
    if (Array.isArray(value)) data[key] = value.join(',');
    else if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) data[key] = value;
  });
  return data;
}

// Vercel Web Analytics, on the website only (a native shell has its own):
// Vercel's script counts page views, and our events go to it as custom
// events. The script exists only where Vercel hosts the site; elsewhere it
// fails to load and nothing is sent. Its queue (window.va) takes events
// before the script has loaded.
if (!isEmbedded()) {
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  const vercel = document.createElement('script');
  vercel.defer = true;
  vercel.src = '/_vercel/insights/script.js';
  document.head.appendChild(vercel);
  onEvent(event => window.va('event', { name: event.name, data: plainProps(event.props) }));
}

// Umami (cloud.umami.is), on scrawlface.app only: not on other copies of the
// site (GitHub Pages, local), in tests or in a native shell, so they don't
// count. Its script counts page views; our events go to it as custom
// events. Events from before it has loaded wait, then go.
const umamiHosts = ['scrawlface.app', 'www.scrawlface.app'];
const umamiWebsiteId = '50b061ec-4f31-4c39-884a-e768e170f27a';

function startUmami() {
  const waiting = [];
  const send = event => window.umami.track(event.name, plainProps(event.props));
  const script = document.createElement('script');
  script.defer = true;
  script.src = 'https://cloud.umami.is/script.js';
  script.dataset.websiteId = umamiWebsiteId;
  script.addEventListener('load', () => {
    if (!window.umami) return;
    waiting.splice(0).forEach(send);
  });
  document.head.appendChild(script);
  onEvent(event => (window.umami ? send(event) : waiting.push(event)));
}

if (!isEmbedded() && umamiHosts.includes(location.hostname)) startUmami();

// The scrawlface on the canvas: what's been used on it, for tool_used (the
// first use of each tool) and scrawlface_saved. fresh: a new scribble (so
// the time since it was made counts); otherwise one reopened or restored.
let scrawlfaceStats = { tools: new Set(), strokes: 0, fills: 0, generatedAt: null };

function startScrawlfaceStats(fresh) {
  scrawlfaceStats = { tools: new Set(), strokes: 0, fills: 0, generatedAt: fresh ? performance.now() : null };
}

function usedTool(tool) {
  if (tool === 'brush' || tool === 'eraser') scrawlfaceStats.strokes++;
  if (tool === 'fill') scrawlfaceStats.fills++;
  if (scrawlfaceStats.tools.has(tool)) return;
  scrawlfaceStats.tools.add(tool);
  track('tool_used', { tool });
}

// The app was opened: first time on this device, or after how many days
function trackAppOpened() {
  const last = parseInt(storageGet('last_opened')) || 0;
  const now = Date.now();
  storageSet('last_opened', now);
  track('app_opened', { first_open: !last, days_since_last: last ? Math.floor((now - last) / 86400000) : null });
}

// ---- For a native shell: the app's state and the functions to drive it ----
// A shell draws its own controls and talks to the page through
// window.scrawlface (see plans/native-shell-readiness.md). The web keys use
// the same functions.

// What any toolbar needs to show
function appState() {
  return {
    tool: currentTool(),
    brushSize,
    eraserSize,
    brushColor,
    loops: intensity,
    eyeStyles: [...eyeStyles],
    linesShown: showScrawl,
    paintShown: showPaint,
    canUndo: historyStack.length > 0,
    canRedo: redoStack.length > 0,
    hasDrawings,
    blankStart: isBlankStart(),
    unsavedChanges: hasUnsavedChanges(),
    saved: galleryId !== null,
    wordmark: wordmarkFonts[wordmarkIndex][0]
  };
}

// Listeners get appState() after something changed. A burst of changes
// (an undo updates several keys) is reported once.
const stateListeners = [];
let stateChangePending = false;

function stateChanged() {
  if (stateChangePending || stateListeners.length === 0) return;
  stateChangePending = true;
  queueMicrotask(() => {
    stateChangePending = false;
    const state = appState();
    stateListeners.forEach(fn => fn(state));
  });
}

// Returns a function that stops listening
function onStateChange(fn) {
  stateListeners.push(fn);
  return () => {
    const i = stateListeners.indexOf(fn);
    if (i !== -1) stateListeners.splice(i, 1);
  };
}

window.scrawlface = {
  appState, onStateChange,
  newScrawl: requestNewScrawl,
  setTool, setBrushSize, setEraserSize, setBrushColor, setLoops,
  eyeSets: Object.keys(eyeSets), pickEyeSet, mixEyes,
  undo, redo, clear: clearDrawings,
  rotate: rotateCanvas, toggleLines: toggleEyes, togglePaint,
  save: saveToGallery, listGallery, openFromGallery,
  exportPNG,
  onboardingState, startTour: openIntro, exploreFeatures, resetOnboarding,
  onEvent, recentEvents: () => [...recentEvents], openExample,
  nextWordmark
};
