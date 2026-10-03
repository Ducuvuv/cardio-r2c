/* CardioR2C — CARDIO.views.rubriques
 * Quatre rubriques de synthèse, par item et en bibliothèque globale :
 *   semio     Sémiologie                       #/item/:num/semio      #/semio
 *   criteres  Critères diagnostiques           #/item/:num/criteres   #/criteres
 *   chiffres  Données chiffrées (mode masqué)  #/item/:num/chiffres   #/chiffres
 *   physio    Physiopathologie par thèmes      #/item/:num/physio     #/physio
 * Données : content.extra = {semio:[{title,rank,content,src}], criteres:[…], chiffres:[{theme,label,value,rank,src}],
 * physio:[{theme,title,rank,content,src}]}.
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  CARDIO.views = CARDIO.views || {};

  const KINDS = {
    semio: { title: 'Sémiologie', short: 'Sémio', ico: 'eye', sub: 'Signes fonctionnels, physiques, formes cliniques et signes de gravité' },
    criteres: { title: 'Critères diagnostiques', short: 'Critères', ico: 'target', sub: 'Définitions, critères, seuils et scores diagnostiques' },
    chiffres: { title: 'Données chiffrées', short: 'Chiffres', ico: 'chart', sub: 'Tous les chiffres du cours, à connaître par cœur' },
    physio: { title: 'Physiopathologie', short: 'Physio', ico: 'layers', sub: 'Mécanismes, cascades et histoire naturelle, par thèmes' },
    parcours: { title: 'Prise en charge de A à Z', short: 'A → Z', ico: 'case', sub: 'Un patient suivi de l’arrivée à la sortie, étape par étape, avec tous les cas particuliers' },
    examens: { title: 'Gestes, imagerie & analyses', short: 'Examens', ico: 'search', sub: 'Indications, interprétation, contre-indications et pièges de chaque examen ou geste' }
  };
  const ORDER = ['parcours', 'semio', 'criteres', 'examens', 'chiffres', 'physio'];

  const U = () => CARDIO.util || {};
  const R = () => CARDIO.registry || null;

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    attrs = attrs || {};
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'on') { for (const e in v) el.addEventListener(e, v[e]); }
      else if (k === 'open') el.open = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    (function add(list) {
      list.forEach((c) => {
        if (c == null || c === false || c === true) return;
        if (Array.isArray(c)) add(c);
        else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
      });
    })(kids);
    return el;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function md(text) { const u = U(); return typeof u.md === 'function' ? u.md(String(text || '')) : '<p>' + esc(text) + '</p>'; }
  function mdInline(text) { const m = /^<p>([\s\S]*)<\/p>$/.exec(md(text).trim()); return m ? m[1] : md(text); }
  function icon(name) { const u = U(); return typeof u.icon === 'function' ? (u.icon(name) || '') : ''; }
  function norm(s) {
    const u = U();
    if (typeof u.normalize === 'function') return u.normalize(String(s || ''));
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function debounce(fn, ms) { let t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
  function rankPill(r) { return r === 'A' || r === 'B' ? h('span', { class: 'pill pill--' + r }, r) : null; }

  const CSS = `
  .rb{min-width:0}
  .rb-head{margin:0 0 12px}
  .rb-title{font:700 1.625rem/1.15 var(--font-display);margin:0;text-wrap:balance}
  .rb-sub{color:var(--muted);font-size:.875rem;margin:4px 0 0}
  .rb-tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:0 calc(-1*var(--gutter)) 12px;padding:0 var(--gutter) 2px}
  .rb-tabs::-webkit-scrollbar{display:none}
  .rb-tabs .chip{flex:none}
  .rb-tools{display:flex;flex-direction:column;gap:10px;margin-bottom:12px;min-width:0}
  .rb-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .rb-count{color:var(--muted);font-size:.8125rem}
  .rb-list{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}
  .rb-sec{background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1);min-width:0;max-width:100%}
  .rb-sec>summary{list-style:none;display:flex;align-items:center;gap:10px;padding:14px 16px;cursor:pointer;font:600 1.0625rem/1.3 var(--font-display);-webkit-tap-highlight-color:transparent}
  .rb-sec>summary::-webkit-details-marker{display:none}
  .rb-sec>summary::after{content:"";flex:none;width:8px;height:8px;margin-left:auto;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(45deg);transition:transform 160ms var(--ease)}
  .rb-sec[open]>summary::after{transform:rotate(-135deg)}
  .rb-sec__t{flex:1;min-width:0;overflow-wrap:anywhere}
  .rb-sec__body{padding:0 16px 14px;min-width:0;overflow-wrap:anywhere}
  .rb-sec__body .md-table{max-width:100%}
  .rb-src{display:block;margin-top:8px;font:500 .75rem/1.4 var(--font-mono);color:var(--muted)}
  .rb-group{margin:18px 0 8px;display:flex;align-items:baseline;gap:8px;justify-content:space-between}
  .rb-group:first-child{margin-top:0}
  .rb-group__t{font:700 1.0625rem/1.25 var(--font-display);margin:0;overflow-wrap:anywhere}
  .rb-group__n{color:var(--muted);font-size:.8125rem;flex:none}
  .rb-item{display:inline-block;font:600 .75rem/1.4 var(--font-mono);color:var(--muted);margin-right:4px}
  .rb-nums{background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1);overflow:hidden}
  .rb-num{display:grid;grid-template-columns:minmax(0,1fr);gap:4px;padding:12px 14px;border-top:1px solid var(--line)}
  .rb-num:first-child{border-top:0}
  .rb-num__label{font-size:.9375rem;line-height:1.4;color:var(--ink-2);overflow-wrap:anywhere}
  .rb-num__value{font-weight:700;font-size:1.0625rem;line-height:1.35;color:var(--ink);font-variant-numeric:tabular-nums;overflow-wrap:anywhere;border-radius:6px;transition:filter 160ms var(--ease),background 160ms var(--ease)}
  .rb-num__meta{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .rb-num__value.is-masked{filter:blur(7px);background:var(--surface-2);cursor:pointer;user-select:none;-webkit-user-select:none}
  .rb-search{position:relative}
  .rb-search .ico{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--muted);display:flex;pointer-events:none}
  .rb-search input{width:100%;min-height:44px;border:1px solid var(--line);border-radius:var(--r-s);background:var(--surface);color:var(--ink);font:inherit;padding:8px 12px 8px 40px}
  .rb-empty{color:var(--muted);text-align:center;padding:24px 8px}
  .rb-hubs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .rb-hub{display:flex;flex-direction:column;gap:6px;text-decoration:none;color:inherit;background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1);padding:14px;min-height:88px}
  .rb-hub .ico{color:var(--accent);display:inline-flex}
  .rb-hub b{font:700 .9375rem/1.2 var(--font-display)}
  .rb-hub span{font-size:.75rem;color:var(--muted)}
  @media (min-width:720px){.rb-hubs{grid-template-columns:repeat(4,minmax(0,1fr))}}
  .pc-bar{position:sticky;top:0;z-index:5;background:var(--bg);padding:6px 0;margin:0 0 10px;border-bottom:1px solid var(--line)}
  .pc-bar__row{display:flex;gap:6px;align-items:center;min-width:0}
  .pc-bar .seg__btn{padding:0 10px;min-height:32px;font-size:.8125rem}
  .pc-bar .btn--sm{min-height:32px;padding:4px 8px;font-size:.8125rem}
  .pc-prog{font-size:.75rem;color:var(--muted);margin-left:auto;white-space:nowrap;font-variant-numeric:tabular-nums}
  .pc-pick{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;margin:0 calc(-1*var(--gutter));padding:0 var(--gutter) 2px}
  .pc-pick::-webkit-scrollbar{display:none}
  .pc-pick{margin-bottom:10px}
  .pc-pick .chip{flex:none;white-space:normal;text-align:left;line-height:1.25;padding:6px 12px;max-width:200px;font-size:.8125rem;min-height:40px}
  .pc-patient{border-left:4px solid var(--accent);background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1);padding:14px 16px;margin-bottom:12px}
  .pc-patient__cap{font-size:.75rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);margin-bottom:6px;display:flex;gap:8px;align-items:center}
  .pc-steps{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;counter-reset:pc}
  .pc-step{background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1);padding:14px 16px;min-width:0}
  .pc-step__phase{display:flex;align-items:center;gap:8px;font-size:.75rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
  .pc-step__n{display:inline-grid;place-items:center;min-width:24px;height:24px;border-radius:12px;background:var(--ink);color:var(--surface);font-size:.75rem;letter-spacing:0}
  .pc-step__t{font:700 1.0625rem/1.3 var(--font-display);margin:0 0 6px;overflow-wrap:anywhere}
  .pc-step__q{font-weight:600;color:var(--blue);margin:0 0 10px;overflow-wrap:anywhere}
  .pc-ans{position:relative;min-width:0;overflow-wrap:anywhere}
  .pc-ans__inner{transition:filter 180ms var(--ease)}
  .pc-ans.is-blur .pc-ans__inner{filter:blur(8px);user-select:none;-webkit-user-select:none;pointer-events:none;max-height:180px;overflow:hidden}
  .pc-ans__veil{display:none}
  .pc-ans.is-blur .pc-ans__veil{display:flex;position:absolute;inset:0;align-items:center;justify-content:center;gap:8px;flex-direction:column;background:transparent;border:0;cursor:pointer;color:var(--ink);font:600 .9375rem var(--font-body);-webkit-tap-highlight-color:transparent}
  .pc-ans__veil span{background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:8px 16px;box-shadow:var(--shadow-2);display:inline-flex;gap:6px;align-items:center}
  .pc-ans__veil small{color:var(--muted);font-weight:500;background:var(--surface);padding:2px 8px;border-radius:6px}
  .pc-cas{margin-top:10px;display:grid;gap:8px}
  .pc-cas__i{border-left:3px solid var(--blue);background:var(--blue-soft);border-radius:0 var(--r-s) var(--r-s) 0;padding:8px 12px}
  .pc-cas__si{font-weight:700;margin-bottom:2px}
  .pc-pit{margin-top:10px;border-left:3px solid var(--warn);background:var(--warn-soft);border-radius:0 var(--r-s) var(--r-s) 0;padding:8px 12px}
  .pc-pit b{color:var(--warn);font-size:.75rem;letter-spacing:.06em;text-transform:uppercase;display:block;margin-bottom:2px}
  .pc-pit ul{margin:0;padding-left:18px}
  .pc-hide{margin-top:8px}
  .pc-ans.is-blur + .pc-hide{display:none}
  .pc-idx{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
  .pc-idx a{display:flex;gap:10px;align-items:center;text-decoration:none;color:inherit;background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1);padding:12px 14px}
  .pc-idx a b{display:block;font:700 .9375rem/1.3 var(--font-display)}
  .pc-idx a span{font-size:.8125rem;color:var(--muted)}
  `;
  function injectStyle() {
    if (document.getElementById('style-view-rubriques')) return;
    const s = document.createElement('style');
    s.id = 'style-view-rubriques';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------- blocs ---------- */

  function sectionCard(entry, opts) {
    const det = h('details', { class: 'rb-sec', open: !!opts.open });
    det.append(
      h('summary', null, rankPill(entry.rank),
        opts.itemLabel ? h('span', { class: 'rb-item' }, opts.itemLabel) : null,
        h('span', { class: 'rb-sec__t' }, entry.title || 'Fiche')),
      h('div', { class: 'rb-sec__body' },
        h('div', { class: 'md', html: md(entry.content) }),
        entry.src ? h('span', { class: 'rb-src' }, entry.src) : null));
    return det;
  }

  function numberRow(n, masked, itemLabel) {
    const val = h('div', { class: 'rb-num__value' + (masked ? ' is-masked' : ''), html: mdInline(n.value), role: masked ? 'button' : null, tabindex: masked ? '0' : null, 'aria-label': masked ? 'Révéler la valeur' : null });
    if (masked) {
      const reveal = () => { val.classList.remove('is-masked'); val.removeAttribute('role'); val.removeAttribute('aria-label'); };
      val.addEventListener('click', reveal);
      val.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal(); } });
    }
    return h('div', { class: 'rb-num' },
      h('div', { class: 'rb-num__label', html: (itemLabel ? '<span class="rb-item">' + esc(itemLabel) + '</span>' : '') + mdInline(n.label) }),
      val,
      h('div', { class: 'rb-num__meta' }, rankPill(n.rank), n.src ? h('span', { class: 'rb-src', style: 'margin:0' }, n.src) : null));
  }

  function groupBy(list, keyFn) {
    const map = new Map();
    list.forEach((x) => { const k = keyFn(x) || 'Autres'; if (!map.has(k)) map.set(k, []); map.get(k).push(x); });
    return map;
  }

  /* entries = [{e, item, short}] */
  function browser(kind, entries, opts) {
    const state = { rank: null, q: '', masked: false, openAll: false, item: null };
    const wrap = h('div', { class: 'rb' });
    const tools = h('div', { class: 'rb-tools' });
    const count = h('div', { class: 'rb-count' });
    const body = h('div');
    wrap.append(tools, count, body);

    const searchIn = h('input', { type: 'search', placeholder: kind === 'chiffres' ? 'Chercher un chiffre, un seuil…' : 'Chercher dans les fiches…', 'aria-label': 'Rechercher', autocomplete: 'off' });
    searchIn.addEventListener('input', debounce(() => { state.q = searchIn.value; draw(); }, 120));
    tools.append(h('div', { class: 'rb-search' }, h('span', { class: 'ico', html: icon('search') }), searchIn));

    const row = h('div', { class: 'rb-row' });
    const rankChips = [['Tous', null], ['Rang A', 'A'], ['Rang B', 'B']].map(([label, r]) => {
      const c = h('button', { type: 'button', class: 'chip' + (r === null ? ' is-on' : '') }, label);
      c.addEventListener('click', () => { state.rank = r; rankChips.forEach((x) => x.classList.toggle('is-on', x === c)); draw(); });
      return c;
    });
    row.append(...rankChips);
    if (kind === 'chiffres') {
      const m = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false' }, h('span', { class: 'ico', html: icon('eye'), style: 'display:inline-flex' }), 'Masquer les valeurs');
      m.addEventListener('click', () => { state.masked = !state.masked; m.classList.toggle('is-on', state.masked); m.setAttribute('aria-pressed', String(state.masked)); draw(); });
      row.append(m);
    } else {
      const o = h('button', { type: 'button', class: 'chip' }, 'Tout déplier');
      o.addEventListener('click', () => { state.openAll = !state.openAll; o.classList.toggle('is-on', state.openAll); o.textContent = state.openAll ? 'Tout replier' : 'Tout déplier'; draw(); });
      row.append(o);
    }
    tools.append(row);

    if (opts.global) {
      const items = [];
      const seen = new Set();
      entries.forEach((x) => { if (!seen.has(x.item)) { seen.add(x.item); items.push(x); } });
      if (items.length > 1) {
        const chips = h('div', { class: 'rb-tabs', style: 'margin-bottom:0' });
        const all = h('button', { type: 'button', class: 'chip is-on' }, 'Tous les items');
        const btns = [all];
        all.addEventListener('click', () => { state.item = null; btns.forEach((b) => b.classList.toggle('is-on', b === all)); draw(); });
        chips.append(all);
        items.forEach((x) => {
          const c = h('button', { type: 'button', class: 'chip' }, x.item + ' · ' + (x.short || ''));
          c.addEventListener('click', () => { state.item = x.item; btns.forEach((b) => b.classList.toggle('is-on', b === c)); draw(); });
          btns.push(c); chips.append(c);
        });
        tools.append(chips);
      }
    }

    const hay = entries.map((x) => norm([x.e.title, x.e.theme, x.e.label, x.e.value, x.e.content].join(' ')));

    function draw() {
      const words = norm(state.q).split(' ').filter(Boolean);
      const rows = entries.filter((x, i) =>
        (!state.rank || x.e.rank === state.rank) &&
        (!state.item || x.item === state.item) &&
        words.every((w) => hay[i].indexOf(w) >= 0));
      const unit = kind === 'chiffres' ? ['donnée', 'données'] : ['fiche', 'fiches'];
      count.textContent = rows.length + ' ' + (rows.length > 1 ? unit[1] : unit[0]) + (rows.length !== entries.length ? ' (filtrées)' : '');
      body.replaceChildren();
      if (!rows.length) { body.append(h('div', { class: 'card' }, h('p', { class: 'rb-empty' }, entries.length ? 'Rien ne correspond : essaie un autre mot ou enlève un filtre.' : 'Pas encore de contenu ici.'))); return; }
      const lbl = (x) => (opts.global && !state.item ? x.item : null);
      const searching = words.length > 0;

      if (kind === 'chiffres') {
        const groups = opts.global && !state.item ? groupBy(rows, (x) => 'Item ' + x.item + ' · ' + (x.short || '')) : groupBy(rows, (x) => x.e.theme);
        groups.forEach((list, key) => {
          body.append(h('div', { class: 'rb-group' }, h('h3', { class: 'rb-group__t' }, key), h('span', { class: 'rb-group__n' }, String(list.length))));
          const box = h('div', { class: 'rb-nums' });
          list.forEach((x) => box.append(numberRow(x.e, state.masked, opts.global && !state.item && x.e.theme ? x.e.theme : null)));
          body.append(box);
        });
        return;
      }
      if (kind === 'physio' || kind === 'examens') {
        const groups = kind === 'physio' && opts.global && !state.item
          ? groupBy(rows, (x) => x.sec || 'Autres')
          : groupBy(rows, (x) => x.e.theme);
        groups.forEach((list, key) => {
          body.append(h('div', { class: 'rb-group' }, h('h3', { class: 'rb-group__t' }, key), h('span', { class: 'rb-group__n' }, String(list.length))));
          const grid = h('div', { class: 'rb-list' });
          list.forEach((x, i) => grid.append(sectionCard(opts.global && !state.item && x.e.theme ? Object.assign({}, x.e, { title: x.short + ' · ' + x.e.theme + ' — ' + (x.e.title || '') }) : x.e, { open: state.openAll || searching || (!opts.global && rows.length <= 3 && i === 0), itemLabel: opts.global && !state.item && x.e.theme ? null : lbl(x) })));
          body.append(grid);
        });
        return;
      }
      if (opts.global && !state.item) {
        groupBy(rows, (x) => 'Item ' + x.item + ' · ' + (x.short || '')).forEach((list, key) => {
          body.append(h('div', { class: 'rb-group' }, h('h3', { class: 'rb-group__t' }, key), h('span', { class: 'rb-group__n' }, String(list.length))));
          const grid = h('div', { class: 'rb-list' });
          list.forEach((x) => grid.append(sectionCard(x.e, { open: state.openAll || searching })));
          body.append(grid);
        });
        return;
      }
      const grid = h('div', { class: 'rb-list' });
      rows.forEach((x, i) => grid.append(sectionCard(x.e, { open: state.openAll || searching || i === 0 })));
      body.append(grid);
    }
    draw();
    return wrap;
  }

  /* ---------- Prise en charge de A à Z ---------- */
  const LS_BLUR = 'cardio.r2c.pcBlur';
  function getBlur() { try { const v = localStorage.getItem(LS_BLUR); return v == null ? true : v === '1'; } catch (e) { return true; } }
  function setBlur(v) { try { localStorage.setItem(LS_BLUR, v ? '1' : '0'); } catch (e) { /* ignore */ } }

  function parcoursView(list, startIdx) {
    const wrap = h('div', { class: 'rb pc' });
    if (!list.length) { wrap.append(h('div', { class: 'card' }, h('p', { class: 'rb-empty' }, 'Pas encore de parcours pour cet item.'))); return wrap; }
    let cur = Math.min(Math.max(0, startIdx || 0), list.length - 1);
    let blur = getBlur();
    const pickHost = h('div');
    const bar = h('div', { class: 'pc-bar' });
    const body = h('div');
    wrap.append(pickHost, bar, body);

    function drawBar(stats) {
      bar.replaceChildren();
      pickHost.replaceChildren();
      if (list.length > 1) {
        const pick = h('div', { class: 'pc-pick', role: 'tablist', 'aria-label': 'Parcours' });
        list.forEach((p, i) => {
          const c = h('button', { type: 'button', class: 'chip' + (i === cur ? ' is-on' : ''), role: 'tab', 'aria-selected': String(i === cur) }, (i + 1) + '. ' + (p.title || 'Parcours'));
          c.addEventListener('click', () => { cur = i; draw(); try { document.getElementById('view').scrollTop = 0; } catch (e) { /* ignore */ } });
          pick.append(c);
        });
        pickHost.append(pick);
      }
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Affichage' });
      [['Flou', true], ['Normal', false]].forEach(([label, v]) => {
        const b = h('button', { type: 'button', class: 'seg__btn' + (blur === v ? ' is-on' : ''), 'aria-pressed': String(blur === v) }, label);
        b.addEventListener('click', () => { if (blur === v) return; blur = v; setBlur(v); draw(); });
        seg.append(b);
      });
      const row = h('div', { class: 'pc-bar__row' }, seg);
      if (blur) {
        const all = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, 'Tout voir');
        all.addEventListener('click', () => { body.querySelectorAll('.pc-ans.is-blur').forEach((a) => a.classList.remove('is-blur')); update(); });
        const reset = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, 'Cacher');
        reset.addEventListener('click', () => { body.querySelectorAll('.pc-ans').forEach((a) => a.classList.add('is-blur')); update(); });
        row.append(all, reset);
      }
      row.append(h('span', { class: 'pc-prog' }, stats || ''));
      bar.append(row);
    }

    function update() {
      const total = body.querySelectorAll('.pc-ans').length;
      const hidden = body.querySelectorAll('.pc-ans.is-blur').length;
      const prog = bar.querySelector('.pc-prog');
      if (prog) prog.textContent = blur ? (total - hidden) + '/' + total : total + ' étapes';
    }

    function stepEl(s, i) {
      const inner = h('div', { class: 'pc-ans__inner' });
      inner.append(h('div', { class: 'md', html: md(s.answer) }));
      const cas = Array.isArray(s.cas) ? s.cas.filter((c) => c && (c.si || c.alors)) : [];
      if (cas.length) {
        const box = h('div', { class: 'pc-cas' }, h('div', { class: 'caption' }, 'Cas particuliers'));
        cas.forEach((c) => box.append(h('div', { class: 'pc-cas__i' }, h('div', { class: 'pc-cas__si', html: mdInline(c.si || '') }), h('div', { class: 'md', html: md(c.alors || '') }))));
        inner.append(box);
      }
      const pit = Array.isArray(s.pieges) ? s.pieges.filter(Boolean) : [];
      if (pit.length) inner.append(h('div', { class: 'pc-pit' }, h('b', null, 'Pièges'), h('ul', null, pit.map((p) => h('li', { html: mdInline(p) })))));
      if (s.src) inner.append(h('span', { class: 'rb-src' }, s.src));
      const ans = h('div', { class: 'pc-ans' + (blur ? ' is-blur' : '') }, inner);
      const veil = h('button', { type: 'button', class: 'pc-ans__veil', 'aria-label': 'Révéler la réponse' },
        h('span', { html: icon('eye') + 'Révéler' }), h('small', null, 'Réfléchis d’abord à ta réponse'));
      veil.addEventListener('click', () => { ans.classList.remove('is-blur'); update(); });
      ans.append(veil);
      const hide = blur ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm pc-hide' }, 'Recacher') : null;
      if (hide) hide.addEventListener('click', () => { ans.classList.add('is-blur'); update(); });
      return h('article', { class: 'pc-step' },
        h('div', { class: 'pc-step__phase' }, h('span', { class: 'pc-step__n' }, String(i + 1)), s.phase || 'Étape'),
        h('h3', { class: 'pc-step__t' }, s.title || ''),
        s.question ? h('p', { class: 'pc-step__q', html: mdInline(s.question) }) : null,
        ans, hide);
    }

    function draw() {
      const p = list[cur];
      drawBar();
      body.replaceChildren();
      body.append(h('div', { class: 'pc-patient' },
        h('div', { class: 'pc-patient__cap' }, rankPill(p.rank), 'Ton patient · ' + (p.title || '')),
        h('div', { class: 'md', html: md(p.patient || '') })));
      const steps = h('div', { class: 'pc-steps' });
      (p.steps || []).forEach((s, i) => steps.append(stepEl(s, i)));
      body.append(steps);
      if (list.length > 1 && cur < list.length - 1) {
        const next = h('button', { type: 'button', class: 'btn btn--secondary btn--block', style: 'margin-top:14px' }, 'Parcours suivant : ' + (list[cur + 1].title || ''));
        next.addEventListener('click', () => { cur += 1; draw(); try { document.getElementById('view').scrollTop = 0; } catch (e) { /* ignore */ } });
        body.append(next);
      }
      update();
    }
    draw();
    return wrap;
  }

  function parcoursIndex(entries) {
    const box = h('div');
    groupBy(entries, (x) => 'Item ' + x.item + ' · ' + (x.short || '')).forEach((list, key) => {
      box.append(h('div', { class: 'rb-group' }, h('h3', { class: 'rb-group__t' }, key), h('span', { class: 'rb-group__n' }, String(list.length))));
      const idx = h('div', { class: 'pc-idx' });
      list.forEach((x) => idx.append(h('a', { href: '#/item/' + x.item + '/parcours?p=' + x.i },
        rankPill(x.e.rank),
        h('div', { style: 'min-width:0' }, h('b', null, x.e.title || 'Parcours'), h('span', null, (x.e.steps || []).length + ' étapes')))));
      box.append(idx);
    });
    return box;
  }

  function kindTabs(kind, num) {
    const tabs = h('div', { class: 'rb-tabs', role: 'navigation', 'aria-label': 'Rubriques' });
    ORDER.forEach((k) => {
      tabs.append(h('a', { class: 'chip' + (k === kind ? ' is-on' : ''), href: num ? '#/item/' + num + '/' + k : '#/' + k, 'aria-current': k === kind ? 'page' : null }, KINDS[k].short));
    });
    return tabs;
  }

  function head(kind, sub) {
    return h('header', { class: 'rb-head' }, h('h2', { class: 'rb-title' }, KINDS[kind].title), h('p', { class: 'rb-sub' }, sub || KINDS[kind].sub));
  }

  async function renderItem(kind, num, query) {
    const page = h('div', { class: 'page rb-page' });
    const reg = R();
    let content = null;
    try { if (reg) { await reg.load(num); content = reg.content(num); } } catch (e) { console.warn('[rubriques]', e); }
    const meta = (content && content.meta) || (reg && reg.item(num)) || {};
    page.append(kindTabs(kind, num), head(kind, (meta.short ? meta.short + ' — ' : '') + KINDS[kind].sub));
    if (!content) {
      page.append(h('div', { class: 'card' }, h('p', { class: 'rb-empty' }, 'Impossible de charger l’item ' + num + '. Vérifie ta connexion puis réessaie.')));
      return { el: page, title: (meta.short || 'Item ' + num) + ' · ' + KINDS[kind].short };
    }
    if (kind === 'parcours') {
      page.append(parcoursView((content.extra || {}).parcours || [], Number(query && query.p) || 0));
      return { el: page, title: (meta.short || 'Item ' + num) + ' · ' + KINDS[kind].short };
    }
    const list = ((content.extra || {})[kind] || []).map((e) => ({ e, item: String(num), short: meta.short }));
    page.append(browser(kind, list, { global: false }));
    return { el: page, title: (meta.short || 'Item ' + num) + ' · ' + KINDS[kind].short };
  }

  function renderGlobal(kind) {
    const page = h('div', { class: 'page rb-page' });
    const reg = R();
    const items = reg ? reg.items() : [];
    const loaded = items.filter((m) => reg.isLoaded(String(m.num)));
    page.append(kindTabs(kind, null), head(kind));
    if (loaded.length < items.length) {
      const btn = h('button', { type: 'button', class: 'btn btn--primary btn--block' }, 'Charger les ' + items.length + ' items');
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = 'Chargement…';
        try { await reg.loadAll({ spe: 'cardio' }); } catch (e) { console.warn(e); }
        page.replaceChildren(...Array.from(renderGlobal(kind).childNodes));
      });
      page.append(h('div', { class: 'card', style: 'margin-bottom:12px' },
        h('p', { style: 'margin:0 0 12px' }, loaded.length + ' item' + (loaded.length > 1 ? 's' : '') + ' chargé' + (loaded.length > 1 ? 's' : '') + ' sur ' + items.length + '. Charge tout pour avoir la rubrique complète.'), btn));
      // Chargement automatique en tâche de fond
      setTimeout(() => { if (document.body.contains(btn) && !btn.disabled) btn.click(); }, 50);
    }
    const entries = [];
    loaded.forEach((m) => {
      const c = reg.content(String(m.num));
      const sec = m.section ? (m.section + ' · ' + (m.sectionTitle || (reg.sectionTitle ? reg.sectionTitle(m.section) : ''))) : '';
      ((c && c.extra && c.extra[kind]) || []).forEach((e, i) => entries.push({ e, i, item: String(m.num), short: m.short, sec }));
    });
    if (kind === 'parcours') { if (entries.length) page.append(parcoursIndex(entries)); return page; }
    if (entries.length || loaded.length === items.length) page.append(browser(kind, entries, { global: true }));
    return page;
  }

  function render(params, query) {
    injectStyle();
    params = params || {};
    const kind = KINDS[params.kind] ? params.kind : 'semio';
    if (params.num) return renderItem(kind, String(params.num), query || {});
    return { el: renderGlobal(kind), title: KINDS[kind].title };
  }

  /* Petit bloc « rubriques de synthèse » réutilisable (accueil, hub). */
  function hubLinks(num, counts) {
    injectStyle();
    const c = counts || {};
    return h('div', { class: 'rb-hubs' }, ORDER.map((k) => {
      const n = num ? Number(c[k]) || 0 : null;
      return h('a', { class: 'rb-hub', href: num ? '#/item/' + num + '/' + k : '#/' + k },
        h('span', { class: 'ico', html: icon(KINDS[k].ico) }),
        h('b', null, KINDS[k].title),
        h('span', null, n == null ? 'Tous les items' : n + (k === 'chiffres' ? ' donnée' : k === 'parcours' ? ' parcours' : ' fiche') + (n > 1 && k !== 'parcours' ? 's' : '')));
    }));
  }

  CARDIO.views.rubriques = { render, hubLinks, KINDS };
})();
