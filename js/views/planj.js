/* CardioR2C — views/planj.js
 * Méthode des J (reprise de la méthode du projet PASS Sorbonne, adaptée aux items) :
 *   #/planj            « Aujourd'hui » : cours à revoir (retard d'abord), note Difficile / Moyen / Facile (+ note % facultative)
 *   #/planj?tab=cours  tous les cours (items cardio / dermato / pneumo, fiches parasito, cours perso) : placer, éditer
 *   #/planj?tab=plan   planning des 21 prochains jours
 *   #/planj?tab=regl   rythme, capacité par jour, décaler tout, rattrapage
 * Rythmes : décalages depuis J0 (classique J1 J3 J7 J15 J30 J60…). Difficile → revient demain sans avancer ;
 * Moyen / Facile → étape suivante (adaptatif : écart × 1,6 si facile). Après chaque changement, lissage
 * automatique : un jour qui dépasse la capacité pousse ses révisions les plus solides d'1 j (J1/J3) ou de 25 % de l'écart.
 * Pastille de maîtrise : dernières notes (et note % si saisie) + avancement dans les J.
 * Données : CARDIO.store « planJ » = {v, rhythm, capacity, updatedAt, courses:{key: course}} (synchronisé avec le profil).
 *   key = « i:<num> » (item), « p:<id> » (parasito), « c:<uid> » (cours perso)
 *   course = {key, title?, group?, start, step, due, state:'active'|'acquis'|'pause', history:[{date, step, grade, note?, late}]}
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  CARDIO.views = CARDIO.views || {};

  const RHYTHMS = {
    classique: { label: 'Classique', offsets: [1, 3, 7, 15, 30, 60], desc: 'J1, J3, J7, J15, J30, J60 : le rythme de référence.' },
    long: { label: 'Long terme', offsets: [1, 3, 7, 15, 30, 60, 120, 240], desc: 'Classique prolongé à J120 et J240, pour tenir jusqu’à l’EDN.' },
    allegee: { label: 'Allégé', offsets: [1, 7, 21, 45], desc: 'Moins de révisions, pour les périodes chargées (stage, partiels).' },
    intensive: { label: 'Intensif', offsets: [1, 2, 4, 7, 12, 20, 30], desc: 'Les dernières semaines avant l’examen.' },
    adaptative: { label: 'Adaptatif', offsets: [1, 3, 7, 15, 30, 60, 120], adaptive: true, desc: 'Selon ta note : Facile espace plus (× 1,6), Difficile revient demain.' }
  };
  const ORDER = ['classique', 'long', 'allegee', 'intensive', 'adaptative'];
  const GRADES = { difficile: { label: 'Difficile', v: 0.2, tone: 'bad' }, moyen: { label: 'Moyen', v: 0.6, tone: 'warn' }, facile: { label: 'Facile', v: 1, tone: 'ok' } };
  const HORIZON = 21;
  const CSS_ID = 'planj-css';

  /* ---------- outils ---------- */
  function U() { return CARDIO.util || {}; }
  function h() { return U().h.apply(null, arguments); }
  function icon(n) { try { return U().iconEl ? U().iconEl(n, { size: 18 }) : null; } catch (e) { return null; } }
  function toast(msg, tone) { try { CARDIO.shell.toast(msg, { tone: tone || 'info' }); } catch (e) { /* ignore */ } }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function key(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return key(new Date()); }
  function parse(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function valid(s) { return !!parse(s); }
  function add(s, n) { const d = parse(s) || new Date(); d.setDate(d.getDate() + n); return key(d); }
  function diff(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
  function maxD(a, b) { return a > b ? a : b; }
  const DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  function nice(s) {
    const t = today();
    if (s === t) return 'aujourd’hui';
    if (s === add(t, 1)) return 'demain';
    if (s === add(t, -1)) return 'hier';
    const d = parse(s); if (!d) return '—';
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  }
  function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ---------- rythme ---------- */
  function rh(id) { return RHYTHMS[id] || RHYTHMS.classique; }
  function offs(id) { return rh(id).offsets; }
  function last(id) { return offs(id).length - 1; }
  function jLabel(id, step) { const o = offs(id); return step >= o.length ? 'Acquis' : 'J' + o[Math.max(0, step)]; }
  function gap(id, step) { const o = offs(id); const s = Math.min(Math.max(0, step), o.length - 1); return o[s] - (s > 0 ? o[s - 1] : 0); }
  function drift(id, step) { const o = offs(id); const s = Math.min(Math.max(0, step), o.length - 1); return o[s] <= 3 ? 1 : Math.max(1, Math.floor(gap(id, s) * 0.25)); }
  function nextDue(id, start, step, day, grade) {
    if (rh(id).adaptive) return add(day, Math.max(1, Math.round(gap(id, step) * (grade === 'facile' ? 1.6 : 1))));
    return maxD(add(start, offs(id)[Math.min(step, last(id))]), add(day, 1));
  }
  function mapStep(from, to, step) {
    const fo = offs(from), tofs = offs(to);
    if (step >= fo.length) return tofs.length;
    const val = fo[Math.max(0, step)];
    let best = 0;
    for (let i = 1; i < tofs.length; i++) if (Math.abs(tofs[i] - val) < Math.abs(tofs[best] - val)) best = i;
    return best;
  }
  /* Cours vu le jour `start` et déjà revu `passes` fois : prochaine étape et échéance. */
  function initialPlan(id, start, passes, t) {
    const o = offs(id);
    let step = -1;
    for (let i = 0; i < o.length; i++) if (add(start, o[i]) <= t) step = i;
    const p = Math.max(0, Math.min(o.length, Math.round(Number(passes) || 0)));
    if (p >= o.length) return { step: o.length, due: null, acquis: true };
    if (p > 0) return { step: p, due: maxD(add(start, o[p]), t) };
    if (step < 0) return { step: 0, due: add(start, o[0]) };
    return { step: step, due: t };
  }

  /* ---------- données ---------- */
  function blank() { return { v: 1, rhythm: 'classique', capacity: 12, updatedAt: 0, courses: {} }; }
  function load() {
    const raw = CARDIO.store && typeof CARDIO.store.get === 'function' ? CARDIO.store.get('planJ') : null;
    const d = blank();
    if (!raw || typeof raw !== 'object') return d;
    if (RHYTHMS[raw.rhythm]) d.rhythm = raw.rhythm;
    d.capacity = Math.max(2, Math.min(60, Math.round(Number(raw.capacity)) || 12));
    d.updatedAt = Number(raw.updatedAt) || 0;
    const t = today();
    const cs = raw.courses && typeof raw.courses === 'object' ? raw.courses : {};
    Object.keys(cs).forEach(function (k) {
      const c = cs[k];
      if (!c || typeof c !== 'object' || !/^[ipc]:/.test(k)) return;
      const o = {
        key: k, title: typeof c.title === 'string' ? c.title.slice(0, 120) : '', group: typeof c.group === 'string' ? c.group.slice(0, 40) : '',
        start: valid(c.start) ? c.start : t, step: Math.max(0, Math.round(Number(c.step)) || 0),
        due: valid(c.due) ? c.due : null, state: c.state === 'acquis' || c.state === 'pause' ? c.state : 'active',
        history: Array.isArray(c.history) ? c.history.filter(function (x) { return x && valid(x.date); }).slice(-60).map(function (x) {
          const y = { date: x.date, step: Math.max(0, Math.round(Number(x.step)) || 0), grade: GRADES[x.grade] ? x.grade : 'moyen', late: Math.max(0, Math.round(Number(x.late)) || 0) };
          if (x.note != null && isFinite(Number(x.note))) y.note = Math.max(0, Math.min(100, Math.round(Number(x.note))));
          return y;
        }) : []
      };
      if (valid(c.planned)) o.planned = c.planned;
      if (o.state === 'active' && !o.due) o.due = t;
      if (o.state === 'active') o.step = Math.min(o.step, last(d.rhythm));
      if (k.charAt(0) === 'c' && !o.title) return;
      d.courses[k] = o;
    });
    return d;
  }
  function save(d) {
    d.updatedAt = Date.now();
    try { smooth(d); } catch (e) { console.warn('[planj] lissage', e); }
    if (CARDIO.store && typeof CARDIO.store.set === 'function') CARDIO.store.set('planJ', JSON.parse(JSON.stringify(d)));
  }
  function list(d) { return Object.keys(d.courses).map(function (k) { return d.courses[k]; }); }

  /* ---------- catalogue : items + parasito ---------- */
  const SPE = { cardio: 'Cardio', dermato: 'Dermato', pneumo: 'Pneumo' };
  function catalog() {
    const out = [];
    const r = CARDIO.registry || {};
    let items = [];
    try { items = typeof r.items === 'function' ? r.items() || [] : []; } catch (e) { items = []; }
    items.forEach(function (it) {
      if (!it || it.num == null) return;
      const lab = typeof r.label === 'function' ? r.label(it.num) : String(it.num);
      out.push({ key: 'i:' + it.num, group: SPE[it.spe || 'cardio'] || 'Autre', title: 'Item ' + lab + ' · ' + (it.short || it.title || ''), href: '#/item/' + encodeURIComponent(it.num), train: '#/review?mode=item&item=' + encodeURIComponent(it.num) + '&size=inf&all=1&from=' + encodeURIComponent('#/planj') + '&autostart=1' });
    });
    (Array.isArray(r.parasito) ? r.parasito : []).forEach(function (p) {
      if (!p || !p.id) return;
      out.push({ key: 'p:' + p.id, group: 'Parasito-myco', title: p.title || p.id, href: '#/parasito/' + encodeURIComponent(p.id), train: '#/parasito/' + encodeURIComponent(p.id) + '/cartes' });
    });
    return out;
  }
  function meta(c, cat) {
    const m = (cat || catalog()).find(function (x) { return x.key === c.key; });
    if (m) return m;
    return { key: c.key, group: c.group || 'Mes cours', title: c.title || c.key, href: null, train: null };
  }

  /* ---------- maîtrise ---------- */
  function mastery(c, d) {
    if (!c) return { lvl: 'none', label: 'Pas placé', score: 0 };
    if (c.state === 'acquis') return { lvl: 'acq', label: 'Acquis', score: 1 };
    const hs = c.history.slice(-3);
    if (!hs.length) return { lvl: 'new', label: 'Vu, pas encore revu', score: 0.3 };
    let s = 0, w = 0;
    hs.forEach(function (x, i) {
      const wt = i + 1;
      let v = GRADES[x.grade].v;
      if (x.note != null) v = (v + x.note / 100) / 2;
      s += v * wt; w += wt;
    });
    const recent = s / w;
    const prog = Math.min(1, c.step / Math.max(1, offs(d.rhythm).length));
    const sc = recent * 0.7 + prog * 0.3;
    if (sc < 0.4) return { lvl: 'bad', label: 'Fragile', score: sc };
    if (sc < 0.7) return { lvl: 'mid', label: 'En cours', score: sc };
    return { lvl: 'ok', label: 'Solide', score: sc };
  }
  function dot(m) { return h('span', { class: 'pj-dot pj-dot--' + m.lvl, title: m.label, 'aria-label': 'Maîtrise : ' + m.label }); }

  /* ---------- prévision et lissage ---------- */
  function project(c, d, t, until) {
    const out = [];
    if (c.state !== 'active' || !c.due) return out;
    let step = c.step, date = maxD(c.due, t), g = 0;
    while (step <= last(d.rhythm) && date <= until && g < 64) {
      out.push({ date: date, step: step, first: g === 0 });
      step += 1; g += 1;
      if (step > last(d.rhythm)) break;
      date = nextDue(d.rhythm, c.start, step, date, 'moyen');
    }
    return out;
  }
  function forecast(d, t, days) {
    const until = add(t, days - 1), idx = {}, out = [];
    for (let i = 0; i < days; i++) { const dt = add(t, i); idx[dt] = i; out.push({ date: dt, items: [] }); }
    list(d).forEach(function (c) {
      project(c, d, t, until).forEach(function (p) {
        const i = idx[p.date];
        if (i != null) out[i].items.push({ key: c.key, step: p.step, projected: !p.first, overdue: p.first && c.due < t });
      });
    });
    return out;
  }
  function smooth(d) {
    const t = today(), cap = d.capacity, total = HORIZON + 14;
    let fc = forecast(d, t, total), guard = 0;
    for (let i = 1; i < HORIZON; i++) {                 // aujourd'hui (i = 0) n'est jamais déplacé automatiquement
      while (fc[i].items.length > cap && guard < 2000) {
        guard++;
        const date = fc[i].date;
        const cands = fc[i].items.filter(function (it) { return !it.projected && !it.overdue; })
          .map(function (it) { return d.courses[it.key]; })
          .filter(function (c) { return c && c.state === 'active' && c.due === date; })
          .sort(function (a, b) { return b.step - a.step || (a.key < b.key ? -1 : 1); });
        let done = false;
        for (let k = 0; k < cands.length && !done; k++) {
          const c = cands[k];
          const limit = add(c.planned || c.due, drift(d.rhythm, c.step));
          for (let j = i + 1; j < total && fc[j].date <= limit; j++) {
            if (fc[j].items.length < cap) {
              if (!c.planned) c.planned = c.due;
              c.due = fc[j].date;
              if (c.due === c.planned) delete c.planned;
              done = true; break;
            }
          }
        }
        if (!done) break;
        fc = forecast(d, t, total);
      }
    }
  }

  /* ---------- opérations ---------- */
  function place(d, k, info) {
    const t = today();
    const start = valid(info.start) && info.start <= t ? info.start : t;
    const p = initialPlan(d.rhythm, start, info.passes, t);
    const c = d.courses[k] || { key: k, history: [] };
    c.start = start; c.step = p.step; c.due = p.due; delete c.planned;
    c.state = p.acquis ? 'acquis' : 'active';
    if (info.title != null) c.title = info.title;
    if (info.group != null) c.group = info.group;
    d.courses[k] = c;
    return c;
  }
  function review(d, k, grade, note) {
    const c = d.courses[k]; const t = today();
    if (!c || c.state !== 'active') return null;
    const g = GRADES[grade] ? grade : 'moyen';
    const done = c.step;
    const hrec = { date: t, step: done, grade: g, late: c.due && c.due < t ? diff(c.due, t) : 0 };
    if (note != null && note !== '' && isFinite(Number(note))) hrec.note = Math.max(0, Math.min(100, Math.round(Number(note))));
    c.history.push(hrec);
    if (c.history.length > 60) c.history.splice(0, c.history.length - 60);
    delete c.planned;
    let msg;
    if (g === 'difficile') { c.due = add(t, 1); msg = jLabel(d.rhythm, done) + ' à refaire demain'; }
    else {
      c.step = done + 1;
      if (c.step > last(d.rhythm)) { c.state = 'acquis'; c.due = null; msg = 'Acquis : bravo !'; }
      else { c.due = nextDue(d.rhythm, c.start, c.step, t, g); msg = jLabel(d.rhythm, done) + ' validé · prochain ' + jLabel(d.rhythm, c.step) + ' ' + nice(c.due); }
    }
    return msg;
  }
  function setRhythm(d, id) {
    if (!RHYTHMS[id] || id === d.rhythm) return;
    const t = today(), from = d.rhythm;
    list(d).forEach(function (c) {
      if (c.state !== 'active') return;
      c.step = Math.min(mapStep(from, id, c.step), offs(id).length - 1);
      if (c.due && c.due > t && !RHYTHMS[id].adaptive) c.due = maxD(add(c.start, offs(id)[c.step]), add(t, 1));
      delete c.planned;
    });
    d.rhythm = id;
  }
  function shiftAll(d, n) {
    const t = today();
    list(d).forEach(function (c) { if (c.state === 'active' && c.due) { c.due = add(maxD(c.due, t), n); delete c.planned; } });
  }
  /* Rattrapage : retards étalés à partir d'aujourd'hui, les plus fragiles d'abord, sans dépasser la capacité. */
  function catchUp(d) {
    const t = today();
    const late = list(d).filter(function (c) { return c.state === 'active' && c.due && c.due < t; })
      .sort(function (a, b) { return a.step - b.step || (a.due < b.due ? -1 : 1); });
    if (!late.length) return 0;
    const fc = forecast(d, t, 60);
    const load = fc.map(function (x) { return x.items.filter(function (it) { return !it.projected && !it.overdue; }).length; });
    let day = 0;
    late.forEach(function (c) {
      while (day < 59 && load[day] >= d.capacity) day++;
      c.due = add(t, day); load[day]++;
      delete c.planned;
    });
    return late.length;
  }

  /* ---------- rendu ---------- */
  function ensureStyles() {
    if (document.getElementById(CSS_ID)) return;
    const s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = [
      '.pj{display:flex;flex-direction:column;gap:14px}',
      '.pj-tabs{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px}',
      '.pj-tabs a{flex:0 0 auto;padding:8px 14px;border-radius:999px;border:1px solid var(--line);color:var(--ink-2);text-decoration:none;font-weight:600;font-size:14px;background:var(--surface)}',
      '.pj-tabs a.is-on{background:var(--accent);border-color:var(--accent);color:#fff}',
      '.pj-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}',
      '.pj-kpi{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-m,12px);padding:10px;text-align:center}',
      '.pj-kpi b{display:block;font-size:22px;color:var(--ink)}.pj-kpi span{font-size:12px;color:var(--muted)}',
      '.pj-row{display:flex;align-items:center;gap:10px;padding:12px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-m,12px)}',
      '.pj-row__main{flex:1;min-width:0}.pj-row__t{font-weight:600;color:var(--ink);overflow:hidden;text-overflow:ellipsis}',
      '.pj-row__s{font-size:13px;color:var(--muted);margin-top:2px}',
      '.pj-row__acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}',
      '.pj-dot{flex:0 0 auto;width:14px;height:14px;border-radius:50%;background:var(--line);border:2px solid var(--surface);box-shadow:0 0 0 1px var(--line)}',
      '.pj-dot--new{background:var(--info)}.pj-dot--bad{background:var(--bad)}.pj-dot--mid{background:var(--warn)}.pj-dot--ok{background:var(--ok)}',
      '.pj-dot--acq{background:var(--ok);box-shadow:0 0 0 3px var(--ok-soft)}',
      '.pj-tag{font-size:12px;font-weight:700;padding:2px 8px;border-radius:999px;background:var(--surface-2);color:var(--ink-2)}',
      '.pj-tag--late{background:var(--bad-soft);color:var(--bad)}',
      '.pj-grade{display:flex;gap:6px;flex-wrap:wrap;align-items:center}',
      '.pj-grade button{min-height:40px}',
      '.pj-note{width:70px;min-height:40px;border:1px solid var(--line);border-radius:10px;padding:0 8px;background:var(--surface);color:var(--ink)}',
      '.pj-h{font-size:15px;font-weight:700;color:var(--ink);margin:6px 0 0}',
      '.pj-grp{display:flex;flex-direction:column;gap:8px}',
      '.pj-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:13px;color:var(--muted);align-items:center}',
      '.pj-legend span{display:inline-flex;align-items:center;gap:5px}',
      '.pj-bars{display:flex;flex-direction:column;gap:4px}',
      '.pj-bar{display:grid;grid-template-columns:92px 1fr 34px;gap:8px;align-items:center;font-size:13px;color:var(--ink-2);cursor:pointer}',
      '.pj-bar__track{height:12px;border-radius:6px;background:var(--surface-2);overflow:hidden}',
      '.pj-bar__fill{height:100%;background:var(--accent);border-radius:6px}.pj-bar__fill.is-over{background:var(--warn)}',
      '.pj-sheet{border:2px solid var(--accent);border-radius:var(--r-m,12px);padding:12px;background:var(--surface);display:flex;flex-direction:column;gap:10px}',
      '.pj-field{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--ink-2)}',
      '.pj-field input,.pj-field select{min-height:40px;border:1px solid var(--line);border-radius:10px;padding:0 10px;background:var(--surface);color:var(--ink);font-size:15px}',
      '.pj-chips{display:flex;gap:6px;flex-wrap:wrap}',
      '.pj-chips button{min-height:36px;padding:0 12px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);font-weight:600}',
      '.pj-chips button.is-on{background:var(--accent);border-color:var(--accent);color:#fff}',
      '.pj-banner{padding:12px;border-radius:var(--r-m,12px);background:var(--warn-soft);color:var(--ink);display:flex;flex-direction:column;gap:8px}',
      '.pj-check{width:22px;height:22px;flex:0 0 auto}',
      '.pj-search{min-height:42px;border:1px solid var(--line);border-radius:12px;padding:0 12px;background:var(--surface);color:var(--ink);font-size:15px;width:100%}',
      '.pj-bulk{position:sticky;bottom:calc(var(--tabbar-h,64px) + 8px);z-index:5;box-shadow:var(--shadow-2)}',
      '@media (max-width:420px){.pj-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function btn(label, cls, onClick, ic) {
    return h('button', { type: 'button', class: 'btn ' + (cls || 'btn--ghost btn--sm'), on: { click: onClick } }, ic ? icon(ic) : null, label);
  }

  function render(params, query) {
    ensureStyles();
    const q = query || {};
    const root = h('div', { class: 'pj' });
    const state = { tab: ['cours', 'plan', 'regl'].indexOf(q.tab) >= 0 ? q.tab : 'today', open: q.open || null, filter: '', sel: {}, bulk: false, day: null };
    function rerender() {
      const d = load();
      const cat = catalog();
      root.replaceChildren.apply(root, [tabs(), kpis(d)].concat(state.tab === 'today' ? viewToday(d, cat)
        : state.tab === 'cours' ? viewCourses(d, cat) : state.tab === 'plan' ? viewPlan(d, cat) : viewSettings(d)).filter(Boolean));
    }
    function go(tab) { state.tab = tab; state.open = null; rerender(); window.scrollTo(0, 0); }
    function tabs() {
      const T = [['today', 'Aujourd’hui'], ['cours', 'Mes cours'], ['plan', 'Planning'], ['regl', 'Réglages']];
      return h('nav', { class: 'pj-tabs' }, T.map(function (x) {
        return h('a', { href: '#/planj' + (x[0] === 'today' ? '' : '?tab=' + x[0]), class: state.tab === x[0] ? 'is-on' : '', on: { click: function (e) { e.preventDefault(); go(x[0]); } } }, x[1]);
      }));
    }
    function kpis(d) {
      const t = today(); const cs = list(d);
      const due = cs.filter(function (c) { return c.state === 'active' && c.due && c.due <= t; }).length;
      const late = cs.filter(function (c) { return c.state === 'active' && c.due && c.due < t; }).length;
      const act = cs.filter(function (c) { return c.state === 'active'; }).length;
      const acq = cs.filter(function (c) { return c.state === 'acquis'; }).length;
      return h('div', { class: 'pj-kpis' },
        h('div', { class: 'pj-kpi' }, h('b', null, String(due)), h('span', null, 'à revoir aujourd’hui')),
        h('div', { class: 'pj-kpi' }, h('b', { style: late ? 'color:var(--bad)' : null }, String(late)), h('span', null, 'en retard')),
        h('div', { class: 'pj-kpi' }, h('b', null, String(act)), h('span', null, 'en cours')),
        h('div', { class: 'pj-kpi' }, h('b', null, String(acq)), h('span', null, 'acquis')));
    }

    /* --- Aujourd'hui --- */
    function viewToday(d, cat) {
      const t = today(); const out = [];
      const cs = list(d);
      if (!cs.length) {
        out.push(h('div', { class: 'card stack' },
          h('p', { class: 'pj-h' }, 'Place tes cours pour démarrer'),
          h('p', { class: 'secondary muted' }, 'Dans « Mes cours », indique pour chaque item (et chaque fiche parasito) si tu l’as déjà vu, quand, et combien de fois. L’app calcule ensuite toute seule quand le revoir : J1, J3, J7, J15, J30, J60…'),
          btn('Placer mes cours', 'btn--primary', function () { go('cours'); }, 'plus')));
        return out;
      }
      const late = cs.filter(function (c) { return c.state === 'active' && c.due && c.due < t; });
      if (late.length > d.capacity) {
        out.push(h('div', { class: 'pj-banner' },
          h('b', null, plural(late.length, 'révision en retard', 'révisions en retard')),
          h('span', null, 'Étale-les sur les prochains jours, les plus fragiles d’abord, sans dépasser ' + d.capacity + ' par jour.'),
          h('div', { class: 'pj-row__acts' },
            btn('Rattraper en douceur', 'btn--primary btn--sm', function () { const n = catchUp(d); save(d); toast(plural(n, 'révision replanifiée', 'révisions replanifiées'), 'ok'); rerender(); }, 'refresh'),
            btn('Tout décaler de ' + Math.min(30, Math.max(1, diff(late.reduce(function (m, c) { return c.due < m ? c.due : m; }, t), t))) + ' j', null, function () {
              const n = Math.min(30, Math.max(1, diff(late.reduce(function (m, c) { return c.due < m ? c.due : m; }, t), t)));
              shiftAll(d, n); save(d); toast('Tout est décalé de ' + plural(n, 'jour', 'jours'), 'ok'); rerender();
            }, 'calendar'))));
      }
      const due = cs.filter(function (c) { return c.state === 'active' && c.due && c.due <= t; })
        .sort(function (a, b) { return (a.due < t ? 0 : 1) - (b.due < t ? 0 : 1) || a.step - b.step || (a.due < b.due ? -1 : 1); });
      out.push(h('p', { class: 'pj-h' }, due.length ? 'À revoir aujourd’hui (' + due.length + ')' : 'Rien à revoir aujourd’hui'));
      if (!due.length) {
        const nxt = cs.filter(function (c) { return c.state === 'active' && c.due; }).sort(function (a, b) { return a.due < b.due ? -1 : 1; })[0];
        out.push(h('p', { class: 'secondary muted' }, nxt ? 'Prochaine révision : ' + meta(nxt, cat).title + ', ' + nice(nxt.due) + '. Tu peux avancer un nouveau cours dans « Mes cours ».' : 'Tous tes cours placés sont acquis ou en pause.'));
      }
      out.push(h('div', { class: 'pj-grp' }, due.map(function (c) { return dueRow(d, c, cat); })));
      const done = cs.filter(function (c) { const x = c.history[c.history.length - 1]; return x && x.date === t; });
      if (done.length) {
        out.push(h('p', { class: 'pj-h' }, 'Faits aujourd’hui (' + done.length + ')'));
        out.push(h('div', { class: 'pj-grp' }, done.map(function (c) {
          const x = c.history[c.history.length - 1]; const m = meta(c, cat);
          return h('div', { class: 'pj-row' }, dot(mastery(c, d)),
            h('div', { class: 'pj-row__main' }, h('div', { class: 'pj-row__t' }, m.title),
              h('div', { class: 'pj-row__s' }, jLabel(d.rhythm, x.step) + ' · ' + GRADES[x.grade].label + (x.note != null ? ' · ' + x.note + ' %' : '') + (c.state === 'acquis' ? ' · acquis' : c.due ? ' · prochain ' + nice(c.due) : ''))),
            btn('Annuler', null, function () { undo(d, c); save(d); rerender(); }));
        })));
      }
      return out;
    }
    function undo(d, c) {
      const x = c.history.pop(); if (!x) return;
      c.step = x.step; c.state = 'active'; c.due = today();
      toast('Note annulée : ' + jLabel(d.rhythm, x.step) + ' de nouveau à faire', 'info');
    }
    function dueRow(d, c, cat) {
      const t = today(); const m = meta(c, cat); const ms = mastery(c, d);
      const lateN = c.due < t ? diff(c.due, t) : 0;
      const note = h('input', { class: 'pj-note', type: 'number', min: '0', max: '100', inputmode: 'numeric', placeholder: 'note %', 'aria-label': 'Ma note en % (facultatif)' });
      function grade(g) { const msg = review(d, c.key, g, note.value); save(d); toast(msg || 'Enregistré', g === 'difficile' ? 'warn' : 'ok'); rerender(); }
      return h('div', { class: 'pj-row', style: 'align-items:flex-start' }, dot(ms),
        h('div', { class: 'pj-row__main' },
          h('div', { class: 'pj-row__t' }, m.title),
          h('div', { class: 'pj-row__s' }, h('span', { class: 'pj-tag' }, jLabel(d.rhythm, c.step)), ' ', lateN ? h('span', { class: 'pj-tag pj-tag--late' }, 'retard ' + lateN + ' j') : null, ' ', m.group + ' · ' + ms.label),
          h('div', { class: 'pj-row__acts' },
            m.href ? h('a', { class: 'btn btn--ghost btn--sm', href: m.href }, icon('book'), 'Revoir le cours') : null,
            m.train ? h('a', { class: 'btn btn--ghost btn--sm', href: m.train }, icon('play'), 'S’entraîner') : null),
          h('div', { class: 'pj-row__acts pj-grade' },
            h('span', { class: 'secondary muted' }, 'Comment ça s’est passé ?'),
            btn('Difficile', 'btn--outline btn--sm', function () { grade('difficile'); }),
            btn('Moyen', 'btn--outline btn--sm', function () { grade('moyen'); }),
            btn('Facile', 'btn--primary btn--sm', function () { grade('facile'); }),
            note)));
    }

    /* --- Mes cours --- */
    function viewCourses(d, cat) {
      const out = [];
      out.push(h('div', { class: 'pj-legend' },
        h('span', null, dot({ lvl: 'none', label: 'Pas placé' }), 'pas placé'),
        h('span', null, dot({ lvl: 'new', label: '' }), 'vu'),
        h('span', null, dot({ lvl: 'bad', label: '' }), 'fragile'),
        h('span', null, dot({ lvl: 'mid', label: '' }), 'en cours'),
        h('span', null, dot({ lvl: 'ok', label: '' }), 'solide'),
        h('span', null, dot({ lvl: 'acq', label: '' }), 'acquis')));
      const search = h('input', { class: 'pj-search', type: 'search', placeholder: 'Chercher un item, une fiche…', value: state.filter,
        on: { input: function (e) { state.filter = e.target.value; const pos = e.target.selectionStart; rerender(); const s = root.querySelector('.pj-search'); if (s) { s.focus(); try { s.setSelectionRange(pos, pos); } catch (er) { /* ignore */ } } } } });
      out.push(h('div', { class: 'pj-row__acts' },
        btn(state.bulk ? 'Terminer la sélection' : 'Placer plusieurs cours d’un coup', state.bulk ? 'btn--primary btn--sm' : null, function () { state.bulk = !state.bulk; state.sel = {}; rerender(); }, 'check'),
        btn('Ajouter un cours perso', null, function () { state.open = 'new'; rerender(); }, 'plus')));
      out.push(search);
      if (state.open === 'new') out.push(sheet(d, null, cat));
      const f = state.filter.trim().toLowerCase();
      const custom = list(d).filter(function (c) { return c.key.charAt(0) === 'c'; }).map(function (c) { return { key: c.key, group: c.group || 'Mes cours', title: c.title, href: null, train: null }; });
      const all = cat.concat(custom).filter(function (m) { return !f || m.title.toLowerCase().indexOf(f) >= 0 || m.group.toLowerCase().indexOf(f) >= 0; });
      const groups = {};
      all.forEach(function (m) { (groups[m.group] = groups[m.group] || []).push(m); });
      Object.keys(groups).forEach(function (g) {
        const items = groups[g];
        const placed = items.filter(function (m) { return d.courses[m.key]; }).length;
        out.push(h('p', { class: 'pj-h' }, g + ' · ' + placed + '/' + items.length + ' placés'));
        out.push(h('div', { class: 'pj-grp' }, items.map(function (m) {
          const c = d.courses[m.key];
          const rows = [courseRow(d, m, c)];
          if (state.open === m.key) rows.push(sheet(d, m, cat));
          return rows;
        })));
      });
      if (state.bulk) out.push(bulkBar(d));
      return out;
    }
    function courseRow(d, m, c) {
      const ms = mastery(c, d);
      const sub = !c ? 'Pas encore placé' : c.state === 'acquis' ? 'Acquis · ' + plural(c.history.length, 'révision', 'révisions')
        : c.state === 'pause' ? 'En pause' : 'Prochain ' + jLabel(d.rhythm, c.step) + ' · ' + nice(c.due) + ' · ' + ms.label;
      const main = h('div', { class: 'pj-row__main', style: 'cursor:pointer', on: { click: function () { if (state.bulk) { toggle(); return; } state.open = state.open === m.key ? null : m.key; rerender(); } } },
        h('div', { class: 'pj-row__t' }, m.title), h('div', { class: 'pj-row__s' }, sub));
      function toggle() { state.sel[m.key] = !state.sel[m.key]; rerender(); }
      return h('div', { class: 'pj-row' },
        state.bulk ? h('input', { type: 'checkbox', class: 'pj-check', checked: !!state.sel[m.key], on: { change: toggle }, 'aria-label': 'Sélectionner ' + m.title }) : dot(ms),
        main,
        !state.bulk && !c ? btn('Vu aujourd’hui', 'btn--outline btn--sm', function () { place(d, m.key, { start: today(), passes: 0 }); save(d); toast(m.title + ' placé : J1 demain', 'ok'); rerender(); }, 'plus') : null);
    }
    function passChips(val, onPick) {
      const opts = [[0, 'Juste lu'], [1, 'Revu 1×'], [2, 'Revu 2×'], [3, '3×'], [4, '4× et +']];
      return h('div', { class: 'pj-chips' }, opts.map(function (o) {
        return h('button', { type: 'button', class: val === o[0] ? 'is-on' : '', on: { click: function () { onPick(o[0]); } } }, o[1]);
      }));
    }
    function sheet(d, m, cat) {
      const isNew = !m;
      const c = m ? d.courses[m.key] : null;
      const loc = { start: c ? c.start : today(), passes: c ? Math.min(4, c.history.length) : 0 };
      const title = h('input', { type: 'text', maxlength: '100', placeholder: 'Ex. Item 152 · Endocardite (cours fac)' });
      const group = h('input', { type: 'text', maxlength: '40', placeholder: 'Ex. Néphro, Gynéco…', value: 'Mes cours' });
      const start = h('input', { type: 'date', value: loc.start, max: today() });
      const chips = h('div');
      function drawChips() { chips.replaceChildren(passChips(loc.passes, function (p) { loc.passes = p; drawChips(); preview(); })); }
      const prev = h('p', { class: 'secondary muted' });
      function preview() {
        const p = initialPlan(d.rhythm, start.value || today(), loc.passes, today());
        prev.textContent = p.acquis ? 'Il sera marqué acquis.' : 'Prochaine révision : ' + jLabel(d.rhythm, p.step) + ', ' + nice(p.due) + '.';
      }
      start.addEventListener('change', preview);
      drawChips(); preview();
      const body = [h('p', { class: 'pj-h' }, isNew ? 'Nouveau cours perso' : m.title)];
      if (isNew) body.push(h('label', { class: 'pj-field' }, 'Nom du cours', title), h('label', { class: 'pj-field' }, 'Matière (groupe)', group));
      body.push(h('label', { class: 'pj-field' }, 'Première lecture le', start),
        h('div', { class: 'pj-field' }, 'Déjà revu combien de fois depuis ?', chips), prev);
      const acts = [btn(c ? 'Replacer' : 'Placer', 'btn--primary btn--sm', function () {
        let k = m ? m.key : 'c:' + uid();
        if (isNew && !title.value.trim()) { toast('Donne un nom au cours', 'warn'); return; }
        const cc = place(d, k, { start: start.value, passes: loc.passes, title: isNew ? title.value.trim() : undefined, group: isNew ? (group.value.trim() || 'Mes cours') : undefined });
        save(d); state.open = null; toast((isNew ? cc.title : m.title) + (cc.state === 'acquis' ? ' : acquis' : ' : ' + jLabel(d.rhythm, cc.step) + ' ' + nice(cc.due)), 'ok'); rerender();
      }, 'check')];
      if (c && c.state === 'active') {
        const due = h('input', { type: 'date', value: c.due || today(), min: today() });
        body.push(h('label', { class: 'pj-field' }, 'Ou choisir moi-même la prochaine date (' + jLabel(d.rhythm, c.step) + ')', due));
        acts.push(btn('Appliquer la date', null, function () { if (!valid(due.value)) return; c.due = due.value; delete c.planned; save(d); toast('Prochaine révision ' + nice(c.due), 'ok'); rerender(); }, 'calendar'));
        acts.push(btn('Pause', null, function () { c.state = 'pause'; save(d); rerender(); }, 'pause'));
        acts.push(btn('Marquer acquis', null, function () { c.state = 'acquis'; c.due = null; save(d); rerender(); }, 'star'));
      }
      if (c && c.state !== 'active') acts.push(btn('Reprendre', null, function () { c.state = 'active'; c.step = Math.min(c.step, last(d.rhythm)); c.due = today(); save(d); rerender(); }, 'play'));
      if (c && c.history.length) {
        body.push(h('div', { class: 'pj-row__s' }, 'Historique : ' + c.history.slice(-6).map(function (x) { return nice(x.date) + ' ' + jLabel(d.rhythm, x.step) + ' ' + GRADES[x.grade].label.toLowerCase() + (x.note != null ? ' (' + x.note + ' %)' : ''); }).join(' · ')));
      }
      if (m && m.href) acts.push(h('a', { class: 'btn btn--ghost btn--sm', href: m.href }, icon('book'), 'Ouvrir'));
      if (c) acts.push(btn('Retirer', 'btn--ghost btn--sm', function () { if (!window.confirm('Retirer ce cours du planning ? Son historique sera effacé.')) return; delete d.courses[c.key]; save(d); state.open = null; rerender(); }, 'trash'));
      acts.push(btn('Fermer', 'btn--ghost btn--sm', function () { state.open = null; rerender(); }));
      body.push(h('div', { class: 'pj-row__acts' }, acts));
      return h('div', { class: 'pj-sheet' }, body);
    }
    function bulkBar(d) {
      const keys = Object.keys(state.sel).filter(function (k) { return state.sel[k]; });
      const loc = { passes: 0 };
      const start = h('input', { type: 'date', value: today(), max: today() });
      const chips = h('div');
      function draw() { chips.replaceChildren(passChips(loc.passes, function (p) { loc.passes = p; draw(); })); }
      draw();
      return h('div', { class: 'pj-sheet pj-bulk' },
        h('b', null, plural(keys.length, 'cours sélectionné', 'cours sélectionnés')),
        h('label', { class: 'pj-field' }, 'Première lecture le', start),
        h('div', { class: 'pj-field' }, 'Déjà revus combien de fois ?', chips),
        h('div', { class: 'pj-row__acts' },
          btn('Placer la sélection', 'btn--primary btn--sm', function () {
            if (!keys.length) { toast('Coche d’abord des cours', 'warn'); return; }
            keys.forEach(function (k) { place(d, k, { start: start.value, passes: loc.passes }); });
            save(d); state.sel = {}; state.bulk = false; toast(plural(keys.length, 'cours placé', 'cours placés'), 'ok'); rerender();
          }, 'check'),
          btn('Annuler', null, function () { state.sel = {}; state.bulk = false; rerender(); })));
    }

    /* --- Planning --- */
    function viewPlan(d, cat) {
      const t = today(); const fc = forecast(d, t, HORIZON);
      const max = Math.max(d.capacity, fc.reduce(function (m, x) { return Math.max(m, x.items.length); }, 0));
      const out = [h('p', { class: 'secondary muted' }, 'Ce qui t’attend si tu tiens le rythme. Les révisions qui dépassent ta capacité (' + d.capacity + '/jour) sont décalées automatiquement d’un jour ou deux. Touche un jour pour voir le détail.')];
      out.push(h('div', { class: 'pj-bars' }, fc.map(function (x) {
        const n = x.items.length;
        return h('div', { class: 'pj-bar', on: { click: function () { state.day = state.day === x.date ? null : x.date; rerender(); } } },
          h('span', null, nice(x.date)),
          h('div', { class: 'pj-bar__track' }, h('div', { class: 'pj-bar__fill' + (n > d.capacity ? ' is-over' : ''), style: 'width:' + Math.round((n / max) * 100) + '%' })),
          h('b', null, String(n)));
      })));
      const day = state.day && fc.find(function (x) { return x.date === state.day; });
      if (day) {
        out.push(h('p', { class: 'pj-h' }, 'Le ' + nice(day.date) + ' (' + day.items.length + ')'));
        out.push(h('div', { class: 'pj-grp' }, day.items.map(function (it) {
          const c = d.courses[it.key]; const m = meta(c, cat);
          return h('div', { class: 'pj-row' }, dot(mastery(c, d)), h('div', { class: 'pj-row__main' },
            h('div', { class: 'pj-row__t' }, m.title), h('div', { class: 'pj-row__s' }, jLabel(d.rhythm, it.step) + (it.overdue ? ' · en retard' : it.projected ? ' · prévu si tu tiens le rythme' : ''))));
        })));
      }
      return out;
    }

    /* --- Réglages --- */
    function viewSettings(d) {
      const out = [];
      out.push(h('p', { class: 'pj-h' }, 'Rythme'));
      out.push(h('div', { class: 'pj-grp' }, ORDER.map(function (id) {
        const r = RHYTHMS[id];
        return h('div', { class: 'pj-row', style: 'cursor:pointer' + (d.rhythm === id ? ';border-color:var(--accent)' : ''), on: { click: function () { setRhythm(d, id); save(d); toast('Rythme ' + r.label + ' : planning recalculé', 'ok'); rerender(); } } },
          h('span', { class: 'pj-dot ' + (d.rhythm === id ? 'pj-dot--ok' : '') }),
          h('div', { class: 'pj-row__main' }, h('div', { class: 'pj-row__t' }, r.label), h('div', { class: 'pj-row__s' }, r.desc)));
      })));
      const cap = h('input', { type: 'number', min: '2', max: '60', value: String(d.capacity), inputmode: 'numeric' });
      out.push(h('p', { class: 'pj-h' }, 'Capacité'));
      out.push(h('div', { class: 'pj-sheet', style: 'border-width:1px' },
        h('label', { class: 'pj-field' }, 'Nombre maximum de cours à revoir par jour', cap),
        h('div', { class: 'pj-row__acts' }, btn('Enregistrer', 'btn--primary btn--sm', function () { d.capacity = Math.max(2, Math.min(60, Math.round(Number(cap.value)) || 12)); save(d); toast('Capacité : ' + d.capacity + ' par jour', 'ok'); rerender(); }, 'check'))));
      const n = h('input', { type: 'number', min: '1', max: '30', value: '3', inputmode: 'numeric' });
      out.push(h('p', { class: 'pj-h' }, 'Pause (vacances, stage chargé)'));
      out.push(h('div', { class: 'pj-sheet', style: 'border-width:1px' },
        h('label', { class: 'pj-field' }, 'Décaler toutes les révisions de (jours)', n),
        h('div', { class: 'pj-row__acts' },
          btn('Décaler', null, function () { const k = Math.max(1, Math.min(30, Math.round(Number(n.value)) || 1)); shiftAll(d, k); save(d); toast('Tout est décalé de ' + plural(k, 'jour', 'jours'), 'ok'); rerender(); }, 'calendar'),
          btn('Rattraper le retard', null, function () { const k = catchUp(d); save(d); toast(k ? plural(k, 'révision replanifiée', 'révisions replanifiées') : 'Aucun retard', 'ok'); rerender(); }, 'refresh'))));
      out.push(h('p', { class: 'secondary muted' }, 'Ton planning est enregistré avec ta progression (et synchronisé si tu es connecté). Difficile = à refaire demain ; Moyen ou Facile = étape suivante. La pastille de maîtrise tient compte de tes 3 dernières notes (et de ta note en % si tu la donnes) et de ton avancement dans les J.'));
      return out;
    }

    rerender();
    return { el: root, title: 'Méthode des J' };
  }

  /* Pour l'accueil : nombre de cours à revoir aujourd'hui (et en retard). */
  function summary() {
    try {
      const d = load(); const t = today(); const cs = list(d);
      return {
        placed: cs.length,
        due: cs.filter(function (c) { return c.state === 'active' && c.due && c.due <= t; }).length,
        late: cs.filter(function (c) { return c.state === 'active' && c.due && c.due < t; }).length
      };
    } catch (e) { return { placed: 0, due: 0, late: 0 }; }
  }
  function homeCard() {
    const s = summary();
    const text = !s.placed ? 'Place tes cours : l’app te dit quoi revoir chaque jour (J1, J3, J7…).'
      : s.due ? plural(s.due, 'cours à revoir', 'cours à revoir') + ' aujourd’hui' + (s.late ? ' dont ' + s.late + ' en retard' : '') : 'Rien à revoir aujourd’hui : avance un nouveau cours.';
    return h('a', { class: 'card', href: '#/planj', style: 'display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit' },
      h('span', { class: 'pj-dot ' + (s.late ? 'pj-dot--bad' : s.due ? 'pj-dot--mid' : 'pj-dot--ok'), style: 'width:16px;height:16px' }),
      h('span', { style: 'flex:1' }, h('b', { style: 'display:block' }, 'Méthode des J'), h('span', { class: 'secondary muted' }, text)),
      icon('calendar'));
  }

  CARDIO.views.planj = { render: render, summary: summary, homeCard: function () { ensureStyles(); return homeCard(); } };
})();
