/* CardioR2C — views/algos.js
 * Rubrique « Algos » : arbres décisionnels de stage, simples et visuels (docs/ALGOS.md).
 *   #/algos           liste par matière (situation, item, statut : nouveau / vu / su)
 *   #/algos/:id       l'arbre en boîtes et flèches ; « Lire » ou « Me tester » (conduites masquées,
 *                     révélées au toucher, puis « Je savais » / « À revoir »).
 * Contenu : CARDIO.registry.algos (content/algos.js) = [{id, spe, item, rank, title, when, tree, footer, pearls, src}].
 * Statut : localStorage « cardio.algos » = {id: {seen, ok, at}} (confort par appareil).
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  CARDIO.views = CARDIO.views || {};

  const SPE_LABEL = { cardio: 'Cardiologie', dermato: 'Dermatologie', pneumo: 'Pneumologie' };
  const KIND_LABEL = { start: 'Situation', q: 'Question', exam: 'Examen', action: 'Conduite', urgent: 'Urgence', ok: 'Rassurant', stop: 'Stop' };
  const HIDDEN_KINDS = { exam: 1, action: 1, urgent: 1, ok: 1, stop: 1 };
  const LS = 'cardio.algos';

  function util() { return CARDIO.util || {}; }
  function h() { const u = util(); return u.h.apply(null, arguments); }
  function str(v) { return v === undefined || v === null ? '' : String(v); }
  function list() { const r = CARDIO.registry || {}; return Array.isArray(r.algos) ? r.algos : []; }
  function activeSpe() {
    try { const s = CARDIO.store; return s && typeof s.activeSpe === 'function' ? s.activeSpe() : 'all'; } catch (e) { return 'all'; }
  }
  function itemLabel(num) {
    try { const r = CARDIO.registry; return r && typeof r.label === 'function' ? r.label(num) : str(num).replace(/^[a-z]+/, ''); } catch (e) { return str(num); }
  }
  function loadState() { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { return {}; } }
  function saveState(st) { try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) { /* stockage indisponible */ } }
  function mark(id, patch) { const st = loadState(); st[id] = Object.assign({}, st[id], patch, { at: Date.now() }); saveState(st); }

  let styled = false;
  function ensureStyles() {
    if (styled) return;
    styled = true;
    const css = [
      '.al-list{display:grid;gap:10px}',
      '.al-card{display:block;padding:14px 16px;border-radius:var(--r-m);background:var(--surface);box-shadow:var(--shadow-1);color:inherit;text-decoration:none}',
      '.al-card:hover{box-shadow:var(--shadow-2);text-decoration:none}',
      '.al-card__top{display:flex;align-items:center;gap:8px;margin-bottom:4px}',
      '.al-card__title{font:700 1.0625rem/1.3 var(--font-display)}',
      '.al-card__when{font-size:.875rem;color:var(--muted);line-height:1.35}',
      '.al-chart{overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;padding:6px 2px 10px;margin-inline:calc(-1 * var(--gutter));padding-inline:var(--gutter)}',
      '.al-tree{display:inline-flex;flex-direction:column;align-items:center;min-width:100%;width:max-content}',
      '.al-node{display:flex;flex-direction:column;align-items:center}',
      '.al-box{position:relative;max-width:240px;min-width:84px;padding:7px 9px;border-radius:10px;border:2px solid var(--line);background:var(--surface);text-align:center;font-weight:600;font-size:.8125rem;line-height:1.25}',
      '.al-box__kind{display:block;font:600 .5625rem/1 var(--font-body);letter-spacing:.06em;text-transform:uppercase;opacity:.7;margin-bottom:3px}',
      '.al-box--start{background:var(--ink);color:var(--bg);border-color:var(--ink)}',
      '.al-box--q{border-color:var(--blue);background:var(--blue-soft)}',
      '.al-box--exam{border-color:var(--info);background:var(--info-soft)}',
      '.al-box--action{border-color:var(--ok);background:var(--ok-soft)}',
      '.al-box--urgent{border-color:var(--bad);background:var(--bad-soft);color:var(--bad)}',
      '.al-box--ok{border-color:var(--ok);background:var(--surface)}',
      '.al-box--stop{border-color:var(--line);background:var(--surface-2);color:var(--ink-2)}',
      '.al-arrow{width:2px;height:16px;background:var(--muted);position:relative;margin:2px 0 6px}',
      '.al-arrow::after{content:"";position:absolute;left:50%;bottom:-5px;transform:translateX(-50%);border:5px solid transparent;border-top-color:var(--muted);border-bottom:0}',
      '.al-branches{display:flex;gap:6px;align-items:flex-start;justify-content:center;border-top:2px solid var(--muted);padding-top:0;margin-top:0}',
      '.al-branch{display:flex;flex-direction:column;align-items:center;min-width:92px;flex:1 1 0}',
      '.al-label{margin-top:-1px;padding:2px 6px;border-radius:0 0 8px 8px;background:var(--surface-3);font-size:.6875rem;font-weight:600;color:var(--ink-2);text-align:center;max-width:150px}',
      '.al-box.is-hidden-a{cursor:pointer;color:transparent!important;text-shadow:none}',
      '.al-box.is-hidden-a .al-box__kind{color:var(--muted)!important;opacity:1}',
      '.al-box.is-hidden-a::after{content:"?";position:absolute;inset:0;display:grid;place-items:center;font:700 1.25rem/1 var(--font-display);color:var(--muted)}',
      '.al-footer{margin-top:4px;padding:10px 12px;border-radius:12px;border:2px dashed var(--line);font-weight:600;font-size:.9375rem;text-align:center}',
      '.al-pearls{margin:0;padding-left:1.1em}',
      '.al-swipe{margin:0 0 -4px;font-size:.75rem}',
      '.al-pearls li{margin:.25em 0}'
    ].join('\n');
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------- liste ---------- */
  function status(id) {
    const s = loadState()[id];
    if (!s) return null;
    if (s.ok === true) return { cls: 'pill--ok', t: 'su' };
    if (s.ok === false) return { cls: 'pill--warn', t: 'à revoir' };
    return s.seen ? { cls: 'pill--info', t: 'vu' } : null;
  }

  function buildList(root) {
    const spe = activeSpe();
    const all = list();
    const shown = all.filter(function (a) { return spe === 'all' || a.spe === spe; });
    const page = h('div', { class: 'page stack' });
    const m = CARDIO.views.matiere;
    if (m && typeof m.switcher === 'function') {
      try { const sw = m.switcher({ onChange: function () { root.replaceChildren(buildList(root)); } }); if (sw) page.appendChild(sw); } catch (e) { /* sans sélecteur */ }
    }
    page.appendChild(h('p', { class: 'secondary' }, 'Les arbres décisionnels de stage : la situation, les questions à se poser et la conduite à tenir, tirés du Collège. Mode « Me tester » : les conduites sont cachées, à toi de les retrouver.'));
    if (!shown.length) {
      page.appendChild(h('div', { class: 'empty' }, h('div', { class: 'empty__title' }, 'Aucun algorithme pour cette matière'), 'Choisis une autre matière.'));
      return page;
    }
    ['cardio', 'pneumo', 'dermato'].forEach(function (s) {
      const group = shown.filter(function (a) { return a.spe === s; });
      if (!group.length) return;
      const st = loadState();
      const done = group.filter(function (a) { return st[a.id] && st[a.id].ok === true; }).length;
      page.appendChild(h('div', { class: 'section-head' }, h('h2', {}, SPE_LABEL[s] || s), h('span', { class: 'secondary muted' }, done + ' / ' + group.length + ' sus')));
      page.appendChild(h('div', { class: 'al-list' }, group.map(function (a) {
        const sta = status(a.id);
        return h('a', { class: 'al-card', href: '#/algos/' + encodeURIComponent(a.id) },
          h('div', { class: 'al-card__top' },
            h('span', { class: 'pill pill--' + (a.rank === 'B' ? 'B' : 'A') }, 'Rang ' + (a.rank === 'B' ? 'B' : 'A')),
            h('span', { class: 'pill pill--kind' }, 'Item ' + itemLabel(a.item)),
            sta ? h('span', { class: 'pill ' + sta.cls }, sta.t) : null),
          h('div', { class: 'al-card__title' }, str(a.title)),
          a.when ? h('div', { class: 'al-card__when' }, str(a.when)) : null);
      })));
    });
    return page;
  }

  /* ---------- arbre ---------- */
  function buildNode(n, test, hidden) {
    if (!n || typeof n !== 'object') return null;
    const kind = KIND_LABEL[n.k] ? n.k : 'q';
    const box = h('div', { class: 'al-box al-box--' + kind }, h('span', { class: 'al-box__kind' }, KIND_LABEL[kind]), str(n.t));
    if (test && HIDDEN_KINDS[kind]) {
      box.classList.add('is-hidden-a');
      box.setAttribute('role', 'button');
      box.setAttribute('tabindex', '0');
      box.setAttribute('aria-label', 'Révéler : ' + KIND_LABEL[kind]);
      hidden.push(box);
    }
    const wrap = h('div', { class: 'al-node' }, box);
    if (n.next) {
      wrap.appendChild(h('div', { class: 'al-arrow', 'aria-hidden': 'true' }));
      wrap.appendChild(buildNode(n.next, test, hidden));
    } else if (Array.isArray(n.branches) && n.branches.length) {
      wrap.appendChild(h('div', { class: 'al-arrow', 'aria-hidden': 'true' }));
      wrap.appendChild(h('div', { class: 'al-branches' }, n.branches.map(function (b) {
        return h('div', { class: 'al-branch' },
          h('div', { class: 'al-label' }, str(b && b.label)),
          h('div', { class: 'al-arrow', 'aria-hidden': 'true' }),
          buildNode(b && b.node, test, hidden));
      })));
    }
    return wrap;
  }

  /* L'arbre doit tenir dans la largeur du téléphone : réduction jusqu'à 60 %, puis défilement centré. */
  function fit(chart, tree, tries) {
    requestAnimationFrame(function () {
      if (!chart.isConnected || !chart.clientWidth) {
        if ((tries || 0) < 40) setTimeout(function () { fit(chart, tree, (tries || 0) + 1); }, 50);
        return;
      }
      tree.style.transform = '';
      chart.style.height = '';
      const cw = chart.clientWidth - 4, sw = tree.scrollWidth;
      if (sw <= cw) return;
      const s = Math.max(0.6, cw / sw);
      tree.style.transformOrigin = 'top left';
      tree.style.transform = 'scale(' + s.toFixed(3) + ')';
      chart.style.height = Math.ceil(tree.offsetHeight * s + 16) + 'px';
      if (sw * s > cw) {
        chart.scrollLeft = (sw * s - cw) / 2;
        if (!chart.previousElementSibling || !chart.previousElementSibling.classList.contains('al-swipe')) {
          chart.parentNode.insertBefore(h('p', { class: 'al-swipe secondary muted center' }, '← Fais glisser l’arbre pour voir toutes les branches →'), chart);
        }
      }
    });
  }

  function renderAlgo(a, root) {
    const page = h('div', { class: 'page stack' });
    let test = false;
    const chartHost = h('div', {});
    const after = h('div', { class: 'stack' });
    const seg = h('div', { class: 'seg seg--block', role: 'tablist' });
    const bRead = h('button', { type: 'button', class: 'seg__btn is-on', on: { click: function () { setMode(false); } } }, 'Lire');
    const bTest = h('button', { type: 'button', class: 'seg__btn', on: { click: function () { setMode(true); } } }, 'Me tester');
    seg.append(bRead, bTest);

    function setMode(t) {
      test = t;
      bRead.classList.toggle('is-on', !t);
      bTest.classList.toggle('is-on', t);
      draw();
    }
    function draw() {
      const hidden = [];
      const tree = h('div', { class: 'al-tree' }, buildNode(a.tree, test, hidden));
      if (a.footer) {
        tree.appendChild(h('div', { class: 'al-arrow', 'aria-hidden': 'true' }));
        tree.appendChild(h('div', { class: 'al-footer' }, str(a.footer)));
      }
      const chart = h('div', { class: 'al-chart' }, tree);
      chartHost.replaceChildren(chart);
      fit(chart, tree);
      after.replaceChildren();
      if (!test) { mark(a.id, { seen: true }); after.appendChild(extras()); return; }
      let left = hidden.length;
      const hint = h('p', { class: 'secondary muted center' }, 'Touche chaque « ? » après avoir répondu de tête (' + left + ' à trouver).');
      after.appendChild(hint);
      function reveal(box) {
        if (!box.classList.contains('is-hidden-a')) return;
        box.classList.remove('is-hidden-a');
        left--;
        hint.textContent = left > 0 ? 'Encore ' + left + ' à révéler.' : 'Tout est révélé. Tu savais ?';
        if (left === 0) {
          after.appendChild(h('div', { class: 'grades', style: 'grid-template-columns:1fr 1fr' },
            h('button', { type: 'button', class: 'btn grade--again', on: { click: function () { mark(a.id, { seen: true, ok: false }); done('À revoir : il reviendra dans ta liste.'); } } }, 'À revoir'),
            h('button', { type: 'button', class: 'btn grade--good', on: { click: function () { mark(a.id, { seen: true, ok: true }); done('Bien joué !'); } } }, 'Je savais')));
        }
      }
      hidden.forEach(function (b) {
        b.addEventListener('click', function () { reveal(b); });
        b.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal(b); } });
      });
    }
    function done(msg) {
      after.replaceChildren(h('div', { class: 'feedback feedback--ok' }, msg), extras(), nextLink());
    }
    function extras() {
      const box = h('div', { class: 'stack' });
      if (Array.isArray(a.pearls) && a.pearls.length) {
        box.appendChild(h('div', { class: 'pitfall' }, h('span', { class: 'caption' }, 'À retenir'),
          h('ul', { class: 'al-pearls' }, a.pearls.map(function (p) { return h('li', {}, str(p)); }))));
      }
      box.appendChild(h('div', { class: 'cluster' },
        a.src ? h('span', { class: 'src' }, 'Collège · ' + str(a.src)) : null,
        a.item ? h('a', { class: 'btn btn--sm btn--outline', href: '#/item/' + encodeURIComponent(a.item) }, 'Item ' + itemLabel(a.item)) : null));
      return box;
    }
    function nextLink() {
      const all = list().filter(function (x) { return x.spe === a.spe; });
      const i = all.findIndex(function (x) { return x.id === a.id; });
      const nx = i >= 0 && i + 1 < all.length ? all[i + 1] : null;
      return nx ? h('a', { class: 'btn btn--primary btn--block', href: '#/algos/' + encodeURIComponent(nx.id) }, 'Algo suivant : ' + str(nx.title)) : h('a', { class: 'btn btn--secondary btn--block', href: '#/algos' }, 'Tous les algos');
    }

    page.append(
      h('div', {}, h('div', { class: 'caption' }, (SPE_LABEL[a.spe] || '') + ' · Item ' + itemLabel(a.item)), h('h2', { style: 'margin:4px 0 0' }, str(a.title)),
        a.when ? h('p', { class: 'secondary', style: 'margin-top:4px' }, str(a.when)) : null),
      seg, chartHost, after);
    draw();
    root.appendChild(page);
  }

  function render(params) {
    ensureStyles();
    const root = h('div', { class: 'view-algos' });
    const id = str(params && params.id);
    if (id) {
      const a = list().find(function (x) { return x.id === id; });
      root.dataset.title = a ? str(a.title) : 'Algo';
      if (!a) root.appendChild(h('div', { class: 'page' }, h('div', { class: 'empty' }, 'Algorithme introuvable.')));
      else renderAlgo(a, root);
      return root;
    }
    root.dataset.title = 'Algos de stage';
    root.appendChild(buildList(root));
    return root;
  }

  function forItem(num) { return list().filter(function (a) { return str(a.item) === str(num); }); }

  CARDIO.views.algos = { render: render, forItem: forItem };
})();
