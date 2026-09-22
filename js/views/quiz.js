/* CardioR2C — quiz.js
 * CARDIO.views.quiz : moteur de séance (SPEC §2.6, §5, §6, §7 ; DESIGN §2, §3, §4, §6).
 *   render(params, query) pour les routes :
 *     #/review              écran de réglage (mode, item, types, taille) puis lancement
 *     #/session/:id         séance en cours (toutes les cartes) puis écran de résultats
 *     #/errors              cahier d'erreurs
 *     #/item/:num/qcm       réglage pré-filtré sur l'item
 * Paramètres de requête : mode, item, kind (liste), rank, size (10|20|40|inf), objective (liste
 * d'ids), autostart=1.
 * Script classique ES2020. Toutes les dépendances (util, store, registry, srs, shell, autres vues,
 * CARDIO.ecg) sont résolues à l'exécution et de façon défensive.
 */
(function () {
  'use strict';

  const C = (window.CARDIO = window.CARDIO || {});
  C.views = C.views || {};

  /* ------------------------------------------------------------------ */
  /* Constantes                                                           */
  /* ------------------------------------------------------------------ */

  const LS_PREFIX = 'cardio.session.';
  const BACKUP_TTL_MS = 2 * 86400000;
  const LETTERS = 'ABCDEFGHIJKL';
  const SIZES = [10, 20, 40, 0];                      // 0 = ∞
  const DEFAULT_SIZE = 20;
  const EXAM_SIZE = 22;
  const MEDIAN_MIN_SAMPLES = 5;

  const KINDS = [
    ['qcm', 'QCM'], ['qroc', 'QROC'], ['open', 'Ouvertes'], ['kfp', 'KFP'], ['tcs', 'TCS'],
    ['flash', 'Flash'], ['tree', 'Arbres'], ['tx', 'Traitements'], ['case', 'Cas'], ['ecg', 'ECG'], ['echo', 'Écho']
  ];
  const KIND_IDS = KINDS.map((k) => k[0]);

  const MODES = [
    { id: 'smart', title: 'Séance intelligente', desc: 'Les cartes dues, puis des nouvelles, mélangées.', icon: 'play' },
    { id: 'item', title: 'Cet item', desc: 'Tout un chapitre, du rang A au rang B.', icon: 'book' },
    { id: 'errors', title: 'Mes erreurs', desc: 'Le cahier d’erreurs, les plus fréquentes d’abord.', icon: 'refresh' },
    { id: 'rank', title: 'Rang A seulement', desc: 'Les incontournables de l’EDN.', icon: 'target' },
    { id: 'kind', title: 'Par type', desc: 'QCM, QROC, flashcards, arbres…', icon: 'filter' },
    { id: 'exam', title: 'Examen blanc', desc: '18 QCM · 2 KFP · 1 TCS · 1 dossier.', icon: 'clock' }
  ];
  const MODE_LABEL = { smart: 'Séance intelligente', item: 'Cet item', errors: 'Mes erreurs', rank: 'Rang A', kind: 'Par type', exam: 'Examen blanc', single: 'Révision ciblée' };

  const GRADE_DEFS = [
    { g: 1, key: 'a', label: 'Encore', cls: 'grade--again' },
    { g: 2, key: 'h', label: 'Difficile', cls: 'grade--hard' },
    { g: 3, key: 'g', label: 'Bien', cls: 'grade--good' },
    { g: 4, key: 'e', label: 'Facile', cls: 'grade--easy' }
  ];

  const TCS_SCALE = [
    { v: -2, label: 'Beaucoup moins probable' },
    { v: -1, label: 'Moins probable' },
    { v: 0, label: 'Ni plus ni moins' },
    { v: 1, label: 'Plus probable' },
    { v: 2, label: 'Beaucoup plus probable' }
  ];

  const BADGE_LABELS = {
    'first-session': 'Première séance', 'streak-3': '3 jours d’affilée', 'streak-7': '7 jours d’affilée',
    'streak-30': '30 jours d’affilée', 'streak-100': '100 jours d’affilée', 'cards-100': '100 cartes révisées',
    'cards-500': '500 cartes révisées', 'cards-2000': '2 000 cartes révisées', 'all-A-90': 'Rang A maîtrisé partout',
    'errors-cleared': 'Cahier d’erreurs vidé', 'night-owl': 'Oiseau de nuit', 'early-bird': 'Lève-tôt', 'exam-80': 'Examen blanc ≥ 80 %'
  };

  const TX_GROUPS = [
    ['indications', 'Indications'], ['contraindications', 'Contre-indications'], ['sideEffects', 'Effets indésirables'],
    ['monitoring', 'Surveillance'], ['interactions', 'Interactions'], ['pearls', 'À retenir']
  ];

  const runtimes = {};        // sessionId → runtime (file de cartes, index, résultats…)

  /* ------------------------------------------------------------------ */
  /* Accès paresseux aux autres modules                                   */
  /* ------------------------------------------------------------------ */

  const U = () => C.util;
  const ST = () => C.store;
  const RG = () => C.registry;
  const SH = () => C.shell;
  const SR = () => C.srs;

  function h() { return U().h.apply(null, arguments); }
  function md(text, cls) { return h('div', { class: ['md', cls || null], html: U().md(text == null ? '' : String(text)) }); }
  function icon(name, opts) { return U().iconEl(name, opts); }
  function txt(v) { return v == null ? '' : String(v); }
  function nowMs() { return Date.now(); }
  function clamp01(x) { const n = Number(x); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0; }

  const warned = {};
  function warnOnce(key, msg) {
    if (warned[key]) return;
    warned[key] = true;
    console.warn('[quiz] ' + msg);
  }

  function go(hash) {
    if (C.router && typeof C.router.go === 'function') C.router.go(hash);
    else location.hash = hash;
  }
  function toast(msg, opts) {
    const sh = SH();
    if (sh && typeof sh.toast === 'function') return sh.toast(msg, opts);
    console.log('[quiz]', msg);
    return null;
  }
  function haptic() {
    const sh = SH();
    if (sh && typeof sh.haptic === 'function') sh.haptic(10);
  }
  function reduced() {
    const sh = SH();
    if (sh && typeof sh.reducedMotion === 'function') return sh.reducedMotion();
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  function viewEl() {
    const sh = SH();
    return (sh && typeof sh.viewEl === 'function' && sh.viewEl()) || document.getElementById('view');
  }
  function storeGet(path, fallback) {
    const st = ST();
    if (!st || typeof st.get !== 'function') return fallback;
    try { const v = st.get(path); return v === undefined ? fallback : v; } catch (e) { return fallback; }
  }

  function itemMeta(num) {
    const r = RG();
    if (!r || typeof r.item !== 'function') return null;
    try { return r.item(num); } catch (e) { return null; }
  }
  function itemShort(num) {
    const m = itemMeta(num);
    return m && m.short ? m.short : 'Item ' + num;
  }
  function itemLabel(num) {
    const m = itemMeta(num);
    return m && m.short ? 'Item ' + num + ' · ' + m.short : 'Item ' + num;
  }
  function registryCard(id) {
    const r = RG();
    if (!r || typeof r.card !== 'function') return null;
    try { return r.card(id); } catch (e) { return null; }
  }
  function itemOfId(id) {
    const m = /^(\d+)-/.exec(txt(id));
    return m ? m[1] : '';
  }

  function stripMd(s) {
    return txt(s)
      .replace(/^\s*(#{1,6}\s+|>\s?|[-*]\s+|\d+[.)]\s+)/gm, '')
      .replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
      .replace(/\[([AB])\]/g, '').replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function truncate(s, n) {
    s = txt(s);
    return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s;
  }
  /** Titre court d'une carte (aperçu dans les listes). */
  function cardTitle(card) {
    if (!card) return 'Carte';
    const d = card.data || {};
    let s = '';
    switch (card.kind) {
      case 'qcm': s = d.stem; break;
      case 'qroc': s = d.question; break;
      case 'open': s = d.prompt; break;
      case 'kfp': s = d.scenario; break;
      case 'tcs': s = d.vignette; break;
      case 'flash': s = d.label || d.title || d.text; break;
      case 'tx': s = d.class; break;
      default: s = d.title || d.diagnosis;
    }
    return truncate(stripMd(s) || card.id, 110);
  }
  function kindLabel(kind) {
    const u = U();
    if (u && typeof u.kindLabel === 'function') return u.kindLabel(kind);
    const k = KINDS.find((x) => x[0] === kind);
    return k ? k[1] : txt(kind);
  }
  function kindPill(kind) { return h('span', { class: 'pill pill--kind' }, kindLabel(kind)); }
  function rankPill(rank) {
    const u = U();
    if (u && typeof u.rankPill === 'function') return u.rankPill(rank);
    return h('span', { class: 'pill pill--' + (rank === 'B' ? 'B' : 'A') }, rank === 'B' ? 'B' : 'A');
  }
  function fmtScore(x) {
    const v = Math.round(clamp01(x) * 100) / 100;
    return String(v).replace('.', ',');
  }
  function fmtClock(ms) {
    const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  function plural(n, s, p) {
    const u = U();
    if (u && typeof u.plural === 'function') return u.plural(n, s, p);
    return n + ' ' + (n > 1 ? (p || s + 's') : s);
  }
  function gradeToScore(g) { return g >= 3 ? 1 : g === 2 ? 0.5 : 0; }
  function ednScore(disc) {
    const S = SR();
    if (S && typeof S.ednScore === 'function') return S.ednScore(disc);
    return disc === 0 ? 1 : disc === 1 ? 0.5 : disc === 2 ? 0.2 : 0;
  }
  function gradeLabel(g) { const d = GRADE_DEFS.find((x) => x.g === g); return d ? d.label : ''; }
  function badgeLabel(id) {
    if (BADGE_LABELS[id]) return BADGE_LABELS[id];
    const m = /^item-mastered-(\d+)$/.exec(id);
    if (m) return itemShort(m[1]) + ' maîtrisé';
    return id;
  }

  /* ------------------------------------------------------------------ */
  /* Styles propres au moteur (tokens uniquement)                         */
  /* ------------------------------------------------------------------ */

  const STYLE_ID = 'quiz-style';
  const CSS = [
    '.quiz__meta{display:flex;align-items:center;gap:8px;min-height:28px;flex-wrap:wrap}',
    '.quiz__meta-item{flex:1 1 auto;min-width:0;font-size:.875rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.qz-card .caption{display:block;margin-bottom:6px}',
    '.qz-stem{font-size:1.0625rem;line-height:1.5}',
    '.qz-slot{min-height:48px}',
    '.qz-feedback-sub{margin-left:auto;font-weight:500;font-size:.875rem;font-variant-numeric:tabular-nums;color:var(--ink-2)}',
    '.grades .btn.is-suggested{box-shadow:inset 0 0 0 2px currentColor}',
    '.grades .btn.is-chosen{box-shadow:inset 0 0 0 2px var(--ink)}',
    '.grades .kbd{margin-top:3px}',
    '.grades .btn[disabled]{opacity:.6}',
    '.flash{display:block;width:100%;min-height:200px;text-align:left;cursor:pointer;border:0;font:inherit;color:inherit;transition:box-shadow 160ms var(--ease)}',
    '.flash:hover{box-shadow:var(--shadow-2)}',
    '.flash.is-flipped{cursor:default}',
    '.flash__face{display:flex;flex-direction:column;justify-content:center;gap:10px;min-height:168px}',
    '.flash__hint{color:var(--muted);font-size:.875rem;display:flex;align-items:center;gap:6px}',
    '.flash__text{font-size:1.125rem;line-height:1.45}',
    '.flash__label{font:600 1.25rem/1.3 var(--font-display)}',
    '.flash__value{font:700 1.5rem/1.25 var(--font-display);letter-spacing:-.01em;font-variant-numeric:tabular-nums}',
    '.kw{display:flex;flex-wrap:wrap;gap:6px}',
    '.kw .chip{min-height:32px;padding:0 12px;cursor:default}',
    '.kw .chip.is-on{background:var(--ok);border-color:var(--ok);color:#fff}',
    '.qz-answer{font:600 1.125rem/1.35 var(--font-display)}',
    '.rubric__weight{margin-left:auto;flex:none}',
    '.rubric__text{flex:1 1 auto;min-width:0}',
    '.qz-rubric-score{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-weight:600;font-variant-numeric:tabular-nums}',
    '.tcs-scale{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}',
    '.tcs-scale .btn{flex-direction:column;gap:2px;min-height:64px;padding:6px 2px;white-space:normal;font-size:.6875rem;line-height:1.2;font-weight:500}',
    '.tcs-scale .btn strong{font:700 1.125rem/1 var(--font-display)}',
    '.tcs-scale .btn.is-on{background:var(--ink);color:var(--bg)}',
    '.tcs-bars{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;align-items:end;height:110px;margin-top:8px}',
    '.tcs-bar{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:4px;font-size:.75rem;color:var(--muted);font-variant-numeric:tabular-nums}',
    '.tcs-bar__col{width:100%;max-width:44px;min-height:3px;border-radius:6px 6px 0 0;background:var(--surface-3);transition:height 600ms var(--ease)}',
    '.tcs-bar.is-peak .tcs-bar__col{background:var(--ok)}',
    '.tcs-bar.is-pick .tcs-bar__col{box-shadow:inset 0 0 0 2px var(--ink)}',
    '.tcs-bar.is-pick{color:var(--ink);font-weight:600}',
    '.tcs-bar__n{font-size:.6875rem}',
    '.tcs-case{display:grid;gap:10px}',
    '.tcs-case__row{display:grid;grid-template-columns:minmax(0,1fr);gap:2px;padding:10px 12px;border-radius:var(--r-s);background:var(--surface-2)}',
    '.tcs-case__row strong{font-weight:600}',
    '.mode-grid{display:grid;gap:10px;grid-template-columns:minmax(0,1fr)}',
    '@media (min-width:600px){.mode-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}',
    '.mode-card{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:12px 14px;border:1px solid transparent;cursor:pointer;font:inherit;color:inherit;transition:border-color 160ms var(--ease),box-shadow 160ms var(--ease)}',
    '.mode-card.is-on{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent),var(--shadow-1)}',
    '.mode-card[disabled]{opacity:.55;cursor:default}',
    '.mode-card__icon{flex:none;display:grid;place-items:center;width:40px;height:40px;border-radius:12px;background:var(--surface-2);color:var(--ink-2)}',
    '.mode-card.is-on .mode-card__icon{background:var(--accent-soft);color:var(--accent)}',
    '.mode-card__main{flex:1 1 auto;min-width:0}',
    '.mode-card__title{font-weight:600;line-height:1.3}',
    '.mode-card__desc{font-size:.8125rem;color:var(--muted);line-height:1.35}',
    '.mode-card__check{flex:none;color:var(--accent);opacity:0;transition:opacity 160ms}',
    '.mode-card.is-on .mode-card__check{opacity:1}',
    '.qz-summary{display:flex;align-items:baseline;gap:6px 10px;flex-wrap:wrap}',
    '.qz-summary strong{font:700 1.5rem/1 var(--font-display);letter-spacing:-.02em;font-variant-numeric:tabular-nums}',
    '.qz-loader{padding:32px 16px;text-align:center}',
    '.qz-loader__spin{display:inline-block;color:var(--accent);margin-bottom:8px;animation:heartbeat 1.2s ease-in-out infinite;transform-origin:center}',
    '.qz-loader .bar{margin:12px auto 0;max-width:260px}',
    '.results-hero{display:flex;align-items:center;gap:16px;flex-wrap:wrap}',
    '.results-hero__side{flex:1 1 160px;min-width:0}',
    '.results-hero__line{font-size:1.0625rem;font-weight:600}',
    '.mastery-row{display:grid;gap:4px}',
    '.mastery-row__head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:.875rem}',
    '.mastery-row__head strong{font-weight:600}',
    '.delta{font-variant-numeric:tabular-nums;font-weight:600;font-size:.8125rem}',
    '.delta--up{color:var(--ok)}.delta--down{color:var(--bad)}.delta--flat{color:var(--muted)}',
    '.qz-missed .row__title,.qz-errors-group .row__title{font-weight:500;font-size:.9375rem;line-height:1.35;white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}',
    '.qz-errors-group .row__main{min-width:0}',
    '.qz-row-actions .btn--sm{padding:4px 8px}',
    '.qz-inline-list{display:flex;flex-wrap:wrap;gap:6px}',
    '.qz-note-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}',
    '.qz-badges{display:grid;gap:10px}',
    '.qz-badge{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:var(--r-m);background:var(--accent-soft);color:var(--accent);font-weight:600}',
    '.qz-timer-big{font:600 1.125rem/1 var(--font-mono);font-variant-numeric:tabular-nums;color:var(--ink-2)}',
    '.qz-kfp-q{font-size:1.0625rem;font-weight:600;line-height:1.4}',
    '.qz-count{font-size:.75rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}',
    '.qz-scenario{max-height:40vh;overflow:auto}',
    '.qz-sticky-empty{min-height:44px}',
    '.qz-hidden-list{position:relative}',
    '.qz-reveal-btn{margin-top:8px}',
    '.qz-errors-group + .qz-errors-group{margin-top:16px}',
    '.qz-row-actions{display:flex;gap:6px;flex:none}',
    '.qz-row-actions .btn{min-height:36px;padding:4px 10px;font-size:.8125rem}',
    '.qz-row-actions .btn--icon{width:36px;padding:0}',
    '@media (prefers-reduced-motion:reduce){.qz-loader__spin{animation:none}.tcs-bar__col{transition:none}}'
  ].join('\n');

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  /* ------------------------------------------------------------------ */
  /* Sauvegarde locale des séances (reprise après rechargement)           */
  /* ------------------------------------------------------------------ */

  function ls() {
    const u = U();
    if (u && u.ls) return u.ls;
    return {
      get(k, f) { try { const r = localStorage.getItem(k); return r == null ? f : JSON.parse(r); } catch (e) { return f; } },
      set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
      remove(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
    };
  }
  function saveRt(rt) {
    if (!rt || !rt.id) return;
    ls().set(LS_PREFIX + rt.id, {
      id: rt.id, queue: rt.queue, idx: rt.idx, opts: rt.opts, results: rt.results, startedAt: rt.startedAt,
      masteryBefore: rt.masteryBefore, ended: !!rt.ended, summary: rt.summary || null, savedAt: nowMs()
    });
  }
  function loadRt(id) {
    const raw = ls().get(LS_PREFIX + id, null);
    if (!raw || !Array.isArray(raw.queue)) return null;
    return {
      id: String(id), queue: raw.queue.map(String), idx: Math.max(0, Number(raw.idx) || 0),
      opts: normOpts(raw.opts || {}), results: Array.isArray(raw.results) ? raw.results : [],
      startedAt: Number(raw.startedAt) || nowMs(), masteryBefore: raw.masteryBefore || {},
      ended: !!raw.ended, summary: raw.summary || null
    };
  }
  function dropRt(id) { ls().remove(LS_PREFIX + id); delete runtimes[id]; }
  function pruneBackups() {
    try {
      const now = nowMs();
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(LS_PREFIX) === 0) keys.push(k);
      }
      keys.forEach((k) => {
        const v = ls().get(k, null);
        if (!v || !(now - (Number(v.savedAt) || 0) < BACKUP_TTL_MS)) ls().remove(k);
      });
    } catch (e) { /* stockage indisponible */ }
  }

  /* ------------------------------------------------------------------ */
  /* Options de séance                                                    */
  /* ------------------------------------------------------------------ */

  function normOpts(o) {
    o = o || {};
    const mode = MODES.some((m) => m.id === o.mode) || o.mode === 'single' ? o.mode : 'smart';
    let kinds = Array.isArray(o.kinds) ? o.kinds : (o.kind ? String(o.kind).split(',') : []);
    kinds = kinds.map((k) => String(k).trim()).filter((k) => KIND_IDS.indexOf(k) >= 0);
    let size = o.size;
    if (size === 'inf' || size === '∞' || size === 0 || size === '0') size = 0;
    else if (size == null || size === '') size = null;
    else { size = parseInt(size, 10); if (!Number.isFinite(size) || size < 1) size = null; }
    const objectives = Array.isArray(o.objectives) ? o.objectives
      : (o.objective ? String(o.objective).split(',') : []);
    return {
      mode,
      item: o.item ? String(o.item) : null,
      kinds,
      rank: o.rank === 'A' || o.rank === 'B' ? o.rank : (mode === 'rank' ? 'A' : null),
      size,
      objectives: objectives.map((s) => String(s).trim()).filter(Boolean),
      autostart: o.autostart === '1' || o.autostart === true || o.autostart === 'true'
    };
  }
  function effectiveSize(o) {
    if (o.mode === 'exam') return EXAM_SIZE;
    return o.size == null ? DEFAULT_SIZE : o.size;
  }
  function reviewUrl(o, over) {
    const x = Object.assign({}, o, over || {});
    const p = new URLSearchParams();
    p.set('mode', x.mode === 'single' ? 'smart' : x.mode);
    if (x.item) p.set('item', x.item);
    if (x.kinds && x.kinds.length) p.set('kind', x.kinds.join(','));
    if (x.rank && x.mode !== 'rank') p.set('rank', x.rank);
    if (x.size != null && x.mode !== 'exam') p.set('size', x.size === 0 ? 'inf' : String(x.size));
    if (x.objectives && x.objectives.length) p.set('objective', x.objectives.join(','));
    if (x.autostart) p.set('autostart', '1');
    return '#/review?' + p.toString();
  }
  function describeOpts(o) {
    const parts = [MODE_LABEL[o.mode] || o.mode];
    if (o.item) parts.push(itemShort(o.item));
    if (o.kinds && o.kinds.length && o.mode !== 'kind') parts.push(o.kinds.map(kindLabel).join(', '));
    else if (o.kinds && o.kinds.length) parts[0] = o.kinds.map(kindLabel).join(', ');
    if (o.rank && o.mode !== 'rank') parts.push('rang ' + o.rank);
    return parts.join(' · ');
  }

  /* ------------------------------------------------------------------ */
  /* Point d'entrée                                                       */
  /* ------------------------------------------------------------------ */

  function render(params, query) {
    params = params || {};
    query = query || {};
    if (!U() || typeof U().h !== 'function') {
      const d = document.createElement('div');
      d.className = 'card';
      d.textContent = 'Les utilitaires de l’application sont indisponibles.';
      return d;
    }
    injectStyle();
    pruneBackups();
    const mode = params.mode;
    if (mode === 'session') return renderSession(params.id);
    if (mode === 'errors') return renderErrors();
    const q = Object.assign({}, query);
    if (mode === 'item' && params.num) {
      q.item = String(params.num);
      if (!q.mode) q.mode = 'item';
    }
    return renderSetup(q, { fromItem: mode === 'item' });
  }

  /* ------------------------------------------------------------------ */
  /* Chargeur                                                             */
  /* ------------------------------------------------------------------ */

  function loaderEl(label) {
    const u = U();
    const fill = h('span', { class: 'bar__fill' });
    const bar = h('div', { class: 'bar bar--sm', hidden: true, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill);
    const text = h('p', { class: 'muted' }, label || 'Chargement…');
    const spin = h('div', { class: 'qz-loader__spin', html: u.icon('heart-pulse', { size: 36 }) });
    const actions = h('div', { class: 'cluster', style: 'justify-content:center;margin-top:12px', hidden: true });
    const el = h('div', { class: 'card qz-loader', 'aria-live': 'polite' }, spin, text, bar, actions);
    el.setProgress = (done, total) => {
      bar.hidden = false;
      const r = total ? Math.round((done / total) * 100) : 0;
      fill.style.width = r + '%';
      bar.setAttribute('aria-valuenow', String(r));
      text.textContent = 'Chargement des items… ' + done + ' / ' + total;
    };
    el.setText = (t) => { text.textContent = t; };
    el.fail = (msg, buttons) => {
      spin.innerHTML = u.icon('warning', { size: 36 });
      spin.style.animation = 'none';
      spin.style.color = 'var(--warn)';
      bar.hidden = true;
      text.textContent = msg;
      actions.replaceChildren.apply(actions, buttons || []);
      actions.hidden = !(buttons && buttons.length);
    };
    return el;
  }

  /* ------------------------------------------------------------------ */
  /* Écran de réglage (#/review, #/item/:num/qcm)                         */
  /* ------------------------------------------------------------------ */

  function renderSetup(query, ctx) {
    ctx = ctx || {};
    const opts = normOpts(query);
    const page = h('div', { class: 'page quiz-setup' });
    const stack = h('div', { class: 'stack stack--lg' });
    page.appendChild(stack);

    if (opts.autostart) {
      const loader = loaderEl('Préparation de la séance…');
      stack.appendChild(loader);
      setTimeout(() => { startFromOpts(opts, stack, loader); }, 0);
      return { el: page, title: 'Réviser', back: opts.item ? '#/item/' + opts.item : false, tab: 'review' };
    }

    const st = ST();
    const items = (RG() && typeof RG().items === 'function') ? RG().items().filter((it) => it.available !== false) : [];
    const errorsCount = st && typeof st.errorsList === 'function' ? st.errorsList().length : 0;
    const state = {
      mode: opts.mode === 'single' ? 'smart' : opts.mode,
      item: opts.item,
      kinds: opts.kinds.slice(),
      size: opts.size == null ? DEFAULT_SIZE : opts.size,
      objectives: opts.objectives.slice(),
      itemFixed: !!ctx.fromItem
    };
    if (state.mode === 'item' && !state.item && items.length === 1) state.item = String(items[0].num);
    if (state.mode === 'errors' && !errorsCount) state.mode = 'smart';

    function summaryLine() {
      let due = 0, fresh = 0;
      if (st && typeof st.dueCards === 'function') {
        try { due = st.dueCards(nowMs(), state.item ? { item: state.item } : null).length; } catch (e) { due = 0; }
      }
      const newPerDay = Number(storeGet('profile.newPerDay', 15)) || 0;
      const todayNew = st && typeof st.todayStats === 'function' ? Number(st.todayStats().newCards) || 0 : 0;
      fresh = Math.max(0, newPerDay - todayNew);
      const goal = st && typeof st.todayStats === 'function' ? st.todayStats() : null;
      return h('div', { class: 'card qz-summary-card' },
        h('div', { class: 'qz-summary' },
          h('strong', { class: 'num' }, String(due)), h('span', due > 1 ? 'à revoir' : 'à revoir'),
          h('span', { class: 'muted' }, '·'),
          h('strong', { class: 'num' }, String(fresh)), h('span', fresh > 1 ? 'nouvelles possibles' : 'nouvelle possible')
        ),
        goal ? h('p', { class: 'secondary muted', style: 'margin-top:6px' },
          'Objectif du jour : ' + goal.reviews + ' / ' + goal.goal + (goal.reached ? ' — atteint, bravo.' : '')) : null
      );
    }

    function modeCards() {
      const grid = h('div', { class: 'mode-grid', role: 'radiogroup', 'aria-label': 'Mode de séance' });
      MODES.forEach((m) => {
        const disabled = m.id === 'errors' && !errorsCount;
        const on = state.mode === m.id;
        const btn = h('button', {
          type: 'button', class: ['card', 'mode-card', on && 'is-on'], role: 'radio', 'aria-checked': on, disabled,
          on: { click: () => { if (disabled) return; state.mode = m.id; if (m.id === 'kind' && !state.kinds.length) state.kinds = ['qcm']; draw(); } }
        },
          h('span', { class: 'mode-card__icon', html: U().icon(m.icon, { size: 22 }) }),
          h('span', { class: 'mode-card__main' },
            h('span', { class: 'mode-card__title' }, m.title, m.id === 'errors' && errorsCount ? h('span', { class: 'badge', style: 'margin-left:8px' }, String(errorsCount)) : null),
            h('span', { class: 'mode-card__desc' }, disabled ? 'Aucune erreur pour l’instant.' : m.desc)
          ),
          h('span', { class: 'mode-card__check', html: U().icon('check', { size: 20 }) })
        );
        grid.appendChild(btn);
      });
      return grid;
    }

    function itemBlock() {
      const stackEl = h('div', { class: 'stack stack--sm' });
      if (state.mode === 'item') {
        stackEl.appendChild(h('div', { class: 'caption' }, 'Item'));
        if (!items.length) {
          stackEl.appendChild(h('p', { class: 'muted' }, 'Aucun item n’est disponible dans cette version.'));
          return stackEl;
        }
        const sel = h('select', { class: 'input', 'aria-label': 'Choisir un item', on: { change: (e) => { state.item = e.target.value || null; draw(); } } },
          h('option', { value: '', disabled: true, selected: !state.item }, 'Choisis un item…'),
          items.map((it) => h('option', { value: String(it.num), selected: state.item === String(it.num) }, 'Item ' + it.num + ' · ' + it.short))
        );
        stackEl.appendChild(sel);
        if (state.objectives.length) {
          stackEl.appendChild(h('p', { class: 'secondary muted' }, 'Limité à ' + plural(state.objectives.length, 'objectif') + ' de la fiche.',
            ' ', h('button', { type: 'button', class: 'btn btn--ghost btn--sm', on: { click: () => { state.objectives = []; draw(); } } }, 'Tout l’item')));
        }
        return stackEl;
      }
      if (state.item) {
        stackEl.appendChild(h('div', { class: 'hstack hstack--between' },
          h('span', { class: 'secondary' }, 'Limité à ', h('strong', itemLabel(state.item))),
          state.itemFixed ? null : h('button', { type: 'button', class: 'btn btn--ghost btn--sm', on: { click: () => { state.item = null; state.objectives = []; draw(); } } }, 'Tous les items')
        ));
      }
      return stackEl.childNodes.length ? stackEl : null;
    }

    function kindBlock() {
      if (state.mode !== 'kind' && !state.kinds.length) return null;
      const wrap = h('div', { class: 'stack stack--sm' },
        h('div', { class: 'caption' }, state.mode === 'kind' ? 'Types de cartes' : 'Types (filtre)'));
      const chips = h('div', { class: 'chips chips--wrap', role: 'group', 'aria-label': 'Types de cartes' });
      KINDS.forEach(([id, label]) => {
        const on = state.kinds.indexOf(id) >= 0;
        chips.appendChild(h('button', {
          type: 'button', class: ['chip', on && 'is-on'], 'aria-pressed': on,
          on: { click: () => {
            const i = state.kinds.indexOf(id);
            if (i >= 0) state.kinds.splice(i, 1); else state.kinds.push(id);
            draw();
          } }
        }, label));
      });
      wrap.appendChild(chips);
      if (state.mode !== 'kind') {
        wrap.appendChild(h('button', { type: 'button', class: 'btn btn--ghost btn--sm', style: 'align-self:flex-start', on: { click: () => { state.kinds = []; draw(); } } }, 'Retirer le filtre'));
      }
      return wrap;
    }

    function sizeBlock() {
      if (state.mode === 'exam') {
        return h('p', { class: 'secondary muted' }, 'Examen blanc : ' + EXAM_SIZE + ' cartes, non chronométré mais le temps s’affiche.');
      }
      const chips = h('div', { class: 'chips chips--wrap', role: 'group', 'aria-label': 'Nombre de cartes' });
      SIZES.forEach((n) => {
        const on = state.size === n;
        chips.appendChild(h('button', {
          type: 'button', class: ['chip', 'chip--lg', on && 'is-on'], 'aria-pressed': on,
          on: { click: () => { state.size = n; draw(); } }
        }, n === 0 ? '∞' : String(n)));
      });
      return h('div', { class: 'stack stack--sm' }, h('div', { class: 'caption' }, 'Nombre de cartes'), chips);
    }

    function canLaunch() {
      if (state.mode === 'item' && !state.item) return false;
      if (state.mode === 'kind' && !state.kinds.length) return false;
      if (state.mode === 'errors' && !errorsCount) return false;
      return true;
    }
    function ctaLabel() {
      if (state.mode === 'exam') return 'Lancer l’examen blanc';
      if (state.mode === 'errors') return 'Refaire mes erreurs';
      const n = state.size === 0 ? null : state.size;
      return n ? 'Lancer ' + plural(n, 'carte') : 'Lancer toutes les cartes';
    }
    function currentOpts() {
      return normOpts({
        mode: state.mode, item: state.item, kinds: state.kinds, size: state.size,
        rank: state.mode === 'rank' ? 'A' : null, objectives: state.objectives
      });
    }
    function launch() {
      if (!canLaunch()) return;
      const o = currentOpts();
      const loader = loaderEl('Préparation de la séance…');
      stack.replaceChildren(loader);
      startFromOpts(o, stack, loader);
    }

    function draw() {
      const cta = h('button', { type: 'button', class: 'btn btn--primary btn--block btn--lg', disabled: !canLaunch(), on: { click: launch } }, icon('play'), ctaLabel());
      stack.replaceChildren(
        summaryLine(),
        h('div', { class: 'stack stack--sm' }, h('div', { class: 'caption' }, 'Mode'), modeCards()),
        itemBlock(),
        kindBlock(),
        sizeBlock(),
        cta,
        h('p', { class: 'secondary muted center hide-phone' }, 'Astuce clavier : ', h('span', { class: 'kbd' }, '1'), '–', h('span', { class: 'kbd' }, '5'), ' pour les options, ', h('span', { class: 'kbd' }, 'Entrée'), ' pour valider.')
      );
    }
    draw();
    page.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT') { e.preventDefault(); launch(); }
    });

    return {
      el: page,
      title: ctx.fromItem ? undefined : 'Réviser',
      back: ctx.fromItem ? '#/item/' + opts.item : false,
      tab: ctx.fromItem ? 'items' : 'review'
    };
  }

  /* ------------------------------------------------------------------ */
  /* Lancement : chargement du contenu, construction de la file           */
  /* ------------------------------------------------------------------ */

  function loadFor(opts, loader) {
    const reg = RG();
    if (!reg || typeof reg.load !== 'function') {
      warnOnce('registry', 'CARDIO.registry indisponible : impossible de charger le contenu.');
      return Promise.resolve();
    }
    if (opts.item) return reg.load(opts.item);
    if (opts.mode === 'errors') {
      const st = ST();
      const list = st && typeof st.errorsList === 'function' ? st.errorsList() : [];
      const nums = Array.from(new Set(list.map((e) => e.item || itemOfId(e.cardId)).filter(Boolean)));
      let done = 0;
      return Promise.all(nums.map((n) => reg.load(n).catch((e) => { console.warn('[quiz] item non chargé', n, e); return null; })
        .then(() => { done++; if (loader) loader.setProgress(done, nums.length); })));
    }
    if (typeof reg.loadAll === 'function') {
      return reg.loadAll({ onProgress: (done, total) => { if (loader) loader.setProgress(done, total); } });
    }
    return Promise.resolve();
  }

  function isDueState(cs) {
    const S = SR();
    if (!cs) return false;
    if (S && typeof S.isDue === 'function') return S.isDue(cs, nowMs());
    return cs.due != null && cs.due <= nowMs();
  }
  function retrievability(cs) {
    const S = SR();
    if (!cs || !(cs.reps > 0)) return 0;
    if (S && typeof S.retrievability === 'function') return S.retrievability(cs, nowMs());
    return 0.5;
  }
  function interleaveKinds(ids, maxRun) {
    const rest = ids.slice(), out = [];
    let runKind = null, run = 0;
    while (rest.length) {
      let idx = 0;
      if (run >= maxRun) {
        idx = rest.findIndex((id) => { const c = registryCard(id); return c && c.kind !== runKind; });
        if (idx < 0) idx = 0;
      }
      const id = rest.splice(idx, 1)[0];
      const c = registryCard(id);
      const k = c ? c.kind : null;
      if (k === runKind) run++; else { runKind = k; run = 1; }
      out.push(id);
    }
    return out;
  }
  function capQueue(ids, size) {
    if (!size) return ids;
    const out = [];
    let used = 0;
    for (const id of ids) {
      const c = registryCard(id);
      const cost = c && c.kind === 'case' ? 4 : 1;
      if (used + cost > size) continue;
      out.push(id); used += cost;
      if (used >= size) break;
    }
    return out;
  }

  /** File filtrée par objectifs (la fiche renvoie ici) : dues, puis nouvelles, puis le reste. */
  function buildObjectiveQueue(opts) {
    const reg = RG(), st = ST();
    let pool = [];
    if (reg && typeof reg.cardsForObjective === 'function') {
      opts.objectives.forEach((obj) => { pool = pool.concat(reg.cardsForObjective(opts.item, obj) || []); });
    } else if (reg && typeof reg.cards === 'function') {
      pool = (reg.cards(opts.item) || []).filter((c) => opts.objectives.indexOf(c.objective) >= 0);
    }
    const seen = new Set();
    pool = pool.filter((c) => {
      if (!c || seen.has(c.id)) return false;
      seen.add(c.id);
      if (opts.kinds.length && opts.kinds.indexOf(c.kind) < 0) return false;
      if (opts.rank && c.rank !== opts.rank) return false;
      return true;
    });
    const cs = (id) => (st && st.state && st.state.cards ? st.state.cards[id] : null);
    const due = [], fresh = [], rest = [];
    pool.forEach((c) => {
      const s = cs(c.id);
      if (isDueState(s)) due.push(c);
      else if (!s || !(s.reps > 0)) fresh.push(c);
      else rest.push(c);
    });
    due.sort((a, b) => retrievability(cs(a.id)) - retrievability(cs(b.id)));
    rest.sort((a, b) => retrievability(cs(a.id)) - retrievability(cs(b.id)));
    const ids = due.concat(fresh, rest).map((c) => c.id);
    return interleaveKinds(capQueue(ids, effectiveSize(opts)), 3);
  }

  function buildQueue(opts) {
    let ids = [];
    if (opts.objectives.length && opts.item) {
      ids = buildObjectiveQueue(opts);
    } else {
      const st = ST();
      if (st && typeof st.buildSession === 'function') {
        try {
          ids = st.buildSession({
            mode: opts.mode, item: opts.item, size: effectiveSize(opts),
            kinds: opts.kinds.length ? opts.kinds : null, rank: opts.rank
          }) || [];
        } catch (e) { console.error('[quiz] buildSession a échoué', e); ids = []; }
      } else {
        warnOnce('build', 'CARDIO.store.buildSession indisponible : file simplifiée.');
        const reg = RG();
        const pool = reg && typeof reg.cards === 'function' ? reg.cards(opts.item || undefined) : [];
        const u = U();
        ids = capQueue((u && u.shuffle ? u.shuffle(pool) : pool).filter((c) => !opts.kinds.length || opts.kinds.indexOf(c.kind) >= 0).map((c) => c.id), effectiveSize(opts));
      }
    }
    // On écarte les cartes dont le contenu n'est pas disponible (item non chargé, id orphelin).
    const ok = [], dropped = [];
    ids.forEach((id) => { if (registryCard(id)) ok.push(id); else dropped.push(id); });
    if (dropped.length) console.warn('[quiz] cartes ignorées (contenu indisponible) :', dropped);
    return ok;
  }

  function masterySnapshot(items) {
    const st = ST();
    const out = {};
    if (!st || typeof st.mastery !== 'function') return out;
    items.forEach((num) => {
      try { const m = st.mastery(num); out[num] = { A: m.A, B: m.B, all: m.all, seen: m.seen, total: m.total }; }
      catch (e) { /* ignore */ }
    });
    return out;
  }

  function createRuntime(queue, opts) {
    const st = ST();
    let id = null;
    if (st && typeof st.startSession === 'function') {
      try { const s = st.startSession({ mode: opts.mode, item: opts.item, size: queue.length, cards: queue }); id = s && s.id; }
      catch (e) { console.error('[quiz] startSession a échoué', e); }
    }
    if (!id) id = 'local-' + (U().uid ? U().uid() : Date.now().toString(36));
    const items = Array.from(new Set(queue.map(itemOfId).filter(Boolean)));
    const rt = {
      id: String(id), queue: queue.slice(), idx: 0, opts, results: [], startedAt: nowMs(),
      masteryBefore: masterySnapshot(items), ended: false, summary: null
    };
    runtimes[rt.id] = rt;
    saveRt(rt);
    return rt;
  }

  function emptyQueueMessage(opts) {
    if (opts.mode === 'smart') return 'Tout est à jour : aucune carte due et ton quota de nouvelles cartes du jour est atteint. Reviens demain, ou lance une séance par item.';
    if (opts.mode === 'errors') return 'Ton cahier d’erreurs est vide. Bravo.';
    if (opts.objectives.length) return 'Aucune carte n’est rattachée à ces objectifs pour l’instant.';
    if (opts.mode === 'exam') return 'Pas assez de contenu disponible pour composer un examen blanc.';
    return 'Rien à réviser avec ces critères. Élargis le filtre ou choisis un autre mode.';
  }

  function startFromOpts(opts, host, loader) {
    loader = loader || loaderEl('Préparation de la séance…');
    if (host && !host.contains(loader)) host.replaceChildren(loader);
    const retryBtn = () => h('button', { type: 'button', class: 'btn btn--primary', on: { click: () => startFromOpts(opts, host) } }, 'Réessayer');
    const editBtn = () => h('button', { type: 'button', class: 'btn btn--secondary', on: { click: () => go(reviewUrl(opts, { autostart: false })) } }, 'Modifier la séance');
    const homeBtn = () => h('a', { class: 'btn btn--ghost', href: '#/' }, 'Accueil');
    return loadFor(opts, loader).then(() => {
      loader.setText('Composition de la file…');
      const queue = buildQueue(opts);
      if (!queue.length) {
        loader.fail(emptyQueueMessage(opts), [editBtn(), opts.item ? h('a', { class: 'btn btn--secondary', href: '#/item/' + opts.item }, 'Voir l’item') : homeBtn()]);
        return null;
      }
      const rt = createRuntime(queue, opts);
      go('#/session/' + rt.id);
      return rt;
    }).catch((err) => {
      console.error('[quiz] lancement impossible', err);
      loader.fail((err && err.friendly && err.message) || 'Impossible de charger le contenu. Vérifie ta connexion puis réessaie.', [retryBtn(), editBtn()]);
      return null;
    });
  }

  /** Séance ciblée sur une liste de cartes (bouton « Revoir »). */
  function startWithQueue(ids, opts) {
    const o = normOpts(Object.assign({ mode: 'single' }, opts || {}));
    o.mode = 'single';
    const reg = RG();
    const nums = Array.from(new Set(ids.map(itemOfId).filter(Boolean)));
    const loads = reg && typeof reg.load === 'function' ? nums.map((n) => reg.load(n).catch(() => null)) : [];
    const sh = SH();
    if (sh && sh.loadingSoon) sh.loadingSoon(120);
    return Promise.all(loads).then(() => {
      const queue = ids.filter((id) => registryCard(id));
      if (sh && sh.setLoading) sh.setLoading(false);
      if (!queue.length) { toast('Cette carte n’est pas disponible.', { tone: 'warn' }); return null; }
      const rt = createRuntime(queue, o);
      go('#/session/' + rt.id);
      return rt;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Séance en cours (#/session/:id)                                      */
  /* ------------------------------------------------------------------ */

  function notFoundEl() {
    return {
      el: h('div', { class: 'page' },
        h('div', { class: 'card empty' },
          h('div', { class: 'empty__icon', html: U().icon('search', { size: 40 }) }),
          h('p', { class: 'empty__title' }, 'Séance introuvable'),
          h('p', 'Elle a peut-être expiré. Lance une nouvelle séance.'),
          h('div', { class: 'cluster', style: 'justify-content:center;margin-top:12px' },
            h('a', { class: 'btn btn--primary', href: '#/review' }, 'Choisir une séance'),
            h('a', { class: 'btn btn--secondary', href: '#/' }, 'Accueil')))),
      title: 'Session', back: '#/review', tab: 'review'
    };
  }

  function renderSession(id) {
    id = txt(id);
    let rt = runtimes[id] || loadRt(id);
    if (!rt) {
      const st = ST();
      const s = st && typeof st.session === 'function' ? st.session(id) : null;
      if (s && Array.isArray(s.cards) && s.cards.length) {
        rt = {
          id, queue: s.cards.slice(), idx: Math.min(s.done || 0, s.cards.length),
          opts: normOpts({ mode: s.mode, item: s.item, size: s.size }), results: [], startedAt: s.startedAt || nowMs(),
          masteryBefore: {}, ended: !!s.endedAt,
          summary: s.endedAt ? { done: s.done, score: s.score, xp: s.xp, ms: s.ms || 0 } : null
        };
      }
    }
    if (!rt) return notFoundEl();
    runtimes[id] = rt;
    // La dernière carte peut avoir avancé l'index sans qu'endRuntime() ait encore tourné
    // (ex. carte « case » avec advance:false, en attente d'un clic « Suivant ») : si on atterrit
    // ici (nouvelle navigation / rechargement) alors que la file est épuisée, on termine tout de
    // suite plutôt que de laisser runnerSpec() déclencher un double montage (coquille vide).
    if (rt.ended || rt.idx >= rt.queue.length) { endRuntime(rt); return resultsSpec(rt); }

    const reg = RG();
    const missing = Array.from(new Set(rt.queue.slice(rt.idx).map(itemOfId).filter(Boolean)))
      .filter((n) => !(reg && typeof reg.isLoaded === 'function' && reg.isLoaded(n)));
    if (missing.length && reg && typeof reg.load === 'function') {
      return Promise.all(missing.map((n) => reg.load(n).catch((e) => { console.warn('[quiz] reprise : item non chargé', n, e); return null; })))
        .then(() => runnerSpec(rt));
    }
    return runnerSpec(rt);
  }

  function runnerSpec(rt) {
    const u = U();
    const page = h('div', { class: 'page quiz' });
    const timerEl = h('span', { class: 'timer', 'aria-label': 'Temps sur cette carte' }, '0:00');
    const totalEl = h('span', { class: 'qz-timer-big', hidden: rt.opts.mode !== 'exam', 'aria-label': 'Temps total' }, '0:00');
    const meta = h('div', { class: 'quiz__meta' });
    const stage = h('div', { class: 'quiz__stage stack', tabindex: '-1' });
    const barHint = h('div', { class: 'actionbar__hint' });
    const barBtn = h('button', { type: 'button', class: 'btn btn--primary' }, 'Valider');
    const bar = h('div', { class: 'actionbar', role: 'toolbar', 'aria-label': 'Actions' }, h('div', { class: 'actionbar__inner' }, barHint, barBtn));
    page.append(meta, stage, bar);

    let current = null;       // {card, t0, recorded, keyHandler, gradeKeys}
    let barHandler = null;
    let timer = null;
    let detached = false;
    let offMounted = null;

    barBtn.addEventListener('click', () => { if (typeof barHandler === 'function') barHandler(); });

    const action = {
      set(cfg) {
        cfg = cfg || {};
        barHandler = typeof cfg.onClick === 'function' ? cfg.onClick : null;
        if (cfg.label == null) { barBtn.hidden = true; }
        else { barBtn.hidden = false; barBtn.textContent = cfg.label; }
        barBtn.disabled = !!cfg.disabled;
        barBtn.className = 'btn ' + (cfg.tone === 'secondary' ? 'btn--secondary' : 'btn--primary');
        barHint.textContent = cfg.hint || '';
      },
      enable(on) { barBtn.disabled = !on; },
      hint(t) { barHint.textContent = t || ''; },
      click() { if (!barBtn.hidden && !barBtn.disabled && barHandler) barHandler(); }
    };

    function headerSpec() {
      const n = Math.min(rt.idx + 1, rt.queue.length);
      return {
        title: n + ' / ' + rt.queue.length,
        back: quit,
        actions: [
          { icon: 'note', label: 'Noter cette carte', onClick: openNote },
          { icon: 'x', label: 'Quitter la séance', onClick: quit }
        ]
      };
    }
    function updateChrome() {
      const sh = SH();
      if (!sh) return;
      const n = Math.min(rt.idx + 1, rt.queue.length);
      if (typeof sh.setHeader === 'function') sh.setHeader(headerSpec());
      if (typeof sh.progressBar === 'function') sh.progressBar(rt.queue.length ? rt.idx / rt.queue.length : 0, n + ' / ' + rt.queue.length);
    }

    function tick() {
      if (!current) return;
      timerEl.textContent = fmtClock(nowMs() - current.t0);
      totalEl.textContent = fmtClock(nowMs() - rt.startedAt);
    }
    function startTimer() {
      if (timer) clearInterval(timer);
      tick();
      timer = setInterval(tick, 1000);
    }

    /* ---- clavier (desktop) ---- */
    function onKey(e) {
      if (detached) return;
      if (!document.contains(page)) { detach(); return; }
      const app = document.getElementById('app');
      if (app && app.classList.contains('has-overlay')) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      const editing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.key === 'Escape') { e.preventDefault(); quit(); return; }
      if (editing) return;
      if (current && current.gradeKeys && /^[ahgeAHGE]$/.test(e.key)) {
        e.preventDefault();
        current.gradeKeys(e.key.toLowerCase());
        return;
      }
      if (current && typeof current.keyHandler === 'function') {
        let handled = false;
        try { handled = current.keyHandler(e) === true; } catch (err) { console.warn(err); }
        if (handled) { e.preventDefault(); return; }
      }
      if (e.key === 'Enter') { e.preventDefault(); action.click(); }
    }
    document.addEventListener('keydown', onKey);
    if (u && typeof u.on === 'function') {
      offMounted = u.on('shell:mounted', (p) => { if (!p || (p.el !== page && !page.contains(p.el))) detach(); });
    }
    function detach() {
      if (detached) return;
      detached = true;
      document.removeEventListener('keydown', onKey);
      if (timer) { clearInterval(timer); timer = null; }
      if (typeof offMounted === 'function') { offMounted(); offMounted = null; }
    }

    /* ---- quitter ---- */
    let quitting = false;
    function quit() {
      if (quitting) return;
      quitting = true;
      const sh = SH();
      const done = rt.results.length;
      const msg = done
        ? 'Quitter la séance ? Les ' + plural(done, 'carte répondue', 'cartes répondues') + ' restent enregistrées.'
        : 'Quitter la séance ?';
      const p = sh && typeof sh.confirm === 'function'
        ? sh.confirm(msg, { ok: 'Quitter', cancel: 'Continuer', tone: 'danger' })
        : Promise.resolve(window.confirm(msg));
      p.then((ok) => {
        quitting = false;
        if (!ok) return;
        detach();
        if (rt.results.length) { showResults(rt); return; }
        const st = ST();
        if (st && typeof st.endSession === 'function') { try { st.endSession(rt.id, { done: 0 }); } catch (e) { /* ignore */ } }
        dropRt(rt.id);
        go(rt.opts.item ? '#/item/' + rt.opts.item : '#/review');
      });
    }

    /* ---- notes & favoris ---- */
    function isBookmarked(id) {
      const b = storeGet('bookmarks', []);
      return Array.isArray(b) && b.indexOf(id) >= 0;
    }
    function openNote() {
      if (!current) return;
      const st = ST(), sh = SH();
      if (!sh || typeof sh.sheet !== 'function') return;
      const id = current.card.id;
      const notes = storeGet('notes', {}) || {};
      const ta = h('textarea', { class: 'input', rows: '5', placeholder: 'Ta note sur cette carte (visible dans le cahier et les stats)…', 'aria-label': 'Note', value: notes[id] || '' });
      let bm = isBookmarked(id);
      const bmLabel = () => (bm ? 'Dans tes favoris' : 'Ajouter aux favoris');
      const bmBtn = h('button', { type: 'button', class: 'btn btn--secondary', 'aria-pressed': bm, on: { click: () => {
        if (!st) return;
        if (typeof st.toggleBookmark === 'function') bm = !!st.toggleBookmark(id);
        else if (typeof st.update === 'function') {
          st.update((s) => { s.bookmarks = s.bookmarks || []; const i = s.bookmarks.indexOf(id); if (i >= 0) s.bookmarks.splice(i, 1); else s.bookmarks.push(id); bm = i < 0; });
        }
        bmBtn.setAttribute('aria-pressed', bm ? 'true' : 'false');
        bmBtn.replaceChildren(icon('bookmark'), bmLabel());
        toast(bm ? 'Ajouté aux favoris' : 'Retiré des favoris', { tone: 'info', ms: 1400 });
      } } }, icon('bookmark'), bmLabel());
      let ref = null;
      const save = () => {
        const text = ta.value.trim();
        if (st) {
          if (typeof st.setNote === 'function') st.setNote(id, text);
          else if (typeof st.update === 'function') st.update((s) => { s.notes = s.notes || {}; if (text) s.notes[id] = text; else delete s.notes[id]; });
        }
        toast(text ? 'Note enregistrée' : 'Note effacée', { tone: 'ok', ms: 1400 });
        if (ref) ref.close(true);
      };
      const body = h('div', { class: 'stack' },
        h('p', { class: 'secondary muted' }, kindLabel(current.card.kind) + ' · ' + itemLabel(current.card.item)),
        ta,
        h('div', { class: 'qz-note-actions' },
          bmBtn,
          h('a', { class: 'btn btn--ghost', href: '#/item/' + current.card.item + '/cours', on: { click: () => { if (ref) ref.close(false); } } }, icon('book'), 'Voir la fiche'),
          h('button', { type: 'button', class: 'btn btn--primary', on: { click: save } }, 'Enregistrer')
        )
      );
      ref = sh.sheet(body, { title: 'Noter cette carte' });
    }

    /* ---- contexte fourni aux rendus de cartes ---- */
    function makeCtx(cur) {
      const ctx = {
        card: cur.card, data: cur.card.data || {}, rt, action,
        get t0() { return cur.t0; },
        elapsed() { return nowMs() - cur.t0; },
        setKeys(fn) { cur.keyHandler = fn; },
        setGradeKeys(fn) { cur.gradeKeys = fn; },
        finish(res) { finishCard(cur, res || {}); },
        skip() { if (cur.recorded) return; cur.recorded = true; rt.idx += 1; saveRt(rt); renderCurrent(); },
        gradeBar(o) { return gradeBar(ctx, o || {}); },
        haptic
      };
      return ctx;
    }

    function finishCard(cur, res) {
      if (cur.recorded) return;
      cur.recorded = true;
      cur.gradeKeys = null;
      cur.keyHandler = null;
      const card = cur.card;
      const ms = Number.isFinite(res.ms) ? Math.max(0, Math.round(res.ms)) : nowMs() - cur.t0;
      const st = ST();
      let out = null;
      if (st && typeof st.recordAttempt === 'function') {
        try {
          out = st.recordAttempt({
            cardId: card.id, item: card.item, kind: card.kind,
            score: res.score == null ? undefined : clamp01(res.score), grade: res.grade || undefined, ms, details: res.details || undefined
          });
        } catch (e) { console.error('[quiz] recordAttempt a échoué', e); }
      } else warnOnce('record', 'CARDIO.store.recordAttempt indisponible : progression non enregistrée.');
      const score = out && out.score != null ? out.score : (res.score != null ? clamp01(res.score) : gradeToScore(res.grade || 3));
      const grade = out && out.grade ? out.grade : (res.grade || suggestGradeRaw(score, ms, card.kind));
      rt.results.push({ cardId: card.id, kind: card.kind, item: card.item, score, grade, ms, xp: out ? out.xpGained || 0 : 0, at: nowMs() });
      rt.idx += 1;
      saveRt(rt);
      if (out && out.xpGained > 0) toast('+' + out.xpGained + ' XP', { tone: 'ok', ms: 1200 });
      if (out && Array.isArray(out.newBadges) && out.newBadges.length) setTimeout(() => showBadges(out.newBadges), 300);
      if (res.advance === false) {
        action.set({ label: 'Suivant', onClick: renderCurrent, hint: rt.idx >= rt.queue.length ? 'Dernière carte : voir les résultats' : '' });
      } else {
        setTimeout(renderCurrent, reduced() ? 0 : 140);
      }
    }

    /* Médiane des temps de réponse de la séance pour ce kind (grade « Facile »). */
    function medianMs(kind) {
      const arr = rt.results.filter((r) => r.kind === kind && r.ms > 0).map((r) => r.ms).sort((a, b) => a - b);
      if (arr.length < MEDIAN_MIN_SAMPLES) return 0;
      const mid = Math.floor(arr.length / 2);
      return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    }
    function cardStreak(cs) {
      let n = 0;
      const hist = (cs && cs.hist) || [];
      for (let i = hist.length - 1; i >= 0; i--) {
        const ok = hist[i][2] == null ? hist[i][1] >= 3 : hist[i][2] >= 0.99;
        if (!ok) break;
        n++;
      }
      return n;
    }
    function suggestGradeRaw(score, ms, kind, cardId) {
      const S = SR(), st = ST();
      if (score == null) return 3;
      const cs = cardId && st && typeof st.card === 'function' ? st.card(cardId) : null;
      if (S && typeof S.gradeFromScore === 'function') {
        return S.gradeFromScore(score, { ms, medianMs: medianMs(kind), streak: cardStreak(cs) });
      }
      return score >= 0.99 ? 3 : score >= 0.5 ? 2 : 1;
    }

    /* Barre de grades Encore / Difficile / Bien / Facile avec aperçu des intervalles. */
    function gradeBar(ctx, o) {
      const st = ST(), S = SR();
      const cardId = ctx.card.id;
      const cs = st && typeof st.card === 'function' ? st.card(cardId) : null;
      let preview = {};
      if (S && typeof S.nextIntervalsPreview === 'function') {
        try { preview = S.nextIntervalsPreview(cs, nowMs(), { retention: Number(storeGet('profile.retention', 0.9)) || 0.9, seed: cardId }) || {}; }
        catch (e) { preview = {}; }
      }
      let score = o.score;
      const ms = o.ms != null ? o.ms : ctx.elapsed();
      let suggested = o.suggested || suggestGradeRaw(score, ms, ctx.card.kind, cardId);
      let picked = false;
      const buttons = [];
      const wrap = h('div', { class: 'grades', role: 'group', 'aria-label': 'Comment ça s’est passé ?' });
      const pick = (g) => {
        if (picked) return;
        picked = true;
        buttons.forEach((b) => { b.disabled = true; b.classList.toggle('is-chosen', Number(b.dataset.g) === g); });
        action.set({ label: 'Suivant', disabled: true });
        if (typeof o.onGrade === 'function') o.onGrade(g);
        else ctx.finish({ score: score == null ? gradeToScore(g) : score, grade: g, ms });
      };
      GRADE_DEFS.forEach((d) => {
        const b = h('button', {
          type: 'button', class: ['btn', d.cls, d.g === suggested && 'is-suggested'], dataset: { g: d.g },
          'aria-label': d.label + (preview[d.g] ? ' — prochain rappel dans ' + preview[d.g] : ''),
          on: { click: () => pick(d.g) }
        }, d.label, preview[d.g] ? h('small', preview[d.g]) : null, h('span', { class: 'kbd hide-phone', 'aria-hidden': 'true' }, d.key.toUpperCase()));
        buttons.push(b);
        wrap.appendChild(b);
      });
      ctx.setGradeKeys((k) => { const d = GRADE_DEFS.find((x) => x.key === k); if (d) pick(d.g); });
      const hintFor = (g) => 'Entrée = ' + gradeLabel(g);
      action.set({ label: 'Suivant', onClick: () => pick(suggested), hint: hintFor(suggested) });
      const el = h('div', { class: 'stack stack--sm qz-grades' }, h('div', { class: 'caption' }, o.title || 'Comment ça s’est passé ?'), wrap);
      el.setScore = (s) => {
        score = s;
        suggested = suggestGradeRaw(score, ms, ctx.card.kind, cardId);
        buttons.forEach((b) => b.classList.toggle('is-suggested', Number(b.dataset.g) === suggested));
        action.hint(hintFor(suggested));
      };
      return el;
    }

    /* ---- rendu de la carte courante ---- */
    function renderCurrent() {
      if (detached) return;
      if (rt.idx >= rt.queue.length) { showResults(rt); return; }
      const id = rt.queue[rt.idx];
      const card = registryCard(id);
      if (!card) {
        console.warn('[quiz] carte indisponible, ignorée :', id);
        rt.idx += 1;
        saveRt(rt);
        renderCurrent();
        return;
      }
      current = { card, t0: nowMs(), recorded: false, keyHandler: null, gradeKeys: null };
      const ctx = makeCtx(current);
      meta.replaceChildren(
        kindPill(card.kind), rankPill(card.rank),
        h('span', { class: 'quiz__meta-item', title: itemLabel(card.item) }, itemShort(card.item)),
        totalEl, timerEl
      );
      action.set({ label: 'Valider', disabled: true });
      let el;
      try {
        const fn = RENDERERS[card.kind];
        el = fn ? fn(card, ctx) : renderUnknown(card, ctx);
      } catch (e) {
        console.error('[quiz] rendu de la carte impossible', id, e);
        el = renderBroken(card, ctx);
      }
      stage.replaceChildren(el);
      const v = viewEl();
      if (v) v.scrollTop = 0;
      startTimer();
      updateChrome();
      const focusTarget = stage.querySelector('[autofocus]');
      try { (focusTarget || stage).focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }

    renderCurrent();
    setTimeout(updateChrome, 0);
    return Object.assign({ el: page, session: true, tab: 'review' }, headerSpec());
  }

  /* ------------------------------------------------------------------ */
  /* Composants partagés des cartes                                       */
  /* ------------------------------------------------------------------ */

  function feedbackEl(tone, line, sub) {
    const ic = { ok: 'check', warn: 'info', bad: 'x', info: 'info' }[tone] || 'info';
    return h('div', { class: ['feedback', 'feedback--' + tone], role: 'status' },
      icon(ic, { size: 20 }), h('span', line), sub ? h('span', { class: 'qz-feedback-sub' }, sub) : null);
  }
  function explainEl(title, text) {
    if (!text) return null;
    return h('div', { class: 'explain' }, h('span', { class: 'caption' }, title), md(text));
  }
  function trapEl(text) {
    if (!text) return null;
    return h('div', { class: 'pitfall' }, h('span', { class: 'caption' }, 'Piège'), md(text));
  }
  function srcEl(src) {
    return src ? h('div', { class: 'src' }, txt(src)) : null;
  }
  function optRow(i, text, onClick) {
    const why = h('div', { class: 'opt__why', hidden: true });
    const btn = h('button', { type: 'button', class: 'opt', 'aria-pressed': 'false', on: { click: onClick } },
      h('span', { class: 'opt__key', 'aria-hidden': 'true' }, LETTERS[i] || String(i + 1)),
      h('span', { class: 'opt__text' }, txt(text)), why);
    return { btn, why };
  }
  function markRow(row, selected, ok, why) {
    row.btn.classList.remove('is-selected');
    row.btn.classList.add(selected && ok ? 'is-correct' : selected && !ok ? 'is-wrong' : ok ? 'is-missed' : 'is-neutral');
    row.btn.disabled = true;
    row.btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
    if (why) { row.why.textContent = txt(why); row.why.hidden = false; }
  }
  function numberKey(e, max) {
    if (e.key.length !== 1 || e.key < '1' || e.key > '9') return -1;
    const n = parseInt(e.key, 10);
    return n >= 1 && n <= max ? n - 1 : -1;
  }
  function scrollIntoView(el) {
    try { el.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ */
  /* QCM (QRM / QRU)                                                      */
  /* ------------------------------------------------------------------ */

  function renderQcm(card, ctx) {
    const d = ctx.data;
    const isQru = txt(d.type).toUpperCase() === 'QRU';
    const opts = Array.isArray(d.options) ? d.options : [];
    const selected = new Set();
    let validated = false;
    const rows = opts.map((o, i) => optRow(i, o && o.t, () => toggle(i)));
    const hintIdle = isQru ? 'Choisis une réponse' : 'Choisis une ou plusieurs réponses';

    function toggle(i) {
      if (validated) return;
      if (isQru) { const was = selected.has(i); selected.clear(); if (!was) selected.add(i); }
      else if (selected.has(i)) selected.delete(i); else selected.add(i);
      rows.forEach((r, j) => {
        const on = selected.has(j);
        r.btn.classList.toggle('is-selected', on);
        r.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      ctx.action.enable(selected.size > 0);
      ctx.action.hint(selected.size ? (isQru ? '' : plural(selected.size, 'réponse cochée', 'réponses cochées')) : hintIdle);
    }

    const slot = h('div', { class: 'qz-slot', 'aria-live': 'polite' });
    const after = h('div', { class: 'stack', hidden: true });
    const el = h('div', { class: 'stack' },
      h('div', { class: 'card qz-card' },
        h('span', { class: 'caption' }, isQru ? 'Une seule réponse' : 'Une ou plusieurs réponses'),
        md(d.stem, 'qz-stem')),
      h('div', { class: 'opts', role: 'group', 'aria-label': 'Propositions' }, rows.map((r) => r.btn)),
      slot, after);

    function validate() {
      if (validated || !selected.size) return;
      validated = true;
      const ms = ctx.elapsed();
      let disc = 0;
      rows.forEach((r, i) => {
        const sel = selected.has(i), ok = !!(opts[i] && opts[i].ok);
        if (sel !== ok) disc++;
        markRow(r, sel, ok, opts[i] && opts[i].why);
      });
      let score, tone, line, sub;
      if (isQru) {
        score = Array.from(selected).every((i) => opts[i] && opts[i].ok) ? 1 : 0;
        tone = score ? 'ok' : 'bad';
        line = score ? 'Juste.' : 'Faux — regarde pourquoi.';
        sub = score ? 'Juste → 1' : 'Faux → 0';
      } else {
        score = ednScore(disc);
        if (disc === 0) { tone = 'ok'; line = 'Juste.'; }
        else if (disc === 1) { tone = 'warn'; line = 'Presque : 1 discordance.'; }
        else if (disc === 2) { tone = 'warn'; line = '2 discordances.'; }
        else { tone = 'bad'; line = 'Faux — regarde pourquoi.'; }
        sub = plural(disc, 'discordance') + ' → ' + fmtScore(score);
      }
      haptic();
      slot.replaceChildren(feedbackEl(tone, line, sub));
      const grades = ctx.gradeBar({ score, ms, onGrade: (g) => ctx.finish({ score, grade: g, ms, details: { type: d.type, discordances: disc, difficulty: d.difficulty, selected: Array.from(selected) } }) });
      after.replaceChildren(explainEl('Explication', d.explanation), trapEl(d.trap), srcEl(d.src), grades);
      after.hidden = false;
      scrollIntoView(slot);
    }

    ctx.action.set({ label: 'Valider', disabled: true, hint: hintIdle, onClick: validate });
    ctx.setKeys((e) => {
      if (validated) return false;
      const i = numberKey(e, rows.length);
      if (i >= 0) { toggle(i); return true; }
      return false;
    });
    return el;
  }

  /* ------------------------------------------------------------------ */
  /* QROC                                                                 */
  /* ------------------------------------------------------------------ */

  function renderQroc(card, ctx) {
    const d = ctx.data;
    const norm = (s) => (U().normalize ? U().normalize(s) : txt(s).toLowerCase().trim());
    let validated = false;
    const input = h('input', {
      type: 'text', class: 'input', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
      placeholder: 'Ta réponse…', 'aria-label': 'Ta réponse', autofocus: true, enterkeyhint: 'done',
      on: { keydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); validate(); } } }
    });
    const slot = h('div', { class: 'qz-slot', 'aria-live': 'polite' });
    const after = h('div', { class: 'stack', hidden: true });
    const el = h('div', { class: 'stack' },
      h('div', { class: 'card qz-card' }, h('span', { class: 'caption' }, 'Réponse courte'), md(d.question, 'qz-stem')),
      h('div', { class: 'field' }, input, h('span', { class: 'field__hint' }, 'Réponds en quelques mots, puis compare.')),
      slot, after);

    function validate() {
      if (validated) return;
      validated = true;
      const ms = ctx.elapsed();
      input.disabled = true;
      const given = norm(input.value);
      const expected = [d.answer].concat(Array.isArray(d.accept) ? d.accept : []).map(norm).filter(Boolean);
      const exact = !!given && expected.some((a) => given === a || given.indexOf(a) >= 0);
      const keywords = Array.isArray(d.keywords) ? d.keywords : [];
      const matched = keywords.filter((k) => { const nk = norm(k); return nk && given.indexOf(nk) >= 0; });
      const ratio = exact ? 1 : keywords.length ? matched.length / keywords.length : 0;
      const score = exact || (keywords.length && ratio >= 0.999) ? 1 : ratio > 0 ? 0.5 : 0;
      let tone, line;
      if (!given) { tone = 'info'; line = 'Pas de réponse — lis la correction.'; }
      else if (exact) { tone = 'ok'; line = 'Juste.'; }
      else if (score === 1) { tone = 'ok'; line = 'Tous les mots-clés sont là.'; }
      else if (score === 0.5) { tone = 'warn'; line = 'Presque : ' + matched.length + ' / ' + keywords.length + ' mots-clés.'; }
      else { tone = 'bad'; line = 'Compare avec la réponse attendue.'; }
      haptic();
      slot.replaceChildren(feedbackEl(tone, line));
      const kw = keywords.length ? h('div', { class: 'stack stack--sm' },
        h('span', { class: 'caption' }, 'Mots-clés'),
        h('div', { class: 'kw' }, keywords.map((k) => {
          const on = matched.indexOf(k) >= 0;
          return h('span', { class: ['chip', on && 'is-on'] }, on ? icon('check', { size: 16 }) : null, txt(k));
        }))) : null;
      const answer = h('div', { class: 'explain' },
        h('span', { class: 'caption' }, 'Réponse attendue'),
        h('div', { class: 'qz-answer' }, txt(d.answer)),
        Array.isArray(d.accept) && d.accept.length ? h('p', { class: 'secondary muted', style: 'margin-top:6px' }, 'Aussi accepté : ' + d.accept.join(' · ')) : null);
      const grades = ctx.gradeBar({
        score, ms, title: 'Ta réponse était…',
        onGrade: (g) => ctx.finish({ score: gradeToScore(g), grade: g, ms, details: { given: input.value.slice(0, 200), matched: matched.length, keywords: keywords.length, exact } })
      });
      after.replaceChildren(answer, kw, explainEl('Explication', d.explanation), srcEl(d.src), grades);
      after.hidden = false;
      scrollIntoView(slot);
    }

    ctx.action.set({ label: 'Valider', onClick: validate, hint: 'Entrée pour valider' });
    return el;
  }

  /* ------------------------------------------------------------------ */
  /* Question ouverte (grille de correction)                              */
  /* ------------------------------------------------------------------ */

  function renderOpen(card, ctx) {
    const d = ctx.data;
    const rubric = Array.isArray(d.rubric) ? d.rubric : [];
    const total = rubric.reduce((t, r) => t + (Number(r.weight) || 1), 0) || 1;
    let compared = false;
    const ta = h('textarea', {
      class: 'input', rows: '6', placeholder: 'Rédige ta réponse en quelques lignes…', 'aria-label': 'Ta réponse', autofocus: true,
      on: { keydown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); compare(); } } }
    });
    const after = h('div', { class: 'stack', hidden: true });
    const el = h('div', { class: 'stack' },
      h('div', { class: 'card qz-card' }, h('span', { class: 'caption' }, 'Question ouverte'), md(d.prompt, 'qz-stem')),
      h('div', { class: 'field' }, ta, h('span', { class: 'field__hint' }, 'Puis compare avec la réponse modèle et coche les points que tu as cités.')),
      after);

    function compare() {
      if (compared) return;
      compared = true;
      const ms = ctx.elapsed();
      ta.readOnly = true;
      haptic();
      const ticked = new Set();
      const scoreLine = h('div', { class: 'qz-rubric-score' }, h('span', 'Points cités'), h('span', { class: 'num' }, '0 / ' + total));
      const grades = ctx.gradeBar({
        score: 0, ms, title: 'Ta réponse était…',
        onGrade: (g) => ctx.finish({ score: ratio(), grade: g, ms, details: { ticked: Array.from(ticked), total, length: ta.value.length } })
      });
      const ratio = () => rubric.reduce((t, r, i) => t + (ticked.has(i) ? (Number(r.weight) || 1) : 0), 0) / total;
      const refresh = () => {
        const pts = Math.round(ratio() * total * 10) / 10;
        scoreLine.lastChild.textContent = String(pts).replace('.', ',') + ' / ' + total + ' (' + Math.round(ratio() * 100) + ' %)';
        if (grades.setScore) grades.setScore(ratio());
      };
      const items = rubric.map((r, i) => {
        const cb = h('input', { type: 'checkbox', 'aria-label': txt(r.point) });
        const lab = h('label', { class: 'rubric__item' }, cb,
          h('span', { class: 'rubric__text' }, txt(r.point)),
          h('span', { class: 'pill pill--outline rubric__weight' }, (Number(r.weight) || 1) + ' pt' + ((Number(r.weight) || 1) > 1 ? 's' : '')));
        cb.addEventListener('change', () => { if (cb.checked) ticked.add(i); else ticked.delete(i); lab.classList.toggle('is-on', cb.checked); refresh(); });
        return lab;
      });
      after.replaceChildren(
        explainEl('Réponse modèle', d.model),
        rubric.length ? h('div', { class: 'stack stack--sm' }, h('span', { class: 'caption' }, 'Grille : coche ce que tu as cité'), h('div', { class: 'rubric' }, items), scoreLine) : null,
        srcEl(d.src), grades);
      after.hidden = false;
      scrollIntoView(after);
    }

    ctx.action.set({ label: 'Comparer', onClick: compare, hint: 'Ctrl + Entrée pour comparer' });
    return el;
  }

  /* ------------------------------------------------------------------ */
  /* KFP                                                                  */
  /* ------------------------------------------------------------------ */

  function renderKfp(card, ctx) {
    const d = ctx.data;
    const qs = Array.isArray(d.questions) ? d.questions : [];
    const scores = [];
    let qi = 0;
    const count = h('div', { class: 'qz-count' });
    const qHost = h('div', { class: 'stack' });
    const el = h('div', { class: 'stack' },
      h('div', { class: 'card qz-card' }, h('span', { class: 'caption' }, 'KFP · Scénario'), md(d.scenario, 'qz-scenario')),
      count, qHost);

    function finishAll() {
      const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      const ms = ctx.elapsed();
      count.textContent = 'Score global : ' + Math.round(mean * 100) + ' %';
      const grades = ctx.gradeBar({ score: mean, ms, onGrade: (g) => ctx.finish({ score: mean, grade: g, ms, details: { perQuestion: scores.slice(), difficulty: d.difficulty } }) });
      qHost.appendChild(h('div', { class: 'stack' }, srcEl(d.src), grades));
      scrollIntoView(grades);
    }

    function showQuestion() {
      if (qi >= qs.length) { finishAll(); return; }
      const q = qs[qi] || {};
      const max = Math.max(1, Number(q.max) || 1);
      const options = Array.isArray(q.options) ? q.options : [];
      const correct = new Set(Array.isArray(q.correct) ? q.correct : []);
      const selected = new Set();
      let validated = false;
      count.textContent = 'Question ' + (qi + 1) + ' / ' + qs.length;
      const rows = options.map((t, i) => optRow(i, t, () => toggle(i)));
      const slot = h('div', { class: 'qz-slot', 'aria-live': 'polite' });
      const block = h('div', { class: 'stack' },
        h('div', { class: 'card qz-card' }, h('div', { class: 'qz-kfp-q' }, txt(q.stem)), h('p', { class: 'secondary muted', style: 'margin-top:6px' }, 'Choisis jusqu’à ' + plural(max, 'réponse') + '.')),
        h('div', { class: 'opts', role: 'group' }, rows.map((r) => r.btn)),
        slot);
      qHost.replaceChildren(block);
      const hintIdle = 'Jusqu’à ' + plural(max, 'réponse');

      function toggle(i) {
        if (validated) return;
        if (selected.has(i)) selected.delete(i);
        else if (selected.size >= max) { ctx.action.hint('Maximum ' + plural(max, 'réponse') + ' : décoche d’abord une proposition.'); return; }
        else selected.add(i);
        rows.forEach((r, j) => { const on = selected.has(j); r.btn.classList.toggle('is-selected', on); r.btn.setAttribute('aria-pressed', on ? 'true' : 'false'); });
        ctx.action.enable(selected.size > 0);
        ctx.action.hint(selected.size ? selected.size + ' / ' + max : hintIdle);
      }
      function validate() {
        if (validated || !selected.size) return;
        validated = true;
        let good = 0, wrong = 0;
        rows.forEach((r, i) => {
          const sel = selected.has(i), ok = correct.has(i);
          if (sel && ok) good++; else if (sel && !ok) wrong++;
          markRow(r, sel, ok, null);
        });
        const score = Math.max(0, good / max - wrong / max);
        scores.push(score);
        haptic();
        const tone = score >= 0.99 ? 'ok' : score > 0 ? 'warn' : 'bad';
        const line = score >= 0.99 ? 'Juste.' : score > 0 ? 'Presque : ' + good + ' / ' + max + (wrong ? ', ' + plural(wrong, 'erreur') : '') + '.' : 'Faux — regarde pourquoi.';
        slot.replaceChildren(feedbackEl(tone, line, fmtScore(score)));
        block.appendChild(explainEl('Explication', q.explanation));
        const last = qi + 1 >= qs.length;
        ctx.action.set({ label: last ? 'Terminer' : 'Question suivante', onClick: () => { qi++; showQuestion(); } });
        scrollIntoView(slot);
      }
      ctx.action.set({ label: 'Valider', disabled: true, hint: hintIdle, onClick: validate });
      ctx.setKeys((e) => {
        if (validated) return false;
        const i = numberKey(e, rows.length);
        if (i >= 0) { toggle(i); return true; }
        return false;
      });
      if (qi > 0) scrollIntoView(count);
    }

    if (!qs.length) {
      qHost.appendChild(h('p', { class: 'empty' }, 'Ce KFP n’a pas de questions.'));
      ctx.action.set({ label: 'Passer', tone: 'secondary', onClick: ctx.skip });
    } else showQuestion();
    return el;
  }

  /* ------------------------------------------------------------------ */
  /* TCS                                                                  */
  /* ------------------------------------------------------------------ */

  function renderTcs(card, ctx) {
    const d = ctx.data;
    const items = Array.isArray(d.items) ? d.items : [];
    const scores = [];
    let ii = 0;
    const count = h('div', { class: 'qz-count' });
    const host = h('div', { class: 'stack' });
    const el = h('div', { class: 'stack' },
      h('div', { class: 'card qz-card' }, h('span', { class: 'caption' }, 'TCS · Vignette'), md(d.vignette, 'qz-scenario')),
      count, host);

    function finishAll() {
      const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      const ms = ctx.elapsed();
      count.textContent = 'Concordance globale : ' + Math.round(mean * 100) + ' %';
      const grades = ctx.gradeBar({ score: mean, ms, onGrade: (g) => ctx.finish({ score: mean, grade: g, ms, details: { perItem: scores.slice(), difficulty: d.difficulty } }) });
      host.appendChild(h('div', { class: 'stack' }, srcEl(d.src), grades));
      scrollIntoView(grades);
    }

    function showItem() {
      if (ii >= items.length) { finishAll(); return; }
      const it = items[ii] || {};
      const panel = Array.isArray(it.panel) && it.panel.length === 5 ? it.panel.map((n) => Math.max(0, Number(n) || 0)) : [0, 0, 0, 0, 0];
      const maxP = Math.max.apply(null, panel) || 1;
      let choice = null, validated = false;
      count.textContent = 'Situation ' + (ii + 1) + ' / ' + items.length;
      const buttons = TCS_SCALE.map((s, k) => h('button', {
        type: 'button', class: 'btn', 'aria-pressed': 'false', dataset: { k },
        on: { click: () => select(k) }
      }, h('strong', (s.v > 0 ? '+' : '') + s.v), h('span', s.label)));
      const scale = h('div', { class: 'tcs-scale', role: 'group', 'aria-label': 'Impact de la nouvelle information' }, buttons);
      const slot = h('div', { class: 'qz-slot', 'aria-live': 'polite' });
      const block = h('div', { class: 'stack' },
        h('div', { class: 'card qz-card tcs-case' },
          h('div', { class: 'tcs-case__row' }, h('span', { class: 'caption' }, 'Si tu pensais à'), h('strong', txt(it.hypothesis))),
          h('div', { class: 'tcs-case__row' }, h('span', { class: 'caption' }, 'Et que tu apprends'), h('strong', txt(it.newInfo))),
          h('p', { class: 'secondary', style: 'margin:4px 0 0' }, 'Cette hypothèse devient…')),
        scale, slot);
      host.replaceChildren(block);

      function select(k) {
        if (validated) return;
        choice = k;
        buttons.forEach((b, j) => { b.classList.toggle('is-on', j === k); b.setAttribute('aria-pressed', j === k ? 'true' : 'false'); });
        ctx.action.enable(true);
        ctx.action.hint('');
      }
      function validate() {
        if (validated || choice == null) return;
        validated = true;
        buttons.forEach((b) => { b.disabled = true; });
        const score = panel[choice] / maxP;
        scores.push(score);
        haptic();
        const peak = panel.indexOf(maxP);
        const bars = h('div', { class: 'tcs-bars', role: 'img', 'aria-label': 'Réponses du panel : ' + panel.map((n, k) => (TCS_SCALE[k].v > 0 ? '+' : '') + TCS_SCALE[k].v + ' : ' + n).join(', ') },
          panel.map((n, k) => {
            const col = h('div', { class: 'tcs-bar__col', style: 'height:4%' });
            const bar = h('div', { class: ['tcs-bar', k === peak && 'is-peak', k === choice && 'is-pick'] },
              h('span', { class: 'tcs-bar__n' }, String(n)), col, h('span', (TCS_SCALE[k].v > 0 ? '+' : '') + TCS_SCALE[k].v));
            requestAnimationFrame(() => { col.style.height = Math.max(4, Math.round((n / maxP) * 100)) + '%'; });
            return bar;
          }));
        const tone = score >= 0.99 ? 'ok' : score >= 0.5 ? 'warn' : 'bad';
        const line = score >= 0.99 ? 'Comme la majorité du panel.' : score >= 0.5 ? 'Proche du panel.' : 'Loin du panel — regarde pourquoi.';
        slot.replaceChildren(feedbackEl(tone, line, panel[choice] + ' / ' + maxP + ' → ' + fmtScore(score)));
        block.appendChild(h('div', { class: 'card qz-card' }, h('span', { class: 'caption' }, 'Panel d’experts (' + panel.reduce((a, b) => a + b, 0) + ' réponses)'), bars));
        block.appendChild(explainEl('Explication', it.explanation));
        const last = ii + 1 >= items.length;
        ctx.action.set({ label: last ? 'Terminer' : 'Situation suivante', onClick: () => { ii++; showItem(); } });
        scrollIntoView(slot);
      }
      ctx.action.set({ label: 'Valider', disabled: true, hint: 'Choisis un niveau de −2 à +2', onClick: validate });
      ctx.setKeys((e) => {
        if (validated) return false;
        const i = numberKey(e, 5);
        if (i >= 0) { select(i); return true; }
        return false;
      });
      if (ii > 0) scrollIntoView(count);
    }

    if (!items.length) {
      host.appendChild(h('p', { class: 'empty' }, 'Ce TCS n’a pas de situations.'));
      ctx.action.set({ label: 'Passer', tone: 'secondary', onClick: ctx.skip });
    } else showItem();
    return el;
  }

  /* ------------------------------------------------------------------ */
  /* Flashcards (essentiels, chiffres, mnémos)                            */
  /* ------------------------------------------------------------------ */

  function flashKind(id) {
    const seg = txt(id).split('-')[1];
    return seg === 'num' ? 'num' : seg === 'mn' ? 'mn' : 'ess';
  }
  function objectiveTitle(card) {
    const reg = RG();
    if (!card.objective || !reg || typeof reg.objective !== 'function') return null;
    try { const o = reg.objective(card.item, card.objective); return o && o.title ? o.title : null; } catch (e) { return null; }
  }

  function renderFlash(card, ctx) {
    const d = ctx.data;
    const fk = flashKind(card.id);
    let flipped = false;
    const hint = h('span', { class: 'flash__hint' }, icon('eye', { size: 18 }), 'Touche la carte ou appuie sur Entrée pour révéler');
    let front, back;
    if (fk === 'num') {
      front = h('div', { class: 'flash__face' }, h('span', { class: 'caption' }, 'Chiffre clé · ' + itemShort(card.item)), h('div', { class: 'flash__label' }, txt(d.label)), hint);
      back = h('div', { class: 'flash__face' }, h('span', { class: 'caption' }, 'Chiffre clé · ' + itemShort(card.item)), h('div', { class: 'flash__label muted' }, txt(d.label)), h('div', { class: 'flash__value' }, txt(d.value)), srcEl(d.src));
    } else if (fk === 'mn') {
      front = h('div', { class: 'flash__face' }, h('span', { class: 'caption' }, 'Mnémo · ' + itemShort(card.item)), h('div', { class: 'flash__label' }, txt(d.title)), h('p', { class: 'muted' }, 'Quel moyen mnémotechnique, et que recouvre-t-il ?'), hint);
      back = h('div', { class: 'flash__face' }, h('span', { class: 'caption' }, 'Mnémo · ' + itemShort(card.item)), h('div', { class: 'flash__label muted' }, txt(d.title)), h('div', { class: 'mnemo__key' }, txt(d.mnemonic)), md(d.expansion), srcEl(d.src));
    } else {
      const words = stripMd(d.text).split(' ');
      const cue = words.slice(0, Math.min(5, Math.max(2, Math.floor(words.length / 3)))).join(' ') + (words.length > 5 ? '…' : '');
      const obj = objectiveTitle(card);
      front = h('div', { class: 'flash__face' }, h('span', { class: 'caption' }, 'L’essentiel · ' + itemShort(card.item)),
        obj ? h('div', { class: 'secondary muted' }, obj) : null,
        h('div', { class: 'flash__text' }, cue), h('p', { class: 'muted' }, 'Complète ce point clé de tête.'), hint);
      back = h('div', { class: 'flash__face' }, h('span', { class: 'caption' }, 'L’essentiel · ' + itemShort(card.item)), md(d.text, 'flash__text'), srcEl(d.src));
    }
    const face = h('div', {}, front);
    const cardBtn = h('button', { type: 'button', class: 'flash card card--raised', 'aria-expanded': 'false', on: { click: flip } }, face);
    const after = h('div', { class: 'stack', hidden: true });
    const el = h('div', { class: 'stack' }, cardBtn, after);

    function flip() {
      if (flipped) return;
      flipped = true;
      const ms = ctx.elapsed();
      face.replaceChildren(back);
      cardBtn.classList.add('is-flipped');
      cardBtn.setAttribute('aria-expanded', 'true');
      cardBtn.disabled = true;
      haptic();
      const grades = ctx.gradeBar({ score: null, ms, suggested: 3, title: 'Tu le savais ?', onGrade: (g) => ctx.finish({ score: gradeToScore(g), grade: g, ms, details: { flash: fk } }) });
      after.replaceChildren(grades);
      after.hidden = false;
    }
    ctx.action.set({ label: 'Retourner', onClick: flip, hint: 'Réfléchis, puis retourne la carte' });
    ctx.setKeys((e) => { if (!flipped && e.key === ' ') { flip(); return true; } return false; });
    return el;
  }

  /* ------------------------------------------------------------------ */
  /* Arbre décisionnel                                                    */
  /* ------------------------------------------------------------------ */

  function renderTree(card, ctx) {
    const tree = ctx.data;
    const trees = C.views.trees;
    const head = h('div', { class: 'card qz-card' }, h('span', { class: 'caption' }, 'Arbre décisionnel'), h('h3', { style: 'margin:0' }, txt(tree.title)), tree.intro ? md(tree.intro) : null);
    const after = h('div', { class: 'stack', hidden: true });
    let completed = false;
    function complete() {
      if (completed) return;
      completed = true;
      const ms = ctx.elapsed();
      haptic();
      const grades = ctx.gradeBar({ score: 1, ms, suggested: 3, title: 'Tu connaissais cet arbre ?', onGrade: (g) => ctx.finish({ score: gradeToScore(g), grade: g, ms }) });
      after.replaceChildren(srcEl(tree.src), grades);
      after.hidden = false;
      scrollIntoView(after);
    }
    if (trees && typeof trees.renderWalkthrough === 'function') {
      let body;
      try { body = trees.renderWalkthrough(tree, { record: false, item: card.item, onComplete: complete }); }
      catch (e) { console.error('[quiz] renderWalkthrough a échoué', e); body = null; }
      if (body) {
        ctx.action.set({ label: null, hint: 'Parcours l’arbre jusqu’à une conclusion' });
        return h('div', { class: 'stack' }, head, body, after);
      }
    } else warnOnce('trees', 'CARDIO.views.trees.renderWalkthrough indisponible : plan de l’arbre affiché.');
    // Repli : plan (outline) + « Vu »
    let outline = null;
    if (trees && typeof trees.renderOutline === 'function') { try { outline = trees.renderOutline(tree); } catch (e) { outline = null; } }
    if (!outline) {
      const nodes = tree.nodes || {};
      outline = h('ul', { class: 'tree' }, Object.keys(nodes).map((k) => {
        const n = nodes[k] || {};
        return h('li', {}, h('span', { class: n.type === 'end' ? 'tree__end tree__end--' + (n.tone || 'info') : n.type === 'action' ? 'tree__action' : 'tree__q' }, stripMd(n.text)),
          Array.isArray(n.options) ? h('div', { class: 'qz-inline-list', style: 'margin-top:4px' }, n.options.map((o) => h('span', { class: 'tree__opt' }, txt(o.label)))) : null);
      }));
    }
    ctx.action.set({ label: 'Vu', onClick: complete, hint: 'Relis l’arbre puis confirme' });
    return h('div', { class: 'stack' }, head, h('div', { class: 'card' }, outline), after);
  }

  /* ------------------------------------------------------------------ */
  /* Traitement (rappel)                                                  */
  /* ------------------------------------------------------------------ */

  function renderTx(card, ctx) {
    const tx = ctx.data;
    const tr = C.views.treatments;
    if (tr && typeof tr.renderRecall === 'function') {
      let body = null;
      try {
        body = tr.renderRecall(tx, { onGrade: (g) => { g = Number(g) || 3; ctx.finish({ score: gradeToScore(g), grade: g, ms: ctx.elapsed() }); } });
      } catch (e) { console.error('[quiz] renderRecall a échoué', e); body = null; }
      if (body) {
        ctx.action.set({ label: null, hint: 'Retrouve les listes de tête, révèle, puis note-toi' });
        return h('div', { class: 'stack' }, body);
      }
    } else warnOnce('tx', 'CARDIO.views.treatments.renderRecall indisponible : rappel simplifié.');
    // Repli : classe → révéler → grades
    const lists = TX_GROUPS.filter(([k]) => Array.isArray(tx[k]) && tx[k].length);
    const hidden = h('div', { class: 'stack stack--sm', hidden: true },
      lists.map(([k, label]) => h('div', { class: 'tx__group tx__group--' + k.slice(0, 3) }, h('span', { class: 'tx__label' }, label), h('ul', {}, tx[k].map((x) => h('li', {}, txt(x)))))),
      srcEl(tx.src));
    const after = h('div', { class: 'stack', hidden: true });
    let revealed = false;
    function reveal() {
      if (revealed) return;
      revealed = true;
      const ms = ctx.elapsed();
      hidden.hidden = false;
      haptic();
      const grades = ctx.gradeBar({ score: null, ms, suggested: 3, title: 'Tu avais tout ?', onGrade: (g) => ctx.finish({ score: gradeToScore(g), grade: g, ms }) });
      after.replaceChildren(grades);
      after.hidden = false;
      scrollIntoView(hidden);
    }
    ctx.action.set({ label: 'Révéler', onClick: reveal, hint: lists.length ? 'Retrouve : ' + lists.map((l) => l[1].toLowerCase()).join(', ') : '' });
    return h('div', { class: 'stack' },
      h('div', { class: 'tx' },
        h('div', { class: 'tx__head' }, h('h3', { class: 'tx__class' }, txt(tx.class)), rankPill(tx.rank)),
        Array.isArray(tx.molecules) && tx.molecules.length ? h('div', { class: 'tx__mol' }, tx.molecules.join(' · ')) : null,
        tx.context ? h('div', { class: 'tx__ctx' }, txt(tx.context)) : null,
        hidden),
      after);
  }

  /* ------------------------------------------------------------------ */
  /* Dossier progressif                                                   */
  /* ------------------------------------------------------------------ */

  function renderCase(card, ctx) {
    const cs = C.views.cases;
    if (cs && typeof cs.runInline === 'function') {
      let body = null;
      try {
        body = cs.runInline(ctx.data, {
          record: false, item: card.item,
          onComplete: (score, details) => {
            const ms = details && Number.isFinite(details.ms) ? details.ms : ctx.elapsed();
            ctx.finish({ score: clamp01(score), ms, details: details && details.steps ? { steps: details.steps } : undefined, advance: false });
          }
        });
      } catch (e) { console.error('[quiz] runInline a échoué', e); body = null; }
      if (body) {
        ctx.action.set({ label: null, hint: 'Dossier progressif : réponds étape par étape' });
        return h('div', { class: 'stack' }, body);
      }
    } else warnOnce('cases', 'CARDIO.views.cases.runInline indisponible : dossier ignoré.');
    ctx.action.set({ label: 'Passer', tone: 'secondary', onClick: ctx.skip });
    return h('div', { class: 'card empty' },
      h('div', { class: 'empty__icon', html: U().icon('case', { size: 40 }) }),
      h('p', { class: 'empty__title' }, txt(ctx.data.title) || 'Dossier progressif'),
      h('p', 'Le lecteur de dossiers n’est pas disponible dans cette séance. Passe à la carte suivante.'));
  }

  /* ------------------------------------------------------------------ */
  /* ECG / Écho (moteurs dédiés, repli quiz simple)                       */
  /* ------------------------------------------------------------------ */

  function onGradeFromEngine(ctx) {
    return (grade, score, extra) => {
      const g = Number(grade) || 0;
      const sc = score != null && Number.isFinite(Number(score)) ? clamp01(score) : (g ? gradeToScore(g) : undefined);
      ctx.finish({ score: sc, grade: g >= 1 && g <= 4 ? g : undefined, ms: ctx.elapsed(), details: extra && typeof extra === 'object' ? { correct: extra.correct } : undefined });
    };
  }

  function simpleQuiz(card, ctx, opts) {
    const entry = ctx.data;
    const quiz = entry.quiz && Array.isArray(entry.quiz.options) ? entry.quiz : null;
    const revealEl = opts.reveal || h('div');
    const head = h('div', { class: 'card qz-card' }, h('span', { class: 'caption' }, opts.caption), h('h3', { style: 'margin:0' }, txt(entry.title)));
    const slot = h('div', { class: 'qz-slot', 'aria-live': 'polite' });
    const after = h('div', { class: 'stack', hidden: true });
    let validated = false;
    if (!quiz) {
      revealEl.hidden = true;
      ctx.action.set({ label: 'Voir la réponse', onClick: () => {
        if (validated) return;
        validated = true;
        revealEl.hidden = false;
        const ms = ctx.elapsed();
        after.replaceChildren(ctx.gradeBar({ score: null, ms, suggested: 3, title: 'Tu l’avais reconnu ?', onGrade: (g) => ctx.finish({ score: gradeToScore(g), grade: g, ms }) }));
        after.hidden = false;
      } });
      return h('div', { class: 'stack' }, head, opts.figure || null, revealEl, after);
    }
    let selected = null;
    const rows = quiz.options.map((t, i) => optRow(i, t, () => select(i)));
    function select(i) {
      if (validated) return;
      selected = selected === i ? null : i;
      rows.forEach((r, j) => { const on = selected === j; r.btn.classList.toggle('is-selected', on); r.btn.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      ctx.action.enable(selected != null);
    }
    function validate() {
      if (validated || selected == null) return;
      validated = true;
      const ms = ctx.elapsed();
      const correct = Number(quiz.correct);
      rows.forEach((r, i) => markRow(r, selected === i, i === correct, null));
      const score = selected === correct ? 1 : 0;
      haptic();
      slot.replaceChildren(feedbackEl(score ? 'ok' : 'bad', score ? 'Juste.' : 'Faux — regarde pourquoi.', score ? 'Juste → 1' : 'Faux → 0'));
      revealEl.hidden = false;
      after.replaceChildren(revealEl, ctx.gradeBar({ score, ms, onGrade: (g) => ctx.finish({ score, grade: g, ms, details: { selected, correct } }) }));
      after.hidden = false;
      scrollIntoView(slot);
    }
    ctx.action.set({ label: 'Valider', disabled: true, hint: 'Choisis une réponse', onClick: validate });
    ctx.setKeys((e) => { if (validated) return false; const i = numberKey(e, rows.length); if (i >= 0) { select(i); return true; } return false; });
    return h('div', { class: 'stack' }, head, opts.figure || null,
      h('div', { class: 'card qz-card' }, md(quiz.stem || 'Quel est le diagnostic ?', 'qz-stem')),
      h('div', { class: 'opts', role: 'group' }, rows.map((r) => r.btn)), slot, after);
  }

  function listCard(caption, items) {
    if (!Array.isArray(items) || !items.length) return null;
    return h('div', { class: 'card' }, h('span', { class: 'caption', style: 'display:block;margin-bottom:6px' }, caption), h('ul', { class: 'kp' }, items.map((x) => h('li', {}, txt(x)))));
  }

  function renderEcg(card, ctx) {
    const api = (C.ecg && typeof C.ecg.renderQuiz === 'function') ? C.ecg
      : (C.views.ecg && typeof C.views.ecg.renderQuiz === 'function') ? C.views.ecg : null;
    if (api) {
      let body = null;
      try { body = api.renderQuiz(ctx.data, { onGrade: onGradeFromEngine(ctx), item: card.item, record: false }); }
      catch (e) { console.error('[quiz] ecg.renderQuiz a échoué', e); body = null; }
      if (body) { ctx.action.set({ label: null, hint: 'Lis le tracé, réponds, puis note-toi' }); return h('div', { class: 'stack' }, body); }
    } else warnOnce('ecg', 'CARDIO.ecg.renderQuiz indisponible : quiz ECG simplifié (sans tracé).');
    const d = ctx.data;
    const reveal = h('div', { class: 'stack' },
      d.diagnosis ? h('div', { class: 'explain' }, h('span', { class: 'caption' }, 'Diagnostic'), h('div', { class: 'qz-answer' }, txt(d.diagnosis))) : null,
      listCard('Éléments du tracé', d.findings), explainEl('Enseignement', d.teaching), srcEl(d.src));
    return simpleQuiz(card, ctx, { caption: 'ECG', reveal, figure: h('div', { class: 'callout' }, h('p', { class: 'secondary', style: 'margin:0' }, 'Le tracé synthétisé n’est pas disponible ici : réponds d’après le titre et tes connaissances, puis vérifie.')) });
  }

  function renderEcho(card, ctx) {
    const api = C.views.echo && typeof C.views.echo.renderQuiz === 'function' ? C.views.echo : null;
    if (api) {
      let body = null;
      try { body = api.renderQuiz(ctx.data, { onGrade: onGradeFromEngine(ctx), item: card.item, record: false }); }
      catch (e) { console.error('[quiz] echo.renderQuiz a échoué', e); body = null; }
      if (body) { ctx.action.set({ label: null, hint: 'Analyse la coupe, réponds, puis note-toi' }); return h('div', { class: 'stack' }, body); }
    } else warnOnce('echo', 'CARDIO.views.echo.renderQuiz indisponible : quiz écho simplifié.');
    const d = ctx.data;
    const measures = Array.isArray(d.measures) && d.measures.length
      ? h('div', { class: 'card' }, h('span', { class: 'caption', style: 'display:block;margin-bottom:6px' }, 'Seuils de sévérité'),
        h('div', { class: 'numbers' }, d.measures.map((m) => h('div', { class: 'number' }, h('span', { class: 'number__label' }, txt(m.label)), m.rank ? rankPill(m.rank) : null, h('span', { class: 'number__value' }, txt(m.severe))))))
      : null;
    const reveal = h('div', { class: 'stack' }, listCard('Ce que l’on voit', d.findings), measures, explainEl('Description', d.description), srcEl(d.src));
    return simpleQuiz(card, ctx, { caption: 'Échocardiographie', reveal });
  }

  /* ------------------------------------------------------------------ */
  /* Cartes inconnues / cassées                                           */
  /* ------------------------------------------------------------------ */

  function renderUnknown(card, ctx) {
    warnOnce('kind-' + card.kind, 'Type de carte non pris en charge : ' + card.kind);
    ctx.action.set({ label: 'Passer', tone: 'secondary', onClick: ctx.skip });
    return h('div', { class: 'card empty' },
      h('div', { class: 'empty__icon', html: U().icon('info', { size: 40 }) }),
      h('p', { class: 'empty__title' }, 'Type de carte non pris en charge'),
      h('p', 'Cette carte (' + txt(card.kind) + ') sera disponible dans une prochaine version.'));
  }
  function renderBroken(card, ctx) {
    ctx.action.set({ label: 'Passer', tone: 'secondary', onClick: ctx.skip });
    return h('div', { class: 'card empty' },
      h('div', { class: 'empty__icon', html: U().icon('warning', { size: 40 }) }),
      h('p', { class: 'empty__title' }, 'Carte illisible'),
      h('p', 'Impossible d’afficher cette carte (' + txt(card.id) + '). Passe à la suivante.'));
  }

  const RENDERERS = {
    qcm: renderQcm, qroc: renderQroc, open: renderOpen, kfp: renderKfp, tcs: renderTcs,
    flash: renderFlash, tree: renderTree, tx: renderTx, case: renderCase, ecg: renderEcg, echo: renderEcho
  };

  /* ------------------------------------------------------------------ */
  /* Badges                                                               */
  /* ------------------------------------------------------------------ */

  function showBadges(list) {
    const sh = SH();
    if (!sh || typeof sh.sheet !== 'function' || !Array.isArray(list) || !list.length) return;
    let ref = null;
    const body = h('div', { class: 'stack' },
      h('div', { class: 'qz-badges' }, list.map((id) => h('div', { class: 'qz-badge' }, icon('trophy', { size: 24 }), h('span', badgeLabel(id))))),
      h('p', { class: 'secondary muted' }, list.length > 1 ? 'Ils comptent déjà dans tes stats.' : 'Il compte déjà dans tes stats.'),
      h('button', { type: 'button', class: 'btn btn--primary btn--block', autofocus: true, on: { click: () => { if (ref) ref.close(true); } } }, 'Continuer')
    );
    ref = sh.sheet(body, { title: list.length > 1 ? 'Nouveaux badges' : 'Nouveau badge' });
  }

  /* ------------------------------------------------------------------ */
  /* Résultats                                                            */
  /* ------------------------------------------------------------------ */

  function summarize(rt) {
    const res = rt.results || [];
    const done = res.length;
    const scored = res.filter((r) => r.score != null);
    const score = scored.length ? scored.reduce((t, r) => t + clamp01(r.score), 0) / scored.length : null;
    const xp = res.reduce((t, r) => t + (Number(r.xp) || 0), 0);
    const ms = res.reduce((t, r) => t + (Number(r.ms) || 0), 0);
    return { done, score, xp, ms, correct: res.filter((r) => clamp01(r.score) >= 0.99).length };
  }

  function endRuntime(rt) {
    if (rt.ended) return;
    rt.ended = true;
    rt.summary = summarize(rt);
    const st = ST();
    const before = Array.isArray(storeGet('badges', [])) ? storeGet('badges', []).slice() : [];
    if (st && typeof st.endSession === 'function' && !/^local-/.test(rt.id)) {
      try { st.endSession(rt.id, { done: rt.summary.done, score: rt.summary.score, xp: rt.summary.xp, ms: rt.summary.ms }); }
      catch (e) { console.error('[quiz] endSession a échoué', e); }
    }
    const after = Array.isArray(storeGet('badges', [])) ? storeGet('badges', []) : [];
    rt.newBadges = after.filter((b) => before.indexOf(b) < 0);
    const items = Object.keys(rt.masteryBefore || {});
    if (!items.length) rt.results.forEach((r) => { if (r.item && !rt.masteryBefore[r.item]) rt.masteryBefore[r.item] = null; });
    rt.masteryAfter = masterySnapshot(Object.keys(rt.masteryBefore || {}));
    saveRt(rt);
  }

  function showResults(rt) {
    endRuntime(rt);
    const spec = resultsSpec(rt);
    const sh = SH();
    if (sh && typeof sh.mount === 'function') sh.mount(spec.el, spec);
    else { const v = viewEl(); if (v) v.replaceChildren(spec.el); }
    if (rt.newBadges && rt.newBadges.length) setTimeout(() => showBadges(rt.newBadges), 500);
  }

  function countUp(el, to, fmt, ms) {
    ms = ms || 700;
    if (reduced() || !(to > 0)) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    el.classList.add('animate-count');
    const step = (t) => {
      const p = Math.min(1, (t - t0) / ms);
      const v = Math.round(to * (1 - Math.pow(1 - p, 3)));
      el.textContent = fmt(v);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function ringEl(ratio, label) {
    const r = 58, c = 2 * Math.PI * r;
    const fill = h('circle', { class: 'ring__fill', cx: 66, cy: 66, r, 'stroke-dasharray': c.toFixed(1), 'stroke-dashoffset': c.toFixed(1) });
    const value = h('span', { class: 'ring__value' }, '0 %');
    const el = h('div', { class: ['ring', ratio >= 0.8 && 'ring--ok'], role: 'img', 'aria-label': 'Score ' + Math.round(ratio * 100) + ' %' },
      h('svg', { viewBox: '0 0 132 132', 'aria-hidden': 'true' }, h('circle', { class: 'ring__track', cx: 66, cy: 66, r }), fill),
      h('div', { class: 'ring__inner' }, value, h('span', { class: 'ring__sub' }, label || 'score')));
    requestAnimationFrame(() => {
      fill.setAttribute('stroke-dashoffset', (c * (1 - clamp01(ratio))).toFixed(1));
      countUp(value, Math.round(ratio * 100), (v) => v + ' %');
    });
    return el;
  }

  function barRow(label, ratio, value, cls) {
    const fill = h('span', { class: 'bar__fill', style: 'width:0%' });
    const el = h('div', { class: 'bar-row' }, h('span', { class: 'bar-row__label' }, label), h('span', { class: 'bar-row__value' }, value), h('div', { class: ['bar', cls] }, fill));
    requestAnimationFrame(() => { fill.style.width = Math.round(clamp01(ratio) * 100) + '%'; });
    return el;
  }

  function masteryRow(num, before, after) {
    const b = before && Number.isFinite(before.all) ? before.all : null;
    const a = after && Number.isFinite(after.all) ? after.all : null;
    if (a == null) return null;
    const fill = h('span', { class: 'bar__fill', style: 'width:' + (b == null ? 0 : Math.round(b * 100)) + '%' });
    const deltaPts = b == null ? null : Math.round((a - b) * 100);
    const delta = deltaPts == null ? h('span', { class: 'delta delta--flat' }, Math.round(a * 100) + ' %')
      : h('span', { class: ['delta', deltaPts > 0 ? 'delta--up' : deltaPts < 0 ? 'delta--down' : 'delta--flat'] },
        (deltaPts > 0 ? '+' : '') + deltaPts + ' pt' + (Math.abs(deltaPts) > 1 ? 's' : '') + ' → ' + Math.round(a * 100) + ' %');
    const el = h('a', { class: 'mastery-row', href: '#/item/' + num, style: 'color:inherit;text-decoration:none' },
      h('div', { class: 'mastery-row__head' }, h('strong', itemLabel(num)), delta),
      h('div', { class: 'bar bar--sm' }, fill));
    requestAnimationFrame(() => { fill.style.width = Math.round(a * 100) + '%'; });
    return el;
  }

  function resultsSpec(rt) {
    if (!rt.summary) rt.summary = summarize(rt);
    const s = rt.summary;
    const res = rt.results || [];
    const u = U();
    const page = h('div', { class: 'page quiz-results' });
    const stack = h('div', { class: 'stack stack--lg' });
    page.appendChild(stack);

    // Héros
    const xpEl = h('span', { class: 'tile__value num' }, '0');
    const hero = h('div', { class: 'card card--raised results-hero' },
      s.score != null ? ringEl(s.score, 'score') : h('div', { class: 'ring' }, h('div', { class: 'ring__inner' }, h('span', { class: 'ring__value' }, String(s.done)), h('span', { class: 'ring__sub' }, 'cartes'))),
      h('div', { class: 'results-hero__side' },
        h('span', { class: 'caption' }, describeOpts(rt.opts)),
        h('p', { class: 'results-hero__line', style: 'margin:4px 0' }, s.done ? heroLine(s) : 'Aucune carte répondue.'),
        h('p', { class: 'secondary muted', style: 'margin:0' }, plural(s.done, 'carte') + ' · ' + (u && u.fmtDuration ? u.fmtDuration(s.ms) : fmtClock(s.ms)))));
    stack.appendChild(hero);

    // Tuiles
    const tiles = h('div', { class: 'tiles' },
      h('div', { class: 'tile' }, h('span', { class: 'tile__label' }, 'Cartes'), h('span', { class: 'tile__value num' }, String(s.done)),
        h('span', { class: 'tile__sub' }, rt.queue.length > s.done ? 'sur ' + rt.queue.length + ' prévues' : 'séance complète')),
      h('div', { class: 'tile tile--accent' }, h('span', { class: 'tile__label' }, 'XP gagnés'), xpEl, h('span', { class: 'tile__sub' }, levelLine())),
      h('div', { class: 'tile' }, h('span', { class: 'tile__label' }, 'Temps'), h('span', { class: 'tile__value num' }, fmtClock(s.ms)),
        h('span', { class: 'tile__sub' }, s.done ? Math.round(s.ms / s.done / 1000) + ' s par carte' : '—')),
      h('div', { class: ['tile', s.done && s.correct / s.done >= 0.8 && 'tile--ok'] }, h('span', { class: 'tile__label' }, 'Justes'), h('span', { class: 'tile__value num' }, String(s.correct)),
        h('span', { class: 'tile__sub' }, s.done ? Math.round((s.correct / s.done) * 100) + ' % de réponses parfaites' : '—')));
    stack.appendChild(tiles);
    requestAnimationFrame(() => countUp(xpEl, s.xp, (v) => '+' + v));

    // Par type
    const byKind = {};
    res.forEach((r) => { const k = r.kind || 'qcm'; (byKind[k] = byKind[k] || []).push(r); });
    const kinds = Object.keys(byKind);
    if (kinds.length) {
      stack.appendChild(h('div', { class: 'card stack stack--sm' },
        h('span', { class: 'caption' }, 'Par type'),
        kinds.sort((a, b) => byKind[b].length - byKind[a].length).map((k) => {
          const arr = byKind[k];
          const mean = arr.reduce((t, r) => t + clamp01(r.score), 0) / arr.length;
          return barRow(kindLabel(k) + ' · ' + plural(arr.length, 'carte'), mean, Math.round(mean * 100) + ' %', mean >= 0.8 ? 'bar--ok' : mean >= 0.5 ? 'bar--warn' : null);
        })));
    }

    // Maîtrise
    const items = Object.keys(rt.masteryAfter || rt.masteryBefore || {});
    const rows = items.map((n) => masteryRow(n, rt.masteryBefore && rt.masteryBefore[n], rt.masteryAfter && rt.masteryAfter[n])).filter(Boolean);
    if (rows.length) {
      stack.appendChild(h('div', { class: 'card stack' }, h('span', { class: 'caption' }, 'Maîtrise des items'), rows));
    }

    // À revoir
    const missed = res.filter((r) => r.grade === 1 || clamp01(r.score) < 0.5);
    if (missed.length) {
      const list = h('div', { class: 'list qz-missed' }, missed.map((r) => {
        const card = registryCard(r.cardId);
        return h('div', { class: 'row row--static', style: 'cursor:default' },
          h('span', { class: 'row__icon row__icon--warn', html: u.icon(u.kindIcon ? u.kindIcon(r.kind) : 'list', { size: 20 }) }),
          h('div', { class: 'row__main' },
            h('div', { class: 'row__title' }, card ? cardTitle(card) : r.cardId),
            h('div', { class: 'row__sub' }, kindLabel(r.kind) + ' · ' + itemShort(r.item) + ' · ' + fmtScore(r.score))),
          h('div', { class: 'qz-row-actions' },
            h('button', { type: 'button', class: 'btn btn--secondary btn--sm', on: { click: () => startWithQueue([r.cardId], { item: r.item }) } }, 'Revoir')));
      }));
      stack.appendChild(h('div', { class: 'stack stack--sm' },
        h('div', { class: 'section-head' }, h('h3', 'À revoir'), h('button', { type: 'button', class: 'btn btn--ghost btn--sm', on: { click: () => startWithQueue(missed.map((r) => r.cardId), { item: rt.opts.item }) } }, 'Tout revoir (' + missed.length + ')')),
        list));
    }

    // CTA
    const ctas = h('div', { class: 'stack stack--sm' });
    if (rt.opts.mode === 'exam') {
      ctas.appendChild(h('a', { class: 'btn btn--primary btn--block btn--lg', href: reviewUrl(rt.opts, { autostart: true }) }, icon('refresh'), 'Nouvel examen blanc'));
    } else if (rt.opts.mode !== 'single') {
      ctas.appendChild(h('a', { class: 'btn btn--primary btn--block btn--lg', href: reviewUrl(rt.opts, { size: 10, autostart: true }) }, icon('play'), 'Encore 10'));
    }
    ctas.appendChild(h('a', { class: 'btn btn--secondary btn--block', href: '#/' }, 'Retour à l’accueil'));
    if (rt.opts.item) ctas.appendChild(h('a', { class: 'btn btn--ghost btn--block', href: '#/item/' + rt.opts.item }, 'Voir l’item ' + itemShort(rt.opts.item)));
    stack.appendChild(ctas);

    return { el: page, title: 'Résultats', back: rt.opts.item ? '#/item/' + rt.opts.item : '#/review', tab: 'review', session: false };
  }

  function heroLine(s) {
    if (s.score == null) return 'Séance terminée.';
    if (s.score >= 0.9) return 'Excellent. Tu maîtrises.';
    if (s.score >= 0.75) return 'Solide. Encore quelques pièges à lever.';
    if (s.score >= 0.5) return 'Correct. Les explications t’ont montré où creuser.';
    return 'Dur, mais c’est comme ça qu’on progresse. Ces cartes reviendront vite.';
  }
  function levelLine() {
    const st = ST();
    if (!st || typeof st.level !== 'function') return '';
    try {
      const l = st.level();
      return 'Niveau ' + l.n + ' · ' + l.name + ' · ' + Math.round(l.progress * 100) + ' %';
    } catch (e) { return ''; }
  }

  /* ------------------------------------------------------------------ */
  /* Cahier d'erreurs (#/errors)                                          */
  /* ------------------------------------------------------------------ */

  function renderErrors() {
    const u = U(), st = ST(), reg = RG();
    const page = h('div', { class: 'page quiz-errors' });
    const stack = h('div', { class: 'stack stack--lg' });
    page.appendChild(stack);

    function draw() {
      const list = st && typeof st.errorsList === 'function' ? st.errorsList() : [];
      stack.replaceChildren();
      if (!list.length) {
        stack.appendChild(h('div', { class: 'card empty' },
          h('div', { class: 'empty__icon', html: u.icon('check', { size: 40 }) }),
          h('p', { class: 'empty__title' }, 'Aucune erreur dans ton cahier'),
          h('p', 'Les cartes notées « Encore » arrivent ici ; elles en sortent après deux réussites d’affilée.'),
          h('div', { class: 'cluster', style: 'justify-content:center;margin-top:12px' },
            h('a', { class: 'btn btn--primary', href: '#/review' }, icon('play'), 'Lancer une séance'))));
        return;
      }
      const total = list.length;
      stack.appendChild(h('div', { class: 'card' },
        h('div', { class: 'qz-summary' }, h('strong', { class: 'num' }, String(total)), h('span', total > 1 ? 'cartes à reprendre' : 'carte à reprendre')),
        h('p', { class: 'secondary muted', style: 'margin:6px 0 12px' }, 'Les plus fréquentes d’abord. Une carte sort du cahier après deux « Bien » ou « Facile » d’affilée.'),
        h('a', { class: 'btn btn--primary btn--block', href: '#/review?mode=errors&autostart=1' }, icon('refresh'), 'Refaire mes erreurs')));

      const groups = {};
      list.forEach((e) => { const k = e.item || itemOfId(e.cardId) || '?'; (groups[k] = groups[k] || []).push(e); });
      const order = Object.keys(groups).sort((a, b) => groups[b].reduce((t, e) => t + e.count, 0) - groups[a].reduce((t, e) => t + e.count, 0));
      order.forEach((num) => {
        const entries = groups[num];
        const rows = entries.map((e) => errorRow(e));
        stack.appendChild(h('div', { class: 'stack stack--sm qz-errors-group' },
          h('div', { class: 'section-head' },
            h('h3', {}, h('a', { href: '#/item/' + num, style: 'color:inherit;text-decoration:none' }, itemLabel(num))),
            h('button', { type: 'button', class: 'btn btn--ghost btn--sm', on: { click: () => startWithQueue(entries.map((e) => e.cardId), { item: num }) } }, 'Revoir (' + entries.length + ')')),
          h('div', { class: 'list' }, rows.map((r) => r.el))));
        if (reg && typeof reg.isLoaded === 'function' && reg.isLoaded(num)) rows.forEach((r) => r.fill());
        else if (reg && typeof reg.load === 'function') {
          reg.load(num).then(() => rows.forEach((r) => r.fill()), (err) => rows.forEach((r) => r.fail(err)));
        } else rows.forEach((r) => r.fail());
      });
    }

    function errorRow(e) {
      const title = h('div', { class: 'row__title skeleton', style: 'height:1.1em;width:70%' });
      const when = u.fmtDate ? u.fmtDate(e.ts, { relative: true }) : new Date(e.ts).toLocaleDateString('fr-FR');
      const sub = h('div', { class: 'row__sub' }, kindLabel(e.kind) + ' · ' + (e.count > 1 ? e.count + ' fois' : '1 fois') + ' · ' + when);
      const removeBtn = h('button', { type: 'button', class: 'btn btn--ghost btn--sm btn--icon', 'aria-label': 'Retirer du cahier', title: 'Retirer', html: u.icon('trash', { size: 18 }), on: { click: () => remove(e) } });
      const el = h('div', { class: 'row row--static', style: 'cursor:default;align-items:flex-start' },
        h('span', { class: 'row__icon row__icon--warn', html: u.icon(u.kindIcon ? u.kindIcon(e.kind) : 'list', { size: 20 }) }),
        h('div', { class: 'row__main' }, title, sub),
        h('div', { class: 'qz-row-actions' },
          h('button', { type: 'button', class: 'btn btn--secondary btn--sm', on: { click: () => startWithQueue([e.cardId], { item: e.item }) } }, 'Revoir'),
          removeBtn));
      return {
        el,
        fill() {
          const card = registryCard(e.cardId);
          title.classList.remove('skeleton');
          title.style.cssText = 'font-weight:500;white-space:normal;line-height:1.35';
          title.textContent = card ? cardTitle(card) : 'Carte ' + e.cardId;
          if (card && card.rank) sub.prepend(rankPill(card.rank), ' ');
        },
        fail() {
          title.classList.remove('skeleton');
          title.style.cssText = '';
          title.textContent = 'Carte ' + e.cardId + ' (item indisponible)';
        }
      };
    }

    function remove(e) {
      if (!st || typeof st.update !== 'function') return;
      let saved = null;
      st.update((s) => { saved = s.errors ? s.errors[e.cardId] : null; if (s.errors) delete s.errors[e.cardId]; });
      draw();
      toast('Retirée du cahier', {
        tone: 'info', ms: 4000,
        action: { label: 'Annuler', onClick: () => { if (!saved) return; st.update((s) => { s.errors = s.errors || {}; s.errors[e.cardId] = saved; }); draw(); } }
      });
    }

    draw();
    return { el: page, title: 'Cahier d’erreurs', back: '#/', tab: 'review' };
  }

  /* ------------------------------------------------------------------ */
  /* Export                                                               */
  /* ------------------------------------------------------------------ */

  C.views.quiz = {
    render,
    startWithQueue,
    startFromOpts: (opts, host) => startFromOpts(normOpts(opts), host),
    reviewUrl: (opts, over) => reviewUrl(normOpts(opts), over),
    cardTitle,
    MODES: MODES.map((m) => Object.assign({}, m)),
    KINDS: KINDS.map((k) => k.slice())
  };
})();
