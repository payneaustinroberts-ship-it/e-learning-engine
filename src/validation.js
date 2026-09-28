/*
 * validation.js — config check for the e-learning engine (v0.2.0)
 *
 * Hand-rolled structural validator that enforces the course-config contract,
 * including the cross-references JSON Schema can't check on its own:
 *   - every `next` and `startScreen` points at a real screen id
 *   - screen ids are unique
 *   - media always carries alt text (accessibility is enforced, not optional)
 *   - every screen is reachable from the start screen
 *
 * Works in the browser (global `EngineValidation`) and in Node (module.exports),
 * so build.js can validate with the exact same code the player runs.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.EngineValidation = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SCHEMA_VERSION = '0.1.0';
  var SCREEN_TYPES = ['content', 'multipleChoice', 'scenario', 'results'];

  function isStr(v) {
    return typeof v === 'string' && v.trim().length > 0;
  }

  function validateConfig(config) {
    var errors = [];
    var warnings = [];

    function E(path, message) { errors.push({ path: path, message: message }); }
    function W(path, message) { warnings.push({ path: path, message: message }); }

    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return { valid: false, errors: [{ path: '$', message: 'Config must be a JSON object.' }], warnings: [] };
    }

    if (config.schemaVersion !== SCHEMA_VERSION) {
      E('schemaVersion', 'schemaVersion must be "' + SCHEMA_VERSION + '" (got ' + JSON.stringify(config.schemaVersion) + ').');
    }
    if (!isStr(config.engineVersion)) {
      E('engineVersion', 'engineVersion is required (semver, e.g. "0.1.0"). Courses pin to an engine version.');
    }

    // ---- meta ----
    var meta = config.meta || {};
    if (!isStr(meta.courseId)) E('meta.courseId', 'meta.courseId is required.');
    if (!isStr(meta.title)) E('meta.title', 'meta.title is required.');

    // ---- branding ----
    var branding = config.branding || {};
    if (branding.logo) {
      var logo = branding.logo;
      if (!isStr(logo.src)) E('branding.logo.src', 'branding.logo.src is required.');
      if (!isStr(logo.alt)) E('branding.logo.alt', 'Logo alt text is REQUIRED (accessibility).');
    }
    ['primaryColor', 'accentColor', 'backgroundColor', 'textColor', 'mutedColor', 'borderColor']
      .forEach(function (k) {
        var v = branding[k];
        if (typeof v === 'string' && v.charAt(0) === '#' &&
            !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
          E('branding.' + k, 'Colors must be valid hex like "#0F766E" (got "' + v + '").');
        }
      });

    // ---- scoring ----
    var scoring = config.scoring || {};
    if (typeof scoring.passingScore !== 'number' || scoring.passingScore < 0 || scoring.passingScore > 100) {
      E('scoring.passingScore', 'scoring.passingScore must be a number between 0 and 100.');
    }

    // ---- flow / screens ----
    var flow = config.flow || {};
    var screens = flow.screens;
    var ids = {};

    if (!isStr(flow.startScreen)) E('flow.startScreen', 'flow.startScreen is required (id of the first screen).');
    if (!Array.isArray(screens) || screens.length === 0) {
      E('flow.screens', 'flow.screens must be a non-empty array.');
      screens = [];
    }

    screens.forEach(function (s, i) {
      var p = 'flow.screens[' + i + ']';
      if (!s || typeof s !== 'object') { E(p, 'Screen must be an object.'); return; }
      if (!isStr(s.id)) { E(p + '.id', 'Screen id is required.'); return; }
      if (ids[s.id]) E(p + '.id', 'Duplicate screen id "' + s.id + '".');
      ids[s.id] = true;
      if (!isStr(s.title)) E(p + '.title', 'Screen title is required.');
      if (SCREEN_TYPES.indexOf(s.type) === -1) { E(p + '.type', 'Unknown screen type "' + s.type + '".'); return; }

      if (s.type === 'content') {
        var blocks = s.blocks || [];
        if (!Array.isArray(blocks) || blocks.length === 0) E(p + '.blocks', 'Content screens need at least one block.');
        blocks.forEach(function (b, bi) {
          var bp = p + '.blocks[' + bi + ']';
          if (!b || ['text', 'list', 'image', 'video', 'callout'].indexOf(b.type) === -1) {
            E(bp + '.type', 'Unknown block type "' + (b && b.type) + '".'); return;
          }
          if ((b.type === 'text' || b.type === 'callout') && !isStr(b.html)) E(bp + '.html', 'Text/callout blocks need html.');
          if (b.type === 'list' && (!Array.isArray(b.items) || b.items.length === 0)) E(bp + '.items', 'List blocks need a non-empty items array.');
          if (b.type === 'image' || b.type === 'video') {
            if (!isStr(b.src)) E(bp + '.src', 'Media src is required.');
            if (!isStr(b.alt)) E(bp + '.alt', 'Alt text is REQUIRED for every image/video (accessibility).');
          }
        });
      }

      if (s.type === 'multipleChoice') {
        if (!isStr(s.prompt)) E(p + '.prompt', 'Question prompt is required.');
        var opts = s.options || [];
        if (!Array.isArray(opts) || opts.length < 2) E(p + '.options', 'Need at least 2 options.');
        var optIds = {};
        opts.forEach(function (o, oi) {
          if (!o || !isStr(o.id)) E(p + '.options[' + oi + '].id', 'Option id is required.');
          else optIds[o.id] = true;
          if (!o || !isStr(o.text)) E(p + '.options[' + oi + '].text', 'Option text is required.');
        });
        if (!isStr(s.correctOptionId) || !optIds[s.correctOptionId]) {
          E(p + '.correctOptionId', 'correctOptionId must match one of the option ids.');
        }
        if (s.points !== undefined && (typeof s.points !== 'number' || s.points < 0)) {
          E(p + '.points', 'points must be a non-negative number.');
        }
      }

      if (s.type === 'scenario') {
        if (!isStr(s.prompt)) E(p + '.prompt', 'Scenario prompt is required.');
        var choices = s.choices || [];
        if (!Array.isArray(choices) || choices.length < 2) E(p + '.choices', 'Scenarios need at least 2 choices.');
        choices.forEach(function (c, ci) {
          var cp = p + '.choices[' + ci + ']';
          if (!c || !isStr(c.id)) E(cp + '.id', 'Choice id is required.');
          if (!c || !isStr(c.text)) E(cp + '.text', 'Choice text is required.');
          if (!c || !isStr(c.feedback)) E(cp + '.feedback', 'Choice feedback is required — learners must see consequences.');
          if (!c || !isStr(c.next)) E(cp + '.next', 'Choice next (screen id) is required.');
          if (c && c.scoreDelta !== undefined && typeof c.scoreDelta !== 'number') {
            E(cp + '.scoreDelta', 'scoreDelta must be a number.');
          }
        });
      }
    });

    // ---- cross-references ----
    if (isStr(flow.startScreen) && !ids[flow.startScreen]) {
      E('flow.startScreen', 'startScreen "' + flow.startScreen + '" does not match any screen id.');
    }
    screens.forEach(function (s) {
      if (s && s.type === 'scenario') {
        (s.choices || []).forEach(function (c) {
          if (c && isStr(c.next) && !ids[c.next]) {
            E('flow.screens[id=' + s.id + '].choices[id=' + c.id + '].next',
              'next "' + c.next + '" does not match any screen id.');
          }
        });
      }
    });

    // ---- reachability (BFS from start) ----
    if (screens.length && ids[flow.startScreen]) {
      var order = {};
      screens.forEach(function (s, i) { order[s.id] = i; });
      var seen = {};
      var stack = [flow.startScreen];
      while (stack.length) {
        var id = stack.pop();
        if (seen[id]) continue;
        seen[id] = true;
        var s = screens[order[id]];
        if (!s) continue;
        if (s.type === 'scenario') {
          (s.choices || []).forEach(function (c) { if (c && isStr(c.next)) stack.push(c.next); });
        } else {
          var nxt = screens[order[id] + 1];
          if (nxt) stack.push(nxt.id);
        }
      }
      screens.forEach(function (s) {
        if (!seen[s.id]) W('flow.screens[id=' + s.id + ']', 'Screen is unreachable from startScreen — learners can never see it.');
      });
    }

    var hasResults = screens.some(function (s) { return s && s.type === 'results'; });
    if (!hasResults) W('flow', 'No results screen — learners never see a score or completion state.');

    return { valid: errors.length === 0, errors: errors, warnings: warnings };
  }

  return { validateConfig: validateConfig, SCHEMA_VERSION: SCHEMA_VERSION };
}));
