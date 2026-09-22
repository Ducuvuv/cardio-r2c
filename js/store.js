/* CardioR2C — store.js
 * CARDIO.store : état de progression, persistance locale (localStorage), synchronisation cloud
 * (artifact `db`), export/import, gamification et file de révision intelligente.
 * Contrat : docs/SPEC.md §3.3, §4, §5, §6.
 *
 * Script classique ES2020. Aucune dépendance au chargement : CARDIO.util, CARDIO.srs et
 * CARDIO.registry ne sont appelés qu'à l'exécution, avec repli gracieux s'ils manquent.
 *
 * Persistance :
 *  - localStorage `cardio.r2c.v1` (clé remplaçable via CARDIO.config.storageKey, utile aux tests),
 *    écriture debounce 300 ms + immédiate sur pagehide / onglet masqué.
 *  - cloud (claude.use('db') + claude.use('user')) : documents `data/users/<uid>/profile` (tout sauf
 *    les cartes) et `data/users/<uid>/cards-<num>` ({cards, updatedAt}) ; repli `progress/...` sans uid.
 *    Écritures en file séquentielle, une seule en vol, regroupées 2 s après le dernier changement,
 *    uniquement pour les documents dont le contenu a changé ; un nouvel essai après échec puis
 *    statut « error ».
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  CARDIO.views = CARDIO.views || {};

  /* ---------- constantes ---------- */

  const VERSION = 1;
  const DEFAULT_STORAGE_KEY = 'cardio.r2c.v1';
  const STORAGE_KEY = (CARDIO.config && typeof CARDIO.config.storageKey === 'string' && CARDIO.config.storageKey) || DEFAULT_STORAGE_KEY;
  const SAVE_DEBOUNCE_MS = 300;
  const CLOUD_COALESCE_MS = 2000;
  const CLOUD_READY_TIMEOUT_MS = 1500;
  const MAX_SESSIONS = 50;
  const SESSIONS_WITH_CARDS = 5;      // seules les 5 dernières sessions gardent leur liste de cartes
  const HIST_MAX = 10;
  const DAY_MS = 86400000;
  const RECENT_MS_MAX = 50;           // échantillons de temps de réponse par kind (médiane, en mémoire)
  const RECENT_MS_MIN = 5;

  /* Items du Collège (repli quand le manifest n'est pas disponible). */
  const ITEM_NUMS = ['221', '222', '223', '224', '339', '230', '225', '233', '152', '153', '238',
    '342', '232', '236', '231', '237', '203', '234', '226', '235', '331', '330'];

  const LEVEL_NAMES = ['Externe', 'Interne', 'Chef de clinique', 'Praticien', 'Professeur'];
  const LEVELS_PER_NAME = 3;          // Externe = niveaux 1-3, Interne = 4-6, … Professeur = 13+

  /* XP (SPEC §6) : kinds « × score » et kinds forfaitaires (forfait entier si score ≥ 0,5, moitié sinon). */
  const XP_BASE = { qcm: 10, qroc: 12, open: 12, case: 40, tree: 8, tx: 8, flash: 4, kfp: 15, tcs: 15, ecg: 10, echo: 10 };
  const XP_SCALED = { qcm: true, case: true, ecg: true, echo: true };
  const XP_HARD_BONUS = 5;

  const KIND_OF_SEGMENT = {
    qcm: 'qcm', qru: 'qcm', qroc: 'qroc', open: 'open', kfp: 'kfp', tcs: 'tcs',
    ess: 'flash', num: 'flash', mn: 'flash', tree: 'tree', tx: 'tx', case: 'case', ecg: 'ecg', echo: 'echo'
  };
  const KIND_COST = { case: 4 };      // un dossier compte pour 4 cartes dans une session
  const MAX_RUN = 3;                  // pas plus de 3 cartes consécutives du même kind
  const EXAM_SHAPE = { qcm: 18, kfp: 2, tcs: 1, case: 1 };
  const CARD_STATES = ['new', 'learning', 'review', 'relearning'];
  const THEMES = ['system', 'light', 'dark'];

  /* ---------- petits utilitaires ---------- */

  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function num(v, def) { const n = Number(v); return Number.isFinite(n) ? n : def; }
  function int(v) { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; }
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function uniqStrings(arr) {
    const seen = {}; const out = [];
    (Array.isArray(arr) ? arr : []).forEach(function (x) {
      if (typeof x !== 'string' || !x || seen[x]) return;
      seen[x] = true; out.push(x);
    });
    return out;
  }
  /* Clone avec clés triées récursivement : sérialisation stable pour comparer deux documents. */
  function sortKeys(v) {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (!isObj(v)) return v;
    const o = {};
    Object.keys(v).sort().forEach(function (k) { if (v[k] !== undefined) o[k] = sortKeys(v[k]); });
    return o;
  }
  const warned = {};
  function warnOnce(key, msg) {
    if (warned[key]) return;
    warned[key] = true;
    console.warn('[store] ' + msg);
  }

  function util() { return CARDIO.util || null; }
  function srs() {
    if (CARDIO.srs && typeof CARDIO.srs.review === 'function') return CARDIO.srs;
    warnOnce('srs', 'CARDIO.srs indisponible : planification simplifiée.');
    return null;
  }
  function registry() { return CARDIO.registry || null; }
  function nowMs() {
    const u = util();
    if (u && typeof u.now === 'function') { try { const n = u.now(); if (Number.isFinite(n)) return n; } catch (e) { /* repli */ } }
    return Date.now();
  }
  function emit(evt, payload) {
    const u = util();
    if (u && typeof u.emit === 'function') {
      try { u.emit(evt, payload); } catch (e) { console.warn('[store] emit ' + evt, e); }
    }
  }
  function makeId(prefix) {
    const u = util();
    if (u && typeof u.uid === 'function') { try { const id = u.uid(); if (id) return String(id); } catch (e) { /* repli */ } }
    return (prefix || 's') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- dates locales 'YYYY-MM-DD' ---------- */

  function dateKey(ms) {
    const d = new Date(ms === undefined ? nowMs() : ms);
    const p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function parseKey(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0) : null;
  }
  function addDays(key, n) {
    const d = parseKey(key);
    if (!d) return key;
    d.setDate(d.getDate() + n);
    return dateKey(d.getTime());
  }
  function daysBetween(a, b) {
    const da = parseKey(a), db = parseKey(b);
    if (!da || !db) return 0;
    return Math.round((db.getTime() - da.getTime()) / DAY_MS);
  }
  function today() { return dateKey(nowMs()); }

  /* ---------- identifiants de cartes ---------- */

  function itemOfId(id) { const m = /^(\d+)-/.exec(String(id || '')); return m ? m[1] : ''; }
  function kindOfId(id) {
    const parts = String(id || '').split('-');
    return parts.length >= 3 ? (KIND_OF_SEGMENT[parts[1]] || null) : null;
  }
  /* Métadonnées d'une carte : registre si disponible, sinon dérivées de l'id (rank inconnu). */
  function cardMeta(id) {
    const reg = registry();
    if (reg && typeof reg.card === 'function') {
      try {
        const c = reg.card(id);
        if (c) return { id: String(c.id), item: String(c.item || itemOfId(id)), kind: c.kind || kindOfId(id), rank: c.rank || null };
      } catch (e) { warnOnce('regcard', 'registry.card a échoué : ' + e); }
    }
    return { id: String(id), item: itemOfId(id), kind: kindOfId(id), rank: null };
  }
  function cardCost(id) { return KIND_COST[cardMeta(id).kind] || 1; }
  function cardDocKey(cardId) { return 'cards-' + (itemOfId(cardId) || 'misc'); }
  function touched(c) { return !!c && (c.reps > 0 || c.due !== null && c.due !== undefined); }

  /* Cartes indexées par le registre (null si le registre est absent, [] si rien n'est chargé). */
  function registryCards(item) {
    const reg = registry();
    if (!reg || typeof reg.cards !== 'function') return null;
    try {
      const list = reg.cards(item === undefined || item === null || item === '' ? undefined : String(item));
      return Array.isArray(list) ? list : [];
    } catch (e) {
      warnOnce('regcards', 'registry.cards a échoué : ' + e);
      return null;
    }
  }
  function manifestItemNums() {
    const reg = registry();
    let nums = [];
    try {
      if (reg && reg.manifest && Array.isArray(reg.manifest.items)) nums = reg.manifest.items.map(function (it) { return String(it.num); });
    } catch (e) { /* repli */ }
    return nums.length ? nums : ITEM_NUMS.slice();
  }
  function manifestCardTotal(itemNum) {
    const reg = registry();
    if (!reg || typeof reg.item !== 'function') return 0;
    try {
      const it = reg.item(itemNum);
      if (!it || !isObj(it.counts)) return 0;
      let t = 0;
      Object.keys(it.counts).forEach(function (k) { t += Math.max(0, int(it.counts[k])); });
      return t;
    } catch (e) { return 0; }
  }

  /* ---------- état par défaut, normalisation, migrations ---------- */

  function defaultProfile() {
    return { name: '', dailyGoal: 30, newPerDay: 15, retention: 0.9, theme: 'system', sound: false, haptics: true };
  }
  function emptyDaily() { return { reviews: 0, newCards: 0, correct: 0, score: 0, ms: 0, xp: 0 }; }
  function defaultState(ts) {
    const t = Number.isFinite(ts) ? ts : Date.now();
    return {
      v: VERSION, createdAt: t, updatedAt: t,
      profile: defaultProfile(),
      cards: {}, daily: {},
      streak: { current: 0, best: 0, lastDay: null },
      xp: 0, badges: [],
      errors: {}, notes: {}, bookmarks: [], itemStats: {}, sessions: []
    };
  }
  function blankCard() { return { s: 0, d: 0, due: null, last: null, reps: 0, lapses: 0, state: 'new', hist: [] }; }

  function normCard(c) {
    if (!isObj(c)) return blankCard();
    const out = {
      s: Math.max(0, num(c.s, 0)),
      d: num(c.d, 0),
      due: Number.isFinite(c.due) ? c.due : null,
      last: Number.isFinite(c.last) ? c.last : null,
      reps: Math.max(0, int(c.reps)),
      lapses: Math.max(0, int(c.lapses)),
      state: CARD_STATES.indexOf(c.state) >= 0 ? c.state : (Number.isFinite(c.last) ? 'review' : 'new'),
      hist: Array.isArray(c.hist) ? c.hist.filter(Array.isArray).slice(-HIST_MAX).map(function (h) {
        return [num(h[0], 0), int(h[1]), h[2] == null ? null : num(h[2], 0), h[3] == null ? null : num(h[3], 0)];
      }) : []
    };
    if (out.reps === 0 && out.last === null) out.state = 'new';
    return out;
  }
  function normProfile(p) {
    const d = defaultProfile();
    if (!isObj(p)) return d;
    return {
      name: typeof p.name === 'string' ? p.name.slice(0, 60) : d.name,
      dailyGoal: clamp(int(num(p.dailyGoal, d.dailyGoal)), 1, 1000),
      newPerDay: clamp(int(num(p.newPerDay, d.newPerDay)), 0, 500),
      retention: clamp(num(p.retention, d.retention), 0.7, 0.99),
      theme: THEMES.indexOf(p.theme) >= 0 ? p.theme : d.theme,
      sound: p.sound === true,
      haptics: p.haptics !== false
    };
  }
  function normSession(s) {
    if (!isObj(s) || !s.id) return null;
    return {
      id: String(s.id),
      mode: typeof s.mode === 'string' ? s.mode : 'smart',
      item: s.item == null ? null : String(s.item),
      startedAt: num(s.startedAt, 0),
      endedAt: Number.isFinite(s.endedAt) ? s.endedAt : null,
      size: Math.max(0, int(s.size)),
      done: Math.max(0, int(s.done)),
      score: Number.isFinite(s.score) ? clamp(s.score, 0, 1) : null,
      xp: Math.max(0, int(s.xp)),
      cards: Array.isArray(s.cards) ? uniqStrings(s.cards) : undefined
    };
  }
  function trimSessions(list) {
    const out = list.slice().sort(function (a, b) { return b.startedAt - a.startedAt; }).slice(0, MAX_SESSIONS);
    out.forEach(function (s, i) { if (i >= SESSIONS_WITH_CARDS || !s.cards) delete s.cards; });
    return out;
  }

  /* Reconstruit un état complet et sain à partir d'un objet quelconque. */
  function normalize(raw, ts) {
    const r = isObj(raw) ? raw : {};
    const now = Number.isFinite(ts) ? ts : Date.now();
    const st = defaultState(now);
    st.v = VERSION;
    st.createdAt = num(r.createdAt, now);
    st.updatedAt = num(r.updatedAt, st.createdAt);
    st.profile = normProfile(r.profile);
    if (isObj(r.cards)) Object.keys(r.cards).forEach(function (id) { if (isObj(r.cards[id])) st.cards[id] = normCard(r.cards[id]); });
    if (isObj(r.daily)) Object.keys(r.daily).forEach(function (k) {
      if (!parseKey(k) || !isObj(r.daily[k])) return;
      const d = r.daily[k];
      st.daily[k] = {
        reviews: Math.max(0, int(d.reviews)), newCards: Math.max(0, int(d.newCards)), correct: Math.max(0, int(d.correct)),
        score: Math.max(0, num(d.score, 0)), ms: Math.max(0, int(d.ms)), xp: Math.max(0, int(d.xp))
      };
    });
    if (isObj(r.streak)) st.streak = { current: Math.max(0, int(r.streak.current)), best: Math.max(0, int(r.streak.best)), lastDay: parseKey(r.streak.lastDay) ? r.streak.lastDay : null };
    st.xp = Math.max(0, int(r.xp));
    st.badges = uniqStrings(r.badges);
    if (isObj(r.errors)) Object.keys(r.errors).forEach(function (id) {
      const e = r.errors[id];
      if (!isObj(e)) return;
      st.errors[id] = { ts: num(e.ts, 0), count: Math.max(1, int(e.count) || 1), note: typeof e.note === 'string' ? e.note : '' };
    });
    if (isObj(r.notes)) Object.keys(r.notes).forEach(function (k) { if (typeof r.notes[k] === 'string' && r.notes[k]) st.notes[k] = r.notes[k]; });
    st.bookmarks = uniqStrings(r.bookmarks);
    if (isObj(r.itemStats)) Object.keys(r.itemStats).forEach(function (k) {
      const s = r.itemStats[k];
      if (isObj(s)) st.itemStats[k] = { lastVisited: num(s.lastVisited, 0), sessions: Math.max(0, int(s.sessions)) };
    });
    st.sessions = trimSessions((Array.isArray(r.sessions) ? r.sessions : []).map(normSession).filter(Boolean));
    return st;
  }

  /* Migrations indexées sur `v` : chaque fonction transforme l'objet brut vers la version suivante. */
  const MIGRATIONS = {
    /* 0 → 1 : sauvegardes sans numéro de version (premier schéma). */
    0: function (s) { s.v = 1; return s; }
  };
  function migrate(raw) {
    let s = isObj(raw) ? raw : {};
    let v = Math.max(0, int(s.v));
    let guard = 0;
    while (v < VERSION && guard++ < 50) {
      const step = MIGRATIONS[v];
      if (typeof step !== 'function') break;
      try { s = step(s) || s; } catch (e) { console.warn('[store] migration ' + v + ' échouée', e); break; }
      const nv = int(s.v);
      v = nv > v ? nv : v + 1;
      s.v = v;
    }
    s.v = VERSION;
    return s;
  }

  /* État sans les cartes jamais touchées (créées à la demande par card()). */
  function serializable(st) {
    const out = {};
    Object.keys(st).forEach(function (k) { if (k !== 'cards') out[k] = st[k]; });
    out.cards = {};
    Object.keys(st.cards || {}).forEach(function (id) { if (touched(st.cards[id])) out.cards[id] = st.cards[id]; });
    return out;
  }
  function hasActivity(st) {
    if (!st) return false;
    if (st.xp > 0 || Object.keys(st.daily).length || st.badges.length || Object.keys(st.errors).length) return true;
    if (Object.keys(st.notes).length || st.bookmarks.length || st.sessions.length) return true;
    return Object.keys(st.cards).some(function (id) { return touched(st.cards[id]); });
  }

  /* ---------- fusion (SPEC §4) : cloud ↔ local, import fusionné ---------- */

  function mergeStates(a, b) {
    const A = normalize(a), B = normalize(b);
    const bNewer = B.updatedAt > A.updatedAt;
    const out = defaultState(Math.min(A.createdAt, B.createdAt));
    out.createdAt = Math.min(A.createdAt, B.createdAt);
    out.updatedAt = Math.max(A.updatedAt, B.updatedAt);
    out.profile = bNewer ? B.profile : A.profile;                      // réglages : le plus récent
    // cartes : par carte, le `last` le plus grand gagne (à égalité, le plus de répétitions)
    const cardIds = uniqStrings(Object.keys(A.cards).concat(Object.keys(B.cards)));
    cardIds.forEach(function (id) {
      const ca = A.cards[id], cb = B.cards[id];
      if (!ca) { out.cards[id] = cb; return; }
      if (!cb) { out.cards[id] = ca; return; }
      const la = ca.last === null ? -1 : ca.last, lb = cb.last === null ? -1 : cb.last;
      out.cards[id] = lb > la || (lb === la && cb.reps > ca.reps) ? cb : ca;
    });
    // journalier : union, max par champ
    uniqStrings(Object.keys(A.daily).concat(Object.keys(B.daily))).forEach(function (k) {
      const da = A.daily[k] || emptyDaily(), db = B.daily[k] || emptyDaily();
      const d = emptyDaily();
      Object.keys(d).forEach(function (f) { d[f] = Math.max(da[f] || 0, db[f] || 0); });
      out.daily[k] = d;
    });
    out.xp = Math.max(A.xp, B.xp);
    out.badges = uniqStrings(A.badges.concat(B.badges));
    uniqStrings(Object.keys(A.errors).concat(Object.keys(B.errors))).forEach(function (id) {
      const ea = A.errors[id], eb = B.errors[id];
      if (!ea) { out.errors[id] = eb; return; }
      if (!eb) { out.errors[id] = ea; return; }
      const newer = eb.ts > ea.ts ? eb : ea;
      out.errors[id] = { ts: newer.ts, count: Math.max(ea.count, eb.count), note: newer.note || ea.note || eb.note || '' };
    });
    const primaryNotes = bNewer ? B.notes : A.notes, otherNotes = bNewer ? A.notes : B.notes;
    Object.keys(otherNotes).forEach(function (k) { out.notes[k] = otherNotes[k]; });
    Object.keys(primaryNotes).forEach(function (k) { out.notes[k] = primaryNotes[k]; });
    out.bookmarks = uniqStrings(A.bookmarks.concat(B.bookmarks));
    uniqStrings(Object.keys(A.itemStats).concat(Object.keys(B.itemStats))).forEach(function (k) {
      const sa = A.itemStats[k] || { lastVisited: 0, sessions: 0 }, sb = B.itemStats[k] || { lastVisited: 0, sessions: 0 };
      out.itemStats[k] = { lastVisited: Math.max(sa.lastVisited, sb.lastVisited), sessions: Math.max(sa.sessions, sb.sessions) };
    });
    const byId = {};
    A.sessions.concat(B.sessions).forEach(function (s) {
      const prev = byId[s.id];
      if (!prev || (s.endedAt || 0) > (prev.endedAt || 0) || s.done > prev.done) byId[s.id] = s;
    });
    out.sessions = trimSessions(Object.keys(byId).map(function (k) { return byId[k]; }));
    out.streak = computeStreak(out.daily, out.profile.dailyGoal, dateKey(nowMs()), { best: Math.max(A.streak.best, B.streak.best) });
    return out;
  }

  /* ---------- série (streak) ---------- */

  function computeStreak(daily, goal, todayKey, prev) {
    const g = Math.max(1, int(goal) || 1);
    function reached(k) { return !!daily[k] && int(daily[k].reviews) >= g; }
    let current = 0;
    let k = reached(todayKey) ? todayKey : addDays(todayKey, -1);   // la série n'est pas rompue tant que la journée n'est pas finie
    let guard = 0;
    while (reached(k) && guard++ < 5000) { current++; k = addDays(k, -1); }
    const keys = Object.keys(daily).filter(reached).sort();
    let best = 0, run = 0, prevKey = null;
    keys.forEach(function (kk) {
      run = prevKey && addDays(prevKey, 1) === kk ? run + 1 : 1;
      if (run > best) best = run;
      prevKey = kk;
    });
    return {
      current: current,
      best: Math.max(best, current, prev ? int(prev.best) : 0),
      lastDay: keys.length ? keys[keys.length - 1] : null
    };
  }

  /* ---------- état vivant, chargement local ---------- */

  const state = {};
  const local = { ok: true, lastWrite: null };

  function replaceState(next) {
    Object.keys(state).forEach(function (k) { delete state[k]; });
    Object.assign(state, next);
    return state;
  }
  function readLocal() {
    let raw = null;
    try { raw = window.localStorage ? window.localStorage.getItem(STORAGE_KEY) : null; }
    catch (e) { local.ok = false; console.warn('[store] localStorage inaccessible en lecture', e); }
    if (!raw) return null;
    try { const parsed = JSON.parse(raw); return isObj(parsed) ? parsed : null; }
    catch (e) { console.warn('[store] sauvegarde locale illisible, on repart de zéro', e); return null; }
  }
  function writeLocal() {
    try {
      if (!window.localStorage) return false;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable(state)));
      local.ok = true;
      local.lastWrite = nowMs();
      return true;
    } catch (e) {
      local.ok = false;
      warnOnce('lswrite', 'localStorage inaccessible en écriture : ' + e);
      return false;
    }
  }
  function loadLocal() {
    const raw = readLocal();
    replaceState(normalize(migrate(raw || {}), Date.now()));
  }

  /* ---------- sauvegarde (debounce) et signalement ---------- */

  let saveTimer = null;
  function save() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      writeLocal();
      scheduleCloudPush();
    }, SAVE_DEBOUNCE_MS);
  }
  function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    writeLocal();
    return pushCloud();
  }
  function touch() { state.updatedAt = nowMs(); }
  function changed(path, reason, extra) {
    touch();
    markDirty(path);
    save();
    emit('store:change', Object.assign({ path: path === undefined ? null : path, reason: reason || 'update' }, extra || {}));
  }

  /* ---------- accès générique ---------- */

  function get(path) {
    if (path === undefined || path === null || path === '') return state;
    const parts = String(path).split('.');
    let cur = state;
    for (let i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }
  function set(path, value) {
    const parts = String(path || '').split('.').filter(Boolean);
    if (!parts.length) { console.warn('[store] set : chemin vide'); return value; }
    let cur = state;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!isObj(cur[parts[i]])) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    if (parts[0] === 'profile') state.profile = normProfile(state.profile);
    if (parts[0] === 'profile' && parts[1] === 'dailyGoal') state.streak = computeStreak(state.daily, state.profile.dailyGoal, today(), state.streak);
    changed(parts.join('.'), 'set');
    return value;
  }
  function update(fn) {
    let r;
    try { r = typeof fn === 'function' ? fn(state) : undefined; }
    catch (e) { console.warn('[store] update : la fonction a levé une erreur', e); }
    state.profile = normProfile(state.profile);
    changed(null, 'update');
    return r;
  }

  /* ---------- cartes ---------- */

  function card(id) {
    const key = String(id || '');
    if (!key) return blankCard();
    let c = state.cards[key];
    if (!c) {
      const S = srs();
      c = S && typeof S.newState === 'function' ? S.newState() : blankCard();
      state.cards[key] = c;        // non persistée tant qu'elle n'est pas révisée (voir serializable)
    }
    return c;
  }
  function setCard(id, cardState) {
    const key = String(id || '');
    if (!key) return null;
    state.cards[key] = normCard(cardState);
    changed('cards.' + key, 'setCard', { cardId: key });
    return state.cards[key];
  }

  /* Temps de réponse récents par kind (médiane pour le grade « Facile ») — en mémoire seulement. */
  const recentMs = {};
  function pushRecentMs(kind, ms) {
    const arr = recentMs[kind] || (recentMs[kind] = []);
    arr.push(ms);
    if (arr.length > RECENT_MS_MAX) arr.shift();
  }
  function medianMs(kind) {
    const arr = (recentMs[kind] || []).slice().sort(function (a, b) { return a - b; });
    if (arr.length < RECENT_MS_MIN) return 0;
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
  }
  /* Nombre de réussites consécutives (score ≥ 0,99, ou grade ≥ Bien) en fin d'historique. */
  function cardStreak(c) {
    let n = 0;
    const h = (c && c.hist) || [];
    for (let i = h.length - 1; i >= 0; i--) {
      const ok = h[i][2] == null ? h[i][1] >= 3 : h[i][2] >= 0.99;
      if (!ok) break;
      n++;
    }
    return n;
  }

  function xpFor(kind, score, details) {
    const base = XP_BASE[kind] != null ? XP_BASE[kind] : 8;
    let xp = XP_SCALED[kind] ? Math.round(base * score) : (score >= 0.5 ? base : Math.round(base / 2));
    const d = isObj(details) ? details : {};
    if (kind === 'qcm' && score >= 0.99 && (num(d.difficulty, 0) >= 3 || d.difficult === true)) xp += XP_HARD_BONUS;
    return Math.max(0, xp);
  }
  function totalReviews() {
    let t = 0;
    Object.keys(state.daily).forEach(function (k) { t += int(state.daily[k].reviews); });
    return t;
  }

  /* recordAttempt({cardId, item, kind, score, grade, ms, details, medianMs}) → {xpGained, newBadges, cardState, grade, score} */
  function recordAttempt(args) {
    const a = isObj(args) ? args : {};
    const cardId = String(a.cardId || '');
    if (!cardId) {
      console.warn('[store] recordAttempt sans cardId');
      return { xpGained: 0, newBadges: [], cardState: null, grade: null, score: 0 };
    }
    const S = srs();
    const now = nowMs();
    const meta = cardMeta(cardId);
    const kind = a.kind || meta.kind || 'qcm';
    const itemNum = String(a.item || meta.item || '');
    const prev = card(cardId);
    const isFirst = !(prev.reps > 0);

    let grade = int(a.grade);
    let score = num(a.score, NaN);
    if (!Number.isFinite(score)) score = grade >= 3 ? 1 : grade === 2 ? 0.5 : 0;
    score = clamp(score, 0, 1);
    if (!(grade >= 1 && grade <= 4)) {
      const med = num(a.medianMs, 0) || medianMs(kind);
      grade = S && typeof S.gradeFromScore === 'function'
        ? S.gradeFromScore(score, { ms: a.ms, medianMs: med, streak: cardStreak(prev) })
        : (score >= 0.99 ? 3 : score >= 0.5 ? 2 : 1);
    }
    const ms = Math.max(0, int(a.ms));
    if (ms > 0) pushRecentMs(kind, ms);

    // planification FSRS
    let next;
    if (S) {
      next = S.review(prev, grade, now, { retention: state.profile.retention, seed: cardId, score: score, ms: ms });
    } else {
      next = Object.assign(blankCard(), prev, {
        reps: prev.reps + 1, last: now, state: grade === 1 ? 'relearning' : 'review',
        lapses: prev.lapses + (grade === 1 && prev.state === 'review' ? 1 : 0),
        due: grade === 1 ? now + 10 * 60000 : now + DAY_MS * Math.max(1, Math.min(365, Math.round(Math.pow(2, prev.reps)))),
        hist: prev.hist.concat([[now, grade, score, ms]]).slice(-HIST_MAX)
      });
    }
    state.cards[cardId] = next;

    // journalier + XP
    const key = dateKey(now);
    const d = state.daily[key] || (state.daily[key] = emptyDaily());
    d.reviews += 1;
    if (isFirst) d.newCards += 1;
    if (score >= 0.99) d.correct += 1;
    d.score = Math.round((d.score + score) * 100) / 100;
    d.ms += ms;
    const xpGained = xpFor(kind, score, a.details);
    d.xp += xpGained;
    state.xp += xpGained;

    // cahier d'erreurs : ajout sur « Encore », retrait après deux Bien/Facile d'affilée
    const hadErrors = Object.keys(state.errors).length > 0;
    if (grade === 1) {
      const e = state.errors[cardId] || { ts: 0, count: 0, note: '' };
      e.ts = now;
      e.count += 1;
      state.errors[cardId] = e;
    } else if (grade >= 3 && state.errors[cardId]) {
      const h = next.hist, n = h.length;
      if (n >= 2 && h[n - 1][1] >= 3 && h[n - 2][1] >= 3) delete state.errors[cardId];
    }

    // série et visite d'item
    state.streak = computeStreak(state.daily, state.profile.dailyGoal, key, state.streak);
    if (itemNum) {
      const is = state.itemStats[itemNum] || (state.itemStats[itemNum] = { lastVisited: 0, sessions: 0 });
      is.lastVisited = now;
    }

    const newBadges = checkBadges({ item: itemNum, now: now, hadErrors: hadErrors });

    touch();
    markDirty('profile');
    markDirty(cardDocKey(cardId));
    save();
    emit('store:change', { path: 'cards.' + cardId, reason: 'attempt', cardId: cardId, item: itemNum, kind: kind, xpGained: xpGained });
    return { xpGained: xpGained, newBadges: newBadges, cardState: next, grade: grade, score: score };
  }

  /* ---------- badges (SPEC §6) ---------- */

  function award(id, list, now) {
    if (state.badges.indexOf(id) >= 0) return false;
    state.badges.push(id);
    list.push(id);
    emit('store:badge', { badge: id, at: now });
    return true;
  }
  function itemMastered(m) { return m.ranks.A.total > 0 && m.A >= 0.9 && m.coverage.A >= 0.8; }
  function checkBadges(ctx) {
    const list = [];
    const now = ctx.now || nowMs();
    [3, 7, 30, 100].forEach(function (n) { if (state.streak.current >= n) award('streak-' + n, list, now); });
    const total = totalReviews();
    [100, 500, 2000].forEach(function (n) { if (total >= n) award('cards-' + n, list, now); });
    if (total >= 10) award('first-session', list, now);   // repli si les vues n'utilisent pas endSession
    if (ctx.item) {
      const m = mastery(ctx.item);
      if (itemMastered(m)) {
        award('item-mastered-' + ctx.item, list, now);
        const all = manifestItemNums().every(function (n) { return n === String(ctx.item) || itemMastered(mastery(n)); });
        if (all) award('all-A-90', list, now);
      }
    }
    if (ctx.hadErrors && Object.keys(state.errors).length === 0) award('errors-cleared', list, now);
    if (ctx.mode === 'exam' && num(ctx.score, 0) >= 0.8) award('exam-80', list, now);
    if (ctx.sessionEnded) award('first-session', list, now);
    const h = new Date(now).getHours();
    if (h < 5) award('night-owl', list, now);
    else if (h < 7) award('early-bird', list, now);
    return list;
  }

  /* ---------- maîtrise ---------- */

  /* mastery(num) → {A, B, all, seen, total, dueNow, coverage:{A,B,all}, ranks:{A:{seen,total}, B:{…}}, loaded}
   * Maîtrise = moyenne de la rétrievabilité des cartes vues × (vues / total) = Σ R / total. */
  function mastery(itemNum) {
    const key = String(itemNum || '');
    const S = srs();
    const now = nowMs();
    const acc = { A: { seen: 0, total: 0, r: 0 }, B: { seen: 0, total: 0, r: 0 }, all: { seen: 0, total: 0, r: 0 } };
    let dueNow = 0;
    let list = registryCards(key);
    let loaded = !!(list && list.length);
    if (!loaded) {
      // Repli : cartes vues dans l'état (rank inconnu) ; total tiré du manifest s'il est connu.
      list = Object.keys(state.cards).filter(function (id) { return itemOfId(id) === key && touched(state.cards[id]); })
        .map(function (id) { return { id: id, item: key, kind: kindOfId(id), rank: null }; });
    }
    list.forEach(function (c) {
      const cs = state.cards[c.id];
      const seen = !!cs && cs.reps > 0;
      let r = 0;
      if (seen) {
        r = S ? S.retrievability(cs, now) : 0;
        if (S ? S.isDue(cs, now) : (cs.due !== null && cs.due <= now)) dueNow++;
      }
      const buckets = [acc.all];
      if (c.rank === 'A' || c.rank === 'B') buckets.push(acc[c.rank]);
      buckets.forEach(function (b) { b.total++; if (seen) { b.seen++; b.r += r; } });
    });
    if (!loaded) {
      const t = manifestCardTotal(key);
      if (t > acc.all.total) acc.all.total = t;
    }
    function score(b) { return b.total ? b.r / b.total : 0; }
    function cov(b) { return b.total ? b.seen / b.total : 0; }
    return {
      A: score(acc.A), B: score(acc.B), all: score(acc.all),
      seen: acc.all.seen, total: acc.all.total, dueNow: dueNow,
      coverage: { A: cov(acc.A), B: cov(acc.B), all: cov(acc.all) },
      ranks: { A: { seen: acc.A.seen, total: acc.A.total }, B: { seen: acc.B.seen, total: acc.B.total } },
      loaded: loaded
    };
  }

  /* ---------- files de cartes ---------- */

  function normKinds(k) {
    if (!k) return null;
    const arr = Array.isArray(k) ? k : String(k).split(',');
    const out = uniqStrings(arr.map(function (x) { return String(x).trim(); }));
    return out.length ? out : null;
  }
  function normFilter(f) {
    const o = isObj(f) ? f : {};
    return {
      item: o.item === undefined || o.item === null || o.item === '' ? null : String(o.item),
      items: Array.isArray(o.items) && o.items.length ? o.items.map(String) : null,
      kinds: normKinds(o.kinds || o.kind),
      rank: o.rank === 'A' || o.rank === 'B' ? o.rank : null
    };
  }
  function matchesFilter(meta, f) {
    if (f.item && String(meta.item) !== f.item) return false;
    if (f.items && f.items.indexOf(String(meta.item)) < 0) return false;
    if (f.kinds && f.kinds.indexOf(meta.kind) < 0) return false;
    if (f.rank && meta.rank !== f.rank) return false;
    return true;
  }

  /* Cartes dues, triées par (rétrievabilité croissante, lapses décroissants). Pool = cartes déjà vues
   * (state.cards), donc disponible sans charger le contenu. */
  function dueCards(at, filter) {
    const now = Number.isFinite(at) ? at : nowMs();
    const S = srs();
    const f = normFilter(filter);
    const out = [];
    Object.keys(state.cards).forEach(function (id) {
      const cs = state.cards[id];
      if (cs.due === null || cs.due === undefined || cs.due > now) return;
      if (!matchesFilter(cardMeta(id), f)) return;
      out.push({ id: id, r: S ? S.retrievability(cs, now) : 0, lapses: cs.lapses || 0 });
    });
    out.sort(function (a, b) { return a.r - b.r || b.lapses - a.lapses || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
    return out.map(function (x) { return x.id; });
  }

  function roundRobin(groups) {
    const out = [];
    const lists = groups.filter(function (g) { return g && g.length; }).map(function (g) { return g.slice(); });
    while (lists.length) {
      for (let i = 0; i < lists.length; i++) {
        out.push(lists[i].shift());
        if (!lists[i].length) { lists.splice(i, 1); i--; }
      }
    }
    return out;
  }
  function byKindRoundRobin(cards) {
    const groups = {}, order = [];
    cards.forEach(function (c) {
      const k = c.kind || 'qcm';
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(c.id);
    });
    return roundRobin(order.map(function (k) { return groups[k]; }));
  }

  /* Cartes jamais vues : rang A d'abord, puis items de plus faible maîtrise, en tourniquet entre items
   * (et entre kinds au sein d'un item). Nécessite le registre (contenu chargé). */
  function newCards(filter, limit) {
    const f = normFilter(filter);
    const lim = limit === undefined || limit === null ? Infinity : Math.max(0, num(limit, 0));
    if (lim === 0) return [];
    const pool = registryCards(f.item) || [];
    const perItem = {};
    pool.forEach(function (c) {
      if (!matchesFilter(c, f)) return;
      const cs = state.cards[c.id];
      if (cs && cs.reps > 0) return;
      (perItem[c.item] = perItem[c.item] || []).push(c);
    });
    const mcache = {};
    function m(it) { if (mcache[it] === undefined) mcache[it] = mastery(it).all; return mcache[it]; }
    const items = Object.keys(perItem).sort(function (a, b) { return m(a) - m(b) || (a < b ? -1 : 1); });
    const out = [];
    ['A', 'B', null].forEach(function (rank) {
      if (out.length >= lim) return;
      const groups = items.map(function (it) {
        return byKindRoundRobin(perItem[it].filter(function (c) { return (c.rank === 'A' || c.rank === 'B' ? c.rank : null) === rank; }));
      });
      roundRobin(groups).forEach(function (id) { if (out.length < lim) out.push(id); });
    });
    return out;
  }

  function costOf(ids) { return ids.reduce(function (t, id) { return t + cardCost(id); }, 0); }
  function capByCost(ids, size) {
    if (!Number.isFinite(size)) return ids.slice();
    const out = [];
    let used = 0;
    for (let i = 0; i < ids.length && used < size; i++) {
      const c = cardCost(ids[i]);
      if (used + c <= size) { out.push(ids[i]); used += c; }
    }
    return out;
  }
  /* Pas plus de `maxRun` cartes consécutives du même kind (on avance la première carte d'un autre kind). */
  function interleave(ids, maxRun) {
    const rest = ids.slice(), out = [];
    let runKind = null, run = 0;
    while (rest.length) {
      let idx = 0;
      if (run >= maxRun) {
        idx = rest.findIndex(function (id) { return cardMeta(id).kind !== runKind; });
        if (idx < 0) idx = 0;
      }
      const id = rest.splice(idx, 1)[0];
      const k = cardMeta(id).kind;
      if (k === runKind) run++; else { runKind = k; run = 1; }
      out.push(id);
    }
    return out;
  }
  function sessionSize(size) {
    if (size === undefined || size === null) return Math.max(1, int(state.profile.dailyGoal) || 30);
    const n = Number(size);
    if (!Number.isFinite(n) || n <= 0) return Infinity;
    return Math.max(1, Math.round(n));
  }
  function rng(seed) {
    const u = util();
    if (seed !== undefined && u && typeof u.seededRandom === 'function') {
      try { const r = u.seededRandom(seed); if (typeof r === 'function') return r; } catch (e) { /* repli */ }
    }
    return Math.random;
  }
  /* Tirage pondéré sans remise (rang A × 3, rang B × 1). */
  function weightedSample(cards, n, rand) {
    const pool = cards.slice();
    const out = [];
    while (pool.length && out.length < n) {
      let total = 0;
      pool.forEach(function (c) { total += c.rank === 'B' ? 1 : 3; });
      let x = rand() * total, idx = 0;
      for (; idx < pool.length; idx++) { x -= pool[idx].rank === 'B' ? 1 : 3; if (x <= 0) break; }
      if (idx >= pool.length) idx = pool.length - 1;
      out.push(pool.splice(idx, 1)[0].id);
    }
    return out;
  }
  function buildExam(o, f) {
    const pool = (registryCards(f.item) || []).filter(function (c) { return matchesFilter(c, { item: null, items: f.items, kinds: null, rank: null }); });
    const rand = rng(o.seed);
    let ids = [];
    Object.keys(EXAM_SHAPE).forEach(function (kind) {
      ids = ids.concat(weightedSample(pool.filter(function (c) { return c.kind === kind; }), EXAM_SHAPE[kind], rand));
    });
    return ids;
  }

  /* buildSession({mode, item, size, kinds, rank, nowMs, seed}) → [cardId] (SPEC §5).
   * smart : dues (R croissante) puis nouvelles (≤ newPerDay − nouvelles du jour), entrelacées, plafonnées.
   * item / rank / kind : idem sans plafond quotidien de nouvelles, puis complément par les cartes vues
   * les moins retenues. errors : cahier d'erreurs par count décroissant. exam : 18 QCM + 2 KFP + 1 TCS + 1 cas. */
  function buildSession(opts) {
    const o = isObj(opts) ? opts : {};
    const mode = ['smart', 'item', 'errors', 'rank', 'kind', 'exam'].indexOf(o.mode) >= 0 ? o.mode : 'smart';
    const now = Number.isFinite(o.nowMs) ? o.nowMs : nowMs();
    const size = sessionSize(o.size);
    const f = normFilter(o);
    if (mode === 'rank' && !f.rank) f.rank = 'A';

    if (mode === 'errors') {
      const ids = errorsList().map(function (e) { return e.cardId; }).filter(function (id) { return matchesFilter(cardMeta(id), f); });
      return capByCost(ids, size);
    }
    if (mode === 'exam') return buildExam(o, f);

    let list = capByCost(dueCards(now, f), size);
    let remaining = size - costOf(list);
    if (remaining > 0) {
      const newToday = int((state.daily[dateKey(now)] || {}).newCards);
      const allowed = mode === 'smart' ? Math.max(0, int(state.profile.newPerDay) - newToday) : Infinity;
      const want = Math.min(allowed, remaining);
      if (want > 0) {
        const chosen = capByCost(newCards(f, want), remaining);
        list = list.concat(chosen);
        remaining -= costOf(chosen);
      }
    }
    if (mode !== 'smart' && remaining > 0) {
      const S = srs();
      const inList = {};
      list.forEach(function (id) { inList[id] = true; });
      const extra = [];
      Object.keys(state.cards).forEach(function (id) {
        const cs = state.cards[id];
        if (inList[id] || !(cs.reps > 0) || !matchesFilter(cardMeta(id), f)) return;
        extra.push({ id: id, r: S ? S.retrievability(cs, now) : 1 });
      });
      extra.sort(function (a, b) { return a.r - b.r; });
      list = list.concat(capByCost(extra.map(function (x) { return x.id; }), remaining));
    }
    return interleave(list, MAX_RUN);
  }

  /* prepareSession(opts) → Promise<[cardId]> : charge le contenu nécessaire puis construit la session. */
  function prepareSession(opts) {
    const o = isObj(opts) ? opts : {};
    const reg = registry();
    let p = Promise.resolve();
    if (reg) {
      try {
        if (o.mode === 'item' && o.item && typeof reg.load === 'function') p = reg.load(String(o.item));
        else if (o.mode === 'errors' && typeof reg.load === 'function') {
          const nums = uniqStrings(Object.keys(state.errors).map(itemOfId));
          p = Promise.all(nums.map(function (n) { return reg.load(n).catch(function () { return null; }); }));
        } else if (typeof reg.loadAll === 'function') p = reg.loadAll();
      } catch (e) { p = Promise.resolve(); }
    }
    return Promise.resolve(p).catch(function (e) {
      console.warn('[store] chargement du contenu incomplet', e);
    }).then(function () { return buildSession(o); });
  }

  /* ---------- sessions ---------- */

  function startSession(opts) {
    const o = isObj(opts) ? opts : {};
    const now = nowMs();
    const cards = Array.isArray(o.cards) ? uniqStrings(o.cards) : [];
    const s = {
      id: makeId('s'), mode: typeof o.mode === 'string' ? o.mode : 'smart',
      item: o.item === undefined || o.item === null ? null : String(o.item),
      startedAt: now, endedAt: null,
      size: Math.max(0, int(o.size) || cards.length), done: 0, score: null, xp: 0, cards: cards
    };
    state.sessions.unshift(s);
    state.sessions = trimSessions(state.sessions);
    if (s.item) {
      const is = state.itemStats[s.item] || (state.itemStats[s.item] = { lastVisited: 0, sessions: 0 });
      is.sessions += 1;
      is.lastVisited = now;
    }
    changed('sessions', 'session-start', { sessionId: s.id });
    return state.sessions.find(function (x) { return x.id === s.id; }) || s;
  }
  function session(id) {
    return state.sessions.find(function (s) { return s.id === String(id); }) || null;
  }
  function endSession(id, summary) {
    const s = session(id);
    if (!s) { console.warn('[store] endSession : session inconnue', id); return null; }
    const sm = isObj(summary) ? summary : {};
    const now = nowMs();
    s.endedAt = now;
    if (sm.done !== undefined) s.done = Math.max(0, int(sm.done));
    if (sm.score !== undefined && sm.score !== null) s.score = clamp(num(sm.score, 0), 0, 1);
    if (sm.xp !== undefined) s.xp = Math.max(0, int(sm.xp));
    if (sm.ms !== undefined) s.ms = Math.max(0, int(sm.ms));
    const newBadges = s.done > 0 ? checkBadges({ now: now, sessionEnded: true, mode: s.mode, score: s.score }) : [];
    changed('sessions', 'session-end', { sessionId: s.id, newBadges: newBadges });
    return s;
  }

  /* ---------- lectures dérivées ---------- */

  function todayStats() {
    const k = today();
    const d = Object.assign(emptyDaily(), state.daily[k] || {});
    const goal = Math.max(1, int(state.profile.dailyGoal) || 30);
    return Object.assign(d, {
      date: k, goal: goal,
      ratio: Math.min(1, d.reviews / goal),
      reached: d.reviews >= goal,
      remaining: Math.max(0, goal - d.reviews),
      due: dueCards(nowMs()).length,
      accuracy: d.reviews ? d.correct / d.reviews : null,
      avgScore: d.reviews ? d.score / d.reviews : null
    });
  }
  function streak() {
    const k = today();
    const d = state.daily[k];
    return Object.assign({}, state.streak, { reachedToday: !!d && int(d.reviews) >= Math.max(1, int(state.profile.dailyGoal) || 1) });
  }
  function xp() { return Math.max(0, int(state.xp)); }
  function level() {
    const x = xp();
    const n = Math.floor(Math.sqrt(x / 100)) + 1;
    const floor = 100 * (n - 1) * (n - 1);
    const next = 100 * n * n;
    return {
      n: n,
      name: LEVEL_NAMES[Math.min(LEVEL_NAMES.length - 1, Math.floor((n - 1) / LEVELS_PER_NAME))],
      xp: x, floor: floor, next: next,
      progress: clamp((x - floor) / (next - floor), 0, 1)
    };
  }
  function forecast(days) {
    const n = Math.max(1, int(days) || 7);
    const now = nowMs();
    const t = dateKey(now);
    const counts = [];
    for (let i = 0; i < n; i++) counts.push(0);
    Object.keys(state.cards).forEach(function (id) {
      const c = state.cards[id];
      if (c.due === null || c.due === undefined) return;
      let i = c.due <= now ? 0 : daysBetween(t, dateKey(c.due));
      if (i < 0) i = 0;
      if (i < n) counts[i]++;
    });
    return counts.map(function (due, i) { return { date: addDays(t, i), due: due }; });
  }
  function errorsList() {
    return Object.keys(state.errors).map(function (id) {
      const e = state.errors[id], meta = cardMeta(id);
      return { cardId: id, count: e.count, ts: e.ts, note: e.note || '', item: meta.item, kind: meta.kind };
    }).sort(function (a, b) { return b.count - a.count || b.ts - a.ts || (a.cardId < b.cardId ? -1 : 1); });
  }

  /* Notes, favoris, visites : petites commodités pour les vues. */
  function setNote(key, text) {
    const k = String(key || '');
    if (!k) return;
    if (typeof text === 'string' && text.trim()) state.notes[k] = text; else delete state.notes[k];
    changed('notes.' + k, 'note');
  }
  function toggleBookmark(id) {
    const k = String(id || '');
    if (!k) return false;
    const i = state.bookmarks.indexOf(k);
    if (i >= 0) state.bookmarks.splice(i, 1); else state.bookmarks.push(k);
    changed('bookmarks', 'bookmark', { cardId: k });
    return i < 0;
  }
  function visitItem(num) {
    const k = String(num || '');
    if (!k) return;
    const is = state.itemStats[k] || (state.itemStats[k] = { lastVisited: 0, sessions: 0 });
    is.lastVisited = nowMs();
    changed('itemStats.' + k, 'visit');
  }

  /* ---------- export / import / reset ---------- */

  function exportJSON() {
    return JSON.stringify({
      app: 'CardioR2C', v: VERSION, exportedAt: new Date(nowMs()).toISOString(), state: serializable(state)
    }, null, 2);
  }
  function pickState(parsed) {
    if (!isObj(parsed)) return null;
    if (parsed.app === 'CardioR2C' && isObj(parsed.state)) return parsed.state;
    if (isObj(parsed.cards) && isObj(parsed.profile)) return parsed;      // état brut
    return null;
  }
  /* importJSON(str, {merge:true}) → {merged, cards}. Lève une Error (message français) si invalide. */
  function importJSON(str, opts) {
    const o = isObj(opts) ? opts : {};
    const merge = o.merge !== false;
    let parsed;
    try { parsed = typeof str === 'string' ? JSON.parse(str) : str; }
    catch (e) { throw new Error('JSON illisible : vérifie que le fichier est complet.'); }
    const raw = pickState(parsed);
    if (!raw) throw new Error('Ce fichier n’est pas un export CardioR2C.');
    const incoming = normalize(migrate(clone(raw)), nowMs());
    replaceState(merge ? mergeStates(state, incoming) : incoming);
    state.streak = computeStreak(state.daily, state.profile.dailyGoal, today(), state.streak);
    touch();
    markDirty(null);
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    writeLocal();
    scheduleCloudPush();
    emit('store:change', { path: null, reason: 'import', merged: merge });
    return { merged: merge, cards: Object.keys(state.cards).length };
  }
  /* resetAll() : efface tout (local + documents cloud vidés). L'appelant a déjà demandé confirmation. */
  function resetAll() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    replaceState(defaultState(nowMs()));
    Object.keys(recentMs).forEach(function (k) { delete recentMs[k]; });
    try { if (window.localStorage) window.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    emit('store:change', { path: null, reason: 'reset' });
    markDirty(null);
    return pushCloud();
  }

  /* ---------- cloud ---------- */

  const cloud = {
    status: 'off', lastSync: null, uid: null, db: null, ready: false,
    dirty: new Set(), enqueued: new Set(), snap: {}, queue: Promise.resolve(), timer: null, lastError: null
  };

  function docPath(key) { return (cloud.uid ? 'data/users/' + cloud.uid + '/' : 'progress/') + key; }
  function collectionPath() { return cloud.uid ? 'data/users/' + cloud.uid : 'progress'; }

  function markDirty(path) {
    if (path === undefined || path === null) { cloud.dirty.add('*'); return; }
    const p = String(path);
    if (p === 'cards') { cloud.dirty.add('*cards'); return; }
    if (p.indexOf('cards.') === 0) { cloud.dirty.add(cardDocKey(p.slice(6).split('.')[0])); return; }
    if (p.indexOf('cards-') === 0) { cloud.dirty.add(p); return; }
    cloud.dirty.add('profile');
  }
  function buildProfileDoc() {
    const s = serializable(state);
    delete s.cards;
    return sortKeys(s);
  }
  function buildCardsDoc(key) {
    const cards = {};
    let updatedAt = 0;
    Object.keys(state.cards).forEach(function (id) {
      const c = state.cards[id];
      if (cardDocKey(id) !== key || !touched(c)) return;
      cards[id] = c;
      if (c.last > updatedAt) updatedAt = c.last;
    });
    return sortKeys({ cards: cards, updatedAt: updatedAt });
  }
  function buildDoc(key) { return key === 'profile' ? buildProfileDoc() : buildCardsDoc(key); }
  function localCardDocKeys() {
    const keys = {};
    Object.keys(state.cards).forEach(function (id) { if (touched(state.cards[id])) keys[cardDocKey(id)] = true; });
    return Object.keys(keys);
  }
  function expandDirty() {
    const keys = {};
    const all = cloud.dirty.has('*');
    cloud.dirty.forEach(function (k) { if (k !== '*' && k !== '*cards') keys[k] = true; });
    if (all || cloud.dirty.has('*cards')) {
      localCardDocKeys().forEach(function (k) { keys[k] = true; });
      Object.keys(cloud.snap).forEach(function (k) { if (k.indexOf('cards-') === 0) keys[k] = true; });
    }
    if (all) keys.profile = true;
    const localKeys = localCardDocKeys();
    // un document de cartes n'est écrit que s'il a du contenu local ou s'il existe déjà côté cloud
    return Object.keys(keys).filter(function (k) { return k === 'profile' || localKeys.indexOf(k) >= 0 || Object.prototype.hasOwnProperty.call(cloud.snap, k); });
  }
  function emitSync() { emit('store:sync', syncStatus()); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function attemptSet(key, data) {
    return Promise.resolve().then(function () { return cloud.db.doc(docPath(key)).set(data); })
      .then(function () { return { ok: true }; }, function (e) {
        const code = e && e.code ? String(e.code) : 'unknown';
        console.warn('[store] écriture cloud « ' + key + ' » : ' + code, e && e.message ? e.message : '');
        return { ok: false, code: code };
      });
  }
  function writeDoc(key) {
    cloud.enqueued.delete(key);
    const data = buildDoc(key);
    const json = JSON.stringify(data);
    if (cloud.snap[key] === json) return Promise.resolve(true);
    cloud.status = 'syncing';
    emitSync();
    return attemptSet(key, data).then(function (r) {
      if (r.ok) return r;
      if (r.code === 'invalid_argument' || r.code === 'revoked' || r.code === 'not_granted' || r.code === 'capability_disabled') return r;
      return sleep(400 + Math.random() * 1200).then(function () { return attemptSet(key, data); });
    }).then(function (r) {
      if (r.ok) {
        cloud.snap[key] = json;
        cloud.lastSync = nowMs();
        cloud.lastError = null;
        cloud.status = cloud.enqueued.size ? 'syncing' : 'ok';
      } else {
        cloud.status = 'error';
        cloud.lastError = r.code;
        cloud.dirty.add(key);                              // réessayé au prochain changement / flush
        if (r.code === 'revoked' || r.code === 'not_granted') cloud.ready = false;
      }
      emitSync();
      return r.ok;
    });
  }
  function scheduleCloudPush() {
    if (!cloud.ready) return;
    if (cloud.timer) clearTimeout(cloud.timer);
    cloud.timer = setTimeout(function () { cloud.timer = null; pushCloud(); }, CLOUD_COALESCE_MS);
  }
  /* Pousse les documents modifiés (file séquentielle, un seul en vol). Résout quand la file est vide. */
  function pushCloud() {
    if (!cloud.ready || !cloud.db) return Promise.resolve(false);
    if (cloud.timer) { clearTimeout(cloud.timer); cloud.timer = null; }
    const keys = expandDirty();
    cloud.dirty.clear();
    keys.forEach(function (key) {
      if (cloud.enqueued.has(key)) return;     // déjà en file : le contenu le plus récent sera lu à l'exécution
      cloud.enqueued.add(key);
      cloud.queue = cloud.queue.then(function () { return writeDoc(key); }).catch(function (e) {
        console.warn('[store] file cloud', e);
        cloud.enqueued.delete(key);
      });
    });
    return cloud.queue.then(function () { return cloud.status !== 'error'; });
  }

  /* Reconstruit un état partiel à partir des documents cloud lus. */
  function stateFromDocs(docs) {
    const keys = Object.keys(docs);
    if (!keys.length) return null;
    const raw = isObj(docs.profile) ? clone(docs.profile) : {};
    raw.cards = {};
    keys.forEach(function (k) {
      if (k.indexOf('cards-') !== 0 || !isObj(docs[k]) || !isObj(docs[k].cards)) return;
      Object.keys(docs[k].cards).forEach(function (id) { raw.cards[id] = docs[k].cards[id]; });
    });
    return raw;
  }
  function readCloudDocs() {
    const out = {};
    return Promise.resolve().then(function () {
      return cloud.db.collection(collectionPath()).get();
    }).then(function (snap) {
      (snap && Array.isArray(snap.docs) ? snap.docs : []).forEach(function (d) {
        if (d && d.exists && (d.id === 'profile' || String(d.id).indexOf('cards-') === 0)) {
          const data = typeof d.data === 'function' ? d.data() : null;
          if (isObj(data)) out[d.id] = data;
        }
      });
      return out;
    }, function (e) {
      console.warn('[store] lecture cloud par collection impossible, lecture document par document', e && e.code ? e.code : e);
      const keys = ['profile'].concat(uniqStrings(manifestItemNums().concat(localCardDocKeys().map(function (k) { return k.slice(6); }))).map(function (n) { return 'cards-' + n; }));
      let chain = Promise.resolve();
      for (let i = 0; i < keys.length; i += 6) {
        const batch = keys.slice(i, i + 6);
        chain = chain.then(function () {
          return Promise.all(batch.map(function (key) {
            return cloud.db.doc(docPath(key)).get().then(function (s) {
              if (s && s.exists) { const data = s.data(); if (isObj(data)) out[key] = data; }
            }, function (err) { console.warn('[store] lecture cloud « ' + key + ' »', err && err.code ? err.code : err); });
          }));
        });
      }
      return chain.then(function () { return out; });
    });
  }
  function applyCloudMerge(docs) {
    const activityBefore = hasActivity(state);
    const incoming = stateFromDocs(docs);
    Object.keys(docs).forEach(function (k) { cloud.snap[k] = JSON.stringify(sortKeys(docs[k])); });
    if (incoming) {
      replaceState(mergeStates(state, incoming));
      writeLocal();
      emit('store:change', { path: null, reason: 'cloud-merge' });
    }
    return activityBefore;
  }
  function cloudInit() {
    if (!(window.claude && typeof window.claude.use === 'function')) { cloud.status = 'off'; return Promise.resolve(false); }
    let db = null;
    return Promise.resolve().then(function () { return window.claude.use('db'); }).then(function (d) {
      db = d;
      if (!db || typeof db.doc !== 'function' || typeof db.collection !== 'function') { cloud.status = 'off'; return false; }
      return Promise.resolve().then(function () { return window.claude.use('user'); }).catch(function () { return null; })
        .then(function (user) {
          if (!user || typeof user.id !== 'function') return null;
          return Promise.resolve().then(function () { return user.id(); }).catch(function () { return null; });
        }).then(function (uid) {
          cloud.db = db;
          cloud.uid = typeof uid === 'string' && uid ? uid : null;
          cloud.status = 'syncing';
          emitSync();
          return readCloudDocs();
        }).then(function (docs) {
          const activityBefore = applyCloudMerge(docs);
          cloud.ready = true;
          cloud.status = 'ok';
          cloud.lastSync = nowMs();
          if (activityBefore) markDirty(null);            // pousse ce qui n'existait qu'en local
          if (cloud.dirty.size) scheduleCloudPush();
          emitSync();
          return true;
        });
    }).catch(function (e) {
      console.warn('[store] synchronisation cloud indisponible', e && e.code ? e.code : e);
      cloud.status = db ? 'error' : 'off';
      emitSync();
      return false;
    });
  }
  function syncStatus() {
    return {
      cloud: cloud.status, lastSync: cloud.lastSync, uid: !!cloud.uid,
      pending: cloud.enqueued.size + cloud.dirty.size, error: cloud.lastError, local: local.ok
    };
  }

  /* ---------- démarrage ---------- */

  loadLocal();

  const store = {
    VERSION: VERSION,
    STORAGE_KEY: STORAGE_KEY,
    LEVEL_NAMES: LEVEL_NAMES.slice(),
    XP_BASE: XP_BASE,
    state: state,
    ready: null,
    get: get, set: set, update: update,
    card: card, setCard: setCard,
    recordAttempt: recordAttempt,
    todayStats: todayStats, streak: streak, xp: xp, level: level, forecast: forecast, errorsList: errorsList,
    mastery: mastery,
    dueCards: dueCards, newCards: newCards, buildSession: buildSession, prepareSession: prepareSession,
    startSession: startSession, endSession: endSession, session: session,
    setNote: setNote, toggleBookmark: toggleBookmark, visitItem: visitItem,
    exportJSON: exportJSON, importJSON: importJSON, resetAll: resetAll,
    save: save, flush: flush, syncStatus: syncStatus,
    mergeStates: mergeStates, computeStreak: computeStreak,
    itemOfId: itemOfId, kindOfId: kindOfId, cardMeta: cardMeta, dateKey: dateKey, today: today
  };

  store.ready = new Promise(function (resolve) {
    let settled = false;
    function done() { if (!settled) { settled = true; resolve(store); } }
    const timer = setTimeout(done, CLOUD_READY_TIMEOUT_MS);
    // Lancement différé : laisse la page finir de charger ses scripts avant de toucher au runtime.
    setTimeout(function () {
      cloudInit().then(function () { clearTimeout(timer); done(); }, function (e) {
        console.warn('[store] cloud init', e);
        clearTimeout(timer);
        done();
      });
    }, 0);
  });

  try {
    window.addEventListener('pagehide', function () { try { flush(); } catch (e) { /* ignore */ } });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { try { flush(); } catch (e) { /* ignore */ } }
    });
  } catch (e) { /* environnement sans DOM */ }

  CARDIO.store = store;
})();
