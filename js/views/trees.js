/* CardioR2C — CARDIO.views.trees
 * Arbres décisionnels : liste globale (#/trees), liste par item (#/item/:num/arbres),
 * mode « Pas à pas » (renderWalkthrough) et « Vue d'ensemble » (renderOutline).
 * Script classique ES2020, aucune dépendance au moment du chargement : tous les appels
 * vers CARDIO.util / store / registry / shell se font à l'exécution et se dégradent proprement.
 */
(function () {
  'use strict';

  window.CARDIO = window.CARDIO || {};
  CARDIO.views = CARDIO.views || {};

  /* ------------------------------------------------------------------ */
  /* Petits utilitaires défensifs (util.js peut être absent ou partiel)  */
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

  // Constructeur DOM minimal utilisé seulement si CARDIO.util.h manque.
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

  // h() : délègue à CARDIO.util.h ; les propriétés booléennes (open, disabled…) sont posées
  // en propriété DOM après création pour ne pas dépendre de la sémantique de setAttribute.
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

  function mdEl(text, cls) {
    const d = h('div', { class: cls || 'md' });
    d.innerHTML = mdHTML(text); // md() échappe le texte source
    return d;
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

  function stripText(s, max) {
    const t = String(s || '').replace(/[*_>#`|]/g, '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
  }

  /* ------------------------------------------------------------------ */
  /* Styles propres à la vue (tokens uniquement)                          */
  /* ------------------------------------------------------------------ */

  const CSS = `
  .page-head{margin:0 0 16px}
  .page-title{font-family:var(--font-display);font-size:1.75rem;line-height:1.15;margin:0;text-wrap:balance}
  .page-sub{color:var(--muted);margin:4px 0 0;font-size:.875rem}
  .src{color:var(--muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.06em}
  .empty{color:var(--muted);text-align:center;padding:24px 8px}
  .tree-list{display:grid;gap:12px}
  .tree-card__top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  .tree-card__title{font-family:var(--font-display);font-size:1.125rem;margin:0;line-height:1.3}
  .tree-card__meta{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;color:var(--muted);font-size:.875rem;margin-top:6px}
  .tree-card__actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
  .tree-group{margin:20px 0 8px;display:flex;align-items:baseline;justify-content:space-between;gap:8px}
  .tree-group__title{font-family:var(--font-display);font-size:1.125rem;margin:0}
  .tree-group__link{color:var(--blue);font-size:.875rem;text-decoration:none;font-weight:600}
  .tree-sheet__head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:6px}
  .tree-sheet__title{font-family:var(--font-display);font-size:1.375rem;margin:0;line-height:1.2}
  .tree-sheet__intro{color:var(--ink-2);margin:6px 0 10px}
  .tree-sheet__intro p{margin:0 0 6px}
  .tree-sheet .tabs{margin:12px 0}
  .walk__crumbs{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0 12px;font-size:.875rem}
  .crumb{background:var(--surface-2);border:1px solid var(--line);border-radius:999px;padding:4px 10px;color:var(--ink-2);min-height:32px;font:inherit;font-size:.8125rem;cursor:pointer;max-width:100%;text-align:left}
  .crumb:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
  .crumb.is-current{background:var(--accent-soft);color:var(--accent);border-color:transparent;cursor:default;font-weight:600}
  .crumb__sep{color:var(--muted)}
  .walk__count{color:var(--muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
  .node{border-radius:var(--r-m);padding:16px;background:var(--surface-2);margin-bottom:12px;border:1px solid transparent}
  .node--action{background:var(--info-soft)}
  .node--end{background:var(--ok-soft)}
  .node--end.node--info{background:var(--info-soft)}
  .node--end.node--warn{background:var(--warn-soft)}
  .node--end.node--danger{background:var(--bad-soft)}
  .node--missing{background:var(--bad-soft);color:var(--bad)}
  .node__type{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:4px;font-weight:600;display:flex;align-items:center;gap:6px}
  .node--action .node__type{color:var(--info)}
  .node--end .node__type{color:var(--ok)}
  .node--end.node--info .node__type{color:var(--info)}
  .node--end.node--warn .node__type{color:var(--warn)}
  .node--end.node--danger .node__type{color:var(--bad)}
  .node__text{font-size:1.125rem;line-height:1.45;font-weight:500}
  .node__text p{margin:0 0 6px}
  .node__text p:last-child{margin-bottom:0}
  .node__note{color:var(--ink-2);font-size:.875rem;margin-top:8px;padding-top:8px;border-top:1px dashed var(--line)}
  .node__note p{margin:0 0 4px}
  .node__opts{display:grid;gap:8px;margin-top:14px}
  .node__opts .btn{justify-content:flex-start;text-align:left;white-space:normal;line-height:1.35;padding:10px 14px}
  .node__opts .btn .ico{flex:none;margin-left:auto;opacity:.6}
  .node__next{margin-top:14px}
  .walk__done{margin-top:4px;padding:14px 16px;border-radius:var(--r-m);background:var(--surface);box-shadow:var(--shadow-1);display:flex;flex-wrap:wrap;align-items:center;gap:10px}
  .walk__done-title{font-family:var(--font-display);font-size:1.125rem;margin:0;flex:1 1 auto;display:flex;align-items:center;gap:8px;color:var(--ok)}
  .walk__foot{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
  .walk__inline-outline{margin-top:14px}
  .outline__tools{display:flex;justify-content:flex-end;gap:8px;margin-bottom:8px}
  ul.tree,ul.tree ul{list-style:none;margin:0;padding:0}
  ul.tree ul{margin-left:12px;padding-left:14px;border-left:2px solid var(--line)}
  ul.tree .tree__sub--chain{border-left-style:dashed}
  .tree__branch{position:relative;margin:8px 0}
  .tree__branch::before{content:'';position:absolute;left:-14px;top:15px;width:12px;height:2px;background:var(--line)}
  .tree__details>.tree__opt{cursor:pointer;display:inline-flex;align-items:center;gap:8px;font-weight:600;font-size:.875rem;padding:6px 12px 6px 10px;border-radius:999px;background:var(--surface);border:1px solid var(--line);min-height:32px;list-style:none;color:var(--ink);user-select:none}
  .tree__details>.tree__opt::-webkit-details-marker{display:none}
  .tree__details>.tree__opt::before{content:'';width:7px;height:7px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(-45deg);transition:transform .16s cubic-bezier(.2,.7,.2,1);flex:none;margin-left:2px}
  .tree__details[open]>.tree__opt::before{transform:rotate(45deg)}
  .tree__details>.tree__opt:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
  .tree__chain{display:flex;align-items:center;gap:6px;color:var(--info);font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;margin:2px 0 2px 4px}
  ul.tree .node{padding:10px 12px;margin:6px 0}
  ul.tree .node__text{font-size:1rem;font-weight:500}
  ul.tree .node__type{margin-bottom:2px}
  @media (prefers-reduced-motion:reduce){.tree__details>.tree__opt::before{transition:none}}
  `;

  function injectStyle() {
    if (document.getElementById('style-view-trees')) return;
    const s = document.createElement('style');
    s.id = 'style-view-trees';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ------------------------------------------------------------------ */
  /* Accès aux modules moteur                                             */
  /* ------------------------------------------------------------------ */

  function registry() { return (window.CARDIO && CARDIO.registry) || null; }

  async function ensureItem(num) {
    const r = registry();
    if (!r) { console.warn('[trees] CARDIO.registry indisponible'); return null; }
    try {
      if (typeof r.load === 'function') await r.load(num);
    } catch (e) {
      console.warn('[trees] chargement de l\'item ' + num + ' impossible', e);
      return null;
    }
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
      try { return s.recordAttempt(payload); } catch (e) { console.warn('[trees] recordAttempt a échoué', e); }
    } else {
      console.warn('[trees] CARDIO.store.recordAttempt indisponible : progression non enregistrée');
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Nœuds                                                                */
  /* ------------------------------------------------------------------ */

  const TONE_LABEL = { ok: 'Conclusion', info: 'À noter', warn: 'Attention', danger: 'Urgence' };
  const TONE_ICON = { ok: 'check', info: 'info', warn: 'warning', danger: 'warning' };

  function isValidTree(tree) {
    return !!(tree && tree.nodes && typeof tree.nodes === 'object' && tree.root && tree.nodes[tree.root]);
  }

  // Carte d'un nœud (sans les boutons d'options : ajoutés par le mode qui l'affiche).
  function nodeCard(node, extraClass) {
    const type = node.type === 'question' || node.type === 'action' || node.type === 'end' ? node.type : 'question';
    const tone = type === 'end' ? (TONE_LABEL[node.tone] ? node.tone : 'ok') : null;
    const cls = ['node', 'node--' + type, tone ? 'node--' + tone : '', extraClass || ''].filter(Boolean).join(' ');
    const label = type === 'question' ? 'Question' : type === 'action' ? 'Conduite à tenir' : TONE_LABEL[tone];
    const ic = type === 'question' ? null : type === 'action' ? icon('chevron-right') : icon(TONE_ICON[tone]);
    const card = h('div', { class: cls },
      h('div', { class: 'node__type' }, ic, label),
      mdEl(node.text, 'node__text'));
    if (node.note) card.append(mdEl(node.note, 'node__note'));
    return card;
  }

  function countNodes(tree) {
    const c = { question: 0, action: 0, end: 0 };
    if (tree && tree.nodes) for (const k in tree.nodes) { const t = tree.nodes[k] && tree.nodes[k].type; if (c[t] != null) c[t]++; }
    return c;
  }

  /* ------------------------------------------------------------------ */
  /* Mode « Pas à pas »                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * renderWalkthrough(tree, opts) → HTMLElement
   * opts: { onComplete({path, choices, ms}), onStep({tree, nodeId, node, option, path}),
   *         record (bool : enregistre via store — pages arbres uniquement), item (num),
   *         onShowOutline() (si fourni, le CTA de fin l'appelle ; sinon l'arbre complet s'ouvre dessous) }
   */
  function renderWalkthrough(tree, opts) {
    opts = opts || {};
    injectStyle();
    const root = h('div', { class: 'walk' });
    if (!isValidTree(tree)) {
      root.append(h('p', { class: 'empty' }, 'Cet arbre est incomplet : impossible de le parcourir.'));
      return root;
    }
    const t0 = now();
    let path = [tree.root];      // ids des nœuds visités
    let choices = [];            // libellé du choix ayant mené à path[i+1]
    let completed = false;       // onComplete / record ne partent qu'une fois par instance

    const crumbs = h('nav', { class: 'walk__crumbs', 'aria-label': 'Chemin parcouru' });
    const count = h('div', { class: 'walk__count' });
    const stage = h('div', { class: 'walk__stage', 'aria-live': 'polite' });
    const foot = h('div', { class: 'walk__foot' });
    root.append(crumbs, count, stage, foot);

    function step(nodeId, node, option) {
      if (typeof opts.onStep === 'function') {
        try { opts.onStep({ tree, nodeId, node, option, path: path.slice() }); } catch (e) { console.warn(e); }
      }
    }

    function goTo(to, label) {
      if (!to || !tree.nodes[to]) {
        toast('Branche manquante dans cet arbre.', 'warn');
        console.warn('[trees] nœud introuvable', to, 'dans', tree.id);
        return;
      }
      path.push(to);
      choices.push(label || '');
      draw();
    }

    function backTo(i) {
      path = path.slice(0, i + 1);
      choices = choices.slice(0, i);
      draw();
    }

    function restart() { path = [tree.root]; choices = []; draw(); }

    function complete() {
      if (completed) return;
      completed = true;
      const ms = now() - t0;
      if (opts.record) {
        const item = opts.item || tree.item || itemOfId(tree.id);
        recordAttempt({ cardId: tree.id, item: item, kind: 'tree', score: 1, ms });
        toast('Arbre terminé : bien joué.', 'ok');
      }
      if (typeof opts.onComplete === 'function') {
        try { opts.onComplete({ path: path.slice(), choices: choices.slice(), ms }); } catch (e) { console.warn(e); }
      }
    }

    function drawCrumbs() {
      crumbs.replaceChildren();
      path.forEach((id, i) => {
        const node = tree.nodes[id];
        const isLast = i === path.length - 1;
        let label;
        if (i === 0) label = 'Départ';
        else label = choices[i - 1] || stripText(node && node.text, 28);
        if (isLast && i > 0) label = stripText(node && node.text, 28);
        if (i > 0) crumbs.append(h('span', { class: 'crumb__sep', 'aria-hidden': 'true' }, '→'));
        if (isLast) {
          crumbs.append(h('span', { class: 'crumb is-current', 'aria-current': 'step' }, label));
        } else {
          crumbs.append(h('button', {
            type: 'button', class: 'crumb', title: 'Revenir à cette étape',
            on: { click: () => backTo(i) }
          }, label));
        }
      });
    }

    function draw() {
      drawCrumbs();
      count.textContent = 'Étape ' + path.length;
      stage.replaceChildren();
      foot.replaceChildren();
      const id = path[path.length - 1];
      const node = tree.nodes[id];
      if (!node) {
        stage.append(h('div', { class: 'node node--missing' }, 'Nœud introuvable : ' + id));
        foot.append(h('button', { type: 'button', class: 'btn btn--ghost', on: { click: restart } }, 'Recommencer'));
        return;
      }
      const card = nodeCard(node);
      if (node.type === 'question') {
        const opts_ = h('div', { class: 'node__opts', role: 'group', 'aria-label': 'Options' });
        (Array.isArray(node.options) ? node.options : []).forEach((o) => {
          opts_.append(h('button', {
            type: 'button', class: 'btn btn--secondary btn--block',
            on: { click: () => { step(id, node, o); goTo(o.to, o.label); } }
          }, o.label, icon('chevron-right')));
        });
        card.append(opts_);
      } else if (node.type === 'action') {
        card.append(h('div', { class: 'node__next' },
          h('button', {
            type: 'button', class: 'btn btn--primary btn--block',
            on: { click: () => { step(id, node, null); goTo(node.to, stripText(node.text, 28)); } }
          }, 'Suite', icon('chevron-right'))));
      }
      stage.append(card);

      if (node.type === 'end') {
        const done = h('div', { class: 'walk__done' },
          h('p', { class: 'walk__done-title' }, icon('check'), 'Terminé'));
        const outlineHost = h('div', { class: 'walk__inline-outline' });
        const cta = h('button', {
          type: 'button', class: 'btn btn--secondary',
          on: {
            click: () => {
              if (typeof opts.onShowOutline === 'function') { opts.onShowOutline(); return; }
              if (outlineHost.childElementCount) { outlineHost.replaceChildren(); cta.textContent = 'Voir tout l\'arbre'; return; }
              outlineHost.replaceChildren(renderOutline(tree));
              cta.textContent = 'Masquer l\'arbre';
            }
          }
        }, 'Voir tout l\'arbre');
        done.append(cta);
        stage.append(done, outlineHost);
        complete();
      }
      if (path.length > 1) {
        foot.append(h('button', { type: 'button', class: 'btn btn--ghost', on: { click: restart } }, icon('refresh'), 'Recommencer'));
      }
    }

    draw();
    return root;
  }

  /* ------------------------------------------------------------------ */
  /* Mode « Vue d'ensemble »                                               */
  /* ------------------------------------------------------------------ */

  /**
   * renderOutline(tree) → HTMLElement : <ul class="tree"> imbriqué depuis la racine,
   * branches repliables (<details>), nœuds de fin colorés selon le ton.
   */
  function renderOutline(tree) {
    injectStyle();
    const wrap = h('div', { class: 'outline' });
    if (!isValidTree(tree)) {
      wrap.append(h('p', { class: 'empty' }, 'Cet arbre est incomplet : rien à afficher.'));
      return wrap;
    }
    const ul = h('ul', { class: 'tree' });
    ul.append(renderNodeLi(tree, tree.root, 0, new Set(), 0));
    const details = () => Array.from(ul.querySelectorAll('details.tree__details'));
    const tools = h('div', { class: 'outline__tools' },
      h('button', { type: 'button', class: 'btn btn--ghost btn--sm', on: { click: () => details().forEach(d => { d.open = true; }) } }, 'Tout déplier'),
      h('button', { type: 'button', class: 'btn btn--ghost btn--sm', on: { click: () => details().forEach(d => { d.open = false; }) } }, 'Tout replier'));
    if (details().length) wrap.append(tools);
    wrap.append(ul);
    return wrap;
  }

  // depth = profondeur de questions (pilote l'ouverture par défaut des <details>).
  function renderNodeLi(tree, id, depth, stack, guard) {
    const li = h('li', { class: 'tree__item' });
    const node = tree.nodes[id];
    if (!node) { li.append(h('div', { class: 'node node--missing' }, 'Nœud manquant : ' + String(id))); return li; }
    if (stack.has(id) || guard > 200) { li.append(h('div', { class: 'node node--missing' }, 'Boucle détectée vers ' + String(id))); return li; }
    stack.add(id);
    if (node.type === 'question') {
      li.append(nodeCard(node));
      const branches = h('ul', { class: 'tree__branches' });
      (Array.isArray(node.options) ? node.options : []).forEach((o) => {
        const det = h('details', { class: 'tree__details', open: depth < 1 });
        det.append(
          h('summary', { class: 'tree__opt' }, o.label),
          h('ul', { class: 'tree__sub' }, renderNodeLi(tree, o.to, depth + 1, stack, guard + 1)));
        branches.append(h('li', { class: 'tree__branch' }, det));
      });
      li.append(branches);
    } else if (node.type === 'action') {
      li.append(nodeCard(node));
      if (node.to) {
        li.append(h('ul', { class: 'tree__sub tree__sub--chain' },
          h('li', { class: 'tree__chain' }, icon('chevron-down'), 'puis'),
          renderNodeLi(tree, node.to, depth, stack, guard + 1)));
      }
    } else {
      li.append(nodeCard(node));
    }
    stack.delete(id);
    return li;
  }

  /* ------------------------------------------------------------------ */
  /* Feuille (sheet) d'un arbre : onglets Pas à pas / Vue d'ensemble        */
  /* ------------------------------------------------------------------ */

  function treeDetailEl(tree, mode, item) {
    const el = h('div', { class: 'tree-sheet' });
    el.append(h('div', { class: 'tree-sheet__head' },
      h('h3', { class: 'tree-sheet__title' }, tree.title || 'Arbre décisionnel'),
      tree.rank ? h('span', { class: 'pill pill--' + tree.rank }, 'Rang ' + tree.rank) : null));
    if (tree.intro) el.append(mdEl(tree.intro, 'tree-sheet__intro'));
    if (tree.src) el.append(h('div', { class: 'src' }, tree.src));

    const tabWalk = h('button', { type: 'button', class: 'tab', role: 'tab' }, 'Pas à pas');
    const tabOut = h('button', { type: 'button', class: 'tab', role: 'tab' }, 'Vue d\'ensemble');
    const tabs = h('div', { class: 'tabs', role: 'tablist' }, tabWalk, tabOut);
    const body = h('div', { class: 'tree-sheet__body' });
    el.append(tabs, body);

    let walkEl = null; // conservé pour ne pas perdre le parcours en changeant d'onglet
    function setMode(m) {
      const isWalk = m !== 'outline';
      tabWalk.classList.toggle('is-on', isWalk); tabWalk.setAttribute('aria-selected', String(isWalk));
      tabOut.classList.toggle('is-on', !isWalk); tabOut.setAttribute('aria-selected', String(!isWalk));
      body.replaceChildren();
      if (isWalk) {
        if (!walkEl) walkEl = renderWalkthrough(tree, { record: true, item, onShowOutline: () => setMode('outline') });
        body.append(walkEl);
      } else {
        body.append(renderOutline(tree));
      }
    }
    tabWalk.addEventListener('click', () => setMode('walk'));
    tabOut.addEventListener('click', () => setMode('outline'));
    setMode(mode);
    return el;
  }

  // Ouvre dans CARDIO.shell.sheet ; à défaut, panneau en ligne au-dessus de la liste.
  function openTree(tree, mode, item, host) {
    const el = treeDetailEl(tree, mode, item);
    const sh = window.CARDIO && CARDIO.shell;
    if (sh && typeof sh.sheet === 'function') {
      try { sh.sheet(el, { title: tree.title || 'Arbre décisionnel' }); return; } catch (e) { console.warn('[trees] shell.sheet a échoué', e); }
    }
    const panel = h('div', { class: 'card card--raised tree-inline' });
    panel.append(h('div', { style: 'display:flex;justify-content:flex-end;margin-bottom:8px' },
      h('button', { type: 'button', class: 'btn btn--ghost btn--sm', on: { click: () => panel.remove() } }, icon('x'), 'Fermer')), el);
    const prev = host.querySelector('.tree-inline');
    if (prev) prev.remove();
    host.prepend(panel);
    try { panel.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ */
  /* Listes                                                               */
  /* ------------------------------------------------------------------ */

  function treeCard(tree, item, host) {
    const c = countNodes(tree);
    const card = h('article', { class: 'card tree-card' });
    card.append(
      h('div', { class: 'tree-card__top' },
        h('h3', { class: 'tree-card__title' }, tree.title || 'Arbre décisionnel'),
        tree.rank ? h('span', { class: 'pill pill--' + tree.rank }, 'Rang ' + tree.rank) : null),
      h('div', { class: 'tree-card__meta' },
        h('span', { class: 'pill pill--kind' }, 'Arbre'),
        h('span', null, c.question + (c.question > 1 ? ' questions' : ' question')),
        h('span', null, c.end + (c.end > 1 ? ' conclusions' : ' conclusion')),
        tree.src ? h('span', { class: 'src' }, tree.src) : null),
      h('div', { class: 'tree-card__actions' },
        h('button', { type: 'button', class: 'btn btn--primary btn--sm', on: { click: () => openTree(tree, 'walk', item, host) } }, icon('play'), 'Parcourir'),
        h('button', { type: 'button', class: 'btn btn--secondary btn--sm', on: { click: () => openTree(tree, 'outline', item, host) } }, icon('tree'), 'Vue d\'ensemble')));
    return card;
  }

  function pageHead(title, sub) {
    return h('header', { class: 'page-head' },
      h('h2', { class: 'page-title' }, title),
      sub ? h('p', { class: 'page-sub' }, sub) : null);
  }

  async function renderItemPage(num) {
    injectStyle();
    const page = h('div', { class: 'page trees-page' });
    const content = await ensureItem(num);
    const meta = (content && content.meta) || itemMeta(num) || {};
    page.append(pageHead('Arbres décisionnels', (meta.short ? meta.short + ' — ' : '') + (meta.title || 'Item ' + num)));
    if (!content) {
      page.append(h('div', { class: 'card' },
        h('p', { class: 'empty' }, 'Impossible de charger l\'item ' + num + '. Vérifie ta connexion puis réessaie.'),
        h('button', { type: 'button', class: 'btn btn--secondary btn--block', on: { click: () => go('#/item/' + num + '/arbres') } }, icon('refresh'), 'Réessayer')));
      return page;
    }
    const trees = Array.isArray(content.trees) ? content.trees : [];
    if (!trees.length) {
      page.append(h('div', { class: 'card' }, h('p', { class: 'empty' }, 'Pas d\'arbre décisionnel pour cet item : ouvre la fiche ou les QCM pour réviser.')));
      return page;
    }
    const list = h('div', { class: 'tree-list' });
    trees.forEach(t => list.append(treeCard(t, num, page)));
    page.append(list);
    return page;
  }

  function renderGlobalPage() {
    injectStyle();
    const page = h('div', { class: 'page trees-page trees-page--global' });
    const r = registry();
    const items = (r && typeof r.items === 'function') ? (r.items() || []) : [];
    const isLoaded = (n) => !!(r && typeof r.isLoaded === 'function' && r.isLoaded(n));
    const loaded = items.filter(m => isLoaded(String(m.num)));
    const allLoaded = items.length > 0 && loaded.length === items.length;

    let total = 0;
    const groups = [];
    loaded.forEach((m) => {
      const c = (typeof r.content === 'function') ? r.content(String(m.num)) : null;
      const trees = (c && Array.isArray(c.trees)) ? c.trees : [];
      if (!trees.length) return;
      total += trees.length;
      groups.push({ meta: m, trees });
    });

    page.append(pageHead('Arbres décisionnels', total
      ? total + (total > 1 ? ' arbres' : ' arbre') + ' sur ' + loaded.length + (loaded.length > 1 ? ' items chargés' : ' item chargé')
      : 'Tous les algorithmes du Collège, item par item'));

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
          console.warn('[trees] loadAll a échoué', e);
          toast('Le chargement a échoué. Réessaie.', 'bad');
          btn.disabled = false; btn.replaceChildren(icon('download'), 'Charger tous les items');
        }
      });
      page.append(h('div', { class: 'card' },
        h('p', { style: 'margin:0 0 12px' }, items.length
          ? (loaded.length + ' item' + (loaded.length > 1 ? 's' : '') + ' chargé' + (loaded.length > 1 ? 's' : '') + ' sur ' + items.length + '. Charge le reste pour voir tous les arbres.')
          : 'Le catalogue n\'est pas encore disponible.'),
        items.length ? btn : null));
    }

    if (!groups.length) {
      page.append(h('div', { class: 'card' }, h('p', { class: 'empty' },
        loaded.length ? 'Aucun arbre dans les items chargés pour l\'instant.' : 'Aucun item chargé : charge tous les items ou ouvre un item depuis la liste.')));
      return page;
    }
    groups.forEach(({ meta, trees }) => {
      const num = String(meta.num);
      page.append(h('div', { class: 'tree-group' },
        h('h3', { class: 'tree-group__title' }, num + ' · ' + (meta.short || meta.title || '')),
        h('a', { class: 'tree-group__link', href: '#/item/' + num + '/arbres' }, 'Voir l\'item')));
      const list = h('div', { class: 'tree-list' });
      trees.forEach(t => list.append(treeCard(t, num, page)));
      page.append(list);
    });
    return page;
  }

  /* ------------------------------------------------------------------ */
  /* API                                                                   */
  /* ------------------------------------------------------------------ */

  function render(params) {
    params = params || {};
    const num = params.num != null ? params.num : params.item;
    try {
      if (num != null && num !== '') return renderItemPage(String(num));
      return renderGlobalPage();
    } catch (e) {
      console.warn('[trees] render a échoué', e);
      return h('div', { class: 'page' }, h('div', { class: 'card' }, h('p', { class: 'empty' }, 'Une erreur est survenue en affichant les arbres.')));
    }
  }

  CARDIO.views.trees = { render, renderWalkthrough, renderOutline, renderTreeDetail: treeDetailEl };
})();
