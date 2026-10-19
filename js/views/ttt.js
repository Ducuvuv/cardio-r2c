/* CardioR2C — views/ttt.js
 * Rubrique « Traitements » ultime, par Collège (docs/TRAITEMENTS.md) : une fiche par classe thérapeutique ou geste,
 * tout ce que le Collège en dit (rangs A et B), avec flashcards et QROC.
 *   #/ttt                    liste par Collège (onglets Cardio / Pneumo / Dermato), regroupée par famille
 *   #/ttt/:id                la fiche ; « Lire » ou « Me tester » (mots en gras masqués)
 *   #/ttt/:id/cartes         flashcards + QROC de la fiche ; id « cardio » / « pneumo » / « dermato » = tout le
 *                            Collège ; ?type=qroc|flash pour filtrer
 * Contenu : CARDIO.registry.ttt = [{id, spe, group, title, molecules, items, intro, sections:[{h, text, retenir,
 *           rank, src}], pieges, cards:{flash:[{id,q,a,rank}], qroc:[{id,q,a,accept,x,rank}]}}].
 * Statut : localStorage « cardio.ttt » (lu/su par fiche) et « cardio.ttt.srs » = {cardId: {b, d}} (répétition espacée).
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  CARDIO.views = CARDIO.views || {};

  const SPES = [['cardio', 'Cardio'], ['pneumo', 'Pneumo'], ['dermato', 'Dermato']];
  const SPE_LABEL = { cardio: 'Cardiologie', pneumo: 'Pneumologie', dermato: 'Dermatologie' };
  const LS = 'cardio.ttt';
  const LS_SRS = 'cardio.ttt.srs';
  const LS_TAB = 'cardio.ttt.tab';
  const STEPS = [0, 1, 3, 7, 15, 30, 60];
  const DAY = 86400000;

  function util() { return CARDIO.util || {}; }
  function h() { const u = util(); return u.h.apply(null, arguments); }
  function str(v) { return v === undefined || v === null ? '' : String(v); }
  function list() { const r = CARDIO.registry || {}; return Array.isArray(r.ttt) ? r.ttt : []; }
  function load(k) { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (e) { return {}; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } }
  function mark(id, patch) { const st = load(LS); st[id] = Object.assign({}, st[id], patch, { at: Date.now() }); save(LS, st); }
  function itemLabel(num) {
    try { const r = CARDIO.registry; return r && typeof r.label === 'function' ? r.label(num) : str(num).replace(/^[a-z]+/, ''); } catch (e) { return str(num); }
  }
  function defaultTab() {
    let t = '';
    try { t = localStorage.getItem(LS_TAB) || ''; } catch (e) { t = ''; }
    if (!t) { try { const s = CARDIO.store && CARDIO.store.activeSpe && CARDIO.store.activeSpe(); if (s && s !== 'all') t = s; } catch (e) { /* défaut */ } }
    return SPES.some(function (s) { return s[0] === t; }) ? t : 'cardio';
  }

  function inlineMd(text) {
    const u = util();
    let html = '';
    if (typeof u.md === 'function') { try { html = u.md(str(text)).trim(); } catch (e) { html = ''; } }
    html = html.replace(/^<p>([\s\S]*)<\/p>$/, '$1');
    return html ? h('span', { html: html }) : h('span', {}, str(text));
  }

  let styled = false;
  function ensureStyles() {
    if (styled) return;
    styled = true;
    const css = [
      '.tt-list{display:grid;gap:10px}',
      '.tt-card{display:block;padding:14px 16px;border-radius:var(--r-m);background:var(--surface);box-shadow:var(--shadow-1);color:inherit;text-decoration:none}',
      '.tt-card:hover{box-shadow:var(--shadow-2);text-decoration:none}',
      '.tt-card__top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px}',
      '.tt-card__title{font:700 1.0625rem/1.3 var(--font-display)}',
      '.tt-card__mol{font-size:.8125rem;color:var(--muted);line-height:1.35;margin-top:2px}',
      '.tt-sec{padding:12px 14px;border-radius:var(--r-m);background:var(--surface);box-shadow:var(--shadow-1)}',
      '.tt-sec__head{display:flex;align-items:center;gap:8px;margin-bottom:6px}',
      '.tt-sec h3{margin:0;font:700 1rem/1.25 var(--font-display);color:var(--ok)}',
      '.tt-text p{margin:.5em 0;line-height:1.55}',
      '.tt-retenir{margin-top:8px;padding:8px 10px;border-radius:10px;background:var(--ok-soft)}',
      '.tt-retenir ul,.tt-pieges ul{margin:4px 0 0;padding-left:1.1em}',
      '.tt-retenir li{margin:.2em 0;font-weight:600}',
      '.tt-src{margin-top:6px;font-size:.75rem;color:var(--muted)}',
      '.tt-hide{cursor:pointer;border-radius:4px;background:var(--surface-3);color:transparent!important;box-shadow:inset 0 -2px 0 var(--muted)}',
      '.tt-train{display:grid;gap:4px;padding:12px 14px;border-radius:var(--r-m);background:var(--surface);box-shadow:var(--shadow-1);border-left:4px solid var(--ok)}',
      '.tt-train__t{font:700 1rem/1.25 var(--font-display)}',
      '.tt-train__s{font-size:.8125rem;color:var(--muted)}',
      '.tt-train__btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}',
      '.tt-q-card{padding:14px 16px;border-radius:var(--r-m);background:var(--surface);box-shadow:var(--shadow-1)}',
      '.tt-q{font:600 1.0625rem/1.4 var(--font-display);margin-top:6px}',
      '.tt-a{padding:12px 14px;border-radius:var(--r-m);background:var(--surface-2);line-height:1.45}',
      '.view-ttt .input{width:100%;padding:12px;border-radius:10px;border:2px solid var(--line);background:var(--surface);color:var(--ink);font-size:1rem}',
      '.view-ttt .grades .is-hint{outline:2px solid currentColor;outline-offset:1px}',
      '.tt-items{display:flex;gap:6px;flex-wrap:wrap}'
    ].join('\n');
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------- cartes ---------- */
  function cardsOf(p) {
    const c = p.cards || {};
    const f = (c.flash || []).map(function (x) { return Object.assign({ kind: 'flash', fiche: p }, x); });
    const q = (c.qroc || []).map(function (x) { return Object.assign({ kind: 'qroc', fiche: p }, x); });
    const out = [];
    let i = 0, j = 0;
    while (i < f.length || j < q.length) {
      if (j >= q.length || (i < f.length && i / f.length <= j / q.length)) out.push(f[i++]);
      else out.push(q[j++]);
    }
    return out;
  }
  function scopeFiches(scope) { return scope.fiche ? [scope.fiche] : list().filter(function (p) { return p.spe === scope.spe; }); }
  function allCards(scope, type) {
    const all = scopeFiches(scope).reduce(function (a, p) { return a.concat(cardsOf(p)); }, []);
    return type === 'qroc' || type === 'flash' ? all.filter(function (c) { return c.kind === type; }) : all;
  }
  function counts(scope, type) {
    const st = load(LS_SRS), now = Date.now();
    const cards = allCards(scope, type);
    let due = 0, fresh = 0, known = 0;
    cards.forEach(function (c) { const s = st[c.id]; if (!s) fresh++; else { if (s.d <= now) due++; if (s.b >= 3) known++; } });
    return { due: due, fresh: fresh, known: known, total: cards.length };
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function buildSession(scope, size, type) {
    const st = load(LS_SRS), now = Date.now();
    const cards = allCards(scope, type);
    const due = cards.filter(function (c) { return st[c.id] && st[c.id].d <= now; }).sort(function (a, b) { return st[a.id].d - st[b.id].d; });
    const fresh = cards.filter(function (c) { return !st[c.id]; });
    return shuffle(due.slice(0, size).concat(fresh.slice(0, Math.max(0, size - due.length))));
  }
  function grade(id, ok) {
    const st = load(LS_SRS), cur = st[id] || { b: 0 };
    const b = ok ? Math.min(STEPS.length - 1, (cur.b || 0) + 1) : 0;
    st[id] = { b: b, d: ok ? Date.now() + STEPS[b] * DAY : Date.now() + 10 * 60000 };
    save(LS_SRS, st);
  }
  function normAns(v) { return str(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9%]+/g, ' ').trim(); }
  function looksRight(input, c) {
    const n = normAns(input);
    if (!n) return false;
    return (c.accept && c.accept.length ? c.accept : [c.a]).some(function (a) { const m = normAns(a); return m && (n === m || (m.length >= 3 && n.indexOf(m) >= 0)); });
  }
  function scopeHref(scope) { return '#/ttt/' + encodeURIComponent(scope.fiche ? scope.fiche.id : scope.spe) + '/cartes'; }

  function trainBlock(scope) {
    const n = counts(scope);
    if (!n.total) return null;
    const nf = allCards(scope, 'flash').length, nq = allCards(scope, 'qroc').length;
    const base = scopeHref(scope);
    return h('div', { class: 'tt-train' },
      h('div', { class: 'tt-train__t' }, scope.fiche ? 'S’entraîner sur cette fiche' : 'Réviser tous les traitements ' + (SPES.find(function (s) { return s[0] === scope.spe; }) || ['', ''])[1].toLowerCase()),
      h('div', { class: 'tt-train__s' }, nf + ' flashcards · ' + nq + ' QROC — ' + (n.due ? n.due + ' à revoir · ' : '') + n.fresh + ' nouvelles · ' + n.known + ' bien sues'),
      h('div', { class: 'tt-train__btns' },
        h('a', { class: 'btn btn--primary btn--sm', href: base }, 'Mixte'),
        nq ? h('a', { class: 'btn btn--outline btn--sm', href: base + '?type=qroc' }, 'QROC') : null,
        nf ? h('a', { class: 'btn btn--outline btn--sm', href: base + '?type=flash' }, 'Flashcards') : null));
  }

  function renderTrain(scope, root, type) {
    const page = h('div', { class: 'page stack' });
    const queue = buildSession(scope, 20, type);
    const total = queue.length;
    let done = 0, good = 0;
    const missed = {};
    const head = h('div', { class: 'cluster' });
    const stage = h('div', { class: 'stack' });
    const back = scope.fiche ? '#/ttt/' + encodeURIComponent(scope.fiche.id) : '#/ttt';
    page.append(h('div', {}, h('div', { class: 'caption' }, (type === 'qroc' ? 'QROC' : type === 'flash' ? 'Flashcards' : 'Flashcards + QROC') + ' · traitements'),
      h('h2', { style: 'margin:4px 0 0' }, scope.fiche ? str(scope.fiche.title) : 'Tous les traitements · ' + SPE_LABEL[scope.spe])), head, stage);
    root.appendChild(page);
    if (!total) {
      stage.append(h('div', { class: 'empty' }, h('div', { class: 'empty__title' }, 'Rien à revoir pour l’instant'), 'Reviens plus tard : les cartes reviennent quand il faut.'),
        h('a', { class: 'btn btn--secondary btn--block', href: back }, 'Retour'));
      return;
    }
    function next() {
      head.replaceChildren(h('span', { class: 'pill pill--kind' }, Math.min(done + 1, total) + ' / ' + total), h('span', { class: 'secondary muted' }, good + ' sue' + (good > 1 ? 's' : '')));
      if (!queue.length) { finish(); return; }
      show(queue.shift());
    }
    function answer(c, ok) {
      if (!missed[c.id]) { grade(c.id, ok); if (ok) good++; done++; if (!ok) { missed[c.id] = 1; queue.push(c); } }
      next();
    }
    function show(c) {
      const card = h('div', { class: 'tt-q-card' },
        h('div', { class: 'tt-card__top' },
          h('span', { class: 'pill ' + (c.kind === 'qroc' ? 'pill--info' : 'pill--kind') }, c.kind === 'qroc' ? 'QROC' : 'Flashcard'),
          c.rank === 'B' ? h('span', { class: 'pill pill--B' }, 'Rang B') : null,
          !scope.fiche ? h('span', { class: 'secondary muted' }, str(c.fiche.title)) : null,
          missed[c.id] ? h('span', { class: 'pill pill--warn' }, 'deuxième passage') : null),
        h('div', { class: 'tt-q' }, inlineMd(c.q)));
      const ans = h('div', { class: 'stack' });
      stage.replaceChildren(card, ans);
      function gradeBtns(hint) {
        return h('div', { class: 'grades', style: 'grid-template-columns:1fr 1fr' },
          h('button', { type: 'button', class: 'btn grade--again' + (hint === false ? ' is-hint' : ''), on: { click: function () { answer(c, false); } } }, 'À revoir'),
          h('button', { type: 'button', class: 'btn grade--good' + (hint === true ? ' is-hint' : ''), on: { click: function () { answer(c, true); } } }, 'Su'));
      }
      if (c.kind === 'flash') {
        ans.appendChild(h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: function () {
          ans.replaceChildren(h('div', { class: 'tt-a' }, inlineMd(c.a)), gradeBtns());
        } } }, 'Voir la réponse'));
        return;
      }
      const input = h('input', { type: 'text', class: 'input', placeholder: 'Ta réponse', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
      function check() {
        const v = input.value.trim();
        const ok = looksRight(v, c);
        ans.replaceChildren(
          h('div', { class: 'feedback ' + (ok ? 'feedback--ok' : 'feedback--warn') }, ok ? 'Correct !' : (v ? 'Compare avec la réponse attendue' : 'Réponse attendue')),
          h('div', { class: 'tt-a' }, h('strong', {}, str(c.a)), c.x ? h('div', { class: 'secondary', style: 'margin-top:4px' }, inlineMd(c.x)) : null),
          v ? h('p', { class: 'secondary muted' }, 'Ta réponse : ' + v) : null,
          gradeBtns(v ? ok : undefined));
      }
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); check(); } });
      ans.append(input, h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: check } }, 'Valider'));
      setTimeout(function () { try { input.focus(); } catch (e) { /* ignore */ } }, 50);
    }
    function finish() {
      head.replaceChildren();
      const n = counts(scope, type);
      stage.replaceChildren(
        h('div', { class: 'feedback feedback--ok' }, 'Session terminée : ' + good + ' / ' + total + ' sues du premier coup.'),
        h('p', { class: 'secondary' }, n.known + ' / ' + n.total + ' cartes bien sues' + (n.fresh ? ' · ' + n.fresh + ' nouvelles restantes' : '') + '.'),
        h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: function () { root.replaceChildren(); renderTrain(scope, root, type); } } }, 'Encore une session'),
        h('a', { class: 'btn btn--secondary btn--block', href: back }, scope.fiche ? 'Retour à la fiche' : 'Retour aux traitements'));
    }
    next();
  }

  /* ---------- liste ---------- */
  function status(id) {
    const s = load(LS)[id];
    if (!s) return null;
    if (s.ok === true) return { cls: 'pill--ok', t: 'su' };
    if (s.ok === false) return { cls: 'pill--warn', t: 'à revoir' };
    return s.seen ? { cls: 'pill--info', t: 'lu' } : null;
  }
  function buildList(root) {
    const tab = defaultTab();
    const page = h('div', { class: 'page stack' });
    const seg = h('div', { class: 'seg seg--block', role: 'tablist' }, SPES.map(function (s) {
      return h('button', { type: 'button', class: 'seg__btn' + (s[0] === tab ? ' is-on' : ''), on: { click: function () {
        try { localStorage.setItem(LS_TAB, s[0]); } catch (e) { /* ignore */ }
        root.replaceChildren(buildList(root));
      } } }, s[1]);
    }));
    page.append(seg, h('p', { class: 'secondary' }, 'Toutes les classes de traitements et les gestes du Collège de ' + SPE_LABEL[tab].toLowerCase() + ', rangs A et B : indications, posologies, contre-indications, effets indésirables, surveillance, pièges. Chaque fiche a ses flashcards et ses QROC.'));
    const fiches = list().filter(function (p) { return p.spe === tab; });
    if (!fiches.length) { page.appendChild(h('div', { class: 'empty' }, 'Pas encore de fiches pour ce Collège.')); return page; }
    const tb = trainBlock({ spe: tab });
    if (tb) page.appendChild(tb);
    const groups = [];
    fiches.forEach(function (p) { if (groups.indexOf(p.group) < 0) groups.push(p.group); });
    groups.forEach(function (g) {
      const gs = fiches.filter(function (p) { return p.group === g; });
      page.appendChild(h('div', { class: 'section-head' }, h('h2', {}, str(g))));
      page.appendChild(h('div', { class: 'tt-list' }, gs.map(function (p) {
        const sta = status(p.id);
        const nc = ((p.cards || {}).flash || []).length + ((p.cards || {}).qroc || []).length;
        return h('a', { class: 'tt-card', href: '#/ttt/' + encodeURIComponent(p.id) },
          h('div', { class: 'tt-card__top' }, h('span', { class: 'pill pill--kind' }, nc + ' cartes'), sta ? h('span', { class: 'pill ' + sta.cls }, sta.t) : null),
          h('div', { class: 'tt-card__title' }, str(p.title)),
          p.molecules && p.molecules.length ? h('div', { class: 'tt-card__mol' }, p.molecules.slice(0, 8).join(' · ') + (p.molecules.length > 8 ? '…' : '')) : null);
      })));
    });
    return page;
  }

  /* ---------- fiche ---------- */
  function renderFiche(p, root) {
    const page = h('div', { class: 'page stack' });
    const body = h('div', { class: 'stack' });
    const after = h('div', { class: 'stack' });
    const seg = h('div', { class: 'seg seg--block', role: 'tablist' });
    const bRead = h('button', { type: 'button', class: 'seg__btn is-on', on: { click: function () { setMode(false); } } }, 'Lire');
    const bTest = h('button', { type: 'button', class: 'seg__btn', on: { click: function () { setMode(true); } } }, 'Me tester');
    seg.append(bRead, bTest);
    function setMode(t) { bRead.classList.toggle('is-on', !t); bTest.classList.toggle('is-on', t); draw(t); }
    function draw(test) {
      const hidden = [];
      body.replaceChildren();
      (p.sections || []).forEach(function (s) {
        const paras = str(s.text).split(/\n\s*\n/).map(function (t) { return t.trim(); }).filter(Boolean);
        const sec = h('section', { class: 'tt-sec' },
          h('div', { class: 'tt-sec__head' }, h('h3', {}, str(s.h)), s.rank === 'B' ? h('span', { class: 'pill pill--B' }, 'Rang B') : null),
          h('div', { class: 'tt-text' }, paras.map(function (t) { return h('p', {}, inlineMd(t)); })),
          Array.isArray(s.retenir) && s.retenir.length ? h('div', { class: 'tt-retenir' }, h('span', { class: 'caption' }, 'À retenir'),
            h('ul', {}, s.retenir.map(function (r) { return h('li', {}, inlineMd(r)); }))) : null,
          Array.isArray(s.src) && s.src.length ? h('div', { class: 'tt-src' }, 'Collège · ' + s.src.join(' · ')) : null);
        if (test) sec.querySelectorAll('.tt-text strong').forEach(function (el) { el.classList.add('tt-hide'); el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0'); hidden.push(el); });
        body.appendChild(sec);
      });
      if (Array.isArray(p.pieges) && p.pieges.length) {
        body.appendChild(h('div', { class: 'pitfall tt-pieges' }, h('span', { class: 'caption' }, 'Pièges'), h('ul', {}, p.pieges.map(function (x) { return h('li', {}, inlineMd(x)); }))));
      }
      after.replaceChildren();
      if (!test) { mark(p.id, { seen: true }); after.appendChild(nextLink()); return; }
      let left = hidden.length;
      const hint = h('p', { class: 'secondary muted center' }, 'Touche chaque mot caché après l’avoir dit de tête (' + left + ' à trouver).');
      body.insertBefore(hint, body.firstChild);
      function reveal(el) {
        if (!el.classList.contains('tt-hide')) return;
        el.classList.remove('tt-hide');
        left--;
        hint.textContent = left > 0 ? 'Encore ' + left + ' à révéler.' : 'Tout est révélé. Tu savais ?';
        if (left === 0) {
          after.replaceChildren(h('div', { class: 'grades', style: 'grid-template-columns:1fr 1fr' },
            h('button', { type: 'button', class: 'btn grade--again', on: { click: function () { mark(p.id, { seen: true, ok: false }); done('À revoir : la fiche reste marquée.'); } } }, 'À revoir'),
            h('button', { type: 'button', class: 'btn grade--good', on: { click: function () { mark(p.id, { seen: true, ok: true }); done('Bien joué !'); } } }, 'Je savais')));
        }
      }
      hidden.forEach(function (el) {
        el.addEventListener('click', function () { reveal(el); });
        el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal(el); } });
      });
      after.appendChild(h('button', { type: 'button', class: 'btn btn--secondary btn--block', on: { click: function () { hidden.slice().forEach(reveal); } } }, 'Tout révéler'));
    }
    function done(msg) { after.replaceChildren(h('div', { class: 'feedback feedback--ok' }, msg), nextLink()); }
    function nextLink() {
      const all = list().filter(function (x) { return x.spe === p.spe; });
      const i = all.findIndex(function (x) { return x.id === p.id; });
      const nx = i >= 0 && i + 1 < all.length ? all[i + 1] : null;
      return nx ? h('a', { class: 'btn btn--primary btn--block', href: '#/ttt/' + encodeURIComponent(nx.id) }, 'Fiche suivante : ' + str(nx.title))
        : h('a', { class: 'btn btn--secondary btn--block', href: '#/ttt' }, 'Tous les traitements');
    }
    page.append(
      h('div', {}, h('div', { class: 'caption' }, SPE_LABEL[p.spe] + ' · ' + str(p.group)), h('h2', { style: 'margin:4px 0 0' }, str(p.title))),
      p.intro ? h('p', {}, inlineMd(p.intro)) : null,
      p.molecules && p.molecules.length ? h('p', { class: 'secondary' }, h('strong', {}, 'Molécules : '), p.molecules.join(', ')) : null,
      p.items && p.items.length ? h('div', { class: 'tt-items' }, p.items.map(function (it) {
        return h('a', { class: 'pill pill--kind', href: '#/item/' + encodeURIComponent(it) }, 'Item ' + itemLabel(it));
      })) : null,
      trainBlock({ fiche: p }), seg, body, after);
    draw(false);
    root.appendChild(page);
  }

  function render(params, query) {
    ensureStyles();
    const root = h('div', { class: 'view-ttt' });
    const id = str(params && params.id);
    if (params && params.train) {
      root.dataset.title = 'Cartes traitements';
      const spe = SPES.find(function (s) { return s[0] === id; });
      const fiche = spe ? null : list().find(function (x) { return x.id === id; });
      if (!spe && !fiche) { root.appendChild(h('div', { class: 'page' }, h('div', { class: 'empty' }, 'Fiche introuvable.'))); return root; }
      renderTrain(spe ? { spe: spe[0] } : { fiche: fiche }, root, query && query.type);
      return root;
    }
    if (id) {
      const p = list().find(function (x) { return x.id === id; });
      root.dataset.title = p ? str(p.title) : 'Traitement';
      if (!p) root.appendChild(h('div', { class: 'page' }, h('div', { class: 'empty' }, 'Fiche introuvable.')));
      else renderFiche(p, root);
      return root;
    }
    root.dataset.title = 'Traitements';
    root.appendChild(buildList(root));
    return root;
  }

  CARDIO.views.ttt = { render: render, available: function () { return list().length > 0; } };
})();
