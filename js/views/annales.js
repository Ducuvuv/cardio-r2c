/* CardioR2C — views/annales.js
 * Rubrique « Annales SU officiel » : sujets officiels de la fac (Sorbonne Université) reproduits tels quels, avec la
 * correction officielle (Valide / Faux + annotations du corrigé) et une correction détaillée item par item.
 * Données : content/annales.js → CARDIO.registry.annales = [{id, matiere, titre, date, source, blocks:[{titre, intro,
 *   questions:[{id, num, type, stem, options:[{l, t, ok, note, expl}], answer, offComment, expl}]}]}]
 *   (ok = réponse officielle de l'option ; answer = réponse attendue pour une question ouverte).
 * Routes : #/annales (liste) · #/annales/:id (sujet ; ?mode=revision affiche tout corrigé d'emblée).
 * Progression : localStorage « cardio.annales » = {qid: {ok, sel, at}} (synchronisé via js/lsync.js). Privé : non
 * publié sur GitHub Pages (deploy_ghpages.py saute content/annales.js). */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  CARDIO.views = CARDIO.views || {};
  const LS = 'cardio.annales';
  const MAT = { parasito: '🪱 Parasito-myco', bacterio: '🧫 Bactério', viro: '🦠 Viro', cardio: '❤️ Cardio', pneumo: '🫁 Pneumo', dermato: '🧴 Dermato' };

  function util() { return CARDIO.util || {}; }
  function h() { return util().h.apply(null, arguments); }
  function str(x) { return x == null ? '' : String(x); }
  function all() { const r = CARDIO.registry && CARDIO.registry.annales; return Array.isArray(r) ? r : []; }
  function prog() { try { const o = JSON.parse(localStorage.getItem(LS) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function saveQ(id, rec) { try { const o = prog(); o[id] = Object.assign({}, rec, { at: Date.now() }); localStorage.setItem(LS, JSON.stringify(o)); } catch (e) { /* ignore */ } }
  function resetExam(ex) { try { const o = prog(); questions(ex).forEach(function (q) { o[q.id] = { reset: 1, at: Date.now() }; }); localStorage.setItem(LS, JSON.stringify(o)); } catch (e) { /* ignore */ } }
  function questions(ex) { return (ex.blocks || []).reduce(function (a, b) { return a.concat(b.questions || []); }, []); }
  function done(rec) { return rec && !rec.reset && typeof rec.ok === 'boolean'; }
  function md(text) {
    const u = util(); let html = '';
    if (typeof u.md === 'function') { try { html = u.md(str(text)).trim(); } catch (e) { html = ''; } }
    return html ? h('div', { class: 'an-md', html: html }) : h('div', { class: 'an-md' }, str(text));
  }
  /* énoncés : mise en forme digeste partagée avec views/hiba.js (tableaux de bilans, anomalies en rouge) */
  function digest(text) { const v = CARDIO.views && CARDIO.views.hiba; return v && typeof v.digest === 'function' ? v.digest(text) : md(text); }
  function inline(text) {
    const u = util(); let html = '';
    if (typeof u.md === 'function') { try { html = u.md(str(text)).trim().replace(/^<p>([\s\S]*)<\/p>$/, '$1'); } catch (e) { html = ''; } }
    return html ? h('span', { html: html }) : h('span', {}, str(text));
  }
  /* images : regroupées par sujet dans content/annales-img/<unité>.js (limite de fichiers de l'artefact), chargées à la demande */
  const bundles = {};
  function annCached(src) { return (CARDIO.annImg && CARDIO.annImg[src]) || ''; }
  function annBundle(src) {
    const m = /^img\/annales\/([^/]+)\//.exec(str(src));
    const name = m ? m[1] : '_root';
    if (!bundles[name]) bundles[name] = new Promise(function (res) {
      const s = document.createElement('script');
      s.src = 'content/annales-img/' + name + '.js'; s.charset = 'utf-8';
      s.onload = res; s.onerror = res; document.head.appendChild(s);
    });
    return bundles[name];
  }
  function closed(q) { return Array.isArray(q.options) && q.options.length > 0 && q.options.some(function (o) { return typeof o.ok === 'boolean'; }); }

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
      '.an-tag.v{background:#dcfce7;color:#166534}', '.an-tag.f{background:#fee2e2;color:#991b1b}',
      '.an-note{display:block;color:#b91c1c;font-size:.82rem;margin-top:3px}', '.an-expl{display:block;font-size:.86rem;margin-top:5px;line-height:1.4}',
      '.an-box{border-left:3px solid var(--primary,#2563eb);padding:8px 12px;margin:10px 0;background:rgba(37,99,235,.05);border-radius:0 10px 10px 0}',
      '.an-off{border-left-color:#b91c1c;background:rgba(185,28,28,.05)}', '.an-md p{margin:.3em 0}',
      '.an-bar{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}', '.an-res{font-weight:700;margin:6px 0}'
    ].join('\n');
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  }

  /* ---------- liste ---------- */
  function renderList() {
    styles();
    const p = prog();
    const page = h('div', { class: 'page' });
    page.appendChild(h('h1', {}, '📝 Annales SU officiel'));
    page.appendChild(h('p', { class: 'secondary' }, 'Sujets officiels de la fac reproduits à l’identique, avec la correction officielle (Valide / Faux et annotations du corrigé) et une correction détaillée de chaque item.'));
    if (!all().length) { page.appendChild(h('p', {}, 'Aucune annale chargée.')); return page; }
    const groups = {};
    all().forEach(function (ex) { (groups[ex.matiere] = groups[ex.matiere] || []).push(ex); });
    Object.keys(groups).forEach(function (m) {
      page.appendChild(h('h2', { style: 'margin-top:18px' }, MAT[m] || m));
      groups[m].forEach(function (ex) {
        const qs = questions(ex), nd = qs.filter(function (q) { return done(p[q.id]); }), ok = nd.filter(function (q) { return p[q.id].ok; }).length;
        page.appendChild(h('a', { class: 'card', href: '#/annales/' + encodeURIComponent(ex.id), style: 'display:block;padding:12px 14px;margin:8px 0;text-decoration:none;color:inherit' },
          h('b', {}, str(ex.titre)),
          h('div', { class: 'secondary', style: 'font-size:.85rem;margin-top:2px' },
            [str(ex.date), qs.length + ' questions', nd.length ? nd.length + ' faites · ' + ok + ' justes' : 'pas encore faite'].filter(Boolean).join(' · ')),
          ex.note ? h('div', { class: 'secondary', style: 'font-size:.8rem;margin-top:4px' }, str(ex.note)) : null));
      });
    });
    return page;
  }

  /* ---------- une question ---------- */
  function questionEl(q, revision, onAnswer) {
    const rec = prog()[q.id];
    const isClosed = closed(q);
    let sel = rec && !rec.reset && Array.isArray(rec.sel) ? rec.sel.slice() : [];
    let shown = revision || done(rec);
    const wrap = h('div', { class: 'card an-q', style: 'padding:12px 14px' });
    function draw() {
      const kids = [];
      kids.push(h('div', { class: 'caption' }, 'Question ' + str(q.num) + (q.type ? ' · ' + q.type : '')));
      kids.push(h('div', { class: 'an-stem' }, digest(q.stem)));
      ['img', 'img2', 'img3', 'img4', 'img5'].forEach(function (k) {
        if (q[k]) {
          const im = h('img', { src: annCached(q[k]) || 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', alt: str(q.imgAlt || 'Figure du sujet'), loading: 'lazy', style: 'max-width:100%;height:auto;border-radius:8px;margin:4px 0 10px;background:#fff;display:block' });
          // version partagée : l'image n'est pas publiée en clair → déchiffrement à la demande
          let tries = 0;
          const viaPriv = function () {
            if (!window.CARDIO || !CARDIO.privImg || tries > 8) return;
            tries++;
            CARDIO.privImg(q[k]).then(function (u) { im.src = u; }).catch(function () { setTimeout(viaPriv, 1500); });
          };
          im.addEventListener('error', function () { if (!/^blob:/.test(im.src)) viaPriv(); });
          if (!annCached(q[k])) annBundle(q[k]).then(function () { im.src = annCached(q[k]) || q[k]; });
          kids.push(im);
        }
      });
      if (q.after) kids.push(h('div', { class: 'an-stem', style: 'font-weight:500' }, md(q.after)));
      if (isClosed) {
        q.options.forEach(function (o) {
          const picked = sel.indexOf(o.l) >= 0;
          let cls = 'an-opt' + (picked ? ' sel' : '');
          if (shown) cls = 'an-opt' + (o.ok ? (picked || revision ? ' good' : ' miss') : (picked ? ' bad' : ''));
          kids.push(h('button', { type: 'button', class: cls, on: { click: function () {
            if (shown) return;
            if (q.type === 'QRU') sel = [o.l]; else sel = picked ? sel.filter(function (x) { return x !== o.l; }) : sel.concat(o.l);
            saveQ(q.id, { draft: 1, sel: sel });
            draw(); if (onAnswer) onAnswer();
          } } },
            h('span', { class: 'an-l' }, o.l + '.'),
            h('span', { style: 'flex:1' }, inline(o.t),
              shown ? h('span', { class: 'an-tag ' + (o.ok ? 'v' : 'f') }, o.ok ? 'Valide' : 'Faux') : null,
              shown && o.note ? h('span', { class: 'an-note' }, '✍️ Corrigé : ' + str(o.note)) : null,
              shown && o.expl ? h('span', { class: 'an-expl' }, inline(o.expl)) : null)));
        });
      } else if (Array.isArray(q.options) && q.options.length) {
        q.options.forEach(function (o) { kids.push(h('div', { class: 'an-opt', style: 'cursor:default' }, h('span', { class: 'an-l' }, o.l + '.'), h('span', {}, inline(o.t)))); });
      }
      if (!shown) {
        // mode examen : pas de correction question par question, tout s'affiche à la fin du sujet
        kids.push(h('div', { class: 'secondary', style: 'font-size:.8rem;margin-top:6px' }, isClosed ? (sel.length ? '✓ Réponse enregistrée · correction à la fin du sujet' : 'Coche ta réponse · correction à la fin du sujet') : 'Question ouverte : réponds de tête, la correction s’affiche à la fin du sujet'));
      } else {
        if (isClosed && !revision) {
          const r = prog()[q.id];
          kids.push(h('div', { class: 'an-res', style: 'color:' + (r && r.ok ? '#16a34a' : '#dc2626') }, r && r.ok ? '✅ Juste' : (r && typeof r.disc === 'number' ? '❌ ' + r.disc + ' discordance' + (r.disc > 1 ? 's' : '') + ' · réponse : ' : '❌ Faux · réponse : ') + q.options.filter(function (o) { return o.ok; }).map(function (o) { return o.l; }).join(', ')));
        }
        if (q.unofficial) kids.push(h('div', { class: 'an-box', style: 'border-left-color:#2563eb;background:rgba(37,99,235,.07)' }, h('div', { class: 'caption' }, '📘 Corrigé non officiel'), md('Pas de corrigé de la fac pour cette question : les réponses ont été **déduites du Collège / du poly** et vérifiées, mais ce n\'est pas la grille officielle.')));
        if (q.answer) kids.push(h('div', { class: 'an-box an-off' }, h('div', { class: 'caption' }, q.unofficial ? 'Réponse attendue (d\'après le cours)' : 'Réponse attendue (corrigé officiel)'), md(q.answer)));
        if (q.offComment) kids.push(h('div', { class: 'an-box an-off' }, h('div', { class: 'caption' }, '✍️ Corrigé officiel'), md(q.offComment)));
        if (q.conflict) kids.push(h('div', { class: 'an-box', style: 'border-left-color:#d97706;background:rgba(217,119,6,.07)' }, h('div', { class: 'caption' }, '⚠️ Corrigé officiel ≠ poly'), md(q.conflict)));
        if (q.expl) kids.push(h('div', { class: 'an-box' }, h('div', { class: 'caption' }, '📖 Correction détaillée'), md(q.expl)));
      }
      wrap.replaceChildren.apply(wrap, kids.filter(Boolean));
    }
    draw();
    return wrap;
  }

  /* ---------- un sujet ---------- */
  function renderExam(ex, query) {
    styles();
    const revision = query && query.mode === 'revision';
    const page = h('div', { class: 'page' });
    page.dataset.title = str(ex.titre);
    page.appendChild(h('a', { href: '#/annales', class: 'secondary', style: 'text-decoration:none' }, '← Annales SU'));
    page.appendChild(h('h1', { style: 'margin-top:6px' }, str(ex.titre)));
    if (ex.source) page.appendChild(h('p', { class: 'secondary', style: 'font-size:.85rem' }, str(ex.source)));
    const score = h('div', { class: 'an-res' });
    const endBox = h('div', { class: 'card', style: 'margin-top:18px;display:grid;gap:8px;text-align:center' });
    /* Barème EDN : 0 discordance = 1 point, 1 = 0,5, 2 = 0,2, 3 ou plus = 0 (QRU : tout ou rien). */
    function pts(q, r) { if (!r || typeof r.disc !== 'number') return r && r.ok ? 1 : 0; if (q.type === 'QRU') return r.disc ? 0 : 1; return r.disc === 0 ? 1 : r.disc === 1 ? 0.5 : r.disc === 2 ? 0.2 : 0; }
    function finished() { const p = prog(); return questions(ex).filter(closed).every(function (q) { return done(p[q.id]); }); }
    function fmt(x) { return (Math.round(x * 10) / 10).toString().replace('.', ','); }
    function result() {
      const p = prog(), qs = questions(ex).filter(closed);
      const total = qs.reduce(function (a, q) { return a + pts(q, p[q.id]); }, 0), perfect = qs.filter(function (q) { return p[q.id] && p[q.id].ok; }).length;
      return { note: qs.length ? total / qs.length * 20 : 0, perfect: perfect, n: qs.length };
    }
    function finish() {
      const p = prog();
      questions(ex).forEach(function (q) {
        const r = p[q.id], sel = r && !r.reset && Array.isArray(r.sel) ? r.sel : [];
        if (closed(q)) {
          const disc = q.options.filter(function (o) { return (sel.indexOf(o.l) >= 0) !== !!o.ok; }).length;
          saveQ(q.id, { ok: disc === 0, sel: sel, disc: disc });
        } else saveQ(q.id, { ok: true, sel: [] });
      });
      location.hash = '#/annales/' + encodeURIComponent(ex.id) + '?r=' + Date.now();
    }
    function upd() {
      const p = prog(), qs = questions(ex).filter(closed);
      if (revision) { score.textContent = 'Mode révision : réponses et corrections affichées'; endBox.style.display = 'none'; return; }
      if (finished()) {
        const r = result();
        score.textContent = '🎯 Note : ' + fmt(r.note) + ' / 20 (barème EDN) · ' + r.perfect + ' / ' + r.n + ' QCM sans faute';
        endBox.replaceChildren(h('b', { style: 'font-size:1.15rem' }, '🎯 ' + fmt(r.note) + ' / 20'), h('div', { class: 'secondary' }, r.perfect + ' / ' + r.n + ' QCM sans faute · barème EDN (1 discordance = 0,5 ; 2 = 0,2 ; 3 et plus = 0)'),
          h('button', { type: 'button', class: 'btn btn--outline btn--sm', style: 'justify-self:center', on: { click: function () { resetExam(ex); location.hash = '#/annales/' + encodeURIComponent(ex.id) + '?r=' + Date.now(); } } }, '↺ Refaire le sujet'));
        return;
      }
      const answered = qs.filter(function (q) { const r = p[q.id]; return r && !r.reset && Array.isArray(r.sel) && r.sel.length; }).length;
      score.textContent = answered + ' / ' + qs.length + ' QCM répondus · correction et note à la fin';
      endBox.replaceChildren(h('b', {}, 'Fini ?'), h('div', { class: 'secondary' }, answered < qs.length ? (qs.length - answered) + ' QCM sans réponse (comptés faux).' : 'Tous les QCM sont répondus.'),
        h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: finish } }, 'Terminer et voir ma note + la correction'));
    }
    upd();
    page.appendChild(h('div', { class: 'an-bar' },
      h('a', { class: 'btn btn--sm ' + (revision ? 'btn--outline' : 'btn--primary'), href: '#/annales/' + encodeURIComponent(ex.id) }, '✍️ Mode examen'),
      h('a', { class: 'btn btn--sm ' + (revision ? 'btn--primary' : 'btn--outline'), href: '#/annales/' + encodeURIComponent(ex.id) + '?mode=revision' }, '👀 Mode révision'),
      revision ? null : h('button', { type: 'button', class: 'btn btn--ghost btn--sm', on: { click: function () { resetExam(ex); location.hash = '#/annales/' + encodeURIComponent(ex.id) + '?r=' + Date.now(); } } }, '↺ Tout recommencer')));
    page.appendChild(score);
    (ex.blocks || []).forEach(function (b) {
      if (b.titre) page.appendChild(h('h2', { style: 'margin-top:18px' }, str(b.titre)));
      if (b.intro) page.appendChild(h('div', { class: 'an-intro' }, digest(b.intro)));
      (b.questions || []).forEach(function (q) {
        if (q.intro) page.appendChild(h('div', { class: 'an-intro' }, digest(q.intro)));
        page.appendChild(questionEl(q, revision, upd));
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
    return { el: el, title: el.dataset.title || 'Annales SU officiel' };
  }
  CARDIO.views.annales = { render: render, available: function () { return all().length > 0; } };
})();
