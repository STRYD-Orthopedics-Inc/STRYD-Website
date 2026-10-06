/* ============================================================
   STRYD — declarative analytics hooks. All events go through window.strydTrack, which is a no-op until the
   visitor has accepted cookies and PostHog has loaded (see consent.js).
     data-cta="<label>" [data-cta-location="hero"]   -> cta_click {location,label,destination}
     <video data-track-video="<id>">                  -> video_played, video_progress {percent 25/50/75/100}
     <details data-faq-id="<id>">                     -> faq_opened {question_id}
   ============================================================ */
(function () {
  'use strict';
  function track(name, props) { if (window.strydTrack) window.strydTrack(name, props); }

  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-cta]');
    if (!el) return;
    track('cta_click', {
      location: el.getAttribute('data-cta-location') || 'unknown',
      label: el.getAttribute('data-cta') || (el.textContent || '').trim().slice(0, 60),
      destination: el.getAttribute('href') || '',
    });
  });

  document.querySelectorAll('video[data-track-video]').forEach(function (v) {
    var id = v.getAttribute('data-track-video');
    var played = false;
    var seen = {};
    v.addEventListener('play', function () {
      if (played) return;
      played = true;
      track('video_played', { video_id: id });
    });
    v.addEventListener('timeupdate', function () {
      if (!v.duration) return;
      var pct = (v.currentTime / v.duration) * 100;
      [25, 50, 75, 100].forEach(function (m) {
        if (pct >= m - 0.5 && !seen[m]) { seen[m] = true; track('video_progress', { video_id: id, percent: m }); }
      });
    });
    v.addEventListener('ended', function () {
      if (!seen[100]) { seen[100] = true; track('video_progress', { video_id: id, percent: 100 }); }
    });
  });

  document.querySelectorAll('details[data-faq-id]').forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (d.open) track('faq_opened', { question_id: d.getAttribute('data-faq-id') });
    });
  });
})();
