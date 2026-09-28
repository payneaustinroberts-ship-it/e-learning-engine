/*
 * scorm.js — thin LMS wrapper for the e-learning engine (v0.1.0)
 *
 * SCORM 1.2 now. The wrapper is deliberately thin so a 2004 (or xAPI/cmi5)
 * mapping can sit alongside it later without touching the engine:
 * the engine only ever calls connect(), saveState(), loadState(),
 * setScore(), setStatus(), commit(), disconnect().
 *
 * No LMS found (local testing)? Falls back to localStorage so the course
 * still runs, saves, and resumes. suspend_data is capped for SCORM 1.2's
 * ~4KB limit — the engine stores ids and deltas, never content.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ScormAdapter = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SUSPEND_LIMIT = 4000;

  function ScormAdapter(courseId) {
    this.courseId = courseId;
    this.api = null;
    this.active = false;
    this.lms = false; // true when a real SCORM API was found
    this.store = {};  // localStorage fallback bucket
    this.storageKey = 'elearn-state-' + courseId;
  }

  // Standard SCORM 1.2 API discovery: the API object can live on this
  // window, anywhere up the parent/frameset chain, or on the opener
  // (SCORM Cloud's sandbox launches the SCO in a new window, so the API
  // is usually on window.opener — missing that case silently drops all
  // LMS reporting into the localStorage fallback).
  ScormAdapter.prototype._findAPI = function (win) {
    var attempts = 0;
    var current = win;
    while (current && attempts < 500) {
      attempts++;
      try {
        if (current.API) return current.API;
      } catch (e) { /* cross-origin — keep looking */ }
      // Opener chain: new-window launches put the API here.
      try {
        var opener = current.opener;
        var oAttempts = 0;
        while (opener && !opener.closed && oAttempts < 50) {
          oAttempts++;
          try {
            if (opener.API) return opener.API;
          } catch (e2) { break; }
          if (opener.parent === opener) break;
          opener = opener.parent;
        }
      } catch (e) { /* cross-origin — keep looking */ }
      try {
        if (current.parent === current) break;
        current = current.parent;
      } catch (e) { break; }
    }
    return null;
  };

  ScormAdapter.prototype.connect = function () {
    if (typeof window !== 'undefined') {
      this.api = this._findAPI(window);
    }
    if (this.api) {
      try {
        var ok = this.api.LMSInitialize('') === 'true';
        this.active = ok;
        this.lms = ok;
      } catch (e) {
        this.active = false;
        this.lms = false;
      }
    }
    if (!this.lms) {
      // Fallback: local testing without an LMS.
      this.active = true;
      try {
        this.store = JSON.parse(localStorage.getItem(this.storageKey) || '{}');
      } catch (e) { this.store = {}; }
    }
    return this.active;
  };

  ScormAdapter.prototype.get = function (key) {
    if (this.lms && this.api) {
      try { return this.api.LMSGetValue(key); } catch (e) { return ''; }
    }
    return this.store[key] || '';
  };

  ScormAdapter.prototype.set = function (key, value) {
    if (this.lms && this.api) {
      try { return this.api.LMSSetValue(key, String(value)); } catch (e) { return 'false'; }
    }
    this.store[key] = String(value);
    return 'true';
  };

  ScormAdapter.prototype.commit = function () {
    if (this.lms && this.api) {
      try { this.api.LMSCommit(''); } catch (e) {}
      return;
    }
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.store)); } catch (e) {}
  };

  // Compact, serializable learner state only: ids, indices, deltas — never content.
  ScormAdapter.prototype.saveState = function (stateObj) {
    var json = JSON.stringify(stateObj);
    if (json.length > SUSPEND_LIMIT) {
      // Trim strategy: visited history is nice-to-have; drop it first.
      var trimmed = JSON.parse(json);
      trimmed.visited = [];
      json = JSON.stringify(trimmed);
    }
    if (json.length > SUSPEND_LIMIT) {
      // Last resort: keep only what resume and reporting need.
      json = JSON.stringify({
        v: stateObj.v,
        courseId: stateObj.courseId,
        currentScreenId: stateObj.currentScreenId,
        score: stateObj.score,
        status: stateObj.status,
        success: stateObj.success
      });
    }
    this.set('cmi.suspend_data', json);
    this.commit(); // commit on meaningful state changes, never rely on unload alone
  };

  ScormAdapter.prototype.loadState = function () {
    var raw = this.get('cmi.suspend_data');
    if (!raw) return null;
    try {
      var s = JSON.parse(raw);
      if (s && s.courseId === this.courseId && s.v === 1) return s;
      return null;
    } catch (e) { return null; }
  };

  ScormAdapter.prototype.clearState = function () {
    this.set('cmi.suspend_data', '');
    this.commit();
  };

  ScormAdapter.prototype.setScore = function (raw /* 0-100 */) {
    this.set('cmi.core.score.min', '0');
    this.set('cmi.core.score.max', '100');
    this.set('cmi.core.score.raw', String(raw));
  };

  // SCORM 1.2 lesson_status doubles as completion + success: incomplete | completed | passed | failed
  ScormAdapter.prototype.setStatus = function (status) {
    this.set('cmi.core.lesson_status', status);
  };

  ScormAdapter.prototype.disconnect = function () {
    if (!this.active) return;
    this.commit();
    if (this.lms && this.api) {
      try {
        // We always persist suspend_data, so tell the LMS this session may
        // resume rather than exiting cleanly with no state to return to.
        this.api.LMSSetValue('cmi.core.exit', 'suspend');
        this.api.LMSFinish('');
      } catch (e) {}
    }
    this.active = false;
  };

  return ScormAdapter;
}));
