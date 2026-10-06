/* STRYD — theme toggle (waitlist-flow pages). The initial data-theme is set by the tiny inline script in <head>
   so there is no flash. The choice is a user preference (not tracking), so it needs no cookie consent. */
(function () {
  'use strict';
  var root = document.documentElement;

  function current() { return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }

  function paint(btn) {
    var light = current() === 'light';
    // Button describes the action it will take.
    btn.setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode');
    btn.setAttribute('title', light ? 'Switch to dark mode' : 'Switch to light mode');
    btn.setAttribute('data-mode', current());
  }

  function set(theme) {
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem('stryd_theme', theme); } catch (e) { /* ignore */ }
    document.dispatchEvent(new CustomEvent('stryd:theme', { detail: theme }));
  }

  document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
    paint(btn);
    btn.addEventListener('click', function () {
      set(current() === 'light' ? 'dark' : 'light');
      document.querySelectorAll('[data-theme-toggle]').forEach(paint);
    });
  });

  // Follow the system setting live, unless the visitor chose explicitly.
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: light)');
    var onChange = function (e) {
      var saved = null;
      try { saved = localStorage.getItem('stryd_theme'); } catch (err) { /* ignore */ }
      if (saved === 'light' || saved === 'dark') return;
      root.setAttribute('data-theme', e.matches ? 'light' : 'dark');
      document.querySelectorAll('[data-theme-toggle]').forEach(paint);
      document.dispatchEvent(new CustomEvent('stryd:theme', { detail: current() }));
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
  }
})();
