// Gallery test for Scrawlface: Save, the unsaved-changes prompt, the draft
// that survives a reload, opening and deleting saved scrawlfaces. Runs the
// same way as smoke.js (see its header for setup):
//   NODE_PATH=~/.scrawl-test/node_modules node tests/gallery.js
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const repo = path.resolve(__dirname, '..');
const p5src = process.env.P5_PATH ? fs.readFileSync(process.env.P5_PATH) : null;

let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
}

async function run(label, contextOpts) {
  console.log(`\n=== ${label} ===`);
  const browser = await chromium.launch();
  // One context for the whole run, so IndexedDB survives reloads
  const ctx = await browser.newContext(contextOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (p5src) await page.route('**/p5.min.js', r => r.fulfill({ body: p5src, contentType: 'application/javascript' }));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  // IndexedDB needs a real origin, not file://
  await page.route('http://scrawl.test/**', r => {
    const file = path.join(repo, new URL(r.request().url()).pathname);
    if (!fs.existsSync(file)) return r.fulfill({ status: 404 });
    r.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'application/javascript' : undefined });
  });

  const ev = (fn) => page.evaluate(fn);
  const load = async () => {
    await page.goto('http://scrawl.test/index.html');
    await page.waitForFunction(() => typeof drawingGraphics !== 'undefined');
    await page.waitForTimeout(300); // draft restore + gallery render
  };
  const galleryCount = () => ev(() => listGallery().then(r => r.length));
  const draft = () => ev(() => dbRequest('draft', 'readonly', s => s.get('current')).then(d => !!d));
  // A stroke that counts as a change (as a real press and release would)
  const stroke = () => ev(() => {
    beginStroke(); isDrawing = true; pressChangedDrawing = true;
    drawingGraphics.fill('#CC0000'); drawingGraphics.noStroke();
    dab(Math.random() * 400, 0, 40);
    strokeLength = 100; // a stroke, not a tap
    hasDrawings = true; enableClearButton();
    mouseReleased();
  });

  await load();
  check('opens on the blank start', await ev(() => isBlankStart()));
  check('no storage problems', !(await ev(() => document.body.classList.contains('no-storage'))));

  await page.click('#blank-cta-btn');
  await page.waitForFunction(() => scrawlQueue.length === 0);
  check('new scrawl can be saved', await ev(() => !document.querySelector('.gallery-save-btn').disabled));

  // Double-tapping Save must make one entry, not two
  // (the database is slowed down so the two saves overlap, as on a slow phone)
  await ev(() => {
    const real = dbRequest;
    window.dbRequest = (...a) => new Promise(r => setTimeout(r, 150)).then(() => real(...a));
    return Promise.all([saveToGallery(), new Promise(r => setTimeout(r, 20)).then(saveToGallery)])
      // Let the slowed-down requests still on their way land before going on
      .then(() => new Promise(r => setTimeout(r, 300)))
      .finally(() => { window.dbRequest = real; });
  });
  check('double Save makes one gallery entry', await galleryCount() === 1, `${await galleryCount()} entries`);
  check('saved: Save disabled', await ev(() => document.querySelector('.gallery-save-btn').disabled));

  // A tap on an eye that doesn't move it is not a change
  await ev(() => {
    const e = eyePositions[0];
    const p = getRotatedPosition(e.x, e.y);
    mouseX = p.x; mouseY = p.y;
    mousePressed({ target: canvas.elt }); mouseReleased();
  });
  check('tapping an eye is not an unsaved change', !(await ev(() => hasUnsavedChanges())));

  // An eye that moves is a change
  await ev(() => { draggedEyeIndex = 0; eyePositions[0].x += 30; mouseReleased(); });
  check('dragging an eye is an unsaved change', await ev(() => hasUnsavedChanges()));
  await ev(() => saveToGallery());

  // Draft: unsaved work survives a reload
  await stroke();
  await ev(() => saveDraft());
  check('draft written for unsaved work', await draft());
  const pixels = () => ev(() => { drawingGraphics.loadPixels(); return drawingGraphics.pixels.reduce((a, v, i) => i % 4 === 3 ? a + (v > 0) : a, 0); });
  const before = await pixels();
  await load();
  await page.waitForFunction(() => !isBlankStart(), null, { timeout: 5000 }).catch(() => {});
  check('reload restores the draft', !(await ev(() => isBlankStart())) && await pixels() === before);
  check('restored draft counts as unsaved', await ev(() => hasUnsavedChanges()));

  // Leaving with unsaved changes asks; Discard goes ahead
  const newScrawl = ev(() => requestNewScrawl());
  await page.waitForSelector('#leave-dialog[open]');
  // Shortcuts are ignored while a dialog is open (N must not stack a second prompt)
  await page.keyboard.press('n');
  await page.keyboard.press('b');
  check('shortcuts ignored behind a dialog', await ev(() => currentTool()) === 'eyes');
  await page.click('#leave-dialog button[value="discard"]');
  await newScrawl;
  await page.waitForFunction(() => scrawlQueue.length === 0);
  check('discard: new scrawl, nothing unsaved, no draft', !(await ev(() => hasUnsavedChanges())) && !(await draft()));
  check('discard kept the gallery as it was', await galleryCount() === 1);

  // Open from the gallery
  const id = await ev(() => listGallery().then(r => r[0].id));
  await ev(`openFromGallery('${id}')`);
  check('open from gallery', await ev(() => galleryId) === id && !(await ev(() => hasUnsavedChanges())));

  // A gallery entry that can't be decoded: stay on the current scrawlface
  await stroke();
  await ev(() => saveDraft());
  await ev(() => dbRequest('gallery', 'readwrite', s => s.put({ id: 'broken', scrawl: new Blob(['x']), drawing: new Blob(['x']), eyes: [], eyeStyles: [], updatedAt: 0, thumb: new Blob(['x']) })));
  page.once('dialog', d => d.accept());
  await ev(() => { document.getElementById('leave-dialog').addEventListener('close', () => {}, { once: true }); });
  const opening = ev(() => openFromGallery('broken'));
  await page.waitForSelector('#leave-dialog[open]');
  await page.click('#leave-dialog button[value="discard"]');
  await opening.catch(() => {});
  await page.waitForTimeout(100);
  check('broken entry: canvas left as it was', await ev(() => galleryId) === id);
  check('broken entry: unsaved work keeps its draft', await draft());

  // A broken draft must not switch off storage for good
  await ev(() => dbRequest('draft', 'readwrite', s => s.put({ scrawl: new Blob(['x']), drawing: new Blob(['x']) }, 'current')));
  await load();
  check('broken draft: storage still works', !(await ev(() => document.body.classList.contains('no-storage'))));
  check('broken draft is dropped', !(await draft()));
  await ev(() => dbRequest('gallery', 'readwrite', s => s.delete('broken')));

  // Saved before the paint layer grew: an 800x800 drawing opens centred on the scrawl
  const oldId = await ev(async () => {
    const c = document.createElement('canvas');
    c.width = c.height = canvasSize;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#CC0000';
    ctx.fillRect(10, 10, 20, 20); // near the scrawl square's top-left corner
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const empty = await new Promise(r => document.createElement('canvas').toBlob(r, 'image/png'));
    await dbRequest('gallery', 'readwrite', s => s.put({ id: 'old', scrawl: blob, drawing: blob, eyes: eyePositions, eyeStyles,
      showScrawl: true, rotation: 0, updatedAt: 1, thumb: empty }));
    return 'old';
  });
  page.once('dialog', d => d.accept());
  const openingOld = ev(`openFromGallery('${oldId}')`);
  if (await page.waitForSelector('#leave-dialog[open]', { timeout: 1000 }).catch(() => null)) {
    await page.click('#leave-dialog button[value="discard"]');
  }
  await openingOld;
  const oldPaint = await ev(() => [
    drawingGraphics.drawingContext.getImageData(layerOffset + 15, layerOffset + 15, 1, 1).data[3],
    drawingGraphics.drawingContext.getImageData(15, 15, 1, 1).data[3]
  ]);
  check('old 800x800 drawing opens centred', oldPaint[0] === 255 && oldPaint[1] === 0, JSON.stringify(oldPaint));
  await ev(() => dbRequest('gallery', 'readwrite', s => s.delete('old')));

  // Delete
  await ev(`toggleGalleryPick('${id}')`);
  page.once('dialog', () => {});
  const deleting = ev(() => deleteSelected());
  await page.waitForSelector('#delete-dialog[open]');
  await page.click('#delete-dialog button[value="delete"]');
  await deleting;
  check('delete empties the gallery', await galleryCount() === 0);

  // Ignore failed fetches of things the test doesn't serve (icons etc.)
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

(async () => {
  await run('desktop', { viewport: { width: 1280, height: 800 } });
  await run('mobile', { ...devices['Pixel 5'] });
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})();
