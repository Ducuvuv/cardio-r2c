/* CardioR2C — views/parasito.js
 * Rubrique « Parasito » : une fiche par parasite / mycose, uniquement le rang A (texte rouge) du poly de
 * parasitologie-mycologie (docs/PARASITO.md). Version privée seulement (content/parasito.js n'est pas publié
 * sur GitHub Pages).
 *   #/parasito        liste par groupe (protozoaires, helminthes, ectoparasites, mycologie)
 *   #/parasito/:id    la fiche ; « Comprendre » (version rédigée et expliquée, première lecture), « Fiche »
 *                     (points télégraphiques) ou « Me tester » (mots-clés en gras masqués, révélés au toucher).
 * Contenu : CARDIO.registry.parasito = [{id, title, agent, group, items, pages, hook, sections:[{h, points}],
 *           explain?: {intro, sections:[{h, text, retenir}]}}],
 *           CARDIO.registry.parasitoNoA = ['Ankylostomoses', …] (sections sans rouge).
 * Statut : localStorage « cardio.parasito » = {id: {seen, ok, at}} (confort par appareil).
 *   #/parasito/:id/cartes  flashcards + QROC de la fiche (id « toutes » = toutes les fiches), répétition espacée
 *                          locale « cardio.parasito.srs » = {cardId: {b: boîte 0–6, d: échéance ms}}.
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  CARDIO.views = CARDIO.views || {};

  const GROUPS = [
    ['generalites', 'Généralités'], ['protozoaires', 'Protozoaires'], ['helminthes', 'Helminthes'],
    ['ectoparasites', 'Ectoparasites'], ['mycologie', 'Mycologie']
  ];
  const LS = 'cardio.parasito';

  function util() { return CARDIO.util || {}; }
  function h() { const u = util(); return u.h.apply(null, arguments); }
  function str(v) { return v === undefined || v === null ? '' : String(v); }
  function list() { const r = CARDIO.registry || {}; return Array.isArray(r.parasito) ? r.parasito : []; }
  function noA() { const r = CARDIO.registry || {}; return Array.isArray(r.parasitoNoA) ? r.parasitoNoA : []; }
  function loadState() { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { return {}; } }
  function saveState(st) { try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) { /* stockage indisponible */ } }
  function mark(id, patch) { const st = loadState(); st[id] = Object.assign({}, st[id], patch, { at: Date.now() }); saveState(st); }
  function count(p) { return (p.sections || []).reduce(function (n, s) { return n + ((s && s.points) || []).length; }, 0); }

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
      '.pz-list{display:grid;gap:10px}',
      '.pz-card{display:block;padding:14px 16px;border-radius:var(--r-m);background:var(--surface);box-shadow:var(--shadow-1);color:inherit;text-decoration:none}',
      '.pz-card:hover{box-shadow:var(--shadow-2);text-decoration:none}',
      '.pz-card__top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px}',
      '.pz-card__title{font:700 1.0625rem/1.3 var(--font-display)}',
      '.pz-card__agent{font-style:italic;font-size:.875rem;color:var(--ink-2)}',
      '.pz-card__hook{font-size:.875rem;color:var(--muted);line-height:1.35;margin-top:2px}',
      '.pz-hook{padding:10px 12px;border-left:4px solid var(--bad);background:var(--bad-soft);border-radius:0 10px 10px 0;font-weight:600}',
      '.pz-sec{padding:12px 14px;border-radius:var(--r-m);background:var(--surface);box-shadow:var(--shadow-1)}',
      '.pz-sec h3{margin:0 0 6px;font:700 1rem/1.25 var(--font-display);color:var(--bad)}',
      '.pz-sec ul{margin:0;padding-left:1.1em}',
      '.pz-sec li{margin:.35em 0;line-height:1.4}',
      '.pz-sec strong{color:var(--ink)}',
      '.pz-hide{cursor:pointer;border-radius:4px;background:var(--surface-3);color:transparent!important;box-shadow:inset 0 -2px 0 var(--muted)}',
      '.pz-toc{display:flex;gap:6px;flex-wrap:wrap}',
      '.pz-toc a{font-size:.8125rem}',
      '.pz-intro{font-size:1rem;line-height:1.5}',
      '.pz-text p{margin:.5em 0;line-height:1.55}',
      '.pz-retenir{margin-top:8px;padding:8px 10px;border-radius:10px;background:var(--bad-soft)}',
      '.pz-retenir .caption{color:var(--bad)}',
      '.pz-retenir ul{margin:4px 0 0;padding-left:1.1em}',
      '.pz-retenir li{margin:.2em 0;font-weight:600}',
      '.pz-train{display:grid;gap:4px;padding:12px 14px;border-radius:var(--r-m);background:var(--surface);box-shadow:var(--shadow-1);border-left:4px solid var(--bad);color:inherit;text-decoration:none}',
      '.pz-train:hover{text-decoration:none;box-shadow:var(--shadow-2)}',
      '.pz-train__t{font:700 1rem/1.25 var(--font-display)}',
      '.pz-train__s{font-size:.8125rem;color:var(--muted)}',
      '.pz-train .btn{justify-self:start;margin-top:4px}',
      '.pz-card-q{padding:14px 16px;border-radius:var(--r-m);background:var(--surface);box-shadow:var(--shadow-1)}',
      '.pz-q{font:600 1.0625rem/1.4 var(--font-display);margin-top:6px}',
      '.pz-a{padding:12px 14px;border-radius:var(--r-m);background:var(--surface-2);line-height:1.45}',
      '.view-parasito .input{width:100%;padding:12px;border-radius:10px;border:2px solid var(--line);background:var(--surface);color:var(--ink);font-size:1rem}',
      '.grades .is-hint{outline:2px solid currentColor;outline-offset:1px}'
    ].join('\n');
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
  }

  function status(id) {
    const s = loadState()[id];
    if (!s) return null;
    if (s.ok === true) return { cls: 'pill--ok', t: 'su' };
    if (s.ok === false) return { cls: 'pill--warn', t: 'à revoir' };
    return s.seen ? { cls: 'pill--info', t: 'lu' } : null;
  }

  /* ---------- liste ---------- */
  function buildList() {
    const all = list();
    const page = h('div', { class: 'page stack' });
    page.appendChild(h('p', { class: 'secondary' }, 'Une fiche par parasite et par mycose, avec uniquement ce qui est en rouge (rang A) dans le poly de parasitologie-mycologie. Mode « Me tester » : les mots-clés sont cachés, à toi de les retrouver.'));
    if (!all.length) {
      page.appendChild(h('div', { class: 'empty' }, h('div', { class: 'empty__title' }, 'Fiches non disponibles ici'), 'Cette rubrique est réservée à ta version privée de l’app.'));
      return page;
    }
    const tb = trainBlock(null);
    if (tb) page.appendChild(tb);
    const st = loadState();
    GROUPS.forEach(function (g) {
      const group = all.filter(function (p) { return p.group === g[0]; });
      if (!group.length) return;
      const done = group.filter(function (p) { return st[p.id] && st[p.id].ok === true; }).length;
      page.appendChild(h('div', { class: 'section-head' }, h('h2', {}, g[1]), h('span', { class: 'secondary muted' }, done + ' / ' + group.length + ' sues')));
      page.appendChild(h('div', { class: 'pz-list' }, group.map(function (p) {
        const sta = status(p.id);
        return h('a', { class: 'pz-card', href: '#/parasito/' + encodeURIComponent(p.id) },
          h('div', { class: 'pz-card__top' },
            h('span', { class: 'pill pill--A' }, 'Rang A'),
            h('span', { class: 'pill pill--kind' }, count(p) + ' points'),
            sta ? h('span', { class: 'pill ' + sta.cls }, sta.t) : null),
          h('div', { class: 'pz-card__title' }, str(p.title)),
          p.agent ? h('div', { class: 'pz-card__agent' }, str(p.agent)) : null,
          p.hook ? h('div', { class: 'pz-card__hook' }, str(p.hook)) : null);
      })));
    });
    if (noA().length) {
      page.appendChild(h('p', { class: 'secondary muted' }, 'Sans rien en rouge dans le poly (donc pas de fiche) : ' + noA().join(', ') + '.'));
    }
    return page;
  }

  /* ---------- fiche ---------- */
  function renderFiche(p, root) {
    const page = h('div', { class: 'page stack' });
    const body = h('div', { class: 'stack' });
    const after = h('div', { class: 'stack' });
    const seg = h('div', { class: 'seg seg--block', role: 'tablist' });
    const hasX = !!(p.explain && Array.isArray(p.explain.sections) && p.explain.sections.length);
    const btns = {};
    [['explain', 'Comprendre'], ['read', 'Fiche'], ['test', 'Me tester']].forEach(function (m) {
      if (m[0] === 'explain' && !hasX) return;
      btns[m[0]] = h('button', { type: 'button', class: 'seg__btn', on: { click: function () { setMode(m[0]); } } }, m[1]);
      seg.appendChild(btns[m[0]]);
    });

    function setMode(m) {
      Object.keys(btns).forEach(function (k) { btns[k].classList.toggle('is-on', k === m); });
      if (toc) toc.hidden = m === 'explain';
      if (m === 'explain') drawExplain(); else draw(m === 'test');
    }
    function drawExplain() {
      const x = p.explain;
      body.replaceChildren();
      if (x.intro) body.appendChild(h('p', { class: 'pz-intro' }, inlineMd(x.intro)));
      x.sections.forEach(function (s) {
        const paras = str(s.text).split(/\n\s*\n/).map(function (t) { return t.trim(); }).filter(Boolean);
        body.appendChild(h('section', { class: 'pz-sec' }, h('h3', {}, str(s.h)),
          h('div', { class: 'pz-text' }, paras.map(function (t) { return h('p', {}, inlineMd(t)); })),
          Array.isArray(s.retenir) && s.retenir.length ? h('div', { class: 'pz-retenir' }, h('span', { class: 'caption' }, 'À retenir'),
            h('ul', {}, s.retenir.map(function (r) { return h('li', {}, inlineMd(r)); }))) : null));
      });
      mark(p.id, { seen: true });
      after.replaceChildren(h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: function () { setMode('test'); window.scrollTo(0, 0); } } }, 'J’ai lu : me tester sur la fiche'), footer());
    }
    function draw(test) {
      const hidden = [];
      body.replaceChildren();
      (p.sections || []).forEach(function (s, i) {
        const ul = h('ul', {}, (s.points || []).map(function (pt) { return h('li', {}, inlineMd(pt)); }));
        body.appendChild(h('section', { class: 'pz-sec', id: 'pz-s' + i }, h('h3', {}, str(s.h)), ul));
        if (test) {
          ul.querySelectorAll('strong').forEach(function (el) {
            el.classList.add('pz-hide');
            el.setAttribute('role', 'button');
            el.setAttribute('tabindex', '0');
            hidden.push(el);
          });
        }
      });
      after.replaceChildren();
      if (!test) { mark(p.id, { seen: true }); after.appendChild(footer()); return; }
      let left = hidden.length;
      const hint = h('p', { class: 'secondary muted center' }, 'Touche chaque mot caché après l’avoir dit de tête (' + left + ' à trouver).');
      body.insertBefore(hint, body.firstChild);
      function reveal(el) {
        if (!el.classList.contains('pz-hide')) return;
        el.classList.remove('pz-hide');
        left--;
        hint.textContent = left > 0 ? 'Encore ' + left + ' à révéler.' : 'Tout est révélé. Tu savais ?';
        if (left === 0) {
          after.replaceChildren(h('div', { class: 'grades', style: 'grid-template-columns:1fr 1fr' },
            h('button', { type: 'button', class: 'btn grade--again', on: { click: function () { mark(p.id, { seen: true, ok: false }); done('À revoir : la fiche reste marquée dans la liste.'); } } }, 'À revoir'),
            h('button', { type: 'button', class: 'btn grade--good', on: { click: function () { mark(p.id, { seen: true, ok: true }); done('Bien joué !'); } } }, 'Je savais')));
        }
      }
      hidden.forEach(function (el) {
        el.addEventListener('click', function () { reveal(el); });
        el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal(el); } });
      });
      after.appendChild(h('button', { type: 'button', class: 'btn btn--secondary btn--block', on: { click: function () { hidden.slice().forEach(reveal); } } }, 'Tout révéler'));
    }
    function done(msg) { after.replaceChildren(h('div', { class: 'feedback feedback--ok' }, msg), footer()); }
    function footer() {
      const all = list();
      const i = all.findIndex(function (x) { return x.id === p.id; });
      const nx = i >= 0 && i + 1 < all.length ? all[i + 1] : null;
      return h('div', { class: 'stack' },
        h('div', { class: 'cluster' }, h('span', { class: 'src' }, 'Poly parasito-myco · p. ' + str(p.pages))),
        nx ? h('a', { class: 'btn btn--primary btn--block', href: '#/parasito/' + encodeURIComponent(nx.id) }, 'Fiche suivante : ' + str(nx.title))
          : h('a', { class: 'btn btn--secondary btn--block', href: '#/parasito' }, 'Toutes les fiches'));
    }

    const toc = (p.sections || []).length > 3 ? h('div', { class: 'pz-toc' }, (p.sections || []).map(function (s, i) {
      return h('a', { class: 'pill pill--kind', href: 'javascript:void 0', on: { click: function (e) { e.preventDefault(); const el = document.getElementById('pz-s' + i); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } } }, str(s.h));
    })) : null;
    const g = GROUPS.find(function (x) { return x[0] === p.group; });
    page.append(
      h('div', {},
        h('div', { class: 'caption' }, (g ? g[1] : 'Parasito') + ' · rang A' + (p.items && p.items.length ? ' · items ' + p.items.join(', ') : '')),
        h('h2', { style: 'margin:4px 0 0' }, str(p.title)),
        p.agent ? h('p', { class: 'pz-card__agent', style: 'margin-top:2px' }, str(p.agent)) : null),
      p.hook ? h('div', { class: 'pz-hook' }, str(p.hook)) : null,
      trainBlock(p), seg, toc, body, after);
    setMode(hasX ? 'explain' : 'read');
    root.appendChild(page);
  }

  /* ---------- cartes : flashcards + QROC, répétition espacée locale ---------- */
  const LS_SRS = 'cardio.parasito.srs';
  const STEPS = [0, 1, 3, 7, 15, 30, 60];
  const DAY = 86400000;
  function loadSrs() { try { return JSON.parse(localStorage.getItem(LS_SRS) || '{}') || {}; } catch (e) { return {}; } }
  function saveSrs(st) { try { localStorage.setItem(LS_SRS, JSON.stringify(st)); } catch (e) { /* stockage indisponible */ } }
  function cardsOf(p) {
    const c = p.cards || {};
    return (c.flash || []).map(function (x) { return Object.assign({ kind: 'flash', fiche: p }, x); })
      .concat((c.qroc || []).map(function (x) { return Object.assign({ kind: 'qroc', fiche: p }, x); }));
  }
  function allCards(scope) { return (scope ? [scope] : list()).reduce(function (a, p) { return a.concat(cardsOf(p)); }, []); }
  function counts(scope) {
    const st = loadSrs(), now = Date.now();
    const cards = allCards(scope);
    let due = 0, fresh = 0, known = 0;
    cards.forEach(function (c) {
      const s = st[c.id];
      if (!s) fresh++;
      else { if (s.d <= now) due++; if (s.b >= 3) known++; }
    });
    return { due: due, fresh: fresh, known: known, total: cards.length };
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function buildSession(scope, size) {
    const st = loadSrs(), now = Date.now();
    const cards = allCards(scope);
    const due = cards.filter(function (c) { return st[c.id] && st[c.id].d <= now; }).sort(function (a, b) { return st[a.id].d - st[b.id].d; });
    const fresh = cards.filter(function (c) { return !st[c.id]; });
    return shuffle(due.slice(0, size).concat(fresh.slice(0, Math.max(0, size - due.length))));
  }
  function grade(id, ok) {
    const st = loadSrs(), cur = st[id] || { b: 0 };
    const b = ok ? Math.min(STEPS.length - 1, (cur.b || 0) + 1) : 0;
    st[id] = { b: b, d: ok ? Date.now() + STEPS[b] * DAY : Date.now() + 10 * 60000 };
    saveSrs(st);
  }
  function normAns(v) {
    return str(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9%]+/g, ' ').trim();
  }
  function looksRight(input, c) {
    const n = normAns(input);
    if (!n) return false;
    return (c.accept && c.accept.length ? c.accept : [c.a]).some(function (a) {
      const m = normAns(a);
      return m && (n === m || (m.length >= 3 && n.indexOf(m) >= 0));
    });
  }

  function trainBlock(scope) {
    const n = counts(scope);
    if (!n.total) return null;
    const todo = Math.min(20, n.due + n.fresh);
    const href = '#/parasito/' + encodeURIComponent(scope ? scope.id : 'toutes') + '/cartes';
    return h('a', { class: 'pz-train', href: href },
      h('div', { class: 'pz-train__t' }, scope ? 'S’entraîner sur cette fiche' : 'Réviser les cartes parasito'),
      h('div', { class: 'pz-train__s' }, (n.due ? n.due + ' à revoir · ' : '') + n.fresh + ' nouvelles · ' + n.known + ' / ' + n.total + ' bien sues'),
      h('span', { class: 'btn btn--primary btn--sm' }, todo ? 'Lancer ' + todo + ' cartes' : 'Tout est à jour'));
  }

  function renderTrain(scope, root) {
    const page = h('div', { class: 'page stack' });
    const queue = buildSession(scope, 20);
    const total = queue.length;
    let done = 0, good = 0;
    const missed = {};
    const head = h('div', { class: 'cluster' });
    const stage = h('div', { class: 'stack' });
    const back = scope ? '#/parasito/' + encodeURIComponent(scope.id) : '#/parasito';
    page.append(h('div', {}, h('div', { class: 'caption' }, 'Cartes parasito · rang A'), h('h2', { style: 'margin:4px 0 0' }, scope ? str(scope.title) : 'Toutes les fiches')), head, stage);
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
      if (!missed[c.id]) {
        grade(c.id, ok);
        if (ok) good++;
        done++;
        if (!ok) { missed[c.id] = 1; queue.push(c); }
      }
      next();
    }
    function show(c) {
      const card = h('div', { class: 'pz-card-q' },
        h('div', { class: 'pz-card__top' },
          h('span', { class: 'pill ' + (c.kind === 'qroc' ? 'pill--info' : 'pill--kind') }, c.kind === 'qroc' ? 'QROC' : 'Flashcard'),
          !scope ? h('span', { class: 'secondary muted' }, str(c.fiche.title)) : null,
          missed[c.id] ? h('span', { class: 'pill pill--warn' }, 'deuxième passage') : null),
        h('div', { class: 'pz-q' }, inlineMd(c.q)));
      const ans = h('div', { class: 'stack' });
      stage.replaceChildren(card, ans);
      function gradeBtns(hint) {
        return h('div', { class: 'grades', style: 'grid-template-columns:1fr 1fr' },
          h('button', { type: 'button', class: 'btn grade--again' + (hint === false ? ' is-hint' : ''), on: { click: function () { answer(c, false); } } }, 'À revoir'),
          h('button', { type: 'button', class: 'btn grade--good' + (hint === true ? ' is-hint' : ''), on: { click: function () { answer(c, true); } } }, 'Su'));
      }
      if (c.kind === 'flash') {
        ans.appendChild(h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: function () {
          ans.replaceChildren(h('div', { class: 'pz-a' }, inlineMd(c.a)), gradeBtns());
        } } }, 'Voir la réponse'));
        return;
      }
      const input = h('input', { type: 'text', class: 'input', placeholder: 'Ta réponse', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
      function check() {
        const v = input.value.trim();
        const ok = looksRight(v, c);
        ans.replaceChildren(
          h('div', { class: 'feedback ' + (ok ? 'feedback--ok' : 'feedback--warn') }, ok ? 'Correct !' : (v ? 'Compare avec la réponse attendue' : 'Réponse attendue')),
          h('div', { class: 'pz-a' }, h('strong', {}, str(c.a)), c.x ? h('div', { class: 'secondary', style: 'margin-top:4px' }, inlineMd(c.x)) : null),
          v ? h('p', { class: 'secondary muted' }, 'Ta réponse : ' + v) : null,
          gradeBtns(v ? ok : undefined));
      }
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); check(); } });
      ans.append(input, h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: check } }, 'Valider'));
      setTimeout(function () { try { input.focus(); } catch (e) { /* ignore */ } }, 50);
    }
    function finish() {
      head.replaceChildren();
      const n = counts(scope);
      stage.replaceChildren(
        h('div', { class: 'feedback feedback--ok' }, 'Session terminée : ' + good + ' / ' + total + ' sues du premier coup.'),
        h('p', { class: 'secondary' }, n.known + ' / ' + n.total + ' cartes bien sues' + (n.fresh ? ' · ' + n.fresh + ' nouvelles restantes' : '') + '.'),
        h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: function () { root.replaceChildren(); renderTrain(scope, root); } } }, 'Encore une session'),
        h('a', { class: 'btn btn--secondary btn--block', href: back }, scope ? 'Retour à la fiche' : 'Retour aux fiches'));
    }
    next();
  }

  function render(params) {
    ensureStyles();
    const root = h('div', { class: 'view-parasito' });
    const id = str(params && params.id);
    if (params && params.train) {
      const scope = id === 'toutes' ? null : list().find(function (x) { return x.id === id; });
      root.dataset.title = 'Cartes parasito';
      renderTrain(scope || null, root);
      return root;
    }
    if (id) {
      const p = list().find(function (x) { return x.id === id; });
      root.dataset.title = p ? str(p.title) : 'Parasito';
      if (!p) root.appendChild(h('div', { class: 'page' }, h('div', { class: 'empty' }, 'Fiche introuvable.')));
      else renderFiche(p, root);
      return root;
    }
    root.dataset.title = 'Parasito-myco';
    root.appendChild(buildList());
    return root;
  }

  CARDIO.views.parasito = { render: render, available: function () { return list().length > 0; } };
})();
