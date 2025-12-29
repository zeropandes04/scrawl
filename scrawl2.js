let canvas;
let bgColor = [255, 255, 255];
let strokeColor = [0, 0, 0];
let button, downloadButton, toggleEyesButton;
let eyesVisible = true;
let needsRedraw = true;

function setup() {
  canvas = createCanvas(800, 800);
  canvas.parent("scrawl-container");
  background(bgColor);

  button = createButton("Scrawl");
  button.parent("button-container");
  button.mousePressed(onButtonPressed);

  downloadButton = createButton("Download PNG");
  downloadButton.parent("button-container");
  downloadButton.mousePressed(onDownloadButtonPressed);

  toggleEyesButton = createButton("Toggle Eyes");
  toggleEyesButton.parent("button-container");
  toggleEyesButton.mousePressed(onToggleEyes);
}

function onButtonPressed() {
  // clear canvas and set stroke color
  background(bgColor);
  strokeColor = getComplementaryColor(bgColor);
  stroke(strokeColor);
  noFill();

  // create scrawl using bezier curves
  let centerX = width / 2; // set centerX to the center of the canvas
  let centerY = height / 2; // set centerY to the center of the canvas
  let x = centerX;
  let y = centerY;
  let x2, y2;
  beginShape();
  curveVertex(x, y);
  for (let i = 0; i < 20; i++) {
    let controlX1 = x + random(-300, 300);
    let controlY1 = y + random(-300, 300);
    let controlX2 = x + random(-300, 300);
    let controlY2 = y + random(-300, 300);
    x2 = x + random(-20, 20);
    y2 = y + random(-20, 20);
    bezierVertex(controlX1, controlY1, controlX2, controlY2, x2, y2);
    x = x2;
    y = y2;
  }
  endShape();

  // draw eyes if eyesVisible is true
  if (eyesVisible) {
    let eye1X = random(0, width - 130);
    let eye1Y = random(0, height);
    let eye2X = random(eye1X + 70, eye1X + 130);
    let eye2Y = random(0, height);
    drawEye(eye1X, eye1Y);
    drawEye(eye2X, eye2Y);
  }

  needsRedraw = true; // set needsRedraw to true
}

function onToggleEyes() {
  eyesVisible = !eyesVisible; // toggle eyesVisible variable
  if (needsRedraw) {
    redraw(); // redraw the canvas if needed
    needsRedraw = false; // reset needsRedraw to false
  }
}


function drawEye(x, y) {
  push();
  translate(x, y);
  fill(255);
  stroke(0);
  strokeWeight(2); // set stroke weight to 1
  ellipse(0, 0, 70, 70);
  fill(0);
  ellipse(0, 0, 40, 40);
  pop();
  strokeWeight(2); // set stroke weight back to 2
}

function onDownloadButtonPressed() {
  saveCanvas(canvas, 'scrawl', 'png', 2);
}

function getComplementaryColor(color) {
  let r = color[0];
  let g = color[1];
  let b = color[2];
  return [255 - r, 255 - g, 255 - b];
}
