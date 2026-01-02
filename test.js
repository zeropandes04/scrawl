let canvas;
let scrawlGraphics;
let fillGraphics;
let bucketMode = false;
let drawMode = false;
let brushColor = '#FF0000';
const canvasSize = 600;

function setup() {
  canvas = createCanvas(canvasSize, canvasSize);
  canvas.parent("test-container");

  // Graphics layer for the scrawl lines
  scrawlGraphics = createGraphics(canvasSize, canvasSize);
  scrawlGraphics.background(255);
  // Enable efficient pixel reading for flood fill
  scrawlGraphics.drawingContext.willReadFrequently = true;

  // Graphics layer for fills
  fillGraphics = createGraphics(canvasSize, canvasSize);
  fillGraphics.clear();
  // Enable efficient pixel reading for flood fill
  fillGraphics.drawingContext.willReadFrequently = true;

  // Draw test shapes
  drawTestShapes();

  // Setup buttons
  setupButtons();

  // Initial render
  render();
}

function drawTestShapes() {
  scrawlGraphics.stroke(0);
  scrawlGraphics.strokeWeight(3); // Use thicker lines for clearer boundaries
  scrawlGraphics.noFill();

  // Circle
  scrawlGraphics.circle(300, 300, 200);

  // Square
  scrawlGraphics.rect(100, 100, 100, 100);

  // Triangle
  scrawlGraphics.triangle(450, 100, 500, 180, 400, 180);
}

function setupButtons() {
  document.getElementById('bucket-btn').addEventListener('click', () => {
    bucketMode = true;
    drawMode = false;
    document.getElementById('bucket-btn').classList.add('active');
    document.getElementById('draw-btn').classList.remove('active');
    console.log('Bucket mode activated');
  });

  document.getElementById('draw-btn').addEventListener('click', () => {
    drawMode = true;
    bucketMode = false;
    document.getElementById('draw-btn').classList.add('active');
    document.getElementById('bucket-btn').classList.remove('active');
    console.log('Draw mode activated');
  });

  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      brushColor = btn.dataset.color;
      document.getElementById('current-color').style.background = brushColor;
      console.log('Color changed to:', brushColor);
    });
  });

  document.getElementById('clear-btn').addEventListener('click', () => {
    fillGraphics.clear();
    render();
    console.log('Fills cleared');
  });
}

function draw() {
  // Only update when drawing
  if (drawMode && mouseIsPressed && isMouseInCanvas()) {
    scrawlGraphics.stroke(0);
    scrawlGraphics.strokeWeight(3);
    scrawlGraphics.strokeCap(ROUND);
    scrawlGraphics.line(pmouseX, pmouseY, mouseX, mouseY);
    render();
  }
}

function mousePressed() {
  if (bucketMode && isMouseInCanvas()) {
    console.log('=== BUCKET CLICK ===');
    console.log('Position:', mouseX, mouseY);
    console.log('Color:', brushColor);
    floodFill(mouseX, mouseY, brushColor);
  }
}

function isMouseInCanvas() {
  return mouseX >= 0 && mouseX < canvasSize && mouseY >= 0 && mouseY < canvasSize;
}

function render() {
  background(255);
  image(scrawlGraphics, 0, 0);
  image(fillGraphics, 0, 0);
}

function floodFill(startX, startY, hexColor) {
  startX = Math.floor(startX);
  startY = Math.floor(startY);

  console.log('FloodFill starting at:', startX, startY);

  // Convert hex to RGB
  const fillR = parseInt(hexColor.slice(1, 3), 16);
  const fillG = parseInt(hexColor.slice(3, 5), 16);
  const fillB = parseInt(hexColor.slice(5, 7), 16);

  console.log('Fill color RGB:', fillR, fillG, fillB);

  // Load pixels from both layers
  scrawlGraphics.loadPixels();
  fillGraphics.loadPixels();

  // Get the color at the starting point
  const startIndex = (startY * canvasSize + startX) * 4;

  // Check what's at the starting point
  const scrawlPixel = {
    r: scrawlGraphics.pixels[startIndex],
    g: scrawlGraphics.pixels[startIndex + 1],
    b: scrawlGraphics.pixels[startIndex + 2]
  };

  const fillPixel = {
    r: fillGraphics.pixels[startIndex],
    g: fillGraphics.pixels[startIndex + 1],
    b: fillGraphics.pixels[startIndex + 2],
    a: fillGraphics.pixels[startIndex + 3]
  };

  console.log('Start pixel - Scrawl:', scrawlPixel, 'Fill:', fillPixel);

  // Don't fill if we're clicking on a scrawl line
  if (scrawlPixel.r < 255 || scrawlPixel.g < 255 || scrawlPixel.b < 255) {
    console.log('Clicked on scrawl line - aborting');
    return;
  }

  // Don't fill if already filled with this color
  if (fillPixel.a > 0) {
    if (Math.abs(fillPixel.r - fillR) < 5 &&
        Math.abs(fillPixel.g - fillG) < 5 &&
        Math.abs(fillPixel.b - fillB) < 5) {
      console.log('Already filled with this color - aborting');
      return;
    }
  }

  // Flood fill algorithm
  const stack = [[startX, startY]];
  const visited = new Set();
  let pixelsFilled = 0;

  while (stack.length > 0) {
    const [x, y] = stack.pop();

    // Bounds check
    if (x < 0 || x >= canvasSize || y < 0 || y >= canvasSize) continue;

    // Already visited check
    const key = `${x},${y}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const idx = (y * canvasSize + x) * 4;

    // Check scrawl layer - stop at any non-white pixel
    const sr = scrawlGraphics.pixels[idx];
    const sg = scrawlGraphics.pixels[idx + 1];
    const sb = scrawlGraphics.pixels[idx + 2];

    if (sr < 255 || sg < 255 || sb < 255) {
      // This is a scrawl line - stop here
      continue;
    }

    // Check fill layer - stop at different colored fills
    const fa = fillGraphics.pixels[idx + 3];
    if (fa > 0) {
      const fr = fillGraphics.pixels[idx];
      const fg = fillGraphics.pixels[idx + 1];
      const fb = fillGraphics.pixels[idx + 2];

      // If it's a different color fill, stop
      if (Math.abs(fr - fillR) > 5 ||
          Math.abs(fg - fillG) > 5 ||
          Math.abs(fb - fillB) > 5) {
        continue;
      }
      // If it's the same color, continue filling (allows expanding fills)
    }

    // Fill this pixel
    fillGraphics.pixels[idx] = fillR;
    fillGraphics.pixels[idx + 1] = fillG;
    fillGraphics.pixels[idx + 2] = fillB;
    fillGraphics.pixels[idx + 3] = 255;
    pixelsFilled++;

    // Add neighbors to stack
    stack.push([x + 1, y]);
    stack.push([x - 1, y]);
    stack.push([x, y + 1]);
    stack.push([x, y - 1]);
  }

  console.log('Filled', pixelsFilled, 'pixels');

  fillGraphics.updatePixels();
  render();
}
