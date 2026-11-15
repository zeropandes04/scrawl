let canvas;
const bgColor = [255, 255, 255];
let strokeColor = [0, 0, 0];
let rotation = 0;
let showScrawl = true;
let moveEyesMode = false;
let drawMode = false;
let eraseMode = false;
let bucketMode = false;
let baseScrawlGraphics;
let drawingGraphics;
let eyePositions = [];
let draggedEyeIndex = -1;
let hasDrawings = false;
let isDrawing = false;
const eyeRadius = 35;
const canvasSize = 800;
const eyeMargin = 200;
const eyeSize = 70;
const scrawlStrokeWeight = 1;

let intensity = 20;
let eyeStyles = ['classic', 'classic']; // style of each eye (see drawEye)
let brushSize = 8;
let brushColor = '#000000';
let eraserSize = 16;

// Scrawl segments still to be drawn by the draw-in animation
let scrawlQueue = [];
const scrawlDrawInFrames = 30; // ~0.5s at 60fps, whatever the intensity

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
  canvasElement.addEventListener('touchstart', (e) => {
    if (drawMode || eraseMode || bucketMode || moveEyesMode) {
      e.preventDefault();
    }
  }, { passive: false });

  canvasElement.addEventListener('touchmove', (e) => {
    if (drawMode || eraseMode || moveEyesMode) {
      e.preventDefault();
    }
  }, { passive: false });

  canvasElement.addEventListener('touchend', (e) => {
    if (drawMode || eraseMode || bucketMode || moveEyesMode) {
      e.preventDefault();
    }
  }, { passive: false });

  baseScrawlGraphics = createGraphics(canvasSize, canvasSize);
  baseScrawlGraphics.drawingContext.willReadFrequently = true;
  drawingGraphics = createGraphics(canvasSize, canvasSize);
  drawingGraphics.drawingContext.willReadFrequently = true;
  drawingGraphics.clear();
  background(bgColor);

  // Desktop buttons
  select("#generate-btn").mousePressed(generateScrawlface);
  select("#rotate-btn").mousePressed(rotateCanvas);
  select("#toggle-eyes-btn").mousePressed(toggleEyes);
  select("#move-eyes-btn").mousePressed(toggleMoveEyesMode);
  select("#clear-drawings-btn").mousePressed(clearDrawings);
  select("#clear-drawings-btn-mobile").mousePressed(clearDrawings);
  select("#undo-btn").mousePressed(undo);
  select("#redo-btn").mousePressed(redo);
  select("#save-btn").mousePressed(saveImage);
  select("#save-btn-mobile").mousePressed(saveImage);

  const undoBtnMobile = select("#undo-btn-mobile");
  if (undoBtnMobile) {
    undoBtnMobile.mousePressed(undo);
  }

  const redoBtnMobile = select("#redo-btn-mobile");
  if (redoBtnMobile) {
    redoBtnMobile.mousePressed(redo);
  }

  // Mobile buttons
  select("#generate-btn-mobile").mousePressed(generateScrawlface);
  select("#rotate-btn-mobile-controls").mousePressed(rotateCanvas);
  select("#toggle-eyes-btn-mobile").mousePressed(toggleEyes);

  // Setup slider
  const intensitySlider = select("#intensity-slider");

  intensitySlider.input(() => {
    intensity = parseInt(intensitySlider.value());
    select("#intensity-value").html(intensity);
    tickLcd("intensity-value");
  });
  // Releasing the slider shows the new intensity straight away, unless that
  // would discard a drawing (then it applies to the next Generate)
  intensitySlider.changed(() => {
    if (!hasDrawings) generateScrawlface();
  });

  // Setup brush tool dropdown
  setupToolDropdown(
    'brush-tool-dropdown',
    'brush-tool-btn',
    'brush-size-indicator',
    (value) => {
      brushSize = parseInt(value);
      activateBrushMode();
      updateMobileToolButtons();
      setBrushCursor();
    },
    () => {
      activateBrushMode();
    }
  );

  // Setup color swatches palette
  setupColorSwatches();

  // Setup eraser tool dropdown
  setupToolDropdown(
    'eraser-tool-dropdown',
    'eraser-tool-btn',
    'eraser-size-indicator',
    (value) => {
      eraserSize = parseInt(value);
      activateEraseMode();
      updateMobileToolButtons();
      setBrushCursor();
    },
    () => {
      activateEraseMode();
    }
  );

  // Setup bucket tool button
  const bucketBtn = document.getElementById('bucket-tool-btn');
  if (bucketBtn) {
    bucketBtn.addEventListener('click', () => {
      activateBucketMode();
    });
  }

  // Setup mobile toolbar
  setupMobileToolbar();

  // Setup mobile intensity slider
  const intensitySliderMobile = select("#intensity-slider-mobile");
  if (intensitySliderMobile) {
    intensitySliderMobile.input(() => {
      intensity = parseInt(intensitySliderMobile.value());
      select("#intensity-value-mobile").html(intensity);
      tickLcd("intensity-value-mobile");
      // Sync with desktop slider
      select("#intensity-slider").value(intensity);
      select("#intensity-value").html(intensity);
    });
    intensitySliderMobile.changed(() => {
      if (!hasDrawings) generateScrawlface();
    });
  }

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
  activateBrushMode();

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

  const centerX = canvasSize / 2;
  const centerY = canvasSize / 2;
  let x = centerX;
  let y = centerY;

  // Each segment is one bezier curve; draw() draws them in a few per frame
  scrawlQueue = [];
  for (let i = 0; i < intensity; i++) {
    const controlX1 = x + random(-300, 300);
    const controlY1 = y + random(-300, 300);
    const controlX2 = x + random(-300, 300);
    const controlY2 = y + random(-300, 300);
    const x2 = x + random(-20, 20);
    const y2 = y + random(-20, 20);
    scrawlQueue.push([x, y, controlX1, controlY1, controlX2, controlY2, x2, y2]);
    x = x2;
    y = y2;
  }
  fitScrawlToCanvas(scrawlQueue);
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

