/* CardioR2C — views/edn.js
 * Rubrique « EDN / Partiels » : reproduit la plateforme des EDN (R2C) — docs/EDN_ANALYSE.md § c (barème), d (plateforme),
 * h (cahier des charges) ; données docs/EDN_BANK.md.
 * Données : CARDIO.registry.edn = {blocks: [{id, item, spe, kind: DP|KFP|QI|TCS, vignette, media, questions: [...]}],
 *   items: {key: {spe, nBlocks, nQ}}} (content/edn.js, généré par tools/_patches/_build_edn.py).
 * Routes : #/edn (accueil), #/edn/examen (épreuve EDN chronométrée), #/edn/entrainement, #/edn/partiels,
 *   #/edn/run (épreuve en cours), #/edn/resultat (bilan + correction de la dernière épreuve).
 * État de l'épreuve en cours : localStorage « cardio.edn.run.v1 », écrit à CHAQUE validation (seules les réponses
 *   validées comptent, comme sur la plateforme). Dernière copie corrigée : « cardio.edn.last.v1 ».
 * Progression synchronisée : CARDIO.store, clé « edn » = {attempts: [résumés], q: {questionId: {n, sum, last, at}}}.
 * Script classique ES2020.
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const C = window.CARDIO;
  C.views = C.views || {};

  function h() { return C.util.h.apply(null, arguments); }
  function put(el) {
    const kids = Array.prototype.slice.call(arguments, 1).flat(Infinity).filter(function (k) { return k != null && k !== false; });
    el.replaceChildren.apply(el, kids);
  }
  function icon(name, size) { try { return C.util.iconEl(name, { size: size || 18 }); } catch (e) { return null; } }
  function mdEl(s, cls) { return h('div', { class: ['edn-md', cls], html: C.util && C.util.md ? C.util.md(String(s || '')) : String(s || '') }); }
  function toast(msg, tone) { try { C.shell.toast(msg, tone ? { tone: tone } : undefined); } catch (e) { /* ignore */ } }
  function haptic(ms) { try { C.shell.haptic(ms); } catch (e) { /* ignore */ } }
  function lsGet(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function plural(n, s, p) { return n + ' ' + (n > 1 ? (p || s + 's') : s); }

  const LS_RUN = 'cardio.edn.run.v1';
  const LS_LAST = 'cardio.edn.last.v1';
  const LS_PREF = 'cardio.edn.pref.v1';
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const ANCHORS = ['Très peu probable', 'Peu probable', 'Ni plus ni moins', 'Probable', 'Très probable'];
  const ANCHOR_VAL = ['−2', '−1', '0', '+1', '+2'];
  const KIND_LABEL = { DP: 'Dossier progressif', KFP: 'KFP', QI: 'Question isolée', TCS: 'TCS' };
  const KIND_SHORT = { DP: 'DP', KFP: 'KFP', QI: 'QI', TCS: 'TCS' };
  const FMT_LABEL = { QRU: 'QRU', QRM: 'QRM', QRP: 'QRP', QRPL: 'QRP longue', QROC: 'QROC', TCS: 'TCS' };
  const SPE_LABEL = { all: 'Toutes', cardio: 'Cardio', dermato: 'Dermato', pneumo: 'Pneumo' };
  const PROPS_2026 = { DP: 0.49, KFP: 0.19, QI: 0.25, TCS: 0.07 };
  const PRESETS = [
    { id: 'mini', label: 'Mini', min: 30, q: 16 },
    { id: 'demi', label: 'Demi-UC', min: 90, q: 50 },
    { id: 'uc', label: 'UC complète', min: 180, q: 100 }
  ];
  const PARTIEL_WARN = 'Format simulé : la faculté ne publie pas le nombre de questions ni les proportions.';

  /* ================================================================ données */
  let IDX = null, IDX_SRC = null;
  function bank() {
    const b = (C.registry || {}).edn;
    return b && Array.isArray(b.blocks) ? b : { blocks: [], items: {} };
  }
  function index() {
    const b = bank();
    if (IDX && IDX_SRC === b) return IDX;
    IDX = { blocks: {}, q: {} };
    b.blocks.forEach(function (bl) {
      IDX.blocks[bl.id] = bl;
      (bl.questions || []).forEach(function (q, i) { IDX.q[q.id] = { q: q, b: bl, i: i }; });
    });
    IDX_SRC = b;
    return IDX;
  }
  function blockById(id) { return index().blocks[id] || null; }
  function available(spe) { return bank().blocks.some(function (b) { return !spe || spe === 'all' || b.spe === spe; }); }
  function activeSpe() { try { return C.store && C.store.activeSpe ? C.store.activeSpe() : 'all'; } catch (e) { return 'all'; } }
  function itemLabel(key) {
    try {
      const r = C.registry;
      const it = r && typeof r.item === 'function' ? r.item(key) : null;
      const lab = r && typeof r.label === 'function' ? r.label(key) : key;
      return 'Item ' + lab + (it && it.short ? ' · ' + it.short : '');
    } catch (e) { return 'Item ' + key; }
  }
  function qStat(id) { try { const v = C.store.get('edn.q.' + id); return v && v.n ? v : null; } catch (e) { return null; } }
  function nq(b) { return (b.questions || []).length; }

  /* ================================================================ barème (EDN_ANALYSE § c, h.2) */
  const A_FORMATS = { QRU: 1, QRP: 1, QROC: 1 };
  function codeOf(q) { return (q.rank === 'B' ? 'B' : 'A') + (A_FORMATS[q.format] ? 'A' : 'B'); }
  function isAA(q) { return codeOf(q) === 'AA'; }
  function good(k) { return k === 'true' || k === 'indisp'; }
  function fmt(x) { return String(Math.round(x * 100) / 100).replace('.', ','); }
  function ednScore(d) {
    try { if (C.srs && typeof C.srs.ednScore === 'function') return C.srs.ednScore(d); } catch (e) { /* ignore */ }
    return d === 0 ? 1 : d === 1 ? 0.5 : d === 2 ? 0.2 : 0;
  }
  /* normalisation QROC : minuscules, sans accents ni ponctuation, espaces réduits, pluriel simple (s/x final, mot > 3 lettres) */
  function norm(s) {
    return String(s || '').toLowerCase().replace(/\+/g, ' plus ').replace(/-(?=\s|$|[),.;:])/g, ' moins ').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/g, 'oe').replace(/æ/g, 'ae')
      .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
      .map(function (w) { return w.length > 3 && /[sx]$/.test(w) ? w.slice(0, -1) : w; }).join(' ');
  }
  function wordCount(s) { return String(s || '').trim().split(/\s+/).filter(Boolean).length; }
  const SELF = { exact: 1, partiel: 0.5, faux: 0 };
  const SELF_LABEL = { exact: 'exact', partiel: 'partiel', faux: 'faux' };

  /* scoreQ(q, a) → {score, pending, calc} ; a = {sel: [indices d'origine], text, tcs: 0..4, self: 'exact'|'partiel'|'faux'} */
  function scoreQ(q, a) {
    a = a || {};
    const f = q.format;
    const opts = q.options || [];
    const sel = Array.isArray(a.sel) ? a.sel.filter(function (i, k, arr) { return arr.indexOf(i) === k && i >= 0 && i < opts.length; }) : [];
    const has = function (i) { return sel.indexOf(i) >= 0; };
    const r = function (score, calc, pending) { return { score: score, calc: calc, pending: !!pending }; };
    if (f === 'QRM') {
      if (!sel.length) return r(0, 'aucune case cochée → 0');
      if (opts.some(function (o, i) { return o.key === 'inacc' && has(i); })) return r(0, 'inacceptable cochée → 0');
      if (opts.some(function (o, i) { return o.key === 'indisp' && !has(i); })) return r(0, 'indispensable non cochée → 0');
      const d = opts.filter(function (o, i) { return has(i) !== good(o.key); }).length;
      const s = ednScore(d);
      return r(s, (d === 0 ? 'aucune discordance' : d + ' discordance' + (d > 1 ? 's' : '')) + ' → ' + fmt(s));
    }
    if (f === 'QRU') {
      if (!sel.length) return r(0, 'aucune réponse → 0');
      return sel.length === 1 && good(opts[sel[0]].key) ? r(1, 'bonne réponse → 1') : r(0, 'mauvaise réponse → 0');
    }
    if (f === 'QRP' || f === 'QRPL') {
      const n = q.n || opts.filter(function (o) { return good(o.key); }).length;
      if (!sel.length) return r(0, 'aucune case cochée → 0');
      if (sel.length > n) return r(0, 'plus de ' + n + ' cases cochées → 0');
      if (opts.some(function (o, i) { return o.key === 'inacc' && has(i); })) return r(0, 'inacceptable cochée → 0');
      if (opts.some(function (o, i) { return o.key === 'indisp' && !has(i); })) return r(0, 'indispensable non cochée → 0');
      const x = opts.filter(function (o, i) { return has(i) && good(o.key); }).length;
      return r(x / n, x + '/' + n + ' → ' + fmt(x / n));
    }
    if (f === 'QROC') {
      const qr = q.qroc || {};
      const s = norm(a.text);
      if (!s) return r(0, 'pas de réponse → 0');
      if ((qr.reject || []).some(function (x) { return norm(x) === s; })) return r(0, 'réponse refusée → 0');
      if ((qr.exact || []).some(function (x) { return norm(x) === s; })) return r(1, 'réponse exacte → 1');
      if ((qr.partial || []).some(function (x) { return norm(x) === s; })) return r(0.5, 'réponse partiellement exacte → 0,5');
      if (a.self && SELF[a.self] != null) return r(SELF[a.self], 'auto-évaluation : ' + SELF_LABEL[a.self] + ' → ' + fmt(SELF[a.self]));
      return r(0, 'réponse non reconnue : à auto-évaluer', true);
    }
    if (f === 'TCS') {
      const p = (q.tcs && q.tcs.panel) || [];
      const m = Math.max.apply(null, p.concat([0]));
      const i = a.tcs;
      if (i == null || i < 0 || i > 4) return r(0, 'pas de réponse → 0');
      const s = m ? (p[i] || 0) / m : 0;
      return r(s, (p[i] || 0) + '/' + m + ' experts → ' + fmt(s));
    }
    return r(0, 'format inconnu → 0');
  }
  /* score d'une question dans une copie : non validée → 0 */
  function scoreInRun(q, run) {
    const a = run.ans[q.id];
    if (!a || !a.validated) return { score: 0, calc: 'non validée → 0', pending: false, unanswered: true };
    return scoreQ(q, a);
  }
  /* agrégation : notes /20 (double A simulé, globale, B ×2, partiels pondérés), détail par format, rang, item */
  function aggregate(run) {
    const rows = [];
    run.blocks.forEach(function (rb) {
      const b = blockById(rb.id);
      if (!b) return;
      b.questions.forEach(function (q) {
        const s = scoreInRun(q, run);
        const w = run.weights && run.weights[q.id] ? run.weights[q.id] : 1;
        rows.push({ q: q, b: b, s: s, w: w });
      });
    });
    const out = { rows: rows, n: rows.length, pending: rows.filter(function (r) { return r.s.pending; }).length };
    const sum = function (list, wf) {
      let p = 0, t = 0;
      list.forEach(function (r) { const w = wf ? wf(r) : 1; p += r.s.score * w; t += w; });
      return { pts: p, max: t, n: list.length, note: t ? p / t * 20 : 0 };
    };
    out.aa = sum(rows.filter(function (r) { return isAA(r.q); }));
    out.glob = sum(rows);
    out.globB2 = sum(rows, function (r) { return r.q.rank === 'B' ? 2 : 1; });
    out.part = sum(rows, function (r) { return r.w; });
    const group = function (keyf) {
      const g = {};
      rows.forEach(function (r) { const k = keyf(r); (g[k] = g[k] || []).push(r); });
      const o = {};
      Object.keys(g).forEach(function (k) { o[k] = sum(g[k]); });
      return o;
    };
    out.byFormat = group(function (r) { return r.q.format; });
    out.byRank = group(function (r) { return r.q.rank; });
    out.byCode = group(function (r) { return codeOf(r.q); });
    out.byItem = group(function (r) { return r.b.item; });
    out.byKind = group(function (r) { return r.b.kind; });
    return out;
  }

  /* ================================================================ composition des épreuves */
  function poolOf(spe) { return bank().blocks.filter(function (b) { return !spe || spe === 'all' || b.spe === spe; }); }
  function seenScore(b) {   // 0 jamais vu · 1 raté au dernier essai · 2 réussi
    const st = b.questions.map(function (q) { return qStat(q.id); });
    if (!st.some(Boolean)) return 0;
    const avg = st.reduce(function (n, s) { return n + (s ? s.last : 0); }, 0) / st.length;
    return avg < 0.75 ? 1 : 2;
  }
  function freshFirst(list) {
    const groups = [[], [], []];
    shuffle(list).forEach(function (b) { groups[seenScore(b)].push(b); });
    return groups[0].concat(groups[1], groups[2]);
  }
  /* compose(pool, N, props) : blocs choisis pour viser N questions avec les proportions (en questions) ; un type absent
     est compensé par les autres (on comble toujours le type le plus en retard parmi ceux qui ont encore des blocs) */
  function compose(pool, N, props) {
    const by = { DP: [], KFP: [], QI: [], TCS: [] };
    freshFirst(pool).forEach(function (b) { (by[b.kind] = by[b.kind] || []).push(b); });
    const got = { DP: 0, KFP: 0, QI: 0, TCS: 0 };
    const out = [];
    let total = 0, guard = 0;
    while (total < N && guard++ < 5000) {
      const kinds = Object.keys(by).filter(function (k) { return by[k].length; });
      if (!kinds.length) break;
      kinds.sort(function (a, b) { return ((props[b] || 0) * N - got[b]) - ((props[a] || 0) * N - got[a]); });
      const k = kinds[0];
      const bl = by[k].shift();
      if (total > 0 && total + nq(bl) > N * 1.15) continue;   // trop long pour le temps imparti : on passe
      out.push(bl); got[k] += nq(bl); total += nq(bl);
    }
    return out;
  }
  function partielBlocks(spe) {
    const pool = freshFirst(poolOf(spe));
    const dps = pool.filter(function (b) { return b.kind === 'DP'; });
    const kfps = pool.filter(function (b) { return b.kind === 'KFP'; });
    const qis = pool.filter(function (b) { return b.kind === 'QI'; });
    const out = [];
    let total = 0;
    const add = function (b) { out.push(b); total += nq(b); };
    const long = dps.filter(function (b) { return nq(b) >= 10; })[0];
    if (long) add(long);
    else dps.slice(0, 2).forEach(add);
    if (kfps.length) add(kfps[0]);
    qis.forEach(function (b) { if (total < 32) add(b); });
    // contenu insuffisant : on complète avec les autres dossiers / KFP jusqu'à ≈ 30 questions
    dps.concat(kfps).forEach(function (b) { if (total < 30 && out.indexOf(b) < 0 && total + nq(b) <= 35) add(b); });
    return out;
  }
  function makeRun(o) {
    const blocks = o.shuffleBlocks === false ? o.blocks : shuffle(o.blocks);
    const run = {
      v: 1, id: 'edn-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      mode: o.mode, title: o.title, spe: o.spe || 'all', createdAt: Date.now(),
      durationSec: o.durationSec || 0, endsAt: o.durationSec ? Date.now() + o.durationSec * 1000 : null,
      immediate: !!o.immediate, weights: null, alerts: {},
      blocks: blocks.map(function (b) {
        const order = {};
        b.questions.forEach(function (q) {
          if (q.options) order[q.id] = o.shuffleOptions === false ? q.options.map(function (x, i) { return i; }) : shuffle(q.options.map(function (x, i) { return i; }));
        });
        return { id: b.id, order: order };
      }),
      ans: {}, flags: {}, recorded: {}, cur: 0, done: false
    };
    if (o.weights) {
      run.weights = {};
      blocks.forEach(function (b) { b.questions.forEach(function (q) { run.weights[q.id] = 1 + Math.floor(Math.random() * 3); }); });
    }
    return run;
  }
  function runQuestions(run) {
    const out = [];
    run.blocks.forEach(function (rb) { const b = blockById(rb.id); if (b) b.questions.forEach(function (q) { out.push(q); }); });
    return out;
  }

  /* ================================================================ store */
  function record(q, score, prev) {
    const s = C.store;
    if (!s || !s.get || !s.set) return;
    const key = 'edn.q.' + q.id;
    const p = s.get(key) || {};
    const first = prev == null;
    const sum = (Number(p.sum) || 0) + score - (first ? 0 : prev);
    const n = (p.n | 0) + (first ? 1 : 0);
    s.set(key, { n: n, sum: Math.max(0, Math.min(n, Math.round(sum * 100) / 100)), last: score, at: Date.now() });
  }
  function saveAttempt(run, ag) {
    const s = C.store;
    if (!s || !s.get || !s.set) return;
    const list = (s.get('edn.attempts') || []).filter(function (a) { return a && a.id !== run.id; });
    list.push({ id: run.id, mode: run.mode, title: run.title, at: run.submittedAt || Date.now(), spe: run.spe, nQ: ag.n,
      dur: Math.round(((run.submittedAt || Date.now()) - run.createdAt) / 1000),
      note: Math.round((run.mode === 'partiel' ? ag.part.note : ag.glob.note) * 100) / 100,
      aa: run.mode === 'partiel' || !ag.aa.n ? null : Math.round(ag.aa.note * 100) / 100, nAA: ag.aa.n });
    s.set('edn.attempts', list.slice(-50));
  }

  /* ================================================================ styles */
  let styled = false;
  function ensureStyles() {
    if (styled) return; styled = true;
    document.head.appendChild(h('style', {}, [
      '.edn-hub .edn-mode{display:flex;gap:12px;align-items:flex-start;text-decoration:none;color:var(--ink)}',
      '.edn-hub .edn-mode:hover{text-decoration:none}',
      '.edn-mode__ico{flex:none;display:grid;place-items:center;width:44px;height:44px;border-radius:12px;background:var(--accent-soft);color:var(--accent)}',
      '.edn-mode__t{font-weight:700;font-size:1.05rem}',
      '.edn-seg{display:flex;flex-wrap:wrap;gap:6px}',
      '.edn-warn{border-left:4px solid var(--warn);background:var(--warn-soft);color:var(--ink);padding:10px 12px;border-radius:var(--r-s);font-size:.875rem}',
      '.edn-row{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}',
      '.edn-hist{display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--line);font-size:.9rem}',
      '.edn-hist:last-child{border-bottom:0}',
      /* épreuve */
      '.edn-run{padding-top:0}',
      '.edn-top{position:sticky;top:0;z-index:8;background:var(--bg);margin-inline:calc(-1 * var(--gutter));padding:8px var(--gutter) 6px;border-bottom:1px solid var(--line)}',
      '.edn-top__row{display:flex;align-items:center;gap:8px}',
      '.edn-top__title{flex:1 1 auto;min-width:0;font-weight:600;font-size:.875rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.edn-clock{font:700 1.05rem/1 var(--font-mono);font-variant-numeric:tabular-nums;padding:6px 8px;border-radius:8px;background:var(--surface-2)}',
      '.edn-clock.is-low{background:var(--bad-soft);color:var(--bad)}',
      '.edn-slide{position:relative;width:132px;height:36px;border-radius:18px;background:var(--bad-soft);overflow:hidden;flex:none}',
      '.edn-slide span{position:absolute;inset:0;display:flex;align-items:center;justify-content:flex-end;padding-right:10px;font-size:.7rem;font-weight:700;color:var(--bad);pointer-events:none;line-height:1.1;text-align:right}',
      '.edn-slide input{position:absolute;inset:0;width:100%;height:100%;margin:0;background:transparent;-webkit-appearance:none;appearance:none;cursor:pointer}',
      '.edn-slide input::-webkit-slider-thumb{-webkit-appearance:none;width:36px;height:36px;border-radius:50%;background:var(--bad);border:3px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3)}',
      '.edn-slide input::-moz-range-thumb{width:30px;height:30px;border-radius:50%;background:var(--bad);border:3px solid #fff}',
      '.edn-pills{display:flex;gap:10px;overflow-x:auto;scrollbar-width:thin;padding:8px 0 2px;-webkit-overflow-scrolling:touch}',
      '.edn-pg{display:flex;align-items:center;gap:4px;flex:none}',
      '.edn-pg__l{font-size:.7rem;font-weight:700;color:var(--muted);margin-right:2px;white-space:nowrap}',
      '.edn-pg.is-cur .edn-pg__l{color:var(--ink)}',
      '.edn-pill{position:relative;flex:none;min-width:28px;height:28px;padding:0 6px;border-radius:14px;border:1.5px solid #9AA3AE;background:#fff;color:#1A2230;font:600 .75rem/1 var(--font-sans,inherit);cursor:pointer}',
      '.edn-pill.is-draft{background:#F28C28;border-color:#C96A0E;color:#fff}',
      '.edn-pill.is-done{background:#2F6FDE;border-color:#1E4FAA;color:#fff}',
      '.edn-pill.is-future{border-style:dashed;opacity:.45;cursor:not-allowed}',
      '.edn-pill.is-cur{box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--ink)}',
      '.edn-pill.is-flag::after{content:"";position:absolute;top:-4px;right:-4px;width:10px;height:10px;border-radius:50%;background:var(--bad);border:2px solid var(--bg)}',
      '.edn-legend{display:flex;gap:10px;flex-wrap:wrap;font-size:.7rem;color:var(--muted);margin-top:4px}',
      '.edn-legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px;vertical-align:-1px;border:1px solid #9AA3AE}',
      '.edn-vig{position:sticky;top:var(--edn-toph,96px);z-index:5;margin:10px 0;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-m);box-shadow:var(--shadow-1)}',
      '.edn-vig summary{cursor:pointer;padding:10px 12px;font-weight:600;font-size:.875rem;list-style:none;display:flex;justify-content:space-between;gap:8px}',
      '.edn-vig summary::-webkit-details-marker{display:none}',
      '.edn-vig[open] summary{border-bottom:1px solid var(--line)}',
      '.edn-vig__body{padding:10px 12px;max-height:38vh;overflow:auto;font-size:.9375rem;line-height:1.5}',
      '.edn-vig--static{position:static;max-height:none}',
      '.edn-vig--static .edn-vig__body{max-height:none}',
      '.edn-md p{margin:0 0 6px}.edn-md p:last-child{margin-bottom:0}',
      '.edn-q{margin-top:12px;scroll-margin-top:calc(var(--edn-toph,96px) + 60px)}',
      '.edn-q.is-active{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}',
      '.edn-q.is-locked .opts,.edn-q.is-locked .edn-tcs,.edn-q.is-locked .edn-qroc{opacity:.75}',
      '.edn-q__head{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px}',
      '.edn-q__head .grow{flex:1 1 auto}',
      '.edn-stem{font-weight:600;line-height:1.45;margin-bottom:10px}',
      '.edn-stem small{font-weight:500;color:var(--muted)}',
      '.edn-reveal{background:var(--info-soft);color:var(--ink);border-left:4px solid var(--info);padding:8px 12px;border-radius:var(--r-s);margin-bottom:10px;font-size:.9375rem}',
      '.edn-flag{border:0;background:transparent;color:var(--muted);cursor:pointer;font-size:.8rem;padding:4px 6px;border-radius:6px}',
      '.edn-flag.is-on{color:var(--bad);background:var(--bad-soft)}',
      '.edn-lock{display:flex;align-items:center;gap:6px;font-size:.8rem;color:var(--muted);margin-top:8px}',
      '.edn-opt .opt__key{border-radius:50%}',
      '.edn-opt--box .opt__key{border-radius:6px}',
      '.edn-opts--compact{gap:6px}',
      '.edn-opts--compact .opt{padding:8px 10px;min-height:0;font-size:.9rem}',
      '.edn-opts--compact .opt__key{width:24px;height:24px;font-size:.75rem}',
      '@media (min-width:700px){.edn-opts--compact{grid-template-columns:1fr 1fr}}',
      '.edn-counter{font:600 .8rem/1 var(--font-mono);padding:4px 8px;border-radius:10px;background:var(--surface-2)}',
      '.edn-counter.is-full{background:var(--info-soft);color:var(--info)}',
      '.edn-msg{font-size:.85rem;color:var(--warn);margin-top:6px;min-height:1em}',
      '.edn-qroc{width:100%}',
      '.edn-tcs__h{background:var(--surface-2);border-radius:var(--r-s);padding:10px 12px;margin-bottom:10px;font-size:.9375rem;line-height:1.45}',
      '.edn-tcs__h div+div{margin-top:4px}',
      '.edn-tcs{display:grid;gap:6px}',
      '.edn-tcs button{display:flex;justify-content:space-between;align-items:center;width:100%;min-height:44px;padding:8px 12px;border-radius:var(--r-s);border:1px solid var(--line);background:var(--surface);color:var(--ink);font:inherit;cursor:pointer;text-align:left}',
      '.edn-tcs button.is-selected{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink);font-weight:600}',
      '.edn-tcs button[disabled]{cursor:default}',
      '.edn-tcs button small{color:var(--muted);font-family:var(--font-mono)}',
      '.edn-fig{margin:10px 0 0}',
      '.edn-scroll{overflow:auto;-webkit-overflow-scrolling:touch;touch-action:pan-x pan-y pinch-zoom;background:#fff;border:1px solid var(--line);border-radius:12px;max-height:70vh}',
      '.edn-img{display:block;width:100%;height:auto;min-height:60px}',
      '.edn-scroll.is-zoom .edn-img{width:250%;max-width:none}',
      '.edn-img.is-missing{min-height:120px;background:repeating-linear-gradient(45deg,var(--surface-2),var(--surface-2) 10px,var(--surface) 10px,var(--surface) 20px)}',
      '.edn-figbar{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap;font-size:.72rem;color:var(--muted)}',
      '.edn-gray{filter:grayscale(1)}',
      /* correction */
      '.edn-badge{flex:none;font-size:.7rem;font-weight:700;padding:2px 6px;border-radius:8px;white-space:nowrap}',
      '.edn-badge--true{background:var(--ok-soft);color:var(--ok)}',
      '.edn-badge--false{background:var(--surface-2);color:var(--ink-2)}',
      '.edn-badge--indisp{background:#FFF2C2;color:#7A5A00}',
      '.edn-badge--inacc{background:var(--bad-soft);color:var(--bad)}',
      '.edn-cor{display:grid;grid-template-columns:auto auto minmax(0,1fr);gap:4px 8px;align-items:start;padding:8px 10px;border-radius:var(--r-s);border:1px solid var(--line);margin-top:6px}',
      '.edn-cor.is-correct{background:var(--ok-soft);border-color:var(--ok)}',
      '.edn-cor.is-wrong{background:var(--bad-soft);border-color:var(--bad)}',
      '.edn-cor.is-missed{border:1px dashed var(--ok)}',
      '.edn-cor__tick{font-size:1rem;line-height:1.2}',
      '.edn-cor__why{grid-column:3;font-size:.85rem;color:var(--ink-2)}',
      '.edn-calc{font:600 .85rem/1.3 var(--font-mono);color:var(--ink-2)}',
      '.edn-hbar{display:grid;grid-template-columns:118px minmax(0,1fr) 28px;gap:6px;align-items:center;font-size:.8rem;margin-top:4px}',
      '.edn-hbar__b{height:14px;border-radius:7px;background:var(--surface-2);overflow:hidden}',
      '.edn-hbar__b i{display:block;height:100%;background:var(--info)}',
      '.edn-hbar.is-mode .edn-hbar__b i{background:var(--ok)}',
      '.edn-hbar.is-you{font-weight:700}',
      '.edn-big{font-size:2.4rem;font-weight:800;line-height:1;font-variant-numeric:tabular-nums}',
      '.edn-gauge{position:relative;height:14px;border-radius:7px;background:var(--surface-2);margin:10px 0 4px}',
      '.edn-gauge i{position:absolute;left:0;top:0;bottom:0;border-radius:7px}',
      '.edn-gauge b{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--ink)}',
      '.edn-gauge__l{display:flex;justify-content:space-between;font-size:.7rem;color:var(--muted)}',
      '.edn-tab{display:grid;grid-template-columns:minmax(0,1fr) 70px 46px;gap:4px 8px;font-size:.875rem;align-items:center}',
      '.edn-tab .bar{grid-column:1 / -1;height:6px;border-radius:3px;background:var(--surface-2);overflow:hidden;margin-bottom:6px}',
      '.edn-tab .bar i{display:block;height:100%}',
      '.edn-blk{margin-top:14px}',
      '.edn-blk > summary{cursor:pointer;font-weight:700;padding:4px 0}',
      '.edn-qc{margin-top:10px}',
      '.edn-qc > summary{cursor:pointer;list-style:none;display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
      '.edn-qc > summary::-webkit-details-marker{display:none}'
    ].join('\n')));
  }

  /* ================================================================ média : ECG de la banque ECG */
  const chunkP = {};
  function loadChunk(src) {
    if (!chunkP[src]) chunkP[src] = new Promise(function (res) {
      const s = document.createElement('script'); s.src = src; s.charset = 'utf-8';
      s.onload = res; s.onerror = function () { delete chunkP[src]; res(); };
      document.head.appendChild(s);
    });
    return chunkP[src];
  }
  function ecgFigure(ref) {
    const eb = (C.registry || {}).ecgBank || {};
    const e = (eb.ecgs || []).find(function (x) { return String(x.id) === String(ref); }) || null;
    const im = h('img', { class: 'edn-img', alt: 'ECG 12 dérivations', decoding: 'async' });
    function data() { const m = (C.registry || {}).ecgImg; return (m && m[String(ref)]) || null; }
    function set() { const d = data(); if (d) { im.src = d; im.classList.remove('is-missing'); } else im.classList.add('is-missing'); }
    if (data()) set();
    else if (eb.img && eb.img[String(ref)]) { im.classList.add('is-missing'); loadChunk(eb.img[String(ref)]).then(set); }
    else im.classList.add('is-missing');
    let zoom = false;
    const sc = h('div', { class: 'edn-scroll' }, im);
    const btn = h('button', { type: 'button', class: 'btn btn--sm btn--outline', on: { click: toggle } }, 'Zoomer ×2,5');
    function toggle() { zoom = !zoom; sc.classList.toggle('is-zoom', zoom); btn.textContent = zoom ? 'Ajuster à l’écran' : 'Zoomer ×2,5'; }
    im.addEventListener('dblclick', toggle);
    const credit = e && e.credit ? e.credit : (eb.credit || 'ECG : PTB-XL (PhysioNet), CC BY 4.0 — tracé redessiné');
    return h('figure', { class: 'edn-fig' }, sc, h('figcaption', { class: 'edn-figbar' }, h('span', {}, credit), btn));
  }
  function mediaEl(b) {
    return (b.media || []).filter(function (m) { return m && m.type === 'ecg'; }).map(function (m) { return ecgFigure(m.ref); });
  }

  /* ================================================================ accueil de la rubrique */
  function attemptsList() { try { return (C.store.get('edn.attempts') || []).slice().reverse(); } catch (e) { return []; } }
  function fmtDate(t) { try { return new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' ' + new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function fmtClock(sec) {
    sec = Math.max(0, Math.round(sec));
    return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  }
  function hub(root) {
    const b = bank();
    const run = lsGet(LS_RUN, null);
    const live = run && !run.done && Array.isArray(run.blocks) ? run : null;
    const last = lsGet(LS_LAST, null);
    const nQ = b.blocks.reduce(function (n, x) { return n + nq(x); }, 0);
    const mode = function (href, ico, title, sub) {
      return h('a', { class: 'card edn-mode', href: href }, h('span', { class: 'edn-mode__ico' }, icon(ico, 22)),
        h('span', { class: 'stack stack--sm' }, h('span', { class: 'edn-mode__t' }, title), h('span', { class: 'secondary' }, sub)));
    };
    const hist = attemptsList().slice(0, 6);
    put(root,
      h('p', { class: 'secondary', style: 'margin:0 0 12px' }, 'Les épreuves dématérialisées comme le jour J : dossiers progressifs irréversibles, KFP, questions isolées, TCS, barème officiel. ' + plural(b.blocks.length, 'bloc') + ' · ' + plural(nQ, 'question') + ' tirées du Collège (rangs A et B).'),
      live ? h('div', { class: 'card stack', style: 'margin-bottom:12px;border-color:var(--accent)' },
        h('strong', {}, 'Épreuve en cours : ' + live.title),
        h('span', { class: 'secondary' }, live.endsAt ? (live.endsAt > Date.now() ? 'Temps restant : ' + fmtClock((live.endsAt - Date.now()) / 1000) + ' (le chrono continue)' : 'Temps écoulé : la copie va être soumise.') : 'Entraînement sans chrono.'),
        h('div', { class: 'edn-seg' },
          h('a', { class: 'btn btn--primary', href: '#/edn/run' }, 'Reprendre'),
          h('button', { type: 'button', class: 'btn btn--outline', on: { click: function () {
            C.shell.confirm('Abandonner l’épreuve en cours ? Elle ne sera pas notée.', { ok: 'Abandonner', tone: 'danger' }).then(function (ok) { if (ok) { lsDel(LS_RUN); hub(root); } });
          } } }, 'Abandonner'))) : null,
      h('div', { class: 'stack' },
        mode('#/edn/examen', 'timer', 'Épreuve EDN', 'Chronométrée : Mini 30 min, Demi-UC 90 min, UC complète 180 min. Correction à la fin, note double A /20.'),
        mode('#/edn/entrainement', 'target', 'Entraînement', 'Par matière, item, format ou type de bloc. Correction après chaque validation.'),
        mode('#/edn/partiels', 'calendar', 'Partiels (simulation)', 'Certificats Sorbonne d’1 h : cardio, pneumo, dermato. Seuil 10/20.')),
      last && last.done ? h('a', { class: 'btn btn--outline btn--block', style: 'margin-top:12px', href: '#/edn/resultat' }, 'Revoir la dernière correction') : null,
      hist.length ? h('div', { class: 'card', style: 'margin-top:12px' },
        h('span', { class: 'caption' }, 'Dernières épreuves'),
        hist.map(function (a) {
          return h('div', { class: 'edn-hist' },
            h('span', {}, a.title || a.mode, h('br'), h('small', { class: 'secondary' }, fmtDate(a.at) + ' · ' + plural(a.nQ, 'question'))),
            h('strong', { style: 'text-align:right' }, fmt(a.note) + '/20', a.aa != null ? h('small', { class: 'secondary', style: 'display:block;font-weight:500' }, 'AA ' + fmt(a.aa) + '/20') : null));
        })) : null);
  }

  /* ---------------------------------------------------------------- réglages communs */
  function prefs() { return Object.assign({ spe: null, preset: 'mini', shuffle: true, immediate: true, size: 10, item: '', format: '', kind: '', weights: false, pspe: null }, lsGet(LS_PREF, {})); }
  function savePrefs(p) { lsSet(LS_PREF, p); }
  function segBtn(on, label, fn, disabled) {
    return h('button', { type: 'button', class: 'btn btn--sm ' + (on ? 'btn--primary' : 'btn--outline'), 'aria-pressed': on ? 'true' : 'false', disabled: !!disabled, on: { click: fn } }, label);
  }
  function speChooser(cur, onPick) {
    return h('div', { class: 'edn-seg', role: 'group', 'aria-label': 'Matière' }, ['all', 'cardio', 'dermato', 'pneumo'].map(function (s) {
      const n = poolOf(s).reduce(function (k, b) { return k + nq(b); }, 0);
      return segBtn(cur === s, SPE_LABEL[s] + ' (' + n + ')', function () { onPick(s); }, !n);
    }));
  }
  function initialSpe(p) {
    let s = p.spe || activeSpe();
    if (!available(s)) s = 'all';
    return s;
  }
  function backLink() { return h('a', { href: '#/edn', class: 'btn btn--ghost btn--sm', style: 'margin-bottom:8px' }, '← EDN / Partiels'); }
  function startRun(run) {
    lsSet(LS_RUN, run);
    C.router.go('#/edn/run');
  }

  /* ---------------------------------------------------------------- épreuve EDN : réglages */
  function examSetup(root) {
    const p = prefs();
    p.spe = initialSpe(p);
    function paint() {
      savePrefs(p);
      const preset = PRESETS.find(function (x) { return x.id === p.preset; }) || PRESETS[0];
      const pool = poolOf(p.spe);
      const avail = pool.reduce(function (n, b) { return n + nq(b); }, 0);
      const preview = compose(pool, preset.q, PROPS_2026);
      const tq = preview.reduce(function (n, b) { return n + nq(b); }, 0);
      const min = tq >= preset.q * 0.9 ? preset.min : Math.max(5, Math.round(preset.min * tq / preset.q));
      const kinds = {};
      preview.forEach(function (b) { kinds[b.kind] = (kinds[b.kind] || 0) + nq(b); });
      put(root, backLink(),
        h('div', { class: 'card stack' },
          h('strong', {}, 'Épreuve EDN chronométrée'),
          h('span', { class: 'caption' }, 'Matière'),
          speChooser(p.spe, function (s) { p.spe = s; paint(); }),
          h('span', { class: 'caption' }, 'Format'),
          h('div', { class: 'edn-seg' }, PRESETS.map(function (x) { return segBtn(p.preset === x.id, x.label + ' · ' + x.min + ' min', function () { p.preset = x.id; paint(); }); })),
          h('p', { class: 'secondary', style: 'margin:0;font-size:.875rem' }, 'Répartition visée (sujets 2026) : DP 49 % · KFP 19 % · QI 25 % · TCS 7 %, ajustée au contenu disponible.'),
          h('div', { class: 'explain' },
            h('span', { class: 'caption' }, 'Ton épreuve'),
            tq ? h('div', {}, h('strong', {}, plural(tq, 'question') + ' · ' + min + ' min'),
              h('div', { class: 'secondary', style: 'font-size:.875rem' }, ['DP', 'KFP', 'QI', 'TCS'].filter(function (k) { return kinds[k]; }).map(function (k) { return k + ' ' + Math.round(100 * kinds[k] / tq) + ' %'; }).join(' · ')),
              tq < preset.q * 0.9 ? h('div', { class: 'secondary', style: 'font-size:.8rem;margin-top:4px' }, 'Banque encore limitée (' + avail + ' questions dans cette matière) : durée ramenée au prorata (≈ 1,8 min par question).') : null)
              : h('div', { class: 'secondary' }, 'Aucune question disponible.')),
          h('label', { class: 'edn-row', style: 'justify-content:flex-start' }, h('input', { type: 'checkbox', checked: p.shuffle, on: { change: function (e) { p.shuffle = e.target.checked; savePrefs(p); } } }), 'Mélanger les propositions et l’ordre des blocs'),
          h('ul', { class: 'secondary', style: 'margin:0;padding-left:18px;font-size:.85rem' },
            h('li', {}, 'La validation enregistre la réponse ; la sélection seule ne compte pas.'),
            h('li', {}, 'DP et KFP : la question suivante n’apparaît qu’après validation, et une question validée n’est plus modifiable.'),
            h('li', {}, 'Aucune correction ni rang affiché avant la fin. À 0:00, la copie est soumise : les réponses non validées valent 0.')),
          h('button', { type: 'button', class: 'btn btn--primary btn--block btn--lg', disabled: !tq, on: { click: function () {
            const blocks = compose(pool, preset.q, PROPS_2026);
            const n = blocks.reduce(function (k, b) { return k + nq(b); }, 0);
            const m = n >= preset.q * 0.9 ? preset.min : Math.max(5, Math.round(preset.min * n / preset.q));
            startRun(makeRun({ mode: 'edn', title: 'EDN ' + preset.label + (p.spe !== 'all' ? ' · ' + SPE_LABEL[p.spe] : ''), spe: p.spe, blocks: blocks,
              durationSec: m * 60, shuffleOptions: p.shuffle, shuffleBlocks: p.shuffle }));
          } } }, 'Commencer l’épreuve')));
    }
    paint();
  }

  /* ---------------------------------------------------------------- entraînement : réglages */
  function trainSetup(root) {
    const p = prefs();
    p.spe = initialSpe(p);
    function filtered() {
      return poolOf(p.spe).filter(function (b) {
        if (p.item && b.item !== p.item) return false;
        if (p.kind && b.kind !== p.kind) return false;
        if (p.format && !b.questions.some(function (q) { return q.format === p.format; })) return false;
        return true;
      });
    }
    function pick() {
      const out = [];
      let n = 0;
      freshFirst(filtered()).forEach(function (b) { if (!p.size || n < p.size) { out.push(b); n += nq(b); } });
      return out;
    }
    function paint() {
      const items = Object.keys(bank().items || {}).filter(function (k) { return p.spe === 'all' || bank().items[k].spe === p.spe; }).sort();
      if (p.item && items.indexOf(p.item) < 0) p.item = '';
      savePrefs(p);
      const pool = filtered();
      const total = pool.reduce(function (n, b) { return n + nq(b); }, 0);
      const sel = function (label, val, opts, onch) {
        return h('label', { class: 'stack stack--sm' }, h('span', { class: 'caption' }, label),
          h('select', { class: 'input', on: { change: function (e) { onch(e.target.value); paint(); } } },
            opts.map(function (o) { return h('option', { value: o[0], selected: o[0] === val }, o[1]); })));
      };
      put(root, backLink(),
        h('div', { class: 'card stack' },
          h('strong', {}, 'Entraînement'),
          h('span', { class: 'caption' }, 'Matière'),
          speChooser(p.spe, function (s) { p.spe = s; p.item = ''; paint(); }),
          sel('Item', p.item, [['', 'Tous les items']].concat(items.map(function (k) { return [k, itemLabel(k) + ' (' + bank().items[k].nQ + ' q)']; })), function (v) { p.item = v; }),
          sel('Type de bloc', p.kind, [['', 'Tous'], ['DP', 'Dossiers progressifs'], ['KFP', 'KFP'], ['QI', 'Questions isolées'], ['TCS', 'TCS']], function (v) { p.kind = v; }),
          sel('Format (blocs qui en contiennent)', p.format, [['', 'Tous'], ['QRU', 'QRU'], ['QRM', 'QRM'], ['QRP', 'QRP'], ['QRPL', 'QRP longue'], ['QROC', 'QROC'], ['TCS', 'TCS']], function (v) { p.format = v; }),
          h('span', { class: 'caption' }, 'Nombre de questions'),
          h('div', { class: 'edn-seg' }, [10, 20, 0].map(function (k) { return segBtn(p.size === k, k ? '≈ ' + k : 'Tout', function () { p.size = k; paint(); }); })),
          h('label', { class: 'edn-row', style: 'justify-content:flex-start' }, h('input', { type: 'checkbox', checked: p.immediate, on: { change: function (e) { p.immediate = e.target.checked; savePrefs(p); } } }), 'Correction immédiate après chaque validation'),
          h('label', { class: 'edn-row', style: 'justify-content:flex-start' }, h('input', { type: 'checkbox', checked: p.shuffle, on: { change: function (e) { p.shuffle = e.target.checked; savePrefs(p); } } }), 'Mélanger les propositions'),
          h('p', { class: 'secondary', style: 'margin:0' }, plural(total, 'question') + ' disponible' + (total > 1 ? 's' : '') + ' · les jamais faites et les ratées passent en premier. Les DP restent irréversibles.'),
          h('button', { type: 'button', class: 'btn btn--primary btn--block btn--lg', disabled: !total, on: { click: function () {
            const blocks = pick();
            startRun(makeRun({ mode: 'train', title: 'Entraînement' + (p.item ? ' · ' + itemLabel(p.item) : p.spe !== 'all' ? ' · ' + SPE_LABEL[p.spe] : ''), spe: p.spe, blocks: blocks,
              durationSec: 0, immediate: p.immediate, shuffleOptions: p.shuffle, shuffleBlocks: true }));
          } } }, 'Commencer')));
    }
    paint();
  }

  /* ---------------------------------------------------------------- partiels : réglages */
  function partielSetup(root) {
    const p = prefs();
    if (!p.pspe || !available(p.pspe)) p.pspe = ['cardio', 'pneumo', 'dermato'].find(function (s) { return available(s); }) || 'cardio';
    function paint() {
      savePrefs(p);
      const blocks = partielBlocks(p.pspe);
      const tq = blocks.reduce(function (n, b) { return n + nq(b); }, 0);
      const min = tq >= 30 ? 60 : Math.max(5, Math.round(60 * tq / 32));
      const kinds = {};
      blocks.forEach(function (b) { kinds[b.kind] = (kinds[b.kind] || 0) + 1; });
      const names = { cardio: 'Cardiologie', pneumo: 'Pneumologie', dermato: 'Dermatologie' };
      put(root, backLink(),
        h('div', { class: 'edn-warn', role: 'note', style: 'margin-bottom:12px' }, '⚠ ' + PARTIEL_WARN),
        h('div', { class: 'card stack' },
          h('strong', {}, 'Partiels Sorbonne (simulation)'),
          h('span', { class: 'caption' }, 'Certificat (DFGSM3, 1 h)'),
          h('div', { class: 'edn-seg' }, ['cardio', 'pneumo', 'dermato'].map(function (s) { return segBtn(p.pspe === s, names[s], function () { p.pspe = s; paint(); }, !available(s)); })),
          h('div', { class: 'explain' },
            h('span', { class: 'caption' }, 'Gabarit'),
            h('div', { style: 'font-size:.9rem' }, '1 DP long (10-17 q) ou 2 DP, 0-1 KFP, puis des QI : ≈ 30-35 questions en 60 min. Barème UNESS par défaut (= EDN), indispensables / inacceptables, seuil 10/20, pas de double A.'),
            tq ? h('div', { style: 'margin-top:6px' }, h('strong', {}, plural(tq, 'question') + ' · ' + min + ' min'),
              h('div', { class: 'secondary', style: 'font-size:.85rem' }, ['DP', 'KFP', 'QI', 'TCS'].filter(function (k) { return kinds[k]; }).map(function (k) { return plural(kinds[k], k === 'QI' ? 'QI' : k, k === 'QI' ? 'QI' : k); }).join(' · ')),
              tq < 30 ? h('div', { class: 'secondary', style: 'font-size:.8rem' }, 'Banque encore limitée : durée ramenée au prorata.') : null)
              : h('div', { class: 'secondary' }, 'Pas encore de contenu pour ce certificat.')),
          h('label', { class: 'edn-row', style: 'justify-content:flex-start' }, h('input', { type: 'checkbox', checked: p.weights, on: { change: function (e) { p.weights = e.target.checked; savePrefs(p); } } }), 'Pondération d’item de 1 à 3 (tirée au hasard, simulée)'),
          h('button', { type: 'button', class: 'btn btn--primary btn--block btn--lg', disabled: !tq, on: { click: function () {
            const b2 = partielBlocks(p.pspe);
            const n = b2.reduce(function (k, b) { return k + nq(b); }, 0);
            startRun(makeRun({ mode: 'partiel', title: 'Partiel ' + names[p.pspe] + ' (simulé)', spe: p.pspe, blocks: b2,
              durationSec: (n >= 30 ? 60 : Math.max(5, Math.round(60 * n / 32))) * 60, weights: p.weights, shuffleOptions: true, shuffleBlocks: false }));
          } } }, 'Commencer le partiel')));
    }
    paint();
  }

  /* ================================================================ rendu d'une question (saisie) */
  function optOrder(run, b, q) {
    const rb = run.blocks.find(function (x) { return x.id === b.id; });
    const ord = rb && rb.order && rb.order[q.id];
    return Array.isArray(ord) && ord.length === (q.options || []).length ? ord : (q.options || []).map(function (x, i) { return i; });
  }
  function stemSuffix(q) {
    if (q.format === 'QRM') return '(une ou plusieurs réponses exactes)';
    if (q.format === 'QRU') return '(une seule réponse exacte)';
    if (q.format === 'QRP' || q.format === 'QRPL') return '(' + q.n + ' réponse' + (q.n > 1 ? 's' : '') + ' attendue' + (q.n > 1 ? 's' : '') + ')';
    return null;
  }
  /* inputs(q, ans, opts) : opts = {order, disabled, onChange(newAns)} ; ans = {sel, text, tcs} */
  function inputs(q, ans, o) {
    ans = ans || {};
    const f = q.format;
    if (f === 'QRU' || f === 'QRM' || f === 'QRP' || f === 'QRPL') {
      const multi = f !== 'QRU';
      const cap = f === 'QRP' || f === 'QRPL' ? q.n : 0;
      let sel = (ans.sel || []).slice();
      const msg = h('div', { class: 'edn-msg', 'aria-live': 'polite' });
      const counter = cap ? h('span', { class: 'edn-counter' }) : null;
      const rows = o.order.map(function (oi, k) {
        const btn = h('button', { type: 'button', class: 'opt edn-opt' + (multi ? ' edn-opt--box' : ''), role: multi ? 'checkbox' : 'radio', 'aria-checked': 'false', disabled: !!o.disabled,
          on: { click: function () { toggle(oi); } } },
          h('span', { class: 'opt__key', 'aria-hidden': 'true' }, LETTERS[k]), h('span', { class: 'opt__text' }, String(q.options[oi].t)));
        return { btn: btn, oi: oi };
      });
      function paintSel() {
        rows.forEach(function (r) { const on = sel.indexOf(r.oi) >= 0; r.btn.classList.toggle('is-selected', on); r.btn.setAttribute('aria-checked', on ? 'true' : 'false'); });
        if (counter) { counter.textContent = sel.length + '/' + cap; counter.classList.toggle('is-full', sel.length >= cap); }
      }
      function toggle(oi) {
        if (o.disabled) return;
        const at = sel.indexOf(oi);
        msg.textContent = '';
        if (!multi) sel = at >= 0 ? [] : [oi];
        else if (at >= 0) sel.splice(at, 1);
        else if (cap && sel.length >= cap) { msg.textContent = 'Tu as déjà coché ' + cap + ' proposition' + (cap > 1 ? 's' : '') + ' : décoche d’abord.'; haptic(20); return; }
        else sel.push(oi);
        paintSel();
        o.onChange({ sel: sel.slice() });
      }
      paintSel();
      return { el: h('div', {}, counter ? h('div', { class: 'edn-row', style: 'margin-bottom:6px' }, h('span', { class: 'secondary', style: 'font-size:.8rem' }, 'Cochez ' + cap + ' proposition' + (cap > 1 ? 's' : '')), counter) : null,
        h('div', { class: 'opts' + (f === 'QRPL' ? ' edn-opts--compact' : ''), role: multi ? 'group' : 'radiogroup' }, rows.map(function (r) { return r.btn; })), msg) };
    }
    if (f === 'QROC') {
      const qr = q.qroc || {};
      const cnt = h('span', { class: 'edn-counter' });
      const input = h('input', { class: 'input edn-qroc', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'Ta réponse', value: ans.text || '', disabled: !!o.disabled,
        on: { input: function () { paint(); o.onChange({ text: input.value }); } } });
      function paint() { const n = wordCount(input.value); cnt.textContent = n + '/5 mots'; cnt.classList.toggle('is-full', n > 5); cnt.style.color = n > 5 ? 'var(--bad)' : ''; }
      paint();
      return { el: h('div', { class: 'stack stack--sm' }, h('div', { class: 'edn-row' }, h('span', { class: 'secondary', style: 'font-size:.85rem' }, 'Consigne : ' + (qr.consigne || '1 à 5 mots')), cnt), input) };
    }
    if (f === 'TCS') {
      const t = q.tcs || {};
      let cur = ans.tcs == null ? null : ans.tcs;
      const btns = ANCHORS.map(function (lab, i) {
        return h('button', { type: 'button', disabled: !!o.disabled, 'aria-pressed': 'false', on: { click: function () { if (o.disabled) return; cur = cur === i ? null : i; paint(); o.onChange({ tcs: cur }); } } },
          h('span', {}, lab), h('small', {}, ANCHOR_VAL[i]));
      });
      function paint() { btns.forEach(function (b, i) { b.classList.toggle('is-selected', cur === i); b.setAttribute('aria-pressed', cur === i ? 'true' : 'false'); }); }
      paint();
      return { el: h('div', {},
        h('div', { class: 'edn-tcs__h' }, h('div', {}, h('strong', {}, t.hypothesis || '')), h('div', {}, t.info || ''), h('div', { class: 'secondary', style: 'font-size:.85rem' }, 'L’hypothèse devient :')),
        h('div', { class: 'edn-tcs' }, btns)) };
    }
    return { el: h('div', { class: 'secondary' }, 'Format non pris en charge.') };
  }
  function ansFilled(q, a) {
    if (!a) return false;
    if (q.format === 'QROC') return !!String(a.text || '').trim();
    if (q.format === 'TCS') return a.tcs != null;
    return Array.isArray(a.sel) && a.sel.length > 0;
  }
  function sameAns(q, a, b) {
    if (!a || !b) return !a && !b;
    if (q.format === 'QROC') return norm(a.text) === norm(b.text) && String(a.text || '').trim() === String(b.text || '').trim();
    if (q.format === 'TCS') return a.tcs === b.tcs;
    const x = (a.sel || []).slice().sort().join(','), y = (b.sel || []).slice().sort().join(',');
    return x === y;
  }

  /* ================================================================ correction d'une question */
  const BADGE = { true: '✓ vrai', false: '✗ faux', indisp: '★ indispensable', inacc: '⛔ inacceptable' };
  function correction(q, a, res, order, extra) {
    extra = extra || {};
    const head = h('div', { class: 'edn-q__head' },
      h('span', { class: 'pill pill--' + (res.score >= 0.99 ? 'ok' : res.score > 0 ? 'warn' : 'bad') }, fmt(res.score) + ' / 1'),
      h('span', { class: 'pill pill--kind' }, FMT_LABEL[q.format] || q.format),
      h('span', { class: 'pill pill--' + (q.rank === 'B' ? 'B' : 'A') }, 'Rang ' + q.rank),
      h('span', { class: 'pill pill--outline', title: 'Code de notation : rang de la connaissance + format' }, codeOf(q)),
      extra.weight && extra.weight > 1 ? h('span', { class: 'pill pill--info' }, 'pondération ×' + extra.weight) : null);
    const calc = h('div', { class: 'edn-calc' }, 'Calcul : ' + res.calc);
    const body = [];
    if (q.options) {
      const sel = (a && a.sel) || [];
      order.forEach(function (oi, k) {
        const op = q.options[oi];
        const on = sel.indexOf(oi) >= 0, ok = good(op.key);
        const cls = on && ok ? 'is-correct' : on && !ok ? 'is-wrong' : ok ? 'is-missed' : '';
        body.push(h('div', { class: 'edn-cor ' + cls },
          h('span', { class: 'edn-cor__tick', title: on ? 'coché' : 'non coché', 'aria-label': on ? 'coché' : 'non coché' }, on ? '☑' : '☐'),
          h('span', { class: 'edn-badge edn-badge--' + op.key }, BADGE[op.key]),
          h('span', {}, h('strong', {}, LETTERS[k] + '. '), String(op.t)),
          h('span', { class: 'edn-cor__why' }, String(op.why || ''))));
      });
    } else if (q.format === 'QROC') {
      const qr = q.qroc || {};
      body.push(h('div', { class: 'explain stack stack--sm' },
        h('div', {}, h('span', { class: 'caption' }, 'Ta réponse'), h('strong', {}, a && a.text ? '« ' + a.text + ' »' : '— (pas de réponse validée)')),
        h('div', {}, h('span', { class: 'caption' }, 'Réponses exactes'), (qr.exact || []).join(' · ')),
        (qr.partial || []).length ? h('div', {}, h('span', { class: 'caption' }, 'Partiellement exactes (0,5)'), qr.partial.join(' · ')) : null,
        (qr.reject || []).length ? h('div', {}, h('span', { class: 'caption' }, 'Refusées (0)'), qr.reject.join(' · ')) : null,
        qr.why ? h('div', { class: 'secondary' }, String(qr.why)) : null));
      if (a && a.validated && res.pending && extra.onSelf) {
        body.push(h('div', { class: 'feedback feedback--info', style: 'flex-direction:column;align-items:stretch' },
          h('span', {}, 'Réponse non reconnue automatiquement. Compare à la réponse attendue et note-toi (auto-évaluation) :'),
          h('div', { class: 'edn-seg' }, ['exact', 'partiel', 'faux'].map(function (k) {
            return h('button', { type: 'button', class: 'btn btn--sm btn--outline', on: { click: function () { extra.onSelf(k); } } }, k === 'exact' ? 'Exact (1)' : k === 'partiel' ? 'Partiel (0,5)' : 'Faux (0)');
          }))));
      } else if (a && a.self && !res.pending && /auto-évaluation/.test(res.calc)) {
        body.push(h('div', { class: 'secondary', style: 'font-size:.8rem' }, 'Note issue de ton auto-évaluation (' + SELF_LABEL[a.self] + ').',
          extra.onSelf ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', on: { click: function () { extra.onSelf(null); } } }, 'Changer') : null));
      }
    } else if (q.format === 'TCS') {
      const t = q.tcs || {};
      const p = t.panel || [];
      const m = Math.max.apply(null, p.concat([1]));
      const you = a ? a.tcs : null;
      body.push(h('div', { class: 'edn-tcs__h' }, h('div', {}, h('strong', {}, t.hypothesis || '')), h('div', {}, t.info || '')));
      body.push(h('div', { 'aria-label': 'Histogramme du panel d’experts' },
        h('span', { class: 'caption' }, 'Panel d’experts (' + p.reduce(function (s, x) { return s + x; }, 0) + ')'),
        ANCHORS.map(function (lab, i) {
          return h('div', { class: 'edn-hbar' + (p[i] === m ? ' is-mode' : '') + (you === i ? ' is-you' : '') },
            h('span', {}, (you === i ? '➜ ' : '') + lab), h('span', { class: 'edn-hbar__b' }, h('i', { style: 'width:' + Math.round(100 * (p[i] || 0) / m) + '%' })), h('span', {}, String(p[i] || 0)));
        }),
        you == null ? h('div', { class: 'secondary', style: 'font-size:.8rem' }, 'Pas de réponse validée.') : null));
      if (t.why) body.push(h('div', { class: 'secondary', style: 'font-size:.875rem' }, String(t.why)));
    }
    return h('div', { class: 'stack stack--sm' }, head, calc, body,
      q.deep ? h('div', { class: 'explain' }, h('span', { class: 'caption' }, 'Pour aller plus loin'), mdEl(q.deep)) : null,
      h('div', { class: 'edn-row' }, q.src ? h('span', { class: 'src' }, 'Collège · ' + q.src) : h('span'), extra.itemLink ? extra.itemLink : null));
  }

  /* ================================================================ runner d'épreuve */
  function runner(root, run) {
    const drafts = {};      // qid → réponse en cours (non sauvegardée)
    const editing = {};     // qid → QI/TCS rouverte
    let tcsActive = null;   // bloc TCS : question ciblée par « Valider »
    let timer = null;
    let submitted = false;
    const timed = !!run.endsAt;
    const total = runQuestions(run).length;

    const clock = h('span', { class: 'edn-clock', role: 'timer', 'aria-live': 'off' });
    const pills = h('div', { class: 'edn-pills', role: 'navigation', 'aria-label': 'Liste des questions' });
    const endCtl = timed ? slideToEnd() : h('button', { type: 'button', class: 'btn btn--sm btn--outline', on: { click: askEnd } }, 'Terminer');
    const grayBtn = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', title: 'Griser l’interface', 'aria-label': 'Griser l’interface', on: { click: function () { root.classList.toggle('edn-gray'); } } }, '◐');
    const top = h('div', { class: 'edn-top' },
      h('div', { class: 'edn-top__row' }, h('span', { class: 'edn-top__title' }, run.title), grayBtn, clock, endCtl),
      pills,
      h('div', { class: 'edn-legend' }, h('span', {}, h('i', { style: 'background:#fff' }), 'non traitée'), h('span', {}, h('i', { style: 'background:#F28C28' }), 'saisie non validée'), h('span', {}, h('i', { style: 'background:#2F6FDE' }), 'validée'),
        h('span', {}, h('i', { style: 'background:var(--bad);border-color:var(--bad)' }), 'marquée')));
    const body = h('div', {});
    const vBtn = h('button', { type: 'button', class: 'btn btn--primary', on: { click: onValidate } }, 'Valider');
    const prevBtn = h('button', { type: 'button', class: 'btn btn--outline btn--sm', 'aria-label': 'Bloc précédent', on: { click: function () { go(run.cur - 1); } } }, '◀');
    const nextBtn = h('button', { type: 'button', class: 'btn btn--outline btn--sm', 'aria-label': 'Bloc suivant', on: { click: function () { go(run.cur + 1); } } }, '▶');
    const bar = h('div', { class: 'actionbar', role: 'toolbar', 'aria-label': 'Actions' }, h('div', { class: 'actionbar__inner' }, prevBtn, vBtn, nextBtn));
    root.classList.add('edn-run');
    put(root, top, body, bar);

    try {
      const ro = new ResizeObserver(function () { root.style.setProperty('--edn-toph', (top.offsetHeight + 4) + 'px'); });
      ro.observe(top);
    } catch (e) { /* ignore */ }

    function save() { if (!submitted) lsSet(LS_RUN, run); }
    function curBlock() { const rb = run.blocks[run.cur]; return rb ? blockById(rb.id) : null; }
    function progressive(b) { return b.kind === 'DP' || b.kind === 'KFP'; }
    function validated(q) { return !!(run.ans[q.id] && run.ans[q.id].validated); }
    function openIndex(b) {   // DP/KFP : indice de la première question non validée (= nombre de questions visibles − 1)
      for (let i = 0; i < b.questions.length; i++) if (!validated(b.questions[i])) return i;
      return b.questions.length;
    }
    function lockedForever(b, q) {   // non modifiable : DP/KFP validée, ou correction déjà vue
      return validated(q) && (progressive(b) || (run.immediate && run.mode === 'train'));
    }
    function pillState(b, q, i) {
      if (progressive(b) && i > openIndex(b)) return 'future';
      const d = drafts[q.id];
      if (validated(q)) return editing[q.id] && d && !sameAns(q, d, run.ans[q.id]) ? 'draft' : 'done';
      return d && ansFilled(q, d) ? 'draft' : 'todo';
    }
    function activeQ(b) {
      if (!b) return null;
      if (progressive(b)) { const i = openIndex(b); return i < b.questions.length ? b.questions[i] : null; }
      if (b.kind === 'QI') return b.questions[0];
      const t = tcsActive && b.questions.find(function (q) { return q.id === tcsActive; });
      return t || b.questions.find(function (q) { return !validated(q); }) || b.questions[0];
    }

    /* --- barre de pastilles */
    function paintPills() {
      const b0 = curBlock();
      const groups = [];
      const flagged = [];
      run.blocks.forEach(function (rb, bi) {
        const b = blockById(rb.id);
        if (!b) return;
        const ps = b.questions.map(function (q, i) {
          const st = pillState(b, q, i);
          const el = h('button', { type: 'button', class: 'edn-pill is-' + st + (run.flags[q.id] ? ' is-flag' : '') + (b0 === b && activeQ(b) === q ? ' is-cur' : ''),
            disabled: st === 'future', 'aria-label': KIND_SHORT[b.kind] + ' ' + (bi + 1) + (b.questions.length > 1 ? ', question ' + (i + 1) : '') + ' : ' + ({ todo: 'non traitée', draft: 'saisie non validée', done: 'validée', future: 'pas encore accessible' })[st] + (run.flags[q.id] ? ', marquée' : ''),
            on: { click: function () { go(bi, q.id); } } }, b.questions.length > 1 ? String(i + 1) : String(bi + 1));
          if (run.flags[q.id]) flagged.push(h('button', { type: 'button', class: 'edn-pill is-' + st + ' is-flag', on: { click: function () { go(bi, q.id); } } }, KIND_SHORT[b.kind] + (bi + 1) + (b.questions.length > 1 ? '.' + (i + 1) : '')));
          return el;
        });
        groups.push(h('div', { class: 'edn-pg' + (b0 === b ? ' is-cur' : '') }, h('span', { class: 'edn-pg__l' }, b.questions.length > 1 ? KIND_SHORT[b.kind] + ' ' + (bi + 1) : KIND_SHORT[b.kind]), ps));
      });
      put(pills, flagged.length ? h('div', { class: 'edn-pg' }, h('span', { class: 'edn-pg__l', style: 'color:var(--bad)' }, '⚑'), flagged) : null, groups);
      const done = runQuestions(run).filter(validated).length;
      try { C.shell.progressBar(total ? done / total : 0, done + ' / ' + total + ' validées'); } catch (e) { /* ignore */ }
      const cur = pills.querySelector('.edn-pg.is-cur');
      if (cur && cur.scrollIntoView) { try { cur.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* ignore */ } }
    }

    /* --- bloc courant */
    function paintBody(focusQid) {
      const b = curBlock();
      if (!b) { put(body, h('p', { class: 'secondary' }, 'Bloc introuvable.')); return; }
      const visible = progressive(b) ? b.questions.slice(0, Math.min(b.questions.length, openIndex(b) + 1)) : b.questions;
      const act = activeQ(b);
      const vig = b.vignette ? (progressive(b)
        ? h('details', { class: 'edn-vig', open: true }, h('summary', {}, h('span', {}, 'Énoncé du dossier'), h('span', { class: 'secondary' }, 'replier / déplier')), h('div', { class: 'edn-vig__body' }, mdEl(b.vignette)))
        : h('div', { class: 'edn-vig edn-vig--static' }, h('div', { class: 'edn-vig__body' }, mdEl(b.vignette)))) : null;
      put(body,
        run.mode === 'partiel' ? h('div', { class: 'edn-warn', role: 'note', style: 'margin-top:10px;font-size:.8rem;padding:6px 10px' }, '⚠ ' + PARTIEL_WARN) : null,
        h('div', { class: 'edn-row', style: 'margin-top:10px' },
          h('strong', {}, (KIND_LABEL[b.kind] || b.kind) + ' ' + (run.cur + 1) + ' / ' + run.blocks.length),
          h('span', { class: 'secondary', style: 'font-size:.85rem' }, plural(b.questions.length, 'question'))),
        vig, mediaEl(b),
        visible.map(function (q, i) { return questionCard(b, q, i, act === q); }),
        progressive(b) && openIndex(b) >= b.questions.length ? h('div', { class: 'edn-lock', style: 'margin-top:12px' }, icon('lock', 14), 'Dossier terminé : toutes les réponses sont validées.') : null);
      paintBar();
      if (focusQid) {
        const el = body.querySelector('#edn-q-' + CSS.escape(focusQid));
        if (el) setTimeout(function () { try { el.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* ignore */ } }, 30);
      }
    }
    function questionCard(b, q, i, isActive) {
      const val = validated(q);
      const locked = lockedForever(b, q);
      const isEditing = !!editing[q.id];
      const disabled = locked || (val && !isEditing);
      const shown = drafts[q.id] || run.ans[q.id] || {};
      const order = optOrder(run, b, q);
      const flagBtn = h('button', { type: 'button', class: 'edn-flag' + (run.flags[q.id] ? ' is-on' : ''), 'aria-pressed': run.flags[q.id] ? 'true' : 'false', title: 'Marqueur personnel (sans effet sur la note)',
        on: { click: function (ev) { ev.stopPropagation(); if (run.flags[q.id]) delete run.flags[q.id]; else run.flags[q.id] = true; save(); paintPills(); ev.currentTarget.classList.toggle('is-on', !!run.flags[q.id]); } } }, '⚑ Marquer');
      const inp = inputs(q, shown, { order: order, disabled: disabled, onChange: function (patch) {
        drafts[q.id] = Object.assign({}, drafts[q.id] || run.ans[q.id] || {}, patch);
        delete drafts[q.id].validated;
        if (b.kind === 'TCS') { tcsActive = q.id; markActive(q.id); }
        paintPills(); paintBar();
      } });
      const showCorr = run.mode === 'train' && run.immediate && val;
      const card = h('div', { class: 'card edn-q' + (disabled ? ' is-locked' : '') + (isActive && !disabled && b.kind === 'TCS' ? ' is-active' : ''), id: 'edn-q-' + q.id, dataset: { qid: q.id },
        on: { click: function () { if (b.kind === 'TCS' && tcsActive !== q.id) { tcsActive = q.id; markActive(q.id); paintPills(); paintBar(); } } } },
        progressive(b) && i > 0 && q.reveal ? h('div', { class: 'edn-reveal' }, mdEl(q.reveal)) : null,
        h('div', { class: 'edn-q__head' },
          h('span', { class: 'pill pill--kind' }, (b.questions.length > 1 ? 'Question ' + (i + 1) + ' · ' : '') + (FMT_LABEL[q.format] || q.format) + (q.options ? ' · ' + q.options.length + ' propositions' : '')),
          h('span', { class: 'grow' }), flagBtn),
        q.stem ? h('div', { class: 'edn-stem' }, mdEl(q.stem), stemSuffix(q) ? h('small', {}, stemSuffix(q)) : null) : null,
        inp.el,
        val && !isEditing && !showCorr ? h('div', { class: 'edn-lock' }, icon(locked ? 'lock' : 'check', 14), locked ? 'Réponse validée — verrouillée' : 'Réponse validée (modifiable : « Modifier »)') : null,
        val && isEditing ? h('div', { class: 'edn-lock', style: 'color:#C96A0E' }, 'Modification en cours : revalide, sinon ta réponse précédente reste enregistrée.') : null,
        showCorr ? h('div', { style: 'margin-top:12px;border-top:1px solid var(--line);padding-top:10px' },
          correction(q, run.ans[q.id], scoreQ(q, run.ans[q.id]), order, { onSelf: function (k) { selfGrade(q, k); } })) : null);
      return card;
    }
    function markActive(qid) {
      body.querySelectorAll('.edn-q').forEach(function (el) { el.classList.toggle('is-active', el.dataset.qid === qid && !el.classList.contains('is-locked')); });
    }
    function paintBar() {
      const b = curBlock();
      const q = activeQ(b);
      prevBtn.disabled = run.cur <= 0;
      nextBtn.disabled = run.cur >= run.blocks.length - 1;
      vBtn.className = 'btn btn--primary';
      if (!q || (progressive(b) && openIndex(b) >= b.questions.length)) {
        vBtn.textContent = run.cur < run.blocks.length - 1 ? 'Bloc suivant' : 'Terminer';
        vBtn.disabled = false; vBtn.dataset.act = run.cur < run.blocks.length - 1 ? 'next' : 'end';
        return;
      }
      if (lockedForever(b, q)) {
        vBtn.textContent = run.cur < run.blocks.length - 1 ? 'Bloc suivant' : 'Terminer'; vBtn.disabled = false; vBtn.dataset.act = run.cur < run.blocks.length - 1 ? 'next' : 'end';
        return;
      }
      if (validated(q) && !editing[q.id]) { vBtn.textContent = 'Modifier'; vBtn.className = 'btn btn--outline'; vBtn.disabled = false; vBtn.dataset.act = 'edit'; return; }
      const d = drafts[q.id] || (editing[q.id] ? run.ans[q.id] : null);
      vBtn.textContent = 'Valider' + (b.kind === 'TCS' ? ' (TCS ' + (b.questions.indexOf(q) + 1) + ')' : '');
      vBtn.disabled = !ansFilled(q, d) || (q.format === 'QROC' && wordCount(d.text) > 5);
      vBtn.dataset.act = 'validate';
    }
    function onValidate() {
      const act = vBtn.dataset.act;
      const b = curBlock();
      const q = activeQ(b);
      if (act === 'next') { go(run.cur + 1); return; }
      if (act === 'end') { askEnd(); return; }
      if (!q) return;
      if (act === 'edit') { editing[q.id] = true; drafts[q.id] = Object.assign({}, run.ans[q.id]); delete drafts[q.id].validated; paintBody(); paintPills(); return; }
      const d = drafts[q.id] || (editing[q.id] ? run.ans[q.id] : null);
      if (!ansFilled(q, d)) return;
      if (q.format === 'QROC' && wordCount(d.text) > 5) { toast('5 mots maximum'); return; }
      const a = { validated: true, at: Date.now() };
      if (q.options) a.sel = (d.sel || []).slice();
      if (q.format === 'QROC') a.text = String(d.text || '').trim();
      if (q.format === 'TCS') a.tcs = d.tcs;
      run.ans[q.id] = a;
      delete drafts[q.id];
      delete editing[q.id];
      haptic(10);
      if (run.mode === 'train' && run.immediate) {
        const res = scoreQ(q, a);
        if (!res.pending) { record(q, res.score, run.recorded[q.id]); run.recorded[q.id] = res.score; }
      }
      save();
      let focus = null;
      if (progressive(b)) { const nx = b.questions[openIndex(b)]; focus = nx ? nx.id : null; }
      else if (b.kind === 'TCS') { const nx = b.questions.find(function (x) { return !validated(x); }); tcsActive = nx ? nx.id : null; focus = run.immediate && run.mode === 'train' ? q.id : (nx ? nx.id : null); }
      else if (run.mode === 'train' && run.immediate) focus = q.id;
      paintBody(focus);
      paintPills();
    }
    function selfGrade(q, k) {
      const a = run.ans[q.id];
      if (!a) return;
      if (k) a.self = k; else delete a.self;
      const res = scoreQ(q, a);
      if (!res.pending) { record(q, res.score, run.recorded[q.id]); run.recorded[q.id] = res.score; }
      save();
      paintBody(q.id);
    }
    function go(bi, qid) {
      if (bi < 0 || bi >= run.blocks.length) return;
      // quitter une QI rouverte sans revalider : la réponse validée précédente reste (comme sur la plateforme)
      Object.keys(editing).forEach(function (id) { delete editing[id]; delete drafts[id]; });
      run.cur = bi;
      tcsActive = qid || null;
      save();
      paintBody(qid);
      paintPills();
      if (!qid) { try { const v = C.shell.viewEl(); if (v) v.scrollTop = 0; } catch (e) { /* ignore */ } }
    }

    /* --- fin d'épreuve */
    function slideToEnd() {
      const lab = h('span', {}, 'Glisser pour terminer ⟶');
      const rng = h('input', { type: 'range', min: '0', max: '100', value: '0', 'aria-label': 'Glisser jusqu’au bout pour terminer l’épreuve',
        on: { input: function () { lab.style.opacity = String(1 - rng.value / 120); },
          change: function () { const v = +rng.value; rng.value = '0'; lab.style.opacity = '1'; if (v >= 90) askEnd(); } } });
      return h('div', { class: 'edn-slide', title: 'Terminer l’épreuve : glisser puis confirmer' }, rng, lab);
    }
    function askEnd() {
      const qs = runQuestions(run);
      const nv = qs.filter(function (q) { return !validated(q); }).length;
      const nd = Object.keys(drafts).filter(function (id) { return drafts[id]; }).length;
      C.shell.confirm((nv ? plural(nv, 'question') + ' non validée' + (nv > 1 ? 's' : '') + ' (comptée' + (nv > 1 ? 's' : '') + ' 0). ' : 'Toutes les questions sont validées. ') +
        (nd ? 'Les saisies non validées seront perdues. ' : '') + 'Après la soumission, tu ne pourras plus revenir à l’épreuve.',
      { title: 'Terminer l’épreuve ?', ok: 'Soumettre ma copie', tone: 'danger' }).then(function (ok) { if (ok) submit(false); });
    }
    function submit(auto) {
      if (submitted) return;
      submitted = true;
      if (timer) { clearInterval(timer); timer = null; }
      finalize(run);
      if (auto) toast('Temps écoulé : copie soumise automatiquement', 'warn');
      try { C.shell.setSession(false); } catch (e) { /* ignore */ }
      C.router.go('#/edn/resultat');
    }

    /* --- chrono */
    function tick() {
      if (!root.isConnected && timer) { clearInterval(timer); timer = null; return; }
      if (!timed) { clock.textContent = '⏱ ' + fmtClock((Date.now() - run.createdAt) / 1000); return; }
      const left = (run.endsAt - Date.now()) / 1000;
      clock.textContent = fmtClock(left);
      clock.classList.toggle('is-low', left <= 300);
      [10, 5].forEach(function (m) {
        if (left <= m * 60 && left > 0 && !run.alerts[m] && run.durationSec > m * 60) {
          run.alerts[m] = true; save();
          toast('Il reste ' + m + ' minutes', 'warn'); haptic(60);
        }
      });
      if (left <= 0) submit(true);
    }
    tick();
    timer = setInterval(tick, 500);

    if (run.cur >= run.blocks.length) run.cur = 0;
    paintBody();
    paintPills();
    return function quit() {
      toast(timed ? 'Épreuve en pause : le chrono continue. Reprends depuis EDN / Partiels.' : 'Épreuve en pause : reprends depuis EDN / Partiels.');
      C.router.go('#/edn');
    };
  }

  /* copie soumise : statistiques + historique + dernière copie */
  function finalize(run) {
    run.done = true;
    run.submittedAt = run.submittedAt || Date.now();
    const ag = aggregate(run);
    ag.rows.forEach(function (r) {
      if (r.s.pending) return;
      if (run.recorded[r.q.id] != null) {
        if (run.recorded[r.q.id] !== r.s.score) { record(r.q, r.s.score, run.recorded[r.q.id]); run.recorded[r.q.id] = r.s.score; }
        return;
      }
      record(r.q, r.s.score, null); run.recorded[r.q.id] = r.s.score;
    });
    saveAttempt(run, ag);
    try { if (C.store && C.store.gainXp) C.store.gainXp(Math.round(5 * ag.glob.pts), 'edn'); } catch (e) { /* ignore */ }
    lsSet(LS_LAST, run);
    lsDel(LS_RUN);
    return ag;
  }

  /* ================================================================ résultats */
  function gauge(note, seuil) {
    const col = note >= seuil ? 'var(--ok)' : note >= seuil - 2 ? 'var(--warn)' : 'var(--bad)';
    return h('div', {},
      h('div', { class: 'edn-gauge', role: 'img', 'aria-label': 'Note ' + fmt(note) + ' sur 20, seuil ' + seuil },
        h('i', { style: 'width:' + Math.max(0, Math.min(100, note * 5)) + '%;background:' + col }), h('b', { style: 'left:' + seuil * 5 + '%' })),
      h('div', { class: 'edn-gauge__l' }, h('span', {}, '0'), h('span', { style: 'font-weight:700' }, 'seuil ' + seuil + '/20'), h('span', {}, '20')));
  }
  function table(title, groups, labelf) {
    const keys = Object.keys(groups);
    if (!keys.length) return null;
    return h('div', { class: 'card', style: 'margin-top:10px' },
      h('span', { class: 'caption' }, title),
      h('div', { class: 'edn-tab', style: 'margin-top:6px' }, keys.map(function (k) {
        const g = groups[k];
        const r = g.max ? g.pts / g.max : 0;
        const col = r >= 0.75 ? 'var(--ok)' : r >= 0.5 ? 'var(--warn)' : 'var(--bad)';
        return [h('span', {}, labelf ? labelf(k) : k), h('span', { style: 'text-align:right;font-variant-numeric:tabular-nums' }, fmt(g.pts) + ' / ' + g.n), h('strong', { style: 'text-align:right' }, Math.round(100 * r) + ' %'),
          h('span', { class: 'bar' }, h('i', { style: 'width:' + Math.round(100 * r) + '%;background:' + col }))];
      })));
  }
  function results(root, run) {
    let b2 = false;
    function paint() {
      const ag = aggregate(run);
      const partiel = run.mode === 'partiel';
      const glob = b2 ? ag.globB2 : ag.glob;
      const review = Object.keys(ag.byItem).filter(function (k) { const g = ag.byItem[k]; return g.max && g.pts / g.max < 0.7; });
      const nv = ag.rows.filter(function (r) { return r.s.unanswered; }).length;
      put(root,
        h('div', { class: 'edn-row', style: 'margin-bottom:8px' }, h('a', { href: '#/edn', class: 'btn btn--ghost btn--sm' }, '← EDN / Partiels'), h('span', { class: 'secondary', style: 'font-size:.8rem' }, fmtDate(run.submittedAt))),
        partiel ? h('div', { class: 'edn-warn', role: 'note', style: 'margin-bottom:10px' }, '⚠ ' + PARTIEL_WARN) : null,
        h('div', { class: 'card stack', style: 'text-align:center' },
          h('span', { class: 'caption' }, run.title + ' · ' + plural(ag.n, 'question') + (nv ? ' · ' + nv + ' non validée' + (nv > 1 ? 's' : '') : '')),
          partiel ? [
            h('div', { class: 'edn-big' }, fmt(ag.part.note) + '/20'),
            h('div', { class: 'secondary' }, run.weights ? 'Note pondérée par item (×1 à ×3, simulé)' : 'Note sur 20 (barème EDN)'),
            gauge(ag.part.note, 10),
            h('strong', { style: 'color:var(--' + (ag.part.note >= 10 ? 'ok' : 'bad') + ')' }, ag.part.note >= 10 ? 'Validé (≥ 10/20, simulé)' : 'Non validé (< 10/20, simulé)')
          ] : [
            h('span', { class: 'caption' }, 'Note double A (simulé)'),
            ag.aa.n ? h('div', { class: 'edn-big' }, fmt(ag.aa.note) + '/20') : h('div', { class: 'secondary' }, 'Aucune question AA dans cette épreuve'),
            ag.aa.n ? h('div', { class: 'secondary', style: 'font-size:.85rem' }, 'Questions de rang A au format A (QRU, QRP, QROC) : ' + fmt(ag.aa.pts) + ' / ' + ag.aa.n) : null,
            ag.aa.n ? gauge(ag.aa.note, 14) : null,
            ag.aa.n ? h('strong', { style: 'color:var(--' + (ag.aa.note >= 14 ? 'ok' : 'bad') + ')' }, ag.aa.note >= 14 ? 'Seuil de validation atteint (≥ 14/20)' : 'Sous le seuil de validation (14/20)') : null
          ]),
        !partiel ? h('div', { class: 'card stack', style: 'margin-top:10px' },
          h('div', { class: 'edn-row' }, h('span', { class: 'caption' }, 'Note globale'), h('strong', { style: 'font-size:1.4rem' }, fmt(glob.note) + '/20')),
          h('div', { class: 'secondary', style: 'font-size:.85rem' }, 'Toutes les questions, ' + (b2 ? 'rang B pondéré ×2 (groupe de DES de l’item)' : 'poids 1') + ' : ' + fmt(glob.pts) + ' / ' + glob.max + ' points.'),
          h('label', { class: 'edn-row', style: 'justify-content:flex-start' }, h('input', { type: 'checkbox', checked: b2, on: { change: function (e) { b2 = e.target.checked; paint(); } } }), 'Pondération B ×2')) : null,
        ag.pending ? h('div', { class: 'feedback feedback--info', style: 'margin-top:10px' }, plural(ag.pending, 'QROC') + ' à auto-évaluer dans la correction (comptée' + (ag.pending > 1 ? 's' : '') + ' 0 en attendant).') : null,
        table('Par format', ag.byFormat, function (k) { return FMT_LABEL[k] || k; }),
        table('Par rang', ag.byRank, function (k) { return 'Rang ' + k; }),
        table('Par code de notation', ag.byCode, function (k) { return k + (k === 'AA' ? ' (validation)' : ''); }),
        table('Par item', ag.byItem, itemLabel),
        review.length ? h('div', { class: 'card stack', style: 'margin-top:10px' }, h('span', { class: 'caption' }, 'Items à revoir (< 70 %)'),
          review.map(function (k) { return h('a', { class: 'btn btn--outline btn--block', href: '#/item/' + encodeURIComponent(k) }, itemLabel(k) + ' →'); })) : null,
        h('h2', { style: 'margin:20px 0 4px;font-size:1.15rem' }, 'Correction'),
        run.blocks.map(function (rb, bi) {
          const b = blockById(rb.id);
          if (!b) return null;
          const pts = b.questions.reduce(function (n, q) { return n + scoreInRun(q, run).score; }, 0);
          return h('details', { class: 'card edn-blk', open: pts < b.questions.length },
            h('summary', {}, (KIND_LABEL[b.kind] || b.kind) + ' ' + (bi + 1) + ' · ' + fmt(pts) + ' / ' + b.questions.length + ' · ' + itemLabel(b.item)),
            b.vignette ? h('div', { class: 'edn-vig edn-vig--static' }, h('div', { class: 'edn-vig__body' }, mdEl(b.vignette))) : null,
            mediaEl(b),
            b.questions.map(function (q, i) {
              const res = scoreInRun(q, run);
              const a = run.ans[q.id];
              return h('details', { class: 'edn-qc', open: res.score < 0.99 || res.pending },
                h('summary', {}, h('strong', {}, b.questions.length > 1 ? 'Q' + (i + 1) : 'Question'), h('span', { class: 'secondary', style: 'font-size:.85rem' }, FMT_LABEL[q.format] + ' · ' + fmt(res.score) + ' / 1'), run.flags[q.id] ? h('span', { style: 'color:var(--bad)' }, '⚑') : null),
                h('div', { class: 'stack stack--sm', style: 'margin-top:6px' },
                  i > 0 && q.reveal && (b.kind === 'DP' || b.kind === 'KFP') ? h('div', { class: 'edn-reveal' }, mdEl(q.reveal)) : null,
                  q.stem ? h('div', { class: 'edn-stem' }, mdEl(q.stem), stemSuffix(q) ? h('small', {}, stemSuffix(q)) : null) : null,
                  correction(q, a, res, optOrder(run, b, q), { weight: run.weights ? run.weights[q.id] : null,
                    itemLink: h('a', { href: '#/item/' + encodeURIComponent(b.item), style: 'font-size:.8rem' }, itemLabel(b.item)),
                    onSelf: function (k) {
                      if (k) a.self = k; else delete a.self;
                      const r2 = scoreQ(q, a);
                      if (!r2.pending) { record(q, r2.score, run.recorded[q.id]); run.recorded[q.id] = r2.score; }
                      saveAttempt(run, aggregate(run));
                      lsSet(LS_LAST, run);
                      const y = (C.shell.viewEl() || {}).scrollTop;
                      paint();
                      try { C.shell.viewEl().scrollTop = y; } catch (e) { /* ignore */ }
                    } })));
            }));
        }),
        h('div', { class: 'stack', style: 'margin-top:16px' },
          h('a', { class: 'btn btn--primary btn--block', href: '#/edn' }, 'Nouvelle épreuve')));
    }
    paint();
  }

  /* ================================================================ point d'entrée */
  function render(params, query) {
    ensureStyles();
    const mode = (params && params.mode) || '';
    const root = h('div', { class: 'page view-edn' });
    if (!bank().blocks.length) {
      put(root, h('div', { class: 'card empty' },
        h('p', { class: 'empty__title' }, 'EDN / Partiels en préparation'),
        h('p', { class: 'secondary' }, 'Les dossiers progressifs, KFP, QI et TCS tirés du Collège arrivent bientôt.')));
      return { el: root, title: 'EDN / Partiels' };
    }
    if (mode === 'run') {
      const run = lsGet(LS_RUN, null);
      if (!run || run.done || !Array.isArray(run.blocks) || !run.blocks.some(function (rb) { return blockById(rb.id); })) {
        lsDel(LS_RUN); hub(root); return { el: root, title: 'EDN / Partiels' };
      }
      run.blocks = run.blocks.filter(function (rb) { return blockById(rb.id); });   // bloc retiré de la banque depuis
      run.flags = run.flags || {}; run.ans = run.ans || {}; run.recorded = run.recorded || {}; run.alerts = run.alerts || {};
      if (run.endsAt && run.endsAt <= Date.now()) {   // temps écoulé hors de l'appli : soumission automatique
        finalize(run);
        toast('Temps écoulé : copie soumise automatiquement', 'warn');
        results(root, run);
        return { el: root, title: 'Résultats', back: '#/edn' };
      }
      const quit = runner(root, run);
      const done = runQuestions(run).filter(function (q) { return run.ans[q.id] && run.ans[q.id].validated; }).length;
      const tot = runQuestions(run).length;
      return { el: root, title: run.title, back: quit, session: { ratio: tot ? done / tot : 0, label: done + ' / ' + tot + ' validées' }, tab: 'review' };
    }
    if (mode === 'resultat') {
      const last = lsGet(LS_LAST, null);
      if (last && last.done && Array.isArray(last.blocks)) {
        last.ans = last.ans || {}; last.recorded = last.recorded || {}; last.flags = last.flags || {};
        results(root, last); return { el: root, title: 'Résultats', back: '#/edn' };
      }
    }
    if (mode === 'examen') { examSetup(root); return { el: root, title: 'Épreuve EDN', back: '#/edn' }; }
    if (mode === 'entrainement') { trainSetup(root); return { el: root, title: 'Entraînement EDN', back: '#/edn' }; }
    if (mode === 'partiels') { partielSetup(root); return { el: root, title: 'Partiels (simulation)', back: '#/edn' }; }
    hub(root);
    return { el: root, title: 'EDN / Partiels' };
  }

  C.views.edn = {
    render: render, available: available,
    // exposés pour les tests (app/_dev/test-edn.html)
    scoreQ: scoreQ, aggregate: aggregate, codeOf: codeOf, norm: norm, compose: compose, partielBlocks: partielBlocks, makeRun: makeRun
  };
})();
