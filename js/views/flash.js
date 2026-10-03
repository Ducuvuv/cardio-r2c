/* CardioR2C — views/flash.js
 * Fiches flash : le BABA de chaque item, modèle « R2C RANG A & B FONDAMENTAL » en 7 blocs fixes
 * (docs/FLASH.md).
 *   #/flash             liste des 22 items par partie + statut (non lue / lue / dernier test / maîtrisée)
 *   #/item/:num/flash   la fiche : « Lire » (tout visible) ou « Me tester » (rappel actif champ par champ ;
 *                       résultat enregistré dans state.itemStats[num].flash = {at, score, runs}).
 * Contenu : CARDIO.registry.load(num) → content.flash ({id, src, sections}) ou null (pas encore écrite).
 * Script classique ES2020 ; appels aux autres modules uniquement à l'exécution, dégradation propre.
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  CARDIO.views = CARDIO.views || {};

  const MASTERED = 0.8;                       // score du dernier test à partir duquel la fiche est « maîtrisée »
  const LS_SEEN = 'cardio.r2c.flash.seen';    // fiches ouvertes (commodité locale, non critique)
  const NBSP = ' ';
  const KEY_ORDER = ['identite', 'pattern', 'gravite', 'paraclinique', 'orientation', 'traitement', 'securite'];
  const DEFAULT_TITLES = {
    identite: 'Carte d’identité flash', pattern: 'Le pattern de reconnaissance', gravite: 'Le tri vital & la gravité',
    paraclinique: 'Le paraclinique de certitude', orientation: 'L’aiguillage clinique',
    traitement: 'Le pack thérapeutique de 1re intention', securite: 'Les fautes graves & la sécurité'
  };

  /* ---------- Accès défensif aux modules ---------- */

  function util() { return CARDIO.util || {}; }
  function store() { return CARDIO.store || null; }
  function registry() { return CARDIO.registry || null; }
  function shell() { return CARDIO.shell || null; }

  function flat(list, out) {
    out = out || [];
    list.forEach(function (c) {
      if (c === null || c === undefined || c === false || c === true) return;
      if (Array.isArray(c)) flat(c, out); else out.push(c);
    });
    return out;
  }

  function fallbackH(tag, attrs, kids) {
    const el = document.createElement(tag);
    const a = attrs || {};
    Object.keys(a).forEach(function (k) {
      const v = a[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.keys(v).forEach(function (d) { el.dataset[d] = v[d]; });
      else if (k === 'on') Object.keys(v).forEach(function (e) { el.addEventListener(e, v[e]); });
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    });
    kids.forEach(function (c) { el.appendChild(c instanceof Node ? c : document.createTextNode(String(c))); });
    return el;
  }

  function h(tag, attrs) {
    const kids = flat(Array.prototype.slice.call(arguments, 2));
    const u = util();
    if (typeof u.h === 'function') return u.h.apply(null, [tag, attrs || {}].concat(kids));
    if (!h.warned) { h.warned = true; console.warn('[flash] CARDIO.util.h absent : rendu de repli'); }
    return fallbackH(tag, attrs, kids);
  }

  function esc(s) {
    const u = util();
    if (typeof u.esc === 'function') return u.esc(String(s == null ? '' : s));
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Markdown-lite → HTML (md() échappe la source) ; repli : texte échappé. */
  function mdHTML(text) {
    const u = util();
    if (typeof u.md === 'function') { try { return u.md(String(text == null ? '' : text)); } catch (e) { console.warn('[flash] md', e); } }
    return '<p>' + esc(text) + '</p>';
  }
  /* Version « en ligne » : retire le <p> englobant quand il n'y a qu'un paragraphe. */
  function mdInline(text) {
    const html = mdHTML(text).trim();
    const m = /^<p>([\s\S]*)<\/p>$/.exec(html);
    return m && m[1].indexOf('<p>') < 0 ? m[1] : html;
  }

  function icon(name, opts) {
    const u = util();
    if (typeof u.icon === 'function') { try { return u.icon(name, opts) || ''; } catch (e) { /* ignore */ } }
    return '';
  }
  function iconEl(name, cls) { return h('span', { class: 'ico ' + (cls || ''), 'aria-hidden': 'true', html: icon(name) }); }

  function safe(fn, fallback) {
    try { const v = fn(); return v === undefined ? fallback : v; } catch (e) { console.warn('[flash]', e); return fallback; }
  }
  function str(v) { return v === undefined || v === null ? '' : String(v); }
  function pctNum(x) { return Math.round(Math.max(0, Math.min(1, Number(x) || 0)) * 100); }
  function pctText(x) { return pctNum(x) + NBSP + '%'; }
  function reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  function touchFirst() {
    try { return window.matchMedia('(hover: none)').matches; } catch (e) { return false; }
  }
  function toast(msg, tone) {
    const s = shell();
    if (s && typeof s.toast === 'function') { try { s.toast(msg, { tone: tone || 'info' }); } catch (e) { /* ignore */ } }
  }
  function haptic(ms) {
    const s = shell();
    if (s && typeof s.haptic === 'function') { try { s.haptic(ms); } catch (e) { /* ignore */ } }
  }

  /* ---------- Données ---------- */

  function allItems() {
    const reg = registry();
    return reg && typeof reg.items === 'function' ? safe(function () { return reg.items(); }, []) || [] : [];
  }
  function findItem(num) {
    const reg = registry();
    const it = reg && typeof reg.item === 'function' ? safe(function () { return reg.item(num); }, null) : null;
    return it || allItems().find(function (x) { return str(x.num) === str(num); }) || null;
  }
  function hasFlash(it) { return !!(it && it.counts && Number(it.counts.ff) > 0); }

  /* Dernier résultat du test de la fiche : {at, score, runs} ou null. */
  function flashStat(num) {
    const s = store();
    const st = (s && s.state) || {};
    const is = (st.itemStats || {})[str(num)];
    const f = is && is.flash;
    if (!f || typeof f !== 'object') return null;
    return { at: Number(f.at) || 0, score: Math.max(0, Math.min(1, Number(f.score) || 0)), runs: Math.max(0, Math.round(Number(f.runs) || 0)) };
  }

  function seenList() {
    try { const v = JSON.parse(localStorage.getItem(LS_SEEN) || '[]'); return Array.isArray(v) ? v.map(String) : []; }
    catch (e) { return []; }
  }
  function markSeen(num) {
    try {
      const list = seenList();
      if (list.indexOf(str(num)) >= 0) return;
      list.push(str(num));
      localStorage.setItem(LS_SEEN, JSON.stringify(list));
    } catch (e) { /* mode privé : simple confort, on ignore */ }
  }

  /* Statut d'une fiche pour la liste : {key, label, title}. */
  function statusOf(it, seen) {
    if (!hasFlash(it)) return { key: 'soon', label: 'bientôt', title: 'Fiche flash en préparation' };
    const f = flashStat(it.num);
    if (f && f.runs > 0) {
      if (f.score >= MASTERED) return { key: 'ok', label: 'maîtrisée', title: 'Dernier test : ' + pctText(f.score) };
      return { key: 'test', label: 'dernier test ' + pctText(f.score), title: 'Maîtrisée à partir de ' + pctText(MASTERED) };
    }
    if (seen && seen.indexOf(str(it.num)) >= 0) return { key: 'seen', label: 'lue', title: 'Lue, pas encore testée' };
    return { key: 'new', label: 'non lue', title: 'Pas encore ouverte' };
  }

  function whenText(at) {
    const u = util();
    if (!at) return '';
    if (typeof u.fmtDate === 'function') { try { return u.fmtDate(at, { relative: true }); } catch (e) { /* repli */ } }
    try { return new Date(at).toLocaleDateString('fr-FR'); } catch (e) { return ''; }
  }

  /* Sections dans l'ordre fixe des 7 blocs (clés inconnues ajoutées à la fin). */
  function orderSections(sections) {
    const list = Array.isArray(sections) ? sections.filter(function (s) { return s && typeof s === 'object'; }) : [];
    return list.slice().sort(function (a, b) {
      const ia = KEY_ORDER.indexOf(a.key), ib = KEY_ORDER.indexOf(b.key);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }

  /* ---------- Styles (tokens uniquement) ---------- */

  const CSS = [
    /* en-tête */
    '.ff__head{padding:2px 0 0}',
    '.ff__top{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px}',
    '.ff__kicker{display:inline-flex;align-items:center;gap:6px;font-size:.75rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--accent)}',
    '.ff__kicker .ico svg{width:16px;height:16px;display:block}',
    '.ff__last{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:.75rem;font-weight:600;font-variant-numeric:tabular-nums;background:var(--surface-2);color:var(--ink-2)}',
    '.ff__last.is-ok{background:var(--ok-soft);color:var(--ok)}',
    '.ff__last.is-warn{background:var(--warn-soft);color:var(--warn)}',
    '.ff__h1{margin:0;font:700 1.375rem/1.2 var(--font-display);letter-spacing:0;text-transform:uppercase;text-wrap:balance;overflow-wrap:anywhere}',
    '.ff__tag{margin:4px 0 0;font:600 .75rem/1.3 var(--font-body);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}',
    /* barre d'outils (collante en mode test) */
    '.ff__tools{display:flex;align-items:center;gap:10px 14px;flex-wrap:wrap;padding:6px 0;background:var(--bg)}',
    '.ff__tools.is-sticky{position:sticky;top:0;z-index:6;margin-inline:calc(-1 * var(--gutter));padding:8px var(--gutter);border-bottom:1px solid var(--line)}',
    '.ff__seg .seg__btn{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 16px;font-weight:600}',
    '.ff__seg .seg__btn .ico svg{width:18px;height:18px;display:block}',
    '.ff__prog{flex:1 1 150px;min-width:0;display:flex;align-items:center;gap:10px}',
    '.ff__prog-txt{font:700 .9375rem/1 var(--font-display);font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.ff__prog-txt small{font:500 .75rem var(--font-body);color:var(--muted);margin-left:4px}',
    '.ff__prog .bar{flex:1 1 auto;height:6px}',
    '.ff__intro{margin:0;font-size:.875rem;color:var(--muted)}',
    /* blocs */
    '.ff__grid{display:grid;gap:10px;align-items:start}',
    '@media (min-width:1100px){.ff__grid{grid-template-columns:repeat(2,minmax(0,1fr))}}',
    '.ff__blk{--ffc:var(--ink);--ffs:var(--surface-2);min-width:0;background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1);border-left:4px solid var(--ffc);padding:11px 13px 12px 13px}',
    '.ff__blk[data-k="identite"]{--ffc:var(--rankA);--ffs:var(--surface-3)}',
    '.ff__blk[data-k="pattern"]{--ffc:var(--info);--ffs:var(--info-soft)}',
    '.ff__blk[data-k="gravite"]{--ffc:var(--bad);--ffs:var(--bad-soft)}',
    '.ff__blk[data-k="paraclinique"]{--ffc:var(--blue);--ffs:var(--blue-soft)}',
    '.ff__blk[data-k="orientation"]{--ffc:var(--warn);--ffs:var(--warn-soft)}',
    '.ff__blk[data-k="traitement"]{--ffc:var(--ok);--ffs:var(--ok-soft)}',
    '.ff__blk[data-k="securite"]{--ffc:var(--accent);--ffs:var(--accent-soft)}',
    '.ff__bt{display:flex;align-items:center;gap:9px;margin:0 0 7px;font:700 .9375rem/1.25 var(--font-display);letter-spacing:.02em;text-transform:uppercase;color:var(--ink)}',
    '.ff__n{flex:none;display:inline-grid;place-items:center;min-width:24px;height:24px;padding:0 5px;border-radius:7px;background:var(--ffc);color:var(--surface);font:700 .8125rem/1 var(--font-display);font-variant-numeric:tabular-nums}',
    '.ff__fs{list-style:none;margin:0;padding:0;display:grid;gap:6px}',
    '.ff__f{position:relative;padding-left:15px;font-size:.875rem;line-height:1.45;overflow-wrap:anywhere}',
    '.ff__f::before{content:"";position:absolute;left:2px;top:.56em;width:6px;height:6px;border-radius:50%;background:var(--ffc)}',
    '.ff__lab{font-weight:600;color:var(--ink)}',
    '.ff__val{color:var(--ink-2)}',
    '.ff__val strong{color:var(--ink);font-weight:700;box-shadow:inset 0 -.42em 0 var(--ffs);border-radius:2px}',
    '.ff__val.is-block{margin-top:2px}',
    '.ff__val.is-block p{margin:0 0 4px}',
    '.ff__val.is-null{color:var(--muted);font-style:italic}',
    '.ff__val.is-in{animation:ffIn .2s var(--ease) both}',
    '.ff__sep{color:var(--ffc);font-weight:700}',
    '.ff__srcs{margin:0;text-align:center;font-size:.75rem;line-height:1.5;color:var(--muted)}',
    '.ff__srcs span{white-space:nowrap}',
    '.ff__srcs b{font-weight:600;color:var(--ink-2)}',
    '@media (min-width:600px){.ff__f{font-size:.9375rem}.ff__h1{font-size:1.625rem}}',
    /* mode test */
    '.ff__hide{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:46px;margin-top:6px;padding:8px 12px;border:1px dashed var(--line);border-radius:var(--r-s);background:repeating-linear-gradient(-45deg,var(--surface-2) 0 7px,var(--surface) 7px 14px);color:var(--muted);font:600 .875rem/1.2 var(--font-body);cursor:pointer;-webkit-tap-highlight-color:transparent;transition:border-color .16s var(--ease),color .16s var(--ease)}',
    '.ff__hide:hover{border-color:var(--ffc);color:var(--ink-2)}',
    '.ff__hide:active{transform:translateY(1px)}',
    '.ff__hide .ico svg{width:18px;height:18px;display:block}',
    '.ff__grade{display:flex;gap:8px;margin-top:8px}',
    /* .btn.… : ces styles sont injectés avant ceux de la page, il faut battre .btn/.btn--sm en spécificité */
    '.btn.ff__g{flex:1 1 0;min-height:40px;padding:6px 10px;font-size:.875rem}',
    '.ff__g .ico svg{width:16px;height:16px;display:block}',
    '.btn.ff__g--ok,.btn.ff__g--ok:hover{background:var(--ok-soft);color:var(--ok)}',
    '.btn.ff__g--ko,.btn.ff__g--ko:hover{background:var(--warn-soft);color:var(--warn)}',
    '.btn.ff__g--ok.is-on,.btn.ff__g--ok.is-on:hover{background:var(--ok);color:var(--surface)}',
    '.btn.ff__g--ko.is-on,.btn.ff__g--ko.is-on:hover{background:var(--warn);color:var(--surface)}',
    '.ff__grade.is-done .ff__g:not(.is-on){opacity:.55}',
    '.ff__f.is-dim{opacity:.5}',
    /* fin de test */
    '.card.ff__end{display:grid;gap:6px;justify-items:center;text-align:center;padding:20px 16px}',
    '.ff__end .caption{margin:0}',
    '.ff__score{font:700 3rem/1 var(--font-display);letter-spacing:-.02em;font-variant-numeric:tabular-nums}',
    '.ff__score.is-ok{color:var(--ok)}.ff__score.is-warn{color:var(--warn)}.ff__score.is-bad{color:var(--bad)}',
    '.ff__end-line{margin:0;font-weight:600}',
    '.ff__end-msg{margin:0;color:var(--ink-2);max-width:42ch}',
    '.ff__end-saved{margin:0;font-size:.8125rem;color:var(--muted)}',
    '.ff__end-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:10px}',
    /* actions, navigation, source */
    '.ff__actions{display:grid;gap:8px;margin-top:16px}',
    '.ff__links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}',
    '.ff__links .btn{gap:6px;padding-inline:8px;font-size:.9375rem;white-space:normal}',
    '.ff__nav{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}',
    '.ff__nav-a{display:flex;flex-direction:column;justify-content:center;gap:2px;min-height:56px;padding:10px 12px;border-radius:var(--r-m);background:var(--surface);box-shadow:var(--shadow-1);color:inherit;text-decoration:none;min-width:0}',
    '.ff__nav-a:hover{text-decoration:none;box-shadow:var(--shadow-2)}',
    '.ff__nav-a.is-next{text-align:right;align-items:flex-end}',
    '.ff__nav-a small{font-size:.6875rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}',
    '.ff__nav-a span{max-width:100%;font-weight:600;font-size:.875rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ff__nav-a.is-soon span{color:var(--muted)}',
    /* liste #/flash */
    '.ffl__h1{font:700 1.75rem/1.15 var(--font-display);margin:8px 0 4px;text-wrap:balance}',
    '.ffl__lead{margin:0;color:var(--ink-2);font-size:1.0625rem}',
    '.ffl__sum{display:grid;gap:10px}',
    '.ffl__sum-line{margin:0;font-size:.9375rem;color:var(--ink-2);font-variant-numeric:tabular-nums}',
    '.ffl__sum-line b{color:var(--ink)}',
    '.ffl__group{display:grid;gap:8px}',
    '.ffl__eyebrow{display:flex;gap:8px;align-items:baseline;margin:6px 0 0;font:500 .75rem/1.35 var(--font-body);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}',
    '.ffl__eyebrow b{color:var(--ink);font-weight:600;white-space:nowrap}',
    '.row.ffl__row{min-height:60px}',
    '.ffl__row .row__num{min-width:38px}',
    '.ffl__row .row__sub{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ffl__row.is-soon .row__title,.ffl__row.is-soon .row__num{color:var(--muted)}',
    '.ffl__row .row__end .ico svg{width:18px;height:18px;display:block}',
    '.ffl__st{display:inline-flex;align-items:center;padding:3px 9px;border-radius:999px;font-size:.75rem;font-weight:600;line-height:1.3;white-space:nowrap;font-variant-numeric:tabular-nums;background:var(--surface-2);color:var(--ink-2)}',
    '.ffl__st--seen{background:var(--info-soft);color:var(--info)}',
    '.ffl__st--test{background:var(--warn-soft);color:var(--warn)}',
    '.ffl__st--ok{background:var(--ok-soft);color:var(--ok)}',
    '.ffl__st--soon{background:transparent;box-shadow:inset 0 0 0 1px var(--line);color:var(--muted)}',
    '@keyframes ffIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}',
    '@media (prefers-reduced-motion:reduce){.ff__val.is-in{animation:none}}',
    '@media print{.ff__tools,.ff__actions,.ff__nav{display:none!important}.ff__blk{box-shadow:none;border:1px solid var(--line);border-left:4px solid var(--ffc);break-inside:avoid}}'
  ].join('\n');

  function ensureStyles() {
    if (document.getElementById('flash-view-css')) return;
    const s = document.createElement('style');
    s.id = 'flash-view-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------- Petits composants ---------- */

  function bar(ratio, mod) {
    const fill = h('span', { class: 'bar__fill' });
    fill.style.width = pctNum(ratio) + '%';
    return h('div', { class: 'bar' + (mod ? ' ' + mod : ''), role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pctNum(ratio)) }, fill);
  }

  /* Valeur d'un champ : markdown-lite en ligne, séparateurs « · » colorés ; null → « non abordé ». */
  function valueEl(value) {
    if (value === null || value === undefined || String(value).trim() === '') {
      return h('span', { class: 'ff__val is-null' }, 'non abordé dans le Collège');
    }
    const html = mdInline(value).replace(/ · /g, ' <span class="ff__sep">·</span> ');
    const isBlock = /<(ul|ol|div|table|h4|p)[\s>]/.test(html);
    return h(isBlock ? 'div' : 'span', { class: 'ff__val' + (isBlock ? ' is-block' : ''), html: html });
  }

  function itemHeader(num, it, last) {
    const title = (it && it.title) || 'Item ' + num;
    let lastEl = null;
    if (last && last.runs > 0) {
      const ok = last.score >= MASTERED;
      const when = whenText(last.at);
      lastEl = h('span', { class: 'ff__last ' + (ok ? 'is-ok' : 'is-warn'), title: when ? 'Dernier test : ' + when : null },
        iconEl(ok ? 'check' : 'target'), (ok ? 'Maîtrisée · ' : 'Dernier test : ') + pctText(last.score));
    }
    return h('header', { class: 'ff__head' },
      h('div', { class: 'ff__top' }, h('span', { class: 'ff__kicker' }, iconEl('flash'), 'Fiche flash · 2 min'), lastEl),
      h('h1', { class: 'ff__h1' }, 'Item ' + num + NBSP + ': ' + title),
      h('p', { class: 'ff__tag' }, '— R2C rang A & B fondamental'));
  }

  function navEl(num) {
    const items = allItems().filter(function (x) { return (x.spe || 'cardio') === 'cardio'; });
    const idx = items.findIndex(function (x) { return str(x.num) === str(num); });
    if (idx < 0 || items.length < 2) return null;
    function link(it, dir) {
      if (!it) return h('span', { 'aria-hidden': 'true' });
      return h('a', { class: 'ff__nav-a' + (dir === 'next' ? ' is-next' : '') + (hasFlash(it) ? '' : ' is-soon'), href: '#/item/' + it.num + '/flash',
        'aria-label': (dir === 'next' ? 'Fiche suivante : ' : 'Fiche précédente : ') + 'item ' + it.num + ' ' + (it.short || '') },
        h('small', {}, dir === 'next' ? 'Suivante' : 'Précédente'),
        h('span', {}, (dir === 'next' ? '' : '‹ ') + it.num + ' · ' + (it.short || '') + (dir === 'next' ? ' ›' : '')));
    }
    return h('nav', { class: 'ff__nav', 'aria-label': 'Autres fiches flash' }, link(items[idx - 1], 'prev'), link(items[idx + 1], 'next'));
  }

  function reviewHref(num) { return '#/review?mode=item&item=' + encodeURIComponent(num) + '&autostart=1'; }

  /* ---------- Fiche d'un item ---------- */

  function buildFiche(num, it, flash, query) {
    const sections = orderSections(flash.sections);
    const fields = [];
    sections.forEach(function (sec, si) {
      (Array.isArray(sec.fields) ? sec.fields : []).forEach(function (f, fi) {
        if (!f || typeof f !== 'object') return;
        const v = f.value === null || f.value === undefined || String(f.value).trim() === '' ? null : String(f.value);
        fields.push({ id: si + '-' + fi, si: si, label: str(f.label), value: v, state: 'shown', grade: null, el: null });
      });
    });
    const testable = fields.filter(function (f) { return f.value !== null; });
    const T = { mode: 'read', pass: 'full', targets: {}, saved: false, finished: false, lastFull: null };

    const page = h('div', { class: 'page ff' });
    let head = itemHeader(num, it, flashStat(num));

    /* Barre d'outils : Lire / Me tester + progression */
    const btnRead = h('button', { type: 'button', class: 'seg__btn', on: { click: function () { setMode('read'); } } }, iconEl('book'), 'Lire');
    const btnTest = h('button', { type: 'button', class: 'seg__btn', disabled: !testable.length, on: { click: function () { setMode('test'); } } }, iconEl('target'), 'Me tester');
    const progTxt = h('span', { class: 'ff__prog-txt' });
    const progBarFill = h('span', { class: 'bar__fill' });
    const progBar = h('div', { class: 'bar', role: 'progressbar', 'aria-label': 'Progression du test', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, progBarFill);
    const prog = h('div', { class: 'ff__prog', hidden: true }, progTxt, progBar);
    const tools = h('div', { class: 'ff__tools' },
      h('div', { class: 'seg ff__seg', role: 'group', 'aria-label': 'Mode de la fiche' }, btnRead, btnTest), prog);
    const intro = h('p', { class: 'ff__intro', 'aria-live': 'polite' });

    const grid = h('div', { class: 'ff__grid' });
    const endHost = h('div', { class: 'ff__endhost', hidden: true });
    const actions = h('div', { class: 'ff__actions' });

    page.append(head, tools, intro, grid, endHost, actions);
    const nav = navEl(num);
    if (nav) page.append(nav);
    /* Sources en pied de fiche (discrètes) : global puis page(s) de chaque bloc. */
    const perBlock = [];
    sections.forEach(function (sec, si) {
      if (!sec.src) return;
      if (perBlock.length) perBlock.push(' · ');
      perBlock.push(h('span', {}, h('b', {}, (si + 1) + '.'), NBSP + sec.src));
    });
    page.append(h('p', { class: 'ff__srcs' },
      'Source : Collège de cardiologie (CNEC)' + (flash.src ? ', ' + flash.src : '') + '. Rien d’extérieur au livre.',
      perBlock.length ? h('br') : null,
      perBlock.length ? ['Par bloc : '].concat(perBlock) : null));

    function isTarget(f) { return T.mode === 'test' && !!T.targets[f.id]; }
    function targets() { return fields.filter(function (f) { return !!T.targets[f.id]; }); }

    function fieldEl(f) {
      const li = h('li', { class: 'ff__f', dataset: { fid: f.id } });
      const lab = h('span', { class: 'ff__lab' }, f.label);
      f.el = li;
      if (T.mode === 'read' || f.value === null) { li.append(lab, NBSP + ': ', valueEl(f.value)); return li; }
      if (!isTarget(f)) { li.classList.add('is-dim'); li.append(lab, NBSP + ': ', valueEl(f.value)); return li; }
      if (f.state === 'hidden') {
        li.classList.add('is-q');
        li.append(lab, NBSP + ':', h('button', {
          type: 'button', class: 'ff__hide', 'aria-label': 'Révéler : ' + f.label,
          on: { click: function () { reveal(f); } }
        }, iconEl('eye'), touchFirst() ? 'Touche pour révéler' : 'Clique pour révéler'));
        return li;
      }
      li.classList.add('is-shown');
      li.append(lab, NBSP + ': ', valueEl(f.value), gradeRow(f));
      return li;
    }

    function gradeRow(f) {
      function btn(g, ico, label) {
        const on = f.grade === g;
        return h('button', {
          type: 'button', class: 'btn btn--sm ff__g ff__g--' + g + (on ? ' is-on' : ''), dataset: { g: g }, 'aria-pressed': on,
          on: { click: function () { grade(f, g); } }
        }, iconEl(ico), label);
      }
      return h('div', { class: 'ff__grade' + (f.grade ? ' is-done' : ''), role: 'group', 'aria-label': 'Auto-évaluation : ' + f.label },
        btn('ok', 'check', 'Je savais'), btn('ko', 'refresh', 'À revoir'));
    }

    function blockEl(sec, si) {
      const id = 'ff-b-' + num + '-' + si;
      const list = h('ul', { class: 'ff__fs' }, fields.filter(function (f) { return f.si === si; }).map(fieldEl));
      return h('section', { class: 'ff__blk', dataset: { k: str(sec.key) }, 'aria-labelledby': id },
        h('h2', { class: 'ff__bt', id: id, title: sec.src ? 'Collège, ' + sec.src : null },
          h('span', { class: 'ff__n' }, String(si + 1)), h('span', {}, sec.title || DEFAULT_TITLES[sec.key] || 'Bloc ' + (si + 1))),
        list);
    }

    function renderActions() {
      // replaceChildren() convertirait un null en texte « null » : on ne passe que des nœuds.
      const kids = [];
      if (T.mode === 'read' && testable.length) {
        kids.push(h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: function () { setMode('test', true); } } }, iconEl('target'), 'Me tester sur cette fiche'));
      }
      kids.push(h('div', { class: 'ff__links' },
        h('a', { class: 'btn btn--secondary', href: reviewHref(num) }, iconEl('play'), 'Réviser cet item'),
        h('a', { class: 'btn btn--secondary', href: '#/item/' + num + '/cours' }, iconEl('book'), 'Fiche complète')));
      actions.replaceChildren.apply(actions, kids);
    }

    function renderAll() {
      const test = T.mode === 'test';
      [[btnRead, !test], [btnTest, test]].forEach(function (p) {
        p[0].classList.toggle('is-on', p[1]);
        p[0].setAttribute('aria-pressed', p[1] ? 'true' : 'false');
      });
      tools.classList.toggle('is-sticky', test);
      prog.hidden = !test;
      intro.textContent = test
        ? (T.pass === 'retry'
          ? 'Seuls tes « À revoir » sont masqués. Retrouve-les de tête, puis révèle.'
          : 'Pour chaque ligne, retrouve la réponse de tête, révèle, puis sois honnête : « Je savais » ou « À revoir ».')
        : 'Les 7 blocs à connaître avant tout le reste. Les mots en gras font gagner le point.';
      grid.replaceChildren.apply(grid, sections.map(blockEl));
      endHost.hidden = true;
      endHost.replaceChildren();
      renderActions();
      if (test) updateProgress();
    }

    function updateProgress() {
      const list = targets();
      const done = list.filter(function (f) { return !!f.grade; }).length;
      const total = list.length;
      const known = list.filter(function (f) { return f.grade === 'ok'; }).length;
      const parts = [done + ' / ' + total];
      if (done) parts.push(h('small', {}, known + ' su' + (known > 1 ? 's' : '')));
      progTxt.replaceChildren.apply(progTxt, parts);
      progBarFill.style.width = (total ? Math.round(done / total * 100) : 0) + '%';
      progBar.setAttribute('aria-valuenow', String(total ? Math.round(done / total * 100) : 0));
      if (total && done === total) finish();
    }

    function visibleBounds() {
      const view = document.getElementById('view');
      const vr = view ? view.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      let bottom = Math.min(vr.bottom, window.innerHeight);
      const tab = document.getElementById('tabbar');
      if (tab) {
        const tr = tab.getBoundingClientRect();
        if (tr.width >= window.innerWidth * 0.8 && tr.top > vr.top && tr.top < bottom) bottom = tr.top;   // barre d'onglets du téléphone
      }
      const top = vr.top + (tools.classList.contains('is-sticky') ? tools.offsetHeight : 0);
      return { top: top, bottom: bottom };
    }
    function ensureVisible(el, block) {
      if (!el || !el.getBoundingClientRect) return;
      const r = el.getBoundingClientRect(), b = visibleBounds();
      if (r.top >= b.top + 8 && r.bottom <= b.bottom - 8) return;
      try { el.scrollIntoView({ block: block || 'center', behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch (e) { el.scrollIntoView(); }
    }
    function focusEl(el) { if (el) { try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } }

    function reveal(f) {
      if (f.state !== 'hidden' || !f.el) return;
      f.state = 'shown';
      const hide = f.el.querySelector('.ff__hide');
      const val = valueEl(f.value);
      val.classList.add('is-in');
      const row = gradeRow(f);
      f.el.classList.remove('is-q');
      f.el.classList.add('is-shown');
      if (hide) hide.replaceWith(document.createTextNode(' '), val, row);
      else f.el.append(' ', val, row);
      haptic(8);
      focusEl(row.querySelector('.ff__g--ok'));
      ensureVisible(row, 'nearest');
    }

    function grade(f, g) {
      if (!f.el) return;
      const first = !f.grade;
      f.grade = g;
      f.el.classList.toggle('is-ok', g === 'ok');
      f.el.classList.toggle('is-ko', g === 'ko');
      const row = f.el.querySelector('.ff__grade');
      if (row) {
        row.classList.add('is-done');
        row.querySelectorAll('.ff__g').forEach(function (b) {
          const on = b.dataset.g === g;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      }
      const wasFinished = T.finished;
      updateProgress();
      if (first && !T.finished && !wasFinished) focusNext(f);
    }

    function focusNext(after) {
      const list = targets();
      const i = list.indexOf(after);
      const next = list.slice(i + 1).concat(list.slice(0, Math.max(0, i))).find(function (f) { return f.state === 'hidden'; });
      if (!next || !next.el) return;
      const btn = next.el.querySelector('.ff__hide');
      focusEl(btn);
      ensureVisible(btn || next.el, 'center');
    }

    function save(score, newRun) {
      const s = store();
      if (!s || typeof s.update !== 'function') { toast('Sauvegarde indisponible : ton score n’est pas enregistré.', 'warn'); return false; }
      try {
        s.update(function (st) {
          st.itemStats = st.itemStats || {};
          const is = st.itemStats[num] || (st.itemStats[num] = { lastVisited: 0, sessions: 0 });
          const prev = is.flash && typeof is.flash === 'object' ? is.flash : null;
          const runs = (prev ? Math.max(0, Math.round(Number(prev.runs) || 0)) : 0) + (newRun ? 1 : 0);
          is.flash = { at: Date.now(), score: Math.round(score * 1000) / 1000, runs: Math.max(1, runs) };
        });
        return true;
      } catch (e) {
        console.warn('[flash] sauvegarde du test', e);
        toast('Enregistrement impossible pour le moment.', 'bad');
        return false;
      }
    }

    function finish() {
      const list = targets();
      const total = list.length;
      const known = list.filter(function (f) { return f.grade === 'ok'; }).length;
      const ko = total - known;
      const score = total ? known / total : 0;
      let saved = false;
      if (T.pass === 'full') {
        saved = save(score, !T.saved);
        T.saved = T.saved || saved;
        T.lastFull = { score: score, known: known, total: total };
        if (saved) refreshHead();
      }
      const tone = score >= MASTERED ? 'ok' : score >= 0.5 ? 'warn' : 'bad';
      let msg;
      if (T.pass === 'full') {
        msg = score >= MASTERED ? 'Fiche maîtrisée. Consolide maintenant avec les questions de l’item.'
          : score >= 0.5 ? 'Presque : relis tes « À revoir », puis recommence.'
            : 'Relis la fiche en mode « Lire », puis refais le test : ça rentre vite.';
      } else {
        msg = ko ? 'Encore ' + ko + ' à revoir : relis-les, puis réessaie.'
          : 'Tout est retrouvé. Refais un test complet pour mettre ton score à jour.';
      }
      const panel = h('section', { class: 'card card--raised ff__end', 'aria-labelledby': 'ff-end-' + num },
        h('h2', { class: 'caption', id: 'ff-end-' + num }, T.pass === 'full' ? 'Résultat du test' : 'Révision des « À revoir »'),
        h('div', { class: 'ff__score is-' + tone }, pctText(score)),
        h('p', { class: 'ff__end-line' }, known + ' sur ' + total + (known > 1 ? ' retrouvés' : ' retrouvé') + (ko ? ' · ' + ko + ' à revoir' : '')),
        h('p', { class: 'ff__end-msg' }, msg),
        T.pass === 'full'
          ? (saved ? h('p', { class: 'ff__end-saved' }, 'Score enregistré dans ta progression.') : null)
          : (T.lastFull ? h('p', { class: 'ff__end-saved' }, 'Score enregistré : ' + pctText(T.lastFull.score) + ' (dernier test complet).') : null),
        h('div', { class: 'ff__end-actions' },
          h('button', { type: 'button', class: 'btn ' + (ko ? 'btn--secondary' : 'btn--primary'), on: { click: function () { restart(true); } } }, iconEl('refresh'), 'Recommencer'),
          ko ? h('button', { type: 'button', class: 'btn btn--primary', on: { click: retryKo } }, iconEl('target'), 'Revoir les « À revoir »') : null));
      endHost.replaceChildren(panel);
      endHost.hidden = false;
      progTxt.replaceChildren('Terminé', h('small', {}, pctText(score)));
      if (!T.finished) {
        T.finished = true;
        haptic(15);
        requestAnimationFrame(function () { ensureVisible(panel, 'center'); });
      }
    }

    /* L'en-tête affiche le dernier score : on le reconstruit après un enregistrement. */
    function refreshHead() {
      const fresh = itemHeader(num, it, flashStat(num));
      if (head.parentNode) head.replaceWith(fresh);
      head = fresh;
    }

    function resetTest(targetFields, pass) {
      T.targets = {};
      targetFields.forEach(function (f) { T.targets[f.id] = true; f.state = 'hidden'; f.grade = null; });
      fields.forEach(function (f) { if (!T.targets[f.id]) { f.state = 'shown'; } });
      T.pass = pass;
      T.finished = false;
      if (pass === 'full') T.saved = false;
    }

    function firstHidden() {
      const f = targets().find(function (x) { return x.state === 'hidden'; });
      return f && f.el ? f.el.querySelector('.ff__hide') : null;
    }

    function restart(scroll) {
      resetTest(testable, 'full');
      T.mode = 'test';
      renderAll();
      if (scroll) jumpToStart();
    }

    function retryKo() {
      const ko = targets().filter(function (f) { return f.grade === 'ko'; });
      if (!ko.length) return;
      resetTest(ko, 'retry');
      T.mode = 'test';
      renderAll();
      const btn = firstHidden();
      focusEl(btn);
      if (btn) requestAnimationFrame(function () { ensureVisible(btn, 'center'); });
    }

    function jumpToStart() {
      const s = shell();
      const btn = firstHidden();
      if (s && typeof s.scrollTop === 'function') s.scrollTop();
      else { const v = document.getElementById('view'); if (v) v.scrollTop = 0; }
      focusEl(btn);
    }

    function setMode(m, scroll) {
      if (m === T.mode) return;                 // un second appui ne doit pas effacer un test en cours
      if (m === 'test') {
        if (!testable.length) return;
        restart(!!scroll);
        return;
      }
      T.mode = 'read';
      fields.forEach(function (f) { f.state = 'shown'; });
      renderAll();
    }

    if (query && (query.mode === 'test' || query.test === '1') && testable.length) restart(false);
    else renderAll();
    return page;
  }

  /* ---------- Rendu : fiche d'un item ---------- */

  function shell404(num) {
    return h('div', { class: 'page ff' },
      h('div', { class: 'card soon' },
        h('div', { class: 'soon__icon', html: icon('warning', { size: 28 }) }),
        h('h2', { class: 'soon__title' }, 'Item introuvable'),
        h('p', { class: 'muted' }, 'L’item ' + num + ' ne fait pas partie du programme de cardiologie.'),
        h('div', { class: 'cluster' }, h('a', { class: 'btn btn--primary', href: '#/flash' }, 'Toutes les fiches flash'))));
  }

  function soonPage(num, it) {
    const page = h('div', { class: 'page ff' });
    page.append(itemHeader(num, it, null),
      h('div', { class: 'card soon' },
        h('div', { class: 'soon__icon', html: icon('flash', { size: 28 }) }),
        h('h2', { class: 'soon__title' }, 'Fiche flash en préparation pour cet item'),
        h('p', { class: 'muted' }, 'Elle arrive bientôt. En attendant, la fiche complète contient tout le cours de l’item.'),
        h('div', { class: 'cluster' },
          h('a', { class: 'btn btn--primary', href: '#/item/' + num + '/cours' }, iconEl('book'), 'Fiche complète'),
          h('a', { class: 'btn btn--secondary', href: reviewHref(num) }, iconEl('play'), 'Réviser cet item'))));
    const nav = navEl(num);
    if (nav) page.append(nav);
    return page;
  }

  function errorPage(num, message) {
    return h('div', { class: 'page ff' },
      h('div', { class: 'card soon soon--error' },
        h('div', { class: 'soon__icon', html: icon('warning', { size: 28 }) }),
        h('h2', { class: 'soon__title' }, 'Fiche indisponible'),
        h('p', { class: 'muted' }, message || 'Impossible de charger le contenu de cet item.'),
        h('div', { class: 'cluster' },
          h('button', { type: 'button', class: 'btn btn--primary', on: { click: function () {
            const r = CARDIO.router;
            if (r && typeof r.go === 'function') r.go(location.hash || '#/item/' + num + '/flash', { force: true });
            else location.reload();
          } } }, iconEl('refresh'), 'Réessayer'),
          h('a', { class: 'btn btn--secondary', href: '#/item/' + num }, 'Retour à l’item'))));
  }

  async function renderItem(num, query) {
    ensureStyles();
    const reg = registry();
    const it = findItem(num);
    if (!num || (reg && reg.manifest && !it)) return shell404(num);
    if (!reg || typeof reg.load !== 'function') return errorPage(num, 'Le registre de contenu n’est pas chargé. Recharge la page.');
    let content = null;
    try {
      content = typeof reg.content === 'function' ? reg.content(num) : null;
      if (!content) content = await reg.load(num);
    } catch (e) {
      console.warn('[flash] chargement de l’item ' + num, e);
      return errorPage(num, e && e.message ? e.message : null);
    }
    const flash = content && content.flash && typeof content.flash === 'object' && Array.isArray(content.flash.sections) && content.flash.sections.length
      ? content.flash : null;
    if (!flash) return soonPage(num, it);
    markSeen(num);
    return { el: buildFiche(num, it, flash, query || {}), wide: true };
  }

  /* ---------- Rendu : liste #/flash ---------- */

  function renderList() {
    ensureStyles();
    const items = allItems().filter(function (x) { return (x.spe || 'cardio') === 'cardio'; });
    const seen = seenList();
    const page = h('div', { class: 'page ffl' });
    page.append(h('header', {},
      h('h1', { class: 'ffl__h1' }, 'Fiches flash'),
      h('p', { class: 'ffl__lead' }, 'Le BABA de chaque item en 2 minutes. Commence par là.')));

    const avail = items.filter(hasFlash);
    const stats = {};
    avail.forEach(function (it) { stats[it.num] = flashStat(it.num); });
    const tested = avail.filter(function (it) { const f = stats[it.num]; return f && f.runs > 0; });
    const mastered = tested.filter(function (it) { return stats[it.num].score >= MASTERED; });
    const next = avail.find(function (it) { const f = stats[it.num]; return !(f && f.runs > 0); })
      || avail.find(function (it) { return stats[it.num].score < MASTERED; }) || null;

    if (!items.length) {
      page.append(h('div', { class: 'card' }, h('p', { class: 'muted', style: 'margin:0' }, 'Le catalogue n’est pas encore chargé. Recharge la page si cela persiste.')));
      return page;
    }
    if (!avail.length) {
      page.append(h('section', { class: 'card ffl__sum' },
        h('p', { class: 'ffl__sum-line' }, 'Les fiches flash sont en cours d’écriture, item par item. Elles apparaîtront ici dès qu’elles sont prêtes.')));
    } else {
      page.append(h('section', { class: 'card ffl__sum', 'aria-label': 'Ta progression sur les fiches flash' },
        h('p', { class: 'ffl__sum-line' },
          h('b', {}, String(tested.length)), tested.length > 1 ? ' testées' : ' testée', ' · ',
          h('b', {}, String(mastered.length)), mastered.length > 1 ? ' maîtrisées' : ' maîtrisée',
          avail.length < items.length ? ' · ' + avail.length + ' fiche' + (avail.length > 1 ? 's' : '') + ' prête' + (avail.length > 1 ? 's' : '') + ' sur ' + items.length : ' · les ' + items.length + ' fiches sont prêtes'),
        bar(avail.length ? mastered.length / avail.length : 0, 'bar--ok'),
        next ? h('a', { class: 'btn btn--primary btn--block', href: '#/item/' + next.num + '/flash' },
          iconEl('flash'), (tested.length ? 'Continuer : ' : 'Commencer : ') + next.num + ' · ' + (next.short || '')) : null));
    }

    let section = null, list = null;
    items.forEach(function (it) {
      if (it.section !== section) {
        section = it.section;
        list = h('div', { class: 'list' });
        page.append(h('section', { class: 'ffl__group' },
          h('h2', { class: 'ffl__eyebrow' }, h('b', {}, 'Partie ' + it.section), it.sectionTitle || ''), list));
      }
      const st = statusOf(it, seen);
      list.append(h('a', { class: 'row ffl__row' + (st.key === 'soon' ? ' is-soon' : ''), href: '#/item/' + it.num + '/flash',
        'aria-label': 'Item ' + it.num + ', ' + (it.short || '') + ' : ' + st.label },
        h('span', { class: 'row__num' }, String(it.num)),
        h('div', { class: 'row__main' },
          h('div', { class: 'row__title' }, it.short || it.title || ''),
          it.title && it.title !== it.short ? h('div', { class: 'row__sub' }, it.title) : null),
        h('span', { class: 'row__end' },
          h('span', { class: 'ffl__st ffl__st--' + st.key, title: st.title }, st.label),
          iconEl('chevron-right'))));
    });
    return page;
  }

  /* ---------- API ---------- */

  function render(params, query) {
    const num = str((params && (params.num || params.item)) || '');
    try {
      if (num) return renderItem(num, query || (params && params.query) || {});
      return renderList();
    } catch (e) {
      console.error('[flash] rendu', e);
      return errorPage(num || '', 'Une erreur est survenue en affichant les fiches flash.');
    }
  }

  CARDIO.views.flash = { render: render, renderList: renderList, renderItem: renderItem, statusOf: statusOf, flashStat: flashStat, MASTERED: MASTERED };
})();
