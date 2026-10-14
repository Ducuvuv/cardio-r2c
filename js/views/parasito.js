/* CardioR2C — views/parasito.js
 * Rubrique « Parasito » : une fiche par parasite / mycose, uniquement le rang A (texte rouge) du poly de
 * parasitologie-mycologie (docs/PARASITO.md). Version privée seulement (content/parasito.js n'est pas publié
 * sur GitHub Pages).
 *   #/parasito        liste par groupe (protozoaires, helminthes, ectoparasites, mycologie)
 *   #/parasito/:id    la fiche ; « Lire » ou « Me tester » (mots-clés en gras masqués, révélés au toucher).
 * Contenu : CARDIO.registry.parasito = [{id, title, agent, group, items, pages, hook, sections:[{h, points}]}],
 *           CARDIO.registry.parasitoNoA = ['Ankylostomoses', …] (sections sans rouge).
 * Statut : localStorage « cardio.parasito » = {id: {seen, ok, at}} (confort par appareil).
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
      '.pz-toc a{font-size:.8125rem}'
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
    const bRead = h('button', { type: 'button', class: 'seg__btn is-on', on: { click: function () { setMode(false); } } }, 'Lire');
    const bTest = h('button', { type: 'button', class: 'seg__btn', on: { click: function () { setMode(true); } } }, 'Me tester');
    seg.append(bRead, bTest);

    function setMode(t) {
      bRead.classList.toggle('is-on', !t);
      bTest.classList.toggle('is-on', t);
      draw(t);
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

    const g = GROUPS.find(function (x) { return x[0] === p.group; });
    page.append(
      h('div', {},
        h('div', { class: 'caption' }, (g ? g[1] : 'Parasito') + ' · rang A' + (p.items && p.items.length ? ' · items ' + p.items.join(', ') : '')),
        h('h2', { style: 'margin:4px 0 0' }, str(p.title)),
        p.agent ? h('p', { class: 'pz-card__agent', style: 'margin-top:2px' }, str(p.agent)) : null),
      p.hook ? h('div', { class: 'pz-hook' }, str(p.hook)) : null,
      (p.sections || []).length > 3 ? h('div', { class: 'pz-toc' }, (p.sections || []).map(function (s, i) {
        return h('a', { class: 'pill pill--kind', href: 'javascript:void 0', on: { click: function (e) { e.preventDefault(); const el = document.getElementById('pz-s' + i); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } } }, str(s.h));
      })) : null,
      seg, body, after);
    draw(false);
    root.appendChild(page);
  }

  function render(params) {
    ensureStyles();
    const root = h('div', { class: 'view-parasito' });
    const id = str(params && params.id);
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
