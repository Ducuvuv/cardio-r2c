/* CardioR2C — views/ttt2.js
 * Traitements cardio v2 (docs/TTT2.md) : rien n'est présenté isolé. La situation clinique est la source de vérité
 * (toute l'ordonnance, dans l'ordre) ; une fiche classe renvoie toujours aux situations où elle sert, avec ce qu'on
 * y associe.
 *   #/ttt2                      onglets « Par situation » (liste par item + recherche) / « Par classe » ; ?tab=classes
 *   #/ttt2/item/:num            les situations d'un item + ses flashcards / QROC
 *   #/ttt2/item/:num/cartes     flashcards + QROC de l'item (?type=flash|qroc, ?rank=A)
 *   #/ttt2/s/:id                une situation : quand, étapes, ordonnance, surveillance, sortie, pièges, classes liées
 *   #/ttt2/c/:id                une fiche classe (contenu v1) puis « Dans quelles situations ? »
 * Filtre Tout / Rang A / Rang B (clé partagée avec la fiche v2 : « cardio.r2c.fiche.rank »).
 * Matière : la liste (#/ttt2) ne montre que les items et classes de la matière active (CARDIO.views.matiere.current(),
 * profil store.activeSpe ; « all » = toutes, groupées par matière) avec le sélecteur de matière partagé ; ?spe=dermato
 * choisit la matière (lien depuis views/ttt.js). Les pages item / situation / classe s'ouvrent quelle que soit la matière.
 * Contenu : CARDIO.registry.ttt2 = {items:[{item,spe,title,situations,flash,qroc}], situations:{id:…}, classes:{id:{…,spe}}}
 *           (app/content/ttt2.js, tools/_patches/_build_ttt2.py).
 * Statut : localStorage « cardio.ttt2.srs » = {cardId: {b, d}} (répétition espacée, même moteur que views/ttt.js),
 *          « cardio.ttt2.tab » (onglet de la liste).
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  CARDIO.views = CARDIO.views || {};

  const LS_RANK = 'cardio.r2c.fiche.rank';
  const LS_SRS = 'cardio.ttt2.srs';
  const LS_TAB = 'cardio.ttt2.tab';
  const STEPS = [0, 1, 3, 7, 15, 30, 60];
  const DAY = 86400000;

  /* ---------- outils ---------- */

  function util() { return CARDIO.util || {}; }
  function h() { const u = util(); return u.h.apply(null, arguments); }
  function str(v) { return v === undefined || v === null ? '' : String(v); }
  function esc(v) {
    return str(v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  /** Texte → HTML sûr : on échappe tout, puis seulement **gras** et *italique*. */
  function inline(s) {
    return esc(s)
      .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(«"'’\/])\*([^*\s](?:[^*]*?[^*\s])?)\*(?=$|[\s.,;:!?)»"'’\/])/g, '$1<em>$2</em>');
  }
  function md(s) {
    const u = util();
    if (typeof u.md === 'function') { try { return u.md(str(s)); } catch (e) { /* repli */ } }
    return str(s).split(/\n\s*\n/).map(function (p) { return p.trim() ? '<p>' + inline(p.trim()) + '</p>' : ''; }).join('');
  }
  function icon(name, size) {
    const u = util();
    try { return typeof u.icon === 'function' ? u.icon(name, { size: size || 18 }) : ''; } catch (e) { return ''; }
  }
  function lsGet(k, fb) { try { const v = localStorage.getItem(k); return v === null ? fb : JSON.parse(v); } catch (e) { return fb; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* mode privé */ } }
  function norm(s) { return str(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’`]/g, ' ').replace(/œ/g, 'oe').replace(/\s+/g, ' ').trim(); }
  function data() { const r = CARDIO.registry || {}; const d = r.ttt2; return d && typeof d === 'object' && Array.isArray(d.items) ? d : null; }
  function sit(id) { const d = data(); return d && d.situations ? d.situations[id] || null : null; }
  function cls(id) { const d = data(); return d && d.classes ? d.classes[id] || null : null; }
  function itemOf(num) { const d = data(); return d ? d.items.find(function (x) { return str(x.item) === str(num); }) || null : null; }
  function itemLabel(num) {
    try { const r = CARDIO.registry; return r && typeof r.label === 'function' ? r.label(num) : str(num); } catch (e) { return str(num); }
  }
  /* ---------- matière ---------- */
  const SPE_ORDER = ['cardio', 'dermato', 'pneumo'];
  const SPE_NAME = { cardio: 'cardiologie', dermato: 'dermatologie', pneumo: 'pneumologie' };
  function mat() { return CARDIO.views.matiere || null; }
  function speOfItem(num) {
    try { const r = CARDIO.registry; if (r && typeof r.speOf === 'function') return r.speOf(num); } catch (e) { /* repli */ }
    const k = str(num);
    return k[0] === 'd' ? 'dermato' : k[0] === 'p' ? 'pneumo' : 'cardio';
  }
  function itemSpe(it) { return (it && it.spe) || speOfItem(it && it.item); }
  function clsSpe(c) { return (c && c.spe) || 'cardio'; }
  function curSpe() { const m = mat(); try { return m ? m.current() : 'all'; } catch (e) { return 'all'; } }
  function inScope(spe, x) { return spe === 'all' || x === spe; }
  function speShort(code) { const m = mat(); try { return m ? m.short(code) : code; } catch (e) { return code; } }
  /** Matières présentes dans les items (ordre cardio, dermato, pneumo). */
  function spesWith(list, f) { return SPE_ORDER.filter(function (sp) { return list.some(function (x) { return f(x) === sp; }); }); }

  function rk(x) { return x && x.rank === 'B' ? 'B' : 'A'; }
  function rkAttr(r, hasB) { return ' data-rk="' + r + '"' + (r === 'A' && hasB ? ' data-hasb="1"' : ''); }
  function pillB(r) { return r === 'B' ? ' <span class="pill pill--B t2-b" title="Rang B">B</span>' : ''; }
  function srcHtml(src) { return src ? ' <span class="t2-src">' + esc(src) + '</span>' : ''; }
  function plural(n, a, b) { return n + ' ' + (n > 1 ? b : a); }
  function sitHasB(s) {
    if (rk(s) === 'B') return true;
    return ['etapes', 'ordonnance', 'surveillance', 'sortie', 'pieges'].some(function (k) { return (s[k] || []).some(function (x) { return rk(x) === 'B'; }); });
  }
  function clsHasB(c) { return (c.sections || []).some(function (x) { return rk(x) === 'B'; }); }

  /* ---------- filtre de rang ---------- */

  function filterBar(extra) {
    return '<div class="t2-bar" role="group" aria-label="Filtrer par rang">' +
      '<button type="button" class="chip" data-rank-f="all" aria-pressed="false">Tout</button>' +
      '<button type="button" class="chip" data-rank-f="A" aria-pressed="false">Rang A</button>' +
      '<button type="button" class="chip" data-rank-f="B" aria-pressed="false">Rang B</button>' +
      (extra ? '<span class="t2-bar__count">' + esc(extra) + '</span>' : '') + '</div>';
  }
  function getFilter() { const v = lsGet(LS_RANK, 'all'); return ['all', 'A', 'B'].indexOf(v) >= 0 ? v : 'all'; }
  function applyFilter(root, v) {
    const page = root.querySelector('.t2');
    if (!page) return;
    page.dataset.rank = v;
    root.querySelectorAll('[data-rank-f]').forEach(function (c) {
      const on = c.getAttribute('data-rank-f') === v;
      c.classList.toggle('is-on', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const empty = root.querySelector('.t2-empty-f');
    if (empty) {
      const any = Array.prototype.some.call(root.querySelectorAll('[data-filterable]'), function (el) { return el.offsetParent !== null; });
      empty.hidden = any;
    }
  }

  /* ---------- cartes (moteur de views/ttt.js, stockage séparé) ---------- */

  function cardsOf(it) {
    const f = (it.flash || []).map(function (x) { return Object.assign({ kind: 'flash' }, x); });
    const q = (it.qroc || []).map(function (x) { return Object.assign({ kind: 'qroc' }, x); });
    const out = [];
    let i = 0, j = 0;
    while (i < f.length || j < q.length) {
      if (j >= q.length || (i < f.length && i / f.length <= j / q.length)) out.push(f[i++]);
      else out.push(q[j++]);
    }
    return out;
  }
  function allCards(scope, type) {
    let all = cardsOf(scope.item);
    if (scope.rankA) all = all.filter(function (c) { return c.rank !== 'B'; });
    return type === 'qroc' || type === 'flash' ? all.filter(function (c) { return c.kind === type; }) : all;
  }
  function counts(scope, type) {
    const st = lsGet(LS_SRS, {}) || {}, now = Date.now();
    const cards = allCards(scope, type);
    let due = 0, fresh = 0, known = 0;
    cards.forEach(function (c) { const s = st[c.id]; if (!s) fresh++; else { if (s.d <= now) due++; if (s.b >= 3) known++; } });
    return { due: due, fresh: fresh, known: known, total: cards.length };
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function buildSession(scope, size, type) {
    const st = lsGet(LS_SRS, {}) || {}, now = Date.now();
    const cards = allCards(scope, type);
    const due = cards.filter(function (c) { return st[c.id] && st[c.id].d <= now; }).sort(function (a, b) { return st[a.id].d - st[b.id].d; });
    const fresh = cards.filter(function (c) { return !st[c.id]; });
    fresh.sort(function (a, b) { return (a.rank === 'B' ? 1 : 0) - (b.rank === 'B' ? 1 : 0); });
    return shuffle(due.slice(0, size).concat(fresh.slice(0, Math.max(0, size - due.length))));
  }
  function grade(id, ok) {
    const st = lsGet(LS_SRS, {}) || {}, cur = st[id] || { b: 0 };
    const b = ok ? Math.min(STEPS.length - 1, (cur.b || 0) + 1) : 0;
    st[id] = { b: b, d: ok ? Date.now() + STEPS[b] * DAY : Date.now() + 10 * 60000 };
    lsSet(LS_SRS, st);
  }
  /* Indice : nombre d'éléments attendus + première lettre de chaque mot-clé ; chiffres remplacés par « ? ». */
  const UNIT = /^(mg|g|kg|µg|ml|mL|l|L|h|j|min|mmHg|mmol|µmol|UI|MUI|cm|mm|ans?|mois|sem|semaines?|jours?|heures?|fois|cp|G)$/;
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
        if (/\d/.test(w)) return w.replace(/\d+(?:[.,]\d+)?/g, '?').replace(/[A-Za-zÀ-ÿ]{2,}/g, function (x) { return UNIT.test(x) ? x : x.charAt(0) + '…'; });
        if (!/[A-Za-zÀ-ÿ]/.test(w) || /^(mg|g|kg|µg|ml|mL|l|L|h|j|min|mmHg|mmol|µmol|UI|MUI|cm|mm|ans?|mois|sem|semaines?|jours?|heures?|fois|cp|G)[/.,;:)]*$/.test(w)) return w;
        return w.charAt(0) + '…';
      }).join(' ');
    });
    return (terms.length > 1 ? terms.length + ' éléments clés : ' : '') + masked.join(' · ');
  }
  function normAns(v) { return str(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9%]+/g, ' ').trim(); }
  function looksRight(input, c) {
    const n = normAns(input);
    if (!n) return false;
    return (c.accept && c.accept.length ? c.accept : [c.a]).some(function (a) { const m = normAns(a); return m && (n === m || (m.length >= 3 && n.indexOf(m) >= 0)); });
  }
  function cardsHref(num, q) { return '#/ttt2/item/' + encodeURIComponent(num) + '/cartes' + (q || ''); }

  function trainHtml(it) {
    const nf = (it.flash || []).length, nq = (it.qroc || []).length;
    if (!nf && !nq) return '';
    const n = counts({ item: it });
    return '<div class="t2-train">' +
      '<p class="t2-train__t">' + icon('flash') + '<span>S’entraîner sur l’item ' + esc(itemLabel(it.item)) + '</span></p>' +
      '<p class="t2-train__s">' + nf + ' flashcards · ' + nq + ' QROC — ' + (n.due ? n.due + ' à revoir · ' : '') + n.fresh + ' nouvelles · ' + n.known + ' bien sues</p>' +
      '<div class="t2-train__btns">' +
      (nf ? '<a class="btn btn--primary btn--sm" href="' + esc(cardsHref(it.item, '?type=flash')) + '">Flashcards</a>' : '') +
      (nq ? '<a class="btn btn--outline btn--sm" href="' + esc(cardsHref(it.item, '?type=qroc')) + '">QROC</a>' : '') +
      '<a class="btn btn--outline btn--sm" href="' + esc(cardsHref(it.item, '?rank=A')) + '">Rang A seulement</a></div></div>';
  }

  function renderTrain(scope, root, type) {
    const it = scope.item;
    const page = h('div', { class: 'page stack' });
    const queue = buildSession(scope, 20, type);
    const total = queue.length;
    let done = 0, good = 0;
    const missed = {};
    const head = h('div', { class: 'cluster' });
    const stage = h('div', { class: 'stack' });
    const back = '#/ttt2/item/' + encodeURIComponent(it.item);
    page.append(h('div', {}, h('div', { class: 'caption' }, (type === 'qroc' ? 'QROC' : type === 'flash' ? 'Flashcards' : 'Flashcards + QROC') + (scope.rankA ? ' · rang A' : '') + ' · traitements v2'),
      h('h2', { style: 'margin:4px 0 0' }, 'Item ' + itemLabel(it.item) + ' · ' + str(it.title))), head, stage);
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
      const s = c.situation ? sit(c.situation) : null;
      const card = h('div', { class: 't2-q-card' },
        h('div', { class: 't2-q-top' },
          h('span', { class: 'pill ' + (c.kind === 'qroc' ? 'pill--info' : 'pill--kind') }, c.kind === 'qroc' ? 'QROC' : 'Flashcard'),
          c.rank === 'B' ? h('span', { class: 'pill pill--B' }, 'Rang B') : null,
          s ? h('span', { class: 'secondary muted' }, str(s.title)) : null,
          missed[c.id] ? h('span', { class: 'pill pill--warn' }, 'deuxième passage') : null),
        h('div', { class: 't2-q', html: inline(c.q) }));
      const ans = h('div', { class: 'stack' });
      const hintBox = h('div', { class: 'secondary t2-hint', style: 'display:none' });
      const hintBtn = h('button', { type: 'button', class: 'btn btn--outline btn--sm', style: 'justify-self:start', on: { click: function () {
        hintBox.textContent = '💡 ' + hintText(c); hintBox.style.display = ''; hintBtn.remove();
      } } }, 'Indice');
      card.append(hintBox);
      stage.replaceChildren(card, hintBtn, ans);
      function gradeBtns(hint) {
        return h('div', { class: 'grades', style: 'grid-template-columns:1fr 1fr' },
          h('button', { type: 'button', class: 'btn grade--again' + (hint === false ? ' is-hint' : ''), on: { click: function () { answer(c, false); } } }, 'À revoir'),
          h('button', { type: 'button', class: 'btn grade--good' + (hint === true ? ' is-hint' : ''), on: { click: function () { answer(c, true); } } }, 'Su'));
      }
      if (c.kind === 'flash') {
        ans.appendChild(h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: function () {
          hintBtn.remove();
          ans.replaceChildren(h('div', { class: 't2-a', html: inline(c.a) }), gradeBtns());
        } } }, 'Voir la réponse'));
        return;
      }
      const input = h('input', { type: 'text', class: 'input t2-input', placeholder: 'Ta réponse', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
      function check() {
        const v = input.value.trim();
        const ok = looksRight(v, c);
        hintBtn.remove();
        ans.replaceChildren(
          h('div', { class: 'feedback ' + (ok ? 'feedback--ok' : 'feedback--warn') }, ok ? 'Correct !' : (v ? 'Compare avec la réponse attendue' : 'Réponse attendue')),
          h('div', { class: 't2-a' }, h('strong', {}, str(c.a)), c.x ? h('div', { class: 'secondary', style: 'margin-top:4px', html: inline(c.x) }) : null),
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
        h('a', { class: 'btn btn--secondary btn--block', href: back }, 'Retour aux situations de l’item'));
    }
    next();
  }

  /* ---------- briques HTML ---------- */

  function sitRow(s, showItem) {
    const r = rk(s);
    const n = (s.ordonnance || []).length;
    return '<a class="t2-row" data-filterable href="#/ttt2/s/' + encodeURIComponent(s.id) + '"' + rkAttr(r, sitHasB(s)) + '>' +
      '<span class="t2-row__main"><span class="t2-row__t">' + inline(s.title) + pillB(r) + '</span>' +
      '<span class="t2-row__s">' + (showItem ? 'Item ' + esc(itemLabel(s.item)) + ' · ' : '') + plural(n, 'ligne d’ordonnance', 'lignes d’ordonnance') + ' · ' + plural((s.etapes || []).length, 'étape', 'étapes') + '</span></span>' +
      '<span class="t2-row__chev" aria-hidden="true">' + icon('chevron-right') + '</span></a>';
  }

  function pointsHtml(list, cls) {
    return '<ul class="t2-points' + (cls ? ' ' + cls : '') + '">' + list.map(function (x) {
      const r = rk(x);
      return '<li' + rkAttr(r) + '><span>' + inline(x.t) + pillB(r) + srcHtml(x.src) + '</span></li>';
    }).join('') + '</ul>';
  }
  function blockHtml(title, ic, list, kind) {
    if (!list || !list.length) return '';
    const hasB = list.some(function (x) { return rk(x) === 'B'; });
    const allB = list.every(function (x) { return rk(x) === 'B'; });
    let body;
    if (kind === 'steps') {
      body = '<ol class="t2-steps">' + list.map(function (x, i) {
        const r = rk(x);
        return '<li' + rkAttr(r) + '><span class="t2-steps__n" aria-hidden="true">' + (i + 1) + '</span><span>' + inline(x.t) + pillB(r) + srcHtml(x.src) + '</span></li>';
      }).join('') + '</ol>';
    } else body = pointsHtml(list);
    if (kind === 'trap') {
      return '<section class="t2-call is-trap"' + rkAttr(allB ? 'B' : 'A', hasB) + '><p class="t2-call__head">' + icon('warning') + '<span>' + esc(title) + '</span></p>' + body + '</section>';
    }
    return '<section class="t2-sec"' + rkAttr(allB ? 'B' : 'A', hasB) + '><h2 class="t2-h2">' + icon(ic) + '<span>' + esc(title) + '</span></h2>' + body + '</section>';
  }
  function ordoHtml(rows) {
    if (!rows || !rows.length) return '';
    const hasB = rows.some(function (x) { return rk(x) === 'B'; });
    const allB = rows.every(function (x) { return rk(x) === 'B'; });
    return '<section class="t2-sec"' + rkAttr(allB ? 'B' : 'A', hasB) + '><h2 class="t2-h2">' + icon('pill') + '<span>Ordonnance</span>' +
      '<span class="t2-h2__n">' + plural(rows.length, 'ligne', 'lignes') + ', dans l’ordre</span></h2>' +
      '<p class="t2-scroll">Fais glisser le tableau →</p>' +
      '<div class="t2-table" tabindex="0" role="region" aria-label="Ordonnance"><table><thead><tr>' +
      ['Classe', 'Molécule', 'Dose', 'Durée', 'CI'].map(function (x) { return '<th scope="col">' + x + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.map(function (o) {
        const r = rk(o);
        return '<tr' + rkAttr(r) + '><th scope="row">' + inline(o.classe) + pillB(r) + (o.src ? '<span class="t2-src t2-src--cell">' + esc(o.src) + '</span>' : '') + '</th>' +
          '<td>' + inline(o.molecule) + '</td><td>' + inline(o.dose) + '</td><td>' + inline(o.duree) + '</td><td>' + (o.ci ? inline(o.ci) : '<span class="t2-muted">—</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';
  }
  function classChips(ids) {
    const list = (ids || []).map(cls).filter(Boolean);
    if (!list.length) return '';
    return '<section class="t2-sec"><h2 class="t2-h2">' + icon('book') + '<span>Fiches classes liées</span></h2>' +
      '<div class="t2-chips">' + list.map(function (c) {
        return '<a class="chip t2-chip" href="#/ttt2/c/' + encodeURIComponent(c.id) + '">' + icon('pill', 16) + '<span>' + esc(c.title) + '</span></a>';
      }).join('') + '</div></section>';
  }

  /* Ligne d'ordonnance « de cette classe » : la classe ou la molécule cite une molécule de la fiche, ou le nom de la fiche. */
  function lineMatcher(c) {
    const keys = (c.molecules || []).map(norm).filter(function (k) { return k.length >= 3; });
    const title = norm(c.title).split(/[ ,(]/)[0];
    if (title.length >= 5) keys.push(title.replace(/s$/, ''));
    return function (o) {
      const hay = ' ' + norm(o.classe + ' ' + o.molecule) + ' ';
      return keys.some(function (k) { return hay.indexOf(k) >= 0; });
    };
  }
  function lineHtml(o) {
    const r = rk(o);
    return '<li' + rkAttr(r) + '><span><strong>' + inline(o.classe) + '</strong>' + (o.molecule ? ' · ' + inline(o.molecule) : '') +
      (o.dose ? ' — ' + inline(o.dose) : '') + pillB(r) + '</span></li>';
  }
  function usesHtml(c) {
    const ids = (c.situations || []).filter(function (id) { return !!sit(id); });
    const isMine = lineMatcher(c);
    const body = ids.length ? ids.map(function (id) {
      const s = sit(id);
      const r = rk(s);
      const rows = s.ordonnance || [];
      const mine = rows.filter(isMine);
      const others = rows.filter(function (o) { return !isMine(o); });
      return '<article class="t2-use" data-filterable' + rkAttr(r, sitHasB(s)) + '>' +
        '<p class="t2-use__kicker">' + (speOfItem(s.item) !== clsSpe(c) ? esc(speShort(speOfItem(s.item))) + ' · ' : '') + 'Item ' + esc(itemLabel(s.item)) + '</p>' +
        '<h3 class="t2-use__t">' + inline(s.title) + pillB(r) + '</h3>' +
        (s.quand ? '<p class="t2-use__q">' + inline(s.quand) + '</p>' : '') +
        (mine.length ? '<div class="t2-use__mine"><p class="t2-use__h">Ici, cette classe :</p><ul class="t2-points">' + mine.map(lineHtml).join('') + '</ul></div>' : '') +
        '<div class="t2-assoc"><p class="t2-assoc__h">' + icon('layers') + '<span>Dans cette situation, on associe aussi :</span></p>' +
        (others.length ? '<ul class="t2-points">' + others.map(lineHtml).join('') + '</ul>'
          : '<p class="t2-muted t2-assoc__none">Aucune autre ligne d’ordonnance : la suite de la prise en charge est dans les étapes de la situation.</p>') + '</div>' +
        '<a class="t2-use__link" href="#/ttt2/s/' + encodeURIComponent(s.id) + '">Voir la situation complète →</a></article>';
    }).join('') : '<p class="t2-muted">Aucune situation rattachée pour l’instant.</p>';
    return '<section class="t2-uses" aria-labelledby="t2-uses-h"><h2 class="t2-h2 t2-h2--big" id="t2-uses-h">' + icon('case') + '<span>Dans quelles situations ?</span>' +
      '<span class="t2-h2__n">' + plural(ids.length, 'situation', 'situations') + '</span></h2>' +
      '<p class="t2-lead">Une classe ne se prescrit jamais seule : voici, pour chaque situation, tout ce qui l’accompagne.</p>' + body + '</section>';
  }

  /* ---------- pages ---------- */

  function header(kicker, title, sub, extra) {
    return '<header class="t2-head"><div class="t2-kicker">' + kicker + '</div><h1 class="t2-title">' + title + '</h1>' +
      (sub ? '<p class="t2-tagline">' + sub + '</p>' : '') + (extra || '') + '</header>';
  }

  function listHtml(tab, spe) {
    const d = data();
    const items = d.items.filter(function (it) { return inScope(spe, itemSpe(it)); });
    const nSit = items.reduce(function (n, it) { return n + it.situations.length; }, 0);
    const classes = Object.keys(d.classes).map(function (k) { return d.classes[k]; }).filter(function (c) { return inScope(spe, clsSpe(c)); });
    const multiSpe = spe === 'all' && spesWith(items, itemSpe).concat(spesWith(classes, clsSpe)).filter(function (x, i, a) { return a.indexOf(x) === i; }).length > 1;
    const kick = spe === 'all' ? (multiSpe ? 'Traitements · toutes matières' : 'Traitements · cardiologie') : 'Traitements · ' + (SPE_NAME[spe] || spe);
    const ttl = spe === 'all' ? (multiSpe ? 'Traitements' : 'Traitements cardio') : 'Traitements ' + speShort(spe).toLowerCase();
    let html = header(kick, ttl, 'Chaque traitement dans sa situation réelle : toute l’ordonnance, dans l’ordre, rangs A et B du Collège.') +
      '<div class="seg seg--block t2-tabs" role="tablist">' +
      '<button type="button" role="tab" class="seg__btn' + (tab === 'situations' ? ' is-on' : '') + '" data-tab="situations" aria-selected="' + (tab === 'situations') + '">Par situation</button>' +
      '<button type="button" role="tab" class="seg__btn' + (tab === 'classes' ? ' is-on' : '') + '" data-tab="classes" aria-selected="' + (tab === 'classes') + '">Par classe</button></div>' +
      filterBar(tab === 'situations' ? plural(nSit, 'situation', 'situations') : plural(classes.length, 'fiche', 'fiches'));
    if (tab === 'situations') {
      html += '<label class="t2-search">' + icon('search') + '<input type="search" class="t2-search__in" placeholder="Rechercher : molécule, situation, dose…" autocomplete="off" aria-label="Rechercher dans les situations"></label>' +
        '<div class="t2-results" hidden></div>' +
        '<div class="t2-items">' + (items.length ? '' : '<p class="t2-empty">Pas encore de traitements v2 pour cette matière.</p>') + items.map(function (it, i) {
          const sits = it.situations.map(sit).filter(Boolean);
          const hasB = sits.some(sitHasB);
          const allB = sits.length && sits.every(function (s) { return rk(s) === 'B'; });
          const sp = itemSpe(it);
          const head = multiSpe && (i === 0 || itemSpe(items[i - 1]) !== sp) ? '<h2 class="t2-group__h">' + esc(speShort(sp)) + '</h2>' : '';
          return head + '<details class="t2-item"' + rkAttr(allB ? 'B' : 'A', hasB) + '><summary class="t2-item__head">' +
            '<span class="t2-item__n">' + esc(itemLabel(it.item)) + '</span>' +
            '<span class="t2-item__main"><span class="t2-item__t">' + inline(it.title) + '</span>' +
            '<span class="t2-item__s">' + plural(sits.length, 'situation', 'situations') + ' · ' + ((it.flash || []).length + (it.qroc || []).length) + ' cartes</span></span>' +
            '<span class="t2-chev" aria-hidden="true">' + icon('chevron-down') + '</span></summary>' +
            '<div class="t2-item__body">' + sits.map(function (s) { return sitRow(s, false); }).join('') +
            '<a class="btn btn--ghost btn--sm t2-item__more" href="#/ttt2/item/' + encodeURIComponent(it.item) + '">' + icon('flash') + '<span>Page de l’item · flashcards et QROC</span></a></div></details>';
        }).join('') + '</div>';
    } else {
      const groups = [];   // [matière, groupe] (une même étiquette de groupe ne mélange jamais deux matières)
      classes.forEach(function (c) { if (!groups.some(function (g) { return g[0] === clsSpe(c) && g[1] === c.group; })) groups.push([clsSpe(c), c.group]); });
      if (!classes.length) html += '<p class="t2-empty">Pas encore de fiches classes v2 pour cette matière.</p>';
      html += groups.map(function (g) {
        return '<section class="t2-group"><h2 class="t2-group__h">' + (multiSpe ? esc(speShort(g[0])) + ' · ' : '') + esc(g[1]) + '</h2><div class="t2-list">' +
          classes.filter(function (c) { return clsSpe(c) === g[0] && c.group === g[1]; }).map(function (c) {
            const n = (c.situations || []).length;
            return '<a class="t2-card" data-filterable href="#/ttt2/c/' + encodeURIComponent(c.id) + '"' + rkAttr('A', clsHasB(c)) + '>' +
              '<span class="t2-card__top"><span class="pill pill--kind">' + plural(n, 'situation', 'situations') + '</span></span>' +
              '<span class="t2-card__t">' + esc(c.title) + '</span>' +
              ((c.molecules || []).length ? '<span class="t2-card__mol">' + esc(c.molecules.slice(0, 8).join(' · ') + (c.molecules.length > 8 ? '…' : '')) + '</span>' : '') + '</a>';
          }).join('') + '</div></section>';
      }).join('');
    }
    html += '<p class="t2-empty t2-empty-f" hidden>Rien à afficher avec ce filtre.</p>' +
      (spe === 'dermato' || spe === 'pneumo'
        ? '<p class="t2-foot"><a href="#/ttt">' + esc(speShort(spe)) + ' : fiches par classe (ancienne présentation) →</a></p>'
        : '<p class="t2-foot"><a href="#/ttt">Pneumo et dermato : rubrique Traitements (ancienne présentation) →</a></p>');
    return html;
  }

  let hayCache = null;
  function hay(s) {
    if (!hayCache) hayCache = {};
    if (!hayCache[s.id]) {
      const parts = [s.title, s.quand];
      ['etapes', 'surveillance', 'sortie', 'pieges'].forEach(function (k) { (s[k] || []).forEach(function (x) { parts.push(x.t); }); });
      (s.ordonnance || []).forEach(function (o) { parts.push(o.classe, o.molecule, o.dose, o.duree, o.ci); });
      hayCache[s.id] = norm(parts.join(' ').replace(/\*/g, ''));
    }
    return hayCache[s.id];
  }
  function search(root, q, spe) {
    const box = root.querySelector('.t2-results');
    const items = root.querySelector('.t2-items');
    const terms = norm(q).split(' ').filter(function (t) { return t.length >= 2; });
    if (!terms.length) { box.hidden = true; box.innerHTML = ''; items.hidden = false; applyFilter(root, getFilter()); return; }
    const d = data();
    const hits = [];
    d.items.filter(function (it) { return inScope(spe || 'all', itemSpe(it)); }).forEach(function (it) { it.situations.forEach(function (id) { const s = sit(id); if (s && terms.every(function (t) { return hay(s).indexOf(t) >= 0; })) hits.push(s); }); });
    items.hidden = true;
    box.hidden = false;
    box.innerHTML = '<p class="t2-results__n">' + (hits.length ? plural(hits.length, 'situation trouvée', 'situations trouvées') : 'Aucune situation ne contient ces mots.') + '</p>' +
      hits.slice(0, 80).map(function (s) { return sitRow(s, true); }).join('') + (hits.length > 80 ? '<p class="t2-muted">Affine la recherche pour voir la suite.</p>' : '');
    applyFilter(root, getFilter());
  }

  function itemHtml(it) {
    const sits = it.situations.map(sit).filter(Boolean);
    return header('Item ' + esc(itemLabel(it.item)) + ' · traitements', inline(it.title), plural(sits.length, 'situation', 'situations') + ' : pour chacune, toute la prise en charge, dans l’ordre.') +
      trainHtml(it) + filterBar() +
      '<div class="t2-item__body t2-item__body--page">' + sits.map(function (s) { return sitRow(s, false); }).join('') + '</div>' +
      '<p class="t2-empty t2-empty-f" hidden>Rien à afficher avec ce filtre.</p>' +
      '<p class="t2-foot"><a href="#/ttt2">Toutes les situations →</a></p>';
  }

  function sitHtml(s) {
    const it = itemOf(s.item);
    const ids = it ? it.situations : [];
    const i = ids.indexOf(s.id);
    const prev = i > 0 ? sit(ids[i - 1]) : null, next = i >= 0 && i + 1 < ids.length ? sit(ids[i + 1]) : null;
    const r = rk(s);
    return header('<a href="#/ttt2/item/' + encodeURIComponent(s.item) + '">Item ' + esc(itemLabel(s.item)) + '</a> · situation ' + (i + 1) + ' / ' + ids.length,
      inline(s.title) + ' <span class="pill pill--' + r + ' t2-rk">' + r + '</span>', '',
      s.quand ? '<div class="t2-quand"><p class="t2-quand__h">' + icon('target') + '<span>Quand ?</span></p><p>' + inline(s.quand) + '</p></div>' : '') +
      filterBar() +
      blockHtml('Étapes', 'list', s.etapes, 'steps') +
      ordoHtml(s.ordonnance) +
      blockHtml('Surveillance', 'eye', s.surveillance) +
      blockHtml('Sortie et long cours', 'check', s.sortie) +
      blockHtml('Pièges', 'warning', s.pieges, 'trap') +
      '<p class="t2-empty t2-empty-b" hidden>Aucun élément de rang B dans cette situation.</p>' +
      classChips(s.associe_classes) +
      (it ? trainHtml(it) : '') +
      '<nav class="t2-nav" aria-label="Situations de l’item">' +
      (prev ? '<a class="btn btn--secondary btn--block" href="#/ttt2/s/' + encodeURIComponent(prev.id) + '">← ' + inline(prev.title) + '</a>' : '') +
      (next ? '<a class="btn btn--primary btn--block" href="#/ttt2/s/' + encodeURIComponent(next.id) + '">Situation suivante : ' + inline(next.title) + '</a>'
        : '<a class="btn btn--primary btn--block" href="#/ttt2/item/' + encodeURIComponent(s.item) + '">Toutes les situations de l’item</a>') + '</nav>';
  }

  function clsHtml(c) {
    return header('Traitements · ' + esc(c.group), esc(c.title), c.intro ? inline(c.intro) : '',
      (c.molecules || []).length ? '<p class="t2-mol"><strong>Molécules : </strong>' + esc(c.molecules.join(', ')) + '</p>' : '') +
      '<a class="t2-jump" href="#t2-uses-h" data-jump>' + icon('case') + '<span>' + plural((c.situations || []).length, 'situation', 'situations') + ' où elle sert, avec tout ce qu’on y associe ↓</span></a>' +
      filterBar() +
      (c.sections || []).map(function (x) {
        const r = rk(x);
        return '<section class="t2-sec t2-csec"' + rkAttr(r) + '><h2 class="t2-h2"><span>' + inline(x.h) + '</span>' + pillB(r) + '</h2>' +
          '<div class="t2-md">' + md(x.text) + '</div>' +
          ((x.retenir || []).length ? '<div class="t2-retenir"><p class="t2-retenir__h">À retenir</p><ul>' + x.retenir.map(function (t) { return '<li>' + inline(t) + '</li>'; }).join('') + '</ul></div>' : '') +
          ((x.src || []).length ? '<p class="t2-src t2-src--sec">' + esc(x.src.join(' · ')) + '</p>' : '') + '</section>';
      }).join('') +
      ((c.pieges || []).length ? '<section class="t2-call is-trap"><p class="t2-call__head">' + icon('warning') + '<span>Pièges</span></p><ul class="t2-points">' +
        c.pieges.map(function (t) { return '<li><span>' + inline(t) + '</span></li>'; }).join('') + '</ul></section>' : '') +
      usesHtml(c) +
      '<p class="t2-foot"><a href="#/ttt2?tab=classes">Toutes les fiches classes →</a></p>';
  }

  /* ---------- styles (tokens uniquement) ---------- */

  const CSS = [
    '.t2{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;padding-bottom:24px}',
    '.t2 .icon{width:18px;height:18px;flex:0 0 auto}',
    '.t2-head{display:grid;gap:4px}',
    '.t2-kicker{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}',
    '.t2-kicker a{color:inherit}',
    '.t2-title{font:700 1.5rem/1.15 var(--font-display);margin:0;text-wrap:balance;overflow-wrap:anywhere}',
    '.t2-rk{vertical-align:.25em;font-size:.75rem}',
    '.t2-tagline{margin:2px 0 0;color:var(--ink-2);line-height:1.5}',
    '.t2-mol{margin:4px 0 0;font-size:.875rem;color:var(--ink-2);line-height:1.45}',
    '.t2-quand{margin-top:8px;padding:10px 12px;border-radius:var(--r-s);background:var(--info-soft);border-left:4px solid var(--info)}',
    '.t2-quand p{margin:0;line-height:1.5}',
    '.t2-quand__h{display:flex;align-items:center;gap:6px;font-weight:700;color:var(--info);margin-bottom:2px!important}',
    '.t2-tabs{margin-top:4px}',
    '.t2-bar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:6px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin-inline:calc(-1 * var(--gutter));padding:8px var(--gutter);background:var(--bg);border-bottom:1px solid var(--line)}',
    '.t2-bar::-webkit-scrollbar{display:none}',
    '.t2-bar .chip{flex:0 0 auto;min-height:36px}',
    '.t2-bar__count{margin-left:auto;flex:0 0 auto;font-size:.75rem;color:var(--muted);white-space:nowrap;padding-left:6px}',
    '.t2-h2{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 10px;font:700 1.0625rem/1.25 var(--font-display);color:var(--ink)}',
    '.t2-h2--big{font-size:1.25rem;color:var(--accent)}',
    '.t2-h2__n{margin-left:auto;font:500 .75rem var(--font-body,inherit);color:var(--muted)}',
    '.t2-sec{background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1);padding:14px;min-width:0}',
    '.t2-sec[data-rk="B"]{border-left:3px solid var(--rankB)}',
    '.t2-b{font-size:.625rem;padding:1px 6px;vertical-align:.1em;margin-left:2px}',
    '.t2-src{font-size:.6875rem;color:var(--muted);white-space:nowrap}',
    '.t2-src--cell{display:block;margin-top:2px;font-weight:400}',
    '.t2-src--sec{margin:8px 0 0;white-space:normal}',
    '.t2-muted{color:var(--muted)}',
    '.t2-points{margin:0;padding-left:20px;display:grid;gap:6px;line-height:1.55}',
    '.t2-points li::marker{color:var(--accent)}',
    '.t2-steps{list-style:none;margin:0;padding:0;display:grid;gap:10px}',
    '.t2-steps li{display:flex;gap:10px;align-items:flex-start;line-height:1.5}',
    '.t2-steps li>span:last-child{min-width:0;overflow-wrap:anywhere}',
    '.t2-steps__n{flex:0 0 26px;height:26px;display:grid;place-items:center;border-radius:50%;background:var(--accent);color:var(--accent-ink);font:700 .8125rem/1 var(--font-display);margin-top:1px}',
    '.t2-steps li[data-rk="B"] .t2-steps__n{background:var(--rankB);color:var(--rankB-ink)}',
    '.t2-scroll{margin:0 0 4px;font-size:.75rem;color:var(--muted)}',
    '@media (min-width:720px){.t2-scroll{display:none}}',
    '.t2-table{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:var(--r-s);max-width:100%}',
    '.t2-table:focus-visible{outline:2px solid var(--blue);outline-offset:2px}',
    '.t2-table table{width:100%;min-width:42rem;border-collapse:collapse;font-size:.875rem}',
    '.t2-table th,.t2-table td{padding:8px 10px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line);line-height:1.45}',
    '.t2-table thead th{background:var(--surface-2);font-size:.75rem;color:var(--ink-2);white-space:nowrap}',
    '.t2-table tbody th{font-weight:700;color:var(--blue);min-width:8rem}',
    '.t2-table tbody tr:last-child>*{border-bottom:0}',
    '.t2-table tbody tr[data-rk="B"]>th{box-shadow:inset 3px 0 0 var(--rankB)}',
    '.t2-call{border-radius:var(--r-m);padding:12px 14px;border-left:4px solid;min-width:0}',
    '.t2-call__head{display:flex;align-items:center;gap:6px;margin:0 0 6px;font-weight:700}',
    '.t2-call.is-trap{background:var(--warn-soft);border-color:var(--warn)}',
    '.t2-call.is-trap .t2-call__head{color:var(--warn)}',
    '.t2-chips{display:flex;flex-wrap:wrap;gap:6px}',
    '.t2-chip{display:inline-flex;align-items:center;gap:6px;min-height:36px;max-width:100%;text-decoration:none}',
    '.t2-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.t2-train{display:grid;gap:4px;padding:12px 14px;border-radius:var(--r-m);background:var(--surface);box-shadow:var(--shadow-1);border-left:4px solid var(--ok)}',
    '.t2-train__t{display:flex;align-items:center;gap:6px;margin:0;font:700 1rem/1.25 var(--font-display)}',
    '.t2-train__s{margin:0;font-size:.8125rem;color:var(--muted)}',
    '.t2-train__btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}',
    '.t2-search{display:flex;align-items:center;gap:8px;padding:0 12px;min-height:46px;border-radius:var(--r-m);border:2px solid var(--line);background:var(--surface);color:var(--muted)}',
    '.t2-search:focus-within{border-color:var(--blue)}',
    '.t2-search__in{flex:1;min-width:0;border:0;background:none;color:var(--ink);font:inherit;font-size:1rem;padding:10px 0;outline:none}',
    '.t2-results{display:grid;gap:6px}',
    '.t2-results__n{margin:0;font-size:.8125rem;font-weight:600;color:var(--muted)}',
    '.t2-items{display:grid;gap:8px}',
    '.t2-item{background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1);min-width:0}',
    '.t2-item__head{display:flex;align-items:center;gap:10px;padding:12px 14px;min-height:44px;cursor:pointer;list-style:none}',
    '.t2-item__head::-webkit-details-marker{display:none}',
    '.t2-item__n{flex:0 0 auto;min-width:40px;height:30px;padding:0 6px;display:grid;place-items:center;border-radius:8px;background:var(--accent-soft);color:var(--accent);font:700 .875rem/1 var(--font-display)}',
    '.t2-item__main{flex:1;min-width:0;display:grid;gap:2px}',
    '.t2-item__t{font:700 1rem/1.3 var(--font-display);overflow-wrap:anywhere}',
    '.t2-item__s{font-size:.75rem;color:var(--muted)}',
    '.t2-chev{display:inline-flex;color:var(--muted);transition:transform .2s var(--ease)}',
    'details[open]>summary .t2-chev{transform:rotate(180deg)}',
    '.t2-item__body{display:grid;gap:6px;padding:0 10px 12px}',
    '.t2-item__body--page{padding:0}',
    '.t2-item__more{justify-self:start;display:inline-flex;align-items:center;gap:6px}',
    '.t2-row{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:var(--r-s);background:var(--surface-2);color:inherit;text-decoration:none;min-width:0}',
    '.t2-item__body--page .t2-row,.t2-results .t2-row{background:var(--surface);box-shadow:var(--shadow-1)}',
    '.t2-row:hover{text-decoration:none;outline:1px solid var(--line)}',
    '.t2-row[data-rk="B"]{border-left:3px solid var(--rankB)}',
    '.t2-row__main{flex:1;min-width:0;display:grid;gap:2px}',
    '.t2-row__t{font-weight:600;line-height:1.35;overflow-wrap:anywhere}',
    '.t2-row__s{font-size:.75rem;color:var(--muted)}',
    '.t2-row__chev{display:inline-flex;color:var(--muted)}',
    '.t2-group{display:grid;gap:8px}',
    '.t2-group__h{margin:6px 0 0;font:700 1.0625rem/1.25 var(--font-display)}',
    '.t2-list{display:grid;gap:8px}',
    '.t2-card{display:grid;gap:4px;padding:12px 14px;border-radius:var(--r-m);background:var(--surface);box-shadow:var(--shadow-1);color:inherit;text-decoration:none;min-width:0}',
    '.t2-card:hover{box-shadow:var(--shadow-2);text-decoration:none}',
    '.t2-card__top{display:flex;gap:6px;flex-wrap:wrap}',
    '.t2-card__t{font:700 1.0625rem/1.3 var(--font-display)}',
    '.t2-card__mol{font-size:.8125rem;color:var(--muted);line-height:1.35}',
    '.t2-jump{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:var(--r-m);background:var(--accent-soft);color:var(--accent);font-weight:600;text-decoration:none;line-height:1.35}',
    '.t2-md p{margin:.45em 0;line-height:1.55}',
    '.t2-md ul,.t2-md ol{margin:.4em 0;padding-left:1.2em;line-height:1.5}',
    '.t2-md .md-table{overflow-x:auto;max-width:100%}',
    '.t2-retenir{margin-top:8px;padding:8px 10px;border-radius:10px;background:var(--ok-soft)}',
    '.t2-retenir__h{margin:0;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--ok)}',
    '.t2-retenir ul{margin:4px 0 0;padding-left:1.1em}',
    '.t2-retenir li{margin:.2em 0;font-weight:600}',
    '.t2-uses{display:grid;gap:10px;margin-top:6px;padding-top:14px;border-top:2px solid var(--accent-soft)}',
    '.t2-uses .t2-h2{margin:0}',
    '.t2-lead{margin:0;color:var(--ink-2);line-height:1.5}',
    '.t2-use{display:grid;gap:8px;padding:14px;border-radius:var(--r-m);background:var(--surface);box-shadow:var(--shadow-1);min-width:0}',
    '.t2-use[data-rk="B"]{border-left:3px solid var(--rankB)}',
    '.t2-use__kicker{margin:0;font-size:.6875rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}',
    '.t2-use__t{margin:0;font:700 1.0625rem/1.3 var(--font-display);overflow-wrap:anywhere}',
    '.t2-use__q{margin:0;font-size:.875rem;color:var(--ink-2);line-height:1.45}',
    '.t2-use__h{margin:0 0 4px;font-size:.8125rem;font-weight:700;color:var(--ink-2)}',
    '.t2-assoc{padding:10px 12px;border-radius:var(--r-s);background:var(--blue-soft);border-left:4px solid var(--blue)}',
    '.t2-assoc__h{display:flex;align-items:center;gap:6px;margin:0 0 6px;font-weight:700;color:var(--blue)}',
    '.t2-assoc__none{margin:0;font-size:.875rem}',
    '.t2-use__link{font-weight:600;font-size:.9375rem}',
    '.t2-nav{display:grid;gap:8px}',
    '.t2-nav .btn{white-space:normal;text-align:center;line-height:1.3;height:auto;min-height:44px;padding-block:8px}',
    '.t2-foot{margin:4px 0 0;font-size:.875rem}',
    '.t2-empty{color:var(--muted);text-align:center;padding:16px 0;margin:0}',
    '.t2-q-card{padding:14px 16px;border-radius:var(--r-m);background:var(--surface);box-shadow:var(--shadow-1)}',
    '.t2-q-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.t2-q{font:600 1.0625rem/1.4 var(--font-display);margin-top:6px}',
    '.t2-a{padding:12px 14px;border-radius:var(--r-m);background:var(--surface-2);line-height:1.45}',
    '.t2-hint{padding:8px 10px;border-radius:10px;background:var(--surface-2);margin-top:8px}',
    '.t2-input{width:100%;padding:12px;border-radius:10px;border:2px solid var(--line);background:var(--surface);color:var(--ink);font-size:1rem}',
    '.view-ttt2 .grades .is-hint{outline:2px solid currentColor;outline-offset:1px}',
    /* filtre de rang : A masque le B ; B masque le A sauf les conteneurs qui ont du B */
    '.t2[data-rank="A"] [data-rk="B"]{display:none}',
    '.t2[data-rank="B"] [data-rk="A"]:not([data-hasb="1"]){display:none}',
    '.t2[data-rank="B"] .t2-table tr[data-rk="A"]{display:none}',
    '@media (prefers-reduced-motion:reduce){.t2-chev{transition:none}}'
  ].join('\n');

  function ensureStyles() {
    if (document.getElementById('ttt2-view-css')) return;
    const s = document.createElement('style');
    s.id = 'ttt2-view-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------- rendu ---------- */

  function mount(root, html, onClick) {
    const page = h('div', { class: 'page t2', dataset: { rank: 'all' } });
    page.innerHTML = html;
    root.appendChild(page);
    applyFilter(root, getFilter());
    root.addEventListener('click', function (e) {
      const fb = e.target.closest('[data-rank-f]');
      if (fb) {
        const v = fb.getAttribute('data-rank-f');
        lsSet(LS_RANK, v);
        applyFilter(root, v);
        const eb = root.querySelector('.t2-empty-b');
        if (eb) eb.hidden = !(v === 'B' && !root.querySelector('.t2 [data-rk="B"],.t2 [data-hasb="1"]'));
        return;
      }
      const j = e.target.closest('[data-jump]');
      if (j) {
        e.preventDefault();
        const t = root.querySelector('#t2-uses-h');
        if (t) t.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
      }
      if (onClick) onClick(e);
    });
    const v = getFilter();
    const eb = root.querySelector('.t2-empty-b');
    if (eb) eb.hidden = !(v === 'B' && !root.querySelector('.t2 [data-rk="B"],.t2 [data-hasb="1"]'));
  }

  function notFound(root, msg) {
    root.appendChild(h('div', { class: 'page' }, h('div', { class: 'empty' }, h('div', { class: 'empty__title' }, msg), h('a', { class: 'btn btn--secondary', href: '#/ttt2' }, 'Tous les traitements'))));
    return root;
  }

  function render(params, query) {
    ensureStyles();
    const root = h('div', { class: 'view-ttt2' });
    const p = params || {};
    const q = query || {};
    const d = data();
    if (!d) return notFound(root, 'Traitements v2 indisponibles.');
    if (p.kind === 'item') {
      const it = itemOf(p.num);
      if (!it) return notFound(root, 'Item introuvable.');
      if (p.train) {
        root.dataset.title = 'Cartes traitements';
        renderTrain({ item: it, rankA: q.rank === 'A' }, root, q.type);
        return { el: root, title: 'Cartes · item ' + itemLabel(it.item) };
      }
      mount(root, itemHtml(it));
      return { el: root, title: 'Traitements · item ' + itemLabel(it.item) };
    }
    if (p.kind === 'situation') {
      const s = sit(str(p.id));
      if (!s) return notFound(root, 'Situation introuvable.');
      mount(root, sitHtml(s));
      return { el: root, title: 'Item ' + itemLabel(s.item) + ' · traitement' };
    }
    if (p.kind === 'classe') {
      const c = cls(str(p.id));
      if (!c) return notFound(root, 'Fiche classe introuvable.');
      mount(root, clsHtml(c));
      return { el: root, title: str(c.title) };
    }
    // ?spe=… (lien depuis l'ancienne rubrique Traitements) : choisit la matière active, comme le sélecteur
    if (q.spe && SPE_ORDER.indexOf(str(q.spe)) >= 0 && mat() && typeof mat().set === 'function' && curSpe() !== str(q.spe)) {
      try { mat().set(str(q.spe)); } catch (e) { /* ignore */ }
    }
    let spe = curSpe();
    let tab = q.tab === 'classes' || q.tab === 'situations' ? q.tab : lsGet(LS_TAB, 'situations');
    if (tab !== 'classes') tab = 'situations';
    let cur = root;
    /* Changement d'onglet : nouveau nœud (un seul écouteur de clic par nœud) à la place de l'ancien. */
    function draw() {
      const fresh = cur.cloneNode(false);
      if (cur.parentNode) cur.parentNode.replaceChild(fresh, cur);
      cur = fresh;
      return fresh;
    }
    function paint(target) {
      mount(target, listHtml(tab, spe), function (e) {
        const t = e.target.closest('[data-tab]');
        if (t) {
          tab = t.getAttribute('data-tab');
          lsSet(LS_TAB, tab);
          const next = draw();
          paint(next);
        }
      });
      // sélecteur de matière partagé (null s'il n'y a qu'une matière) : redessine la liste
      const m = mat();
      const page = target.querySelector('.t2');
      if (m && typeof m.switcher === 'function' && page) {
        try {
          const sw = m.switcher({ onChange: function () { spe = curSpe(); const next = draw(); paint(next); } });
          if (sw) page.insertBefore(sw, page.firstChild);
        } catch (e) { /* sans sélecteur */ }
      }
      const input = target.querySelector('.t2-search__in');
      if (input) {
        let timer = 0;
        input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { search(target, input.value, spe); }, 120); });
      }
    }
    paint(root);
    return { el: root, title: spe === 'dermato' || spe === 'pneumo' ? 'Traitements ' + speShort(spe).toLowerCase() : 'Traitements cardio' };
  }

  CARDIO.views.ttt2 = {
    render: render,
    /** Contenu v2 présent (pour une matière si `spe` est donné : au moins un item de cette matière). */
    available: function (spe) {
      const d = data();
      if (!d) return false;
      if (!spe || spe === 'all') return true;
      return d.items.some(function (it) { return itemSpe(it) === spe && it.situations.length > 0; });
    },
    /** Nombre de situations d'un item (0 si l'item n'a pas de traitements v2). */
    count: function (num) { const it = itemOf(num); return it ? it.situations.length : 0; }
  };
})();
