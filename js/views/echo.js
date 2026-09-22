/* CardioR2C — app/js/views/echo.js
 *
 * CARDIO.views.echo : vue « Écho » d'un item (#/item/:num/echo).
 *   render(params)                 → Promise<HTMLElement> : liste des schémas de l'item, page d'un schéma
 *   renderQuiz(entry, {onGrade})   → HTMLElement : schéma + question + correction + boutons de grade
 *   schematic(name)                → SVGElement | null : dessin schématique (plax, psax, a4c, a2c, a5c,
 *                                    subcostal, doppler, mmode) ; 'none' → null
 *   figure(name)                   → <figure> : schéma + légende (pratique pour les autres vues)
 *   legend(name)                   → texte de légende
 *
 * Script classique ES2020, aucune dépendance au chargement : tout appel aux autres modules
 * (CARDIO.util, CARDIO.registry, CARDIO.store, CARDIO.srs, CARDIO.shell) se fait à l'exécution,
 * avec repli gracieux si le module manque.
 */
(function () {
  'use strict';

  window.CARDIO = window.CARDIO || {};
  CARDIO.views = CARDIO.views || {};

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var VIEW_W = 320;
  var VIEW_H = 240;

  var LEGENDS = {
    plax: 'Schéma simplifié — coupe parasternale grand axe',
    psax: 'Schéma simplifié — coupe parasternale petit axe (niveau mitral)',
    a4c: 'Schéma simplifié — coupe apicale 4 cavités',
    a2c: 'Schéma simplifié — coupe apicale 2 cavités',
    a5c: 'Schéma simplifié — coupe apicale 5 cavités',
    subcostal: 'Schéma simplifié — coupe sous-costale 4 cavités',
    doppler: 'Schéma simplifié — Doppler continu (enveloppe spectrale)',
    mmode: 'Schéma simplifié — mode TM (temps-mouvement)',
    none: ''
  };

  var GRADE_LABELS = [
    { grade: 1, key: 'a', label: 'Encore', cls: 'btn--danger' },
    { grade: 2, key: 'h', label: 'Difficile', cls: 'btn--secondary' },
    { grade: 3, key: 'g', label: 'Bien', cls: 'btn--primary' },
    { grade: 4, key: 'e', label: 'Facile', cls: 'btn--secondary' }
  ];

  /* ------------------------------------------------------------------ */
  /* Accès défensif aux autres modules                                   */
  /* ------------------------------------------------------------------ */

  var warned = {};
  function warnOnce(key, msg) {
    if (warned[key]) return;
    warned[key] = true;
    if (window.console && console.warn) console.warn('[views.echo] ' + msg);
  }

  function util() { return (window.CARDIO && CARDIO.util) || null; }

  function esc(s) {
    var U = util();
    if (U && typeof U.esc === 'function') return U.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** markdown-lite → HTML (repli : paragraphes échappés). */
  function mdHtml(text) {
    var U = util();
    if (U && typeof U.md === 'function') return U.md(text || '');
    warnOnce('md', 'CARDIO.util.md absent : rendu markdown minimal.');
    return String(text || '').split(/\n{2,}/).map(function (p) {
      return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  /**
   * Constructeur DOM : passe par CARDIO.util.h pour la création (class), puis gère lui-même
   * dataset / attributs / écouteurs / enfants pour ne dépendre d'aucune subtilité d'implémentation.
   * attrs : {class, dataset, attr:{...setAttribute}, on:{evt:fn}, text}
   */
  function h(tag, attrs, children) {
    attrs = attrs || {};
    var U = util();
    var el;
    if (U && typeof U.h === 'function') {
      el = U.h(tag, attrs['class'] ? { 'class': attrs['class'] } : {});
    } else {
      warnOnce('h', 'CARDIO.util.h absent : constructeur DOM de secours.');
      el = document.createElement(tag);
      if (attrs['class']) el.className = attrs['class'];
    }
    if (attrs.dataset) {
      Object.keys(attrs.dataset).forEach(function (k) { el.dataset[k] = attrs.dataset[k]; });
    }
    if (attrs.attr) {
      Object.keys(attrs.attr).forEach(function (k) {
        if (attrs.attr[k] != null) el.setAttribute(k, attrs.attr[k]);
      });
    }
    if (attrs.on) {
      Object.keys(attrs.on).forEach(function (evt) { el.addEventListener(evt, attrs.on[evt]); });
    }
    if (attrs.text != null) el.textContent = attrs.text;
    append(el, children);
    return el;
  }

  function append(el, children) {
    if (children == null || children === false) return;
    if (Array.isArray(children)) { children.forEach(function (c) { append(el, c); }); return; }
    if (typeof children === 'string' || typeof children === 'number') {
      el.appendChild(document.createTextNode(String(children)));
      return;
    }
    if (children.nodeType) el.appendChild(children);
  }

  /** Bloc markdown-lite (le HTML vient de util.md, qui échappe la source). */
  function mdBlock(text, cls) {
    var d = h('div', { 'class': 'md' + (cls ? ' ' + cls : '') });
    d.innerHTML = mdHtml(text);
    return d;
  }

  function pill(text, mod) {
    return h('span', { 'class': 'pill' + (mod ? ' pill--' + mod : ''), text: text });
  }

  function rankPill(rank) {
    var r = rank === 'B' ? 'B' : 'A';
    return pill('Rang ' + r, r);
  }

  /** Graine numérique stable à partir d'une chaîne (FNV-1a 32 bits). */
  function seedOf(str) {
    var s = String(str || 'echo');
    var hsh = 2166136261;
    for (var i = 0; i < s.length; i++) {
      hsh ^= s.charCodeAt(i);
      hsh = Math.imul(hsh, 16777619) >>> 0;
    }
    return hsh >>> 0;
  }

  /** Mélange déterministe (util.shuffle si présent, sinon Fisher-Yates + mulberry32). */
  function shuffle(arr, seed) {
    var U = util();
    if (U && typeof U.shuffle === 'function') {
      try {
        var out = U.shuffle(arr.slice(), seed);
        if (Array.isArray(out) && out.length === arr.length) return out;
      } catch (e) { /* repli local ci-dessous */ }
    }
    var a = arr.slice();
    var t = seed >>> 0;
    function rnd() {
      t = (t + 0x6D2B79F5) >>> 0;
      var x = Math.imul(t ^ (t >>> 15), 1 | t);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    }
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function nowMs() {
    var U = util();
    return (U && typeof U.now === 'function') ? U.now() : Date.now();
  }

  function toast(msg, tone) {
    var S = window.CARDIO && CARDIO.shell;
    if (S && typeof S.toast === 'function') { S.toast(msg, { tone: tone || 'info' }); }
  }

  function haptic() {
    try {
      var st = window.CARDIO && CARDIO.store && CARDIO.store.state;
      var on = !st || !st.profile || st.profile.haptics !== false;
      if (on && navigator.vibrate) navigator.vibrate(10);
    } catch (e) { /* silencieux */ }
  }

  function scrollTop() {
    var v = document.getElementById('view');
    if (v) v.scrollTop = 0;
    try { window.scrollTo(0, 0); } catch (e) { /* silencieux */ }
  }

  /* ------------------------------------------------------------------ */
  /* Styles propres à la vue (tokens uniquement)                          */
  /* ------------------------------------------------------------------ */

  var STYLE_ID = 'cardio-echo-style';
  var CSS = [
    /* minmax(0,1fr) : un tableau large ne doit jamais élargir la page (il défile dans son conteneur) */
    '.echo-page{display:grid;gap:12px;grid-template-columns:minmax(0,1fr)}',
    '.echo-page>*{min-width:0}',
    '.echo-page h2{font-family:var(--font-display);font-size:1.375rem;margin:0}',
    '.echo-sub{color:var(--muted);font-size:.875rem;margin:0}',
    '.echo-chips{display:flex;gap:8px;flex-wrap:wrap}',
    '.echo-list{display:grid;gap:12px;margin:0;padding:0;list-style:none;grid-template-columns:minmax(0,1fr)}',
    '.echo-item{display:flex;align-items:center;gap:12px;width:100%;text-align:left;cursor:pointer;',
    '  border:0;font:inherit;color:inherit;min-height:44px}',
    '.echo-item:focus-visible{outline:2px solid var(--blue);outline-offset:2px}',
    '.echo-item__thumb{width:76px;flex:0 0 76px}',
    '.echo-item__thumb svg{width:100%;height:auto;display:block;border-radius:var(--r-s);background:var(--surface-2)}',
    '.echo-item__thumb svg text{display:none}',
    '.echo-item__body{flex:1;min-width:0;display:grid;gap:4px}',
    '.echo-item__title{font-weight:600}',
    '.echo-item__meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:.75rem;color:var(--muted)}',
    '.echo-item__chev{color:var(--muted);flex:0 0 auto}',
    '.echo-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}',
    '.echo-head h2{flex:1 1 100%}',
    '.echo-fig{margin:12px 0}',
    '.echo-fig svg{width:100%;height:auto;display:block;border-radius:var(--r-s);background:var(--surface-2)}',
    '.echo-fig figcaption{font-size:.75rem;color:var(--muted);margin-top:6px;text-transform:uppercase;letter-spacing:.06em}',
    '.echo-sec-title{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);',
    '  margin:14px 0 6px;font-weight:600}',
    '.echo-findings{margin:0;padding-left:20px;display:grid;gap:4px}',
    '.echo-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:6px 0;max-width:100%}',
    '.echo-table{width:100%;min-width:360px;border-collapse:collapse;font-size:.875rem}',
    '.echo-table th,.echo-table td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}',
    '.echo-table th{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600}',
    '.echo-table td:nth-child(2){font-variant-numeric:tabular-nums}',
    '.echo-src{font-size:.75rem;color:var(--muted);margin:12px 0 0}',
    '.echo-nav{display:flex;gap:8px;justify-content:space-between;align-items:center}',
    '.echo-nav .btn{flex:1}',
    '.echo-quiz{outline:none}',
    '.echo-quiz__stem{font-weight:600;margin:12px 0 8px}',
    '.echo-quiz__opts{display:grid;gap:8px}',
    '.echo-quiz .opt{display:flex;align-items:center;gap:12px;width:100%;min-height:52px;padding:8px 12px;',
    '  border:1px solid var(--line);border-radius:var(--r-s);background:var(--surface);color:var(--ink);',
    '  font:inherit;text-align:left;cursor:pointer;transition:background 200ms ease,border-color 160ms ease}',
    '.echo-quiz .opt:focus-visible{outline:2px solid var(--blue);outline-offset:2px}',
    '.echo-quiz .opt__key{flex:0 0 28px;height:28px;border-radius:999px;display:inline-flex;align-items:center;',
    '  justify-content:center;font-size:.75rem;font-weight:600;background:var(--surface-2);color:var(--ink-2)}',
    '.echo-quiz .opt.is-selected{border-color:var(--blue);background:var(--blue-soft)}',
    '.echo-quiz .opt.is-selected .opt__key{background:var(--blue);color:var(--surface)}',
    '.echo-quiz .opt.is-correct{border-color:var(--ok);background:var(--ok-soft)}',
    '.echo-quiz .opt.is-correct .opt__key{background:var(--ok);color:var(--surface)}',
    '.echo-quiz .opt.is-wrong{border-color:var(--bad);background:var(--bad-soft)}',
    '.echo-quiz .opt.is-wrong .opt__key{background:var(--bad);color:var(--surface)}',
    '.echo-quiz .opt.is-missed{border-color:var(--ok);border-style:dashed}',
    '.echo-quiz .opt.is-neutral{opacity:.7}',
    '.echo-quiz .opt[disabled]{cursor:default}',
    '@media (prefers-reduced-motion:no-preference){',
    '  .echo-quiz .opt.is-wrong.is-selected{animation:echo-shake 220ms cubic-bezier(.2,.7,.2,1)}',
    '  @keyframes echo-shake{0%{transform:translateX(0)}30%{transform:translateX(-6px)}60%{transform:translateX(5px)}100%{transform:translateX(0)}}',
    '}',
    '.echo-quiz__actions{margin-top:12px}',
    '.echo-quiz__feedback{margin:12px 0 0;font-weight:600}',
    '.echo-quiz__feedback.is-ok{color:var(--ok)}',
    '.echo-quiz__feedback.is-bad{color:var(--bad)}',
    '.echo-reveal{margin-top:12px;border-top:1px solid var(--line);padding-top:4px}',
    '.echo-grades{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px}',
    '.echo-grades .btn{display:flex;flex-direction:column;gap:2px;padding:6px 4px;line-height:1.2}',
    '.echo-grades .btn small{font-size:.7rem;font-weight:400;opacity:.8}',
    '.echo-grades .btn.is-suggested{outline:2px solid var(--blue);outline-offset:2px}',
    '.echo-grades .btn.is-chosen{box-shadow:inset 0 0 0 2px var(--ink)}',
    '.echo-empty{text-align:center;padding:32px 16px;color:var(--muted);display:grid;gap:12px;justify-items:center}',
    '.echo-empty p{margin:0}',
    '@media (min-width:900px){.echo-item__thumb{width:112px;flex-basis:112px}}'
  ].join('\n');

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ------------------------------------------------------------------ */
  /* Schémas SVG                                                          */
  /* ------------------------------------------------------------------ */

  function svg(tag, attrs, children) {
    var el = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (attrs[k] != null) el.setAttribute(k, attrs[k]);
      });
    }
    append(el, children);
    return el;
  }

  function root() {
    var s = svg('svg', {
      viewBox: '0 0 ' + VIEW_W + ' ' + VIEW_H,
      width: '100%',
      role: 'img',
      'aria-hidden': 'false',
      style: 'font-family:var(--font-body);'
    });
    return s;
  }

  /** Cavité / structure : contour encre, remplissage d'un token à faible opacité. */
  function shape(d, tone, opacity, extra) {
    var attrs = {
      d: d,
      style: 'stroke:var(--ink);fill:var(--' + (tone || 'ink') + ');fill-opacity:' + (opacity == null ? 0.14 : opacity) +
        ';stroke-width:2;stroke-linejoin:round;stroke-linecap:round;'
    };
    if (extra) Object.keys(extra).forEach(function (k) { attrs[k] = extra[k]; });
    return svg('path', attrs);
  }

  function circle(cx, cy, r, tone, opacity, extraStyle) {
    return svg('circle', {
      cx: cx, cy: cy, r: r,
      style: 'stroke:var(--ink);stroke-width:2;fill:var(--' + (tone || 'ink') + ');fill-opacity:' +
        (opacity == null ? 0.14 : opacity) + ';' + (extraStyle || '')
    });
  }

  /** Feuillet valvulaire : trait épais, arrondi. */
  function leaflet(x1, y1, x2, y2, tone) {
    return svg('line', {
      x1: x1, y1: y1, x2: x2, y2: y2,
      style: 'stroke:var(--' + (tone || 'ink') + ');stroke-width:3.5;stroke-linecap:round;'
    });
  }

  function line(x1, y1, x2, y2, style) {
    return svg('line', { x1: x1, y1: y1, x2: x2, y2: y2, style: style || 'stroke:var(--ink);stroke-width:1.5;' });
  }

  /**
   * Libellé lisible sur les remplissages : halo de la couleur de fond (paint-order).
   * opts : {size, weight, muted, anchor, rotate, tone}
   */
  function label(x, y, text, opts) {
    opts = opts || {};
    var attrs = {
      x: x, y: y,
      'text-anchor': opts.anchor || 'middle',
      'dominant-baseline': 'middle',
      'paint-order': 'stroke',
      style: 'font-size:' + (opts.size || 13) + 'px;font-weight:' + (opts.weight || 600) + ';' +
        'fill:var(--' + (opts.tone || (opts.muted ? 'muted' : 'ink')) + ');' +
        'stroke:var(--surface-2);stroke-width:3px;stroke-linejoin:round;'
    };
    if (opts.rotate) attrs.transform = 'rotate(' + opts.rotate + ' ' + x + ' ' + y + ')';
    return svg('text', attrs, text);
  }

  /** Petit repère de la sonde (position du transducteur). */
  function probe(x, y) {
    return svg('rect', {
      x: x - 12, y: y, width: 24, height: 5, rx: 2,
      style: 'fill:var(--muted);'
    });
  }

  function polar(cx, cy, r, deg) {
    var a = deg * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }
  function fmt(n) { return Math.round(n * 10) / 10; }

  /* --- coupe parasternale grand axe ------------------------------------ */
  function drawPlax(s) {
    s.appendChild(probe(160, 3));
    // VD, antérieur (en haut)
    s.appendChild(shape('M 36 42 C 90 26, 160 28, 214 44 L 214 74 C 160 66, 90 72, 36 84 Z', 'blue', 0.16));
    // VG, avec chambre de chasse continue vers l'aorte
    s.appendChild(shape('M 30 102 C 22 150, 40 202, 110 214 C 162 222, 200 192, 206 146 L 206 84 C 150 86, 90 92, 30 102 Z', 'accent', 0.12));
    // Racine aortique
    s.appendChild(shape('M 206 84 L 300 50 L 300 96 L 206 118 Z', 'accent', 0.2));
    // OG, sous l'aorte
    s.appendChild(shape('M 206 122 L 300 100 L 300 200 C 260 214, 220 200, 206 170 Z', 'accent', 0.08));
    // Valve aortique (2 sigmoïdes visibles)
    s.appendChild(leaflet(212, 90, 228, 98));
    s.appendChild(leaflet(212, 112, 228, 104));
    // Valve mitrale : grande valve antérieure et petite valve postérieure, ouvertes vers le VG
    s.appendChild(leaflet(206, 124, 184, 152));
    s.appendChild(leaflet(206, 170, 190, 160));
    // Libellés
    s.appendChild(label(120, 58, 'VD'));
    s.appendChild(label(110, 158, 'VG'));
    s.appendChild(label(278, 74, 'Ao'));
    s.appendChild(label(236, 66, 'VAo', { size: 10 }));
    s.appendChild(label(258, 160, 'OG'));
    s.appendChild(label(170, 164, 'VM', { size: 10 }));
    s.appendChild(label(120, 86, 'SIV', { size: 9, muted: true }));
    s.appendChild(label(112, 228, 'paroi postérieure', { size: 9, muted: true }));
  }

  /* --- coupe parasternale petit axe, niveau mitral --------------------- */
  function drawPsax(s) {
    s.appendChild(probe(160, 3));
    var cx = 185, cy = 132;
    // Croissant du VD autour du VG (antéro-gauche)
    var o1 = polar(cx, cy, 112, 170), o2 = polar(cx, cy, 112, 300);
    var i1 = polar(cx, cy, 84, 170), i2 = polar(cx, cy, 84, 300);
    s.appendChild(shape(
      'M ' + fmt(o1[0]) + ' ' + fmt(o1[1]) + ' A 112 112 0 0 1 ' + fmt(o2[0]) + ' ' + fmt(o2[1]) +
      ' L ' + fmt(i2[0]) + ' ' + fmt(i2[1]) + ' A 84 84 0 0 0 ' + fmt(i1[0]) + ' ' + fmt(i1[1]) + ' Z',
      'blue', 0.16));
    // Myocarde du VG (anneau) puis cavité
    s.appendChild(circle(cx, cy, 82, 'accent', 0.18));
    s.appendChild(circle(cx, cy, 54, 'surface', 1));
    // Valve mitrale en « bouche de poisson »
    s.appendChild(shape('M 145 132 Q 185 110 225 132 Q 185 154 145 132 Z', 'accent', 0.1, { style: 'stroke:var(--ink);stroke-width:3;fill:var(--accent);fill-opacity:.1;stroke-linejoin:round;' }));
    s.appendChild(line(150, 132, 220, 132, 'stroke:var(--ink);stroke-width:1.5;stroke-dasharray:3 3;'));
    // Libellés
    var vd = polar(cx, cy, 98, 235);
    s.appendChild(label(fmt(vd[0]), fmt(vd[1]), 'VD'));
    s.appendChild(label(cx, 98, 'VG'));
    s.appendChild(label(cx, 170, 'VM', { size: 10 }));
    var siv = polar(cx, cy, 68, 205);
    s.appendChild(label(fmt(siv[0]), fmt(siv[1]), 'SIV', { size: 9, muted: true }));
    var lat = polar(cx, cy, 68, 20);
    s.appendChild(label(fmt(lat[0]), fmt(lat[1]), 'lat.', { size: 9, muted: true }));
    var post = polar(cx, cy, 68, 100);
    s.appendChild(label(fmt(post[0]), fmt(post[1]), 'post.', { size: 9, muted: true }));
  }

  /* --- coupe apicale 4 cavités (option 5 cavités) ---------------------- */
  function drawA4c(s, fifth) {
    s.appendChild(probe(160, 3));
    // Ventricules, apex en haut
    s.appendChild(shape('M 154 40 C 110 46, 78 80, 78 140 L 150 142 Z', 'blue', 0.16));           // VD
    s.appendChild(shape('M 166 40 C 220 44, 254 84, 252 148 L 172 150 Z', 'accent', 0.12));       // VG
    // Oreillettes (rétrécies en 5 cavités pour laisser passer l'aorte)
    if (fifth) {
      s.appendChild(shape('M 78 150 L 142 152 L 142 224 C 100 226, 72 200, 78 150 Z', 'blue', 0.16));     // OD
      s.appendChild(shape('M 182 156 L 250 154 C 258 200, 228 228, 182 226 Z', 'accent', 0.08));         // OG
      s.appendChild(shape('M 150 150 L 176 150 L 190 226 L 138 226 Z', 'accent', 0.22));                 // CCVG → Ao
      s.appendChild(leaflet(152, 160, 162, 170));
      s.appendChild(leaflet(174, 160, 164, 170));
      s.appendChild(label(163, 184, 'VAo', { size: 9 }));
      s.appendChild(label(163, 208, 'Ao'));
    } else {
      s.appendChild(shape('M 78 150 L 150 152 L 150 224 C 100 226, 72 200, 78 150 Z', 'blue', 0.16));     // OD
      s.appendChild(shape('M 172 156 L 250 154 C 258 200, 228 228, 172 226 Z', 'accent', 0.08));         // OG
      s.appendChild(label(161, 190, 'SIA', { size: 9, muted: true, rotate: -90 }));
    }
    // Valve tricuspide (plus apicale) et valve mitrale
    s.appendChild(leaflet(84, 142, 112, 130));
    s.appendChild(leaflet(146, 141, 126, 132));
    s.appendChild(leaflet(176, 150, 204, 136));
    s.appendChild(leaflet(248, 150, 222, 138));
    // Libellés
    s.appendChild(label(112, 100, 'VD'));
    s.appendChild(label(210, 100, 'VG'));
    s.appendChild(label(fifth ? 108 : 112, 190, 'OD'));
    s.appendChild(label(fifth ? 218 : 212, 192, 'OG'));
    s.appendChild(label(114, 158, 'VT', { size: 10 }));
    s.appendChild(label(214, 166, 'VM', { size: 10 }));
    s.appendChild(label(161, 96, 'SIV', { size: 9, muted: true, rotate: -90 }));
    s.appendChild(label(160, 30, 'apex', { size: 9, muted: true }));
  }

  /* --- coupe apicale 2 cavités ----------------------------------------- */
  function drawA2c(s) {
    s.appendChild(probe(160, 3));
    s.appendChild(shape('M 160 36 C 226 40, 246 100, 240 154 L 84 154 C 76 100, 96 40, 160 36 Z', 'accent', 0.12)); // VG
    s.appendChild(shape('M 90 160 L 234 160 C 244 210, 200 232, 160 232 C 120 232, 80 210, 90 160 Z', 'accent', 0.08)); // OG
    s.appendChild(leaflet(92, 156, 118, 142));
    s.appendChild(leaflet(232, 156, 206, 142));
    s.appendChild(label(160, 96, 'VG'));
    s.appendChild(label(160, 200, 'OG'));
    s.appendChild(label(160, 146, 'VM', { size: 10 }));
    s.appendChild(label(104, 112, 'paroi inf.', { size: 9, muted: true }));
    s.appendChild(label(220, 112, 'paroi ant.', { size: 9, muted: true }));
    s.appendChild(label(160, 28, 'apex', { size: 9, muted: true }));
  }

  /* --- coupe sous-costale : 4 cavités + foie + VCI --------------------- */
  function drawSubcostal(s) {
    s.appendChild(probe(18, 3));
    // Foie, interposé entre la sonde et le cœur
    s.appendChild(shape('M 0 0 L 230 0 C 236 34, 170 76, 100 112 C 60 132, 30 124, 0 112 Z', 'warn', 0.18));
    s.appendChild(label(58, 46, 'Foie'));
    // Cœur, basculé : VD au contact du foie
    var g = svg('g', { transform: 'rotate(-25 210 150)' });
    g.appendChild(shape('M 250 104 L 246 30 L 272 30 L 276 104 Z', 'blue', 0.16));                    // VCI → OD
    g.appendChild(shape('M 118 106 C 150 92, 190 96, 208 104 L 208 146 L 118 146 Z', 'blue', 0.16));   // VD
    g.appendChild(shape('M 118 152 L 208 152 L 208 192 C 190 206, 150 208, 118 194 Z', 'accent', 0.12)); // VG
    g.appendChild(shape('M 214 104 C 250 92, 290 100, 300 120 L 300 146 L 214 146 Z', 'blue', 0.16));  // OD
    g.appendChild(shape('M 214 152 L 300 152 L 300 180 C 290 204, 250 212, 214 196 Z', 'accent', 0.08)); // OG
    g.appendChild(leaflet(212, 110, 196, 124));
    g.appendChild(leaflet(212, 144, 198, 134));
    g.appendChild(leaflet(212, 156, 196, 170));
    g.appendChild(leaflet(212, 192, 198, 180));
    g.appendChild(label(162, 126, 'VD'));
    g.appendChild(label(162, 174, 'VG'));
    g.appendChild(label(258, 126, 'OD'));
    g.appendChild(label(258, 176, 'OG'));
    g.appendChild(label(261, 62, 'VCI', { size: 10 }));
    g.appendChild(label(226, 98, 'VT', { size: 9 }));
    g.appendChild(label(226, 204, 'VM', { size: 9 }));
    s.appendChild(g);
  }

  /* --- Doppler continu : enveloppe spectrale + curseur Vmax ------------ */
  function drawDoppler(s) {
    var base = 54;          // ligne de base
    var perMs = 40;         // 40 px par m/s
    var vmax = 4;           // vitesse du pic dessiné
    var peakY = base + vmax * perMs;

    // Mini ECG de synchronisation
    var ecg = 'M 24 30';
    [66, 206].forEach(function (bx) {
      ecg += ' L ' + (bx - 8) + ' 30 L ' + (bx - 4) + ' 25 L ' + bx + ' 40 L ' + (bx + 3) + ' 18 L ' + (bx + 7) + ' 30';
    });
    ecg += ' L 312 30';
    s.appendChild(svg('path', { d: ecg, style: 'fill:none;stroke:var(--muted);stroke-width:1.2;' }));

    // Axes : vitesse (vers le bas = flux s'éloignant de la sonde) et temps
    s.appendChild(line(24, base, 312, base, 'stroke:var(--ink);stroke-width:1.5;'));
    s.appendChild(line(24, base, 24, 226, 'stroke:var(--ink);stroke-width:1.5;'));
    for (var v = 1; v <= 4; v++) {
      var y = base + v * perMs;
      s.appendChild(line(20, y, 28, y));
      s.appendChild(label(12, y, String(v), { size: 9, muted: true, weight: 500 }));
    }
    s.appendChild(label(12, 232, 'm/s', { size: 9, muted: true, weight: 500 }));

    // Deux enveloppes systoliques (couche large claire + noyau dense)
    [[56, 166], [196, 306]].forEach(function (seg) {
      var x0 = seg[0], x1 = seg[1], xm = (x0 + x1) / 2;
      var outer = 'M ' + x0 + ' ' + base + ' C ' + (x0 + 20) + ' ' + (base + 100) + ', ' + (xm - 22) + ' ' + peakY + ', ' + xm + ' ' + peakY +
        ' C ' + (xm + 22) + ' ' + peakY + ', ' + (x1 - 20) + ' ' + (base + 100) + ', ' + x1 + ' ' + base + ' Z';
      var inner = 'M ' + (x0 + 10) + ' ' + base + ' C ' + (x0 + 26) + ' ' + (base + 90) + ', ' + (xm - 14) + ' ' + (peakY - 14) + ', ' + xm + ' ' + (peakY - 12) +
        ' C ' + (xm + 14) + ' ' + (peakY - 14) + ', ' + (x1 - 26) + ' ' + (base + 90) + ', ' + (x1 - 10) + ' ' + base + ' Z';
      s.appendChild(svg('path', { d: outer, style: 'fill:var(--ink);fill-opacity:.22;stroke:var(--ink);stroke-width:1.5;stroke-linejoin:round;' }));
      s.appendChild(svg('path', { d: inner, style: 'fill:var(--ink);fill-opacity:.35;stroke:none;' }));
    });

    // Curseur Vmax
    s.appendChild(line(24, peakY, 312, peakY, 'stroke:var(--accent);stroke-width:1.5;stroke-dasharray:4 3;'));
    s.appendChild(svg('circle', { cx: 111, cy: peakY, r: 4, style: 'fill:var(--accent);stroke:var(--surface-2);stroke-width:1.5;' }));
    s.appendChild(label(140, peakY - 9, 'Vmax', { size: 11, tone: 'accent', anchor: 'start' }));

    // Annotation du gradient (double flèche entre ligne de base et pic)
    var ax = 181;
    s.appendChild(line(ax, base + 6, ax, peakY - 6, 'stroke:var(--accent);stroke-width:1.5;'));
    s.appendChild(svg('path', { d: 'M ' + (ax - 4) + ' ' + (base + 10) + ' L ' + ax + ' ' + (base + 4) + ' L ' + (ax + 4) + ' ' + (base + 10), style: 'fill:none;stroke:var(--accent);stroke-width:1.5;' }));
    s.appendChild(svg('path', { d: 'M ' + (ax - 4) + ' ' + (peakY - 10) + ' L ' + ax + ' ' + (peakY - 4) + ' L ' + (ax + 4) + ' ' + (peakY - 10), style: 'fill:none;stroke:var(--accent);stroke-width:1.5;' }));
    s.appendChild(label(ax, 134, 'ΔP', { size: 11, tone: 'accent' }));
    s.appendChild(label(ax, 147, 'gradient', { size: 8, tone: 'accent', weight: 500 }));
  }

  /* --- Mode TM : parois septale et postérieure ------------------------- */
  function drawMmode(s) {
    var x0 = 24, x1 = 312, period = 96, step = 4;
    var septBase = 95, postBase = 190;

    // Bosse systolique (0 en diastole, 1 au pic), période normalisée
    function bump(t) {
      var u = (t - 0.15) / 0.5;
      return (u >= 0 && u <= 1) ? Math.sin(Math.PI * u) : 0;
    }
    function wave(base, amp, offset) {
      var d = '';
      for (var x = x0; x <= x1; x += step) {
        var t = ((x - x0) % period) / period;
        var y = base + amp * bump(t) + (offset || 0);
        d += (d ? ' L ' : 'M ') + x + ' ' + fmt(y);
      }
      return d;
    }
    function stroke(d, w, tone) {
      return svg('path', { d: d, style: 'fill:none;stroke:var(--' + (tone || 'ink') + ');stroke-width:' + w + ';stroke-linejoin:round;' });
    }

    // Mini ECG
    var ecg = 'M ' + x0 + ' 18';
    for (var k = 0; k < 3; k++) {
      var bx = x0 + k * period + Math.round(0.12 * period);
      ecg += ' L ' + (bx - 8) + ' 18 L ' + (bx - 4) + ' 14 L ' + bx + ' 26 L ' + (bx + 3) + ' 8 L ' + (bx + 7) + ' 18';
    }
    ecg += ' L ' + x1 + ' 18';
    s.appendChild(svg('path', { d: ecg, style: 'fill:none;stroke:var(--muted);stroke-width:1.2;' }));

    // Paroi antérieure du VD (quasi immobile), septum (2 bords), paroi postérieure (2 bords), péricarde
    s.appendChild(stroke(wave(40, 2), 1.5, 'ink-2'));
    s.appendChild(stroke(wave(septBase, 12), 2));
    s.appendChild(stroke(wave(septBase, 12, 8), 2));
    s.appendChild(stroke(wave(postBase, -16), 2.5));
    s.appendChild(stroke(wave(postBase, -16, 10), 2));
    s.appendChild(line(x0, 214, x1, 214, 'stroke:var(--ink);stroke-width:3;'));

    // Mesures : diamètres télédiastolique et télésystolique
    function dim(x, ya, yb, txt) {
      s.appendChild(line(x, ya, x, yb, 'stroke:var(--accent);stroke-width:1.5;'));
      s.appendChild(line(x - 5, ya, x + 5, ya, 'stroke:var(--accent);stroke-width:1.5;'));
      s.appendChild(line(x - 5, yb, x + 5, yb, 'stroke:var(--accent);stroke-width:1.5;'));
      s.appendChild(label(x + 14, (ya + yb) / 2, txt, { size: 10, tone: 'accent', anchor: 'start' }));
    }
    var xd = x0 + Math.round(0.02 * period) + period;             // télédiastole (avant la bosse)
    var xs = x0 + Math.round(0.40 * period) + period;             // pic systolique
    dim(xd, septBase + 8, postBase, 'DTD');
    dim(xs, septBase + 12 + 8, postBase - 16, 'DTS');

    // Libellés et axe du temps
    s.appendChild(label(x1 - 6, 40, 'VD', { size: 10, anchor: 'end' }));
    s.appendChild(label(x1 - 6, septBase + 4, 'SIV', { size: 10, anchor: 'end' }));
    s.appendChild(label(x1 - 6, 140, 'VG', { size: 10, anchor: 'end' }));
    s.appendChild(label(x1 - 6, postBase + 5, 'PP', { size: 10, anchor: 'end' }));
    s.appendChild(label(x1 - 6, 221, 'péricarde', { size: 8, muted: true, anchor: 'end' }));
    s.appendChild(line(x0, 230, x1, 230, 'stroke:var(--muted);stroke-width:1;'));
    for (var x = x0; x <= x1; x += period / 4) s.appendChild(line(x, 228, x, 232, 'stroke:var(--muted);stroke-width:1;'));
    s.appendChild(label(x0 + 2, 236, 'temps →', { size: 8, muted: true, anchor: 'start', weight: 500 }));
  }

  var DRAWERS = {
    plax: drawPlax,
    psax: drawPsax,
    a4c: function (s) { drawA4c(s, false); },
    a5c: function (s) { drawA4c(s, true); },
    a2c: drawA2c,
    subcostal: drawSubcostal,
    doppler: drawDoppler,
    mmode: drawMmode
  };

  /** Dessin schématique ; null pour 'none' ou un nom inconnu (avertissement console). */
  function schematic(name) {
    var key = String(name || 'none');
    if (key === 'none') return null;
    var draw = DRAWERS[key];
    if (!draw) {
      warnOnce('schem-' + key, 'schéma inconnu « ' + key + ' »');
      return null;
    }
    var s = root();
    s.appendChild(svg('title', null, LEGENDS[key]));
    draw(s);
    return s;
  }

  function legend(name) { return LEGENDS[String(name || 'none')] || ''; }

  /** <figure> avec le dessin et sa légende ; null si rien à dessiner. */
  function figure(name) {
    var s = schematic(name);
    if (!s) return null;
    return h('figure', { 'class': 'echo-fig' }, [s, h('figcaption', { text: legend(name) })]);
  }

  /* ------------------------------------------------------------------ */
  /* Blocs de contenu d'une entrée                                        */
  /* ------------------------------------------------------------------ */

  function findingsBlock(entry) {
    var list = Array.isArray(entry.findings) ? entry.findings.filter(Boolean) : [];
    if (!list.length) return null;
    return h('div', null, [
      h('div', { 'class': 'echo-sec-title', text: 'Signes échographiques' }),
      h('ul', { 'class': 'echo-findings' }, list.map(function (f) {
        var li = h('li');
        li.innerHTML = mdHtml(String(f)).replace(/^<p>|<\/p>$/g, '');
        return li;
      }))
    ]);
  }

  function measuresBlock(entry) {
    var ms = Array.isArray(entry.measures) ? entry.measures : [];
    if (!ms.length) return null;
    var rows = ms.map(function (m) {
      return h('tr', null, [
        h('td', { text: m.label || '—' }),
        h('td', { text: m.severe || '—' }),
        h('td', null, rankPill(m.rank))
      ]);
    });
    var table = h('table', { 'class': 'echo-table' }, [
      h('thead', null, h('tr', null, [
        h('th', { text: 'Mesure' }),
        h('th', { text: 'Seuil de sévérité' }),
        h('th', { text: 'Rang' })
      ])),
      h('tbody', null, rows)
    ]);
    return h('div', null, [
      h('div', { 'class': 'echo-sec-title', text: 'Mesures et seuils' }),
      h('div', { 'class': 'echo-table-wrap' }, table)
    ]);
  }

  function descriptionBlock(entry) {
    if (!entry.description) return null;
    return h('div', null, [
      h('div', { 'class': 'echo-sec-title', text: 'En pratique' }),
      mdBlock(entry.description)
    ]);
  }
  /* Le titre d'un schéma (« Rétrécissement aortique serré »…) donne quasiment toujours la
   * réponse du quiz : on ne l'affiche jamais avant que l'utilisateur ait répondu. */
  function isBlind(entry) {
    var q = entry && entry.quiz;
    return !!(q && Array.isArray(q.options) && q.options.length >= 2 && typeof q.correct === 'number');
  }
  function blindLabel(entry, idx) {
    return isBlind(entry) ? ('Schéma n°' + (idx + 1)) : (entry.title || 'Schéma');
  }
  function titleRevealBlock(entry) {
    if (!isBlind(entry) || !entry.title) return null;
    return h('h3', { 'class': 'echo-reveal__title', text: entry.title });
  }

  function srcLine(entry) {
    if (!entry.src) return null;
    return h('p', { 'class': 'echo-src', text: 'Source : Collège de cardiologie, ' + entry.src });
  }

  /* ------------------------------------------------------------------ */
  /* Quiz                                                                 */
  /* ------------------------------------------------------------------ */

  function gradeButtons(entry, score, onChoose) {
    var wrap = h('div', { 'class': 'echo-grades', attr: { role: 'group', 'aria-label': 'Comment tu t\'en es sorti ?' } });
    var suggested = score >= 0.99 ? 3 : (score >= 0.5 ? 2 : 1);
    var previews = null;
    try {
      var S = window.CARDIO && CARDIO.store, R = window.CARDIO && CARDIO.srs;
      if (S && R && typeof S.card === 'function' && typeof R.nextIntervalsPreview === 'function') {
        previews = R.nextIntervalsPreview(S.card(entry.id), nowMs());
      }
    } catch (e) { previews = null; }
    var buttons = GRADE_LABELS.map(function (g) {
      var b = h('button', {
        'class': 'btn btn--sm ' + g.cls + (g.grade === suggested ? ' is-suggested' : ''),
        attr: { type: 'button', 'data-grade': String(g.grade) }
      }, [g.label, previews && previews[g.grade] ? h('small', { text: previews[g.grade] }) : null]);
      b.addEventListener('click', function () {
        buttons.forEach(function (x) { x.disabled = true; x.classList.remove('is-suggested'); });
        b.classList.add('is-chosen');
        onChoose(g.grade);
      });
      return b;
    });
    append(wrap, buttons);
    wrap._choose = function (key) {
      var g = GRADE_LABELS.filter(function (x) { return x.key === key; })[0];
      if (!g) return;
      var b = buttons[GRADE_LABELS.indexOf(g)];
      if (b && !b.disabled) b.click();
    };
    return wrap;
  }

  /**
   * renderQuiz(entry, {onGrade}) → élément autonome : schéma, question à choix unique (options mélangées
   * de façon déterministe à partir de entry.id), « Valider », correction, révélation des mesures et de la
   * description, puis boutons de grade → onGrade(grade, score, {ms, correct}).
   */
  function renderQuiz(entry, opts) {
    ensureStyles();
    opts = opts || {};
    entry = entry || {};
    var onGrade = typeof opts.onGrade === 'function' ? opts.onGrade : function () {};
    var startedAt = nowMs();
    var wrap = h('div', { 'class': 'echo-quiz', dataset: { id: entry.id || '' } });
    wrap.tabIndex = -1;

    var head = h('div', { 'class': 'echo-head' }, [
      pill('Écho', 'kind'), rankPill(entry.rank),
      h('h2', { text: isBlind(entry) ? 'Schéma à interpréter' : (entry.title || 'Schéma') })
    ]);
    wrap.appendChild(head);
    var fig = figure(entry.schematic);
    if (fig) wrap.appendChild(fig);

    var reveal = h('div', { 'class': 'echo-reveal' }, [titleRevealBlock(entry), findingsBlock(entry), measuresBlock(entry), descriptionBlock(entry), srcLine(entry)]);
    var gradesHost = h('div');
    var graded = false;

    function finish(score, correct) {
      var grades = gradeButtons(entry, score, function (grade) {
        if (graded) return;
        graded = true;
        onGrade(grade, score, { ms: nowMs() - startedAt, correct: correct });
      });
      gradesHost.appendChild(h('div', { 'class': 'echo-sec-title', text: 'Comment tu t\'en es sorti ?' }));
      gradesHost.appendChild(grades);
      wrap._grades = grades;
    }

    var quiz = entry.quiz;
    var hasQuiz = quiz && Array.isArray(quiz.options) && quiz.options.length >= 2 && typeof quiz.correct === 'number';

    if (!hasQuiz) {
      // Pas de question : auto-évaluation après lecture.
      wrap.appendChild(h('p', { 'class': 'echo-sub', text: 'Pas de question pour ce schéma : relis les signes et les seuils, puis évalue-toi.' }));
      wrap.appendChild(reveal);
      wrap.appendChild(gradesHost);
      var selfGrades = gradeButtons(entry, 1, function (grade) {
        if (graded) return;
        graded = true;
        var score = grade >= 3 ? 1 : (grade === 2 ? 0.5 : 0);
        onGrade(grade, score, { ms: nowMs() - startedAt, correct: null });
      });
      gradesHost.appendChild(h('div', { 'class': 'echo-sec-title', text: 'Comment tu t\'en es sorti ?' }));
      gradesHost.appendChild(selfGrades);
      wrap._grades = selfGrades;
      wrap.addEventListener('keydown', function (ev) {
        if (wrap._grades && /^[ahge]$/i.test(ev.key)) { wrap._grades._choose(ev.key.toLowerCase()); ev.preventDefault(); }
      });
      return wrap;
    }

    // Options mélangées ; on garde l'index d'origine pour retrouver la bonne réponse.
    var order = quiz.options.map(function (t, i) { return { t: String(t), i: i }; });
    order = shuffle(order, seedOf(entry.id || quiz.stem));
    var selected = -1;
    var validated = false;

    wrap.appendChild(h('div', { 'class': 'echo-quiz__stem' }, mdBlock(quiz.stem || 'Quel est le diagnostic ?')));
    var rows = order.map(function (o, pos) {
      var key = String.fromCharCode(65 + pos);
      var row = h('button', {
        'class': 'opt',
        attr: { type: 'button', 'aria-pressed': 'false', 'data-pos': String(pos) }
      }, [h('span', { 'class': 'opt__key', text: key }), h('span', { 'class': 'opt__text', text: o.t })]);
      row.addEventListener('click', function () { select(pos); });
      return row;
    });
    var optsEl = h('div', { 'class': 'echo-quiz__opts', attr: { role: 'group', 'aria-label': 'Réponses' } }, rows);
    wrap.appendChild(optsEl);

    var validateBtn = h('button', { 'class': 'btn btn--primary btn--block', attr: { type: 'button' }, text: 'Valider' });
    validateBtn.disabled = true;
    validateBtn.addEventListener('click', validate);
    wrap.appendChild(h('div', { 'class': 'echo-quiz__actions' }, validateBtn));

    var feedback = h('p', { 'class': 'echo-quiz__feedback', attr: { 'aria-live': 'polite' } });
    wrap.appendChild(feedback);
    wrap.appendChild(gradesHost);

    function select(pos) {
      if (validated) return;
      selected = pos;
      rows.forEach(function (r, i) {
        r.classList.toggle('is-selected', i === pos);
        r.setAttribute('aria-pressed', i === pos ? 'true' : 'false');
      });
      validateBtn.disabled = false;
    }

    function validate() {
      if (validated || selected < 0) return;
      validated = true;
      haptic();
      var correct = order[selected].i === quiz.correct;
      rows.forEach(function (r, i) {
        r.disabled = true;
        var isCorrect = order[i].i === quiz.correct;
        r.classList.remove('is-selected');
        if (isCorrect) r.classList.add('is-correct');
        else if (i === selected) r.classList.add('is-wrong', 'is-selected');
        else r.classList.add('is-neutral');
      });
      feedback.textContent = correct ? 'Juste.' : 'Faux — regarde pourquoi.';
      feedback.classList.add(correct ? 'is-ok' : 'is-bad');
      validateBtn.disabled = true;
      validateBtn.textContent = correct ? 'Bonne réponse' : 'Réponse attendue en vert';
      wrap.insertBefore(reveal, gradesHost);
      finish(correct ? 1 : 0, correct);
    }

    wrap.addEventListener('keydown', function (ev) {
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
      var k = ev.key;
      if (!validated && /^[1-9]$/.test(k)) {
        var pos = parseInt(k, 10) - 1;
        if (pos < rows.length) { select(pos); ev.preventDefault(); }
      } else if (!validated && k === 'Enter') {
        if (selected >= 0) { validate(); ev.preventDefault(); }
      } else if (validated && wrap._grades && /^[ahge]$/i.test(k)) {
        wrap._grades._choose(k.toLowerCase());
        ev.preventDefault();
      }
    });

    return wrap;
  }

  /* ------------------------------------------------------------------ */
  /* Vue : liste + page d'un schéma                                       */
  /* ------------------------------------------------------------------ */

  function emptyState(msg, num) {
    var back = h('a', { 'class': 'btn btn--secondary', attr: { href: num ? '#/item/' + num : '#/items' }, text: num ? 'Retour à l\'item' : 'Voir les items' });
    return h('div', { 'class': 'card echo-empty' }, [h('p', { text: msg }), back]);
  }

  function recordAttempt(entry, num, grade, score, extra) {
    var S = window.CARDIO && CARDIO.store;
    if (!S || typeof S.recordAttempt !== 'function') {
      warnOnce('store', 'CARDIO.store.recordAttempt absent : la réponse n\'est pas enregistrée.');
      toast('Réponse non enregistrée (progression indisponible).', 'warn');
      return;
    }
    try {
      S.recordAttempt({
        cardId: entry.id, item: num, kind: 'echo', score: score, grade: grade,
        ms: extra && extra.ms ? extra.ms : 0,
        details: { correct: extra ? extra.correct : null, schematic: entry.schematic || 'none' }
      });
      toast('Réponse enregistrée.', 'ok');
    } catch (e) {
      warnOnce('record', 'recordAttempt a échoué : ' + (e && e.message));
      toast('Impossible d\'enregistrer la réponse.', 'bad');
    }
  }

  function buildList(host, num, meta, entries, open) {
    var filter = 'all';
    var listEl = h('ul', { 'class': 'echo-list' });
    var chips = h('div', { 'class': 'echo-chips', attr: { role: 'group', 'aria-label': 'Filtre par rang' } });

    function chip(label, value) {
      var c = h('button', { 'class': 'chip' + (value === filter ? ' is-on' : ''), attr: { type: 'button', 'aria-pressed': value === filter ? 'true' : 'false' }, text: label });
      c.addEventListener('click', function () {
        filter = value;
        Array.prototype.forEach.call(chips.children, function (x) {
          var on = x === c;
          x.classList.toggle('is-on', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        fill();
      });
      return c;
    }
    append(chips, [chip('Tout', 'all'), chip('Rang A', 'A'), chip('Rang B', 'B')]);

    function fill() {
      listEl.textContent = '';
      var shown = entries.filter(function (e) { return filter === 'all' || (e.rank || 'A') === filter; });
      if (!shown.length) {
        listEl.appendChild(h('li', { 'class': 'echo-sub', text: 'Aucun schéma de ce rang dans cet item.' }));
        return;
      }
      shown.forEach(function (e) {
        var idx = entries.indexOf(e);
        var blind = isBlind(e);
        var thumb = h('span', { 'class': 'echo-item__thumb', attr: { 'aria-hidden': 'true' } });
        var s = schematic(e.schematic);
        if (s) thumb.appendChild(s);
        var nMes = blind ? 0 : (Array.isArray(e.measures) ? e.measures.length : 0);
        var meta = h('span', { 'class': 'echo-item__meta' }, [
          rankPill(e.rank),
          blind ? null : h('span', { text: legend(e.schematic).replace(/^Schéma simplifié — /, '') || 'Sans schéma' }),
          nMes ? h('span', { text: '· ' + nMes + (nMes > 1 ? ' mesures' : ' mesure') }) : null,
          blind ? h('span', { text: '· quiz' }) : null
        ]);
        var btn = h('button', { 'class': 'card echo-item', attr: { type: 'button' } }, [
          thumb,
          h('span', { 'class': 'echo-item__body' }, [h('span', { 'class': 'echo-item__title', text: blindLabel(e, idx) }), meta]),
          h('span', { 'class': 'echo-item__chev', attr: { 'aria-hidden': 'true' }, text: '›' })
        ]);
        btn.addEventListener('click', function () { open(idx); });
        listEl.appendChild(h('li', null, btn));
      });
    }
    fill();

    var n = entries.length;
    host.textContent = '';
    append(host, [
      h('h2', { text: 'Écho — ' + (meta && meta.short ? meta.short : 'item ' + num) }),
      h('p', { 'class': 'echo-sub', text: n + (n > 1 ? ' schémas' : ' schéma') + ' : signes, seuils de sévérité et quiz. Touche un schéma pour l\'ouvrir.' }),
      chips,
      listEl
    ]);
  }

  function buildEntry(host, num, entries, idx, backToList, open) {
    var entry = entries[idx];
    // « signes, seuils de sévérité et quiz » (cf. sous-titre de la liste) : le schéma est
    // toujours présenté à l'aveugle d'abord — renderQuiz() masque lui-même le titre et la
    // description jusqu'à ce que l'utilisateur ait répondu (ou se soit auto-évalué).
    var quizCard = h('div', { 'class': 'card' });
    var q = renderQuiz(entry, {
      onGrade: function (grade, score, extra) {
        recordAttempt(entry, num, grade, score, extra);
        var hasNext = idx + 1 < entries.length;
        quizCard.appendChild(h('div', { 'class': 'echo-nav' }, [
          hasNext
            ? h('button', { 'class': 'btn btn--primary', attr: { type: 'button' }, text: 'Schéma suivant', on: { click: function () { open(idx + 1); } } })
            : h('button', { 'class': 'btn btn--primary', attr: { type: 'button' }, text: 'Tous les schémas', on: { click: backToList } })
        ]));
      }
    });
    quizCard.appendChild(q);

    var prev = h('button', { 'class': 'btn btn--secondary', attr: { type: 'button' }, text: '‹ Précédent' });
    var next = h('button', { 'class': 'btn btn--secondary', attr: { type: 'button' }, text: 'Suivant ›' });
    prev.disabled = idx === 0;
    next.disabled = idx >= entries.length - 1;
    prev.addEventListener('click', function () { open(idx - 1); });
    next.addEventListener('click', function () { open(idx + 1); });

    var back = h('button', { 'class': 'btn btn--ghost btn--sm', attr: { type: 'button' }, text: '‹ Tous les schémas' });
    back.addEventListener('click', backToList);

    host.textContent = '';
    append(host, [
      h('div', null, back),
      h('p', { 'class': 'echo-sub', text: 'Schéma ' + (idx + 1) + ' sur ' + entries.length }),
      quizCard,
      h('div', { 'class': 'echo-nav' }, [prev, next])
    ]);
    try { q.focus({ preventScroll: true }); } catch (e) { /* silencieux */ }
    scrollTop();
  }

  /**
   * render(params) pour '#/item/:num/echo'. params.num (ou params.item) ; params.entry (id) ouvre
   * directement un schéma. Retourne une Promise<HTMLElement> (le contenu est chargé paresseusement).
   */
  function render(params) {
    ensureStyles();
    params = params || {};
    var num = String(params.num || params.item || '').trim();
    var page = h('div', { 'class': 'page echo-page', dataset: { view: 'echo', item: num } });
    page.appendChild(h('div', { 'class': 'echo-empty' }, h('p', { text: 'Chargement des schémas…' })));

    var R = window.CARDIO && CARDIO.registry;
    if (!num) {
      page.textContent = '';
      page.appendChild(emptyState('Aucun item précisé : choisis un item pour voir ses schémas d\'écho.', ''));
      return Promise.resolve(page);
    }
    if (!R || typeof R.load !== 'function') {
      warnOnce('registry', 'CARDIO.registry.load absent : impossible de charger le contenu.');
      page.textContent = '';
      page.appendChild(emptyState('Le contenu n\'est pas encore disponible. Réessaie dans un instant.', num));
      return Promise.resolve(page);
    }

    return Promise.resolve()
      .then(function () { return R.load(num); })
      .then(function (content) {
        var data = content && content.echo && Array.isArray(content.echo.data) ? content.echo.data : [];
        var meta = (content && content.meta) || (typeof R.item === 'function' ? R.item(num) : null) || {};
        page.textContent = '';
        if (!data.length) {
          page.appendChild(emptyState('Pas de schéma d\'écho pour cet item : passe à la fiche ou aux QCM.', num));
          return page;
        }
        var host = h('div', { 'class': 'echo-page' });
        page.appendChild(host);

        function backToList() { buildList(host, num, meta, data, open); scrollTop(); }
        function open(i) {
          if (i < 0 || i >= data.length) return;
          buildEntry(host, num, data, i, backToList, open);
        }

        var wanted = params.entry || params.id;
        var start = wanted ? data.findIndex(function (e) { return e.id === wanted; }) : -1;
        if (start >= 0) open(start); else buildList(host, num, meta, data, open);
        return page;
      })
      .catch(function (err) {
        warnOnce('load-' + num, 'chargement de l\'item ' + num + ' impossible : ' + (err && err.message));
        page.textContent = '';
        page.appendChild(emptyState('Impossible de charger cet item pour le moment. Vérifie ta connexion et réessaie.', num));
        return page;
      });
  }

  CARDIO.views.echo = {
    render: render,
    renderQuiz: renderQuiz,
    schematic: schematic,
    figure: figure,
    legend: legend,
    LEGENDS: LEGENDS
  };
})();
