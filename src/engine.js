/*
 * engine.js — the reusable e-learning engine (v0.2.0)
 *
 * Renders any valid course-config JSON: content, multipleChoice, scenario,
 * and results screens. No dependencies, no framework.
 *
 * Design notes:
 *  - Navigation: content/multipleChoice advance linearly through flow.screens;
 *    scenario screens branch via the chosen choice's `next`.
 *  - Learner state is a compact serializable object (ids and deltas only).
 *  - Internal learning events are dispatched on `document` (engine:ready,
 *    engine:screen, engine:answered, engine:choice, engine:complete,
 *    engine:invalid) so xAPI/cmi5 can hook in later without engine changes.
 *  - Accessibility: real radios/buttons, fieldset/legend, aria-live feedback,
 *    focus moved to the heading on every screen change, visible focus styles.
 *  - Resume: relaunching with saved incomplete progress shows a "Welcome back"
 *    gate (Resume / Restart) instead of silently jumping mid-course.
 *  - Theming: config.branding maps onto --el-* CSS variables (primary, accent,
 *    background, text, muted, border, font) plus an optional logo.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LearningEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ENGINE_VERSION = '0.2.0';

  var config = null;
  var mount = null;
  var adapter = null;
  var order = {};     // screen id -> index in flow.screens
  var history = [];   // back-navigation stack (session only)
  var state = null;
  var maxScore = 0;

  /* ---------------- utilities ---------------- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function emit(name, detail) {
    try {
      document.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
    } catch (e) { /* non-DOM environment */ }
  }

  function getValidation() {
    if (typeof EngineValidation !== 'undefined') return EngineValidation;
    try { return require('./validation.js'); } catch (e) { return null; }
  }

  function getAdapter() {
    if (typeof ScormAdapter !== 'undefined') return ScormAdapter;
    try { return require('./scorm.js'); } catch (e) { return null; }
  }

  function getScreen(id) { return config.flow.screens[order[id]]; }

  function linearNext(id) {
    var s = config.flow.screens[order[id] + 1];
    return s ? s.id : null;
  }

  /* ---------------- state ---------------- */

  function freshState() {
    var now = new Date().toISOString();
    return {
      v: 1,
      courseId: config.meta.courseId,
      currentScreenId: config.flow.startScreen,
      visited: [],
      responses: {},   // screenId -> { selectedOptionId|choiceId, correct?, points?, scoreDelta? }
      score: 0,
      status: 'incomplete',   // incomplete | completed
      success: null,          // passed | failed | null
      startedAt: now,
      updatedAt: now,
      completedAt: null
    };
  }

  function persist() {
    state.updatedAt = new Date().toISOString();
    if (adapter) adapter.saveState(state);
  }

  function markVisited(id) {
    if (state.visited.indexOf(id) === -1) state.visited.push(id);
  }

  function computeMaxScore() {
    var total = 0;
    config.flow.screens.forEach(function (s) {
      if (s.type === 'multipleChoice') {
        total += (typeof s.points === 'number' ? s.points : 0);
      } else if (s.type === 'scenario') {
        var best = 0;
        (s.choices || []).forEach(function (c) {
          var d = (typeof c.scoreDelta === 'number') ? c.scoreDelta : 0;
          if (d > best) best = d;
        });
        total += best;
      }
    });
    return total;
  }

  function percent() {
    if (maxScore <= 0) return 100;
    return Math.round((state.score / maxScore) * 100);
  }

  /* ---------------- branding ---------------- */

  function applyBranding() {
    var b = config.branding || {};
    function set(k, v) { mount.style.setProperty(k, v); }
    set('--el-primary', b.primaryColor || '#0F766E');
    set('--el-accent', b.accentColor || '#B45309');
    set('--el-bg', b.backgroundColor || '#FFFFFF');
    set('--el-text', b.textColor || '#1F2937');
    set('--el-muted', b.mutedColor || '#6B7280');
    set('--el-border', b.borderColor || '#E5E7EB');
    if (b.fontFamily) set('--el-font', b.fontFamily);
    try { document.title = config.meta.title; } catch (e) {}
  }

  function logoHTML() {
    var b = config.branding || {};
    if (b.logo && b.logo.src) {
      return '<img class="el-logo" src="' + esc(b.logo.src) + '" alt="' + esc(b.logo.alt || '') + '">';
    }
    return '';
  }

  /* ---------------- navigation ---------------- */

  function goTo(id, pushCurrent) {
    if (pushCurrent !== false) history.push(state.currentScreenId);
    state.currentScreenId = id;
    markVisited(id);
    persist();
    render();
  }

  function goBack() {
    var prev = history.pop();
    if (prev) {
      state.currentScreenId = prev;
      persist();
      render();
    }
  }

  function continueFrom(screen) {
    var nextId = linearNext(screen.id);
    if (nextId) {
      goTo(nextId);
    } else {
      // Course ends without a results screen: complete here with a generic summary.
      completeCourse();
      renderGenericDone();
    }
  }

  function completeCourse() {
    if (state.status === 'completed') return state.success === 'passed';
    var pct = percent();
    var passed = pct >= config.scoring.passingScore;
    state.status = 'completed';
    state.success = passed ? 'passed' : 'failed';
    state.completedAt = new Date().toISOString();
    if (adapter) {
      adapter.setScore(pct);
      adapter.setStatus(passed ? 'passed' : 'failed');
    }
    persist();
    emit('engine:complete', {
      courseId: state.courseId,
      score: state.score,
      maxScore: maxScore,
      percent: pct,
      passed: passed
    });
    return passed;
  }

  /* ---------------- rendering ---------------- */

  function topbarHTML(screen) {
    var idx = order[screen.id] + 1;
    var total = config.flow.screens.length;
    var pct = Math.round((idx / total) * 100);
    return (
      '<header class="el-topbar">' +
        '<div class="el-course-title">' + logoHTML() + '<span>' + esc(config.meta.title) + '</span></div>' +
        '<div class="el-progress-wrap">' +
          '<div class="el-progress-label">Screen ' + idx + ' of ' + total + '</div>' +
          '<div class="el-progress" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100" aria-label="Course progress">' +
            '<div class="el-progress-fill" style="width:' + pct + '%"></div>' +
          '</div>' +
        '</div>' +
      '</header>'
    );
  }

  function footerHTML(screen, primaryLabel, primaryAction) {
    var backDisabled = history.length === 0 ? ' disabled' : '';
    return (
      '<footer class="el-footer">' +
        '<button type="button" class="el-btn el-btn-ghost" data-action="back"' + backDisabled + '>Back</button>' +
        (primaryLabel
          ? '<button type="button" class="el-btn el-btn-primary" data-action="' + primaryAction + '">' + esc(primaryLabel) + '</button>'
          : '') +
      '</footer>'
    );
  }

  function blocksHTML(blocks) {
    return (blocks || []).map(function (b) {
      if (b.type === 'text' || b.type === 'callout') {
        var cls = b.type === 'callout' ? 'el-callout' : 'el-text';
        return '<div class="' + cls + '">' + b.html + '</div>';
      }
      if (b.type === 'list') {
        return '<ul class="el-list">' + b.items.map(function (i) {
          return '<li>' + esc(i) + '</li>';
        }).join('') + '</ul>';
      }
      if (b.type === 'image') {
        return '<figure class="el-media">' +
          '<img src="' + esc(b.src) + '" alt="' + esc(b.alt) + '">' +
          (b.caption ? '<figcaption>' + esc(b.caption) + '</figcaption>' : '') +
          '</figure>';
      }
      if (b.type === 'video') {
        return '<figure class="el-media">' +
          '<video controls src="' + esc(b.src) + '" aria-label="' + esc(b.alt) + '"></video>' +
          (b.caption ? '<figcaption>' + esc(b.caption) + '</figcaption>' : '') +
          '</figure>';
      }
      return '';
    }).join('');
  }

  function renderContent(screen) {
    return { body: blocksHTML(screen.blocks), primary: 'Continue', action: 'continue' };
  }

  function renderMCQ(screen, answered) {
    var body = '<p class="el-prompt">' + esc(screen.prompt) + '</p>';
    body += '<fieldset class="el-options"><legend class="el-legend">Choose one answer</legend>';
    screen.options.forEach(function (o) {
      var cls = 'el-option';
      var checked = '';
      var disabled = '';
      if (answered) {
        disabled = ' disabled';
        if (o.id === answered.selectedOptionId) { cls += answered.correct ? ' is-correct' : ' is-wrong'; checked = ' checked'; }
        else if (o.id === screen.correctOptionId) cls += ' is-correct-answer';
      }
      body += '<label class="' + cls + '">' +
        '<input type="radio" name="el-mcq" value="' + esc(o.id) + '"' + checked + disabled + '>' +
        '<span>' + esc(o.text) + '</span>' +
        '</label>';
    });
    body += '</fieldset><div class="el-feedback" aria-live="polite">';
    if (answered) {
      var verdict = answered.correct ? 'Correct.' : 'Not quite.';
      var vcls = answered.correct ? 'is-correct' : 'is-wrong';
      var optFeedback = '';
      var chosen = screen.options.filter(function (o) { return o.id === answered.selectedOptionId; })[0];
      if (chosen && chosen.feedback) optFeedback = ' ' + esc(chosen.feedback);
      body += '<p class="el-verdict ' + vcls + '">' + verdict + optFeedback + '</p>';
    }
    body += '</div>';
    return {
      body: body,
      primary: answered ? 'Continue' : 'Check answer',
      action: answered ? 'continue' : 'check'
    };
  }

  function renderScenario(screen, answered) {
    var body = '<p class="el-prompt el-scenario-prompt">' + esc(screen.prompt) + '</p>';
    if (!answered) {
      body += '<div class="el-choices">';
      screen.choices.forEach(function (c) {
        body += '<button type="button" class="el-choice" data-choice="' + esc(c.id) + '">' +
          '<span>' + esc(c.text) + '</span></button>';
      });
      body += '</div><div class="el-feedback" aria-live="polite"></div>';
      return { body: body, primary: null, action: null };
    }
    var choice = screen.choices.filter(function (c) { return c.id === answered.choiceId; })[0] || {};
    body += '<div class="el-feedback" aria-live="polite">' +
      '<p class="el-consequence"><strong>What happened:</strong> ' + esc(choice.feedback || '') + '</p>' +
      '</div>';
    return { body: body, primary: 'Continue', action: 'continue-scenario' };
  }

  function renderResults(screen) {
    var passed = completeCourse(); // idempotent; sets score/status on first entry
    var pct = percent();
    var banner = passed
      ? '<div class="el-result-banner is-pass">Passed</div>'
      : '<div class="el-result-banner is-fail">Not passed yet</div>';
    var msg = passed ? (screen.passMessage || '') : (screen.failMessage || '');
    var body = banner;
    if (screen.showScore !== false) {
      body += '<div class="el-score"><span class="el-score-num">' + pct + '%</span>' +
        '<span class="el-score-sub">' + state.score + ' of ' + maxScore + ' points · ' +
        config.scoring.passingScore + '% to pass</span></div>';
    }
    if (msg) body += '<p class="el-result-msg">' + esc(msg) + '</p>';

    var cert = config.certificate;
    if (cert && cert.enabled && passed) {
      var date = new Date().toLocaleDateString();
      body += '<div class="el-certificate">' +
        '<div class="el-cert-title">' + esc(cert.title || 'Certificate of Completion') + '</div>' +
        '<div class="el-cert-body">' + esc(cert.message || '') + '</div>' +
        '<div class="el-cert-meta">' + esc(config.meta.title) + ' · ' + esc(date) + '</div>' +
        '</div>';
    }

    if (config.resources && config.resources.length) {
      body += '<div class="el-resources"><h2 class="el-h2">Keep learning</h2><ul>' +
        config.resources.map(function (r) {
          return '<li><a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.label) + '</a></li>';
        }).join('') + '</ul></div>';
    }

    return { body: body, primary: 'Restart course', action: 'restart' };
  }

  function renderGenericDone() {
    var pct = percent();
    mount.innerHTML = '<div class="el"><main class="el-main">' +
      '<h1 class="el-heading" tabindex="-1">Course complete</h1>' +
      '<p class="el-result-msg">You scored ' + pct + '% (' + state.score + ' of ' + maxScore + ' points).</p>' +
      '<button type="button" class="el-btn el-btn-primary" data-action="restart">Restart course</button>' +
      '</main></div>';
    wireGeneric();
  }

  function renderResumeGate() {
    var screen = getScreen(state.currentScreenId);
    var where = screen ? screen.title : '';
    mount.innerHTML = '<div class="el">' +
      '<main class="el-main">' +
      '<h1 class="el-heading" tabindex="-1">Welcome back</h1>' +
      '<p class="el-result-msg">You left off at &ldquo;' + esc(where) + '&rdquo;. ' +
      'Pick up where you left off, or start the course over.</p>' +
      '<div class="el-gate-actions">' +
      '<button type="button" class="el-btn el-btn-primary" data-action="resume-course">Resume where I left off</button>' +
      '<button type="button" class="el-btn el-btn-ghost" data-action="restart-course">Restart course</button>' +
      '</div>' +
      '</main></div>';
    var h = mount.querySelector('.el-heading');
    if (h) h.focus();
    mount.querySelector('[data-action="resume-course"]').addEventListener('click', function () { render(); });
    mount.querySelector('[data-action="restart-course"]').addEventListener('click', restart);
    emit('engine:screen', { screenId: '__resume_gate', type: 'gate' });
  }

  function renderInvalid(result) {
    var items = result.errors.map(function (e) {
      return '<li><code>' + esc(e.path) + '</code> — ' + esc(e.message) + '</li>';
    }).join('');
    mount.innerHTML = '<div class="el"><main class="el-main">' +
      '<h1 class="el-heading" tabindex="-1">This course config has errors</h1>' +
      '<p class="el-result-msg">Fix these in the JSON config and reload:</p>' +
      '<ul class="el-error-list">' + items + '</ul>' +
      '</main></div>';
    emit('engine:invalid', { errors: result.errors });
  }

  function render() {
    var screen = getScreen(state.currentScreenId);
    if (!screen) { renderGenericDone(); return; }

    var answered = state.responses[screen.id] || null;
    var out;
    if (screen.type === 'content') out = renderContent(screen);
    else if (screen.type === 'multipleChoice') out = renderMCQ(screen, answered);
    else if (screen.type === 'scenario') out = renderScenario(screen, answered);
    else if (screen.type === 'results') out = renderResults(screen);

    var html = '<div class="el">' + topbarHTML(screen) +
      '<main class="el-main"><h1 class="el-heading" tabindex="-1">' + esc(screen.title) + '</h1>' +
      out.body + '</main>';
    html += footerHTML(screen, out.primary, out.action);
    html += '</div>';

    mount.innerHTML = html;
    var h = mount.querySelector('.el-heading');
    if (h) h.focus();
    wire(screen, answered, out);
    emit('engine:screen', { screenId: screen.id, type: screen.type });
  }

  /* ---------------- wiring ---------------- */

  function wire(screen, answered, out) {
    var backBtn = mount.querySelector('[data-action="back"]');
    if (backBtn) backBtn.addEventListener('click', goBack);

    var primary = mount.querySelector('.el-footer [data-action="' + (out.action || '') + '"]');
    if (!primary) { wireChoices(screen); wireRestart(); return; }

    primary.addEventListener('click', function () {
      var action = primary.getAttribute('data-action');
      if (action === 'continue') continueFrom(screen);
      else if (action === 'continue-scenario') {
        var resp = state.responses[screen.id];
        var choice = screen.choices.filter(function (c) { return c.id === resp.choiceId; })[0];
        if (choice && choice.next) goTo(choice.next);
      }
      else if (action === 'check') checkMCQ(screen);
      else if (action === 'restart') restart();
    });

    wireChoices(screen);
    if (out.action !== 'restart') wireRestart(); // primary handler already covers restart
  }

  function wireChoices(screen) {
    var buttons = mount.querySelectorAll('[data-choice]');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var choice = screen.choices.filter(function (c) { return c.id === btn.getAttribute('data-choice'); })[0];
        if (!choice) return;
        var delta = (typeof choice.scoreDelta === 'number') ? choice.scoreDelta : 0;
        state.score = Math.max(0, state.score + delta);
        state.responses[screen.id] = { choiceId: choice.id, scoreDelta: delta };
        markVisited(screen.id);
        persist();
        emit('engine:choice', { screenId: screen.id, choiceId: choice.id, scoreDelta: delta });
        render();
      });
    });
  }

  function wireRestart() {
    var btn = mount.querySelector('[data-action="restart"]');
    if (btn) btn.addEventListener('click', restart);
  }

  function wireGeneric() {
    wireRestart();
    var h = mount.querySelector('.el-heading');
    if (h) h.focus();
  }

  function checkMCQ(screen) {
    var selected = mount.querySelector('input[name="el-mcq"]:checked');
    var feedback = mount.querySelector('.el-feedback');
    if (!selected) {
      if (feedback) feedback.innerHTML = '<p class="el-verdict">Choose an answer first.</p>';
      return;
    }
    var optId = selected.value;
    var correct = optId === screen.correctOptionId;
    var points = correct ? (typeof screen.points === 'number' ? screen.points : 0) : 0;
    state.responses[screen.id] = { selectedOptionId: optId, correct: correct, points: points };
    state.score = Math.max(0, state.score + points);
    markVisited(screen.id);
    persist();
    emit('engine:answered', {
      screenId: screen.id, selectedOptionId: optId, correct: correct, points: points
    });
    render();
  }

  function restart() {
    if (adapter) adapter.clearState();
    history = [];
    state = freshState();
    markVisited(state.currentScreenId);
    persist();
    render();
  }

  /* ---------------- public API ---------------- */

  function start(cfg, mountEl) {
    if (!mountEl) throw new Error('LearningEngine.start(config, mountEl): mountEl is required.');
    config = cfg;
    mount = mountEl;
    history = [];
    order = {};
    config.flow = config.flow || {};
    (config.flow.screens || []).forEach(function (s, i) { if (s && s.id) order[s.id] = i; });

    var v = getValidation();
    var result = v ? v.validateConfig(config) : { valid: true, errors: [], warnings: [] };
    if (!result.valid) { renderInvalid(result); return; }
    result.warnings.forEach(function (w) {
      if (typeof console !== 'undefined') console.warn('[engine] ' + w.path + ': ' + w.message);
    });

    applyBranding();
    maxScore = computeMaxScore();

    var Adapter = getAdapter();
    adapter = Adapter ? new Adapter(config.meta.courseId) : null;
    if (adapter) adapter.connect();

    var saved = adapter ? adapter.loadState() : null;
    state = saved || freshState();
    markVisited(state.currentScreenId);
    persist();

    if (typeof window !== 'undefined') {
      window.addEventListener('unload', function () { if (adapter) adapter.disconnect(); });
    }

    emit('engine:ready', { courseId: state.courseId, resumed: !!saved, engineVersion: ENGINE_VERSION });

    // Saved incomplete progress past the first screen: offer a resume gate
    // instead of silently jumping mid-course. Completed courses go straight
    // to their results screen.
    if (saved && saved.status === 'incomplete' && saved.currentScreenId !== config.flow.startScreen) {
      renderResumeGate();
      return;
    }
    render();
  }

  function getState() { return state ? JSON.parse(JSON.stringify(state)) : null; }

  return { start: start, getState: getState, version: ENGINE_VERSION };
}));
