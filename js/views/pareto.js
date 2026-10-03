/* CardioR2C — views/pareto.js
 * Récaps « loi de Pareto » : pour chaque item, les 10 à 15 faits qui rapportent le plus, dans l'ordre
 * (docs/MULTI.md §4).
 *   #/pareto              liste des items de la matière active + statut (à lire / dernier test / maîtrisé)
 *   #/item/:num/pareto    la liste : « Lire » (tout visible) ou « Me tester » (mots-clés en gras masqués,
 *                         révélés au toucher, puis « Je savais » / « À revoir » ; résultat enregistré dans
 *                         state.itemStats[num].pareto = {at, score, runs}).
 * Contenu : CARDIO.registry.load(num) → content.pareto ({id, points:[{id, rank, cat, text, src}]}) ou null.
 * Script classique ES2020 ; appels aux autres modules uniquement à l'exécution, dégradation propre.
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  CARDIO.views = CARDIO.views || {};

  const MASTERED = 0.8;
  const CAT_LABEL = {
    'définition': 'Définition', clinique: 'Clinique', 'gravité': 'Gravité', examen: 'Examen', 'étiologie': 'Cause',
    traitement: 'Traitement', 'piège': 'Piège', chiffre: 'Chiffre', suivi: 'Suivi', 'prévention': 'Prévention'
  };
  const CAT_TONE = { 'gravité': 'bad', 'piège': 'warn', traitement: 'ok', chiffre: 'info', examen: 'info' };

  function util() { return CARDIO.util || {}; }
  function store() { return CARDIO.store || null; }
  function registry() { return CARDIO.registry || null; }
  function matiere() { return CARDIO.views.matiere || null; }
  function h() { const u = util(); return u.h.apply(null, arguments); }
  function str(v) { return v === undefined || v === null ? '' : String(v); }
  function safe(fn, fallback) {
    try { const v = fn(); return v === undefined ? fallback : v; } catch (e) { console.warn('[pareto]', e); return fallback; }
  }
  function icon(name) { const u = util(); try { return typeof u.icon === 'function' ? u.icon(name) || '' : ''; } catch (e) { return ''; } }
  function pct(x) { return Math.round(Math.max(0, Math.min(1, Number(x) || 0)) * 100); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  /* Markdown-lite en ligne (le gras devient <strong>, que le mode test masque). */
  function mdInline(text) {
    const u = util();
    let html = '';
    if (typeof u.md === 'function') { try { html = u.md(str(text)).trim(); } catch (e) { html = ''; } }
    if (!html) html = esc(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    const m = /^<p>([\s\S]*)<\/p>$/.exec(html);
    return m && m[1].indexOf('<p>') < 0 ? m[1] : html;
  }
  function toast(msg, tone) {
    const s = CARDIO.shell;
    if (s && typeof s.toast === 'function') { try { s.toast(msg, { tone: tone || 'info' }); } catch (e) { /* ignore */ } }
  }
  function label(num) { const r = registry(); return r && typeof r.label === 'function' ? r.label(num) : str(num); }

  function allItems() {
    const r = registry();
    return r && typeof r.items === 'function' ? safe(function () { return r.items(); }, []) || [] : [];
  }
  function findItem(num) {
    const r = registry();
    return (r && typeof r.item === 'function' ? safe(function () { return r.item(num); }, null) : null)
      || allItems().find(function (x) { return str(x.num) === str(num); }) || null;
  }
  function hasPareto(it) { return !!(it && it.counts && Number(it.counts.par) > 0); }
  function scopedItems() {
    const m = matiere();
    const spe = m ? m.current() : 'all';
    return allItems().filter(function (it) { return it.available !== false && (spe === 'all' || (it.spe || 'cardio') === spe); });
  }

  /* Dernier test : {at, score, runs} ou null. */
  function stat(num) {
    const s = store();
    const is = ((s && s.state && s.state.itemStats) || {})[str(num)];
    const p = is && is.pareto;
    if (!p || typeof p !== 'object' || !(Number(p.runs) > 0)) return null;
    return { at: Number(p.at) || 0, score: Math.max(0, Math.min(1, Number(p.score) || 0)), runs: Math.round(Number(p.runs)) };
  }
  function status(it) {
    if (!hasPareto(it)) return { key: 'soon', label: 'bientôt' };
    const st = stat(it.num);
    if (!st) return { key: 'new', label: 'à découvrir' };
    if (st.score >= MASTERED) return { key: 'ok', label: 'maîtrisé · ' + pct(st.score) + ' %' };
    return { key: 'warn', label: 'dernier test ' + pct(st.score) + ' %' };
  }

  const CSS = [
    '.pa__h1{font:700 1.625rem/1.15 var(--font-display);margin:8px 0 4px;text-wrap:balance}',
    '.pa__lead{margin:0 0 14px;color:var(--muted);font-size:.9375rem}',
    '.pa__kicker{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:8px 0 6px}',
    '.pa__item{margin:0 0 4px;font-size:.9375rem;color:var(--ink-2)}',
    '.pa__bar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:12px 0}',
    '.pa__count{font-size:.8125rem;color:var(--muted);font-variant-numeric:tabular-nums}',
    '.pa__list{list-style:none;margin:0;padding:0;display:grid;gap:10px;counter-reset:pa}',
    '.pa__pt{display:grid;grid-template-columns:32px 1fr;gap:10px;align-items:start;background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1);padding:12px 14px}',
    '.pa__n{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--accent-soft);color:var(--accent);font:700 .875rem/1 var(--font-display);font-variant-numeric:tabular-nums}',
    '.pa__pt:nth-child(-n+3) .pa__n{background:var(--accent);color:var(--accent-ink)}',
    '.pa__body{min-width:0}',
    '.pa__text{font-size:1rem;line-height:1.45;overflow-wrap:anywhere}',
    '.pa__text strong{font-weight:700;color:var(--ink)}',
    '.pa__meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px;font-size:.75rem;color:var(--muted)}',
    '.pa__mask{display:inline;border-radius:4px;background:var(--surface-3);color:transparent;cursor:pointer;padding:0 2px;-webkit-user-select:none;user-select:none;box-decoration-break:clone;-webkit-box-decoration-break:clone}',
    '.pa__mask:focus-visible{outline:2px solid var(--blue);outline-offset:1px}',
    '.pa__mask.is-shown{background:var(--warn-soft);color:var(--ink);cursor:default}',
    '.pa__judge{display:flex;gap:8px;margin-top:10px}',
    '.pa__judge .btn{flex:1 1 0}',
    '.pa__pt.is-known{box-shadow:inset 3px 0 0 var(--ok),var(--shadow-1)}',
    '.pa__pt.is-miss{box-shadow:inset 3px 0 0 var(--bad),var(--shadow-1)}',
    '.pa__result{margin:16px 0;padding:16px;border-radius:var(--r-m);background:var(--surface);box-shadow:var(--shadow-2);display:grid;gap:10px;text-align:center}',
    '.pa__score{font:700 2.25rem/1 var(--font-display);font-variant-numeric:tabular-nums}',
    '.pa__score.is-ok{color:var(--ok)}.pa__score.is-warn{color:var(--warn)}',
    '.pa__nav{display:flex;justify-content:space-between;gap:10px;margin:18px 0 8px}',
    '.pa__nav a{font-size:.875rem;font-weight:600;text-decoration:none;color:var(--blue);max-width:48%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.pa__ctas{display:grid;gap:8px;margin-top:14px}',
    '.pa__group{margin:18px 0 8px;font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}',
    '.pa__rows{display:grid;gap:8px}',
    '.pa__row{display:grid;grid-template-columns:52px 1fr auto;gap:10px;align-items:center;text-decoration:none;color:inherit;background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1);padding:12px 14px;min-height:56px}',
    '.pa__row.is-soon{opacity:.55}',
    '.pa__row-num{font:700 1rem/1 var(--font-display);font-variant-numeric:tabular-nums}',
    '.pa__row-num small{display:block;font:500 .6875rem/1.2 var(--font-body);color:var(--muted);margin-top:3px}',
    '.pa__row-short{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.pa__row-sub{font-size:.75rem;color:var(--muted)}',
    '.pa__empty{padding:16px;border-radius:var(--r-m);background:var(--surface-2);color:var(--ink-2)}'
  ].join('\n');
  function ensureStyles() {
    if (document.getElementById('pareto-view-css')) return;
    const s = document.createElement('style');
    s.id = 'pareto-view-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------- Liste (#/pareto) ---------- */

  function rowFor(it) {
    const st = status(it);
    const pill = st.key === 'ok' ? 'pill--ok' : st.key === 'warn' ? 'pill--warn' : st.key === 'soon' ? 'pill--outline' : 'pill--info';
    return h('a', { class: 'pa__row' + (st.key === 'soon' ? ' is-soon' : ''), href: '#/item/' + it.num + '/pareto',
      'aria-label': 'Item ' + label(it.num) + ', ' + (it.short || '') + ' : ' + st.label },
    h('span', { class: 'pa__row-num' }, label(it.num), h('small', {}, 'item')),
    h('span', { style: 'min-width:0' },
      h('div', { class: 'pa__row-short' }, it.short || it.title || ''),
      h('div', { class: 'pa__row-sub' }, hasPareto(it) ? it.counts.par + ' points' : 'en préparation')),
    h('span', { class: 'pill ' + pill }, st.label));
  }

  function buildList() {
    const page = h('div', { class: 'page pa' });
    page.appendChild(h('h1', { class: 'pa__h1' }, 'Récaps Pareto'));
    page.appendChild(h('p', { class: 'pa__lead' }, 'Pour chaque item, les quelques faits qui rapportent le plus de points, dans l’ordre. Lis-les, puis passe en « Me tester » : les mots-clés en gras se cachent.'));
    const m = matiere();
    const sw = m ? m.switcher() : null;
    if (sw) page.appendChild(sw);
    const items = scopedItems();
    const withP = items.filter(hasPareto);
    if (!withP.length) {
      page.appendChild(h('p', { class: 'pa__empty' }, 'Les récaps de cette matière sont en préparation.'));
      return page;
    }
    const tested = withP.filter(function (it) { return stat(it.num); });
    const mastered = tested.filter(function (it) { return stat(it.num).score >= MASTERED; });
    page.appendChild(h('p', { class: 'pa__count' }, withP.length + ' items · ' + tested.length + ' testés · ' + mastered.length + ' maîtrisés'));
    const next = withP.find(function (it) { return !stat(it.num); }) || withP.find(function (it) { return stat(it.num).score < MASTERED; });
    if (next) {
      page.appendChild(h('div', { class: 'pa__ctas' },
        h('a', { class: 'btn btn--primary btn--block', href: '#/item/' + next.num + '/pareto' },
          (tested.length ? 'Continuer : ' : 'Commencer : ') + 'item ' + label(next.num) + ' · ' + (next.short || ''))));
    }
    let group = null, rows = null;
    items.forEach(function (it) {
      const g = (it.spe || 'cardio') + '|' + it.section;
      if (g !== group) {
        group = g;
        page.appendChild(h('div', { class: 'pa__group' }, it.sectionTitle || ''));
        rows = h('div', { class: 'pa__rows' });
        page.appendChild(rows);
      }
      rows.appendChild(rowFor(it));
    });
    return page;
  }

  /* ---------- Une liste (#/item/:num/pareto) ---------- */

  function maskStrongs(el, onReveal) {
    Array.prototype.slice.call(el.querySelectorAll('strong')).forEach(function (s) {
      const m = h('span', { class: 'pa__mask', role: 'button', tabindex: '0', 'aria-label': 'Révéler le mot caché' });
      m.textContent = s.textContent;
      function reveal() {
        if (m.classList.contains('is-shown')) return;
        m.classList.add('is-shown');
        m.removeAttribute('role'); m.removeAttribute('tabindex'); m.removeAttribute('aria-label');
        onReveal();
      }
      m.addEventListener('click', reveal);
      m.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal(); } });
      s.replaceWith(m);
    });
  }

  function pointEl(p, i, test, onJudge) {
    const text = h('div', { class: 'pa__text', html: mdInline(p.text) });
    const li = h('li', { class: 'pa__pt', dataset: { id: p.id } },
      h('span', { class: 'pa__n', 'aria-hidden': 'true' }, String(i + 1)),
      h('div', { class: 'pa__body' }, text,
        h('div', { class: 'pa__meta' },
          p.cat ? h('span', { class: 'pill pill--' + (CAT_TONE[p.cat] || 'kind') }, CAT_LABEL[p.cat] || p.cat) : null,
          p.rank === 'B' ? h('span', { class: 'pill pill--B' }, 'B') : null,
          p.src ? h('span', {}, p.src) : null)));
    if (!test) return li;
    const body = li.querySelector('.pa__body');
    const hidden = text.querySelectorAll('strong').length;
    let shown = 0;
    const judge = h('div', { class: 'pa__judge', hidden: true },
      h('button', { type: 'button', class: 'btn btn--sm btn--danger', on: { click: function () { mark(false); } } }, 'À revoir'),
      h('button', { type: 'button', class: 'btn btn--sm btn--ok', on: { click: function () { mark(true); } } }, 'Je savais'));
    function mark(known) {
      li.classList.toggle('is-known', known);
      li.classList.toggle('is-miss', !known);
      judge.querySelectorAll('button').forEach(function (b) { b.classList.remove('is-on'); });
      onJudge(p.id, known);
    }
    maskStrongs(text, function () { shown++; if (shown >= hidden) judge.hidden = false; });
    if (!hidden) judge.hidden = false;
    body.appendChild(judge);
    return li;
  }

  function save(num, score) {
    const s = store();
    if (!s || typeof s.update !== 'function') { toast('Sauvegarde indisponible : ton score n’est pas enregistré.', 'warn'); return; }
    try {
      s.update(function (st) {
        st.itemStats = st.itemStats || {};
        const is = st.itemStats[num] || (st.itemStats[num] = { lastVisited: 0, sessions: 0 });
        const prev = is.pareto && typeof is.pareto === 'object' ? is.pareto : null;
        is.pareto = { at: Date.now(), score: Math.round(score * 1000) / 1000, runs: (prev ? Math.max(0, Math.round(Number(prev.runs) || 0)) : 0) + 1 };
      });
    } catch (e) { console.warn('[pareto] save', e); toast('Enregistrement impossible.', 'bad'); }
  }

  function navLinks(it) {
    const list = scopedItems().filter(hasPareto);
    const i = list.findIndex(function (x) { return str(x.num) === str(it.num); });
    if (i < 0) return null;
    const prev = list[i - 1], next = list[i + 1];
    return h('nav', { class: 'pa__nav', 'aria-label': 'Autres récaps' },
      prev ? h('a', { href: '#/item/' + prev.num + '/pareto' }, '‹ ' + label(prev.num) + ' · ' + (prev.short || '')) : h('span'),
      next ? h('a', { href: '#/item/' + next.num + '/pareto' }, label(next.num) + ' · ' + (next.short || '') + ' ›') : h('span'));
  }

  function renderItem(num, root) {
    const it = findItem(num);
    const page = h('div', { class: 'page pa' });
    const spe = registry() && typeof registry().speOf === 'function' ? registry().speOf(num) : 'cardio';
    const m = matiere();
    page.appendChild(h('div', { class: 'pa__kicker' }, 'Item ' + label(num) + (m && m.multi() ? ' · ' + m.title(spe) : '')));
    page.appendChild(h('h1', { class: 'pa__h1' }, 'Les 20 % qui rapportent 80 %'));
    page.appendChild(h('p', { class: 'pa__item' }, it ? (it.short + (it.title && it.title !== it.short ? ' — ' + it.title : '')) : ''));
    const host = h('div', {}, h('p', { class: 'pa__lead' }, 'Chargement…'));
    page.appendChild(host);
    root.replaceChildren(page);
    const r = registry();
    if (!r || typeof r.load !== 'function') { host.replaceChildren(h('p', { class: 'pa__empty' }, 'Le contenu n’est pas disponible.')); return; }
    // Le contenu peut être déjà chargé : on attend que la vue soit insérée par le routeur avant de dessiner.
    new Promise(function (res) { setTimeout(res, 0); }).then(function () { return r.load(num); }).then(function (content) {
      if (!host.isConnected) return;
      const P = content && content.pareto;
      const points = P && Array.isArray(P.points) ? P.points : [];
      if (!points.length) {
        host.replaceChildren.apply(host, [h('p', { class: 'pa__empty' }, 'Le récap de cet item est en préparation.'),
          it ? h('a', { class: 'btn btn--secondary btn--block', href: '#/item/' + it.num }, 'Retour à l’item') : null].filter(Boolean));
        return;
      }
      let mode = 'read';
      let done = false;
      const answers = {};
      const listEl = h('ol', { class: 'pa__list' });
      const result = h('div', { class: 'pa__result', hidden: true });
      const count = h('span', { class: 'pa__count' });
      const seg = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Mode' });
      function judged() { return Object.keys(answers).length; }
      function refreshCount() {
        count.textContent = mode === 'read' ? points.length + ' points' : judged() + ' / ' + points.length + ' évalués';
        if (mode === 'test' && !done && judged() === points.length) { done = true; finish(); }
      }
      function finish() {
        const known = Object.keys(answers).filter(function (k) { return answers[k]; }).length;
        const score = known / points.length;
        save(str(num), score);
        const ok = score >= MASTERED;
        result.replaceChildren(
          h('div', { class: 'pa__score ' + (ok ? 'is-ok' : 'is-warn') }, pct(score) + ' %'),
          h('div', {}, known + ' / ' + points.length + ' points sus. ' + (ok ? 'Récap maîtrisé : passe aux questions de l’item.' : 'Relis les points en rouge, puis reteste-toi.')),
          h('div', { class: 'pa__ctas' },
            h('a', { class: 'btn btn--primary btn--block', href: '#/review?mode=item&item=' + num + '&autostart=1' }, 'Réviser cet item'),
            h('button', { type: 'button', class: 'btn btn--secondary btn--block', on: { click: function () { setMode('test'); } } }, 'Me retester')));
        result.hidden = false;
        result.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      function draw() {
        listEl.replaceChildren.apply(listEl, points.map(function (p, i) {
          return pointEl(p, i, mode === 'test', function (id, known) { answers[id] = known; refreshCount(); });
        }));
        refreshCount();
      }
      function setMode(m2) {
        mode = m2;
        done = false;
        Object.keys(answers).forEach(function (k) { delete answers[k]; });
        result.hidden = true;
        seg.querySelectorAll('.seg__btn').forEach(function (b) { b.classList.toggle('is-on', b.dataset.mode === mode); b.setAttribute('aria-selected', b.dataset.mode === mode ? 'true' : 'false'); });
        draw();
      }
      [['read', 'Lire'], ['test', 'Me tester']].forEach(function (x) {
        seg.appendChild(h('button', { type: 'button', class: 'seg__btn' + (x[0] === mode ? ' is-on' : ''), role: 'tab', dataset: { mode: x[0] },
          'aria-selected': x[0] === mode ? 'true' : 'false', on: { click: function () { setMode(x[0]); } } }, x[1]));
      });
      const st = stat(num);
      host.replaceChildren.apply(host, [
        h('div', { class: 'pa__bar' }, seg, count),
        st ? h('p', { class: 'pa__lead' }, 'Dernier test : ' + pct(st.score) + ' %' + (st.score >= MASTERED ? ' · maîtrisé' : ' · vise 80 %')) : null,
        listEl, result,
        h('div', { class: 'pa__ctas' },
          h('a', { class: 'btn btn--secondary btn--block', href: '#/review?mode=item&item=' + num + '&autostart=1' }, 'Réviser les questions de cet item'),
          it ? h('a', { class: 'btn btn--ghost btn--block', href: '#/item/' + it.num }, 'Retour à l’item') : null),
        it ? navLinks(it) : null].filter(Boolean));
      draw();
    }, function (err) {
      if (!host.isConnected) return;
      host.replaceChildren(h('p', { class: 'pa__empty' }, (err && err.message) || 'Impossible de charger le récap.'));
    });
  }

  function render(params) {
    ensureStyles();
    const num = str(params && (params.num || params.item));
    const root = h('div', { class: 'view-pareto' });
    if (num) {
      const it = findItem(num);
      root.dataset.title = it ? (it.short || 'Item ' + label(num)) + ' · Récap Pareto' : 'Récap Pareto';
      renderItem(num, root);
      return root;
    }
    root.dataset.title = 'Récaps Pareto';
    root.appendChild(buildList());
    const u = util();
    if (typeof u.on === 'function') {
      const handler = function () {
        if (!root.isConnected) { if (root.dataset.mounted === '1' && typeof u.off === 'function') u.off('store:change', handler); return; }
        root.dataset.mounted = '1';
        try { root.replaceChildren(buildList()); } catch (e) { console.warn('[pareto] refresh', e); }
      };
      u.on('store:change', handler);
      requestAnimationFrame(function () { if (root.isConnected) root.dataset.mounted = '1'; });
    }
    return root;
  }

  CARDIO.views.pareto = { render: render, stat: stat, hasPareto: hasPareto };
})();
