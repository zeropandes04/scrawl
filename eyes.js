let eye1X, eye1Y, eye2X, eye2Y;
let eyeSize = 100;
let pupilSize = 30;
let irisSize = 60;
let draggingEye1 = false;
let draggingEye2 = false;

function setup() {
  createCanvas(800, 800);
  // initialize the positions of the eyes to the center of the canvas
  eye1X = width/3;
  eye1Y = height/2;
  eye2X = 2*width/3;
  eye2Y = height/2;
}

function draw() {
  background(220, 200); // set a transparent background

  drawEye(eye1X, eye1Y, eyeSize, irisSize, pupilSize);
  drawEye(eye2X, eye2Y, eyeSize, irisSize, pupilSize);
}

function drawEye(x, y, size, irisSize, pupilSize) {
  // draw the pupil
  fill(0);
  ellipse(x, y, pupilSize, pupilSize);

  // draw the white of the eye
  fill(255);
  ellipse(x, y, size, size);

  // draw the iris
  fill(100, 150, 255);
  ellipse(x, y, irisSize, irisSize);
}

function mousePressed() {
  // check if the mouse is inside an eye
  if (dist(mouseX, mouseY, eye1X, eye1Y) < eyeSize/2) {
    draggingEye1 = true;
  }
  if (dist(mouseX, mouseY, eye2X, eye2Y) < eyeSize/2) {
    draggingEye2 = true;
  }
  // update the position of the eyes to the current mouse position
  if (draggingEye1) {
    eye1X = mouseX;
    eye1Y = mouseY;
  }
  if (draggingEye2) {
    eye2X = mouseX;
    eye2Y = mouseY;
  }
}

function mouseReleased() {
  // stop dragging the eyes when the mouse is released
  draggingEye1 = false;
  draggingEye2 = false;
}

function mouseDragged() {
  // update the position of the eyes only if the mouse is currently dragging the eye
  if (draggingEye1) {
    eye1X = mouseX;
    eye1Y = mouseY;
  }
  if (draggingEye2) {
    eye2X = mouseX;
    eye2Y = mouseY;
  }
}
