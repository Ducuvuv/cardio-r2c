/* CardioR2C — views/fc.js
 * Flashcards « style Pass2P2 » (docs/FC.md) : cartes recto/verso courtes, auto-évaluées avec 3 boutons
 * (Je bloque / Je sais / Trop facile), répétition espacée SM-2 (ease 2,5, min 1,3), file du jour = cartes dues
 * + 20 nouvelles/jour (tirées à tour de rôle dans les fiches), séance plafonnée à 40, reprise de séance, bilan.
 * Données : CARDIO.registry.fc = { cards: [{id, poly, fiche, front, back, prio, sec}], fiches: {slug: {title, poly}} }.
 * Progression : CARDIO.store, chemin « fc.<id> » = {due, interval, ease, reps, lapses, at, first} (synchronisée).
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const C = window.CARDIO;
  C.views = C.views || {};
  function h() { return C.util.h.apply(null, arguments); }
  function put(el) { el.replaceChildren.apply(el, Array.prototype.slice.call(arguments, 1).flat(Infinity).filter(function (k) { return k != null && k !== false; })); }

  const DEFAULT_EASE = 2.5, MIN_EASE = 1.3, SESSION_CAP = 40, NEW_DAILY_LIMIT = 20;
  const LS_SESSION = 'cardio.fc.session.v1';
  const POLYS = { parasito: '🪱 Parasito', bacterio: '🧫 Bactério', viro: '🦠 Viro', dermato: '🩺 Dermato · images', pneumo: '🫁 Pneumo · images', cardio: '❤️ Cardio · images' };

  /* Cartes texte (content/fc-micro.js) + cartes image tirées de l'atlas photo (views/atlas.js, images déjà vérifiées) :
     recto = photo + « Quel diagnostic ? », verso = diagnostic + signes à repérer. Parasito : rangées dans la fiche
     du même nom ; dermato / pneumo / cardio : un paquet par item. */
  let merged = null, mergedKey = '';
  function reg() {
    const r = C.registry || {};
    const base = r.fc && Array.isArray(r.fc.cards) ? r.fc : { cards: [], fiches: {} };
    const atlas = Array.isArray(r.atlas) ? r.atlas : [];
    const key = base.cards.length + ':' + atlas.length;
    if (merged && mergedKey === key) return merged;
    const cards = base.cards.slice(), fiches = Object.assign({}, base.fiches);
    const A = C.views && C.views.atlas;
    atlas.forEach(function (x) {
      if (x.quiz === false || !POLYS[x.cat] || !x.items || !x.items[0]) return;
      const fiche = x.cat === 'parasito' ? x.items[0] : 'img-' + x.items[0];
      if (!fiches[fiche]) fiches[fiche] = { title: x.cat === 'parasito' ? x.items[0] : (A && A.itemLabel ? A.itemLabel(x) : x.items[0]), poly: x.cat };
      cards.push({ id: 'fci-' + x.id, poly: x.cat, fiche: fiche, img: x, front: x.q || 'Quel diagnostic ?',
        back: '**' + x.dx + '**' + ((x.signs || []).length ? '\n' + x.signs.map(function (s) { return '· ' + s; }).join('\n') : ''),
        prio: x.rank === 'B' ? 'P2' : 'P1', sec: null });
    });
    merged = { cards: cards, fiches: fiches }; mergedKey = key;
    return merged;
  }
  function store() { return C.store; }
  function st(id) { const s = store(); const v = s && s.get ? s.get('fc.' + id) : null; return v && typeof v.due === 'string' ? v : null; }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

  /* ---------- dates locales (midi : pas de piège heure d'été) ---------- */
  function dayKey(d) { const x = d || new Date(); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }
  function today() { return dayKey(); }
  function addDays(key, n) { const p = key.split('-').map(Number); const d = new Date(p[0], p[1] - 1, p[2], 12); d.setDate(d.getDate() + n); return dayKey(d); }
  function diffDays(a, b) { const pa = a.split('-').map(Number), pb = b.split('-').map(Number); return Math.round((new Date(pb[0], pb[1] - 1, pb[2], 12) - new Date(pa[0], pa[1] - 1, pa[2], 12)) / 864e5); }

  /* ---------- SM-2 (3 boutons) ---------- */
  function nextState(prev, grade) {
    const t = today();
    const p = prev || { due: t, interval: 0, ease: DEFAULT_EASE, reps: 0, lapses: 0, first: null };
    const n = { due: p.due, interval: p.interval, ease: p.ease || DEFAULT_EASE, reps: p.reps, lapses: p.lapses, at: Date.now(), first: p.first || t };
    if (grade === 'again') {
      n.lapses++; n.reps = 0; n.interval = 0; n.due = t; n.ease = Math.max(MIN_EASE, n.ease - 0.2);
      return n;
    }
    // révision anticipée (carte pas encore due) : on ne rapproche jamais l'échéance, ease/reps inchangés
    if (prev && prev.interval > 0 && diffDays(t, prev.due) > 0) {
      const left = diffDays(t, prev.due), elapsed = Math.max(0, prev.interval - left);
      n.interval = Math.max(left, Math.round(elapsed * n.ease * (grade === 'easy' ? 1.3 : 1)));
      n.due = addDays(t, n.interval);
      return n;
    }
    if (grade === 'good') {
      n.interval = n.reps === 0 ? 1 : n.reps === 1 ? 3 : Math.max(1, Math.round(p.interval * n.ease));
    } else {
      n.interval = n.reps === 0 ? 4 : Math.max(4, Math.round(p.interval * n.ease * 1.3));
      n.ease = n.ease + 0.15;
    }
    n.reps++;
    n.due = addDays(t, n.interval);
    return n;
  }
  function fmtDays(n) { return n <= 0 ? 'aujourd’hui' : n === 1 ? 'demain' : 'dans ' + n + ' j'; }
  function preview(id, g) { return fmtDays(nextState(st(id), g).interval); }
  function grade(id, g) {
    const s = store(); if (!s || !s.set) return;
    const isNew = !st(id);
    s.set('fc.' + id, nextState(st(id), g));
    try { s.gainXp && s.gainXp(2, 'flashcard'); } catch (e) { /* ignore */ }
    return isNew;
  }

  /* ---------- files ---------- */
  function newStartedToday() { const t = today(); const all = (store() && store().get('fc')) || {}; return Object.keys(all).filter(function (id) { return all[id] && all[id].first === t; }).length; }
  function isDue(id) { const s = st(id); return !!s && s.due <= today(); }
  function isLearning(id) { const s = st(id); return !!s && s.interval === 0; }
  function roundRobin(cards, n) {
    const byF = {}, order = [];
    cards.forEach(function (c) { if (!byF[c.fiche]) { byF[c.fiche] = []; order.push(c.fiche); } byF[c.fiche].push(c); });
    const out = [];
    while (out.length < n) {
      let added = false;
      order.forEach(function (f) { if (out.length < n && byF[f].length) { out.push(byF[f].shift()); added = true; } });
      if (!added) break;
    }
    return out;
  }
  function prioOrder(a, b) { return String(a.prio).localeCompare(String(b.prio)); }
  function pool(opts) {
    const fiches = opts.fiches && opts.fiches.length ? opts.fiches : null;
    let cards = reg().cards.filter(function (c) {
      return (!opts.poly || c.poly === opts.poly) && (!fiches || fiches.indexOf(c.fiche) >= 0) && (opts.prios || ['P1', 'P2', 'P3']).indexOf(c.prio) >= 0;
    });
    if (opts.mode === 'review') return cards.filter(function (c) { return isLearning(c.id); });
    if (opts.mode === 'all') return cards;
    const due = cards.filter(function (c) { return isDue(c.id); });
    const fresh = cards.filter(function (c) { return !st(c.id); }).sort(prioOrder);
    const room = Math.max(0, NEW_DAILY_LIMIT - newStartedToday());
    return due.concat(roundRobin(fresh, room));
  }
  function counts(opts) {
    const cards = reg().cards.filter(function (c) { return (!opts.poly || c.poly === opts.poly) && (!opts.fiches || !opts.fiches.length || opts.fiches.indexOf(c.fiche) >= 0); });
    let due = 0, fresh = 0, learning = 0, known = 0;
    cards.forEach(function (c) { const s = st(c.id); if (!s) fresh++; else { if (s.due <= today()) due++; if (s.interval === 0) learning++; else known++; } });
    return { total: cards.length, due: due, fresh: fresh, learning: learning, known: known, todo: due + Math.min(fresh, Math.max(0, NEW_DAILY_LIMIT - newStartedToday())) };
  }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const x = a[i]; a[i] = a[j]; a[j] = x; } return a; }

  /* ---------- texte : **gras** ---------- */
  function md(s) {
    const e = String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    return h('span', { html: e.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>') });
  }

  let styled = false;
  function ensureStyles() {
    if (styled) return; styled = true;
    document.head.appendChild(h('style', {}, [
      '.fc-card{position:relative;padding:18px 18px 16px;border-radius:18px;background:var(--surface);box-shadow:var(--shadow-2);min-height:180px;cursor:pointer;animation:fc-enter .22s ease}',
      '.fc-card.is-flipped{cursor:default;animation:fc-turn .22s ease}',
      '.fc-pills{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}',
      '.fc-front{font-size:1.08rem;font-weight:600;line-height:1.4}',
      '.fc-back{margin-top:14px;padding-top:14px;border-top:2px dashed var(--line);font-size:1rem;line-height:1.5;animation:fc-reveal .22s ease}',
      '.fc-hint{margin-top:14px;font-size:.8rem;color:var(--ink-2)}',
      '.fc-strip{display:flex;gap:2px;margin:6px 0 10px}',
      '.fc-strip i{flex:1;height:5px;border-radius:3px;background:var(--surface-3)}',
      '.fc-strip i.ok{background:var(--ok)}.fc-strip i.bad{background:var(--bad)}.fc-strip i.cur{background:var(--accent)}',
      '.fc-bar{height:6px;border-radius:3px;background:var(--surface-3);overflow:hidden;margin:6px 0 10px}.fc-bar b{display:block;height:100%;background:var(--accent)}',
      '.fc-grades{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}',
      '.fc-grades .btn{flex-direction:column;gap:2px;min-height:58px;padding:8px 4px}',
      '.fc-grades small{font-weight:500;font-size:.7rem;opacity:.85}',
      '.fc-g-easy{background:var(--accent-soft,var(--surface-2));color:var(--accent)}',
      '.fc-chips{display:flex;flex-wrap:wrap;gap:8px}',
      '.fc-list{display:grid;gap:6px;max-height:320px;overflow:auto;padding:2px}',
      '.fc-list label{display:flex;gap:8px;align-items:center;padding:8px 10px;border-radius:10px;background:var(--surface-2);font-size:.9rem}',
      '.fc-list label small{margin-left:auto;color:var(--ink-2);white-space:nowrap}',
      '.fc-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}',
      '.fc-tiles div{padding:12px;border-radius:12px;background:var(--surface-2);text-align:center}.fc-tiles b{display:block;font-size:1.4rem}',
      '@keyframes fc-enter{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}',
      '@keyframes fc-turn{0%{transform:rotateY(0)}50%{transform:rotateY(-7deg)}100%{transform:rotateY(0)}}',
      '@keyframes fc-reveal{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
      '@media (prefers-reduced-motion:reduce){.fc-card,.fc-back{animation:none!important}}'
    ].join('\n')));
  }

  /* ---------- séance ---------- */
  function runSession(root, ids, scope, done) {
    const byId = {}; reg().cards.forEach(function (c) { byId[c.id] = c; });
    let s = { ids: ids, index: 0, stats: { again: 0, good: 0, easy: 0, newSeen: 0 }, marks: {}, scope: scope };
    const saved = lsGet(LS_SESSION);
    if (saved && saved.resume && saved.ids && saved.ids.length) { s = saved; delete s.resume; }
    lsSet(LS_SESSION, s);
    let keyHandler = null;
    function cleanup() { if (keyHandler) document.removeEventListener('keydown', keyHandler); keyHandler = null; }
    function finish() { cleanup(); lsSet(LS_SESSION, null); summary(); }
    function show() {
      while (s.index < s.ids.length && !byId[s.ids[s.index]]) s.index++;
      if (s.index >= s.ids.length) { finish(); return; }
      const c = byId[s.ids[s.index]];
      const fresh = !st(c.id);
      let flipped = false;
      const strip = s.ids.length <= 50
        ? h('div', { class: 'fc-strip' }, s.ids.map(function (id, i) { return h('i', { class: i === s.index ? 'cur' : s.marks[i] === 'again' ? 'bad' : s.marks[i] ? 'ok' : '' }); }))
        : h('div', { class: 'fc-bar' }, h('b', { style: 'width:' + Math.round(100 * s.index / s.ids.length) + '%' }));
      const f = reg().fiches[c.fiche] || {};
      const card = h('div', { class: 'fc-card', role: 'button', tabindex: '0', 'aria-label': 'Carte, touche pour voir la réponse' },
        h('div', { class: 'fc-pills' },
          scope && scope.multi ? h('span', { class: 'pill pill--kind' }, f.title || c.fiche) : null,
          h('span', { class: 'pill ' + (c.prio === 'P1' ? 'pill--warn' : 'pill--info') }, c.prio),
          fresh ? h('span', { class: 'pill pill--ok' }, 'Nouvelle') : null),
        h('div', { class: 'fc-front' }, md(c.front)),
        c.img && C.views.atlas && C.views.atlas.img ? h('figure', { class: 'at-fig', style: 'margin:10px 0 0' }, C.views.atlas.img(c.img, { alt: 'Image à reconnaître', style: 'max-height:46vh' })) : null,
        h('div', { class: 'fc-hint' }, 'Touche la carte pour voir la réponse'));
      const actions = h('div', {});
      function flip() {
        if (flipped) return; flipped = true;
        card.classList.add('is-flipped');
        card.querySelector('.fc-hint').textContent = 'Tu savais ? Choisis en bas.';
        card.insertBefore(h('div', { class: 'fc-back' }, md(c.back), c.sec ? h('div', { class: 'secondary', style: 'margin-top:8px;font-size:.78rem' }, f.title ? f.title + ' · ' : '', c.sec) : null), card.querySelector('.fc-hint'));
        put(actions, h('div', { class: 'fc-grades' },
          [['again', 'Je bloque', 'grade--again', 1], ['good', 'Je sais', 'grade--good', 2], ['easy', 'Trop facile', 'fc-g-easy', 3]].map(function (g) {
            return h('button', { type: 'button', class: 'btn ' + g[2], on: { click: function () { rate(g[0]); } } }, h('span', {}, g[1]), h('small', {}, preview(c.id, g[0])));
          })));
      }
      function rate(g) {
        if (!flipped) return;
        if (grade(c.id, g)) s.stats.newSeen++;
        s.stats[g]++;
        s.marks[s.index] = g;
        if (g === 'again' && s.ids.indexOf(c.id, s.index + 1) < 0) s.ids.push(c.id);   // revient en fin de séance
        s.index++;
        lsSet(LS_SESSION, s);
        show();
      }
      card.addEventListener('click', flip);
      put(actions, h('button', { type: 'button', class: 'btn btn--primary btn--block', style: 'margin-top:12px', on: { click: flip } }, 'Voir la réponse'));
      cleanup();
      keyHandler = function (e) {
        if (/input|textarea/i.test((e.target && e.target.tagName) || '')) return;
        if (!flipped && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); flip(); }
        else if (flipped && e.key === '1') rate('again');
        else if (flipped && e.key === '2') rate('good');
        else if (flipped && e.key === '3') rate('easy');
      };
      document.addEventListener('keydown', keyHandler);
      put(root,
        h('div', { class: 'row', style: 'justify-content:space-between;align-items:center' },
          h('span', { class: 'secondary' }, (s.index + 1) + ' / ' + s.ids.length),
          h('button', { type: 'button', class: 'btn btn--ghost btn--sm', on: { click: function () { cleanup(); s.resume = true; lsSet(LS_SESSION, s); done(); } } }, 'Pause')),
        strip, card, actions);
      window.scrollTo(0, 0);
    }
    function summary() {
      const t = s.stats, n = t.again + t.good + t.easy;
      const head = !t.again ? 'Sans faute.' : t.again > t.good + t.easy ? 'Ça rentre, continue.' : 'Bien joué.';
      const missed = s.ids.filter(function (id, i) { return s.marks[i] === 'again'; });
      const left = counts(scope || {}).todo;
      put(root,
        h('h2', { style: 'margin:0 0 6px' }, head),
        h('div', { class: 'fc-tiles' },
          h('div', {}, h('b', {}, String(n)), 'cartes'),
          h('div', {}, h('b', {}, '+' + 2 * n), 'XP'),
          h('div', {}, h('b', {}, String(t.again)), 'ratées')),
        h('div', { class: 'fc-bar', style: 'height:10px;display:flex' },
          h('b', { style: 'width:' + (n ? 100 * t.again / n : 0) + '%;background:var(--bad)' }),
          h('b', { style: 'width:' + (n ? 100 * t.good / n : 0) + '%;background:var(--ok)' }),
          h('b', { style: 'width:' + (n ? 100 * t.easy / n : 0) + '%;background:var(--accent)' })),
        h('div', { class: 'stack', style: 'margin-top:12px' },
          left ? h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: function () { start(root, Object.assign({}, scope, { mode: 'due' }), done); } } }, 'Continuer · ' + left + ' cartes à faire') : null,
          missed.length ? h('button', { type: 'button', class: 'btn btn--secondary btn--block', on: { click: function () { runSession(root, shuffle(missed.filter(function (v, i, a) { return a.indexOf(v) === i; })), scope, done); } } }, 'Refaire mes ' + missed.length + ' ratées') : null,
          h('button', { type: 'button', class: 'btn btn--outline btn--block', on: { click: done } }, 'Changer de cartes')));
    }
    show();
  }
  function start(root, opts, done) {
    let ids = pool(opts).map(function (c) { return c.id; });
    if (opts.shuffle !== false) ids = shuffle(ids);
    if (opts.mode === 'due') ids = ids.slice(0, SESSION_CAP);
    if (!ids.length) { if (C.shell && C.shell.toast) C.shell.toast('Rien à réviser ici pour aujourd’hui.', { tone: 'ok' }); return false; }
    lsSet(LS_SESSION, null);
    runSession(root, ids, { poly: opts.poly, fiches: opts.fiches, prios: opts.prios, multi: !opts.fiches || opts.fiches.length !== 1 }, done);
    return true;
  }

  /* ---------- écran de choix ---------- */
  function render(params, query) {
    ensureStyles();
    const q = query || {};
    const root = h('div', { class: 'page stack view-fc' });
    const R = reg();
    const polys = Object.keys(POLYS).filter(function (p) { return R.cards.some(function (c) { return c.poly === p; }); });
    let poly = polys.indexOf(q.poly) >= 0 ? q.poly : (q.fiche && R.fiches[q.fiche] ? R.fiches[q.fiche].poly : polys[0]);
    let sel = q.fiche ? [String(q.fiche)] : [];
    let mode = q.mode === 'all' || q.mode === 'review' ? q.mode : 'due';
    let prios = ['P1', 'P2', 'P3'];
    function home() {
      if (!polys.length) { put(root, h('p', {}, 'Pas encore de flashcards. Elles arrivent (parasito d’abord).')); return; }
      const saved = lsGet(LS_SESSION);
      const fichesOf = Object.keys(R.fiches).filter(function (k) { return R.fiches[k].poly === poly && R.cards.some(function (c) { return c.fiche === k; }); });
      const opts = { poly: poly, fiches: sel, mode: mode, prios: prios };
      const cnt = counts(opts);
      const n = pool(opts).length;
      put(root,
        saved && saved.ids && saved.ids.length ? h('div', { class: 'card stack' }, h('strong', {}, 'Séance en cours : ' + saved.index + ' / ' + saved.ids.length),
          h('div', { class: 'row', style: 'gap:8px' },
            h('button', { type: 'button', class: 'btn btn--primary', on: { click: function () { saved.resume = true; lsSet(LS_SESSION, saved); runSession(root, saved.ids, saved.scope, home); } } }, 'Reprendre'),
            h('button', { type: 'button', class: 'btn btn--outline', on: { click: function () { lsSet(LS_SESSION, null); home(); } } }, 'Abandonner'))) : null,
        polys.length > 1 ? h('div', { class: 'fc-chips' }, polys.map(function (p) {
          return h('button', { type: 'button', class: 'btn btn--sm ' + (p === poly ? 'btn--primary' : 'btn--secondary'), on: { click: function () { poly = p; sel = []; home(); } } }, POLYS[p]);
        })) : null,
        h('div', { class: 'card stack' },
          h('strong', {}, '🃏 Flashcards ' + (sel.length === 1 ? '· ' + (R.fiches[sel[0]] || {}).title : POLYS[poly])),
          h('p', { class: 'secondary', style: 'margin:0' }, cnt.total + ' cartes · ' + cnt.due + ' à revoir · ' + cnt.fresh + ' nouvelles · ' + cnt.known + ' sues. Réponds de tête, retourne la carte, puis sois honnête : Je bloque / Je sais / Trop facile.'),
          h('div', { class: 'fc-chips' }, [['due', 'Aujourd’hui'], ['review', 'Mes ratées'], ['all', 'Toutes']].map(function (m) {
            return h('button', { type: 'button', class: 'btn btn--sm ' + (mode === m[0] ? 'btn--primary' : 'btn--outline'), on: { click: function () { mode = m[0]; home(); } } }, m[1]);
          })),
          h('div', { class: 'fc-chips' }, ['P1', 'P2', 'P3'].map(function (p) {
            const on = prios.indexOf(p) >= 0;
            return h('button', { type: 'button', class: 'btn btn--sm ' + (on ? 'btn--secondary' : 'btn--ghost'), on: { click: function () { prios = on ? prios.filter(function (x) { return x !== p; }) : prios.concat(p); if (!prios.length) prios = [p]; home(); } } }, (on ? '✓ ' : '') + p);
          })),
          h('button', { type: 'button', class: 'btn btn--primary btn--block', disabled: !n, on: { click: function () { start(root, { poly: poly, fiches: sel, mode: mode, prios: prios }, home); } } },
            n ? 'Lancer · ' + Math.min(n, mode === 'due' ? SESSION_CAP : n) + ' cartes' : (mode === 'due' ? 'Rien à faire aujourd’hui ✓' : 'Aucune carte'))),
        h('div', { class: 'card stack' },
          h('div', { class: 'row', style: 'justify-content:space-between;align-items:center' }, h('strong', {}, 'Fiches'),
            sel.length ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', on: { click: function () { sel = []; home(); } } }, 'Tout le poly') : null),
          h('div', { class: 'fc-list' }, fichesOf.map(function (k) {
            const c = counts({ poly: poly, fiches: [k] });
            const box = h('input', { type: 'checkbox', checked: sel.indexOf(k) >= 0, on: { change: function (e) { sel = e.target.checked ? sel.concat(k) : sel.filter(function (x) { return x !== k; }); home(); } } });
            return h('label', {}, box, R.fiches[k].title, h('small', {}, c.due ? c.due + ' à revoir' : c.fresh ? c.fresh + ' nouv.' : '✓ ' + c.total));
          }))));
    }
    if (q.go === '1' && q.fiche) { if (!start(root, { poly: poly, fiches: sel, mode: mode, prios: prios }, home)) home(); }
    else home();
    return { el: root, title: 'Flashcards' };
  }

  /* Bloc « Flashcards de la fiche » pour views/parasito.js */
  function ficheBlock(slug) {
    const R = reg();
    if (!R.cards.some(function (c) { return c.fiche === slug; })) return null;
    const c = counts({ fiches: [slug] });
    return h('a', { class: 'card', href: '#/fc?fiche=' + encodeURIComponent(slug) + '&go=1&mode=' + (c.due || c.fresh ? 'due' : 'all'), style: 'display:block;padding:12px 14px;text-decoration:none;color:inherit' },
      h('div', { style: 'display:flex;justify-content:space-between;gap:8px' }, h('b', {}, '🃏 Flashcards de la fiche'), h('span', { class: 'secondary muted' }, c.total + ' cartes')),
      h('p', { class: 'secondary muted', style: 'margin:4px 0 0' }, c.due ? c.due + ' à revoir aujourd’hui' : c.fresh ? c.fresh + ' nouvelles à découvrir' : 'Toutes vues · revient au bon moment'));
  }

  C.views.fc = { render: render, ficheBlock: ficheBlock, counts: counts, nextState: nextState };
})();
