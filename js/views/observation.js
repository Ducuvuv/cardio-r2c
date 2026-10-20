/* CardioR2C — views/observation.js
 * Rubrique « Observation » (docs/OBSERVATION.md) : une fiche par motif de consultation, construite comme une
 * observation médicale (terrain → symptôme → signes associés → questions qui orientent → examen → gravité → examens
 * → synthèse → hypothèses), uniquement depuis le Collège (rangs A et B).
 *   #/observation          les motifs (score et étoiles par motif)
 *   #/observation/:id      « Apprendre » (étapes, pourquoi au toucher, astuces) ou « Consultation » (jeu : liste de
 *                          tête, révèle, coche ce que tu avais → score, étoiles, rejouer les oublis)
 * Contenu : CARDIO.registry.observation = [{id, spe, title, emoji, items, hook, intro, steps:[{key, title, goal,
 *           questions:[{ask, why, flag, if, src}], astuce}], synthese, hypotheses:[{dx, pour, danger, src}], pieges, src}].
 * Scores : localStorage « cardio.obs » = {id: {best, last, at}}.
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  CARDIO.views = CARDIO.views || {};

  const LS = 'cardio.obs';
  const FLAG = { gravite: ['🔴', 'gravité'], orientation: ['🧭', 'oriente'], terrain: ['📌', 'terrain'] };

  function util() { return CARDIO.util || {}; }
  function h() { const u = util(); return u.h.apply(null, arguments); }
  function str(v) { return v === undefined || v === null ? '' : String(v); }
  function list() { const r = CARDIO.registry || {}; return Array.isArray(r.observation) ? r.observation : []; }
  function load() { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { return {}; } }
  function save(v) { try { localStorage.setItem(LS, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } }
  function stars(pct) { return pct >= 90 ? 3 : pct >= 70 ? 2 : pct >= 50 ? 1 : 0; }
  function starStr(n) { return '★★★'.slice(0, n) + '☆☆☆'.slice(0, 3 - n); }
  function nQuestions(o) { return (o.steps || []).reduce(function (n, s) { return n + (s.questions || []).length; }, 0); }
  function itemLabel(num) {
    try { const r = CARDIO.registry; return r && typeof r.label === 'function' ? r.label(num) : str(num); } catch (e) { return str(num); }
  }
  function md(text) {
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
      '.ob-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}',
      '.ob-card{display:flex;flex-direction:column;gap:4px;padding:14px;border-radius:var(--r-m);background:var(--surface);box-shadow:var(--shadow-1);color:inherit;text-decoration:none;min-height:132px}',
      '.ob-card:hover{box-shadow:var(--shadow-2);text-decoration:none}',
      '.ob-card__emo{font-size:2rem;line-height:1}',
      '.ob-card__t{font:700 .9375rem/1.25 var(--font-display)}',
      '.ob-card__s{font-size:.75rem;color:var(--muted)}',
      '.ob-card__stars{margin-top:auto;color:var(--warn);letter-spacing:2px}',
      '.ob-hero{display:flex;gap:12px;align-items:center}',
      '.ob-hero__emo{font-size:2.6rem}',
      '.ob-hook{padding:10px 12px;border-radius:12px;background:var(--bad-soft);color:var(--ink);font-weight:600;line-height:1.4}',
      '.ob-steps{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch}',
      '.ob-steps a{flex:0 0 auto;font-size:.75rem;padding:6px 10px;border-radius:999px;background:var(--surface-2);color:var(--ink-2);text-decoration:none;white-space:nowrap}',
      '.ob-step{padding:14px;border-radius:var(--r-m);background:var(--surface);box-shadow:var(--shadow-1);scroll-margin-top:70px}',
      '.ob-step__n{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--blue);color:#fff;font-weight:700;font-size:.8125rem;margin-right:8px}',
      '.ob-step h3{display:flex;align-items:center;margin:0 0 4px;font:700 1.0625rem/1.25 var(--font-display)}',
      '.ob-goal{font-size:.875rem;color:var(--muted);margin:0 0 8px}',
      '.ob-q{border-top:1px solid var(--line);padding:9px 0}',
      '.ob-q__btn{display:flex;gap:8px;align-items:flex-start;width:100%;text-align:left;background:none;border:0;padding:0;color:inherit;font:inherit;cursor:pointer}',
      '.ob-q__ask{font-weight:600;line-height:1.4;flex:1}',
      '.ob-q__flag{font-size:.6875rem;white-space:nowrap;padding:2px 6px;border-radius:999px;background:var(--surface-2);color:var(--ink-2)}',
      '.ob-q__flag--gravite{background:var(--bad-soft);color:var(--bad)}',
      '.ob-q__why{margin:6px 0 0 0;font-size:.875rem;line-height:1.45;color:var(--ink-2)}',
      '.ob-q__if{display:block;margin-top:4px;font-weight:600;color:var(--blue)}',
      '.ob-q__src{display:block;margin-top:3px;font-size:.6875rem;color:var(--muted)}',
      '.ob-tip{margin-top:10px;padding:9px 11px;border-radius:10px;background:var(--warn-soft);line-height:1.45}',
      '.ob-box{padding:14px;border-radius:var(--r-m);background:var(--surface);box-shadow:var(--shadow-1)}',
      '.ob-box h3{margin:0 0 6px;font:700 1rem/1.25 var(--font-display)}',
      '.ob-hyp{display:flex;gap:8px;padding:6px 0;border-top:1px solid var(--line)}',
      '.ob-check{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-top:1px solid var(--line);cursor:pointer}',
      '.ob-check input{width:22px;height:22px;flex:0 0 auto;margin-top:1px}',
      '.ob-score{font:800 2.4rem/1 var(--font-display);text-align:center}',
      '.ob-score__stars{text-align:center;font-size:1.8rem;color:var(--warn);letter-spacing:4px}',
      '.ob-think{padding:16px;border-radius:var(--r-m);border:2px dashed var(--line);text-align:center;color:var(--ink-2)}'
    ].join('\n');
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------- liste ---------- */
  function buildList() {
    const page = h('div', { class: 'page stack' });
    const sc = load();
    page.appendChild(h('p', { class: 'secondary' }, 'Comme à l’hôpital : pour chaque motif, toutes les questions à poser, ce qu’il faut chercher à l’examen et la synthèse à présenter. Apprends, puis joue la consultation pour battre ton record.'));
    if (!list().length) { page.appendChild(h('div', { class: 'empty' }, 'Les observations arrivent bientôt.')); return page; }
    const total = list().length, done = list().filter(function (o) { return sc[o.id] && sc[o.id].best >= 90; }).length;
    page.appendChild(h('div', { class: 'cluster' }, h('span', { class: 'pill pill--ok' }, done + ' / ' + total + ' maîtrisées (≥ 90 %)')));
    page.appendChild(h('div', { class: 'ob-grid' }, list().map(function (o) {
      const s = sc[o.id];
      return h('a', { class: 'ob-card', href: '#/observation/' + encodeURIComponent(o.id) },
        h('div', { class: 'ob-card__emo' }, str(o.emoji || '🩺')),
        h('div', { class: 'ob-card__t' }, str(o.title)),
        h('div', { class: 'ob-card__s' }, nQuestions(o) + ' questions' + (s ? ' · record ' + s.best + ' %' : ' · nouveau')),
        h('div', { class: 'ob-card__stars' }, starStr(s ? stars(s.best) : 0)));
    })));
    return page;
  }

  /* ---------- apprendre ---------- */
  function questionRow(q) {
    const why = h('div', { class: 'ob-q__why', hidden: true },
      q.if ? h('span', { class: 'ob-q__if' }, '➜ ' + str(q.if)) : null,
      q.why ? md(q.why) : null,
      q.src ? h('span', { class: 'ob-q__src' }, 'Collège · ' + str(q.src)) : null);
    const f = FLAG[q.flag];
    const btn = h('button', { type: 'button', class: 'ob-q__btn', 'aria-expanded': 'false', on: { click: function () {
      why.hidden = !why.hidden; btn.setAttribute('aria-expanded', why.hidden ? 'false' : 'true');
    } } }, h('span', { class: 'ob-q__ask' }, md(q.ask)), f ? h('span', { class: 'ob-q__flag ob-q__flag--' + q.flag }, f[0] + ' ' + f[1]) : null);
    return h('div', { class: 'ob-q' }, btn, why);
  }
  function renderLearn(o, host) {
    const steps = o.steps || [];
    host.replaceChildren(
      h('div', { class: 'ob-steps' }, steps.map(function (s, i) {
        return h('a', { href: 'javascript:void 0', on: { click: function (e) { e.preventDefault(); const el = document.getElementById('ob-s' + i); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } } }, (i + 1) + '. ' + str(s.title));
      })),
      h('p', { class: 'secondary muted', style: 'margin:0' }, 'Touche une question pour voir pourquoi on la pose.'));
    steps.forEach(function (s, i) {
      host.appendChild(h('section', { class: 'ob-step', id: 'ob-s' + i },
        h('h3', {}, h('span', { class: 'ob-step__n' }, String(i + 1)), str(s.title)),
        s.goal ? h('p', { class: 'ob-goal' }, md(s.goal)) : null,
        (s.questions || []).map(questionRow),
        s.astuce ? h('div', { class: 'ob-tip' }, '💡 ', md(s.astuce)) : null));
    });
    if (o.synthese) host.appendChild(h('div', { class: 'ob-box' }, h('h3', {}, '📝 La synthèse à présenter'), h('p', { style: 'margin:0;line-height:1.5' }, md(o.synthese))));
    if (Array.isArray(o.hypotheses) && o.hypotheses.length) {
      host.appendChild(h('div', { class: 'ob-box' }, h('h3', {}, '🎯 Hypothèses'), o.hypotheses.map(function (x) {
        return h('div', { class: 'ob-hyp' }, h('span', {}, x.danger ? '🚨' : '•'),
          h('div', {}, h('strong', {}, str(x.dx)), x.pour ? h('div', { class: 'secondary' }, md(x.pour)) : null));
      })));
    }
    if (Array.isArray(o.pieges) && o.pieges.length) {
      host.appendChild(h('div', { class: 'pitfall' }, h('span', { class: 'caption' }, '⚠️ Pièges'), h('ul', { style: 'margin:4px 0 0;padding-left:1.1em' }, o.pieges.map(function (p) { return h('li', {}, md(p)); }))));
    }
    host.appendChild(h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: function () { window.scrollTo(0, 0); host.dispatchEvent(new CustomEvent('ob:play')); } } }, '🎮 Je joue la consultation'));
  }

  /* ---------- consultation (jeu) ---------- */
  function renderPlay(o, host, only) {
    const steps = (o.steps || []).map(function (s) {
      return Object.assign({}, s, { questions: (s.questions || []).filter(function (q) { return !only || only.has(q.ask); }) });
    }).filter(function (s) { return s.questions.length; });
    const missed = new Set();
    let got = 0, total = 0, i = 0;
    function step() {
      if (i >= steps.length) return finish();
      const s = steps[i];
      host.replaceChildren(
        h('div', { class: 'cluster' }, h('span', { class: 'pill pill--kind' }, 'Étape ' + (i + 1) + ' / ' + steps.length), only ? h('span', { class: 'pill pill--warn' }, 'mes oublis') : null),
        h('div', { class: 'ob-step' },
          h('h3', {}, h('span', { class: 'ob-step__n' }, String(i + 1)), str(s.title)),
          s.goal ? h('p', { class: 'ob-goal' }, md(s.goal)) : null,
          h('div', { class: 'ob-think' }, '🧠 Le patient est devant toi. Dis à voix haute (ou dans ta tête) tout ce que tu demandes / cherches ici, puis révèle. ', h('strong', {}, s.questions.length + ' à trouver.'))),
        h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: reveal } }, 'Révéler'));
      function reveal() {
        const boxes = s.questions.map(function (q) {
          const cb = h('input', { type: 'checkbox' });
          const row = h('label', { class: 'ob-check' }, cb, h('div', {}, h('div', { style: 'font-weight:600' }, md(q.ask)), q.if ? h('div', { class: 'ob-q__if' }, '➜ ' + str(q.if)) : null, q.why ? h('div', { class: 'ob-q__why' }, md(q.why)) : null));
          return { q: q, cb: cb, row: row };
        });
        host.replaceChildren(
          h('div', { class: 'cluster' }, h('span', { class: 'pill pill--kind' }, 'Étape ' + (i + 1) + ' / ' + steps.length)),
          h('div', { class: 'ob-step' }, h('h3', {}, h('span', { class: 'ob-step__n' }, String(i + 1)), str(s.title)),
            h('p', { class: 'ob-goal' }, 'Coche honnêtement ce que tu avais trouvé :'), boxes.map(function (b) { return b.row; }),
            s.astuce ? h('div', { class: 'ob-tip' }, '💡 ', md(s.astuce)) : null),
          h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: function () {
            boxes.forEach(function (b) { total++; if (b.cb.checked) got++; else missed.add(b.q.ask); });
            i++; window.scrollTo(0, 0); step();
          } } }, i + 1 < steps.length ? 'Étape suivante' : 'Voir mon score'));
      }
    }
    function finish() {
      const pct = total ? Math.round(got * 100 / total) : 0;
      const sc = load(), prev = sc[o.id] || { best: 0 };
      const record = !only && pct > (prev.best || 0);
      if (!only) { sc[o.id] = { best: Math.max(prev.best || 0, pct), last: pct, at: Date.now() }; save(sc); }
      const msg = pct >= 90 ? 'Niveau interne. Ton senior va t’adorer.' : pct >= 70 ? 'Solide ! Encore quelques réflexes à automatiser.' : pct >= 50 ? 'Bonne base. Rejoue tes oublis pour les graver.' : 'C’est en ratant qu’on retient : rejoue tes oublis maintenant.';
      host.replaceChildren(
        h('div', { class: 'ob-box stack' },
          h('div', { class: 'ob-score' }, pct + ' %'),
          h('div', { class: 'ob-score__stars' }, starStr(stars(pct))),
          h('p', { class: 'center', style: 'margin:0;font-weight:600' }, (record ? '🏆 Nouveau record ! ' : '') + msg),
          h('p', { class: 'center secondary', style: 'margin:0' }, got + ' / ' + total + ' questions trouvées' + (only ? ' (oublis)' : ''))),
        missed.size ? h('div', { class: 'ob-box' }, h('h3', {}, '🔁 Tes oublis'), Array.from(missed).map(function (a) { return h('div', { class: 'ob-q' }, md(a)); })) : null,
        missed.size ? h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: function () { window.scrollTo(0, 0); renderPlay(o, host, new Set(missed)); } } }, 'Rejouer mes ' + missed.size + ' oublis') : null,
        h('button', { type: 'button', class: 'btn btn--secondary btn--block', on: { click: function () { window.scrollTo(0, 0); renderPlay(o, host, null); } } }, 'Rejouer toute la consultation'),
        nextLink(o));
    }
    step();
  }
  function nextLink(o) {
    const all = list();
    const i = all.findIndex(function (x) { return x.id === o.id; });
    const nx = i >= 0 && i + 1 < all.length ? all[i + 1] : null;
    return nx ? h('a', { class: 'btn btn--outline btn--block', href: '#/observation/' + encodeURIComponent(nx.id) }, 'Motif suivant : ' + str(nx.emoji || '') + ' ' + str(nx.title))
      : h('a', { class: 'btn btn--outline btn--block', href: '#/observation' }, 'Tous les motifs');
  }

  function renderFiche(o, root) {
    const page = h('div', { class: 'page stack' });
    const host = h('div', { class: 'stack' });
    const seg = h('div', { class: 'seg seg--block', role: 'tablist' });
    const bL = h('button', { type: 'button', class: 'seg__btn is-on', on: { click: function () { mode(false); } } }, '📖 Apprendre');
    const bP = h('button', { type: 'button', class: 'seg__btn', on: { click: function () { mode(true); } } }, '🎮 Consultation');
    seg.append(bL, bP);
    function mode(play) {
      bL.classList.toggle('is-on', !play); bP.classList.toggle('is-on', play);
      if (play) renderPlay(o, host, null); else renderLearn(o, host);
    }
    host.addEventListener('ob:play', function () { mode(true); });
    const best = (load()[o.id] || {}).best;
    page.append(
      h('div', { class: 'ob-hero' }, h('div', { class: 'ob-hero__emo' }, str(o.emoji || '🩺')),
        h('div', {}, h('div', { class: 'caption' }, 'Observation · cardio' + (best != null ? ' · record ' + best + ' %' : '')), h('h2', { style: 'margin:2px 0 0' }, str(o.title)))),
      o.hook ? h('div', { class: 'ob-hook' }, md(o.hook)) : null,
      o.intro ? h('p', { style: 'margin:0;line-height:1.5' }, md(o.intro)) : null,
      Array.isArray(o.items) && o.items.length ? h('div', { class: 'cluster' }, o.items.map(function (it) { return h('a', { class: 'pill pill--kind', href: '#/item/' + encodeURIComponent(it) }, 'Item ' + itemLabel(it)); })) : null,
      seg, host);
    mode(false);
    root.appendChild(page);
  }

  function render(params) {
    ensureStyles();
    const root = h('div', { class: 'view-observation' });
    const id = str(params && params.id);
    if (id) {
      const o = list().find(function (x) { return x.id === id; });
      root.dataset.title = o ? str(o.title) : 'Observation';
      if (!o) root.appendChild(h('div', { class: 'page' }, h('div', { class: 'empty' }, 'Motif introuvable.')));
      else renderFiche(o, root);
      return root;
    }
    root.dataset.title = 'Observation';
    root.appendChild(buildList());
    return root;
  }

  CARDIO.views.observation = { render: render, available: function () { return list().length > 0; } };
})();
