/* CardioR2C — views/qcmmicro.js
 * QCM d'entraînement viro / bactério / parasito, écrits à partir des fiches (poly de la fac) et relus.
 * Données : content/qcm-micro.js → CARDIO.registry.qcmMicro = {ficheId: [{qid, type, rank, stem, options:[{l,t,ok,expl}], sec}]}.
 * Routes : #/qcm-micro (accueil) · #/qcm-micro/:id (QCM d'une fiche) · #/qcm-micro?mat=viro|bacterio|parasito|all (20 QCM mélangés,
 *   priorité aux jamais faits puis aux ratés). Correction immédiate après chaque question, barème EDN
 *   (0 discordance = 1 ; 1 = 0,5 ; 2 = 0,2 ; 3+ = 0 ; QRU tout ou rien), note sur 20 à la fin.
 * Progression : localStorage « cardio.qcmmicro » = {qid: {p, at}} (synchronisé via lsync, fusion entrée par entrée). */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  CARDIO.views = CARDIO.views || {};
  const LS = 'cardio.qcmmicro';
  const MAT = { viro: '🦠 Viro', bacterio: '🧫 Bactério', parasito: '🪱 Parasito-myco' };

  function util() { return CARDIO.util || {}; }
  function h() { return util().h.apply(null, arguments); }
  function str(x) { return x == null ? '' : String(x); }
  function bank() { const r = CARDIO.registry && CARDIO.registry.qcmMicro; return r && typeof r === 'object' ? r : {}; }
  function prog() { try { const o = JSON.parse(localStorage.getItem(LS) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function saveP(qid, p) { try { const o = prog(); o[qid] = { p: p, at: Date.now() }; localStorage.setItem(LS, JSON.stringify(o)); } catch (e) { /* ignore */ } }
  function fiches() {
    const r = CARDIO.registry || {}, out = [];
    Object.keys(MAT).forEach(function (m) { (Array.isArray(r[m]) ? r[m] : []).forEach(function (f) { if (f && bank()[f.id] && bank()[f.id].length) out.push({ id: f.id, title: f.title, mat: m }); }); });
    return out;
  }
  function fiche(id) { return fiches().filter(function (f) { return f.id === id; })[0] || null; }
  function inline(text) {
    const u = util(); let html = '';
    if (typeof u.md === 'function') { try { html = u.md(str(text)).trim().replace(/^<p>([\s\S]*)<\/p>$/, '$1'); } catch (e) { html = ''; } }
    return html ? h('span', { html: html }) : h('span', {}, str(text));
  }
  function stemEl(text) { const u = util(); return u.digest ? u.digest(text) : h('div', {}, inline(text)); }
  function fmt(x) { return (Math.round(x * 10) / 10).toString().replace('.', ','); }
  function score(q, sel) {
    const disc = q.options.filter(function (o) { return (sel.indexOf(o.l) >= 0) !== !!o.ok; }).length;
    if (!sel.length) return { p: 0, disc: disc };
    if (q.type === 'QRU') return { p: disc ? 0 : 1, disc: disc };
    return { p: disc === 0 ? 1 : disc === 1 ? 0.5 : disc === 2 ? 0.2 : 0, disc: disc };
  }
  function stats(qs) {
    const p = prog(); let done = 0, tot = 0;
    qs.forEach(function (q) { const r = p[q.qid]; if (r && typeof r.p === 'number') { done++; tot += r.p; } });
    return { done: done, n: qs.length, pct: done ? Math.round(tot / done * 100) : null };
  }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  let styled = false;
  function styles() {
    if (styled) return; styled = true;
    const css = [
      '.qm-opt{display:flex;gap:8px;align-items:flex-start;width:100%;text-align:left;border:1.5px solid var(--line,#ddd);background:var(--surface,#fff);color:inherit;border-radius:10px;padding:10px 12px;margin:6px 0;font:inherit;cursor:pointer}',
      '.qm-opt.sel{border-color:var(--primary,#2563eb);background:rgba(37,99,235,.07)}',
      '.qm-opt.good{border-color:#16a34a;background:rgba(22,163,74,.09)}', '.qm-opt.bad{border-color:#dc2626;background:rgba(220,38,38,.08)}',
      '.qm-opt.miss{border-color:#16a34a;border-style:dashed}', '.qm-l{font-weight:800;min-width:1.4em}',
      '.qm-tag{font-size:.72rem;font-weight:700;padding:1px 7px;border-radius:999px;margin-left:6px;white-space:nowrap}',
      '.qm-tag.v{background:#dcfce7;color:#166534}', '.qm-tag.f{background:#fee2e2;color:#991b1b}',
      '.qm-expl{display:block;font-size:.86rem;margin-top:5px;line-height:1.4;color:var(--muted,#4b5563)}',
      '.qm-stem{font-weight:600;line-height:1.45;margin:6px 0 10px}', '.qm-res{font-weight:800;margin:10px 0 4px}',
      '.qm-bar{height:6px;border-radius:3px;background:var(--line,#e5e7eb);overflow:hidden;margin:6px 0 12px}', '.qm-bar>div{height:100%;background:var(--accent,#2563eb)}',
      '.qm-row{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}',
      '.qm-ch{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-top:1px dashed var(--line,#e5e7eb);text-decoration:none;color:inherit}',
      '.qm-ch:first-of-type{border-top:0}', '.qm-ch .t{font-size:.9rem}', '.qm-ch .m{font-size:.76rem;color:var(--muted,#6b7280)}'
    ].join('\n');
    document.head.appendChild(h('style', {}, css));
  }

  /* nombre de QCM au choix : 10 / 20 / 30 / 50 / tous (selon le nombre dispo) */
  function poolCount(mat) { return fiches().filter(function (f) { return mat === 'all' || f.mat === mat; }).reduce(function (a, f) { return a + bank()[f.id].length; }, 0); }
  function chooser(mat, label) {
    const tot = poolCount(mat);
    if (!tot) return null;
    const ns = [10, 20, 30, 50].filter(function (n) { return n < tot; });
    return h('div', { class: 'qm-row', style: 'align-items:center' },
      label ? h('span', { class: 'secondary', style: 'font-size:.85rem' }, label) : null,
      ns.map(function (n) { return h('a', { class: 'btn btn--secondary btn--sm', href: '#/qcm-micro?mat=' + mat + '&n=' + n }, String(n)); }),
      h('a', { class: 'btn btn--primary btn--sm', href: '#/qcm-micro?mat=' + mat + '&n=all' }, 'Tous (' + tot + ')'));
  }

  /* ---------- accueil ---------- */
  function renderHome() {
    const page = h('div', { class: 'page' });
    page.appendChild(h('h1', {}, '📝 QCM micro'));
    page.appendChild(h('p', { class: 'secondary' }, 'QCM façon partiel écrits à partir des fiches du poly (rang A et B), chacun relu contre la fiche. Correction tout de suite après chaque question, barème EDN, note sur 20 à la fin.'));
    const all = fiches();
    if (!all.length) { page.appendChild(h('p', {}, 'QCM en cours de préparation.')); return page; }
    const allQ = all.reduce(function (a, f) { return a.concat(bank()[f.id]); }, []), sa = stats(allQ);
    page.appendChild(h('div', { class: 'card', style: 'padding:12px 14px;margin:10px 0' },
      h('b', {}, allQ.length + ' QCM · ' + sa.done + ' faits' + (sa.pct != null ? ' · ' + sa.pct + ' % des points' : '')),
      chooser('all', '🎲 QCM mélangés (toute la micro) :')));
    Object.keys(MAT).forEach(function (m) {
      const fs = all.filter(function (f) { return f.mat === m; });
      if (!fs.length) return;
      const qs = fs.reduce(function (a, f) { return a.concat(bank()[f.id]); }, []), s = stats(qs);
      const box = h('div', { class: 'card', style: 'padding:12px 14px;margin:12px 0' },
        h('b', { style: 'font-size:1.05rem' }, MAT[m] + ' · ' + qs.length + ' QCM'),
        chooser(m, '🎲 Mélangés :'),
        h('div', { class: 'secondary', style: 'font-size:.8rem;margin-top:2px' }, s.done + ' / ' + s.n + ' faits' + (s.pct != null ? ' · ' + s.pct + ' % des points' : '')));
      fs.forEach(function (f) {
        const st = stats(bank()[f.id]);
        box.appendChild(h('a', { class: 'qm-ch', href: '#/qcm-micro/' + encodeURIComponent(f.id) },
          h('div', {}, h('div', { class: 't' }, f.title), h('div', { class: 'm' }, st.n + ' QCM' + (st.done ? ' · ' + st.done + ' faits · ' + st.pct + ' %' : ''))),
          h('span', { style: 'font-weight:800;color:' + (st.pct == null ? 'var(--muted,#9ca3af)' : st.pct >= 80 ? '#16a34a' : st.pct >= 50 ? '#d97706' : '#dc2626') }, st.pct == null ? '›' : st.pct + ' %')));
      });
      page.appendChild(box);
    });
    return page;
  }

  /* ---------- une session ---------- */
  function renderSession(qs, title, back, more) {
    const page = h('div', { class: 'page' });
    page.appendChild(h('a', { href: back, class: 'secondary', style: 'text-decoration:none' }, '← ' + (back === '#/qcm-micro' ? 'QCM micro' : 'Retour')));
    page.appendChild(h('h1', { style: 'margin-top:6px;font-size:1.25rem' }, title));
    const holder = h('div', {});
    page.appendChild(holder);
    let i = 0, sel = [], shown = false, tot = 0;
    const res = [];
    function drawQ() {
      if (i >= qs.length) return drawEnd();
      const q = qs[i];
      const kids = [h('div', { class: 'secondary', style: 'font-size:.8rem' }, 'Question ' + (i + 1) + ' / ' + qs.length + ' · ' + q.type + (q.rank === 'B' ? ' · rang B' : '') + (q._t ? ' · ' + q._t : '')),
        h('div', { class: 'qm-bar' }, h('div', { style: 'width:' + Math.round(i / qs.length * 100) + '%' })),
        h('div', { class: 'qm-stem' }, stemEl(q.stem))];
      q.options.forEach(function (o) {
        const picked = sel.indexOf(o.l) >= 0;
        let cls = 'qm-opt' + (picked ? ' sel' : '');
        if (shown) cls = 'qm-opt' + (o.ok ? (picked ? ' good' : ' miss') : (picked ? ' bad' : ''));
        kids.push(h('button', { type: 'button', class: cls, on: { click: function () {
          if (shown) return;
          sel = q.type === 'QRU' ? [o.l] : (picked ? sel.filter(function (x) { return x !== o.l; }) : sel.concat(o.l));
          drawQ();
        } } }, h('span', { class: 'qm-l' }, o.l + '.'), h('span', { style: 'flex:1' }, inline(o.t),
          shown ? h('span', { class: 'qm-tag ' + (o.ok ? 'v' : 'f') }, o.ok ? 'Vrai' : 'Faux') : null,
          shown && o.expl ? h('span', { class: 'qm-expl' }, inline(o.expl)) : null)));
      });
      if (!shown) {
        kids.push(h('button', { type: 'button', class: 'btn btn--primary btn--block', style: 'margin-top:10px', disabled: sel.length ? null : true, on: { click: function () {
          const sc = score(q, sel); saveP(q.qid, sc.p); tot += sc.p; res.push({ q: q, p: sc.p }); shown = true; drawQ();
        } } }, 'Valider'));
      } else {
        const r = res[res.length - 1];
        kids.push(h('div', { class: 'qm-res', style: 'color:' + (r.p === 1 ? '#16a34a' : r.p > 0 ? '#d97706' : '#dc2626') },
          (r.p === 1 ? '✅ 1 point' : (r.p > 0 ? '🟠 ' : '❌ ') + fmt(r.p) + ' point') + ' · réponse : ' + q.options.filter(function (o) { return o.ok; }).map(function (o) { return o.l; }).join(', ')));
        const f = q._f ? fiche(q._f) : null;
        kids.push(h('div', { class: 'qm-row' },
          h('button', { type: 'button', class: 'btn btn--primary', style: 'flex:1', on: { click: function () { i++; sel = []; shown = false; drawQ(); window.scrollTo(0, 0); } } }, i + 1 < qs.length ? 'Question suivante →' : 'Voir ma note'),
          f ? h('a', { class: 'btn btn--secondary', href: '#/parasito/' + encodeURIComponent(f.id) }, 'Fiche') : null));
      }
      holder.replaceChildren(h('div', { class: 'card', style: 'padding:12px 14px' }, kids));
    }
    function drawEnd() {
      const note = qs.length ? tot / qs.length * 20 : 0;
      const bad = res.filter(function (r) { return r.p < 1; });
      holder.replaceChildren(h('div', { class: 'card', style: 'padding:16px;text-align:center' },
        h('div', { style: 'font-size:2rem;font-weight:800' }, '🎯 ' + fmt(note) + ' / 20'),
        h('div', { class: 'secondary' }, fmt(tot) + ' points sur ' + qs.length + ' · ' + (qs.length - bad.length) + ' sans faute'),
        h('div', { class: 'qm-row', style: 'justify-content:center' },
          bad.length ? h('button', { type: 'button', class: 'btn btn--primary btn--sm', on: { click: function () { qs = bad.map(function (r) { return r.q; }); i = 0; sel = []; shown = false; tot = 0; res.length = 0; drawQ(); } } }, '↻ Refaire les ' + bad.length + ' ratés') : null,
          more ? h('a', { class: 'btn btn--primary btn--sm', href: more.href + '&r=' + Date.now() }, '➕ Enchaîner ' + more.n + ' autres') : null,
          h('a', { class: 'btn btn--secondary btn--sm', href: back }, 'Terminer'))),
        bad.length ? h('div', { class: 'card', style: 'padding:12px 14px;margin-top:12px' }, h('b', {}, 'À revoir sur la fiche'),
          bad.map(function (r) { const f = r.q._f ? fiche(r.q._f) : null; return h('div', { class: 'qm-ch' }, h('div', { class: 't' }, (f ? f.title + ' · ' : '') + str(r.q.sec)), f ? h('a', { class: 'btn btn--ghost btn--sm', href: '#/parasito/' + encodeURIComponent(f.id) }, 'Fiche') : null); })) : null);
    }
    drawQ();
    return page;
  }

  function render(params, query) {
    styles();
    query = query || {};
    let el;
    const id = params && params.id;
    if (id && bank()[id]) {
      const f = fiche(id);
      el = renderSession(bank()[id].map(function (q) { return Object.assign({ _f: id }, q); }), (f ? f.title : id) + ' · QCM', '#/qcm-micro');
    } else if (query.mat && (MAT[query.mat] || query.mat === 'all')) {
      const p = prog();
      const pool = fiches().filter(function (f) { return query.mat === 'all' || f.mat === query.mat; }).reduce(function (a, f) {
        return a.concat(bank()[f.id].map(function (q) { return Object.assign({ _f: f.id, _t: f.title }, q); }));
      }, []);
      const never = shuffle(pool.filter(function (q) { return !p[q.qid]; })), weak = shuffle(pool.filter(function (q) { return p[q.qid] && p[q.qid].p < 1; })), good = shuffle(pool.filter(function (q) { return p[q.qid] && p[q.qid].p >= 1; }));
      const nq = query.n === 'all' ? pool.length : Math.max(1, parseInt(query.n, 10) || 20);
      const n = Math.min(nq, pool.length);
      const pick = never.slice(0, Math.ceil(n * 0.6)).concat(weak.slice(0, n)).concat(never.slice(Math.ceil(n * 0.6))).concat(good).slice(0, n);
      el = renderSession(shuffle(pick), '🎲 ' + (query.mat === 'all' ? 'Micro' : MAT[query.mat]) + ' · ' + n + ' QCM mélangés', '#/qcm-micro',
        n < pool.length ? { n: Math.min(n, pool.length), href: '#/qcm-micro?mat=' + query.mat + '&n=' + n } : null);
    } else el = renderHome();
    return { el: el, title: 'QCM micro' };
  }
  CARDIO.views.qcmmicro = { render: render, available: function () { return fiches().length > 0; }, count: function (id) { return (bank()[id] || []).length; },
    chooser: function (mat, label) { styles(); return chooser(mat, label); } };
})();
