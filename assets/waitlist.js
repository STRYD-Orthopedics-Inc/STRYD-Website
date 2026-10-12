/* ============================================================
   STRYD — /waitlist form logic + public counter.
   Submits to POST /api/waitlist (Netlify function -> Supabase + Customer.io). Client validation is a convenience;
   the server re-validates everything.
   ============================================================ */
(function () {
  'use strict';

  var SEGMENTS = ['parent_travel_hs', 'runner_active_adult', 'pro_college_athlete', 'other'];
  var MESSAGES = {
    email: 'Enter a valid email address.',
    segment: 'Pick the option that fits you best.',
    where_heard: 'Choose where you heard about us.',
    where_heard_other: 'Tell us where you heard about us.',
    age_attested: 'Please confirm you are 18 or older.',
    consent: 'Please agree to continue.',
    sport: 'Keep this under 80 characters.',
  };
  var ERR_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 7v6M12 16.5v.5"/></svg>';

  function track(name, props) { if (window.strydTrack) window.strydTrack(name, props); }

  /* ---------- counter: renders nothing unless the server says show:true (>= threshold confirmed) ---------- */
  function initCounter() {
    var el = document.querySelector('[data-waitlist-counter]');
    if (!el) return;
    fetch('/api/waitlist/count', { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || d.show !== true || typeof d.count !== 'number') return;
        el.querySelector('[data-count]').textContent = d.count.toLocaleString('en-US');
        el.hidden = false;
      })
      .catch(function () { /* stay hidden */ });
  }

  /* ---------- form ---------- */
  var form = document.getElementById('waitlist-form');
  if (!form) { initCounter(); return; }

  var el = {
    email: form.elements.email,
    sport: form.elements.sport,
    heard: form.elements.where_heard,
    other: form.elements.where_heard_other,
    otherWrap: document.getElementById('wl-other-wrap'),
    age: form.elements.age_attested,
    consent: form.elements.consent,
    hp: form.elements.company_website,
    btn: form.querySelector('[type="submit"]'),
    formError: document.getElementById('wl-form-error'),
  };
  var started = false;

  function segmentValue() {
    var c = form.querySelector('input[name="segment"]:checked');
    return c ? c.value : '';
  }

  function controlFor(field) {
    if (field === 'segment') return document.getElementById('seg-group');
    if (field === 'age_attested') return el.age;
    if (field === 'consent') return el.consent;
    if (field === 'where_heard') return el.heard;
    if (field === 'where_heard_other') return el.other;
    return el[field];
  }

  function setError(field, code) {
    var box = document.getElementById('err-' + field);
    var ctl = controlFor(field);
    if (!box) return;
    box.innerHTML = ERR_ICON + '<span></span>';
    box.querySelector('span').textContent = MESSAGES[field] || 'Check this field.';
    box.hidden = false;
    if (ctl) {
      ctl.setAttribute('aria-invalid', 'true');
      var row = ctl.closest && ctl.closest('.check-row');
      if (row) row.classList.add('invalid');
    }
  }
  function clearErrors() {
    form.querySelectorAll('.field-error').forEach(function (b) { b.hidden = true; b.innerHTML = ''; });
    form.querySelectorAll('[aria-invalid="true"]').forEach(function (c) { c.removeAttribute('aria-invalid'); });
    form.querySelectorAll('.check-row.invalid').forEach(function (r) { r.classList.remove('invalid'); });
    el.formError.hidden = true;
    el.formError.innerHTML = '';
  }
  function showFormError(msg) {
    el.formError.innerHTML = ERR_ICON + '<span></span>';
    el.formError.querySelector('span').textContent = msg;
    el.formError.hidden = false;
  }

  function validate() {
    var errs = {};
    var email = (el.email.value || '').trim();
    if (!/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) errs.email = 'invalid';
    if (SEGMENTS.indexOf(segmentValue()) === -1) errs.segment = 'invalid';
    if (!el.heard.value) errs.where_heard = 'invalid';
    if (el.heard.value === 'other' && !(el.other.value || '').trim()) errs.where_heard_other = 'required';
    if ((el.sport.value || '').trim().length > 80) errs.sport = 'too_long';
    if (!el.age.checked) errs.age_attested = 'required';
    if (!el.consent.checked) errs.consent = 'required';
    return errs;
  }

  function showErrors(errs) {
    var order = ['email', 'segment', 'sport', 'where_heard', 'where_heard_other', 'age_attested', 'consent'];
    var first = null;
    order.forEach(function (f) {
      if (errs[f]) { setError(f, errs[f]); if (!first) first = f; }
    });
    if (first) {
      var ctl = controlFor(first);
      if (ctl) {
        if (ctl.id === 'seg-group') { var r = form.querySelector('input[name="segment"]'); if (r) r.focus(); }
        else ctl.focus();
      }
    }
  }

  function setBusy(b) {
    el.btn.disabled = b;
    if (b) el.btn.setAttribute('aria-busy', 'true'); else el.btn.removeAttribute('aria-busy');
  }

  function buildPayload() {
    var a = (window.STRYD_CONSENT && window.STRYD_CONSENT.getAttribution()) || {};
    var attribution = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'lk', 'landing_path', 'referrer_host'].forEach(function (k) {
      if (a[k]) attribution[k] = a[k];
    });
    var heard = el.heard.value;
    var body = {
      email: (el.email.value || '').trim(),
      segment: segmentValue(),
      where_heard: heard,
      age_attested: el.age.checked === true,
      consent: el.consent.checked === true,
      attribution: attribution,
      hp: el.hp ? el.hp.value : '',
    };
    var sport = (el.sport.value || '').trim();
    if (sport) body.sport = sport;
    if (heard === 'other') body.where_heard_other = (el.other.value || '').trim();
    var id = window.STRYD_CONSENT && window.STRYD_CONSENT.distinctId();
    if (id) body.posthog_distinct_id = id;
    return body;
  }

  // Interaction tracking (field names only, never values)
  form.addEventListener('focusin', function (e) {
    if (started || !e.target.name) return;
    started = true;
    track('waitlist_form_started', { first_field: e.target.name });
  });
  el.heard.addEventListener('change', function () {
    el.otherWrap.hidden = el.heard.value !== 'other';
    if (el.heard.value !== 'other') el.other.value = '';
  });

  // Prefill ?segment=... (homepage cards link here with it). Only known values; never attribution.
  try {
    var pre = new URLSearchParams(location.search).get('segment');
    if (pre && SEGMENTS.indexOf(pre) !== -1) {
      var r = form.querySelector('input[name="segment"][value="' + pre + '"]');
      if (r) r.checked = true;
    }
  } catch (e) { /* ignore */ }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (el.btn.getAttribute('aria-busy') === 'true') return;
    clearErrors();

    var errs = validate();
    if (Object.keys(errs).length) {
      showErrors(errs);
      track('waitlist_form_error', { error_type: 'validation', fields: Object.keys(errs) });
      return;
    }

    setBusy(true);
    var payload = buildPayload();
    fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, data: data }; });
      })
      .then(function (r) {
        if (r.status === 200 && r.data && r.data.ok) {
          track('waitlist_form_submitted', { segment: payload.segment, where_heard: payload.where_heard, has_sport: !!payload.sport });
          // Give the analytics event a moment to flush before navigating away.
          setTimeout(function () { location.assign('/waitlist/check-email'); }, 200);
          return;
        }
        setBusy(false);
        if (r.status === 400 && r.data && r.data.errors) {
          var fields = Object.keys(r.data.errors).filter(function (f) { return MESSAGES[f]; });
          if (fields.length) {
            var map = {};
            fields.forEach(function (f) { map[f] = r.data.errors[f]; });
            showErrors(map);
            track('waitlist_form_error', { error_type: 'validation', fields: fields });
            return;
          }
        }
        if (r.status === 429) {
          showFormError('Too many tries. Please wait a few minutes and try again.');
          track('waitlist_form_error', { error_type: 'rate_limited', fields: [] });
          return;
        }
        showFormError('Something went wrong on our end. Please try again.');
        track('waitlist_form_error', { error_type: 'server', fields: [] });
      })
      .catch(function () {
        setBusy(false);
        showFormError('We could not reach the server. Check your connection and try again.');
        track('waitlist_form_error', { error_type: 'server', fields: [] });
      });
  });

  initCounter();
})();
