/* CardioR2C — views/hiba.js
 * Rubrique « Hiba » : sujets de virologie SU en conditions d'examen (aucune correction ni commentaire avant la fin),
 * minuteur, note sur 20 et correction complète à la fin (Valide / Faux, commentaire pédagogique officiel, correction détaillée).
 * Données : content/hiba.js → CARDIO.registry.hiba = [{id, titre, date, source, blocks:[{titre, intro, questions:[…]}]}]
 *   (même format que les annales ; option.flag = 'indispensable' | 'inacceptable').
 * Barème par QCM : option « inacceptable » cochée → 0 ; option « indispensable » non cochée → 0 ;
 *   sinon 0 discordance = 1, 1 = 0,5, 2 = 0,2, 3 et plus = 0 ; QRU : tout ou rien.
 * Progression : localStorage « cardio.hiba » = {qid: {sel, draft|ok, pts, disc}, '@<examId>': {t0, acc, run, dur, end}}.
 * Routes : #/hiba (liste) · #/hiba/:id (sujet ; ?mode=revision = tout corrigé d'emblée). */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  CARDIO.views = CARDIO.views || {};
  const LS = 'cardio.hiba';

  function util() { return CARDIO.util || {}; }
  function h() { return util().h.apply(null, arguments); }
  function str(x) { return x == null ? '' : String(x); }
  function all() { const r = CARDIO.registry && CARDIO.registry.hiba; return Array.isArray(r) ? r : []; }
  function prog() { try { const o = JSON.parse(localStorage.getItem(LS) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function put(k, v) { try { const o = prog(); if (v === null) delete o[k]; else o[k] = v; localStorage.setItem(LS, JSON.stringify(o)); } catch (e) { /* ignore */ } }
  function questions(ex) { return (ex.blocks || []).reduce(function (a, b) { return a.concat(b.questions || []); }, []); }
  function closed(q) { return Array.isArray(q.options) && q.options.length > 0 && q.options.some(function (o) { return typeof o.ok === 'boolean'; }); }
  function md(text) {
    const u = util(); let html = '';
    if (typeof u.md === 'function') { try { html = u.md(str(text)).trim(); } catch (e) { html = ''; } }
    return html ? h('div', { class: 'an-md', html: html }) : h('div', { class: 'an-md' }, str(text));
  }
  function inline(text) {
    const u = util(); let html = '';
    if (typeof u.md === 'function') { try { html = u.md(str(text)).trim().replace(/^<p>([\s\S]*)<\/p>$/, '$1'); } catch (e) { html = ''; } }
    return html ? h('span', { html: html }) : h('span', {}, str(text));
  }
  function fmt(x) { return (Math.round(x * 10) / 10).toString().replace('.', ','); }
  function clock(ms) { const s = Math.max(0, Math.round(ms / 1000)), m = Math.floor(s / 60); return (m >= 60 ? Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') : String(m)) + ':' + String(s % 60).padStart(2, '0'); }

  /* images : bundles content/annales-img/<unité>.js (comme les annales), chargés à la demande */
  const bundles = {};
  function cached(src) { return (CARDIO.annImg && CARDIO.annImg[src]) || ''; }
  function bundle(src) {
    const m = /^img\/annales\/([^/]+)\//.exec(str(src)), name = m ? m[1] : '_root';
    if (!bundles[name]) bundles[name] = new Promise(function (res) { const s = document.createElement('script'); s.src = 'content/annales-img/' + name + '.js'; s.charset = 'utf-8'; s.onload = res; s.onerror = res; document.head.appendChild(s); });
    return bundles[name];
  }
  function imgEl(q, k) {
    const im = h('img', { src: cached(q[k]) || 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', alt: str(q.imgAlt || 'Figure du sujet'), loading: 'lazy', style: 'max-width:100%;height:auto;border-radius:8px;margin:4px 0 10px;background:#fff;display:block' });
    let tries = 0;
    const viaPriv = function () { if (!CARDIO.privImg || tries > 8) return; tries++; CARDIO.privImg(q[k]).then(function (u) { im.src = u; }).catch(function () { setTimeout(viaPriv, 1500); }); };
    im.addEventListener('error', function () { if (!/^blob:/.test(im.src)) viaPriv(); });
    if (!cached(q[k])) bundle(q[k]).then(function () { im.src = cached(q[k]) || q[k]; });
    return im;
  }

  /* ---------- barème ---------- */
  function score(q, sel) {
    const opts = q.options || [];
    const disc = opts.filter(function (o) { return (sel.indexOf(o.l) >= 0) !== !!o.ok; }).length;
    if (!sel.length) return { pts: 0, disc: disc, why: 'sans réponse' };
    if (opts.some(function (o) { return o.flag === 'inacceptable' && sel.indexOf(o.l) >= 0; })) return { pts: 0, disc: disc, why: 'proposition inacceptable cochée' };
    if (opts.some(function (o) { return o.flag === 'indispensable' && sel.indexOf(o.l) < 0; })) return { pts: 0, disc: disc, why: 'proposition indispensable non cochée' };
    if (q.type === 'QRU') return { pts: disc ? 0 : 1, disc: disc };
    return { pts: disc === 0 ? 1 : disc === 1 ? 0.5 : disc === 2 ? 0.2 : 0, disc: disc };
  }

  let styled = false;
  function styles() {
    if (styled) return; styled = true;
    const css = [
      '.an-q{margin:12px 0}', '.an-stem{font-weight:600;margin:6px 0 10px;line-height:1.4}',
      '.an-intro{background:var(--surface-2,#f3f4f6);border-radius:10px;padding:10px 12px;margin:8px 0;line-height:1.45}',
      '.an-opt{display:flex;gap:8px;align-items:flex-start;width:100%;text-align:left;border:1.5px solid var(--line,#ddd);background:var(--surface,#fff);color:inherit;border-radius:10px;padding:9px 11px;margin:6px 0;font:inherit;cursor:pointer}',
      '.an-opt.sel{border-color:var(--primary,#2563eb);background:rgba(37,99,235,.07)}',
      '.an-opt.good{border-color:#16a34a;background:rgba(22,163,74,.09)}', '.an-opt.bad{border-color:#dc2626;background:rgba(220,38,38,.08)}',
      '.an-opt.miss{border-color:#16a34a;border-style:dashed}', '.an-l{font-weight:800;min-width:1.4em}',
      '.an-tag{font-size:.72rem;font-weight:700;padding:1px 7px;border-radius:999px;margin-left:6px;white-space:nowrap}',
      '.an-tag.v{background:#dcfce7;color:#166534}', '.an-tag.f{background:#fee2e2;color:#991b1b}', '.an-tag.k{background:#fef3c7;color:#92400e}',
      '.an-note{display:block;color:#b91c1c;font-size:.82rem;margin-top:3px}', '.an-expl{display:block;font-size:.86rem;margin-top:5px;line-height:1.4}',
      '.an-box{border-left:3px solid var(--primary,#2563eb);padding:8px 12px;margin:10px 0;background:rgba(37,99,235,.05);border-radius:0 10px 10px 0}',
      '.an-off{border-left-color:#b91c1c;background:rgba(185,28,28,.05)}', '.an-md p{margin:.3em 0}',
      '.an-bar{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}', '.an-res{font-weight:700;margin:6px 0}',
      '.hb-timer{position:sticky;top:calc(var(--topbar-h,0px) + 6px);z-index:5;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 12px;border-radius:12px;background:var(--surface,#fff);box-shadow:var(--shadow-2,0 2px 10px rgba(0,0,0,.12));margin:8px 0}',
      '.hb-time{font-variant-numeric:tabular-nums;font-weight:800;font-size:1.2rem;min-width:5.5ch}', '.hb-time.low{color:#dc2626}'
    ].join('\n');
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  }

  /* ---------- liste ---------- */
  function renderList() {
    styles();
    const p = prog();
    const page = h('div', { class: 'page' });
    page.appendChild(h('h1', {}, '🦠 Hiba'));
    page.appendChild(h('p', { class: 'secondary' }, 'Sujets officiels de virologie de la fac, en conditions d’examen : minuteur, aucune correction ni commentaire pendant l’épreuve. À la fin : ta note, puis la correction officielle, les commentaires pédagogiques et une correction détaillée.'));
    if (!all().length) { page.appendChild(h('p', {}, 'Aucun sujet chargé.')); return page; }
    all().forEach(function (ex) {
      const st = p['@' + ex.id];
      page.appendChild(h('a', { class: 'card', href: '#/hiba/' + encodeURIComponent(ex.id), style: 'display:block;padding:12px 14px;margin:8px 0;text-decoration:none;color:inherit' },
        h('b', {}, str(ex.titre)),
        h('div', { class: 'secondary', style: 'font-size:.85rem;margin-top:2px' }, [questions(ex).length + ' questions', st && st.end ? '🎯 ' + fmt(st.note) + ' / 20 en ' + clock(st.used) : st && st.t0 ? 'en cours' : 'pas encore fait'].join(' · '))));
    });
    page.appendChild(h('p', { class: 'secondary', style: 'font-size:.8rem;margin-top:14px' }, 'Barème : proposition indispensable non cochée ou inacceptable cochée = 0 ; sinon tout juste = 1, une erreur ou un oubli = 0,5, deux = 0,2, trois et plus = 0 (QRU : tout ou rien). Les questions ouvertes ne sont pas notées.'));
    return page;
  }

  /* ---------- un sujet ---------- */
  function renderExam(ex, query) {
    styles();
    const revision = query && query.mode === 'revision';
    const SK = '@' + ex.id;
    const st0 = prog()[SK] || {};
    const isEnd = !!st0.end;
    const shown = revision || isEnd;
    const page = h('div', { class: 'page' });
    page.dataset.title = str(ex.titre);
    page.appendChild(h('a', { href: '#/hiba', class: 'secondary', style: 'text-decoration:none' }, '← Hiba'));
    page.appendChild(h('h1', { style: 'margin-top:6px' }, str(ex.titre)));
    if (ex.source) page.appendChild(h('p', { class: 'secondary', style: 'font-size:.85rem' }, str(ex.source)));
    page.appendChild(h('div', { class: 'an-bar' },
      h('a', { class: 'btn btn--sm ' + (revision ? 'btn--outline' : 'btn--primary'), href: '#/hiba/' + encodeURIComponent(ex.id) }, '✍️ Examen'),
      h('a', { class: 'btn btn--sm ' + (revision ? 'btn--primary' : 'btn--outline'), href: '#/hiba/' + encodeURIComponent(ex.id) + '?mode=revision' }, '👀 Révision (tout corrigé)')));

    /* minuteur */
    const timeEl = h('span', { class: 'hb-time' }, '0:00');
    const timerBar = h('div', { class: 'hb-timer' });
    function st() { return prog()[SK] || {}; }
    function used(s) { return (s.acc || 0) + (s.run ? Date.now() - s.run : 0); }
    function setSt(patch) { put(SK, Object.assign({}, st(), patch)); }
    let tick = null;
    function drawTimer() {
      const s = st(), u = used(s);
      if (s.dur) { const left = s.dur * 60000 - u; timeEl.textContent = left > 0 ? '⏳ ' + clock(left) : '⏰ Temps écoulé'; timeEl.className = 'hb-time' + (left < 5 * 60000 ? ' low' : ''); }
      else { timeEl.textContent = '⏱️ ' + clock(u); timeEl.className = 'hb-time'; }
    }
    function buildTimer() {
      const s = st();
      const kids = [timeEl];
      kids.push(h('button', { type: 'button', class: 'btn btn--sm btn--outline', on: { click: function () { const x = st(); if (x.run) setSt({ acc: used(x), run: 0, paused: 1 }); else setSt({ run: Date.now(), t0: x.t0 || Date.now(), paused: 0 }); buildTimer(); } } }, s.run ? '⏸ Pause' : '▶️ ' + (s.t0 ? 'Reprendre' : 'Démarrer')));
      const sel = h('select', { class: 'btn btn--sm btn--ghost', 'aria-label': 'Durée', on: { change: function (e) { setSt({ dur: Number(e.target.value) || 0 }); drawTimer(); } } },
        [['0', 'Chrono libre'], ['30', '30 min'], ['45', '45 min'], ['60', '1 h'], ['90', '1 h 30'], ['120', '2 h']].map(function (o) { const op = h('option', { value: o[0] }, o[1]); if (String(s.dur || 0) === o[0]) op.selected = true; return op; }));
      kids.push(sel);
      timerBar.replaceChildren.apply(timerBar, kids);
      drawTimer();
    }
    if (!shown) {
      if (!st0.t0) setSt({ t0: Date.now(), run: Date.now(), acc: 0 });   // démarre à l'ouverture du sujet
      else if (!st0.run && !st0.paused) setSt({ run: Date.now() });   // reprend en revenant sur le sujet (sauf pause volontaire)
      buildTimer();
      page.appendChild(timerBar);
      tick = setInterval(function () { if (!timerBar.isConnected) { clearInterval(tick); const x = st(); if (x.run && !x.end) setSt({ acc: used(x), run: 0 }); return; } drawTimer(); }, 1000);   // quitter la page = pause
    }

    const head = h('div', { class: 'an-res' });
    page.appendChild(head);
    const endBox = h('div', { class: 'card', style: 'margin-top:18px;display:grid;gap:8px;text-align:center' });

    function answered() { const p = prog(); return questions(ex).filter(closed).filter(function (q) { const r = p[q.id]; return r && Array.isArray(r.sel) && r.sel.length; }).length; }
    function finish() {
      const p = prog(), qs = questions(ex);
      let tot = 0, n = 0, perfect = 0;
      qs.forEach(function (q) {
        const r = p[q.id], sel = r && Array.isArray(r.sel) ? r.sel : [];
        if (closed(q)) { const sc = score(q, sel); put(q.id, { sel: sel, pts: sc.pts, disc: sc.disc, why: sc.why || '' }); tot += sc.pts; n++; if (sc.pts === 1) perfect++; }
      });
      const s = st();
      put(SK, { t0: s.t0, acc: 0, run: 0, dur: s.dur || 0, end: Date.now(), used: used(s), note: n ? tot / n * 20 : 0, pts: tot, n: n, perfect: perfect });
      location.hash = '#/hiba/' + encodeURIComponent(ex.id) + '?r=' + Date.now();
    }
    function restart() {
      const p = prog();
      questions(ex).forEach(function (q) { delete p[q.id]; });
      delete p[SK];
      try { localStorage.setItem(LS, JSON.stringify(p)); } catch (e) { /* ignore */ }
      location.hash = '#/hiba/' + encodeURIComponent(ex.id) + '?r=' + Date.now();
    }
    function upd() {
      if (revision) { head.textContent = 'Mode révision : réponses, commentaires et corrections affichés'; endBox.style.display = 'none'; return; }
      const n = questions(ex).filter(closed).length;
      if (isEnd) {
        const s = st();
        head.textContent = '🎯 ' + fmt(s.note) + ' / 20 · ' + fmt(s.pts) + ' / ' + s.n + ' points · ' + s.perfect + ' QCM sans faute · ⏱️ ' + clock(s.used);
        endBox.replaceChildren(h('b', { style: 'font-size:1.2rem' }, '🎯 ' + fmt(s.note) + ' / 20'),
          h('div', { class: 'secondary' }, fmt(s.pts) + ' points sur ' + s.n + ' · ' + s.perfect + ' QCM sans faute · temps : ' + clock(s.used)),
          h('button', { type: 'button', class: 'btn btn--outline btn--sm', style: 'justify-self:center', on: { click: restart } }, '↺ Refaire le sujet'));
        return;
      }
      const a = answered();
      head.textContent = a + ' / ' + n + ' QCM répondus · note et correction à la fin';
      endBox.replaceChildren(h('b', {}, 'Fini ?'), h('div', { class: 'secondary' }, a < n ? (n - a) + ' QCM sans réponse (comptés 0).' : 'Tous les QCM sont répondus.'),
        h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: finish } }, 'Terminer et voir ma note + la correction'));
    }

    function questionEl(q) {
      const wrap = h('div', { class: 'card an-q', style: 'padding:12px 14px' });
      const isC = closed(q);
      let sel = (function () { const r = prog()[q.id]; return r && Array.isArray(r.sel) ? r.sel.slice() : []; })();
      function draw() {
        const kids = [h('div', { class: 'caption' }, 'Question ' + str(q.num) + (q.type ? ' · ' + q.type : '')), h('div', { class: 'an-stem' }, md(q.stem))];
        ['img', 'img2', 'img3', 'img4', 'img5'].forEach(function (k) { if (q[k]) kids.push(imgEl(q, k)); });
        if (q.after) kids.push(h('div', { class: 'an-stem', style: 'font-weight:500' }, md(q.after)));
        if (isC) {
          q.options.forEach(function (o) {
            const picked = sel.indexOf(o.l) >= 0;
            let cls = 'an-opt' + (picked ? ' sel' : '');
            if (shown) cls = 'an-opt' + (o.ok ? (picked || revision ? ' good' : ' miss') : (picked ? ' bad' : ''));
            kids.push(h('button', { type: 'button', class: cls, on: { click: function () {
              if (shown) return;
              sel = q.type === 'QRU' ? [o.l] : (picked ? sel.filter(function (x) { return x !== o.l; }) : sel.concat(o.l));
              put(q.id, { sel: sel, draft: 1 });
              draw(); upd();
            } } },
              h('span', { class: 'an-l' }, o.l + '.'),
              h('span', { style: 'flex:1' }, inline(o.t),
                shown ? h('span', { class: 'an-tag ' + (o.ok ? 'v' : 'f') }, o.ok ? 'Valide' : 'Faux') : null,
                shown && o.flag ? h('span', { class: 'an-tag k' }, o.flag === 'indispensable' ? '⭐ Indispensable' : '⛔ Inacceptable') : null,
                shown && o.note && !o.flag ? h('span', { class: 'an-note' }, '✍️ Corrigé : ' + str(o.note)) : null,
                shown && o.expl ? h('span', { class: 'an-expl' }, inline(o.expl)) : null)));
          });
        } else if (Array.isArray(q.options) && q.options.length) {
          q.options.forEach(function (o) { kids.push(h('div', { class: 'an-opt', style: 'cursor:default' }, h('span', { class: 'an-l' }, o.l + '.'), h('span', {}, inline(o.t)))); });
        }
        if (!shown) {
          kids.push(h('div', { class: 'secondary', style: 'font-size:.8rem;margin-top:6px' }, isC ? (sel.length ? '✓ Réponse enregistrée' : 'Coche ta réponse') : 'Question ouverte : réponds de tête (non notée), la correction s’affiche à la fin'));
        } else {
          const r = prog()[q.id];
          if (isC && !revision && r) kids.push(h('div', { class: 'an-res', style: 'color:' + (r.pts === 1 ? '#16a34a' : r.pts > 0 ? '#d97706' : '#dc2626') },
            (r.pts === 1 ? '✅ 1 point' : (r.pts > 0 ? '🟠 ' : '❌ ') + fmt(r.pts || 0) + ' point' + (r.why ? ' · ' + r.why : ' · ' + r.disc + ' discordance' + (r.disc > 1 ? 's' : ''))) + ' · réponse : ' + q.options.filter(function (o) { return o.ok; }).map(function (o) { return o.l; }).join(', ')));
          if (q.answer) kids.push(h('div', { class: 'an-box an-off' }, h('div', { class: 'caption' }, 'Réponse attendue (corrigé officiel)'), md(q.answer)));
          if (q.offComment) kids.push(h('div', { class: 'an-box an-off' }, h('div', { class: 'caption' }, '🎓 Commentaire pédagogique (officiel)'), md(q.offComment)));
          if (q.conflict) kids.push(h('div', { class: 'an-box', style: 'border-left-color:#d97706;background:rgba(217,119,6,.07)' }, h('div', { class: 'caption' }, '⚠️ Corrigé officiel ≠ poly'), md(q.conflict)));
          if (q.expl) kids.push(h('div', { class: 'an-box' }, h('div', { class: 'caption' }, '📖 Correction détaillée'), md(q.expl)));
        }
        wrap.replaceChildren.apply(wrap, kids.filter(Boolean));
      }
      draw();
      return wrap;
    }

    upd();
    (ex.blocks || []).forEach(function (b) {
      if (b.titre) page.appendChild(h('h2', { style: 'margin-top:18px' }, str(b.titre)));
      if (b.intro) page.appendChild(h('div', { class: 'an-intro' }, md(b.intro)));
      (b.questions || []).forEach(function (q) {
        if (q.intro) page.appendChild(h('div', { class: 'an-intro' }, md(q.intro)));
        page.appendChild(questionEl(q));
      });
    });
    page.appendChild(endBox);
    upd();
    return page;
  }

  function render(params, query) {
    const id = params && params.id;
    let el;
    if (id) { const ex = all().filter(function (x) { return x.id === id; })[0]; el = ex ? renderExam(ex, query || {}) : renderList(); }
    else el = renderList();
    return { el: el, title: el.dataset.title || 'Hiba' };
  }
  CARDIO.views.hiba = { render: render, available: function () { return all().length > 0; }, score: score };
})();
