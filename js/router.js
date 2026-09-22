/* CardioR2C — router.js
 * CARDIO.router : tiny hash router with ':param' segments.
 *   add(pattern, handler)  pattern like '#/item/:num/cas/:caseId'; handler(params, query)
 *   go(hash, {replace, force}) · replace(hash) · current() → {path, params, query, hash, route}
 *   start() · stop() · back() · parent(path) · match(hash)
 * Unknown routes redirect to '#/'. Handlers may be async; errors are reported, never thrown.
 */
(function () {
  'use strict';

  const C = (window.CARDIO = window.CARDIO || {});

  const routes = [];          // {pattern, path, regex, keys, literals, handler}
  let started = false;
  let notFound = null;        // optional custom handler for unknown routes
  let depth = 0;              // in-app navigations since start (for back())
  let backing = false;        // a history.back() we triggered is in flight
  let lastHash = null;
  let lastMatch = null;       // {route, params, query, path, hash}

  /* ---------- helpers ---------- */

  function normalizeHash(hash) {
    let s = String(hash == null ? '' : hash).trim();
    if (s.startsWith('#')) s = s.slice(1);
    if (!s.startsWith('/')) s = '/' + s;
    return '#' + s;
  }

  /** Split '#/a/b?x=1' → {path:'/a/b', query:{x:'1'}} ; path has no trailing slash (except root). */
  function parse(hash) {
    const full = normalizeHash(hash).slice(1);
    const qi = full.indexOf('?');
    let path = qi >= 0 ? full.slice(0, qi) : full;
    const qstr = qi >= 0 ? full.slice(qi + 1) : '';
    if (path.length > 1) path = path.replace(/\/+$/, '');
    if (!path) path = '/';
    const query = {};
    if (qstr) {
      try {
        new URLSearchParams(qstr).forEach((v, k) => { query[k] = v; });
      } catch (e) { /* malformed query → ignored */ }
    }
    return { path, query };
  }

  function compile(pattern) {
    const { path } = parse(pattern);
    const keys = [];
    let literals = 0;
    const src = path.split('/').filter((seg, i) => i > 0 || seg !== '').map((seg) => {
      if (seg.startsWith(':')) { keys.push(seg.slice(1)); return '([^/]+)'; }
      if (seg === '*') { keys.push('rest'); return '(.*)'; }
      literals += 1;
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    const regex = new RegExp('^/' + src.join('/') + '$');
    return { pattern, path, regex, keys, literals };
  }

  function decode(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }

  /** match(hash) → {route, params, query, path, hash} | null. Most specific (most literal segments) wins. */
  function match(hash) {
    const h = normalizeHash(hash);
    const { path, query } = parse(h);
    let best = null;
    for (const r of routes) {
      const m = r.regex.exec(path);
      if (!m) continue;
      if (!best || r.literals > best.route.literals) {
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decode(m[i + 1]); });
        best = { route: r, params, query, path, hash: h };
      }
    }
    return best;
  }

  /** parent('/item/224/cours') → '#/item/224' ; parent('/item/224') → '#/items' ; root tabs → '#/'. */
  function parent(path) {
    const p = (path || parse(location.hash).path).replace(/\/+$/, '') || '/';
    if (p === '/' ) return '#/';
    const segs = p.split('/').filter(Boolean);
    if (segs[0] === 'item') {
      if (segs.length >= 4) return '#/item/' + segs[1] + '/' + segs[2];   // …/cas/<id> → …/cas
      if (segs.length === 3) return '#/item/' + segs[1];                   // …/cours → hub
      return '#/items';                                                    // hub → list
    }
    if (segs[0] === 'session') return '#/review';
    return '#/';
  }

  /* ---------- dispatch ---------- */

  function dispatch() {
    const hash = location.hash || '#/';
    if (backing) backing = false; else if (lastHash !== null && hash !== lastHash) depth += 1;
    lastHash = hash;

    const m = match(hash);
    if (!m) {
      const { path } = parse(hash);
      if (path === '/' ) {
        // No home route registered yet: nothing to do (app.js registers before start()).
        console.warn('[CARDIO.router] aucune route pour', hash);
        return;
      }
      console.warn('[CARDIO.router] route inconnue', hash, '→ #/');
      if (typeof notFound === 'function') {
        try { notFound(parse(hash)); } catch (e) { console.error(e); }
      } else {
        replace('#/');
        dispatch();
      }
      return;
    }
    lastMatch = m;
    try {
      const out = m.route.handler(m.params, m.query, m);
      if (out && typeof out.then === 'function') {
        out.catch((e) => reportError(e, hash));
      }
    } catch (e) {
      reportError(e, hash);
    }
    try { C.util && C.util.emit && C.util.emit('route', { path: m.path, params: m.params, query: m.query, hash }); } catch (e) { /* ignore */ }
  }

  function reportError(e, hash) {
    console.error('[CARDIO.router] erreur dans la route', hash, e);
    try { C.shell && C.shell.toast && C.shell.toast('Une erreur est survenue', { tone: 'bad' }); } catch (e2) { /* ignore */ }
  }

  /* ---------- API ---------- */

  function add(pattern, handler) {
    if (typeof handler !== 'function') throw new TypeError('router.add: handler must be a function');
    const r = compile(pattern);
    r.handler = handler;
    routes.push(r);
    return router;
  }

  /** go(hash, {replace, force}) — navigate. Same hash + force → re-dispatch (re-render). */
  function go(hash, opts) {
    opts = opts || {};
    const target = normalizeHash(hash);
    const same = (location.hash || '#/') === target;
    if (opts.replace) { replace(target); if (started) dispatch(); return; }
    if (!same) { location.hash = target; return; }   // hashchange → dispatch
    if (opts.force && started) dispatch();            // same hash: re-render only on demand
  }

  function replace(hash) {
    const target = normalizeHash(hash);
    try {
      history.replaceState(history.state, '', location.pathname + location.search + target);
    } catch (e) {
      location.replace(target);
    }
    lastHash = target;
  }

  function current() {
    const hash = location.hash || '#/';
    const m = match(hash);
    const { path, query } = parse(hash);
    return {
      path, query, hash,
      params: m ? m.params : {},
      route: m ? m.route.pattern : null
    };
  }

  /**
   * back() — history.back() when we navigated inside the app, else (or if the browser
   * does not react within 350 ms, e.g. sandboxed iframe) the logical parent route.
   */
  function back(fallback) {
    const before = location.hash || '#/';
    const target = fallback || parent(parse(before).path);
    if (depth > 0 && history.length > 1) {
      depth -= 1;
      backing = true;
      history.back();
      setTimeout(() => {
        if ((location.hash || '#/') === before) { backing = false; go(target); }
      }, 350);
    } else {
      go(target);
    }
  }

  function start() {
    if (started) return router;
    started = true;
    window.addEventListener('hashchange', dispatch);
    if (!location.hash) replace('#/');
    dispatch();
    return router;
  }

  function stop() {
    started = false;
    window.removeEventListener('hashchange', dispatch);
  }

  const router = {
    add, go, replace, current, start, stop, back, parent, match, parse,
    onNotFound(fn) { notFound = fn; return router; },
    routes() { return routes.map((r) => r.pattern); },
    get started() { return started; },
    get depth() { return depth; }
  };
  C.router = router;
})();
