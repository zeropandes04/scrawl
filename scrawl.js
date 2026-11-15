// The "Scrawlface" wordmark is set in a different typeface on every page
// load, the same way the scrawl itself is different every time.
// Each entry: [family, Google Fonts query, CSS weight, CSS style, size scale].
const wordmarkFonts = [
  ['Space Grotesk', 'Space+Grotesk:wght@700', 700, 'normal', 1],                    // modern sans
  ['Archivo Black', 'Archivo+Black', 400, 'normal', 0.95],                          // heavy sans
  ['Playfair Display', 'Playfair+Display:ital,wght@1,700', 700, 'italic', 1.05],    // italic serif
  ['Instrument Serif', 'Instrument+Serif:ital@1', 400, 'italic', 1.25],             // elegant italic
  ['Abril Fatface', 'Abril+Fatface', 400, 'normal', 1.05],                          // display serif
  ['Bungee Shade', 'Bungee+Shade', 400, 'normal', 0.9],                             // display
  ['Monoton', 'Monoton', 400, 'normal', 0.95],                                      // decorative
  ['Pacifico', 'Pacifico', 400, 'normal', 1],                                       // script
  ['Lobster', 'Lobster', 400, 'normal', 1.1],                                       // flamboyant
  ['Permanent Marker', 'Permanent+Marker', 400, 'normal', 1],                       // marker
  ['Caveat', 'Caveat:wght@700', 700, 'normal', 1.35],                               // handwritten
  ['Rye', 'Rye', 400, 'normal', 0.95],                                              // western
  ['UnifrakturMaguntia', 'UnifrakturMaguntia', 400, 'normal', 1.15],                // blackletter
  ['Press Start 2P', 'Press+Start+2P', 400, 'normal', 0.6]                          // pixel
];

