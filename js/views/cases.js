/* CardioR2C — CARDIO.views.cases
 * Dossiers progressifs : liste (#/item/:num/cas) et lecteur (#/item/:num/cas/:caseId).
 * runInline(caseObj, {onComplete(score, details), record, item, onExit}) → HTMLElement est aussi
 * utilisé par le moteur de quiz (record:false → pas d'enregistrement, seulement onComplete).
 * Règles de score : SPEC §2.6 (QRM EDN 5 options, QRU 1/0, QROC auto-évaluée avec mots-clés,
 * OPEN grille pondérée). Score du dossier = moyenne des étapes.
 * Script classique ES2020 ; appels aux autres modules uniquement à l'exécution, dégradation propre.
 */
(function () {
  'use strict';

  window.CARDIO = window.CARDIO || {};
  CARDIO.views = CARDIO.views || {};

  /* ------------------------------------------------------------------ */
  /* Utilitaires défensifs                                                */
  /* ------------------------------------------------------------------ */

  function U() { return (window.CARDIO && CARDIO.util) || null; }

  function esc(s) {
    const u = U();
    if (u && typeof u.esc === 'function') return u.esc(String(s == null ? '' : s));
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function flatten(list, out) {
    for (const c of list) {
      if (c == null || c === false || c === true) continue;
      if (Array.isArray(c)) flatten(c, out);
      else out.push(c);
    }
    return out;
  }

  function fallbackH(tag, attrs, kids) {
    const el = document.createElement(tag);
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') { for (const d in v) el.dataset[d] = v[d]; }
      else if (k === 'on') { for (const e in v) el.addEventListener(e, v[e]); }
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }

  const PROP_KEYS = ['open', 'disabled', 'checked', 'value', 'selected'];
  function h(tag, attrs, ...children) {
    attrs = Object.assign({}, attrs || {});
    const props = {};
    for (const k of PROP_KEYS) if (k in attrs) { props[k] = attrs[k]; delete attrs[k]; }
    const kids = flatten(children, []);
    const u = U();
    let el;
    if (u && typeof u.h === 'function') el = u.h(tag, attrs, ...kids);
    else el = fallbackH(tag, attrs, kids);
    for (const k in props) el[k] = props[k];
    return el;
  }

  function mdHTML(text) {
    const u = U();
    if (u && typeof u.md === 'function') return u.md(String(text == null ? '' : text));
    return '<p>' + esc(text) + '</p>';
  }

  function mdInline(text) {
    const html = mdHTML(text).trim();
    const m = /^<p>([\s\S]*)<\/p>$/.exec(html);
    return m ? m[1] : html;
  }

  function mdEl(text, cls) {
    const d = h('div', { class: cls || 'md' });
    d.innerHTML = mdHTML(text); // md() échappe le texte source
    return d;
  }

  function inlineEl(tag, attrs, text) {
    const el = h(tag, attrs);
    el.innerHTML = mdInline(text);
    return el;
  }

  function icon(name) {
    const u = U();
    if (u && typeof u.icon === 'function') {
      const s = h('span', { class: 'ico', 'aria-hidden': 'true' });
      s.innerHTML = u.icon(name);
      return s;
    }
    return null;
  }

  function now() {
    const u = U();
    return (u && typeof u.now === 'function') ? u.now() : Date.now();
  }

  function normalize(s) {
    const u = U();
    if (u && typeof u.normalize === 'function') return u.normalize(String(s == null ? '' : s));
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function fmtDuration(ms) {
    const u = U();
    if (u && typeof u.fmtDuration === 'function') { try { return u.fmtDuration(ms); } catch (e) { /* fallback */ } }
    const s = Math.round(ms / 1000);
    if (s < 60) return s + ' s';
    const m = Math.floor(s / 60);
    return m + ' min ' + String(s % 60).padStart(2, '0') + ' s';
  }

  function toast(msg, tone) {
    const sh = window.CARDIO && CARDIO.shell;
    if (sh && typeof sh.toast === 'function') { try { sh.toast(msg, { tone: tone || 'info' }); } catch (e) { /* silencieux */ } }
  }

  function go(hash) {
    const r = window.CARDIO && CARDIO.router;
    if (r && typeof r.go === 'function') { try { r.go(hash); return; } catch (e) { /* fallback */ } }
    location.hash = hash;
  }

  function itemOfId(id) {
    const m = /^(\d{3})-/.exec(String(id || ''));
    return m ? m[1] : null;
  }

  function list(arr) { return Array.isArray(arr) ? arr.filter(x => x != null && String(x).trim() !== '') : []; }

  function pct(x) { return Math.round((Number(x) || 0) * 100); }

  function registry() { return (window.CARDIO && CARDIO.registry) || null; }

  async function ensureItem(num) {
    const r = registry();
    if (!r) { console.warn('[cases] CARDIO.registry indisponible'); return null; }
    try { if (typeof r.load === 'function') await r.load(num); }
    catch (e) { console.warn('[cases] chargement de l\'item ' + num + ' impossible', e); return null; }
    return typeof r.content === 'function' ? (r.content(num) || null) : null;
  }

  function itemMeta(num) {
    const r = registry();
    if (r && typeof r.item === 'function') { try { return r.item(num) || null; } catch (e) { return null; } }
    return null;
  }

  function recordAttempt(payload) {
    const s = window.CARDIO && CARDIO.store;
    if (s && typeof s.recordAttempt === 'function') {
      try { return s.recordAttempt(payload); } catch (e) { console.warn('[cases] recordAttempt a échoué', e); }
    } else {
      console.warn('[cases] CARDIO.store.recordAttempt indisponible : progression non enregistrée');
    }
    return null;
  }

  // Meilleur score enregistré pour une carte, lu sans créer d'entrée dans le store.
  function bestScore(cardId) {
    try {
      const s = window.CARDIO && CARDIO.store;
      const cs = s && s.state && s.state.cards && s.state.cards[cardId];
      if (!cs || !Array.isArray(cs.hist) || !cs.hist.length) return null;
      let best = null;
      cs.hist.forEach(r => { const sc = Array.isArray(r) ? r[2] : (r && r.score); if (typeof sc === 'number' && (best == null || sc > best)) best = sc; });
      return best;
    } catch (e) { return null; }
  }

  function haptic() {
    try {
      const s = window.CARDIO && CARDIO.store;
      const on = !(s && s.state && s.state.profile && s.state.profile.haptics === false);
      if (on && navigator.vibrate) navigator.vibrate(10);
    } catch (e) { /* ignore */ }
  }

  function reducedMotion() {
    try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  /* ------------------------------------------------------------------ */
  /* Styles (tokens uniquement)                                           */
  /* ------------------------------------------------------------------ */

  const CSS = `
  .page-head{margin:0 0 16px}
  .page-title{font-family:var(--font-display);font-size:1.75rem;line-height:1.15;margin:0;text-wrap:balance}
  .page-sub{color:var(--muted);margin:4px 0 0;font-size:.875rem}
  .src{color:var(--muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.06em}
  .empty{color:var(--muted);text-align:center;padding:24px 8px}
  .case-list{display:grid;gap:12px}
  .case-card__top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
  .case-card__title{font-family:var(--font-display);font-size:1.125rem;line-height:1.3;margin:0}
  .case-card__summary{color:var(--ink-2);margin:6px 0 0}
  .case-card__meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin-top:10px;font-size:.875rem;color:var(--muted)}
  .dots{display:inline-flex;gap:3px;align-items:center}
  .dots__dot{width:8px;height:8px;border-radius:50%;background:var(--surface-3)}
  .dots__dot.is-on{background:var(--accent)}
  .case-tl{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:10px 0 0;padding:0 0 2px;list-style:none;-webkit-overflow-scrolling:touch}
  .case-tl::-webkit-scrollbar{display:none}
  .case-tl li{flex:none;font-size:.75rem;color:var(--ink-2);background:var(--surface-2);border-radius:999px;padding:4px 10px;white-space:nowrap;display:flex;align-items:center;gap:6px}
  .case-tl li::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--accent);opacity:.6}
  .case-card__actions{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:12px;flex-wrap:wrap}
  .case-card__best{font-size:.875rem;color:var(--muted)}
  .case-player{max-width:var(--maxw);margin-inline:auto;outline:none}
  .case-player__head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px}
  .case-player__title{font-family:var(--font-display);font-size:1.25rem;line-height:1.25;margin:0}
  .stepper{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;list-style:none;margin:8px 0 12px;padding:0 0 4px;-webkit-overflow-scrolling:touch;counter-reset:stepper}
  .stepper::-webkit-scrollbar{display:none}
  .stepper__step{flex:none;display:flex;align-items:center;gap:6px;font-size:.75rem;color:var(--muted);padding:6px 10px 6px 6px;border-radius:999px;border:1px solid transparent;white-space:nowrap}
  .stepper__dot{width:22px;height:22px;border-radius:50%;background:var(--surface-3);color:var(--ink-2);display:inline-flex;align-items:center;justify-content:center;font-size:.6875rem;font-weight:600;font-variant-numeric:tabular-nums;flex:none}
  .stepper__step.is-done{color:var(--ink-2)}
  .stepper__step.is-done .stepper__dot{background:var(--ok);color:var(--accent-ink)}
  .stepper__step.is-current{color:var(--accent);border-color:var(--accent);background:var(--accent-soft);font-weight:600}
  .stepper__step.is-current .stepper__dot{background:var(--accent);color:var(--accent-ink)}
  .case-progress{display:flex;align-items:center;gap:10px;margin-bottom:12px;font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-variant-numeric:tabular-nums}
  .case-progress .bar{flex:1;height:6px;background:var(--surface-3);border-radius:999px;overflow:hidden}
  .case-progress .bar__fill{height:100%;background:var(--accent);border-radius:999px;transition:width .3s cubic-bezier(.2,.7,.2,1)}
  .dossier{background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1);border-left:4px solid var(--blue);padding:14px 16px;margin-bottom:12px;max-width:62ch;line-height:1.65}
  .dossier__label{font-family:var(--font-mono);font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--blue);margin-bottom:6px;display:flex;align-items:center;gap:6px}
  .dossier__body p{margin:0 0 10px}
  .dossier__body p:last-child{margin-bottom:0}
  .dossier__body ul,.dossier__body ol{padding-left:20px;margin:0 0 10px}
  .dossier__body table{border-collapse:collapse;width:100%;font-size:.875rem;margin:8px 0}
  .dossier__body th,.dossier__body td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
  .q{background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1);padding:16px;margin-bottom:12px}
  .q__kind{display:flex;align-items:center;gap:8px;margin-bottom:8px}
  .q__stem{font-size:1.0625rem;font-weight:500;line-height:1.5;margin-bottom:12px}
  .q__stem p{margin:0 0 6px}
  .q__stem p:last-child{margin:0}
  .opts{display:grid;gap:8px}
  .opt{display:flex;align-items:flex-start;gap:10px;width:100%;min-height:52px;border:1px solid var(--line);border-radius:var(--r-s);background:var(--surface);padding:10px 12px;cursor:pointer;text-align:left;font:inherit;color:var(--ink);flex-wrap:wrap;transition:background .2s ease,border-color .2s ease}
  .opt:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
  .opt__key{flex:none;width:28px;height:28px;border-radius:50%;background:var(--surface-2);color:var(--ink-2);display:inline-flex;align-items:center;justify-content:center;font-weight:600;font-size:.875rem}
  .opt__text{flex:1;min-width:0;line-height:1.45;padding-top:3px}
  .opt.is-selected{border-color:var(--ink);background:var(--surface-2)}
  .opt.is-selected .opt__key{background:var(--ink);color:var(--surface)}
  .opt.is-correct{background:var(--ok-soft);border-color:var(--ok)}
  .opt.is-correct .opt__key{background:var(--ok);color:var(--accent-ink)}
  .opt.is-wrong{background:var(--bad-soft);border-color:var(--bad)}
  .opt.is-wrong .opt__key{background:var(--bad);color:var(--accent-ink)}
  .opt.is-missed{background:var(--warn-soft);border-color:var(--warn)}
  .opt.is-missed .opt__key{background:var(--warn);color:var(--accent-ink)}
  .opt.is-neutral{opacity:.75}
  .opt[aria-disabled="true"]{cursor:default}
  .opt__why{display:none;flex-basis:100%;font-size:.875rem;color:var(--ink-2);padding:6px 0 0 38px;line-height:1.45}
  .opt__why.is-open{display:block}
  .q__feedback{font-weight:600;margin:12px 0 0}
  .q__feedback--ok{color:var(--ok)} .q__feedback--warn{color:var(--warn)} .q__feedback--bad{color:var(--bad)}
  .callout{background:var(--info-soft);border-left:3px solid var(--info);border-radius:var(--r-s);padding:10px 12px;margin-top:12px;color:var(--ink-2)}
  .callout p{margin:0 0 6px} .callout p:last-child{margin:0}
  .callout__label{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;font-weight:600;color:var(--info);margin-bottom:4px}
  .q__input{width:100%;box-sizing:border-box;min-height:44px;border:1px solid var(--line);border-radius:var(--r-s);background:var(--surface);color:var(--ink);font:inherit;padding:10px 12px;resize:vertical;line-height:1.5}
  .q__input:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
  .q__input:disabled{background:var(--surface-2);color:var(--ink-2)}
  .q__answer{margin-top:12px;background:var(--ok-soft);border-left:3px solid var(--ok);border-radius:var(--r-s);padding:10px 12px}
  .q__answer-label{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;font-weight:600;color:var(--ok);margin-bottom:4px}
  .q__answer-text{margin:0;font-weight:600}
  .q__accept{margin:6px 0 0;font-size:.875rem;color:var(--ink-2)}
  .q__kws{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px}
  .q__kws-label{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-right:2px}
  .q__kws .pill{text-transform:none;letter-spacing:0}
  .selfgrade{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}
  .selfgrade .btn{padding-inline:6px;font-size:.875rem;border:2px solid transparent}
  .selfgrade .btn--again{background:var(--bad-soft);color:var(--bad)}
  .selfgrade .btn--hard{background:var(--warn-soft);color:var(--warn)}
  .selfgrade .btn--good{background:var(--ok-soft);color:var(--ok)}
  .selfgrade .btn.is-suggested{border-color:currentColor}
  .selfgrade .btn.is-selected{outline:2px solid var(--ink);outline-offset:2px}
  .grades__label{grid-column:1/-1;color:var(--muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.06em}
  .rubric{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:6px}
  .rubric__item{display:flex;align-items:flex-start;gap:10px;min-height:44px;padding:8px 10px;border:1px solid var(--line);border-radius:var(--r-s);cursor:pointer;background:var(--surface)}
  .rubric__item input{width:20px;height:20px;margin:2px 0 0;accent-color:var(--ok);flex:none}
  .rubric__item.is-on{background:var(--ok-soft);border-color:var(--ok)}
  .rubric__text{flex:1;line-height:1.45}
  .rubric__w{flex:none;font-variant-numeric:tabular-nums}
  .rubric__score{margin-top:10px;font-weight:600;font-variant-numeric:tabular-nums}
  .rubric__hint{font-size:.875rem;color:var(--muted);margin:10px 0 0}
  .case-reveal{background:var(--surface-2);border-radius:var(--r-m);padding:14px 16px;margin-bottom:12px;max-width:62ch;line-height:1.6}
  .case-reveal__label{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;font-weight:600;color:var(--muted);margin-bottom:6px;display:flex;align-items:center;gap:6px}
  .case-reveal p{margin:0 0 8px} .case-reveal p:last-child{margin:0}
  .case-actions{display:flex;flex-direction:column;gap:8px;margin:4px 0 8px}
  .case-actions .btn{min-height:52px}
  .case-end{text-align:center}
  .case-end__title{font-family:var(--font-display);font-size:1.375rem;margin:0 0 4px}
  .case-end__pct{font-family:var(--font-display);font-size:3rem;line-height:1;font-weight:700;font-variant-numeric:tabular-nums;margin:8px 0 4px}
  .case-end__pct--ok{color:var(--ok)} .case-end__pct--warn{color:var(--warn)} .case-end__pct--bad{color:var(--bad)}
  .case-end .bar{height:10px;background:var(--surface-3);border-radius:999px;overflow:hidden;margin:10px auto 8px;max-width:320px}
  .case-end .bar__fill{height:100%;background:var(--accent);border-radius:999px;width:0;transition:width .6s cubic-bezier(.2,.7,.2,1)}
  .case-end__meta{color:var(--muted);font-size:.875rem;margin:0 0 14px}
  .case-results{list-style:none;margin:0 0 14px;padding:0;text-align:left;display:grid;gap:6px}
  .case-results li{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:var(--r-s);background:var(--surface-2);font-size:.9375rem}
  .case-results__n{font-variant-numeric:tabular-nums;color:var(--muted);width:24px;flex:none}
  .case-results__phase{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .case-results__score{font-variant-numeric:tabular-nums;font-weight:600;flex:none}
  .case-results__score--ok{color:var(--ok)} .case-results__score--warn{color:var(--warn)} .case-results__score--bad{color:var(--bad)}
  .case-end__actions{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
  @media (prefers-reduced-motion:reduce){.case-end .bar__fill,.case-progress .bar__fill,.opt{transition:none}}
  @keyframes case-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
  .q.is-shake{animation:case-shake .18s ease 1}
  @media (prefers-reduced-motion:reduce){.q.is-shake{animation:none}}
  `;

  function injectStyle() {
    if (document.getElementById('style-view-cases')) return;
    const s = document.createElement('style');
    s.id = 'style-view-cases';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ------------------------------------------------------------------ */
  /* Contrôleurs de question                                              */
  /* Interface : { el, validate() → number | 'pending' | null, score() → number|null,             */
  /*               onScore(fn), needsPick (bool), keyToggle(i), kind }                              */
  /* ------------------------------------------------------------------ */

  const KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const KIND_LABEL = { QRM: 'QRM', QRU: 'QRU', QROC: 'QROC', OPEN: 'Ouverte' };

  function kindPill(type) {
    return h('div', { class: 'q__kind' }, h('span', { class: 'pill pill--kind' }, KIND_LABEL[type] || type || 'Question'));
  }

  function edmScore(disc, isQRU) {
    if (isQRU) return disc === 0 ? 1 : 0;
    return disc === 0 ? 1 : disc === 1 ? 0.5 : disc === 2 ? 0.2 : 0;
  }

  function feedbackLine(disc, isQRU) {
    if (disc === 0) return 'Juste.';
    if (isQRU) return 'Faux — regarde pourquoi.';
    if (disc === 1) return 'Presque : 1 discordance.';
    if (disc === 2) return 'Insuffisant : 2 discordances.';
    return 'Faux — regarde pourquoi.';
  }

  // QRM (EDN, 5 options) et QRU (1 bonne réponse).
  function mcqController(q, isQRU) {
    const opts = Array.isArray(q.options) ? q.options : [];
    const sel = new Set();
    let validated = false;
    let score = null;
    const el = h('div', { class: 'q q--mcq' });
    el.append(kindPill(isQRU ? 'QRU' : 'QRM'), mdEl(q.stem, 'q__stem'));
    const listEl = h('div', { class: 'opts', role: isQRU ? 'radiogroup' : 'group' });
    const rows = opts.map((o, i) => {
      const row = h('div', { class: 'opt', role: isQRU ? 'radio' : 'checkbox', tabindex: '0', 'aria-checked': 'false' },
        h('span', { class: 'opt__key', 'aria-hidden': 'true' }, KEYS[i] || String(i + 1)),
        inlineEl('span', { class: 'opt__text' }, o.t),
        h('div', { class: 'opt__why' }));
      row.addEventListener('click', () => toggle(i));
      row.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(i); } });
      listEl.append(row);
      return row;
    });
    el.append(listEl);
    const fb = h('p', { class: 'q__feedback', 'aria-live': 'polite' });
    el.append(fb);

    function toggle(i) {
      if (validated) return;
      if (isQRU) { const had = sel.has(i); sel.clear(); if (!had) sel.add(i); }
      else { if (sel.has(i)) sel.delete(i); else sel.add(i); }
      rows.forEach((r, j) => { r.classList.toggle('is-selected', sel.has(j)); r.setAttribute('aria-checked', String(sel.has(j))); });
    }

    function validate() {
      if (validated) return score;
      if (!sel.size) { toast(isQRU ? 'Choisis une réponse.' : 'Coche au moins une réponse.', 'warn'); return null; }
      validated = true;
      let disc = 0;
      opts.forEach((o, i) => {
        const s = sel.has(i), ok = !!o.ok;
        if (s !== ok) disc++;
        const r = rows[i];
        r.classList.remove('is-selected');
        r.classList.add(s && ok ? 'is-correct' : s && !ok ? 'is-wrong' : !s && ok ? 'is-missed' : 'is-neutral');
        r.setAttribute('aria-disabled', 'true');
        r.removeAttribute('tabindex');
        if (o.why) { const why = r.querySelector('.opt__why'); why.innerHTML = mdInline(o.why); why.classList.add('is-open'); }
      });
      score = edmScore(disc, isQRU);
      fb.textContent = feedbackLine(disc, isQRU);
      fb.className = 'q__feedback q__feedback--' + (score >= 0.99 ? 'ok' : score >= 0.5 ? 'warn' : 'bad');
      if (score < 0.5 && !reducedMotion()) { el.classList.add('is-shake'); setTimeout(() => el.classList.remove('is-shake'), 250); }
      if (q.explanation) el.append(h('div', { class: 'callout q__explain' }, h('div', { class: 'callout__label' }, 'Explication'), mdEl(q.explanation)));
      return score;
    }
    return { el, validate, score: () => score, onScore: () => {}, needsPick: false, keyToggle: toggle, kind: isQRU ? 'QRU' : 'QRM' };
  }

  // QROC : réponse courte, auto-évaluée 0 / 0,5 / 1 avec aide par mots-clés.
  function qrocController(q) {
    const el = h('div', { class: 'q q--qroc' });
    el.append(kindPill('QROC'), mdEl(q.question, 'q__stem'));
    const ta = h('textarea', { class: 'q__input', rows: '2', placeholder: 'Ta réponse…', 'aria-label': 'Ta réponse', autocomplete: 'off' });
    el.append(ta);
    let score = null, validated = false;
    const listeners = [];

    function validate() {
      if (validated) return score == null ? 'pending' : score;
      validated = true;
      ta.disabled = true;
      const user = normalize(ta.value);
      const accept = list(q.accept);
      const answers = [q.answer].concat(accept).map(normalize).filter(Boolean);
      const kws = list(q.keywords);
      const found = kws.filter(k => user && user.includes(normalize(k)));
      const exact = !!user && answers.some(a => user.includes(a));
      const suggest = exact || (kws.length && found.length === kws.length) ? 1 : found.length ? 0.5 : 0;

      const ans = h('div', { class: 'q__answer' },
        h('div', { class: 'q__answer-label' }, 'Réponse attendue'),
        inlineEl('p', { class: 'q__answer-text' }, q.answer || '—'));
      if (accept.length) ans.append(h('p', { class: 'q__accept' }, 'Aussi accepté : ' + accept.join(', ')));
      if (kws.length) {
        ans.append(h('div', { class: 'q__kws' }, h('span', { class: 'q__kws-label' }, 'Mots-clés'),
          kws.map(k => h('span', { class: 'pill ' + (found.includes(k) ? 'pill--ok' : 'pill--bad'), title: found.includes(k) ? 'Présent dans ta réponse' : 'Absent de ta réponse' }, k))));
      }
      el.append(ans);
      if (q.explanation) el.append(h('div', { class: 'callout q__explain' }, h('div', { class: 'callout__label' }, 'Explication'), mdEl(q.explanation)));

      const row = h('div', { class: 'selfgrade', role: 'group', 'aria-label': 'Ton auto-évaluation' },
        h('span', { class: 'grades__label' }, user ? 'Ta réponse était… (suggestion entourée)' : 'Tu n\'as rien écrit : ta réponse était…'));
      [{ s: 0, l: 'Fausse', c: 'btn--again' }, { s: 0.5, l: 'Partielle', c: 'btn--hard' }, { s: 1, l: 'Juste', c: 'btn--good' }].forEach(d => {
        const b = h('button', { type: 'button', class: 'btn btn--secondary ' + d.c + (d.s === suggest ? ' is-suggested' : ''), 'aria-pressed': 'false' }, d.l);
        b.addEventListener('click', () => {
          score = d.s;
          row.querySelectorAll('.btn').forEach(x => { x.classList.toggle('is-selected', x === b); x.setAttribute('aria-pressed', String(x === b)); });
          listeners.forEach(f => f(score));
        });
        row.append(b);
      });
      el.append(row);
      return 'pending';
    }
    return { el, validate, score: () => score, onScore: (f) => listeners.push(f), needsPick: true, keyToggle: () => {}, kind: 'QROC', focus: () => ta.focus() };
  }

  // OPEN : réponse rédigée (facultative), grille pondérée cochée par l'utilisateur.
  function openController(q) {
    const el = h('div', { class: 'q q--open' });
    el.append(kindPill('OPEN'), mdEl(q.prompt, 'q__stem'));
    const ta = h('textarea', { class: 'q__input', rows: '4', placeholder: 'Rédige ta réponse (facultatif), puis valide pour comparer.', 'aria-label': 'Ta réponse', autocomplete: 'off' });
    el.append(ta);
    const rubric = Array.isArray(q.rubric) ? q.rubric.filter(r => r && r.point) : [];
    const total = rubric.reduce((a, r) => a + (Number(r.weight) || 0), 0);
    const ticked = new Set();
    let validated = false;
    const listeners = [];
    const scoreEl = h('p', { class: 'rubric__score' });

    function current() {
      if (!total) return 1;
      let s = 0; ticked.forEach(i => { s += Number(rubric[i].weight) || 0; });
      return Math.max(0, Math.min(1, s / total));
    }
    function refresh() {
      let s = 0; ticked.forEach(i => { s += Number(rubric[i].weight) || 0; });
      scoreEl.textContent = 'Points : ' + s + ' / ' + total + ' (' + pct(current()) + ' %)';
      listeners.forEach(f => f(current()));
    }
    function validate() {
      if (validated) return 'pending';
      validated = true;
      ta.disabled = true;
      if (q.model) el.append(h('div', { class: 'callout' }, h('div', { class: 'callout__label' }, 'Réponse modèle'), mdEl(q.model)));
      if (rubric.length) {
        el.append(h('p', { class: 'rubric__hint' }, 'Coche les points que ta réponse contenait : sois honnête, c\'est ce qui fait progresser.'));
        const ul = h('ul', { class: 'rubric' });
        rubric.forEach((r, i) => {
          const cb = h('input', { type: 'checkbox', 'aria-label': r.point });
          const li = h('label', { class: 'rubric__item' }, cb,
            inlineEl('span', { class: 'rubric__text' }, r.point),
            h('span', { class: 'pill rubric__w' }, (Number(r.weight) || 0) + ' pt' + ((Number(r.weight) || 0) > 1 ? 's' : '')));
          cb.addEventListener('change', () => { if (cb.checked) ticked.add(i); else ticked.delete(i); li.classList.toggle('is-on', cb.checked); refresh(); });
          ul.append(li);
        });
        el.append(ul, scoreEl);
        refresh();
      }
      return 'pending';
    }
    return { el, validate, score: current, onScore: (f) => listeners.push(f), needsPick: false, keyToggle: () => {}, kind: 'OPEN', focus: () => ta.focus() };
  }

  function buildController(q) {
    const type = q && q.type;
    if (type === 'QRM') return mcqController(q, false);
    if (type === 'QRU') return mcqController(q, true);
    if (type === 'QROC') return qrocController(q);
    if (type === 'OPEN') return openController(q);
    // Type inconnu : on affiche ce qu'on peut et on laisse passer sans pénaliser.
    const el = h('div', { class: 'q' }, h('p', { class: 'empty' }, 'Question d\'un type non pris en charge (' + String(type) + ').'));
    return { el, validate: () => 1, score: () => 1, onScore: () => {}, needsPick: false, keyToggle: () => {}, kind: String(type || '?') };
  }

  /* ------------------------------------------------------------------ */
  /* Lecteur de dossier                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * runInline(caseObj, opts) → HTMLElement
   * opts: { onComplete(score, details), record (bool), item (num), onExit() }
   * details = { steps: [{id, phase, type, score, ms}], ms, total }
   */
  function runInline(caseObj, opts) {
    opts = opts || {};
    injectStyle();
    const root = h('div', { class: 'case-player', tabindex: '-1' });
    if (!caseObj || !Array.isArray(caseObj.steps) || !caseObj.steps.length) {
      root.append(h('div', { class: 'card' }, h('p', { class: 'empty' }, 'Ce dossier est vide ou introuvable.')));
      return root;
    }
    const steps = caseObj.steps;
    const timeline = Array.isArray(caseObj.timeline) ? caseObj.timeline : [];
    const item = opts.item || caseObj.item || itemOfId(caseObj.id);
    const N = steps.length;

    let idx = 0, results = [], t0 = now(), stepT0 = t0, ctrl = null, primaryBtn = null;

    const head = h('div', { class: 'case-player__head' },
      h('h3', { class: 'case-player__title' }, caseObj.title || 'Dossier progressif'),
      caseObj.rank ? h('span', { class: 'pill pill--' + caseObj.rank }, 'Rang ' + caseObj.rank) : null);
    const stepper = h('ol', { class: 'stepper', 'aria-label': 'Chronologie du dossier' });
    const progText = h('span');
    const progFill = h('div', { class: 'bar__fill', style: 'width:0%' });
    const progress = h('div', { class: 'case-progress' }, progText, h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(N) }, progFill));
    const body = h('div', { class: 'case-player__body' });
    root.append(head, stepper, progress, body);

    function drawStepper(currentPhase, finished) {
      stepper.replaceChildren();
      timeline.forEach((label, i) => {
        const done = finished || i < currentPhase;
        const isCur = !finished && i === currentPhase;
        const attrs = { class: 'stepper__step' + (done ? ' is-done' : '') + (isCur ? ' is-current' : '') };
        if (isCur) attrs['aria-current'] = 'step';
        const li = h('li', attrs,
          h('span', { class: 'stepper__dot' }, done ? (icon('check') || '✓') : String(i + 1)),
          h('span', null, label));
        stepper.append(li);
      });
      const cur = stepper.querySelector('.is-current');
      if (cur && typeof cur.scrollIntoView === 'function') {
        try { cur.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch (e) { /* ignore */ }
      }
    }

    function setProgress(n) {
      progText.textContent = 'Étape ' + Math.min(n + 1, N) + ' / ' + N;
      progFill.style.width = Math.round((n / N) * 100) + '%';
      progress.querySelector('.bar').setAttribute('aria-valuenow', String(n));
    }

    function drawStep() {
      const step = steps[idx];
      stepT0 = now();
      const phase = Number.isInteger(step.phase) ? step.phase : 0;
      drawStepper(phase, false);
      setProgress(idx);
      body.replaceChildren();

      const dossier = h('section', { class: 'dossier' },
        h('div', { class: 'dossier__label' }, icon('case'), 'Dossier patient · ' + (timeline[phase] || 'Étape ' + (idx + 1))),
        mdEl(step.narrative, 'dossier__body'));
      body.append(dossier);

      ctrl = buildController(step.question || {});
      body.append(ctrl.el);

      const actions = h('div', { class: 'case-actions' });
      const validateBtn = h('button', { type: 'button', class: 'btn btn--primary btn--block' }, 'Valider');
      actions.append(validateBtn);
      body.append(actions);
      primaryBtn = validateBtn;

      validateBtn.addEventListener('click', () => {
        const r = ctrl.validate();
        if (r === null) return;
        haptic();
        validateBtn.remove();
        // Suite de l'histoire, puis bouton d'étape suivante.
        const nextBtn = h('button', { type: 'button', class: 'btn btn--primary btn--block' }, idx + 1 < N ? 'Étape suivante' : 'Voir le bilan', icon('chevron-right'));
        if (step.reveal) {
          actions.before(h('section', { class: 'case-reveal' },
            h('div', { class: 'case-reveal__label' }, icon('clock'), 'Ce qui se passe ensuite'),
            mdEl(step.reveal)));
        }
        if (step.src) actions.before(h('div', { class: 'src', style: 'margin-bottom:10px' }, step.src));
        actions.append(nextBtn);
        primaryBtn = nextBtn;
        if (r === 'pending' && ctrl.needsPick && ctrl.score() == null) {
          nextBtn.disabled = true;
          ctrl.onScore(() => { nextBtn.disabled = false; });
        }
        nextBtn.addEventListener('click', () => {
          const sc = typeof r === 'number' ? r : ctrl.score();
          if (sc == null) { toast('Évalue d\'abord ta réponse.', 'warn'); return; }
          results.push({ id: step.id, phase, type: ctrl.kind, score: Math.max(0, Math.min(1, Number(sc) || 0)), ms: now() - stepT0 });
          idx++;
          if (idx >= N) finish(); else { drawStep(); scrollTop(); }
        });
        try { nextBtn.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch (e) { /* ignore */ }
      });
      if (ctrl.focus && window.matchMedia && window.matchMedia('(min-width: 900px)').matches) { try { ctrl.focus(); } catch (e) { /* ignore */ } }
    }

    function scrollTop() {
      try { root.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch (e) { /* ignore */ }
    }

    function finish() {
      const ms = now() - t0;
      const total = results.length ? results.reduce((a, r) => a + r.score, 0) / results.length : 0;
      const details = { steps: results.slice(), ms, total };
      drawStepper(timeline.length, true);
      setProgress(N);
      progText.textContent = 'Terminé';
      body.replaceChildren();

      if (opts.record) {
        recordAttempt({ cardId: caseObj.id, item, kind: 'case', score: total, ms, details });
      }
      if (typeof opts.onComplete === 'function') {
        try { opts.onComplete(total, details); } catch (e) { console.warn('[cases] onComplete a échoué', e); }
      }

      const tone = total >= 0.8 ? 'ok' : total >= 0.5 ? 'warn' : 'bad';
      const fill = h('div', { class: 'bar__fill' });
      const end = h('section', { class: 'card case-end' },
        h('h3', { class: 'case-end__title' }, 'Dossier terminé'),
        h('div', { class: 'case-end__pct case-end__pct--' + tone }, pct(total) + ' %'),
        h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': String(pct(total)), 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill),
        h('p', { class: 'case-end__meta' }, N + ' étapes · ' + fmtDuration(ms) + (total >= 0.8 ? ' · Solide.' : total >= 0.5 ? ' · Presque : relis les explications.' : ' · À retravailler : la fiche t\'attend.')));
      const ul = h('ol', { class: 'case-results' });
      results.forEach((r, i) => {
        const t = r.score >= 0.99 ? 'ok' : r.score >= 0.5 ? 'warn' : 'bad';
        ul.append(h('li', null,
          h('span', { class: 'case-results__n' }, String(i + 1)),
          h('span', { class: 'pill pill--kind' }, KIND_LABEL[r.type] || r.type),
          h('span', { class: 'case-results__phase' }, timeline[r.phase] || ''),
          h('span', { class: 'case-results__score case-results__score--' + t }, pct(r.score) + ' %')));
      });
      end.append(ul);
      const acts = h('div', { class: 'case-end__actions' });
      acts.append(h('button', { type: 'button', class: 'btn btn--secondary', on: { click: restart } }, icon('refresh'), 'Refaire'));
      if (typeof opts.onExit === 'function' || opts.record) {
        acts.append(h('button', {
          type: 'button', class: 'btn btn--primary',
          on: { click: () => { if (typeof opts.onExit === 'function') opts.onExit(); else if (item) go('#/item/' + item + '/cas'); else history.back(); } }
        }, 'Retour'));
      }
      end.append(acts);
      body.append(end);
      primaryBtn = null;
      // Barre animée 0 → score (600 ms), instantanée si prefers-reduced-motion.
      requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = pct(total) + '%'; }));
      scrollTop();
    }

    function restart() {
      idx = 0; results = []; t0 = now();
      drawStep();
      scrollTop();
    }

    // Clavier (bureau) : 1–5 cochent les options, Entrée valide / passe à la suite.
    root.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'TEXTAREA' || tag === 'INPUT') { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && primaryBtn && !primaryBtn.disabled) { e.preventDefault(); primaryBtn.click(); } return; }
      if (/^[1-5]$/.test(e.key) && ctrl && ctrl.keyToggle) { ctrl.keyToggle(Number(e.key) - 1); e.preventDefault(); return; }
      if (e.key === 'Enter' && primaryBtn && !primaryBtn.disabled && !(e.target && e.target.classList && e.target.classList.contains('opt'))) { e.preventDefault(); primaryBtn.click(); }
    });

    drawStep();
    return root;
  }

  /* ------------------------------------------------------------------ */
  /* Pages                                                                 */
  /* ------------------------------------------------------------------ */

  function pageHead(title, sub) {
    return h('header', { class: 'page-head' },
      h('h2', { class: 'page-title' }, title),
      sub ? h('p', { class: 'page-sub' }, sub) : null);
  }

  function difficultyDots(d) {
    const n = Math.max(1, Math.min(3, Number(d) || 1));
    const wrap = h('span', { class: 'dots', role: 'img', 'aria-label': 'Difficulté ' + n + ' sur 3', title: 'Difficulté ' + n + '/3' });
    for (let i = 1; i <= 3; i++) wrap.append(h('span', { class: 'dots__dot' + (i <= n ? ' is-on' : '') }));
    return wrap;
  }

  function caseCard(c, num) {
    const steps = Array.isArray(c.steps) ? c.steps.length : 0;
    const best = bestScore(c.id);
    const card = h('article', { class: 'card case-card' });
    card.append(
      h('div', { class: 'case-card__top' },
        h('h3', { class: 'case-card__title' }, c.title || 'Dossier progressif'),
        c.rank ? h('span', { class: 'pill pill--' + c.rank }, 'Rang ' + c.rank) : null),
      c.summary ? h('p', { class: 'case-card__summary' }, c.summary) : null,
      h('div', { class: 'case-card__meta' },
        h('span', { class: 'pill pill--kind' }, 'Cas'),
        difficultyDots(c.difficulty),
        h('span', null, steps + (steps > 1 ? ' étapes' : ' étape'))));
    const tl = Array.isArray(c.timeline) ? c.timeline : [];
    if (tl.length) card.append(h('ol', { class: 'case-tl', 'aria-label': 'Chronologie' }, tl.map(t => h('li', null, t))));
    const href = '#/item/' + num + '/cas/' + encodeURIComponent(c.id);
    card.append(h('div', { class: 'case-card__actions' },
      best == null
        ? h('span', { class: 'case-card__best' }, 'Jamais fait')
        : h('span', { class: 'pill pill--' + (best >= 0.8 ? 'ok' : best >= 0.5 ? 'warn' : 'bad') }, 'Meilleur score ' + pct(best) + ' %'),
      h('button', { type: 'button', class: 'btn btn--primary btn--sm', on: { click: () => go(href) } }, icon('play'), best == null ? 'Commencer' : 'Refaire')));
    return card;
  }

  function errorCard(num, msg, retryHash) {
    return h('div', { class: 'card' },
      h('p', { class: 'empty' }, msg),
      h('button', { type: 'button', class: 'btn btn--secondary btn--block', on: { click: () => go(retryHash) } }, icon('refresh'), 'Réessayer'));
  }

  async function renderListPage(num) {
    injectStyle();
    const page = h('div', { class: 'page cases-page' });
    const content = await ensureItem(num);
    const meta = (content && content.meta) || itemMeta(num) || {};
    page.append(pageHead('Dossiers progressifs', (meta.short ? meta.short + ' — ' : '') + (meta.title || 'Item ' + num)));
    if (!content) {
      page.append(errorCard(num, 'Impossible de charger l\'item ' + num + '. Vérifie ta connexion puis réessaie.', '#/item/' + num + '/cas'));
      return page;
    }
    const cases = Array.isArray(content.cases) ? content.cases : [];
    if (!cases.length) {
      page.append(h('div', { class: 'card' }, h('p', { class: 'empty' }, 'Pas de dossier progressif pour cet item : entraîne-toi avec les QCM en attendant.')));
      return page;
    }
    const listEl = h('div', { class: 'case-list' });
    cases.forEach(c => listEl.append(caseCard(c, num)));
    page.append(listEl);
    return page;
  }

  async function renderPlayerPage(num, caseId) {
    injectStyle();
    const page = h('div', { class: 'page cases-page cases-page--player' });
    const content = await ensureItem(num);
    if (!content) {
      page.append(errorCard(num, 'Impossible de charger l\'item ' + num + '. Vérifie ta connexion puis réessaie.', '#/item/' + num + '/cas/' + encodeURIComponent(caseId)));
      return page;
    }
    const cases = Array.isArray(content.cases) ? content.cases : [];
    const c = cases.find(x => x && x.id === caseId) || null;
    if (!c) {
      page.append(h('div', { class: 'card' },
        h('p', { class: 'empty' }, 'Ce dossier n\'existe pas (ou plus) dans cet item.'),
        h('button', { type: 'button', class: 'btn btn--secondary btn--block', on: { click: () => go('#/item/' + num + '/cas') } }, 'Voir les dossiers')));
      return page;
    }
    page.append(runInline(c, { record: true, item: num, onExit: () => go('#/item/' + num + '/cas') }));
    return page;
  }

  function render(params) {
    params = params || {};
    const num = params.num != null ? params.num : params.item;
    let caseId = params.caseId != null ? params.caseId : (params.id != null ? params.id : params.case);
    try {
      if (num == null || num === '') {
        return h('div', { class: 'page' }, h('div', { class: 'card' }, h('p', { class: 'empty' }, 'Choisis un item pour voir ses dossiers progressifs.')));
      }
      if (caseId != null && caseId !== '') {
        try { caseId = decodeURIComponent(String(caseId)); } catch (e) { caseId = String(caseId); }
        return renderPlayerPage(String(num), caseId);
      }
      return renderListPage(String(num));
    } catch (e) {
      console.warn('[cases] render a échoué', e);
      return h('div', { class: 'page' }, h('div', { class: 'card' }, h('p', { class: 'empty' }, 'Une erreur est survenue en affichant les dossiers.')));
    }
  }

  CARDIO.views.cases = { render, runInline, renderCase: runInline };
})();
