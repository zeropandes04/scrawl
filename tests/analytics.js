// Analytics test for Scrawlface: each event in plans/analytics.md fires at
// the right moment with the right properties, and nothing leaves the page
// (events only go to window.scrawlface.onEvent listeners). Runs like
// smoke.js (see its header):
//   NODE_PATH=~/.scrawl-test/node_modules node tests/analytics.js
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
// localStorage survives reloads); `storage` is put in localStorage first.
// Any request that isn't the repo is counted: there must be none.
async function fresh(browser, contextOpts, storage = {}) {
  const ctx = await browser.newContext(contextOpts);
  if (Object.keys(storage).length) {
    await ctx.addInitScript(items => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v);
    }, storage);
  }
  const page = await ctx.newPage();
  const errors = [];
  const remote = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.route('**/*', r => {
    const url = new URL(r.request().url());
    if (url.origin !== 'http://scrawl.test') { remote.push(url.href); return r.abort(); }
    const file = path.join(repo, url.pathname);
    if (!fs.existsSync(file)) return r.abort();
    const type = { '.html': 'text/html', '.js': 'application/javascript', '.woff2': 'font/woff2' }[path.extname(file)];
    r.fulfill({ body: fs.readFileSync(file), contentType: type });
  });
  // After each load, collect events: those from the start (in recentEvents)
  // and every one after, through onEvent
  const load = async (query = '') => {
    await page.goto('http://scrawl.test/index.html' + query);
    await page.waitForFunction(() => typeof drawingGraphics !== 'undefined');
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      window.__events = window.scrawlface.recentEvents();
      window.scrawlface.onEvent(e => window.__events.push(e));
    });
  };
  const ev = fn => page.evaluate(fn);
  // The events since the last take() or mark()
  const take = () => ev(() => window.__events.splice(0));
  const mark = () => ev(() => { window.__events.length = 0; });
  return { ctx, page, errors, remote, load, ev, take, mark };
}

const named = (events, name) => events.filter(e => e.name === name);
const one = (events, name) => { const list = named(events, name); return list.length === 1 ? list[0].props : null; };