// Runs while the <head> is still being parsed, so the font is on its way
// before the header is painted. Only the letters of the wordmark are
// downloaded. If the font can't load, the header falls back to the system font.
function loadWordmarkFont() {
  // Never the same typeface twice in a row
  let last = -1;
  try { last = parseInt(localStorage.getItem('wordmarkFont')); } catch (e) {}
  let i;
  do {
    i = Math.floor(Math.random() * wordmarkFonts.length);
  } while (i === last);
  try { localStorage.setItem('wordmarkFont', i); } catch (e) {}

  const [family, query, weight, style, scale] = wordmarkFonts[i];

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${query}&text=Scrawlface&display=block`;
  document.head.appendChild(link);

  const root = document.documentElement.style;
  root.setProperty('--wordmark-font', `'${family}', sans-serif`);
  root.setProperty('--wordmark-weight', weight);
  root.setProperty('--wordmark-style', style);
  root.setProperty('--wordmark-scale', scale);
}
loadWordmarkFont();

let canvas;
const bgColor = [255, 255, 255];
let strokeColor = [0, 0, 0];
let rotation = 0;      // degrees; quarter turns from the Rotate button, any angle from a pinch
let viewZoom = 1;      // 1 = whole canvas visible; pinch zooms in up to maxZoom
let viewPan = { x: 0, y: 0 }; // canvas px the zoomed view is shifted by
const maxZoom = 8;
let pinch = null;      // two-finger gesture in progress: the view and fingers when it started
let pressChangedDrawing = false; // the current press started a stroke or filled
let showScrawl = true;
let moveEyesMode = false;
let drawMode = false;
let eraseMode = false;
let bucketMode = false;
let baseScrawlGraphics;
let drawingGraphics;
let eyePositions = [];
let draggedEyeIndex = -1;
let dragOffset = { x: 0, y: 0 }; // eye centre minus grab point, so the eye doesn't jump to the finger
let hasDrawings = false;
let isDrawing = false;
const eyeRadius = 35;
const canvasSize = 800;
const eyeMargin = 200;
const eyeSize = 70;
const scrawlStrokeWeight = 1;

let intensity = 10;
let eyeStyles = ['classic', 'classic']; // style of each eye (see drawEye)
let brushSize = 8;
let brushColor = '#000000';
let eraserSize = 16;
let brushSizesShown = false; // mobile strip: brush sizes instead of colours

// Scrawl segments still to be drawn by the draw-in animation
let scrawlQueue = [];
// The draw-in takes a short fixed start plus a little per segment, so a
// simple scrawl appears quickly and a dense one takes longer
// (at 60fps: intensity 1 ~0.3s, 10 ~0.6s, 25 ~1.1s)
const scrawlDrawInBaseFrames = 15;
const scrawlDrawInFramesPerSegment = 2;
let scrawlDrawInRate = 0;      // segments per frame (can be a fraction)
let scrawlDrawInProgress = 0;  // fraction of a segment carried to the next frame

// Memento pattern for undo/redo
let historyStack = [];
let redoStack = [];
// Each snapshot is a full 800x800 RGBA copy (~2.7MB measured); undo + redo
// share this budget, so 25 keeps a full history around 70MB on mobile.
const maxHistorySize = 25;

// Brush stroke tracking for easing
let strokePoints = 0;
let maxStrokePoints = 20; // Points to reach full size
let currentBrushSize = 0;
let strokeLength = 0; // Canvas px travelled in the current stroke
const tapSlop = 10;   // Strokes shorter than this count as a tap

function setup() {
  // CRITICAL: Disable pixel density to prevent coordinate mismatch
  // On retina displays, p5.js doubles canvas resolution but we need 1:1 mapping
  pixelDensity(1);

  canvas = createCanvas(canvasSize, canvasSize);
  canvas.parent("scrawl-container");

  // Prevent default touch behavior on canvas to avoid scrolling/zooming while drawing
  const canvasElement = canvas.elt;
  // Two fingers on the canvas zoom, rotate and pan the view (see startPinch).
  // These listeners run before p5's window-level ones, so mousePressed
  // already sees the pinch.
  canvasElement.addEventListener('touchstart', (e) => {
    if (e.targetTouches.length === 2) {
      startPinch(e.targetTouches);
    }
    if (pinch || drawMode || eraseMode || bucketMode || moveEyesMode) {
      e.preventDefault();
    }
  }, { passive: false });

  canvasElement.addEventListener('touchmove', (e) => {
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
    if (pinch && e.targetTouches.length < 2) {
      endPinch();
    }
  };
  canvasElement.addEventListener('touchend', onTouchEnd, { passive: false });
  canvasElement.addEventListener('touchcancel', onTouchEnd, { passive: false });

  baseScrawlGraphics = createGraphics(canvasSize, canvasSize);
  baseScrawlGraphics.drawingContext.willReadFrequently = true;
  drawingGraphics = createGraphics(canvasSize, canvasSize);
  drawingGraphics.drawingContext.willReadFrequently = true;
  drawingGraphics.clear();
  background(bgColor);

  // Match the canvas to its container now and whenever the layout changes
  // (window resize, phone rotation, the mobile address bar sliding away)
  fitCanvasToContainer();
  new ResizeObserver(fitCanvasToContainer).observe(document.getElementById('scrawl-container'));

  // Desktop and mobile keys that do the same thing
  select("#generate-btn").mousePressed(generateScrawlface);
  select("#generate-btn-mobile").mousePressed(generateScrawlface);
  select("#generate-btn-sheet").mousePressed(generateScrawlface);
  select("#rotate-btn").mousePressed(rotateCanvas);
  select("#rotate-btn-mobile-controls").mousePressed(rotateCanvas);
  select("#toggle-eyes-btn").mousePressed(toggleEyes);
  select("#toggle-eyes-btn-mobile").mousePressed(toggleEyes);
  select("#clear-drawings-btn").mousePressed(clearDrawings);
  select("#clear-drawings-btn-mobile").mousePressed(clearDrawings);
  select("#undo-btn").mousePressed(undo);
  select("#undo-btn-mobile").mousePressed(undo);
  select("#redo-btn").mousePressed(redo);
  select("#redo-btn-mobile").mousePressed(redo);
  select("#save-btn").mousePressed(saveImage);
  select("#save-btn-mobile").mousePressed(saveImage);

  // Intensity faders (sidebar and sheet) stay in sync. The value only
  // applies at the next Generate.
  ['intensity-slider', 'intensity-slider-mobile'].forEach(id => {
    const slider = document.getElementById(id);
    slider.addEventListener('input', () => {
      intensity = parseInt(slider.value);
      ['', '-mobile'].forEach(suffix => {
        document.getElementById('intensity-slider' + suffix).value = intensity;
        document.getElementById('intensity-value' + suffix).textContent = intensity;
      });
      tickLcd(id.replace('slider', 'value'));
    });
  });

  // Tool, size and colour keys, Share
  setupToolbar();

  // Mobile bottom sheet: open/close
  setupMobileSheet();

  // Eye set keys (desktop and mobile share data-eye-set)
  setupEyeSetButtons();

  // A short buzz when a control key is tapped, so the keys feel physical.
  // Android Chrome only; other browsers have no navigator.vibrate.
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || !navigator.vibrate) return;
    const key = e.target.closest('.sidebar button, .bottom-toolbar button');
    if (key && !key.disabled) navigator.vibrate(8);
  });

  // Start with the brush selected so the canvas responds to the first touch
  setTool('brush');

  generateScrawlface();
}

function generateScrawlface() {
  // Generating wipes the drawing and its undo history, so check first
  if (hasDrawings && !confirm('Start a new scrawl? Your drawing will be lost.')) {
    return;
  }

  drawingGraphics.clear();
  hasDrawings = false;
  disableClearButton();

  // A new scrawl starts with the whole canvas in view
  viewZoom = 1;
  viewPan = { x: 0, y: 0 };

  // Clear undo/redo history
  clearHistory();

  // Ensure scrawl is visible when generating new scrawl
  if (!showScrawl) {
    showScrawl = true;
    updateScrawlToggleButtons();
  }

  baseScrawlGraphics.background(bgColor);
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
  // Reduced motion: draw the whole scrawl straight away
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    drawScrawlSegments(scrawlQueue.length);
  }

  const eye1X = random(eyeMargin, canvasSize - eyeMargin - eyeSize - 60);
  const eye1Y = random(eyeMargin, canvasSize - eyeMargin - eyeSize);
  const eye2X = random(eye1X + eyeSize, min(eye1X + 130, canvasSize - eyeMargin - eyeSize));
  const eye2Y = random(eyeMargin, canvasSize - eyeMargin - eyeSize);

  eyePositions = [
    {x: eye1X, y: eye1Y, scale: 1.0},
    {x: eye2X, y: eye2Y, scale: 0.9}
  ];

  redrawCanvas();
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
    // Keep the whole eye on the canvas so it can't be dragged out of reach
    eyePositions[draggedEyeIndex].x = constrain(transformed.x + dragOffset.x, eyeRadius, canvasSize - eyeRadius);
    eyePositions[draggedEyeIndex].y = constrain(transformed.y + dragOffset.y, eyeRadius, canvasSize - eyeRadius);
    redrawCanvas();
    return;
  }

  if (!drawMode && !eraseMode && !bucketMode && moveEyesMode && !mouseIsPressed) {
    updateCursor();
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
      const x = lerp(previous.x, current.x, t);
      const y = lerp(previous.y, current.y, t);
      drawingGraphics.ellipse(x, y, currentBrushSize, currentBrushSize);
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
}

function updateCursor() {
  const transformed = getTransformedCoords(mouseX, mouseY);
  const overEye = findEyeAt(transformed.x, transformed.y) !== -1;
  cursor(overEye ? 'pointer' : ARROW);
}

// Index of the eye nearest to a point (canvas coords), or -1 if none is in reach.
// The canvas is scaled down on small screens, so the reach grows to stay a
// ~44px touch target (and shrinks again when zoomed in).
function findEyeAt(x, y) {
  let reach = max(eyeRadius, 22 * width / canvas.elt.clientWidth / viewZoom);
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
  // mousePressed is window-wide. Ignore presses on anything other than the
  // canvas (e.g. mobile toolbar buttons that overlap it when the menu is open),
  // even if their coordinates fall inside the canvas bounds.
  if (event && event.target !== canvas.elt) return;

  // A second finger is a pinch, not another press
  if (pinch) return;

  if (!drawMode && !eraseMode && !bucketMode && moveEyesMode) {
    const transformed = getTransformedCoords(mouseX, mouseY);
    const eyeIndex = findEyeAt(transformed.x, transformed.y);

    if (eyeIndex !== -1) {
      draggedEyeIndex = eyeIndex;
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
    // Save state BEFORE starting to draw so we can undo to the clean state
    saveState();
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

function startPinch(touches) {
  // The first finger had already started a stroke or filled: take it back,
  // the gesture turned out to be a pinch. An eye being dragged is let go.
  if (pressChangedDrawing) {
    undo();
    redoStack.pop(); // undo() queued the cancelled mark for redo
    updateUndoRedoButtons();
    pressChangedDrawing = false;
  }
  isDrawing = false;
  draggedEyeIndex = -1;

  const a = touchPoint(touches[0]);
  const b = touchPoint(touches[1]);
  pinch = {
    distance: dist(a.x, a.y, b.x, b.y),
    angle: atan2(b.y - a.y, b.x - a.x),
    // The point of the drawing between the fingers; it stays between them
    anchor: getTransformedCoords((a.x + b.x) / 2, (a.y + b.y) / 2),
    zoom: viewZoom,
    rotation: rotation
  };
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

  // Settle on a quarter turn when close to one, and on the full view when
  // barely zoomed, so it's easy to get back to a straight, whole canvas
  const quarterTurn = round(rotation / 90) * 90;
  if (abs(rotation - quarterTurn) < 8) rotation = quarterTurn;
  rotation = ((rotation % 360) + 360) % 360;
  if (viewZoom < 1.05) viewZoom = 1;
  clampViewPan();

  if (drawMode || eraseMode) setBrushCursor();
  redrawCanvas();
}

// The view can only be shifted as far as the zoom has pushed the canvas past
// the frame: none at zoom 1, so zooming all the way out re-centres it
function clampViewPan() {
  const limit = (viewZoom - 1) * canvasSize / 2;
  viewPan.x = constrain(viewPan.x, -limit, limit);
  viewPan.y = constrain(viewPan.y, -limit, limit);
}

function mouseReleased() {
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
    drawingGraphics.ellipse(pos.x, pos.y, size, size);
    if (eraseMode) {
      drawingGraphics.noErase();
    }

    if (!hasDrawings && !eraseMode) {
      hasDrawings = true;
      enableClearButton();
    }

    redrawCanvas();
  }

  isDrawing = false;
  pressChangedDrawing = false;
}

function keyPressed() {
  // Undo: Cmd+Z (Mac) or Ctrl+Z (Windows/Linux)
  if ((keyCode === 90) && (keyIsDown(CONTROL) || keyIsDown(91) || keyIsDown(93))) {
    // Check for Shift key for redo
    if (keyIsDown(SHIFT)) {
      redo();
    } else {
      undo();
    }
    return false; // Prevent default browser behavior
  }

  // Alternative redo: Cmd+Y or Ctrl+Y
  if ((keyCode === 89) && (keyIsDown(CONTROL) || keyIsDown(91) || keyIsDown(93))) {
    redo();
    return false;
  }

  // Tool shortcuts (desktop): B brush, E eraser, F fill, V eyes, N new scrawl
  if (keyIsDown(CONTROL) || keyIsDown(91) || keyIsDown(93) || keyIsDown(ALT)) return;
  const tool = { b: 'brush', e: 'eraser', f: 'fill', v: 'eyes' }[key.toLowerCase()];
  if (tool) setTool(tool);
  if (key.toLowerCase() === 'n') generateScrawlface();
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
  // so each frame while drawing only copies what's needed
  if (showScrawl) {
    image(baseScrawlGraphics, 0, 0);
  }
  image(drawingGraphics, 0, 0);

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
// own style, so the two can differ. A set is a ready-made pair (Wink is an
// open and a closed eye); Mix picks a random pair.
// `g` is what to draw on: the main canvas (window) or a preview graphic.
const eyeSets = {
  classic: ['classic', 'classic'],
  lashes: ['lashes', 'lashes'],
  sleepy: ['sleepy', 'sleepy'],
  glam: ['glam', 'glam'],
  spiky: ['spiky', 'spiky'],
  wink: ['lashes', 'closed'],
  dot: ['dot', 'dot'],
  side: ['side', 'side'],
  amber: ['amber', 'amber'],
  sunny: ['sunny', 'sunny'],
  blue: ['blue', 'blue'],
  cat: ['cat', 'cat']
};
// Eye colours come from the swatch palette, so eyes and doodles match
const eyeColors = {
  blue: '#26ACD9',      // Nano Blue
  red: '#CC0000',       // Red
  aqua: '#44A2A2',      // Aqua
  tangerine: '#FFA64D', // Tangerine
  yellow: '#FFF133',    // Yellow
  lime: '#66BD0F',      // Lime
  magenta: '#CC0099',   // Magenta
  pink: '#F2A6ED'       // Electric Pink
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
  smile:    { w: 36, top: 6, bottom: 50, kl: 0.7, kr: 0.7 },     // flat top, deep bottom
  dome:     { w: 42, top: 52, bottom: 8, kl: 0.7, kr: 0.7 },     // deep top, flat bottom
  big:      { w: 40, top: 50, bottom: 50, kl: 0.9, kr: 0.9 },    // big and round
  slanted:  { w: 46, top: 24, bottom: 24, kl: 0.3, kr: 0.7, tilt: 0.3 }
};
const eyeStyleShapes = {
  lashes: 'almond', closed: 'almond', sleepy: 'lens', glam: 'upturned',
  spiky: 'round', dot: 'slit', side: 'teardrop', amber: 'smile',
  sunny: 'dome', blue: 'big', cat: 'slanted'
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
    g.strokeWeight(2.5);
    g.fill(255);
    doodleEllipse(g, 0, 0, eyeSize, eyeSize, 1);
    // The pen going round a second time
    g.noFill();
    g.strokeWeight(1.2);
    doodleEllipse(g, 0.5, -0.5, eyeSize + 3, eyeSize + 2, 2);
    g.noStroke();
    g.fill(0);
    doodleEllipse(g, 1, 1, 40, 40, 3);
    g.fill(255);
    doodleEllipse(g, 7, -6, 11, 10, 4);
  } else if (style === 'closed') {
    // Closed eye: just the lower lid with lashes hanging down
    const { w, bottom, kl, kr } = eyeShape;
    g.noFill();
    g.bezier(-w, 0, -w * kl, bottom * 0.8, w * kr, bottom * 0.8, w, 0);
    // The pen going over the lid a second time
    g.strokeWeight(1.5);
    g.bezier(-w - 3, -2, -w * kl, bottom * 0.8 + 3, w * kr, bottom * 0.8 - 1, w + 4, -1);
    g.strokeWeight(3);
    lashes(g, 1, 5, 12, 0.8);
  } else {
    // Open eyes: the outline, then everything inside it (clipped to the
    // shape so nothing pokes out), then the outline again and the lashes
    const colour = { amber: eyeColors.tangerine, blue: eyeColors.blue, cat: eyeColors.lime }[style];
    eyeOutline(g, colour || 255);

    const ctx = g.drawingContext;
    ctx.save();
    clipToEye(ctx);
    if (style === 'lashes') {
      iris(g, 0, 0, 26, 0);
    } else if (style === 'sleepy') {
      // Heavy coloured lid covering the top half
      iris(g, 0, 6, 26, 0);
      lid(g, eyeColors.pink, 0);
    } else if (style === 'glam') {
      // Magenta crescent lid, aqua iris
      iris(g, 0, 0, 30, eyeColors.aqua);
      lid(g, eyeColors.magenta, 0.35);
    } else if (style === 'spiky') {
      iris(g, 0, 0, 32, eyeColors.red);
    } else if (style === 'dot') {
      // Small dot pupil
      g.fill(0);
      doodleEllipse(g, 0, 0, 12, 12, 3);
    } else if (style === 'side') {
      // Big black iris pushed against the round end
      g.noStroke();
      g.fill(0);
      doodleEllipse(g, 18, 0, 44, 44, 3);
      g.fill(255);
      doodleEllipse(g, 10, -7, 9, 8, 4);
    } else if (style === 'amber' || style === 'blue') {
      // Whole eye filled with colour, dot pupil in the middle of the shape
      const cy = (eyeShape.bottom - eyeShape.top) * 0.375;
      g.fill(0);
      doodleEllipse(g, 0, cy, 14, 14, 3);
      g.noStroke();
      g.fill(255);
      doodleEllipse(g, 3, cy - 3, 5, 4, 4);
    } else if (style === 'cat') {
      // The whole eye is a lime iris with a vertical slit pupil
      g.noStroke();
      g.fill(0);
      doodleEllipse(g, 0, 0, 9, 40, 3);
      g.fill(255);
      doodleEllipse(g, 9, -8, 7, 6, 4);
    } else if (style === 'sunny') {
      // Yellow lid over a black iris
      iris(g, 0, -6, 26, 0);
      lid(g, eyeColors.yellow, 0.45);
    }
    ctx.restore();

    // ctx.restore() also put the pen back, so set it again
    g.stroke(0);
    g.strokeWeight(3);
    eyeOutline(g, null);

    if (style === 'lashes') lashes(g, -1, 5, 14);
    if (style === 'glam' || style === 'sunny') lashes(g, 1, 4, 10);
    if (style === 'spiky') {
      lashes(g, -1, 7, 14);
      lashes(g, 1, 5, 12);
    }
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

// A coloured iris (or plain black when color is 0) with a pupil and highlight
function iris(g, x, y, size, color) {
  g.fill(color);
  doodleEllipse(g, x, y, size, size, 5);
  g.noStroke();
  if (color !== 0) {
    g.fill(0);
    doodleEllipse(g, x, y, size * 0.4, size * 0.4, 6);
  }
  g.fill(255);
  doodleEllipse(g, x + size * 0.2, y - size * 0.2, size * 0.28, size * 0.25, 7);
  g.stroke(0);
}

// Upper lid: from the top curve down to a lower curve at `depth`
// (0 = straight across the middle, 1 = no lid)
function lid(g, color, depth) {
  const { w, top, kl, kr } = eyeShape;
  g.fill(color);
  g.beginShape();
  g.vertex(-w, 0);
  g.bezierVertex(-w * kl, -top, w * kr, -top, w, 0);
  g.bezierVertex(w * kr, -top * depth, -w * kl, -top * depth, -w, 0);
  g.endShape(CLOSE);
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

// Each key shows a preview of its set (the closed eye for Wink); picking one
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
    btn.addEventListener('click', () => setEyeStyles(eyeSets[set]));
  });

  document.querySelectorAll('.mix-eyes-btn').forEach(btn => {
    btn.addEventListener('click', mixEyes);
  });

  updateEyeSetButtons();
}

// Gives each eye a different random style (never both closed, never the
// same pair as now, so every press visibly changes something)
function mixEyes() {
  const styles = ['classic', 'lashes', 'sleepy', 'glam', 'spiky', 'closed',
                  'dot', 'side', 'amber', 'blue', 'sunny', 'cat'];
  let pair;
  do {
    pair = shuffle(styles).slice(0, 2);
  } while (pair[0] === eyeStyles[0] && pair[1] === eyeStyles[1]);
  setEyeStyles(pair);
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
}

function rotateCanvas() {
  rotation = (rotation + 90) % 360;
  redrawCanvas();
}

// The picture Save and Share export: the whole drawing at normal size, with
// its eyes, rotation and scrawl visibility, whatever the zoom on screen.
function exportImage() {
  // Draw one frame with the zoom taken out, grab the square middle of the
  // canvas (exactly the drawing), then put the view back. It all happens
  // within one frame, so nothing flickers on screen.
  const zoom = viewZoom;
  const pan = viewPan;
  viewZoom = 1;
  viewPan = { x: 0, y: 0 };
  redrawCanvas();
  const image = get(round((width - canvasSize) / 2), round((height - canvasSize) / 2), canvasSize, canvasSize);
  viewZoom = zoom;
  viewPan = pan;
  redrawCanvas();
  return image;
}

function saveImage() {
  exportImage().save('scrawlface', 'png');
}

// Hands the image to the phone's share sheet (messages, socials, ...)
function shareImage() {
  exportImage().canvas.toBlob(blob => {
    const file = new File([blob], 'scrawlface.png', { type: 'image/png' });
    // Rejects when the share sheet is dismissed - nothing to do then
    navigator.share({ files: [file] }).catch(() => {});
  }, 'image/png');
}

function toggleEyes() {
  showScrawl = !showScrawl;
  updateScrawlToggleButtons();
  redrawCanvas();
}

// The buttons name what pressing them will do, rather than lighting up when
// the scrawl is hidden
function updateScrawlToggleButtons() {
  const label = showScrawl ? "Hide scrawl" : "Show scrawl";
  select("#toggle-eyes-btn").html(label);
  select("#toggle-eyes-btn-mobile").html(label);
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
  updateToolButtons();
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

// The canvas element fills its container, which is rarely square, so the
// canvas takes the container's proportions. The shorter side is always
// canvasSize units: the whole drawing fits at zoom 1, and the extra room
// shows more of it when zoomed in or rotated.
function fitCanvasToContainer() {
  const box = document.getElementById('scrawl-container');
  if (box.clientWidth === 0 || box.clientHeight === 0) return;

  const k = canvasSize / min(box.clientWidth, box.clientHeight);
  const w = round(box.clientWidth * k);
  const h = round(box.clientHeight * k);
  if (w === width && h === height) return;

  resizeCanvas(w, h, true);
  if (drawMode || eraseMode) setBrushCursor();
  redrawCanvas();
}

// The canvas is scaled to fit the window, so the ring has to be rescaled too
function windowResized() {
  if (drawMode || eraseMode) setBrushCursor();
}

function clearDrawings() {
  if (!hasDrawings) return;

  // Save state BEFORE clearing so Clear can be undone
  saveState();

  drawingGraphics.clear();
  hasDrawings = false;
  disableClearButton();

  redrawCanvas();
}

function enableClearButton() {
  select("#clear-drawings-btn").removeAttribute("disabled");
  select("#clear-drawings-btn-mobile").removeAttribute("disabled");
}

function disableClearButton() {
  select("#clear-drawings-btn").attribute("disabled", "");
  select("#clear-drawings-btn-mobile").attribute("disabled", "");
}

// startX/startY are a position on the drawing (see getTransformedCoords).
// The fill works on the unrotated, unzoomed layers, so the view doesn't matter.
function floodFill(startX, startY, fillColor) {
  startX = Math.floor(startX);
  startY = Math.floor(startY);
  if (startX < 0 || startX >= canvasSize || startY < 0 || startY >= canvasSize) return;

  // Max per-channel difference from the clicked colour that still counts as
  // "the same area". Absorbs the soft anti-aliased edges of lines without
  // leaking through them (measured: higher values start crossing 1px lines).
  const fillTolerance = 64;

  // Build a temporary canvas of everything that bounds a fill: background,
  // scrawl (if shown) and drawings.
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvasSize;
  tempCanvas.height = canvasSize;
  const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

  tempCtx.fillStyle = `rgb(${bgColor.join(',')})`;
  tempCtx.fillRect(0, 0, canvasSize, canvasSize);

  if (showScrawl) {
    tempCtx.drawImage(baseScrawlGraphics.canvas, 0, 0);

    // Don't fill if clicking on a scrawl line (non-white pixel)
    const [lineR, lineG, lineB] = tempCtx.getImageData(startX, startY, 1, 1).data;
    if (lineR + lineG + lineB < 700) {
      return;
    }
  }

  tempCtx.drawImage(drawingGraphics.canvas, 0, 0);

  const data = tempCtx.getImageData(0, 0, canvasSize, canvasSize).data;

  // Target color (the color we're replacing) is whatever was clicked
  const clickIndex = (startY * canvasSize + startX) * 4;
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

  // Save state BEFORE filling - only now that we know a fill will happen
  saveState();

  // Flood fill to find all pixels to fill.
  // Pixels are addressed by flat index (y * canvasSize + x) and tracked in typed
  // arrays: far faster on mobile than string keys in a Set and [x, y] pairs.
  const totalPixels = canvasSize * canvasSize;
  const inRegion = new Uint8Array(totalPixels); // 1 = pixel is part of the fill region
  const stack = new Int32Array(totalPixels);    // each pixel is pushed at most once
  let stackSize = 0;

  // Add a neighbour to the region if it is close to the target color and isn't in yet
  const visit = (i) => {
    if (inRegion[i]) return;
    if (distanceFromTarget(i * 4) <= fillTolerance) {
      inRegion[i] = 1;
      stack[stackSize++] = i;
    }
  };

  visit(startY * canvasSize + startX);

  while (stackSize > 0) {
    const i = stack[--stackSize];
    const x = i % canvasSize;
    if (x > 0) visit(i - 1);
    if (x < canvasSize - 1) visit(i + 1);
    if (i >= canvasSize) visit(i - canvasSize);
    if (i < totalPixels - canvasSize) visit(i + canvasSize);
  }

  // The 1px ring just outside the region is the soft edge of whatever bounds it.
  // Blend the fill into those pixels, more strongly the closer they are to the
  // target color, so no white halo is left along lines but the lines stay visible.
  // This ring never spreads further, so it can't leak through a line.
  const edgeAlpha = new Uint8Array(totalPixels);
  const markEdge = (j) => {
    if (!inRegion[j]) edgeAlpha[j] = 255 - distanceFromTarget(j * 4);
  };
  for (let i = 0; i < totalPixels; i++) {
    if (!inRegion[i]) continue;
    const x = i % canvasSize;
    if (x > 0) markEdge(i - 1);
    if (x < canvasSize - 1) markEdge(i + 1);
    if (i >= canvasSize) markEdge(i - canvasSize);
    if (i < totalPixels - canvasSize) markEdge(i + canvasSize);
  }

  // Write the region into the drawing layer
  drawingGraphics.loadPixels();
  const px = drawingGraphics.pixels;

  for (let i = 0; i < totalPixels; i++) {
    if (!inRegion[i] && !edgeAlpha[i]) continue;

    const idx = i * 4;

    if (inRegion[i]) {
      px[idx] = fillR;
      px[idx + 1] = fillG;
      px[idx + 2] = fillB;
      px[idx + 3] = 255;
    } else {
      // Edge pixel: composite the fill at partial opacity over what's already drawn
      const a = edgeAlpha[i] / 255;
      const existingA = px[idx + 3] / 255;
      const outA = a + existingA * (1 - a);
      px[idx] = (fillR * a + px[idx] * existingA * (1 - a)) / outA;
      px[idx + 1] = (fillG * a + px[idx + 1] * existingA * (1 - a)) / outA;
      px[idx + 2] = (fillB * a + px[idx + 2] * existingA * (1 - a)) / outA;
      px[idx + 3] = outA * 255;
    }
  }

  drawingGraphics.updatePixels();

  if (!hasDrawings) {
    hasDrawings = true;
    enableClearButton();
  }

  redrawCanvas();
}

function getComplementaryColor(color) {
  return [255 - color[0], 255 - color[1], 255 - color[2]];
}

// Memento pattern implementation
function saveState() {
  // Create a memento (snapshot) of the current drawing state
  const memento = drawingGraphics.get();

  // Add to history stack
  historyStack.push(memento);

  // Limit history size
  if (historyStack.length > maxHistorySize) {
    historyStack.shift();
  }

  // Clear redo stack when new action is performed
  redoStack = [];

  updateUndoRedoButtons();
}

function undo() {
  if (historyStack.length === 0) return;

  // Save current state to redo stack
  const currentState = drawingGraphics.get();
  redoStack.push(currentState);

  // Restore previous state
  const previousState = historyStack.pop();
  drawingGraphics.clear();
  drawingGraphics.image(previousState, 0, 0);

  // Update canvas
  hasDrawings = checkIfDrawingHasContent();
  hasDrawings ? enableClearButton() : disableClearButton();

  redrawCanvas();
  updateUndoRedoButtons();
}

function redo() {
  if (redoStack.length === 0) return;

  // Save current state to history
  const currentState = drawingGraphics.get();
  historyStack.push(currentState);

  // Restore redo state
  const redoState = redoStack.pop();
  drawingGraphics.clear();
  drawingGraphics.image(redoState, 0, 0);

  // Update canvas (redoing a Clear leaves the drawing empty)
  hasDrawings = checkIfDrawingHasContent();
  hasDrawings ? enableClearButton() : disableClearButton();

  redrawCanvas();
  updateUndoRedoButtons();
}

function checkIfDrawingHasContent() {
  drawingGraphics.loadPixels();
  for (let i = 3; i < drawingGraphics.pixels.length; i += 4) {
    if (drawingGraphics.pixels[i] > 0) {
      return true;
    }
  }
  return false;
}

function updateUndoRedoButtons() {
  const undoBtn = select("#undo-btn");
  const redoBtn = select("#redo-btn");
  const undoBtnMobile = select("#undo-btn-mobile");
  const redoBtnMobile = select("#redo-btn-mobile");

  if (undoBtn) {
    if (historyStack.length > 0) {
      undoBtn.removeAttribute("disabled");
    } else {
      undoBtn.attribute("disabled", "");
    }
  }

  if (redoBtn) {
    if (redoStack.length > 0) {
      redoBtn.removeAttribute("disabled");
    } else {
      redoBtn.attribute("disabled", "");
    }
  }

  if (undoBtnMobile) {
    if (historyStack.length > 0) {
      undoBtnMobile.removeAttribute("disabled");
    } else {
      undoBtnMobile.attribute("disabled", "");
    }
  }

  if (redoBtnMobile) {
    if (redoStack.length > 0) {
      redoBtnMobile.removeAttribute("disabled");
    } else {
      redoBtnMobile.attribute("disabled", "");
    }
  }
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
      const size = parseInt(btn.dataset.size);
      if (eraseMode) {
        eraserSize = size;
      } else {
        brushSize = size;
      }
      brushSizesShown = false; // mobile: back to the colours
      setBrushCursor();
      updateToolButtons();
    });
  });

  document.querySelectorAll('[data-color]').forEach(swatch => {
    swatch.addEventListener('click', () => {
      brushColor = swatch.dataset.color;
      document.querySelectorAll('[data-color]').forEach(s => {
        s.classList.toggle('selected', s.dataset.color === brushColor);
      });
      // Size dots and the mobile colour chip are drawn in the brush colour
      document.documentElement.style.setProperty('--brush-color', brushColor);
    });
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

  // Share: only shown where the browser can share image files
  const testFile = new File([], 'scrawlface.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [testFile] })) {
    document.querySelectorAll('.share-btn').forEach(btn => {
      btn.hidden = false;
      btn.addEventListener('click', shareImage);
    });
  }
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

  // The handle: tap (or Enter/Space) toggles, a swipe up opens, down closes
  let startY = null;
  let swiped = false;
  handle.addEventListener('pointerdown', (e) => {
    startY = e.clientY;
    swiped = false;
  });
  handle.addEventListener('pointermove', (e) => {
    if (startY === null || swiped) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 12) {
      swiped = true;
      setOpen(dy < 0);
    }
  });
  handle.addEventListener('pointerup', () => { startY = null; });
  handle.addEventListener('pointercancel', () => { startY = null; });
  handle.addEventListener('click', () => {
    if (swiped) {
      swiped = false;
      return;
    }
    setOpen(!bar.classList.contains('open'));
  });

  scrim.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });

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
