/* CardioR2C — app.js
 * Bootstrap: early theme (no flash), wait for the store, register every route of SPEC §3.5,
 * mount views through CARDIO.shell, hide the splash, flush the store on pagehide, hot-reload
 * snapshot/restore, global error handler. Loaded last.
 */
(function () {
  'use strict';

  const C = (window.CARDIO = window.CARDIO || {});
  C.views = C.views || {};

  const LS_STATE = 'cardio.r2c.v1';
  const LS_THEME = 'cardio.r2c.theme';
  const STORE_TIMEOUT_MS = 8000;
  const VERSION = '1.0.0';

  let nav = 0;                 // navigation sequence, to drop stale async renders
  let lastErrorToast = 0;
  let started = false;

  /* ------------------------------------------------------------------ */
  /* Theme (before anything else, to avoid a light/dark flash)            */
  /* ------------------------------------------------------------------ */

  function applyTheme(theme) {
    const t = theme === 'light' || theme === 'dark' ? theme : 'system';
    if (C.shell && typeof C.shell.applyTheme === 'function') return C.shell.applyTheme(t);
    const root = document.documentElement;
    if (t === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
    return t;
  }

  function earlyTheme() {
    let theme = null;
    try { theme = localStorage.getItem(LS_THEME); } catch (e) { /* private mode */ }
    if (!theme) {
      try {
        const raw = localStorage.getItem(LS_STATE);
        if (raw) {
          const st = JSON.parse(raw);
          theme = st && st.profile && st.profile.theme;
        }
      } catch (e) { /* corrupt or unavailable: fall back to system */ }
    }
    applyTheme(theme || 'system');
  }

  /* ------------------------------------------------------------------ */
  /* Route table (SPEC §3.5)                                              */
  /* ------------------------------------------------------------------ */

  // pattern, view, tab, default title, back by default, extra params merged into `params`
  const ROUTES = [
    ['#/',                        'home',       'home',     'Accueil',             false, {}],
    ['#/review',                  'quiz',       'review',   'Réviser',             false, { mode: 'review' }],
    ['#/session/:id',             'quiz',       'review',   'Session',             true,  { mode: 'session' }],
    ['#/errors',                  'quiz',       'review',   'Cahier d’erreurs',    true,  { mode: 'errors' }],
    ['#/items',                   'items',      'items',    'Items',               false, {}],
    ['#/item/:num',               'items',      'items',    'Item',                true,  { mode: 'hub' }],
    ['#/item/:num/cours',         'course',     'items',    'Fiche',               true,  { section: 'cours' }],
    ['#/item/:num/mnemos',        'course',     'items',    'Mnémos',              true,  { section: 'mnemos' }],
    ['#/item/:num/qcm',           'quiz',       'items',    'Questions',           true,  { mode: 'item' }],
    ['#/item/:num/arbres',        'trees',      'items',    'Arbres décisionnels', true,  {}],
    ['#/item/:num/traitements',   'treatments', 'items',    'Traitements',         true,  {}],
    ['#/item/:num/cas',           'cases',      'items',    'Cas cliniques',       true,  {}],
    ['#/item/:num/cas/:caseId',   'cases',      'items',    'Cas clinique',        true,  {}],
    ['#/item/:num/ecg',           'ecg',        'items',    'ECG',                 true,  {}],
    ['#/item/:num/echo',          'echo',       'items',    'Échocardiographie',   true,  {}],
    ['#/stats',                   'stats',      'stats',    'Stats',               false, {}],
    ['#/settings',                'settings',   'settings', 'Plus',                false, {}],
    ['#/ecg',                     'ecg',        'items',    'Bibliothèque ECG',    true,  { mode: 'library' }],
    ['#/treatments',              'treatments', 'items',    'Traitements',         true,  { mode: 'library' }],
    ['#/trees',                   'trees',      'items',    'Arbres décisionnels', true,  { mode: 'library' }]
  ];

  function itemShort(num) {
    try {
      const r = C.registry;
      const meta = r && typeof r.item === 'function' ? r.item(num) : null;
      return meta && meta.short ? meta.short : null;
    } catch (e) { return null; }
  }

  function defaultTitle(def, params) {
    if (!params || !params.num) return def.title;
    const short = itemShort(params.num);
    if (def.pattern === '#/item/:num') return short || ('Item ' + params.num);
    return short ? short + ' · ' + def.title : def.title;
  }

  /* ------------------------------------------------------------------ */
  /* Fallback cards                                                       */
  /* ------------------------------------------------------------------ */

  function soonCard(def) {
    const u = C.util;
    if (!u) { const d = document.createElement('div'); d.textContent = 'Cette section arrive bientôt'; return d; }
    return u.h('div', { class: 'stack' },
      u.h('div', { class: 'card soon' },
        u.h('div', { class: 'soon__icon', html: u.icon('clock', { size: 32 }) }),
        u.h('h2', { class: 'soon__title' }, 'Cette section arrive bientôt'),
        u.h('p', { class: 'muted' }, 'On y travaille. Reviens un peu plus tard, ' + (def.title ? '« ' + def.title + ' » ' : '') + 'sera là.'),
        u.h('div', { class: 'cluster' },
          u.h('a', { class: 'btn btn--primary', href: '#/' }, 'Retour à l’accueil'),
          u.h('button', { type: 'button', class: 'btn btn--secondary', on: { click: () => C.router && C.router.back() } }, 'Retour')
        )
      )
    );
  }

  function errorCard(err) {
    const u = C.util;
    if (!u) { const d = document.createElement('div'); d.textContent = 'Une erreur est survenue'; return d; }
    const detail = err && (err.message || String(err));
    return u.h('div', { class: 'stack' },
      u.h('div', { class: 'card soon soon--error' },
        u.h('div', { class: 'soon__icon', html: u.icon('warning', { size: 32 }) }),
        u.h('h2', { class: 'soon__title' }, 'Oups, quelque chose a cassé'),
        u.h('p', { class: 'muted' }, 'Réessaie ; si ça persiste, recharge la page. Tes progrès sont sauvegardés.'),
        detail ? u.h('p', { class: 'caption mono soon__detail' }, detail) : null,
        u.h('div', { class: 'cluster' },
          u.h('button', { type: 'button', class: 'btn btn--primary', on: { click: () => rerender() } }, 'Réessayer'),
          u.h('a', { class: 'btn btn--secondary', href: '#/' }, 'Accueil')
        )
      )
    );
  }

  /* ------------------------------------------------------------------ */
  /* Route handlers                                                       */
  /* ------------------------------------------------------------------ */

  /** Normalize whatever a view returned into a mount spec {el, title, back, actions, session, wide, tab}. */
  function normalizeResult(result, def, params) {
    let spec = {};
    if (result instanceof Node) spec = { el: result };
    else if (result && typeof result === 'object' && result.el instanceof Node) spec = Object.assign({}, result);
    else if (typeof result === 'string' && C.util) spec = { el: C.util.h('div', { class: 'card' }, result) };
    else if (result && typeof result === 'object' && result.el == null && C.util && typeof result.render === 'function') {
      // A view object mistakenly returned: try its render output synchronously if it is a Node
      const out = result.render();
      spec = out instanceof Node ? { el: out } : { el: soonCard(def) };
    } else {
      if (result != null) console.warn('[CARDIO.app] résultat de vue inattendu pour', def.pattern, result);
      spec = { el: soonCard(def) };
    }
    if (spec.title == null || spec.title === '') spec.title = defaultTitle(def, params);
    if (spec.back === undefined) spec.back = def.back;
    if (!Array.isArray(spec.actions)) spec.actions = [];
    spec.session = spec.session || false;
    spec.tab = spec.tab || def.tab;
    return spec;
  }

  function makeHandler(def) {
    return async function handler(params, query, m) {
      const seq = ++nav;
      const shell = C.shell;
      const p = Object.assign({}, params, def.extra, { route: def.pattern, path: m && m.path ? m.path : null });
      const q = query || {};
      if (shell) { shell.setTab(def.tab); shell.loadingSoon(180); }

      let result;
      const view = C.views[def.view];
      if (!view || typeof view.render !== 'function') {
        console.warn('[CARDIO.app] vue manquante :', def.view, '(route ' + def.pattern + ')');
        result = soonCard(def);
      } else {
        try {
          result = await view.render(p, q);
        } catch (e) {
          console.error('[CARDIO.app] erreur de rendu', def.view, e);
          result = errorCard(e);
        }
      }
      if (seq !== nav) return;                 // superseded by a newer navigation
      const spec = normalizeResult(result, def, p);
      if (shell && typeof shell.mount === 'function') {
        shell.mount(spec.el, spec);
      } else {
        const v = document.getElementById('view');
        if (v) v.replaceChildren(spec.el);
      }
      updateDueBadge();
    };
  }

  function registerRoutes() {
    const router = C.router;
    if (!router || typeof router.add !== 'function') {
      console.warn('[CARDIO.app] router manquant : navigation désactivée');
      return false;
    }
    for (const [pattern, view, tab, title, back, extra] of ROUTES) {
      router.add(pattern, makeHandler({ pattern, view, tab, title, back, extra }));
    }
    return true;
  }

  function rerender() {
    if (C.router && typeof C.router.go === 'function') C.router.go(location.hash || '#/', { force: true });
  }

  /** Due-count badge on the "Réviser" tab (best effort, never throws). */
  function updateDueBadge() {
    try {
      const st = C.store, shell = C.shell;
      if (!st || typeof st.dueCards !== 'function' || !shell || typeof shell.setTabBadge !== 'function') return;
      const due = st.dueCards(Date.now());
      shell.setTabBadge('review', Array.isArray(due) ? due.length : 0);
    } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle & errors                                                   */
  /* ------------------------------------------------------------------ */

  function flushStore() {
    try { C.store && typeof C.store.flush === 'function' && C.store.flush(); } catch (e) { console.error(e); }
  }

  function bindLifecycle() {
    window.addEventListener('pagehide', flushStore);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushStore(); });
    window.addEventListener('beforeunload', flushStore);
    // Theme changes requested through the bus (settings view may also call shell.applyTheme directly)
    if (C.util && typeof C.util.on === 'function') {
      C.util.on('theme:set', (t) => applyTheme(t));
      C.util.on('store:change', () => updateDueBadge());
    }
  }

  function reportError(e, origin) {
    console.error('[CardioR2C] ' + origin, e);
    const t = Date.now();
    if (t - lastErrorToast < 3000) return;    // do not spam the user
    lastErrorToast = t;
    try { C.shell && C.shell.toast && C.shell.toast('Une erreur est survenue', { tone: 'bad' }); } catch (e2) { /* ignore */ }
  }

  function bindGlobalErrors() {
    window.addEventListener('error', (ev) => {
      // Resource load errors (e.g. a missing content file) bubble here without an Error object
      if (ev && ev.target && ev.target !== window && (ev.target.tagName === 'SCRIPT' || ev.target.tagName === 'LINK')) {
        console.warn('[CardioR2C] ressource introuvable :', ev.target.src || ev.target.href);
        return;
      }
      reportError(ev.error || ev.message, 'erreur globale');
    }, true);
    window.addEventListener('unhandledrejection', (ev) => reportError(ev.reason, 'promesse rejetée'));
  }

  async function waitStore() {
    const st = C.store;
    if (!st || !st.ready || typeof st.ready.then !== 'function') {
      console.warn('[CARDIO.app] store indisponible : progression non persistée');
      return false;
    }
    let timedOut = false;
    await Promise.race([
      st.ready.catch((e) => { console.error('[CARDIO.app] store.ready a échoué', e); }),
      new Promise((res) => setTimeout(() => { timedOut = true; res(); }, STORE_TIMEOUT_MS))
    ]);
    if (timedOut) console.warn('[CARDIO.app] store.ready trop lent : démarrage sans attendre');
    return !timedOut;
  }

  /* ------------------------------------------------------------------ */
  /* Start                                                                */
  /* ------------------------------------------------------------------ */

  async function start(data) {
    if (started) return;
    started = true;
    data = data && typeof data === 'object' ? data : {};
    earlyTheme();
    bindGlobalErrors();

    // Hot-reload restore: put the previous hash back without firing hashchange
    if (typeof data.hash === 'string' && /^#\//.test(data.hash) && (location.hash || '#/') !== data.hash) {
      try { history.replaceState(history.state, '', location.pathname + location.search + data.hash); }
      catch (e) { location.hash = data.hash; }
    }

    const hasRouter = registerRoutes();
    bindLifecycle();

    // Splash safety net: never stay stuck on the heart
    const splashGuard = setTimeout(() => hideSplash(), STORE_TIMEOUT_MS + 1500);
    await waitStore();
    clearTimeout(splashGuard);

    try {
      const t = C.store && typeof C.store.get === 'function' ? C.store.get('profile.theme') : null;
      if (t) applyTheme(t);
    } catch (e) { /* ignore */ }

    hideSplash();
    if (hasRouter) C.router.start();
    else if (C.shell) C.shell.mount(errorCard(new Error('router manquant')), { title: 'CardioR2C' });
    updateDueBadge();
    try { C.util && C.util.emit('app:ready', { version: VERSION }); } catch (e) { /* ignore */ }
  }

  function hideSplash() {
    if (C.shell && typeof C.shell.hideSplash === 'function') { C.shell.hideSplash(); return; }
    const s = document.getElementById('splash');
    if (s) s.hidden = true;
  }

  C.app = {
    version: VERSION,
    start,
    rerender,
    routes: () => ROUTES.map((r) => r[0]),
    navigate: (hash) => { if (C.router) C.router.go(hash); else location.hash = hash; },
    applyTheme
  };

  /* ---------- boot (hot reload aware) ---------- */
  try {
    if (window.claude && window.claude.hot && typeof window.claude.hot.snapshot === 'function') {
      window.claude.hot.snapshot(() => ({ hash: location.hash }));
    }
  } catch (e) { /* ignore */ }

  const safeStart = (d) => { start(d).catch((e) => { reportError(e, 'démarrage'); hideSplash(); }); };
  const hot = window.claude && window.claude.hot;
  if (hot && typeof hot.ready === 'function') hot.ready(safeStart);
  else safeStart((hot && hot.data) || {});
})();
