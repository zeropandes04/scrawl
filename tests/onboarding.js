// Onboarding test for Scrawlface: the intro on first launch, Skip / finish
// and that it stays away after, the help key (Product tour, Explore
// features), the one-off tips, existing users, the version rule, and
// canvas-only mode. Runs like smoke.js (see its header):
//   NODE_PATH=~/.scrawl-test/node_modules node tests/onboarding.js
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const repo = path.resolve(__dirname, '..');

let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
}

// A fresh browser profile with the repo served at a made-up origin (so
// localStorage survives reloads); `storage` is put in localStorage first
async function fresh(browser, contextOpts, storage = {}) {
  const ctx = await browser.newContext(contextOpts);
  if (Object.keys(storage).length) {
    await ctx.addInitScript(items => {
      if (sessionStorage.getItem('seeded')) return; // only before the first load
      sessionStorage.setItem('seeded', '1');
      for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v);
    }, storage);
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('http://scrawl.test/**', r => {
    const file = path.join(repo, new URL(r.request().url()).pathname);
    if (!fs.existsSync(file)) return r.abort();
    const type = { '.html': 'text/html', '.js': 'application/javascript', '.woff2': 'font/woff2' }[path.extname(file)];
    r.fulfill({ body: fs.readFileSync(file), contentType: type });
  });
  const load = async (query = '') => {
    await page.goto('http://scrawl.test/index.html' + query);
    await page.waitForFunction(() => typeof drawingGraphics !== 'undefined');
    await page.waitForTimeout(150);
  };
  return { ctx, page, errors, load, ev: fn => page.evaluate(fn) };
}

const introShown = p => p.evaluate(() => document.getElementById('intro-dialog').open);
const coachShown = p => p.evaluate(() => !document.getElementById('coach').hidden);
const state = p => p.evaluate(() => onboardingState());

