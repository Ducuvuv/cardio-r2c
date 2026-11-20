/* CardioR2C — passes.js
 * « Vu N fois » : nombre de passages déclarés par l'étudiant sur un cours (item du Collège « i:<num> » ou fiche de poly
 * « p:<id> »), réglable à la main avec − / +. localStorage « cardio.passes » = {clé: {n, at}} (sauvegardé dans le cloud
 * via js/lsync.js). Un cours vu au moins une fois entre dans le paquet auto (js/deck.js). */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  const LS = 'cardio.passes';
  function h() { return CARDIO.util.h.apply(null, arguments); }
  function all() { try { const o = JSON.parse(localStorage.getItem(LS) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function get(k) { const e = all()[k]; return e ? Math.max(0, Math.round(Number(e.n) || 0)) : 0; }
  function set(k, n) {
    try {
      k = String(k || ''); if (!/^[ip]:./.test(k)) return 0;
      n = Math.max(0, Math.min(99, Math.round(Number(n) || 0)));
      const o = all();
      o[k] = { n: n, at: Date.now() };   // n = 0 gardé (avec sa date) pour que la remise à zéro se synchronise
      localStorage.setItem(LS, JSON.stringify(o));
      if (n >= 1 && CARDIO.deck) try { CARDIO.deck.activate(k, 'read'); } catch (e) { /* ignore */ }
      try { if (CARDIO.util && CARDIO.util.emit) CARDIO.util.emit('passes:change', { key: k, n: n }); } catch (e) { /* ignore */ }
      return n;
    } catch (e) { return 0; }
  }
  function when(at) {
    if (!at) return '';
    const d = Math.floor((Date.now() - at) / 86400000);
    return d <= 0 ? 'aujourd’hui' : d === 1 ? 'hier' : 'il y a ' + d + ' j';
  }
  /* Bloc « 👁️ Vu N fois  − + » pour la page d'un cours. */
  function widget(k) {
    const wrap = h('div', { class: 'card', style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 14px' });
    function draw() {
      const e = all()[k], n = get(k);
      const b = function (label, aria, fn) { return h('button', { type: 'button', class: 'btn btn--sm btn--outline', 'aria-label': aria, style: 'min-width:40px;font-weight:800', on: { click: fn } }, label); };
      wrap.replaceChildren(
        h('div', { style: 'flex:1;min-width:150px' },
          h('b', {}, n ? '👁️ Vu ' + n + ' fois' : '👁️ Pas encore vu'),
          h('div', { class: 'secondary muted', style: 'font-size:.8125rem' }, n ? 'Dernier passage ' + when(e && e.at) + ' · ajuste si besoin' : 'Note chaque lecture complète de ce cours')),
        b('−', 'Un passage de moins', function () { set(k, n - 1); draw(); }),
        h('button', { type: 'button', class: 'btn btn--sm btn--primary', on: { click: function () { set(k, n + 1); draw(); } } }, n ? '+1 passage' : 'Je l’ai vu ✓'));
    }
    draw();
    return wrap;
  }
  /* Petite pastille « 👁️ ×N » pour les listes (null si jamais vu). */
  function badge(k) {
    const n = get(k);
    return n ? h('span', { class: 'pill pill--kind', title: 'Vu ' + n + ' fois' }, '👁️ ×' + n) : null;
  }
  CARDIO.passes = { get: get, set: set, widget: widget, badge: badge };
})();
