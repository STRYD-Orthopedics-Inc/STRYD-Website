/* ============================================================
   STRYD ORTHOPEDICS — Shared interactions
   ============================================================ */
window.STRYD = window.STRYD || { waveSpeed: 0.9 };

/* ---------- EMG WAVEFORM ---------- */
function createEMGWaveform(canvasId, options = {}) {
  const {
    lineColor        = '#0A7AFF',
    backgroundColor  = null,
    amplitude        = 0.76,
    period           = 52,
    pauseOnHover     = true,
    secondaryChannel = false,
    secondaryColor   = '#5C677D',
    glow             = true,
    onDot            = null,
    dotSweepFrames   = 300,   // frames for one full left→right sweep
    localWaveSpeed   = null,  // per-instance speed (overrides global if set)
  } = options;

  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let offset      = 0;
  let paused      = false;
  let ampPhase    = 0;
  let dynAmp      = 1;
  let dotPhase    = 0;      // 0→1 sweep progress
  let smoothDotY  = null;   // EMA-smoothed y position
  const EMA       = 0.07;   // smoothing factor (lower = smoother)
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  if (pauseOnHover) {
    canvas.addEventListener('mouseenter', () => paused = true);
    canvas.addEventListener('mouseleave', () => paused = false);
  }

  function resize() {
    const w = Math.max(Math.floor(canvas.parentElement.getBoundingClientRect().width), 100);
    const h = canvas.clientHeight || 64;
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    smoothDotY = null; // reset on resize so it re-initialises
  }

  // Compute waveform y at any canvas x position using the repeating pattern
  function getYAtX(xPos) {
    const h   = canvas.height / dpr;
    const mid = h / 2;
    const amp = mid * amplitude * dynAmp;
    const relX = ((xPos + offset) % period + period) % period;
    const pts = [
      [0,       0     ],
      [5,       0     ],
      [6,      -1.10  ],
      [8,       0.80  ],
      [10,     -0.30  ],
      [12,      0     ],
      [18,      0     ],
      [19,     -0.55  ],
      [21,      0.45  ],
      [23,      0     ],
      [32,      0     ],
      [33,     -1.20  ],
      [35,      0.90  ],
      [37,      0     ],
      [period,  0     ],
    ];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, dy0] = pts[i];
      const [x1, dy1] = pts[i + 1];
      if (relX >= x0 && relX <= x1) {
        const t = x1 === x0 ? 0 : (relX - x0) / (x1 - x0);
        return mid + (dy0 + (dy1 - dy0) * t) * amp;
      }
    }
    return mid;
  }

  function drawChannel(color, phaseOffset, ampScale, lineWidth, alpha) {
    const w   = canvas.width / dpr;
    const h   = canvas.height / dpr;
    const mid = h / 2;
    const amp = mid * amplitude * ampScale * dynAmp;

    ctx.strokeStyle = color;
    ctx.lineWidth   = lineWidth;
    ctx.lineJoin    = 'round';
    ctx.globalAlpha = alpha;
    if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 10; }
    ctx.beginPath();

    const count = Math.ceil(w / period) + 2;
    let first = true;
    for (let i = -1; i < count; i++) {
      const x = i * period - ((offset + phaseOffset) % period);
      const ps = [
        [x,          mid],
        [x + 5,      mid],
        [x + 6,      mid - amp * 1.10],
        [x + 8,      mid + amp * 0.80],
        [x + 10,     mid - amp * 0.30],
        [x + 12,     mid],
        [x + 18,     mid],
        [x + 19,     mid - amp * 0.55],
        [x + 21,     mid + amp * 0.45],
        [x + 23,     mid],
        [x + 32,     mid],
        [x + 33,     mid - amp * 1.20],
        [x + 35,     mid + amp * 0.90],
        [x + 37,     mid],
        [x + period, mid],
      ];
      ps.forEach(([px, py]) => {
        if (first) { ctx.moveTo(px, py); first = false; }
        else ctx.lineTo(px, py);
      });
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;
  }

  function draw() {
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.clearRect(0, 0, w, h);
    if (backgroundColor) { ctx.fillStyle = backgroundColor; ctx.fillRect(0, 0, w, h); }

    // Slowly vary amplitude high-to-low
    if (!paused) ampPhase += 0.016;
    dynAmp = 0.30 + 0.70 * (0.5 + 0.5 * Math.sin(ampPhase));

    if (secondaryChannel) drawChannel(secondaryColor, 18, 0.72, 1.0, 0.35);
    drawChannel(lineColor, 0, 1.0, 1.6, 1.0);

    // Advance dot sweep left → right
    if (!paused) {
      dotPhase += 1 / dotSweepFrames;
      if (dotPhase >= 1) dotPhase = 0;
    }

    const margin = 14;
    const dotX   = margin + dotPhase * (w - 2 * margin);

    // EMA-smooth the y so spikes don't cause jitter
    const rawY = getYAtX(dotX);
    if (smoothDotY === null) smoothDotY = rawY;
    smoothDotY += EMA * (rawY - smoothDotY);
    const dotY = smoothDotY;

    const mid = h / 2;
    const amp = mid * amplitude * dynAmp;

    ctx.save();
    // Tiny outer glow ring — 2 px radius
    ctx.beginPath();
    ctx.arc(dotX, dotY, 2, 0, Math.PI * 2);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth   = 0.6;
    ctx.globalAlpha = 0.22;
    ctx.shadowColor = lineColor;
    ctx.shadowBlur  = 4;
    ctx.stroke();
    // Solid dot — 1 px radius
    ctx.beginPath();
    ctx.arc(dotX, dotY, 1, 0, Math.PI * 2);
    ctx.fillStyle   = lineColor;
    ctx.globalAlpha = 1;
    ctx.shadowColor = lineColor;
    ctx.shadowBlur  = 4;
    ctx.fill();
    ctx.restore();

    // Normalize excitation: 0 at baseline, 1 at peak
    const rawT = Math.abs(dotY - mid) / (amp * 1.20 + 0.001);
    const t    = Math.max(0, Math.min(1, rawT));
    if (onDot) onDot(t, dotPhase);

    const speed = localWaveSpeed !== null ? localWaveSpeed : (window.STRYD.waveSpeed ?? 0.9);
    if (!paused) offset += speed;
    requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener('resize', resize);
  draw();
}
window.createEMGWaveform = createEMGWaveform;

