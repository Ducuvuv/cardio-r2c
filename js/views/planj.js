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
    allegee: { label: 'Allégé (par défaut)', offsets: [1, 7, 21, 45, 90], desc: 'J1, J7, J21, J45, J90 : peu de révisions, tient sur la durée sans te noyer.' },
    intensive: { label: 'Intensif', offsets: [1, 2, 4, 7, 12, 20, 30], desc: 'Les dernières semaines avant l’examen.' },
    adaptative: { label: 'Adaptatif', offsets: [1, 3, 7, 15, 30, 60, 120], adaptive: true, desc: 'Selon ta note : Facile espace plus (× 1,6), Difficile revient demain.' }
  };
  const ORDER = ['allegee', 'classique', 'long', 'intensive', 'adaptative'];
  const GRADES = { difficile: { label: 'Difficile', v: 0.2, tone: 'bad' }, moyen: { label: 'Moyen', v: 0.6, tone: 'warn' }, facile: { label: 'Facile', v: 1, tone: 'ok' } };
  const HORIZON = 21;
  const LEVELS = { 1: { label: 'Vu 1 fois, flou', v: 0.15 }, 2: { label: 'Les bases', v: 0.45 }, 3: { label: 'Bien', v: 0.7 }, 4: { label: 'Maîtrisé', v: 0.95 } };
  const FREQ = { 1: 'Tombe rarement', 2: 'Tombe parfois', 3: 'Tombe souvent' };
  const TOURS_MIN = 3, TOURS_MAX = 120;
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

  /* ---------- XP et badges (CARDIO.store.gainXp / grantBadge, effets dans js/fx.js) ---------- */
  const XP = { discover: 40, difficile: 15, moyen: 25, facile: 30, memo: 15, tour: 20, day: 100, place: 5 };
  function xp(n, why) { try { if (CARDIO.store && CARDIO.store.gainXp) CARDIO.store.gainXp(n, why); } catch (e) { /* ignore */ } }
  function badge(id) { try { if (CARDIO.store && CARDIO.store.grantBadge) CARDIO.store.grantBadge(id); } catch (e) { /* ignore */ } }
  /* Badges d'avancement calculés sur l'état du planning (appelé après chaque changement). */
  function checkBadges(d, cat) {
    const cs = list(d);
    const placed = cs.length, acq = cs.filter(function (c) { return c.state === 'acquis'; }).length;
    const reviews = cs.reduce(function (a, c) { return a + c.history.length; }, 0);
    if (placed >= 20) badge('pj-placed-20');
    if (cat && cat.length && cat.every(function (m) { return d.courses[m.key]; })) badge('pj-placed-all');
    if (acq >= 1) badge('pj-acquis-1'); if (acq >= 10) badge('pj-acquis-10'); if (acq >= 50) badge('pj-acquis-50');
    if (reviews >= 100) badge('pj-review-100');
    const n = Number(d.daysDone) || 0;
    if (n >= 1) badge('pj-day-1'); if (n >= 7) badge('pj-day-7'); if (n >= 30) badge('pj-day-30'); if (n >= 100) badge('pj-day-100');
    if (cat) {
      const groups = {};
      cat.forEach(function (m) { (groups[m.group] = groups[m.group] || []).push(m); });
      Object.keys(groups).forEach(function (g) {
        const ok = groups[g].length >= 3 && groups[g].every(function (m) { const c = d.courses[m.key]; const ms = mastery(c, d); return ms.lvl === 'ok' || ms.lvl === 'acq'; });
        if (ok) badge('pj-pole-' + encodeURIComponent(g));
      });
    }
  }

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

  /* « Vu N fois au total, la dernière fois le L » → { start, passes } : la 1re lecture est remontée de l'écart du dernier J fait. */
  function fromSeen(id, times, lastDate) {
    const o = offs(id);
    const passes = Math.max(0, Math.min(o.length, Math.round(Number(times) || 1) - 1));
    const L = valid(lastDate) && lastDate <= today() ? lastDate : today();
    return { start: passes > 0 ? add(L, -o[Math.min(passes, o.length) - 1]) : L, passes: passes };
  }

  /* ---------- données ---------- */
  function blank() { return { v: 1, rhythm: 'allegee', rhythmSet: false, capacity: 12, updatedAt: 0, courses: {}, freq: {}, tours: null, daysDone: 0, template: normTemplate(null), tplStage: normTemplate(null, STAGE_TEMPLATE), stage: false, day: null, plans: {}, caughtAt: null }; }
  function load() {
    const raw = CARDIO.store && typeof CARDIO.store.get === 'function' ? CARDIO.store.get('planJ') : null;
    const d = blank();
    if (!raw || typeof raw !== 'object') return d;
    // Allégé par défaut tant que l'utilisateur n'a pas choisi lui-même un rythme
    if (raw.rhythmSet && RHYTHMS[raw.rhythm]) { d.rhythm = raw.rhythm; d.rhythmSet = true; }
    d.capacity = Math.max(2, Math.min(60, Math.round(Number(raw.capacity)) || 12));
    d.updatedAt = Number(raw.updatedAt) || 0;
    if (raw.freq && typeof raw.freq === 'object') Object.keys(raw.freq).forEach(function (k) { const v = Math.round(Number(raw.freq[k])); if (/^[ipc]:/.test(k) && v >= 1 && v <= 3) d.freq[k] = v; });
    d.tours = toursNorm(raw.tours);
    // ancien modèle (v51, sans durées) → nouveau modèle par défaut
    d.template = normTemplate(Array.isArray(raw.template) && raw.template.some(function (s) { return s && s.min; }) ? raw.template : null);
    // Programmes par date (aujourd'hui + jours préparés à l'avance) ; d.day = programme d'aujourd'hui
    d.plans = {};
    const t0 = today();
    if (raw.plans && typeof raw.plans === 'object') Object.keys(raw.plans).forEach(function (k) { const x = normDay(raw.plans[k]); if (x && x.date === k && k >= t0 && k <= add(t0, 13)) d.plans[k] = x; });
    { const x = normDay(raw.day); if (x && x.date >= t0 && !d.plans[x.date]) d.plans[x.date] = x; }
    d.day = d.plans[t0] || null;
    d.caughtAt = valid(raw.caughtAt) ? raw.caughtAt : null;
    d.daysDone = Math.max(0, Math.round(Number(raw.daysDone)) || 0);
    // Questions faites dans la journée, par item : {date, items: {num: {n, sum, applied}}}
    d.qacc = raw.qacc && typeof raw.qacc === 'object' && raw.qacc.date === t0 && raw.qacc.items && typeof raw.qacc.items === 'object' ? raw.qacc : { date: t0, items: {} };
    // Tour de révision du jour (même jour, ne fait pas avancer les J) : {date, done: {clé: 'ok' | 'flou'}}
    d.recap = { date: t0, done: {} };
    if (raw.recap && raw.recap.date === t0 && raw.recap.done && typeof raw.recap.done === 'object') Object.keys(raw.recap.done).forEach(function (k) { if (/^[ipc]:/.test(k) && (raw.recap.done[k] === 'ok' || raw.recap.done[k] === 'flou')) d.recap.done[k] = raw.recap.done[k]; });
    d.stage = !!raw.stage;
    d.tplStage = normTemplate(Array.isArray(raw.tplStage) ? raw.tplStage : null, STAGE_TEMPLATE);
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
      { const lv = Math.round(Number(c.level)); if (lv >= 1 && lv <= 4) o.level = lv; }
      if (c.qnote && valid(c.qnote.date) && isFinite(Number(c.qnote.pct))) o.qnote = { date: c.qnote.date, pct: Math.max(0, Math.min(100, Math.round(Number(c.qnote.pct)))), n: Math.max(0, Math.round(Number(c.qnote.n)) || 0) };
      if (o.state === 'active' && !o.due) o.due = t;
      if (o.state === 'active') o.step = Math.min(o.step, last(d.rhythm));
      if (k.charAt(0) === 'c' && !o.title) return;
      d.courses[k] = o;
    });
    return d;
  }
  function save(d) {
    d.updatedAt = Date.now();
    if (d.plans && d.day) d.plans[d.day.date] = d.day;
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
      out.push({ key: 'i:' + it.num, weight: Number(it.tierCounts && it.tierCounts['1']) || 0, group: SPE[it.spe || 'cardio'] || 'Autre', title: 'Item ' + lab + ' · ' + (it.short || it.title || ''), href: '#/item/' + encodeURIComponent(it.num), train: '#/review?mode=item&item=' + encodeURIComponent(it.num) + '&size=inf&all=1&from=' + encodeURIComponent('#/planj') + '&autostart=1' });
    });
    (Array.isArray(r.parasito) ? r.parasito : []).forEach(function (p) {
      if (!p || !p.id) return;
      out.push({ key: 'p:' + p.id, weight: 0, group: 'Parasito-myco', title: p.title || p.id, href: '#/parasito/' + encodeURIComponent(p.id), train: '#/parasito/' + encodeURIComponent(p.id) + '/cartes' });
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
    const base = c.level ? LEVELS[c.level].v : null;
    if (!hs.length && c.qnote) {
      const q = c.qnote.pct / 100, v = base == null ? q : (q + base) / 2;
      return v < 0.4 ? { lvl: 'bad', label: 'Fragile (questions ' + c.qnote.pct + ' %)', score: v } : v < 0.7 ? { lvl: 'mid', label: 'En cours (questions ' + c.qnote.pct + ' %)', score: v } : { lvl: 'ok', label: 'Solide (questions ' + c.qnote.pct + ' %)', score: v };
    }
    if (!hs.length) {
      if (base == null) return { lvl: 'new', label: 'Vu, pas encore revu', score: 0.3 };
      return base < 0.4 ? { lvl: 'bad', label: 'Fragile (mon classement)', score: base } : base < 0.7 ? { lvl: 'mid', label: 'En cours (mon classement)', score: base } : { lvl: 'ok', label: 'Solide (mon classement)', score: base };
    }
    let s = 0, w = 0;
    hs.forEach(function (x, i) {
      const wt = i + 1;
      let v = GRADES[x.grade].v;
      if (x.note != null) v = (v + x.note / 100) / 2;
      s += v * wt; w += wt;
    });
    let recent = base == null ? s / w : (s / w) * 0.7 + base * 0.3;
    if (c.qnote && diff(c.qnote.date, today()) <= 30) recent = recent * 0.5 + (c.qnote.pct / 100) * 0.5;   // note aux questions
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

  /* ---------- fréquence aux examens et priorité ---------- */
  /* Aucune statistique officielle fiable des items « les plus tombés » n'est dans l'app : c'est TOI qui règles la
   * fréquence (selon tes annales, tes profs) ; à défaut, estimation d'après le volume de l'essentiel (niveau 1) de l'item. */
  function weightTiers(cat) {
    const ws = cat.map(function (m) { return m.weight || 0; }).filter(function (w) { return w > 0; }).sort(function (a, b) { return a - b; });
    return { lo: ws[Math.floor(ws.length / 3)] || 0, hi: ws[Math.floor((ws.length * 2) / 3)] || 0 };
  }
  /* Pertinence EDN + pratique (estimation, pas une statistique officielle) : 3 = incontournable (urgence vitale, très fréquent
   * en pratique, transversal), 2 = important, 1 = plus rare / plus spécialisé. Remplacée par ton propre réglage « Aux examens ». */
  const REL = {
    'i:339': 3, 'i:224': 3, 'i:234': 3, 'i:226': 3, 'i:232': 3, 'i:230': 3, 'i:331': 3, 'i:330': 3,
    'i:222': 2, 'i:223': 2, 'i:231': 2, 'i:203': 2, 'i:342': 2, 'i:225': 2, 'i:233': 2, 'i:152': 2, 'i:236': 2, 'i:237': 2, 'i:235': 2,
    'i:221': 1, 'i:153': 1, 'i:238': 1,
    'i:d350': 3, 'i:d115': 3, 'i:d168': 3, 'i:d187': 3, 'i:d302': 3, 'i:d162': 3, 'i:d215': 3,
    'i:d111': 2, 'i:d117': 2, 'i:d155': 2, 'i:d171': 2, 'i:d228': 2, 'i:d330': 2, 'i:d114': 2, 'i:d116': 2, 'i:d112': 2, 'i:d169': 2,
    'i:d113': 1, 'i:d194': 1, 'i:d201': 1, 'i:d211': 1, 'i:d239': 1, 'i:d319': 1,
    'i:p154': 3, 'i:p188': 3, 'i:p209': 3, 'i:p226': 3, 'i:p338': 3, 'i:p359': 3, 'i:p75': 3,
    'i:p159': 2, 'i:p203': 2, 'i:p206': 2, 'i:p309': 2, 'i:p360': 2, 'i:p230': 2, 'i:p186': 2, 'i:p204': 2, 'i:p205': 2, 'i:p359bis': 2,
    'i:p110': 1, 'i:p207': 1, 'i:p208': 1, 'i:p210': 1, 'i:p211': 1,
    'p:paludisme': 3, 'p:toxoplasmose': 3, 'p:candidoses': 3, 'p:gale-ou-scabiose': 3, 'p:dermatophytoses': 3, 'p:pneumocystose': 3,
    'p:generalites': 2, 'p:introduction-a-la-mycologie': 2, 'p:amoebose': 2, 'p:giardiose': 2, 'p:oxyurose': 2, 'p:taeniasis-et-cysticercose': 2,
    'p:aspergilloses-et-autres-champignons-fila': 2, 'p:cryptococcose': 2, 'p:anguillulose-ou-strongyloidose': 2, 'p:schistosomoses-ou-bilharzioses': 2,
    'p:leishmanioses': 2, 'p:poux-puces-punaises-et-tiques': 2, 'p:ascaridiose': 2, 'p:infections-a-malassezia': 2
  };
  function freqOf(d, m, tiers) {
    if (d.freq[m.key]) return { v: d.freq[m.key], est: false };
    if (REL[m.key]) return { v: REL[m.key], est: true };
    if (m.key.charAt(0) === 'p') return { v: 1, est: true };
    if (!m.weight || !tiers) return { v: 2, est: true };
    return { v: m.weight >= tiers.hi ? 3 : m.weight >= tiers.lo ? 2 : 1, est: true };
  }
  /* Score de priorité (plus haut = à travailler d'abord) : faible maîtrise, tombe souvent, retard, jamais vu. */
  function priority(d, m, tiers) {
    const c = d.courses[m.key]; const t = today();
    const ms = mastery(c, d);
    const f = freqOf(d, m, tiers);
    let s = (1 - ms.score) * 50 + (f.v - 1) * 18;
    const why = [];
    if (!c) { s += 8; why.push('jamais placé'); }
    else if (c.state === 'acquis') { s -= 30; }
    else if (c.state === 'active' && c.due && c.due < t) { s += Math.min(20, diff(c.due, t) * 2); why.push('en retard'); }
    if (ms.lvl === 'bad') why.push('fragile');
    if (f.v === 3) why.push(f.est ? 'incontournable EDN' : 'tombe souvent');
    return { score: Math.round(s), why: why, mastery: ms, freq: f };
  }

  /* ---------- programme du jour ---------- */
  /* Modèle de journée : une suite de créneaux {g: groupe/pôle, m: 'new' (découvrir un cours jamais placé) | 'rev' (revoir un
   * cours déjà placé : J dû d'abord, sinon le plus prioritaire)}. Le programme est composé une fois par jour puis figé. */
  const DEFAULT_TEMPLATE = [
    { g: 'Dermato', m: 'auto', min: 45 }, { g: 'Dermato', m: 'auto', min: 45 },
    { g: 'Pneumo', m: 'auto', min: 40 }, { g: 'Cardio', m: 'auto', min: 40 }, { g: 'Pneumo', m: 'auto', min: 40 }, { g: 'Cardio', m: 'auto', min: 40 },
    { g: 'Parasito-myco', m: 'auto', min: 20 }, { g: 'Parasito-myco', m: 'auto', min: 20 },
    { g: 'Bactério / viro (hors app)', m: 'memo', min: 20 }
  ];
  // Mode stage : journée allégée d'environ 3 h (un seul créneau par pôle, révisions d'abord)
  const STAGE_TEMPLATE = [
    { g: 'Dermato', m: 'auto', min: 40 }, { g: 'Pneumo', m: 'auto', min: 35 }, { g: 'Cardio', m: 'auto', min: 35 },
    { g: 'Pneumo', m: 'rev', min: 30 }, { g: 'Parasito-myco', m: 'auto', min: 20 },
    { g: 'Bactério / viro (hors app)', m: 'memo', min: 15 }
  ];
  const MODES = { auto: 'Auto', new: 'Découvrir', rev: 'Revoir', memo: 'Rappel (hors app)' };
  function mode(x) { return x === 'new' || x === 'rev' || x === 'memo' ? x : 'auto'; }
  function mins(x, m) { const n = Math.round(Number(x)); return n >= 5 && n <= 240 ? n : (m === 'new' ? 45 : m === 'rev' ? 30 : m === 'memo' ? 20 : 40); }
  function normTemplate(x, def) {
    if (!Array.isArray(x)) return (def || DEFAULT_TEMPLATE).map(function (s) { return { g: s.g, m: s.m, min: s.min }; });
    const out = x.filter(function (s) { return s && typeof s.g === 'string' && s.g; }).slice(0, 20)
      .map(function (s) { const m = mode(s.m); return { g: s.g.slice(0, 40), m: m, min: mins(s.min, m) }; });
    return out;
  }
  function normDay(x) {
    if (!x || typeof x !== 'object' || !valid(x.date) || !Array.isArray(x.slots)) return null;
    return { date: x.date, round: Math.max(1, Math.min(9, Math.round(Number(x.round)) || 1)), bonus: !!x.bonus, stage: !!x.stage, heavy: !!x.heavy, dueN: Math.max(0, Math.round(Number(x.dueN)) || 0), caught: Math.max(0, Math.round(Number(x.caught)) || 0), slots: x.slots.filter(function (s) { return s && typeof s.g === 'string'; }).slice(0, 20).map(function (s) {
      const m = mode(s.m);
      return { g: s.g, m: m, min: mins(s.min, m), why: typeof s.why === 'string' ? s.why.slice(0, 60) : '', key: typeof s.key === 'string' ? s.key : null, done: !!s.done, grade: GRADES[s.grade] ? s.grade : null };
    }) };
  }
  function buildDay(d, cat, date) {
    const t = date || today(); const tiers = weightTiers(cat);
    const metas = cat.concat(list(d).filter(function (c) { return c.key.charAt(0) === 'c'; }).map(function (c) { return { key: c.key, group: c.group || 'Mes cours', title: c.title, weight: 0 }; }));
    const used = {};
    const pr = function (m) { return priority(d, m, tiers).score; };
    function pickNew(g) {
      const c = metas.filter(function (m) { return m.group === g && !d.courses[m.key] && !used[m.key]; }).sort(function (a, b) { return pr(b) - pr(a); });
      return c[0] ? { m: c[0], why: 'jamais vu' + (freqOf(d, c[0], tiers).v === 3 ? ' · incontournable' : '') } : null;
    }
    function pickDue(g) {
      const due = metas.filter(function (m) { const c = d.courses[m.key]; return m.group === g && c && c.state === 'active' && c.due && c.due <= t && !used[m.key]; })
        .sort(function (a, b) { const ca = d.courses[a.key], cb = d.courses[b.key]; return pr(b) - pr(a) || (ca.due < cb.due ? -1 : ca.due > cb.due ? 1 : 0) || ca.step - cb.step; });
      if (!due.length) return null;
      const c = d.courses[due[0].key];
      return { m: due[0], why: jLabel(d.rhythm, c.step) + (c.due < today() ? ' en retard' : c.due === today() ? ' prévu aujourd’hui' : ' prévu ce jour-là') };
    }
    function pickWeak(g) {
      const rest = metas.filter(function (m) { const c = d.courses[m.key]; return m.group === g && c && c.state === 'active' && !used[m.key]; }).sort(function (a, b) { return pr(b) - pr(a); });
      return rest[0] ? { m: rest[0], why: 'le plus fragile du pôle' } : null;
    }
    const dueN = list(d).filter(function (c) { return c.state === 'active' && c.due && c.due <= t; }).length;
    const tpl = d.stage ? d.tplStage : d.template;
    const autoN = tpl.filter(function (s) { return s.m !== 'memo'; }).length;
    const heavy = !!d.stage || dueN > Math.max(autoN, Math.round(d.capacity * 0.8));
    const slots = tpl.map(function (s) {
      if (s.m === 'memo') return { g: s.g, m: 'memo', min: s.min, why: '', key: null, done: false, grade: null };
      // Charge trop lourde (trop de J dus) : les créneaux « Auto » revoient au lieu de découvrir
      const order = s.m === 'new' ? [pickNew, pickDue, pickWeak] : s.m === 'rev' ? [pickDue, pickWeak, pickNew] : heavy ? [pickDue, pickWeak, pickNew] : [pickNew, pickDue, pickWeak];
      let r = null;
      for (let i = 0; i < order.length && !r; i++) r = order[i](s.g);
      if (r) used[r.m.key] = 1;
      return { g: s.g, m: s.m, min: s.min, why: r ? r.why : '', key: r ? r.m.key : null, done: false, grade: null };
    });
    return { date: t, slots: slots, heavy: heavy, dueN: dueN, stage: !!d.stage };
  }

  /* ---------- méthode des tours ---------- */
  /* Tout le programme choisi, cours après cours, en N jours (tour 1) ; chaque tour suivant va plus vite
   * (jours × 0,6, minimum 3). L'ordre d'un tour est figé à son début : par priorité ou ordre du programme. */
  function toursNorm(x) {
    if (!x || typeof x !== 'object' || !Array.isArray(x.order) || !x.order.length) return null;
    return {
      groups: Array.isArray(x.groups) ? x.groups.filter(function (g) { return typeof g === 'string'; }) : [],
      mode: x.mode === 'programme' ? 'programme' : 'priorite',
      order: x.order.filter(function (k) { return typeof k === 'string' && /^[ipc]:/.test(k); }),
      days: Math.max(TOURS_MIN, Math.min(TOURS_MAX, Math.round(Number(x.days)) || 21)),
      firstDays: Math.max(TOURS_MIN, Math.min(TOURS_MAX, Math.round(Number(x.firstDays || x.days)) || 21)),
      tour: Math.max(1, Math.round(Number(x.tour)) || 1),
      pos: Math.max(0, Math.round(Number(x.pos)) || 0),
      startedAt: valid(x.startedAt) ? x.startedAt : today(),
      dayDate: valid(x.dayDate) ? x.dayDate : null,
      dayPos: Math.max(0, Math.round(Number(x.dayPos)) || 0),
      rolledAt: valid(x.rolledAt) ? x.rolledAt : null,
      lastDoneAt: valid(x.lastDoneAt) ? x.lastDoneAt : null
    };
  }
  function tourOrder(d, groups, mode, cat) {
    const tiers = weightTiers(cat);
    const custom = list(d).filter(function (c) { return c.key.charAt(0) === 'c'; }).map(function (c) { return { key: c.key, group: c.group || 'Mes cours', title: c.title, weight: 0 }; });
    let ms = cat.concat(custom).filter(function (m) { return groups.indexOf(m.group) >= 0; });
    if (mode === 'priorite') ms = ms.map(function (m) { return { m: m, p: priority(d, m, tiers).score }; }).sort(function (a, b) { return b.p - a.p; }).map(function (x) { return x.m; });
    return ms.map(function (m) { return m.key; });
  }
  function tourQuota(T) { return Math.max(1, Math.ceil(T.order.length / Math.max(1, T.days))); }
  function tourToday(T) {
    const t = today(); const q = tourQuota(T);
    if (T.rolledAt === t && T.pos === 0) return { items: [], finished: true, quota: q };
    const sp = T.dayDate === t ? Math.min(T.dayPos, T.pos) : T.pos;
    const items = [];
    for (let i = sp; i < Math.min(T.order.length, sp + q); i++) items.push({ index: i, key: T.order[i], done: i < T.pos });
    return { items: items, finished: false, quota: q };
  }
  function tourDone(d, cat) {
    const T = d.tours; const t = today();
    if (!T) return null;
    if (T.dayDate !== t) { T.dayDate = t; T.dayPos = T.pos; }
    T.pos += 1; T.lastDoneAt = t;
    if (T.pos >= T.order.length) {
      const n = T.tour;
      T.tour += 1; T.pos = 0; T.dayPos = 0;
      T.days = Math.max(TOURS_MIN, Math.round(T.days * 0.6));
      T.startedAt = add(t, 1); T.rolledAt = t;
      T.order = tourOrder(d, T.groups, T.mode, cat).filter(function (k) { return !d.courses[k] || d.courses[k].state !== 'acquis' || T.mode === 'programme'; });
      if (!T.order.length) T.order = tourOrder(d, T.groups, T.mode, cat);
      return 'Tour ' + n + ' terminé ! Le tour ' + T.tour + ' commence demain, en ' + plural(T.days, 'jour', 'jours') + '.';
    }
    return null;
  }
  function tourProgress(T) {
    const total = T.order.length, q = tourQuota(T);
    const dayIndex = Math.max(0, diff(T.startedAt, today()));
    const expected = Math.min(total, (dayIndex + 1) * q);
    return { total: total, pos: Math.min(T.pos, total), pct: total ? Math.round(Math.min(T.pos, total) / total * 100) : 0, quota: q, day: Math.min(T.days, dayIndex + 1), behind: Math.max(0, expected - q - T.pos), next: Math.max(TOURS_MIN, Math.round(T.days * 0.6)) };
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
      '.pj-xpline{display:flex;gap:6px;flex-wrap:wrap}',
      '.pj-sts{display:flex;gap:5px;flex-wrap:wrap;margin-top:5px}',
      '.pj-frag{display:flex;flex-direction:column;gap:6px;margin-top:8px;padding:8px;border-radius:14px;background:color-mix(in srgb,var(--bad) 7%,transparent)}',
      '.pj-frag__row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.pj-frag__t{flex:1;min-width:120px;font-size:13px;font-weight:600;color:var(--ink)}',
      '.pj-st{font-size:12px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap}',
      '.pj-xpchip{font-weight:800;font-size:13px;padding:5px 11px;border-radius:999px;color:#fff;background:linear-gradient(135deg,var(--accent),var(--accent-2,var(--accent)))}',
      '.pj-xpchip--lvl{background:var(--surface-2);color:var(--ink)}',
      '.pj-xpchip--fire{background:linear-gradient(135deg,#F97316,#FBBF24)}',
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
    const state = { tab: ['cours', 'prio', 'tours', 'plan', 'regl'].indexOf(q.tab) >= 0 ? q.tab : 'today', open: q.open || null, filter: '', sel: {}, bulk: false, classify: false, day: null, tg: null };
    function rerender() {
      const d = load();
      const cat = catalog();
      if (list(d).length) ensureDay(d, cat);
      root.replaceChildren.apply(root, [tabs(), kpis(d)].concat(state.tab === 'today' ? viewToday(d, cat)
        : state.tab === 'cours' ? viewCourses(d, cat) : state.tab === 'prio' ? viewPrio(d, cat) : state.tab === 'tours' ? viewTours(d, cat) : state.tab === 'plan' ? viewPlan(d, cat) : viewSettings(d)).filter(Boolean));
    }
    let rrTimer = null;
    function rerenderSoon() { clearTimeout(rrTimer); rrTimer = setTimeout(function () { if (root.isConnected) rerender(); }, 120); }
    function go(tab) { state.tab = tab; state.open = null; rerender(); window.scrollTo(0, 0); }
    function tabs() {
      const T = [['today', 'Aujourd’hui'], ['cours', 'Mes cours'], ['prio', 'Priorités'], ['tours', 'Tours'], ['plan', 'Planning'], ['regl', 'Réglages']];
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
    function miniBlock() {
      const ret = encodeURIComponent('#/planj');
      const S = [
        ['Mix du jour · 10 cartes', '#/review?mode=smart&size=10&from=' + ret + '&autostart=1', 'shuffle', 'les cartes dues, toutes formes'],
        ['Flashcards · 10', '#/review?mode=smart&kind=flash&size=10&from=' + ret + '&autostart=1', 'flash', '≈ 3 min'],
        ['QCM · 10', '#/review?mode=smart&kind=qcm&size=10&from=' + ret + '&autostart=1', 'qcm', '≈ 5 min'],
        ['QROC · 10', '#/review?mode=smart&kind=qroc&size=10&from=' + ret + '&autostart=1', 'edit', '≈ 5 min'],
        ['Mes erreurs', '#/errors', 'refresh', 'refaire ce que tu as raté'],
        ['Parasito · cartes', '#/parasito/toutes/cartes', 'list', 'répétition espacée']
      ];
      return h('div', { class: 'card stack' },
        h('p', { class: 'pj-h' }, '2 · Mini-sessions du jour (quelques minutes)'),
        h('p', { class: 'secondary muted' }, 'À faire en plus des cours, dans les petits moments. Après chaque question : « Voir le point de cours », puis « Revenir à la question » pour passer à la suite. Dès 20 questions sur un même item dans la journée, ta note (📝) compte comme une révision du planning.'),
        h('div', { class: 'pj-grp' }, S.map(function (x) {
          return h('a', { class: 'pj-row', href: x[1], style: 'text-decoration:none;color:inherit' }, icon(x[2]),
            h('div', { class: 'pj-row__main' }, h('div', { class: 'pj-row__t' }, x[0]), h('div', { class: 'pj-row__s' }, x[3])), icon('play'));
        })));
    }
    /* « Changer » un créneau : liste de TOUS les cours du pôle (ou de tous les pôles), à choisir soi-même.
     * Ordre : J dus, à découvrir (par priorité), en cours (par priorité), acquis ; recherche par mot. */
    function coursePicker(d, cat, day, s, date) {
      const tiers = weightTiers(cat);
      const custom = list(d).filter(function (c) { return c.key.charAt(0) === 'c'; }).map(function (c) { return { key: c.key, group: c.group || 'Mes cours', title: c.title, weight: 0 }; });
      const taken = {}; day.slots.forEach(function (x) { if (x !== s && x.key) taken[x.key] = 1; });
      const all = !!state.pick.all;
      const ms = cat.concat(custom).filter(function (m) { return (all || m.group === s.g) && !taken[m.key]; });
      const rows = ms.map(function (m) {
        const c = d.courses[m.key];
        const cls = !c ? 1 : c.state === 'active' && c.due && c.due <= date ? 0 : c.state === 'active' ? 2 : 3;
        const why = cls === 0 ? jLabel(d.rhythm, c.step) + (c.due < today() ? ' en retard' : ' dû') : cls === 1 ? 'à découvrir' : cls === 2 ? 'prochain ' + jLabel(d.rhythm, c.step) + ' le ' + nice(c.due) : c.state === 'paused' ? 'en pause' : 'acquis';
        return { m: m, c: c, cls: cls, why: why, p: priority(d, m, tiers).score };
      }).sort(function (a, b) { return a.cls - b.cls || b.p - a.p; });
      const listEl = h('div', { style: 'display:grid;gap:4px;max-height:360px;overflow:auto;margin-top:6px' });
      function fill(qs) {
        const n = U().normalize ? U().normalize(qs || '') : String(qs || '').toLowerCase();
        const shown = rows.filter(function (r) { const tt = U().normalize ? U().normalize(r.m.title + ' ' + r.m.key) : (r.m.title + ' ' + r.m.key).toLowerCase(); return !n || tt.indexOf(n) >= 0; });
        listEl.replaceChildren.apply(listEl, shown.length ? shown.map(function (r) {
          const cur = r.m.key === s.key;
          return h('button', { type: 'button', class: 'pj-row', style: 'width:100%;text-align:left;cursor:pointer;padding:8px 10px;border-radius:12px;border:1px solid ' + (cur ? 'var(--accent)' : 'var(--line)') + ';background:var(--surface)',
            on: { click: function () {
              if (!cur) { s.key = r.m.key; s.why = 'choisi par toi'; save(d); toast(r.m.title + ' : placé dans ce créneau', 'ok'); }
              state.pick = null; rerender();
            } } },
            dot(mastery(r.c, d)),
            h('div', { class: 'pj-row__main' }, h('div', { class: 'pj-row__t' }, r.m.title + (cur ? ' (actuel)' : '')),
              h('div', { class: 'pj-row__s' }, (all ? r.m.group + ' · ' : '') + r.why)));
        }) : [h('p', { class: 'secondary muted', style: 'margin:4px 0' }, 'Aucun cours ne correspond.')]);
      }
      const search = h('input', { type: 'search', class: 'input', placeholder: 'Chercher un cours (nom ou numéro)…', style: 'width:100%', on: { input: function (e) { fill(e.target.value); } } });
      // Auto : l'app prend le meilleur cours suivant du classement (jamais vu > J dû > en cours, le plus pertinent d'abord),
      // en sautant ceux déjà proposés pour ce créneau : chaque appui propose un cours différent.
      const skipKey = date + ':' + state.pick.i;
      state.skip = state.skip || {};
      const autoBtn = btn('Auto : l’app choisit', 'btn--primary btn--sm', function () {
        const sk = state.skip[skipKey] || (state.skip[skipKey] = []);
        if (s.key && sk.indexOf(s.key) < 0) sk.push(s.key);
        const ord = day.heavy || s.m === 'rev' ? { 0: 0, 2: 1, 1: 2 } : { 1: 0, 0: 1, 2: 2 };   // même logique que les créneaux Auto
        const pool = rows.filter(function (r) { return r.cls < 3 && r.m.group === s.g; }).sort(function (a, b) { return ord[a.cls] - ord[b.cls] || b.p - a.p; });
        let next = pool.find(function (r) { return sk.indexOf(r.m.key) < 0; });
        if (!next) { state.skip[skipKey] = s.key ? [s.key] : []; next = pool.find(function (r) { return r.m.key !== s.key; }); }
        if (!next) { toast('Pas d’autre cours à proposer dans ce pôle', 'warn'); return; }
        s.key = next.m.key; s.why = next.why + ' · auto'; save(d);
        toast(next.m.title + ' (' + next.why + ')', 'ok'); rerender();
      }, 'shuffle');
      fill('');
      return h('div', { class: 'card', style: 'margin-top:8px;padding:10px;display:grid;gap:6px' },
        h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center' },
          h('b', { style: 'flex:1;min-width:140px' }, 'Choisis le cours de ce créneau'),
          autoBtn,
          btn('Ce pôle', !all ? 'btn--primary btn--sm' : 'btn--outline btn--sm', function () { state.pick.all = false; rerender(); }),
          btn('Tous les pôles', all ? 'btn--primary btn--sm' : 'btn--outline btn--sm', function () { state.pick.all = true; rerender(); })),
        search, listEl);
    }
    function viewToday(d, cat) {
      const t = today(); const out = [];
      const cs = list(d);
      const mini = miniBlock();
      if (!cs.length) {
        out.push(h('div', { class: 'card stack' },
          h('p', { class: 'pj-h' }, 'Place tes cours pour démarrer'),
          h('p', { class: 'secondary muted' }, 'Dans « Mes cours », indique pour chaque item (et chaque fiche parasito) si tu l’as déjà vu, quand, et combien de fois. L’app calcule ensuite toute seule quand le revoir (rythme allégé : J1, J7, J21, J45, J90).'),
          btn('Placer mes cours', 'btn--primary', function () { go('cours'); }, 'plus')));
        out.push(dateBar());
        out.push(dayBlock(d, cat));
        out.push(mini);
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
      let due = cs.filter(function (c) { return c.state === 'active' && c.due && c.due <= t; })
        .sort(function (a, b) { const tiers = weightTiers(cat); return priority(d, meta(b, cat), tiers).score - priority(d, meta(a, cat), tiers).score || (a.due < b.due ? -1 : 1); });
      out.push(dateBar());
      out.push(dayBlock(d, cat));
      if (!state.date || state.date <= t) { const rc = recapBlock(d, cat); if (rc) out.push(rc); }
      const inDay = d.day ? d.day.slots.map(function (s) { return s.key; }) : [];
      due = due.filter(function (c) { return inDay.indexOf(c.key) < 0; });
      out.push(h('p', { class: 'pj-h' }, due.length ? 'Autres révisions J dues aujourd’hui (' + due.length + ')' : 'Pas d’autre révision J aujourd’hui'));
      if (d.tours) {
        const td = tourToday(d.tours);
        const left = td.items.filter(function (x) { return !x.done; }).length;
        out.push(h('a', { class: 'pj-row', href: '#/planj?tab=tours', style: 'text-decoration:none;color:inherit', on: { click: function (e) { e.preventDefault(); go('tours'); } } }, icon('layers'),
          h('div', { class: 'pj-row__main' }, h('div', { class: 'pj-row__t' }, 'Tour ' + d.tours.tour + ' : ' + (td.finished ? 'terminé aujourd’hui' : left ? plural(left, 'cours à passer', 'cours à passer') + ' aujourd’hui' : 'quota du jour fait')), h('div', { class: 'pj-row__s' }, 'Ouvre l’onglet Tours')), icon('play')));
      }
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
          return h('div', { class: 'pj-row', style: 'opacity:.75' }, dot(mastery(c, d)),
            h('div', { class: 'pj-row__main' }, h('div', { class: 'pj-row__t' }, m.title),
              h('div', { class: 'pj-row__s' }, jLabel(d.rhythm, x.step) + ' · ' + GRADES[x.grade].label + (x.note != null ? ' · ' + x.note + ' %' : '') + (c.state === 'acquis' ? ' · acquis' : c.due ? ' · prochain ' + nice(c.due) : ''))),
            btn('Annuler', null, function () { undo(d, c); save(d); rerender(); }));
        })));
      }
      out.push(mini);
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
      function grade(g) { const msg = review(d, c.key, g, note.value); save(d); xp(XP[g], 'Révision J'); checkBadges(d, cat); toast(msg || 'Enregistré', g === 'difficile' ? 'warn' : 'ok'); rerender(); }
      return h('div', { class: 'pj-row', style: 'align-items:flex-start' }, dot(ms),
        h('div', { class: 'pj-row__main' },
          h('div', { class: 'pj-row__t' }, m.title),
          h('div', { class: 'pj-row__s' }, h('span', { class: 'pj-tag' }, jLabel(d.rhythm, c.step)), ' ', lateN ? h('span', { class: 'pj-tag pj-tag--late' }, 'retard ' + lateN + ' j') : null, ' ', m.group),
          statusEl(c, d, { noLevel: true }),
          c.key.charAt(0) === 'i' ? fragileEl(c.key.slice(2), rerenderSoon, 2) : c.key.charAt(0) === 'p' ? fragileEl(c.key, null, 2) : null,
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
        btn(state.classify ? 'Terminer le classement' : 'Classer par maîtrise', state.classify ? 'btn--primary btn--sm' : null, function () { state.classify = !state.classify; state.bulk = false; rerender(); }, 'layers'),
        btn('Ajouter un cours perso', null, function () { state.open = 'new'; rerender(); }, 'plus')));
      if (state.classify) out.push(h('p', { class: 'secondary muted' }, 'Pour chaque cours, touche ton niveau : un cours pas encore placé est placé tout seul (plus il est maîtrisé, plus sa prochaine révision est lointaine). Ça sert aussi à calculer tes priorités.'));
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
        if (state.classify) out.push(h('div', { class: 'pj-row', style: 'flex-wrap:wrap;background:var(--surface-2)' }, h('div', { class: 'pj-row__main' }, h('div', { class: 'pj-row__t' }, 'Tout le pôle ' + g), h('div', { class: 'pj-row__s' }, 'Classe d’un coup les ' + items.length + ' cours affichés, puis ajuste un par un.')),
          h('div', { style: 'flex-basis:100%' }, levelChips(0, function (lv) {
            if (!lv) return;
            if (!window.confirm('Classer les ' + items.length + ' cours de « ' + g + ' » en « ' + LEVELS[lv].label + ' » ? (les cours pas encore placés seront placés)')) return;
            items.forEach(function (m) { let c = d.courses[m.key]; if (!c) c = place(d, m.key, { start: today(), passes: lv - 1 }); c.level = lv; });
            save(d); checkBadges(d, catalog()); toast(items.length + ' cours classés « ' + LEVELS[lv].label + ' »', 'ok'); rerender();
          }))));
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
      const subQ = sub + qtag(c);
      const main = h('div', { class: 'pj-row__main', style: 'cursor:pointer', on: { click: function () { if (state.bulk) { toggle(); return; } state.open = state.open === m.key ? null : m.key; rerender(); } } },
        h('div', { class: 'pj-row__t' }, m.title), h('div', { class: 'pj-row__s' }, !c ? 'Pas encore placé' : c.state === 'acquis' ? 'Acquis · ' + plural(c.history.length, 'révision', 'révisions') : c.state === 'pause' ? 'En pause' : 'Prochain ' + jLabel(d.rhythm, c.step) + ' · ' + nice(c.due)),
        c ? statusEl(c, d) : null);
      function toggle() { state.sel[m.key] = !state.sel[m.key]; rerender(); }
      if (state.classify) {
        return h('div', { class: 'pj-row', style: 'flex-wrap:wrap' }, dot(ms), h('div', { class: 'pj-row__main' }, h('div', { class: 'pj-row__t' }, m.title), h('div', { class: 'pj-row__s' }, sub)),
          h('div', { style: 'flex-basis:100%' }, levelChips(c && c.level, function (lv) { setLevel(d, m, lv); rerender(); })));
      }
      return h('div', { class: 'pj-row' },
        state.bulk ? h('input', { type: 'checkbox', class: 'pj-check', checked: !!state.sel[m.key], on: { change: toggle }, 'aria-label': 'Sélectionner ' + m.title }) : dot(ms),
        main,
        !state.bulk ? btn(c ? 'Vu combien ?' : 'Déjà vu…', 'btn--outline btn--sm', function () { state.open = state.open === m.key ? null : m.key; rerender(); }, c ? 'edit' : 'plus') : null);
    }
    function levelChips(val, onPick) {
      return h('div', { class: 'pj-chips' }, [1, 2, 3, 4].map(function (lv) {
        return h('button', { type: 'button', class: val === lv ? 'is-on' : '', on: { click: function () { onPick(val === lv ? 0 : lv); } } }, LEVELS[lv].label);
      }));
    }
    function setLevel(d, m, lv) {
      let c = d.courses[m.key];
      if (!lv) { if (c) delete c.level; save(d); return; }
      if (!c) { c = place(d, m.key, { start: today(), passes: lv - 1, title: m.key.charAt(0) === 'c' ? m.title : undefined }); }
      c.level = lv;
      save(d); toast(m.title + ' : ' + LEVELS[lv].label.toLowerCase(), 'ok');
    }
    function freqChips(d, m, cat) {
      const f = freqOf(d, m, weightTiers(cat));
      return h('div', { class: 'pj-chips' }, [1, 2, 3].map(function (v) {
        return h('button', { type: 'button', class: f.v === v ? 'is-on' : '', on: { click: function () { if (d.freq[m.key] === v) delete d.freq[m.key]; else d.freq[m.key] = v; save(d); rerender(); } } }, FREQ[v] + (f.v === v && f.est ? ' (estimé)' : ''));
      }));
    }
    function timesChips(val, onPick) {
      const opts = [[1, '1× (juste lu)'], [2, '2×'], [3, '3×'], [4, '4×'], [5, '5×'], [6, '6× et +']];
      return h('div', { class: 'pj-chips' }, opts.map(function (o) {
        return h('button', { type: 'button', class: val === o[0] ? 'is-on' : '', on: { click: function () { onPick(o[0]); } } }, o[1]);
      }));
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
      const o0 = offs(d.rhythm);
      const loc = { times: c ? Math.min(6, (c.state === 'acquis' ? o0.length : c.step) + 1) : 1 };
      const title = h('input', { type: 'text', maxlength: '100', placeholder: 'Ex. Item 152 · Endocardite (cours fac)' });
      const group = h('input', { type: 'text', maxlength: '40', placeholder: 'Ex. Néphro, Gynéco…', value: 'Mes cours' });
      const lastSeen = c && c.history && c.history.length ? c.history[c.history.length - 1].date : c ? (c.step > 0 ? add(c.start, o0[Math.min(c.step, o0.length) - 1]) : c.start) : today();
      const start = h('input', { type: 'date', value: lastSeen > today() ? today() : lastSeen, max: today() });
      const chips = h('div');
      function drawChips() { chips.replaceChildren(timesChips(loc.times, function (n) { loc.times = n; drawChips(); preview(); })); }
      const prev = h('p', { class: 'secondary muted' });
      function plan() { const f = fromSeen(d.rhythm, loc.times, start.value); return { f: f, p: initialPlan(d.rhythm, f.start, f.passes, today()) }; }
      function preview() {
        const x = plan();
        prev.textContent = x.p.acquis ? 'Vu assez de fois : il sera marqué acquis.' : 'Je recalcule : prochaine révision ' + jLabel(d.rhythm, x.p.step) + ', ' + nice(x.p.due).replace(/\.$/, '') + (x.p.due <= today() ? ' (à faire aujourd’hui)' : '') + '.';
      }
      start.addEventListener('change', preview);
      drawChips(); preview();
      const body = [h('p', { class: 'pj-h' }, isNew ? 'Nouveau cours perso' : m.title)];
      if (isNew) body.push(h('label', { class: 'pj-field' }, 'Nom du cours', title), h('label', { class: 'pj-field' }, 'Matière (groupe)', group));
      body.push(h('div', { class: 'pj-field' }, 'Tu l’as vu combien de fois en tout (1re lecture comprise) ?', chips),
        h('label', { class: 'pj-field' }, 'La dernière fois, c’était le', start), prev);
      if (m) {
        body.push(h('div', { class: 'pj-field' }, 'Ma maîtrise (mon propre classement)', levelChips(c && c.level, function (lv) { setLevel(d, m, lv); rerender(); })));
        body.push(h('div', { class: 'pj-field' }, 'Aux examens, ce cours…', freqChips(d, m, cat)));
      }
      const acts = [btn(c ? 'Replacer' : 'Placer', 'btn--primary btn--sm', function () {
        let k = m ? m.key : 'c:' + uid();
        if (isNew && !title.value.trim()) { toast('Donne un nom au cours', 'warn'); return; }
        const f = plan().f;
        const cc = place(d, k, { start: f.start, passes: f.passes, title: isNew ? title.value.trim() : undefined, group: isNew ? (group.value.trim() || 'Mes cours') : undefined });
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
      const loc = { times: 1 };
      const start = h('input', { type: 'date', value: today(), max: today() });
      const chips = h('div');
      function draw() { chips.replaceChildren(timesChips(loc.times, function (n) { loc.times = n; draw(); })); }
      draw();
      return h('div', { class: 'pj-sheet pj-bulk' },
        h('b', null, plural(keys.length, 'cours sélectionné', 'cours sélectionnés')),
        h('div', { class: 'pj-field' }, 'Vus combien de fois en tout (1re lecture comprise) ?', chips),
        h('label', { class: 'pj-field' }, 'La dernière fois, c’était le', start),
        h('div', { class: 'pj-row__acts' },
          btn('Placer la sélection', 'btn--primary btn--sm', function () {
            if (!keys.length) { toast('Coche d’abord des cours', 'warn'); return; }
            const f = fromSeen(d.rhythm, loc.times, start.value);
            keys.forEach(function (k) { place(d, k, { start: f.start, passes: f.passes }); });
            save(d); checkBadges(d, catalog()); state.sel = {}; state.bulk = false; toast(plural(keys.length, 'cours placé', 'cours placés'), 'ok'); rerender();
          }, 'check'),
          btn('Annuler', null, function () { state.sel = {}; state.bulk = false; rerender(); })));
    }

    /* --- Programme du jour (dans « Aujourd'hui ») --- */
    function todayXp() { try { const st = CARDIO.store; const dd = st.get('daily.' + st.today()); return dd && dd.xp ? dd.xp : 0; } catch (e) { return 0; } }
    function levelLabel() { try { const lv = CARDIO.store.level(); return 'Niv. ' + lv.n + ' · ' + Math.round(lv.progress * 100) + ' %'; } catch (e) { return ''; } }
    function ensureDay(d, cat, date) {
      const t = today(); const dt = date || t;
      let caught = 0;
      if (dt === t && d.caughtAt !== t) {
        // Premier passage du jour : si le retard dépasse la capacité, on l'étale automatiquement (les plus fragiles d'abord)
        const late = list(d).filter(function (c) { return c.state === 'active' && c.due && c.due < t; }).length;
        caught = late > d.capacity ? catchUp(d) : 0;
        d.caughtAt = t;
      }
      const cur = d.plans[dt];
      if (cur && !!cur.stage === !!d.stage) { if (caught) { cur.caught = caught; save(d); } return; }
      const plan = buildDay(d, cat, dt); plan.caught = caught;
      d.plans[dt] = plan; if (dt === t) d.day = plan;
      save(d);
    }
    /* Tour de révision du jour : les cours vus aujourd'hui (découverts ou revus) à repasser une 2e fois le soir.
     * Ne fait pas avancer les J (une relecture le même jour ne remplace pas l'espacement) ; « Encore flou » ramène le
     * prochain J à demain. Bouton pour une séance de questions mélangée sur tous ces cours. */
    function recapBlock(d, cat) {
      const t = today();
      if (!d.recap || d.recap.date !== t) d.recap = { date: t, done: {} };
      const seen = list(d).filter(function (c) { return c.start === t || (c.history.length && c.history[c.history.length - 1].date === t); });
      if (!seen.length) return null;
      const items = seen.filter(function (c) { return c.key.charAt(0) === 'i'; }).map(function (c) { return c.key.slice(2); });
      const paras = seen.filter(function (c) { return c.key.charAt(0) === 'p'; }).map(function (c) { return c.key.slice(2); });
      const nDone = seen.filter(function (c) { return d.recap.done[c.key]; }).length;
      const from = encodeURIComponent('#/planj');
      const quiz = [];
      if (items.length) quiz.push(h('a', { class: 'btn btn--primary btn--sm', href: '#/review?mode=item&items=' + items.map(encodeURIComponent).join(',') + '&kind=qcm,qroc&size=' + Math.min(30, 10 * items.length) + '&all=1&order=random&from=' + from + '&autostart=1' }, icon('play'), 'Questions sur ' + plural(items.length, 'item', 'items') + ' du jour'));
      if (paras.length) quiz.push(h('a', { class: 'btn btn--outline btn--sm', href: '#/parasito/choix/cartes?ids=' + paras.map(encodeURIComponent).join(',') + '&size=' + Math.min(30, 10 * paras.length) + '&order=random' }, icon('play'), 'Cartes parasito du jour'));
      const rows = seen.map(function (c) {
        const m = meta(c, cat); const r = d.recap.done[c.key];
        const mark = function (v) {
          return function () {
            const was = d.recap.done[c.key];
            if (was === v) { delete d.recap.done[c.key]; save(d); rerender(); return; }
            d.recap.done[c.key] = v;
            if (v === 'flou' && c.state === 'active' && (!c.due || c.due > add(t, 1))) { c.due = add(t, 1); delete c.planned; toast(m.title + ' : prochain passage demain', 'warn'); }
            else toast(m.title + ' : 2e tour fait', 'ok');
            if (!was) xp(10, '2e tour');
            save(d); rerender();
          };
        };
        return h('div', { class: 'pj-row', style: 'align-items:flex-start' + (r ? ';opacity:.7' : '') },
          h('b', { style: 'width:22px;text-align:right;color:var(--muted)' }, r ? '✓' : '·'), dot(mastery(c, d)),
          h('div', { class: 'pj-row__main' },
            h('div', { class: 'pj-row__t' }, m.title),
            h('div', { class: 'pj-row__s' }, (c.start === t && c.history.length === 0 ? 'découvert aujourd’hui' : 'revu aujourd’hui') + (r ? ' · 2e tour : ' + (r === 'ok' ? 'ça tient' : 'encore flou') : '')),
            h('div', { class: 'pj-row__acts' },
              m.href ? h('a', { class: 'btn btn--ghost btn--sm', href: m.href }, icon('book'), 'Relire') : null,
              m.train ? h('a', { class: 'btn btn--ghost btn--sm', href: m.train.replace(/size=inf&all=1/, 'size=10&order=random') }, icon('play'), '10 questions') : null,
              btn('Ça tient ✓', r === 'ok' ? 'btn--primary btn--sm' : 'btn--outline btn--sm', mark('ok')),
              btn('Encore flou', r === 'flou' ? 'btn--primary btn--sm' : 'btn--outline btn--sm', mark('flou')))));
      });
      return h('div', { class: 'card stack' },
        h('p', { class: 'pj-h', style: 'font-size:17px;margin:0' }, 'Tour de révision du jour (' + nDone + '/' + seen.length + ')'),
        h('p', { class: 'secondary muted', style: 'margin:0' }, 'Repasse rapidement ce que tu as vu aujourd’hui, en fin de journée : relecture des points clés ou quelques questions. Ça consolide sans changer tes J ; si c’est encore flou, le cours revient dès demain.'),
        quiz.length ? h('div', { class: 'pj-row__acts' }, quiz) : null,
        h('div', { class: 'pj-grp' }, rows));
    }
    function dateBar() {
      const t = today(); const cur = state.date || t;
      const inp = h('input', { type: 'date', value: cur, min: t, max: add(t, 13), class: 'pj-note', style: 'width:auto', 'aria-label': 'Choisir le jour à préparer',
        on: { change: function (e) { if (valid(e.target.value)) { state.date = e.target.value; rerender(); } } } });
      return h('div', { class: 'pj-chips', style: 'align-items:center' },
        h('button', { type: 'button', class: cur === t ? 'is-on' : '', on: { click: function () { state.date = t; rerender(); } } }, 'Aujourd’hui'),
        h('button', { type: 'button', class: cur === add(t, 1) ? 'is-on' : '', on: { click: function () { state.date = add(t, 1); rerender(); } } }, 'Demain'),
        inp);
    }
    /* Une autre journée dans la même journée : nouveau programme (les cours déjà vus aujourd'hui sont placés, donc
     * l'app propose de nouvelles découvertes et les J suivants). Ce qui a été fait reste enregistré. */
    function anotherDay(d, cat, day, date) {
      const left = day.slots.filter(function (s) { return !s.done && (s.key || s.m === 'memo'); }).length;
      if (left && !window.confirm('Il reste ' + plural(left, 'créneau', 'créneaux') + ' non faits. Les remplacer par une nouvelle journée ? (ce que tu as déjà fait reste enregistré)')) return;
      const pl = buildDay(d, cat, date); pl.round = (day.round || 1) + 1;
      d.plans[date] = pl; if (date === today()) d.day = pl;
      save(d); toast('Journée n° ' + pl.round + ' : c’est parti !', 'ok'); rerender(); window.scrollTo(0, 0);
    }
    /* Réinitialiser un bloc (ex. Dermato) : ses créneaux redeviennent à faire et l'app re-choisit les cours du pôle
     * (les révisions déjà notées restent enregistrées dans tes J). Ensuite « Changer » pour choisir toi-même. */
    function blockReset(d, cat, day, date, isToday) {
      const groups = [];
      day.slots.forEach(function (s) { if (s.m !== 'memo' && groups.indexOf(s.g) < 0) groups.push(s.g); });
      if (!groups.length) return null;
      return h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center' },
        h('span', { class: 'secondary muted' }, 'Réinitialiser un bloc :'),
        groups.map(function (g) {
          return btn(g, 'btn--outline btn--sm', function () {
            const mine = day.slots.filter(function (s) { return s.g === g; });
            const others = day.slots.filter(function (s) { return s.g !== g; }).map(function (s) { return s.key; });
            const tmp = buildDay(Object.assign({}, d, { stage: false, template: mine.map(function (s) { return { g: s.g, m: s.m, min: s.min }; }) }), cat.filter(function (x) { return others.indexOf(x.key) < 0; }), date);
            mine.forEach(function (s, k) { const n = tmp.slots[k] || {}; s.key = n.key || null; s.why = n.why || ''; s.done = false; s.grade = null; });
            save(d); toast('Bloc ' + g + ' remis à zéro : nouveaux cours proposés (touche « Changer » pour choisir)', 'ok'); rerender();
          }, 'refresh');
        }));
    }
    function dayDone(d, cat, day) {
      if (!day || day.bonus || day.date !== today()) return;
      if (!day.slots.length || !day.slots.every(function (s) { return s.done || !s.key && s.m !== 'memo'; })) return;
      day.bonus = true; d.daysDone = (Number(d.daysDone) || 0) + 1;
      save(d);
      xp(XP.day, 'Journée bouclée');
      if (day.stage) badge('pj-stage');
      checkBadges(d, cat);
      try { if (CARDIO.fx) CARDIO.fx.celebrate('Journée bouclée !', '+' + XP.day + ' XP bonus · ' + d.daysDone + ' journée' + (d.daysDone > 1 ? 's' : '') + ' au total'); } catch (e) { /* ignore */ }
    }
    function dayBlock(d, cat) {
      const t = today();
      const date = state.date && state.date >= t ? state.date : t;
      const isToday = date === t;
      ensureDay(d, cat, date);
      const day = d.plans[date];
      const rows = [];
      const nDone = day.slots.filter(function (s) { return s.done; }).length;
      day.slots.forEach(function (s, i) {
        const c = s.key ? d.courses[s.key] : null;
        const m = s.key ? meta(c || { key: s.key }, cat) : null;
        const tag = s.g + ' · ' + (s.min || 40) + ' min' + (s.why ? ' · ' + s.why : '');
        if (s.m === 'memo') {
          rows.push(h('div', { class: 'pj-row', style: s.done ? 'opacity:.6' : null }, h('b', { style: 'width:22px;text-align:right;color:var(--muted)' }, s.done ? '✓' : String(i + 1)), icon('note'),
            h('div', { class: 'pj-row__main' }, h('div', { class: 'pj-row__t' }, s.g), h('div', { class: 'pj-row__s' }, (s.min || 20) + ' min · rappel, à faire en dehors de l’app')),
            btn(s.done ? 'Annuler' : 'Fait ✓', s.done ? 'btn--ghost btn--sm' : 'btn--outline btn--sm', function () { s.done = !s.done; save(d); if (s.done) { xp(XP.memo, s.g); dayDone(d, cat, day); } rerender(); })));
          return;
        }
        if (!m) {
          rows.push(h('div', { class: 'pj-row', style: 'opacity:.6' }, h('b', { style: 'width:22px;text-align:right;color:var(--muted)' }, String(i + 1)),
            h('div', { class: 'pj-row__main' }, h('div', { class: 'pj-row__t' }, tag), h('div', { class: 'pj-row__s' }, 'Rien à proposer dans ce pôle (tout est découvert ou acquis).'))));
          return;
        }
        const acts = [];
        if (!s.done) {
          if (s.key.charAt(0) === 'i') {
            // Déroulé guidé d'un item : découverte = pré-test (ne compte pas) → fiche (6 questions après chaque partie) → Découvert ✓ ;
            // révision = 20 questions au hasard (la note règle le J toute seule) → relire les parties fragiles
            const num = s.key.slice(2), from = encodeURIComponent('#/planj');
            const base = '#/review?mode=item&item=' + encodeURIComponent(num) + '&all=1&order=random&from=' + from + '&autostart=1';
            if (!c) {
              acts.push(h('a', { class: 'btn btn--outline btn--sm', href: base + '&kind=qcm&size=10&pre=1' }, '① Pré-test 10 QCM'));
              acts.push(h('a', { class: 'btn btn--outline btn--sm', href: '#/item/' + encodeURIComponent(num) + '/cours' }, '② Lire la fiche'));
            } else {
              acts.push(h('a', { class: 'btn btn--outline btn--sm', href: base + '&kind=qcm,qroc&size=20' }, '① 20 questions'));
              if (m.href) acts.push(h('a', { class: 'btn btn--ghost btn--sm', href: '#/item/' + encodeURIComponent(num) + '/cours' }, '② Relire'));
            }
          } else {
            if (m.href) acts.push(h('a', { class: 'btn btn--ghost btn--sm', href: m.href }, icon('book'), 'Cours'));
            if (m.train) acts.push(h('a', { class: 'btn btn--ghost btn--sm', href: m.train }, icon('play'), 'S’entraîner'));
          }
          if (!isToday) {
            /* jour préparé à l'avance : on peut changer les cours, la note se fera le jour J */
          } else if (!c) {
            acts.push(btn((s.key.charAt(0) === 'i' ? '③ ' : '') + 'Découvert ✓', 'btn--primary btn--sm', function () { place(d, s.key, { start: t, passes: 0 }); s.done = true; save(d); xp(XP.discover, 'Découverte'); checkBadges(d, cat); dayDone(d, cat, day); toast(m.title + ' découvert : J1 demain', 'ok'); rerender(); }));
          } else {
            ['difficile', 'moyen', 'facile'].forEach(function (g) {
              acts.push(btn(GRADES[g].label, g === 'facile' ? 'btn--primary btn--sm' : 'btn--outline btn--sm', function () {
                let cc = d.courses[s.key];
                if (!cc) cc = place(d, s.key, { start: t, passes: 0 });
                if (cc.state !== 'active') { cc.state = 'active'; cc.due = t; }
                const msg = review(d, s.key, g, null);
                s.done = true; s.grade = g; save(d); xp(XP[g], 'Révision'); checkBadges(d, cat); dayDone(d, cat, day); toast(msg || 'Enregistré', g === 'difficile' ? 'warn' : 'ok'); rerender();
              }));
            });
          }
          const pickOpen = state.pick && state.pick.date === date && state.pick.i === i;
          acts.push(btn(pickOpen ? 'Fermer' : 'Changer', pickOpen ? 'btn--primary btn--sm' : 'btn--ghost btn--sm', function () {
            state.pick = pickOpen ? null : { date: date, i: i, all: false }; rerender();
          }, 'shuffle'));
        }
        const picker = !s.done && state.pick && state.pick.date === date && state.pick.i === i ? coursePicker(d, cat, day, s, date) : null;
        rows.push(h('div', { class: 'pj-row', style: 'align-items:flex-start' + (s.done ? ';opacity:.6' : '') },
          h('b', { style: 'width:22px;text-align:right;color:var(--muted)' }, s.done ? '✓' : String(i + 1)), dot(mastery(c, d)),
          h('div', { class: 'pj-row__main' },
            h('div', { class: 'pj-row__t' }, m.title),
            h('div', { class: 'pj-row__s' }, tag + (s.done && s.grade ? ' · ' + GRADES[s.grade].label : '')),
            statusEl(c, d, { noLevel: true }),
            !s.done && s.key.charAt(0) === 'i' ? h('div', { class: 'pj-row__s', style: 'margin-top:4px' }, !c
              ? 'Découverte : pré-test 10 QCM (ne compte pas, lis vite les corrections) → fiche partie par partie, avec 6 questions après chaque partie → Découvert ✓.'
              : 'Révision : 20 questions au hasard, ta note règle le prochain J toute seule → relis les parties fragiles. Ou note-toi directement.') : null,
            !s.done ? (s.key.charAt(0) === 'i' ? fragileEl(s.key.slice(2), rerenderSoon, 2) : s.key.charAt(0) === 'p' ? fragileEl(s.key, null, 2) : null) : null,
            acts.length ? h('div', { class: 'pj-row__acts' }, acts) : null,
            picker)));
        const nextS = day.slots[i + 1];
        if (s.g === 'Parasito-myco' && (!nextS || nextS.g !== 'Parasito-myco')) {
          rows.push(h('a', { class: 'pj-row', href: '#/parasito/toutes/cartes', style: 'text-decoration:none;color:inherit' }, icon('refresh'),
            h('div', { class: 'pj-row__main' }, h('div', { class: 'pj-row__t' }, 'Revoir rapidement les anciennes fiches parasito'), h('div', { class: 'pj-row__s' }, 'cartes dues, répétition espacée · quelques minutes')), icon('play')));
        }
      });
      const tot = day.slots.reduce(function (a, s) { return a + (s.min || 40); }, 0);
      const left = day.slots.reduce(function (a, s) { return a + (s.done ? 0 : (s.min || 40)); }, 0);
      const hm = function (n) { return Math.floor(n / 60) + ' h ' + pad(n % 60); };
      const byG = {};
      day.slots.forEach(function (s) { byG[s.g] = (byG[s.g] || 0) + 1; });
      return h('div', { class: 'card stack' },
        h('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap' },
          h('p', { class: 'pj-h', style: 'font-size:17px;flex:1;margin:0' }, '1 · ' + (d.stage ? 'Journée de stage' : 'Ma journée type') + (day.round > 1 ? ' n° ' + day.round : '') + (isToday ? '' : ' · ' + nice(date)) + ' (' + nDone + '/' + day.slots.length + ' créneaux)'),
          btn(d.stage ? 'Mode stage : activé' : 'Mode stage', d.stage ? 'btn--primary btn--sm' : 'btn--outline btn--sm', function () {
            // Bascule : la journée est recomposée tout de suite ; les créneaux déjà faits restent comptés dans les J
            d.stage = !d.stage; delete d.plans[date]; if (isToday) d.day = null; ensureDay(d, cat, date); save(d);
            toast(d.stage ? 'Mode stage : journée allégée (~3 h), révisions d’abord' : 'Retour à ta journée type', 'ok'); rerender();
          }, 'clock')),
        h('div', { class: 'pj-xpline' }, h('span', { class: 'pj-xpchip' }, '⚡ ' + todayXp() + ' XP aujourd’hui'), h('span', { class: 'pj-xpchip pj-xpchip--lvl' }, levelLabel()), h('span', { class: 'pj-xpchip pj-xpchip--fire' }, '🏁 ' + (Number(d.daysDone) || 0) + ' journées bouclées')),
        h('p', { class: 'secondary muted' }, 'Objectif : ' + Object.keys(byG).map(function (g) { return byG[g] + ' ' + g; }).join(' · ') + ' · environ ' + hm(tot) + (nDone ? ' (reste ' + hm(left) + ')' : '') + '. Dans chaque créneau, l’app choisit le cours du pôle : un cours jamais vu d’abord, sinon un J dû, sinon ton cours le plus fragile ; à chaque fois le plus pertinent pour l’EDN et la pratique en premier (les jours chargés, les révisions passent avant).'),
        h('div', { class: 'pj-bar__track' }, h('div', { class: 'pj-bar__fill', style: 'width:' + Math.round((tot - left) / Math.max(1, tot) * 100) + '%' })),
        day.heavy || day.caught ? h('div', { class: 'pj-banner' }, h('span', null,
          (day.caught ? plural(day.caught, 'révision en retard étalée', 'révisions en retard étalées') + ' automatiquement sur les prochains jours. ' : '') +
          (day.stage ? 'Mode stage : journée allégée (environ 3 h), révisions d’abord ; une découverte seulement s’il n’y a rien à revoir dans le pôle. ' : day.heavy ? 'Beaucoup de J dus (' + day.dueN + ') : les créneaux « Auto » revoient au lieu de découvrir ce jour-là. Les découvertes reprennent quand la charge baisse.' : ''))) : null,
        isToday ? null : h('p', { class: 'secondary muted' }, 'Programme préparé pour ' + nice(date) + ' : change les cours si tu veux, il sera prêt le jour venu (tu noteras tes révisions ce jour-là).'),
        h('div', { class: 'pj-grp' }, rows),
        isToday && day.bonus ? h('div', { class: 'pj-banner' }, h('span', null, 'Journée bouclée ! Encore de l’énergie ? Enchaîne une autre journée : de nouveaux cours à découvrir et les révisions suivantes.'),
          btn('Enchaîner une autre journée', 'btn--primary btn--sm', function () { anotherDay(d, cat, day, date); }, 'refresh')) : null,
        blockReset(d, cat, day, date, isToday),
        h('div', { class: 'pj-row__acts' }, btn('Recomposer le programme', null, function () { const pl = buildDay(d, cat, date); pl.round = day.round || 1; d.plans[date] = pl; if (isToday) d.day = pl; save(d); rerender(); }, 'refresh'),
          isToday && !day.bonus ? btn('Faire une autre journée', null, function () { anotherDay(d, cat, day, date); }, 'plus') : null,
          btn('Modifier mon modèle', null, function () { go('regl'); }, 'edit')));
    }

    /* --- Éditeur du modèle de journée (dans « Réglages ») --- */
    function templateEditor(d, cat) {
      const groups = {};
      allMetas(d, cat).forEach(function (m) { groups[m.group] = 1; });
      const gs = Object.keys(groups);
      const T = d.stage ? d.tplStage : d.template;
      const rows = T.map(function (s, i) {
        const sel = s.m === 'memo'
          ? h('input', { type: 'text', maxlength: '40', value: s.g, 'aria-label': 'Nom du rappel', on: { change: function (e) { s.g = e.target.value.trim() || 'Rappel'; save(d); } } })
          : h('select', { on: { change: function (e) { s.g = e.target.value; save(d); rerender(); } } }, gs.map(function (g) { return h('option', { value: g, selected: g === s.g }, g); }));
        return h('div', { class: 'pj-row', style: 'flex-wrap:wrap' },
          h('b', { style: 'width:22px;text-align:right;color:var(--muted)' }, String(i + 1)),
          h('label', { class: 'pj-field', style: 'flex:1;min-width:140px' }, sel),
          h('div', { class: 'pj-chips' }, ['auto', 'new', 'rev', 'memo'].map(function (mm) {
            return h('button', { type: 'button', class: s.m === mm ? 'is-on' : '', on: { click: function () { s.m = mm; save(d); rerender(); } } }, MODES[mm]);
          })),
          h('input', { class: 'pj-note', type: 'number', min: '5', max: '240', value: String(s.min || 40), 'aria-label': 'Durée en minutes', on: { change: function (e) { s.min = mins(e.target.value, s.m); save(d); } } }), h('span', { class: 'secondary muted' }, 'min'),
          btn('↑', 'btn--ghost btn--sm', function () { if (i > 0) { T.splice(i - 1, 0, T.splice(i, 1)[0]); save(d); rerender(); } }),
          btn('↓', 'btn--ghost btn--sm', function () { if (i < T.length - 1) { T.splice(i + 1, 0, T.splice(i, 1)[0]); save(d); rerender(); } }),
          btn('✕', 'btn--ghost btn--sm', function () { T.splice(i, 1); save(d); rerender(); }));
      });
      return [h('p', { class: 'pj-h' }, d.stage ? 'Mon modèle de journée de stage (mode stage activé)' : 'Mon modèle de journée'),
        h('div', { class: 'pj-row__acts' }, btn(d.stage ? 'Désactiver le mode stage' : 'Activer le mode stage', d.stage ? 'btn--primary btn--sm' : 'btn--outline btn--sm', function () { d.stage = !d.stage; d.plans = {}; d.day = null; save(d); rerender(); }, 'clock')),
        h('p', { class: 'secondary muted' }, 'L’ordre de ta journée, créneau par créneau, avec sa durée. « Auto » (conseillé) : J dû du pôle d’abord, sinon un cours à découvrir, sinon le plus fragile. « Découvrir » : un cours jamais placé en priorité. « Revoir » : un cours déjà placé seulement. Les changements valent au prochain programme (ou touche « Recomposer »).'),
        h('div', { class: 'pj-grp' }, rows),
        h('div', { class: 'pj-row__acts' },
          btn('Ajouter un créneau', null, function () { T.push({ g: gs[0] || 'Cardio', m: 'auto', min: 40 }); save(d); rerender(); }, 'plus'),
          btn('Ajouter un rappel (hors app)', null, function () { T.push({ g: 'Bactério / viro (hors app)', m: 'memo', min: 20 }); save(d); rerender(); }, 'note'),
          btn('Modèle par défaut', 'btn--ghost btn--sm', function () { if (d.stage) d.tplStage = normTemplate(null, STAGE_TEMPLATE); else d.template = normTemplate(null); save(d); rerender(); }),
          btn('Recomposer aujourd’hui', null, function () { d.day = buildDay(d, cat); d.plans[today()] = d.day; save(d); toast('Programme du jour recomposé', 'ok'); }, 'refresh'))];
    }

    /* --- Priorités --- */
    function allMetas(d, cat) {
      const custom = list(d).filter(function (c) { return c.key.charAt(0) === 'c'; }).map(function (c) { return { key: c.key, group: c.group || 'Mes cours', title: c.title, weight: 0, href: null, train: null }; });
      return cat.concat(custom);
    }
    function viewPrio(d, cat) {
      const tiers = weightTiers(cat);
      const groups = {};
      allMetas(d, cat).forEach(function (m) { groups[m.group] = 1; });
      const gs = Object.keys(groups);
      if (!state.tg) state.tg = {};
      const out = [h('p', { class: 'secondary muted' }, 'Ordre conseillé de travail, recalculé à chaque changement : d’abord ce que tu maîtrises le moins (tes notes et ton classement), ce qui tombe souvent, et ce qui est en retard. La fréquence aux examens se règle sur chaque cours (« Mes cours », touche un cours) ; sans réglage, elle est estimée d’après le volume de l’essentiel de l’item.')];
      out.push(h('div', { class: 'pj-chips' }, gs.map(function (g) {
        const on = state.tg[g] !== false;
        return h('button', { type: 'button', class: on ? 'is-on' : '', on: { click: function () { state.tg[g] = !on; rerender(); } } }, g);
      })));
      out.push(h('div', { class: 'pj-chips' }, h('button', { type: 'button', class: state.unseen ? 'is-on' : '', on: { click: function () { state.unseen = !state.unseen; rerender(); } } }, state.unseen ? 'Pas encore vus inclus' : '+ Inclure les cours pas encore vus')));
      const ranked = allMetas(d, cat).filter(function (m) { return state.tg[m.group] !== false && (state.unseen || d.courses[m.key]); })
        .map(function (m) { return { m: m, p: priority(d, m, tiers) }; })
        .filter(function (x) { const c = d.courses[x.m.key]; return !c || c.state !== 'acquis'; })
        .sort(function (a, b) { return b.p.score - a.p.score; });
      const top = ranked.slice(0, 40);
      const max = Math.max(1, top.length ? top[0].p.score : 1);
      out.push(h('div', { class: 'pj-grp' }, top.map(function (x, i) {
        const m = x.m, c = d.courses[m.key];
        return h('div', { class: 'pj-row', style: 'align-items:flex-start' },
          h('b', { style: 'width:22px;text-align:right;color:var(--muted)' }, String(i + 1)), dot(x.p.mastery),
          h('div', { class: 'pj-row__main' },
            h('div', { class: 'pj-row__t' }, m.title),
            h('div', { class: 'pj-row__s' }, m.group + ' · ' + FREQ[x.p.freq.v].toLowerCase() + (x.p.freq.est ? ' (estimé)' : '') + (x.p.why.length ? ' · ' + x.p.why.join(', ') : '')),
            statusEl(c, d, { next: true }),
            h('div', { class: 'pj-bar__track', style: 'margin-top:6px' }, h('div', { class: 'pj-bar__fill', style: 'width:' + Math.max(4, Math.round(x.p.score / max * 100)) + '%' })),
            h('div', { class: 'pj-row__acts' },
              m.href ? h('a', { class: 'btn btn--ghost btn--sm', href: m.href }, icon('book'), 'Cours') : null,
              m.train ? h('a', { class: 'btn btn--ghost btn--sm', href: m.train }, icon('play'), 'S’entraîner') : null,
              !c ? btn('Déjà vu…', 'btn--outline btn--sm', function () { state.tab = 'cours'; state.open = m.key; state.filter = ''; rerender(); }, 'plus')
                : btn('Régler', null, function () { state.tab = 'cours'; state.open = m.key; state.filter = ''; rerender(); }, 'edit'))));
      })));
      if (!ranked.length) out.push(h('p', { class: 'secondary muted' }, 'Aucun cours placé dans ces matières. Place ou classe tes cours dans « Mes cours », ou inclus les cours pas encore vus.'));
      if (ranked.length > top.length) out.push(h('p', { class: 'secondary muted' }, '… et ' + (ranked.length - top.length) + ' autres, moins prioritaires.'));
      return out;
    }

    /* --- Tours --- */
    function viewTours(d, cat) {
      const out = [];
      const T = d.tours;
      if (!T) {
        const groups = {};
        allMetas(d, cat).forEach(function (m) { groups[m.group] = (groups[m.group] || 0) + 1; });
        if (!state.tg) state.tg = {};
        const loc = state.tsetup || (state.tsetup = { days: 21, mode: 'priorite' });
        const daysIn = h('input', { type: 'number', min: String(TOURS_MIN), max: String(TOURS_MAX), value: String(loc.days), inputmode: 'numeric', on: { input: function (e) { loc.days = e.target.value; } } });
        const sel = Object.keys(groups).filter(function (g) { return state.tg[g] !== false; });
        const n = sel.reduce(function (s, g) { return s + groups[g]; }, 0);
        out.push(h('div', { class: 'card stack' },
          h('p', { class: 'pj-h' }, 'Méthode des tours'),
          h('p', { class: 'secondary muted' }, 'Quand tu as beaucoup de cours déjà vus, tu repasses sur TOUT le programme choisi, cours après cours, en un nombre de jours fixé. Chaque tour suivant va plus vite (durée × 0,6). Ça complète les J : les J gèrent chaque cours, les tours te font balayer l’ensemble.')));
        out.push(h('div', { class: 'pj-sheet' },
          h('div', { class: 'pj-field' }, 'Matières du tour', h('div', { class: 'pj-chips' }, Object.keys(groups).map(function (g) {
            const on = state.tg[g] !== false;
            return h('button', { type: 'button', class: on ? 'is-on' : '', on: { click: function () { state.tg[g] = !on; rerender(); } } }, g + ' (' + groups[g] + ')');
          }))),
          h('label', { class: 'pj-field' }, 'Durée du 1er tour (jours)', daysIn),
          h('div', { class: 'pj-field' }, 'Ordre', h('div', { class: 'pj-chips' },
            h('button', { type: 'button', class: loc.mode === 'priorite' ? 'is-on' : '', on: { click: function () { loc.mode = 'priorite'; rerender(); } } }, 'Par priorité (conseillé)'),
            h('button', { type: 'button', class: loc.mode === 'programme' ? 'is-on' : '', on: { click: function () { loc.mode = 'programme'; rerender(); } } }, 'Ordre du programme'))),
          h('p', { class: 'secondary muted' }, plural(n, 'cours', 'cours') + ' · environ ' + Math.max(1, Math.ceil(n / Math.max(TOURS_MIN, Math.min(TOURS_MAX, Number(loc.days) || 21)))) + ' par jour'),
          h('div', { class: 'pj-row__acts' }, btn('Lancer le tour 1', 'btn--primary btn--sm', function () {
            if (!sel.length) { toast('Choisis au moins une matière', 'warn'); return; }
            const days = Math.max(TOURS_MIN, Math.min(TOURS_MAX, Math.round(Number(loc.days)) || 21));
            d.tours = { groups: sel, mode: loc.mode, order: tourOrder(d, sel, loc.mode, cat), days: days, firstDays: days, tour: 1, pos: 0, startedAt: today(), dayDate: null, dayPos: 0, rolledAt: null, lastDoneAt: null };
            save(d); toast('Tour 1 lancé : ' + plural(days, 'jour', 'jours'), 'ok'); rerender();
          }, 'play'))));
        return out;
      }
      const pr = tourProgress(T); const td = tourToday(T);
      out.push(h('div', { class: 'card stack' },
        h('p', { class: 'pj-h' }, 'Tour ' + T.tour + ' · jour ' + pr.day + '/' + T.days),
        h('div', { class: 'pj-bar__track' }, h('div', { class: 'pj-bar__fill', style: 'width:' + pr.pct + '%' })),
        h('p', { class: 'secondary muted' }, pr.pos + '/' + pr.total + ' cours faits (' + pr.pct + ' %) · ' + pr.quota + ' par jour · ' + T.groups.join(', ') + ' · ' + (T.mode === 'priorite' ? 'par priorité' : 'ordre du programme')
          + (pr.behind ? ' · ' + plural(pr.behind, 'cours de retard', 'cours de retard') : '') + ' · tour suivant en ' + plural(pr.next, 'jour', 'jours'))));
      if (td.finished) out.push(h('p', { class: 'pj-h' }, 'Tour terminé aujourd’hui : bravo ! Le suivant commence demain.'));
      else {
        out.push(h('p', { class: 'pj-h' }, 'Au programme aujourd’hui'));
        out.push(h('div', { class: 'pj-grp' }, td.items.map(function (it) {
          const c = d.courses[it.key]; const m = meta(c || { key: it.key }, cat);
          const isNext = !it.done && it.index === T.pos;
          return h('div', { class: 'pj-row', style: it.done ? 'opacity:.6' : null }, dot(mastery(c, d)),
            h('div', { class: 'pj-row__main' }, h('div', { class: 'pj-row__t' }, (it.done ? '✓ ' : '') + m.title), h('div', { class: 'pj-row__s' }, m.group), statusEl(c, d, { noLevel: true }),
              !it.done ? h('div', { class: 'pj-row__acts' },
                m.href ? h('a', { class: 'btn btn--ghost btn--sm', href: m.href }, icon('book'), 'Cours') : null,
                m.train ? h('a', { class: 'btn btn--ghost btn--sm', href: m.train }, icon('play'), 'S’entraîner') : null,
                isNext ? btn('Fait', 'btn--primary btn--sm', function () { const msg = tourDone(d, cat); save(d); xp(XP.tour, 'Tour'); if (msg) { badge('pj-tour-1'); try { CARDIO.fx && CARDIO.fx.celebrate('Tour terminé !', msg); } catch (e) { /* ignore */ } } toast(msg || 'Coché', 'ok'); rerender(); }, 'check') : null) : null));
        })));
        if (td.items.length && td.items.every(function (x) { return x.done; })) {
          out.push(h('p', { class: 'secondary muted' }, 'Quota du jour fait. Tu peux t’arrêter là ou avancer le cours suivant.'));
          out.push(btn('Avancer d’un cours', null, function () { T.dayDate = null; save(d); rerender(); }, 'plus'));
        }
      }
      out.push(h('div', { class: 'pj-row__acts' },
        btn('Recalculer l’ordre (priorités actuelles)', null, function () { const done = T.order.slice(0, T.pos); const rest = tourOrder(d, T.groups, T.mode, cat).filter(function (k) { return done.indexOf(k) < 0; }); T.order = done.concat(rest); save(d); toast('Ordre recalculé', 'ok'); rerender(); }, 'refresh'),
        btn('Arrêter les tours', 'btn--ghost btn--sm', function () { if (!window.confirm('Arrêter la méthode des tours ? La progression du tour sera perdue (les J ne changent pas).')) return; d.tours = null; save(d); rerender(); }, 'x')));
      return out;
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
      const out = templateEditor(d, catalog());
      out.push(h('p', { class: 'pj-h' }, 'Rythme'));
      out.push(h('div', { class: 'pj-grp' }, ORDER.map(function (id) {
        const r = RHYTHMS[id];
        return h('div', { class: 'pj-row', style: 'cursor:pointer' + (d.rhythm === id ? ';border-color:var(--accent)' : ''), on: { click: function () { setRhythm(d, id); d.rhythmSet = true; save(d); toast('Rythme ' + r.label + ' : planning recalculé', 'ok'); rerender(); } } },
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
    const text = !s.placed ? 'Place tes cours : l’app te dit quoi revoir chaque jour.'
      : s.due ? plural(s.due, 'cours à revoir', 'cours à revoir') + ' aujourd’hui' + (s.late ? ' dont ' + s.late + ' en retard' : '') : 'Rien à revoir aujourd’hui : avance un nouveau cours.';
    return h('a', { class: 'card', href: '#/planj', style: 'display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit' },
      h('span', { class: 'pj-dot ' + (s.late ? 'pj-dot--bad' : s.due ? 'pj-dot--mid' : 'pj-dot--ok'), style: 'width:16px;height:16px' }),
      h('span', { style: 'flex:1' }, h('b', { style: 'display:block' }, 'Méthode des J'), h('span', { class: 'secondary muted' }, text)),
      icon('calendar'));
  }

  /* ---------- questions → planning ----------
   * Chaque réponse (QCM, QROC, KFP, TCS, cas…) d'un item s'ajoute à son compteur du jour. Au 20e, la note moyenne
   * devient une révision : J dû (ou en retard / dans les 2 jours) → validé selon la note (≥ 85 % facile, ≥ 65 % moyen,
   * sinon difficile = demain) ; J pas encore dû → note enregistrée, et rappel avancé à demain si < 50 %.
   * Cours pas encore placé → placé (vu aujourd'hui). Cours acquis → réactivé si < 65 %. La note est affichée sur le
   * planning et pèse dans la maîtrise (pastille, priorités). */
  const QUIZ_KINDS = { qcm: 1, qroc: 1, open: 1, kfp: 1, tcs: 1, case: 1, cases: 1, ecg: 1, echo: 1, parasito: 1 };
  const QUIZ_MIN = 20;
  function gradeOfPct(p) { return p >= 85 ? 'facile' : p >= 65 ? 'moyen' : 'difficile'; }
  function applyQuiz(d, key, acc) {
    const t = today();
    const pct = Math.round(acc.sum / Math.max(1, acc.n) * 100);
    const g = gradeOfPct(pct);
    let c = d.courses[key];
    let msg;
    if (!c) {
      c = place(d, key, { start: t, passes: 0 });
      c.level = pct >= 85 ? 3 : pct >= 65 ? 2 : 1;
      msg = 'placé dans la méthode des J (' + pct + ' %)';
    } else if (c.state === 'acquis') {
      if (pct < 65) { c.state = 'active'; c.step = Math.max(0, last(d.rhythm) - 1); c.due = add(t, 1); msg = pct + ' % : il revient demain'; }
      else msg = pct + ' % : toujours acquis';
    } else if (c.state === 'active' && c.due && c.due <= add(t, 2)) {
      msg = (review(d, key, g, pct) || 'révision validée') + ' (' + pct + ' %)';
      const day = d.plans && d.plans[t];
      if (day) day.slots.forEach(function (s) { if (s.key === key && !s.done) { s.done = true; s.grade = g; } });
    } else {
      if (pct < 50 && c.state === 'active') { c.due = add(t, 1); delete c.planned; msg = pct + ' % : prochaine révision avancée à demain'; }
      else msg = pct + ' % noté';
    }
    c.qnote = { date: t, pct: pct, n: acc.n };
    return { msg: msg, pct: pct, grade: g };
  }
  function onQuizAnswer(p) {
    try {
      if (!p || !QUIZ_KINDS[p.kind] || !(p.item || p.pkey)) return;
      const key = p.pkey && /^p:/.test(p.pkey) ? String(p.pkey) : 'i:' + String(p.item);
      const d = load(); const t = today();
      if (!d.qacc || d.qacc.date !== t) d.qacc = { date: t, items: {} };
      const acc = d.qacc.items[key] || (d.qacc.items[key] = { n: 0, sum: 0, applied: false });
      acc.n += 1; acc.sum += Math.max(0, Math.min(1, Number(p.score) || 0));
      let r = null;
      if (acc.n >= QUIZ_MIN && !acc.applied) { acc.applied = true; r = applyQuiz(d, key, acc); }
      else if (acc.applied && d.courses[key]) {
        // au-delà de 20 : la note du jour se met à jour (sans nouvelle révision)
        d.courses[key].qnote = { date: t, pct: Math.round(acc.sum / acc.n * 100), n: acc.n };
      }
      save(d);
      if (r) {
        const m = meta(d.courses[key] || { key: key });
        xp(XP[r.grade] || 20, 'Note');
        toastG('📝 ' + m.title + ' : ' + r.msg, r.pct >= 65 ? 'ok' : 'warn');
      }
    } catch (e) { console.warn('[planj] quiz → planning', e); }
  }
  function toastG(msg, tone) { try { CARDIO.shell.toast(msg, { tone: tone || 'info', ms: 4200 }); } catch (e) { /* ignore */ } }
  (function bindQuiz() {
    const u = CARDIO.util;
    if (!u || typeof u.on !== 'function') { setTimeout(bindQuiz, 200); return; }
    u.on('quiz:answer', onQuizAnswer);
  })();
  /* Pastilles visibles partout : niveau de maîtrise (couleur) + note aux questions + prochain J. */
  const LVL_TONE = { none: ['var(--surface-2)', 'var(--muted)'], new: ['var(--info-soft)', 'var(--info)'], bad: ['var(--bad-soft)', 'var(--bad)'], mid: ['var(--warn-soft)', 'var(--warn)'], ok: ['var(--ok-soft)', 'var(--ok)'], acq: ['var(--ok)', '#fff'] };
  function chip(text, bg, fg) { return h('span', { class: 'pj-st', style: 'background:' + bg + ';color:' + fg }, text); }
  function statusEl(c, d, opts) {
    const ms = mastery(c, d); const tone = LVL_TONE[ms.lvl] || LVL_TONE.none;
    const lab = ms.label.replace(/ \((mon classement|questions [^)]*)\)$/, '');
    const out = [chip(lab + (c ? ' · ' + Math.round(ms.score * 100) + ' %' : ''), tone[0], tone[1])];
    if (c && c.qnote) out.push(chip('📝 ' + c.qnote.pct + ' % · ' + c.qnote.n + ' q.' + (diff(c.qnote.date, today()) ? ' · il y a ' + diff(c.qnote.date, today()) + ' j' : ''), 'var(--accent-soft)', 'var(--accent)'));
    if (c && c.level && !(opts && opts.noLevel)) out.push(chip('Mon niveau : ' + LEVELS[c.level].label, 'var(--surface-2)', 'var(--ink-2)'));
    if (opts && opts.next && c && c.state === 'active' && c.due) out.push(chip('Prochain ' + jLabel(d.rhythm, c.step) + ' · ' + nice(c.due), 'var(--surface-2)', 'var(--ink-2)'));
    return h('span', { class: 'pj-sts' }, out);
  }
  function qtag(c) {
    if (!c || !c.qnote) return '';
    const days = diff(c.qnote.date, today());
    return ' · 📝 ' + c.qnote.pct + ' % (' + c.qnote.n + ' q.' + (days ? ', il y a ' + days + ' j' : '') + ')';
  }

  /* ---------- zones de fragilité : parties de la fiche où tu réussis le moins ----------
   * Pour chaque partie (section de fiche2 et ses objectifs), score moyen de tes dernières réponses aux cartes de la
   * partie (au moins 3 cartes déjà faites). Renvoie null tant que le contenu de l'item n'est pas chargé (chargement lancé,
   * puis `onReady` rappelé). */
  const GRADE_SCORE = { 1: 0, 2: 0.5, 3: 0.8, 4: 1 };
  const loading = {};
  function cardScore(id) {
    try {
      const c = CARDIO.store.card(id);
      if (!c || !Array.isArray(c.hist) || !c.hist.length) return null;
      const hs = c.hist.slice(-2);
      let s = 0;
      hs.forEach(function (x) { s += x[2] != null ? Math.max(0, Math.min(1, Number(x[2]))) : (GRADE_SCORE[x[1]] != null ? GRADE_SCORE[x[1]] : 0.5); });
      return s / hs.length;
    } catch (e) { return null; }
  }
  function weakSections(num, onReady) {
    const r = CARDIO.registry || {};
    const key = String(num);
    const f2 = r.fiche2 && r.fiche2[key];
    if (!f2 || !Array.isArray(f2.sections)) return [];
    if (typeof r.isLoaded === 'function' && !r.isLoaded(key)) {
      if (!loading[key] && typeof r.load === 'function') {
        loading[key] = true;
        r.load(key).then(function () { loading[key] = false; if (typeof onReady === 'function') onReady(); }, function () { loading[key] = false; });
      }
      return null;
    }
    const out = [];
    f2.sections.forEach(function (s) {
      const objs = Array.isArray(s.objectives) ? s.objectives.filter(Boolean) : [];
      if (!objs.length) return;
      const ids = {};
      objs.forEach(function (o) { (typeof r.cardsForObjective === 'function' ? r.cardsForObjective(key, o) : []).forEach(function (c) { if (c.kind !== 'flash') ids[c.id] = 1; }); });
      const all = Object.keys(ids);
      let n = 0, sum = 0;
      all.forEach(function (id) { const v = cardScore(id); if (v != null) { n++; sum += v; } });
      out.push({ id: s.id, title: String(s.title || s.id).replace(/^\d+\.\s*/, ''), objectives: objs, total: all.length, seen: n, pct: n ? Math.round(sum / n * 100) : null });
    });
    return out;
  }
  /* Les parties à revoir en priorité : testées (≥ 3 cartes) et sous 70 %, les plus faibles d'abord. */
  function fragileOf(num, onReady) {
    const ws = weakSections(num, onReady);
    if (!ws) return null;
    return ws.filter(function (s) { return s.seen >= 3 && s.pct < 70; }).sort(function (a, b) { return a.pct - b.pct; });
  }
  function sectionLinks(num, s) {
    const back = encodeURIComponent('#/item/' + num + '/cours?sec=' + s.id);
    return {
      read: '#/item/' + encodeURIComponent(num) + '/cours?sec=' + encodeURIComponent(s.id),
      test: '#/review?mode=item&item=' + encodeURIComponent(num) + '&objective=' + s.objectives.map(encodeURIComponent).join(',') + '&from=' + back + '&autostart=1'
    };
  }
  function fragileParasito(id, max) {
    const pz = CARDIO.views && CARDIO.views.parasito;
    const fr = pz && typeof pz.fragileOf === 'function' ? pz.fragileOf(id) : [];
    if (!fr.length) return null;
    return h('div', { class: 'pj-frag' }, fr.slice(0, max || 2).map(function (s) {
      return h('div', { class: 'pj-frag__row' },
        h('span', { class: 'pj-st', style: 'background:var(--bad-soft);color:var(--bad)' }, '⚠ ' + s.pct + ' %'),
        h('span', { class: 'pj-frag__t' }, s.title),
        h('a', { class: 'btn btn--ghost btn--sm', href: '#/parasito/' + encodeURIComponent(id) }, 'Revoir'),
        h('a', { class: 'btn btn--outline btn--sm', href: '#/parasito/' + encodeURIComponent(id) + '/cartes' }, 'Me tester'));
    }));
  }
  function fragileEl(num, onReady, max) {
    if (/^p:/.test(String(num))) return fragileParasito(String(num).slice(2), max);
    const fr = fragileOf(num, onReady);
    if (!fr || !fr.length) return null;
    return h('div', { class: 'pj-frag' }, fr.slice(0, max || 2).map(function (s) {
      const l = sectionLinks(num, s);
      return h('div', { class: 'pj-frag__row' },
        h('span', { class: 'pj-st', style: 'background:var(--bad-soft);color:var(--bad)' }, '⚠ ' + s.pct + ' %'),
        h('span', { class: 'pj-frag__t' }, s.title),
        h('a', { class: 'btn btn--ghost btn--sm', href: l.read }, 'Revoir'),
        h('a', { class: 'btn btn--outline btn--sm', href: l.test }, 'Me tester'));
    }));
  }

  /* Pour les autres vues (liste des items, page d'un item, séance) */
  function statusFor(key) {
    try { const d = load(); return { course: d.courses[key] || null, el: statusEl(d.courses[key] || null, d, { next: true }), mastery: mastery(d.courses[key] || null, d) }; } catch (e) { return null; }
  }
  function quizProgress(num) {
    try { const d = load(); const k = /^[ipc]:/.test(String(num)) ? String(num) : 'i:' + String(num); const a = d.qacc && d.qacc.date === today() ? (d.qacc.items[k] || d.qacc.items[String(num)]) : null; return a ? { n: a.n, pct: Math.round(a.sum / Math.max(1, a.n) * 100), applied: !!a.applied, min: QUIZ_MIN } : { n: 0, pct: 0, applied: false, min: QUIZ_MIN }; } catch (e) { return null; }
  }
  CARDIO.views.planj = { render: render, summary: summary, statusFor: function (k) { ensureStyles(); return statusFor(k); }, quizProgress: quizProgress,
    weakSections: weakSections, fragileOf: fragileOf, sectionLinks: sectionLinks,
    // pertinence EDN + pratique 1-3 (ton réglage « Aux examens » s'il existe, sinon l'estimation) et si elle est estimée
    relevance: function (key) { try { return freqOf(load(), { key: String(key), weight: 0 }, null); } catch (e) { return { v: 2, est: true }; } },
    homeCard: function () { ensureStyles(); return homeCard(); } };
})();
