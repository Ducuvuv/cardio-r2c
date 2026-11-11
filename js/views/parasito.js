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
    ['ectoparasites', 'Ectoparasites'], ['mycologie', 'Mycologie'],
    ['bact-gen', 'Généralités de bactériologie'], ['bact-fam', 'Les bactéries (résumé du poly)'], ['bact-lz', 'Fiches par bactérie (LISAzay)'], ['bact-synd', 'Approche par syndrome'],
    ['viro-gen', 'Généralités de virologie'], ['viro-vir', 'Les virus']
  ];
  const LS = 'cardio.parasito';

  function util() { return CARDIO.util || {}; }
  function h() { const u = util(); return u.h.apply(null, arguments); }
  function str(v) { return v === undefined || v === null ? '' : String(v); }
  /* Deux polys dans la même rubrique : parasito-myco (CARDIO.registry.parasito) et bactériologie (CARDIO.registry.bacterio,
   * ids « bact-… », docs/BACTERIO.md). list() = les fiches du poly affiché ; listAll() = toutes (recherche par id). */
  // 3e poly : virologie (CARDIO.registry.viro, ids « viro-… », docs/VIRO.md)
  function listAll() { const r = CARDIO.registry || {}; return (Array.isArray(r.parasito) ? r.parasito : []).concat(Array.isArray(r.bacterio) ? r.bacterio : [], Array.isArray(r.viro) ? r.viro : []); }
  function polyOf(p) { return p && /^bact-/.test(p.id) ? 'bacterio' : p && /^viro-/.test(p.id) ? 'viro' : 'parasito'; }
  function hasPoly(x) { const r = CARDIO.registry || {}; return Array.isArray(r[x]) && r[x].length > 0; }
  function hasBact() { return hasPoly('bacterio') || hasPoly('viro'); }
  let curPoly = 'parasito';
  try { const s0 = sessionStorage.getItem('cardio.micro.poly'); if (s0 === 'bacterio' || s0 === 'viro') curPoly = s0; } catch (e) { /* ignore */ }
  function setPoly(x) { curPoly = (x === 'bacterio' || x === 'viro') && hasPoly(x) ? x : 'parasito'; try { sessionStorage.setItem('cardio.micro.poly', curPoly); } catch (e) { /* ignore */ } }
  function list() { return listAll().filter(function (p) { return polyOf(p) === curPoly; }); }
  function polyName(p) { return polyOf(p) === 'bacterio' ? 'Poly bactério' : polyOf(p) === 'viro' ? 'Poly viro' : 'Poly parasito-myco'; }
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
      '.card-fig{margin:10px 0 0}', '.card-fig img{display:block;max-width:100%%;max-height:300px;margin:0 auto;border-radius:10px;background:#000}', '.card-fig figcaption{font-size:.6875rem;color:var(--muted);text-align:center;margin-top:4px}',
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
      '.pz-train__t{font:700 1rem/1.25 var(--font-display)}',
      '.pz-train__s{font-size:.8125rem;color:var(--muted)}',
      '.pz-train__btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}',
      '.pz-card-q{padding:14px 16px;border-radius:var(--r-m);background:var(--surface);box-shadow:var(--shadow-1)}',
      '.pz-q{font:600 1.0625rem/1.4 var(--font-display);margin-top:6px}',
      '.pz-a{padding:12px 14px;border-radius:var(--r-m);background:var(--surface-2);line-height:1.45}',
      '.view-parasito .input{width:100%;padding:12px;border-radius:10px;border:2px solid var(--line);background:var(--surface);color:var(--ink);font-size:1rem}',
      '.grades .is-hint{outline:2px solid currentColor;outline-offset:1px}',
      '.pz-expl{padding:10px 12px;border-radius:var(--r-m);border-left:4px solid var(--blue);background:var(--blue-soft);line-height:1.45}',
      '.pz-expl p{margin:.35em 0}'
    ].join('\n');
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* Pertinence EDN + pratique de la fiche (1-3), partagée avec la Méthode des J (estimation, ou ton réglage « Aux examens »). */
  function rel(id) {
    const pj = CARDIO.views && CARDIO.views.planj;
    try { return pj && pj.relevance ? pj.relevance('p:' + id).v : 2; } catch (e) { return 2; }
  }
  const REL_PILL = { 3: ['pill--warn', 'Incontournable'], 2: ['pill--info', 'Important'] };
  /* Ordre de travail : jamais ouverte d'abord, puis à revoir, puis lue, puis sue ; à égalité la plus pertinente. */
  function workRank(id) { const s = status(id); return !s ? 0 : s.t === 'à revoir' ? 1 : s.t === 'lu' ? 2 : 3; }
  function byWork(a, b) { return workRank(a.id) - workRank(b.id) || rel(b.id) - rel(a.id); }
  function status(id) {
    const s = loadState()[id];
    if (!s) return null;
    if (s.ok === true) return { cls: 'pill--ok', t: 'su' };
    if (s.ok === false) return { cls: 'pill--warn', t: 'à revoir' };
    return s.seen ? { cls: 'pill--info', t: 'lu' } : null;
  }

  /* ---------- liste ---------- */
  /* Réglages d'une séance : type, nombre de cartes, ordre (mémorisés), puis bouton Lancer. */
  const OPT_KEY = 'cardio.parasito.opts';
  function getOpts() { const def = { type: '', size: '20', order: 'random', newcap: '20', typed: '0' }; try { return Object.assign(def, JSON.parse(localStorage.getItem(OPT_KEY) || '{}')); } catch (e) { return def; } }
  function trainChooser(base, nCards) {
    const o = getOpts();
    const wrap = h('div', { style: 'display:grid;gap:8px' });
    function chips(label, key, opts) {
      return h('div', { style: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap' }, h('span', { class: 'secondary muted', style: 'min-width:64px' }, label),
        opts.map(function (x) {
          return h('button', { type: 'button', class: 'btn btn--sm ' + (o[key] === x[0] ? 'btn--primary' : 'btn--outline'), on: { click: function () { o[key] = x[0]; try { localStorage.setItem(OPT_KEY, JSON.stringify(o)); } catch (e) { /* ignore */ } draw(); } } }, x[1]);
        }));
    }
    function draw() {
      const n = o.size === 'all' ? nCards : Math.min(nCards, Number(o.size) || 20);
      const qs = (o.type ? '&type=' + o.type : '') + '&size=' + o.size + '&order=' + o.order;
      const href = base.indexOf('?') < 0 ? base + '?' + qs.slice(1) : base + qs;
      wrap.replaceChildren(
        chips('Cartes', 'type', [['', 'Mixte'], ['qroc', 'QROC'], ['flash', 'Flashcards']].concat([['ttt', '💊 Traitements']], [['pieges', '🎯 Mes cartes pièges']])),
        o.type === 'pieges' ? h('p', { class: 'secondary muted', style: 'margin:0' }, 'Les cartes que tu as ratées au moins ' + PIEGE + ' fois (« À revoir »).') : null,
        chips('Nombre', 'size', [['10', '10'], ['20', '20'], ['30', '30'], ['50', '50'], ['all', 'Toutes (' + nCards + ')']]),
        chips('Ordre', 'order', [['random', 'Au hasard'], ['srs', 'Répétition espacée']]),
        o.order === 'srs' ? chips('Nouvelles / jour', 'newcap', [['10', '10'], ['20', '20'], ['30', '30'], ['all', 'Sans limite']]) : null,
        chips('Flashcards', 'typed', [['0', 'Je retourne la carte'], ['1', 'Je tape ma réponse']]),
        h('p', { class: 'secondary muted', style: 'margin:0' }, o.order === 'random' ? 'Tirage au hasard à chaque séance, en évitant les cartes que tu viens de voir.' : 'Les cartes dues d’abord, puis les nouvelles, puis les moins récemment vues.'),
        h('a', { class: 'btn btn--primary btn--block', href: href }, 'Lancer · ' + n + ' carte' + (n > 1 ? 's' : '')));
    }
    draw();
    return wrap;
  }
  /* Sélection de plusieurs fiches pour s'entraîner dessus (mémorisée pour la session de l'onglet). */
  const SEL_KEY = 'cardio.parasito.sel';
  function getSel() { try { return JSON.parse(sessionStorage.getItem(SEL_KEY) || '[]') || []; } catch (e) { return []; } }
  function setSel(a) { try { sessionStorage.setItem(SEL_KEY, JSON.stringify(a)); } catch (e) { /* ignore */ } }
  let selMode = false;
  function buildList() {
    const all = list();
    const page = h('div', { class: 'page stack' });
    const sel = getSel().filter(function (id) { return all.some(function (p) { return p.id === id; }); });
    const redraw = function () { const v = page.parentNode; if (v) v.replaceChild(buildList(), page); };
    if (hasBact()) page.appendChild(h('div', { class: 'pj-chips', style: 'display:flex;gap:6px;flex-wrap:wrap' },
      [['parasito', '🪱 Parasito-myco'], ['bacterio', '🧫 Bactério'], ['viro', '🦠 Viro']].filter(function (x) { return x[0] === 'parasito' || hasPoly(x[0]); }).map(function (x) {
        return h('button', { type: 'button', class: 'btn btn--sm ' + (curPoly === x[0] ? 'btn--primary' : 'btn--outline'), on: { click: function () { setPoly(x[0]); selMode = false; redraw(); } } }, x[1]);
      })));
    page.appendChild(h('p', { class: 'secondary' }, curPoly === 'viro'
      ? 'Une fiche par virus ou par chapitre du poly de virologie (DFGSM3). Ce poly n’a pas de code couleur rang A/B : tout le contenu utile au partiel est repris, résumé. Mode « Me tester » : les mots-clés sont cachés, à toi de les retrouver.'
      : curPoly === 'bacterio'
      ? 'Une fiche par chapitre du poly de bactériologie (DFGSM3). Ce poly n’a pas de code couleur rang A/B : tout le contenu utile au partiel est repris, résumé. Mode « Me tester » : les mots-clés sont cachés, à toi de les retrouver.'
      : 'Une fiche par parasite et par mycose, avec uniquement ce qui est en rouge (rang A) dans le poly de parasitologie-mycologie. Mode « Me tester » : les mots-clés sont cachés, à toi de les retrouver.'));
    if (!all.length) {
      page.appendChild(h('div', { class: 'empty' }, h('div', { class: 'empty__title' }, 'Fiches non disponibles ici'), 'Cette rubrique est réservée à ta version privée de l’app.'));
      return page;
    }
    const tb = trainBlock(null);
    if (tb) page.appendChild(tb);
    page.appendChild(h('div', { class: 'cluster' },
      h('button', { type: 'button', class: 'btn ' + (selMode ? 'btn--primary' : 'btn--outline') + ' btn--sm', on: { click: function () { selMode = !selMode; redraw(); } } },
        selMode ? 'Terminer la sélection' : 'Choisir plusieurs fiches pour m’entraîner'),
      selMode && sel.length ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', on: { click: function () { setSel([]); redraw(); } } }, 'Tout décocher') : null));
    const st = loadState();
    // Par où commencer : les fiches jamais ouvertes les plus pertinentes, puis celles à revoir
    const next = all.slice().sort(byWork).filter(function (p) { return workRank(p.id) <= 1; }).slice(0, 4);
    if (next.length && !selMode) {
      page.appendChild(h('div', { class: 'card', style: 'padding:12px 14px;display:grid;gap:6px' },
        h('b', {}, 'Par où commencer'),
        h('p', { class: 'secondary muted', style: 'margin:0' }, 'Les fiches jamais ouvertes d’abord, les plus utiles pour l’EDN et la pratique en premier (estimation, réglable dans la Méthode des J).'),
        next.map(function (p) {
          const r = rel(p.id), s = status(p.id);
          return h('a', { href: '#/parasito/' + encodeURIComponent(p.id), style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--line);text-decoration:none;color:inherit' },
            h('span', { style: 'flex:1;min-width:150px;font-weight:600' }, str(p.title)),
            REL_PILL[r] ? h('span', { class: 'pill ' + REL_PILL[r][0] }, REL_PILL[r][1]) : null,
            h('span', { class: 'secondary muted' }, s ? s.t : 'jamais ouverte'));
        })));
    }
    GROUPS.forEach(function (g) {
      const group = all.filter(function (p) { return p.group === g[0]; }).sort(byWork);
      if (!group.length) return;
      const done = group.filter(function (p) { return st[p.id] && st[p.id].ok === true; }).length;
      const allIn = group.every(function (p) { return sel.indexOf(p.id) >= 0; });
      page.appendChild(h('div', { class: 'section-head' }, h('h2', {}, g[1]),
        selMode ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', on: { click: function () {
          let s = getSel();
          if (allIn) s = s.filter(function (id) { return !group.some(function (p) { return p.id === id; }); });
          else group.forEach(function (p) { if (s.indexOf(p.id) < 0) s.push(p.id); });
          setSel(s); redraw();
        } } }, allIn ? 'Décocher le groupe' : 'Tout le groupe') : h('span', { class: 'secondary muted' }, done + ' / ' + group.length + ' sues')));
      page.appendChild(h('div', { class: 'pz-list' }, group.map(function (p) {
        const sta = status(p.id);
        const on = sel.indexOf(p.id) >= 0;
        return h('a', { class: 'pz-card', href: '#/parasito/' + encodeURIComponent(p.id),
          style: selMode ? 'position:relative;' + (on ? 'outline:3px solid var(--accent);outline-offset:-1px' : '') : null,
          on: selMode ? { click: function (e) { e.preventDefault(); let s = getSel(); if (on) s = s.filter(function (x) { return x !== p.id; }); else s.push(p.id); setSel(s); redraw(); } } : null },
          selMode ? h('span', { 'aria-hidden': 'true', style: 'position:absolute;top:10px;right:10px;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;' + (on ? 'background:var(--accent);color:#fff' : 'border:2px solid var(--line);background:var(--surface)') }, on ? '✓' : '') : null,
          h('div', { class: 'pz-card__top' },
            h('span', { class: 'pill pill--A' }, 'Rang A'),
            h('span', { class: 'pill pill--kind' }, count(p) + ' points'),
            REL_PILL[rel(p.id)] ? h('span', { class: 'pill ' + REL_PILL[rel(p.id)][0] }, REL_PILL[rel(p.id)][1]) : null,
            sta ? h('span', { class: 'pill ' + sta.cls }, sta.t) : null),
          h('div', { class: 'pz-card__title' }, str(p.title)),
          p.agent ? h('div', { class: 'pz-card__agent' }, str(p.agent)) : null,
          p.hook ? h('div', { class: 'pz-card__hook' }, str(p.hook)) : null,
          pjStatus(p.id, false));
      })));
    });
    if (selMode || sel.length) {
      const chosen = all.filter(function (p) { return sel.indexOf(p.id) >= 0; });
      const nCards = chosen.reduce(function (a, p) { return a + cardsOf(p).length; }, 0);
      const base = '#/parasito/choix/cartes?ids=' + chosen.map(function (p) { return encodeURIComponent(p.id); }).join(',');
      page.appendChild(h('div', { class: 'card', style: 'position:sticky;bottom:calc(var(--tabbar-h,60px) + 8px);z-index:6;display:grid;gap:8px;box-shadow:var(--shadow-2)' },
        h('b', {}, chosen.length ? chosen.length + ' fiche' + (chosen.length > 1 ? 's' : '') + ' choisie' + (chosen.length > 1 ? 's' : '') + ' · ' + nCards + ' cartes' : 'Touche les fiches à travailler ensemble'),
        chosen.length ? trainChooser(base, nCards) : null,
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', on: { click: function () { setSel([]); selMode = false; redraw(); } } }, '✕ Fermer et tout décocher')));
    }
    if (curPoly === 'parasito' && noA().length) {
      page.appendChild(h('p', { class: 'secondary muted' }, 'Sans rien en rouge dans le poly (donc pas de fiche) : ' + noA().join(', ') + '.'));
    }
    return page;
  }

  /* ---------- zones de fragilité (estimées) ----------
   * Les cartes ne sont pas rattachées à une partie de la fiche : on les range dans la partie dont les points partagent le
   * plus de mots significatifs avec la question + la réponse. Score d'une partie = moyenne des derniers résultats
   * (Su = 1, À revoir = 0) de ses cartes déjà faites ; fragile si ≥ 3 cartes faites et < 70 %. */
  function words(s) {
    const n = (util().normalize ? util().normalize(str(s).replace(/\*\*/g, '')) : str(s).toLowerCase());
    return n.split(' ').filter(function (w) { return w.length >= 5; });
  }
  /* Partie (index) de chaque carte de la fiche, estimée par les mots partagés : {cardId: index}. */
  // explain = true : parties du mode « Comprendre » (texte rédigé) au lieu des parties de la fiche
  function cardSections(p, explain) {
    const src = explain ? (p.explain && p.explain.sections) || [] : p.sections || [];
    const secs = src.map(function (s) { const set = {}; words((s.h || '') + ' ' + (explain ? str(s.text) + ' ' + (s.retenir || []).join(' ') : (s.points || []).join(' '))).forEach(function (w) { set[w] = 1; }); return set; });
    const out = {};
    cardsOf(p).forEach(function (c) {
      let best = -1, bs = 0;
      const ws = words(c.q + ' ' + c.a);
      secs.forEach(function (set, i) { let k = 0; ws.forEach(function (w) { if (set[w]) k++; }); if (k > bs) { bs = k; best = i; } });
      if (best >= 0) out[c.id] = best;
    });
    return out;
  }
  function sectionScores(p) {
    const secs = (p.sections || []).map(function (s, i) {
      const set = {};
      words((s.h || '') + ' ' + (s.points || []).join(' ')).forEach(function (w) { set[w] = 1; });
      return { i: i, title: str(s.h || ('Partie ' + (i + 1))), set: set, n: 0, sum: 0, total: 0 };
    });
    if (!secs.length) return [];
    const srs = loadSrs();
    cardsOf(p).forEach(function (c) {
      const ws = words(c.q + ' ' + c.a);
      let best = null, bs = 0;
      secs.forEach(function (s) { let k = 0; ws.forEach(function (w) { if (s.set[w]) k++; }); if (k > bs) { bs = k; best = s; } });
      if (!best) return;
      best.total++;
      const e = srs[c.id];
      if (e) { best.n++; best.sum += e.r != null ? e.r : (e.b > 0 ? 1 : 0); }
    });
    return secs.map(function (s) { return { i: s.i, title: s.title, seen: s.n, total: s.total, pct: s.n ? Math.round(s.sum / s.n * 100) : null }; });
  }
  function fragileBlock(p) {
    const ss = sectionScores(p);
    if (!ss.length) return null;
    const tested = ss.filter(function (s) { return s.seen >= 3; }).sort(function (a, b) { return a.pct - b.pct; });
    const fragile = tested.filter(function (s) { return s.pct < 70; });
    const go = function (i) { const el = document.getElementById('pz-s' + i); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    const rowOf = function (s, tone) {
      const col = tone === 'bad' ? 'var(--bad)' : tone === 'ok' ? 'var(--ok)' : 'var(--muted)';
      return h('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--line)' },
        h('b', { style: 'min-width:74px;color:' + col }, (tone === 'bad' ? '⚠ ' : '') + (s.seen >= 3 ? s.pct + ' %' : 'pas encore testé')),
        h('span', { style: 'flex:1;min-width:140px;font-size:14px' }, s.title),
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', on: { click: function () { go(s.i); } } }, 'Revoir'));
    };
    return h('div', { class: 'card', style: 'padding:12px 14px' },
      h('b', {}, fragile.length ? 'À revoir en priorité (' + fragile.length + ')' : 'Zones de fragilité'),
      h('p', { class: 'secondary muted', style: 'margin:4px 0 6px' }, fragile.length ? 'Les parties de la fiche où tu rates le plus de cartes (estimé d’après le contenu des cartes).' : tested.length ? 'Aucune partie sous 70 % : bravo.' : 'Fais les cartes de la fiche : les parties où tu bloques apparaîtront ici.'),
      [].concat(fragile.map(function (s) { return rowOf(s, 'bad'); }), tested.filter(function (s) { return s.pct >= 70; }).slice(0, 2).map(function (s) { return rowOf(s, 'ok'); })));
  }
  function pjStatus(id, withProgress) {
    const pj = CARDIO.views && CARDIO.views.planj;
    if (!pj || typeof pj.statusFor !== 'function') return null;
    const s = pj.statusFor('p:' + id);
    const out = [];
    if (s && s.course) out.push(s.el);
    if (withProgress && pj.quizProgress) {
      const q = pj.quizProgress('p:' + id);
      if (q) out.push(h('p', { class: 'secondary muted', style: 'margin:4px 0 0' }, q.applied ? '📝 Note du jour : ' + q.pct + ' % sur ' + q.n + ' cartes.' : '📝 ' + q.n + '/' + q.min + ' cartes aujourd’hui' + (q.n ? ' (' + q.pct + ' %)' : '') + ' via « Me tester » dans la Méthode des J : à ' + q.min + ', ta note compte comme une révision.'));
    }
    return out.length ? h('div', {}, out) : null;
  }

  /* ---------- fiche ---------- */
  function renderFiche(p, root) {
    const page = h('div', { class: 'page stack' });
    const atlasStrip = (function () { try { return CARDIO.views.atlas && CARDIO.views.atlas.strip(p.id); } catch (e) { return null; } })();
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
      const eMap = cardSections(p, true);
      x.sections.forEach(function (s, i) {
        const nSec = Object.keys(eMap).filter(function (k) { return eMap[k] === i; }).length;
        const paras = str(s.text).split(/\n\s*\n/).map(function (t) { return t.trim(); }).filter(Boolean);
        body.appendChild(h('section', { class: 'pz-sec' }, h('h3', {}, str(s.h)),
          h('div', { class: 'pz-text' }, paras.map(function (t) { return h('p', {}, inlineMd(t)); })),
          Array.isArray(s.retenir) && s.retenir.length ? h('div', { class: 'pz-retenir' }, h('span', { class: 'caption' }, 'À retenir'),
            h('ul', {}, s.retenir.map(function (r) { return h('li', {}, inlineMd(r)); }))) : null,
          nSec ? h('a', { class: 'btn btn--outline btn--sm', style: 'margin-top:8px', href: '#/parasito/' + encodeURIComponent(p.id) + '/cartes?sec=e' + i + '&size=6&order=random' }, '▶ Me tester sur cette partie · ' + Math.min(6, nSec) + ' cartes') : null));
      });
      mark(p.id, { seen: true });
      after.replaceChildren(h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: function () { setMode('test'); window.scrollTo(0, 0); } } }, 'J’ai lu : me tester sur la fiche'), footer());
    }
    const secMap = cardSections(p);
    function draw(test) {
      const hidden = [];
      body.replaceChildren();
      (p.sections || []).forEach(function (s, i) {
        // « (B) » en tête de point = rang B (fiches LISAzay) : pastille B
        const ul = h('ul', {}, (s.points || []).map(function (pt) { const b = /^\(B\)\s*/.test(pt); return h('li', {}, b ? h('span', { class: 'pill pill--B', style: 'margin-right:4px' }, 'B') : null, inlineMd(b ? pt.replace(/^\(B\)\s*/, '') : pt)); }));
        const nSec = secMap ? Object.keys(secMap).filter(function (k) { return secMap[k] === i; }).length : 0;
        body.appendChild(h('section', { class: 'pz-sec', id: 'pz-s' + i }, h('h3', {}, str(s.h)), ul,
          nSec ? h('a', { class: 'btn btn--outline btn--sm', style: 'margin-top:8px', href: '#/parasito/' + encodeURIComponent(p.id) + '/cartes?sec=' + i + '&size=6&order=random' }, '▶ Me tester sur cette partie · ' + Math.min(6, nSec) + ' cartes') : null));
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
        h('div', { class: 'cluster' }, h('span', { class: 'src' }, polyName(p) + ' · p. ' + str(p.pages))),
        nx ? h('a', { class: 'btn btn--primary btn--block', href: '#/parasito/' + encodeURIComponent(nx.id) }, 'Fiche suivante : ' + str(nx.title))
          : h('a', { class: 'btn btn--secondary btn--block', href: '#/parasito' }, 'Toutes les fiches'));
    }

    const toc = (p.sections || []).length > 3 ? h('div', { class: 'pz-toc' }, (p.sections || []).map(function (s, i) {
      return h('a', { class: 'pill pill--kind', href: 'javascript:void 0', on: { click: function (e) { e.preventDefault(); const el = document.getElementById('pz-s' + i); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } } }, str(s.h));
    })) : null;
    const g = GROUPS.find(function (x) { return x[0] === p.group; });
    page.append(
      h('div', {},
        h('div', { class: 'caption' }, (g ? g[1] : 'Parasito') + (/^bact-lz-/.test(p.id) ? ' · fiche LISAzay n° ' + (p.num || '') + ' · rangs A et B' : polyOf(p) === 'bacterio' ? ' · poly bactério' : polyOf(p) === 'viro' ? ' · poly viro' : ' · rang A') + (p.items && p.items.length ? ' · items ' + p.items.join(', ') : '')),
        h('h2', { style: 'margin:4px 0 0' }, str(p.title)),
        p.agent ? h('p', { class: 'pz-card__agent', style: 'margin-top:2px' }, str(p.agent)) : null),
      p.hook ? h('div', { class: 'pz-hook' }, str(p.hook)) : null,
      atlasStrip,
      (function () { try { return CARDIO.views.fc && CARDIO.views.fc.ficheBlock(p.id); } catch (e) { return null; } })(),
      h('a', { class: 'card', href: '#/planj?tab=cours', style: 'display:block;padding:12px 14px;text-decoration:none;color:inherit' },
        h('div', { style: 'display:flex;justify-content:space-between;gap:8px' }, h('b', {}, 'Méthode des J'), h('span', { class: 'secondary muted' }, 'Modifier')),
        pjStatus(p.id, true) || h('p', { class: 'secondary muted', style: 'margin:4px 0 0' }, 'Pas encore placée dans ton planning.')),
      fragileBlock(p),
      trainBlock(p), seg, toc, body, after);
    setMode(hasX ? 'explain' : 'read');
    root.appendChild(page);
  }

  /* ---------- cartes : flashcards + QROC, répétition espacée locale ---------- */
  const LS_SRS = 'cardio.parasito.srs';
  const PIEGE = 3;   // ratée au moins 3 fois = carte piège
  const LS_NEW = 'cardio.parasito.newday';   // nouvelles cartes vues aujourd'hui (plafond quotidien)
  function today() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function newToday() { try { const o = JSON.parse(localStorage.getItem(LS_NEW) || '{}'); return o.d === today() ? (o.n || 0) : 0; } catch (e) { return 0; } }
  function bumpNew() { try { localStorage.setItem(LS_NEW, JSON.stringify({ d: today(), n: newToday() + 1 })); } catch (e) { /* ignore */ } }
  const STEPS = [0, 1, 3, 7, 15, 30, 60];
  const DAY = 86400000;
  function loadSrs() { try { return JSON.parse(localStorage.getItem(LS_SRS) || '{}') || {}; } catch (e) { return {}; } }
  function saveSrs(st) { try { localStorage.setItem(LS_SRS, JSON.stringify(st)); } catch (e) { /* stockage indisponible */ } }
  /* Flashcards et QROC entrelacés proportionnellement, pour qu'une session mélange toujours les deux. */
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
  let trainSec = null;   // ?sec=i : seulement les cartes de cette partie de la fiche (après chaque partie)
  function allCards(scope, type) {
    let all = (Array.isArray(scope) ? scope : scope ? [scope] : list()).reduce(function (a, p) { return a.concat(cardsOf(p)); }, []);
    if (trainSec != null && scope && !Array.isArray(scope)) {
      const ex = String(trainSec).charAt(0) === 'e', n = Number(String(trainSec).replace(/^e/, ''));
      const m = cardSections(scope, ex); all = all.filter(function (c) { return m[c.id] === n; });
    }
    if (type === 'ttt') return all.filter(function (c) { return c.tag === 'ttt'; });
    if (type === 'pieges') { const st = loadSrs(); return all.filter(function (c) { return st[c.id] && (st[c.id].l || 0) >= PIEGE; }); }
    return type === 'qroc' || type === 'flash' ? all.filter(function (c) { return c.kind === type; }) : all;
  }
  function counts(scope, type) {
    const st = loadSrs(), now = Date.now();
    const cards = allCards(scope, type);
    let due = 0, fresh = 0, known = 0;
    cards.forEach(function (c) {
      const s = st[c.id];
      if (!s) fresh++;
      else { if (s.d <= now) due++; if (s.b >= 3) known++; }
    });
    return { due: due, fresh: fresh, known: known, total: cards.length };
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  /* Dernière fois qu'une carte a été montrée (anti-répétition) : localStorage « cardio.parasito.shown » = {cardId: ms}. */
  const LS_SHOWN = 'cardio.parasito.shown';
  function loadShown() { try { return JSON.parse(localStorage.getItem(LS_SHOWN) || '{}') || {}; } catch (e) { return {}; } }
  function markShown(id) { try { const s = loadShown(); s[id] = Date.now(); localStorage.setItem(LS_SHOWN, JSON.stringify(s)); } catch (e) { /* ignore */ } }
  /* Les moins récemment montrées d'abord (jamais montrées en tête), tirage au hasard à égalité. */
  function byFreshness(list, shown) {
    // à égalité (ex. jamais montrées), les cartes des fiches les plus pertinentes passent devant
    const rc = {}; const rv = function (c) { const id = c.fiche && c.fiche.id; if (!(id in rc)) rc[id] = id ? rel(id) : 2; return rc[id]; };
    return shuffle(list.slice()).map(function (c) { return { c: c, t: shown[c.id] || 0, r: rv(c) }; })
      .sort(function (a, b) { return a.t - b.t || b.r - a.r; }).map(function (x) { return x.c; });
  }
  function buildSession(scope, size, type, order) {
    const st = loadSrs(), now = Date.now(), shown = loadShown();
    const cards = allCards(scope, type);
    if (order === 'random') {
      // Au hasard : toutes les cartes de la sélection, en évitant celles montrées récemment
      return shuffle(byFreshness(cards, shown).slice(0, size));
    }
    // Répétition espacée : dues d'abord, puis nouvelles (rang A devant), puis complément avec les moins récemment vues,
    // pour que la séance ait toujours sa taille et ne repasse pas toujours les mêmes cartes.
    const due = byFreshness(cards.filter(function (c) { return st[c.id] && st[c.id].d <= now; }), shown);
    const fresh = byFreshness(cards.filter(function (c) { return !st[c.id]; }), shown);
    fresh.sort(function (a, b) { return (a.rank === 'B' ? 1 : 0) - (b.rank === 'B' ? 1 : 0); });
    const cap = getOpts().newcap, left = cap === 'all' ? 100000 : Math.max(0, (Number(cap) || 20) - newToday());
    let out = due.slice(0, size).concat(fresh.slice(0, Math.min(left, Math.max(0, size - due.length))));
    if (out.length < size) {
      const used = {}; out.forEach(function (c) { used[c.id] = 1; });
      out = out.concat(byFreshness(cards.filter(function (c) { return !used[c.id] && st[c.id]; }), shown).slice(0, size - out.length));
    }
    return shuffle(out);
  }
  /* Note 0 À revoir · 1 Difficile · 2 Bien · 3 Facile (true/false = Bien/À revoir). l : nombre d'oublis (cartes pièges). */
  function grade(id, q) {
    if (q === true) q = 2; else if (q === false) q = 0;
    const st = loadSrs(), cur = st[id] || { b: 0 }, now = Date.now();
    if (!st[id]) bumpNew();
    let b = cur.b || 0, d;
    if (q === 0) { b = 0; d = now + 10 * 60000; }
    else if (q === 1) { b = Math.max(1, b); d = now + Math.max(1, Math.round(STEPS[b] / 2)) * DAY; }
    else { b = Math.min(STEPS.length - 1, b + (q === 3 ? 2 : 1)); d = now + STEPS[b] * DAY; }
    st[id] = { b: b, d: d, r: q >= 1 ? 1 : 0, l: (cur.l || 0) + (q === 0 ? 1 : 0) };   // r : dernier résultat (zones de fragilité)
    saveSrs(st);
  }
  /* Indice : nombre d'éléments attendus + première lettre de chaque mot-clé ; chiffres remplacés par « ? ». */
  function hintText(c) {
    const src = str(c.a);
    let terms = [];
    if (c.kind === 'qroc') terms = [src];
    else { const re = /\*\*(.+?)\*\*/g; let m; while ((m = re.exec(src))) terms.push(m[1]); }
    if (!terms.length) terms = [src.split(/[;:(]/)[0]];
    const KEEP = { de: 1, du: 1, des: 1, la: 1, le: 1, les: 1, l: 1, d: 1, à: 1, a: 1, au: 1, aux: 1, et: 1, ou: 1, en: 1, par: 1, sur: 1, '+': 1, '/': 1, '-': 1, '×': 1 };
    if (terms.length === 1 && /^(oui|non)\b/i.test(terms[0].replace(/\*\*/g, '').trim())) return 'Réponse fermée : oui ou non, puis la nuance.';
    const masked = terms.slice(0, 6).map(function (t) {
      t = t.replace(/\*\*/g, '').trim();
      return t.split(/\s+/).map(function (w) {
        if (KEEP[w.toLowerCase()]) return w;
        if (/\d/.test(w)) return w.replace(/\d+(?:[.,]\d+)?/g, '?').replace(/[A-Za-zÀ-ÿ]{2,}/g, function (x) { return /^(mg|g|kg|µg|ml|mL|l|L|h|j|min|mmHg|mmol|µmol|UI|MUI|cm|mm|ans?|mois|sem|semaines?|jours?|heures?|fois|cp|G)$/.test(x) ? x : x.charAt(0) + '…'; });
        if (!/[A-Za-zÀ-ÿ]/.test(w) || /^(mg|g|kg|µg|ml|mL|l|L|h|j|min|mmHg|mmol|µmol|UI|MUI|cm|mm|ans?|mois|sem|semaines?|jours?|heures?|fois|cp|G)[/.,;:)]*$/.test(w)) return w;
        return w.charAt(0) + '…';
      }).join(' ');
    });
    return (terms.length > 1 ? terms.length + ' éléments clés : ' : '') + masked.join(' · ');
  }
  /* Correction enrichie : c.e = explication (paragraphes markdown : pourquoi, lien, astuce, piège). */
  function explBox(c, cls) {
    if (!c.e) return null;
    const paras = str(c.e).split(/\n\s*\n|\n/).map(function (t) { return t.trim(); }).filter(Boolean);
    return h('div', { class: cls }, h('span', { class: 'caption' }, 'Pour bien comprendre'), paras.map(function (t) { return h('p', {}, inlineMd(t)); }));
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

  /* Réponse tapée à une flashcard : juste si chaque mot-clé en gras (ou la réponse entière) figure dans la saisie. */
  function flashRight(input, c) {
    const n = normAns(input);
    if (!n) return false;
    const re = /\*\*(.+?)\*\*/g; let m; const terms = [];
    while ((m = re.exec(str(c.a)))) terms.push(m[1]);
    if (!terms.length) terms.push(str(c.a));
    return terms.every(function (t) { const k = normAns(t); return !k || n.indexOf(k) >= 0 || (n.length >= 4 && k.indexOf(n) >= 0); });
  }

  function trainBlock(scope) {
    const n = counts(scope);
    if (!n.total) return null;
    const nf = allCards(scope, 'flash').length, nq = allCards(scope, 'qroc').length;
    const base = '#/parasito/' + encodeURIComponent(scope ? scope.id : 'toutes') + '/cartes' + (scope ? '' : '?poly=' + curPoly);
    return h('div', { class: 'pz-train' },
      h('div', { class: 'pz-train__t' }, scope ? 'S’entraîner sur cette fiche' : (curPoly === 'bacterio' ? 'Réviser les cartes bactério' : curPoly === 'viro' ? 'Réviser les cartes viro' : 'Réviser les cartes parasito')),
      h('div', { class: 'pz-train__s' }, nf + ' flashcards · ' + nq + ' QROC — ' + (n.due ? n.due + ' à revoir · ' : '') + n.fresh + ' nouvelles · ' + n.known + ' bien sues'),
      h('div', { style: 'margin-top:6px' }, trainChooser(base, n.total)),
      h('a', { class: 'btn btn--secondary btn--block', style: 'margin-top:8px', href: '#/scroll' }, '📱 Mode Scroll · swipe, combos, cœurs'));
  }

  let trainCounts = false;   // séance lancée depuis la Méthode des J (?pj=1) : seule celle-ci compte pour la note
  function renderTrain(scope, root, type, size, order) {
    const page = h('div', { class: 'page stack' });
    const multi = Array.isArray(scope);
    const queue = buildSession(scope, size || 20, type, order);
    const total = queue.length;
    let done = 0, good = 0;
    const missed = {};
    const head = h('div', { class: 'cluster' });
    const stage = h('div', { class: 'stack' });
    const back = scope && !multi ? '#/parasito/' + encodeURIComponent(scope.id) : '#/parasito';
    page.append(h('div', {}, h('div', { class: 'caption' }, (type === 'qroc' ? 'QROC' : type === 'flash' ? 'Flashcards' : type === 'ttt' ? 'Flashcards traitements' : type === 'pieges' ? 'Cartes pièges' : 'Flashcards + QROC') + (curPoly === 'bacterio' ? ' bactério · poly DFGSM3' : curPoly === 'viro' ? ' viro · poly DFGSM3' : ' parasito · rang A')), h('h2', { style: 'margin:4px 0 0' }, multi ? scope.length + ' fiches choisies' : scope ? str(scope.title) : 'Toutes les fiches'),
      multi ? h('p', { class: 'secondary muted', style: 'margin:2px 0 0' }, scope.map(function (x) { return str(x.title); }).join(' · ')) : null), head, stage);
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
    function answer(c, q) {
      if (q === true) q = 2; else if (q === false) q = 0;
      const ok = q >= 1;
      if (!missed[c.id]) {
        grade(c.id, q);
        // Méthode des J (views/planj.js) : 20 cartes d'une fiche dans la journée → note de la fiche
        if (trainCounts) try { const u = util(); if (u.emit && c.fiche) u.emit('quiz:answer', { pkey: 'p:' + c.fiche.id, kind: 'parasito', score: ok ? 1 : 0, at: Date.now() }); } catch (e) { /* ignore */ }
        if (ok) good++;
        done++;
        if (!ok) { missed[c.id] = 1; queue.push(c); }
      }
      next();
    }
    /* Contexte de la carte : fiche › partie de la fiche (devinée d'après le contenu), pour ne pas réviser « hors sol ». */
    const secCache = {};
    function ctxLine(c) {
      const p = c.fiche; if (!p || !p.sections || !p.sections.length) return null;
      if (!secCache[p.id]) secCache[p.id] = cardSections(p, false);
      const i = secCache[p.id][c.id], sec = i != null ? p.sections[i] : null;
      return h('div', { class: 'secondary muted', style: 'font-size:.8125rem;margin:2px 0 4px' }, '📍 ' + str(p.title) + (sec && sec.h ? ' › ' + str(sec.h) : ''));
    }
    function show(c) {
      markShown(c.id);
      const card = h('div', { class: 'pz-card-q' },
        h('div', { class: 'pz-card__top' },
          h('span', { class: 'pill ' + (c.kind === 'qroc' ? 'pill--info' : 'pill--kind') }, c.kind === 'qroc' ? 'QROC' : 'Flashcard'),
          !scope || Array.isArray(scope) ? h('span', { class: 'secondary muted' }, str(c.fiche.title)) : null,
          missed[c.id] ? h('span', { class: 'pill pill--warn' }, 'deuxième passage') : null),
        ctxLine(c),
        h('div', { class: 'pz-q' }, inlineMd(c.q)),
        c.img ? h('figure', { class: 'card-fig' }, h('a', { href: c.img, target: '_blank', rel: 'noopener' }, h('img', { src: c.img, alt: 'Image de la question', loading: 'lazy' })),
          h('figcaption', {}, str(c.credit || ''), c.src ? h('a', { href: c.src, target: '_blank', rel: 'noopener' }, ' · source') : null)) : null);
      const ans = h('div', { class: 'stack' });
      const hintBox = h('div', { class: 'secondary', style: 'display:none;padding:8px 10px;border-radius:10px;background:var(--surface-2)' });
      const hintBtn = h('button', { type: 'button', class: 'btn btn--outline btn--sm', style: 'justify-self:start', on: { click: function () {
        hintBox.textContent = '💡 ' + hintText(c); hintBox.style.display = ''; hintBtn.remove();
      } } }, 'Indice');
      card.append(hintBox);
      stage.replaceChildren(card, hintBtn, ans);
      function gradeBtns(hint) {
        function b(cls, q, label, sub) {
          return h('button', { type: 'button', class: 'btn ' + cls + ((hint === false && q === 0) || (hint === true && q === 2) ? ' is-hint' : ''), on: { click: function () { answer(c, q); } } }, label, h('small', {}, sub));
        }
        return h('div', { class: 'grades' },
          b('grade--again', 0, 'À revoir', 'raté'), b('grade--hard', 1, 'Difficile', 'avec peine'),
          b('grade--good', 2, 'Bien', 'su'), b('grade--easy', 3, 'Facile', 'évident'));
      }
      if (c.kind === 'flash' && getOpts().typed === '1') {
        const fin = h('input', { type: 'text', class: 'input', placeholder: 'Ta réponse', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
        const fcheck = function () {
          const v = fin.value.trim(), ok = flashRight(v, c);
          hintBtn.remove();
          ans.replaceChildren(h('div', { class: 'feedback ' + (ok ? 'feedback--ok' : 'feedback--warn') }, ok ? 'Correct !' : (v ? 'Compare avec la réponse attendue' : 'Réponse attendue')),
            h('div', { class: 'pz-a' }, inlineMd(c.a)), v ? h('p', { class: 'secondary muted' }, 'Ta réponse : ' + v) : null,
            explBox(c, 'pz-expl'), gradeBtns(v ? ok : undefined));
        };
        fin.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); fcheck(); } });
        ans.append(fin, h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: fcheck } }, 'Valider'));
        setTimeout(function () { try { fin.focus(); } catch (e) { /* ignore */ } }, 50);
        return;
      }
      if (c.kind === 'flash') {
        ans.appendChild(h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: function () {
          hintBtn.remove();
          ans.replaceChildren(h('div', { class: 'pz-a' }, inlineMd(c.a)), explBox(c, 'pz-expl'), gradeBtns());
        } } }, 'Voir la réponse'));
        return;
      }
      const input = h('input', { type: 'text', class: 'input', placeholder: 'Ta réponse', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
      function check() {
        const v = input.value.trim();
        const ok = looksRight(v, c);
        hintBtn.remove();
        ans.replaceChildren(
          h('div', { class: 'feedback ' + (ok ? 'feedback--ok' : 'feedback--warn') }, ok ? 'Correct !' : (v ? 'Compare avec la réponse attendue' : 'Réponse attendue')),
          h('div', { class: 'pz-a' }, h('strong', {}, str(c.a)), c.x ? h('div', { class: 'secondary', style: 'margin-top:4px' }, inlineMd(c.x)) : null),
          v ? h('p', { class: 'secondary muted' }, 'Ta réponse : ' + v) : null,
          explBox(c, 'pz-expl'),
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
        h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: function () { root.replaceChildren(); renderTrain(scope, root, type, size, order); } } }, 'Encore une session'),
        h('a', { class: 'btn btn--secondary btn--block', href: back }, scope && !multi ? 'Retour à la fiche' : 'Retour aux fiches'));
    }
    next();
  }

  /* ---------- Mode Scroll : fil infini façon réseau social, branché sur la répétition espacée ----------
   * Tap = retourner · swipe droite = Bien · swipe gauche = À revoir (boutons gardés dessous).
   * Combo (À revoir le casse, Difficile le garde, bouclier tous les 25), modes Zen / Défi (3 cœurs par run, relance immédiate),
   * carte ratée reproposée 3-4 cartes plus loin, cartes bonus ×2 au hasard, objectif du jour, dosage auto ≈ 85 % de réussite.
   * État de jeu à part (localStorage « cardio.scroll.game »), jamais mélangé avec la progression SRS. */
  const LS_GAME = 'cardio.scroll.game', LS_SCROLL = 'cardio.scroll.opts', GOAL = 50;
  function loadGame() { try { return Object.assign({ xp: 0, bestCombo: 0, bestRun: 0, days: {} }, JSON.parse(localStorage.getItem(LS_GAME) || '{}')); } catch (e) { return { xp: 0, bestCombo: 0, bestRun: 0, days: {} }; } }
  function saveGame(g) { try { localStorage.setItem(LS_GAME, JSON.stringify(g)); } catch (e) { /* ignore */ } }
  function scrollOpts() { try { return Object.assign({ mode: 'zen', poly: 'all' }, JSON.parse(localStorage.getItem(LS_SCROLL) || '{}')); } catch (e) { return { mode: 'zen', poly: 'all' }; } }
  function streakOf(g) {
    let n = 0; const d = new Date();
    for (;;) { const k = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); if ((g.days[k] || 0) > 0) { n++; d.setDate(d.getDate() - 1); } else break; }
    return n;
  }
  /* Flashcards du Collège (views/fc.js : cardio, dermato, pneumo) adaptées au fil, avec leur propre SM-2. */
  function fcCards() {
    const r = CARDIO.registry || {}, pub = r.fcPub && Array.isArray(r.fcPub.cards) ? r.fcPub : null;
    if (!pub) return [];
    const fiches = pub.fiches || {};
    return pub.cards.map(function (c) {
      const f = fiches[c.fiche] || {};
      return { id: 'fc:' + c.id, fcid: c.id, src: 'fc', kind: 'flash', poly: c.poly, q: c.front, a: c.back, fiche: { id: 'fc-' + c.fiche, title: f.title || ('Item ' + c.fiche) } };
    });
  }
  function fcStore() { return CARDIO.store && CARDIO.store.get ? CARDIO.store : null; }
  function fcState(id) { const s = fcStore(); try { return s ? s.get('fc.' + id) : null; } catch (e) { return null; } }
  function fcToday() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function fcGrade(id, q) {
    const s = fcStore(), v = CARDIO.views && CARDIO.views.fc;
    if (!s || !s.set || !v || !v.nextState) return;
    if (!fcState(id)) bumpNew();
    s.set('fc.' + id, v.nextState(fcState(id), q === 0 ? 'again' : q === 3 ? 'easy' : 'good'));
  }
  function renderScroll(root) {
    const o = scrollOpts();
    const page = h('div', { class: 'page stack' });
    root.appendChild(page);
    function chip(key, val, label) {
      return h('button', { type: 'button', class: 'btn btn--sm ' + (o[key] === val ? 'btn--primary' : 'btn--outline'), on: { click: function () { o[key] = val; try { localStorage.setItem(LS_SCROLL, JSON.stringify(o)); } catch (e) { /* ignore */ } start(); } } }, label);
    }
    function start() {
      const g = loadGame();
      const fcN = fcCards().length;
      const polys = [['all', 'Tout'], ['parasito', '🪱 Parasito']].concat(hasPoly('bacterio') ? [['bacterio', '🧫 Bactério']] : [], hasPoly('viro') ? [['viro', '🦠 Viro']] : [],
        fcN ? [['cardio', '❤️ Cardio'], ['dermato', '🧴 Dermato'], ['pneumo', '🫁 Pneumo']] : []);
      page.replaceChildren(
        h('h2', { style: 'margin:0' }, '📱 Mode Scroll'),
        h('p', { class: 'secondary muted', style: 'margin:0' }, 'Tape la carte pour la retourner, puis glisse ➡️ si tu savais, ⬅️ sinon. Les cartes viennent de ta répétition espacée : chaque swipe compte.'),
        h('div', { class: 'card', style: 'display:grid;gap:8px' },
          h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center' }, h('span', { class: 'secondary muted', style: 'min-width:64px' }, 'Mode'), chip('mode', 'zen', '🧘 Zen'), chip('mode', 'defi', '❤️ Défi (3 cœurs)')),
          h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center' }, h('span', { class: 'secondary muted', style: 'min-width:64px' }, 'Matière'), polys.map(function (x) { return chip('poly', x[0], x[1]); })),
          h('p', { class: 'secondary muted', style: 'margin:0' }, '🔥 Série : ' + streakOf(g) + ' jour' + (streakOf(g) > 1 ? 's' : '') + ' · ⭐ ' + g.xp + ' XP · record de combo ' + g.bestCombo + (o.mode === 'defi' ? ' · record de run ' + g.bestRun : '')),
          h('button', { type: 'button', class: 'btn btn--primary btn--block btn--lg', on: { click: play } }, 'C’est parti')));
    }
    function play() {
      const g = loadGame(), defi = o.mode === 'defi';
      const pool = listAll().filter(function (p) { return o.poly === 'all' || polyOf(p) === o.poly; }).reduce(function (a, p) { return a.concat(cardsOf(p)); }, [])
        .concat(fcCards().filter(function (c) { return o.poly === 'all' || c.poly === o.poly; }));
      const queued = {}, recent = [], feed = [];
      let combo = 0, shields = 0, hearts = 3, runCards = 0, runGood = 0, runXp = 0, runBest = 0, msg = '';
      const today = (function () { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); })();
      function refill() {
        const st = loadSrs(), now = Date.now(), shown = loadShown();
        const acc = recent.length >= 8 ? recent.reduce(function (a, b) { return a + b; }, 0) / recent.length : 0.85;
        const freshShare = acc < 0.75 ? 0.1 : acc > 0.92 ? 0.5 : 0.3;   // dosage pour rester autour de 85 % de réussite
        const cap = getOpts().newcap, capLeft = cap === 'all' ? 100000 : Math.max(0, (Number(cap) || 20) - newToday());
        const free = function (c) { return !queued[c.id]; };
        const known = function (c) { return c.src === 'fc' ? !!fcState(c.fcid) : !!st[c.id]; };
        const isDue = function (c) { if (c.src === 'fc') { const f = fcState(c.fcid); return !!f && f.due <= fcToday(); } return !!st[c.id] && st[c.id].d <= now; };
        const due = byFreshness(pool.filter(function (c) { return free(c) && known(c) && isDue(c); }), shown);
        const fresh = byFreshness(pool.filter(function (c) { return free(c) && !known(c); }), shown);
        const seen = byFreshness(pool.filter(function (c) { return free(c) && known(c) && !isDue(c); }), shown);
        const freshQueued = feed.filter(function (c) { return !known(c); }).length;
        let batch = due.slice(0, 12);
        batch = batch.concat(fresh.slice(0, Math.max(0, Math.min(capLeft - freshQueued, Math.round(20 * freshShare), 20 - batch.length))));
        batch = batch.concat(seen.slice(0, Math.max(0, 20 - batch.length)));
        if (!batch.length) batch = byFreshness(pool, shown).slice(0, 20);   // tout est vu : on repasse les moins récentes
        shuffle(batch).forEach(function (c) { queued[c.id] = 1; feed.push(Object.assign({}, c, { bonus: Math.random() < 1 / 12 })); });
      }
      const hud = h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-weight:600' });
      const ring = h('div', { class: 'bar' }, h('span', { class: 'bar__fill' }));
      const note = h('div', { class: 'secondary', style: 'min-height:1.4em;text-align:center;font-weight:600' });
      const stage = h('div', {});
      page.replaceChildren(hud, ring, note, stage);
      function drawHud() {
        const n = loadGame().days[today] || 0;
        hud.replaceChildren.apply(hud, [
          h('span', { class: 'pill pill--accent' }, '🔥 ' + combo + (shields ? ' 🛡️' + (shields > 1 ? '×' + shields : '') : '')),
          defi ? h('span', { class: 'pill' }, '❤️'.repeat(hearts) + '🤍'.repeat(3 - hearts)) : null,
          h('span', { class: 'pill' }, '⭐ ' + runXp + ' XP'),
          h('span', { class: 'secondary muted', style: 'margin-left:auto' }, Math.min(n, GOAL) + ' / ' + GOAL + ' aujourd’hui'),
          h('a', { href: '#/scroll', class: 'btn btn--ghost btn--sm', on: { click: function (e) { e.preventDefault(); finish(true); } } }, 'Stop')].filter(Boolean));
        ring.firstChild.style.width = Math.min(100, Math.round(100 * n / GOAL)) + '%';
      }
      function say(t) { msg = t; note.textContent = t || ''; }
      function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ } }
      function next() {
        if (feed.length < 5) refill();
        if (!feed.length) { stage.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'empty__title' }, 'Aucune carte disponible'))); return; }
        show(feed.shift());
      }
      function show(c) {
        markShown(c.id);
        drawHud();
        let flipped = false;
        const secMap = c.fiche && c.fiche.sections ? cardSections(c.fiche, false) : {};
        const sec = c.fiche && c.fiche.sections && secMap[c.id] != null ? c.fiche.sections[secMap[c.id]] : null;
        const back = h('div', { style: 'display:none' });
        const card = h('div', { class: 'card card--raised', style: 'min-height:52vh;display:flex;flex-direction:column;justify-content:center;gap:12px;touch-action:none;user-select:none;cursor:pointer;transition:transform .2s ease, opacity .2s ease;position:relative' },
          h('div', { class: 'secondary muted', style: 'font-size:.8125rem' }, '📍 ' + str(c.fiche && c.fiche.title) + (sec && sec.h ? ' › ' + str(sec.h) : '')),
          c.bonus ? h('span', { class: 'pill pill--warn', style: 'align-self:flex-start' }, '🎁 Carte bonus ×2') : null,
          c.retry ? h('span', { class: 'pill pill--info', style: 'align-self:flex-start' }, '↩️ Rattrapage' + (defi && hearts < 3 ? ' : un cœur à gagner' : '')) : null,
          h('div', { class: 'pz-q', style: 'font-size:1.25rem' }, inlineMd(c.q)),
          back,
          h('div', { class: 'secondary muted', style: 'font-size:.75rem;text-align:center;margin-top:auto' }, 'Tape pour retourner'));
        const btns = h('div', { class: 'grades', style: 'display:none' });
        function flip() {
          if (flipped) return; flipped = true;
          back.style.display = '';
          back.replaceChildren(h('div', { class: 'pz-a', style: 'font-size:1.15rem' }, inlineMd(c.kind === 'qroc' ? '**' + str(c.a) + '**' : c.a)), c.x ? h('div', { class: 'secondary' }, inlineMd(c.x)) : null, explBox(c, 'pz-expl'));
          card.lastChild.textContent = '⬅️ À revoir · Bien ➡️';
          btns.style.display = '';
        }
        function b(cls, q, label) { return h('button', { type: 'button', class: 'btn ' + cls, on: { click: function (e) { e.stopPropagation(); rate(q); } } }, label); }
        btns.append(b('grade--again', 0, 'À revoir'), b('grade--hard', 1, 'Difficile'), b('grade--good', 2, 'Bien'), b('grade--easy', 3, 'Facile'));
        let x0 = null, y0 = 0, dx = 0;
        card.addEventListener('pointerdown', function (e) { x0 = e.clientX; y0 = e.clientY; dx = 0; try { card.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ } });
        card.addEventListener('pointermove', function (e) { if (x0 == null || !flipped) return; dx = e.clientX - x0; card.style.transform = 'translateX(' + dx + 'px) rotate(' + (dx / 30) + 'deg)'; });
        card.addEventListener('pointerup', function (e) {
          if (x0 == null) return;
          const mx = e.clientX - x0, my = e.clientY - y0; x0 = null;
          if (!flipped) { if (Math.abs(mx) < 12 && Math.abs(my) < 12) flip(); else if (Math.abs(mx) > 60) flip(); return; }
          if (Math.abs(mx) > 90) { rate(mx > 0 ? 2 : 0); return; }
          card.style.transform = '';
        });
        function rate(q) {
          card.style.transform = 'translateX(' + (q >= 1 ? 120 : -120) + '%)'; card.style.opacity = '0';
          const ok = q >= 1;
          if (!c.retry) { if (c.src === 'fc') fcGrade(c.fcid, q); else grade(c.id, q); }
          recent.push(ok ? 1 : 0); if (recent.length > 20) recent.shift();
          runCards++; if (ok) runGood++;
          const gg = loadGame(); gg.days[today] = (gg.days[today] || 0) + 1;
          let t = '';
          if (q === 0) {
            if (shields) { shields--; t = '🛡️ Bouclier utilisé : combo sauvé'; }
            else { if (combo >= 5) t = 'Combo de ' + combo + ' cassé…'; combo = 0; }
            if (defi) hearts--;
            feed.splice(Math.min(feed.length, 3), 0, Object.assign({}, c, { retry: true, bonus: false }));
            vibrate(40);
          } else if (q >= 2) {
            combo++;
            if (combo % 25 === 0) { shields++; t = '🛡️ Bouclier gagné !'; vibrate([20, 40, 20]); }
            else if (combo % 10 === 0) { t = '🔥 Combo ' + combo + ' !'; vibrate(25); }
          }
          if (ok && c.retry && defi && hearts < 3) { hearts++; t = '💚 Cœur récupéré'; }
          const xp = ok ? Math.round((q === 1 ? 6 : q === 3 ? 12 : 10) * (c.bonus ? 2 : 1) * (1 + Math.floor(combo / 10) * 0.5)) : 0;
          runXp += xp; gg.xp += xp;
          runBest = Math.max(runBest, combo); gg.bestCombo = Math.max(gg.bestCombo, combo);
          if (combo > 0 && combo === gg.bestCombo && combo >= 5 && !t) t = '🏆 Nouveau record de combo : ' + combo;
          saveGame(gg);
          const n = gg.days[today];
          if (!t && n < GOAL && GOAL - n <= 5) t = 'Plus que ' + (GOAL - n) + ' carte' + (GOAL - n > 1 ? 's' : '') + ' pour ton objectif du jour';
          if (n === GOAL) t = '🎯 Objectif du jour atteint ! Tu peux t’arrêter… ou continuer en bonus';
          if (c.bonus && ok && !t) t = '🎁 Bonus : XP ×2';
          say(t);
          setTimeout(function () { if (defi && hearts <= 0) finish(false); else next(); }, 180);
        }
        card.addEventListener('click', function () { if (!flipped) flip(); });
        stage.replaceChildren(card, btns);
      }
      function finish(stopped) {
        const gg = loadGame();
        if (defi && !stopped) gg.bestRun = Math.max(gg.bestRun, runGood);
        saveGame(gg);
        page.replaceChildren.apply(page, [
          h('h2', { style: 'margin:0' }, defi && !stopped ? '💔 Plus de cœurs' : 'Session terminée'),
          h('div', { class: 'tiles' },
            h('div', { class: 'tile' }, h('span', { class: 'tile__label' }, 'Cartes'), h('span', { class: 'tile__value' }, String(runCards))),
            h('div', { class: 'tile tile--ok' }, h('span', { class: 'tile__label' }, 'Réussies'), h('span', { class: 'tile__value' }, String(runGood))),
            h('div', { class: 'tile tile--accent' }, h('span', { class: 'tile__label' }, 'Meilleur combo'), h('span', { class: 'tile__value' }, String(runBest))),
            h('div', { class: 'tile' }, h('span', { class: 'tile__label' }, 'XP gagnés'), h('span', { class: 'tile__value' }, String(runXp)))),
          defi && !stopped ? h('p', { class: 'secondary' }, runGood >= gg.bestRun ? '🏆 Record de run : ' + runGood + ' cartes réussies !' : 'Record de run : ' + gg.bestRun + ' — à battre.') : null,
          h('button', { type: 'button', class: 'btn btn--primary btn--block btn--lg', on: { click: play } }, defi ? 'Rejouer un run' : 'Continuer à scroller'),
          h('button', { type: 'button', class: 'btn btn--secondary btn--block', on: { click: start } }, 'Changer de mode')].filter(Boolean));
      }
      refill();
      next();
    }
    start();
  }

  // le titre de l'en-tête suit le poly affiché (Parasito-myco / Bactério)
  function render(params, query) { const el = renderInner(params, query); return { el: el, title: el.dataset.title || '' }; }
  function renderInner(params, query) {
    ensureStyles();
    const root = h('div', { class: 'view-parasito' });
    const id = str(params && params.id);
    if (params && params.scroll) { root.dataset.title = 'Mode Scroll'; renderScroll(root); return root; }
    if (params && params.train) {
      if (query && query.poly) setPoly(query.poly);
      let scope = id === 'toutes' ? null : listAll().find(function (x) { return x.id === id; });
      if (scope) setPoly(polyOf(scope));
      if (id === 'choix') {
        const ids = str(query && query.ids).split(',').map(function (s) { return decodeURIComponent(s.trim()); }).filter(Boolean);
        scope = listAll().filter(function (x) { return ids.indexOf(x.id) >= 0; });
        if (!scope.length) scope = null;
      }
      root.dataset.title = curPoly === 'bacterio' ? 'Cartes bactério' : curPoly === 'viro' ? 'Cartes viro' : 'Cartes parasito';
      const sz = query && query.size === 'all' ? 100000 : query && Number(query.size) > 0 ? Math.min(500, Number(query.size)) : 20;
      trainCounts = !!(query && query.pj === '1');
      trainSec = query && /^e?\d+$/.test(str(query.sec)) ? str(query.sec) : null;
      renderTrain(scope || null, root, query && query.type, sz, query && query.order === 'random' ? 'random' : 'srs');
      return root;
    }
    if (id) {
      const p = listAll().find(function (x) { return x.id === id; });
      if (p) setPoly(polyOf(p));
      root.dataset.title = p ? str(p.title) : 'Parasito';
      if (!p) root.appendChild(h('div', { class: 'page' }, h('div', { class: 'empty' }, 'Fiche introuvable.')));
      else renderFiche(p, root);
      return root;
    }
    if (query && query.poly) setPoly(query.poly);
    root.dataset.title = curPoly === 'bacterio' ? 'Bactério' : curPoly === 'viro' ? 'Viro' : 'Parasito-myco';
    root.appendChild(buildList());
    return root;
  }

  /* Pour la méthode des J : parties fragiles d'une fiche (au moins 3 cartes faites, < 70 %), les plus faibles d'abord. */
  function fragileOf(id) {
    const p = listAll().find(function (x) { return x.id === id; });
    if (!p) return [];
    return sectionScores(p).filter(function (s) { return s.seen >= 3 && s.pct < 70; }).sort(function (a, b) { return a.pct - b.pct; });
  }
  CARDIO.views.parasito = { render: render, available: function () { return listAll().length > 0; }, fragileOf: fragileOf };
})();