async function run(label, contextOpts) {
  console.log(`\n=== ${label} ===`);
  const browser = await chromium.launch();
  const mobile = !!contextOpts.isMobile;

  // -- First launch: app_opened, the tour started and skipped --
  {
    const t = await fresh(browser, contextOpts);
    await t.load();
    let e = await t.take();
    const opened = one(e, 'app_opened');
    check('app_opened, first time', opened && opened.first_open === true && opened.days_since_last === null, JSON.stringify(opened));
    const version = await t.ev(() => document.querySelector('script[src*="scrawl.js"]').src.match(/v=(\d+)/)[1]);
    check('every event has platform, app_version and onboarding_version',
      e.every(x => x.props.platform === 'web' && x.props.app_version === version && x.props.onboarding_version === 1 && typeof x.time === 'number'),
      JSON.stringify(e.map(x => x.props)));
    check('onboarding_started from first launch', one(e, 'onboarding_started')?.source === 'first_launch', JSON.stringify(e.map(x => x.name)));
    await t.page.click('#intro-next');
    await t.page.click('#intro-skip');
    e = await t.take();
    check('onboarding_skipped at step 2', one(e, 'onboarding_skipped')?.at_step === 2, JSON.stringify(e));
    await t.load();
    e = await t.take();
    const again = one(e, 'app_opened');
    check('app_opened again: not first, 0 days; no tour', again && again.first_open === false && again.days_since_last === 0 && !named(e, 'onboarding_started').length,
      JSON.stringify(e.map(x => [x.name, x.props.first_open])));

    // A scribble, and its one tip
    await t.page.click('#blank-cta-btn');
    await t.page.waitForFunction(() => scrawlQueue.length === 0);
    await t.page.waitForFunction(() => !document.getElementById('coach').hidden, null, { timeout: 5000 }).catch(() => {});
    e = await t.take();
    check('scribble_generated from the blank start, with loops', JSON.stringify(one(e, 'scribble_generated')) &&
      one(e, 'scribble_generated').source === 'blank_start' && one(e, 'scribble_generated').loops === 15, JSON.stringify(e.map(x => x.name)));
    check('tip_shown for the first scrawl', one(e, 'tip_shown')?.tip_id === 'drag-eyes', JSON.stringify(e.map(x => x.name)));
    await t.page.click('#coach-next');
    e = await t.take();
    check('tip_closed by its button', one(e, 'tip_closed')?.via === 'button', JSON.stringify(e));
    check('no page errors (first launch)', t.errors.length === 0, t.errors.join(' | '));
    check('nothing requested from outside the app', t.remote.length === 0, t.remote.join(' '));
    await t.ctx.close();
  }

  // -- Working on a scrawlface: tools, eyes, view, history, save, export --
  {
    const t = await fresh(browser, contextOpts, { onboarding_completed: '1', onboarding_version_seen: '1',
      tips_seen: '["drag-eyes","gestures","fill","save","help-key"]' });
    await t.load();
    await t.page.click('#blank-cta-btn');
    await t.page.waitForFunction(() => scrawlQueue.length === 0);
    await t.mark();
    const box = await t.page.locator('#scrawl-container canvas').boundingBox();
    const at = (u, v) => ({ x: box.x + box.width * u, y: box.y + box.height * v });
    const drag = async (from, to) => {
      const a = at(...from), b = at(...to);
      await t.page.mouse.move(a.x, a.y);
      await t.page.mouse.down();
      for (let i = 1; i <= 8; i++) { await t.page.mouse.move(a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8); await t.page.waitForTimeout(16); }
      await t.page.mouse.up();
    };

    // An eye drag counts as using the eyes
    const eye = await t.ev(() => { const p = getRotatedPosition(eyePositions[0].x, eyePositions[0].y);
      const c = canvas.elt.getBoundingClientRect(); const k = c.width / width; return { x: c.left + p.x * k, y: c.top + p.y * k }; });
    await t.page.mouse.move(eye.x, eye.y); await t.page.mouse.down();
    await t.page.mouse.move(eye.x + 20, eye.y + 10, { steps: 4 }); await t.page.mouse.up();
    await t.ev(() => setTool('brush'));
    await drag([0.2, 0.8], [0.4, 0.85]);
    await drag([0.6, 0.8], [0.8, 0.85]);
    let e = await t.take();
    check('tool_used once per tool on a scrawlface (eyes, then brush once for two strokes)',
      JSON.stringify(named(e, 'tool_used').map(x => x.props.tool)) === '["eyes","brush"]', JSON.stringify(e.map(x => [x.name, x.props.tool])));

    await t.ev(() => setTool('fill'));
    await t.page.mouse.click(at(0.03, 0.03).x, at(0.03, 0.03).y);
    await t.page.waitForTimeout(200);
    e = await t.take();
    check('tool_used fill', one(e, 'tool_used')?.tool === 'fill', JSON.stringify(e.map(x => [x.name, x.props.tool])));

    await t.ev(() => { window.scrawlface.undo(); window.scrawlface.redo(); window.scrawlface.rotate(); window.scrawlface.toggleLines(); });
    await t.ev(() => { window.scrawlface.pickEyeSet(window.scrawlface.eyeSets[1]); window.scrawlface.mixEyes(); });
    e = await t.take();
    check('undo_used, redo_used, canvas_rotated, lines_hidden',
      one(e, 'undo_used') && one(e, 'redo_used') && one(e, 'canvas_rotated')?.rotation === 90 && one(e, 'lines_hidden')?.hidden === true,
      JSON.stringify(e.map(x => [x.name, x.props.rotation, x.props.hidden])));
    const styles = named(e, 'eye_style_changed').map(x => x.props.style);
    check('eye_style_changed for a set and for Mix', styles.length === 2 && styles[1] === 'mix' && styles[0] !== 'mix', JSON.stringify(styles));
    await t.ev(() => { window.scrawlface.undo(); window.scrawlface.undo(); window.scrawlface.undo(); }); // nothing to undo past the start
    await t.ev(() => window.scrawlface.redo());
    e = await t.take();
    check('undo_used only when something was undone', named(e, 'undo_used').length === 3 && named(e, 'redo_used').length === 1,
      JSON.stringify(e.map(x => x.name)));

    // Save: the first, then an update
    await t.ev(() => window.scrawlface.save());
    e = await t.take();
    const saved = one(e, 'scrawlface_saved');
    check('scrawlface_saved: first save, its tools, strokes and fills, seconds since generated',
      saved && saved.trigger === 'button' && saved.first_save === true && saved.strokes === 2 && saved.fills === 1 &&
      ['eyes', 'brush', 'fill'].every(x => saved.tools_used.includes(x)) && Number.isInteger(saved.seconds_since_generated),
      JSON.stringify(saved));
    await t.ev(() => window.scrawlface.clear());
    await t.ev(() => window.scrawlface.save());
    e = await t.take();
    check('clear_used; saving again is not a first save', one(e, 'clear_used') && one(e, 'scrawlface_saved')?.first_save === false,
      JSON.stringify(e.map(x => [x.name, x.props.first_save])));

    // Download and share (the share sheet stubbed: sent, then dismissed)
    await t.ev(() => downloadImage());
    await t.page.waitForTimeout(300);
    await t.ev(() => { navigator.share = () => Promise.resolve(); });
    await t.ev(() => shareImage());
    await t.page.waitForTimeout(300);
    await t.ev(() => { navigator.share = () => Promise.reject(new Error('AbortError')); });
    await t.ev(() => shareImage());
    await t.page.waitForTimeout(300);
    e = await t.take();
    check('scrawlface_downloaded, scrawlface_shared, share_cancelled', one(e, 'scrawlface_downloaded')?.from === 'canvas' &&
      one(e, 'scrawlface_shared')?.from === 'canvas' && one(e, 'share_cancelled')?.from === 'canvas', JSON.stringify(e.map(x => x.name)));

    // My Scrawls: opened, reopened, deleted
    await t.ev(() => openGallery());
    await t.page.waitForTimeout(300);
    e = await t.take();
    check('my_scrawls_opened with the count', one(e, 'my_scrawls_opened')?.count === 1, JSON.stringify(e));
    await t.ev(() => openFromGallery(galleryId));
    await t.page.waitForTimeout(300);
    e = await t.take();
    check('scrawlface_reopened', !!one(e, 'scrawlface_reopened'), JSON.stringify(e.map(x => x.name)));
    await t.ev(async () => { window.confirmDelete = () => Promise.resolve(true); gallerySelection = new Set([galleryId]); await deleteSelected(); });
    e = await t.take();
    check('scrawlface_deleted with the count', one(e, 'scrawlface_deleted')?.count === 1, JSON.stringify(e));
    await t.ev(() => document.getElementById('gallery-dialog').close());

    // Leaving unsaved work: the prompt's answer, then the new scribble's source
    await t.ev(() => setTool('brush'));
    await drag([0.2, 0.2], [0.3, 0.3]);
    await t.mark();
    await t.ev(() => { requestNewScrawl('new_button'); });
    await t.page.click('#leave-dialog [value="discard"]');
    await t.page.waitForFunction(() => window.__events.some(x => x.name === 'scribble_generated'));
    e = await t.take();
    check('leave_prompt_answered discard, then scribble_generated from New', one(e, 'leave_prompt_answered')?.answer === 'discard' &&
      one(e, 'scribble_generated')?.source === 'new_button', JSON.stringify(e.map(x => [x.name, x.props.answer || x.props.source])));
    await t.ev(() => setTool('brush'));
    await drag([0.2, 0.2], [0.3, 0.3]);
    await t.mark();
    await t.ev(() => { requestNewScrawl('key_n'); });
    await t.page.keyboard.press('Escape');
    await t.page.waitForTimeout(200);
    e = await t.take();
    check('leave_prompt_answered cancel (Esc), no new scribble', one(e, 'leave_prompt_answered')?.answer === 'cancel' && !named(e, 'scribble_generated').length,
      JSON.stringify(e.map(x => x.name)));

    // A failed save: an error event (the alert is accepted)
    await t.ev(() => { window.dbRequest = () => Promise.reject(new Error('full')); });
    await t.ev(() => document.querySelector('.gallery-save-btn').click());
    await t.page.waitForTimeout(300);
    e = await t.take();
    check('error on a failed save', one(e, 'error')?.where === 'save', JSON.stringify(e));

    // Mobile gestures: a pinch, and touch and hold to peek
    if (mobile) {
      const cdp = await t.ctx.newCDPSession(t.page);
      const p = at(0.5, 0.5);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x - 40, y: p.y }, { x: p.x + 40, y: p.y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x - 60, y: p.y }, { x: p.x + 60, y: p.y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await t.ev(() => setTool('eyes'));
      const q = at(0.1, 0.1);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: q.x, y: q.y }] });
      await t.page.waitForTimeout(800);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      e = await t.take();
      check('canvas_zoomed (pinch) and lines_peeked (touch and hold)', !!one(e, 'canvas_zoomed') && !!one(e, 'lines_peeked'), JSON.stringify(e.map(x => x.name)));
    }

    // No drawing or image data in any event; each is small
    const all = await t.ev(() => window.scrawlface.recentEvents());
    check('events carry no image data and stay small', all.every(x => !/data:|blob:/.test(JSON.stringify(x)) && JSON.stringify(x).length < 600),
      String(Math.max(...all.map(x => JSON.stringify(x).length))));
    check('no page errors (work)', t.errors.length === 0, t.errors.join(' | '));
    check('nothing requested from outside the app (work)', t.remote.length === 0, t.remote.join(' '));
    await t.ctx.close();
  }

  // -- Help menu: the tour replayed and completed; Explore features ended part way --
  {
    const t = await fresh(browser, contextOpts, { onboarding_completed: '1', onboarding_version_seen: '1',
      tips_seen: '["drag-eyes","gestures","fill","save","help-key"]' });
    await t.load();
    await t.page.click('#blank-cta-btn');
    await t.page.waitForFunction(() => scrawlQueue.length === 0);
    await t.mark();
    await t.page.click('#help-btn');
    await t.page.click('#help-tour');
    for (let i = 0; i < 3; i++) await t.page.click('#intro-next');
    let e = await t.take();
    check('onboarding_started from the help menu, then completed', one(e, 'onboarding_started')?.source === 'help_menu' && !!one(e, 'onboarding_completed'),
      JSON.stringify(e.map(x => x.name)));
    await t.page.click('#help-btn');
    await t.page.click('#help-explore');
    await t.page.click('#coach-next');
    await t.page.click('#coach-skip');
    e = await t.take();
    check('explore_features_started, then ended at step 2', !!one(e, 'explore_features_started') && one(e, 'explore_features_ended')?.at_step === 2,
      JSON.stringify(e));
    await t.page.click('#help-btn');
    await t.page.click('#help-explore');
    while (await t.ev(() => !document.getElementById('coach').hidden)) await t.page.click('#coach-next');
    e = await t.take();
    check('explore_features_completed', !!one(e, 'explore_features_completed') && !named(e, 'explore_features_ended').length, JSON.stringify(e.map(x => x.name)));

    // A listener gets each event, and stops when told
    const got = await t.ev(() => {
      const names = [];
      const stop = window.scrawlface.onEvent(x => names.push(x.name));
      window.scrawlface.rotate();
      stop();
      window.scrawlface.rotate();
      return names;
    });
    check('onEvent: a listener gets events until it stops', JSON.stringify(got) === '["canvas_rotated"]', JSON.stringify(got));
    check('no page errors (help)', t.errors.length === 0, t.errors.join(' | '));
    await t.ctx.close();
  }

  // -- Canvas-only mode (a native shell): events still flow, marked as the shell's --
  {
    const t = await fresh(browser, contextOpts);
    await t.load('?embedded');
    await t.ev(() => window.scrawlface.newScrawl());
    await t.page.waitForFunction(() => scrawlQueue.length === 0);
    const e = await t.ev(() => window.scrawlface.recentEvents());
    check('embedded: platform shell, scribble_generated, no onboarding events',
      e.length > 0 && e.every(x => x.props.platform === 'shell') && !!one(e, 'scribble_generated') && !e.some(x => /^onboarding|^tip_/.test(x.name)),
      JSON.stringify(e.map(x => x.name)));
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
