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
  function inline(text) {
    const u = util(); let html = '';
    if (typeof u.md === 'function') { try { html = u.md(str(text)).trim().replace(/^<p>([\s\S]*)<\/p>$/, '$1'); } catch (e) { html = ''; } }
    return html ? h('span', { html: html }) : h('span', {}, str(text));
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
    let sel = done(rec) && Array.isArray(rec.sel) ? rec.sel.slice() : [];
    let shown = revision || done(rec);
    const wrap = h('div', { class: 'card an-q', style: 'padding:12px 14px' });
    function draw() {
      const kids = [];
      kids.push(h('div', { class: 'caption' }, 'Question ' + str(q.num) + (q.type ? ' · ' + q.type : '')));
      kids.push(h('div', { class: 'an-stem' }, md(q.stem)));
      if (q.img) kids.push(h('img', { src: q.img, alt: str(q.imgAlt || 'Figure du sujet'), style: 'max-width:100%;height:auto;border-radius:8px;margin:4px 0 10px;background:#fff' }));
      if (q.after) kids.push(h('div', { class: 'an-stem', style: 'font-weight:500' }, md(q.after)));
      if (isClosed) {
        q.options.forEach(function (o) {
          const picked = sel.indexOf(o.l) >= 0;
          let cls = 'an-opt' + (picked ? ' sel' : '');
          if (shown) cls = 'an-opt' + (o.ok ? (picked || revision ? ' good' : ' miss') : (picked ? ' bad' : ''));
          kids.push(h('button', { type: 'button', class: cls, on: { click: function () {
            if (shown) return;
            if (q.type === 'QRU') sel = [o.l]; else sel = picked ? sel.filter(function (x) { return x !== o.l; }) : sel.concat(o.l);
            draw();
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
        kids.push(h('div', { class: 'an-bar' },
          h('button', { type: 'button', class: 'btn btn--primary btn--sm', on: { click: function () {
            shown = true;
            if (isClosed) {
              const good = q.options.filter(function (o) { return o.ok; }).map(function (o) { return o.l; }).sort().join('');
              const ok = sel.slice().sort().join('') === good;
              saveQ(q.id, { ok: ok, sel: sel });
            } else saveQ(q.id, { ok: true, sel: [] });
            draw(); if (onAnswer) onAnswer();
          } } }, isClosed ? 'Valider' : 'Voir la correction')));
      } else {
        if (isClosed && !revision) {
          const r = prog()[q.id];
          kids.push(h('div', { class: 'an-res', style: 'color:' + (r && r.ok ? '#16a34a' : '#dc2626') }, r && r.ok ? '✅ Juste' : '❌ Faux · réponse : ' + q.options.filter(function (o) { return o.ok; }).map(function (o) { return o.l; }).join(', ')));
        }
        if (q.answer) kids.push(h('div', { class: 'an-box an-off' }, h('div', { class: 'caption' }, 'Réponse attendue (corrigé officiel)'), md(q.answer)));
        if (q.offComment) kids.push(h('div', { class: 'an-box an-off' }, h('div', { class: 'caption' }, '✍️ Corrigé officiel'), md(q.offComment)));
        if (q.conflict) kids.push(h('div', { class: 'an-box', style: 'border-left-color:#d97706;background:rgba(217,119,6,.07)' }, h('div', { class: 'caption' }, '⚠️ Corrigé officiel ≠ poly'), md(q.conflict)));
        if (q.expl) kids.push(h('div', { class: 'an-box' }, h('div', { class: 'caption' }, '📖 Correction détaillée'), md(q.expl)));
        if (!revision) kids.push(h('div', { class: 'an-bar' }, h('button', { type: 'button', class: 'btn btn--ghost btn--sm', on: { click: function () { sel = []; shown = false; saveQ(q.id, { reset: 1 }); draw(); if (onAnswer) onAnswer(); } } }, '↺ Refaire')));
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
    function upd() {
      const p = prog(), qs = questions(ex).filter(closed), nd = qs.filter(function (q) { return done(p[q.id]); });
      score.textContent = revision ? 'Mode révision : réponses et corrections affichées' : nd.length + ' / ' + qs.length + ' QCM faits · ' + nd.filter(function (q) { return p[q.id].ok; }).length + ' justes';
    }
    upd();
    page.appendChild(h('div', { class: 'an-bar' },
      h('a', { class: 'btn btn--sm ' + (revision ? 'btn--outline' : 'btn--primary'), href: '#/annales/' + encodeURIComponent(ex.id) }, '✍️ Mode examen'),
      h('a', { class: 'btn btn--sm ' + (revision ? 'btn--primary' : 'btn--outline'), href: '#/annales/' + encodeURIComponent(ex.id) + '?mode=revision' }, '👀 Mode révision'),
      revision ? null : h('button', { type: 'button', class: 'btn btn--ghost btn--sm', on: { click: function () { resetExam(ex); location.hash = '#/annales/' + encodeURIComponent(ex.id) + '?r=' + Date.now(); } } }, '↺ Tout recommencer')));
    page.appendChild(score);
    (ex.blocks || []).forEach(function (b) {
      if (b.titre) page.appendChild(h('h2', { style: 'margin-top:18px' }, str(b.titre)));
      if (b.intro) page.appendChild(h('div', { class: 'an-intro' }, md(b.intro)));
      (b.questions || []).forEach(function (q) {
        if (q.intro) page.appendChild(h('div', { class: 'an-intro' }, md(q.intro)));
        page.appendChild(questionEl(q, revision, upd));
      });
    });
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
