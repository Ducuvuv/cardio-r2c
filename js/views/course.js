/* CardioR2C — views/course.js
 * Fiche de cours d'un item (#/item/:num/cours et #/item/:num/mnemos) : sections en accordéons,
 * filtre de rang, sections lues (store.itemStats[num].readSections), chiffres clés, essentiel,
 * moyens mnémotechniques. Le contenu est chargé paresseusement via CARDIO.registry.load.
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  CARDIO.views = CARDIO.views || {};

  /* ---------- Accès défensif aux modules ---------- */

  function util() { return CARDIO.util || {}; }
  function store() { return CARDIO.store || null; }
  function registry() { return CARDIO.registry || null; }

  function flat(list, out) {
    out = out || [];
    list.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) flat(c, out); else out.push(c);
    });
    return out;
  }

  function fallbackH(tag, attrs) {
    const el = document.createElement(tag);
    const a = attrs || {};
    Object.keys(a).forEach(function (k) {
      const v = a[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.keys(v).forEach(function (d) { el.dataset[d] = v[d]; });
      else if (k === 'on') Object.keys(v).forEach(function (e) { el.addEventListener(e, v[e]); });
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    flat(Array.prototype.slice.call(arguments, 2)).forEach(function (c) {
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return el;
  }

  function h(tag, attrs) {
    const kids = flat(Array.prototype.slice.call(arguments, 2));
    const u = util();
    if (typeof u.h === 'function') return u.h.apply(null, [tag, attrs || {}].concat(kids));
    if (!h.warned) { h.warned = true; console.warn('[course] CARDIO.util.h absent : rendu de repli'); }
    return fallbackH.apply(null, [tag, attrs].concat(kids));
  }

  function esc(s) {
    const u = util();
    if (typeof u.esc === 'function') return u.esc(String(s == null ? '' : s));
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Rendu markdown-lite ; repli : texte échappé en paragraphes (jamais de HTML brut). */
  function md(text) {
    const u = util();
    if (typeof u.md === 'function') { try { return u.md(String(text == null ? '' : text)); } catch (e) { console.warn('[course] md', e); } }
    return String(text == null ? '' : text).split(/\n{2,}/).map(function (p) { return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>'; }).join('');
  }

  function mdEl(text, cls) { return h('div', { class: 'md ' + (cls || ''), html: md(text) }); }

  function icon(name) {
    const u = util();
    if (typeof u.icon === 'function') { try { return u.icon(name) || ''; } catch (e) { /* ignore */ } }
    return '';
  }
  function iconEl(name, cls) { return h('span', { class: 'ico ' + (cls || ''), 'aria-hidden': 'true', html: icon(name) }); }

  function safe(fn, fallback) {
    try { const v = fn(); return v === undefined ? fallback : v; } catch (e) { console.warn('[course]', e); return fallback; }
  }
  function state() { const s = store(); return (s && s.state) || {}; }
  function str(v) { return v === undefined || v === null ? '' : String(v); }
  function reducedMotion() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

  /* ---------- Préférences locales (par lecteur, non critiques) ---------- */

  function lsGet(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* mode privé : on ignore */ }
  }
  const LS_RANK = 'cardio.r2c.fiche.rank';
  function lsOpenKey(num) { return 'cardio.r2c.fiche.' + num + '.open'; }

  /* ---------- Sections lues (store) ---------- */

  function readSections(num) {
    const st = state();
    const is = (st.itemStats || {})[num];
    return is && Array.isArray(is.readSections) ? is.readSections.slice() : [];
  }

  function setRead(num, secId, read) {
    const s = store();
    if (!s) return;
    const apply = function (st) {
      st.itemStats = st.itemStats || {};
      const is = st.itemStats[num] = st.itemStats[num] || { sessions: 0 };
      const list = Array.isArray(is.readSections) ? is.readSections : [];
      const idx = list.indexOf(secId);
      if (read && idx < 0) list.push(secId);
      if (!read && idx >= 0) list.splice(idx, 1);
      is.readSections = list;
    };
    try {
      if (typeof s.update === 'function') s.update(apply);
      else if (s.state) { apply(s.state); if (typeof s.save === 'function') s.save(); }
    } catch (e) { console.warn('[course] readSections', e); }
  }

  /* ---------- Styles (tokens uniquement) ---------- */

  const CSS = [
    '.fiche__bar{position:sticky;top:0;z-index:5;background:var(--bg);padding:8px 0 10px;margin-bottom:8px;border-bottom:1px solid var(--line)}',
    '.fiche__bar-row{display:flex;align-items:center;gap:8px;overflow-x:auto;scrollbar-width:none}',
    '.fiche__bar-row::-webkit-scrollbar{display:none}',
    '.fiche__chip{flex:0 0 auto;min-height:36px}',
    '.fiche__meta{display:flex;justify-content:space-between;gap:12px;font-size:.75rem;color:var(--muted);margin-top:8px;font-variant-numeric:tabular-nums}',
    '.fiche__meta b{color:var(--ink);font-weight:600}',
    '.fiche__head{padding:6px 0 12px}',
    '.fiche__kicker{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:4px}',
    '.fiche__h1{font:700 1.5rem/1.15 var(--font-display);margin:0;text-wrap:balance}',
    '.fiche__pages{font-size:.75rem;color:var(--muted);margin-top:4px}',
    '.fiche__sec{background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1);margin-bottom:10px;overflow:hidden}',
    '.fiche__sec[data-rank="B"]{border-left:3px solid var(--blue)}',
    '.fiche__sec[data-rank="A"]{border-left:3px solid var(--rankA)}',
    '.fiche__sec>summary{list-style:none;display:flex;align-items:center;gap:10px;padding:14px 16px;cursor:pointer;min-height:44px;font:700 1.0625rem/1.25 var(--font-display)}',
    '.fiche__sec>summary::-webkit-details-marker{display:none}',
    '.fiche__sec>summary:focus-visible{outline:2px solid var(--blue);outline-offset:-2px}',
    '.fiche__sum-title{flex:1;min-width:0;overflow-wrap:anywhere}',
    '.fiche__sum-read{color:var(--ok);display:none}',
    '.fiche__sec.is-read .fiche__sum-read{display:inline-flex}',
    '.fiche__chev{color:var(--muted);transition:transform .2s cubic-bezier(.2,.7,.2,1)}',
    '.fiche__sec[open] .fiche__chev{transform:rotate(180deg)}',
    '.fiche__sec-body{padding:0 16px 16px}',
    '.fiche__sec-body .md>:first-child{margin-top:0}',
    '.fiche__sub{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:16px 0 6px}',
    '.fiche__sec-body .kp{margin:0;padding-left:20px}',
    '.fiche__sec-body .kp li{margin:4px 0}',
    '.fiche__sec-body .pitfall{background:var(--warn-soft);border-radius:var(--r-s);padding:10px 12px 10px 30px;margin:0}',
    '.fiche__sec-body .pitfall li{margin:4px 0}',
    '.fiche__foot{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:16px;padding-top:12px;border-top:1px solid var(--line)}',
    '.fiche__src{font-size:.75rem;color:var(--muted)}',
    '.fiche__foot-btns{display:flex;gap:8px;flex-wrap:wrap}',
    '.fiche__foot .btn .ico{display:inline-flex;margin-right:6px}',
    '.ico svg{width:18px;height:18px;display:block}',
    '.fiche__h2{font:700 1.25rem/1.3 var(--font-display);margin:24px 0 10px;display:flex;align-items:baseline;gap:10px}',
    '.fiche__h2 small{font:500 .75rem var(--font-body);color:var(--muted)}',
    '.fiche__table{width:100%;border-collapse:collapse;font-size:.875rem;background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1);overflow:hidden}',
    '.fiche__table th{text-align:left;font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:500;padding:10px 12px;border-bottom:1px solid var(--line)}',
    '.fiche__table td{padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}',
    '.fiche__table tr:last-child td{border-bottom:0}',
    '.fiche__table td.fiche__val{font-weight:600;font-variant-numeric:tabular-nums}',
    '.fiche__table td.fiche__rk{width:32px;padding-right:0}',
    '.fiche__ess{list-style:none;padding:0;margin:0;display:grid;gap:6px}',
    '.fiche__ess li{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:start;background:var(--surface);border-radius:var(--r-s);padding:10px 12px;box-shadow:var(--shadow-1)}',
    '.fiche__ess .pill{margin-top:2px}',
    '.fiche__mn-grid{display:grid;gap:10px}',
    '.fiche__mn{background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1);padding:14px 16px}',
    '.fiche__mn-top{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:.875rem;color:var(--muted)}',
    '.fiche__mn-word{font:700 1.375rem/1.2 var(--font-display);margin:0 0 8px;color:var(--accent);letter-spacing:.01em;overflow-wrap:anywhere}',
    '.fiche__mn .md{font-size:.9375rem}',
    '.fiche__mn-src{font-size:.75rem;color:var(--muted);margin-top:8px}',
    '.fiche__cta{margin:12px 0 4px}',
    '.fiche__cta .btn .ico{display:inline-flex;margin-right:8px}',
    '.fiche__empty{color:var(--muted);font-size:.875rem;margin:4px 0 12px}',
    '.fiche__none{display:none;color:var(--muted);font-size:.875rem;padding:12px;background:var(--surface-2);border-radius:var(--r-s);margin-bottom:10px}',
    '.fiche__skel{display:grid;gap:10px;padding-top:12px}',
    '.fiche__skel span{display:block;height:18px;border-radius:8px;background:var(--surface-2);animation:fiche-pulse 1.2s ease-in-out infinite}',
    '.fiche__skel span:nth-child(1){width:60%;height:26px}.fiche__skel span:nth-child(3){width:85%}.fiche__skel span:nth-child(5){width:70%}',
    '@keyframes fiche-pulse{0%,100%{opacity:.6}50%{opacity:1}}',
    '.fiche__err{background:var(--bad-soft);border-radius:var(--r-m);padding:16px;display:grid;gap:10px}',
    '.fiche__err p{margin:0}',
    '.fiche__objsum{display:flex;gap:6px;align-items:center}',
    /* filtre de rang : masque sections, lignes et pastilles inline de l'autre rang */
    '.fiche[data-rank="A"] .fiche__body [data-rank="B"]{display:none}',
    '.fiche[data-rank="B"] .fiche__body [data-rank="A"]{display:none}',
    '.fiche[data-rank="A"] .fiche__body .pill--B{display:none}',
    '.fiche[data-rank="B"] .fiche__body .pill--A{display:none}',
    '.fiche[data-rank="A"] .fiche__none--A,.fiche[data-rank="B"] .fiche__none--B{display:block}',
    '@media (min-width:720px){.fiche__mn-grid{grid-template-columns:1fr 1fr}}',
    '@media (prefers-reduced-motion:reduce){.fiche__chev,.fiche__skel span{transition:none;animation:none}}'
  ].join('\n');

  function ensureStyles() {
    if (document.getElementById('course-view-css')) return;
    const s = document.createElement('style');
    s.id = 'course-view-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------- Composants ---------- */

  function rankPill(rank) { const r = rank === 'B' ? 'B' : 'A'; return h('span', { class: 'pill pill--' + r }, r); }

  function testUrl(num, objectiveIds) {
    const ids = (objectiveIds || []).filter(Boolean).map(encodeURIComponent).join(',');
    return '#/review?mode=item&item=' + num + (ids ? '&objective=' + ids : '') + '&autostart=1';
  }

  function sectionEl(num, sec, index, ctx) {
    const isRead = ctx.read.indexOf(sec.id) >= 0;
    const openPref = ctx.open;
    const open = openPref ? openPref.indexOf(sec.id) >= 0 : index === 0;
    const det = h('details', { class: 'fiche__sec' + (isRead ? ' is-read' : ''), dataset: { rank: sec.rank === 'B' ? 'B' : 'A', id: sec.id }, id: 'sec-' + sec.id });
    if (open) det.open = true;

    const readBtn = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, iconEl('check'), isRead ? 'Lue' : 'Marquer comme lue');
    readBtn.setAttribute('aria-pressed', isRead ? 'true' : 'false');
    function applyRead(val) {
      det.classList.toggle('is-read', val);
      readBtn.lastChild.textContent = val ? 'Lue' : 'Marquer comme lue';
      readBtn.setAttribute('aria-pressed', val ? 'true' : 'false');
      if (val && ctx.read.indexOf(sec.id) < 0) ctx.read.push(sec.id);
      if (!val) ctx.read = ctx.read.filter(function (x) { return x !== sec.id; });
      setRead(num, sec.id, val);
      ctx.onReadChange();
    }
    readBtn.addEventListener('click', function () { applyRead(!det.classList.contains('is-read')); });

    det.addEventListener('toggle', function () {
      // Mémorise l'état d'ouverture par item ; l'ouverture par l'utilisateur vaut lecture.
      const cur = lsGet(lsOpenKey(num), null) || (openPref ? openPref.slice() : (index === 0 ? [sec.id] : []));
      const list = Array.isArray(cur) ? cur.filter(function (x) { return x !== sec.id; }) : [];
      if (det.open) list.push(sec.id);
      lsSet(lsOpenKey(num), list);
      ctx.open = list;
      if (det.open && ctx.userInteracted && !det.classList.contains('is-read')) applyRead(true);
    });

    const body = h('div', { class: 'fiche__sec-body' });
    body.appendChild(mdEl(sec.content || ''));
    if (Array.isArray(sec.keyPoints) && sec.keyPoints.length) {
      body.appendChild(h('div', { class: 'fiche__sub' }, 'À retenir'));
      body.appendChild(h('ul', { class: 'kp' }, sec.keyPoints.map(function (k) { return h('li', { html: md(k) }); })));
    }
    if (Array.isArray(sec.pitfalls) && sec.pitfalls.length) {
      body.appendChild(h('div', { class: 'fiche__sub' }, 'Pièges'));
      body.appendChild(h('ul', { class: 'pitfall' }, sec.pitfalls.map(function (p) { return h('li', { html: md(p) }); })));
    }
    body.appendChild(h('div', { class: 'fiche__foot' },
      h('span', { class: 'fiche__src' }, sec.src ? 'Collège, ' + sec.src : ''),
      h('div', { class: 'fiche__foot-btns' },
        readBtn,
        h('a', { class: 'btn btn--secondary btn--sm', href: testUrl(num, sec.objectives) }, iconEl('play'), 'Tester cette section'))));

    det.appendChild(h('summary', {},
      rankPill(sec.rank),
      h('span', { class: 'fiche__sum-title' }, sec.title || 'Section ' + (index + 1)),
      h('span', { class: 'ico fiche__sum-read', 'aria-label': 'Lue', html: icon('check') }),
      h('span', { class: 'ico fiche__chev', html: icon('chevron-down') })));
    det.appendChild(body);
    return det;
  }

  function numbersTable(numbers) {
    if (!numbers.length) return h('p', { class: 'fiche__empty' }, 'Pas de chiffres clés pour cet item.');
    return h('table', { class: 'fiche__table' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Donnée'), h('th', {}, 'Valeur'))),
      h('tbody', {}, numbers.map(function (n) {
        return h('tr', { dataset: { rank: n.rank === 'B' ? 'B' : 'A' } },
          h('td', { class: 'fiche__rk' }, rankPill(n.rank)),
          h('td', {}, n.label || ''),
          h('td', { class: 'fiche__val' }, n.value || ''));
      })));
  }

  function essentialsList(essentials) {
    if (!essentials.length) return h('p', { class: 'fiche__empty' }, 'Pas de liste « l’essentiel » pour cet item.');
    return h('ul', { class: 'fiche__ess' }, essentials.map(function (e) {
      return h('li', { dataset: { rank: e.rank === 'B' ? 'B' : 'A' } }, rankPill(e.rank), h('span', { html: md(e.text || '') }));
    }));
  }

  function mnemonicsGrid(mnemonics) {
    if (!mnemonics.length) return h('p', { class: 'fiche__empty' }, 'Pas de moyen mnémotechnique pour cet item.');
    return h('div', { class: 'fiche__mn-grid' }, mnemonics.map(function (m) {
      return h('article', { class: 'fiche__mn', dataset: { rank: m.rank === 'B' ? 'B' : 'A' } },
        h('div', { class: 'fiche__mn-top' }, rankPill(m.rank), h('span', {}, m.title || '')),
        h('p', { class: 'fiche__mn-word' }, m.mnemonic || ''),
        mdEl(m.expansion || ''),
        m.src ? h('div', { class: 'fiche__mn-src' }, 'Collège, ' + m.src) : null);
    }));
  }

  /* ---------- Assemblage de la fiche ---------- */

  function buildFiche(num, content, section) {
    const meta = content.meta || {};
    const course = content.course || {};
    const sections = Array.isArray(course.sections) ? course.sections : [];
    const objectives = Array.isArray(content.objectives) ? content.objectives : [];
    const numbers = Array.isArray(course.numbers) ? course.numbers : [];
    const essentials = Array.isArray(course.essentials) ? course.essentials : [];
    const mnemonics = Array.isArray(course.mnemonics) ? course.mnemonics : [];

    const ctx = { read: readSections(num), open: lsGet(lsOpenKey(num), null), userInteracted: false, onReadChange: function () {} };
    const fiche = h('div', { class: 'page fiche', dataset: { rank: 'all' } });

    /* Barre collante : filtre de rang + progression */
    const readNote = h('span', {});
    function updateReadNote() {
      readNote.replaceChildren(h('b', {}, String(ctx.read.filter(function (id) { return sections.some(function (s) { return s.id === id; }); }).length)), ' / ' + sections.length + ' sections lues');
    }
    ctx.onReadChange = updateReadNote;
    updateReadNote();

    const nA = objectives.filter(function (o) { return o.rank !== 'B'; }).length;
    const objSum = h('span', { class: 'fiche__objsum' }, h('b', {}, String(objectives.length)), objectives.length > 1 ? 'objectifs' : 'objectif', objectives.length ? '(' + nA + ' A · ' + (objectives.length - nA) + ' B)' : '');

    const chips = [];
    const FILTERS = [{ v: 'all', l: 'Tout' }, { v: 'A', l: 'Rang A' }, { v: 'B', l: 'Rang B' }];
    function setFilter(v) {
      fiche.dataset.rank = v;
      chips.forEach(function (c) { c.classList.toggle('is-on', c.dataset.value === v); c.setAttribute('aria-pressed', c.dataset.value === v ? 'true' : 'false'); });
      lsSet(LS_RANK, v);
    }
    FILTERS.forEach(function (f) {
      const c = h('button', { class: 'chip fiche__chip', type: 'button', dataset: { value: f.v }, on: { click: function () { setFilter(f.v); } } }, f.l);
      chips.push(c);
    });
    const bar = h('div', { class: 'fiche__bar' },
      h('div', { class: 'fiche__bar-row', role: 'group', 'aria-label': 'Filtrer par rang' }, chips),
      h('div', { class: 'fiche__meta' }, readNote, objSum));
    fiche.appendChild(bar);

    fiche.appendChild(h('header', { class: 'fiche__head' },
      h('div', { class: 'fiche__kicker' }, 'Item ' + (meta.num || num) + ' · fiche de cours'),
      h('h1', { class: 'fiche__h1' }, meta.title || meta.short || 'Item ' + num),
      meta.pages ? h('div', { class: 'fiche__pages' }, 'Collège, pages ' + meta.pages) : null));

    const body = h('div', { class: 'fiche__body' });
    fiche.appendChild(body);

    /* Sections */
    const hasA = sections.some(function (s) { return s.rank !== 'B'; }), hasB = sections.some(function (s) { return s.rank === 'B'; });
    if (!hasB) body.appendChild(h('div', { class: 'fiche__none fiche__none--B' }, 'Aucune section de rang B dans cet item : tout est rang A.'));
    if (!hasA) body.appendChild(h('div', { class: 'fiche__none fiche__none--A' }, 'Aucune section de rang A dans cet item.'));
    if (!sections.length) body.appendChild(h('p', { class: 'fiche__empty' }, 'La fiche de cet item n’a pas encore de sections.'));
    sections.forEach(function (sec, i) { body.appendChild(sectionEl(num, sec, i, ctx)); });
    // Toute interaction ultérieure (clic, clavier) sur la fiche compte comme « lecture » à l'ouverture.
    ['pointerdown', 'keydown'].forEach(function (evt) { body.addEventListener(evt, function () { ctx.userInteracted = true; }, { passive: true }); });

    /* Chiffres clés */
    body.appendChild(h('h2', { class: 'fiche__h2' }, 'Chiffres clés', h('small', {}, numbers.length ? numbers.length + ' valeurs' : '')));
    body.appendChild(numbersTable(numbers));

    /* L'essentiel */
    body.appendChild(h('h2', { class: 'fiche__h2' }, 'L’essentiel', h('small', {}, essentials.length ? essentials.length + ' lignes' : '')));
    body.appendChild(essentialsList(essentials));

    /* Mnémos */
    const mnTitle = h('h2', { class: 'fiche__h2', id: 'fiche-mnemos', tabindex: '-1' }, 'Moyens mnémotechniques', h('small', {}, mnemonics.length ? mnemonics.length + ' astuces' : ''));
    body.appendChild(mnTitle);
    const flashCount = essentials.length + numbers.length + mnemonics.length;
    if (flashCount) {
      body.appendChild(h('div', { class: 'fiche__cta' },
        h('a', { class: 'btn btn--primary btn--block', href: '#/review?mode=kind&kind=flash&item=' + num + '&autostart=1' }, iconEl('flash'), 'Réviser en flashcards (' + flashCount + ')')));
    }
    body.appendChild(mnemonicsGrid(mnemonics));

    /* Bas de page : tester tout l'item */
    body.appendChild(h('div', { class: 'fiche__cta' },
      h('a', { class: 'btn btn--secondary btn--block', href: '#/review?mode=item&item=' + num + '&autostart=1' }, iconEl('play'), 'Tester tout l’item')));

    setFilter(['all', 'A', 'B'].indexOf(lsGet(LS_RANK, 'all')) >= 0 ? lsGet(LS_RANK, 'all') : 'all');

    if (section === 'mnemos') {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          try {
            mnTitle.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
            mnTitle.focus({ preventScroll: true });
          } catch (e) { /* ignore */ }
        });
      });
    }
    return fiche;
  }

  function skeleton() {
    return h('div', { class: 'page fiche' }, h('div', { class: 'fiche__skel', 'aria-busy': 'true', 'aria-label': 'Chargement de la fiche' },
      h('span'), h('span'), h('span'), h('span'), h('span'), h('span')));
  }

  function errorCard(num, message, retry) {
    return h('div', { class: 'page fiche' }, h('div', { class: 'fiche__err', role: 'alert' },
      h('p', {}, h('b', {}, 'Fiche indisponible. ')), h('p', {}, message),
      h('div', { class: 'fiche__foot-btns' },
        h('button', { class: 'btn btn--primary btn--sm', type: 'button', on: { click: retry } }, 'Réessayer'),
        h('a', { class: 'btn btn--secondary btn--sm', href: '#/item/' + num }, 'Retour à l’item'))));
  }

  /* ---------- Rendu ---------- */

  function render(params) {
    ensureStyles();
    const num = str((params && (params.num || params.item)) || '');
    const section = params && params.section ? String(params.section) : '';
    const reg = registry();
    const meta = reg && typeof reg.item === 'function' ? safe(function () { return reg.item(num); }, null) : null;
    const root = h('div', { class: 'view-course' });
    root.dataset.title = meta ? 'Fiche · ' + meta.short : 'Fiche';

    if (!num || (reg && meta === null && reg.manifest)) {
      root.appendChild(h('div', { class: 'page fiche' }, h('div', { class: 'fiche__err' },
        h('p', {}, 'Cet item ne fait pas partie du programme de cardiologie.'),
        h('a', { class: 'btn btn--secondary btn--sm', href: '#/items' }, 'Voir tous les items'))));
      return root;
    }

    function show(el) { root.replaceChildren(el); }

    function attempt() {
      const r = registry();
      if (!r || typeof r.load !== 'function') {
        console.warn('[course] CARDIO.registry.load absent');
        show(errorCard(num, 'Le registre de contenu n’est pas chargé. Recharge la page.', attempt));
        return;
      }
      const cached = typeof r.content === 'function' ? r.content(num) : null;
      if (cached) { show(buildFiche(num, cached, section)); return; }
      show(skeleton());
      r.load(num).then(function (content) {
        show(buildFiche(num, content, section));
      }, function (err) {
        const msg = err && err.message ? err.message : 'Impossible de charger le contenu de cet item.';
        show(errorCard(num, msg, attempt));
      });
    }
    attempt();
    return root;
  }

  CARDIO.views.course = { render: render };
})();
