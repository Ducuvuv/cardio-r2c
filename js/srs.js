/* CardioR2C — srs.js
 * CARDIO.srs : planificateur de répétition espacée (FSRS-4.5, poids par défaut FSRS-5).
 * Fonctions pures : aucune lecture d'état global, aucune dépendance au chargement.
 * Contrat : docs/SPEC.md §3.2 et §2.6.
 *
 * Modèle :
 *   R(t, S)  = (1 + FACTOR · t / S) ^ DECAY            (rétention à t jours pour une stabilité S)
 *   I(S, r)  = S / FACTOR · (r ^ (1 / DECAY) − 1)      (intervalle visé pour une rétention r ; I(S, 0.9) = S)
 *   S0(G)    = w[G−1]                                   (stabilité initiale)
 *   D0(G)    = w4 − (G − 3) · w5, borné 1..10           (difficulté initiale)
 *   D'       = D − w6 · (G − 3) ; D'' = w7 · D0(4) + (1 − w7) · D'  (réversion vers la moyenne)
 *   rappel   : S' = S · (e^w8 · (11 − D) · S^−w9 · (e^(w10·(1−R)) − 1) · [G=2 : w15] · [G=4 : w16] + 1)
 *   oubli    : S' = w11 · D^−w12 · ((S + 1)^w13 − 1) · e^(w14·(1−R))
 *   même jour: S' = S · e^(w17 · (G − 3 + w18))          (révision dans la même journée d'étude)
 *
 * Étapes d'apprentissage : « Encore » → 10 min (état learning/relearning, +1 lapse depuis review) ;
 * Difficile/Bien/Facile → sortie en « review » avec un intervalle entier ≥ 1 j et ≤ 365 j, fuzzé ±5 %
 * de façon déterministe à partir de l'id de carte (opts.seed) s'il est fourni.
 * Les échéances « review » tombent à 04 h 00 (heure locale) du jour visé : une carte prévue « demain »
 * est due toute la journée de demain, quelle que soit l'heure de la révision précédente.
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  CARDIO.views = CARDIO.views || {};

  const W = Object.freeze([
    0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0234, 1.616, 0.1544,
    1.0824, 1.9813, 0.0953, 0.2975, 2.2042, 0.2407, 2.9466, 0.5034, 0.6567
  ]);
  const DECAY = -0.5;
  const FACTOR = 19 / 81;

  const MIN_MS = 60 * 1000;
  const HOUR_MS = 60 * MIN_MS;
  const DAY_MS = 24 * HOUR_MS;
  const LEARNING_STEP_MS = 10 * MIN_MS;   // « Encore » → revoir dans 10 min
  const MIN_INTERVAL_DAYS = 1;
  const MAX_INTERVAL_DAYS = 365;
  const FUZZ = 0.05;                       // ±5 %
  const DAY_ROLLOVER_HOUR = 4;             // la journée d'étude commence à 04 h 00
  const HIST_MAX = 10;
  const DEFAULT_RETENTION = 0.9;

  const GRADES = Object.freeze({ AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 });
  const GRADE_LABELS = Object.freeze({ 1: 'Encore', 2: 'Difficile', 3: 'Bien', 4: 'Facile' });
  const STATES = ['new', 'learning', 'review', 'relearning'];

  /* ---------- utilitaires ---------- */

  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
  function round4(x) { return Math.round(x * 10000) / 10000; }
  function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
  function toNum(v, def) { const n = Number(v); return Number.isFinite(n) ? n : def; }

  function newState() {
    return { s: 0, d: 0, due: null, last: null, reps: 0, lapses: 0, state: 'new', hist: [] };
  }

  /* Copie assainie d'un état (jamais de mutation de l'entrée). */
  function normState(st) {
    const base = newState();
    if (!st || typeof st !== 'object') return base;
    const out = {
      s: Math.max(0, toNum(st.s, 0)),
      d: toNum(st.d, 0),
      due: finite(st.due) ? st.due : null,
      last: finite(st.last) ? st.last : null,
      reps: Math.max(0, Math.round(toNum(st.reps, 0))),
      lapses: Math.max(0, Math.round(toNum(st.lapses, 0))),
      state: STATES.indexOf(st.state) >= 0 ? st.state : (finite(st.last) ? 'review' : 'new'),
      hist: Array.isArray(st.hist) ? st.hist.filter(Array.isArray).slice(-HIST_MAX).map(function (h) {
        return [toNum(h[0], 0), Math.round(toNum(h[1], 3)), h[2] == null ? null : toNum(h[2], 0), h[3] == null ? null : toNum(h[3], 0)];
      }) : []
    };
    if (out.reps === 0 && out.last === null) out.state = 'new';
    return out;
  }

  /* ---------- formules FSRS ---------- */

  function initStability(g) { return W[g - 1]; }
  function initDifficulty(g) { return clamp(W[4] - (g - 3) * W[5], 1, 10); }
  function nextDifficulty(d, g) {
    const dp = d - W[6] * (g - 3);
    return clamp(W[7] * initDifficulty(4) + (1 - W[7]) * dp, 1, 10);
  }
  function forgettingCurve(tDays, s) {
    if (!(s > 0)) return 0;
    return Math.pow(1 + FACTOR * Math.max(0, tDays) / s, DECAY);
  }
  function stabilityAfterRecall(d, s, r, g) {
    const hardPenalty = g === GRADES.HARD ? W[15] : 1;
    const easyBonus = g === GRADES.EASY ? W[16] : 1;
    return s * (Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * hardPenalty * easyBonus + 1);
  }
  function stabilityAfterForget(d, s, r) {
    return W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r));
  }
  function stabilityShortTerm(s, g) {
    return s * Math.exp(W[17] * (g - 3 + W[18]));
  }
  function intervalFor(s, retention) {
    return s / FACTOR * (Math.pow(retention, 1 / DECAY) - 1);
  }

  /* ---------- fuzz déterministe ---------- */

  function hashSeed(seed) {
    if (typeof seed === 'number' && Number.isFinite(seed)) return (Math.floor(seed) >>> 0) || 0x9E3779B9;
    const str = String(seed);
    let h = 0x811c9dc5;                       // FNV-1a 32 bits
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
  function unit(h) {                          // mulberry32, un seul pas → [0, 1)
    let t = (h + 0x6D2B79F5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /* Facteur dans [0.95, 1.05] dérivé de la graine et du nombre de répétitions (varie d'une révision à
   * l'autre, mais reste identique entre l'aperçu et la révision réelle). */
  function fuzzFactor(seed, reps) {
    if (seed === undefined || seed === null || seed === '') return 1;
    const h = (hashSeed(seed) ^ Math.imul((reps | 0) + 1, 0x9E3779B9)) >>> 0;
    return 1 + (unit(h) * 2 - 1) * FUZZ;
  }

  /* ---------- journée d'étude (bascule à 04 h 00) ---------- */

  function studyDayStart(ms) {
    const d = new Date(ms);
    if (d.getHours() < DAY_ROLLOVER_HOUR) d.setDate(d.getDate() - 1);
    d.setHours(DAY_ROLLOVER_HOUR, 0, 0, 0);
    return d;
  }
  function studyDayKey(ms) {
    const d = studyDayStart(ms);
    const p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  /* Échéance à 04 h 00 du jour d'étude courant + `days` jours. */
  function dueForDays(nowMs, days) {
    const d = studyDayStart(nowMs);
    d.setDate(d.getDate() + days);
    return d.getTime();
  }
  /* Nombre de jours entre la journée d'étude de nowMs et l'échéance d'une carte en review. */
  function scheduledDays(state, nowMs) {
    const st = normState(state);
    if (st.due === null) return 0;
    return Math.round((st.due - dueForDays(nowMs, 0)) / DAY_MS);
  }

  /* ---------- API ---------- */

  function retrievability(state, nowMs) {
    const st = normState(state);
    if (st.last === null || !(st.s > 0)) return 0;
    const now = finite(nowMs) ? nowMs : Date.now();
    const t = Math.max(0, (now - st.last) / DAY_MS);
    return clamp(forgettingCurve(t, st.s), 0, 1);
  }

  function isDue(state, nowMs) {
    if (!state || typeof state !== 'object' || !finite(state.due)) return false;
    const now = finite(nowMs) ? nowMs : Date.now();
    return state.due <= now;
  }

  /* Révision : retourne un NOUVEL état (l'entrée n'est jamais modifiée).
   * opts : {retention (0.7..0.99, défaut 0.9), seed (id de carte → fuzz), score, ms (pour l'historique)} */
  function review(state, grade, nowMs, opts) {
    const o = opts || {};
    const st = normState(state);
    let g = Math.round(toNum(grade, GRADES.GOOD));
    if (!(g >= 1 && g <= 4)) g = GRADES.GOOD;
    const now = finite(nowMs) ? nowMs : Date.now();
    const retention = clamp(toNum(o.retention, DEFAULT_RETENTION), 0.7, 0.99);

    const isNew = st.state === 'new' || st.last === null || !(st.s > 0);
    const sameDay = !isNew && studyDayKey(st.last) === studyDayKey(now);
    const elapsedDays = isNew ? 0 : Math.max(0, (now - st.last) / DAY_MS);
    const r = isNew ? 0 : forgettingCurve(elapsedDays, st.s);
    const dPrev = st.d > 0 ? st.d : initDifficulty(GRADES.GOOD);

    /* Stabilité obtenue pour un grade donné (utilisée pour g, et pour « Bien » afin d'ordonner
     * les intervalles Difficile ≤ Bien < Facile). */
    function stabilityFor(gr) {
      if (isNew) return initStability(gr);
      if (sameDay) return stabilityShortTerm(st.s, gr);
      return gr === GRADES.AGAIN ? stabilityAfterForget(dPrev, st.s, r) : stabilityAfterRecall(dPrev, st.s, r, gr);
    }

    const d = isNew ? initDifficulty(g) : nextDifficulty(dPrev, g);
    const s = Math.max(0.01, stabilityFor(g));

    let nextState, due, lapses = st.lapses;
    if (g === GRADES.AGAIN) {
      if (st.state === 'review') lapses += 1;
      nextState = (isNew || st.state === 'learning') ? 'learning' : 'relearning';
      due = now + LEARNING_STEP_MS;
    } else {
      nextState = 'review';
      const fz = fuzzFactor(o.seed, st.reps);
      const daysFor = function (sv) {
        return clamp(Math.round(intervalFor(sv, retention) * fz), MIN_INTERVAL_DAYS, MAX_INTERVAL_DAYS);
      };
      let days = daysFor(s);
      if (g === GRADES.HARD) days = Math.min(days, daysFor(Math.max(0.01, stabilityFor(GRADES.GOOD))));
      if (g === GRADES.EASY) days = Math.max(days, daysFor(Math.max(0.01, stabilityFor(GRADES.GOOD))) + 1);
      days = clamp(days, MIN_INTERVAL_DAYS, MAX_INTERVAL_DAYS);
      due = dueForDays(now, days);
    }

    const score = finite(o.score) ? Math.round(clamp(o.score, 0, 1) * 100) / 100 : null;
    const ms = finite(o.ms) ? Math.max(0, Math.round(o.ms)) : null;
    const hist = st.hist.concat([[Math.round(now), g, score, ms]]).slice(-HIST_MAX);

    return {
      s: round4(s), d: round4(d), due: due, last: Math.round(now),
      reps: st.reps + 1, lapses: lapses, state: nextState, hist: hist
    };
  }

  /* ---------- formats français ---------- */

  function fmtDays(days) {
    const n = Math.max(1, Math.round(days));
    if (n < 30) return n + ' j';
    if (n < 365) return Math.max(1, Math.round(n / 30.4)) + ' mois';
    const years = Math.round(n / 365 * 10) / 10;
    return (years === 1 ? '1' : String(years).replace('.', ',')) + (years > 1 ? ' ans' : ' an');
  }
  function fmtInterval(ms) {
    const v = Math.max(0, toNum(ms, 0));
    if (v < HOUR_MS) return Math.max(1, Math.round(v / MIN_MS)) + ' min';
    if (v < DAY_MS) return Math.max(1, Math.round(v / HOUR_MS)) + ' h';
    return fmtDays(v / DAY_MS);
  }

  /* Aperçu des 4 issues : {1:'10 min', 2:'1 j', 3:'3 j', 4:'15 j'} (formaté en français). */
  function nextIntervalsPreview(state, nowMs, opts) {
    const now = finite(nowMs) ? nowMs : Date.now();
    const out = {};
    for (let g = 1; g <= 4; g++) {
      const ns = review(state, g, now, opts);
      out[g] = ns.state === 'review' ? fmtDays(scheduledDays(ns, now)) : fmtInterval(ns.due - now);
    }
    return out;
  }

  /* ---------- score → grade (SPEC §2.6) ---------- */

  /* Score EDN d'une QRM selon le nombre de discordances. */
  function ednScore(discordances) {
    const n = Math.max(0, Math.round(toNum(discordances, 0)));
    if (n === 0) return 1;
    if (n === 1) return 0.5;
    if (n === 2) return 0.2;
    return 0;
  }

  /* score ≥ 0.99 → Bien (Facile si répondu en < 40 % du temps médian et série ≥ 2) ;
   * 0.5 ≤ score < 0.99 → Difficile ; score < 0.5 → Encore. */
  function gradeFromScore(score, ctx) {
    const sc = toNum(score, NaN);
    if (!Number.isFinite(sc)) return GRADES.AGAIN;
    if (sc >= 0.99) {
      const c = ctx || {};
      const ms = toNum(c.ms, 0), med = toNum(c.medianMs, 0), streak = toNum(c.streak, 0);
      if (ms > 0 && med > 0 && ms < 0.4 * med && streak >= 2) return GRADES.EASY;
      return GRADES.GOOD;
    }
    if (sc >= 0.5) return GRADES.HARD;
    return GRADES.AGAIN;
  }

  CARDIO.srs = {
    GRADES: GRADES,
    GRADE_LABELS: GRADE_LABELS,
    STATES: STATES.slice(),
    W: W, DECAY: DECAY, FACTOR: FACTOR,
    LEARNING_STEP_MS: LEARNING_STEP_MS, DAY_MS: DAY_MS,
    MIN_INTERVAL_DAYS: MIN_INTERVAL_DAYS, MAX_INTERVAL_DAYS: MAX_INTERVAL_DAYS,
    newState: newState,
    normState: normState,
    review: review,
    retrievability: retrievability,
    nextIntervalsPreview: nextIntervalsPreview,
    isDue: isDue,
    gradeFromScore: gradeFromScore,
    ednScore: ednScore,
    scheduledDays: scheduledDays,
    studyDayKey: studyDayKey,
    fmtInterval: fmtInterval,
    fmtDays: fmtDays,
    gradeLabel: function (g) { return GRADE_LABELS[g] || ''; }
  };
})();
