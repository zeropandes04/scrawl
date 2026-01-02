let canvas;
const bgColor = [255, 255, 255];
let strokeColor = [0, 0, 0];
let rotation = 0;
let showEyes = true;
let drawMode = false;
let eraseMode = false;
let bucketMode = false;
let scrawlGraphics;
let baseScrawlGraphics;
let originalScrawlGraphics;
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
const drawStrokeWeight = 8;

let intensity = 20;
let scrawlCount = 0;
let brushSize = 8;
let brushColor = '#000000';
let eraserSize = 16;

// Memento pattern for undo/redo
let historyStack = [];
let redoStack = [];
const maxHistorySize = 50;

function setup() {
  // Load scrawl count from localStorage
  const savedCount = localStorage.getItem('scrawlCount');
  scrawlCount = savedCount ? parseInt(savedCount) : 0;
  updateScrawlCounter();

  // CRITICAL: Disable pixel density to prevent coordinate mismatch
  // On retina displays, p5.js doubles canvas resolution but we need 1:1 mapping
  pixelDensity(1);

  canvas = createCanvas(canvasSize, canvasSize);
  canvas.parent("scrawl-container");
  scrawlGraphics = createGraphics(canvasSize, canvasSize);
  baseScrawlGraphics = createGraphics(canvasSize, canvasSize);
  baseScrawlGraphics.drawingContext.willReadFrequently = true;
  originalScrawlGraphics = createGraphics(canvasSize, canvasSize);
  drawingGraphics = createGraphics(canvasSize, canvasSize);
  drawingGraphics.drawingContext.willReadFrequently = true;
  drawingGraphics.clear();
  background(bgColor);

  // Desktop buttons
  select("#generate-btn").mousePressed(generateScrawlface);
  select("#download-btn").mousePressed(() => saveCanvas(canvas, 'scrawl', 'png', 2));
  select("#rotate-btn").mousePressed(rotateCanvas);
  select("#toggle-eyes-btn").mousePressed(toggleEyes);
  select("#clear-drawings-btn").mousePressed(clearDrawings);
  select("#clear-drawings-btn-mobile").mousePressed(clearDrawings);
  select("#undo-btn").mousePressed(undo);
  select("#redo-btn").mousePressed(redo);
  select("#undo-btn-mobile").mousePressed(undo);
  select("#redo-btn-mobile").mousePressed(redo);

  // Mobile buttons
  select("#generate-btn-mobile").mousePressed(generateScrawlface);
  select("#download-btn-mobile").mousePressed(() => saveCanvas(canvas, 'scrawl', 'png', 2));
  select("#rotate-btn-mobile").mousePressed(rotateCanvas);
  select("#toggle-eyes-btn-mobile").mousePressed(() => {
    toggleEyes();
    // Sync mobile button state
    const btn = select("#toggle-eyes-btn-mobile");
    showEyes ? btn.addClass("active") : btn.removeClass("active");
  });
  select("#draw-btn-mobile").mousePressed(() => {
    toggleDrawMode();
    // Sync mobile button state
    const btn = select("#draw-btn-mobile");
    drawMode ? btn.addClass("active") : btn.removeClass("active");
  });
  select("#erase-btn-mobile").mousePressed(() => {
    toggleEraseMode();
    // Sync mobile button state
    const btn = select("#erase-btn-mobile");
    eraseMode ? btn.addClass("active") : btn.removeClass("active");
  });

  // Setup slider
  const intensitySlider = select("#intensity-slider");

  intensitySlider.input(() => {
    intensity = parseInt(intensitySlider.value());
    select("#intensity-value").html(intensity);
  });

  // Setup brush tool dropdown
  setupToolDropdown(
    'brush-tool-dropdown',
    'brush-tool-btn',
    'brush-size-indicator',
    (value) => {
      brushSize = parseInt(value);
      activateBrushMode();
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

  generateScrawlface();
}

function generateScrawlface() {
  drawingGraphics.clear();
  hasDrawings = false;
  disableClearButton();

  // Clear undo/redo history
  clearHistory();

  // Increment and save scrawl count
  scrawlCount++;
  localStorage.setItem('scrawlCount', scrawlCount.toString());
  updateScrawlCounter();

  baseScrawlGraphics.background(bgColor);
  strokeColor = getComplementaryColor(bgColor);
  baseScrawlGraphics.stroke(strokeColor);
  baseScrawlGraphics.strokeWeight(scrawlStrokeWeight);
  baseScrawlGraphics.noFill();

  const centerX = canvasSize / 2;
  const centerY = canvasSize / 2;
  let x = centerX;
  let y = centerY;

  baseScrawlGraphics.beginShape();
  baseScrawlGraphics.curveVertex(x, y);

  for (let i = 0; i < intensity; i++) {
    const controlX1 = x + random(-300, 300);
    const controlY1 = y + random(-300, 300);
    const controlX2 = x + random(-300, 300);
    const controlY2 = y + random(-300, 300);
    const x2 = x + random(-20, 20);
    const y2 = y + random(-20, 20);
    baseScrawlGraphics.bezierVertex(controlX1, controlY1, controlX2, controlY2, x2, y2);
    x = x2;
    y = y2;
  }
  baseScrawlGraphics.endShape();

  const eye1X = random(eyeMargin, canvasSize - eyeMargin - eyeSize - 60);
  const eye1Y = random(eyeMargin, canvasSize - eyeMargin - eyeSize);
  const eye2X = random(eye1X + eyeSize, min(eye1X + 130, canvasSize - eyeMargin - eyeSize));
  const eye2Y = random(eyeMargin, canvasSize - eyeMargin - eyeSize);

  eyePositions = [
    {x: eye1X, y: eye1Y, scale: 1.0},
    {x: eye2X, y: eye2Y, scale: 0.9}
  ];

  originalScrawlGraphics.clear();
  originalScrawlGraphics.image(baseScrawlGraphics, 0, 0);

  updateScrawl();
  redrawCanvas();
}

function updateScrawl() {
  scrawlGraphics.clear();
  scrawlGraphics.image(baseScrawlGraphics, 0, 0);
  scrawlGraphics.image(drawingGraphics, 0, 0);
}

function draw() {
  if (draggedEyeIndex !== -1 && mouseIsPressed) {
    const transformed = getTransformedCoords(mouseX, mouseY);
    eyePositions[draggedEyeIndex].x = transformed.x;
    eyePositions[draggedEyeIndex].y = transformed.y;
    updateScrawl();
    redrawCanvas();
    return;
  }

  if (!drawMode && showEyes && !mouseIsPressed) {
    updateCursor();
  }

  if ((drawMode || eraseMode) && isDrawing && mouseIsPressed && isMouseInCanvas()) {
    const current = getTransformedCoords(mouseX, mouseY);
    const previous = getTransformedCoords(pmouseX, pmouseY);

    if (eraseMode) {
      drawingGraphics.erase();
      drawingGraphics.strokeWeight(eraserSize);
    } else {
      drawingGraphics.stroke(brushColor);
      drawingGraphics.strokeWeight(brushSize);
    }
    drawingGraphics.strokeCap(ROUND);
    drawingGraphics.strokeJoin(ROUND);
    drawingGraphics.line(previous.x, previous.y, current.x, current.y);
    if (eraseMode) {
      drawingGraphics.noErase();
    }

    if (!hasDrawings) {
      hasDrawings = true;
      enableClearButton();
    }

    updateScrawl();
    redrawCanvas();
  }
}

function updateCursor() {
  const transformed = getTransformedCoords(mouseX, mouseY);
  const overEye = eyePositions.some(pos =>
    dist(transformed.x, transformed.y, pos.x, pos.y) < eyeRadius
  );
  cursor(overEye ? 'pointer' : ARROW);
}

function isMouseInCanvas() {
  return mouseX >= 0 && mouseX <= width && mouseY >= 0 && mouseY <= height;
}

function mousePressed() {
  if (!drawMode && !eraseMode && !bucketMode && showEyes) {
    const transformed = getTransformedCoords(mouseX, mouseY);
    const eyeIndex = eyePositions.findIndex(pos =>
      dist(transformed.x, transformed.y, pos.x, pos.y) < eyeRadius
    );

    if (eyeIndex !== -1) {
      draggedEyeIndex = eyeIndex;
      cursor(MOVE);
    }
  }

  if ((drawMode || eraseMode) && isMouseInCanvas()) {
    isDrawing = true;
    // Save state BEFORE starting to draw so we can undo to the clean state
    saveState();
  }

  if (bucketMode && isMouseInCanvas()) {
    // Save state BEFORE bucket fill
    saveState();
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

  if (showEyes) {
    image(scrawlGraphics, 0, 0);
  } else {
    image(originalScrawlGraphics, 0, 0);
  }

  pop();

  if (showEyes) {
    eyePositions.forEach(pos => {
      const rotatedPos = getRotatedPosition(pos.x, pos.y);
      drawEye(rotatedPos.x, rotatedPos.y, pos.scale);
    });
  }
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

function drawEye(x, y, scale = 1.0) {
  const size = eyeSize * scale;
  const pupilSize = 40 * scale;
  const highlightSize = 10 * scale;
  const highlightOffset = 6 * scale;

  push();
  translate(x, y);

  fill(255);
  stroke(0);
  strokeWeight(2);
  ellipse(0, 0, size, size);

  fill(0);
  noStroke();
  ellipse(0, 0, pupilSize, pupilSize);

  fill(255);
  ellipse(highlightOffset, -highlightOffset, highlightSize, highlightSize);

  pop();
}

function rotateCanvas() {
  rotation = (rotation + 90) % 360;
  redrawCanvas();
}

function toggleEyes() {
  showEyes = !showEyes;
  const btn = select("#toggle-eyes-btn");
  showEyes ? btn.addClass("active") : btn.removeClass("active");
  redrawCanvas();
}

function activateBrushMode() {
  if (!drawMode) {
    drawMode = true;
    eraseMode = false;
    bucketMode = false;

    const brushBtn = document.getElementById('brush-tool-btn');
    const eraserBtn = document.getElementById('eraser-tool-btn');
    const bucketBtn = document.getElementById('bucket-tool-btn');

    if (brushBtn) brushBtn.classList.add('active');
    if (eraserBtn) eraserBtn.classList.remove('active');
    if (bucketBtn) bucketBtn.classList.remove('active');

    cursor(CROSS);
  }
}

function activateEraseMode() {
  if (!eraseMode) {
    eraseMode = true;
    drawMode = false;
    bucketMode = false;

    const brushBtn = document.getElementById('brush-tool-btn');
    const eraserBtn = document.getElementById('eraser-tool-btn');
    const bucketBtn = document.getElementById('bucket-tool-btn');

    if (brushBtn) brushBtn.classList.remove('active');
    if (eraserBtn) eraserBtn.classList.add('active');
    if (bucketBtn) bucketBtn.classList.remove('active');

    cursor(CROSS);
  }
}

function activateBucketMode() {
  if (!bucketMode) {
    bucketMode = true;
    drawMode = false;
    eraseMode = false;

    const brushBtn = document.getElementById('brush-tool-btn');
    const eraserBtn = document.getElementById('eraser-tool-btn');
    const bucketBtn = document.getElementById('bucket-tool-btn');

    if (brushBtn) brushBtn.classList.remove('active');
    if (eraserBtn) eraserBtn.classList.remove('active');
    if (bucketBtn) bucketBtn.classList.add('active');

    cursor(CROSS);
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
}

function clearDrawings() {
  drawingGraphics.clear();
  hasDrawings = false;
  disableClearButton();

  // Clear undo/redo history
  clearHistory();

  updateScrawl();
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

function updateScrawlCounter() {
  const counterElement = select("#scrawl-counter");
  if (counterElement) {
    counterElement.html(scrawlCount.toLocaleString());
  }
}

function floodFill(startX, startY, fillColor) {
  startX = Math.floor(startX);
  startY = Math.floor(startY);

  // Create a temporary canvas that matches what the user sees (rotated scrawl)
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvasSize;
  tempCanvas.height = canvasSize;
  const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

  // Draw the rotated scrawl (matching the visual display)
  tempCtx.save();
  tempCtx.translate(canvasSize / 2, canvasSize / 2);
  tempCtx.rotate(rotation * Math.PI / 180);
  tempCtx.translate(-canvasSize / 2, -canvasSize / 2);
  tempCtx.drawImage(baseScrawlGraphics.canvas, 0, 0);
  tempCtx.restore();

  // Check if we clicked on a scrawl line
  const imageData = tempCtx.getImageData(0, 0, canvasSize, canvasSize);
  const data = imageData.data;

  const clickIndex = (startY * canvasSize + startX) * 4;
  const clickR = data[clickIndex];
  const clickG = data[clickIndex + 1];
  const clickB = data[clickIndex + 2];

  // Don't fill if clicking on a scrawl line (non-white pixel)
  if (clickR + clickG + clickB < 700) {
    return;
  }

  // Convert fill color
  const fillR = parseInt(fillColor.slice(1, 3), 16);
  const fillG = parseInt(fillColor.slice(3, 5), 16);
  const fillB = parseInt(fillColor.slice(5, 7), 16);

  // Flood fill to find all pixels to fill (on the rotated view)
  const pixelsToFill = [];
  const stack = [[startX, startY]];
  const visited = new Set();

  // Get target color (the color we're replacing)
  const targetR = clickR;
  const targetG = clickG;
  const targetB = clickB;

  while (stack.length > 0) {
    const [x, y] = stack.pop();

    if (x < 0 || x >= canvasSize || y < 0 || y >= canvasSize) continue;

    const key = `${x},${y}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const idx = (y * canvasSize + x) * 4;
    const pr = data[idx];
    const pg = data[idx + 1];
    const pb = data[idx + 2];

    // If this pixel matches the target color
    if (pr === targetR && pg === targetG && pb === targetB) {
      pixelsToFill.push([x, y]);
      stack.push([x + 1, y]);
      stack.push([x - 1, y]);
      stack.push([x, y + 1]);
      stack.push([x, y - 1]);
    }
  }

  // Now we need to map these rotated screen pixels back to unrotated graphics coordinates
  // and fill them in the drawingGraphics layer
  drawingGraphics.loadPixels();

  for (const [screenX, screenY] of pixelsToFill) {
    // Transform from rotated screen coordinates to unrotated graphics coordinates
    const unrotatedCoords = getTransformedCoords(screenX, screenY);
    const gx = Math.floor(unrotatedCoords.x);
    const gy = Math.floor(unrotatedCoords.y);

    // Make sure we're within bounds
    if (gx >= 0 && gx < canvasSize && gy >= 0 && gy < canvasSize) {
      const idx = (gy * canvasSize + gx) * 4;
      drawingGraphics.pixels[idx] = fillR;
      drawingGraphics.pixels[idx + 1] = fillG;
      drawingGraphics.pixels[idx + 2] = fillB;
      drawingGraphics.pixels[idx + 3] = 255;
    }
  }

  drawingGraphics.updatePixels();

  if (!hasDrawings) {
    hasDrawings = true;
    enableClearButton();
  }

  updateScrawl();
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
      // Short click - activate tool
      onActivate();
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
      // Short tap - activate tool
      onActivate();
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

function setupColorDropdown(dropdownId, buttonId, swatchId, onSelect, onActivate) {
  const dropdown = document.getElementById(dropdownId);
  const button = document.getElementById(buttonId);
  const content = dropdown.querySelector('.custom-dropdown-content');
  const swatch = document.getElementById(swatchId);
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

  button.addEventListener('mouseup', () => {
    clearTimeout(longPressTimer);
    if (!isLongPress) {
      // Short click - activate tool
      onActivate();
    }
  });

  button.addEventListener('mouseleave', () => {
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
      // Short tap - activate tool
      onActivate();
    }
  });

  button.addEventListener('touchcancel', () => {
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

  // Handle option selection
  options.forEach(option => {
    option.addEventListener('click', () => {
      const value = option.getAttribute('data-value');

      // Update selected state
      options.forEach(opt => opt.classList.remove('selected'));
      option.classList.add('selected');

      // Update swatch color
      swatch.style.background = value;

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

      // Activate brush mode
      activateBrushMode();
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
  hasDrawings = historyStack.length > 0 || checkIfDrawingHasContent();
  if (!hasDrawings) {
    disableClearButton();
  }

  updateScrawl();
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

  // Update canvas
  hasDrawings = true;
  enableClearButton();

  updateScrawl();
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
