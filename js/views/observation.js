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
 * v2 (docs/OBSERVATION2.md) : CARDIO.registry.observation2 = [{…même en-tête, v:2, steps: 9 étapes dans l'ordre
 *           gravite → motif → associes → terrain → examen → examens → hypotheses → conduite → senior, questions:[{ask,
 *           why, if, flag, rank, src}]}]. Un motif présent en v2 remplace la v1 (même id) : « Apprendre » devient un
 *           parcours linéaire étape par étape (Précédent / Suivant, étape en cours mémorisée dans « cardio.obs2.pos ») ;
 *           la « Consultation » suit le même ordre. Les motifs non migrés gardent la v1.
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
  /** Motifs v1, chacun remplacé par sa version v2 s'il en a une ; les motifs v2 sans v1 sont ajoutés à la fin. */
  function list() {
    const r = CARDIO.registry || {};
    const v1 = Array.isArray(r.observation) ? r.observation : [];
    const v2 = Array.isArray(r.observation2) ? r.observation2.filter(function (o) { return o && o.id && Array.isArray(o.steps); }) : [];
    if (!v2.length) return v1;
    const by = {};
    v2.forEach(function (o) { by[o.id] = Object.assign({ v: 2 }, o); });
    const out = v1.map(function (o) { const n = by[o.id]; if (n) delete by[o.id]; return n || o; });
    v2.forEach(function (o) { if (by[o.id]) out.push(by[o.id]); });
    return out;
  }
  function isV2(o) { return !!o && Number(o.v) === 2; }
  const LS_POS = 'cardio.obs2.pos';
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
      '.ob-think{padding:16px;border-radius:var(--r-m);border:2px dashed var(--line);text-align:center;color:var(--ink-2)}',
      /* v2 : parcours linéaire */
      '.ob2-top{display:grid;gap:8px}',
      '.ob2-count{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:.8125rem;color:var(--muted);font-variant-numeric:tabular-nums}',
      '.ob2-count b{font:700 1rem var(--font-display);color:var(--ink)}',
      '.ob2-bar{height:6px;border-radius:999px;background:var(--surface-3);overflow:hidden}',
      '.ob2-bar span{display:block;height:100%;background:var(--accent);border-radius:999px;transition:width .3s var(--ease)}',
      '.ob2-dots{display:flex;gap:4px}',
      '.ob2-dots button{flex:1 1 0;min-width:0;height:28px;border:0;border-radius:6px;background:var(--surface-2);color:var(--muted);font:600 .75rem var(--font-display);cursor:pointer;padding:0}',
      '.ob2-dots button.is-done{background:var(--blue-soft);color:var(--blue)}',
      '.ob2-dots button.is-on{background:var(--accent);color:var(--accent-ink)}',
      '.ob2-head{display:flex;align-items:center;gap:10px}',
      '.ob2-head h3{margin:0;font:700 1.1875rem/1.25 var(--font-display)}',
      '.ob2-n{flex:0 0 32px;height:32px;display:grid;place-items:center;border-radius:50%;background:var(--accent);color:var(--accent-ink);font:700 .9375rem/1 var(--font-display)}',
      '.ob2-goal{margin:0;color:var(--ink-2);line-height:1.45}',
      '.ob2-tools{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:.8125rem;color:var(--muted)}',
      '.ob2-qs{display:grid;gap:8px}',
      '.ob2-q{background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1);border-left:3px solid transparent}',
      '.ob2-q[data-flag="gravite"]{border-left-color:var(--bad)}',
      '.ob2-q__btn{display:grid;gap:6px;width:100%;padding:12px 14px;min-height:48px;text-align:left;background:none;border:0;color:inherit;font:inherit;cursor:pointer;border-radius:var(--r-m)}',
      '.ob2-q__btn:focus-visible{outline:2px solid var(--blue);outline-offset:-2px}',
      '.ob2-q__ask{font-weight:700;line-height:1.4}',
      '.ob2-q__meta{display:flex;flex-wrap:wrap;gap:4px;align-items:center}',
      '.ob2-q__tap{font-size:.75rem;color:var(--muted)}',
      '.ob2-q[data-open="1"] .ob2-q__tap{display:none}',
      '.ob2-q__more{display:grid;gap:8px;padding:0 14px 12px}',
      '.ob2-q__more[hidden]{display:none}',
      '.ob2-q__row{display:grid;gap:2px;font-size:.9375rem;line-height:1.45}',
      '.ob2-q__row>span:first-child{font-size:.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}',
      '.ob2-q__row--if{padding:8px 10px;border-radius:var(--r-s);background:var(--blue-soft)}',
      '.ob2-q__row--if>span:first-child{color:var(--blue)}',
      '.ob2-q__src{font-size:.75rem;color:var(--muted)}',
      '.ob2-nav{display:grid;grid-template-columns:1fr 1fr;gap:8px}',
      '.ob2-nav .btn:only-child{grid-column:1 / -1}',
      '.ob2-nav .btn{min-width:0;white-space:normal;text-align:center;line-height:1.25}',
      '.ob2-sum{padding:14px;border-radius:var(--r-m);background:var(--surface);box-shadow:var(--shadow-1);display:grid;gap:8px}',
      '.ob2-sum h3{margin:0;font:700 1rem/1.25 var(--font-display)}',
      '.ob2-sum p{margin:0;line-height:1.55}',
      '.ob2-hyp{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;padding:8px 0;border-top:1px solid var(--line)}',
      '.ob2-sum h3+.ob2-hyp{border-top:0}',
      '.ob2-hyp__src{font-size:.75rem;color:var(--muted)}'
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

  /* ---------- apprendre v2 : parcours linéaire étape par étape ---------- */
  function pills(q) {
    const f = FLAG[q.flag];
    return [f ? h('span', { class: 'ob-q__flag ob-q__flag--' + q.flag }, f[0] + ' ' + f[1]) : null,
      q.rank === 'B' ? h('span', { class: 'pill pill--B', title: 'Rang B' }, 'B') : null];
  }
  function questionCard(q) {
    const more = h('div', { class: 'ob2-q__more', hidden: true },
      q.why ? h('div', { class: 'ob2-q__row' }, h('span', {}, 'Pourquoi'), md(q.why)) : null,
      q.if ? h('div', { class: 'ob2-q__row ob2-q__row--if' }, h('span', {}, 'Si positif'), md(q.if)) : null,
      q.src ? h('div', { class: 'ob2-q__src' }, 'Source : Collège · ' + str(q.src)) : null);
    const card = h('div', { class: 'ob2-q', dataset: { flag: q.flag || '' } });
    const btn = h('button', { type: 'button', class: 'ob2-q__btn', 'aria-expanded': 'false', on: { click: function () { toggle(more.hidden); } } },
      h('span', { class: 'ob2-q__ask' }, md(q.ask)),
      h('span', { class: 'ob2-q__meta' }, pills(q), h('span', { class: 'ob2-q__tap' }, 'Touche pour voir pourquoi')));
    function toggle(open) {
      more.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      card.dataset.open = open ? '1' : '0';
    }
    card.append(btn, more);
    card.reveal = toggle;
    return card;
  }
  function hypothesesBox(o, compact) {
    if (!Array.isArray(o.hypotheses) || !o.hypotheses.length) return null;
    return h('div', { class: 'ob2-sum' }, h('h3', {}, compact ? '🎯 Hypothèses à présenter' : '🎯 Hypothèses : d’abord les urgences'), o.hypotheses.map(function (x) {
      return h('div', { class: 'ob2-hyp' }, h('span', { 'aria-hidden': 'true' }, x.danger ? '🚨' : '•'),
        h('div', {}, h('strong', {}, str(x.dx)), x.danger ? h('span', { class: 'pill pill--bad', style: 'margin-left:6px' }, 'urgence') : null,
          !compact && x.pour ? h('div', { class: 'secondary' }, md(x.pour)) : null,
          !compact && x.src ? h('div', { class: 'ob2-hyp__src' }, 'Collège · ' + str(x.src)) : null));
    }));
  }
  function renderLearnV2(o, host) {
    const steps = o.steps || [];
    const n = steps.length;
    const posAll = (function () { try { return JSON.parse(localStorage.getItem(LS_POS) || '{}') || {}; } catch (e) { return {}; } })();
    let i = Math.max(0, Math.min(n - 1, Number(posAll[o.id]) || 0));
    function savePos() { posAll[o.id] = i; try { localStorage.setItem(LS_POS, JSON.stringify(posAll)); } catch (e) { /* ignore */ } }
    function go(k) {
      i = Math.max(0, Math.min(n - 1, k)); savePos(); draw();
      const top = host.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight) host.scrollIntoView({ block: 'start' });
    }
    function draw() {
      const s = steps[i] || {};
      const last = i === n - 1;
      const qs = s.questions || [];
      const cards = qs.map(questionCard);
      host.replaceChildren(
        h('div', { class: 'ob2-top' },
          h('div', { class: 'ob2-count' }, h('span', {}, h('b', {}, (i + 1) + ' / ' + n), ' étapes'), h('span', {}, qs.length + ' question' + (qs.length > 1 ? 's' : ''))),
          h('div', { class: 'ob2-bar', role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': String(n), 'aria-valuenow': String(i + 1), 'aria-label': 'Progression dans la consultation' },
            h('span', { style: 'width:' + Math.round((i + 1) * 100 / n) + '%' })),
          h('div', { class: 'ob2-dots', role: 'group', 'aria-label': 'Aller à une étape' }, steps.map(function (st, k) {
            return h('button', { type: 'button', class: k === i ? 'is-on' : k < i ? 'is-done' : '', title: str(st.title), 'aria-label': 'Étape ' + (k + 1) + ' : ' + str(st.title), 'aria-current': k === i ? 'step' : null, on: { click: function () { go(k); } } }, String(k + 1));
          }))),
        h('div', { class: 'ob2-head' }, h('span', { class: 'ob2-n' }, String(i + 1)), h('h3', {}, str(s.title))),
        s.goal ? h('p', { class: 'ob2-goal' }, md(s.goal)) : null,
        cards.length ? h('div', { class: 'ob2-tools' }, h('span', {}, 'Touche une carte pour voir pourquoi.'),
          h('button', { type: 'button', class: 'btn btn--ghost btn--sm', on: { click: function () { const open = cards.some(function (c) { return c.dataset.open !== '1'; }); cards.forEach(function (c) { c.reveal(open); }); } } }, 'Tout révéler')) : null,
        cards.length ? h('div', { class: 'ob2-qs' }, cards) : null,
        s.astuce ? h('div', { class: 'ob-tip' }, '💡 ', md(s.astuce)) : null,
        s.key === 'hypotheses' && !last ? hypothesesBox(o, false) : null,
        last && o.synthese ? h('div', { class: 'ob2-sum' }, h('h3', {}, '📝 La synthèse modèle'), h('p', {}, md(o.synthese))) : null,
        last ? hypothesesBox(o, true) : null,
        last && Array.isArray(o.pieges) && o.pieges.length ? h('div', { class: 'pitfall' }, h('span', { class: 'caption' }, '⚠️ Pièges'), h('ul', { style: 'margin:4px 0 0;padding-left:1.1em' }, o.pieges.map(function (p) { return h('li', {}, md(p)); }))) : null,
        h('div', { class: 'ob2-nav' },
          i > 0 ? h('button', { type: 'button', class: 'btn btn--secondary', on: { click: function () { go(i - 1); } } }, '← Précédent') : null,
          last ? h('button', { type: 'button', class: 'btn btn--primary', on: { click: function () { window.scrollTo(0, 0); host.dispatchEvent(new CustomEvent('ob:play')); } } }, '🎮 Je joue la consultation')
            : h('button', { type: 'button', class: 'btn btn--primary', on: { click: function () { go(i + 1); } } }, 'Suivant →')));
    }
    draw();
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
          const row = h('label', { class: 'ob-check' }, cb, h('div', {}, h('div', { style: 'font-weight:600' }, md(q.ask), q.rank === 'B' ? h('span', { class: 'pill pill--B', style: 'margin-left:6px', title: 'Rang B' }, 'B') : null), q.if ? h('div', { class: 'ob-q__if' }, '➜ ' + str(q.if)) : null, q.why ? h('div', { class: 'ob-q__why' }, md(q.why)) : null));
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
      if (play) renderPlay(o, host, null); else if (isV2(o)) renderLearnV2(o, host); else renderLearn(o, host);
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
