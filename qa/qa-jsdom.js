/**
 * Functional click-through QA for the e-learning engine, powered by jsdom.
 * Exercises the REAL engine code (rendering, navigation, scoring, state,
 * resume, events) without needing a browser binary.
 * Run: node qa-jsdom.js  (from ~/workspace/elearning-engine/qa/)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const config = JSON.parse(read('courses/demo-course/config.json'));

let failures = [];
let step = 0;
function check(name, cond, detail = '') {
  step++;
  if (cond) console.log(`  PASS [${step}] ${name}`);
  else {
    console.log(`  FAIL [${step}] ${name}${detail ? ' — ' + detail : ''}`);
    failures.push(name);
  }
}

// Bind config into the context before start: do it via a small prelude.
function makeWindowWithConfig(seedStorage) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head></head><body><div id="engine-root"></div></body></html>',
    { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' }
  );
  const { window } = dom;
  const document = window.document;
  if (seedStorage) {
    for (const k of Object.keys(seedStorage)) window.localStorage.setItem(k, seedStorage[k]);
  }
  const ctx = dom.getInternalVMContext();
  for (const f of ['src/validation.js', 'src/scorm.js', 'src/engine.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  const events = [];
  for (const e of ['engine:ready', 'engine:screen', 'engine:answered', 'engine:choice', 'engine:complete', 'engine:invalid']) {
    document.addEventListener(e, () => events.push(e));
  }
  ctx.__cfg = config;
  vm.runInContext('LearningEngine.start(__cfg, document.getElementById("engine-root"))', ctx);
  return { window, document, events, ctx };
}

function snapshotStorage(window) {
  const out = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    out[k] = window.localStorage.getItem(k);
  }
  return out;
}

const heading = document => (document.querySelector('.el-heading') || { textContent: '' }).textContent;
const click = (document, sel) => {
  const el = document.querySelector(sel);
  if (!el) throw new Error('missing element: ' + sel);
  el.click();
};
const selectRadio = (window, document, value) => {
  const input = document.querySelector(`input[name="el-mcq"][value="${value}"]`);
  if (!input) throw new Error('missing radio: ' + value);
  input.checked = true;
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
};

console.log('— Full learner journey (correct path) —');
let w = makeWindowWithConfig();
let { window, document, events } = w;

check('S1 heading "Stop the slip"', heading(document).includes('Stop the slip'));
check('S1 Continue visible', !!document.querySelector('.el-btn-primary'));
check('S1 progress label "Screen 1 of 5"', (document.querySelector('.el-progress-label') || { textContent: '' }).textContent.includes('1 of 5'));
check('engine:ready fired', events.includes('engine:ready'));
click(document, '.el-btn-primary');

check('S2 heading "Quick check"', heading(document).includes('Quick check'));
check('S2 has 4 radios', document.querySelectorAll('input[name="el-mcq"]').length === 4);
check('S2 has fieldset+legend', !!document.querySelector('fieldset legend'));
click(document, '.el-btn-primary'); // Check with nothing selected
check('S2 prompts when checking with no answer',
  (document.querySelector('.el-feedback') || { textContent: '' }).textContent.includes('Choose an answer first'));
selectRadio(window, document, 'o2'); // correct answer
check('S2 Check enabled after selecting', document.querySelector('.el-btn-primary').disabled === false);
click(document, '.el-btn-primary'); // Check answer
const verdict = document.querySelector('.el-verdict');
check('S2 verdict marked correct', !!verdict && verdict.className.includes('is-correct'));
check('S2 feedback aria-live=polite', document.querySelector('.el-feedback').getAttribute('aria-live') === 'polite');
check('engine:answered fired', events.includes('engine:answered'));
check('S2 primary now reads Continue', document.querySelector('.el-btn-primary').textContent.includes('Continue'));
click(document, '.el-btn-primary'); // Continue

check('S3 heading "3-step response"', heading(document).includes('3-step response'));
const img = document.querySelector('.el-media img');
check('S3 image present with alt text', !!img && (img.getAttribute('alt') || '').length > 0);
click(document, '[data-action="back"]');
check('Back from S3 returns to S2', heading(document).includes('Quick check'));
check('S2 keeps answered state after Back', !!document.querySelector('.el-verdict.is-correct'));
click(document, '.el-btn-primary'); // S2 -> S3
click(document, '.el-btn-primary'); // S3 -> S4

check('S4 heading "Decision point"', heading(document).includes('Decision point'));
check('S4 has 2 choices', document.querySelectorAll('.el-choice').length === 2);
click(document, '.el-choice[data-choice="c1"]');
const cons = document.querySelector('.el-consequence');
check('S4 consequence panel appears', !!cons && cons.textContent.includes('What happened:'), (cons || { textContent: '' }).textContent.trim().slice(0, 60));
check('engine:choice fired', events.includes('engine:choice'));
click(document, '.el-btn-primary'); // Continue

check('S5 heading "Your results"', heading(document).includes('Your results'));
check('S5 Passed banner', !!document.querySelector('.el-result-banner.is-pass'));
const scoreNum = (document.querySelector('.el-score-num') || { textContent: '' }).textContent;
const scoreSub = (document.querySelector('.el-score-sub') || { textContent: '' }).textContent;
check('S5 score 100%', scoreNum.includes('100%'), scoreNum);
check('S5 points "20 of 20"', scoreSub.includes('20 of 20'), scoreSub);
check('S5 certificate shown', !!document.querySelector('.el-certificate'));
check('engine:complete fired', events.includes('engine:complete'));

const st = w.ctx.LearningEngine ? null : null; // getState lives on window global
const state = window.LearningEngine.getState();
check('getState: status completed', state.status === 'completed', JSON.stringify(state).slice(0, 160));
check('getState: score 20', state.score === 20, JSON.stringify(state).slice(0, 160));

// Suspend payload must fit SCORM 1.2's ~4KB budget
const saved = snapshotStorage(window);
const key = 'elearn-state-' + (config.meta && config.meta.courseId);
const bytes = (saved[key] || '').length;
check(`suspend payload ${bytes}B present and < 4096B`, bytes > 0 && bytes < 4096, `${bytes}B`);

console.log('— Resume after reload —');
const w2 = makeWindowWithConfig(saved);
check('Reload resumes at results screen', heading(w2.document).includes('Your results'));
check('Reload keeps 100% score', (w2.document.querySelector('.el-score-num') || { textContent: '' }).textContent.includes('100%'));

console.log('— Restart —');
click(w2.document, '[data-action="restart"]');
check('Restart returns to screen 1', heading(w2.document).includes('Stop the slip'));
check('Restart clears score banner', !w2.document.querySelector('.el-result-banner'));

console.log('— Wrong-answer + branch-2 path —');
const w3 = makeWindowWithConfig();
click(w3.document, '.el-btn-primary'); // S1 -> S2
selectRadio(w3.window, w3.document, 'o1'); // wrong
click(w3.document, '.el-btn-primary'); // Check answer
const verdictW = w3.document.querySelector('.el-verdict');
check('Wrong answer verdict marked is-wrong', !!verdictW && verdictW.className.includes('is-wrong'));
click(w3.document, '.el-btn-primary'); // S2 -> S3
click(w3.document, '.el-btn-primary'); // S3 -> S4
click(w3.document, '.el-choice[data-choice="c2"]'); // 0-point branch
click(w3.document, '.el-btn-primary'); // S4 -> S5
const num2 = (w3.document.querySelector('.el-score-num') || { textContent: '' }).textContent;
const sub2 = (w3.document.querySelector('.el-score-sub') || { textContent: '' }).textContent;
check('Branch-2 path scores below 100%', !num2.includes('100%'), num2 + ' / ' + sub2);
check('Branch-2 path still completes course', !!w3.document.querySelector('.el-result-banner'));

console.log('— Resume gate (incomplete progress) —');
const wg = makeWindowWithConfig();
click(wg.document, '.el-btn-primary'); // S1 -> S2
selectRadio(wg.window, wg.document, 'o2'); // correct
click(wg.document, '.el-btn-primary'); // Check answer
click(wg.document, '.el-btn-primary'); // S2 -> S3
const mid = snapshotStorage(wg.window);
const wg2 = makeWindowWithConfig(mid);
check('Gate shows "Welcome back"', heading(wg2.document).includes('Welcome back'));
check('Gate offers Resume + Restart',
  !!wg2.document.querySelector('[data-action="resume-course"]') &&
  !!wg2.document.querySelector('[data-action="restart-course"]'));
check('Gate heading takes focus', wg2.document.activeElement === wg2.document.querySelector('.el-heading'));
click(wg2.document, '[data-action="resume-course"]');
check('Resume lands back on S3', heading(wg2.document).includes('3-step response'));
check('Resume keeps S2 answered state', wg2.window.LearningEngine.getState().responses.s2.correct === true);
const wg3 = makeWindowWithConfig(mid);
click(wg3.document, '[data-action="restart-course"]');
check('Restart from gate returns to S1', heading(wg3.document).includes('Stop the slip'));
check('Restart from gate clears score', wg3.window.LearningEngine.getState().score === 0);

console.log('\n==============================');
if (failures.length === 0) console.log(`ALL ${step} CHECKS PASSED`);
else {
  console.log(`${failures.length} FAILURES out of ${step}:`);
  failures.forEach(f => console.log('  - ' + f));
  process.exitCode = 1;
}
