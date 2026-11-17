// Smoke test for Scrawlface: the happy path (generate -> eyes -> doodle ->
// undo/redo) plus the undo/fill/pinch edge cases from CLAUDE.md, on a desktop
// and a phone-sized viewport. Not part of the site; nothing loads it.
//
// Needs Playwright, installed outside the repo (no package.json here):
//   npm install --prefix ~/.scrawl-test playwright
//   npx --prefix ~/.scrawl-test playwright install chromium
// Run from the repo root:
//   NODE_PATH=~/.scrawl-test/node_modules node tests/smoke.js
//
// Optional: P5_PATH=/path/to/p5.min.js serves p5 from disk instead of the CDN.
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const repo = path.resolve(__dirname, '..');
const p5src = process.env.P5_PATH ? fs.readFileSync(process.env.P5_PATH) : null;
const shotsDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'scrawl-smoke-'));

let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
}

async function run(label, contextOpts) {
  console.log(`\n=== ${label} ===`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext(contextOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  if (p5src) await page.route('**/p5.min.js', r => r.fulfill({ body: p5src, contentType: 'application/javascript' }));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await page.goto('file://' + path.join(repo, 'index.html'));
  // The app opens on a blank start: create the first scrawl from its button
  await page.waitForFunction(() => typeof drawingGraphics !== 'undefined');
  await page.click('#blank-cta-btn');
  await page.waitForFunction(() => eyePositions.length === 2);
  await page.waitForFunction(() => scrawlQueue.length === 0);

  const mobile = !!contextOpts.isMobile;
  const touch = mobile;
  const box = await page.locator('#scrawl-container canvas').boundingBox();
  const ev = (fn) => page.evaluate(fn);
  // canvas px -> page px (no zoom/rotation at start)
  const toPage = async (x, y) => {
    const s = await ev(() => ({ w: width, h: height }));
    return { x: box.x + (x + (s.w - 800) / 2) * box.width / s.w, y: box.y + (y + (s.h - 800) / 2) * box.height / s.h };
  };
  const drag = async (from, to, steps = 10) => {
    const a = await toPage(...from), b = await toPage(...to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps);
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await page.waitForTimeout(50);
  };
  const tool = async (t) => ev(`setTool('${t}')`);
  const state = () => ev(() => ({ h: historyStack.length, r: redoStack.length, has: hasDrawings,
    undoDis: document.getElementById('undo-btn-mobile').disabled,
    clearDis: document.getElementById('clear-drawings-btn').disabled }));

  check('starts on eyes tool', await ev(() => currentTool()) === 'eyes');

  // Idle, the frame loop is paused; New runs it for the draw-in, then it pauses again
  await page.waitForTimeout(100);
  check('frame loop paused when idle', !(await ev(() => isLooping())));
  const during = await ev(() => { generateScrawlface(); return isLooping(); });
  await page.waitForFunction(() => scrawlQueue.length === 0);
  await page.waitForTimeout(100);
  check('frame loop runs for the draw-in, then pauses', during && !(await ev(() => isLooping())));

  // The canvas is the 4:5 picture, covering its area (which masks the rest), centred
  const fit = await ev(() => {
    const c = canvas.elt.getBoundingClientRect();
    const b = document.getElementById('scrawl-container').getBoundingClientRect();
    return { ratio: c.width / c.height, coverW: c.width / b.width, coverH: c.height / b.height,
      exact: Math.min(c.width / b.width, c.height / b.height),
      dx: Math.abs((c.left - b.left) - (b.right - c.right)), dy: Math.abs((c.top - b.top) - (b.bottom - c.bottom)) };
  });
  // Both test windows have room for a 4:5 canvas area, so nothing is masked
  const areaRatio = await ev(() => { const b = document.getElementById('scrawl-container').getBoundingClientRect(); return b.width / b.height; });
  check('canvas area is 4:5 by default', Math.abs(areaRatio - 0.8) < 0.01, areaRatio.toFixed(3));
  check('canvas is a centred 4:5 box covering its area', Math.abs(fit.ratio - 0.8) < 0.01 && fit.coverW >= 0.999 && fit.coverH >= 0.999 &&
    fit.exact < 1.01 && fit.dx < 2 && fit.dy < 2, JSON.stringify(fit));
  check('undo disabled at start', (await state()).undoDis);

  // Drag eye 0
  const e0 = await ev(() => ({ ...eyePositions[0] }));
  await drag([e0.x, e0.y], [e0.x + 40, e0.y + 30]);
  const e0b = await ev(() => ({ ...eyePositions[0] }));
  check('eye drag moves eye', Math.abs(e0b.x - e0.x - 40) < 3 && Math.abs(e0b.y - e0.y - 30) < 3, JSON.stringify(e0b));
  check('eye drag not in undo history', (await state()).h === 0);

  // On a screen short enough to mask the picture, an eye can't be dragged
  // under the mask: it stops where it's still wholly visible
  if (mobile) {
    const size = page.viewportSize();
    await page.setViewportSize({ width: 320, height: 520 });
    await page.waitForTimeout(300);
    const masked = await ev(() => { const v = visibleCanvasRect(); return v.y0 > 1; });
    const start = await ev(() => { const e = eyePositions[0]; const p = getRotatedPosition(e.x, e.y);
      const c = canvas.elt.getBoundingClientRect(); const k = c.width / width; return { x: c.left + p.x * k, y: c.top + p.y * k }; });
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(start.x, start.y - 60 * i); await page.waitForTimeout(20); }
    await page.mouse.up();
    const seen = await ev(() => {
      const e = eyePositions[0]; const p = getRotatedPosition(e.x, e.y); const v = visibleCanvasRect();
      return { top: p.y - eyeRadius, visibleTop: v.y0 };
    });
    check('eye stops at the visible edge when the picture is masked', masked && seen.top >= seen.visibleTop - 0.5 && seen.top < seen.visibleTop + 5, JSON.stringify(seen));
    await page.setViewportSize(size);
    await page.waitForTimeout(300);
  }

  // Brush stroke
  await tool('brush');
  await drag([150, 650], [350, 700]);
  let s = await state();
  check('stroke adds 1 undo step', s.h === 1 && s.has && !s.undoDis && !s.clearDis, JSON.stringify(s));

  // Tap = dot
  const p = await toPage(600, 650);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(50);
  check('tap adds 1 undo step', (await state()).h === 2);

  // Bucket fill on empty area, then undo restores
  await tool('fill');
  const before = await ev(() => { drawingGraphics.loadPixels(); return drawingGraphics.pixels.reduce((a, v, i) => i % 4 === 3 ? a + (v > 0) : a, 0); });
  const pt = await ev(() => {
    // find a pixel not on scrawl or drawing (both layers transparent there)
    baseScrawlGraphics.loadPixels(); drawingGraphics.loadPixels();
    for (let y = 20; y < 780; y += 7) for (let x = 20; x < 780; x += 7) {
      // The paint layer is bigger than the scrawl square, which sits in its middle
      const i = (y * 800 + x) * 4;
      const j = ((y + layerOffset) * layerSize + x + layerOffset) * 4;
      if (baseScrawlGraphics.pixels[i + 3] === 0 && drawingGraphics.pixels[j + 3] === 0) return [x, y];
    }
  });
  const fp = await toPage(...pt);
  await page.mouse.click(fp.x, fp.y);
  await page.waitForTimeout(100);
  const after = await ev(() => { drawingGraphics.loadPixels(); return drawingGraphics.pixels.reduce((a, v, i) => i % 4 === 3 ? a + (v > 0) : a, 0); });
  check('fill paints pixels + 1 undo step', after > before && (await state()).h === 3, `${before}->${after}`);
  await ev('undo()');
  const afterUndo = await ev(() => { drawingGraphics.loadPixels(); return drawingGraphics.pixels.reduce((a, v, i) => i % 4 === 3 ? a + (v > 0) : a, 0); });
  check('undo after fill restores exactly', afterUndo === before, `${afterUndo} vs ${before}`);
  await ev('redo()');
  check('redo after fill', (await state()).r === 0 && (await state()).h === 3);

  // Undo all, redo all
  await ev('undo(); undo(); undo(); undo();');
  s = await state();
  check('undo to empty', s.h === 0 && s.r === 3 && !s.has && s.clearDis && s.undoDis, JSON.stringify(s));
  await ev('redo(); redo(); redo();');
  s = await state();
  check('redo all', s.h === 3 && s.r === 0 && s.has, JSON.stringify(s));

  // Clear is undoable
  await ev('clearDrawings()');
  s = await state();
  check('clear is an undo step', s.h === 4 && !s.has, JSON.stringify(s));
  await ev('undo()');
  check('undo clear restores', (await state()).has);

  // Rapid actions
  await tool('brush');
  for (let i = 0; i < 30; i++) await drag([100 + i * 20, 100], [100 + i * 20, 160], 3);
  s = await state();
  check('history capped at maxHistorySize', s.h === 25, JSON.stringify(s));
  for (let i = 0; i < 40; i++) await ev('undo()');
  s = await state();
  check('rapid undo stops at cap', s.h === 0 && s.r === 25, JSON.stringify(s));

  // Keyboard undo while a stroke is in progress must not corrupt history
  await ev('redo()');
  const a = await toPage(200, 400), b = await toPage(300, 450);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  const hMid = (await state()).h;
  await page.keyboard.press('Control+z');
  await page.mouse.move(a.x, b.y, { steps: 5 });
  await page.mouse.up();
  s = await state();
  // Ignored, and the stroke becomes one step when it ends
  check('ctrl+z mid-stroke ignored', s.h === hMid + 1 && s.r === 0, `mid ${hMid} -> ${JSON.stringify(s)}`);

  // Fill during scrawl draw-in should not leak past unfinished lines
  await ev('hasDrawings = false; generateScrawlface()');
  const queued = await ev(() => scrawlQueue.length);
  await ev(`setTool('fill'); floodFill(${pt[0]}, ${pt[1]}, '#CC0000')`);
  check('fill finishes scrawl draw-in first', await ev(() => scrawlQueue.length) === 0, `queued was ${queued}`);

  // New scrawl (N key) in the middle of a stroke: the rest of the stroke is dropped
  await ev('hasDrawings = false; generateScrawlface()');
  await page.waitForFunction(() => scrawlQueue.length === 0);
  await tool('brush');
  const n1 = await toPage(200, 200), n2 = await toPage(300, 300);
  await page.mouse.move(n1.x, n1.y); await page.mouse.down();
  await page.mouse.move(n2.x, n2.y, { steps: 3 });
  await ev('hasDrawings = false; generateScrawlface()');
  await page.mouse.move(n1.x, n2.y, { steps: 5 });
  await page.mouse.up();
  s = await state();
  check('generate mid-stroke leaves clean canvas', s.h === 0 && !s.has, JSON.stringify(s));

  // Generate resets everything
  await ev('generateScrawlface()');
  await page.waitForFunction(() => scrawlQueue.length === 0);
  s = await state();
  check('generate clears history & drawing', s.h === 0 && s.r === 0 && !s.has && s.undoDis, JSON.stringify(s));
  check('generate selects eyes tool', await ev(() => currentTool()) === 'eyes');

  // Degenerate pinch (both fingers on one point) must not break the view
  await ev(() => {
    const t = { clientX: 100, clientY: 100 };
    startPinch([t, t]); movePinch([t, t]); endPinch();
  });
  check('degenerate pinch keeps zoom finite', await ev(() => Number.isFinite(viewZoom) && Number.isFinite(viewPan.x)), await ev(() => JSON.stringify({ viewZoom, viewPan })));

  // Export is the 4:5 frame regardless of zoom
  await ev('viewZoom = 3; viewPan = {x: 100, y: 50}');
  const dims = await ev(() => { const im = exportImage(); return [im.width, im.height, viewZoom]; });
  check('export is 800x1000 and keeps the zoom', dims[0] === 800 && dims[1] === 1000 && dims[2] === 3, JSON.stringify(dims));

  // ---- Painting past the scrawl square ----
  await ev('viewZoom = 1; viewPan = {x: 0, y: 0}; rotation = 0; redrawCanvas()');
  const alphaAt = (x, y) => ev(`drawingGraphics.drawingContext.getImageData(${x} + layerOffset, ${y} + layerOffset, 1, 1).data[3]`);
  const historyPixels = () => ev(() => historyStack.reduce((a, m) => a + m.w * m.h, 0));

  // A stroke above the square, in the frame's extra room (100 units; the
  // top of it may be masked, so not too near the edge)
  const outside = [[300, -25], [500, -25]];
  await tool('brush');
  await drag(outside[0], outside[1]);
  const mid = [(outside[0][0] + outside[1][0]) / 2, (outside[0][1] + outside[1][1]) / 2];
  check('stroke paints past the scrawl square', await alphaAt(...mid) > 0);
  check('stroke memento covers only the stroke', (await historyPixels()) < 60000, `${await historyPixels()} px`);
  await ev('undo()');
  check('undo removes the stroke outside the square', await alphaAt(...mid) === 0);
  await ev('redo()');
  check('redo puts it back', await alphaAt(...mid) > 0);

  // Fill the background: reaches the corners of the paint layer
  await ev('clearDrawings(); clearHistory()');
  await ev(`floodFill(${pt[0]}, ${pt[1]}, '#66BD0F')`);
  const far = await ev('[-layerOffset, canvasSize + layerOffset - 1]');
  check('fill spreads past the square', await alphaAt(far[0], far[0]) === 255 && await alphaAt(far[1], far[1]) === 255);
  await ev('undo()');
  check('undo fill outside the square', await alphaAt(far[0], far[0]) === 0 && !(await ev('hasDrawings')));

  // Pinch / hold cancelling a stroke in progress leaves no trace (Redo is
  // kept: nothing happened)
  await ev(() => { beginStroke(); pressChangedDrawing = true; isDrawing = true;
    drawingGraphics.fill(0); dab(-100, 100, 20); });
  await ev('cancelPressMark()');
  s = await state();
  check('cancelled stroke: no paint, no step, redo kept', await alphaAt(-100, 100) === 0 && s.h === 0 && s.r === 1, JSON.stringify(s));

  // Memory: many big fills stay within the budget, and the last one can be undone
  for (let i = 0; i < 12; i++) {
    await ev(`floodFill(${pt[0]}, ${pt[1]}, ${JSON.stringify(['#CC0000', '#001A80'][i % 2])})`);
  }
  const hp = await historyPixels();
  check('history stays within its memory limit', hp <= await ev('maxHistoryPixels') && (await state()).h >= 1, `${hp} px, ${(await state()).h} steps`);

  // Export: always the 4:5 frame, whatever is drawn or the rotation
  await ev('clearDrawings(); clearHistory()');
  const exportOf = () => ev(() => {
    const im = exportImage();
    const ctx = im.getContext('2d');
    const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
    return { size: [im.width, im.height], top: at(400, 50), corners: [at(2, 2), at(797, 2), at(2, 997), at(797, 997)] };
  });
  let ex = await exportOf();
  check('export of square-only art is 800x1000', ex.size[0] === 800 && ex.size[1] === 1000, JSON.stringify(ex.size));
  await ev(() => { drawingGraphics.fill('#CC0000'); drawingGraphics.noStroke(); drawingGraphics.ellipse(layerOffset + 400, layerOffset - 50, 40, 40); });
  ex = await exportOf();
  check('paint above the square is in the picture', ex.size[1] === 1000 && ex.top[0] > 150 && ex.top[1] < 60, JSON.stringify(ex));
  // Turned and the background filled: no empty corners in the picture
  await ev(`drawingGraphics.clear(); rotation = 28; floodFill(${pt[0]}, ${pt[1]}, '#66BD0F')`);
  ex = await exportOf();
  const green = c => c[0] < 130 && c[1] > 150 && c[2] < 60;
  check('turned + background fill: corners painted, same size', ex.size[0] === 800 && ex.size[1] === 1000 && ex.corners.every(green), JSON.stringify(ex));
  await ev('rotation = 0; redrawCanvas()');

  check('no page errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: path.join(shotsDir, `${label}.png`) });
  await browser.close();
}

(async () => {
  await run('desktop', { viewport: { width: 1280, height: 800 } });
  await run('mobile', { ...devices['Pixel 5'] });
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  console.log(`Screenshots: ${shotsDir}`);
  process.exit(failures ? 1 : 0);
})();
