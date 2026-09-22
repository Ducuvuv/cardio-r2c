/* CardioR2C — views/home.js
 * Tableau de bord quotidien (SPEC §6). Ne charge jamais le contenu des items : uniquement
 * le manifest (registry) et la progression (store).
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

  /* Repli minimal si CARDIO.util.h est absent (jamais au chargement, seulement au rendu). */
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
    if (!h.warned) { h.warned = true; console.warn('[home] CARDIO.util.h absent : rendu de repli'); }
    return fallbackH.apply(null, [tag, attrs].concat(kids));
  }

  function esc(s) {
    const u = util();
    if (typeof u.esc === 'function') return u.esc(String(s == null ? '' : s));
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function icon(name) {
    const u = util();
    if (typeof u.icon === 'function') { try { return u.icon(name) || ''; } catch (e) { /* ignore */ } }
    return '';
  }

  function iconEl(name, cls) {
    return h('span', { class: 'ico ' + (cls || ''), 'aria-hidden': 'true', html: icon(name) });
  }

  function plural(n, s, p) {
    const u = util();
    if (typeof u.plural === 'function') { try { return u.plural(n, s, p); } catch (e) { /* ignore */ } }
    return n + ' ' + (n > 1 ? (p || s + 's') : s);
  }

  function pct(x) { return Math.round(Math.max(0, Math.min(1, Number(x) || 0)) * 100); }

  /* ---------- Lecture du store (chaque appel est protégé) ---------- */

  function safe(fn, fallback) {
    try { const v = fn(); return v === undefined ? fallback : v; } catch (e) { console.warn('[home]', e); return fallback; }
  }

  function state() { const s = store(); return (s && s.state) || {}; }
  function profile() { return state().profile || { dailyGoal: 30 }; }

  function todayStats() {
    const s = store();
    const t = s && typeof s.todayStats === 'function' ? safe(function () { return s.todayStats(); }, null) : null;
    if (t) return t;
    const u = util();
    const day = typeof u.today === 'function' ? u.today() : new Date().toISOString().slice(0, 10);
    return (state().daily || {})[day] || { reviews: 0, newCards: 0, correct: 0, score: 0, ms: 0, xp: 0 };
  }

  function streak() {
    const s = store();
    const v = s && typeof s.streak === 'function' ? safe(function () { return s.streak(); }, null) : null;
    if (v && typeof v === 'object') return v;
    if (typeof v === 'number') return { current: v, best: v };
    return state().streak || { current: 0, best: 0 };
  }

  function xp() {
    const s = store();
    const v = s && typeof s.xp === 'function' ? safe(function () { return s.xp(); }, null) : null;
    return typeof v === 'number' ? v : (Number(state().xp) || 0);
  }

  const LEVEL_NAMES = ['Externe', 'Externe confirmé', 'Interne', 'Interne senior', 'Chef de clinique',
    'Praticien', 'Maître de conférences', 'Professeur'];

  function level() {
    const s = store();
    const total = xp();
    const v = s && typeof s.level === 'function' ? safe(function () { return s.level(); }, null) : null;
    const n = typeof v === 'number' ? v : (v && typeof v === 'object' && v.level) ? v.level
      : Math.floor(Math.sqrt(total / 100)) + 1;
    const name = (v && typeof v === 'object' && v.name) ? v.name : LEVEL_NAMES[Math.min(n, LEVEL_NAMES.length) - 1];
    // xp nécessaire pour atteindre le niveau k : 100 (k-1)^2
    const floor = 100 * Math.pow(n - 1, 2);
    const ceil = 100 * Math.pow(n, 2);
    return { level: n, name: name, xp: total, floor: floor, next: ceil, ratio: Math.max(0, Math.min(1, (total - floor) / (ceil - floor))) };
  }

  function mastery(num) {
    const s = store();
    const v = s && typeof s.mastery === 'function' ? safe(function () { return s.mastery(num); }, null) : null;
    return v && typeof v === 'object' ? v : { A: 0, B: 0, all: 0, seen: 0, total: 0 };
  }

  function dueIds() {
    const s = store();
    const v = s && typeof s.dueCards === 'function' ? safe(function () { return s.dueCards(Date.now()); }, null) : null;
    if (Array.isArray(v)) return v;
    // Repli : lecture directe des cartes du store.
    const now = Date.now();
    const cards = state().cards || {};
    return Object.keys(cards).filter(function (id) {
      const c = cards[id];
      return c && c.due && c.due <= now && c.state !== 'new';
    });
  }

  /* Prévision des cartes dues sur n jours → [{date:'YYYY-MM-DD', count}] */
  function forecast(days) {
    const s = store();
    const v = s && typeof s.forecast === 'function' ? safe(function () { return s.forecast(days); }, null) : null;
    const out = [];
    const start = new Date(); start.setHours(0, 0, 0, 0);
    function dayKey(d) {
      const z = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
    }
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getTime()); d.setDate(d.getDate() + i);
      out.push({ date: dayKey(d), day: d, count: 0 });
    }
    if (Array.isArray(v) && v.length) {
      v.forEach(function (entry, i) {
        if (typeof entry === 'number') { if (out[i]) out[i].count = entry; return; }
        if (!entry || typeof entry !== 'object') return;
        const key = entry.date || entry.day;
        const cnt = Number(entry.count !== undefined ? entry.count : entry.due) || 0;
        const slot = key ? out.find(function (o) { return o.date === key; }) : out[i];
        if (slot) slot.count = cnt;
      });
      return out;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.forEach(function (o) { o.count = Number(v[o.date]) || 0; });
      return out;
    }
    // Repli : calcul direct depuis les cartes du store (les retards comptent pour aujourd'hui).
    const cards = state().cards || {};
    const end = start.getTime() + days * 86400000;
    Object.keys(cards).forEach(function (id) {
      const c = cards[id];
      if (!c || !c.due || c.state === 'new' || c.due >= end) return;
      const idx = Math.max(0, Math.floor((c.due - start.getTime()) / 86400000));
      if (out[idx]) out[idx].count++;
    });
    return out;
  }

  function totalReviews() {
    const daily = state().daily || {};
    return Object.keys(daily).reduce(function (n, k) { return n + (Number(daily[k].reviews) || 0); }, 0);
  }

  /* ---------- Badges (SPEC §6) : prochain badge à débloquer ---------- */

  function nextBadge(availableItems) {
    const earned = state().badges || [];
    const has = function (id) { return earned.indexOf(id) >= 0; };
    const st = streak();
    const reviews = totalReviews();
    const sessions = (state().sessions || []).length;
    const errors = Object.keys(state().errors || {}).length;
    const candidates = [];
    if (!has('first-session')) candidates.push({ id: 'first-session', label: 'Première session', desc: 'Termine une première session de révision.', progress: sessions > 0 ? 1 : 0, prio: 0 });
    [3, 7, 30, 100].forEach(function (n) {
      if (!has('streak-' + n)) candidates.push({ id: 'streak-' + n, label: n + ' jours d’affilée', desc: 'Atteins ton objectif quotidien ' + n + ' jours de suite.', progress: Math.min(1, (st.current || 0) / n), prio: 1 });
    });
    [100, 500, 2000].forEach(function (n) {
      if (!has('cards-' + n)) candidates.push({ id: 'cards-' + n, label: n + ' cartes', desc: 'Révise ' + n + ' cartes au total.', progress: Math.min(1, reviews / n), prio: 2 });
    });
    if (!has('exam-80')) candidates.push({ id: 'exam-80', label: 'Examen blanc à 80 %', desc: 'Obtiens 80 % ou plus à un examen blanc.', progress: 0, prio: 4 });
    if (!has('errors-cleared') && errors > 0) candidates.push({ id: 'errors-cleared', label: 'Cahier vidé', desc: 'Refais toutes tes erreurs jusqu’à vider le cahier.', progress: 0, prio: 4 });
    // Item le plus proche de la maîtrise (rang A ≥ 0,9)
    let bestItem = null;
    availableItems.forEach(function (it) {
      if (has('item-mastered-' + it.num)) return;
      const m = mastery(it.num);
      if (!m.seen) return;
      if (!bestItem || m.A > bestItem.A) bestItem = { num: it.num, short: it.short, A: m.A };
    });
    if (bestItem) candidates.push({ id: 'item-mastered-' + bestItem.num, label: bestItem.short + ' maîtrisé', desc: 'Maîtrise le rang A de l’item ' + bestItem.num + ' à 90 %.', progress: Math.min(1, bestItem.A / 0.9), prio: 3 });
    if (!has('all-A-90')) candidates.push({ id: 'all-A-90', label: 'Tout le rang A à 90 %', desc: 'Maîtrise le rang A de tous les items.', progress: 0, prio: 5 });
    if (!candidates.length) return null;
    // Le plus avancé d'abord, à progression égale le plus accessible.
    candidates.sort(function (a, b) { return (b.progress - a.progress) || (a.prio - b.prio); });
    // Ne propose pas un badge à 100 % non encore attribué par le store : prends le suivant.
    return candidates.find(function (c) { return c.progress < 1; }) || candidates[0];
  }

  /* ---------- Rendu des composants ---------- */

  function ringSvg(ratio, size, stroke) {
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const off = c * (1 - Math.max(0, Math.min(1, ratio)));
    return '<svg class="ring__svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--surface-3)" stroke-width="' + stroke + '"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--accent)" stroke-width="' + stroke + '" stroke-linecap="round"' +
      ' stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')" class="ring__fill"/></svg>';
  }

  function bar(ratio, mod) {
    const fill = h('div', { class: 'bar__fill' });
    fill.style.width = pct(ratio) + '%';
    return h('div', { class: 'bar' + (mod ? ' ' + mod : ''), role: 'progressbar', 'aria-valuenow': String(pct(ratio)), 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill);
  }

  function greeting() {
    const hr = new Date().getHours();
    const hello = hr >= 18 || hr < 5 ? 'Bonsoir' : 'Bonjour';
    const name = (profile().name || '').trim();
    const st = streak();
    let line;
    if (st.current >= 2) line = st.current + ' jours d’affilée, continue.';
    else if (st.current === 1) line = 'Premier jour de série : reviens demain pour la garder.';
    else if (st.best > 0) line = 'La série est à zéro. Une session suffit pour la relancer.';
    else line = 'Quelques cartes chaque jour, c’est tout ce qu’il faut.';
    return h('header', { class: 'home__greeting' },
      h('h1', { class: 'home__title' }, hello + (name ? ' ' + name : '') + '.'),
      h('p', { class: 'home__sub' }, line));
  }

  function dailyBlock(today, goal, due, availableItems) {
    const done = Number(today.reviews) || 0;
    const ratio = goal > 0 ? done / goal : 0;
    const reached = goal > 0 && done >= goal;
    const ring = h('div', { class: 'ring home__ring', html: ringSvg(ratio, 112, 10) },
      h('div', { class: 'ring__label' },
        h('span', { class: 'ring__num' }, String(done)),
        h('span', { class: 'ring__den' }, '/ ' + goal)));
    const lines = [];
    lines.push(h('p', { class: 'home__due' },
      due > 0
        ? [h('strong', {}, String(due)), ' ' + (due > 1 ? 'cartes à revoir' : 'carte à revoir') + ' maintenant']
        : 'Aucune carte en attente. Tout est à jour.'));
    lines.push(h('p', { class: 'home__daymsg' },
      reached ? 'Objectif du jour atteint. Chaque carte en plus renforce ta série.'
        : done > 0 ? 'Encore ' + plural(goal - done, 'carte', 'cartes') + ' pour valider la journée.'
          : 'Objectif : ' + plural(goal, 'carte', 'cartes') + ' aujourd’hui.'));
    const ctas = [];
    if (due > 0) {
      ctas.push(h('a', { class: 'btn btn--primary btn--block', href: '#/review?mode=smart&autostart=1' }, iconEl('play'), 'Réviser maintenant'));
      ctas.push(h('a', { class: 'btn btn--secondary btn--block', href: '#/review' }, 'Choisir une session'));
    } else {
      const hasContent = availableItems.length > 0;
      ctas.push(h('a', { class: 'btn btn--primary btn--block', href: hasContent ? '#/review?mode=smart&autostart=1' : '#/items' }, iconEl('plus'), 'Nouveau : apprendre des cartes'));
      ctas.push(h('a', { class: 'btn btn--secondary btn--block', href: '#/review' }, 'Choisir une session'));
    }
    return h('section', { class: 'card card--raised home__daily' },
      h('div', { class: 'home__daily-row' }, ring, h('div', { class: 'home__daily-text' }, lines)),
      h('div', { class: 'home__ctas' }, ctas));
  }

  function streakXpBlock() {
    const st = streak();
    const lv = level();
    const flame = h('div', { class: 'tile home__tile home__tile--streak' + (st.current > 0 ? ' is-on' : '') },
      h('div', { class: 'tile__label' }, 'Série'),
      h('div', { class: 'tile__num' }, iconEl('flame', 'home__flame'), h('span', {}, String(st.current || 0))),
      h('div', { class: 'tile__foot' }, 'Record : ' + (st.best || 0) + ' j'));
    const xpTile = h('div', { class: 'tile home__tile home__tile--xp' },
      h('div', { class: 'tile__label' }, 'Niveau ' + lv.level + ' · ' + lv.name),
      h('div', { class: 'tile__num' }, h('span', {}, String(lv.xp)), h('span', { class: 'tile__unit' }, ' XP')),
      bar(lv.ratio, 'bar--xp'),
      h('div', { class: 'tile__foot' }, 'Prochain niveau à ' + lv.next + ' XP'));
    return h('div', { class: 'home__tiles' }, flame, xpTile);
  }

  function weakestBlock(availableItems) {
    const started = availableItems.map(function (it) { return { it: it, m: mastery(it.num) }; })
      .filter(function (x) { return x.m.seen > 0; });
    let list, title, hint;
    if (started.length) {
      started.sort(function (a, b) { return (a.m.all - b.m.all) || (a.m.A - b.m.A); });
      list = started.slice(0, 3);
      title = 'À renforcer';
      hint = 'Tes 3 items les moins maîtrisés.';
    } else {
      list = availableItems.slice(0, 3).map(function (it) { return { it: it, m: mastery(it.num) }; });
      title = 'Par où commencer';
      hint = availableItems.length ? 'Trois items pour démarrer dans l’ordre du Collège.' : 'Le contenu arrive : reviens bientôt.';
    }
    const rows = list.map(function (x) {
      return h('a', { class: 'home__weak', href: '#/item/' + x.it.num },
        h('div', { class: 'home__weak-head' },
          h('span', { class: 'home__weak-num' }, String(x.it.num)),
          h('span', { class: 'home__weak-title' }, x.it.short),
          h('span', { class: 'home__weak-pct' }, pct(x.m.all) + ' %')),
        h('div', { class: 'home__weak-bars' },
          h('div', { class: 'home__weak-bar' }, h('span', { class: 'pill pill--A' }, 'A'), bar(x.m.A, 'bar--A')),
          h('div', { class: 'home__weak-bar' }, h('span', { class: 'pill pill--B' }, 'B'), bar(x.m.B, 'bar--B'))));
    });
    return h('section', { class: 'card home__section' },
      h('div', { class: 'home__sec-head' }, h('h2', { class: 'home__h2' }, title), h('a', { class: 'home__more', href: '#/items' }, 'Tous les items')),
      h('p', { class: 'home__hint' }, hint),
      rows.length ? h('div', { class: 'home__weak-list' }, rows) : null);
  }

  function badgeBlock(availableItems) {
    const b = nextBadge(availableItems);
    const earned = (state().badges || []).length;
    if (!b) {
      return h('section', { class: 'card home__section home__badge' },
        h('div', { class: 'home__badge-ico', html: icon('trophy') }),
        h('div', {}, h('h2', { class: 'home__h2' }, 'Tous les badges débloqués'), h('p', { class: 'home__hint' }, 'Bravo, il ne reste plus qu’à entretenir.')));
    }
    return h('section', { class: 'card home__section home__badge' },
      h('div', { class: 'home__badge-ico', html: icon('trophy') }),
      h('div', { class: 'home__badge-body' },
        h('div', { class: 'home__eyebrow' }, 'Prochain badge' + (earned ? ' · ' + earned + ' obtenu' + (earned > 1 ? 's' : '') : '')),
        h('h2', { class: 'home__h2' }, b.label),
        h('p', { class: 'home__hint' }, b.desc),
        bar(b.progress, 'bar--badge')));
  }

  function chipsBlock() {
    const chips = [
      { label: 'Mes erreurs', href: '#/errors', ico: 'refresh' },
      { label: 'Rang A', href: '#/review?mode=rank&rank=A', ico: 'target' },
      { label: 'Examen blanc', href: '#/review?mode=exam', ico: 'clock' },
      { label: 'ECG du jour', href: '#/ecg?daily=1', ico: 'ecg' },
      { label: 'Arbres', href: '#/trees', ico: 'tree' },
      { label: 'Traitements', href: '#/treatments', ico: 'pill' }
    ];
    const errorsCount = Object.keys(state().errors || {}).length;
    return h('section', { class: 'home__chips-wrap' },
      h('div', { class: 'home__eyebrow' }, 'Accès rapides'),
      h('div', { class: 'home__chips' }, chips.map(function (c) {
        const count = c.href === '#/errors' && errorsCount ? h('span', { class: 'chip__count' }, String(errorsCount)) : null;
        return h('a', { class: 'chip home__chip', href: c.href }, iconEl(c.ico), c.label, count);
      })));
  }

  function forecastBlock() {
    const days = forecast(7);
    const max = Math.max(1, Math.max.apply(null, days.map(function (d) { return d.count; })));
    const names = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
    const cols = days.map(function (d, i) {
      const col = h('div', { class: 'home__fc-col' + (i === 0 ? ' is-today' : '') });
      const barEl = h('div', { class: 'home__fc-bar', title: d.count + ' carte' + (d.count > 1 ? 's' : '') });
      const fill = h('div', { class: 'home__fc-fill' });
      fill.style.height = Math.max(d.count ? 6 : 2, Math.round(d.count / max * 100)) + '%';
      barEl.appendChild(fill);
      col.appendChild(h('div', { class: 'home__fc-n' }, String(d.count)));
      col.appendChild(barEl);
      col.appendChild(h('div', { class: 'home__fc-d' }, i === 0 ? 'auj.' : names[d.day.getDay()]));
      return col;
    });
    const total = days.reduce(function (n, d) { return n + d.count; }, 0);
    return h('section', { class: 'card home__section' },
      h('div', { class: 'home__sec-head' }, h('h2', { class: 'home__h2' }, 'Les 7 prochains jours'), h('a', { class: 'home__more', href: '#/stats' }, 'Stats')),
      h('p', { class: 'home__hint' }, total ? plural(total, 'carte', 'cartes') + ' à revoir cette semaine.' : 'Rien de prévu : lance de nouvelles cartes pour nourrir la file.'),
      h('div', { class: 'home__fc' }, cols));
  }

  /* ---------- Styles propres à la vue (tokens uniquement) ---------- */

  const CSS = [
    '.home__greeting{padding:8px 0 12px}',
    '.home__title{font:700 1.75rem/1.15 var(--font-display);margin:0 0 4px;text-wrap:balance}',
    '.home__sub{margin:0;color:var(--muted)}',
    '.home__daily{margin-bottom:16px}',
    '.home__daily-row{display:flex;gap:16px;align-items:center;margin-bottom:14px}',
    '.home__ring{position:relative;flex:0 0 112px;width:112px;height:112px}',
    '.home__ring .ring__svg{display:block}',
    '.home__ring .ring__fill{transition:stroke-dashoffset .6s cubic-bezier(.2,.7,.2,1)}',
    '.home__ring .ring__label{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1}',
    '.home__ring .ring__num{font:700 2rem/1 var(--font-display);font-variant-numeric:tabular-nums}',
    '.home__ring .ring__den{font-size:.75rem;color:var(--muted);margin-top:4px;font-variant-numeric:tabular-nums}',
    '.home__daily-text{flex:1;min-width:0}',
    '.home__due{margin:0 0 4px;font-size:1.125rem}',
    '.home__due strong{font:700 1.5rem/1 var(--font-display);font-variant-numeric:tabular-nums}',
    '.home__daymsg{margin:0;color:var(--muted);font-size:.875rem}',
    '.home__ctas{display:grid;gap:8px}',
    '.home__ctas .btn .ico{display:inline-flex;margin-right:8px}',
    '.ico svg{width:20px;height:20px;display:block}',
    '.home__tiles{display:grid;grid-template-columns:1fr 1.4fr;gap:12px;margin-bottom:16px}',
    '.home__tile{background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1);padding:14px 16px;min-width:0}',
    '.home__tile .tile__label{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.home__tile .tile__num{display:flex;align-items:center;gap:6px;font:700 1.75rem/1 var(--font-display);font-variant-numeric:tabular-nums}',
    '.home__tile .tile__unit{font-size:1rem;color:var(--muted);font-weight:500}',
    '.home__tile .tile__foot{font-size:.75rem;color:var(--muted);margin-top:8px}',
    '.home__tile .bar{margin-top:10px}',
    '.home__flame{color:var(--muted)}',
    '.home__tile--streak.is-on .home__flame{color:var(--accent)}',
    '.home__flame svg{width:26px;height:26px}',
    '.home__section{margin-bottom:16px}',
    '.home__sec-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}',
    '.home__h2{font:700 1.125rem/1.3 var(--font-display);margin:0}',
    '.home__more{font-size:.875rem;color:var(--blue);text-decoration:none;font-weight:600;white-space:nowrap}',
    '.home__hint{margin:4px 0 12px;color:var(--muted);font-size:.875rem}',
    '.home__eyebrow{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:8px}',
    '.home__weak-list{display:grid;gap:10px}',
    '.home__weak{display:block;text-decoration:none;color:inherit;padding:10px 12px;border-radius:var(--r-s);background:var(--surface-2);min-height:44px}',
    '.home__weak:active{background:var(--surface-3)}',
    '.home__weak-head{display:flex;align-items:baseline;gap:8px;margin-bottom:8px}',
    '.home__weak-num{font:500 .875rem var(--font-mono);color:var(--muted)}',
    '.home__weak-title{flex:1;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.home__weak-pct{font-variant-numeric:tabular-nums;font-weight:600;font-size:.875rem}',
    '.home__weak-bars{display:grid;gap:6px}',
    '.home__weak-bar{display:grid;grid-template-columns:30px 1fr;align-items:center;gap:8px}',
    '.home__weak-bar .bar{height:6px}',
    '.home__weak-bar .bar--B .bar__fill{background:var(--blue)}',
    '.home__badge{display:flex;gap:14px;align-items:flex-start}',
    '.home__badge-ico{flex:0 0 44px;width:44px;height:44px;border-radius:50%;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center}',
    '.home__badge-ico svg{width:24px;height:24px}',
    '.home__badge-body{flex:1;min-width:0}',
    '.home__badge-body .bar{margin-top:6px}',
    '.home__chips-wrap{margin-bottom:16px}',
    '.home__chips{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none;-webkit-overflow-scrolling:touch}',
    '.home__chips::-webkit-scrollbar{display:none}',
    '.home__chip{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;text-decoration:none;color:inherit;min-height:44px;white-space:nowrap}',
    '.home__chip .ico svg{width:18px;height:18px}',
    '.chip__count{background:var(--accent);color:var(--accent-ink);border-radius:999px;font-size:.75rem;padding:1px 7px;font-variant-numeric:tabular-nums}',
    '.home__fc{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;align-items:end}',
    '.home__fc-col{display:flex;flex-direction:column;align-items:center;gap:4px}',
    '.home__fc-n{font-size:.75rem;color:var(--muted);font-variant-numeric:tabular-nums}',
    '.home__fc-bar{width:100%;max-width:28px;height:64px;background:var(--surface-2);border-radius:6px;display:flex;align-items:flex-end;overflow:hidden}',
    '.home__fc-fill{width:100%;background:var(--accent);border-radius:6px;transition:height .6s cubic-bezier(.2,.7,.2,1)}',
    '.home__fc-col:not(.is-today) .home__fc-fill{background:var(--blue)}',
    '.home__fc-d{font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}',
    '.home__fc-col.is-today .home__fc-d{color:var(--ink);font-weight:600}',
    '@media (min-width:720px){.home__grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}.home__grid>*{margin-bottom:0}}',
    '@media (prefers-reduced-motion:reduce){.home__ring .ring__fill,.home__fc-fill{transition:none}}'
  ].join('\n');

  function ensureStyles() {
    if (document.getElementById('home-view-css')) return;
    const s = document.createElement('style');
    s.id = 'home-view-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------- Rendu principal ---------- */

  function build() {
    const reg = registry();
    const allItems = reg && typeof reg.items === 'function' ? safe(function () { return reg.items(); }, []) : [];
    const availableItems = allItems.filter(function (it) { return it.available !== false; });
    const today = todayStats();
    const goal = Math.max(1, Number(profile().dailyGoal) || 30);
    const due = dueIds();

    const page = h('div', { class: 'page home' });
    page.appendChild(greeting());
    page.appendChild(dailyBlock(today, goal, due.length, availableItems));
    page.appendChild(streakXpBlock());
    page.appendChild(chipsBlock());
    page.appendChild(h('div', { class: 'home__grid' },
      weakestBlock(availableItems),
      badgeBlock(availableItems)));
    page.appendChild(forecastBlock());
    if (!reg || !reg.manifest) {
      page.appendChild(h('section', { class: 'card home__section' },
        h('h2', { class: 'home__h2' }, 'Contenu en cours de chargement'),
        h('p', { class: 'home__hint' }, 'Le catalogue des items n’est pas encore disponible. Recharge la page si cela persiste.')));
    }
    return page;
  }

  function render() {
    ensureStyles();
    const root = h('div', { class: 'view-home' });
    root.dataset.title = 'Accueil';
    root.appendChild(build());

    // Rafraîchissement sur changement du store ; désabonnement dès que la vue quitte le DOM.
    const u = util();
    if (typeof u.on === 'function') {
      let scheduled = false;
      const handler = function () {
        if (!root.isConnected) {
          // La vue a été démontée : on se détache (si la vue n'est pas encore montée, on retente plus tard).
          if (root.dataset.mounted === '1' && typeof u.off === 'function') u.off('store:change', handler);
          return;
        }
        root.dataset.mounted = '1';
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(function () {
          scheduled = false;
          if (!root.isConnected) return;
          try {
            const fresh = build();
            root.replaceChild(fresh, root.firstChild);
          } catch (e) { console.warn('[home] refresh', e); }
        });
      };
      u.on('store:change', handler);
      // Marque « monté » dès le premier frame pour permettre le désabonnement propre ensuite ;
      // si la vue n'a jamais été montée après 3 s (rendu abandonné), on se détache aussi.
      requestAnimationFrame(function () { if (root.isConnected) root.dataset.mounted = '1'; });
      setTimeout(function () {
        if (!root.isConnected && typeof u.off === 'function') u.off('store:change', handler);
      }, 3000);
    }
    return root;
  }

  CARDIO.views.home = { render: render, nextBadge: nextBadge, forecast: forecast };
})();
