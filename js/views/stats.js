/* CardioR2C — vue Stats (CARDIO.views.stats)
 * Page d'analyse : tuiles, maîtrise par item, heatmap d'activité, courbe de rétention,
 * prévision à 7 jours, répartition par type, badges, cahier d'erreurs.
 * Script classique ES2020, aucune dépendance au chargement : tout est résolu à l'exécution.
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  CARDIO.views = CARDIO.views || {};

  var DAY_MS = 86400000;
  var KINDS = ['qcm', 'qroc', 'open', 'kfp', 'tcs', 'flash', 'tree', 'tx', 'case', 'ecg', 'echo'];
  var KIND_LABEL = {
    qcm: 'QCM', qroc: 'QROC', open: 'Ouverte', kfp: 'KFP', tcs: 'TCS', flash: 'Flash',
    tree: 'Arbre', tx: 'Traitement', 'case': 'Cas', ecg: 'ECG', echo: 'Écho'
  };
  var LEVEL_NAMES = ['Externe', 'Interne', 'Chef de clinique', 'Praticien', 'Cardiologue',
    'Maître de conférences', 'Professeur'];
  var WEEKDAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
  var MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

  /* ------------------------------------------------------------------ helpers */

  function util() { return CARDIO.util || {}; }
  function store() { return CARDIO.store || null; }
  function registry() { return CARDIO.registry || null; }

  /** Aplatit les enfants et délègue à CARDIO.util.h (avec repli minimal si absent). */
  function h(tag, attrs) {
    var kids = [];
    for (var i = 2; i < arguments.length; i++) flatten(arguments[i], kids);
    var u = util();
    if (typeof u.h === 'function') return u.h.apply(null, [tag, attrs || {}].concat(kids));
    // Repli très simple (ne devrait jamais servir : util.js est chargé en premier).
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.keys(v).forEach(function (d) { el.dataset[d] = v[d]; });
      else if (k === 'on') Object.keys(v).forEach(function (e) { el.addEventListener(e, v[e]); });
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v === true ? '' : v);
    });
    kids.forEach(function (c) { el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function flatten(c, out) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { flatten(x, out); }); return; }
    if (typeof c === 'number') { out.push(String(c)); return; }
    out.push(c);
  }
  function icon(name) {
    var u = util();
    return typeof u.icon === 'function' ? u.icon(name) : '';
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function dateKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function todayKey() {
    var u = util();
    return typeof u.today === 'function' ? u.today() : dateKey(new Date());
  }
  function parseKey(key) {
    var p = String(key).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function fmtInt(n) { return Number(n || 0).toLocaleString('fr-FR'); }
  function fmtPct(r) { return Math.round((r || 0) * 100) + ' %'; }
  function fmtDuration(ms) {
    var u = util();
    if (typeof u.fmtDuration === 'function') { try { return u.fmtDuration(ms); } catch (e) { /* repli ci-dessous */ } }
    var m = Math.round((ms || 0) / 60000);
    if (m < 60) return m + ' min';
    var hh = Math.floor(m / 60), mm = m % 60;
    return hh + ' h' + (mm ? ' ' + pad2(mm) : '');
  }
  /** « lun. 3 mars » */
  function fmtDayLong(d) {
    try {
      return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' });
    } catch (e) {
      var wd = WEEKDAYS[(d.getDay() + 6) % 7];
      return wd + ' ' + d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()];
    }
  }
  function fmtDayShort(d) { return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()]; }

  function state() { var s = store(); return (s && s.state) || {}; }
  function daily() { return state().daily || {}; }
  function cards() { return state().cards || {}; }

  /** Déduit le kind d'une carte : registre si chargé, sinon motif de l'id. */
  function kindOf(id) {
    var r = registry();
    if (r && typeof r.card === 'function') {
      try { var c = r.card(id); if (c && c.kind) return c.kind; } catch (e) { /* item non chargé */ }
    }
    var m = /^\d+-([a-z]+)-/.exec(String(id));
    var k = m ? m[1] : '';
    if (k === 'qru') return 'qcm';
    if (k === 'ess' || k === 'num' || k === 'mn') return 'flash';
    return KINDS.indexOf(k) >= 0 ? k : 'qcm';
  }
  function itemOfCard(id) { var m = /^(\d+)-/.exec(String(id)); return m ? m[1] : null; }

  function isDue(cs, now) {
    if (!cs || cs.state === 'new' || !cs.due) return false;
    var srs = CARDIO.srs;
    if (srs && typeof srs.isDue === 'function') { try { return !!srs.isDue(cs, now); } catch (e) { /* repli */ } }
    var due = typeof cs.due === 'number' ? cs.due : Date.parse(cs.due);
    return isFinite(due) && due <= now;
  }
  function dueMs(cs) {
    if (!cs || !cs.due) return NaN;
    return typeof cs.due === 'number' ? cs.due : Date.parse(cs.due);
  }

  /* ------------------------------------------------------------- data access */

  function safe(fn, fallback) { try { var v = fn(); return v === undefined ? fallback : v; } catch (e) { console.warn('[stats]', e); return fallback; } }

  function getMastery(num) {
    var s = store();
    var m = s && typeof s.mastery === 'function' ? safe(function () { return s.mastery(num); }, null) : null;
    if (!m) { console.warn('[stats] store.mastery indisponible'); m = { A: 0, B: 0, all: 0, seen: 0, total: 0 }; }
    return m;
  }
  function getStreak() {
    var s = store();
    var v = s && typeof s.streak === 'function' ? safe(function () { return s.streak(); }, null) : null;
    if (v && typeof v === 'object') return { current: v.current || 0, best: v.best || v.current || 0 };
    var st = state().streak || {};
    return { current: typeof v === 'number' ? v : (st.current || 0), best: st.best || st.current || 0 };
  }
  function getXp() {
    var s = store();
    var v = s && typeof s.xp === 'function' ? safe(function () { return s.xp(); }, null) : null;
    return typeof v === 'number' ? v : (state().xp || 0);
  }
  function getLevel(xp) {
    var s = store();
    var v = s && typeof s.level === 'function' ? safe(function () { return s.level(); }, null) : null;
    var n = Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
    var name = LEVEL_NAMES[Math.min(LEVEL_NAMES.length - 1, n - 1)];
    if (v && typeof v === 'object') {
      n = v.n || v.level || v.num || n;
      name = v.name || v.label || name;
    } else if (typeof v === 'number') {
      n = v; name = LEVEL_NAMES[Math.min(LEVEL_NAMES.length - 1, n - 1)];
    }
    return { n: n, name: name, nextXp: 100 * n * n, floorXp: 100 * (n - 1) * (n - 1) };
  }
  function getForecast(days) {
    var s = store(), now = Date.now();
    var raw = s && typeof s.forecast === 'function' ? safe(function () { return s.forecast(days); }, null) : null;
    var out = [];
    if (Array.isArray(raw) && raw.length) {
      for (var i = 0; i < days; i++) {
        var r = raw[i];
        out.push(typeof r === 'number' ? r : (r && (r.count != null ? r.count : r.due != null ? r.due : r.n)) || 0);
      }
      return out;
    }
    // Repli : calcul direct depuis les cartes (le jour 0 inclut le retard).
    for (var d = 0; d < days; d++) out.push(0);
    var startTomorrow = addDays(new Date(), 1).getTime();
    var all = cards();
    Object.keys(all).forEach(function (id) {
      var cs = all[id];
      if (!cs || cs.state === 'new') return;
      var due = dueMs(cs);
      if (!isFinite(due)) return;
      if (due < startTomorrow) { out[0]++; return; }
      var idx = Math.floor((due - startTomorrow) / DAY_MS) + 1;
      if (idx < days) out[idx]++;
    });
    return out;
  }
  function manifestItems() {
    var r = registry();
    var list = r && typeof r.items === 'function' ? safe(function () { return r.items(); }, null) : null;
    if (!list || !list.length) list = (r && r.manifest && r.manifest.items) || [];
    return list.filter(function (it) { return it && it.available !== false; });
  }

  /** Agrégats sur les N derniers jours de state.daily. */
  function rangeDaily(nDays) {
    var d = daily(), today = parseKey(todayKey()), acc = { reviews: 0, correct: 0, ms: 0 };
    for (var i = 0; i < nDays; i++) {
      var k = dateKey(addDays(today, -i)), e = d[k];
      if (!e) continue;
      acc.reviews += e.reviews || 0; acc.correct += e.correct || 0; acc.ms += e.ms || 0;
    }
    return acc;
  }
  function totalDaily() {
    var d = daily(), acc = { reviews: 0, ms: 0 };
    Object.keys(d).forEach(function (k) { acc.reviews += d[k].reviews || 0; acc.ms += d[k].ms || 0; });
    return acc;
  }

  /* ------------------------------------------------------------------ styles */

  var CSS = [
    '.st-tiles{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px}',
    '@media(min-width:720px){.st-tiles{grid-template-columns:repeat(5,1fr)}}',
    '.st-tiles .tile{background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1);padding:12px 14px;min-width:0}',
    '.tile__label{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);display:block;margin-bottom:4px}',
    '.tile__num{font:700 1.75rem/1.1 var(--font-display);font-variant-numeric:tabular-nums;color:var(--ink);display:block}',
    '.tile__sub{font-size:.8125rem;color:var(--muted);font-variant-numeric:tabular-nums;display:block;margin-top:4px}',
    '.tile__num--accent{color:var(--accent)}',
    '.st-section{margin-bottom:16px}',
    '.st-section__head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 10px}',
    '.st-section__head h2{font:700 1.125rem/1.3 var(--font-display);margin:0}',
    '.st-empty{color:var(--muted);font-size:.9375rem;padding:8px 0}',
    '.st-ico{display:inline-flex;width:20px;height:20px;vertical-align:middle}.st-ico svg{width:100%;height:100%}',
    /* maîtrise */
    '.st-mastery{display:grid;gap:6px}',
    '@media(min-width:900px){.st-mastery{grid-template-columns:1fr 1fr;column-gap:16px}}',
    '.st-mrow{display:grid;grid-template-columns:44px 1fr auto;gap:10px;align-items:center;padding:8px 6px;border-radius:var(--r-s);min-height:44px;color:inherit;text-decoration:none;cursor:pointer;border:0;background:transparent;text-align:left;font:inherit;width:100%}',
    '.st-mrow:hover,.st-mrow:focus-visible{background:var(--surface-2)}',
    '.st-mrow:focus-visible{outline:2px solid var(--blue);outline-offset:2px}',
    '.st-mrow__num{font:700 1rem/1 var(--font-display);font-variant-numeric:tabular-nums;color:var(--ink)}',
    '.st-mrow__body{min-width:0}',
    '.st-mrow__title{font-size:.875rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px}',
    '.st-mrow__bars{display:grid;gap:3px}',
    '.st-mbar{display:grid;grid-template-columns:14px 1fr 38px;gap:6px;align-items:center;font-size:.6875rem;color:var(--muted);font-variant-numeric:tabular-nums}',
    '.st-mbar .bar{display:block;height:5px;background:var(--surface-3);border-radius:999px;overflow:hidden}',
    '.st-mbar .bar__fill{display:block;height:100%;border-radius:999px;transition:width .5s cubic-bezier(.2,.7,.2,1)}',
    '.st-mbar--A .bar__fill{background:var(--rankA)}.st-mbar--B .bar__fill{background:var(--rankB)}',
    '.st-mbar__k{font-weight:600;color:var(--ink-2)}',
    '.st-mrow__due{font-size:.75rem;color:var(--muted);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.st-mrow__due strong{display:block;font:700 1rem/1.1 var(--font-display);color:var(--ink)}',
    '.st-mrow__due.is-due strong{color:var(--accent)}',
    '.st-sect-label{grid-column:1/-1;font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:8px 6px 2px}',
    /* heatmap */
    '.st-heatwrap{overflow-x:auto;padding-bottom:4px}',
    '.heat{display:grid;grid-template-columns:32px repeat(12,12px);grid-auto-rows:12px;gap:3px;width:max-content}',
    '.heat__month{font-size:.6875rem;color:var(--muted);white-space:nowrap;line-height:12px;grid-row:1}',
    '.heat__wd{font-size:.6875rem;color:var(--muted);line-height:12px;grid-column:1}',
    '.heat__cell{width:12px;height:12px;border-radius:3px;background:var(--surface-3)}',
    '.heat__cell[data-l="1"]{background:var(--accent);opacity:.3}.heat__cell[data-l="2"]{background:var(--accent);opacity:.5}',
    '.heat__cell[data-l="3"]{background:var(--accent);opacity:.75}.heat__cell[data-l="4"]{background:var(--accent);opacity:1}',
    '.heat__cell.is-today{box-shadow:0 0 0 1.5px var(--ink) inset}',
    '.st-legend{display:flex;align-items:center;gap:4px;font-size:.6875rem;color:var(--muted);margin-top:8px}',
    '.st-legend .heat__cell{display:inline-block}',
    /* rétention */
    '.st-chart{width:100%;max-width:640px;height:auto;display:block;margin:0 auto;font-family:var(--font-body);font-variant-numeric:tabular-nums}',
    '.st-chart .grid{stroke:var(--line);stroke-width:1}',
    '.st-chart .axis{fill:var(--muted);font-size:10px}',
    '.st-chart .line{fill:none;stroke:var(--accent);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}',
    '.st-chart .area{fill:var(--accent);opacity:.08}',
    '.st-chart .dot{fill:var(--surface);stroke:var(--accent);stroke-width:1.5}',
    '.st-chart .dot--last{fill:var(--accent);stroke:var(--surface);stroke-width:2}',
    '.st-chart .last-label{fill:var(--ink);font-size:11px;font-weight:600}',
    /* prévision */
    '.st-forecast{max-width:640px;margin:0 auto;display:grid;grid-template-columns:repeat(7,1fr);gap:6px;align-items:end;height:140px}',
    '.st-fcol{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:4px}',
    '.st-fcol__n{font-size:.75rem;font-variant-numeric:tabular-nums;color:var(--ink-2);font-weight:600}',
    '.st-fcol__bar{width:100%;max-width:36px;background:var(--blue);border-radius:6px 6px 3px 3px;min-height:2px;transition:height .5s cubic-bezier(.2,.7,.2,1)}',
    '.st-fcol--today .st-fcol__bar{background:var(--accent)}',
    '.st-fcol__d{font-size:.6875rem;color:var(--muted);text-transform:lowercase}',
    /* par type */
    '.st-kinds{width:100%;border-collapse:collapse;font-size:.875rem;font-variant-numeric:tabular-nums}',
    '.st-kinds th{font-size:.6875rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);text-align:left;font-weight:600;padding:4px 6px;border-bottom:1px solid var(--line)}',
    '.st-kinds td{padding:6px;border-bottom:1px solid var(--line)}',
    '.st-kinds tr:last-child td{border-bottom:0}',
    '.st-kinds .num{text-align:right}',
    '.st-kinds .bar{display:block;height:5px;background:var(--surface-3);border-radius:999px;overflow:hidden;min-width:60px}',
    '.st-kinds .bar__fill{display:block;height:100%;background:var(--ok);border-radius:999px}',
    '.st-kinds .bar__fill.is-warn{background:var(--warn)}.st-kinds .bar__fill.is-bad{background:var(--bad)}',
    /* badges */
    '.st-badges{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}',
    '.st-badge{display:flex;min-width:0}.st-badge>span:last-child{min-width:0}.st-badge{gap:10px;align-items:flex-start;padding:10px;border-radius:var(--r-s);background:var(--surface-2);min-height:44px}',
    '.st-badge__ico{flex:0 0 32px;width:32px;height:32px;border-radius:999px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent)}',
    '.st-badge__ico svg{width:18px;height:18px}',
    '.st-badge__t{display:block;font-size:.8125rem;font-weight:600;line-height:1.25}',
    '.st-badge__c{display:block;font-size:.75rem;color:var(--muted);line-height:1.3;margin-top:2px}',
    '.st-badge.is-locked{opacity:.6}.st-badge.is-locked .st-badge__ico{background:var(--surface-3);color:var(--muted)}',
    /* erreurs */
    '.st-errors{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}',
    '.st-errors__n{font:700 1.75rem/1.1 var(--font-display);font-variant-numeric:tabular-nums}',
    '.st-errors__n.is-some{color:var(--accent)}',
    '@media(prefers-reduced-motion:reduce){.st-mbar .bar__fill,.st-fcol__bar{transition:none}}'
  ].join('\n');

  function ensureStyles() {
    if (document.getElementById('cardio-stats-css')) return;
    var st = document.createElement('style');
    st.id = 'cardio-stats-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ---------------------------------------------------------------- sections */

  function section(title, bodyEl, headExtra) {
    return h('section', { class: 'card st-section' },
      h('div', { class: 'st-section__head' }, h('h2', {}, title), headExtra || null),
      bodyEl);
  }

  function tile(label, num, sub, accent) {
    return h('div', { class: 'tile' },
      h('span', { class: 'tile__label' }, label),
      h('span', { class: 'tile__num' + (accent ? ' tile__num--accent' : '') }, num),
      sub ? h('span', { class: 'tile__sub' }, sub) : null);
  }

  /* (a) tuiles */
  function renderTiles() {
    var tot = totalDaily(), r30 = rangeDaily(30), streak = getStreak(), xp = getXp(), lvl = getLevel(xp);
    var rate = r30.reviews ? r30.correct / r30.reviews : null;
    var toNext = Math.max(0, lvl.nextXp - xp);
    return h('div', { class: 'st-tiles' },
      tile('Cartes revues', fmtInt(tot.reviews), tot.reviews ? 'au total' : 'lance ta première session'),
      tile('Réussite 30 j', rate === null ? '—' : fmtPct(rate), r30.reviews ? fmtInt(r30.reviews) + ' cartes' : 'aucune carte ce mois'),
      tile('Temps total', fmtDuration(tot.ms), r30.ms ? fmtDuration(r30.ms) + ' sur 30 j' : null),
      tile('Série', streak.current + ' j', 'record : ' + streak.best + ' j', streak.current > 0),
      tile('Niveau ' + lvl.n, lvl.name, fmtInt(xp) + ' XP · encore ' + fmtInt(toNext))
    );
  }

  /* (b) maîtrise par item */
  var sortWeakest = false;
  function masteryRows() {
    var items = manifestItems(), now = Date.now(), all = cards();
    var dueByItem = {};
    Object.keys(all).forEach(function (id) {
      if (isDue(all[id], now)) { var it = itemOfCard(id); if (it) dueByItem[it] = (dueByItem[it] || 0) + 1; }
    });
    return items.map(function (it) {
      var num = String(it.num), m = getMastery(num);
      return { it: it, num: num, m: m, due: dueByItem[num] || 0 };
    });
  }
  function renderMastery(container) {
    container.textContent = '';
    var rows = masteryRows();
    if (!rows.length) { container.appendChild(h('p', { class: 'st-empty' }, 'Aucun item disponible pour le moment.')); return; }
    if (sortWeakest) rows.sort(function (a, b) { return (a.m.all || 0) - (b.m.all || 0); });
    var lastSection = null;
    rows.forEach(function (r) {
      if (!sortWeakest && r.it.section !== lastSection) {
        lastSection = r.it.section;
        container.appendChild(h('div', { class: 'st-sect-label' }, 'Section ' + r.it.section + (r.it.sectionTitle ? ' · ' + r.it.sectionTitle : '')));
      }
      container.appendChild(masteryRow(r));
    });
  }
  function masteryRow(r) {
    var go = function () { navigate('#/item/' + r.num); };
    return h('button', { class: 'st-mrow', type: 'button', dataset: { item: r.num }, on: { click: go } },
      h('span', { class: 'st-mrow__num' }, r.num),
      h('span', { class: 'st-mrow__body' },
        h('span', { class: 'st-mrow__title' }, r.it.short || r.it.title || ('Item ' + r.num)),
        h('span', { class: 'st-mrow__bars' }, masteryBar('A', r.m.A), masteryBar('B', r.m.B))),
      h('span', { class: 'st-mrow__due' + (r.due ? ' is-due' : '') },
        h('strong', {}, String(r.due)), r.due > 1 ? 'dues' : 'due'));
  }
  function masteryBar(rank, v) {
    var pct = Math.round(Math.max(0, Math.min(1, v || 0)) * 100);
    return h('span', { class: 'st-mbar st-mbar--' + rank },
      h('span', { class: 'st-mbar__k' }, rank),
      h('span', { class: 'bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Rang ' + rank },
        h('span', { class: 'bar__fill', style: 'width:' + pct + '%' })),
      h('span', {}, pct + ' %'));
  }

  /* (c) heatmap 12 semaines */
  function renderHeat() {
    var d = daily(), today = parseKey(todayKey()), tKey = dateKey(today);
    // Colonne = semaine (lundi → dimanche) ; la dernière colonne contient aujourd'hui.
    var dow = (today.getDay() + 6) % 7; // 0 = lundi
    var lastMonday = addDays(today, -dow);
    var firstMonday = addDays(lastMonday, -7 * 11);
    var max = 0, counts = [];
    for (var w = 0; w < 12; w++) {
      counts[w] = [];
      for (var r = 0; r < 7; r++) {
        var day = addDays(firstMonday, w * 7 + r), e = d[dateKey(day)];
        var n = e ? (e.reviews || 0) : 0;
        counts[w][r] = { day: day, n: n };
        if (day <= today && n > max) max = n;
      }
    }
    var grid = h('div', { class: 'heat', role: 'img', 'aria-label': 'Activité des 12 dernières semaines' });
    grid.appendChild(h('span', {}));                    // coin vide
    var seenMonth = -1;
    for (w = 0; w < 12; w++) {
      var mon = counts[w][0].day, label = '';
      if (mon.getMonth() !== seenMonth) { seenMonth = mon.getMonth(); label = MONTHS_SHORT[seenMonth]; }
      grid.appendChild(h('span', { class: 'heat__month', style: 'grid-column:' + (w + 2) }, label));
    }
    for (r = 0; r < 7; r++) {
      grid.appendChild(h('span', { class: 'heat__wd', style: 'grid-row:' + (r + 2) }, (r % 2 === 0) ? WEEKDAYS[r] : ''));
      for (w = 0; w < 12; w++) {
        var c = counts[w][r], future = c.day > today;
        var level = future || !c.n ? 0 : Math.max(1, Math.min(4, Math.ceil(c.n / max * 4)));
        var key = dateKey(c.day);
        grid.appendChild(h('span', {
          class: 'heat__cell' + (key === tKey ? ' is-today' : ''),
          dataset: { l: String(level) },
          style: 'grid-row:' + (r + 2) + ';grid-column:' + (w + 2) + (future ? ';opacity:.35' : ''),
          title: future ? '' : fmtDayLong(c.day) + ' · ' + c.n + ' ' + (c.n > 1 ? 'cartes' : 'carte')
        }));
      }
    }
    var legend = h('div', { class: 'st-legend' }, 'moins',
      [0, 1, 2, 3, 4].map(function (l) { return h('span', { class: 'heat__cell', dataset: { l: String(l) } }); }), 'plus');
    return h('div', {}, h('div', { class: 'st-heatwrap' }, grid), legend);
  }

  /* (d) courbe de rétention (SVG maison) */
  function renderRetention() {
    var d = daily(), today = parseKey(todayKey());
    var pts = [];
    for (var i = 29; i >= 0; i--) {
      var day = addDays(today, -i), e = d[dateKey(day)];
      pts.push({ day: day, v: e && e.reviews ? (e.correct || 0) / e.reviews : null, n: e ? e.reviews || 0 : 0 });
    }
    var withData = pts.filter(function (p) { return p.v !== null; });
    if (withData.length < 2) {
      return h('p', { class: 'st-empty' }, 'La courbe apparaît dès que tu as révisé sur deux jours différents.');
    }
    var W = 320, H = 150, L = 34, R = 12, T = 12, B = 24;
    var iw = W - L - R, ih = H - T - B;
    var x = function (i) { return L + (i / 29) * iw; };
    var y = function (v) { return T + (1 - v) * ih; };
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('class', 'st-chart');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Pourcentage de bonnes réponses par jour sur 30 jours');
    function el(tag, attrs, text) {
      var n = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      if (text != null) n.textContent = text;
      svg.appendChild(n);
      return n;
    }
    [0, 0.25, 0.5, 0.75, 1].forEach(function (g) {
      el('line', { class: 'grid', x1: L, x2: W - R, y1: y(g), y2: y(g) });
      if (g === 0 || g === 0.5 || g === 1) el('text', { class: 'axis', x: L - 5, y: y(g) + 3.5, 'text-anchor': 'end' }, Math.round(g * 100) + ' %');
    });
    el('text', { class: 'axis', x: L, y: H - 8 }, fmtDayShort(pts[0].day));
    el('text', { class: 'axis', x: W - R, y: H - 8, 'text-anchor': 'end' }, "auj.");
    // Tracé : segments continus seulement entre jours consécutifs avec données (les jours vides coupent la ligne).
    var path = '', area = '', prevHas = false;
    pts.forEach(function (p, i) {
      if (p.v === null) { prevHas = false; return; }
      var px = x(i).toFixed(1), py = y(p.v).toFixed(1);
      path += (prevHas ? 'L' : 'M') + px + ' ' + py + ' ';
      prevHas = true;
    });
    // Aire entre les points ayant des données (interpolation sur les trous pour la lisibilité).
    area = 'M' + x(withData[0] === pts[0] ? 0 : pts.indexOf(withData[0])).toFixed(1) + ' ' + y(0).toFixed(1) + ' ';
    withData.forEach(function (p) { area += 'L' + x(pts.indexOf(p)).toFixed(1) + ' ' + y(p.v).toFixed(1) + ' '; });
    area += 'L' + x(pts.indexOf(withData[withData.length - 1])).toFixed(1) + ' ' + y(0).toFixed(1) + ' Z';
    el('path', { class: 'area', d: area });
    el('path', { class: 'line', d: path.trim() });
    // Points isolés (sans voisin) sinon invisibles ; dernier point mis en avant.
    var last = withData[withData.length - 1], lastIdx = pts.indexOf(last);
    pts.forEach(function (p, i) {
      if (p.v === null || i === lastIdx) return;
      var isolated = (i === 0 || pts[i - 1].v === null) && (i === 29 || pts[i + 1].v === null);
      if (isolated) el('circle', { class: 'dot', cx: x(i), cy: y(p.v), r: 2.5 });
    });
    el('circle', { class: 'dot--last', cx: x(lastIdx), cy: y(last.v), r: 4 });
    var lx = x(lastIdx), anchor = lx > W - 50 ? 'end' : 'start';
    el('text', { class: 'last-label', x: lx + (anchor === 'end' ? -8 : 8), y: y(last.v) - 8, 'text-anchor': anchor },
      Math.round(last.v * 100) + ' %');
    var t = document.createElementNS(NS, 'title');
    t.textContent = withData.map(function (p) { return fmtDayLong(p.day) + ' : ' + Math.round(p.v * 100) + ' % (' + p.n + ')'; }).join(' · ');
    svg.insertBefore(t, svg.firstChild);
    return svg;
  }

  /* (e) prévision 7 jours */
  function renderForecast() {
    var f = getForecast(7), max = Math.max(1, Math.max.apply(null, f)), today = parseKey(todayKey());
    var cols = f.map(function (n, i) {
      var day = addDays(today, i);
      var label = i === 0 ? "auj." : i === 1 ? 'dem.' : WEEKDAYS[(day.getDay() + 6) % 7];
      var hPct = Math.round(n / max * 100);
      return h('div', { class: 'st-fcol' + (i === 0 ? ' st-fcol--today' : ''), title: fmtDayLong(day) + ' · ' + n + ' ' + (n > 1 ? 'cartes' : 'carte') },
        h('span', { class: 'st-fcol__n' }, String(n)),
        h('span', { class: 'st-fcol__bar', style: 'height:' + Math.max(2, hPct * 0.9) + '%' }),
        h('span', { class: 'st-fcol__d' }, label));
    });
    var total = f.reduce(function (a, b) { return a + b; }, 0);
    return h('div', {},
      h('div', { class: 'st-forecast' }, cols),
      h('p', { class: 'st-empty', style: 'margin:8px 0 0' },
        total ? fmtInt(total) + ' cartes prévues sur 7 jours' + (f[0] ? ', dont ' + f[0] + ' à faire aujourd’hui.' : '.')
          : 'Rien de prévu : commence des cartes nouvelles pour lancer la répétition espacée.'));
  }

  /* (f) répartition par type */
  function renderKinds() {
    var all = cards(), agg = {}, srs = CARDIO.srs, GOOD = (srs && srs.GRADES && srs.GRADES.GOOD) || 3;
    KINDS.forEach(function (k) { agg[k] = { n: 0, ok: 0, cards: 0 }; });
    Object.keys(all).forEach(function (id) {
      var cs = all[id], hist = cs && Array.isArray(cs.hist) ? cs.hist : [];
      if (!hist.length) return;
      var k = kindOf(id);
      if (!agg[k]) agg[k] = { n: 0, ok: 0, cards: 0 };
      agg[k].cards++;
      hist.forEach(function (e) {
        var grade = Array.isArray(e) ? e[1] : e && e.grade, score = Array.isArray(e) ? e[2] : e && e.score;
        var ok = typeof grade === 'number' ? grade >= GOOD : (typeof score === 'number' ? score >= 0.99 : false);
        agg[k].n++; if (ok) agg[k].ok++;
      });
    });
    var rows = KINDS.filter(function (k) { return agg[k].n > 0; });
    if (!rows.length) return h('p', { class: 'st-empty' }, 'Aucune tentative enregistrée pour l’instant.');
    return h('div', { style: 'overflow-x:auto' },
      h('table', { class: 'st-kinds' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Type'), h('th', { class: 'num' }, 'Tentatives'), h('th', { class: 'num' }, 'Réussite'), h('th', {}, ''))),
        h('tbody', {}, rows.map(function (k) {
          var a = agg[k], rate = a.ok / a.n, pct = Math.round(rate * 100);
          var cls = rate >= 0.8 ? '' : rate >= 0.5 ? ' is-warn' : ' is-bad';
          return h('tr', {},
            h('td', {}, h('span', { class: 'pill pill--kind' }, KIND_LABEL[k] || k)),
            h('td', { class: 'num' }, fmtInt(a.n)),
            h('td', { class: 'num' }, pct + ' %'),
            h('td', {}, h('span', { class: 'bar' }, h('span', { class: 'bar__fill' + cls, style: 'width:' + pct + '%' }))));
        }))),
      h('p', { class: 'st-empty', style: 'margin:6px 0 0;font-size:.75rem' }, 'Sur les 10 dernières tentatives de chaque carte.'));
  }

  /* (g) badges */
  function badgeDefs() {
    var defs = [
      { id: 'first-session', t: 'Première session', c: 'Termine une première session de révision.', i: 'play' },
      { id: 'streak-3', t: 'Série de 3', c: 'Atteins ton objectif 3 jours d’affilée.', i: 'flame' },
      { id: 'streak-7', t: 'Série de 7', c: 'Atteins ton objectif 7 jours d’affilée.', i: 'flame' },
      { id: 'streak-30', t: 'Série de 30', c: 'Atteins ton objectif 30 jours d’affilée.', i: 'flame' },
      { id: 'streak-100', t: 'Série de 100', c: 'Atteins ton objectif 100 jours d’affilée.', i: 'flame' },
      { id: 'cards-100', t: '100 cartes', c: 'Revois 100 cartes au total.', i: 'flash' },
      { id: 'cards-500', t: '500 cartes', c: 'Revois 500 cartes au total.', i: 'flash' },
      { id: 'cards-2000', t: '2 000 cartes', c: 'Revois 2 000 cartes au total.', i: 'flash' },
      { id: 'all-A-90', t: 'Rang A à 90 %', c: 'Maîtrise ≥ 90 % du rang A sur tous les items.', i: 'trophy' },
      { id: 'errors-cleared', t: 'Cahier vidé', c: 'Refais toutes les cartes du cahier d’erreurs.', i: 'check' },
      { id: 'exam-80', t: 'Examen blanc 80 %', c: 'Obtiens ≥ 80 % à un examen blanc.', i: 'target' },
      { id: 'early-bird', t: 'Lève-tôt', c: 'Révise avant 7 h du matin.', i: 'clock' },
      { id: 'night-owl', t: 'Oiseau de nuit', c: 'Révise après 23 h.', i: 'clock' }
    ];
    manifestItems().forEach(function (it) {
      defs.push({ id: 'item-mastered-' + it.num, t: 'Item ' + it.num + ' maîtrisé',
        c: (it.short || it.title) + ' : rang A ≥ 90 % avec 80 % des cartes vues.', i: 'star' });
    });
    return defs;
  }
  function renderBadges() {
    var have = state().badges || [], defs = badgeDefs();
    var unlocked = defs.filter(function (d) { return have.indexOf(d.id) >= 0; });
    var locked = defs.filter(function (d) { return have.indexOf(d.id) < 0; });
    var grid = h('div', { class: 'st-badges' }, unlocked.concat(locked).map(function (d) {
      var on = have.indexOf(d.id) >= 0;
      return h('div', { class: 'st-badge' + (on ? '' : ' is-locked'), title: on ? 'Débloqué' : 'À débloquer' },
        h('span', { class: 'st-badge__ico', html: icon(d.i) }),
        h('span', {}, h('span', { class: 'st-badge__t' }, d.t), h('span', { class: 'st-badge__c' }, d.c)));
    }));
    return h('div', {},
      h('p', { class: 'st-empty', style: 'margin:0 0 8px' }, unlocked.length + ' / ' + defs.length + ' badges débloqués'),
      grid);
  }

  /* (h) cahier d'erreurs */
  function renderErrors() {
    var errs = state().errors || {}, n = Object.keys(errs).length;
    var byItem = {};
    Object.keys(errs).forEach(function (id) { var it = itemOfCard(id); if (it) byItem[it] = (byItem[it] || 0) + 1; });
    var nItems = Object.keys(byItem).length;
    return h('div', { class: 'st-errors' },
      h('div', {},
        h('span', { class: 'st-errors__n' + (n ? ' is-some' : '') }, fmtInt(n)),
        h('div', { class: 'st-empty', style: 'padding:0' },
          n ? (n > 1 ? 'cartes ratées' : 'carte ratée') + ' à retravailler' + (nItems ? ' sur ' + nItems + ' item' + (nItems > 1 ? 's' : '') : '')
            : 'Aucune erreur en attente. Continue comme ça.')),
      h('button', { class: 'btn ' + (n ? 'btn--primary' : 'btn--secondary'), type: 'button', id: 'stats-errors-go',
        on: { click: function () { navigate('#/errors'); } } }, n ? 'Refaire mes erreurs' : 'Voir le cahier'));
  }

  function navigate(hash) {
    var r = CARDIO.router;
    if (r && typeof r.go === 'function') { try { r.go(hash); return; } catch (e) { /* repli */ } }
    location.hash = hash;
  }

  /* ------------------------------------------------------------------ render */

  function render() {
    ensureStyles();
    var page = h('div', { class: 'page page--wide', id: 'stats-page' });
    var slots = {};
    function slot(name) { return (slots[name] = h('div', { dataset: { slot: name } })); }

    var sortBtn = h('button', {
      class: 'chip' + (sortWeakest ? ' is-on' : ''), type: 'button', id: 'stats-sort-weak', 'aria-pressed': sortWeakest ? 'true' : 'false',
      on: { click: function () {
        sortWeakest = !sortWeakest;
        sortBtn.classList.toggle('is-on', sortWeakest);
        sortBtn.setAttribute('aria-pressed', sortWeakest ? 'true' : 'false');
        renderMastery(slots.mastery);
      } }
    }, 'Les plus faibles d’abord');

    page.appendChild(slot('tiles'));
    page.appendChild(section('Maîtrise par item', h('div', { class: 'st-mastery' }, slot('mastery')), sortBtn));
    page.appendChild(section('Activité', slot('heat')));
    page.appendChild(section('Rétention', slot('retention')));
    page.appendChild(section('À venir', slot('forecast')));
    page.appendChild(section('Par type', slot('kinds')));
    page.appendChild(section('Badges', slot('badges')));
    page.appendChild(section('Cahier d’erreurs', slot('errors')));

    function fill() {
      var s = store();
      if (!s || !s.state) {
        console.warn('[stats] store indisponible');
        slots.tiles.textContent = '';
        slots.tiles.appendChild(h('p', { class: 'st-empty' }, 'Tes statistiques ne sont pas encore disponibles. Réessaie dans un instant.'));
        return;
      }
      var parts = { tiles: renderTiles, heat: renderHeat, retention: renderRetention, forecast: renderForecast,
        kinds: renderKinds, badges: renderBadges, errors: renderErrors };
      Object.keys(parts).forEach(function (k) {
        var el;
        try { el = parts[k](); } catch (e) { console.warn('[stats] section ' + k, e); el = h('p', { class: 'st-empty' }, 'Section indisponible pour le moment.'); }
        slots[k].textContent = '';
        slots[k].appendChild(el);
      });
      try { renderMastery(slots.mastery); } catch (e) { console.warn('[stats] mastery', e); }
    }
    fill();

    // Rafraîchissement sur 'store:change' (regroupé), désabonnement quand la page quitte le DOM.
    var u = util(), timer = null;
    if (typeof u.on === 'function') {
      var handler = function () {
        if (!page.isConnected) {
          if (page.dataset.mounted === '1' && typeof u.off === 'function') u.off('store:change', handler);
          return;
        }
        page.dataset.mounted = '1';
        clearTimeout(timer);
        timer = setTimeout(function () { if (page.isConnected) fill(); }, 250);
      };
      u.on('store:change', handler);
      // Marque « montée » dès que possible pour permettre le désabonnement propre plus tard.
      setTimeout(function () { if (page.isConnected) page.dataset.mounted = '1'; }, 500);
    }
    return page;
  }

  CARDIO.views.stats = { render: render, title: 'Stats', tab: 'stats' };
})();
