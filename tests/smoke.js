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
// The app bundles everything (p5.js, fonts), so the tests need no network.
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const repo = path.resolve(__dirname, '..');
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
  // The onboarding (intro, tips) is tested in tests/onboarding.js; here it's
  // marked as done so it doesn't cover the page
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('onboarding_completed', '1');
      localStorage.setItem('tips_seen', JSON.stringify(['drag-eyes', 'gestures', 'fill', 'save', 'help-key']));
    } catch (e) {}
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  // Serves the repo at a made-up http origin (file:// requests can't be
  // intercepted); `block` lists paths to refuse
  const serveRepo = (p, block = []) => p.route('http://scrawl.test/**', r => {
    const rel = new URL(r.request().url()).pathname;
    const file = path.join(repo, rel);
    if (block.some(b => rel.endsWith(b)) || !fs.existsSync(file)) return r.abort();
    const type = { '.html': 'text/html', '.js': 'application/javascript', '.woff2': 'font/woff2' }[path.extname(file)];
    r.fulfill({ body: fs.readFileSync(file), contentType: type });
  });

  // Before setup() runs, the page already shows the default tool's options
  // (Eyes), so nothing switches when the script starts. p5 is refused here,
  // so setup() never runs and the page stays as its markup.
  {
    const early = await ctx.newPage();
    await serveRepo(early, ['vendor/p5.min.js']);
    await early.goto('http://scrawl.test/index.html');
    await early.waitForTimeout(300);
    const seen = await early.evaluate(() => {
      const shown = el => !!el && el.getClientRects().length > 0;
      const q = s => document.querySelector(s);
      return { setupRan: typeof drawingGraphics !== 'undefined',
        sizes: shown(q('.sidebar .size-keys')) || shown(q('[data-strip="sizes"]')),
        colours: shown(q('.sidebar .swatches')) || shown(q('[data-strip="colours"]')),
        eyes: shown(q('.sidebar [data-for="eyes"]')) || shown(q('[data-strip="eyes"]')) };
    });
    check('before the script starts, only the Eyes options show', !seen.setupRan && seen.eyes && !seen.sizes && !seen.colours, JSON.stringify(seen));
    await early.close();
  }

  // Offline: every request outside the repo is refused, and the app still
  // starts, draws and shows its wordmark in one of the bundled fonts
  {
    const off = await ctx.newPage();
    const remote = [];
    await off.route(/^https?:\/\/(?!scrawl\.test\/)/, r => { remote.push(r.request().url()); r.abort(); });
    await serveRepo(off);
    await off.goto('http://scrawl.test/index.html');
    await off.waitForFunction(() => typeof drawingGraphics !== 'undefined');
    await off.click('#blank-cta-btn');
    await off.waitForFunction(() => scrawlQueue.length === 0 && eyePositions.length === 2);
    const font = await off.evaluate(async () => {
      await document.fonts.ready;
      const family = getComputedStyle(document.documentElement).getPropertyValue('--wordmark-font').split(',')[0].trim();
      return { family, loaded: document.fonts.check(`32px ${family}`, 'Scrawlface') && [...document.fonts].some(f => f.status === 'loaded') };
    });
    check('works offline: no remote requests, app runs, wordmark font loaded', remote.length === 0 && font.loaded, JSON.stringify({ remote, font }));
    await off.close();
  }
  await page.goto('file://' + path.join(repo, 'index.html'));
  // The app opens on a blank start: create the first scrawl from its button
  await page.waitForFunction(() => typeof drawingGraphics !== 'undefined');
  // Blank start: the keys that need a scrawlface are off (Rotate, Hide lines, Save,
  // Share / Download and the sidebar's ... menu)
  const blankKeys = "['rotate-btn', 'toggle-eyes-btn', 'toggle-eyes-btn-mobile', 'save-more-btn', 'image-btn', 'image-btn-mobile']" +
    ".map(id => document.getElementById(id)).concat([...document.querySelectorAll('.gallery-save-btn')]).map(b => b.disabled)";
  const offAtStart = await page.evaluate(blankKeys);
  await page.click('#blank-cta-btn');
  await page.waitForFunction(() => eyePositions.length === 2);
  await page.waitForFunction(() => scrawlQueue.length === 0);

  const mobile = !!contextOpts.isMobile;
  const touch = mobile;
  const box = await page.locator('#scrawl-container canvas').boundingBox();
  const ev = (fn) => page.evaluate(fn);
  // canvas units -> page px (no zoom/rotation at start)
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
  const onAfterNew = await page.evaluate(blankKeys);
  // (Save stays off until there's a change to save)
  check('blank start disables Rotate, Hide lines, Save and Share; New enables all but Save',
    offAtStart.every(Boolean) && onAfterNew.slice(0, 6).every(d => !d), JSON.stringify({ offAtStart, onAfterNew }));
  // Tool order, sidebar and phone row alike: the colour tools together, the eraser last
  const toolOrder = await ev(() => [...document.querySelectorAll('.tool-keys')].map(g => [...g.querySelectorAll('[data-tool]')].map(b => b.dataset.tool).join(' ')));
  check('tools ordered eyes, brush, fill, eraser', toolOrder.length === 2 && toolOrder.every(o => o === 'eyes brush fill eraser'), JSON.stringify(toolOrder));
  // The brush starts at the 4th of the 6 sizes, and that's the selected key
  const brushStart = await ev(() => ({ size: brushSize,
    fourth: [...new Set([...document.querySelectorAll('[data-size]')].map(b => +b.dataset.size))].sort((a, b) => a - b)[3],
    selected: [...document.querySelectorAll('.size-key.selected')].map(b => +b.dataset.size) }));
  check('brush starts at the 4th size', brushStart.size === brushStart.fourth && brushStart.selected.every(n => n === brushStart.fourth), JSON.stringify(brushStart));
  // ...and so does the eraser (its key is the one marked when it's picked)
  const eraserStart = await ev(() => { setTool('eraser'); const r = { size: eraserSize,
    selected: [...document.querySelectorAll('.size-key.selected')].map(b => +b.dataset.size) }; setTool('eyes'); return r; });
  check('eraser starts at the 4th size', eraserStart.size === brushStart.fourth && eraserStart.selected.every(n => n === brushStart.fourth), JSON.stringify(eraserStart));

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
  // Loops: folded away by default; opened, its fader sets the next scrawl's loops
  const loopsId = mobile ? '#intensity-slider-mobile' : '#intensity-slider';
  const folded = await ev(() => [...document.querySelectorAll('.loops-setting')].every(d => !d.open));
  const loopsDefaults = await ev(() => ({ intensity, sliders: [...document.querySelectorAll('input[type=range]')].map(r => [r.min, r.max, r.value].join('/')),
    lines: [...document.querySelectorAll('.loops-value, .lcd')].map(e => e.textContent) }));
  check('Loops go 1-30 and start at 15', loopsDefaults.intensity === 15 && loopsDefaults.sliders.every(t => t === '1/30/15') &&
    loopsDefaults.lines.every(t => t === '15'), JSON.stringify(loopsDefaults));
  if (mobile) { await page.click('#toggle-mobile-menu'); await page.waitForTimeout(400); }
  const summary = page.locator('.loops-setting summary').nth(mobile ? 1 : 0);
  await summary.click();
  await page.locator(loopsId).fill('30');
  const max30 = await ev(() => (generateScrawlface(), scrawlQueue.length));
  check('a 30-loop scrawl has 30 segments', max30 === 30, String(max30));
  await page.locator(loopsId).fill('4');
  const loops4 = await ev(() => ({ intensity, lines: [...document.querySelectorAll('.loops-value')].map(e => e.textContent),
    segments: (generateScrawlface(), scrawlQueue.length) }));
  check('Loops folded by default; fader sets the next scrawl', folded && loops4.intensity === 4 && loops4.lines.every(t => t === '4') && loops4.segments === 4, JSON.stringify(loops4));
  await page.locator(loopsId).fill('15'); // back to the default
  await summary.click(); // fold it again
  if (mobile) { await page.click('#toggle-mobile-menu'); await page.waitForTimeout(400); }
  await page.waitForFunction(() => scrawlQueue.length === 0);

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
    // (positions in units; the layers have res pixels per unit, and the paint
    // layer is bigger than the scrawl square, which sits in its middle)
    // Each layer is read once, then looked up by pixel
    const read = g => ({ w: g.elt.width, data: g.drawingContext.getImageData(0, 0, g.elt.width, g.elt.height).data });
    const scrawl = read(baseScrawlGraphics), paint = read(drawingGraphics);
    const alpha = (l, x, y) => l.data[(Math.floor(y * res) * l.w + Math.floor(x * res)) * 4 + 3];
    for (let y = 20; y < 780; y += 7) for (let x = 20; x < 780; x += 7) {
      if (alpha(scrawl, x, y) === 0 && alpha(paint, x + layerOffset, y + layerOffset) === 0) return [x, y];
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
  check('export is 1080x1350 and keeps the zoom', dims[0] === 1080 && dims[1] === 1350 && dims[2] === 3, JSON.stringify(dims));

  // ---- Painting past the scrawl square ----
  await ev('viewZoom = 1; viewPan = {x: 0, y: 0}; rotation = 0; redrawCanvas()');
  // Paint at a position in units (relative to the scrawl square)
  const alphaAt = (x, y) => ev(`drawingGraphics.drawingContext.getImageData(Math.floor((${x} + layerOffset) * res), Math.floor((${y} + layerOffset) * res), 1, 1).data[3]`);
  const historyPixels = () => ev(() => historyStack.reduce((a, m) => a + m.w * m.h, 0));

  // A stroke above the square, in the frame's extra room (100 units; the
  // top of it may be masked, so not too near the edge)
  const outside = [[300, -25], [500, -25]];
  await tool('brush');
  await drag(outside[0], outside[1]);
  const mid = [(outside[0][0] + outside[1][0]) / 2, (outside[0][1] + outside[1][1]) / 2];
  check('stroke paints past the scrawl square', await alphaAt(...mid) > 0);
  check('stroke memento covers only the stroke', (await historyPixels()) < 110000, `${await historyPixels()} px`);
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
    return { size: [im.width, im.height], top: at(540, 67), corners: [at(2, 2), at(1077, 2), at(2, 1347), at(1077, 1347)] };
  });
  let ex = await exportOf();
  check('export of square-only art is 1080x1350', ex.size[0] === 1080 && ex.size[1] === 1350, JSON.stringify(ex.size));
  await ev(() => { drawingGraphics.fill('#CC0000'); drawingGraphics.noStroke(); drawingGraphics.ellipse(layerOffset + 400, layerOffset - 50, 40, 40); });
  ex = await exportOf();
  check('paint above the square is in the picture', ex.size[1] === 1350 && ex.top[0] > 150 && ex.top[1] < 60, JSON.stringify(ex));
  // Turned and the background filled: no empty corners in the picture
  await ev(`drawingGraphics.clear(); rotation = 28; floodFill(${pt[0]}, ${pt[1]}, '#66BD0F')`);
  ex = await exportOf();
  const green = c => c[0] < 130 && c[1] > 150 && c[2] < 60;
  check('turned + background fill: corners painted, same size', ex.size[0] === 1080 && ex.size[1] === 1350 && ex.corners.every(green), JSON.stringify(ex));
  await ev('rotation = 0; redrawCanvas()');

  // ---- Driving the app through window.scrawlface only (what a native shell does) ----
  const api = await ev(async () => {
    const sf = window.scrawlface;
    const seen = [];
    const stop = sf.onStateChange(st => seen.push(st));
    const tick = () => new Promise(r => setTimeout(r, 0));
    sf.setTool('brush'); sf.setBrushColor('#CC0000'); sf.setBrushSize(8); sf.setLoops(40);
    await tick();
    const afterSet = sf.appState();
    const burst = seen.length; // several changes, reported once
    sf.clear();
    // paint a stroke as a press would, then undo it
    beginStroke(); isDrawing = true; pressChangedDrawing = true; drawingGraphics.fill(brushColor); dab(100, 100, brushSize); strokeLength = 99; hasDrawings = true; mouseReleased();
    sf.undo(); await tick();
    const afterUndo = sf.appState();
    sf.redo(); sf.pickEyeSet('cat'); await tick();
    const afterEyes = sf.appState();
    const png = await sf.exportPNG();
    const bmp = await createImageBitmap(png);
    stop(); sf.mixEyes(); await tick();
    return { afterSet, burst, afterUndo, afterEyes, png: [png.type, bmp.width, bmp.height], stoppedListening: seen.length };
  });
  check('API: tool, colour, size, loops (clamped)', api.afterSet.tool === 'brush' && api.afterSet.brushColor === '#CC0000' &&
    api.afterSet.brushSize === 8 && api.afterSet.loops === 30, JSON.stringify(api.afterSet));
  check('API: a burst of changes is reported once', api.burst === 1, String(api.burst));
  check('API: undo / redo state', api.afterUndo.canRedo && !api.afterUndo.hasDrawings, JSON.stringify(api.afterUndo));
  check('API: eye set marks the scrawlface changed', api.afterEyes.eyeStyles.join() === 'cat,cat' && api.afterEyes.unsavedChanges, JSON.stringify(api.afterEyes));
  check('API: exportPNG gives the 1080x1350 picture; listeners can stop', api.png.join() === 'image/png,1080,1350' && api.stoppedListening === api.burst + 2, JSON.stringify(api));
  await ev(() => { window.scrawlface.setLoops(15); window.scrawlface.setBrushSize(32); window.scrawlface.setBrushColor('#000000'); });

  // The web keys go through the same functions: a real click still works
  await ev(() => setTool('brush'));
  if (mobile) {
    await page.click('[data-strip="colours"] [data-color="#006635"]');
    await page.click('#size-chip');
    await page.click('[data-strip="sizes"] [data-size="12"]');
  } else {
    await page.click('.sidebar [data-color="#006635"]');
    await page.click('.sidebar [data-size="12"]');
  }
  const clicked = await ev(() => ({ color: brushColor, size: brushSize,
    marked: [...document.querySelectorAll('[data-color].selected')].map(b => b.dataset.color) }));
  check('size and colour keys still work by click', clicked.color === '#006635' && clicked.size === 12 &&
    clicked.marked.every(c => c === '#006635'), JSON.stringify(clicked));
  await ev(() => { window.scrawlface.setBrushSize(32); window.scrawlface.setBrushColor('#000000'); setTool('eyes'); });

  // ---- Canvas-only mode (?embedded): what a native shell loads ----
  {
    // Its own context: a shell has its own storage (no draft from the pages above)
    const emCtx = await browser.newContext(contextOpts);
    const em = await emCtx.newPage();
    const emErrors = [];
    em.on('pageerror', e => emErrors.push(e.message));
    em.on('dialog', d => d.accept());
    await em.goto('file://' + path.join(repo, 'index.html') + '?embedded');
    await em.waitForFunction(() => typeof drawingGraphics !== 'undefined');
    const layout = await em.evaluate(() => {
      const box = document.getElementById('scrawl-container').getBoundingClientRect();
      const shown = ['header', '.sidebar', '.bottom-toolbar', '.blank-cta']
        .filter(s => { const e = document.querySelector(s); return e && e.getClientRects().length > 0; });
      return { fills: box.left === 0 && box.top === 0 && Math.round(box.width) === innerWidth && Math.round(box.height) === innerHeight,
        shown, scroll: document.scrollingElement.scrollHeight - innerHeight };
    });
    check('embedded: only the canvas, filling the window', layout.fills && layout.shown.length === 0 && layout.scroll === 0, JSON.stringify(layout));

    // The happy path through window.scrawlface, with a real pointer stroke
    await em.evaluate(() => window.scrawlface.newScrawl());
    await em.waitForFunction(() => scrawlQueue.length === 0 && eyePositions.length === 2);
    await em.evaluate(() => window.scrawlface.setTool('brush'));
    const cbox = await em.locator('#scrawl-container').boundingBox();
    const at = (fx, fy) => [cbox.x + cbox.width * fx, cbox.y + cbox.height * fy];
    await em.mouse.move(...at(0.3, 0.4)); await em.mouse.down();
    for (let i = 1; i <= 10; i++) { await em.mouse.move(...at(0.3 + i * 0.03, 0.4 + i * 0.01)); await em.waitForTimeout(16); }
    await em.mouse.up();
    const flow = await em.evaluate(async () => {
      const sf = window.scrawlface;
      const tick = () => new Promise(r => setTimeout(r, 0));
      const painted = sf.appState();
      sf.undo(); await tick();
      const undone = sf.appState();
      sf.redo(); await tick();
      const png = await sf.exportPNG();
      return { painted: painted.hasDrawings && painted.canUndo, undone: !undone.hasDrawings && undone.canRedo, png: png && png.type };
    });
    check('embedded: new, brush stroke, undo, redo and export work', flow.painted && flow.undone && flow.png === 'image/png' && emErrors.length === 0,
      JSON.stringify({ ...flow, emErrors }));
    await emCtx.close();
  }

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