// The random curves only cover about the middle half of the canvas, so
// scale them up evenly (same shape) until the scrawl's longer side spans
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
  // Scrawl draw-in after Generate: a few segments per frame
  if (scrawlQueue.length > 0) {
    drawScrawlSegments(ceil(intensity / scrawlDrawInFrames));
    redrawCanvas();
  }

  if (draggedEyeIndex !== -1 && mouseIsPressed) {
    const transformed = getTransformedCoords(mouseX, mouseY);
    // Keep the whole eye on the canvas so it can't be dragged out of reach
    eyePositions[draggedEyeIndex].x = constrain(transformed.x, eyeRadius, canvasSize - eyeRadius);
    eyePositions[draggedEyeIndex].y = constrain(transformed.y, eyeRadius, canvasSize - eyeRadius);
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
    strokeLength += distance;
    const velocity = constrain(distance, 0, 20);
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
// ~44px touch target.
function findEyeAt(x, y) {
  let reach = max(eyeRadius, 22 * canvasSize / canvas.elt.clientWidth);
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

  if (!drawMode && !eraseMode && !bucketMode && moveEyesMode) {
    const transformed = getTransformedCoords(mouseX, mouseY);
    const eyeIndex = findEyeAt(transformed.x, transformed.y);

    if (eyeIndex !== -1) {
      draggedEyeIndex = eyeIndex;
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
  }

  if (bucketMode && isMouseInCanvas()) {
    // floodFill saves undo state itself, only when it actually fills.
    // For bucket fill, we need to work with screen coordinates directly
    // because we need to detect what's visible at the clicked position
    floodFill(Math.floor(mouseX), Math.floor(mouseY), brushColor);
  }
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
}

function getTransformedCoords(mx, my) {
  const cx = mx - width / 2;
  const cy = my - height / 2;
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
  translate(width / 2, height / 2);
  rotate(radians(rotation));
  imageMode(CENTER);

  // Draw the layers straight onto the canvas (no intermediate composite),
  // so each frame while drawing only copies what's needed
  if (showScrawl) {
    image(baseScrawlGraphics, 0, 0);
  }
  image(drawingGraphics, 0, 0);

  pop();

  // Always show eyes (window = the main canvas in p5 global mode)
  eyePositions.forEach((pos, i) => {
    const rotatedPos = getRotatedPosition(pos.x, pos.y);
    drawEye(window, rotatedPos.x, rotatedPos.y, pos.scale, eyeStyles[i]);
  });
}

function getRotatedPosition(x, y) {
  const cx = x - canvasSize / 2;
  const cy = y - canvasSize / 2;
  const angle = radians(rotation);
  const cosA = cos(angle);
  const sinA = sin(angle);

  return {
    x: cx * cosA - cy * sinA + width / 2,
    y: cx * sinA + cy * cosA + height / 2
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
  lowlid: ['lowlid', 'lowlid'],
  sunny: ['sunny', 'sunny'],
  blue: ['blue', 'blue']
};
const eyeColors = {
  lidBlue: '#7B9CF2',
  lidRed: '#F0504A',
  irisBlue: '#8ED3F5',
  irisAqua: '#A8EBE3',
  amber: '#F5A32A',
  lidYellow: '#F8D24A'
};
const almondW = 40;  // half the width of an almond eye
const almondC = 33;  // control-point height of its top and bottom curves

function drawEye(g, x, y, scale, style) {
  g.push();
  g.translate(x, y);
  g.scale(scale);
  g.stroke(0);
  g.strokeWeight(3);
  g.strokeCap(ROUND);
  g.strokeJoin(ROUND);

  if (style === 'classic') {
    // The original googly eye
    g.strokeWeight(2);
    g.fill(255);
    g.ellipse(0, 0, eyeSize, eyeSize);
    g.noStroke();
    g.fill(0);
    g.ellipse(0, 0, 40, 40);
    g.fill(255);
    g.ellipse(6, -6, 10, 10);
  } else if (style === 'lashes') {
    almondEye(g, 255);
    iris(g, 0, 0, 26, 0);
    lashes(g, -1, 5, 14);
  } else if (style === 'closed') {
    // Closed eye: just the lower lid with lashes hanging down
    g.noFill();
    g.beginShape();
    g.vertex(-almondW, 0);
    g.bezierVertex(-almondW / 2, almondC * 0.8, almondW / 2, almondC * 0.8, almondW, 0);
    g.endShape();
    lashes(g, 1, 5, 12, 0.8);
  } else if (style === 'sleepy') {
    // Heavy coloured lid covering the top half
    almondEye(g, 255);
    iris(g, 0, 6, 26, 0);
    lid(g, eyeColors.lidBlue, 0);
  } else if (style === 'glam') {
    // Red crescent lid, blue iris, lower lashes
    almondEye(g, 255);
    iris(g, 0, 2, 30, eyeColors.irisBlue);
    lid(g, eyeColors.lidRed, 0.35);
    lashes(g, 1, 4, 10);
  } else if (style === 'spiky') {
    // Aqua iris with lashes all round
    lashes(g, -1, 7, 14);
    lashes(g, 1, 5, 12);
    almondEye(g, 255);
    iris(g, 0, 0, 30, eyeColors.irisAqua);
  } else if (style === 'dot') {
    // Plain outline with a small dot pupil
    almondEye(g, 255);
    g.fill(0);
    g.ellipse(0, 0, 12, 12);
  } else if (style === 'side') {
    // Big black iris pushed against the edge, clipped by the eye shape
    almondEye(g, 255);
    const ctx = g.drawingContext;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-almondW, 0);
    ctx.bezierCurveTo(-almondW / 2, -almondC, almondW / 2, -almondC, almondW, 0);
    ctx.bezierCurveTo(almondW / 2, almondC, -almondW / 2, almondC, -almondW, 0);
    ctx.clip();
    g.noStroke();
    g.fill(0);
    g.ellipse(18, 0, 44, 44);
    g.fill(255);
    g.ellipse(10, -7, 8, 8);
    ctx.restore();
    // Redraw the outline over the iris
    g.stroke(0);
    almondEye(g, null);
  } else if (style === 'amber' || style === 'blue') {
    // Whole eye filled with colour, dot pupil
    almondEye(g, style === 'amber' ? eyeColors.amber : eyeColors.lidBlue);
    g.fill(0);
    g.ellipse(0, 0, 14, 14);
    g.noStroke();
    g.fill(255);
    g.ellipse(3, -3, 4, 4);
  } else if (style === 'lowlid') {
    // Blue lower lid pushing the iris up
    almondEye(g, 255);
    iris(g, 0, -4, 26, 0);
    g.fill(eyeColors.lidBlue);
    g.beginShape();
    g.vertex(-almondW, 0);
    g.bezierVertex(-almondW / 2, almondC, almondW / 2, almondC, almondW, 0);
    g.bezierVertex(almondW / 2, almondC * 0.2, -almondW / 2, almondC * 0.2, -almondW, 0);
    g.endShape(CLOSE);
  } else if (style === 'sunny') {
    // Yellow lid, black iris, lower lashes
    almondEye(g, 255);
    iris(g, 0, 3, 26, 0);
    lid(g, eyeColors.lidYellow, 0.2);
    lashes(g, 1, 4, 10);
  }

  g.pop();
}

// Almond outline: two curves meeting in points at each side
// (fillColor null = outline only)
function almondEye(g, fillColor) {
  fillColor === null ? g.noFill() : g.fill(fillColor);
  g.beginShape();
  g.vertex(-almondW, 0);
  g.bezierVertex(-almondW / 2, -almondC, almondW / 2, -almondC, almondW, 0);
  g.bezierVertex(almondW / 2, almondC, -almondW / 2, almondC, -almondW, 0);
  g.endShape(CLOSE);
}

// A coloured iris (or plain black when color is 0) with a pupil and highlight
function iris(g, x, y, size, color) {
  g.fill(color);
  g.ellipse(x, y, size, size);
  g.noStroke();
  if (color !== 0) {
    g.fill(0);
    g.ellipse(x, y, size * 0.4, size * 0.4);
  }
  g.fill(255);
  g.ellipse(x + size * 0.2, y - size * 0.2, size * 0.25, size * 0.25);
  g.stroke(0);
}

// Upper lid: from the top curve down to a lower curve at `depth`
// (0 = straight across the middle, 1 = no lid)
function lid(g, color, depth) {
  g.fill(color);
  g.beginShape();
  g.vertex(-almondW, 0);
  g.bezierVertex(-almondW / 2, -almondC, almondW / 2, -almondC, almondW, 0);
  g.bezierVertex(almondW / 2, -almondC * depth, -almondW / 2, -almondC * depth, -almondW, 0);
  g.endShape(CLOSE);
}

// Lashes along the top (side -1) or bottom (side 1) curve, pointing outwards
function lashes(g, side, count, length, curve = 1) {
  const c = almondC * curve * side;
  for (let i = 0; i < count; i++) {
    const t = 0.2 + 0.6 * i / (count - 1);
    const x = bezierPoint(-almondW, -almondW / 2, almondW / 2, almondW, t);
    const y = bezierPoint(0, c, c, 0, t);
    // Fan out from a point on the other side of the eye
    const dx = x;
    const dy = y + 20 * side;
    const d = Math.hypot(dx, dy);
    g.line(x, y, x + dx / d * length, y + dy / d * length);
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
                  'dot', 'side', 'amber', 'blue', 'lowlid', 'sunny'];
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

// Saves exactly what is on screen (eyes, rotation, scrawl visibility)
function saveImage() {
  saveCanvas(canvas, 'scrawlface', 'png');
}

// Hands the image to the phone's share sheet (messages, socials, ...)
function shareImage() {
  canvas.elt.toBlob(blob => {
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
  select("#toggle-eyes-btn").html(showScrawl ? "Hide scrawl" : "Show scrawl");
  select("#toggle-eyes-btn-mobile").html(showScrawl ? "Hide Scrawl" : "Show Scrawl");
}

function toggleMoveEyesMode() {
  moveEyesMode = !moveEyesMode;
  const btn = select("#move-eyes-btn");
  moveEyesMode ? btn.addClass("active") : btn.removeClass("active");

  // Deactivate all drawing tools when entering move eyes mode
  if (moveEyesMode) {
    deactivateAllTools();
  }

  // Reset cursor when exiting move eyes mode
  if (!moveEyesMode) {
    cursor(ARROW);
  }

  updateMobileToolButtons();
}

function activateBrushMode() {
  if (!drawMode) {
    drawMode = true;
    eraseMode = false;
    bucketMode = false;

    // Deactivate move eyes mode
    if (moveEyesMode) {
      moveEyesMode = false;
      const moveEyesBtn = select("#move-eyes-btn");
      if (moveEyesBtn) moveEyesBtn.removeClass("active");
    }

    const brushBtn = document.getElementById('brush-tool-btn');
    const eraserBtn = document.getElementById('eraser-tool-btn');
    const bucketBtn = document.getElementById('bucket-tool-btn');

    if (brushBtn) brushBtn.classList.add('active');
    if (eraserBtn) eraserBtn.classList.remove('active');
    if (bucketBtn) bucketBtn.classList.remove('active');

    setBrushCursor();
    updateMobileToolButtons();
  }
}

function activateEraseMode() {
  if (!eraseMode) {
    eraseMode = true;
    drawMode = false;
    bucketMode = false;

    // Deactivate move eyes mode
    if (moveEyesMode) {
      moveEyesMode = false;
      const moveEyesBtn = select("#move-eyes-btn");
      if (moveEyesBtn) moveEyesBtn.removeClass("active");
    }

    const brushBtn = document.getElementById('brush-tool-btn');
    const eraserBtn = document.getElementById('eraser-tool-btn');
    const bucketBtn = document.getElementById('bucket-tool-btn');

    if (brushBtn) brushBtn.classList.remove('active');
    if (eraserBtn) eraserBtn.classList.add('active');
    if (bucketBtn) bucketBtn.classList.remove('active');

    setBrushCursor();
    updateMobileToolButtons();
  }
}

// Cursor for the brush and eraser: a ring the size the tool draws on screen
function setBrushCursor() {
  const size = eraseMode ? eraserSize : brushSize;
  // Even diameter (min 4px) so the hotspot lands on a whole pixel
  const d = max(4, 2 * round(size * canvas.elt.clientWidth / canvasSize / 2));
  const box = d + 4;
  const c = box / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}">` +
    `<circle cx="${c}" cy="${c}" r="${d / 2 + 1}" fill="none" stroke="white"/>` +
    `<circle cx="${c}" cy="${c}" r="${d / 2}" fill="none" stroke="black"/></svg>`;
  canvas.elt.style.cursor = `url('data:image/svg+xml,${encodeURIComponent(svg)}') ${c} ${c}, crosshair`;
}

// The canvas is scaled to fit the window, so the ring has to be rescaled too
function windowResized() {
  if (drawMode || eraseMode) setBrushCursor();
}

function activateBucketMode() {
  if (!bucketMode) {
    bucketMode = true;
    drawMode = false;
    eraseMode = false;

    // Deactivate move eyes mode
    if (moveEyesMode) {
      moveEyesMode = false;
      const moveEyesBtn = select("#move-eyes-btn");
      if (moveEyesBtn) moveEyesBtn.removeClass("active");
    }

    const brushBtn = document.getElementById('brush-tool-btn');
    const eraserBtn = document.getElementById('eraser-tool-btn');
    const bucketBtn = document.getElementById('bucket-tool-btn');

    if (brushBtn) brushBtn.classList.remove('active');
    if (eraserBtn) eraserBtn.classList.remove('active');
    if (bucketBtn) bucketBtn.classList.add('active');

    cursor(CROSS);
    updateMobileToolButtons();
  }
}

function deactivateAllTools() {
  drawMode = false;
  eraseMode = false;
  bucketMode = false;

  const brushBtn = document.getElementById('brush-tool-btn');
  const eraserBtn = document.getElementById('eraser-tool-btn');
  const bucketBtn = document.getElementById('bucket-tool-btn');

  if (brushBtn) brushBtn.classList.remove('active');
  if (eraserBtn) eraserBtn.classList.remove('active');
  if (bucketBtn) bucketBtn.classList.remove('active');

  cursor(ARROW);
  updateMobileToolButtons();
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

function floodFill(startX, startY, fillColor) {
  startX = Math.floor(startX);
  startY = Math.floor(startY);

  // Max per-channel difference from the clicked colour that still counts as
  // "the same area". Absorbs the soft anti-aliased edges of lines without
  // leaking through them (measured: higher values start crossing 1px lines).
  const fillTolerance = 64;

  // Build a temporary canvas that matches what the user sees: background,
  // rotated scrawl (if shown) and rotated drawings. The fill is bounded by all of it.
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvasSize;
  tempCanvas.height = canvasSize;
  const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

  const drawRotated = (source) => {
    tempCtx.save();
    tempCtx.translate(canvasSize / 2, canvasSize / 2);
    tempCtx.rotate(rotation * Math.PI / 180);
    tempCtx.translate(-canvasSize / 2, -canvasSize / 2);
    tempCtx.drawImage(source, 0, 0);
    tempCtx.restore();
  };

  tempCtx.fillStyle = `rgb(${bgColor.join(',')})`;
  tempCtx.fillRect(0, 0, canvasSize, canvasSize);

  if (showScrawl) {
    drawRotated(baseScrawlGraphics.canvas);

    // Don't fill if clicking on a scrawl line (non-white pixel)
    const [lineR, lineG, lineB] = tempCtx.getImageData(startX, startY, 1, 1).data;
    if (lineR + lineG + lineB < 700) {
      return;
    }
  }

  drawRotated(drawingGraphics.canvas);

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

  // Flood fill to find all pixels to fill (on the rotated view).
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

  // Now we need to map these rotated screen pixels back to unrotated graphics coordinates
  // and fill them in the drawingGraphics layer. Same rotation as getTransformedCoords(),
  // but applied to pixel centres and rounded: flooring pixel corners lands 1px off at
  // 90/180/270 degrees (cos(90deg) is 6e-17, not 0), shifting the fill across lines.
  drawingGraphics.loadPixels();
  const px = drawingGraphics.pixels;

  const angle = -radians(rotation);
  const cosA = cos(angle);
  const sinA = sin(angle);

  for (let i = 0; i < totalPixels; i++) {
    if (!inRegion[i] && !edgeAlpha[i]) continue;

    // Transform from rotated screen coordinates to unrotated graphics coordinates
    const cx = (i % canvasSize) + 0.5 - width / 2;
    const cy = Math.floor(i / canvasSize) + 0.5 - height / 2;
    const gx = Math.round(cx * cosA - cy * sinA + canvasSize / 2 - 0.5);
    const gy = Math.round(cx * sinA + cy * cosA + canvasSize / 2 - 0.5);

    // Make sure we're within bounds
    if (gx < 0 || gx >= canvasSize || gy < 0 || gy >= canvasSize) continue;

    const idx = (gy * canvasSize + gx) * 4;

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

function setupToolDropdown(dropdownId, buttonId, labelId, onSelect, onActivate) {
  const dropdown = document.getElementById(dropdownId);
  const button = document.getElementById(buttonId);
  const content = dropdown.querySelector('.custom-dropdown-content');
  const label = document.getElementById(labelId);
  const options = dropdown.querySelectorAll('.custom-dropdown-option');

  let longPressTimer = null;
  let isLongPress = false;

  // Long-press handling for mouse
  button.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isLongPress = false;
    longPressTimer = setTimeout(() => {
      isLongPress = true;
      openDropdown();
    }, 500);
  });

  button.addEventListener('mouseup', (e) => {
    clearTimeout(longPressTimer);
    if (!isLongPress) {
      // Short click - open the size list from the size indicator, otherwise activate tool
      e.target.closest('.size-toggle') ? toggleDropdown() : onActivate();
    }
  });

  button.addEventListener('mouseleave', (e) => {
    clearTimeout(longPressTimer);
  });

  // Long-press handling for touch
  button.addEventListener('touchstart', (e) => {
    e.preventDefault();
    isLongPress = false;
    longPressTimer = setTimeout(() => {
      isLongPress = true;
      openDropdown();
    }, 500);
  });

  button.addEventListener('touchend', (e) => {
    e.preventDefault();
    clearTimeout(longPressTimer);
    if (!isLongPress) {
      // Short tap - open the size list from the size indicator, otherwise activate tool
      e.target.closest('.size-toggle') ? toggleDropdown() : onActivate();
    }
  });

  button.addEventListener('touchcancel', (e) => {
    clearTimeout(longPressTimer);
  });

  // Function to open dropdown
  function openDropdown() {
    // Close all other dropdowns
    document.querySelectorAll('.custom-dropdown-content.show').forEach(el => {
      el.classList.remove('show');
      const parentDropdown = el.closest('.tool-dropdown, .custom-dropdown');
      if (parentDropdown) {
        const btn = parentDropdown.querySelector('.tool-dropdown-button, .custom-dropdown-button');
        if (btn) btn.classList.remove('open');
      }
    });

    content.classList.add('show');
    button.classList.add('open');
  }

  function toggleDropdown() {
    if (content.classList.contains('show')) {
      content.classList.remove('show');
      button.classList.remove('open');
    } else {
      openDropdown();
    }
  }

  // Handle option selection
  options.forEach(option => {
    option.addEventListener('click', () => {
      const value = option.getAttribute('data-value');

      // Update selected state
      options.forEach(opt => opt.classList.remove('selected'));
      option.classList.add('selected');

      // Update size indicator circle
      const sizeValue = parseInt(value);
      if (label) {
        label.style.width = sizeValue + 'px';
        label.style.height = sizeValue + 'px';
      }

      // Close dropdown
      content.classList.remove('show');
      button.classList.remove('open');

      // Call callback
      onSelect(value);
    });
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target)) {
      content.classList.remove('show');
      button.classList.remove('open');
    }
  });
}

function setupColorSwatches() {
  const swatches = document.querySelectorAll('.color-swatch-btn');

  swatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
      const color = swatch.getAttribute('data-color');

      // Update selected state
      swatches.forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');

      // Update brush color
      brushColor = color;

      // Update brush size indicator color
      document.getElementById('brush-size-indicator').style.background = color;
    });
  });
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

