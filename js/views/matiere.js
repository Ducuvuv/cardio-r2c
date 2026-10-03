/* CardioR2C — views/matiere.js
 * Matière active (cardio, dermato, pneumo, ou toutes) : sélecteur partagé par l'accueil, la liste des items,
 * les récaps Pareto et la page « Réviser ». La valeur vit dans le profil (store.activeSpe / store.setSpe) :
 * les séances, les cartes dues, le mode illimité, l'examen blanc et les prévisions s'y limitent.
 * Script classique ES2020 ; appels aux autres modules uniquement à l'exécution.
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  CARDIO.views = CARDIO.views || {};

  function h() {
    const u = CARDIO.util || {};
    return u.h.apply(null, arguments);
  }

  /* [{code, title, short, items}] d'après le manifest (cardio seule si manifest ancien). */
  function list() {
    const r = CARDIO.registry;
    try { return r && typeof r.specialties === 'function' ? r.specialties() : []; } catch (e) { return []; }
  }
  function multi() { return list().length > 1; }
  function current() {
    const s = CARDIO.store;
    try { return s && typeof s.activeSpe === 'function' ? s.activeSpe() : 'all'; } catch (e) { return 'all'; }
  }
  function find(code) { return list().find(function (x) { return x.code === code; }) || null; }
  function title(code) { if (!code || code === 'all') return 'Toutes les matières'; const x = find(code); return x ? x.title : String(code); }
  function short(code) { if (!code || code === 'all') return 'Toutes'; const x = find(code); return x ? x.short : String(code); }
  function set(code) {
    const s = CARDIO.store;
    if (s && typeof s.setSpe === 'function') { try { s.setSpe(code); } catch (e) { console.warn('[matiere]', e); } }
  }
  /* Libellé pour un bouton ou un titre : « tous les items » / « la dermato ». */
  function scopeLabel(code) {
    const c = code === undefined ? current() : code;
    return c === 'all' ? (multi() ? 'toutes matières' : 'tous les items') : short(c).toLowerCase();
  }

  const CSS = [
    '.spe{display:flex;gap:6px;overflow-x:auto;margin:0 0 14px;padding:2px 0;scrollbar-width:none;-webkit-overflow-scrolling:touch}',
    '.spe::-webkit-scrollbar{display:none}',
    '.spe__btn{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);font:600 .875rem/1 var(--font-body);cursor:pointer}',
    '.spe__btn.is-on{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}',
    '.spe__btn:focus-visible{outline:2px solid var(--blue);outline-offset:2px}',
    '.spe__n{font-size:.75rem;font-weight:700;font-variant-numeric:tabular-nums;opacity:.75}'
  ].join('\n');
  function ensureStyles() {
    if (document.getElementById('matiere-css')) return;
    const s = document.createElement('style');
    s.id = 'matiere-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* Sélecteur segmenté (null s'il n'y a qu'une matière). opts.counts : {code: n} affiché en pastille ;
   * opts.onChange(code) après l'enregistrement (les vues abonnées à « store:change » se redessinent seules). */
  function switcher(opts) {
    const o = opts || {};
    if (!multi()) return null;
    ensureStyles();
    const cur = current();
    const codes = ['all'].concat(list().map(function (x) { return x.code; }));
    return h('div', { class: 'spe', role: 'radiogroup', 'aria-label': 'Matière' }, codes.map(function (code) {
      const on = code === cur;
      const n = o.counts ? Number(o.counts[code]) || 0 : 0;
      return h('button', {
        type: 'button', class: 'spe__btn' + (on ? ' is-on' : ''), role: 'radio', 'aria-checked': on ? 'true' : 'false',
        title: title(code),
        on: { click: function () { if (code === current()) return; set(code); if (typeof o.onChange === 'function') o.onChange(code); } }
      }, short(code), n ? h('span', { class: 'spe__n' }, String(n)) : null);
    }));
  }

  CARDIO.views.matiere = { list: list, multi: multi, current: current, title: title, short: short, set: set, scopeLabel: scopeLabel, switcher: switcher };
})();