/* ---------- NAV / MOBILE DRAWER ---------- */
function initNav() {
  const burger = document.querySelector('.nav-burger');
  const drawer = document.querySelector('.mobile-drawer');
  if (burger && drawer) {
    burger.addEventListener('click', () => drawer.classList.add('open'));
    drawer.querySelector('.close')?.addEventListener('click', () => drawer.classList.remove('open'));
    drawer.querySelectorAll('a').forEach(a => a.addEventListener('click', () => drawer.classList.remove('open')));
  }
}

/* ---------- PARTNER STRIP ---------- */
function initPartnerStrip() {
  const track = document.querySelector('.partner-track');
  if (!track) return;
  // duplicate for seamless infinite loop — cloneNode avoids innerHTML re-parsing
  Array.from(track.children).forEach(child => track.appendChild(child.cloneNode(true)));
  let x = 0, paused = false;
  const strip = track.parentElement;
  strip.addEventListener('mouseenter', () => paused = true);
  strip.addEventListener('mouseleave', () => paused = false);
  function step() {
    if (!paused) {
      x -= 0.6;
      const half = track.scrollWidth / 2;
      if (-x >= half) x += half;
      track.style.transform = `translateX(${x}px)`;
    }
    requestAnimationFrame(step);
  }
  step();
}

/* ---------- AUDIENCE TABS ---------- */
function initTabs() {
  document.querySelectorAll('.audience-tabs').forEach(tabs => {
    const buttons = tabs.querySelectorAll('.audience-tab');
    const panels  = tabs.parentElement.querySelectorAll('.tab-panel');
    buttons.forEach((btn, i) => btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      panels[i]?.classList.add('active');
    }));
  });
}

/* ---------- SCROLL REVEAL + PROGRESS ---------- */
function initReveal() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        e.target.querySelectorAll('.progress-fill[data-w]').forEach(f => f.style.width = f.dataset.w);
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.18 });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
}

/* ---------- EXPLODED VIEW ---------- */
function initExploded() {
  const view = document.querySelector('.exploded-view');
  if (!view) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) view.classList.add('is-exploded'); });
  }, { threshold: 0.4 });
  io.observe(view);
  view.querySelectorAll('.layer').forEach(layer => {
    layer.addEventListener('click', () => {
      const wasIsolated = layer.classList.contains('isolated');
      view.querySelectorAll('.layer').forEach(l => l.classList.remove('isolated'));
      view.classList.remove('isolating');
      if (!wasIsolated) {
        layer.classList.add('isolated');
        view.classList.add('isolating');
      }
    });
  });
}