function setupMobileToolbar() {
  // Toggle mobile menu
  const toggleMenuBtn = document.getElementById('toggle-mobile-menu');
  const expandedMenu = document.getElementById('mobile-expanded-menu');

  if (toggleMenuBtn && expandedMenu) {
    const closeMenu = () => {
      expandedMenu.style.display = 'none';
      toggleMenuBtn.textContent = '⋯';
      toggleMenuBtn.setAttribute('aria-expanded', 'false');
    };

    toggleMenuBtn.addEventListener('click', () => {
      if (expandedMenu.style.display === 'none') {
        expandedMenu.style.display = 'block';
        toggleMenuBtn.textContent = '×';
        toggleMenuBtn.setAttribute('aria-expanded', 'true');
      } else {
        closeMenu();
      }
    });

    // The open menu covers the canvas, so close it after actions whose
    // result is only visible there
    ['rotate-btn-mobile-controls', 'toggle-eyes-btn-mobile', 'move-eyes-btn-mobile', 'clear-drawings-btn-mobile'].forEach(id => {
      document.getElementById(id).addEventListener('click', closeMenu);
    });
    expandedMenu.querySelectorAll('[data-eye-set], .mix-eyes-btn').forEach(btn => btn.addEventListener('click', closeMenu));
  }

  // Mobile tool buttons
  const brushBtnMobile = document.getElementById('brush-tool-btn-mobile');
  const bucketBtnMobile = document.getElementById('bucket-tool-btn-mobile');
  const eraserBtnMobile = document.getElementById('eraser-tool-btn-mobile');

  if (brushBtnMobile) {
    brushBtnMobile.addEventListener('click', () => {
      activateBrushMode();
    });
  }

  if (bucketBtnMobile) {
    bucketBtnMobile.addEventListener('click', () => {
      activateBucketMode();
    });
  }

  if (eraserBtnMobile) {
    eraserBtnMobile.addEventListener('click', () => {
      activateEraseMode();
    });
  }

  // Mobile color swatches
  const mobileSwatches = document.querySelectorAll('.color-swatch-btn-mobile');
  mobileSwatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
      const color = swatch.getAttribute('data-color');

      // Update selected state
      mobileSwatches.forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');

      // Update brush color
      brushColor = color;

      // Sync with desktop swatch
      const desktopSwatches = document.querySelectorAll('.color-swatch-btn');
      desktopSwatches.forEach(s => {
        if (s.getAttribute('data-color') === color) {
          s.classList.add('selected');
        } else {
          s.classList.remove('selected');
        }
      });

      // Update brush size indicator color
      document.getElementById('brush-size-indicator').style.background = color;
    });
  });

  // Mobile size buttons
  const mobileSizeBtns = document.querySelectorAll('.mobile-size-btn');
  mobileSizeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const size = parseInt(btn.getAttribute('data-size'));

      // Update selected state
      mobileSizeBtns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');

      // The picker edits the eraser while erasing, the brush otherwise
      if (eraseMode) {
        eraserSize = size;
        // Update desktop eraser indicator
        const indicator = document.getElementById('eraser-size-indicator');
        if (indicator) {
          indicator.style.width = size + 'px';
          indicator.style.height = size + 'px';
        }
      } else {
        brushSize = size;
        // Update desktop brush indicator
        const indicator = document.getElementById('brush-size-indicator');
        if (indicator) {
          indicator.style.width = size + 'px';
          indicator.style.height = size + 'px';
        }
      }
    });
  });

  // Share button: only shown where the browser can share image files
  const shareBtn = document.getElementById('share-btn-mobile');
  const testFile = new File([], 'scrawlface.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [testFile] })) {
    shareBtn.hidden = false;
    shareBtn.addEventListener('click', shareImage);
  }

  // Mobile move eyes button
  const moveEyesBtnMobile = document.getElementById('move-eyes-btn-mobile');
  if (moveEyesBtnMobile) {
    moveEyesBtnMobile.addEventListener('click', () => {
      toggleMoveEyesMode();
    });
  }
}

