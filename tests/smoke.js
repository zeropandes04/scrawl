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
  await page.waitForFunction(() => typeof eyePositions !== 'undefined' && eyePositions.length === 2);
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
  check('undo disabled at start', (await state()).undoDis);

  // Drag eye 0
  const e0 = await ev(() => ({ ...eyePositions[0] }));
  await drag([e0.x, e0.y], [e0.x + 40, e0.y + 30]);
  const e0b = await ev(() => ({ ...eyePositions[0] }));
  check('eye drag moves eye', Math.abs(e0b.x - e0.x - 40) < 3 && Math.abs(e0b.y - e0.y - 30) < 3, JSON.stringify(e0b));
  check('eye drag not in undo history', (await state()).h === 0);

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
    // find a pixel not on scrawl or drawing
    baseScrawlGraphics.loadPixels(); drawingGraphics.loadPixels();
    for (let y = 20; y < 780; y += 7) for (let x = 20; x < 780; x += 7) {
      const i = (y * 800 + x) * 4;
      if (baseScrawlGraphics.pixels[i] > 250 && drawingGraphics.pixels[i + 3] === 0) return [x, y];
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
  check('ctrl+z mid-stroke ignored', s.h === hMid, `mid ${hMid} -> ${JSON.stringify(s)}`);

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

  // Export has canvas size regardless of zoom
  await ev('viewZoom = 3; viewPan = {x: 100, y: 50}');
  const dims = await ev(() => { const im = exportImage(); return [im.width, im.height, viewZoom]; });
  check('export is 800x800 and restores zoom', dims[0] === 800 && dims[1] === 800 && dims[2] === 3, JSON.stringify(dims));

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
