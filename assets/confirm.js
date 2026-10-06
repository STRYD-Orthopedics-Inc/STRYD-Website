/* STRYD — /waitlist/confirm
   The emailed link carries a one-time token. We (1) read it, (2) immediately strip it from the address bar so it
   can't leak via history, screenshots or analytics, and (3) POST it. Confirming is a POST fired from here, never a
   GET, because email security scanners prefetch links and would otherwise confirm people automatically. */
(function () {
  'use strict';

  var token = '';
  try { token = (new URLSearchParams(location.search).get('token') || '').trim(); } catch (e) { /* ignore */ }
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }

  var panel = document.getElementById('confirm-panel');
  function show(state) {
    panel.querySelectorAll('[data-state]').forEach(function (s) { s.hidden = s.getAttribute('data-state') !== state; });
    var h = panel.querySelector('[data-state="' + state + '"] h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  function confirm() {
    show('loading');
    fetch('/api/waitlist/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ token: token }),
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, d: d }; }); })
      .then(function (r) {
        if (r.status === 200 && r.d && r.d.ok) { token = ''; show('success'); return; }
        if (r.status === 200 && r.d && r.d.reason === 'invalid_or_expired') { show('expired'); return; }
        show('error');
      })
      .catch(function () { show('error'); });
  }

  var retry = document.getElementById('confirm-retry');
  if (retry) retry.addEventListener('click', confirm);

  if (!token) { show('expired'); return; }
  confirm();
})();