async function run(label, contextOpts) {
  console.log(`\n=== ${label} ===`);
  const browser = await chromium.launch();
  const mobile = !!contextOpts.isMobile;

  // -- First launch: the intro; three screens, Back / Next, last one creates --
  {
    const t = await fresh(browser, contextOpts);
    await t.load();
    check('first launch shows the intro', await introShown(t.page));
    const screens = [];
    for (let i = 0; i < 3; i++) {
      screens.push(await t.ev(() => [document.getElementById('intro-step').textContent, document.getElementById('intro-title').textContent,
        document.getElementById('intro-next').textContent]));
      if (i === 1) { // Back and forth
        await t.page.click('#intro-back');
        const back = await t.ev(() => document.getElementById('intro-step').textContent);
        check('Back goes to the previous screen', back.startsWith('01 '), back);
        await t.page.click('#intro-next');
      }
      if (i < 2) await t.page.click('#intro-next');
    }
    check('three screens, each with its own key', JSON.stringify(screens) === JSON.stringify([
      ['01 · Look closer', 'Train your imagination.', 'Let\'s look'],
      ['02 · Make it yours', 'Every scribble holds a possibility.', 'Show me'],
      ['03 · Find something unexpected', 'Your first scribble is waiting.', 'Surprise me!']]), JSON.stringify(screens));
    const art = await t.ev(() => !document.querySelector('#intro-art canvas').hidden);
    check('every screen\'s picture is drawn live', art);
    // Screen 02 builds up the bundled example: lines, then eyes, then paint
    await t.page.click('#intro-back');
    const colour = () => t.ev(() => { const c = document.querySelector('#intro-art canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i + 2] > 100 && d[i] < 60 && d[i + 1] < 60) n++; return n; }); // the example's dark blue
    await t.page.waitForTimeout(1500);
    const early = await colour();
    await t.page.waitForTimeout(2200);
    const later = await colour();
    check('screen 02: the example\'s paint fades in after its lines and eyes', early === 0 && later > 100, JSON.stringify({ early, later }));
    await t.page.click('#intro-next');
    await t.page.click('#intro-next');
    await t.page.waitForFunction(() => !isBlankStart() && scrawlQueue.length === 0);
    const st = await state(t.page);
    check('finishing creates the first scrawlface and records completed', !(await introShown(t.page)) && st.completed === 1 && st.skipped === 0 && st.versionSeen === 1, JSON.stringify(st));
    // The first scrawl: eyes in, one tooltip on them; Let's go! closes it
    const tipUp = await t.page.waitForFunction(() => !document.getElementById('coach').hidden, null, { timeout: 5000 }).then(() => true, () => false);
    const tip = await t.ev(() => ({ eyes: eyePositions.length, text: document.getElementById('coach-text').textContent,
      key: document.getElementById('coach-next').textContent }));
    check('first scrawl: eyes in, and the one tooltip', tipUp && tip.eyes === 2 &&
      tip.text === 'There\'s more than meets the eye. Move the eyes and rotate the canvas. Can you spot a face? Add colour to make it yours.' &&
      tip.key === 'Let\'s go!', JSON.stringify(tip));
    await t.page.click('#coach-next');
    check('Let\'s go! closes it', !(await coachShown(t.page)));
    await t.load();
    check('after finishing, the intro stays away on reload', !(await introShown(t.page)));
    check('no page errors (first launch)', t.errors.length === 0, t.errors.join(' | '));
    await t.ctx.close();
  }

  // -- Phones: swipe between screens --
  if (mobile) {
    const t = await fresh(browser, contextOpts);
    await t.load();
    const cdp = await t.ctx.newCDPSession(t.page);
    // pause: ms between moves (a slow drag rather than a flick)
    const swipe = async (x1, x2, y = 300, pause = 0) => {
      const steps = 8;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y }] });
      for (let k = 1; k <= steps; k++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2 - x1) * k / steps, y }] });
        if (pause) await t.page.waitForTimeout(pause);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await t.page.waitForTimeout(450); // the slide
    };
    const step = () => t.ev(() => document.getElementById('intro-step').textContent.slice(0, 2));
    // Mid-drag, the screen follows the finger; let go after a slow, short
    // drag and it goes back into place
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 300 }] });
    for (const x of [290, 280, 270, 260, 250, 240]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: 300 }] });
      await t.page.waitForTimeout(60);
    }
    const follow = await t.ev(() => new DOMMatrix(getComputedStyle(document.getElementById('intro-slide')).transform).m41);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await t.page.waitForTimeout(450);
    const back = [await step(), await t.ev(() => getComputedStyle(document.getElementById('intro-slide')).transform)];
    check('the screen follows the finger; a slow short drag springs back', follow < -40 && back[0] === '01' && back[1] === 'none',
      JSON.stringify({ follow, back }));
    await swipe(300, 80);
    const a = await step();
    await swipe(80, 300);
    const b = await step();
    for (let i = 0; i < 3; i++) await swipe(300, 80);
    const c = [await step(), await introShown(t.page)];
    await swipe(200, 180);
    const d = await step();
    check('swipe left / right moves between screens; not past the last, short drags ignored', a === '02' && b === '01' && c[0] === '03' && c[1] && d === '03',
      JSON.stringify([a, b, c, d]));
    await t.ctx.close();
  }

  // -- Skip, and Esc, both stop it --
  {
    const t = await fresh(browser, contextOpts);
    await t.load();
    await t.page.click('#intro-skip');
    const st = await state(t.page);
    check('Skip closes it and records skipped', !(await introShown(t.page)) && st.skipped === 1 && st.completed === 0 && st.versionSeen === 1, JSON.stringify(st));
    await t.load();
    check('after Skip, it stays away on reload', !(await introShown(t.page)));
    await t.ctx.close();
    const e = await fresh(browser, contextOpts);
    await e.load();
    await e.page.keyboard.press('Escape');
    const st2 = await state(e.page);
    check('Esc skips too', !(await introShown(e.page)) && st2.skipped === 1, JSON.stringify(st2));
    await e.ctx.close();
  }

  // -- A new intro version shows once more, even to people who finished v0 --
  {
    const t = await fresh(browser, contextOpts, { onboarding_completed: '0', onboarding_version_seen: '0', createdScrawlface: '1' });
    await t.load();
    // (createdScrawlface + nothing seen = an existing user: no intro, a tip on the help key)
    const tip = await t.ev(() => new Promise(r => setTimeout(() => r({ intro: document.getElementById('intro-dialog').open,
      coach: !document.getElementById('coach').hidden, text: document.getElementById('coach-text').textContent }), 1000)));
    check('existing user: no intro, a tip on the help key', !tip.intro && tip.coach && tip.text.includes('tour'), JSON.stringify(tip));
    await t.load();
    await t.page.waitForTimeout(1000);
    check('the help-key tip shows only once', !(await coachShown(t.page)));
    await t.ctx.close();
    const v = await fresh(browser, contextOpts, { onboarding_completed: '0', onboarding_version_seen: '1' });
    await v.load();
    check('an intro version not yet completed or skipped shows again', await introShown(v.page));
    await v.ctx.close();
  }

  // -- Help key: Product tour and Explore features --
  {
    const t = await fresh(browser, contextOpts, { onboarding_completed: '1', onboarding_version_seen: '1', tips_seen: '["drag-eyes","gestures","fill","save","help-key"]' });
    await t.load();
    await t.page.click('#blank-cta-btn');
    await t.page.waitForFunction(() => scrawlQueue.length === 0);
    await t.page.click('#help-btn');
    const menu = await t.ev(() => [...document.querySelectorAll('#help-menu button')].filter(b => b.getClientRects().length).map(b => b.querySelector('b').textContent));
    check('help key opens Product tour and Explore features', menu.join() === 'Product tour,Explore features', JSON.stringify(menu));
    await t.page.click('#help-tour');
    const replay = await t.ev(() => [document.getElementById('intro-dialog').open, document.getElementById('intro-step').textContent]);
    check('Product tour replays the intro', replay[0] && replay[1].startsWith('01 '), JSON.stringify(replay));
    await t.page.click('#intro-skip');
    await t.page.click('#help-btn');
    await t.page.click('#help-explore');
    const steps = [];
    for (let i = 0; i < 12 && await coachShown(t.page); i++) {
      steps.push(await t.ev(() => ({ count: document.getElementById('coach-count').textContent, next: document.getElementById('coach-next').textContent,
        end: !document.getElementById('coach-skip').hidden,
        // the outline: shown, rounded, and wholly on screen
        outline: (() => { const b = document.getElementById('coach-box'); const r = b.getBoundingClientRect();
          return !b.hidden && parseFloat(getComputedStyle(b).borderTopLeftRadius) > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })(),
        title: document.getElementById('coach-title').textContent })));
      await t.page.click('#coach-next');
    }
    const total = steps.length;
    const titles = mobile ? 'Your creative tools,The canvas,More tools,My Scrawls'
      : 'New scribble and Loops,Your creative tools,Undo, Redo & Clear,The canvas,My Scrawls';
    check('Explore features: its steps, each outlined by a rounded box on screen', steps.map(s => s.title).join() === titles && steps.every(s => s.outline),
      JSON.stringify(steps.map(s => [s.title, s.outline])));
    check('Explore features steps through every control, then ends', total === (mobile ? 4 : 5) && steps.every((s, i) => s.count === `${i + 1} of ${total}`) &&
      steps[total - 1].next === 'Done' && !steps[total - 1].end && !(await coachShown(t.page)) &&
      await t.ev(() => document.getElementById('coach-box').hidden),
      JSON.stringify(steps.map(s => s.count + ' ' + s.next)));
    // End tour part way
    await t.page.click('#help-btn');
    await t.page.click('#help-explore');
    await t.page.click('#coach-next');
    await t.page.click('#coach-skip');
    check('End tour stops it part way', !(await coachShown(t.page)));
    // every tour bubble stays on screen
    await t.page.click('#help-btn');
    await t.page.click('#help-explore');
    let inView = true;
    while (await coachShown(t.page)) {
      const r = await t.ev(() => { const b = document.getElementById('coach').getBoundingClientRect(); return b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight; });
      inView = inView && r;
      await t.page.click('#coach-next');
    }
    check('tour bubbles stay on screen', inView);
    check('no page errors (help)', t.errors.length === 0, t.errors.join(' | '));
    await t.ctx.close();
  }

  // -- Already at work on the canvas: the drag-eyes tip doesn't turn up late --
  {
    const t = await fresh(browser, contextOpts, { onboarding_completed: '1', onboarding_version_seen: '1' });
    await t.load();
    await t.page.click('#blank-cta-btn');
    const box = await t.page.locator('#scrawl-container canvas').boundingBox();
    await t.page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.85);
    await t.page.waitForFunction(() => scrawlQueue.length === 0);
    await t.page.waitForTimeout(1200);
    const r = await t.ev(() => ({ coach: !document.getElementById('coach').hidden, seen: onboardingState().tipsSeen }));
    check('pressed the canvas during the draw-in: no drag-eyes tip after', !r.coach && !r.seen.includes('drag-eyes'), JSON.stringify(r));
    await t.ctx.close();
  }

  // -- One-off tips: shown once, put away by working on the canvas --
  {
    const t = await fresh(browser, contextOpts, { onboarding_completed: '1', onboarding_version_seen: '1' });
    await t.load();
    await t.page.click('#blank-cta-btn');
    await t.page.waitForFunction(() => scrawlQueue.length === 0);
    // the tip follows the draw-in on a timer: wait for it rather than guess
    const tipUp = await t.page.waitForFunction(() => !document.getElementById('coach').hidden, null, { timeout: 5000 }).then(() => true, () => false);
    check('drag-eyes tip shows', tipUp);
    // Press the canvas somewhere the bubble isn't (it sits by a random eye)
    const spot = await t.ev(() => {
      const c = document.getElementById('scrawl-container').getBoundingClientRect();
      const b = document.getElementById('coach').getBoundingClientRect();
      return [[0.2, 0.85], [0.8, 0.85], [0.2, 0.15], [0.8, 0.15]]
        .map(([u, v]) => ({ x: c.left + c.width * u, y: c.top + c.height * v }))
        .find(p => p.x < b.left - 8 || p.x > b.right + 8 || p.y < b.top - 8 || p.y > b.bottom + 8);
    });
    await t.page.mouse.click(spot.x, spot.y);
    check('a press on the canvas puts the tip away', !(await coachShown(t.page)));
    await t.ev(() => { hasDrawings = false; generateScrawlface(); });
    await t.page.waitForFunction(() => scrawlQueue.length === 0);
    await t.page.waitForTimeout(500);
    check('drag-eyes tip doesn\'t show again', !(await coachShown(t.page)));
    await t.ev(() => setTool('fill'));
    const fill = await t.ev(() => [!document.getElementById('coach').hidden, document.getElementById('coach-text').textContent]);
    check('first time on Fill: a tip', fill[0] && fill[1].includes('enclosed area'), JSON.stringify(fill));
    await t.page.click('#coach-next');
    await t.ev(() => setTool('brush'));
    const gestures = await coachShown(t.page);
    check(mobile ? 'touch: first time on Brush, the pinch / hold tip' : 'mouse: no pinch tip on Brush', gestures === mobile);
    if (gestures) await t.page.click('#coach-next');
    // Eye moves and the like don't bring it; paint does
    for (let i = 0; i < 6; i++) await t.ev(() => markChanged());
    check('no Save tip for changes without paint', !(await coachShown(t.page)));
    for (let i = 0; i < 6; i++) await t.ev(() => markChanged(true));
    const save = await t.ev(() => [!document.getElementById('coach').hidden, document.getElementById('coach-text').textContent]);
    check('after a few changes, a tip to Save', save[0] && save[1].toLowerCase().includes('save it to my scrawls'), JSON.stringify(save));
    await t.ev(() => saveToGallery());
    check('saving puts the Save tip away', !(await coachShown(t.page)));
    const st = await state(t.page);
    check('tips seen are remembered', ['drag-eyes', 'fill', 'save'].every(id => st.tipsSeen.includes(id)), JSON.stringify(st.tipsSeen));
    check('no page errors (tips)', t.errors.length === 0, t.errors.join(' | '));
    await t.ctx.close();
  }

  // -- Canvas-only mode: none of it --
  {
    const t = await fresh(browser, contextOpts);
    await t.load('?embedded');
    await t.ev(() => window.scrawlface.newScrawl());
    await t.page.waitForFunction(() => scrawlQueue.length === 0 && eyePositions.length === 2);
    await t.page.waitForTimeout(500);
    const em = await t.ev(() => ({ intro: document.getElementById('intro-dialog').open, coach: !document.getElementById('coach').hidden,
      help: document.getElementById('help-btn').getClientRects().length > 0, state: window.scrawlface.onboardingState() }));
    check('embedded: no intro, tips or help key; state still readable', !em.intro && !em.coach && !em.help && em.state.version === 1, JSON.stringify(em));
    await t.ctx.close();
  }

  await browser.close();
}

