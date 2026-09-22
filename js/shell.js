/* CardioR2C — shell.js
 * CARDIO.shell : app chrome. Header (back / title / actions), tab bar, session mode with the
 * ECG "rhythm strip" progress, toasts, confirm, bottom sheets and modals, theme, document title.
 * Depends on CARDIO.util at runtime (never at load time) and on the markup ids of index.html:
 *   #app #header #rhythm #view #tabbar #overlays #splash
 */
(function () {
  'use strict';

  const C = (window.CARDIO = window.CARDIO || {});
  const THEME_KEY = 'cardio.r2c.theme';
  const TAB_NAMES = ['home', 'review', 'items', 'stats', 'settings'];

  const U = () => C.util;                      // resolved lazily (load-order safe)
  const $ = (id) => document.getElementById(id);

  let bound = false;
  let currentMount = null;                     // {el, opts}
  let backTarget = null;                       // true | string | function
  const overlays = [];                         // stack of {wrap, close}
  let loadingTimer = null;
  let rhythm = null;                           // {svg, track, fill, marker, width, ratio, label}
  let rhythmRatio = 0;

  const reducedMotion = () => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  };
  const isDesktop = () => {
    try { return window.matchMedia('(min-width: 900px)').matches; } catch (e) { return false; }
  };

  /* ------------------------------------------------------------------ */
  /* Binding (once, lazily: the DOM may not exist at load time)           */
  /* ------------------------------------------------------------------ */

  function bind() {
    if (bound) return;
    const app = $('app'), header = $('header'), view = $('view'), tabbar = $('tabbar');
    if (!app || !header || !view) return;
    bound = true;

    // Back button
    const backBtn = header.querySelector('.header__back');
    if (backBtn) backBtn.addEventListener('click', (e) => { e.preventDefault(); doBack(); });

    // Header shadow once the view is scrolled
    let ticking = false;
    view.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        header.classList.toggle('is-scrolled', view.scrollTop > 4);
        ticking = false;
      });
    }, { passive: true });

    // Tab bar: native anchors navigate; tapping the active tab scrolls to top
    if (tabbar) {
      tabbar.addEventListener('click', (e) => {
        const a = e.target.closest('a[data-tab]');
        if (!a) return;
        const href = a.getAttribute('href') || '#/';
        if ((location.hash || '#/') === href) {
          e.preventDefault();
          smoothScrollTop();
        }
      });
    }

    // Escape closes the top-most overlay
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlays.length) {
        e.preventDefault();
        overlays[overlays.length - 1].close(false);
      }
    });

    // Keep the rhythm strip crisp when the width changes
    const rh = $('rhythm');
    if (rh && 'ResizeObserver' in window) {
      new ResizeObserver(() => { if (rhythm && app.classList.contains('is-session')) buildRhythm(true); }).observe(rh);
    } else {
      window.addEventListener('resize', () => { if (rhythm && app.classList.contains('is-session')) buildRhythm(true); });
    }

    // System theme flips → refresh the theme-color meta
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => updateThemeColor());
    } catch (e) { /* old browsers */ }
  }

  function smoothScrollTop() {
    const view = $('view');
    if (!view) return;
    try { view.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch (e) { view.scrollTop = 0; }
  }

  /* ------------------------------------------------------------------ */
  /* Mount                                                                */
  /* ------------------------------------------------------------------ */

  /** Wrap a bare view element in .page unless it already is (or contains) one, or opts.bleed. */
  function wrapPage(el, opts) {
    const u = U();
    if (!(el instanceof Node)) {
      el = u ? u.h('div', { class: 'card' }, String(el == null ? '' : el)) : document.createTextNode(String(el || ''));
    }
    if (opts.bleed) return el;
    if (el instanceof Element) {
      if (el.classList.contains('page') || el.hasAttribute('data-bleed')) {
        if (opts.wide) el.classList.add('page--wide');
        return el;
      }
      if (el.querySelector(':scope > .page')) return el;
    }
    const page = document.createElement('div');
    page.className = 'page' + (opts.wide ? ' page--wide' : '');
    page.appendChild(el);
    return page;
  }

  /**
   * mount(el, {title, back, actions, wide, session, tab, scroll, bleed})
   * Renders `el` into #view (replacing the previous view), scrolls to top, animates in,
   * updates the header and toggles session mode. `session` may be true or {ratio, label}.
   */
  function mount(el, opts) {
    bind();
    opts = opts || {};
    const view = $('view');
    if (!view) { console.warn('[CARDIO.shell] #view introuvable'); return; }
    closeAll();
    setLoading(false);

    const page = wrapPage(el, opts);
    view.replaceChildren(page);
    if (opts.scroll !== 'keep') view.scrollTop = 0;
    $('header') && $('header').classList.remove('is-scrolled');

    if (!reducedMotion()) {
      page.classList.add('view-enter');
      page.addEventListener('animationend', () => page.classList.remove('view-enter'), { once: true });
      // Safety net in case animationend never fires (display:none tab, etc.)
      setTimeout(() => page.classList.remove('view-enter'), 400);
    }

    setHeader(opts);
    setSession(opts.session);
    if (opts.tab) setTab(opts.tab);
    setTitle(opts.title);
    currentMount = { el: page, opts };
    try { U() && U().emit('shell:mounted', { el: page, opts }); } catch (e) { /* ignore */ }
    return page;
  }

  /* ------------------------------------------------------------------ */
  /* Header                                                               */
  /* ------------------------------------------------------------------ */

  function setHeader(opts) {
    bind();
    opts = opts || {};
    const header = $('header');
    if (!header) return;
    const titleEl = header.querySelector('.header__title');
    const backBtn = header.querySelector('.header__back');
    const mark = header.querySelector('.header__mark');

    if (titleEl) titleEl.textContent = opts.title || 'CardioR2C';
    backTarget = opts.back || null;
    if (backBtn) backBtn.hidden = !opts.back;
    if (mark) mark.hidden = !!opts.back;
    header.classList.toggle('has-back', !!opts.back);
    setActions(opts.actions);
  }

  /** setActions([{icon, label, onClick, primary, badge}]) — right-side header buttons. */
  function setActions(actions) {
    bind();
    const header = $('header');
    const slot = header && header.querySelector('.header__actions');
    if (!slot) return;
    const u = U();
    slot.replaceChildren();
    if (!u || !Array.isArray(actions)) return;
    for (const a of actions) {
      if (!a) continue;
      const label = a.label || '';
      const btn = u.h('button', {
        type: 'button',
        class: ['header__btn', a.icon ? 'header__btn--icon' : 'header__btn--text', a.primary && 'is-primary', a.class],
        'aria-label': a.icon ? label : null,
        title: a.icon ? label : null,
        disabled: !!a.disabled,
        on: { click: (e) => { try { a.onClick && a.onClick(e); } catch (err) { console.error(err); } } }
      });
      if (a.icon) btn.innerHTML = u.icon(a.icon);
      else btn.textContent = label;
      if (a.badge != null && a.badge !== 0 && a.badge !== '') {
        btn.appendChild(u.h('span', { class: 'header__badge' }, String(a.badge)));
      }
      slot.appendChild(btn);
    }
  }

  function doBack() {
    const t = backTarget;
    const router = C.router;
    try {
      if (typeof t === 'function') return t();
      if (typeof t === 'string') return router ? router.go(t) : (location.hash = t);
      if (router && router.back) return router.back();
    } catch (e) { console.error(e); }
    location.hash = '#/';
  }

  function setTitle(title) {
    document.title = title ? 'CardioR2C · ' + title : 'CardioR2C';
  }

  /** Thin indeterminate bar under the header while a view is loading. */
  function setLoading(on) {
    bind();
    const header = $('header');
    if (!header) return;
    clearTimeout(loadingTimer);
    loadingTimer = null;
    header.classList.toggle('is-loading', !!on);
  }
  /** loadingSoon(ms) — show the loading bar only if it is still needed after `ms` (avoids flicker). */
  function loadingSoon(ms) {
    bind();
    clearTimeout(loadingTimer);
    loadingTimer = setTimeout(() => { const hd = $('header'); hd && hd.classList.add('is-loading'); }, ms == null ? 180 : ms);
  }

  /* ------------------------------------------------------------------ */
  /* Tabs                                                                 */
  /* ------------------------------------------------------------------ */

  function setTab(name) {
    bind();
    const tabbar = $('tabbar');
    if (!tabbar) return;
    const n = TAB_NAMES.includes(name) ? name : null;
    tabbar.querySelectorAll('a[data-tab]').forEach((a) => {
      const on = a.dataset.tab === n;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  /** setTabBadge('review', 12) — small count on a tab (0/null hides it). */
  function setTabBadge(name, count) {
    bind();
    const tabbar = $('tabbar');
    const a = tabbar && tabbar.querySelector('a[data-tab="' + name + '"]');
    if (!a) return;
    let b = a.querySelector('.tabbar__badge');
    const n = Number(count) || 0;
    if (n <= 0) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement('span');
      b.className = 'tabbar__badge';
      const iconBox = a.querySelector('.tabbar__icon') || a;
      iconBox.appendChild(b);
    }
    b.textContent = n > 99 ? '99+' : String(n);
  }

  /* ------------------------------------------------------------------ */
  /* Session mode & rhythm strip                                          */
  /* ------------------------------------------------------------------ */

  function setSession(session) {
    bind();
    const app = $('app');
    if (!app) return;
    const on = !!session;
    const was = app.classList.contains('is-session');
    app.classList.toggle('is-session', on);
    if (on) {
      const ratio = (session && typeof session === 'object' && session.ratio != null) ? session.ratio : (was ? rhythmRatio : 0);
      const label = (session && typeof session === 'object') ? session.label : undefined;
      buildRhythm(false);
      progressBar(ratio, label, !was);
    }
  }

  /** One PQRST complex, 56 px wide, baseline y = 18 in a 28 px tall strip. */
  function complexPath() {
    return 'l6 0 q3 -5 6 0 l6 0 l2 3 l4 -15 l4 17 l2 -5 l6 0 q5 -7 10 0 l10 0';
  }

  function buildRhythm(force) {
    const box = $('rhythm');
    if (!box) return;
    const width = Math.max(120, Math.round(box.clientWidth || window.innerWidth || 360));
    if (rhythm && !force && rhythm.width === width) return;
    const n = Math.ceil(width / 56) + 1;
    let d = 'M0 18';
    for (let i = 0; i < n; i++) d += ' ' + complexPath();
    const ns = 'http://www.w3.org/2000/svg';
    if (!rhythm) {
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('class', 'rhythm__svg');
      svg.setAttribute('height', '28');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      const track = document.createElementNS(ns, 'path');
      track.setAttribute('class', 'rhythm__track');
      const fill = document.createElementNS(ns, 'path');
      fill.setAttribute('class', 'rhythm__fill');
      fill.setAttribute('pathLength', '1000');
      const marker = document.createElementNS(ns, 'circle');
      marker.setAttribute('class', 'rhythm__marker');
      marker.setAttribute('r', '3.2');
      svg.appendChild(track); svg.appendChild(fill); svg.appendChild(marker);
      const label = document.createElement('span');
      label.className = 'rhythm__label';
      box.replaceChildren(svg, label);
      rhythm = { svg, track, fill, marker, label, width, ratio: 0 };
    }
    rhythm.width = width;
    rhythm.svg.setAttribute('width', String(width));
    rhythm.svg.setAttribute('viewBox', '0 0 ' + width + ' 28');
    rhythm.track.setAttribute('d', d);
    rhythm.fill.setAttribute('d', d);
    // Clip the visible part to the strip width (the last complex overflows on purpose)
    placeMarker(rhythmRatio);
  }

  function placeMarker(ratio) {
    if (!rhythm) return;
    try {
      const total = rhythm.fill.getTotalLength();
      const p = rhythm.fill.getPointAtLength(Math.max(0, Math.min(1, ratio)) * total);
      rhythm.marker.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px)';
    } catch (e) { /* not rendered yet */ }
  }

  /** progressBar(ratio, label) — fills the rhythm strip (0..1). `label` e.g. "3 / 20". */
  function progressBar(ratio, label, immediate) {
    bind();
    const r = Math.max(0, Math.min(1, Number(ratio) || 0));
    rhythmRatio = r;
    const app = $('app');
    if (!app || !app.classList.contains('is-session')) return;
    buildRhythm(false);
    if (!rhythm) return;
    if (immediate) rhythm.fill.style.transition = 'none';
    rhythm.fill.style.strokeDashoffset = String(1000 - r * 1000);
    if (immediate) {
      // eslint-disable-next-line no-unused-expressions
      rhythm.fill.getBoundingClientRect();
      rhythm.fill.style.transition = '';
    }
    rhythm.marker.style.transition = immediate ? 'none' : '';
    placeMarker(r);
    if (immediate) setTimeout(() => { if (rhythm) rhythm.marker.style.transition = ''; }, 0);
    if (label !== undefined) rhythm.label.textContent = label == null ? '' : String(label);
    rhythm.svg.parentElement && rhythm.svg.parentElement.setAttribute('aria-valuenow', String(Math.round(r * 100)));
  }

  /* ------------------------------------------------------------------ */
  /* Toasts                                                               */
  /* ------------------------------------------------------------------ */

  const TONE_ICON = { ok: 'check', warn: 'warning', bad: 'x', info: 'info' };

  function toastsBox() {
    const o = $('overlays');
    if (!o) return null;
    let box = o.querySelector('.toasts');
    if (!box) {
      box = document.createElement('div');
      box.className = 'toasts';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      o.appendChild(box);
    }
    return box;
  }

  /** toast(msg, {tone: 'ok'|'warn'|'bad'|'info', ms, action:{label, onClick}}) → {close}. */
  function toast(msg, opts) {
    bind();
    opts = opts || {};
    const u = U();
    const box = toastsBox();
    if (!box || !u) { console.log('[toast]', msg); return { close() {} }; }
    const tone = TONE_ICON[opts.tone] ? opts.tone : null;
    let closed = false;
    const el = u.h('div', { class: ['toast', tone && 'toast--' + tone] },
      tone ? u.h('span', { class: 'toast__icon', html: u.icon(TONE_ICON[tone], { size: 20 }) }) : null,
      u.h('span', { class: 'toast__msg' }, String(msg == null ? '' : msg)),
      opts.action && opts.action.label
        ? u.h('button', { type: 'button', class: 'toast__action', on: { click: (e) => { e.stopPropagation(); try { opts.action.onClick && opts.action.onClick(); } catch (err) { console.error(err); } close(); } } }, opts.action.label)
        : null
    );
    const close = () => {
      if (closed) return;
      closed = true;
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), reducedMotion() ? 0 : 200);
    };
    el.addEventListener('click', close);
    while (box.children.length >= 3) box.firstElementChild.remove();
    box.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    const ms = opts.ms == null ? 2500 : opts.ms;
    if (ms > 0) setTimeout(close, ms);
    return { close, el };
  }

  /* ------------------------------------------------------------------ */
  /* Sheets & modals                                                      */
  /* ------------------------------------------------------------------ */

  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  function openOverlay(contentEl, opts, kind) {
    bind();
    opts = opts || {};
    const u = U();
    const host = $('overlays');
    if (!u || !host) {
      console.warn('[CARDIO.shell] overlays indisponibles');
      return { close() {}, el: null, closed: Promise.resolve(false) };
    }
    const titleId = 'sheet-title-' + u.uid();
    let resolveClosed;
    const closed = new Promise((res) => { resolveClosed = res; });
    let done = false;
    const previousFocus = document.activeElement;

    const sheet = u.h('div', {
      class: ['sheet', kind === 'modal' && 'sheet--modal', opts.wide && 'sheet--wide', opts.class],
      role: 'dialog', 'aria-modal': 'true', tabindex: '-1',
      'aria-labelledby': opts.title ? titleId : null,
      'aria-label': opts.title ? null : (opts.ariaLabel || 'Fenêtre')
    },
      kind === 'sheet' ? u.h('div', { class: 'sheet__handle', 'aria-hidden': 'true' }) : null,
      (opts.title || opts.closeButton !== false) ? u.h('header', { class: 'sheet__head' },
        u.h('h2', { class: 'sheet__title', id: titleId }, opts.title || ''),
        opts.closeButton !== false ? u.h('button', {
          type: 'button', class: 'sheet__close', 'aria-label': 'Fermer', html: u.icon('x'),
          on: { click: () => close(false) }
        }) : null
      ) : null,
      u.h('div', { class: 'sheet__body' }, contentEl)
    );
    const scrim = u.h('div', { class: 'scrim', on: { click: () => { if (opts.dismissible !== false) close(false); } } });
    const wrap = u.h('div', { class: ['overlay', 'overlay--' + kind] }, scrim, sheet);

    // Minimal focus trap
    sheet.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const f = Array.from(sheet.querySelectorAll(FOCUSABLE)).filter((x) => x.offsetParent !== null);
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    function close(result) {
      if (done) return;
      done = true;
      const idx = overlays.indexOf(entry);
      if (idx >= 0) overlays.splice(idx, 1);
      wrap.classList.remove('is-open');
      wrap.classList.add('is-closing');
      const finish = () => {
        wrap.remove();
        if (!overlays.length) { const app = $('app'); app && app.classList.remove('has-overlay'); }
        try { if (previousFocus && previousFocus.focus && document.contains(previousFocus)) previousFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        try { opts.onClose && opts.onClose(result); } catch (e) { console.error(e); }
        resolveClosed(result);
      };
      setTimeout(finish, reducedMotion() ? 0 : 220);
    }

    const entry = { wrap, close, kind };
    overlays.push(entry);
    host.appendChild(wrap);
    const app = $('app'); app && app.classList.add('has-overlay');
    requestAnimationFrame(() => {
      wrap.classList.add('is-open');
      const target = opts.autofocus === false ? sheet : (sheet.querySelector('[autofocus]') || sheet.querySelector('.sheet__body ' + FOCUSABLE) || sheet);
      try { target.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    });
    return { close, el: sheet, wrap, closed };
  }

  /** sheet(el, {title, wide, dismissible, onClose}) — bottom sheet on phones, centered ≥ 900 px. */
  function sheet(el, opts) { return openOverlay(el, opts, 'sheet'); }
  /** modal(el, {title, …}) — always centered. */
  function modal(el, opts) { return openOverlay(el, opts, 'modal'); }

  function closeAll() {
    while (overlays.length) overlays[overlays.length - 1].close(false);
  }

  /** confirm(msg, {ok, cancel, tone: 'danger'|'primary', title}) → Promise<boolean>. */
  function confirm(msg, opts) {
    opts = opts || {};
    const u = U();
    if (!u) return Promise.resolve(window.confirm(String(msg)));
    let ref = null;
    return new Promise((resolve) => {
      const okBtn = u.h('button', {
        type: 'button', class: ['btn', opts.tone === 'danger' ? 'btn--danger' : 'btn--primary'], autofocus: true,
        on: { click: () => ref.close(true) }
      }, opts.ok || 'Confirmer');
      const cancelBtn = u.h('button', {
        type: 'button', class: 'btn btn--secondary', on: { click: () => ref.close(false) }
      }, opts.cancel || 'Annuler');
      const body = u.h('div', { class: 'confirm' },
        u.h('p', { class: 'confirm__msg' }, String(msg == null ? '' : msg)),
        u.h('div', { class: 'confirm__actions' }, cancelBtn, okBtn)
      );
      ref = openOverlay(body, { title: opts.title, closeButton: !!opts.title, class: 'sheet--confirm', onClose: (r) => resolve(r === true) }, 'modal');
    });
  }

  /* ------------------------------------------------------------------ */
  /* Theme                                                                */
  /* ------------------------------------------------------------------ */

  function updateThemeColor() {
    try {
      let meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'theme-color');
        (document.head || document.documentElement).appendChild(meta);
      }
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      if (bg) meta.setAttribute('content', bg);
    } catch (e) { /* ignore */ }
  }

  /** applyTheme('system'|'light'|'dark') — sets/removes data-theme on <html>, remembers it. */
  function applyTheme(theme) {
    const t = theme === 'light' || theme === 'dark' ? theme : 'system';
    const root = document.documentElement;
    if (t === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* private mode */ }
    updateThemeColor();
    try { U() && U().emit('theme', t); } catch (e) { /* ignore */ }
    return t;
  }
  function currentTheme() {
    const a = document.documentElement.getAttribute('data-theme');
    return a === 'light' || a === 'dark' ? a : 'system';
  }
  /** effectiveTheme() → 'light' | 'dark' actually displayed. */
  function effectiveTheme() {
    const t = currentTheme();
    if (t !== 'system') return t;
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (e) { return 'light'; }
  }

  /* ------------------------------------------------------------------ */
  /* Misc                                                                 */
  /* ------------------------------------------------------------------ */

  /** haptic(ms) — vibrates on phones when the profile allows it. */
  function haptic(ms) {
    try {
      const st = C.store;
      const allowed = st && typeof st.get === 'function' ? st.get('profile.haptics') !== false : true;
      if (allowed && navigator.vibrate) navigator.vibrate(ms == null ? 10 : ms);
    } catch (e) { /* ignore */ }
  }

  function hideSplash() {
    const s = $('splash');
    if (!s) return;
    s.classList.add('is-hidden');
    setTimeout(() => { s.hidden = true; }, reducedMotion() ? 0 : 260);
  }

  C.shell = {
    mount, setHeader, setActions, setTitle, setLoading, loadingSoon,
    setTab, setTabBadge, setSession, progressBar,
    toast, confirm, sheet, modal, closeAll,
    applyTheme, currentTheme, effectiveTheme,
    haptic, hideSplash, scrollTop: smoothScrollTop, isDesktop, reducedMotion,
    viewEl: () => $('view'),
    current: () => currentMount,
    THEME_KEY
  };
})();
