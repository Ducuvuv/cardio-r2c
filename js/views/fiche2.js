/* CardioR2C — views/fiche2.js
 * Cours v2 (« fiche logique », docs/FICHE2.md) : #/item/:num/cours quand CARDIO.registry.fiche2[num] existe
 * (sinon, ou avec ?v=1, la fiche v1 de views/course.js, inchangée).
 * Mise en page : en-tête (titre, accroche, anneau des parties revues) → « Le film en 1 minute » → « L'essentiel »
 * → barre collante Tout / Rang A / Rang B → sommaire repliable → parties repliables (blocs points, explain,
 * table défilante, steps, compare, trap, mnemo, alert, cloze) → mini-quiz de 3 questions de l'appli liées aux
 * objectifs de la partie → « J'ai revu cette partie ».
 * Rang : chaque élément porte data-rk (rang effectif, hérité de la partie) ; un conteneur mixte porte aussi
 * data-hasb="1" pour rester visible en filtre B. Pastille B sur un élément B dans une partie A.
 * Progression : localStorage « cardio.fiche2.<num> » = {read: {<sectionId>: iso}, at}.
 * Contenu : CARDIO.registry.fiche2 = {"<num>": {item, title, tagline, film[], essentials[], sections[]}}
 *           (app/content/fiche2.js, tools/_patches/_build_fiche2.py).
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  CARDIO.views = CARDIO.views || {};

  const LS_RANK = 'cardio.r2c.fiche.rank';   // partagé avec la fiche v1
  const PER_QUIZ = 3;
  const LETTERS = 'ABCDEFGH';
  const SLOT = /\{\{([^{}]+)\}\}/g;

  /* ---------- outils ---------- */

  function util() { return CARDIO.util || {}; }
  function h() { const u = util(); return u.h.apply(null, arguments); }
  function str(v) { return v === undefined || v === null ? '' : String(v); }
  function esc(v) {
    return str(v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  /** Texte de fiche → HTML sûr : on échappe tout, puis seulement **gras** et *italique*. */
  function inline(s) {
    return esc(s)
      .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(«"'’\/])\*([^*\s](?:[^*]*?[^*\s])?)\*(?=$|[\s.,;:!?)»"'’\/])/g, '$1<em>$2</em>');
  }
  function paras(s) {
    return str(s).split(/\n\s*\n/).map(function (p) {
      return p.trim() ? '<p>' + inline(p.trim()).replace(/\n/g, '<br>') + '</p>' : '';
    }).join('');
  }
  function icon(name, size) {
    const u = util();
    try { return typeof u.icon === 'function' ? u.icon(name, { size: size || 18 }) : ''; } catch (e) { return ''; }
  }
  function lsGet(key, fb) { try { const v = localStorage.getItem(key); return v === null ? fb : JSON.parse(v); } catch (e) { return fb; } }
  function lsSet(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* mode privé */ } }
  function reduced() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function registry() { return CARDIO.registry || {}; }
  /** Valeur d'attribut sûre dans un sélecteur [x="…"] (CSS.escape n'existe pas partout). */
  function attrq(s) { return str(s).replace(/["\\]/g, '\\$&'); }
  function data(num) { const f = registry().fiche2; return f && typeof f === 'object' && f[str(num)] ? f[str(num)] : null; }
  function testUrl(num, ids) {
    const q = (ids || []).filter(Boolean).map(encodeURIComponent).join(',');
    return '#/review?mode=item&item=' + encodeURIComponent(num) + (q ? '&objective=' + q : '') + '&autostart=1';
  }
  function itemLabel(num) {
    try { const r = registry(); return typeof r.label === 'function' ? r.label(num) : str(num); } catch (e) { return str(num); }
  }

  /* ---------- progression locale ---------- */

  function progKey(num) { return 'cardio.fiche2.' + num; }
  function progress(num) {
    const p = lsGet(progKey(num), null);
    return p && typeof p === 'object' && p.read && typeof p.read === 'object' ? p : { read: {} };
  }
  function setRead(num, sid, on) {
    const p = progress(num);
    if (on) p.read[sid] = p.read[sid] || new Date().toISOString(); else delete p.read[sid];
    p.at = new Date().toISOString();
    lsSet(progKey(num), p);
  }

  /* ---------- rangs ---------- */

  function rk(el, inherited) { return el && el.rank === 'B' ? 'B' : el && el.rank === 'A' ? 'A' : inherited; }
  function rowOf(r) { return Array.isArray(r) ? { cells: r } : r || { cells: [] }; }
  /** Rangs effectifs des enfants d'un bloc. */
  function childRanks(b, r) {
    let list = [];
    if (Array.isArray(b.items)) list = list.concat(b.items);
    (b.cols || []).forEach(function (c) { list = list.concat(c.items || []); });
    (b.rows || []).forEach(function (x) { list.push(rowOf(x)); });
    return list.map(function (x) { return rk(x, r); });
  }
  function hasB(b, r) { return r === 'B' || childRanks(b, r).indexOf('B') >= 0; }
  function rkAttr(r, mixed) { return ' data-rk="' + r + '"' + (r === 'A' && mixed ? ' data-hasb="1"' : ''); }
  function pillB(r, inherited) { return r === 'B' && inherited !== 'B' ? ' <span class="pill pill--B f2-b" title="Rang B">B</span>' : ''; }

  /* ---------- blocs ---------- */

  function li(it, inh) {
    const r = rk(it, inh);
    const sub = Array.isArray(it.sub) && it.sub.length
      ? '<ul class="f2-sub">' + it.sub.map(function (s) { return '<li>' + inline(s) + '</li>'; }).join('') + '</ul>' : '';
    return '<li' + rkAttr(r) + '><span>' + inline(it.text) + pillB(r, inh) + '</span>' + sub + '</li>';
  }

  function callout(kind, ic, title, b, inh) {
    const r = rk(b, inh);
    return '<div class="f2-call is-' + kind + '"><p class="f2-call__head">' + icon(ic) + '<span>' + inline(title) + '</span>' + pillB(r, inh) + '</p>' +
      '<div class="f2-call__body">' + paras(b.text) + '</div></div>';
  }

  /** Mélange déterministe (même ordre à chaque visite, différent de l'ordre du texte). */
  function shuffleSeed(list, seed) {
    const a = list.slice();
    let x = 2166136261;
    for (let k = 0; k < seed.length; k++) x = Math.imul(x ^ seed.charCodeAt(k), 16777619);
    for (let i = a.length - 1; i > 0; i--) {
      x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
      const j = x % (i + 1);
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function norm(s) {
    return str(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/['’`]/g, '').replace(/œ/g, 'oe').replace(/[‐-―\-_/]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function cloze(b, key) {
    const answers = [];
    const text = str(b.text);
    let html = '', last = 0;
    text.replace(SLOT, function (m, inner, at) {
      const alts = inner.split('|').map(function (s) { return s.trim(); });
      html += inline(text.slice(last, at));
      html += '<button type="button" class="f2-slot" data-slot="' + answers.length + '" data-accept="' + esc(JSON.stringify(alts.map(norm))) +
        '" aria-label="Trou ' + (answers.length + 1) + ', vide"><span class="f2-slot__v"></span></button>';
      answers.push(alts[0]);
      last = at + m.length;
      return m;
    });
    html += inline(text.slice(last));
    const chips = shuffleSeed(answers.concat(Array.isArray(b.distractors) ? b.distractors : []), key + text);
    return '<div class="f2-cloze" data-cloze>' +
      '<p class="f2-btitle">' + icon('target') + '<span>Texte à trous</span></p>' +
      '<p class="f2-cloze__hint">Touche une étiquette puis un trou (ou glisse-la). Touche un trou rempli pour le vider.</p>' +
      '<p class="f2-cloze__text">' + html + '</p>' +
      '<div class="f2-bank" role="group" aria-label="Étiquettes">' + chips.map(function (c, i) {
        return '<button type="button" class="f2-chip" draggable="true" data-chip="' + i + '" data-value="' + esc(c) + '" aria-pressed="false">' + esc(c) + '</button>';
      }).join('') + '</div>' +
      '<div class="f2-cloze__actions">' +
      '<button type="button" class="btn btn--primary btn--sm" data-cz="check">Vérifier</button>' +
      '<button type="button" class="btn btn--ghost btn--sm" data-cz="reveal">Révéler</button>' +
      '<button type="button" class="btn btn--ghost btn--sm" data-cz="reset">Recommencer</button></div>' +
      '<p class="f2-cloze__fb" aria-live="polite"></p></div>';
  }

  function table(b, inh) {
    const head = Array.isArray(b.head) ? b.head : [];
    const minW = Math.max(18, head.length * 7.5);
    const body = (b.rows || []).map(function (raw) {
      const row = rowOf(raw);
      const r = rk(row, inh);
      const cells = (row.cells || []).map(function (c, i) {
        const inner = inline(c) + (i === row.cells.length - 1 ? pillB(r, inh) : '');
        return i === 0 ? '<th scope="row">' + inner + '</th>' : '<td>' + inner + '</td>';
      }).join('');
      return '<tr' + rkAttr(r) + '>' + cells + '</tr>';
    }).join('');
    return (b.caption ? '<p class="f2-btitle">' + inline(b.caption) + '</p>' : '') +
      (head.length >= 4 ? '<p class="f2-scroll">Fais glisser le tableau →</p>' : '') +
      '<div class="f2-table" tabindex="0" role="region" aria-label="' + esc(str(b.caption || 'Tableau').replace(/\*/g, '')) + '">' +
      '<table style="min-width:' + minW + 'rem"><thead><tr>' + head.map(function (x) { return '<th scope="col">' + inline(x) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  const R = {
    points: function (b, r) { return '<ul class="f2-points">' + (b.items || []).map(function (it) { return li(it, r); }).join('') + '</ul>'; },
    steps: function (b, r) {
      return (b.title ? '<p class="f2-btitle">' + inline(b.title) + '</p>' : '') +
        '<ol class="f2-steps">' + (b.items || []).map(function (it, i) {
          const ir = rk(it, r);
          return '<li' + rkAttr(ir) + '><span class="f2-steps__n" aria-hidden="true">' + (i + 1) + '</span><span>' + inline(it.text) + pillB(ir, r) + '</span></li>';
        }).join('') + '</ol>';
    },
    compare: function (b, r) {
      const cols = b.cols || [];
      return (b.title ? '<p class="f2-btitle">' + inline(b.title) + '</p>' : '') +
        '<div class="f2-compare is-' + cols.length + '">' + cols.map(function (c) {
          const cr = childRanks({ items: c.items || [] }, r);
          return '<div class="f2-compare__col"' + rkAttr(cr.length && cr.every(function (x) { return x === 'B'; }) ? 'B' : r, cr.indexOf('B') >= 0) + '>' +
            '<p class="f2-compare__head">' + inline(c.title) + '</p>' +
            '<ul class="f2-points">' + (c.items || []).map(function (it) { return li(it, r); }).join('') + '</ul></div>';
        }).join('') + '</div>';
    },
    table: table,
    explain: function (b, r) { return callout('explain', 'search', b.title || 'Pour comprendre', b, r); },
    trap: function (b, r) { return callout('trap', 'warning', 'Piège', b, r); },
    mnemo: function (b, r) { return callout('mnemo', 'star', 'Astuce', b, r); },
    alert: function (b, r) { return callout('alert', 'warning', 'Urgence / notion inacceptable', b, r); },
    cloze: function (b, r, key) { return cloze(b, key); }
  };

  function block(b, inh, key) {
    const fn = b && R[b.type];
    if (!fn) return '';
    const r = rk(b, inh);
    const kids = childRanks(b, r);
    // conteneur entièrement B dans une partie A → marqué B ; conteneur mixte → visible en filtre B (data-hasb)
    const own = r === 'A' && kids.length && kids.every(function (x) { return x === 'B'; }) ? 'B' : r;
    const src = b.src ? '<p class="f2-src">Collège · ' + esc(b.src) + '</p>' : '';
    return '<div class="f2-block is-' + b.type + '"' + rkAttr(own, hasB(b, r)) + '>' + fn(b, r, key) + src + '</div>';
  }

  function sectionHasB(s) {
    if (s.rank === 'B') return true;
    return (s.blocks || []).some(function (b) { return hasB(b, rk(b, 'A')); });
  }

  /* ---------- assemblage ---------- */

  function sectionHtml(num, s, i, read) {
    const r = s.rank === 'B' ? 'B' : 'A';
    const objs = Array.isArray(s.objectives) ? s.objectives.filter(Boolean) : [];
    const blocks = (s.blocks || []).map(function (b, bi) { return block(b, r, num + ':' + s.id + ':' + bi); }).join('');
    const quiz = objs.length ? '<div class="f2-quiz" data-quiz="' + esc(s.id) + '">' +
      '<p class="f2-quiz__title">' + icon('target') + '<span>Teste-toi sur cette partie</span></p>' +
      '<button type="button" class="btn btn--secondary btn--block" data-qz="start">' + icon('play') + '<span>Mini-quiz · ' + PER_QUIZ + ' questions</span></button>' +
      '<div class="f2-quiz__body" hidden></div>' +
      '<a class="f2-quiz__all" href="' + esc(testUrl(num, objs)) + '">Faire toutes les questions de cette partie →</a></div>' : '';
    return '<details class="f2-sec' + (read ? ' is-read' : '') + '" data-sid="' + esc(s.id) + '"' + rkAttr(r, sectionHasB(s)) + (read ? '' : ' open') + '>' +
      '<summary class="f2-sec__head"><span class="f2-sec__n" aria-hidden="true">' + (i + 1) + '</span>' +
      '<span class="f2-sec__title">' + inline(s.title) + '</span>' +
      '<span class="pill pill--' + r + '">' + r + '</span>' +
      '<span class="f2-sec__done" aria-label="Partie revue">' + icon('check') + '</span>' +
      '<span class="f2-sec__chev" aria-hidden="true">' + icon('chevron-down') + '</span></summary>' +
      '<div class="f2-sec__body">' + blocks +
      (s.src ? '<p class="f2-src">Collège · ' + esc(s.src) + '</p>' : '') + quiz +
      '<button type="button" class="btn btn--outline btn--block f2-read" data-read="' + esc(s.id) + '" aria-pressed="false">' + icon('check') + '<span>J’ai revu cette partie</span></button>' +
      '</div></details>';
  }

  function ficheHtml(num, f) {
    const secs = Array.isArray(f.sections) ? f.sections : [];
    const read = progress(num).read;
    const film = Array.isArray(f.film) ? f.film : [];
    const ess = Array.isArray(f.essentials) ? f.essentials : [];
    const nB = secs.filter(sectionHasB).length;
    const nA = secs.filter(function (s) { return s.rank !== 'B'; }).length;
    return '<header class="f2-head">' +
      '<div class="f2-kicker">Item ' + esc(itemLabel(num)) + ' · cours</div>' +
      '<h1 class="f2-title">' + inline(f.title) + '</h1>' +
      (f.tagline ? '<p class="f2-tagline">' + inline(f.tagline) + '</p>' : '') +
      '<div class="f2-meta"><div class="f2-ring" aria-hidden="true"></div>' +
      '<div class="f2-meta__txt"><p class="f2-meta__line">0 / ' + secs.length + ' parties revues</p>' +
      '<p class="f2-meta__sub">' + secs.length + ' parties · rangs A et B du Collège</p></div></div>' +
      '<a class="btn btn--ghost btn--sm f2-old" href="#/item/' + encodeURIComponent(num) + '/cours?v=1">' + icon('book') + '<span>Ancienne fiche</span></a>' +
      '</header>' +
      (film.length ? '<section class="f2-film" aria-labelledby="f2-film-h"><h2 class="f2-h2" id="f2-film-h">' + icon('play') + '<span>Le film en 1 minute</span></h2>' +
        '<ol class="f2-film__list">' + film.map(function (x, i) {
          const t = typeof x === 'object' && x ? x.text : x;
          return '<li><span class="f2-film__n" aria-hidden="true">' + (i + 1) + '</span><span>' + inline(t) + '</span></li>';
        }).join('') + '</ol></section>' : '') +
      (ess.length ? '<section class="f2-ess" aria-labelledby="f2-ess-h"><h2 class="f2-h2" id="f2-ess-h">' + icon('flash') + '<span>L’essentiel</span></h2>' +
        '<ul class="f2-ess__list">' + ess.map(function (x) {
          const t = typeof x === 'object' && x ? x.text : x;
          const r = typeof x === 'object' && x && x.rank === 'B' ? 'B' : 'A';
          return '<li' + rkAttr(r) + '>' + icon('check') + '<span>' + inline(t) + pillB(r, 'A') + '</span></li>';
        }).join('') + '</ul></section>' : '') +
      '<div class="f2-bar" role="group" aria-label="Filtrer par rang">' +
      '<button type="button" class="chip f2-chip-f" data-rank-f="all" aria-pressed="false">Tout</button>' +
      '<button type="button" class="chip f2-chip-f" data-rank-f="A" aria-pressed="false">Rang A</button>' +
      '<button type="button" class="chip f2-chip-f" data-rank-f="B" aria-pressed="false">Rang B</button>' +
      '<span class="f2-bar__count">' + nA + ' A · ' + nB + ' avec du B</span></div>' +
      '<details class="f2-toc"><summary>' + icon('list') + '<span>Sommaire</span><span class="f2-toc__n">' + secs.length + ' parties</span>' +
      '<span class="f2-sec__chev" aria-hidden="true">' + icon('chevron-down') + '</span></summary><ol>' +
      secs.map(function (s, i) {
        const r = s.rank === 'B' ? 'B' : 'A';
        return '<li' + rkAttr(r, sectionHasB(s)) + '><button type="button" data-toc="' + esc(s.id) + '">' +
          '<span class="f2-toc__i">' + (i + 1) + '</span><span class="f2-toc__t">' + inline(s.title) + '</span>' +
          '<span class="pill pill--' + r + '">' + r + '</span><span class="f2-toc__done" aria-hidden="true">' + icon('check') + '</span></button></li>';
      }).join('') + '</ol></details>' +
      '<div class="f2-secs">' + secs.map(function (s, i) { return sectionHtml(num, s, i, !!read[s.id]); }).join('') +
      '<p class="f2-empty" hidden>Rien à afficher avec ce filtre.</p></div>' +
      '<section class="f2-next" aria-label="Et maintenant">' +
      '<a class="btn btn--primary btn--block btn--lg" href="#/review?mode=item&item=' + encodeURIComponent(num) + '&autostart=1">' + icon('play') + '<span>Tester tout l’item</span></a>' +
      '<a class="btn btn--secondary btn--block" href="#/item/' + encodeURIComponent(num) + '/mnemos">' + icon('star') + '<span>Moyens mnémotechniques</span></a>' +
      '<a class="btn btn--ghost btn--block" href="#/item/' + encodeURIComponent(num) + '/cours?v=1">' + icon('book') + '<span>Ancienne fiche (v1)</span></a>' +
      '</section>';
  }

  function ringSvg(ratio, size, stroke) {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, ratio)));
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--surface-3)" stroke-width="' + stroke + '"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + (ratio >= 1 ? 'var(--ok)' : 'var(--accent)') + '" stroke-width="' + stroke +
      '" stroke-linecap="round" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/></svg>';
  }

  function paint(root, num) {
    const read = progress(num).read;
    const secs = root.querySelectorAll('.f2-sec');
    let done = 0;
    secs.forEach(function (sec) {
      const sid = sec.getAttribute('data-sid');
      const on = !!read[sid];
      if (on) done++;
      sec.classList.toggle('is-read', on);
      const btn = sec.querySelector('.f2-read');
      if (btn) {
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.querySelector('span').textContent = on ? 'Partie revue' : 'J’ai revu cette partie';
      }
      const t = root.querySelector('[data-toc="' + attrq(sid) + '"]');
      if (t) t.classList.toggle('is-read', on);
    });
    const n = secs.length;
    const pct = n ? Math.round(done * 100 / n) : 0;
    const ring = root.querySelector('.f2-ring');
    if (ring) ring.innerHTML = ringSvg(n ? done / n : 0, 56, 6) + '<span class="f2-ring__v">' + pct + '%</span>';
    const line = root.querySelector('.f2-meta__line');
    if (line) line.textContent = done + ' / ' + n + ' parties revues' + (n && done === n ? ' · fiche bouclée' : '');
    return { done: done, n: n };
  }

  function applyFilter(root, v) {
    const page = root.querySelector('.f2');
    page.dataset.rank = v;
    root.querySelectorAll('[data-rank-f]').forEach(function (c) {
      const on = c.getAttribute('data-rank-f') === v;
      c.classList.toggle('is-on', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    let shown = 0;
    root.querySelectorAll('.f2-sec').forEach(function (s) {
      const r = s.getAttribute('data-rk'), b = s.getAttribute('data-hasb') === '1' || r === 'B';
      if (v === 'all' || (v === 'A' && r === 'A') || (v === 'B' && b)) shown++;
    });
    const empty = root.querySelector('.f2-empty');
    if (empty) {
      empty.hidden = shown > 0;
      empty.textContent = v === 'B' ? 'Aucun élément de rang B dans cette fiche.' : 'Rien à afficher avec ce filtre.';
    }
  }

  /* ---------- texte à trous ---------- */

  const Cz = {
    clear: function (box) {
      box.querySelectorAll('.f2-slot').forEach(function (s) { s.classList.remove('is-ok', 'is-bad'); });
      const fb = box.querySelector('.f2-cloze__fb'); fb.textContent = ''; fb.className = 'f2-cloze__fb';
    },
    empty: function (slot) {
      const box = slot.closest('[data-cloze]');
      const id = slot.dataset.chip;
      if (id != null && id !== '') {
        const chip = box.querySelector('.f2-chip[data-chip="' + id + '"]');
        if (chip) { chip.classList.remove('is-used'); chip.disabled = false; }
      }
      delete slot.dataset.chip;
      slot.querySelector('.f2-slot__v').textContent = '';
      slot.classList.remove('is-filled', 'is-ok', 'is-bad', 'is-armed');
      slot.setAttribute('aria-label', 'Trou ' + (Number(slot.dataset.slot) + 1) + ', vide');
    },
    fill: function (slot, chip) {
      const box = slot.closest('[data-cloze]');
      if (slot.dataset.chip != null && slot.dataset.chip !== '') Cz.empty(slot);
      slot.dataset.chip = chip.dataset.chip;
      slot.querySelector('.f2-slot__v').textContent = chip.dataset.value;
      slot.classList.add('is-filled');
      slot.setAttribute('aria-label', 'Trou ' + (Number(slot.dataset.slot) + 1) + ' : ' + chip.dataset.value + '. Toucher pour vider.');
      chip.classList.add('is-used'); chip.setAttribute('aria-pressed', 'false'); chip.disabled = true;
      box.classList.remove('is-picking');
    },
    check: function (box) {
      const slots = box.querySelectorAll('.f2-slot');
      let ok = 0;
      slots.forEach(function (s) {
        const accept = JSON.parse(s.dataset.accept || '[]');
        const v = norm(s.querySelector('.f2-slot__v').textContent);
        const good = !!v && accept.indexOf(v) >= 0;
        if (good) ok++;
        s.classList.toggle('is-ok', good); s.classList.toggle('is-bad', !good);
      });
      const fb = box.querySelector('.f2-cloze__fb');
      const all = ok === slots.length;
      fb.className = 'f2-cloze__fb ' + (all ? 'is-ok' : 'is-bad');
      fb.textContent = all ? 'Juste. Tout est à sa place.' : ok + ' / ' + slots.length + ' : corrige les trous en rouge.';
    },
    reveal: function (box) {
      box.querySelectorAll('.f2-slot').forEach(function (s) {
        Cz.empty(s);
        const accept = JSON.parse(s.dataset.accept || '[]');
        const chip = Array.prototype.find.call(box.querySelectorAll('.f2-chip:not(.is-used)'), function (c) { return accept.indexOf(norm(c.dataset.value)) >= 0; });
        if (chip) Cz.fill(s, chip);
      });
      Cz.check(box);
    },
    reset: function (box) {
      box.querySelectorAll('.f2-slot').forEach(Cz.empty);
      box.querySelectorAll('.f2-chip').forEach(function (c) { c.setAttribute('aria-pressed', 'false'); });
      box.classList.remove('is-picking');
      Cz.clear(box);
    },
    click: function (e, box) {
      const chip = e.target.closest('.f2-chip');
      const slot = e.target.closest('.f2-slot');
      const act = e.target.closest('[data-cz]');
      if (chip && !chip.disabled) {
        const armed = box.querySelector('.f2-slot.is-armed');
        if (armed) { armed.classList.remove('is-armed'); Cz.clear(box); Cz.fill(armed, chip); return; }
        const on = chip.getAttribute('aria-pressed') === 'true';
        box.querySelectorAll('.f2-chip').forEach(function (c) { c.setAttribute('aria-pressed', 'false'); });
        chip.setAttribute('aria-pressed', on ? 'false' : 'true');
        box.classList.toggle('is-picking', !on);
      } else if (slot) {
        Cz.clear(box);
        const sel = box.querySelector('.f2-chip[aria-pressed="true"]');
        if (sel) Cz.fill(slot, sel);
        else if (slot.classList.contains('is-filled')) Cz.empty(slot);
        else {
          box.querySelectorAll('.f2-slot.is-armed').forEach(function (s) { s.classList.remove('is-armed'); });
          slot.classList.add('is-armed');
        }
      } else if (act) {
        const a = act.getAttribute('data-cz');
        if (a === 'check') Cz.check(box); else if (a === 'reveal') Cz.reveal(box); else Cz.reset(box);
      }
    }
  };

  function bindDrag(root) {
    let dragged = null;
    root.addEventListener('dragstart', function (e) {
      const chip = e.target.closest && e.target.closest('.f2-chip');
      if (!chip || chip.disabled) return;
      dragged = chip;
      try { e.dataTransfer.setData('text/plain', chip.dataset.value); e.dataTransfer.effectAllowed = 'move'; } catch (err) { /* ignore */ }
    });
    root.addEventListener('dragend', function () { dragged = null; root.querySelectorAll('.f2-slot.is-over').forEach(function (s) { s.classList.remove('is-over'); }); });
    root.addEventListener('dragover', function (e) {
      const slot = e.target.closest && e.target.closest('.f2-slot');
      if (!slot || !dragged || slot.closest('[data-cloze]') !== dragged.closest('[data-cloze]')) return;
      e.preventDefault();
      slot.classList.add('is-over');
    });
    root.addEventListener('dragleave', function (e) { const slot = e.target.closest && e.target.closest('.f2-slot'); if (slot) slot.classList.remove('is-over'); });
    root.addEventListener('drop', function (e) {
      const slot = e.target.closest && e.target.closest('.f2-slot');
      if (!slot || !dragged) return;
      e.preventDefault();
      slot.classList.remove('is-over');
      const box = slot.closest('[data-cloze]');
      if (box !== dragged.closest('[data-cloze]')) return;
      Cz.clear(box);
      Cz.fill(slot, dragged);
      dragged = null;
    });
  }

  /* ---------- mini-quiz de fin de partie ---------- */

  function makeQuiz(num, fiche, getFilter) {
    const secById = {};
    (fiche.sections || []).forEach(function (s) { secById[s.id] = s; });
    const state = {};   // par partie : {pool, ids, pos, picked, revealed, results, seen, t0}

    function store() { return CARDIO.store || null; }
    function reps(id) { try { const s = store(); const c = s && typeof s.card === 'function' ? s.card(id) : null; return c && c.reps ? c.reps : 0; } catch (e) { return 0; } }
    function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

    function poolOf(content, sec) {
      const objs = sec.objectives || [];
      const f = getFilter();
      const qs = (content && Array.isArray(content.questions) ? content.questions : []).filter(function (q) {
        return objs.indexOf(q.objective) >= 0 && (q.type === 'QRU' || q.type === 'QRM' || q.type === 'QROC') &&
          (f !== 'A' || q.rank !== 'B') && (f !== 'B' || q.rank === 'B');
      });
      // QCM d'abord (correction automatique), jamais vues d'abord, ordre aléatoire à rang égal
      return shuffle(qs).sort(function (a, b) {
        // puis, dans une partie A, les questions de rang A avant celles de rang B
        function key(q) { return (q.type === 'QROC' ? 4 : 0) + (reps(q.id) ? 2 : 0) + (sec.rank !== 'B' && q.rank === 'B' ? 1 : 0); }
        return key(a) - key(b);
      });
    }

    function load() {
      const r = registry();
      const c = typeof r.content === 'function' ? r.content(num) : null;
      if (c) return Promise.resolve(c);
      if (typeof r.load !== 'function') return Promise.reject(new Error('registre absent'));
      return r.load(num);
    }

    function record(q, score, ms) {
      try {
        const s = store();
        const r = registry();
        const kind = (typeof r.kindOfId === 'function' && r.kindOfId(q.id)) || (q.type === 'QROC' ? 'qroc' : 'qcm');
        if (s && typeof s.recordAttempt === 'function') s.recordAttempt({ cardId: q.id, item: num, kind: kind, score: score, ms: ms });
      } catch (e) { console.warn('[fiche2] recordAttempt', e); }
    }

    function qHtml(q, st) {
      const head = '<p class="f2-quiz__count">Question ' + (st.pos + 1) + ' / ' + st.ids.length + ' · ' +
        (q.type === 'QRM' ? 'plusieurs réponses possibles' : q.type === 'QRU' ? 'une seule réponse' : 'réponse courte') +
        (q.rank === 'B' ? ' <span class="pill pill--B f2-b">B</span>' : '') + '</p>';
      if (q.type === 'QROC') {
        return head + '<p class="f2-quiz__stem">' + inline(q.question || q.stem) + '</p>' +
          '<div class="f2-quiz__fb"></div>' +
          '<div class="f2-quiz__actions"><button type="button" class="btn btn--primary" data-qz="show">Voir la réponse</button></div>';
      }
      return head + '<p class="f2-quiz__stem">' + inline(q.stem) + '</p>' +
        '<div class="f2-quiz__opts" role="group" aria-label="Propositions">' + (q.options || []).map(function (o, i) {
          return '<button type="button" class="f2-opt" data-opt="' + i + '" aria-pressed="false"><span class="f2-opt__k">' + LETTERS[i] + '</span>' +
            '<span class="f2-opt__t">' + inline(o.t) + '</span><span class="f2-opt__why" hidden></span></button>';
        }).join('') + '</div>' +
        '<div class="f2-quiz__fb"></div>' +
        '<div class="f2-quiz__actions"><button type="button" class="btn btn--primary" data-qz="validate" disabled>Valider</button></div>';
    }

    function endHtml(sec, st) {
      const ok = st.results.reduce(function (a, b) { return a + b; }, 0);
      const n = st.results.length;
      const more = st.pool.filter(function (q) { return !st.seen[q.id]; }).length;
      const score = Math.round(ok * 10) / 10;
      const msg = ok >= n ? 'Parfait, cette partie est acquise.' : ok === 0 ? 'Relis la partie puis réessaie : c’est comme ça que ça rentre.' : 'Bien. Les erreurs reviendront dans tes révisions.';
      return '<div class="f2-quiz__end"><p class="f2-quiz__score"><strong>' + String(score).replace('.', ',') + ' / ' + n + '</strong></p>' +
        '<p class="f2-quiz__msg">' + msg + '</p><div class="f2-quiz__actions">' +
        (more ? '<button type="button" class="btn btn--primary" data-qz="again">' + Math.min(PER_QUIZ, more) + ' autre' + (Math.min(PER_QUIZ, more) > 1 ? 's' : '') + ' question' + (Math.min(PER_QUIZ, more) > 1 ? 's' : '') + '</button>' : '') +
        '<button type="button" class="btn btn--ghost" data-qz="restart">Recommencer</button></div></div>';
    }

    function show(box, sec) {
      const st = state[sec.id];
      const body = box.querySelector('.f2-quiz__body');
      if (st.pos >= st.ids.length) { body.innerHTML = endHtml(sec, st); return; }
      const q = st.byId[st.ids[st.pos]];
      st.picked = {}; st.revealed = false; st.t0 = Date.now();
      body.innerHTML = qHtml(q, st);
    }

    function start(box, sec, fresh) {
      const btn = box.querySelector('[data-qz="start"]');
      const body = box.querySelector('.f2-quiz__body');
      if (btn) btn.disabled = true;
      load().then(function (content) {
        const st = state[sec.id] && !fresh ? state[sec.id] : (state[sec.id] = { seen: {} });
        if (!st.pool || fresh) st.pool = poolOf(content, sec);
        st.byId = {};
        st.pool.forEach(function (q) { st.byId[q.id] = q; });
        let ids = st.pool.filter(function (q) { return !st.seen[q.id]; }).map(function (q) { return q.id; });
        if (!ids.length) { st.seen = {}; ids = st.pool.map(function (q) { return q.id; }); }
        st.ids = ids.slice(0, PER_QUIZ);
        st.pos = 0; st.results = [];
        if (btn) btn.hidden = true;
        body.hidden = false;
        if (!st.ids.length) {
          body.innerHTML = '<p class="f2-quiz__msg">Pas encore de question de l’appli liée à cette partie' + (getFilter() !== 'all' ? ' pour ce rang' : '') + '.</p>';
          return;
        }
        show(box, sec);
      }, function () {
        if (btn) btn.disabled = false;
        body.hidden = false;
        body.innerHTML = '<p class="f2-quiz__msg">Questions indisponibles pour le moment. Réessaie.</p>';
      });
    }

    function validate(box, sec) {
      const st = state[sec.id];
      const q = st.byId[st.ids[st.pos]];
      let discord = 0, good = 0, bad = 0;
      box.querySelectorAll('.f2-opt').forEach(function (b) {
        const o = q.options[Number(b.getAttribute('data-opt'))] || {};
        const picked = !!st.picked[b.getAttribute('data-opt')];
        const ok = !!o.ok;
        if (ok !== picked) discord++;
        if (ok && picked) good++;
        if (!ok && picked) bad++;
        b.classList.add(ok ? (picked ? 'is-correct' : 'is-missed') : picked ? 'is-wrong' : 'is-neutral');
        b.disabled = true;
        const why = b.querySelector('.f2-opt__why');
        if (o.why) { why.innerHTML = '<strong>' + (ok ? 'Vrai' : 'Faux') + '</strong> · ' + inline(o.why); why.hidden = false; }
      });
      const score = q.type === 'QRU' ? (discord === 0 ? 1 : 0) : discord === 0 ? 1 : discord === 1 ? 0.5 : 0;
      const tone = score === 1 ? 'ok' : score > 0 ? 'warn' : 'bad';
      const fb = box.querySelector('.f2-quiz__fb');
      fb.className = 'f2-quiz__fb is-' + tone;
      fb.innerHTML = '<p class="f2-quiz__verdict">' + (score === 1 ? 'Juste.' : score > 0 ? 'Presque : une seule discordance.' : 'À retravailler.') +
        ' <span>' + good + ' bonne' + (good > 1 ? 's' : '') + ' cochée' + (good > 1 ? 's' : '') + (bad ? ', ' + bad + ' fausse' + (bad > 1 ? 's' : '') : '') + '</span></p>' +
        (q.explanation ? '<p class="f2-quiz__expl">' + inline(q.explanation) + '</p>' : '') +
        (q.src ? '<p class="f2-src">Collège · ' + esc(q.src) + '</p>' : '');
      finishQ(box, st, q, score);
    }

    function showQroc(box, sec) {
      const st = state[sec.id];
      const q = st.byId[st.ids[st.pos]];
      const fb = box.querySelector('.f2-quiz__fb');
      fb.className = 'f2-quiz__fb is-info';
      fb.innerHTML = '<p class="f2-quiz__verdict">Réponse : <strong>' + esc(q.answer) + '</strong></p>' +
        (q.explanation ? '<p class="f2-quiz__expl">' + inline(q.explanation) + '</p>' : '') +
        (q.src ? '<p class="f2-src">Collège · ' + esc(q.src) + '</p>' : '');
      box.querySelector('.f2-quiz__actions').innerHTML =
        '<button type="button" class="btn btn--ok" data-qz="knew">Je savais</button>' +
        '<button type="button" class="btn btn--outline" data-qz="missed">À revoir</button>';
    }

    function finishQ(box, st, q, score) {
      st.results.push(score);
      st.seen[q.id] = true;
      st.revealed = true;
      record(q, score, Date.now() - (st.t0 || Date.now()));
      box.querySelector('.f2-quiz__actions').innerHTML = '<button type="button" class="btn btn--primary" data-qz="next">' +
        (st.pos + 1 < st.ids.length ? 'Suivante' : 'Voir le bilan') + '</button>';
    }

    function click(e, box) {
      const sec = secById[box.getAttribute('data-quiz')];
      if (!sec) return;
      const st = state[sec.id];
      const opt = e.target.closest('.f2-opt');
      const act = e.target.closest('[data-qz]');
      if (opt && st && !st.revealed && !opt.disabled) {
        const q = st.byId[st.ids[st.pos]];
        const k = opt.getAttribute('data-opt');
        if (q.type === 'QRU') {
          st.picked = {};
          box.querySelectorAll('.f2-opt').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
        }
        st.picked[k] = !st.picked[k];
        opt.setAttribute('aria-pressed', st.picked[k] ? 'true' : 'false');
        const v = box.querySelector('[data-qz="validate"]');
        if (v) v.disabled = !Object.keys(st.picked).some(function (x) { return st.picked[x]; });
        return;
      }
      if (!act) return;
      const a = act.getAttribute('data-qz');
      if (a === 'start' || a === 'again') start(box, sec, false);
      else if (a === 'restart') start(box, sec, true);
      else if (a === 'validate') validate(box, sec);
      else if (a === 'show') showQroc(box, sec);
      else if (a === 'knew' || a === 'missed') {
        const q = st.byId[st.ids[st.pos]];
        const fb = box.querySelector('.f2-quiz__fb');
        fb.className = 'f2-quiz__fb is-' + (a === 'knew' ? 'ok' : 'bad');
        finishQ(box, st, q, a === 'knew' ? 1 : 0);
      } else if (a === 'next') {
        st.pos++;
        show(box, sec);
        const first = box.querySelector('.f2-quiz__body button');
        if (first) { try { first.focus({ preventScroll: true }); } catch (err) { /* ignore */ } }
        const top = box.querySelector('.f2-quiz__body');
        if (top && top.getBoundingClientRect().top < 60) top.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
      }
    }

    return { click: click };
  }

  /* ---------- styles (tokens uniquement) ---------- */

  const CSS = [
    '.f2{padding-bottom:24px}',
    '.f2 .icon{width:18px;height:18px;flex:0 0 auto}',
    '.f2-head{display:grid;gap:4px}',
    '.f2-kicker{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}',
    '.f2-title{font:700 1.5rem/1.15 var(--font-display);margin:0;text-wrap:balance}',
    '.f2-tagline{margin:2px 0 0;color:var(--ink-2);line-height:1.5}',
    '.f2-meta{display:flex;align-items:center;gap:12px;margin-top:10px}',
    '.f2-ring{position:relative;flex:0 0 56px;width:56px;height:56px;display:grid;place-items:center}',
    '.f2-ring svg{position:absolute;inset:0}',
    '.f2-ring__v{position:relative;font:700 .8125rem/1 var(--font-display);font-variant-numeric:tabular-nums}',
    '.f2-meta__line{margin:0;font-weight:600}',
    '.f2-meta__sub{margin:2px 0 0;font-size:.8125rem;color:var(--muted)}',
    '.f2-old{justify-self:start;margin-top:4px;display:inline-flex;align-items:center;gap:6px}',
    '.f2-h2{display:flex;align-items:center;gap:8px;margin:0 0 10px;font:700 1.125rem/1.25 var(--font-display)}',
    '.f2-film,.f2-ess{background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1);padding:14px 16px}',
    '.f2-film .f2-h2{color:var(--accent)}',
    '.f2-film__list{list-style:none;margin:0;padding:0;display:grid;gap:0;position:relative}',
    '.f2-film__list li{display:flex;gap:10px;align-items:flex-start;line-height:1.45;padding:0 0 10px;position:relative}',
    '.f2-film__list li:last-child{padding-bottom:0}',
    '.f2-film__list li:not(:last-child)::before{content:"";position:absolute;left:12px;top:26px;bottom:2px;width:2px;background:var(--accent-soft)}',
    '.f2-film__n{flex:0 0 26px;height:26px;display:grid;place-items:center;border-radius:50%;background:var(--accent);color:var(--accent-ink);font:700 .8125rem/1 var(--font-display);position:relative}',
    '.f2-film__list li>span:last-child{padding-top:3px}',
    '.f2-ess .f2-h2{color:var(--blue)}',
    '.f2-ess__list{list-style:none;margin:0;padding:0;display:grid;gap:8px}',
    '.f2-ess__list li{display:flex;gap:8px;line-height:1.45}',
    '.f2-ess__list li>.icon{color:var(--ok);margin-top:2px}',
    '.f2-bar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:6px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin-inline:calc(-1 * var(--gutter));padding:8px var(--gutter);background:var(--bg);border-bottom:1px solid var(--line)}',
    '.f2-bar::-webkit-scrollbar{display:none}',
    '.f2-bar .chip{flex:0 0 auto;min-height:36px}',
    '.f2-bar__count{margin-left:auto;flex:0 0 auto;font-size:.75rem;color:var(--muted);white-space:nowrap;padding-left:6px}',
    '.f2-toc{background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1)}',
    '.f2-toc>summary{display:flex;align-items:center;gap:8px;padding:12px 14px;min-height:44px;font-weight:600;cursor:pointer;list-style:none}',
    '.f2-toc>summary::-webkit-details-marker{display:none}',
    '.f2-toc__n{margin-left:auto;font-size:.75rem;font-weight:500;color:var(--muted)}',
    '.f2-toc ol{list-style:none;margin:0;padding:0 6px 8px}',
    '.f2-toc button{display:flex;align-items:center;gap:8px;width:100%;min-height:44px;padding:6px 8px;border:0;background:none;border-radius:var(--r-s);color:var(--ink);font:inherit;text-align:left;cursor:pointer}',
    '.f2-toc button:hover{background:var(--surface-2)}',
    '.f2-toc__i{flex:0 0 22px;font:700 .8125rem var(--font-display);color:var(--muted)}',
    '.f2-toc__t{flex:1;min-width:0;font-size:.9375rem;line-height:1.3}',
    '.f2-toc__done{display:none;color:var(--ok)}',
    '.f2-toc button.is-read .f2-toc__done{display:inline-flex}',
    '.f2-toc button.is-read .f2-toc__t{color:var(--muted)}',
    '.f2-secs{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}',
    '.f2-sec{background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1);scroll-margin-top:64px;min-width:0}',
    '.f2-sec[data-rk="B"]{border-left:3px solid var(--rankB)}',
    '.f2-sec__head{display:flex;align-items:center;gap:10px;padding:14px;min-height:44px;cursor:pointer;list-style:none}',
    '.f2-sec__head::-webkit-details-marker{display:none}',
    '.f2-sec__head:focus-visible{outline:2px solid var(--blue);outline-offset:-2px;border-radius:var(--r-m)}',
    '.f2-sec__n{flex:0 0 28px;height:28px;display:grid;place-items:center;border-radius:50%;background:var(--accent-soft);color:var(--accent);font:700 .875rem/1 var(--font-display)}',
    '.f2-sec.is-read .f2-sec__n{background:var(--ok-soft);color:var(--ok)}',
    '.f2-sec__title{flex:1;min-width:0;font:700 1.0625rem/1.3 var(--font-display);overflow-wrap:anywhere}',
    '.f2-sec__done{display:none;color:var(--ok)}',
    '.f2-sec.is-read .f2-sec__done{display:inline-flex}',
    '.f2-sec__chev{display:inline-flex;color:var(--muted);transition:transform .2s var(--ease)}',
    'details[open]>summary .f2-sec__chev{transform:rotate(180deg)}',
    '.f2-sec__body{padding:0 14px 14px;display:grid;grid-template-columns:minmax(0,1fr);gap:12px}',
    '.f2-block{min-width:0}',
    '.f2-btitle{display:flex;align-items:center;gap:6px;margin:0 0 6px;font-weight:700;font-size:.9375rem;color:var(--ink-2)}',
    '.f2-src{margin:6px 0 0;font-size:.75rem;color:var(--muted)}',
    '.f2-b{font-size:.625rem;padding:1px 6px;vertical-align:.1em;margin-left:2px}',
    '.f2-points{margin:0;padding-left:20px;display:grid;gap:6px;line-height:1.55}',
    '.f2-points li::marker{color:var(--accent)}',
    '.f2-sub{margin:4px 0 0;padding-left:18px;display:grid;gap:3px;color:var(--ink-2);font-size:.9375em}',
    '.f2-steps{list-style:none;margin:0;padding:0;display:grid;gap:8px}',
    '.f2-steps li{display:flex;gap:10px;align-items:flex-start;line-height:1.5}',
    '.f2-steps__n{flex:0 0 24px;height:24px;display:grid;place-items:center;border-radius:50%;border:1.5px solid var(--accent);color:var(--accent);font-weight:700;font-size:.75rem;margin-top:1px}',
    '.f2-call{border-radius:var(--r-s);padding:10px 12px;border-left:4px solid}',
    '.f2-call__head{display:flex;align-items:center;gap:6px;margin:0 0 4px;font-weight:700}',
    '.f2-call__body p{margin:0 0 8px;line-height:1.55}',
    '.f2-call__body p:last-child{margin-bottom:0}',
    '.f2-call.is-explain{background:var(--info-soft);border-color:var(--info)}',
    '.f2-call.is-explain .f2-call__head{color:var(--info)}',
    '.f2-call.is-trap{background:var(--warn-soft);border-color:var(--warn)}',
    '.f2-call.is-trap .f2-call__head{color:var(--warn)}',
    '.f2-call.is-mnemo{background:var(--surface-2);border-color:var(--ink-2)}',
    '.f2-call.is-mnemo .f2-call__head{color:var(--ink)}',
    '.f2-call.is-alert{background:var(--bad-soft);border-color:var(--bad)}',
    '.f2-call.is-alert .f2-call__head{color:var(--bad)}',
    '.f2-scroll{margin:0 0 4px;font-size:.75rem;color:var(--muted)}',
    '@media (min-width:720px){.f2-scroll{display:none}}',
    '.f2-table{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:var(--r-s);max-width:100%}',
    '.f2-table:focus-visible{outline:2px solid var(--blue);outline-offset:2px}',
    '.f2-table table{width:100%;border-collapse:collapse;font-size:.875rem}',
    '.f2-table th,.f2-table td{padding:8px 10px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line);line-height:1.45}',
    '.f2-table thead th{background:var(--surface-2);font-size:.75rem;color:var(--ink-2);white-space:nowrap}',
    '.f2-table tbody th{font-weight:600}',
    '.f2-table tbody tr:last-child>*{border-bottom:0}',
    '.f2-compare{display:grid;gap:8px}',
    '@media (min-width:560px){.f2-compare.is-2{grid-template-columns:repeat(2,minmax(0,1fr))}.f2-compare.is-3{grid-template-columns:repeat(3,minmax(0,1fr))}}',
    '.f2-compare__col{border:1px solid var(--line);border-radius:var(--r-s);padding:10px 12px;background:var(--surface-2);min-width:0}',
    '.f2-compare__head{margin:0 0 6px;font:700 1rem/1.25 var(--font-display);color:var(--blue)}',
    /* texte à trous */
    '.f2-cloze{border:1.5px dashed var(--line);border-radius:var(--r-s);padding:12px}',
    '.f2-cloze__hint{margin:0 0 8px;font-size:.8125rem;color:var(--muted)}',
    '.f2-cloze__text{margin:0 0 10px;line-height:2.2}',
    '.f2-slot{display:inline-flex;align-items:center;justify-content:center;min-width:5.5rem;min-height:30px;padding:0 8px;margin:0 2px;vertical-align:middle;border:1.5px dashed var(--muted);border-radius:6px;background:var(--surface-2);font:inherit;font-weight:600;color:var(--ink);cursor:pointer;max-width:100%;overflow-wrap:anywhere}',
    '.f2-cloze.is-picking .f2-slot:not(.is-filled),.f2-slot.is-armed,.f2-slot.is-over{border-color:var(--accent);background:var(--accent-soft)}',
    '.f2-slot.is-filled{border-style:solid;border-color:var(--blue);background:var(--surface)}',
    '.f2-slot.is-ok{border-color:var(--ok);background:var(--ok-soft);color:var(--ok)}',
    '.f2-slot.is-bad{border-color:var(--bad);background:var(--bad-soft);color:var(--bad)}',
    '.f2-bank{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}',
    '.f2-chip{min-height:36px;padding:4px 12px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font:inherit;font-size:.875rem;cursor:grab;max-width:100%}',
    '.f2-chip[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}',
    '.f2-chip.is-used{opacity:.35;cursor:default}',
    '.f2-cloze__actions,.f2-quiz__actions{display:flex;flex-wrap:wrap;gap:6px}',
    '.f2-cloze__fb{margin:8px 0 0;font-weight:600;min-height:1.2em}',
    '.f2-cloze__fb.is-ok{color:var(--ok)}.f2-cloze__fb.is-bad{color:var(--bad)}',
    /* mini-quiz */
    '.f2-quiz{border-top:1px dashed var(--line);padding-top:12px;display:grid;gap:10px}',
    '.f2-quiz__title{display:flex;align-items:center;gap:6px;margin:0;font-weight:700;color:var(--ink-2);font-size:.9375rem}',
    '.f2-quiz .btn .icon{margin-right:6px}',
    '.f2-quiz__all{font-size:.875rem;font-weight:600}',
    '.f2-quiz__body{display:grid;gap:10px}',
    '.f2-quiz__count{margin:0;font-size:.8125rem;font-weight:600;color:var(--muted)}',
    '.f2-quiz__stem{margin:0;font-weight:600;line-height:1.5}',
    '.f2-quiz__opts{display:grid;gap:6px}',
    '.f2-opt{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start;gap:2px 10px;width:100%;min-height:48px;padding:10px 12px;text-align:left;border:1px solid var(--line);border-radius:var(--r-s);background:var(--surface);font:inherit;color:var(--ink);cursor:pointer}',
    '.f2-opt:hover:not(:disabled){border-color:var(--muted)}',
    '.f2-opt__k{display:grid;place-items:center;width:26px;height:26px;border-radius:6px;background:var(--surface-2);color:var(--ink-2);font:600 .8125rem var(--font-mono)}',
    '.f2-opt__t{line-height:1.45;padding-top:2px}',
    '.f2-opt__why{grid-column:2;margin-top:4px;font-size:.875rem;color:var(--ink-2);line-height:1.45}',
    '.f2-opt[aria-pressed="true"]{border-color:var(--blue);background:var(--blue-soft)}',
    '.f2-opt[aria-pressed="true"] .f2-opt__k{background:var(--blue);color:var(--surface)}',
    '.f2-opt:disabled{cursor:default}',
    '.f2-opt.is-correct{border-color:var(--ok);background:var(--ok-soft)}',
    '.f2-opt.is-correct .f2-opt__k{background:var(--ok);color:var(--surface)}',
    '.f2-opt.is-wrong{border-color:var(--bad);background:var(--bad-soft)}',
    '.f2-opt.is-wrong .f2-opt__k{background:var(--bad);color:var(--surface)}',
    '.f2-opt.is-missed{border-color:var(--ok);border-style:dashed}',
    '.f2-opt.is-missed .f2-opt__k{background:var(--ok-soft);color:var(--ok)}',
    '.f2-opt.is-neutral{opacity:.8}',
    '.f2-quiz__fb:empty{display:none}',
    '.f2-quiz__fb{border-radius:var(--r-s);padding:10px 12px;display:grid;gap:6px}',
    '.f2-quiz__fb p{margin:0;line-height:1.5}',
    '.f2-quiz__fb.is-ok{background:var(--ok-soft)}.f2-quiz__fb.is-ok .f2-quiz__verdict{color:var(--ok)}',
    '.f2-quiz__fb.is-warn{background:var(--warn-soft)}.f2-quiz__fb.is-warn .f2-quiz__verdict{color:var(--warn)}',
    '.f2-quiz__fb.is-bad{background:var(--bad-soft)}.f2-quiz__fb.is-bad .f2-quiz__verdict{color:var(--bad)}',
    '.f2-quiz__fb.is-info{background:var(--info-soft)}',
    '.f2-quiz__verdict{font-weight:700}.f2-quiz__verdict span{font-weight:500;font-size:.8125rem;color:var(--ink-2)}',
    '.f2-quiz__expl{font-size:.9375rem;color:var(--ink-2)}',
    '.f2-quiz__end{display:grid;gap:6px}',
    '.f2-quiz__score{margin:0;font:700 1.375rem/1.2 var(--font-display)}',
    '.f2-quiz__msg{margin:0;color:var(--ink-2)}',
    '.f2-read{display:inline-flex;align-items:center;justify-content:center;gap:6px}',
    '.f2-read[aria-pressed="true"]{background:var(--ok-soft);color:var(--ok);border-color:var(--ok)}',
    '.f2-next{display:grid;gap:8px}',
    '.f2-next .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px}',
    '.f2-empty{color:var(--muted);text-align:center;padding:16px 0;margin:0}',
    '.f2-v1bar{padding-bottom:0}',
    '.f2-v1bar .btn{display:flex;align-items:center;justify-content:center;gap:8px}',
    /* filtre de rang : A masque le B ; B masque le A sauf les conteneurs qui ont du B */
    '.f2[data-rank="A"] [data-rk="B"]{display:none}',
    '.f2[data-rank="B"] .f2-secs [data-rk="A"]:not([data-hasb="1"]),.f2[data-rank="B"] .f2-toc [data-rk="A"]:not([data-hasb="1"]),.f2[data-rank="B"] .f2-ess [data-rk="A"]{display:none}',
    '.f2[data-rank="B"] .f2-block.is-cloze{display:none}',
    '@media (prefers-reduced-motion:reduce){.f2-sec__chev{transition:none}}'
  ].join('\n');

  function ensureStyles() {
    if (document.getElementById('fiche2-view-css')) return;
    const s = document.createElement('style');
    s.id = 'fiche2-view-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------- rendu ---------- */

  function renderV1(params, query, num) {
    const course = CARDIO.views.course;
    const inner = course && typeof course.render === 'function' ? course.render(params, query) : h('div', { class: 'page' }, 'Fiche indisponible.');
    if (!data(num)) return inner;
    ensureStyles();
    return h('div', {},
      h('div', { class: 'page f2-v1bar' },
        h('a', { class: 'btn btn--secondary btn--sm btn--block', href: '#/item/' + encodeURIComponent(num) + '/cours', html: icon('flash') + '<span>Nouvelle fiche disponible : ouvrir la v2</span>' })),
      inner);
  }

  function render(params, query) {
    const num = str(params && (params.num || params.item));
    const q = query || {};
    const f = data(num);
    if (!f || str(q.v) === '1') return renderV1(params, query, num);
    ensureStyles();

    const root = h('div', { class: 'view-fiche2' });
    const page = h('div', { class: 'page f2', dataset: { rank: 'all' } });
    page.innerHTML = ficheHtml(num, f);
    root.appendChild(page);

    let filter = lsGet(LS_RANK, 'all');
    if (['all', 'A', 'B'].indexOf(filter) < 0) filter = 'all';
    applyFilter(root, filter);
    paint(root, num);
    const quiz = makeQuiz(num, f, function () { return filter; });

    root.addEventListener('click', function (e) {
      const cz = e.target.closest('[data-cloze]');
      if (cz) { Cz.click(e, cz); return; }
      const qz = e.target.closest('[data-quiz]');
      if (qz) { quiz.click(e, qz); return; }
      const fb = e.target.closest('[data-rank-f]');
      if (fb) { filter = fb.getAttribute('data-rank-f'); lsSet(LS_RANK, filter); applyFilter(root, filter); return; }
      const toc = e.target.closest('[data-toc]');
      if (toc) {
        const sec = root.querySelector('.f2-sec[data-sid="' + attrq(toc.getAttribute('data-toc')) + '"]');
        if (sec) { sec.open = true; sec.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }); }
        return;
      }
      const rd = e.target.closest('[data-read]');
      if (rd) {
        const sid = rd.getAttribute('data-read');
        const on = !progress(num).read[sid];
        setRead(num, sid, on);
        const st = paint(root, num);
        if (on) {
          const sec = rd.closest('.f2-sec');
          let next = sec && sec.nextElementSibling;
          while (next && (!next.classList.contains('f2-sec') || next.offsetParent === null)) next = next.nextElementSibling;
          if (sec) sec.open = false;
          if (next) { next.open = true; next.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }); }
          else if (sec) sec.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
          if (st.n && st.done === st.n) {
            try { CARDIO.shell && CARDIO.shell.toast && CARDIO.shell.toast('Fiche bouclée. Passe aux questions pour ancrer.', { tone: 'ok' }); } catch (err) { /* ignore */ }
          }
        }
      }
    });
    bindDrag(root);
    return root;
  }

  CARDIO.views.fiche2 = { render: render, available: function (num) { return !!data(num); } };
})();
