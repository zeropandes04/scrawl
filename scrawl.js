let canvas;
const bgColor = [255, 255, 255];
let strokeColor = [0, 0, 0];
let rotation = 0;
let showEyes = true;
let drawMode = false;
let scrawlGraphics;
let baseScrawlGraphics;
let originalScrawlGraphics;
let eyePositions = [];
let draggedEyeIndex = -1;
const eyeRadius = 35;
const canvasSize = 800;
const eyeMargin = 200;
const eyeSize = 70;
const scrawlStrokeWeight = 1;
const drawStrokeWeight = 4;

let intensity = 20;

function setup() {
  canvas = createCanvas(canvasSize, canvasSize);
  canvas.parent("scrawl-container");
  scrawlGraphics = createGraphics(canvasSize, canvasSize);
  baseScrawlGraphics = createGraphics(canvasSize, canvasSize);
  originalScrawlGraphics = createGraphics(canvasSize, canvasSize);
  background(bgColor);

  // Desktop buttons
  select("#generate-btn").mousePressed(generateScrawlface);
  select("#download-btn").mousePressed(() => saveCanvas(canvas, 'scrawl', 'png', 2));
  select("#rotate-btn").mousePressed(rotateCanvas);
  select("#toggle-eyes-btn").mousePressed(toggleEyes);
  select("#draw-btn").mousePressed(toggleDrawMode);
  select("#clear-drawings-btn").mousePressed(clearDrawings);

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

  // Setup slider
  const intensitySlider = select("#intensity-slider");

  intensitySlider.input(() => {
    intensity = parseInt(intensitySlider.value());
    select("#intensity-value").html(intensity);
  });

  generateScrawlface();
}

function generateScrawlface() {
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

  if (drawMode && mouseIsPressed && isMouseInCanvas()) {
    const current = getTransformedCoords(mouseX, mouseY);
    const previous = getTransformedCoords(pmouseX, pmouseY);

    baseScrawlGraphics.stroke(strokeColor);
    baseScrawlGraphics.strokeWeight(drawStrokeWeight);
    baseScrawlGraphics.line(previous.x, previous.y, current.x, current.y);
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
  if (!drawMode && showEyes) {
    const transformed = getTransformedCoords(mouseX, mouseY);
    const eyeIndex = eyePositions.findIndex(pos =>
      dist(transformed.x, transformed.y, pos.x, pos.y) < eyeRadius
    );

    if (eyeIndex !== -1) {
      draggedEyeIndex = eyeIndex;
      cursor(MOVE);
    }
  }
}

function mouseReleased() {
  if (draggedEyeIndex !== -1) {
    draggedEyeIndex = -1;
    cursor(ARROW);
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

function toggleDrawMode() {
  drawMode = !drawMode;
  const btn = select("#draw-btn");

  if (drawMode) {
    btn.addClass("active");
    cursor(CROSS);
  } else {
    btn.removeClass("active");
    cursor(ARROW);
  }
}

function clearDrawings() {
  baseScrawlGraphics.clear();
  baseScrawlGraphics.image(originalScrawlGraphics, 0, 0);
  updateScrawl();
  redrawCanvas();
}

function getComplementaryColor(color) {
  return [255 - color[0], 255 - color[1], 255 - color[2]];
}
