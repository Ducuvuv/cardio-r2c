/* CardioR2C — deck.js
 * « Paquet du jour » : dès qu'un cours est vu (placé dans la Méthode des J, fiche ouverte, ou ajouté à la main), ses
 * flashcards reviennent chaque jour. Une session par jour de `size` cartes (100 par défaut), réparties entre les chapitres
 * actifs : per = max(min, floor(size / k)) cartes par chapitre ; plus les chapitres s'accumulent, moins il y en a par chapitre.
 * Priorité dans un chapitre : dues (SRS) → souvent ratées → les moins récemment vues → nouvelles.
 * Clés de chapitre = celles de la Méthode des J : « i:<num> » (item du Collège, cartes CARDIO.registry.fcPub dont
 * card.fiche === num) et « p:<id> » (fiche parasito / bactério / viro, cartes flash + QROC de la fiche).
 * Clés de carte = celles du Mode Scroll : « fc:<id> » (Collège, SRS CARDIO.store « fc.<id> ») ou l'id de la carte de la
 * fiche (SRS localStorage « cardio.parasito.srs »).
 * Stockage : localStorage « cardio.deck.v1 » = {chapters:{key:{added, src:'planj'|'read'|'manual'}}, off:{key:ms},
 *   size, min, day:{date, queue:[cardKey], done:{cardKey: grade}}}. off = chapitres retirés à la main (pas réactivés
 *   automatiquement ; un ajout manuel les remet).
 * API : CARDIO.deck = {activate, remove, summary, today, markDone, setSize, setMin, openSheet, card, chapterTitle}.
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;

  const LS = 'cardio.deck.v1';
  const SIZES = [30, 50, 100, 150, 200], MINS = [1, 2, 3];
  const SRC_LABEL = { planj: 'Méthode des J', read: 'Fiche lue', manual: 'Ajouté' };

  function h() { return CARDIO.util.h.apply(null, arguments); }
  function str(v) { return v == null ? '' : String(v); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  function blank() { return { chapters: {}, off: {}, size: 100, min: 2, day: null }; }
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS) || 'null');
      const d = blank();
      if (!raw || typeof raw !== 'object') return d;
      if (raw.chapters && typeof raw.chapters === 'object') Object.keys(raw.chapters).forEach(function (k) {
        const c = raw.chapters[k];
        if (/^[ip]:/.test(k) && c && typeof c === 'object') d.chapters[k] = { added: Number(c.added) || Date.now(), src: SRC_LABEL[c.src] ? c.src : 'manual' };
      });
      if (raw.off && typeof raw.off === 'object') Object.keys(raw.off).forEach(function (k) { if (/^[ip]:/.test(k)) d.off[k] = Number(raw.off[k]) || 1; });
      if (SIZES.indexOf(Number(raw.size)) >= 0) d.size = Number(raw.size);
      if (MINS.indexOf(Number(raw.min)) >= 0) d.min = Number(raw.min);
      if (raw.day && typeof raw.day === 'object' && typeof raw.day.date === 'string' && Array.isArray(raw.day.queue)) {
        d.day = { date: raw.day.date, queue: raw.day.queue.map(str).filter(Boolean), done: raw.day.done && typeof raw.day.done === 'object' ? raw.day.done : {} };
      }
      return d;
    } catch (e) { return blank(); }
  }
  function save(d) { try { localStorage.setItem(LS, JSON.stringify(d)); } catch (e) { /* stockage indisponible */ } }

  /* ---------- chapitres et cartes ---------- */
  function polys() { const r = CARDIO.registry || {}; return [].concat(Array.isArray(r.parasito) ? r.parasito : [], Array.isArray(r.bacterio) ? r.bacterio : [], Array.isArray(r.viro) ? r.viro : []); }
  function fcPub() { const r = CARDIO.registry || {}; return r.fcPub && Array.isArray(r.fcPub.cards) ? r.fcPub : null; }
  function fiche(id) { return polys().find(function (p) { return p && p.id === id; }) || null; }
  function chapterTitle(k) {
    try {
      const id = str(k).slice(2);
      if (k.charAt(0) === 'p') { const p = fiche(id); return p ? str(p.title) : id; }
      const r = CARDIO.registry || {};
      const it = typeof r.item === 'function' ? r.item(id) : null;
      const lab = typeof r.label === 'function' ? r.label(id) : id;
      const pub = fcPub(), f = pub && pub.fiches ? pub.fiches[id] : null;
      return 'Item ' + lab + ' · ' + str((it && (it.short || it.title)) || (f && f.title) || '');
    } catch (e) { return str(k); }
  }
  /* Index des cartes du Collège par fiche (= numéro d'item), recalculé si le registre change. */
  let fcIdx = null, fcIdxN = -1;
  function fcIndex() {
    const pub = fcPub();
    const n = pub ? pub.cards.length : 0;
    if (fcIdx && fcIdxN === n) return fcIdx;
    fcIdx = {}; fcIdxN = n;
    if (pub) pub.cards.forEach(function (c) { if (c && c.id) (fcIdx[str(c.fiche)] = fcIdx[str(c.fiche)] || []).push(c); });
    return fcIdx;
  }
  /* Cartes d'un chapitre : [{key, fc?}] (clé du Mode Scroll). */
  function cardsOfChapter(k) {
    const id = str(k).slice(2), out = [];
    try {
      if (k.charAt(0) === 'i') {
        (fcIndex()[id] || []).forEach(function (c) { out.push({ key: 'fc:' + c.id, fc: c.id, prio: c.prio }); });
      } else {
        const p = fiche(id), c = (p && p.cards) || {};
        (c.flash || []).concat(c.qroc || []).forEach(function (x) { if (x && x.id) out.push({ key: str(x.id) }); });
      }
    } catch (e) { /* registre absent */ }
    return out;
  }
  function hasCards(k) { return cardsOfChapter(k).length > 0; }

  /* Chapitres placés dans la Méthode des J (CARDIO.store « planJ », cours déjà commencés). */
  function planjKeys() {
    try {
      const raw = CARDIO.store && CARDIO.store.get ? CARDIO.store.get('planJ') : null;
      const cs = raw && raw.courses && typeof raw.courses === 'object' ? raw.courses : {};
      const t = today();
      return Object.keys(cs).filter(function (k) { const c = cs[k]; return /^[ip]:/.test(k) && c && typeof c === 'object' && (!c.start || String(c.start) <= t); });
    } catch (e) { return []; }
  }

  /* ---------- construction du paquet ---------- */
  function scoreInfo() {
    let fc = {}, srs = {}, shown = {};
    try { fc = (CARDIO.store && CARDIO.store.get && CARDIO.store.get('fc')) || {}; } catch (e) { fc = {}; }
    try { srs = JSON.parse(localStorage.getItem('cardio.parasito.srs') || '{}') || {}; } catch (e) { srs = {}; }
    try { shown = JSON.parse(localStorage.getItem('cardio.parasito.shown') || '{}') || {}; } catch (e) { shown = {}; }
    const t = today(), now = Date.now();
    return function (c) {
      if (c.fc) {
        const s = fc[c.fc];
        if (!s || typeof s.due !== 'string') return { fresh: true, prio: c.prio };
        return { due: s.due <= t, lapses: Number(s.lapses) || 0, last: Math.max(Number(s.at) || 0, Number(shown[c.key]) || 0) };
      }
      const s = srs[c.key];
      if (!s) return { fresh: true };
      return { due: Number(s.d) <= now, lapses: Number(s.l) || 0, last: Number(shown[c.key]) || 0 };
    };
  }
  /* n cartes d'un chapitre par priorité, en sautant celles de `skip`. */
  /* Cartes d'un chapitre classées par priorité (hors `skip`) : dues → souvent ratées → les moins récemment vues → nouvelles. */
  function rankOf(x) { return x.s.fresh ? 3 : x.s.due ? 0 : x.s.lapses > 0 ? 1 : 2; }
  function byPriority(a, b) {
    const ra = rankOf(a), rb = rankOf(b);
    if (ra !== rb) return ra - rb;
    if (ra === 3) return str(a.s.prio).localeCompare(str(b.s.prio));      // nouvelles : P1 d'abord
    return (b.s.lapses - a.s.lapses) || (a.s.last - b.s.last);
  }
  function ranked(k, info, skip) {
    return shuffle(cardsOfChapter(k).filter(function (c) { return !skip[c.key]; })).map(function (c) { return { c: c, s: info(c) }; }).sort(byPriority);
  }
  function perChapter(d, k) { return k ? Math.max(d.min, Math.floor(d.size / k)) : 0; }
  /* Reconstruit la file du jour en gardant les cartes déjà faites (comptées dans le quota de leur chapitre).
   * per cartes par chapitre ; s'il reste de la place sous `size` (arrondi, petits chapitres), on complète avec les
   * cartes restantes les plus prioritaires, tous chapitres confondus. */
  function rebuild(d) {
    const t = today();
    const keep = d.day && d.day.date === t ? d.day : { date: t, queue: [], done: {} };
    const done = {}; keep.queue.forEach(function (key) { if (keep.done[key] != null) done[key] = keep.done[key]; });
    const ks = Object.keys(d.chapters).filter(hasCards);
    const per = perChapter(d, ks.length), info = scoreInfo();
    const owner = {};
    ks.forEach(function (k) { cardsOfChapter(k).forEach(function (c) { owner[c.key] = k; }); });
    const doneBy = {};
    Object.keys(done).forEach(function (key) { const k = owner[key]; if (k) doneBy[k] = (doneBy[k] || 0) + 1; });
    const kept = Object.keys(done).filter(function (key) { return owner[key]; });
    let fresh = [], rest = [];
    ks.forEach(function (k) {
      const r = ranked(k, info, done), n = Math.max(0, per - (doneBy[k] || 0));
      fresh = fresh.concat(r.slice(0, n).map(function (x) { return x.c.key; }));
      rest = rest.concat(r.slice(n));
    });
    const room = d.size - kept.length - fresh.length;
    if (room > 0 && rest.length) fresh = fresh.concat(shuffle(rest).sort(byPriority).slice(0, room).map(function (x) { return x.c.key; }));
    d.day = { date: t, queue: kept.concat(shuffle(fresh)), done: done };
    return d;
  }
  /* Synchronise les chapitres (Méthode des J) et construit la file une fois par jour. */
  function ensure() {
    const d = load();
    let changed = false;
    planjKeys().forEach(function (k) { if (!d.chapters[k] && !d.off[k]) { d.chapters[k] = { added: Date.now(), src: 'planj' }; changed = true; } });
    if (!d.day || d.day.date !== today() || changed) { rebuild(d); save(d); }
    return d;
  }

  /* ---------- API ---------- */
  function activate(k, src, force) {
    try {
      k = str(k);
      if (!/^[ip]:./.test(k)) return;
      const d = load();
      if (d.chapters[k]) return;
      if (d.off[k] && !force) return;
      delete d.off[k];
      d.chapters[k] = { added: Date.now(), src: src || 'manual' };
      if (d.day && d.day.date === today()) rebuild(d);
      save(d);
    } catch (e) { /* ignore */ }
  }
  function remove(k) {
    try {
      const d = load();
      delete d.chapters[k]; d.off[k] = Date.now();
      rebuild(d); save(d);
    } catch (e) { /* ignore */ }
  }
  function setSize(n) { try { const d = load(); if (SIZES.indexOf(n) < 0) return; d.size = n; rebuild(d); save(d); } catch (e) { /* ignore */ } }
  function setMin(n) { try { const d = load(); if (MINS.indexOf(n) < 0) return; d.min = n; rebuild(d); save(d); } catch (e) { /* ignore */ } }
  function markDone(key, grade) {
    try {
      const d = load();
      if (!d.day || d.day.date !== today() || d.day.queue.indexOf(key) < 0 || d.day.done[key] != null) return;
      d.day.done[key] = grade;
      save(d);
    } catch (e) { /* ignore */ }
  }
  /* File du jour : {queue, remaining, done, total, k, size, min, per}. */
  function todayDeck() {
    try {
      const d = ensure();
      const k = Object.keys(d.chapters).filter(hasCards).length;
      const q = d.day ? d.day.queue : [];
      const done = q.filter(function (key) { return d.day.done[key] != null; }).length;
      return { queue: q.slice(), remaining: q.filter(function (key) { return d.day.done[key] == null; }), done: done, total: q.length, k: k, chapters: Object.keys(d.chapters).length, size: d.size, min: d.min, per: perChapter(d, k) };
    } catch (e) { return { queue: [], remaining: [], done: 0, total: 0, k: 0, chapters: 0, size: 100, min: 2, per: 0 }; }
  }
  function summary() { const t = todayDeck(); return { done: t.done, total: t.total, k: t.k, size: t.size }; }
  function available() { return !!fcPub() || polys().length > 0; }

  /* ---------- feuille « Mon paquet » ---------- */
  function catalog() {
    const out = [];
    try {
      const r = CARDIO.registry || {};
      const withFc = fcIndex();
      (typeof r.items === 'function' ? r.items() || [] : []).forEach(function (it) { if (it && withFc[str(it.num)]) out.push({ key: 'i:' + it.num, group: it.spe === 'dermato' ? 'Dermato' : it.spe === 'pneumo' ? 'Pneumo' : 'Cardio' }); });
      polys().forEach(function (p) {
        if (!p || !p.id || !p.cards || !((p.cards.flash || []).length + (p.cards.qroc || []).length)) return;
        out.push({ key: 'p:' + p.id, group: /^bact-/.test(p.id) ? 'Bactério' : /^viro-/.test(p.id) ? 'Viro' : 'Parasito-myco' });
      });
    } catch (e) { /* ignore */ }
    return out;
  }
  function openSheet(onChange) {
    const sh = CARDIO.shell;
    if (!sh || typeof sh.sheet !== 'function') return;
    const body = h('div', { class: 'stack' });
    function changed() { draw(); try { if (typeof onChange === 'function') onChange(); } catch (e) { /* ignore */ } }
    function chips(label, list, cur, set, fmt) {
      return h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center' }, h('span', { class: 'secondary muted', style: 'min-width:110px' }, label),
        list.map(function (n) { return h('button', { type: 'button', class: 'btn btn--sm ' + (n === cur ? 'btn--primary' : 'btn--outline'), on: { click: function () { set(n); changed(); } } }, fmt ? fmt(n) : String(n)); }));
    }
    function draw() {
      const d = ensure(), t = todayDeck();
      const keys = Object.keys(d.chapters).sort(function (a, b) { return d.chapters[b].added - d.chapters[a].added; });
      const cat = catalog().filter(function (m) { return !d.chapters[m.key]; });
      const sel = h('select', { class: 'input', style: 'flex:1;min-width:0;padding:8px;border-radius:10px;border:2px solid var(--line);background:var(--surface);color:var(--ink)' },
        h('option', { value: '' }, 'Ajouter un chapitre…'),
        ['Cardio', 'Dermato', 'Pneumo', 'Parasito-myco', 'Bactério', 'Viro'].map(function (g) {
          const ms = cat.filter(function (m) { return m.group === g; });
          return ms.length ? h('optgroup', { label: g }, ms.map(function (m) { return h('option', { value: m.key }, chapterTitle(m.key)); })) : null;
        }));
      body.replaceChildren(
        h('p', { class: 'secondary', style: 'margin:0' }, t.k ? t.total + ' cartes aujourd’hui · ' + t.k + ' chapitre' + (t.k > 1 ? 's' : '') + ' · ' + t.per + ' carte' + (t.per > 1 ? 's' : '') + ' par chapitre' + (t.total > t.size ? ' (au-delà de ' + t.size + ' pour garder le minimum par chapitre)' : '') : 'Aucun chapitre actif. Un cours entre ici dès que tu ouvres sa fiche ou que tu le places dans la Méthode des J.'),
        chips('Cartes par jour', SIZES, d.size, setSize),
        chips('Minimum / chapitre', MINS, d.min, setMin),
        h('div', { style: 'display:flex;gap:8px;align-items:center' }, sel,
          h('button', { type: 'button', class: 'btn btn--secondary btn--sm', on: { click: function () { if (sel.value) { activate(sel.value, 'manual', true); changed(); } } } }, 'Ajouter')),
        h('b', {}, 'Chapitres actifs (' + keys.length + ')'),
        keys.length ? h('div', { style: 'display:grid;gap:4px;max-height:45vh;overflow:auto' }, keys.map(function (k) {
          const n = cardsOfChapter(k).length;
          return h('div', { style: 'display:flex;gap:8px;align-items:center;padding:6px 0;border-top:1px solid var(--line)' },
            h('div', { style: 'flex:1;min-width:0' }, h('div', { style: 'font-weight:600' }, chapterTitle(k)),
              h('div', { class: 'secondary muted', style: 'font-size:.8125rem' }, (SRC_LABEL[d.chapters[k].src] || 'Ajouté') + ' · ' + (n ? n + ' cartes' : 'pas de flashcards'))),
            h('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': 'Retirer ' + chapterTitle(k), on: { click: function () { remove(k); changed(); } } }, '✕'));
        })) : null);
    }
    draw();
    sh.sheet(body, { title: '📦 Mon paquet' });
  }

  /* Carte « 📦 Paquet du jour » (accueil des flashcards, écran du Mode Scroll). */
  function card(onChange) {
    try {
      if (!available()) return null;
      const wrap = h('div', { class: 'card', style: 'display:grid;gap:6px;padding:12px 14px;border-left:4px solid var(--accent)' });
      function draw() {
        const x = todayDeck();
        const end = x.total && x.done >= x.total;
        wrap.replaceChildren(
          h('div', { style: 'display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap' },
            h('b', {}, '📦 Paquet du jour' + (x.total ? ' · ' + x.done + '/' + x.total : '') + ' · ' + x.k + ' chapitre' + (x.k > 1 ? 's' : '')),
            h('button', { type: 'button', class: 'btn btn--ghost btn--sm', on: { click: function () { openSheet(function () { draw(); if (typeof onChange === 'function') onChange(); }); } } }, 'Mon paquet')),
          x.total ? h('div', { class: 'fc-bar', style: 'height:6px;border-radius:3px;background:var(--surface-3);overflow:hidden' }, h('b', { style: 'display:block;height:100%;background:var(--accent);width:' + Math.round(100 * x.done / x.total) + '%' })) : null,
          h('p', { class: 'secondary muted', style: 'margin:0' }, !x.k ? 'Ouvre un cours ou place-le dans la Méthode des J : ses flashcards reviendront ici chaque jour.' : end ? 'Paquet du jour terminé ✓ Reviens demain.' : (x.total - x.done) + ' cartes à faire · ' + x.per + ' par chapitre'),
          x.total && !end ? h('a', { class: 'btn btn--primary btn--block', href: '#/scroll?deck=1' }, x.done ? 'Reprendre le paquet' : 'Lancer le paquet') : null);
      }
      draw();
      return wrap;
    } catch (e) { return null; }
  }

  CARDIO.deck = { activate: activate, remove: remove, summary: summary, today: todayDeck, markDone: markDone, setSize: setSize, setMin: setMin,
    openSheet: openSheet, card: card, chapterTitle: chapterTitle, available: available };
})();
