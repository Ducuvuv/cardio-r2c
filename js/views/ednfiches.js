/* CardioR2C — views/ednfiches.js
 * Rubrique « Fiches EDN » : les 380 fiches PDF d'Aymen (items 1-367 + bonus LCA), affichées telles quelles.
 * Données : content/ednfiches.js → CARDIO.registry.ednfiches = [{n, t, u, s, p}] (n = n° d'item, t = titre,
 *   u = URL du PDF dans le store d'assets de l'artefact, s = taille en octets, p = nombre de pages).
 * Routes : #/ednfiches (liste, tours de lecture) · #/ednfiches/:n (lecteur PDF, rendu par pdf.js).
 * Progression : localStorage « cardio.ednfiches » = {"<n>": {c: nb de lectures, at}} (synchronisé via js/lsync.js,
 *   fusion entrée par entrée : store.LSX_MAPS). Privé : deploy_ghpages.py saute content/ednfiches.js. */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  CARDIO.views = CARDIO.views || {};
  const LS = 'cardio.ednfiches';
  const LSV = 'cardio.ednfiches.view';
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  function h() { return CARDIO.util.h.apply(null, arguments); }
  function all() { const r = CARDIO.registry && CARDIO.registry.ednfiches; return Array.isArray(r) ? r : []; }
  function byNum(n) { n = Number(n); return all().filter(function (f) { return f.n === n; }); }
  function key(f) { return f.n + (f.t.indexOf('BONUS') === 0 ? 'b' : ''); }
  function find(k) { return all().filter(function (f) { return key(f) === String(k); })[0] || byNum(k)[0] || null; }
  function pad(n) { return n < 100 ? ('00' + n).slice(-3) : String(n); }
  function prog() { try { const o = JSON.parse(localStorage.getItem(LS) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function count(f, p) { const e = (p || prog())[key(f)]; return e && Number(e.c) > 0 ? Number(e.c) : 0; }
  function setCount(f, c) {
    try { const o = prog(); o[key(f)] = { c: Math.max(0, c), at: Date.now() }; localStorage.setItem(LS, JSON.stringify(o)); } catch (e) { /* ignore */ }
  }
  function viewPrefs() { try { return JSON.parse(localStorage.getItem(LSV) || '{}') || {}; } catch (e) { return {}; } }
  function saveView(o) { try { localStorage.setItem(LSV, JSON.stringify(Object.assign(viewPrefs(), o))); } catch (e) { /* ignore */ } }
  function isBonus(f) { return f.n > 367; }
  function core() { return all().filter(function (f) { return !isBonus(f); }); }
  /* Tour en cours = nombre minimal de lectures sur les items 1-367, + 1. */
  function tourInfo(p) {
    const list = core(); if (!list.length) return { tour: 1, done: 0, total: 0 };
    const min = list.reduce(function (m, f) { return Math.min(m, count(f, p)); }, Infinity);
    return { tour: min + 1, done: list.filter(function (f) { return count(f, p) > min; }).length, total: list.length };
  }
  function nextFiche(p, exclude) {
    const list = core().filter(function (f) { return !exclude || key(f) !== key(exclude); });
    let best = null;
    list.forEach(function (f) { if (!best || count(f, p) < count(best, p)) best = f; });
    return best;
  }
  function randomFiche(p, exclude) {
    const list = core().filter(function (f) { return !exclude || key(f) !== key(exclude); });
    if (!list.length) return null;
    const min = list.reduce(function (m, f) { return Math.min(m, count(f, p)); }, Infinity);
    const pool = list.filter(function (f) { return count(f, p) === min; });
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  let styled = false;
  function styles() {
    if (styled) return; styled = true;
    const css = [
      '.ef-hero{display:flex;flex-direction:column;gap:10px}',
      '.ef-tour{font:700 1.5rem/1.1 var(--font-display)}',
      '.ef-sub{color:var(--muted);font-size:.875rem}',
      '.ef-actions{display:flex;gap:8px;flex-wrap:wrap}',
      '.ef-row{display:flex;align-items:center;gap:12px;padding:10px 14px;text-decoration:none;color:inherit;border-top:1px solid var(--line)}',
      '.ef-row:first-child{border-top:0}',
      '.ef-num{font:700 .95rem/1 var(--font-mono);color:var(--muted);min-width:34px}',
      '.ef-t{flex:1 1 auto;min-width:0;font-weight:500;line-height:1.3;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
      '.ef-c{flex:none;font-size:.75rem;font-weight:700;padding:2px 8px;border-radius:999px;background:var(--surface-2);color:var(--muted)}',
      '.ef-c.on{background:var(--ok-soft);color:var(--ok)}',
      '.ef-c.cur{background:var(--accent-soft);color:var(--accent)}',
      '.ef-list{background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1);overflow:hidden}',
      '.ef-group{margin:18px 0 6px;font-size:.75rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}',
      '.ef-viewer-top{display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
      '.ef-pages{overflow-x:auto;-webkit-overflow-scrolling:touch;margin-inline:calc(-1 * var(--gutter));padding:0 var(--gutter)}',
      '.ef-pages canvas{display:block;background:#fff;margin:0 auto 10px;box-shadow:var(--shadow-1);border-radius:4px}',
      '.ef-status{padding:24px 8px;text-align:center;color:var(--muted)}',
      '.ef-bottom{display:flex;gap:8px;flex-wrap:wrap;justify-content:space-between;margin-top:8px}',
      '.ef-frame{width:100%;height:75vh;border:1px solid var(--line);border-radius:8px;background:#fff}',
      '.ef-err{border-left:4px solid var(--warn)}', '.ef-err__sum{cursor:pointer;font-weight:700;list-style:none}',
      '.ef-err__list{display:grid;gap:8px;margin-top:10px}', '.ef-err__it{font-size:.9rem;line-height:1.4;padding:8px 10px;border-radius:10px;background:var(--surface-2)}',
      '.ef-err__bad{color:var(--bad);text-decoration:line-through;text-decoration-thickness:1px;margin-bottom:3px}', '.ef-err__ok{color:var(--ink)}',
      '.ef-err-pill{flex:none;font-size:.7rem;font-weight:700;padding:2px 7px;border-radius:999px;background:var(--warn-soft);color:var(--warn)}'
    ].join('\n');
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  }

  /* ---------- liste ---------- */
  function renderList(query) {
    styles();
    const p = prog(), ti = tourInfo(p);
    const page = h('div', { class: 'page' });
    page.dataset.title = 'Fiches EDN';
    const pct = ti.total ? Math.round(100 * ti.done / ti.total) : 0;
    const nx = nextFiche(p);
    page.appendChild(h('div', { class: 'card ef-hero' },
      h('div', { class: 'caption' }, '📄 Fiches EDN · ' + all().length + ' fiches'),
      h('div', { class: 'ef-tour' }, 'Tour ' + ti.tour),
      h('div', { class: 'bar' }, h('span', { class: 'bar__fill', style: 'width:' + pct + '%' })),
      h('div', { class: 'ef-sub' }, ti.done + ' / ' + ti.total + ' items lus pendant ce tour (items 1 à 367)'),
      h('div', { class: 'ef-actions' },
        nx ? h('a', { class: 'btn btn--primary', href: '#/ednfiches/' + key(nx) }, '▶ Fiche suivante · ' + pad(nx.n)) : null,
        h('button', { type: 'button', class: 'btn btn--secondary', on: { click: function () { const r = randomFiche(prog()); if (r) location.hash = '#/ednfiches/' + key(r); } } }, '🎲 Au hasard'))));

    const filt = (query && query.f) || 'all';
    let q = (query && query.q) || '';
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Chercher un n° ou un mot (ex. 224, asthme)…', value: q });
    const chips = h('div', { class: 'chips chips--wrap' }, [['all', 'Toutes'], ['todo', 'À lire ce tour'], ['done', 'Déjà lues ce tour'], ['bonus', 'Bonus LCA']].map(function (c) {
      return h('a', { class: 'chip' + (filt === c[0] ? ' is-on' : ''), href: '#/ednfiches?f=' + c[0] }, c[1]);
    }));
    page.appendChild(h('div', { class: 'search' }, search));
    page.appendChild(chips);
    const host = h('div');
    page.appendChild(host);

    function draw() {
      host.textContent = '';
      const nq = norm(q.trim());
      const min = ti.tour - 1;
      let list = all().filter(function (f) {
        if (filt === 'todo' && (isBonus(f) || count(f, p) > min)) return false;
        if (filt === 'done' && (isBonus(f) || count(f, p) <= min)) return false;
        if (filt === 'bonus' && !isBonus(f)) return false;
        if (!nq) return true;
        if (/^\d+$/.test(nq)) return String(f.n).indexOf(String(Number(nq))) === 0;
        return norm(f.t).indexOf(nq) >= 0;
      });
      if (!list.length) { host.appendChild(h('div', { class: 'ef-status' }, 'Aucune fiche.')); return; }
      let curGroup = null, box = null;
      list.forEach(function (f) {
        const g = isBonus(f) ? 'Bonus' : 'Items ' + (Math.floor((f.n - 1) / 50) * 50 + 1) + ' – ' + Math.min(367, Math.floor((f.n - 1) / 50) * 50 + 50);
        if (g !== curGroup) { curGroup = g; host.appendChild(h('div', { class: 'ef-group' }, g)); box = h('div', { class: 'ef-list' }); host.appendChild(box); }
        const c = count(f, p);
        box.appendChild(h('a', { class: 'ef-row', href: '#/ednfiches/' + key(f) },
          h('span', { class: 'ef-num' }, pad(f.n)),
          h('span', { class: 'ef-t' }, f.t),
          f.e ? h('span', { class: 'ef-err-pill' }, '⚠️ corrigée') : null,
          h('span', { class: 'ef-c' + (c > min && !isBonus(f) ? ' on' : (c ? ' cur' : '')) }, c ? '×' + c : f.p + ' p.')));
      });
    }
    let tmr = null;
    search.addEventListener('input', function () { q = search.value; clearTimeout(tmr); tmr = setTimeout(draw, 150); });
    draw();
    if (query && query.check) page.insertBefore(selfCheck(), page.children[1]);
    return page;
  }

  /* Vérification : chaque PDF répond et a la taille attendue (#/ednfiches?check=1). */
  function selfCheck() {
    const out = h('div', { class: 'card', id: 'ef-check' }, 'Vérification des ' + all().length + ' PDF…');
    const list = all(); let ok = 0, bad = [], i = 0;
    function one() {
      if (i >= list.length) { out.textContent = 'Vérif : ' + ok + ' / ' + list.length + ' OK' + (bad.length ? ' · problèmes : ' + bad.join(', ') : ''); return; }
      const f = list[i++];
      fetch(f.u).then(function (r) { return r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status))); })
        .then(function (b) {
          const head = new Uint8Array(b.slice(0, 5)), isPdf = String.fromCharCode.apply(null, head) === '%PDF-';
          if (b.byteLength === f.s && isPdf) ok++; else bad.push(key(f) + '(' + b.byteLength + ')');
        }, function (e) { bad.push(key(f) + '(' + e.message + ')'); })
        .then(function () { out.textContent = 'Vérif… ' + i + ' / ' + list.length + ' · OK ' + ok + (bad.length ? ' · KO ' + bad.length : ''); one(); });
    }
    one();
    return out;
  }

  /* ---------- pdf.js (chargé à la demande) ---------- */
  let pdfjsP = null;
  function loadPdfjs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfjsP) return pdfjsP;
    pdfjsP = new Promise(function (resolve, reject) {
      const s = document.createElement('script'); s.src = PDFJS; s.async = true;
      s.onload = function () {
        const lib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
        if (!lib) { reject(new Error('pdf.js absent')); return; }
        try { lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; } catch (e) { /* ignore */ }
        resolve(lib);
      };
      s.onerror = function () { pdfjsP = null; reject(new Error('pdf.js non chargé')); };
      document.head.appendChild(s);
    });
    return pdfjsP;
  }

  /* ---------- lecteur ---------- */
  function renderFiche(f) {
    styles();
    const page = h('div', { class: 'page page--wide' });
    page.dataset.title = pad(f.n) + ' · Fiche EDN';
    const list = all(), idx = list.indexOf(f);
    const prev = idx > 0 ? list[idx - 1] : null, next = idx < list.length - 1 ? list[idx + 1] : null;
    let zoom = Number(viewPrefs().zoom) || 1;
    const zoomLbl = h('span', { class: 'ef-sub' }, Math.round(zoom * 100) + ' %');
    const cnt = h('span', { class: 'ef-c' }, '');
    function refreshCount() { const c = count(f); cnt.textContent = c ? 'Lue ×' + c : 'Pas encore lue'; cnt.className = 'ef-c' + (c ? ' on' : ''); }
    refreshCount();

    page.appendChild(h('div', { class: 'stack stack--sm' },
      h('div', { class: 'caption' }, 'Item ' + pad(f.n) + ' · ' + f.p + ' page' + (f.p > 1 ? 's' : '')),
      h('h2', { style: 'font-size:1.25rem;margin:0' }, f.t),
      h('div', { class: 'ef-viewer-top' },
        cnt,
        h('button', { type: 'button', class: 'btn btn--sm btn--outline', 'aria-label': 'Dézoomer', on: { click: function () { setZoom(zoom / 1.25); } } }, '−'),
        zoomLbl,
        h('button', { type: 'button', class: 'btn btn--sm btn--outline', 'aria-label': 'Zoomer', on: { click: function () { setZoom(zoom * 1.25); } } }, '+'),
        h('a', { class: 'btn btn--sm btn--ghost', href: f.u, target: '_blank', rel: 'noopener' }, '↗ Plein écran'))));

    if (f.e && ((f.e.fix || []).length || (f.e.add || []).length)) {
      const fx = f.e.fix || [], ad = f.e.add || [];
      page.appendChild(h('details', { class: 'card ef-err', open: true },
        h('summary', { class: 'ef-err__sum' }, '⚠️ Corrections d\'après le Collège · ' + fx.length + ' erreur' + (fx.length > 1 ? 's' : '') + (ad.length ? ' · ' + ad.length + ' ajout' + (ad.length > 1 ? 's' : '') : '')),
        fx.length ? h('div', { class: 'ef-err__list' }, fx.map(function (x) {
          return h('div', { class: 'ef-err__it' },
            h('div', { class: 'ef-err__bad' }, '✗ Fiche : ' + x[0]),
            h('div', { class: 'ef-err__ok' }, '✓ Collège : ' + x[1] + ' ', h('span', { class: 'src' }, x[2])));
        })) : null,
        ad.length ? h('div', { class: 'ef-err__list' }, h('div', { class: 'caption' }, '➕ À ajouter (absent de la fiche)'), ad.map(function (x) {
          return h('div', { class: 'ef-err__it ef-err__ok' }, x[0] + ' ', h('span', { class: 'src' }, x[1]));
        })) : null));
    }

    const pagesEl = h('div', { class: 'ef-pages' }, h('div', { class: 'ef-status' }, 'Chargement de la fiche…'));
    page.appendChild(pagesEl);

    const nx = nextFiche(prog(), f);
    page.appendChild(h('div', { class: 'ef-bottom' },
      h('button', { type: 'button', class: 'btn btn--primary', on: { click: function () {
        setCount(f, count(f) + 1); refreshCount();
        try { CARDIO.shell && CARDIO.shell.toast && CARDIO.shell.toast('Fiche ' + pad(f.n) + ' lue ×' + count(f), { tone: 'ok' }); } catch (e) { /* ignore */ }
        const n2 = nextFiche(prog(), f); if (n2) location.hash = '#/ednfiches/' + key(n2);
      } } }, '✓ Lue · fiche suivante'),
      h('button', { type: 'button', class: 'btn btn--ghost btn--sm', on: { click: function () { if (count(f) > 0) { setCount(f, count(f) - 1); refreshCount(); } } } }, '↺ Annuler une lecture'),
      h('div', { class: 'cluster' },
        prev ? h('a', { class: 'btn btn--sm btn--secondary', href: '#/ednfiches/' + key(prev) }, '← ' + pad(prev.n)) : null,
        h('a', { class: 'btn btn--sm btn--secondary', href: '#/ednfiches' }, 'Liste'),
        next ? h('a', { class: 'btn btn--sm btn--secondary', href: '#/ednfiches/' + key(next) }, pad(next.n) + ' →') : null)));
    if (nx) page.appendChild(h('div', { class: 'ef-sub' }, 'Prochaine fiche du tour : ' + pad(nx.n) + ' · ' + nx.t));

    let doc = null, token = 0;
    function setZoom(z) {
      zoom = Math.max(0.5, Math.min(4, z)); saveView({ zoom: zoom }); zoomLbl.textContent = Math.round(zoom * 100) + ' %';
      if (doc) drawPages();
    }
    function drawPages() {
      const my = ++token;
      pagesEl.textContent = '';
      const base = Math.max(280, (page.clientWidth || window.innerWidth) - 8);
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      let i = 1;
      (function one() {
        if (my !== token || i > doc.numPages) return;
        const n = i++;
        doc.getPage(n).then(function (pg) {
          if (my !== token) return;
          const v1 = pg.getViewport({ scale: 1 });
          const cssW = base * zoom, scale = cssW / v1.width;
          const vp = pg.getViewport({ scale: scale * dpr });
          const cv = document.createElement('canvas');
          cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
          cv.style.width = Math.floor(cssW) + 'px'; cv.style.height = Math.floor(vp.height / dpr) + 'px';
          pagesEl.appendChild(cv);
          return pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
        }).then(one, one);
      })();
    }
    function fallback(err) {
      pagesEl.textContent = '';
      pagesEl.appendChild(h('div', { class: 'ef-status' }, 'Lecteur intégré indisponible' + (err && err.message ? ' (' + err.message + ')' : '') + '. Affichage simple :'));
      pagesEl.appendChild(h('iframe', { class: 'ef-frame', src: f.u, title: f.t }));
    }
    loadPdfjs().then(function (lib) {
      return lib.getDocument({ url: f.u }).promise;
    }).then(function (d) { doc = d; if (page.isConnected) drawPages(); else setTimeout(drawPages, 50); }, fallback);
    return page;
  }

  function render(params, query) {
    const k = params && params.n;
    let el;
    if (k) { const f = find(k); el = f ? renderFiche(f) : renderList(query || {}); }
    else el = renderList(query || {});
    return { el: el, title: el.dataset.title || 'Fiches EDN' };
  }
  CARDIO.views.ednfiches = { render: render, available: function () { return all().length > 0; } };
})();
