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

  // -- First launch: the intro; four screens, Back / Next, last one creates --
  {
    const t = await fresh(browser, contextOpts);
    await t.load();
    check('first launch shows the intro', await introShown(t.page));
    const screens = [];
    for (let i = 0; i < 4; i++) {
      screens.push(await t.ev(() => [document.getElementById('intro-step').textContent, document.getElementById('intro-next').textContent]));
      if (i === 1) { // Back and forth
        await t.page.click('#intro-back');
        const back = await t.ev(() => document.getElementById('intro-step').textContent);
        check('Back goes to the previous screen', back.startsWith('01 '), back);
        await t.page.click('#intro-next');
      }
      if (i === 1) {
        const art = await t.ev(() => ({ canvas: document.querySelector('#intro-art canvas').hidden, pile: document.querySelectorAll('#intro-art .pile img').length }));
        check('screen 2 shows the pile of discoveries', art.canvas && art.pile === 3, JSON.stringify(art));
      }
      if (i === 2) {
        await t.page.waitForTimeout(2200);
        const list = await t.ev(() => ({ items: [...document.querySelectorAll('#intro-text li')].map(li => li.textContent),
          on: [...document.querySelectorAll('#intro-text li')].findIndex(li => li.classList.contains('on')),
          canvas: !document.querySelector('#intro-art canvas').hidden }));
        check('screen 3 lists the three steps, the illustrated one marked', list.items.length === 3 && list.on === 1 && list.canvas, JSON.stringify(list));
      }
      if (i < 3) await t.page.click('#intro-next');
    }
    check('four screens: what, what can I do, how, ready', screens.map(s => s[0].split(' · ')[1]).join() === 'What is it?,What can I do?,How does it work?,Ready?' &&
      screens[3][1] === 'Start discovering', JSON.stringify(screens));
    await t.page.click('#intro-next');
    await t.page.waitForFunction(() => !isBlankStart() && scrawlQueue.length === 0);
    const st = await state(t.page);
    check('finishing creates the first scrawlface and records completed', !(await introShown(t.page)) && st.completed === 1 && st.skipped === 0 && st.versionSeen === 1, JSON.stringify(st));
    // The first scribble: no eyes until you tap where you see a face
    await t.page.waitForTimeout(400);
    const tip = await t.ev(() => ({ shown: !document.getElementById('coach').hidden, text: document.getElementById('coach-text').textContent, finding: findingFace }));
    check('first scribble: eyes wait, a tip asks what you see', tip.shown && tip.finding && tip.text.includes('Can you spot a face'), JSON.stringify(tip));
    const c = await t.page.locator('#scrawl-container canvas').boundingBox();
    if (mobile) await t.page.tap('#scrawl-container canvas', { position: { x: c.width / 2, y: c.height / 2 } });
    else await t.page.mouse.click(c.x + c.width / 2, c.y + c.height / 2);
    await t.page.waitForTimeout(400);
    const found = await t.ev(() => ({ finding: findingFace, eyes: eyePositions.map(e => [Math.round(e.x), Math.round(e.y)]),
      unsaved: editVersion !== savedVersion, undo: historyStack.length,
      tip: !document.getElementById('coach').hidden && document.getElementById('coach-text').textContent }));
    const mid = found.eyes.length === 2 && Math.abs((found.eyes[0][0] + found.eyes[1][0]) / 2 - 400) < 8;
    check('tapping puts the eyes where you tapped, then a tip to fine-tune', !found.finding && mid && found.unsaved && found.undo === 0 &&
      String(found.tip).includes('Found one'), JSON.stringify(found));
    await t.load();
    check('after finishing, the intro stays away on reload', !(await introShown(t.page)));
    check('no page errors (first launch)', t.errors.length === 0, t.errors.join(' | '));
    await t.ctx.close();
  }

  // -- The first scribble without tapping: Surprise me, or another tool --
  for (const how of ['surprise', 'tool']) {
    const t = await fresh(browser, contextOpts);
    await t.load();
    for (let i = 0; i < 4; i++) await t.page.click('#intro-next');
    await t.page.waitForFunction(() => scrawlQueue.length === 0);
    await t.page.waitForTimeout(400);
    if (how === 'surprise') await t.page.click('#coach-next');
    else await t.ev(() => window.scrawlface.setTool('brush'));
    await t.page.waitForTimeout(400);
    const r = await t.ev(() => ({ finding: findingFace, eyes: eyePositions.length, coach: !document.getElementById('coach').hidden,
      text: document.getElementById('coach-text').textContent }));
    const ok = !r.finding && r.eyes === 2 && (how === 'tool' || (r.coach && r.text.includes('Drag the eyes')));
    check(how === 'surprise' ? 'Surprise me puts the eyes in, then the drag tip' : 'choosing another tool puts the eyes in', ok, JSON.stringify(r));
    check(`no page errors (${how})`, t.errors.length === 0, t.errors.join(' | '));
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
        ring: document.querySelectorAll('.coach-target').length, end: !document.getElementById('coach-skip').hidden })));
      await t.page.click('#coach-next');
    }
    const total = steps.length;
    check('Explore features steps through every control, then ends', total >= 5 && steps.every((s, i) => s.count === `${i + 1} of ${total}` && s.ring === 1) &&
      steps[total - 1].next === 'Done' && !steps[total - 1].end && !(await coachShown(t.page)) && await t.ev(() => document.querySelectorAll('.coach-target').length === 0),
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

  // -- One-off tips: shown once, put away by working on the canvas --
  {
    const t = await fresh(browser, contextOpts, { onboarding_completed: '1', onboarding_version_seen: '1' });
    await t.load();
    await t.page.click('#blank-cta-btn');
    await t.page.waitForFunction(() => scrawlQueue.length === 0);
    // the tip follows the draw-in on a timer: wait for it rather than guess
    const tipUp = await t.page.waitForFunction(() => !document.getElementById('coach').hidden, null, { timeout: 5000 }).then(() => true, () => false);
    check('drag-eyes tip shows', tipUp);
    const box = await t.page.locator('#scrawl-container canvas').boundingBox();
    await t.page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.85);
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
    for (let i = 0; i < 6; i++) await t.ev(() => markChanged());
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

(async () => {
  await run('desktop', { viewport: { width: 1280, height: 800 } });
  await run('mobile', { ...devices['Pixel 5'] });
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})();
