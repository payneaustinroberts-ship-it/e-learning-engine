/**
 * Functional click-through QA for course 2 (de-escalation basics).
 * Exercises the REAL engine code against a different config: 6 screens,
 * 80% pass bar, 3-choice scenario with a negative scoreDelta, per-course
 * theme + logo. Run: node qa-jsdom2.js  (from ~/workspace/elearning-engine/qa/)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const config = JSON.parse(read('courses/deescalation-basics/config.json'));

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
const themeVar = document => document.getElementById('engine-root').style.getPropertyValue('--el-primary').trim();

console.log('— Theme + logo (config-driven, engine untouched) —');
let w = makeWindowWithConfig();
let { window, document, events } = w;

check('S1 heading "The call is already hot"', heading(document).includes('The call is already hot'));
check('Progress label "Screen 1 of 6"', (document.querySelector('.el-progress-label') || { textContent: '' }).textContent.includes('1 of 6'));
check('Theme primary applied (#164E63)', themeVar(document) === '#164E63', themeVar(document));
check('Theme muted applied (#78716C)', document.getElementById('engine-root').style.getPropertyValue('--el-muted').trim() === '#78716C');
check('Theme border applied (#E7E5E4)', document.getElementById('engine-root').style.getPropertyValue('--el-border').trim() === '#E7E5E4');
const logo = document.querySelector('.el-logo');
check('Logo rendered in topbar', !!logo);
check('Logo has alt text', !!logo && (logo.getAttribute('alt') || '').length > 0, logo && logo.getAttribute('alt'));

console.log('— Perfect path (30/30) —');
click(document, '.el-btn-primary'); // S1 -> S2
check('S2 heading "first move"', heading(document).includes('first move'));
check('S2 has 4 radios', document.querySelectorAll('input[name="el-mcq"]').length === 4);
selectRadio(window, document, 'o1');
click(document, '.el-btn-primary'); // Check
check('S2 verdict correct', (document.querySelector('.el-verdict') || { className: '' }).className.includes('is-correct'));
click(document, '.el-btn-primary'); // S2 -> S3

check('S3 heading "refund demand"', heading(document).includes('refund demand'));
check('S3 has 3 choices', document.querySelectorAll('.el-choice').length === 3);
click(document, '.el-choice[data-choice="c1"]'); // +10
check('S3 consequence shown', !!document.querySelector('.el-consequence'));
click(document, '.el-btn-primary'); // S3 -> S4 (branches rejoin)

check('S4 heading "toolkit"', heading(document).includes('toolkit'));
click(document, '.el-btn-primary'); // S4 -> S5

check('S5 heading "rebuild trust"', heading(document).includes('rebuild trust'));
selectRadio(window, document, 'o1');
click(document, '.el-btn-primary'); // Check
click(document, '.el-btn-primary'); // S5 -> S6

check('S6 heading "Your results"', heading(document).includes('Your results'));
check('S6 Passed banner', !!document.querySelector('.el-result-banner.is-pass'));
const scoreNum = (document.querySelector('.el-score-num') || { textContent: '' }).textContent;
const scoreSub = (document.querySelector('.el-score-sub') || { textContent: '' }).textContent;
check('S6 score 100%', scoreNum.includes('100%'), scoreNum);
check('S6 points "30 of 30"', scoreSub.includes('30 of 30'), scoreSub);
check('S6 shows 80% pass bar', scoreSub.includes('80% to pass'), scoreSub);
check('S6 certificate shown', !!document.querySelector('.el-certificate'));
check('engine:complete fired', events.includes('engine:complete'));
const state = window.LearningEngine.getState();
check('getState: success passed', state.success === 'passed');

const saved = snapshotStorage(window);
const key = 'elearn-state-' + config.meta.courseId;
const bytes = (saved[key] || '').length;
check(`suspend payload ${bytes}B present and < 4096B`, bytes > 0 && bytes < 4096, `${bytes}B`);

console.log('— All-wrong path (negative delta, 0/30) —');
const w2 = makeWindowWithConfig();
click(w2.document, '.el-btn-primary'); // S1 -> S2
selectRadio(w2.window, w2.document, 'o2'); // wrong
click(w2.document, '.el-btn-primary'); // Check
click(w2.document, '.el-btn-primary'); // S2 -> S3
click(w2.document, '.el-choice[data-choice="c3"]'); // -5 on a 0 score
click(w2.document, '.el-btn-primary'); // S3 -> S4
click(w2.document, '.el-btn-primary'); // S4 -> S5
selectRadio(w2.window, w2.document, 'o3'); // wrong
click(w2.document, '.el-btn-primary'); // Check
click(w2.document, '.el-btn-primary'); // S5 -> S6
const num2 = (w2.document.querySelector('.el-score-num') || { textContent: '' }).textContent;
check('All-wrong scores 0%', num2.includes('0%'), num2);
check('All-wrong shows fail banner', !!w2.document.querySelector('.el-result-banner.is-fail'));
check('All-wrong shows fail message', (w2.document.querySelector('.el-result-msg') || { textContent: '' }).textContent.includes('Review the four steps'));
check('Score never goes negative', w2.window.LearningEngine.getState().score === 0);
check('No certificate on fail', !w2.document.querySelector('.el-certificate'));

console.log('— Mid path (20/30 = 67% < 80% bar) —');
const w3 = makeWindowWithConfig();
click(w3.document, '.el-btn-primary'); // S1 -> S2
selectRadio(w3.window, w3.document, 'o1');
click(w3.document, '.el-btn-primary'); // Check
click(w3.document, '.el-btn-primary'); // S2 -> S3
click(w3.document, '.el-choice[data-choice="c2"]'); // 0 points
click(w3.document, '.el-btn-primary'); // S3 -> S4
click(w3.document, '.el-btn-primary'); // S4 -> S5
selectRadio(w3.window, w3.document, 'o1');
click(w3.document, '.el-btn-primary'); // Check
click(w3.document, '.el-btn-primary'); // S5 -> S6
const num3 = (w3.document.querySelector('.el-score-num') || { textContent: '' }).textContent;
const sub3 = (w3.document.querySelector('.el-score-sub') || { textContent: '' }).textContent;
check('Mid path scores 67%', num3.includes('67%'), num3 + ' / ' + sub3);
check('67% fails the 80% bar', !!w3.document.querySelector('.el-result-banner.is-fail'));

console.log('\n==============================');
if (failures.length === 0) console.log(`ALL ${step} CHECKS PASSED`);
else {
  console.log(`${failures.length} FAILURES out of ${step}:`);
  failures.forEach(f => console.log('  - ' + f));
  process.exitCode = 1;
}