function updateMobileToolButtons() {
  const brushBtnMobile = document.getElementById('brush-tool-btn-mobile');
  const bucketBtnMobile = document.getElementById('bucket-tool-btn-mobile');
  const eraserBtnMobile = document.getElementById('eraser-tool-btn-mobile');

  if (brushBtnMobile) {
    brushBtnMobile.classList.toggle('active', drawMode);
  }
  if (bucketBtnMobile) {
    bucketBtnMobile.classList.toggle('active', bucketMode);
  }
  if (eraserBtnMobile) {
    eraserBtnMobile.classList.toggle('active', eraseMode);
  }

  const moveEyesBtnMobile = document.getElementById('move-eyes-btn-mobile');
  if (moveEyesBtnMobile) {
    moveEyesBtnMobile.classList.toggle('active', moveEyesMode);
  }

  // The size picker shows the eraser's size while erasing, the brush's otherwise
  const activeSize = eraseMode ? eraserSize : brushSize;
  document.querySelectorAll('.mobile-size-btn').forEach(btn => {
    btn.classList.toggle('selected', parseInt(btn.getAttribute('data-size')) === activeSize);
  });
  document.getElementById('mobile-size-label').textContent = eraseMode ? 'Eraser Size' : 'Brush Size';

  // Tell assistive tech which tool is selected (desktop and mobile buttons)
  [['bucket-tool-btn', bucketMode], ['brush-tool-btn', drawMode], ['eraser-tool-btn', eraseMode], ['move-eyes-btn', moveEyesMode]].forEach(([id, on]) => {
    document.getElementById(id).setAttribute('aria-pressed', on);
    document.getElementById(id + '-mobile').setAttribute('aria-pressed', on);
  });
}
