/* ============================================================
   STRYD — cookie consent + consent-gated analytics (PostHog)
   - Opt-in. Before "Accept": no PostHog script, no PostHog network requests, no attribution storage.
   - On accept: loads PostHog through our own domain (/ingest) and captures first-touch attribution.
   - On decline: nothing loads. The "where did you hear about us" answer carries attribution.
   - Keep POLICY_VERSION in sync with PRIVACY_POLICY_VERSION in netlify/functions/lib/config.js (a test enforces it).
   ============================================================ */
(function () {
  'use strict';

  var POLICY_VERSION = '2026-10-06';
  var CONSENT_KEY = 'stryd_consent';
  var ATTR_KEY = 'stryd_attr';
  var ATTR_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'lk'];

  var ph = null;           // PostHog instance once ready
  var queue = [];          // events captured before PostHog finished loading
  var loadStarted = false;
  var listeners = [];

  /* ---------- storage (always try/catch: private mode / blocked storage) ---------- */
  function readConsent() {
    try {
      var v = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null');
      if (v && (v.choice === 'accepted' || v.choice === 'declined') && v.policy_version === POLICY_VERSION) return v;
    } catch (e) { /* ignore */ }
    return null;
  }
  function writeConsent(choice) {
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify({ choice: choice, ts: Date.now(), policy_version: POLICY_VERSION }));
    } catch (e) { /* ignore */ }
  }
  function accepted() { var c = readConsent(); return !!c && c.choice === 'accepted'; }

  /* ---------- first-touch attribution (only after consent) ---------- */
  function captureAttribution() {
    if (!accepted()) return;
    try {
      var existing = JSON.parse(localStorage.getItem(ATTR_KEY) || 'null');
      if (existing && existing.ts && Date.now() - existing.ts < ATTR_TTL_MS) return; // first touch wins for 30 days
    } catch (e) { /* ignore */ }
    var q = new URLSearchParams(location.search);
    var v = {};
    UTM_KEYS.forEach(function (k) {
      var val = (q.get(k) || '').trim().slice(0, 100);
      if (val) v[k] = val;
    });
    v.landing_path = location.pathname; // path only, never the query string (it can hold a token)
    try {
      if (document.referrer) {
        var h = new URL(document.referrer).hostname;
        if (h && h !== location.hostname) v.referrer_host = h;
      }
    } catch (e) { /* ignore */ }
    try { localStorage.setItem(ATTR_KEY, JSON.stringify({ ts: Date.now(), v: v })); } catch (e) { /* ignore */ }
  }
  function getAttribution() {
    if (!accepted()) return {};
    try {
      var a = JSON.parse(localStorage.getItem(ATTR_KEY) || 'null');
      if (a && a.v && a.ts && Date.now() - a.ts < ATTR_TTL_MS) return a.v;
    } catch (e) { /* ignore */ }
    return {};
  }
  function clearAttribution() { try { localStorage.removeItem(ATTR_KEY); } catch (e) { /* ignore */ } }

  /* ---------- PostHog ---------- */
  // The confirm link carries a one-time token. Never let it into captured URLs or referrers.
  function scrub(str) { return typeof str === 'string' ? str.replace(/([?&])token=[^&#]*/gi, '$1token=REDACTED') : str; }
  function beforeSend(evt) {
    if (evt && evt.properties) {
      Object.keys(evt.properties).forEach(function (k) { evt.properties[k] = scrub(evt.properties[k]); });
    }
    return evt;
  }

  function loadPostHog() {
    if (loadStarted) { if (ph && ph.opt_in_capturing) ph.opt_in_capturing(); return; }
    loadStarted = true;
    fetch('/api/config', { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) {
        if (!cfg || !cfg.analytics || !cfg.posthogKey || !accepted()) return;
        var s = document.createElement('script');
        s.async = true;
        s.src = '/ingest/static/array.js';
        s.onload = function () {
          if (!window.posthog || typeof window.posthog.init !== 'function') return;
          window.posthog.init(cfg.posthogKey, {
            api_host: '/ingest',
            ui_host: cfg.uiHost,
            autocapture: true,
            capture_pageview: true,
            capture_pageleave: true,
            persistence: 'localStorage+cookie',
            session_recording: { maskAllInputs: true },
            before_send: beforeSend,
            loaded: function (p) {
              ph = p;
              p.register({ theme: document.documentElement.getAttribute('data-theme') || 'dark' });
              queue.splice(0).forEach(function (e) { p.capture(e[0], e[1]); });
            },
          });
        };
        document.head.appendChild(s);
      })
      .catch(function () { loadStarted = false; });
  }

  function track(name, props) {
    if (!accepted()) return;
    if (ph) ph.capture(name, props || {});
    else if (loadStarted) queue.push([name, props || {}]);
  }

  document.addEventListener('stryd:theme', function (e) {
    if (ph) ph.register({ theme: e.detail });
  });

  /* ---------- banner ---------- */
  var CSS = '' +
    '.stryd-cc{--cc-bg:rgba(18,18,18,.94);--cc-ink:#fff;--cc-border:rgba(255,255,255,.22);position:fixed;left:12px;right:12px;bottom:12px;z-index:1000;' +
    'max-width:720px;margin:0 auto;padding:16px 18px;border-radius:16px;background:var(--cc-bg);color:var(--cc-ink);border:1px solid var(--cc-border);' +
    '-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);box-shadow:0 12px 40px rgba(0,0,0,.45);' +
    'font:400 14px/1.45 "DM Sans","Inter",system-ui,sans-serif;display:flex;gap:14px;align-items:center;flex-wrap:wrap}' +
    ':root[data-theme="light"] .stryd-cc{--cc-bg:rgba(255,255,255,.95);--cc-ink:#000;--cc-border:rgba(0,0,0,.2);box-shadow:0 12px 40px rgba(0,0,0,.18)}' +
    '.stryd-cc p{margin:0;flex:1 1 280px;color:var(--cc-ink)}' +
    '.stryd-cc a{color:var(--cc-ink);text-decoration:underline}' +
    '.stryd-cc .cc-btns{display:flex;gap:10px;flex:0 0 auto}' +
    '.stryd-cc button{min-height:44px;min-width:96px;padding:0 18px;border-radius:12px;font:600 14px "DM Sans","Inter",system-ui,sans-serif;cursor:pointer;' +
    'border:1px solid var(--cc-ink);background:transparent;color:var(--cc-ink)}' +
    '.stryd-cc button.cc-accept{background:#006FBF;border-color:#006FBF;color:#fff}' +
    '.stryd-cc button:hover{filter:brightness(1.12)}' +
    '.stryd-cc button:focus-visible{outline:2px solid #006FBF;outline-offset:2px}';

  var banner = null;
  function closeBanner() { if (banner && banner.parentNode) banner.parentNode.removeChild(banner); banner = null; }

  function choose(choice) {
    var was = readConsent();
    writeConsent(choice);
    closeBanner();
    if (choice === 'accepted') {
      captureAttribution();
      loadPostHog();
    } else {
      clearAttribution();
      queue.length = 0;
      if (ph && ph.opt_out_capturing) ph.opt_out_capturing();
      if (was && was.choice === 'accepted' && ph && ph.reset) ph.reset();
    }
    listeners.forEach(function (cb) { try { cb(choice); } catch (e) { /* ignore */ } });
  }

  function openBanner() {
    if (banner) return;
    if (!document.getElementById('stryd-cc-css')) {
      var st = document.createElement('style');
      st.id = 'stryd-cc-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    banner = document.createElement('div');
    banner.className = 'stryd-cc';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-modal', 'false');
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.innerHTML =
      '<p>We use cookies and similar tech for analytics, but only if you say yes. ' +
      'See our <a href="/privacy">Privacy Policy</a>.</p>' +
      '<div class="cc-btns"><button type="button" class="cc-decline">Decline</button>' +
      '<button type="button" class="cc-accept">Accept</button></div>';
    banner.querySelector('.cc-accept').addEventListener('click', function () { choose('accepted'); });
    banner.querySelector('.cc-decline').addEventListener('click', function () { choose('declined'); });
    // Netlify injects a collaborative-review toolbar along the bottom of deploy-preview URLs. Lift the banner above it
    // there so Accept / Decline stay clickable. Does nothing on the real site.
    if (/\.netlify\.app$/.test(location.hostname)) banner.style.bottom = '84px';
    document.body.appendChild(banner);
  }

  function init() {
    document.querySelectorAll('[data-cookie-settings]').forEach(function (el) {
      el.addEventListener('click', function (e) { e.preventDefault(); openBanner(); });
    });
    if (!readConsent()) openBanner();
    else if (accepted()) { captureAttribution(); loadPostHog(); }
  }

  window.STRYD_CONSENT = {
    policyVersion: POLICY_VERSION,
    get: readConsent,
    accepted: accepted,
    getAttribution: getAttribution,
    openSettings: openBanner,
    onChange: function (cb) { listeners.push(cb); },
    distinctId: function () { try { return ph && ph.get_distinct_id ? ph.get_distinct_id() : null; } catch (e) { return null; } },
  };
  window.strydTrack = track;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
