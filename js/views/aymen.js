/* CardioR2C — views/aymen.js
 * Rubrique « Aymen » : planning automatique jusqu'aux partiels (micro le 3 déc., puis pneumo + dermato + cardio).
 * Chaque jour est calculé tout seul :
 *   1. Flashcards du jour (révision espacée de tout ce qui est déjà vu)
 *   2. Rappels J1 / J3 / J7 des cours appris (récitation de mémoire, puis vérification)
 *   3. Nouveaux cours : file triée par fréquence aux annales SU (CARDIO.annFreq), remplie jusqu'à la capacité du jour
 *      (en blocs de 25 min) ; ce qui n'est pas coché revient automatiquement le lendemain.
 *   4. Annales en conditions d'examen (2 par jour)
 *   5. Soir : correction des erreurs + entretien des autres matières
 * Les jours futurs sont simulés (on suppose le planning suivi) pour pouvoir les prévisualiser.
 * Données : localStorage « cardio.aymen » = {learned:{key:date|'old'|null}, rev:{'key@off':date}, ann:{id:date},
 *   done:{'date|bloc':1}, cap:'leger'|'normal'|'intense', ex1:'YYYY-MM-DD', ex2:'YYYY-MM-DD'} (synchronisé via lsync).
 * Clés : « m:<id> » (fiche viro / bactério / parasito), « i:<num> » (item). Routes : #/aymen (?d=YYYY-MM-DD, ?tab=cours|regl). */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  CARDIO.views = CARDIO.views || {};
  const LS = 'cardio.aymen';
  const START = '2026-11-27';
  const OFFS = [1, 3, 7];
  const CAPS = { leger: { label: 'Léger', n: 5, desc: '5 blocs de 25 min de nouveau par jour' }, normal: { label: 'Normal', n: 7, desc: '7 blocs de 25 min de nouveau par jour' }, intense: { label: 'Intense', n: 9, desc: '9 blocs de 25 min de nouveau par jour' } };

  /* ce qui est déjà vu au départ (27/11) : rappels antérieurs au 27/11 considérés comme faits */
  const SEED = {
    'm:bact-diagnostic': '2026-11-24', 'm:bact-urinaires': '2026-11-24', 'm:bact-meningites': '2026-11-26', 'm:bact-respiratoires': '2026-11-26',
    'm:viro-hepatites-a-e': '2026-11-27', 'm:viro-hepatite-b-d': '2026-11-27', 'm:viro-hepatite-c': '2026-11-27',
    'm:bact-antibiotiques': '2026-11-27', 'm:bact-anatomie': '2026-11-27', 'm:bact-genetique': '2026-11-27', 'm:bact-familles': '2026-11-27',
    'm:viro-vih-structure': '2026-11-23', 'm:viro-vih-clinique': '2026-11-23', 'm:viro-rubeole-parvo': '2026-11-23', 'm:viro-arbo': '2026-11-23',
    'i:d187': 'old', 'i:d302': 'old', 'i:d350': 'old', 'i:d112': 'old', 'i:d168': 'old',
    'i:p209': 'old', 'i:p188': 'old', 'i:p154': 'old', 'i:p110': 'old', 'i:p159': 'old', 'i:p210': 'old'
  };
  const FIRST = ['m:viro-hepatites-a-e', 'm:viro-hepatite-b-d', 'm:viro-hepatite-c'];   // en cours : à finir d'abord
  const COST1 = { 'viro-hepatite-c': 1, 'viro-hpv': 1, 'viro-gea': 1, 'viro-respi-autres': 1, 'viro-enterovirus': 1, 'viro-rougeole': 1, 'viro-rage': 1, 'viro-htlv': 1, 'viro-mpox': 1, 'viro-structure': 1, 'bact-mots-cles': 1, 'bact-atypiques': 1, 'bact-flores': 1, 'bact-genetique': 1 };
  const ANN_MICRO = [['su-parasito-2022', 'a'], ['su-bacterio-2021', 'a'], ['su-parasito-2023', 'a'], ['su-viro-2025', 'h'], ['su-bacterio-2024', 'a'], ['su-parasito-2024-12', 'a'],
    ['su-viro-2024', 'h'], ['su-bacterio-2025', 'a'], ['su-viro-2023', 'h'], ['su-parasito-2025-11-14', 'a'], ['su-viro-2022', 'h'], ['su-parasito-2026-rangA', 'a'],
    ['su-bacterio-2021-ratt', 'a'], ['su-parasito-2024-11', 'a']];
  const ANN_PD = [['su-dermato-2025-26-s1', 'a'], ['su-pneumo-2025-26-s1', 'a'], ['su-dermato-2024-25-s1', 'a'], ['su-pneumo-2024-25-s1', 'a'], ['su-dermato-2023-24', 'a'],
    ['su-pneumo-2023-24', 'a'], ['su-dermato-2025-26-s2', 'a'], ['su-pneumo-2025-26-s2', 'a'], ['su-dermato-2022-23', 'a'], ['su-dermato-2024-25-s2', 'a'],
    ['su-pneumo-2024-25-ratt', 'a'], ['su-dermato-2024-25-ratt', 'a']];
  const ANN_C = [['su-cardio-2025-26-s1', 'a'], ['su-cardio-2025-26-s2', 'a'], ['su-cardio-2024-25-s1', 'a'], ['su-cardio-2023-24', 'a'], ['su-cardio-2024-25-ratt', 'a'], ['su-cardio-2022-23', 'a']];

  function util() { return CARDIO.util || {}; }
  function h() { return util().h.apply(null, arguments); }
  function str(x) { return x == null ? '' : String(x); }
  function st() { try { const o = JSON.parse(localStorage.getItem(LS) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function save(fn) { try { const o = st(); fn(o); o._at = Date.now(); localStorage.setItem(LS, JSON.stringify(o)); } catch (e) { /* ignore */ } }
  function sub(o, k) { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; return o[k]; }

  /* ---------- dates (locales) ---------- */
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parse(s) { const p = str(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function add(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
  function diff(a, b) { return Math.round((parse(b) - parse(a)) / 864e5); }
  function today() { return iso(new Date()); }
  const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  function longDate(s) { const d = parse(s); return JOURS[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()]; }
  function ex1() { return st().ex1 || '2026-12-03'; }
  function ex2() { return st().ex2 || '2026-12-17'; }

  /* ---------- catalogue ---------- */
  function microAll() {
    const r = CARDIO.registry || {};
    const out = [];
    [['viro', '🦠 Viro'], ['bacterio', '🧫 Bactério'], ['parasito', '🪱 Parasito']].forEach(function (p) {
      (Array.isArray(r[p[0]]) ? r[p[0]] : []).forEach(function (f) { if (f && f.id) out.push({ key: 'm:' + f.id, id: f.id, mat: p[0], tag: p[1], title: f.title }); });
    });
    return out;
  }
  function itemMeta(num) { try { const r = CARDIO.registry; return r && typeof r.item === 'function' ? r.item(num) : null; } catch (e) { return null; } }
  function itemsAll() {
    try { const r = CARDIO.registry; return (r && typeof r.items === 'function' ? r.items() || [] : []).filter(function (it) { return it && (it.spe === 'pneumo' || it.spe === 'dermato'); }); } catch (e) { return []; }
  }
  function freqMap() {
    const F = CARDIO.annFreq && CARDIO.annFreq.spe, m = {};
    if (!F) return m;
    Object.keys(F).forEach(function (k) { ((F[k] && F[k].top) || []).forEach(function (t) { const key = (/^(viro|bacterio|parasito)$/.test(k) ? 'm:' : 'i:') + t[0]; m[key] = Math.max(m[key] || 0, t[2]); }); });
    return m;
  }
  function info(key) {
    if (key.indexOf('m:') === 0) {
      const f = microAll().filter(function (x) { return x.key === key; })[0];
      if (!f) return null;
      return { key: key, title: f.title, tag: f.tag, mat: f.mat, cost: f.mat === 'bacterio' ? (/^bact-lz-/.test(f.id) && f.id !== 'bact-lz-mycobacterium-tuberculosis' ? 1 : (COST1[f.id] || 2)) : (COST1[f.id] || 2),
        href: '#/parasito/' + encodeURIComponent(f.id), fc: '#/fc?fiche=' + encodeURIComponent(f.id) + '&go=1&mode=all',
        qcm: CARDIO.views.qcmmicro && CARDIO.views.qcmmicro.count && CARDIO.views.qcmmicro.count(f.id) ? '#/qcm-micro/' + encodeURIComponent(f.id) : null };
    }
    const num = key.slice(2), it = itemMeta(num);
    if (!it) return null;
    return { key: key, title: (it.label || num) + ' · ' + (it.short || it.title), tag: it.spe === 'dermato' ? '🩺 Dermato' : it.spe === 'pneumo' ? '🫁 Pneumo' : '❤️ Cardio', mat: it.spe, cost: 2,
      href: '#/item/' + encodeURIComponent(num) + '/cours', fc: '#/fc?fiche=' + encodeURIComponent(num) + '&go=1&mode=all', qcm: '#/item/' + encodeURIComponent(num) + '/qcm' };
  }
  function queue(phase) {
    const fm = freqMap();
    let keys;
    if (phase === 1) keys = microAll().filter(function (f) { return f.mat !== 'parasito'; }).map(function (f) { return f.key; });
    else keys = itemsAll().map(function (it) { return 'i:' + it.num; });
    keys.sort(function (a, b) { return (fm[b] || 0) - (fm[a] || 0); });
    if (phase === 1) keys = FIRST.concat(keys.filter(function (k) { return FIRST.indexOf(k) < 0; }));
    return keys.map(function (k) { const x = info(k); if (x) x.pct = fm[k] || 0; return x; }).filter(Boolean);
  }

  /* ---------- état de départ (graines + choix de l'utilisateur) ---------- */
  /* « lu » ailleurs dans l'app → appris ici automatiquement (sauf choix manuel dans « Mes cours ») :
     - Fiches EDN marquées lues (cardio.ednfiches : {n: {c, at}}) → item pneumo / dermato / cardio du même numéro ;
     - fiches viro / bactério / parasito terminées par « À revoir » ou « Je savais » (cardio.parasito : {id: {ok, at}}).
     Lu avant le 27/11 → « déjà vu » ; sinon appris ce jour-là (les rappels J1/J3/J7 partent de cette date). */
  function readLS(k) { try { const o = JSON.parse(localStorage.getItem(k) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function autoRead() {
    const out = {}, put = function (key, at) {
      const d = at ? iso(new Date(Number(at))) : START;
      const v = d < START ? 'old' : d;
      if (!out[key] || (out[key] !== 'old' && (v === 'old' || v < out[key]))) out[key] = v;
    };
    const byLabel = {};
    try { const r = CARDIO.registry; (r && typeof r.items === 'function' ? r.items() || [] : []).forEach(function (it) { if (it && it.label) (byLabel[String(it.label)] = byLabel[String(it.label)] || []).push(it.num); }); } catch (e) { /* ignore */ }
    const ef = readLS('cardio.ednfiches');
    Object.keys(ef).forEach(function (n) { const e = ef[n]; if (e && Number(e.c) > 0) (byLabel[String(n)] || []).forEach(function (num) { put('i:' + num, e.at); }); });
    const pz = readLS('cardio.parasito');
    Object.keys(pz).forEach(function (id) { const e = pz[id]; if (e && typeof e.ok === 'boolean') put('m:' + id, e.at); });
    return out;
  }
  function baseState() {
    const s = st();
    const par = {};
    microAll().forEach(function (f) { if (f.mat === 'parasito') par[f.key] = 'old'; });   // parasito : tout revu
    const learned = Object.assign(par, SEED, autoRead(), s.learned || {});
    Object.keys(learned).forEach(function (k) { if (!learned[k]) delete learned[k]; });
    return { learned: learned, rev: Object.assign({}, s.rev || {}), ann: Object.assign({}, s.ann || {}), done: s.done || {}, cap: CAPS[s.cap] ? s.cap : 'intense' };
  }
  function phaseOf(d) { return d < ex1() ? 1 : d === ex1() ? 'x1' : d < ex2() ? 2 : d === ex2() ? 'x2' : 'fin'; }
  function capOf(d, cap) {
    const n = CAPS[cap].n;
    if (d === add(ex1(), -1) || d === add(ex2(), -1)) return Math.min(3, n);    // veille : léger
    if (d === add(ex1(), 1)) return Math.max(3, n - 3);                          // lendemain de partiel
    if (diff(d, ex2()) <= 3) return Math.max(2, n - 4);                          // 3 derniers jours : cardio + annales
    return n;
  }
  /* date d'un rappel : décalage, ramené au plus tard à la veille du partiel de la matière */
  function dueOf(key, l, off) {
    let due = add(l, off);
    const micro = key.indexOf('m:') === 0, lim = add(micro ? ex1() : ex2(), -1);
    if (micro && l >= ex1()) return null;
    if (due > lim) return null;   // après la veille du partiel : les flashcards et les annales prennent le relais
    return due;
  }

  /* ---------- calcul d'une journée ---------- */
  function dayPlan(d, S, isReal) {
    const ph = phaseOf(d), P = { date: d, phase: ph, rappels: [], news: [], bonus: [], anns: [], react: [] };
    if (ph === 'x1' || ph === 'x2' || ph === 'fin') return P;
    /* rappels */
    Object.keys(S.learned).forEach(function (k) {
      const l = S.learned[k];
      if (l === 'old' || (ph === 2 && k.indexOf('m:') === 0)) return;
      OFFS.forEach(function (off) {
        const due = dueOf(k, l, off);
        if (!due || due < START || due > d) return;
        const rk = k + '@' + off, dn = S.rev[rk];
        if (dn && dn !== d) return;
        const x = info(k); if (!x) return;
        x.off = off; x.rk = rk; x.late = due < d ? diff(due, d) : 0; x.ok = dn === d;
        P.rappels.push(x);
      });
    });
    P.rappels.sort(function (a, b) { return b.late - a.late || a.off - b.off; });
    /* réactivation des items déjà vus (2 premiers jours de la phase 2) */
    if (ph === 2) {
      const i0 = diff(add(ex1(), 1), d);
      if (i0 === 0 || i0 === 1) {
        const olds = Object.keys(SEED).filter(function (k) { return k.indexOf('i:') === 0 && S.learned[k] === 'old'; });
        const half = Math.ceil(olds.length / 2);
        (i0 === 0 ? olds.slice(0, half) : olds.slice(half)).forEach(function (k) { const x = info(k); if (x) { x.rk = k + '@react'; x.ok = S.rev[x.rk] === d; P.react.push(x); } });
      }
    }
    /* nouveaux cours */
    let cap = capOf(d, S.cap) - Math.floor((P.rappels.length + P.react.length) / 4);   // 4 rappels ≈ 1 bloc
    const q = queue(ph === 1 ? 1 : 2).filter(function (x) { return !S.learned[x.key] || S.learned[x.key] === d; });
    q.forEach(function (x) {
      x.ok = S.learned[x.key] === d;
      if (cap >= x.cost || (cap > 0 && !P.news.length)) { P.news.push(x); cap -= x.cost; } else P.bonus.push(x);
    });
    /* annales */
    const pick = function (list, n) {
      list.filter(function (a) { return !S.ann[a[0]] || S.ann[a[0]] === d; }).slice(0, n).forEach(function (a) { P.anns.push({ id: a[0], kind: a[1], ok: S.ann[a[0]] === d }); });
    };
    if (ph === 1) pick(ANN_MICRO, d === add(ex1(), -1) ? 1 : 2);
    else if (diff(d, ex2()) <= 3) { pick(ANN_C, d === add(ex2(), -1) ? 1 : 2); }
    else pick(ANN_PD, d === add(ex1(), 1) ? 1 : 2);
    return P;
  }
  /* simulation jusqu'au jour demandé : les jours avant lui sont supposés faits */
  function planFor(d) {
    const S = baseState(), t = today();
    let cur = t < START ? START : t;
    if (d < cur) return dayPlan(d, S, true);
    while (cur < d) {
      const P = dayPlan(cur, S, cur === t);
      P.news.forEach(function (x) { if (!S.learned[x.key]) S.learned[x.key] = cur; });
      P.rappels.forEach(function (x) { if (!S.rev[x.rk]) S.rev[x.rk] = cur; });
      P.react.forEach(function (x) { if (!S.rev[x.rk]) S.rev[x.rk] = cur; });
      P.anns.forEach(function (a) { if (!S.ann[a.id]) S.ann[a.id] = cur; });
      cur = add(cur, 1);
    }
    return dayPlan(d, S, d === t);
  }

  /* ---------- chrono 25 min (persistant) ---------- */
  let timerEl = null, tick = null;
  function tget() { return st().timer || null; }
  function tset(v) { save(function (o) { if (v) o.timer = v; else delete o.timer; }); drawTimer(); }
  function startTimer(label, min, kind) { tset({ end: Date.now() + min * 60000, label: label, min: min, kind: kind || 'work' }); }
  function drawTimer() {
    if (!timerEl) return;
    const t = tget();
    if (!t) { timerEl.style.display = 'none'; return; }
    timerEl.style.display = '';
    const left = t.paused != null ? t.paused : t.end - Date.now();
    if (left <= 0 && t.paused == null) {
      if (!t.rang) { try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch (e) { /* ignore */ } t.rang = 1; save(function (o) { o.timer = t; }); }
      timerEl.replaceChildren(h('b', {}, t.kind === 'work' ? '✅ ' + t.min + ' min finies : ' + t.label : '☕ Pause finie, on repart !'),
        h('div', { class: 'ay-row' },
          t.kind === 'work' ? h('button', { class: 'btn btn--sm btn--primary', on: { click: function () { startTimer('Pause', 5, 'pause'); } } }, '☕ Pause 5 min') : null,
          t.kind === 'work' ? h('button', { class: 'btn btn--sm btn--secondary', on: { click: function () { startTimer(t.label, 25, 'work'); } } }, '↻ Encore 25 min') : null,
          h('button', { class: 'btn btn--sm btn--ghost', on: { click: function () { tset(null); } } }, 'Fermer')));
      timerEl.className = 'ay-timer done';
      return;
    }
    const s = Math.ceil(left / 1000);
    timerEl.className = 'ay-timer' + (t.kind === 'pause' ? ' pause' : '');
    timerEl.replaceChildren(
      h('div', {}, h('div', { class: 'ay-tl' }, (t.kind === 'pause' ? '☕ ' : '⏱️ ') + t.label), h('div', { class: 'ay-tc' }, Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'))),
      h('div', { class: 'ay-row' },
        h('button', { class: 'btn btn--sm btn--secondary', on: { click: function () { const x = tget(); if (!x) return; if (x.paused != null) { x.end = Date.now() + x.paused; delete x.paused; } else x.paused = x.end - Date.now(); tset(x); } } }, t.paused != null ? '▶ Reprendre' : '⏸ Pause'),
        h('button', { class: 'btn btn--sm btn--ghost', on: { click: function () { tset(null); } } }, '✕')));
  }
  function runTick() {
    if (tick) clearInterval(tick);
    tick = setInterval(function () { if (!timerEl || !document.body.contains(timerEl)) { clearInterval(tick); tick = null; timerEl = null; return; } drawTimer(); }, 1000);
  }

  /* ---------- styles ---------- */
  let styled = false;
  function styles() {
    if (styled) return; styled = true;
    const css = [
      '.ay-hero{border-radius:16px;padding:14px 16px;background:linear-gradient(135deg,var(--accent,#2563eb),#7c3aed);color:#fff;margin:4px 0 12px}',
      '.ay-hero h1{margin:0;font-size:1.35rem;color:#fff}', '.ay-hero p{margin:4px 0 0;opacity:.92;font-size:.9rem}',
      '.ay-cd{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}', '.ay-cd span{background:rgba(255,255,255,.18);border-radius:999px;padding:3px 10px;font-size:.82rem;font-weight:600}',
      '.ay-bar{height:8px;border-radius:4px;background:rgba(255,255,255,.25);margin-top:10px;overflow:hidden}', '.ay-bar>div{height:100%;background:#fff;border-radius:4px}',
      '.ay-nav{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 10px}', '.ay-nav b{text-transform:capitalize}',
      '.ay-tabs{display:flex;gap:6px;margin:0 0 12px;flex-wrap:wrap}',
      '.ay-blk{border:1px solid var(--line,#e5e7eb);border-radius:14px;padding:12px 14px;margin:0 0 12px;background:var(--surface,#fff)}',
      '.ay-blk.fini{opacity:.65}', '.ay-bh{display:flex;align-items:center;gap:10px;justify-content:space-between}',
      '.ay-bt{font-weight:700;font-size:1rem}', '.ay-bs{font-size:.8rem;color:var(--muted,#6b7280);margin-top:1px}',
      '.ay-num{flex:none;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:.85rem;background:var(--accent,#2563eb);color:#fff}',
      '.ay-blk.fini .ay-num{background:#16a34a}',
      '.ay-tip{font-size:.83rem;color:var(--muted,#6b7280);margin:8px 0 2px;line-height:1.4}',
      '.ay-task{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-top:1px dashed var(--line,#e5e7eb)}', '.ay-task:first-of-type{border-top:0}',
      '.ay-ck{flex:none;width:26px;height:26px;border-radius:8px;border:2px solid var(--line,#cbd5e1);background:transparent;cursor:pointer;font-size:.95rem;line-height:1;color:#fff;padding:0}',
      '.ay-ck.on{background:#16a34a;border-color:#16a34a}',
      '.ay-tt{flex:1;min-width:0}', '.ay-tt .t{font-size:.93rem;line-height:1.3}', '.ay-task.on .ay-tt .t{text-decoration:line-through;opacity:.6}',
      '.ay-tt .m{font-size:.76rem;color:var(--muted,#6b7280);margin-top:2px}', '.ay-late{color:#dc2626;font-weight:700}',
      '.ay-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}', '.ay-row .btn{padding:4px 10px;font-size:.8rem}',
      '.ay-timer{position:sticky;top:6px;z-index:20;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;border-radius:14px;padding:10px 14px;margin:0 0 12px;background:#111827;color:#fff;box-shadow:0 6px 18px rgba(0,0,0,.18)}',
      '.ay-timer.pause{background:#0f766e}', '.ay-timer.done{background:#16a34a}', '.ay-timer .btn{color:inherit}',
      '.ay-tl{font-size:.8rem;opacity:.85}', '.ay-tc{font-size:1.6rem;font-weight:800;font-variant-numeric:tabular-nums}',
      '.ay-big{text-align:center;padding:26px 16px}', '.ay-big .e{font-size:2.6rem}',
      '.ay-list .ay-task .t{font-size:.88rem}', '.ay-mat{margin:14px 0 4px;font-weight:700}'
    ].join('\n');
    document.head.appendChild(h('style', {}, css));
  }

  /* ---------- rendu ---------- */
  function check(on, fn) { return h('button', { type: 'button', class: 'ay-ck' + (on ? ' on' : ''), 'aria-label': on ? 'Fait' : 'À faire', on: { click: fn } }, on ? '✓' : ''); }
  function link(href, label, cls) { return h('a', { class: 'btn btn--sm ' + (cls || 'btn--secondary'), href: href }, label); }
  function timerBtn(label, min) { return h('button', { type: 'button', class: 'btn btn--sm btn--primary', on: { click: function () { startTimer(label, min || 25, 'work'); window.scrollTo({ top: 0, behavior: 'smooth' }); } } }, '▶ ' + (min || 25) + ' min'); }
  function block(n, title, sub, tip, tasks, fini, extra) {
    return h('div', { class: 'ay-blk' + (fini ? ' fini' : '') },
      h('div', { class: 'ay-bh' }, h('div', { style: 'display:flex;gap:10px;align-items:center;min-width:0' }, h('span', { class: 'ay-num' }, fini ? '✓' : String(n)), h('div', {}, h('div', { class: 'ay-bt' }, title), sub ? h('div', { class: 'ay-bs' }, sub) : null)), extra || null),
      tip ? h('div', { class: 'ay-tip' }, tip) : null,
      tasks);
  }
  function annTitle(id) {
    const r = CARDIO.registry || {};
    const e = [].concat(r.annales || [], r.hiba || []).filter(function (x) { return x && x.id === id; })[0];
    return e ? e.titre : id;
  }
  function annN(id) {
    const r = CARDIO.registry || {};
    const e = [].concat(r.annales || [], r.hiba || []).filter(function (x) { return x && x.id === id; })[0];
    return e ? (e.blocks || []).reduce(function (a, b) { return a + (b.questions || []).length; }, 0) : 0;
  }
  function mins(n) { return n >= 60 ? Math.floor(n / 60) + ' h' + (n % 60 ? ' ' + String(n % 60).padStart(2, '0') : '') : n + ' min'; }

  function renderDay(page, d, rerender) {
    const t = today(), real = d === t, P = planFor(d), S = baseState();
    const editable = real;
    const ph = P.phase;
    /* jours d'examen / fin */
    if (ph === 'x1' || ph === 'x2') {
      page.appendChild(h('div', { class: 'ay-blk ay-big' }, h('div', { class: 'e' }, '🎯'), h('h2', {}, ph === 'x1' ? 'Partiel de micro (viro · bactério · parasito)' : 'Partiel pneumo · dermato · cardio'),
        h('p', {}, 'Le matin : 20 min de flashcards du jour, pas plus. Pas de nouveau cours. Mange, bois de l’eau, arrive en avance.'),
        h('div', { class: 'ay-row', style: 'justify-content:center' }, link('#/fc?mode=due&poly=' + (ph === 'x1' ? 'viro' : 'pneumo'), '20 min de flashcards', 'btn--primary')),
        h('p', { class: 'secondary', style: 'margin-top:10px' }, 'Après l’épreuve : repos. Tu l’as mérité.')));
      return;
    }
    if (ph === 'fin') { page.appendChild(h('div', { class: 'ay-blk ay-big' }, h('div', { class: 'e' }, '🏁'), h('h2', {}, 'Partiels terminés !'), h('p', {}, 'Bravo. Les flashcards continuent à te garder tout en mémoire jusqu’à l’EDN.'))); return; }

    const micro = ph === 1;
    let n = 0, total = 0, doneN = 0, minutes = 0;
    const key = function (b) { return d + '|' + b; };
    const isDone = function (b) { return !!(S.done && S.done[key(b)]); };
    const toggleDone = function (b) { if (!editable) return; save(function (o) { const x = sub(o, 'done'); if (x[key(b)]) delete x[key(b)]; else x[key(b)] = 1; }); rerender(); };
    const cnt = function (on) { total++; if (on) doneN++; };

    const blocks = [];
    /* 1. flashcards */
    const polys = micro ? [['viro', '🦠 Viro'], ['bacterio', '🧫 Bactério'], ['parasito', '🪱 Parasito']] : diff(d, ex2()) <= 3 ? [['cardio', '❤️ Cardio'], ['pneumo', '🫁 Pneumo'], ['dermato', '🩺 Dermato']] : [['pneumo', '🫁 Pneumo'], ['dermato', '🩺 Dermato']];
    const fcOn = isDone('fc'); cnt(fcOn); minutes += 30;
    blocks.push(block(++n, '☀️ Flashcards du jour', '≈ 30 min · pour réviser tout ce que tu as déjà vu', 'C’est l’app qui choisit les cartes que tu es en train d’oublier : pas besoin de te demander quoi revoir. Commence toujours par là, c’est facile et ça lance la journée.',
      h('div', { class: 'ay-task' + (fcOn ? ' on' : '') }, check(fcOn, function () { toggleDone('fc'); }),
        h('div', { class: 'ay-tt' }, h('div', { class: 't' }, 'Toutes les cartes « à revoir » de ' + polys.map(function (p) { return p[1].replace(/^\S+\s/, ''); }).join(', ')),
          h('div', { class: 'ay-row' }, polys.map(function (p) { return link('#/fc?mode=due&poly=' + p[0], p[1]); }), timerBtn('Flashcards du jour', 25)))), fcOn));

    /* 2. rappels */
    if (P.rappels.length || P.react.length) {
      const all = P.rappels.concat(P.react);
      const allOk = all.every(function (x) { return x.ok; });
      all.forEach(function (x) { cnt(x.ok); }); minutes += all.length * 10;
      blocks.push(block(++n, P.react.length && !P.rappels.length ? '🔁 Réactivation des items déjà vus' : '🔁 Rappels J1 · J3 · J7', all.length + ' × 10 min · de mémoire d’abord',
        'Pour chaque cours : feuille blanche (ou à voix haute), tu ressors tout ce dont tu te souviens SANS regarder. Ensuite seulement, ouvre la fiche et regarde ce qui manquait. C’est ce qui fixe le cours.',
        all.map(function (x) {
          return h('div', { class: 'ay-task' + (x.ok ? ' on' : '') },
            check(x.ok, function () { if (!editable) return; save(function (o) { const r = sub(o, 'rev'); if (r[x.rk] === d) delete r[x.rk]; else r[x.rk] = d; }); rerender(); }),
            h('div', { class: 'ay-tt' }, h('div', { class: 't' }, x.tag + ' · ' + x.title),
              h('div', { class: 'm' }, x.rk.slice(-6) === '@react' ? 'Réactivation : vu avant la micro' : 'Rappel J' + x.off, x.late ? h('span', { class: 'ay-late' }, ' · en retard de ' + x.late + ' j') : null),
              h('div', { class: 'ay-row' }, timerBtn('Rappel : ' + x.title, 10), link(x.href, 'Vérifier sur la fiche'), x.qcm ? link(x.qcm, 'QCM') : null)));
        }), allOk));
    }

    /* 3. nouveaux cours */
    if (P.news.length) {
      const allOk = P.news.every(function (x) { return x.ok; });
      const pomo = P.news.reduce(function (a, x) { return a + x.cost; }, 0);
      P.news.forEach(function (x) { cnt(x.ok); }); minutes += pomo * 30;
      blocks.push(block(++n, micro ? '📘 Nouveaux cours (par ordre de fréquence)' : '📘 Nouveaux items (par ordre de fréquence)', pomo + ' blocs de 25 min + 5 min de pause',
        'Méthode : 1 bloc = 25 min chrono. Lis la fiche une fois activement, puis ferme-la et explique-la (comme tu fais déjà), puis 5 min de flashcards du chapitre. Coche « appris » : les rappels J1/J3/J7 se planifient tout seuls. Pas fini ? Il revient demain automatiquement.',
        P.news.map(function (x) {
          return h('div', { class: 'ay-task' + (x.ok ? ' on' : '') },
            check(x.ok, function () { if (!editable) return; save(function (o) { const l = sub(o, 'learned'); if (l[x.key] === d) l[x.key] = null; else l[x.key] = d; }); rerender(); }),
            h('div', { class: 'ay-tt' }, h('div', { class: 't' }, x.tag + ' · ' + x.title),
              h('div', { class: 'm' }, x.cost + ' × 25 min' + (x.pct ? ' · ' + Math.round(x.pct) + ' % des questions d’annales' : ' · peu tombé aux annales') + (FIRST.indexOf(x.key) >= 0 ? ' · à finir (en cours)' : '')),
              h('div', { class: 'ay-row' }, timerBtn(x.title, 25), link(x.href, 'Fiche'), link(x.fc, 'Flashcards'), x.qcm ? link(x.qcm, 'QCM') : null)));
        }), allOk));
    }

    /* 4. annales */
    if (P.anns.length) {
      const allOk = P.anns.every(function (a) { return a.ok; });
      P.anns.forEach(function (a) { cnt(a.ok); minutes += Math.max(30, Math.round(annN(a.id) * 1.2)); });
      blocks.push(block(++n, '⏱️ Annales en conditions d’examen', P.anns.length + ' sujet' + (P.anns.length > 1 ? 's' : '') + ' · d’une traite, sans regarder la correction',
        'Fais le sujet en entier, minuteur lancé, comme le jour J. Ensuite lis la correction en notant sur une feuille chaque point raté : c’est ta liste « erreurs » du soir.',
        P.anns.map(function (a) {
          const nq = annN(a.id), m = Math.max(30, Math.round(nq * 1.2));
          return h('div', { class: 'ay-task' + (a.ok ? ' on' : '') },
            check(a.ok, function () { if (!editable) return; save(function (o) { const x = sub(o, 'ann'); if (x[a.id] === d) delete x[a.id]; else x[a.id] = d; }); rerender(); }),
            h('div', { class: 'ay-tt' }, h('div', { class: 't' }, annTitle(a.id)),
              h('div', { class: 'm' }, (nq ? nq + ' questions · ' : '') + '≈ ' + mins(m) + (a.kind === 'h' ? ' · dans Hiba (barème + chrono)' : '')),
              h('div', { class: 'ay-row' }, link(a.kind === 'h' ? '#/hiba/' + encodeURIComponent(a.id) : '#/annales/' + encodeURIComponent(a.id), 'Ouvrir le sujet', 'btn--primary'))));
        }), allOk));
    }

    /* 5. soir */
    const evOn = isDone('soir'); cnt(evOn); minutes += 30;
    const other = micro ? [['pneumo', '🫁 Pneumo'], ['dermato', '🩺 Dermato']] : [['cardio', '❤️ Cardio']];
    blocks.push(block(++n, '🌙 Soir : erreurs + entretien', '≈ 30 min',
      'Reprends ta feuille d’erreurs de la journée : pour chaque point raté, réécris-le de mémoire en une phrase. Puis 15 min de flashcards ' + (micro ? 'pneumo / dermato pour ne pas les oublier avant leur partiel.' : 'cardio pour garder ton avance.'),
      h('div', { class: 'ay-task' + (evOn ? ' on' : '') }, check(evOn, function () { toggleDone('soir'); }),
        h('div', { class: 'ay-tt' }, h('div', { class: 't' }, 'Erreurs du jour réécrites + flashcards ' + other.map(function (p) { return p[1].replace(/^\S+\s/, ''); }).join(' / ')),
          h('div', { class: 'ay-row' }, timerBtn('Erreurs du jour', 15), other.map(function (p) { return link('#/fc?mode=due&poly=' + p[0], p[1]); })))), evOn));

    /* en-tête du jour */
    const pct = total ? Math.round(doneN / total * 100) : 0;
    const dl1 = diff(d, ex1()), dl2 = diff(d, ex2());
    page.appendChild(h('div', { class: 'ay-hero' },
      h('h1', {}, real ? '🎯 Ta journée' : '🗓️ Aperçu du ' + longDate(d)),
      h('p', {}, (real ? longDate(d) + ' · ' : '') + 'Fais les blocs de haut en bas, c’est tout. Environ ' + mins(Math.round(minutes / 15) * 15) + ' de travail + pauses.'),
      h('div', { class: 'ay-cd' }, dl1 > 0 ? h('span', {}, '🦠 Micro dans ' + dl1 + ' j') : null, dl2 > 0 ? h('span', {}, '🫁 Pneumo · dermato · cardio dans ' + dl2 + ' j') : null, h('span', {}, doneN + ' / ' + total + ' fait')),
      h('div', { class: 'ay-bar' }, h('div', { style: 'width:' + pct + '%' }))));
    if (!real) page.appendChild(h('p', { class: 'secondary', style: 'font-size:.82rem;margin:-4px 0 10px' }, 'Aperçu calculé en supposant que tu suis le planning d’ici là ; il se met à jour tout seul selon ce que tu coches vraiment.'));
    if (real && doneN === total && total) page.appendChild(h('div', { class: 'ay-blk', style: 'border-color:#16a34a;text-align:center' }, h('b', {}, '🏆 Journée terminée ! Ferme l’app et repose-toi.')));
    blocks.forEach(function (b) { page.appendChild(b); });
    if (P.bonus.length && (d === add(ex1(), -1) || d === add(ex2(), -1))) {
      page.appendChild(h('details', { class: 'ay-blk' }, h('summary', {}, h('b', {}, '⚪ Pas eu le temps (' + P.bonus.length + ', peu tombés aux annales)')),
        h('div', { class: 'ay-tip' }, 'Ne panique pas : ce sont les chapitres les moins rentables. Si tu as du temps, survole leurs flashcards.'),
        P.bonus.map(function (x) { return h('div', { class: 'ay-task' }, h('div', { class: 'ay-tt' }, h('div', { class: 't' }, x.tag + ' · ' + x.title), h('div', { class: 'ay-row' }, link(x.fc, 'Flashcards'), link(x.href, 'Fiche')))); })));
    }
  }

  function renderCours(page, rerender) {
    const S = baseState();
    page.appendChild(h('p', { class: 'secondary' }, 'Coche ce que tu as déjà vu (sans rappels programmés) ; décoche ce que tu veux remettre dans le planning. Le planning se recalcule tout seul.'));
    const groups = [['🦠 Virologie', microAll().filter(function (f) { return f.mat === 'viro'; }).map(function (f) { return f.key; })],
      ['🧫 Bactériologie', microAll().filter(function (f) { return f.mat === 'bacterio'; }).map(function (f) { return f.key; })],
      ['🪱 Parasitologie', microAll().filter(function (f) { return f.mat === 'parasito'; }).map(function (f) { return f.key; })],
      ['🫁 Pneumologie', itemsAll().filter(function (i) { return i.spe === 'pneumo'; }).map(function (i) { return 'i:' + i.num; })],
      ['🩺 Dermatologie', itemsAll().filter(function (i) { return i.spe === 'dermato'; }).map(function (i) { return 'i:' + i.num; })]];
    groups.forEach(function (g) {
      const box = h('div', { class: 'ay-blk ay-list' });
      const seen = g[1].filter(function (k) { return S.learned[k]; }).length;
      box.appendChild(h('div', { class: 'ay-bt' }, g[0] + ' · ' + seen + ' / ' + g[1].length + ' vus'));
      g[1].forEach(function (k) {
        const x = info(k); if (!x) return;
        const l = S.learned[k], on = !!l;
        box.appendChild(h('div', { class: 'ay-task' + (on ? ' on' : '') },
          check(on, function () { save(function (o) { const L = sub(o, 'learned'); L[k] = on ? null : 'old'; }); rerender(); }),
          h('div', { class: 'ay-tt' }, h('div', { class: 't' }, x.title), h('div', { class: 'm' }, (l && l !== 'old' ? 'appris le ' + longDate(l) : on ? 'déjà vu' : 'pas encore vu') + (x.pct ? ' · ' + Math.round(x.pct) + ' % aux annales' : '')))));
      });
      page.appendChild(box);
    });
  }

  function renderRegl(page, rerender) {
    const s = st();
    const cap = CAPS[s.cap] ? s.cap : 'intense';
    page.appendChild(h('div', { class: 'ay-blk' }, h('div', { class: 'ay-bt' }, 'Rythme'),
      h('div', { class: 'ay-tip' }, 'Combien de nouveau par jour. Si tu finis tes journées trop tard, passe en Léger : le planning se recale tout seul (les chapitres les moins tombés passent en « si tu as le temps »).'),
      h('div', { class: 'ay-row' }, Object.keys(CAPS).map(function (k) {
        return h('button', { type: 'button', class: 'btn btn--sm ' + (k === cap ? 'btn--primary' : 'btn--secondary'), on: { click: function () { save(function (o) { o.cap = k; }); rerender(); } } }, CAPS[k].label);
      })), h('div', { class: 'ay-tip' }, CAPS[cap].desc + '.')));
    const dateIn = function (label, k, val) {
      return h('label', { style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;margin:8px 0' }, h('span', {}, label),
        h('input', { type: 'date', value: val, style: 'font:inherit;padding:4px 6px', on: { change: function (e) { const v = e.target.value; if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { save(function (o) { o[k] = v; }); rerender(); } } } }));
    };
    page.appendChild(h('div', { class: 'ay-blk' }, h('div', { class: 'ay-bt' }, 'Dates des partiels'), dateIn('🦠 Micro', 'ex1', ex1()), dateIn('🫁 Pneumo · dermato · cardio', 'ex2', ex2())));
    page.appendChild(h('div', { class: 'ay-blk' }, h('div', { class: 'ay-bt' }, 'Les 5 règles'),
      h('ol', { style: 'margin:6px 0 0;padding-left:18px;line-height:1.5;font-size:.9rem' },
        h('li', {}, 'Un bloc = 25 min chrono, téléphone en mode Concentration. Puis 5 min de pause (lève-toi).'),
        h('li', {}, 'Le chrono est un repère, pas une punition : à la sonnerie, tu passes au bloc suivant. Ce qui n’est pas fini revient demain tout seul.'),
        h('li', {}, 'De mémoire avant de relire : toujours essayer de ressortir le cours avant d’ouvrir la fiche.'),
        h('li', {}, 'Les annales d’une traite, sans regarder la correction, puis les erreurs le soir.'),
        h('li', {}, 'Dodo avant minuit : c’est la nuit que la mémoire se fixe.'))));
  }

  function render(params, query) {
    styles();
    query = query || {};
    const page = h('div', { class: 'page' });
    const t = today();
    let d = /^\d{4}-\d{2}-\d{2}$/.test(query.d || '') ? query.d : t;
    if (d < t) d = t;
    let tab = query.tab === 'cours' || query.tab === 'regl' ? query.tab : 'jour';
    const draw = function () {
      page.replaceChildren();
      timerEl = h('div', { class: 'ay-timer', style: 'display:none' });
      page.appendChild(timerEl); drawTimer(); runTick();
      page.appendChild(h('div', { class: 'ay-tabs' }, [['jour', '📅 Planning'], ['cours', '📚 Mes cours'], ['regl', '⚙️ Réglages']].map(function (x) {
        return h('button', { type: 'button', class: 'btn btn--sm ' + (tab === x[0] ? 'btn--primary' : 'btn--secondary'), on: { click: function () { tab = x[0]; draw(); } } }, x[1]);
      })));
      if (tab === 'jour') {
        page.appendChild(h('div', { class: 'ay-nav' },
          h('button', { type: 'button', class: 'btn btn--sm btn--ghost', disabled: d <= t ? true : null, on: { click: function () { if (d > t) { d = add(d, -1); draw(); } } } }, '‹'),
          h('b', {}, d === t ? 'Aujourd’hui' : longDate(d)),
          h('div', { style: 'display:flex;gap:4px' }, d !== t ? h('button', { type: 'button', class: 'btn btn--sm btn--ghost', on: { click: function () { d = t; draw(); } } }, 'Aujourd’hui') : null,
            h('button', { type: 'button', class: 'btn btn--sm btn--ghost', disabled: d >= ex2() ? true : null, on: { click: function () { if (d < ex2()) { d = add(d, 1); draw(); } } } }, '›'))));
        renderDay(page, d, draw);
      } else if (tab === 'cours') renderCours(page, draw);
      else renderRegl(page, draw);
    };
    draw();
    page.dataset.title = 'Aymen';
    return { el: page, title: 'Aymen' };
  }

  CARDIO.views.aymen = { render: render, available: function () { return true; }, _planFor: planFor };
})();