/* ---------- TWEAKS PANEL ---------- */
function initTweaks(defaults) {
  const root = document.documentElement;
  const body = document.body;
  let state = { ...defaults };
  try {
    const saved = JSON.parse(localStorage.getItem('stryd-tweaks') || '{}');
    state = { ...state, ...saved };
  } catch (e) {}

  function shade(hex, amt) {
    let r = parseInt(hex.slice(1,3), 16);
    let g = parseInt(hex.slice(3,5), 16);
    let b = parseInt(hex.slice(5,7), 16);
    const f   = amt > 0 ? (1 - amt) : 1;
    const add = amt < 0 ? -amt * 40 : 0;
    r = Math.max(0, Math.min(255, Math.round(r * f + add)));
    g = Math.max(0, Math.min(255, Math.round(g * f + add)));
    b = Math.max(0, Math.min(255, Math.round(b * f + add)));
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function apply() {
    root.style.setProperty('--glass-blur',    state.glassBlur + 'px');
    root.style.setProperty('--glass-alpha',   state.glassAlpha);
    root.style.setProperty('--glass-alpha-2', (state.glassAlpha * 1.7).toFixed(3));
    root.style.setProperty('--depth',         state.depth);
    body.classList.toggle('glow-on', !!state.glow);
    window.STRYD.waveSpeed = state.waveSpeed;
    const d = state.depth;
    body.style.setProperty('--bg-primary',   shade('#0A0A0A', (d - 1) * 0.5));
    body.style.setProperty('--bg-secondary', shade('#111111', (d - 1) * 0.5));
  }

  function persist() {
    localStorage.setItem('stryd-tweaks', JSON.stringify(state));
    try { window.parent.postMessage({ type: '__edit_mode_set_keys', edits: state }, window.location.origin); } catch (e) {}
  }

  apply();

  // Build tweaks panel
  const panel = document.createElement('div');
  panel.className = 'tweaks-panel';
  panel.innerHTML = `
    <div class="tweaks-head">
      <h4>Tweaks</h4>
      <button class="x" aria-label="Close">&times;</button>
    </div>
    <div class="tweak-row">
      <label>Glass blur <span class="val" id="tv-blur"></span></label>
      <input type="range" id="t-blur" min="4" max="48" step="1">
    </div>
    <div class="tweak-row">
      <label>Glass opacity <span class="val" id="tv-alpha"></span></label>
      <input type="range" id="t-alpha" min="0.02" max="0.16" step="0.005">
    </div>
    <div class="tweak-row">
      <label>Background depth <span class="val" id="tv-depth"></span></label>
      <input type="range" id="t-depth" min="0.4" max="1.6" step="0.05">
    </div>
    <div class="tweak-row">
      <label>Waveform speed <span class="val" id="tv-wave"></span></label>
      <input type="range" id="t-wave" min="0.2" max="2.2" step="0.05">
    </div>
    <div class="tweak-row">
      <label>Accent glow</label>
      <div class="tweak-toggle">
        <button data-glow="1">On</button>
        <button data-glow="0">Off</button>
      </div>
    </div>
    <div class="tweak-divider"></div>
    <div class="tweak-row">
      <label>Presets</label>
      <div class="preset-row">
        <button data-preset="clinical">Clinical</button>
        <button data-preset="frosted">Frosted</button>
        <button data-preset="aurora">Aurora</button>
      </div>
    </div>`;
  body.appendChild(panel);

  const $ = s => panel.querySelector(s);
  function sync() {
    $('#t-blur').value   = state.glassBlur;  $('#tv-blur').textContent  = state.glassBlur + 'px';
    $('#t-alpha').value  = state.glassAlpha; $('#tv-alpha').textContent = Math.round(state.glassAlpha * 100) + '%';
    $('#t-depth').value  = state.depth;      $('#tv-depth').textContent = state.depth.toFixed(2);
    $('#t-wave').value   = state.waveSpeed;  $('#tv-wave').textContent  = state.waveSpeed.toFixed(2) + '×';
    panel.querySelectorAll('[data-glow]').forEach(b =>
      b.classList.toggle('on', String(state.glow ? 1 : 0) === b.dataset.glow));
  }
  sync();

  $('#t-blur').addEventListener('input',  e => { state.glassBlur  = +e.target.value; apply(); sync(); persist(); });
  $('#t-alpha').addEventListener('input', e => { state.glassAlpha = +e.target.value; apply(); sync(); persist(); });
  $('#t-depth').addEventListener('input', e => { state.depth      = +e.target.value; apply(); sync(); persist(); });
  $('#t-wave').addEventListener('input',  e => { state.waveSpeed  = +e.target.value; apply(); sync(); persist(); });
  panel.querySelectorAll('[data-glow]').forEach(b =>
    b.addEventListener('click', () => { state.glow = b.dataset.glow === '1'; apply(); sync(); persist(); }));

  const presets = {
    clinical: { glassBlur: 8,  glassAlpha: 0.04, depth: 1.1, waveSpeed: 0.7, glow: false },
    frosted:  { glassBlur: 24, glassAlpha: 0.07, depth: 1.0, waveSpeed: 0.9, glow: true  },
    aurora:   { glassBlur: 40, glassAlpha: 0.11, depth: 0.7, waveSpeed: 1.4, glow: true  },
  };
  panel.querySelectorAll('[data-preset]').forEach(b =>
    b.addEventListener('click', () => {
      state = { ...state, ...presets[b.dataset.preset] };
      apply(); sync(); persist();
    }));

  $('.x').addEventListener('click', () => {
    panel.classList.remove('open');
    try { window.parent.postMessage({ type: '__edit_mode_dismissed' }, window.location.origin); } catch (e) {}
  });

  const _allowedOrigin = window.location.origin;
  window.addEventListener('message', (e) => {
    if (e.origin !== _allowedOrigin) return; // reject cross-origin messages
    const t = e.data && e.data.type;
    if (t === '__activate_edit_mode')   panel.classList.add('open');
    if (t === '__deactivate_edit_mode') panel.classList.remove('open');
  });
  try { window.parent.postMessage({ type: '__edit_mode_available' }, _allowedOrigin); } catch (e) {}
}
window.initTweaks = initTweaks;

/* ---------- BOOT ---------- */
window.STRYDinit = function () {
  initNav();
  initPartnerStrip();
  initTabs();
  initReveal();
  initExploded();
};
