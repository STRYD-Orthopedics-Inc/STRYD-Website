/* ============================================================
   STRYD hero viewer
   The hero shows the looping product video. Touch it and you can turn the sleeve (drag), zoom (pinch, double-click or
   Ctrl + scroll) and pan around when zoomed. A moment after you stop, it crossfades back to the looping video.

   - Frames: 121 images covering a half-turn (assets/spin/sd, 960px) mirrored into a full 360 degrees. The 1800px set
     (assets/spin/hd) is fetched per frame only while zoomed in.
   - Frames start loading when the page is idle (skipped on Save-Data / slow connections) or on first hover / touch.
   - Keyboard: Left / Right turn, + / - zoom, 0 reset, Escape returns to the video. Respects prefers-reduced-motion.
   - Page scrolling keeps working: touch-action is pan-y, plain mouse-wheel is untouched.
   Adapted from the older STRYD site's viewer (canvas + mirrored half-turn frame set).
   ============================================================ */
(function () {
  'use strict';

  var root = document.querySelector('[data-hero-viewer]');
  if (!root || !window.HTMLCanvasElement || !window.requestAnimationFrame) return;

  var video = root.querySelector('video');
  var N = parseInt(root.getAttribute('data-frames'), 10) || 121;
  var BASE = root.getAttribute('data-src') || '/assets/spin/';
  var IDLE_MS = parseInt(root.getAttribute('data-idle'), 10) || 900;   // how long after the last touch before returning to the loop
  var KEY_IDLE_MS = 2200;                                              // keyboard users get a little longer
  var FADE_MS = 360;
  var MINZ = 1, MAXZ = 4;
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var canvas = document.createElement('canvas');
  canvas.className = 'hv-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  root.appendChild(canvas);
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  /* ---------- start the loop after the page has loaded ----------
     The video is large, so it is not preloaded: the tiny poster paints first (that is what the page's first paint waits for),
     and the loop starts right after load. Skipped on Save-Data connections (the poster stays, and the viewer still works). */
  function startLoop() {
    if (!video || active) return;
    var c = navigator.connection || {};
    if (c.saveData) return;
    var p = video.play();
    if (p && p.catch) p.catch(function () { /* autoplay blocked: the poster stays */ });
  }
  if (document.readyState === 'complete') setTimeout(startLoop, 150);
  else window.addEventListener('load', function () { setTimeout(startLoop, 150); }, { once: true });

  /* ---------- frames ---------- */
  var sd = new Array(N), hd = new Array(N), edges = new Array(N), loaded = 0;
  var probe = document.createElement('canvas');
  probe.width = 2; probe.height = 3;
  var pctx = probe.getContext('2d', { willReadFrequently: true });

  function pad(i) { return ('00' + i).slice(-3); }

  // Average colour down the left and right edges (top / middle / bottom) so the letterbox bands match the studio backdrop.
  function sampleEdges(img) {
    try {
      var w = img.naturalWidth, h = img.naturalHeight, s = Math.max(2, Math.round(w * 0.02));
      pctx.clearRect(0, 0, 2, 3);
      pctx.drawImage(img, 0, 0, s, h, 0, 0, 1, 3);
      pctx.drawImage(img, w - s, 0, s, h, 1, 0, 1, 3);
      var d = pctx.getImageData(0, 0, 2, 3).data, out = [];
      for (var r = 0; r < 3; r++) {
        var a = r * 8, b = a + 4;
        out.push('rgb(' + Math.round((d[a] + d[b]) / 2) + ',' + Math.round((d[a + 1] + d[b + 1]) / 2) + ',' + Math.round((d[a + 2] + d[b + 2]) / 2) + ')');
      }
      return out;
    } catch (e) { return null; }
  }

  function load(set, i, cb) {
    var img = new Image();
    img.decoding = 'async';
    img.onload = function () {
      var done = function () { cb(img); };
      (img.decode ? img.decode() : Promise.resolve()).then(done, done);
    };
    img.onerror = function () { cb(null); };
    img.src = BASE + set + '/' + pad(i) + '.webp';
  }

  // Coarse ring first, so turning works almost immediately and fills in as more frames arrive.
  var order = [], seen = {};
  [16, 8, 4, 2, 1].forEach(function (step) { for (var i = 0; i < N; i += step) if (!seen[i]) { seen[i] = 1; order.push(i); } });
  var inflight = 0, cursor = 0, started = false;
  function pump() {
    while (inflight < 6 && cursor < order.length) {
      (function (i) {
        inflight++;
        load('sd', i, function (img) {
          inflight--;
          if (img) { sd[i] = img; edges[i] = sampleEdges(img); loaded++; dirty = true; if (active) kick(); }
          pump();
        });
      })(order[cursor++]);
    }
  }
  function startLoading() { if (started) return; started = true; pump(); }

  function nearestIdx(arr, i) {
    if (arr[i]) return i;
    for (var d = 1; d < N; d++) { if (arr[i - d]) return i - d; if (arr[i + d]) return i + d; }
    return -1;
  }

  /* ---------- state ---------- */
  var angle = 0, vel = 0, zoom = 1, zoomTarget = 1, panX = 0, panY = 0;
  var active = false, live = false, dirty = true, raf = 0, lastT = 0, idleT = 0, fadeUntil = 0;
  var dragging = false, pointers = {}, lastX = 0, lastMoveT = 0, pinch0 = 0, zoom0 = 1, usedOnce = false;

  function frameFor(a) {
    a = ((a % 360) + 360) % 360;
    if (a <= 180) return { i: Math.round(a / 180 * (N - 1)), flip: false };
    return { i: Math.round((360 - a) / 180 * (N - 1)), flip: true };
  }

  function box() { return root.getBoundingClientRect(); }

  function size() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2), r = box();
    var w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; dirty = true; }
  }

  function clampPan() {
    var r = box(), s = Math.min(r.width, r.height) * zoom;
    var mx = Math.max(0, (s - r.width) / 2 + r.width * 0.15), my = Math.max(0, (s - r.height) / 2 + r.height * 0.15);
    if (zoom <= 1.001) { panX = 0; panY = 0; return; }
    panX = Math.max(-mx, Math.min(mx, panX));
    panY = Math.max(-my, Math.min(my, panY));
  }

  function draw() {
    var f = frameFor(angle), useHD = zoom > 1.3;
    if (useHD && !hd[f.i] && !hd[f.i + '_p']) {
      hd[f.i + '_p'] = 1;
      load('hd', f.i, function (img) { if (img) { hd[f.i] = img; dirty = true; if (active) kick(); } });
    }
    var idx = nearestIdx(sd, f.i);
    var img = (useHD && hd[f.i]) || (idx >= 0 ? sd[idx] : null);
    if (!img) return false;
    var e = edges[idx >= 0 ? idx : f.i] || ['#8a8680', '#908c86', '#938f89'];
    var W = canvas.width, H = canvas.height, dpr = W / box().width;
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, e[0]); g.addColorStop(0.5, e[1]); g.addColorStop(1, e[2]);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    var s = Math.min(W, H) * zoom;               // the sleeve is always shown whole when not zoomed (no cropping)
    ctx.save();
    ctx.translate(W / 2 + panX * dpr, H / 2 + panY * dpr);
    if (f.flip) ctx.scale(-1, 1);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, -s / 2, -s / 2, s, s);
    // feather the square's left / right edges into the backdrop so there is no visible seam
    var fw = s * 0.08;
    ctx.globalCompositeOperation = 'destination-out';
    [[-s / 2, -s / 2 + fw], [s / 2, s / 2 - fw]].forEach(function (p) {
      var m = ctx.createLinearGradient(p[0], 0, p[1], 0);
      m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = m;
      ctx.fillRect(Math.min(p[0], p[1]), -s / 2, fw, s);
    });
    ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    return true;
  }

  function tick(t) {
    raf = 0;
    var dt = lastT ? Math.min(64, t - lastT) : 16; lastT = t;
    var moving = false;
    if (!dragging && Math.abs(vel) > 0.01) {
      angle += vel * dt; vel *= Math.pow(0.94, dt / 16); moving = true; dirty = true;
    }
    if (Math.abs(zoomTarget - zoom) > 0.002) { zoom += (zoomTarget - zoom) * Math.min(1, dt / 90); clampPan(); moving = true; dirty = true; }
    else if (zoom !== zoomTarget) { zoom = zoomTarget; clampPan(); dirty = true; }
    if (dirty) {
      size();
      if (draw()) {
        if (active && !live) { live = true; root.classList.add('is-live'); if (video) video.pause(); }
      }
      dirty = false;
    }
    if (moving || (!active && performance.now() < fadeUntil)) kick(); else lastT = 0;
  }
  function kick() { if (!raf) raf = requestAnimationFrame(tick); }

  /* ---------- active <-> loop ---------- */
  function track(method) {
    if (usedOnce) return;
    usedOnce = true;
    root.classList.add('has-used');
    if (window.strydTrack) window.strydTrack('hero_viewer_used', { method: method });
  }

  function activate(method) {
    startLoading();
    track(method);
    if (active) return;
    active = true;
    root.classList.add('is-active');
    dirty = true; kick();                         // the canvas fades in once the first frame is ready; the video keeps playing until then
  }

  function returnToLoop() {
    clearTimeout(idleT);
    if (!active) return;
    active = false; live = false; vel = 0; zoomTarget = 1; panX = 0; panY = 0;
    root.classList.remove('is-active', 'is-live', 'is-dragging');
    if (video) { var p = video.play(); if (p && p.catch) p.catch(function () {}); }
    fadeUntil = performance.now() + FADE_MS + 80;
    kick();
  }

  function bump(ms) { clearTimeout(idleT); idleT = setTimeout(check, ms || IDLE_MS); }
  function check() {
    if (dragging || Object.keys(pointers).length) return bump();
    if (Math.abs(vel) > 0.02 || Math.abs(zoomTarget - zoom) > 0.01) return bump(250);   // let a fling / zoom settle first
    returnToLoop();
  }

  /* ---------- zoom ---------- */
  function setZoom(z, cx, cy) {
    var r = box();
    z = Math.max(MINZ, Math.min(MAXZ, z));
    if (cx != null) {
      var px = cx - r.left - r.width / 2, py = cy - r.top - r.height / 2, k = z / zoomTarget;
      panX = px - (px - panX) * k; panY = py - (py - panY) * k;       // keep the point under the cursor fixed
    }
    zoomTarget = z;
    if (z <= 1.001) { panX = 0; panY = 0; }
    var keep = zoom; zoom = zoomTarget; clampPan(); zoom = keep;
    dirty = true; kick();
  }

  /* ---------- pointers: drag to turn; drag to pan when zoomed; pinch to zoom ---------- */
  root.addEventListener('pointerenter', startLoading, { once: true });
  root.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    activate('pointer');
    try { root.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    dragging = true; vel = 0; lastX = e.clientX; lastMoveT = performance.now();
    var ids = Object.keys(pointers);
    if (ids.length === 2) { var a = pointers[ids[0]], b = pointers[ids[1]]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); zoom0 = zoomTarget; }
    root.classList.add('is-dragging');
    clearTimeout(idleT);
  });
  root.addEventListener('pointermove', function (e) {
    var p = pointers[e.pointerId];
    if (!p) return;
    var prevX = p.x, prevY = p.y;
    p.x = e.clientX; p.y = e.clientY;
    var ids = Object.keys(pointers);
    if (ids.length === 2) {
      var a = pointers[ids[0]], b = pointers[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0) setZoom(zoom0 * d / pinch0, (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    var dx = e.clientX - prevX, dy = e.clientY - prevY, now = performance.now(), dt = Math.max(1, now - lastMoveT);
    lastMoveT = now;
    if (zoomTarget > 1.01) {
      panX += dx; panY += dy; var keep = zoom; zoom = zoomTarget; clampPan(); zoom = keep;
    } else {
      var d2 = -dx / box().width * 360 * 0.9;      // a full-width drag turns ~90% of a full rotation
      angle += d2; vel = reduced ? 0 : d2 / dt;
    }
    dirty = true; kick();
  });
  function end(e) {
    delete pointers[e.pointerId];
    var n = Object.keys(pointers).length;
    if (n < 2) pinch0 = 0;
    if (n === 0) {
      dragging = false; root.classList.remove('is-dragging');
      if (performance.now() - lastMoveT > 80) vel = 0;       // held still before letting go: no fling
      vel = Math.max(-1.2, Math.min(1.2, vel));
      kick(); bump(IDLE_MS);
    }
  }
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('lostpointercapture', function (e) { if (pointers[e.pointerId]) end(e); });
  root.addEventListener('dblclick', function (e) { activate('pointer'); setZoom(zoomTarget > 1.01 ? 1 : 2.4, e.clientX, e.clientY); bump(IDLE_MS + 600); });
  root.addEventListener('wheel', function (e) {              // Ctrl / Cmd + scroll (and trackpad pinch) zooms; plain scroll scrolls the page
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault(); activate('wheel');
    setZoom(zoomTarget * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    bump(IDLE_MS + 400);
  }, { passive: false });
  root.addEventListener('contextmenu', function () { if (dragging) { pointers = {}; end({ pointerId: -1 }); } });

  /* ---------- keyboard ---------- */
  function turnBy(deg) {
    var start = angle, target = angle + deg, t0 = performance.now(), dur = reduced ? 1 : 320;
    (function step(t) {
      var k = Math.min(1, (t - t0) / dur), ease = 1 - Math.pow(1 - k, 3);
      angle = start + (target - start) * ease; dirty = true; kick();
      if (k < 1 && active) requestAnimationFrame(step);
    })(t0);
  }
  root.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'ArrowLeft') { activate('keyboard'); vel = 0; turnBy(-15); }
    else if (k === 'ArrowRight') { activate('keyboard'); vel = 0; turnBy(15); }
    else if (k === '+' || k === '=') { activate('keyboard'); setZoom(zoomTarget * 1.3); }
    else if (k === '-' || k === '_') { activate('keyboard'); setZoom(zoomTarget / 1.3); }
    else if (k === '0') { activate('keyboard'); setZoom(1); }
    else if (k === 'Escape') { returnToLoop(); return; }
    else return;
    e.preventDefault();
    bump(KEY_IDLE_MS);
  });
  root.addEventListener('blur', function () { if (active && !dragging) bump(600); });

  window.addEventListener('resize', function () { dirty = true; if (active) kick(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && active && !dragging) returnToLoop(); });

  /* ---------- start loading when idle (not on Save-Data or very slow connections), or on first hover / touch ---------- */
  var conn = navigator.connection || {};
  var lean = conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '');
  if (!lean) {
    var go = function () { setTimeout(startLoading, 2500); };
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
  }
  root.classList.add('hv-ready');
})();