// Tablets in landscape get the sidebar, but touch: the tour's canvas step
// tells them about the touch gestures
async function tabletTour() {
  console.log('\n=== tablet (landscape) ===');
  const browser = await chromium.launch();
  const t = await fresh(browser, { ...devices['iPad Pro 11 landscape'] }, { onboarding_completed: '1', onboarding_version_seen: '1',
    tips_seen: '["drag-eyes","gestures","fill","save","help-key"]' });
  await t.load();
  await t.page.tap('#blank-cta-btn');
  await t.page.waitForFunction(() => scrawlQueue.length === 0);
  await t.page.tap('#help-btn');
  await t.page.tap('#help-explore');
  let text = null;
  for (let i = 0; i < 6 && await coachShown(t.page); i++) {
    const step = await t.ev(() => [document.getElementById('coach-title').textContent, document.getElementById('coach-text').textContent]);
    if (step[0] === 'The canvas') text = step[1];
    await t.page.tap('#coach-next');
  }
  check('tablet: the canvas step tells about pinch and touch and hold', text === 'Pinch to zoom and rotate. Touch and hold to peek under the lines.', text);
  await browser.close();
}

(async () => {
  await run('desktop', { viewport: { width: 1280, height: 800 } });
  await run('mobile', { ...devices['Pixel 5'] });
  await tabletTour();
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})();
