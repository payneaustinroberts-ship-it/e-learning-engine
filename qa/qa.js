/**
 * Headless click-through QA for the e-learning engine demo course.
 * Run: node qa.js  (from ~/workspace/elearning-engine/qa/)
 * Serves nothing itself — expects the dev server on http://localhost:8123/
 */
const { chromium } = require('playwright-core');

const BASE = 'http://localhost:8123/index.html';
const SHOTS = __dirname + '/screenshots';

let failures = [];
let step = 0;

function check(name, cond, detail = '') {
  step++;
  if (cond) {
    console.log(`  PASS [${step}] ${name}`);
  } else {
    console.log(`  FAIL [${step}] ${name}${detail ? ' — ' + detail : ''}`);
    failures.push(name);
  }
}

(async () => {
  const fs = require('fs');
  fs.mkdirSync(SHOTS, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(String(e)));

  const shot = n => page.screenshot({ path: `${SHOTS}/${String(n).padStart(2, '0')}.png` });
  const h2 = () => page.textContent('.screen h2');
  const clickContinue = () => page.click('.btn-primary');
  const clickBack = () => page.click('.btn-back');

  console.log('— Loading course —');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.screen', { timeout: 10000 });

  // ---- Screen 1: content ----
  console.log('— Screen 1 (content) —');
  check('S1 heading is "Stop the slip"', (await h2()).includes('Stop the slip'));
  check('S1 has Continue button', await page.isVisible('.btn-primary'));
  await shot(1);
  await clickContinue();
  await page.waitForTimeout(300);

  // ---- Screen 2: MCQ ----
  console.log('— Screen 2 (multiple choice) —');
  check('S2 heading is "Quick check"', (await h2()).includes('Quick check'));
  check('S2 has 4 radio options', (await page.$$('input[type="radio"]')).length === 4);
  check('S2 Continue/Check disabled before answering', await page.isDisabled('.btn-primary'));
  await page.check('input[value="opt2"]'); // correct answer
  check('S2 Check enabled after selecting', await page.isEnabled('.btn-primary'));
  await clickContinue(); // "Check answer"
  await page.waitForTimeout(300);
  const fb = await page.textContent('.feedback');
  check('S2 feedback says Correct', fb.includes('Correct'), `got: ${fb.trim().slice(0, 60)}`);
  check('S2 feedback is announced (aria-live)', await page.getAttribute('.feedback', 'aria-live') === 'polite');
  await shot(2);
  await clickContinue(); // continue to screen 3
  await page.waitForTimeout(300);

  // ---- Screen 3: content + image ----
  console.log('— Screen 3 (content + image) —');
  check('S3 heading is "The 3-step response"', (await h2()).includes('3-step response'));
  check('S3 image has alt text', (await page.getAttribute('.screen img', 'alt') || '').length > 0);
  await shot(3);
  // Back button test
  await clickBack();
  await page.waitForTimeout(300);
  check('Back from S3 returns to S2', (await h2()).includes('Quick check'));
  check('S2 still shows answered state after Back', (await page.textContent('.feedback')).includes('Correct'));
  await clickContinue(); // S2 -> S3 again
  await page.waitForTimeout(300);
  await clickContinue(); // S3 -> S4
  await page.waitForTimeout(300);

  // ---- Screen 4: scenario ----
  console.log('— Screen 4 (scenario) —');
  check('S4 heading is "Decision point"', (await h2()).includes('Decision point'));
  check('S4 has 2 choice buttons', (await page.$$('.choice-btn')).length === 2);
  await page.click('.choice-btn:first-child');
  await page.waitForTimeout(300);
  const cons = await page.textContent('.consequence');
  check('S4 consequence panel appears', cons.includes('What happened:'), `got: ${String(cons).trim().slice(0, 60)}`);
  await shot(4);
  await clickContinue();
  await page.waitForTimeout(300);

  // ---- Screen 5: results ----
  console.log('— Screen 5 (results) —');
  check('S5 heading is "Your results"', (await h2()).includes('Your results'));
  check('S5 shows Passed banner', await page.isVisible('.score-banner.passed'));
  const scoreLine = await page.textContent('.score-line');
  check('S5 score is 100%', scoreLine.includes('100%'), `got: ${scoreLine.trim()}`);
  check('S5 points are 20 of 20', scoreLine.includes('20 of 20'), `got: ${scoreLine.trim()}`);
  check('S5 shows certificate', await page.isVisible('.certificate'));
  await shot(5);

  // ---- Resume after reload ----
  console.log('— Resume after reload —');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.screen', { timeout: 10000 });
  await page.waitForTimeout(300);
  check('Reload resumes at results screen', (await h2()).includes('Your results'));

  // ---- Restart ----
  console.log('— Restart —');
  await page.click('.btn-restart');
  await page.waitForTimeout(300);
  check('Restart returns to screen 1', (await h2()).includes('Stop the slip'));

  // ---- Console / page errors ----
  console.log('— JS errors —');
  check('No console errors', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 300));
  check('No page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));

  // ---- Mobile viewport smoke test ----
  console.log('— Mobile viewport (390px) —');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.screen', { timeout: 10000 });
  check('Mobile: course renders', await page.isVisible('.screen h2'));
  await shot(6);

  await browser.close();

  console.log('\n==============================');
  if (failures.length === 0) {
    console.log(`ALL ${step} CHECKS PASSED`);
  } else {
    console.log(`${failures.length} FAILURES out of ${step} checks:`);
    failures.forEach(f => console.log('  - ' + f));
    process.exitCode = 1;
  }
})().catch(e => { console.error('QA CRASH:', e); process.exit(2); });
