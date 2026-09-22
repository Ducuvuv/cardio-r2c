/* CardioR2C — CARDIO.views.treatments
 * Fiches traitements : liste globale (#/treatments : recherche + chips par item), liste par item
 * (#/item/:num/traitements : stratégies en accordéons + fiches), « Mode rappel » (listes masquées
 * derrière « Révéler », auto-évaluation), tableau comparatif compact, et renderRecall(tx, {onGrade})
 * pour le moteur de quiz.
 * Script classique ES2020 ; appels aux autres modules uniquement à l'exécution, dégradation propre.
 */
(function () {
  'use strict';

  window.CARDIO = window.CARDIO || {};
  CARDIO.views = CARDIO.views || {};

  /* ------------------------------------------------------------------ */
  /* Utilitaires défensifs                                                */
  /* ------------------------------------------------------------------ */

  function U() { return (window.CARDIO && CARDIO.util) || null; }

  function esc(s) {
    const u = U();
    if (u && typeof u.esc === 'function') return u.esc(String(s == null ? '' : s));
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function flatten(list, out) {
    for (const c of list) {
      if (c == null || c === false || c === true) continue;
      if (Array.isArray(c)) flatten(c, out);
      else out.push(c);
    }
    return out;
  }

  function fallbackH(tag, attrs, kids) {
    const el = document.createElement(tag);
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') { for (const d in v) el.dataset[d] = v[d]; }
      else if (k === 'on') { for (const e in v) el.addEventListener(e, v[e]); }
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }

  const PROP_KEYS = ['open', 'disabled', 'checked', 'value', 'selected'];
  function h(tag, attrs, ...children) {
    attrs = Object.assign({}, attrs || {});
    const props = {};
    for (const k of PROP_KEYS) if (k in attrs) { props[k] = attrs[k]; delete attrs[k]; }
    const kids = flatten(children, []);
    const u = U();
    let el;
    if (u && typeof u.h === 'function') el = u.h(tag, attrs, ...kids);
    else el = fallbackH(tag, attrs, kids);
    for (const k in props) el[k] = props[k];
    return el;
  }

  function mdHTML(text) {
    const u = U();
    if (u && typeof u.md === 'function') return u.md(String(text == null ? '' : text));
    return '<p>' + esc(text) + '</p>';
  }

  // Rendu md « en ligne » : retire l'unique <p> englobant produit par md() pour un item de liste.
  function mdInline(text) {
    const html = mdHTML(text).trim();
    const m = /^<p>([\s\S]*)<\/p>$/.exec(html);
    return m ? m[1] : html;
  }

  function mdEl(text, cls) {
    const d = h('div', { class: cls || 'md' });
    d.innerHTML = mdHTML(text);
    return d;
  }

  function inlineEl(tag, attrs, text) {
    const el = h(tag, attrs);
    el.innerHTML = mdInline(text);
    return el;
  }

  function icon(name) {
    const u = U();
    if (u && typeof u.icon === 'function') {
      const s = h('span', { class: 'ico', 'aria-hidden': 'true' });
      s.innerHTML = u.icon(name);
      return s;
    }
    return null;
  }

  function now() {
    const u = U();
    return (u && typeof u.now === 'function') ? u.now() : Date.now();
  }

  function normalize(s) {
    const u = U();
    if (u && typeof u.normalize === 'function') return u.normalize(String(s == null ? '' : s));
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function debounce(fn, ms) {
    const u = U();
    if (u && typeof u.debounce === 'function') return u.debounce(fn, ms);
    let t = null;
    return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
  }

  function toast(msg, tone) {
    const sh = window.CARDIO && CARDIO.shell;
    if (sh && typeof sh.toast === 'function') { try { sh.toast(msg, { tone: tone || 'info' }); } catch (e) { /* silencieux */ } }
  }

  function go(hash) {
    const r = window.CARDIO && CARDIO.router;
    if (r && typeof r.go === 'function') { try { r.go(hash); return; } catch (e) { /* fallback */ } }
    location.hash = hash;
  }

  function itemOfId(id) {
    const m = /^(\d{3})-/.exec(String(id || ''));
    return m ? m[1] : null;
  }

  function registry() { return (window.CARDIO && CARDIO.registry) || null; }

  async function ensureItem(num) {
    const r = registry();
    if (!r) { console.warn('[treatments] CARDIO.registry indisponible'); return null; }
    try { if (typeof r.load === 'function') await r.load(num); }
    catch (e) { console.warn('[treatments] chargement de l\'item ' + num + ' impossible', e); return null; }
    return typeof r.content === 'function' ? (r.content(num) || null) : null;
  }

  function itemMeta(num) {
    const r = registry();
    if (r && typeof r.item === 'function') { try { return r.item(num) || null; } catch (e) { return null; } }
    return null;
  }

  function recordAttempt(payload) {
    const s = window.CARDIO && CARDIO.store;
    if (s && typeof s.recordAttempt === 'function') {
      try { return s.recordAttempt(payload); } catch (e) { console.warn('[treatments] recordAttempt a échoué', e); }
    } else {
      console.warn('[treatments] CARDIO.store.recordAttempt indisponible : progression non enregistrée');
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Styles (tokens uniquement)                                           */
  /* ------------------------------------------------------------------ */

  const CSS = `
  .page-head{margin:0 0 16px}
  .page-title{font-family:var(--font-display);font-size:1.75rem;line-height:1.15;margin:0;text-wrap:balance}
  .page-sub{color:var(--muted);margin:4px 0 0;font-size:.875rem}
  .src{color:var(--muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.06em}
  .empty{color:var(--muted);text-align:center;padding:24px 8px}
  .tx-tools{display:flex;flex-direction:column;gap:10px;margin-bottom:14px}
  .tx-search{position:relative}
  .tx-search .ico{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none;display:flex}
  .tx-search__input{width:100%;min-height:44px;border:1px solid var(--line);border-radius:var(--r-s);background:var(--surface);color:var(--ink);font:inherit;padding:8px 12px 8px 40px;box-sizing:border-box}
  .tx-search__input:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
  .tx-search--noicon .tx-search__input{padding-left:12px}
  .tx-chips{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px;-webkit-overflow-scrolling:touch}
  .tx-chips::-webkit-scrollbar{display:none}
  .tx-chips .chip{flex:none}
  .tx-toggles{display:flex;gap:8px;flex-wrap:wrap}
  .tx-toggles .chip .ico{display:inline-flex}
  .tx-count{color:var(--muted);font-size:.875rem}
  .tx-list{display:grid;gap:12px}
  @media (min-width:900px){.tx-list{grid-template-columns:1fr 1fr}.tx-list--single{grid-template-columns:1fr}}
  .tx{display:flex;flex-direction:column;gap:10px}
  .tx__head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
  .tx__class{font-family:var(--font-display);font-size:1.25rem;line-height:1.2;margin:0}
  .tx__molecules{margin:0;color:var(--ink-2);font-size:.9375rem}
  .tx__molecules b{font-weight:600;color:var(--ink)}
  .tx__context{align-self:flex-start;white-space:normal;text-transform:none;letter-spacing:0;font-size:.8125rem;line-height:1.3;padding:4px 10px}
  .tx__groups{display:flex;flex-direction:column;gap:8px}
  .tx__group{border-top:1px solid var(--line);padding-top:8px}
  .tx__group-head{display:flex;align-items:center;gap:8px;min-height:32px}
  .tx__group-title{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;font-weight:600;color:var(--muted);margin:0;display:flex;align-items:center;gap:6px;flex:1}
  .tx__group-title .ico{display:inline-flex;width:18px;height:18px}
  .tx__group-title .ico svg{width:18px;height:18px}
  .tx__group--indications .tx__group-title{color:var(--ok)}
  .tx__group--contraindications .tx__group-title{color:var(--bad)}
  .tx__group--sideEffects .tx__group-title{color:var(--warn)}
  .tx__group--monitoring .tx__group-title{color:var(--info)}
  .tx__group--interactions .tx__group-title{color:var(--blue)}
  .tx__group--pearls .tx__group-title{color:var(--accent)}
  .tx__list{margin:4px 0 0;padding-left:20px}
  .tx__list li{margin:3px 0;line-height:1.45}
  .tx__group.is-hidden .tx__list{display:none}
  .tx__reveal{margin-left:auto}
  .tx__foot{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
  .tx__recall-hint{color:var(--muted);font-size:.875rem;margin:0}
  .tx__recall-actions{display:flex;gap:8px;flex-wrap:wrap}
  .tx__graded{color:var(--ok);font-weight:600;font-size:.875rem;display:flex;align-items:center;gap:6px}
  .grades{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:4px}
  .grades .btn{padding-inline:6px;font-size:.875rem}
  .grades .btn--again{background:var(--bad-soft);color:var(--bad)}
  .grades .btn--hard{background:var(--warn-soft);color:var(--warn)}
  .grades .btn--good{background:var(--ok-soft);color:var(--ok)}
  .grades .btn--easy{background:var(--info-soft);color:var(--info)}
  .grades__label{grid-column:1/-1;color:var(--muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.06em}
  .tx-recall .tx__groups{display:none}
  .tx-recall.is-revealed .tx__groups{display:flex}
  .tx-strats{margin-bottom:18px;display:grid;gap:8px}
  .tx-strats__title{font-family:var(--font-display);font-size:1.125rem;margin:0 0 4px}
  .tx-strat{padding:0}
  .tx-strat>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:14px 16px;min-height:52px;font-weight:600}
  .tx-strat>summary::-webkit-details-marker{display:none}
  .tx-strat>summary .ico{margin-left:auto;transition:transform .18s cubic-bezier(.2,.7,.2,1);display:inline-flex;color:var(--muted)}
  .tx-strat[open]>summary .ico{transform:rotate(180deg)}
  .tx-strat>summary:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
  .tx-strat__body{padding:0 16px 16px;color:var(--ink-2)}
  .tx-strat__body p{margin:0 0 8px}
  .tx-strat__body ul,.tx-strat__body ol{padding-left:20px;margin:0 0 8px}
  .tx-strat__body table{border-collapse:collapse;width:100%;font-size:.875rem;margin:8px 0}
  .tx-strat__body th,.tx-strat__body td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
  .tx-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:var(--r-m);background:var(--surface);box-shadow:var(--shadow-1)}
  .tx-table{border-collapse:collapse;min-width:560px;width:100%;font-size:.875rem}
  .tx-table th,.tx-table td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;line-height:1.4}
  .tx-table th{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);background:var(--surface-2);position:sticky;top:0}
  .tx-table td:first-child{font-weight:600}
  .tx-table tr:last-child td{border-bottom:0}
  .tx-table__muted{color:var(--muted)}
  .tx-section{margin:20px 0 8px;display:flex;align-items:baseline;justify-content:space-between;gap:8px}
  .tx-section__title{font-family:var(--font-display);font-size:1.125rem;margin:0}
  .tx-section__link{color:var(--blue);font-size:.875rem;text-decoration:none;font-weight:600}
  @media (prefers-reduced-motion:reduce){.tx-strat>summary .ico{transition:none}}
  `;

  function injectStyle() {
    if (document.getElementById('style-view-treatments')) return;
    const s = document.createElement('style');
    s.id = 'style-view-treatments';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ------------------------------------------------------------------ */
  /* Fiche traitement                                                     */
  /* ------------------------------------------------------------------ */

  const GROUPS = [
    { key: 'indications', label: 'Indications', icon: 'check' },
    { key: 'contraindications', label: 'Contre-indications', icon: 'x' },
    { key: 'sideEffects', label: 'Effets indésirables', icon: 'warning' },
    { key: 'monitoring', label: 'Surveillance', icon: 'eye' },
    { key: 'interactions', label: 'Interactions', icon: 'info' },
    { key: 'pearls', label: 'À retenir', icon: 'star' }
  ];

  const GRADE_BTNS = [
    { grade: 1, label: 'Encore', cls: 'btn--again', score: 0 },
    { grade: 2, label: 'Difficile', cls: 'btn--hard', score: 0.5 },
    { grade: 3, label: 'Bien', cls: 'btn--good', score: 1 },
    { grade: 4, label: 'Facile', cls: 'btn--easy', score: 1 }
  ];

  function list(arr) { return Array.isArray(arr) ? arr.filter(x => x != null && String(x).trim() !== '') : []; }

  function presentGroups(tx) { return GROUPS.filter(g => list(tx[g.key]).length > 0); }

  function groupEl(tx, g, hidden) {
    const sec = h('section', { class: 'tx__group tx__group--' + g.key + (hidden ? ' is-hidden' : '') });
    const head = h('div', { class: 'tx__group-head' }, h('h4', { class: 'tx__group-title' }, icon(g.icon), g.label));
    const ul = h('ul', { class: 'tx__list' });
    list(tx[g.key]).forEach(t => ul.append(inlineEl('li', null, t)));
    if (hidden) {
      const btn = h('button', {
        type: 'button', class: 'btn btn--ghost btn--sm tx__reveal', 'aria-expanded': 'false',
        on: { click: () => { sec.classList.remove('is-hidden'); btn.remove(); sec.dispatchEvent(new CustomEvent('tx:reveal', { bubbles: true })); } }
      }, icon('eye'), 'Révéler');
      head.append(btn);
    }
    sec.append(head, ul);
    return sec;
  }

  function gradeRow(onPick, label) {
    const row = h('div', { class: 'grades', role: 'group', 'aria-label': 'Auto-évaluation' });
    if (label) row.append(h('span', { class: 'grades__label' }, label));
    GRADE_BTNS.forEach(gb => {
      row.append(h('button', { type: 'button', class: 'btn btn--secondary ' + gb.cls, on: { click: () => onPick(gb) } }, gb.label));
    });
    return row;
  }

  // En-tête commun : classe (police display), molécules, contexte.
  function txHeader(tx) {
    const mols = list(tx.molecules);
    const frag = document.createDocumentFragment();
    frag.append(h('div', { class: 'tx__head' },
      h('h3', { class: 'tx__class' }, tx.class || 'Classe thérapeutique'),
      tx.rank ? h('span', { class: 'pill pill--' + tx.rank }, 'Rang ' + tx.rank) : null));
    if (mols.length) {
      const p = h('p', { class: 'tx__molecules' });
      p.innerHTML = '<b>' + (mols.length > 1 ? 'Molécules' : 'Molécule') + ' :</b> ' + mols.map(m => mdInline(m)).join(' · ');
      frag.append(p);
    }
    if (tx.context) frag.append(h('span', { class: 'pill pill--info tx__context' }, tx.context));
    return frag;
  }

  /**
   * txCard(tx, {recall, item, host}) → <article class="tx card">
   * En mode rappel : listes masquées (bouton « Révéler » par groupe + « Révéler tout »), puis
   * auto-évaluation Encore/Difficile/Bien/Facile enregistrée via store (kind 'tx').
   */
  function txCard(tx, opts) {
    opts = opts || {};
    const recall = !!opts.recall;
    const item = opts.item || itemOfId(tx.id);
    const card = h('article', { class: 'tx card' + (recall ? ' is-recall' : ''), dataset: { id: tx.id || '' } });
    card.append(txHeader(tx));
    const groups = presentGroups(tx);
    const groupsEl = h('div', { class: 'tx__groups' });
    groups.forEach(g => groupsEl.append(groupEl(tx, g, recall)));
    if (!groups.length) groupsEl.append(h('p', { class: 'tx__recall-hint' }, 'Le Collège ne détaille pas davantage cette classe.'));
    card.append(groupsEl);

    const foot = h('div', { class: 'tx__foot' });
    if (tx.src) foot.append(h('span', { class: 'src' }, tx.src));
    card.append(foot);

    if (recall && groups.length) {
      const t0 = now();
      let graded = false;
      const actions = h('div', { class: 'tx__recall-actions' });
      const revealAll = h('button', {
        type: 'button', class: 'btn btn--secondary btn--sm',
        on: { click: () => { groupsEl.querySelectorAll('.tx__group.is-hidden').forEach(s => { s.classList.remove('is-hidden'); const b = s.querySelector('.tx__reveal'); if (b) b.remove(); }); onAllRevealed(); } }
      }, icon('eye'), 'Révéler tout');
      actions.append(revealAll);
      foot.append(actions);

      const gradesHost = h('div');
      card.append(gradesHost);

      function onAllRevealed() {
        if (groupsEl.querySelector('.tx__group.is-hidden')) return;
        revealAll.remove();
        if (graded || gradesHost.childElementCount) return;
        gradesHost.append(gradeRow((gb) => {
          graded = true;
          const ms = now() - t0;
          recordAttempt({ cardId: tx.id, item, kind: 'tx', score: gb.score, grade: gb.grade, ms });
          gradesHost.replaceChildren(h('div', { class: 'tx__graded' }, icon('check'), 'Noté : ' + gb.label + '.'));
          toast('Rappel enregistré.', 'ok');
        }, 'Comment ça s\'est passé ?'));
      }
      groupsEl.addEventListener('tx:reveal', onAllRevealed);
    }
    return card;
  }

  /**
   * renderRecall(tx, {onGrade}) → HTMLElement (moteur de quiz).
   * Montre seulement classe + molécules + contexte ; « Révéler tout » affiche les listes puis les
   * boutons Encore/Difficile/Bien/Facile → onGrade(grade) avec grade ∈ {1,2,3,4} (CARDIO.srs.GRADES).
   */
  function renderRecall(tx, opts) {
    opts = opts || {};
    injectStyle();
    const el = h('div', { class: 'tx tx-recall card' });
    if (!tx) { el.append(h('p', { class: 'empty' }, 'Fiche traitement introuvable.')); return el; }
    el.append(txHeader(tx));
    const groups = presentGroups(tx);
    const hint = h('p', { class: 'tx__recall-hint' }, groups.length
      ? 'Essaie de retrouver : ' + groups.map(g => g.label.toLowerCase()).join(', ') + '.'
      : 'Le Collège ne détaille pas davantage cette classe.');
    el.append(hint);
    const groupsEl = h('div', { class: 'tx__groups' });
    groups.forEach(g => groupsEl.append(groupEl(tx, g, false)));
    el.append(groupsEl);
    if (tx.src) el.append(h('div', { class: 'src' }, tx.src));
    const host = h('div');
    const reveal = h('button', {
      type: 'button', class: 'btn btn--primary btn--block',
      on: {
        click: () => {
          el.classList.add('is-revealed');
          reveal.remove();
          let picked = false;
          host.append(gradeRow((gb) => {
            if (picked) return;
            picked = true;
            host.querySelectorAll('.grades .btn').forEach(b => { b.disabled = true; });
            if (typeof opts.onGrade === 'function') { try { opts.onGrade(gb.grade); } catch (e) { console.warn(e); } }
          }, 'Comment ça s\'est passé ?'));
        }
      }
    }, icon('eye'), 'Révéler tout');
    host.append(reveal);
    el.append(host);
    return el;
  }

  /* ------------------------------------------------------------------ */
  /* Tableau comparatif                                                    */
  /* ------------------------------------------------------------------ */

  function comparisonTable(rows, withItem) {
    const wrap = h('div', { class: 'tx-table-wrap' });
    const table = h('table', { class: 'tx-table' });
    const headCells = [withItem ? 'Item' : null, 'Classe', 'Molécules', '1re indication', 'CI principale'].filter(Boolean);
    table.append(h('thead', null, h('tr', null, headCells.map(c => h('th', { scope: 'col' }, c)))));
    const tbody = h('tbody');
    rows.forEach(({ tx, item }) => {
      const mols = list(tx.molecules);
      const ind = list(tx.indications)[0];
      const ci = list(tx.contraindications)[0];
      const tr = h('tr');
      if (withItem) tr.append(h('td', { class: 'tx-table__muted' }, item || ''));
      tr.append(
        h('td', null, tx.class || ''),
        mols.length ? inlineEl('td', null, mols.join(', ')) : h('td', { class: 'tx-table__muted' }, '—'),
        ind ? inlineEl('td', null, ind) : h('td', { class: 'tx-table__muted' }, '—'),
        ci ? inlineEl('td', null, ci) : h('td', { class: 'tx-table__muted' }, '—'));
      tbody.append(tr);
    });
    table.append(tbody);
    wrap.append(table);
    return wrap;
  }

  /* ------------------------------------------------------------------ */
  /* Stratégies (accordéons)                                               */
  /* ------------------------------------------------------------------ */

  function strategiesBlock(strats) {
    const wrap = h('section', { class: 'tx-strats' });
    wrap.append(h('h3', { class: 'tx-strats__title' }, 'Stratégies thérapeutiques'));
    strats.forEach((s, i) => {
      const det = h('details', { class: 'card tx-strat', open: i === 0 });
      det.append(
        h('summary', null,
          s.rank ? h('span', { class: 'pill pill--' + s.rank }, s.rank) : null,
          h('span', null, s.title || 'Stratégie'),
          icon('chevron-down')),
        h('div', { class: 'tx-strat__body' }, mdEl(s.content, 'md'), s.src ? h('div', { class: 'src' }, s.src) : null));
      wrap.append(det);
    });
    return wrap;
  }

  /* ------------------------------------------------------------------ */
  /* Vue générique : outils (recherche, chips, toggles) + rendu             */
  /* ------------------------------------------------------------------ */

  function haystack(tx) {
    return normalize([tx.class, list(tx.molecules).join(' '), tx.context].join(' '));
  }

  function matches(hay, query) {
    const words = normalize(query).split(' ').filter(Boolean);
    return words.every(w => hay.includes(w));
  }

  function pageHead(title, sub) {
    return h('header', { class: 'page-head' },
      h('h2', { class: 'page-title' }, title),
      sub ? h('p', { class: 'page-sub' }, sub) : null);
  }

  function toggleChip(label, iconName, initial, onChange) {
    const chip = h('button', { type: 'button', class: 'chip' + (initial ? ' is-on' : ''), 'aria-pressed': String(!!initial) }, icon(iconName), label);
    chip.addEventListener('click', () => {
      const on = !chip.classList.contains('is-on');
      chip.classList.toggle('is-on', on);
      chip.setAttribute('aria-pressed', String(on));
      onChange(on);
    });
    return chip;
  }

  /**
   * Bloc liste + outils. entries = [{tx, item, short}] ; opts.search, opts.itemChips, opts.table.
   */
  function txBrowser(entries, opts) {
    opts = opts || {};
    const state = { query: '', item: null, recall: false, table: false };
    const tools = h('div', { class: 'tx-tools' });
    const body = h('div');
    const countEl = h('div', { class: 'tx-count' });
    const wrap = h('div', { class: 'tx-browser' }, tools, countEl, body);

    if (opts.search) {
      const ic = icon('search');
      const input = h('input', {
        type: 'search', class: 'tx-search__input', placeholder: 'Classe, molécule, contexte…',
        'aria-label': 'Rechercher un traitement', autocomplete: 'off'
      });
      input.addEventListener('input', debounce(() => { state.query = input.value; draw(); }, 120));
      tools.append(h('div', { class: 'tx-search' + (ic ? '' : ' tx-search--noicon') }, ic, input));
    }

    if (opts.itemChips) {
      const items = [];
      const seen = new Set();
      entries.forEach(e => { if (!seen.has(e.item)) { seen.add(e.item); items.push({ item: e.item, short: e.short }); } });
      if (items.length > 1) {
        const chips = h('div', { class: 'tx-chips', role: 'group', 'aria-label': 'Filtrer par item' });
        const all = h('button', { type: 'button', class: 'chip is-on' }, 'Tous');
        const btns = [all];
        all.addEventListener('click', () => { state.item = null; btns.forEach(b => b.classList.toggle('is-on', b === all)); draw(); });
        chips.append(all);
        items.forEach(it => {
          const c = h('button', { type: 'button', class: 'chip' }, it.item + ' · ' + (it.short || ''));
          c.addEventListener('click', () => { state.item = it.item; btns.forEach(b => b.classList.toggle('is-on', b === c)); draw(); });
          btns.push(c); chips.append(c);
        });
        tools.append(chips);
      }
    }

    const toggles = h('div', { class: 'tx-toggles' });
    toggles.append(toggleChip('Mode rappel', 'eye-off', false, (on) => { state.recall = on; draw(); }));
    if (opts.table) toggles.append(toggleChip('Tableau comparatif', 'list', false, (on) => { state.table = on; draw(); }));
    tools.append(toggles);

    const cache = entries.map(e => ({ e, hay: haystack(e.tx) }));

    function draw() {
      const rows = cache.filter(({ e, hay }) => (!state.item || e.item === state.item) && (!state.query || matches(hay, state.query))).map(x => x.e);
      countEl.textContent = rows.length
        ? rows.length + (rows.length > 1 ? ' fiches' : ' fiche') + (state.query || state.item ? ' (filtrées)' : '')
        : '';
      body.replaceChildren();
      if (!rows.length) {
        body.append(h('div', { class: 'card' }, h('p', { class: 'empty' }, entries.length
          ? 'Aucune fiche ne correspond : essaie un autre mot ou enlève le filtre.'
          : 'Pas de fiche traitement ici pour l\'instant.')));
        return;
      }
      if (state.table) { body.append(comparisonTable(rows, !!opts.itemChips && !state.item)); return; }
      const grid = h('div', { class: 'tx-list' + (rows.length === 1 ? ' tx-list--single' : '') });
      rows.forEach(({ tx, item }) => grid.append(txCard(tx, { recall: state.recall, item })));
      body.append(grid);
    }
    draw();
    return wrap;
  }

  /* ------------------------------------------------------------------ */
  /* Pages                                                                 */
  /* ------------------------------------------------------------------ */

  async function renderItemPage(num) {
    injectStyle();
    const page = h('div', { class: 'page tx-page' });
    const content = await ensureItem(num);
    const meta = (content && content.meta) || itemMeta(num) || {};
    page.append(pageHead('Traitements', (meta.short ? meta.short + ' — ' : '') + (meta.title || 'Item ' + num)));
    if (!content) {
      page.append(h('div', { class: 'card' },
        h('p', { class: 'empty' }, 'Impossible de charger l\'item ' + num + '. Vérifie ta connexion puis réessaie.'),
        h('button', { type: 'button', class: 'btn btn--secondary btn--block', on: { click: () => go('#/item/' + num + '/traitements') } }, icon('refresh'), 'Réessayer')));
      return page;
    }
    const tr = content.treatments || {};
    const data = Array.isArray(tr.data) ? tr.data : [];
    const strats = Array.isArray(tr.strategies) ? tr.strategies : [];
    if (strats.length) page.append(strategiesBlock(strats));
    if (!data.length) {
      page.append(h('div', { class: 'card' }, h('p', { class: 'empty' }, 'Pas de fiche traitement pour cet item : la fiche de cours reste ta référence.')));
      return page;
    }
    if (strats.length) page.append(h('div', { class: 'tx-section' }, h('h3', { class: 'tx-section__title' }, 'Fiches par classe')));
    page.append(txBrowser(data.map(tx => ({ tx, item: num, short: meta.short })), { search: data.length > 6, itemChips: false, table: true }));
    return page;
  }

  function renderGlobalPage() {
    injectStyle();
    const page = h('div', { class: 'page tx-page tx-page--global' });
    const r = registry();
    const items = (r && typeof r.items === 'function') ? (r.items() || []) : [];
    const isLoaded = (n) => !!(r && typeof r.isLoaded === 'function' && r.isLoaded(n));
    const loaded = items.filter(m => isLoaded(String(m.num)));
    const allLoaded = items.length > 0 && loaded.length === items.length;

    const entries = [];
    loaded.forEach(m => {
      const num = String(m.num);
      const c = (typeof r.content === 'function') ? r.content(num) : null;
      const data = (c && c.treatments && Array.isArray(c.treatments.data)) ? c.treatments.data : [];
      data.forEach(tx => entries.push({ tx, item: num, short: m.short }));
    });

    page.append(pageHead('Traitements', entries.length
      ? entries.length + ' fiches sur ' + loaded.length + (loaded.length > 1 ? ' items chargés' : ' item chargé')
      : 'Toutes les classes du Collège, avec ce que le livre en dit'));

    if (!allLoaded) {
      const btn = h('button', { type: 'button', class: 'btn btn--primary btn--block' }, icon('download'), 'Charger tous les items');
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = 'Chargement…';
        try {
          if (r && typeof r.loadAll === 'function') await r.loadAll();
          else throw new Error('registry.loadAll indisponible');
          const fresh = renderGlobalPage();
          page.replaceChildren(...Array.from(fresh.childNodes));
        } catch (e) {
          console.warn('[treatments] loadAll a échoué', e);
          toast('Le chargement a échoué. Réessaie.', 'bad');
          btn.disabled = false; btn.replaceChildren(icon('download'), 'Charger tous les items');
        }
      });
      page.append(h('div', { class: 'card', style: 'margin-bottom:14px' },
        h('p', { style: 'margin:0 0 12px' }, items.length
          ? (loaded.length + ' item' + (loaded.length > 1 ? 's' : '') + ' chargé' + (loaded.length > 1 ? 's' : '') + ' sur ' + items.length + '. Charge le reste pour chercher dans toutes les classes.')
          : 'Le catalogue n\'est pas encore disponible.'),
        items.length ? btn : null));
    }

    if (!entries.length) {
      page.append(h('div', { class: 'card' }, h('p', { class: 'empty' },
        loaded.length ? 'Aucune fiche traitement dans les items chargés.' : 'Aucun item chargé : charge tous les items ou ouvre un item depuis la liste.')));
      return page;
    }
    page.append(txBrowser(entries, { search: true, itemChips: true, table: true }));
    return page;
  }

  function render(params) {
    params = params || {};
    const num = params.num != null ? params.num : params.item;
    try {
      if (num != null && num !== '') return renderItemPage(String(num));
      return renderGlobalPage();
    } catch (e) {
      console.warn('[treatments] render a échoué', e);
      return h('div', { class: 'page' }, h('div', { class: 'card' }, h('p', { class: 'empty' }, 'Une erreur est survenue en affichant les traitements.')));
    }
  }

  CARDIO.views.treatments = { render, renderRecall, renderCard: txCard, renderTable: comparisonTable };
})();
