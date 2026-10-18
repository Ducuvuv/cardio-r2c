/* CardioR2C — views/points.js
 * Rubrique « Points cours » : cours transversaux tirés du Collège (docs/POINTCOURS.md), p. ex. « Les examens en
 * pneumologie » (radio, scanner, EFR, gaz du sang, fibroscopie, ponction pleurale, microbiologie…).
 *   #/points                 liste des points cours
 *   #/points/:id             sommaire : les examens, regroupés par partie
 *   #/points/:id/:exam       un examen ; « Lire » ou « Me tester » (mots en gras masqués, révélés au toucher)
 * Contenu : CARDIO.registry.pointcours = [{id, spe, title, intro, parts:[{id, title, exams:[{id, title, intro,
 *           sections:[{h, text, retenir, rank, src}], pieges}]}]}].
 * Statut : localStorage « cardio.points » = {"<id>/<exam>": {seen, ok, at}} (confort par appareil).
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  CARDIO.views = CARDIO.views || {};

  const SPE_LABEL = { cardio: 'Cardiologie', dermato: 'Dermatologie', pneumo: 'Pneumologie' };
  const LS = 'cardio.points';

  function util() { return CARDIO.util || {}; }
  function h() { const u = util(); return u.h.apply(null, arguments); }
  function str(v) { return v === undefined || v === null ? '' : String(v); }
  function list() { const r = CARDIO.registry || {}; return Array.isArray(r.pointcours) ? r.pointcours : []; }
  function loadState() { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { return {}; } }
  function saveState(st) { try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) { /* stockage indisponible */ } }
  function mark(key, patch) { const st = loadState(); st[key] = Object.assign({}, st[key], patch, { at: Date.now() }); saveState(st); }
  function exams(pc) { return (pc.parts || []).reduce(function (a, p) { return a.concat(p.exams || []); }, []); }

  function inlineMd(text) {
    const u = util();
    let html = '';
    if (typeof u.md === 'function') { try { html = u.md(str(text)).trim(); } catch (e) { html = ''; } }
    html = html.replace(/^<p>([\s\S]*)<\/p>$/, '$1');
    return html ? h('span', { html: html }) : h('span', {}, str(text));
  }

  let styled = false;
  function ensureStyles() {
    if (styled) return;
    styled = true;
    const css = [
      '.pc-list{display:grid;gap:10px}',
      '.pc-card{display:block;padding:14px 16px;border-radius:var(--r-m);background:var(--surface);box-shadow:var(--shadow-1);color:inherit;text-decoration:none}',
      '.pc-card:hover{box-shadow:var(--shadow-2);text-decoration:none}',
      '.pc-card__top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px}',
      '.pc-card__title{font:700 1.0625rem/1.3 var(--font-display)}',
      '.pc-card__intro{font-size:.875rem;color:var(--muted);line-height:1.35;margin-top:2px}',
      '.pc-sec{padding:12px 14px;border-radius:var(--r-m);background:var(--surface);box-shadow:var(--shadow-1)}',
      '.pc-sec__head{display:flex;align-items:center;gap:8px;margin-bottom:6px}',
      '.pc-sec h3{margin:0;font:700 1rem/1.25 var(--font-display);color:var(--blue)}',
      '.pc-text p{margin:.5em 0;line-height:1.55}',
      '.pc-retenir{margin-top:8px;padding:8px 10px;border-radius:10px;background:var(--blue-soft)}',
      '.pc-retenir ul,.pc-pieges ul{margin:4px 0 0;padding-left:1.1em}',
      '.pc-retenir li{margin:.2em 0;font-weight:600}',
      '.pc-src{margin-top:6px;font-size:.75rem;color:var(--muted)}',
      '.pc-hide{cursor:pointer;border-radius:4px;background:var(--surface-3);color:transparent!important;box-shadow:inset 0 -2px 0 var(--muted)}'
    ].join('\n');
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
  }

  function status(key) {
    const s = loadState()[key];
    if (!s) return null;
    if (s.ok === true) return { cls: 'pill--ok', t: 'su' };
    if (s.ok === false) return { cls: 'pill--warn', t: 'à revoir' };
    return s.seen ? { cls: 'pill--info', t: 'lu' } : null;
  }

  function buildList() {
    const page = h('div', { class: 'page stack' });
    page.appendChild(h('p', { class: 'secondary' }, 'Des cours transversaux tirés du Collège, pour ce qui est dispersé entre plusieurs items. Rangs A et B uniquement.'));
    if (!list().length) { page.appendChild(h('div', { class: 'empty' }, 'Aucun point cours pour l’instant.')); return page; }
    page.appendChild(h('div', { class: 'pc-list' }, list().map(function (pc) {
      return h('a', { class: 'pc-card', href: '#/points/' + encodeURIComponent(pc.id) },
        h('div', { class: 'pc-card__top' }, h('span', { class: 'pill pill--kind' }, SPE_LABEL[pc.spe] || str(pc.spe)), h('span', { class: 'pill pill--kind' }, exams(pc).length + ' examens')),
        h('div', { class: 'pc-card__title' }, str(pc.title)),
        pc.intro ? h('div', { class: 'pc-card__intro' }, str(pc.intro)) : null);
    })));
    return page;
  }

  function buildSummary(pc) {
    const page = h('div', { class: 'page stack' });
    page.appendChild(h('div', {}, h('div', { class: 'caption' }, (SPE_LABEL[pc.spe] || '') + ' · point cours'), h('h2', { style: 'margin:4px 0 0' }, str(pc.title))));
    if (pc.intro) page.appendChild(h('p', {}, inlineMd(pc.intro)));
    (pc.parts || []).forEach(function (part) {
      if (!(part.exams || []).length) return;
      page.appendChild(h('div', { class: 'section-head' }, h('h2', {}, str(part.title))));
      page.appendChild(h('div', { class: 'pc-list' }, part.exams.map(function (ex) {
        const sta = status(pc.id + '/' + ex.id);
        return h('a', { class: 'pc-card', href: '#/points/' + encodeURIComponent(pc.id) + '/' + encodeURIComponent(ex.id) },
          h('div', { class: 'pc-card__top' }, h('span', { class: 'pill pill--kind' }, (ex.sections || []).length + ' parties'), sta ? h('span', { class: 'pill ' + sta.cls }, sta.t) : null),
          h('div', { class: 'pc-card__title' }, str(ex.title)),
          ex.intro ? h('div', { class: 'pc-card__intro' }, str(ex.intro)) : null);
      })));
    });
    return page;
  }

  function renderExam(pc, ex, root) {
    const key = pc.id + '/' + ex.id;
    const page = h('div', { class: 'page stack' });
    const body = h('div', { class: 'stack' });
    const after = h('div', { class: 'stack' });
    const seg = h('div', { class: 'seg seg--block', role: 'tablist' });
    const bRead = h('button', { type: 'button', class: 'seg__btn is-on', on: { click: function () { setMode(false); } } }, 'Lire');
    const bTest = h('button', { type: 'button', class: 'seg__btn', on: { click: function () { setMode(true); } } }, 'Me tester');
    seg.append(bRead, bTest);
    function setMode(t) { bRead.classList.toggle('is-on', !t); bTest.classList.toggle('is-on', t); draw(t); }

    function draw(test) {
      const hidden = [];
      body.replaceChildren();
      (ex.sections || []).forEach(function (s) {
        const paras = str(s.text).split(/\n\s*\n/).map(function (t) { return t.trim(); }).filter(Boolean);
        const sec = h('section', { class: 'pc-sec' },
          h('div', { class: 'pc-sec__head' }, h('h3', {}, str(s.h)), s.rank === 'B' ? h('span', { class: 'pill pill--B' }, 'Rang B') : null),
          h('div', { class: 'pc-text' }, paras.map(function (t) { return h('p', {}, inlineMd(t)); })),
          Array.isArray(s.retenir) && s.retenir.length ? h('div', { class: 'pc-retenir' }, h('span', { class: 'caption' }, 'À retenir'),
            h('ul', {}, s.retenir.map(function (r) { return h('li', {}, inlineMd(r)); }))) : null,
          Array.isArray(s.src) && s.src.length ? h('div', { class: 'pc-src' }, 'Collège · ' + s.src.join(' · ')) : null);
        if (test) sec.querySelectorAll('.pc-text strong').forEach(function (el) {
          el.classList.add('pc-hide'); el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0'); hidden.push(el);
        });
        body.appendChild(sec);
      });
      if (Array.isArray(ex.pieges) && ex.pieges.length) {
        body.appendChild(h('div', { class: 'pitfall pc-pieges' }, h('span', { class: 'caption' }, 'Pièges'), h('ul', {}, ex.pieges.map(function (p) { return h('li', {}, inlineMd(p)); }))));
      }
      after.replaceChildren();
      if (!test) { mark(key, { seen: true }); after.appendChild(nextLink()); return; }
      let left = hidden.length;
      const hint = h('p', { class: 'secondary muted center' }, 'Touche chaque mot caché après l’avoir dit de tête (' + left + ' à trouver).');
      body.insertBefore(hint, body.firstChild);
      function reveal(el) {
        if (!el.classList.contains('pc-hide')) return;
        el.classList.remove('pc-hide');
        left--;
        hint.textContent = left > 0 ? 'Encore ' + left + ' à révéler.' : 'Tout est révélé. Tu savais ?';
        if (left === 0) {
          after.replaceChildren(h('div', { class: 'grades', style: 'grid-template-columns:1fr 1fr' },
            h('button', { type: 'button', class: 'btn grade--again', on: { click: function () { mark(key, { seen: true, ok: false }); done('À revoir : il reste marqué dans le sommaire.'); } } }, 'À revoir'),
            h('button', { type: 'button', class: 'btn grade--good', on: { click: function () { mark(key, { seen: true, ok: true }); done('Bien joué !'); } } }, 'Je savais')));
        }
      }
      hidden.forEach(function (el) {
        el.addEventListener('click', function () { reveal(el); });
        el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal(el); } });
      });
      after.appendChild(h('button', { type: 'button', class: 'btn btn--secondary btn--block', on: { click: function () { hidden.slice().forEach(reveal); } } }, 'Tout révéler'));
    }
    function done(msg) { after.replaceChildren(h('div', { class: 'feedback feedback--ok' }, msg), nextLink()); }
    function nextLink() {
      const all = exams(pc);
      const i = all.findIndex(function (x) { return x.id === ex.id; });
      const nx = i >= 0 && i + 1 < all.length ? all[i + 1] : null;
      return nx ? h('a', { class: 'btn btn--primary btn--block', href: '#/points/' + encodeURIComponent(pc.id) + '/' + encodeURIComponent(nx.id) }, 'Examen suivant : ' + str(nx.title))
        : h('a', { class: 'btn btn--secondary btn--block', href: '#/points/' + encodeURIComponent(pc.id) }, 'Retour au sommaire');
    }

    page.append(
      h('div', {}, h('div', { class: 'caption' }, str(pc.title)), h('h2', { style: 'margin:4px 0 0' }, str(ex.title))),
      ex.intro ? h('p', { class: 'secondary' }, inlineMd(ex.intro)) : null,
      seg, body, after);
    draw(false);
    root.appendChild(page);
  }

  function render(params) {
    ensureStyles();
    const root = h('div', { class: 'view-points' });
    const pc = params && params.id ? list().find(function (x) { return x.id === str(params.id); }) : null;
    if (params && params.id && !pc) { root.appendChild(h('div', { class: 'page' }, h('div', { class: 'empty' }, 'Point cours introuvable.'))); return root; }
    if (pc && params.exam) {
      const ex = exams(pc).find(function (x) { return x.id === str(params.exam); });
      root.dataset.title = ex ? str(ex.title) : 'Point cours';
      if (!ex) root.appendChild(h('div', { class: 'page' }, h('div', { class: 'empty' }, 'Examen introuvable.')));
      else renderExam(pc, ex, root);
      return root;
    }
    if (pc) { root.dataset.title = str(pc.title); root.appendChild(buildSummary(pc)); return root; }
    root.dataset.title = 'Points cours';
    root.appendChild(buildList());
    return root;
  }

  CARDIO.views.points = { render: render, available: function () { return list().length > 0; } };
})();
