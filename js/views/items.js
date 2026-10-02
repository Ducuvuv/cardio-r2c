/* CardioR2C — views/items.js
 * Liste des 22 items groupés par section (#/items) et page « hub » d'un item (#/item/:num).
 * La liste ne dépend que du manifest et du store ; le hub charge le contenu uniquement pour
 * la table des objectifs (chargement paresseux avec squelette).
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  CARDIO.views = CARDIO.views || {};

  /* ---------- Accès défensif aux modules ---------- */

  function util() { return CARDIO.util || {}; }
  function store() { return CARDIO.store || null; }
  function registry() { return CARDIO.registry || null; }

  function flat(list, out) {
    out = out || [];
    list.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) flat(c, out); else out.push(c);
    });
    return out;
  }

  function fallbackH(tag, attrs) {
    const el = document.createElement(tag);
    const a = attrs || {};
    Object.keys(a).forEach(function (k) {
      const v = a[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.keys(v).forEach(function (d) { el.dataset[d] = v[d]; });
      else if (k === 'on') Object.keys(v).forEach(function (e) { el.addEventListener(e, v[e]); });
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    flat(Array.prototype.slice.call(arguments, 2)).forEach(function (c) {
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return el;
  }

  function h(tag, attrs) {
    const kids = flat(Array.prototype.slice.call(arguments, 2));
    const u = util();
    if (typeof u.h === 'function') return u.h.apply(null, [tag, attrs || {}].concat(kids));
    if (!h.warned) { h.warned = true; console.warn('[items] CARDIO.util.h absent : rendu de repli'); }
    return fallbackH.apply(null, [tag, attrs].concat(kids));
  }

  function icon(name) {
    const u = util();
    if (typeof u.icon === 'function') { try { return u.icon(name) || ''; } catch (e) { /* ignore */ } }
    return '';
  }
  function iconEl(name, cls) { return h('span', { class: 'ico ' + (cls || ''), 'aria-hidden': 'true', html: icon(name) }); }

  function safe(fn, fallback) {
    try { const v = fn(); return v === undefined ? fallback : v; } catch (e) { console.warn('[items]', e); return fallback; }
  }
  function state() { const s = store(); return (s && s.state) || {}; }
  function pct(x) { return Math.round(Math.max(0, Math.min(1, Number(x) || 0)) * 100); }
  function str(v) { return v === undefined || v === null ? '' : String(v); }

  function mastery(num) {
    const s = store();
    const v = s && typeof s.mastery === 'function' ? safe(function () { return s.mastery(num); }, null) : null;
    return v && typeof v === 'object' ? v : { A: 0, B: 0, all: 0, seen: 0, total: 0 };
  }

  function dueIds() {
    const s = store();
    const v = s && typeof s.dueCards === 'function' ? safe(function () { return s.dueCards(Date.now()); }, null) : null;
    if (Array.isArray(v)) return v;
    const now = Date.now();
    const cards = state().cards || {};
    return Object.keys(cards).filter(function (id) { const c = cards[id]; return c && c.due && c.due <= now && c.state !== 'new'; });
  }

  function dueByItem() {
    const out = {};
    dueIds().forEach(function (id) { const n = String(id).split('-')[0]; out[n] = (out[n] || 0) + 1; });
    return out;
  }

  function allItems() {
    const reg = registry();
    return reg && typeof reg.items === 'function' ? safe(function () { return reg.items(); }, []) : [];
  }

  function findItem(num) {
    const reg = registry();
    const it = reg && typeof reg.item === 'function' ? safe(function () { return reg.item(num); }, null) : null;
    return it || allItems().find(function (x) { return str(x.num) === str(num); }) || null;
  }

  /* Score « maîtrise » d'une carte du store : rétrievabilité FSRS si disponible, sinon dernier score. */
  function cardScore(cs) {
    if (!cs || cs.state === 'new' || !cs.reps) return null;
    const srs = CARDIO.srs;
    if (srs && typeof srs.retrievability === 'function') {
      const r = safe(function () { return srs.retrievability(cs, Date.now()); }, null);
      if (typeof r === 'number' && !isNaN(r)) return r;
    }
    const hist = Array.isArray(cs.hist) ? cs.hist : [];
    if (hist.length) { const last = hist[hist.length - 1]; if (Array.isArray(last) && typeof last[2] === 'number') return last[2]; }
    return cs.lapses ? 0.5 : 0.8;
  }

  const KIND_SEGMENTS = { qcm: ['qcm', 'qru'], qroc: ['qroc'], open: ['open'], kfp: ['kfp'], tcs: ['tcs'],
    flash: ['ess', 'num', 'mn'], trees: ['tree'], tx: ['tx'], cases: ['case'], ecg: ['ecg'], echo: ['echo'] };

  /* Maîtrise par kind d'un item (sans contenu) : moyenne des scores sur le total du manifest. */
  function kindMastery(num, countKeys, counts) {
    const cards = state().cards || {};
    const prefix = str(num) + '-';
    let sum = 0, seen = 0, total = 0;
    countKeys.forEach(function (k) { total += Number((counts || {})[k]) || 0; });
    const segs = [];
    countKeys.forEach(function (k) { (KIND_SEGMENTS[k] || []).forEach(function (s) { segs.push('-' + s + '-'); }); });
    Object.keys(cards).forEach(function (id) {
      if (id.indexOf(prefix) !== 0) return;
      if (!segs.some(function (s) { return id.indexOf(s, prefix.length - 1) === prefix.length - 1; })) return;
      const sc = cardScore(cards[id]);
      if (sc === null) return;
      seen++; sum += sc;
    });
    const denom = Math.max(total, seen);
    return { ratio: denom ? sum / denom : 0, seen: seen, total: total };
  }

  function bar(ratio, mod) {
    const fill = h('div', { class: 'bar__fill' });
    fill.style.width = pct(ratio) + '%';
    return h('div', { class: 'bar' + (mod ? ' ' + mod : ''), role: 'progressbar', 'aria-valuenow': String(pct(ratio)), 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill);
  }

  function ringSvg(ratio, size, stroke, color) {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r;
    const off = c * (1 - Math.max(0, Math.min(1, ratio)));
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--surface-3)" stroke-width="' + stroke + '"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="' + stroke + '" stroke-linecap="round" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/></svg>';
  }

  function countsSummary(counts) {
    const c = counts || {};
    const parts = [];
    if (c.qcm) parts.push(c.qcm + ' QCM');
    if (c.qroc) parts.push(c.qroc + ' QROC');
    if (c.cases) parts.push(c.cases + ' cas');
    if (!parts.length) {
      if (c.flash) parts.push(c.flash + ' flashcards');
      else parts.push('contenu à venir');
    }
    return parts.join(' · ');
  }

  /* ---------- Styles (tokens uniquement) ---------- */

  const CSS = [
    '.items__h1{font:700 1.75rem/1.15 var(--font-display);margin:8px 0 4px;text-wrap:balance}',
    '.items__lead{margin:0 0 16px;color:var(--muted)}',
    '.items__eyebrow{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:20px 0 8px;display:flex;gap:8px;align-items:baseline}',
    '.items__eyebrow b{color:var(--ink);font-weight:600}',
    '.items__group{display:grid;gap:8px}',
    '.items__row{display:grid;grid-template-columns:44px 1fr;gap:12px;align-items:start;text-decoration:none;color:inherit;background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1);padding:12px 14px;min-height:44px}',
    '.items__row:active{background:var(--surface-2)}',
    '.items__row.is-soon{opacity:.62}',
    '.items__num{font:500 .875rem/1 var(--font-mono);color:var(--muted);padding-top:4px}',
    '.items__num b{display:block;font:700 1.125rem/1.1 var(--font-display);color:var(--ink);margin-bottom:2px}',
    '.items__body{min-width:0}',
    '.items__head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.items__short{font:700 1.0625rem/1.25 var(--font-display)}',
    '.items__title{margin:2px 0 6px;color:var(--ink-2);font-size:.875rem;line-height:1.35;overflow-wrap:anywhere}',
    '.items__counts{font-size:.75rem;color:var(--muted);margin-bottom:8px}',
    '.items__bars{display:grid;gap:5px}',
    '.items__bar{display:grid;grid-template-columns:28px 1fr 38px;align-items:center;gap:8px;font-size:.75rem}',
    '.items__bar .bar{height:6px}',
    '.items__bar .bar--B .bar__fill{background:var(--blue)}',
    '.items__bar span:last-child{text-align:right;font-variant-numeric:tabular-nums;color:var(--muted)}',
    '.items__due{margin-left:auto}',
    '.ico svg{width:20px;height:20px;display:block}',
    /* hub */
    '.hub__header{padding:8px 0 14px}',
    '.hub__kicker{display:flex;gap:8px;align-items:center;font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:6px}',
    '.hub__h1{font:700 1.625rem/1.15 var(--font-display);margin:0 0 4px;text-wrap:balance}',
    '.hub__full{margin:0;color:var(--ink-2);font-size:.9375rem;line-height:1.4}',
    '.hub__pages{font-size:.75rem;color:var(--muted);margin-top:6px}',
    '.hub__mastery{display:flex;gap:16px;align-items:center;margin-bottom:14px}',
    '.hub__ring{position:relative;width:88px;height:88px;flex:0 0 88px}',
    '.hub__ring svg{display:block}',
    '.hub__ring-label{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1}',
    '.hub__ring-label b{font:700 1.375rem/1 var(--font-display);font-variant-numeric:tabular-nums}',
    '.hub__ring-label span{font-size:.75rem;color:var(--muted);margin-top:3px}',
    '.hub__mastery-txt{flex:1;min-width:0;font-size:.875rem;color:var(--muted)}',
    '.hub__mastery-txt b{color:var(--ink)}',
    '.hub__ctas{display:grid;gap:8px;margin-bottom:16px}',
    '.hub__ctas .btn .ico{display:inline-flex;margin-right:8px}',
    '.hub__grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px}',
    '.hub__sec{display:flex;flex-direction:column;gap:6px;text-decoration:none;color:inherit;background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1);padding:14px;min-height:96px}',
    '.hub__sec:active{background:var(--surface-2)}',
    '.hub__sec.is-empty{opacity:.55}',
    '.hub__sec-ico{color:var(--accent);width:24px;height:24px}',
    '.hub__sec-ico svg{width:24px;height:24px}',
    '.hub__sec-title{font:700 .9375rem/1.2 var(--font-display)}',
    '.hub__sec-count{font-size:.75rem;color:var(--muted)}',
    '.hub__sec .bar{height:4px;margin-top:auto}',
    '.hub__h2{font:700 1.125rem/1.3 var(--font-display);margin:0 0 8px}',
    '.hub__block{margin-bottom:20px}',
    '.hub__sdd{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:0}',
    '.hub__sdd li{background:var(--surface-2);border-radius:999px;padding:6px 12px;font-size:.875rem}',
    '.hub__sdd li b{font:500 .75rem var(--font-mono);color:var(--muted);margin-right:6px}',
    '.hub__obj{width:100%;border-collapse:collapse;font-size:.875rem}',
    '.hub__obj th{text-align:left;font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:500;padding:6px 6px;border-bottom:1px solid var(--line)}',
    '.hub__obj td{padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}',
    '.hub__obj td.hub__obj-rank{width:36px}',
    '.hub__obj td.hub__obj-dot{width:22px}',
    '.hub__obj-rub{display:block;font-size:.75rem;color:var(--muted);margin-bottom:2px}',
    '.hub__dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--surface-3);margin-top:5px}',
    '.hub__dot.is-ok{background:var(--ok)}.hub__dot.is-warn{background:var(--warn)}.hub__dot.is-bad{background:var(--bad)}',
    '.hub__legend{display:flex;gap:12px;flex-wrap:wrap;font-size:.75rem;color:var(--muted);margin-top:8px}',
    '.hub__legend span{display:inline-flex;align-items:center;gap:5px}',
    '.hub__notes{width:100%;min-height:120px;border:1px solid var(--line);border-radius:var(--r-s);background:var(--surface);color:var(--ink);padding:10px 12px;font:1rem/1.5 var(--font-body);resize:vertical}',
    '.hub__notes:focus{outline:2px solid var(--blue);outline-offset:2px}',
    '.hub__notes-foot{display:flex;justify-content:space-between;font-size:.75rem;color:var(--muted);margin-top:6px}',
    '.hub__skel{display:grid;gap:8px}',
    '.hub__skel span{display:block;height:14px;border-radius:6px;background:var(--surface-2);animation:hub-pulse 1.2s ease-in-out infinite}',
    '@keyframes hub-pulse{0%,100%{opacity:.6}50%{opacity:1}}',
    '.hub__err{background:var(--bad-soft);color:var(--ink);border-radius:var(--r-m);padding:14px;display:grid;gap:10px}',
    '.hub__err-msg{margin:0}',
    '.hub__soon{margin:10px 0 0}',
    '.hub__filter{margin-bottom:8px}',
    '.hub__sec-note{font-size:.75rem;color:var(--muted);margin-top:auto}',
    /* fiche flash : première entrée du hub */
    '.hub__ff{display:flex;align-items:center;gap:14px;margin-bottom:16px;padding:16px;min-height:88px;border-radius:var(--r-m);background:var(--accent-soft);box-shadow:var(--shadow-2);color:inherit;text-decoration:none}',
    'a.hub__ff:hover{text-decoration:none}',
    '.hub__ff:active{filter:brightness(.97)}',
    '.hub__ff-ico{flex:none;display:grid;place-items:center;width:48px;height:48px;border-radius:14px;background:var(--accent);color:var(--accent-ink)}',
    '.hub__ff-ico svg{width:26px;height:26px;display:block}',
    '.hub__ff-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px}',
    '.hub__ff-title{font:700 1.125rem/1.25 var(--font-display);color:var(--ink);text-wrap:balance}',
    '.hub__ff-sub{font-size:.875rem;line-height:1.35;color:var(--ink-2)}',
    '.hub__ff-score{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:2px;font:700 1.375rem/1 var(--font-display);font-variant-numeric:tabular-nums}',
    '.hub__ff-score small{font:600 .6875rem/1 var(--font-body);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}',
    '.hub__ff-score.is-ok{color:var(--ok)}.hub__ff-score.is-warn{color:var(--warn)}',
    '.hub__ff-chev{flex:none;color:var(--accent)}',
    '.hub__ff-chev svg{width:22px;height:22px;display:block}',
    '.hub__ff.is-soon{background:var(--surface);box-shadow:var(--shadow-1)}',
    '.hub__ff.is-soon .hub__ff-ico{background:var(--surface-2);color:var(--muted)}',
    '.hub__ff.is-soon .hub__ff-chev{color:var(--muted)}',
    /* niveau de l'item */
    '.hub__lvl{margin-bottom:16px}',
    '.hub__lvl-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
    '.hub__lvl-head .hub__h2{margin:0}',
    '.hub__lvl-hint{margin:2px 0 14px;font-size:.8125rem;color:var(--muted)}',
    '.hub__steps{list-style:none;margin:0 0 14px;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}',
    '.hub__step{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0;text-align:center}',
    '.hub__step+.hub__step::before{content:"";position:absolute;top:15px;left:calc(-50% + 22px);right:calc(50% + 22px);height:2px;border-radius:2px;background:var(--line)}',
    '.hub__step.is-done+.hub__step::before{background:var(--ok)}',
    '.hub__step-dot{display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:var(--surface-2);color:var(--muted);font:700 .875rem/1 var(--font-display)}',
    '.hub__step-dot svg{width:16px;height:16px;display:block}',
    '.hub__step.is-done .hub__step-dot{background:var(--ok-soft);color:var(--ok)}',
    '.hub__step.is-current .hub__step-dot{background:var(--accent);color:var(--accent-ink);box-shadow:0 0 0 4px var(--accent-soft)}',
    '.hub__step-lab{max-width:100%;font-size:.8125rem;font-weight:500;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.hub__step.is-done .hub__step-lab{color:var(--ink-2)}',
    '.hub__step.is-current .hub__step-lab{color:var(--ink);font-weight:700}',
    '.hub__lvl-bar{display:grid;gap:6px}',
    '.hub__lvl-bar-top{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:.875rem;color:var(--ink-2)}',
    '.hub__lvl-bar-top b{color:var(--ink);font-variant-numeric:tabular-nums}',
    '.hub__lvl-next{margin:12px 0 0;font-size:.9375rem}',
    '.hub__lvl-mode{margin:10px 0 12px;font-size:.9375rem;color:var(--ink-2)}',
    '.hub__lvl-btns{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px}',
    '.btn.hub__lvl-reset{color:var(--muted);font-weight:500}',
    '.hub__lvl-paused{display:flex;align-items:center;gap:6px;margin:12px 0 0;font-size:.8125rem;color:var(--muted)}',
    '.hub__lvl-paused svg{width:16px;height:16px;display:block}',
    '@media (min-width:720px){.hub__grid{grid-template-columns:repeat(3,1fr)}.items__group{grid-template-columns:1fr 1fr}}',
    '@media (min-width:1000px){.hub__grid{grid-template-columns:repeat(4,1fr)}}',
    '@media (prefers-reduced-motion:reduce){.hub__skel span{animation:none}}'
  ].join('\n');

  function ensureStyles() {
    if (document.getElementById('items-view-css')) return;
    const s = document.createElement('style');
    s.id = 'items-view-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------- Liste des items ---------- */

  function itemRow(it, due) {
    const m = mastery(it.num);
    const soon = it.available === false;
    const c = it.counts || {};
    return h('a', { class: 'items__row' + (soon ? ' is-soon' : ''), href: '#/item/' + it.num, 'aria-label': 'Item ' + it.num + ' ' + it.title },
      h('div', { class: 'items__num' }, h('b', {}, String(it.num)), 'item'),
      h('div', { class: 'items__body' },
        h('div', { class: 'items__head' },
          h('span', { class: 'items__short' }, it.short),
          soon ? h('span', { class: 'pill pill--info' }, 'bientôt') : null,
          !soon && due ? h('span', { class: 'pill pill--warn items__due' }, due + ' à revoir') : null),
        h('p', { class: 'items__title' }, it.title),
        h('div', { class: 'items__counts' }, soon ? 'Contenu en préparation' : countsSummary(c)),
        soon ? null : h('div', { class: 'items__bars' },
          h('div', { class: 'items__bar' }, h('span', { class: 'pill pill--A' }, 'A'), bar(m.A, 'bar--A'), h('span', {}, pct(m.A) + ' %')),
          h('div', { class: 'items__bar' }, h('span', { class: 'pill pill--B' }, 'B'), bar(m.B, 'bar--B'), h('span', {}, pct(m.B) + ' %')))));
  }

  function buildList() {
    const items = allItems();
    const due = dueByItem();
    const page = h('div', { class: 'page items' });
    page.appendChild(h('h1', { class: 'items__h1' }, 'Les 22 items'));
    const available = items.filter(function (i) { return i.available !== false; }).length;
    page.appendChild(h('p', { class: 'items__lead' }, items.length
      ? (available === items.length ? 'Tout le Collège de cardiologie, dans l’ordre du livre.' : available + ' item' + (available > 1 ? 's' : '') + ' disponible' + (available > 1 ? 's' : '') + ' sur ' + items.length + '. Les autres arrivent.')
      : 'Le catalogue n’est pas encore chargé. Recharge la page si cela persiste.'));
    let currentSection = null, group = null;
    items.forEach(function (it) {
      if (it.section !== currentSection) {
        currentSection = it.section;
        page.appendChild(h('div', { class: 'items__eyebrow' }, h('b', {}, 'Partie ' + it.section), it.sectionTitle || ''));
        group = h('div', { class: 'items__group' });
        page.appendChild(group);
      }
      group.appendChild(itemRow(it, due[str(it.num)] || 0));
    });
    return page;
  }

  /* ---------- Hub d'un item ---------- */

  const SECTION_CARDS = [
    { key: 'cours', title: 'Fiche de cours', ico: 'book', route: 'cours', counts: ['flash'], countLabel: function (c) { return (c.flash || 0) + ' points clés'; }, always: true },
    { key: 'qcm', title: 'QCM & QROC', ico: 'list', route: 'qcm', counts: ['qcm', 'qroc', 'open', 'kfp', 'tcs'], countLabel: function (c) {
      const p = [];
      if (c.qcm) p.push(c.qcm + ' QCM');
      if (c.qroc) p.push(c.qroc + ' QROC');
      if (c.kfp || c.tcs) p.push((c.kfp || 0) + (c.tcs || 0) + ' EDN');
      return p.join(' · ') || 'aucune question';
    } },
    { key: 'parcours', title: 'Prise en charge A → Z', ico: 'case', route: 'parcours', counts: ['parcours'], noMastery: true, countLabel: function (c) { return (c.parcours || 0) + ' parcours'; } },
    { key: 'examens', title: 'Gestes, imagerie & analyses', ico: 'search', route: 'examens', counts: ['examens'], noMastery: true, countLabel: function (c) { return (c.examens || 0) + ' fiche' + (c.examens > 1 ? 's' : ''); } },
    { key: 'semio', title: 'Sémiologie', ico: 'eye', route: 'semio', counts: ['semio'], noMastery: true, countLabel: function (c) { return (c.semio || 0) + ' fiche' + (c.semio > 1 ? 's' : ''); } },
    { key: 'criteres', title: 'Critères diagnostiques', ico: 'target', route: 'criteres', counts: ['criteres'], noMastery: true, countLabel: function (c) { return (c.criteres || 0) + ' fiche' + (c.criteres > 1 ? 's' : ''); } },
    { key: 'chiffres', title: 'Données chiffrées', ico: 'chart', route: 'chiffres', counts: ['chiffres'], noMastery: true, countLabel: function (c) { return (c.chiffres || 0) + ' donnée' + (c.chiffres > 1 ? 's' : ''); } },
    { key: 'physio', title: 'Physiopathologie', ico: 'layers', route: 'physio', counts: ['physio'], noMastery: true, countLabel: function (c) { return (c.physio || 0) + ' fiche' + (c.physio > 1 ? 's' : ''); } },
    // Support de cours : jamais proposé en séance, donc ni maîtrise ni barre de progression.
    { key: 'arbres', title: 'Arbres décisionnels', ico: 'tree', route: 'arbres', counts: ['trees'], course: true, countLabel: function (c) { return (c.trees || 0) + ' arbre' + (c.trees > 1 ? 's' : ''); }, note: 'La démarche du Collège, à parcourir' },
    { key: 'traitements', title: 'Traitements', ico: 'pill', route: 'traitements', counts: ['tx'], countLabel: function (c) { return (c.tx || 0) + ' classe' + (c.tx > 1 ? 's' : ''); } },
    { key: 'cas', title: 'Cas cliniques', ico: 'case', route: 'cas', counts: ['cases'], countLabel: function (c) { return (c.cases || 0) + ' dossier' + (c.cases > 1 ? 's' : ''); } },
    { key: 'mnemos', title: 'Mnémos & flashcards', ico: 'flash', route: 'mnemos', counts: ['flash'], countLabel: function (c) { return (c.flash || 0) + ' carte' + (c.flash > 1 ? 's' : ''); } },
    { key: 'ecg', title: 'ECG', ico: 'ecg', route: 'ecg', counts: ['ecg'], countLabel: function (c) { return (c.ecg || 0) + ' tracé' + (c.ecg > 1 ? 's' : ''); }, onlyIf: 'ecg' },
    { key: 'echo', title: 'Écho', ico: 'echo', route: 'echo', counts: ['echo'], countLabel: function (c) { return (c.echo || 0) + ' vue' + (c.echo > 1 ? 's' : ''); }, onlyIf: 'echo' }
  ];

  function sectionCard(it, def) {
    const c = it.counts || {};
    const total = def.counts.reduce(function (n, k) { return n + (Number(c[k]) || 0); }, 0);
    const km = (def.course || def.noMastery) ? null : kindMastery(it.num, def.counts, c);
    const empty = !total && !def.always;
    return h('a', { class: 'hub__sec' + (empty ? ' is-empty' : ''), href: '#/item/' + it.num + '/' + def.route },
      h('div', { class: 'hub__sec-ico', html: icon(def.ico) }),
      h('div', { class: 'hub__sec-title' }, def.title),
      h('div', { class: 'hub__sec-count' }, def.countLabel(c) + (km && km.seen ? ' · ' + pct(km.ratio) + ' %' : '')),
      km ? bar(km.ratio) : (def.note ? h('div', { class: 'hub__sec-note' }, def.note) : null));
  }

  /* ---------- Fiche flash (première entrée) et niveau de l'item ---------- */

  function toast(msg, tone) {
    const sh = CARDIO.shell;
    if (sh && typeof sh.toast === 'function') { try { sh.toast(msg, { tone: tone || 'ok' }); } catch (e) { /* ignore */ } }
  }

  function whenText(at) {
    const u = util();
    if (!at || typeof u.fmtDate !== 'function') return '';
    return safe(function () { return u.fmtDate(at, { relative: true }); }, '');
  }

  /* Dernier test de la fiche flash (state.itemStats[num].flash) ou null s'il n'y en a pas encore. */
  function flashStat(num) {
    const is = (state().itemStats || {})[str(num)];
    const f = is && is.flash;
    if (!f || typeof f !== 'object' || !(Number(f.runs) > 0)) return null;
    return { at: Number(f.at) || 0, score: Math.max(0, Math.min(1, Number(f.score) || 0)), runs: Math.round(Number(f.runs)) };
  }

  function flashEntry(it) {
    const has = !!(it.counts && Number(it.counts.ff) > 0);
    const f = has ? flashStat(it.num) : null;
    const mastered = f && f.score >= 0.8;
    let sub;
    if (!has) sub = 'En préparation pour cet item : la fiche complète est déjà là.';
    else if (f) {
      let when = whenText(f.at);
      if (/^\d/.test(when)) when = 'le ' + when;                  // « le 2 oct. » ; « aujourd'hui », « il y a 3 j » tels quels
      sub = mastered ? 'Maîtrisée' + (when ? ' · testée ' + when : '') : 'Dernier test' + (when ? ' ' + when : '') + ' · vise 80 %';
    } else sub = 'Les 7 blocs à connaître avant tout le reste. Commence par là.';
    return h('a', { class: 'hub__ff' + (has ? '' : ' is-soon'), href: '#/item/' + it.num + '/flash' },
      h('span', { class: 'hub__ff-ico', 'aria-hidden': 'true', html: icon('flash') }),
      h('span', { class: 'hub__ff-main' },
        h('span', { class: 'hub__ff-title' }, 'Fiche flash — l’essentiel en 2 min'),
        h('span', { class: 'hub__ff-sub' }, sub)),
      f ? h('span', { class: 'hub__ff-score ' + (mastered ? 'is-ok' : 'is-warn'), title: 'Score du dernier test' }, h('small', {}, 'test'), pct(f.score) + ' %') : null,
      !has ? h('span', { class: 'pill pill--outline' }, 'bientôt') : null,
      h('span', { class: 'hub__ff-chev', 'aria-hidden': 'true', html: icon('chevron-right') }));
  }

  function setTier(num, tier, labels) {
    const s = store();
    if (!s || typeof s.setItemTier !== 'function') { toast('Niveau indisponible pour le moment.', 'bad'); return; }
    const t = safe(function () { return s.setItemTier(num, tier); }, null);
    if (t === null || t === undefined) return;
    toast(t === 1 ? 'Retour au niveau Essentiel sur cet item.' : 'Niveau « ' + labels[t] + ' » débloqué sur cet item.', 'ok');
  }

  function levelBar(label, acquired, total) {
    return h('div', { class: 'hub__lvl-bar' },
      h('div', { class: 'hub__lvl-bar-top' },
        h('span', {}, label),
        total ? h('span', {}, h('b', {}, acquired + ' / ' + total), total > 1 ? ' cartes acquises' : ' carte acquise') : h('span', {}, 'aucune carte à ce niveau')),
      bar(total ? acquired / total : 0, 'bar--ok'));
  }

  function stepper(tier, labels) {
    return h('ol', { class: 'hub__steps', 'aria-label': 'Niveaux de l’item' }, [1, 2, 3].map(function (t) {
      const st = t < tier ? 'done' : t === tier ? 'current' : 'locked';
      const dot = h('span', { class: 'hub__step-dot', 'aria-hidden': 'true' });
      if (st === 'current') dot.textContent = String(t); else dot.innerHTML = icon(st === 'done' ? 'check' : 'lock');
      return h('li', { class: 'hub__step is-' + st, 'aria-current': st === 'current' ? 'step' : null },
        dot,
        h('span', { class: 'hub__step-lab' }, labels[t]),
        h('span', { class: 'sr-only' }, st === 'done' ? ' (débloqué)' : st === 'current' ? ' (niveau actuel)' : ' (pas encore débloqué)'));
    }));
  }

  /* « Ton niveau sur cet item » : niveaux progressifs du store (1 Essentiel, 2 Approfondi, 3 Expert). */
  function levelPanel(it) {
    const s = store();
    if (!s || typeof s.tierProgress !== 'function') return null;
    const num = str(it.num);
    const tp = safe(function () { return s.tierProgress(num); }, null);
    if (!tp || !Array.isArray(tp.tiers) || tp.tiers.length < 3) return null;
    const labels = s.TIER_LABELS || { 1: 'Essentiel', 2: 'Approfondi', 3: 'Expert' };
    const mode = tp.mode || 'progressif';
    const tier = Math.max(1, Math.min(3, Number(tp.tier) || 1));
    const cur = tp.tiers[tier - 1] || { acquired: 0, total: 0 };
    const pausedInfo = typeof s.pausedStats === 'function' ? safe(function () { return s.pausedStats(num); }, null) : null;
    const paused = pausedInfo ? Number(pausedInfo.paused) || 0 : 0;
    const body = [];

    if (mode === 'progressif') {
      body.push(h('p', { class: 'hub__lvl-hint' }, 'Tes séances ne te proposent que les niveaux débloqués.'));
      body.push(stepper(tier, labels));
      body.push(levelBar(labels[tier], cur.acquired, cur.total));
      let next;
      if (tier >= 3) next = 'Tout est débloqué : rang B, KFP et TCS compris.';
      else if (!cur.total) next = 'Aucune carte à ce niveau : « ' + labels[tier + 1] + ' » se débloque à ta prochaine carte de cet item.';
      else if (tp.toNext > 0) next = ['Encore ', h('b', {}, String(tp.toNext)), ' carte' + (tp.toNext > 1 ? 's' : '') + ' à acquérir pour débloquer ', h('b', {}, labels[tier + 1])];
      else next = 'Seuil atteint : « ' + labels[tier + 1] + ' » se débloque à ta prochaine carte de cet item.';
      body.push(h('p', { class: 'hub__lvl-next' }, next));
      const btns = [];
      if (tier < 3) btns.push(h('button', { type: 'button', class: 'btn btn--secondary btn--sm', on: { click: function () { setTier(num, tier + 1, labels); } } }, 'Passer au niveau suivant'));
      if (tier > 1) btns.push(h('button', { type: 'button', class: 'btn btn--ghost btn--sm hub__lvl-reset', on: { click: function () { setTier(num, 1, labels); } } }, 'Revenir à l’essentiel'));
      if (btns.length) body.push(h('div', { class: 'hub__lvl-btns' }, btns));
    } else {
      body.push(h('p', { class: 'hub__lvl-mode' },
        mode === 'essentiel'
          ? ['Mode ', h('b', {}, '« L’essentiel seulement »'), ' : tes séances ne proposent que le niveau Essentiel (rang A, questions faciles). ']
          : ['Mode ', h('b', {}, '« Tout le programme »'), ' : rang A et B, KFP et TCS, comme le jour de l’EDN. '],
        h('a', { href: '#/settings' }, 'Changer de mode')));
      if (mode === 'essentiel') body.push(levelBar(labels[1], tp.tiers[0].acquired, tp.tiers[0].total));
      else {
        const acq = tp.tiers.reduce(function (n, t) { return n + (Number(t.acquired) || 0); }, 0);
        const tot = tp.tiers.reduce(function (n, t) { return n + (Number(t.total) || 0); }, 0);
        body.push(levelBar('Tout le programme', acq, tot));
      }
    }
    if (paused > 0) {
      body.push(h('p', { class: 'hub__lvl-paused' }, h('span', { 'aria-hidden': 'true', html: icon('pause') }),
        paused > 1 ? paused + ' cartes de niveau supérieur sont en pause' : '1 carte de niveau supérieur est en pause'));
    }
    return h('section', { class: 'card hub__lvl', 'aria-labelledby': 'hub-lvl-' + num },
      h('div', { class: 'hub__lvl-head' },
        h('h2', { class: 'hub__h2', id: 'hub-lvl-' + num }, 'Ton niveau sur cet item'),
        mode === 'progressif' ? h('span', { class: 'pill pill--accent' }, labels[tier]) : null),
      body);
  }

  function objectiveDot(num, objId) {
    const reg = registry();
    // Les arbres sont un support de cours, pas des cartes à réviser : ils ne comptent pas dans la maîtrise.
    const list = reg && typeof reg.cardsForObjective === 'function' ? safe(function () { return reg.cardsForObjective(num, objId); }, []) : [];
    const cards = (Array.isArray(list) ? list : []).filter(function (c) { return c && c.kind !== 'tree'; });
    const cs = state().cards || {};
    let sum = 0, seen = 0;
    cards.forEach(function (c) { const sc = cardScore(cs[c.id]); if (sc !== null) { seen++; sum += sc; } });
    let cls = '', label = cards.length ? 'Pas encore révisé' : 'Aucune carte rattachée';
    if (seen) {
      const r = sum / seen;
      cls = r >= 0.8 ? ' is-ok' : r >= 0.5 ? ' is-warn' : ' is-bad';
      label = pct(r) + ' % sur ' + seen + ' carte' + (seen > 1 ? 's' : '');
    }
    return h('span', { class: 'hub__dot' + cls, title: label, 'aria-label': label });
  }

  function objectivesTable(num, objectives) {
    if (!objectives.length) return h('p', { class: 'items__lead' }, 'Aucun objectif listé pour cet item.');
    const rows = objectives.map(function (o) {
      return h('tr', {},
        h('td', { class: 'hub__obj-dot' }, objectiveDot(num, o.id)),
        h('td', { class: 'hub__obj-rank' }, h('span', { class: 'pill pill--' + (o.rank === 'B' ? 'B' : 'A') }, o.rank || 'A')),
        h('td', {}, h('span', { class: 'hub__obj-rub' }, o.rubric || ''), o.title || ''));
    });
    const nA = objectives.filter(function (o) { return o.rank !== 'B'; }).length;
    return h('div', {},
      h('table', { class: 'hub__obj' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Rang'), h('th', {}, 'Rubrique et intitulé'))),
        h('tbody', {}, rows)),
      h('div', { class: 'hub__legend' },
        h('span', {}, objectives.length + ' objectifs · ' + nA + ' A · ' + (objectives.length - nA) + ' B'),
        h('span', {}, h('i', { class: 'hub__dot is-ok' }), 'acquis'),
        h('span', {}, h('i', { class: 'hub__dot is-warn' }), 'fragile'),
        h('span', {}, h('i', { class: 'hub__dot is-bad' }), 'à revoir'),
        h('span', {}, h('i', { class: 'hub__dot' }), 'non vu')));
  }

  function loadObjectives(num, host) {
    const reg = registry();
    if (!reg || typeof reg.load !== 'function') {
      host.replaceChildren(h('p', { class: 'items__lead' }, 'Le registre de contenu n’est pas disponible.'));
      return;
    }
    const skel = h('div', { class: 'hub__skel', 'aria-busy': 'true' }, h('span'), h('span'), h('span'), h('span'));
    host.replaceChildren(skel);
    reg.load(num).then(function (content) {
      if (!host.isConnected) return;
      host.replaceChildren(objectivesTable(num, (content && content.objectives) || []));
    }, function (err) {
      if (!host.isConnected) return;
      const msg = err && err.message ? err.message : 'Impossible de charger les objectifs.';
      host.replaceChildren(h('div', { class: 'hub__err' },
        h('p', { class: 'hub__err-msg' }, msg),
        h('button', { class: 'btn btn--secondary btn--sm', type: 'button', on: { click: function () { loadObjectives(num, host); } } }, 'Réessayer')));
    });
  }

  function notesBlock(num) {
    const s = store();
    const initial = str((state().notes || {})[num] || '');
    let timer = null;
    const status = h('span', {}, initial ? 'Enregistrée' : '');
    const ta = h('textarea', { class: 'hub__notes', placeholder: 'Tes notes sur cet item : ce que tu confonds, ce que tu veux retenir…', 'aria-label': 'Notes sur l’item ' + num, rows: '5' });
    ta.value = initial;
    function persist() {
      const val = ta.value;
      if (!s) { status.textContent = 'Sauvegarde indisponible'; return; }
      try {
        if (typeof s.update === 'function') {
          s.update(function (st) { st.notes = st.notes || {}; if (val.trim()) st.notes[num] = val; else delete st.notes[num]; });
        } else if (s.state) {
          s.state.notes = s.state.notes || {};
          if (val.trim()) s.state.notes[num] = val; else delete s.state.notes[num];
          if (typeof s.save === 'function') s.save();
        }
        status.textContent = 'Enregistrée';
      } catch (e) { console.warn('[items] notes', e); status.textContent = 'Erreur de sauvegarde'; }
    }
    ta.addEventListener('input', function () {
      status.textContent = 'Enregistrement…';
      clearTimeout(timer);
      timer = setTimeout(persist, 400);
    });
    ta.addEventListener('blur', function () { clearTimeout(timer); persist(); });
    return h('section', { class: 'hub__block' },
      h('h2', { class: 'hub__h2' }, 'Mes notes'),
      ta,
      h('div', { class: 'hub__notes-foot' }, h('span', {}, 'Sauvegardées avec ta progression'), status));
  }

  function markVisited(num) {
    const s = store();
    if (!s) return;
    try {
      if (typeof s.update === 'function') {
        s.update(function (st) { st.itemStats = st.itemStats || {}; st.itemStats[num] = st.itemStats[num] || { sessions: 0 }; st.itemStats[num].lastVisited = Date.now(); });
      }
    } catch (e) { /* non bloquant */ }
  }

  function buildHub(num) {
    const it = findItem(num);
    const page = h('div', { class: 'page hub' });
    if (!it) {
      page.appendChild(h('div', { class: 'card' },
        h('h1', { class: 'hub__h1' }, 'Item introuvable'),
        h('p', { class: 'items__lead' }, 'L’item ' + num + ' ne fait pas partie du programme de cardiologie.'),
        h('a', { class: 'btn btn--secondary', href: '#/items' }, 'Voir tous les items')));
      return page;
    }
    const m = mastery(it.num);
    const due = dueByItem()[str(it.num)] || 0;
    const soon = it.available === false;
    const c = it.counts || {};

    page.appendChild(h('header', { class: 'hub__header' },
      h('div', { class: 'hub__kicker' }, 'Item ' + it.num, h('span', {}, '·'), 'Partie ' + it.section + (it.chapter ? ' · chapitre ' + it.chapter : '')),
      h('h1', { class: 'hub__h1' }, it.short),
      h('p', { class: 'hub__full' }, it.title),
      it.pages ? h('div', { class: 'hub__pages' }, 'Pages ' + it.pages + ' du Collège') : null));

    if (soon) {
      page.appendChild(h('div', { class: 'card' },
        h('span', { class: 'pill pill--info' }, 'bientôt'),
        h('p', { class: 'items__lead hub__soon' }, 'Le contenu de cet item est en préparation. Reviens un peu plus tard.')));
      return page;
    }

    page.appendChild(flashEntry(it));

    page.appendChild(h('div', { class: 'card hub__mastery' },
      h('div', { class: 'hub__ring', html: ringSvg(m.A, 88, 8, 'var(--rankA)') }, h('div', { class: 'hub__ring-label' }, h('b', {}, pct(m.A) + '%'), h('span', {}, 'rang A'))),
      h('div', { class: 'hub__ring', html: ringSvg(m.B, 88, 8, 'var(--blue)') }, h('div', { class: 'hub__ring-label' }, h('b', {}, pct(m.B) + '%'), h('span', {}, 'rang B'))),
      h('div', { class: 'hub__mastery-txt' },
        h('div', {}, h('b', {}, m.seen || 0), ' carte' + (m.seen > 1 ? 's' : '') + ' vue' + (m.seen > 1 ? 's' : '') + (m.total ? ' sur ' + m.total : '')),
        h('div', {}, due ? [h('b', {}, String(due)), ' à revoir maintenant'] : 'Rien en attente'))));

    page.appendChild(h('div', { class: 'hub__ctas' },
      h('a', { class: 'btn btn--primary btn--block', href: '#/review?mode=item&item=' + it.num + '&autostart=1' }, iconEl('play'), 'Réviser cet item'),
      h('a', { class: 'btn btn--secondary btn--block', href: '#/item/' + it.num + '/cours' }, iconEl('book'), 'Fiche complète')));

    const lvl = levelPanel(it);
    if (lvl) page.appendChild(lvl);

    page.appendChild(h('div', { class: 'hub__grid' }, SECTION_CARDS.filter(function (d) {
      return !d.onlyIf || Number(c[d.onlyIf]) > 0;
    }).map(function (d) { return sectionCard(it, d); })));

    const sdd = Array.isArray(it.sdd) ? it.sdd : [];
    if (sdd.length) {
      page.appendChild(h('section', { class: 'hub__block' },
        h('h2', { class: 'hub__h2' }, 'Situations de départ'),
        h('ul', { class: 'hub__sdd' }, sdd.map(function (s) {
          return h('li', {}, h('b', {}, 'SDD ' + s.num), s.label || '');
        }))));
    }

    const objHost = h('div', { class: 'hub__obj-host' });
    page.appendChild(h('section', { class: 'hub__block' },
      h('h2', { class: 'hub__h2' }, 'Objectifs de connaissance'),
      objHost));
    loadObjectives(str(it.num), objHost);

    page.appendChild(notesBlock(str(it.num)));
    return page;
  }

  /* ---------- Exports ---------- */

  function bindRefresh(root, rebuild) {
    const u = util();
    if (typeof u.on !== 'function') return;
    let scheduled = false;
    const handler = function () {
      if (!root.isConnected) {
        if (root.dataset.mounted === '1' && typeof u.off === 'function') u.off('store:change', handler);
        return;
      }
      root.dataset.mounted = '1';
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        if (!root.isConnected) return;
        // Ne pas écraser une zone de notes en cours d'édition.
        if (document.activeElement && root.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') return;
        try { root.replaceChild(rebuild(), root.firstChild); } catch (e) { console.warn('[items] refresh', e); }
      });
    };
    u.on('store:change', handler);
    requestAnimationFrame(function () { if (root.isConnected) root.dataset.mounted = '1'; });
    setTimeout(function () { if (!root.isConnected && typeof u.off === 'function') u.off('store:change', handler); }, 3000);
  }

  function renderHub(params) {
    ensureStyles();
    const num = str((params && (params.num || params.item)) || '');
    const it = findItem(num);
    const root = h('div', { class: 'view-hub' });
    root.dataset.title = it ? 'Item ' + it.num + ' · ' + it.short : 'Item';
    root.appendChild(buildHub(num));
    // Une seule fois par affichage : buildHub sert aussi au rafraîchissement sur « store:change » et
    // une écriture dans le store à chaque reconstruction relancerait la reconstruction en boucle.
    if (it && it.available !== false) markVisited(str(it.num));
    bindRefresh(root, function () { return buildHub(num); });
    return root;
  }

  function render(params) {
    if (params && (params.num || params.item)) return renderHub(params);
    ensureStyles();
    const root = h('div', { class: 'view-items' });
    root.dataset.title = 'Items';
    root.appendChild(buildList());
    bindRefresh(root, buildList);
    return root;
  }

  CARDIO.views.items = { render: render, renderHub: renderHub, kindMastery: kindMastery };
})();
