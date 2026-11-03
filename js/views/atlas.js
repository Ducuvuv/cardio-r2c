/* CardioR2C — views/atlas.js
 * Atlas photo (docs/ATLAS.md) : images libres de droits (Wikimedia Commons) à reconnaître — lésions de dermato,
 * imagerie thoracique, ECG, parasites et champignons. Données : CARDIO.registry.atlas (content/atlas.js,
 * + content/atlas-micro.js privé). Parcourir (grille → détail avec signes à repérer) ou quiz (image → 4 diagnostics).
 * Progression par image dans localStorage (confort seulement). strip(key) : vignettes pour une fiche.
 * Script classique ES2020.
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  CARDIO.views = CARDIO.views || {};

  function h() { return CARDIO.util.h.apply(null, arguments); }
  /* replaceChildren sans « null » ni tableaux imbriqués affichés en texte */
  function put(el) {
    const kids = Array.prototype.slice.call(arguments, 1).flat(Infinity).filter(function (k) { return k != null && k !== false; });
    el.replaceChildren.apply(el, kids);
  }
  function all() { const r = CARDIO.registry || {}; return Array.isArray(r.atlas) ? r.atlas : []; }
  function cats() { const r = CARDIO.registry || {}; return r.atlasCats || {}; }
  const LS = 'cardio.atlas.v1';
  function prog() { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { return {}; } }
  function saveProg(p) { try { localStorage.setItem(LS, JSON.stringify(p)); } catch (e) { /* ignore */ } }
  function md(s) {   // **gras** seulement ; texte échappé
    const e = String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    return h('span', { html: e.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>') });
  }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function itemLabel(x) {
    const k = x.items && x.items[0];
    if (!k) return '';
    if (x.cat === 'parasito') {
      const p = ((CARDIO.registry || {}).parasito || []).find(function (f) { return f.id === k; });
      return p ? p.title : k;
    }
    try { const r = CARDIO.registry; const m = r && typeof r.item === 'function' ? r.item(k) : null; return 'Item ' + k.replace(/^[dp]/, '') + (m && (m.short || m.title) ? ' · ' + (m.short || m.title) : ''); } catch (e) { return 'Item ' + k; }
  }
  function ficheHref(x) {
    const k = x.items && x.items[0];
    if (!k) return null;
    return x.cat === 'parasito' ? '#/parasito/' + encodeURIComponent(k) : '#/item/' + encodeURIComponent(k) + '/cours';
  }

  let styled = false;
  function ensureStyles() {
    if (styled) return; styled = true;
    document.head.appendChild(h('style', {}, [
      '.at-chips{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 14px}',
      '.at-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}',
      '.at-th{position:relative;display:block;border-radius:12px;overflow:hidden;background:var(--surface-2);aspect-ratio:1/1;border:0;padding:0;cursor:pointer}',
      '.at-th img{width:100%;height:100%;object-fit:cover;display:block}',
      '.at-th span{position:absolute;left:0;right:0;bottom:0;padding:6px 8px;font-size:.78rem;line-height:1.2;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.75));text-align:left}',
      '.at-th.is-hidden span{display:none}',
      '.at-dot{position:absolute;top:6px;right:6px;width:12px;height:12px;border-radius:50%;border:2px solid #fff}',
      '.at-fig{margin:0;border-radius:14px;overflow:hidden;background:#111;display:flex;justify-content:center}',
      '.at-fig img{max-width:100%;max-height:62vh;object-fit:contain;display:block}',
      '.at-cap{font-size:.75rem;color:var(--ink-2);margin:4px 2px 0}',
      '.at-cap a{color:inherit}',
      '.at-opts{display:grid;gap:8px;margin-top:12px}',
      '.at-opt{text-align:left;justify-content:flex-start}',
      '.at-opt.is-ok{background:var(--ok-soft);color:var(--ok);font-weight:600}',
      '.at-opt.is-bad{background:var(--bad-soft);color:var(--bad)}',
      '.at-signs{margin:6px 0 0;padding-left:20px}',
      '.at-signs li{margin:3px 0}',
      '.at-strip{display:flex;gap:8px;overflow-x:auto;padding:2px 0 6px}',
      '.at-strip .at-th{flex:0 0 96px;width:96px;height:96px}',
      '.at-group{margin:18px 0 8px;font-size:.95rem}',
      '.at-lb{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.72);display:flex;align-items:flex-end;justify-content:center}',
      '.at-lb__panel{background:var(--bg,var(--surface));width:100%;max-width:760px;max-height:94vh;overflow:auto;border-radius:18px 18px 0 0;padding:14px 16px 24px;box-shadow:var(--shadow-2)}',
      '@media (min-width:760px){.at-lb{align-items:center}.at-lb__panel{border-radius:18px}}',
      '.at-inline{margin:4px 0 12px;padding:10px;border-radius:12px;background:var(--surface-2)}',
      '.at-inl{margin:0;flex:0 0 120px;width:120px}',
      '.at-inl .at-th{width:120px;height:120px}',
      '.at-inl .at-th span{display:none}',
      '.at-inl figcaption{font-size:.78rem;line-height:1.25;margin-top:4px}'
    ].join('\n')));
  }

  /* Les images publiées sont dans des paquets JS par item (content/atlas-img/*.js → CARDIO.atlasImg[id] = data: URI),
     chargés à la demande ; à défaut (copie locale), le fichier img/atlas/<id>.* est utilisé. */
  const chunkP = {};
  function loadChunk(src) {
    if (!chunkP[src]) chunkP[src] = new Promise(function (res) {
      const s = document.createElement('script'); s.src = src; s.charset = 'utf-8'; s.onload = res; s.onerror = res; document.head.appendChild(s);
    });
    return chunkP[src];
  }
  // file d'attente des vignettes : contrôle de position au défilement (capture : conteneurs internes compris)
  let lazy = [], lazyTimer = null;
  function lazyCheck() {
    const vh = window.innerHeight || 800;
    lazy = lazy.filter(function (p) {
      if (!p.el.isConnected) return !p.seen && Date.now() - p.t < 5000;   // pas encore inséré : on attend un peu
      p.seen = true;
      const r = p.el.getBoundingClientRect();
      if (r.bottom > -400 && r.top < vh + 400 && r.width > 0) { loadChunk(p.chunk).then(p.set); return false; }
      return true;
    });
    if (!lazy.length && lazyTimer) { clearInterval(lazyTimer); lazyTimer = null; }
  }
  function lazyAdd(el, chunk, set) {
    lazy.push({ el: el, chunk: chunk, set: set, t: Date.now() });
    if (!lazyTimer) lazyTimer = setInterval(lazyCheck, 400);
    setTimeout(lazyCheck, 30);
  }
  window.addEventListener('scroll', function () { if (lazy.length) lazyCheck(); }, { capture: true, passive: true });
  window.addEventListener('resize', function () { if (lazy.length) lazyCheck(); });
  function img(x, attrs) {
    const el = h('img', attrs);
    const set = function () { const d = CARDIO.atlasImg && CARDIO.atlasImg[x.id]; el.src = d || x.file; };
    if ((CARDIO.atlasImg && CARDIO.atlasImg[x.id]) || !x.chunk) { set(); return el; }
    // vignettes (loading=lazy) : le paquet n'est chargé que quand l'image approche de l'écran
    if (attrs && attrs.loading === 'lazy') { lazyAdd(el, x.chunk, set); return el; }
    loadChunk(x.chunk).then(set);
    return el;
  }

  function dotColor(p) { if (!p || !p.n) return null; return p.last ? 'var(--ok)' : 'var(--bad)'; }
  function thumb(x, onClick, opts) {
    const p = prog()[x.id];
    const c = dotColor(p);
    return h('button', { type: 'button', class: 'at-th' + (opts && opts.hide ? ' is-hidden' : ''), title: opts && opts.hide ? 'Image' : x.dx, on: { click: onClick } },
      img(x, { alt: opts && opts.hide ? 'Image à reconnaître' : x.dx, loading: 'lazy' }),
      h('span', {}, x.dx),
      c ? h('i', { class: 'at-dot', style: 'background:' + c }) : null);
  }
  function credit(x) {
    return h('p', { class: 'at-cap' }, 'Illustration libre de droits : ', x.credit || '', ' · ',
      h('a', { href: x.src, target: '_blank', rel: 'noopener' }, x.srcName || 'source'));
  }
  function explain(x) {
    const href = ficheHref(x);
    return h('div', { class: 'stack', style: 'gap:6px' },
      h('div', {}, h('strong', {}, 'À repérer'), h('ul', { class: 'at-signs' }, (x.signs || []).map(function (s) { return h('li', {}, md(s)); }))),
      x.objective ? h('p', { class: 'secondary', style: 'margin:0' }, h('span', { class: 'pill pill--kind', style: 'margin-right:6px' }, 'Rang ' + x.rank), 'Objectif : ', x.objective) : null,
      h('p', { class: 'secondary', style: 'margin:0' }, 'Source : ', x.ref || '', href ? [' · ', h('a', { href: href }, 'ouvrir la fiche')] : null),
      credit(x));
  }

  /* Détail d'une image (mode Parcourir) */
  function detail(x, back) {
    const box = h('div', { class: 'stack' },
      h('button', { type: 'button', class: 'btn btn--ghost btn--sm', style: 'justify-self:start', on: { click: back } }, '← Retour à l’atlas'),
      h('h2', { style: 'margin:0' }, x.dx),
      h('p', { class: 'secondary', style: 'margin:0' }, (cats()[x.cat] || x.cat) + ' · ' + itemLabel(x)),
      h('figure', { class: 'at-fig' }, img(x, { alt: x.dx })),
      explain(x));
    return box;
  }

  /* Quiz : image → 4 propositions */
  function options(x, pool) {
    const dx = x.dx;
    const norm = function (s) { return String(s || '').trim().toLowerCase(); };
    let d = (x.distract || []).filter(function (s) { return norm(s) !== norm(dx); });
    d = shuffle(d);
    if (d.length < 3) {
      const more = shuffle(pool.filter(function (y) { return y.cat === x.cat && norm(y.dx) !== norm(dx); }).map(function (y) { return y.dx; }));
      more.forEach(function (s) { if (d.length < 3 && !d.some(function (t) { return norm(t) === norm(s); })) d.push(s); });
    }
    return shuffle([dx].concat(d.slice(0, 3)));
  }
  function runQuiz(list, done) {
    const pool = all();
    let queue = list.slice(), missed = {}, good = 0, first = 0;
    const total = list.length;
    const stage = h('div', { class: 'stack' });
    function next() {
      if (!queue.length) { finish(); return; }
      show(queue.shift());
    }
    function show(x) {
      const opts = options(x, pool);
      const head = h('div', { class: 'row', style: 'justify-content:space-between;align-items:center' },
        h('span', { class: 'secondary' }, (total - queue.length) + ' / ' + total + (missed[x.id] ? ' · deuxième passage' : '')),
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', on: { click: function () { finish(); } } }, 'Terminer'));
      const after = h('div', { class: 'stack', style: 'margin-top:10px' });
      const optBox = h('div', { class: 'at-opts' }, opts.map(function (o) {
        return h('button', { type: 'button', class: 'btn btn--outline at-opt', on: { click: function (ev) { pick(o, ev.currentTarget); } } }, o);
      }));
      function pick(o, btn) {
        const ok = o === x.dx;
        optBox.querySelectorAll('button').forEach(function (b) { b.disabled = true; if (b.textContent === x.dx) b.classList.add('is-ok'); });
        if (!ok) btn.classList.add('is-bad');
        if (!missed[x.id]) {
          const p = prog(); const r = p[x.id] || { n: 0, ok: 0 };
          r.n++; if (ok) r.ok++; r.last = ok ? 1 : 0; r.at = Date.now(); p[x.id] = r; saveProg(p);
          first++; if (ok) good++;
          if (!ok) { missed[x.id] = 1; queue.push(x); }
        }
        try { if (navigator.vibrate) navigator.vibrate(ok ? 15 : [30, 40, 30]); } catch (e) { /* ignore */ }
        put(after, 
          h('p', { style: 'margin:0;font-weight:600;color:' + (ok ? 'var(--ok)' : 'var(--bad)') }, (ok ? '✓ Bien vu : ' : '✗ C’était : ') + x.dx),
          explain(x),
          h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: next } }, queue.length ? 'Image suivante' : 'Voir le bilan'));
        after.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      put(stage, head,
        h('p', { style: 'margin:4px 0 6px;font-weight:600' }, x.q || 'Quel diagnostic ?'),
        h('figure', { class: 'at-fig' }, img(x, { alt: 'Image à reconnaître' })),
        optBox, after);
      window.scrollTo(0, 0);
    }
    function finish() {
      const miss = list.filter(function (x) { return missed[x.id]; });
      put(stage, 
        h('h2', { style: 'margin:0' }, 'Bilan : ' + good + ' / ' + first + ' du premier coup'),
        miss.length ? h('p', { class: 'secondary' }, 'À revoir (déjà repassées une fois) :') : h('p', {}, 'Aucune erreur, bravo.'),
        miss.length ? h('div', { class: 'at-grid' }, miss.map(function (x) { return thumb(x, function () { put(stage, detail(x, finish)); }); })) : null,
        h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: done } }, 'Terminer'));
    }
    next();
    return stage;
  }

  function pickQuiz(list, n) {
    const p = prog();
    // jamais vues et ratées d'abord, puis les autres ; mélange à l'intérieur de chaque groupe
    const score = function (x) { const r = p[x.id]; return !r ? 0 : (r.last ? 2 : 1); };
    const a = shuffle(list.filter(function (x) { return x.quiz !== false; }));
    a.sort(function (x, y) { return score(x) - score(y); });
    return a.slice(0, n || a.length);
  }

  function render(params, query) {
    ensureStyles();
    const q = query || {};
    const root = h('div', { class: 'page view-atlas' });
    const rows = all();
    let cat = q.cat && cats()[q.cat] ? q.cat : 'all';
    const item = q.item ? String(q.item) : null;
    const ret = typeof q.ret === 'string' && /^#\/(item|parasito)\/[A-Za-z0-9_%.-]+/.test(q.ret) ? q.ret : null;
    function backBtn() { return ret ? h('a', { class: 'btn btn--primary', href: ret, style: 'position:sticky;top:8px;z-index:20;display:flex;justify-content:center;margin:0 0 10px;box-shadow:var(--shadow-2)' }, '← Revenir à la fiche') : null; }
    let n = 10, hide = false;
    try { const s = sessionStorage.getItem('cardio.atlas.cat'); if (!q.cat && s && (s === 'all' || cats()[s])) cat = s; } catch (e) { /* ignore */ }

    function scope() {
      return rows.filter(function (x) { return (cat === 'all' || x.cat === cat) && (!item || (x.items || []).indexOf(item) >= 0); });
    }
    function startQuiz(list) {
      const qz = runQuiz(list, ret ? function () { location.hash = ret; } : home);
      put(root, backBtn(), qz);
    }
    function home() {
      const list = scope();
      const counts = {};
      rows.forEach(function (x) { counts[x.cat] = (counts[x.cat] || 0) + 1; });
      const p = prog();
      const seen = list.filter(function (x) { return p[x.id]; }).length;
      const ok = list.filter(function (x) { return p[x.id] && p[x.id].last; }).length;
      const chips = h('div', { class: 'at-chips' },
        [['all', 'Tout (' + rows.length + ')']].concat(Object.keys(cats()).filter(function (k) { return counts[k]; }).map(function (k) { return [k, cats()[k] + ' (' + counts[k] + ')']; }))
          .map(function (c) {
            return h('button', { type: 'button', class: 'btn btn--sm ' + (c[0] === cat ? 'btn--primary' : 'btn--secondary'), on: { click: function () { cat = c[0]; try { sessionStorage.setItem('cardio.atlas.cat', cat); } catch (e) { /* ignore */ } home(); } } }, c[1]);
          }));
      const nSel = h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' }, h('span', { class: 'secondary' }, 'Nombre :'),
        [10, 20, 0].map(function (k) {
          return h('button', { type: 'button', class: 'btn btn--sm ' + (n === k ? 'btn--primary' : 'btn--outline'), on: { click: function () { n = k; home(); } } }, k ? String(k) : 'Toutes');
        }));
      const quizable = list.filter(function (x) { return x.quiz !== false; }).length;
      const groups = {};
      list.forEach(function (x) { const g = itemLabel(x); (groups[g] = groups[g] || []).push(x); });
      put(root, backBtn(),
        h('p', { class: 'secondary', style: 'margin:0' }, 'Les images à savoir reconnaître (objectifs « contenu multimédia » rangs A et B du Collège, et le diagnostic morphologique du poly de parasito). Chaque correction donne les signes à repérer, tirés de tes sources.'),
        item ? h('p', { style: 'margin:8px 0 0' }, h('span', { class: 'pill pill--info' }, 'Fiche : ' + (list[0] ? itemLabel(list[0]) : item)), ' ', h('a', { href: '#/atlas' }, 'voir tout l’atlas')) : chips,
        h('div', { class: 'card stack', style: 'margin:6px 0 14px' },
          h('strong', {}, '🎯 Quiz images'),
          h('p', { class: 'secondary', style: 'margin:0' }, list.length + ' images · ' + seen + ' déjà vues · ' + ok + ' reconnues la dernière fois. Les jamais vues et les ratées passent en premier.'),
          nSel,
          h('button', { type: 'button', class: 'btn btn--primary btn--block', disabled: !quizable, on: { click: function () { startQuiz(pickQuiz(list, n)); } } }, 'Lancer le quiz')),
        h('div', { class: 'row', style: 'justify-content:space-between;align-items:center' },
          h('strong', {}, 'Parcourir'),
          h('label', { class: 'secondary', style: 'display:flex;gap:6px;align-items:center' },
            h('input', { type: 'checkbox', checked: hide, on: { change: function (e) { hide = e.target.checked; home(); } } }), 'cacher les noms')),
        Object.keys(groups).map(function (g) {
          return [h('h3', { class: 'at-group' }, g), h('div', { class: 'at-grid' }, groups[g].map(function (x) {
            return thumb(x, function () { put(root, detail(x, home)); window.scrollTo(0, 0); }, { hide: hide });
          }))];
        }),
        rows.length ? null : h('p', {}, 'Aucune image pour l’instant.'));
    }
    home();
    return { el: root, title: 'Atlas photo' };
  }

  /* Visionneuse par-dessus la page (on reste sur la fiche) : image en grand, diagnostic, signes, crédit ;
     ← → pour passer aux autres images de la même fiche ; Échap / ✕ / clic hors image pour fermer. */
  function lightbox(list, idx) {
    ensureStyles();
    let i = idx || 0;
    const prevOverflow = document.body.style.overflow;
    const box = h('div', { class: 'stack', style: 'gap:8px' });
    const ov = h('div', { class: 'at-lb', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Image',
      on: { click: function (e) { if (e.target === ov) close(); } } },
      h('div', { class: 'at-lb__panel' },
        h('div', { class: 'row', style: 'justify-content:space-between;align-items:center;gap:8px' },
          h('span', { class: 'secondary', 'data-n': '1' }, ''),
          h('button', { type: 'button', class: 'btn btn--secondary btn--sm', on: { click: close } }, '✕ Fermer')),
        box));
    function key(e) { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1); }
    function close() { document.removeEventListener('keydown', key); ov.remove(); document.body.style.overflow = prevOverflow; }
    function go(d) { if (list.length < 2) return; i = (i + d + list.length) % list.length; draw(); }
    function draw() {
      const x = list[i];
      ov.querySelector('[data-n]').textContent = list.length > 1 ? (i + 1) + ' / ' + list.length : '';
      put(box, 
        h('h3', { style: 'margin:0' }, x.dx),
        h('figure', { class: 'at-fig' }, img(x, { alt: x.dx })),
        list.length > 1 ? h('div', { class: 'row', style: 'gap:8px' },
          h('button', { type: 'button', class: 'btn btn--outline', style: 'flex:1', on: { click: function () { go(-1); } } }, '← Précédente'),
          h('button', { type: 'button', class: 'btn btn--outline', style: 'flex:1', on: { click: function () { go(1); } } }, 'Suivante →')) : null,
        explain(x, true));
      ov.querySelector('.at-lb__panel').scrollTop = 0;
    }
    document.addEventListener('keydown', key);
    document.body.style.overflow = 'hidden';
    document.body.appendChild(ov);
    draw();
  }

  function forKey(key) { return all().filter(function (x) { return (x.items || []).indexOf(String(key)) >= 0; }); }
  function quizHref(key, ret) { return '#/atlas?item=' + encodeURIComponent(key) + (ret ? '&ret=' + encodeURIComponent(ret) : ''); }

  /* Bandeau en tête de fiche : toutes les images de la fiche (item « d117 », « p204 », « 231 » ou id parasito). */
  function strip(key, ret) {
    const list = forKey(key);
    if (!list.length) return null;
    ensureStyles();
    return h('div', { class: 'card stack', style: 'margin:10px 0' },
      h('div', { class: 'row', style: 'justify-content:space-between;align-items:center;gap:8px' },
        h('strong', {}, '📷 Images à reconnaître (' + list.length + ')'),
        h('a', { class: 'btn btn--sm btn--primary', href: quizHref(key, ret || location.hash) }, 'Me tester')),
      h('div', { class: 'at-strip' }, list.map(function (x, k) {
        return thumb(x, function () { lightbox(list, k); });
      })),
      h('p', { class: 'secondary', style: 'margin:0;font-size:.8rem' }, 'Touche une image pour l’agrandir sans quitter la fiche.'));
  }

  /* Images dans le cours : chaque image (champ « sec ») est placée en haut de la partie de la fiche Collège
     qui en parle. root = élément de la fiche (views/fiche2.js), num = item. */
  function inline(num, root) {
    const list = forKey(num);
    if (!list.length || !root) return;
    ensureStyles();
    const bySec = {};
    list.forEach(function (x) { if (x.sec) (bySec[x.sec] = bySec[x.sec] || []).push(x); });
    Object.keys(bySec).forEach(function (sid) {
      const body = root.querySelector('.f2-sec[data-sid="' + sid.replace(/"/g, '') + '"] .f2-sec__body');
      if (!body) return;
      const imgs = bySec[sid];
      const ret = '#/item/' + encodeURIComponent(num) + '/cours?sec=' + encodeURIComponent(sid);
      body.insertBefore(h('div', { class: 'at-inline' },
        h('div', { class: 'at-strip' }, imgs.map(function (x) {
          const k = list.indexOf(x);
          return h('figure', { class: 'at-inl' },
            thumb(x, function () { lightbox(list, k); }),
            h('figcaption', {}, x.dx));
        })),
        h('a', { class: 'secondary', style: 'font-size:.8rem', href: quizHref(num, ret) }, '📷 Me tester sur les images de cette fiche →')), body.firstChild);
    });
  }

  CARDIO.views.atlas = { render: render, strip: strip, inline: inline, lightbox: lightbox };
})();
