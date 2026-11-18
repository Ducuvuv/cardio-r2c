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
  const MINS = [1, 2, 3];
  function okSize(n) { n = Math.round(Number(n)); return n >= 5 && n <= 1000 ? n : null; }
  function okMax(n) { n = Math.round(Number(n)); return n >= 0 && n <= 999 ? n : null; }
  const SRC_LABEL = { planj: 'Méthode des J', read: 'Fiche lue', manual: 'Ajouté' };

  function h() { return CARDIO.util.h.apply(null, arguments); }
  function str(v) { return v == null ? '' : String(v); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  function blank() { return { chapters: {}, off: {}, size: 100, min: 2, maxCh: 0, lastIn: {}, presets: [], day: null }; }
  /* ---------- slots : plusieurs paquets indépendants (cours, réglages, file du jour propres) ----------
   * META = {cur, list:[{id, name, auto}]}. Le slot « main » garde la clé historique LS ; les autres LS + '.' + id.
   * auto = les fiches lues et la Méthode des J y ajoutent leurs cours. */
  const META = 'cardio.deck.slots';
  function slotKey(id) { return !id || id === 'main' ? LS : LS + '.' + id; }
  function meta() {
    let m = null;
    try { m = JSON.parse(localStorage.getItem(META) || 'null'); } catch (e) { m = null; }
    if (m && Array.isArray(m.list) && m.list.length) {
      m.list = m.list.filter(function (x) { return x && typeof x.id === 'string' && /^[a-z0-9]+$/.test(x.id); }).map(function (x) { return { id: x.id, name: str(x.name).slice(0, 40) || 'Paquet', auto: !!x.auto }; });
      if (m.list.length) { if (!m.list.some(function (x) { return x.id === m.cur; })) m.cur = m.list[0].id; return m; }
    }
    m = { cur: 'main', list: [{ id: 'main', name: 'Paquet principal', auto: true }] };
    /* migration : chaque paquet enregistré (v125) devient un slot */
    try {
      const d = load('main');
      (d.presets || []).forEach(function (pr, i) {
        const id = 's' + Date.now().toString(36) + i;
        const nd = blank(); pr.keys.forEach(function (k) { nd.chapters[k] = { added: Date.now(), src: 'manual' }; });
        if (pr.size) nd.size = pr.size; if (pr.min) nd.min = pr.min; if (pr.maxCh != null) nd.maxCh = pr.maxCh;
        save(nd, id); m.list.push({ id: id, name: pr.name, auto: false });
      });
      if ((d.presets || []).length) { d.presets = []; save(d, 'main'); }
    } catch (e) { /* ignore */ }
    saveMeta(m);
    return m;
  }
  function saveMeta(m) { try { localStorage.setItem(META, JSON.stringify(m)); } catch (e) { /* ignore */ } }
  function curId() { return meta().cur; }
  function curSlot() { const m = meta(); return m.list.find(function (x) { return x.id === m.cur; }) || m.list[0]; }

  function load(id) {
    try {
      const raw = JSON.parse(localStorage.getItem(slotKey(id === undefined ? curId() : id)) || 'null');
      const d = blank();
      if (!raw || typeof raw !== 'object') return d;
      if (raw.chapters && typeof raw.chapters === 'object') Object.keys(raw.chapters).forEach(function (k) {
        const c = raw.chapters[k];
        if (/^[ip]:/.test(k) && c && typeof c === 'object') d.chapters[k] = { added: Number(c.added) || Date.now(), src: SRC_LABEL[c.src] ? c.src : 'manual' };
      });
      if (raw.off && typeof raw.off === 'object') Object.keys(raw.off).forEach(function (k) { if (/^[ip]:/.test(k)) d.off[k] = Number(raw.off[k]) || 1; });
      if (okSize(raw.size)) d.size = okSize(raw.size);
      if (MINS.indexOf(Number(raw.min)) >= 0) d.min = Number(raw.min);
      if (okMax(raw.maxCh) != null) d.maxCh = okMax(raw.maxCh);
      if (raw.lastIn && typeof raw.lastIn === 'object') Object.keys(raw.lastIn).forEach(function (k) { if (/^[ip]:/.test(k) && typeof raw.lastIn[k] === 'string') d.lastIn[k] = raw.lastIn[k]; });
      if (Array.isArray(raw.presets)) d.presets = raw.presets.filter(function (x) { return x && typeof x.name === 'string' && Array.isArray(x.keys); }).map(function (x) {
        return { name: x.name.slice(0, 40), keys: x.keys.map(str).filter(function (k) { return /^[ip]:./.test(k); }), size: okSize(x.size), min: MINS.indexOf(Number(x.min)) >= 0 ? Number(x.min) : null, maxCh: okMax(x.maxCh) };
      });
      if (raw.day && typeof raw.day === 'object' && typeof raw.day.date === 'string' && Array.isArray(raw.day.queue)) {
        d.day = { date: raw.day.date, queue: raw.day.queue.map(str).filter(Boolean), done: raw.day.done && typeof raw.day.done === 'object' ? raw.day.done : {}, chs: Array.isArray(raw.day.chs) ? raw.day.chs.map(str) : null };
      }
      return d;
    } catch (e) { return blank(); }
  }
  function save(d, id) { try { localStorage.setItem(slotKey(id === undefined ? curId() : id), JSON.stringify(d)); } catch (e) { /* stockage indisponible */ } }

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
    const info = scoreInfo();
    const ks = pickChapters(d, keep, info);
    const per = perChapter(d, ks.length);
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
    d.day = { date: t, queue: kept.concat(shuffle(fresh)), done: done, chs: ks };
    ks.forEach(function (k) { d.lastIn[k] = t; });
    return d;
  }
  /* Chapitres du jour : tous les actifs, ou au plus maxCh en rotation (jamais / le moins récemment inclus d'abord,
   * puis le plus de cartes dues). Ceux déjà choisis aujourd'hui restent, pour que la file ne change pas en cours de journée. */
  function pickChapters(d, keep, info) {
    const all = Object.keys(d.chapters).filter(hasCards);
    if (!d.maxCh || all.length <= d.maxCh) return all;
    const stay = (keep.chs || []).filter(function (k) { return all.indexOf(k) >= 0; }).slice(0, d.maxCh);
    const dueN = function (k) { return cardsOfChapter(k).filter(function (c) { const s = info(c); return s.due || s.lapses > 0; }).length; };
    const others = all.filter(function (k) { return stay.indexOf(k) < 0; }).map(function (k) {
      return { k: k, li: d.lastIn[k] || '', due: dueN(k) };
    }).sort(function (a, b) { return a.li < b.li ? -1 : a.li > b.li ? 1 : b.due - a.due; });
    return stay.concat(others.slice(0, d.maxCh - stay.length).map(function (x) { return x.k; }));
  }
  /* Synchronise les chapitres (Méthode des J) et construit la file une fois par jour. */
  function ensure() {
    const d = load();
    let changed = false;
    if (curSlot().auto) planjKeys().forEach(function (k) { if (!d.chapters[k] && !d.off[k]) { d.chapters[k] = { added: Date.now(), src: 'planj' }; changed = true; } });
    if (!d.day || d.day.date !== today() || changed) { rebuild(d); save(d); }
    return d;
  }

  /* ---------- API ---------- */
  function activate(k, src, force) {
    try {
      k = str(k);
      if (!/^[ip]:./.test(k)) return;
      src = src || 'manual';
      const ids = src === 'manual' ? [curId()] : meta().list.filter(function (x) { return x.auto; }).map(function (x) { return x.id; });
      ids.forEach(function (id) {
        const d = load(id);
        if (d.chapters[k]) return;
        if (d.off[k] && !force) return;
        delete d.off[k];
        d.chapters[k] = { added: Date.now(), src: src };
        if (d.day && d.day.date === today()) rebuild(d);
        save(d, id);
      });
    } catch (e) { /* ignore */ }
  }
  /* --- gestion des slots --- */
  function slots() {
    const m = meta();
    return m.list.map(function (x) {
      const d = load(x.id), t = today();
      const q = d.day && d.day.date === t ? d.day.queue : [];
      return { id: x.id, name: x.name, auto: x.auto, cur: x.id === m.cur, chapters: Object.keys(d.chapters).length, done: q.filter(function (k) { return d.day.done[k] != null; }).length, total: q.length };
    });
  }
  function useSlot(id) { const m = meta(); if (m.list.some(function (x) { return x.id === id; })) { m.cur = id; saveMeta(m); } }
  /* Nouveau slot : vide ou copie des cours/réglages du slot courant. Devient le slot courant. */
  function newSlot(name, copy) {
    try {
      const m = meta(), id = 's' + Date.now().toString(36);
      const src = load(), d = blank();
      if (copy) { Object.keys(src.chapters).forEach(function (k) { d.chapters[k] = { added: Date.now(), src: 'manual' }; }); d.size = src.size; d.min = src.min; d.maxCh = src.maxCh; }
      save(d, id);
      m.list.push({ id: id, name: str(name).trim().slice(0, 40) || 'Paquet ' + (m.list.length + 1), auto: false });
      m.cur = id; saveMeta(m);
      return id;
    } catch (e) { return null; }
  }
  function renameSlot(id, name) { const m = meta(), x = m.list.find(function (y) { return y.id === id; }); name = str(name).trim().slice(0, 40); if (x && name) { x.name = name; saveMeta(m); } }
  function setAuto(id, v) { const m = meta(), x = m.list.find(function (y) { return y.id === id; }); if (x) { x.auto = !!v; saveMeta(m); } }
  function deleteSlot(id) {
    const m = meta();
    if (m.list.length < 2) return;
    m.list = m.list.filter(function (x) { return x.id !== id; });
    if (m.cur === id) m.cur = m.list[0].id;
    saveMeta(m);
    try { localStorage.removeItem(slotKey(id)); } catch (e) { /* ignore */ }
  }
  function remove(k) {
    try {
      const d = load();
      delete d.chapters[k]; d.off[k] = Date.now();
      rebuild(d); save(d);
    } catch (e) { /* ignore */ }
  }
  function setSize(n) { try { const d = load(); n = okSize(n); if (!n) return; d.size = n; rebuild(d); save(d); } catch (e) { /* ignore */ } }
  function setMaxCh(n) { try { const d = load(); n = okMax(n); if (n == null) return; d.maxCh = n; rebuild(d); save(d); } catch (e) { /* ignore */ } }
  /* Sélection en bloc : `keys` devient la liste exacte des chapitres actifs. */
  function setChapters(keys) {
    try {
      const d = load(), want = {};
      keys.forEach(function (k) { if (/^[ip]:./.test(k)) want[k] = 1; });
      Object.keys(d.chapters).forEach(function (k) { if (!want[k]) { delete d.chapters[k]; d.off[k] = Date.now(); } });
      Object.keys(want).forEach(function (k) { if (!d.chapters[k]) { delete d.off[k]; d.chapters[k] = { added: Date.now(), src: 'manual' }; } });
     
      rebuild(d); save(d);
    } catch (e) { /* ignore */ }
  }
  function savePreset(name) {
    try {
      name = str(name).trim().slice(0, 40); if (!name) return;
      const d = load();
      const p = { name: name, keys: Object.keys(d.chapters), size: d.size, min: d.min, maxCh: d.maxCh };
      const i = d.presets.findIndex(function (x) { return x.name === name; });
      if (i >= 0) d.presets[i] = p; else d.presets.push(p);
      save(d);
    } catch (e) { /* ignore */ }
  }
  function loadPreset(name) {
    try {
      const d = load(), p = d.presets.find(function (x) { return x.name === name; });
      if (!p) return;
      if (p.size) d.size = p.size; if (p.min) d.min = p.min; if (p.maxCh != null) d.maxCh = p.maxCh;
      save(d); setChapters(p.keys);
    } catch (e) { /* ignore */ }
  }
  function deletePreset(name) { try { const d = load(); d.presets = d.presets.filter(function (x) { return x.name !== name; }); save(d); } catch (e) { /* ignore */ } }
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
      const act = Object.keys(d.chapters).filter(hasCards).length;
      const k = d.day && d.day.chs ? d.day.chs.length : act;
      const q = d.day ? d.day.queue : [];
      const done = q.filter(function (key) { return d.day.done[key] != null; }).length;
      return { queue: q.slice(), remaining: q.filter(function (key) { return d.day.done[key] == null; }), done: done, total: q.length, k: k, active: act, slot: curSlot().name, nSlots: meta().list.length, maxCh: d.maxCh, chs: d.day && d.day.chs ? d.day.chs.slice() : [], chapters: Object.keys(d.chapters).length, size: d.size, min: d.min, per: perChapter(d, k) };
    } catch (e) { return { queue: [], remaining: [], done: 0, total: 0, k: 0, active: 0, slot: '', nSlots: 1, maxCh: 0, chs: [], chapters: 0, size: 100, min: 2, per: 0 }; }
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
  /* Rangée de boutons pour changer de slot (null s'il n'y en a qu'un). */
  function slotChips(onSwitch, always) {
    try {
      const L = slots();
      if (L.length < 2 && !always) return null;
      return h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center' }, L.map(function (x) {
        return h('button', { type: 'button', class: 'btn btn--sm ' + (x.cur ? 'btn--primary' : 'btn--outline'), on: { click: function () { useSlot(x.id); if (typeof onSwitch === 'function') onSwitch(); } } },
          x.name + (x.total ? ' · ' + x.done + '/' + x.total : ''));
      }));
    } catch (e) { return null; }
  }
  const GROUPS = ['Cardio', 'Dermato', 'Pneumo', 'Parasito-myco', 'Bactério', 'Viro'];
  function openSheet(onChange) {
    const sh = CARDIO.shell;
    if (!sh || typeof sh.sheet !== 'function') return;
    const body = h('div', { class: 'stack' });
    let mode = 'main', picked = null, q = '';
    function notify() { try { if (typeof onChange === 'function') onChange(); } catch (e) { /* ignore */ } }
    function changed() { draw(); notify(); }
    function btn(cls, label, fn, extra) { return h('button', Object.assign({ type: 'button', class: 'btn btn--sm ' + cls, on: { click: fn } }, extra || {}), label); }
    function chips(label, list, cur, set, fmt) {
      return h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center' }, h('span', { class: 'secondary muted', style: 'min-width:110px' }, label),
        list.map(function (n) { return btn(n === cur ? 'btn--primary' : 'btn--outline', fmt ? fmt(n) : String(n), function () { set(n); changed(); }); }));
    }
    /* Champ numérique libre avec − / + (valeur 0 = « Tous » si zeroLabel). Appliqué à la validation du champ. */
    function stepper(label, cur, step, lo, hi, set, zeroLabel) {
      const inp = h('input', { type: 'number', min: String(lo), max: String(hi), step: '1', inputmode: 'numeric', style: 'width:76px;padding:6px;border-radius:10px;border:2px solid var(--line);background:var(--surface);color:var(--ink);text-align:center;font-weight:700' });
      inp.value = String(cur);
      function apply(v) { v = Math.max(lo, Math.min(hi, Math.round(Number(v) || 0))); set(v); changed(); }
      inp.addEventListener('change', function () { apply(inp.value); });
      return h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center' }, h('span', { class: 'secondary muted', style: 'min-width:110px' }, label),
        btn('btn--outline', '−', function () { apply(cur - step); }, { 'aria-label': label + ' moins' }), inp,
        btn('btn--outline', '+', function () { apply(cur + step); }, { 'aria-label': label + ' plus' }),
        zeroLabel ? btn(cur === 0 ? 'btn--primary' : 'btn--ghost', zeroLabel, function () { apply(0); }) : null,
        zeroLabel && cur === 0 ? h('span', { class: 'secondary muted', style: 'font-size:.8125rem' }, '(tous tes cours chaque jour)') : null);
    }
    const inputStyle = 'flex:1;min-width:0;padding:8px;border-radius:10px;border:2px solid var(--line);background:var(--surface);color:var(--ink)';

    /* Sélecteur : cases à cocher par matière, recherche, tout / aucun ; appliqué par « Valider ». */
    function drawPick() {
      const cat = catalog();
      const list = h('div', { style: 'display:grid;gap:2px;max-height:52vh;overflow:auto' });
      const count = h('b', {});
      function refreshCount() { count.textContent = Object.keys(picked).length + ' cours cochés'; }
      function fill() {
        const ql = q.toLowerCase();
        list.replaceChildren.apply(list, GROUPS.map(function (g) {
          const ms = cat.filter(function (m) { return m.group === g && (!ql || chapterTitle(m.key).toLowerCase().indexOf(ql) >= 0); });
          if (!ms.length) return null;
          const boxes = [];
          const rows = ms.map(function (m) {
            const cb = h('input', { type: 'checkbox', style: 'width:20px;height:20px;flex:none' });
            cb.checked = !!picked[m.key];
            cb.addEventListener('change', function () { if (cb.checked) picked[m.key] = 1; else delete picked[m.key]; refreshCount(); });
            boxes.push([cb, m.key]);
            return h('label', { style: 'display:flex;gap:10px;align-items:center;padding:7px 2px;border-top:1px solid var(--line);cursor:pointer' }, cb,
              h('span', { style: 'flex:1;min-width:0' }, chapterTitle(m.key)), h('span', { class: 'secondary muted', style: 'font-size:.75rem' }, String(cardsOfChapter(m.key).length)));
          });
          function all(v) { boxes.forEach(function (b) { b[0].checked = v; if (v) picked[b[1]] = 1; else delete picked[b[1]]; }); refreshCount(); }
          return h('div', {}, h('div', { style: 'display:flex;gap:6px;align-items:center;margin-top:10px;position:sticky;top:0;background:var(--surface);z-index:1;padding:4px 0' },
            h('b', { style: 'flex:1' }, g + ' (' + ms.length + ')'), btn('btn--ghost', 'Tout', function () { all(true); }), btn('btn--ghost', 'Aucun', function () { all(false); })), rows);
        }));
        refreshCount();
      }
      const search = h('input', { type: 'search', placeholder: 'Rechercher un cours…', style: inputStyle });
      search.value = q;
      search.addEventListener('input', function () { q = search.value; fill(); });
      fill();
      body.replaceChildren(
        h('p', { class: 'secondary', style: 'margin:0' }, 'Coche les cours de ton paquet. Un cours décoché en sort, et la Méthode des J ne le remettra pas.'),
        search, list,
        h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, count, h('span', { style: 'flex:1' }),
          btn('btn--outline', 'Annuler', function () { mode = 'main'; draw(); }),
          btn('btn--primary', 'Valider', function () { setChapters(Object.keys(picked)); mode = 'main'; changed(); })));
    }

    function drawMain() {
      const d = ensure(), t = todayDeck();
      const keys = Object.keys(d.chapters).sort(function (a, b) { return d.chapters[b].added - d.chapters[a].added; });
      const inToday = {}; t.chs.forEach(function (k) { inToday[k] = 1; });
      const status = !t.active ? 'Aucun cours actif. Un cours entre ici dès que tu ouvres sa fiche ou que tu le places dans la Méthode des J.'
        : t.total + ' cartes aujourd’hui · ' + t.k + (t.k < t.active ? ' cours sur ' + t.active + ' (rotation)' : ' cours') + ' · ' + t.per + ' carte' + (t.per > 1 ? 's' : '') + ' par cours' + (t.total > t.size ? ' (au-delà de ' + t.size + ' pour garder le minimum)' : '');
      const sl = curSlot(), nS = meta().list.length;
      const nm = h('input', { type: 'text', maxlength: '40', placeholder: 'Nom du nouveau paquet', style: inputStyle });
      const ren = h('input', { type: 'text', maxlength: '40', style: inputStyle });
      ren.value = sl.name;
      ren.addEventListener('change', function () { renameSlot(sl.id, ren.value); changed(); });
      body.replaceChildren(
        h('b', {}, '🗂️ Mes paquets (' + nS + ')'),
        slotChips(changed, true),
        h('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, nm,
          btn('btn--secondary', '＋ Vide', function () { newSlot(nm.value, false); changed(); }),
          btn('btn--outline', '＋ Copie', function () { newSlot(nm.value || sl.name + ' (copie)', true); changed(); }, { title: 'Nouveau paquet avec les mêmes cours et réglages' })),
        h('div', { class: 'card', style: 'display:grid;grid-template-columns:minmax(0,1fr);gap:8px;padding:10px 12px;background:var(--surface-2);min-width:0' },
          h('div', { style: 'display:flex;gap:6px;align-items:center' }, h('span', { class: 'secondary muted', style: 'min-width:60px' }, 'Nom'), ren,
            nS > 1 ? btn('btn--ghost', '🗑', function () { if (window.confirm('Supprimer le paquet « ' + sl.name + ' » ? Ses cours et sa progression du jour seront effacés (tes flashcards et ta répétition espacée ne bougent pas).')) { deleteSlot(sl.id); changed(); } }, { 'aria-label': 'Supprimer ce paquet' }) : null),
          h('label', { style: 'display:flex;gap:10px;align-items:center;cursor:pointer' },
            (function () { const cb = h('input', { type: 'checkbox', style: 'width:20px;height:20px;flex:none' }); cb.checked = !!sl.auto; cb.addEventListener('change', function () { setAuto(sl.id, cb.checked); changed(); }); return cb; })(),
            h('span', { class: 'secondary' }, 'Ajout auto : les fiches que tu lis et la Méthode des J ajoutent leurs cours à ce paquet')),
          h('p', { class: 'secondary', style: 'margin:0' }, status)),
        stepper('Cartes par jour', d.size, 10, 5, 1000, setSize, null),
        stepper('Cours par jour', d.maxCh, 1, 0, 999, setMaxCh, 'Tous'),
        d.maxCh ? h('p', { class: 'secondary muted', style: 'margin:0;font-size:.8125rem' }, 'Chaque jour, l’app prend ' + d.maxCh + ' de tes cours : d’abord ceux que tu n’as pas revus depuis le plus longtemps, puis ceux qui ont le plus de cartes dues. Tous finissent par passer.') : null,
        chips('Minimum / cours', MINS, d.min, setMin),
        btn('btn--secondary btn--block', '☑️ Choisir mes cours', function () { picked = {}; Object.keys(d.chapters).forEach(function (k) { picked[k] = 1; }); q = ''; mode = 'pick'; draw(); }),

        h('b', {}, 'Cours actifs (' + keys.length + ')'),
        keys.length ? h('div', { style: 'display:grid;gap:4px;max-height:40vh;overflow:auto' }, keys.map(function (k) {
          const n = cardsOfChapter(k).length;
          return h('div', { style: 'display:flex;gap:8px;align-items:center;padding:6px 0;border-top:1px solid var(--line)' },
            h('div', { style: 'flex:1;min-width:0' }, h('div', { style: 'font-weight:600' }, chapterTitle(k)),
              h('div', { class: 'secondary muted', style: 'font-size:.8125rem' }, (SRC_LABEL[d.chapters[k].src] || 'Ajouté') + ' · ' + (n ? n + ' cartes' : 'pas de flashcards') + (t.k < t.active && inToday[k] ? ' · 📦 aujourd’hui' : ''))),
            btn('btn--ghost', '✕', function () { remove(k); changed(); }, { 'aria-label': 'Retirer ' + chapterTitle(k) }));
        })) : null);
    }
    function draw() { if (mode === 'pick') drawPick(); else drawMain(); }
    draw();
    sh.sheet(body, { title: '📦 Mes paquets' });
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
            h('b', {}, '📦 ' + (x.nSlots > 1 ? x.slot : 'Paquet du jour') + (x.total ? ' · ' + x.done + '/' + x.total : '') + ' · ' + x.k + ' cours'),
            h('button', { type: 'button', class: 'btn btn--ghost btn--sm', on: { click: function () { openSheet(function () { draw(); if (typeof onChange === 'function') onChange(); }); } } }, 'Mes paquets')),
          slotChips(function () { draw(); if (typeof onChange === 'function') onChange(); }),
          x.total ? h('div', { class: 'fc-bar', style: 'height:6px;border-radius:3px;background:var(--surface-3);overflow:hidden' }, h('b', { style: 'display:block;height:100%;background:var(--accent);width:' + Math.round(100 * x.done / x.total) + '%' })) : null,
          h('p', { class: 'secondary muted', style: 'margin:0' }, !x.k ? 'Ouvre un cours ou place-le dans la Méthode des J : ses flashcards reviendront ici chaque jour.' : end ? 'Paquet du jour terminé ✓ Reviens demain.' : (x.total - x.done) + ' cartes à faire · ' + x.per + ' par chapitre'),
          x.total && !end ? h('a', { class: 'btn btn--primary btn--block', href: '#/scroll?deck=1' }, x.done ? 'Reprendre le paquet' : 'Lancer le paquet') : null);
      }
      draw();
      return wrap;
    } catch (e) { return null; }
  }

  CARDIO.deck = { activate: activate, remove: remove, summary: summary, today: todayDeck, markDone: markDone, setSize: setSize, setMin: setMin, setMaxCh: setMaxCh, setChapters: setChapters,
    savePreset: savePreset, loadPreset: loadPreset, deletePreset: deletePreset,
    slots: slots, useSlot: useSlot, newSlot: newSlot, renameSlot: renameSlot, setAuto: setAuto, deleteSlot: deleteSlot, slotChips: slotChips,
    openSheet: openSheet, card: card, chapterTitle: chapterTitle, available: available };
})();
