/* CardioR2C — util.js
 * CARDIO.util : DOM builder, markdown-lite, formatting helpers, seeded random,
 * app-wide event bus and the inline SVG icon set (DESIGN.md §5).
 * Plain ES2020, classic script. Loaded first: creates the CARDIO namespace.
 */
(function () {
  'use strict';

  const C = (window.CARDIO = window.CARDIO || {});
  C.views = C.views || {};

  /* ------------------------------------------------------------------ */
  /* Escaping                                                             */
  /* ------------------------------------------------------------------ */

  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(str) {
    if (str == null) return '';
    return String(str).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
  }

  /* ------------------------------------------------------------------ */
  /* DOM builder                                                          */
  /* ------------------------------------------------------------------ */

  const SVG_NS = 'http://www.w3.org/2000/svg';
  // Tags that are unambiguously SVG (no HTML element shares the name).
  const SVG_TAGS = new Set([
    'svg', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'g', 'defs',
    'text', 'tspan', 'use', 'symbol', 'clipPath', 'mask', 'pattern', 'linearGradient',
    'radialGradient', 'stop', 'marker', 'foreignObject', 'animate', 'animateTransform'
  ]);
  // Attributes that are booleans in HTML: `true` → present, falsy → absent.
  const BOOL_ATTRS = new Set([
    'disabled', 'hidden', 'checked', 'selected', 'required', 'readonly', 'open', 'autofocus',
    'multiple', 'inert', 'autoplay', 'controls', 'loop', 'muted', 'novalidate', 'draggable'
  ]);

  function setClass(el, value) {
    let cls = '';
    if (Array.isArray(value)) cls = value.filter(Boolean).join(' ');
    else if (value && typeof value === 'object') {
      cls = Object.keys(value).filter((k) => value[k]).join(' ');
    } else if (value != null && value !== false) cls = String(value);
    if (cls) el.setAttribute('class', cls);
  }

  function setStyle(el, value) {
    if (typeof value === 'string') { el.style.cssText = value; return; }
    if (value && typeof value === 'object') {
      for (const k of Object.keys(value)) {
        const v = value[k];
        if (v == null || v === false) continue;
        if (k.startsWith('--')) el.style.setProperty(k, String(v));
        else el.style[k] = String(v);
      }
    }
  }

  function append(el, child) {
    if (child == null || child === false || child === true) return;
    if (Array.isArray(child)) { for (const c of child) append(el, c); return; }
    if (child instanceof Node) { el.appendChild(child); return; }
    if (typeof child === 'string' || typeof child === 'number') {
      el.appendChild(document.createTextNode(String(child)));
      return;
    }
    // Anything else (plain object…) is a programming error: render as text, loudly.
    console.warn('[CARDIO.util.h] enfant inattendu', child);
    el.appendChild(document.createTextNode(String(child)));
  }

  /**
   * h(tag, attrs, ...children) — build a DOM element.
   * attrs: class/className (string | array | object), id, dataset:{…}, style (string | object),
   *        on:{event: handler}, html (TRUSTED string, output of md() only), ref(el), value,
   *        boolean attributes (disabled, hidden, checked…) and any other attribute as string.
   * children: strings/numbers → text nodes, Nodes, arrays (flattened), null/false/undefined skipped.
   * The second argument may itself be a child when no attrs are needed: h('p', 'texte').
   */
  function h(tag, attrs, ...children) {
    const isSvg = SVG_TAGS.has(tag);
    const el = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    if (attrs != null && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
      children.unshift(attrs);
      attrs = null;
    }
    if (attrs) {
      for (const key of Object.keys(attrs)) {
        const v = attrs[key];
        if (v == null) continue;
        switch (key) {
          case 'class':
          case 'className':
            setClass(el, v); break;
          case 'dataset':
            if (v && typeof v === 'object') {
              for (const dk of Object.keys(v)) if (v[dk] != null) el.dataset[dk] = String(v[dk]);
            }
            break;
          case 'style':
            setStyle(el, v); break;
          case 'on':
            if (v && typeof v === 'object') {
              for (const evt of Object.keys(v)) {
                const fn = v[evt];
                if (typeof fn === 'function') el.addEventListener(evt, fn);
                else if (Array.isArray(fn) && typeof fn[0] === 'function') el.addEventListener(evt, fn[0], fn[1]);
              }
            }
            break;
          case 'html':
            el.innerHTML = String(v); break;
          case 'ref':
            if (typeof v === 'function') v(el); break;
          case 'value':
            if (isSvg) el.setAttribute('value', String(v)); else el.value = String(v);
            break;
          default:
            if (BOOL_ATTRS.has(key)) {
              if (v === true || v === '' || v === key) el.setAttribute(key, '');
              else if (v) el.setAttribute(key, String(v));
              // false → attribute absent
            } else if (typeof v === 'boolean') {
              // aria-pressed="true" style attributes are strings
              el.setAttribute(key, v ? 'true' : 'false');
            } else {
              el.setAttribute(key, String(v));
            }
        }
      }
    }
    for (const c of children) append(el, c);
    return el;
  }

  /** frag(...children) → DocumentFragment. */
  function frag(...children) {
    const f = document.createDocumentFragment();
    for (const c of children) append(f, c);
    return f;
  }

  /** fromHTML(trustedHtml) → first element (or a fragment when several roots). Trusted input only. */
  function fromHTML(html) {
    const t = document.createElement('template');
    t.innerHTML = String(html || '').trim();
    return t.content.childNodes.length === 1 ? t.content.firstChild : t.content;
  }

  const qs = (sel, root) => (root || document).querySelector(sel);
  const qsa = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ------------------------------------------------------------------ */
  /* Markdown-lite (SPEC §2.5)                                            */
  /* ------------------------------------------------------------------ */

  const RE_LIST = /^(\s*)(?:([-*•])|(\d+)[.)])\s+(.*)$/;
  const RE_HEAD = /^\s*#{1,6}\s+(.*)$/;
  const RE_QUOTE = /^\s*>\s?(.*)$/;
  const RE_TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  const RE_HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

  /** Inline formatting on an already-escaped line. */
  function inline(s) {
    return s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/\[([AB])\]/g, '<span class="pill pill--$1" title="Rang $1">$1</span>');
  }

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((c) => c.trim());
  }

  /**
   * md(text) → HTML string. Supported: paragraphs (blank-line separated), **bold**, *italic*,
   * '- ' bullets (nesting by indentation), '1. ' numbered lists, '### ' sub-headings,
   * pipe tables with a |---| row, '> ' callouts, inline [A]/[B] rank pills. Source is escaped first.
   */
  function md(text) {
    if (text == null || text === '') return '';
    const lines = esc(String(text)).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let para = [];       // pending paragraph lines
    let quote = null;    // pending callout lines
    let table = null;    // pending table lines
    const lists = [];    // open lists stack: {type, indent, liOpen}

    const flushPara = () => {
      if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; }
    };
    const closeLists = (depth) => {
      while (lists.length > depth) {
        const l = lists.pop();
        if (l.liOpen) out.push('</li>');
        out.push(l.type === 'ul' ? '</ul>' : '</ol>');
      }
    };
    const flushQuote = () => {
      if (quote) {
        // Recursive render so callouts can hold bold titles, lists, pills…
        out.push('<div class="callout">' + mdRaw(quote.join('\n')) + '</div>');
        quote = null;
      }
    };
    const flushTable = () => {
      if (!table) return;
      const rows = table.map(splitRow);
      const sepIdx = table.findIndex((l) => RE_TABLE_SEP.test(l));
      let head = null, body = rows;
      if (sepIdx > 0) { head = rows[0]; body = rows.filter((_, i) => i !== 0 && i !== sepIdx); }
      else if (sepIdx === 0) body = rows.slice(1);
      let html = '<div class="md-table"><table>';
      if (head) html += '<thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead>';
      html += '<tbody>' + body.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody>';
      html += '</table></div>';
      out.push(html);
      table = null;
    };
    const flushAll = () => { flushPara(); flushQuote(); flushTable(); closeLists(0); };

    // The core loop, reused recursively for callout bodies.
    function mdRaw(src) {
      // Nested call: render with an isolated state and return the string.
      const saved = { out: out.splice(0), para, quote, table, lists: lists.splice(0) };
      para = []; quote = null; table = null;
      run(src.split('\n'));
      const html = out.splice(0).join('');
      out.push(...saved.out); para = saved.para; quote = saved.quote; table = saved.table; lists.push(...saved.lists);
      return html;
    }

    function run(ls) {
      for (const raw of ls) {
        const line = raw.replace(/\s+$/, '');
        if (!line.trim()) { flushAll(); continue; }

        // Callout '> '
        const mq = RE_QUOTE.exec(line);
        if (mq) { flushPara(); flushTable(); closeLists(0); (quote = quote || []).push(mq[1]); continue; }
        flushQuote();

        // Table rows
        if (line.trim().startsWith('|') && line.trim().length > 1) {
          flushPara(); closeLists(0); (table = table || []).push(line); continue;
        }
        flushTable();

        // Heading
        const mh = RE_HEAD.exec(line);
        if (mh) { flushPara(); closeLists(0); out.push('<h4 class="md-h">' + inline(mh[1].trim()) + '</h4>'); continue; }

        // Horizontal rule
        if (RE_HR.test(line)) { flushPara(); closeLists(0); out.push('<hr>'); continue; }

        // List item
        const ml = RE_LIST.exec(line);
        if (ml) {
          flushPara();
          const indent = ml[1].replace(/\t/g, '  ').length;
          const type = ml[2] ? 'ul' : 'ol';
          while (lists.length && lists[lists.length - 1].indent > indent) closeLists(lists.length - 1);
          const top = lists[lists.length - 1];
          if (top && top.indent === indent) {
            if (top.type !== type) { closeLists(lists.length - 1); out.push('<' + type + '>'); lists.push({ type, indent, liOpen: false }); }
            else if (top.liOpen) out.push('</li>');
          } else {
            out.push('<' + type + '>');
            lists.push({ type, indent, liOpen: false });
          }
          out.push('<li>' + inline(ml[4]));
          lists[lists.length - 1].liOpen = true;
          continue;
        }

        // Continuation line inside an open list item (indented text) → same item
        if (lists.length && /^\s{2,}/.test(raw)) { out.push('<br>' + inline(line.trim())); continue; }

        closeLists(0);
        para.push(line.trim());
      }
      flushAll();
    }

    run(lines);
    return out.join('');
  }

  /* ------------------------------------------------------------------ */
  /* Ids, random                                                          */
  /* ------------------------------------------------------------------ */

  let uidCounter = 0;
  function uid() {
    uidCounter += 1;
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + uidCounter.toString(36);
  }

  /** 32-bit string hash (cyrb-style), for seeding from strings. */
  function hash(str) {
    let h1 = 0x811c9dc5;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h1 ^= s.charCodeAt(i);
      h1 = Math.imul(h1, 0x01000193);
    }
    return h1 >>> 0;
  }

  /** mulberry32 — returns a function () → [0, 1). Seed may be a number or a string. */
  function seededRandom(seed) {
    let a = (typeof seed === 'number' ? seed : hash(seed == null ? Math.random() : seed)) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Fisher–Yates on a copy. With a seed the order is reproducible. */
  function shuffle(arr, seed) {
    const a = Array.from(arr || []);
    const rnd = seed == null ? Math.random : seededRandom(seed);
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ------------------------------------------------------------------ */
  /* Dates & formatting (French)                                          */
  /* ------------------------------------------------------------------ */

  const pad2 = (n) => (n < 10 ? '0' : '') + n;

  function dateKey(d) {
    const x = d instanceof Date ? d : new Date(d);
    return x.getFullYear() + '-' + pad2(x.getMonth() + 1) + '-' + pad2(x.getDate());
  }
  const today = () => dateKey(new Date());
  const now = () => Date.now();

  /** addDays('2026-09-21', -1) → '2026-09-20' (local calendar). */
  function addDays(key, n) {
    const [y, m, d] = String(key).split('-').map(Number);
    const x = new Date(y, m - 1, d + n);
    return dateKey(x);
  }

  function toDate(v) {
    if (v instanceof Date) return v;
    if (typeof v === 'number') return new Date(v);
    if (typeof v === 'string') {
      // 'YYYY-MM-DD' must be parsed as LOCAL midnight (not UTC as the spec would do).
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
      if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
      return new Date(v);
    }
    return new Date(NaN);
  }

  function calendarDiffDays(a, b) {
    const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((da - db) / 86400000);
  }

  const NBSP = ' ';

  /**
   * fmtDate(iso | ms | Date, {relative, time, long, weekday}) → French string.
   * relative: "aujourd'hui", "hier", "demain", "il y a 3 j", "dans 5 j", else absolute date.
   */
  function fmtDate(v, opts) {
    opts = opts || {};
    const d = toDate(v);
    if (isNaN(d.getTime())) return '';
    const ref = new Date();
    const timeStr = opts.time ? ' à ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : '';
    if (opts.relative) {
      const diff = calendarDiffDays(d, ref);
      if (diff === 0) return "aujourd'hui" + timeStr;
      if (diff === -1) return 'hier' + timeStr;
      if (diff === 1) return 'demain' + timeStr;
      if (diff < 0 && diff > -7) return 'il y a ' + (-diff) + NBSP + 'j';
      if (diff > 0 && diff < 7) return 'dans ' + diff + NBSP + 'j';
    }
    const o = { day: 'numeric', month: opts.long ? 'long' : 'short' };
    if (opts.weekday) o.weekday = opts.long ? 'long' : 'short';
    if (d.getFullYear() !== ref.getFullYear() || opts.year) o.year = 'numeric';
    let s;
    try { s = new Intl.DateTimeFormat('fr-FR', o).format(d); }
    catch (e) { s = pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear(); }
    return s + timeStr;
  }

  /** fmtDuration(ms) → '45 s' | '12 min' | '1 h 05'. */
  function fmtDuration(ms) {
    const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    if (s < 60) return s + NBSP + 's';
    const m = Math.floor(s / 60);
    if (m < 60) return m + NBSP + 'min';
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    return mm ? hh + NBSP + 'h' + NBSP + pad2(mm) : hh + NBSP + 'h';
  }

  /** fmtNum(1234.5, 1) → '1 234,5' (French grouping with narrow no-break space). */
  function fmtNum(n, digits) {
    const v = Number(n) || 0;
    try {
      return new Intl.NumberFormat('fr-FR', {
        minimumFractionDigits: digits || 0, maximumFractionDigits: digits == null ? 0 : digits
      }).format(v);
    } catch (e) { return String(digits ? v.toFixed(digits) : Math.round(v)); }
  }

  /** pct(0.853) → '85 %'. */
  function pct(ratio, digits) {
    const v = Math.round((Number(ratio) || 0) * 100 * Math.pow(10, digits || 0)) / Math.pow(10, digits || 0);
    return fmtNum(v, digits || 0) + NBSP + '%';
  }

  /** plural(3, 'carte') → '3 cartes' ; plural(1, 'cheval', 'chevaux') → '1 cheval'. French: 0 and 1 singular. */
  function plural(n, s, p) {
    const v = Number(n) || 0;
    return fmtNum(v) + NBSP + pluralWord(v, s, p);
  }
  function pluralWord(n, s, p) {
    const v = Math.abs(Number(n) || 0);
    return v > 1 ? (p || s + 's') : s;
  }

  /* ------------------------------------------------------------------ */
  /* Functions & numbers                                                  */
  /* ------------------------------------------------------------------ */

  function debounce(fn, ms) {
    let t = null, lastArgs = null, lastThis = null;
    const d = function (...args) {
      lastArgs = args; lastThis = this;
      clearTimeout(t);
      t = setTimeout(() => { t = null; fn.apply(lastThis, lastArgs); }, ms);
    };
    d.cancel = () => { clearTimeout(t); t = null; };
    d.flush = () => { if (t) { clearTimeout(t); t = null; fn.apply(lastThis, lastArgs); } };
    d.pending = () => t != null;
    return d;
  }

  function throttle(fn, ms) {
    let last = 0, t = null, lastArgs = null, lastThis = null;
    return function (...args) {
      const nowT = Date.now();
      lastArgs = args; lastThis = this;
      const remaining = ms - (nowT - last);
      if (remaining <= 0) {
        clearTimeout(t); t = null; last = nowT; fn.apply(lastThis, lastArgs);
      } else if (!t) {
        t = setTimeout(() => { last = Date.now(); t = null; fn.apply(lastThis, lastArgs); }, remaining);
      }
    };
  }

  const clamp = (v, min, max) => Math.min(max, Math.max(min, Number(v) || 0));
  const sum = (arr) => (arr || []).reduce((a, b) => a + (Number(b) || 0), 0);
  const mean = (arr) => (arr && arr.length ? sum(arr) / arr.length : 0);

  /** normalize('Œdème aigu du poumon !') → 'oedeme aigu du poumon' (QROC matching). */
  function normalize(str) {
    return String(str == null ? '' : str)
      .toLowerCase()
      .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ------------------------------------------------------------------ */
  /* Safe localStorage                                                    */
  /* ------------------------------------------------------------------ */

  const ls = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }
  };

  /* ------------------------------------------------------------------ */
  /* Event bus                                                            */
  /* ------------------------------------------------------------------ */

  const bus = new Map();
  function on(evt, fn) {
    if (!bus.has(evt)) bus.set(evt, new Set());
    bus.get(evt).add(fn);
    return () => off(evt, fn);
  }
  function off(evt, fn) {
    const set = bus.get(evt);
    if (set) { set.delete(fn); if (!set.size) bus.delete(evt); }
  }
  function emit(evt, payload) {
    const set = bus.get(evt);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try { fn(payload); } catch (e) { console.error('[CARDIO.util.emit]', evt, e); }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Icons (DESIGN.md §5) — 24×24, stroke currentColor, 1.8, round caps   */
  /* ------------------------------------------------------------------ */

  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
    play: '<path d="M7.5 4.5v15l12-7.5z"/>',
    list: '<path d="M8.5 6h12M8.5 12h12M8.5 18h12"/><path d="M3.75 6h.01M3.75 12h.01M3.75 18h.01" stroke-width="2.6"/>',
    chart: '<path d="M3 21h18"/><path d="M6.5 21v-7M12 21V6M17.5 21v-10"/>',
    more: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    check: '<path d="M4.5 12.5l5 5 10-11"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    heart: '<path d="M12 20.5s-7.5-4.6-9.6-9C.9 8 3 4 6.8 4c2.2 0 3.9 1.2 5.2 2.9C13.3 5.2 15 4 17.2 4 21 4 23.1 8 21.6 11.5 19.5 15.9 12 20.5 12 20.5z"/>',
    'heart-pulse': '<path d="M12 20.5s-7.5-4.6-9.6-9C.9 8 3 4 6.8 4c2.2 0 3.9 1.2 5.2 2.9C13.3 5.2 15 4 17.2 4 21 4 23.1 8 21.6 11.5 19.5 15.9 12 20.5 12 20.5z"/><path d="M3.5 12h4l1.5-3 2.5 6.5 2-4.5 1.2 1.5h5.8"/>',
    flame: '<path d="M12 22c4.4 0 7-2.9 7-6.5 0-3.2-2.2-5.3-3.4-7.2-.5 1.3-1.3 2-2.1 2.3C13.9 8 13.5 4.6 10.5 2c.3 3.2-1.4 4.6-2.8 6.3C6.2 10.2 5 12 5 15.5 5 19.1 7.6 22 12 22z"/><path d="M12 22c-1.9 0-3-1.4-3-3.1 0-1.6 1-2.6 1.6-3.6.4.8.9 1.3 1.6 1.4.3-1 .2-2.1-.4-3 1.9 1.1 3.2 2.8 3.2 5.2 0 1.7-1.1 3.1-3 3.1z"/>',
    star: '<path d="M12 3l2.8 5.9 6.4.8-4.7 4.4 1.2 6.3L12 17.3l-5.7 3.1 1.2-6.3L2.8 9.7l6.4-.8z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    book: '<path d="M4 19.5V5.5A2.5 2.5 0 0 1 6.5 3H20v14H6.5A2.5 2.5 0 0 0 4 19.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
    tree: '<rect x="8.5" y="2.5" width="7" height="4.5" rx="1.2"/><rect x="2.5" y="15" width="7" height="4.5" rx="1.2"/><rect x="14.5" y="15" width="7" height="4.5" rx="1.2"/><path d="M12 7v3.5H6V15M12 10.5h6V15"/>',
    pill: '<g transform="rotate(-45 12 12)"><rect x="3" y="8.5" width="18" height="7" rx="3.5"/><path d="M12 8.5v7"/></g>',
    case: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M9 11h6M9 15h4"/>',
    ecg: '<path d="M2 12h4l2.5-6 3.5 12 3-9 1.5 3H22"/>',
    echo: '<path d="M12 3 3 17.5A11 11 0 0 0 21 17.5z"/><path d="M12 3l-5.2 9a7 7 0 0 0 10.4 0z"/>',
    flash: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    settings: '<path d="M4 6h8M16 6h4M4 12h2M10 12h10M4 18h10M18 18h2"/><circle cx="14" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
    download: '<path d="M12 3v12m0 0-4-4m4 4 4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    upload: '<path d="M12 15V3m0 0L8 7m4-4 4 4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>',
    filter: '<path d="M4 5h16l-6.5 8v6l-3 1.5V13z"/>',
    'chevron-down': '<path d="M6 9l6 6 6-6"/>',
    'chevron-right': '<path d="M9 6l6 6-6 6"/>',
    'chevron-left': '<path d="M15 5l-7 7 7 7"/>',
    'chevron-up': '<path d="M6 15l6-6 6 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    warning: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/>',
    trophy: '<path d="M8 4h8v6a4 4 0 0 1-8 0z"/><path d="M8 6H5.5A1.5 1.5 0 0 0 4 7.5V8a3 3 0 0 0 3 3M16 6h2.5A1.5 1.5 0 0 1 20 7.5V8a3 3 0 0 1-3 3"/><path d="M12 14v4M8 21h8M9.5 18h5v3"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off': '<path d="M10.6 6.3A9.7 9.7 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-2.7 3.3M6.6 6.6C3.7 8.6 2 12 2 12s3.5 6 10 6c1.4 0 2.7-.3 3.8-.7M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M4 4l16 16"/>',
    edit: '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13 8l3 3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    /* extras used by the shell / handy for views */
    minus: '<path d="M5 12h14"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    note: '<path d="M6 3h9l5 5v13H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5M3 17l9 5 9-5"/>',
    shuffle: '<path d="M3 6h3.5c2 0 3.5 1 4.5 3l2 6c1 2 2.5 3 4.5 3H21M3 18h3.5c1.4 0 2.5-.5 3.4-1.5M21 6h-3.5c-1.4 0-2.5.5-3.4 1.5"/><path d="M18 3l3 3-3 3M18 15l3 3-3 3"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    cloud: '<path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/>',
    'cloud-off': '<path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 16 7M20 16.5a4.5 4.5 0 0 0-2.5-7.5M4 4l16 16"/>',
    'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6M12 2v3"/>',
    dot: '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>'
  };
  const ICON_ALIASES = { close: 'x', stats: 'chart', items: 'list', review: 'play', zap: 'flash', warn: 'warning', alert: 'warning', ok: 'check', flashcard: 'flash', treatment: 'pill', tx: 'pill', cases: 'case', trees: 'tree', prev: 'chevron-left', next: 'chevron-right', up: 'chevron-up', down: 'chevron-down' };
  const warnedIcons = new Set();

  /** icon(name, {size, class, title}) → inline SVG string. Unknown names fall back to a dot (warned once). */
  function icon(name, opts) {
    opts = opts || {};
    let key = ICON_ALIASES[name] || name;
    let body = ICONS[key];
    if (!body) {
      if (!warnedIcons.has(name)) { warnedIcons.add(name); console.warn('[CARDIO.util.icon] icône inconnue :', name); }
      body = ICONS.dot;
      key = 'dot';
    }
    const size = opts.size || 24;
    const cls = 'icon icon--' + key + (opts.class ? ' ' + opts.class : '');
    const title = opts.title ? '<title>' + esc(opts.title) + '</title>' : '';
    const aria = opts.title ? ' role="img"' : ' aria-hidden="true"';
    return '<svg class="' + cls + '" xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"' +
      aria + ' focusable="false">' + title + body + '</svg>';
  }
  /** iconEl(name, opts) → SVG element. */
  function iconEl(name, opts) { return fromHTML(icon(name, opts)); }
  function iconNames() { return Object.keys(ICONS); }

  /* ------------------------------------------------------------------ */
  /* Domain labels                                                        */
  /* ------------------------------------------------------------------ */

  const KIND_LABELS = {
    qcm: 'QCM', qrm: 'QRM', qru: 'QRU', qroc: 'QROC', open: 'Ouverte', kfp: 'KFP', tcs: 'TCS',
    flash: 'Flash', tree: 'Arbre', tx: 'Traitement', case: 'Cas clinique', ecg: 'ECG', echo: 'Écho'
  };
  const KIND_ICONS = {
    qcm: 'list', qrm: 'list', qru: 'list', qroc: 'edit', open: 'note', kfp: 'target', tcs: 'layers',
    flash: 'flash', tree: 'tree', tx: 'pill', case: 'case', ecg: 'ecg', echo: 'echo'
  };
  /** kindLabel('qcm') → 'QCM' ; accepts question types too ('QRM' → 'QCM' unless exact requested). */
  function kindLabel(kind, exact) {
    const k = String(kind || '').toLowerCase();
    if (!exact && (k === 'qrm' || k === 'qru')) return 'QCM';
    return KIND_LABELS[k] || (kind ? String(kind) : '');
  }
  function kindIcon(kind) { return KIND_ICONS[String(kind || '').toLowerCase()] || 'list'; }
  /** kindPill('qcm') → <span class="pill pill--kind">QCM</span>. */
  function kindPill(kind) { return h('span', { class: 'pill pill--kind' }, kindLabel(kind)); }
  /** rankPill('A', {long}) → <span class="pill pill--A">A</span> (long → 'Rang A'). */
  function rankPill(rank, opts) {
    const r = String(rank || '').toUpperCase() === 'B' ? 'B' : 'A';
    return h('span', { class: 'pill pill--' + r, title: 'Rang ' + r, 'aria-label': 'Rang ' + r }, opts && opts.long ? 'Rang ' + r : r);
  }

  /* ------------------------------------------------------------------ */
  /* Export                                                               */
  /* ------------------------------------------------------------------ */

  C.util = {
    h, frag, fromHTML, esc, md, qs, qsa,
    uid, hash, shuffle, seededRandom,
    today, now, dateKey, addDays, fmtDate, fmtDuration, fmtNum, pct, plural, pluralWord,
    debounce, throttle, clamp, mean, sum, normalize, ls,
    on, off, emit,
    icon, iconEl, iconNames, kindLabel, kindIcon, kindPill, rankPill,
    NBSP
  };
})();
