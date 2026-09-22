/* CardioR2C — app/js/views/ecg.js
 *
 * Defines BOTH:
 *   CARDIO.ecg         — déclaratif → SVG : synthétiseur ECG 12 dérivations (SPEC §2.4).
 *     render(descriptor, opts) → SVGSVGElement      renderString(descriptor, opts) → string
 *     renderCompact(descriptor) → SVGSVGElement (6 lignes × 2 dérivations, téléphone)
 *     describe(descriptor) → [String] (phrases FR)  normal() → descripteur normal
 *     renderQuiz = CARDIO.views.ecg.renderQuiz (alias, pour le moteur de séance)
 *   CARDIO.views.ecg   — vues « #/ecg » (bibliothèque globale) et « #/item/:num/ecg ».
 *     render(params, query) → Promise<HTMLElement>
 *     renderQuiz(entry, {onGrade}) → HTMLElement
 *
 * Script classique ES2020, aucune dépendance au chargement : tout appel aux autres modules
 * (CARDIO.util, CARDIO.registry, CARDIO.store, CARDIO.srs, CARDIO.shell, CARDIO.router) se fait
 * à l'exécution, avec repli gracieux et console.warn si une fonction attendue est absente.
 *
 * Le moteur (§1) est pur et déterministe : mêmes descripteur + options → même SVG (seule source
 * d'aléa : CARDIO.util.seededRandom, jamais Math.random/Date.now dans le chemin de rendu).
 */
(function () {
  'use strict';

  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  CARDIO.views = CARDIO.views || {};

  /* ==================================================================== */
  /* 0. Accès défensif aux autres modules + petits utilitaires DOM          */
  /* ==================================================================== */

  const warned = {};
  function warnOnce(key, msg) {
    if (warned[key]) return;
    warned[key] = true;
    if (window.console && console.warn) console.warn('[views/ecg] ' + msg);
  }

  function util() { return (window.CARDIO && CARDIO.util) || null; }
  function registry() { return (window.CARDIO && CARDIO.registry) || null; }

  const SVG_TAG_SET = new Set([
    'svg', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'g', 'defs',
    'text', 'tspan', 'use', 'symbol', 'clipPath', 'mask', 'pattern', 'title'
  ]);
  const BOOL_ATTRS = new Set(['disabled', 'hidden', 'checked', 'selected', 'required', 'readonly', 'open', 'autofocus']);

  /** Constructeur DOM défensif : délègue à CARDIO.util.h (attrs = API native de util.h). */
  function h(tag, attrs, children) {
    const U = util();
    if (U && typeof U.h === 'function') return U.h(tag, attrs || {}, children);
    warnOnce('h', 'CARDIO.util.h absent : constructeur DOM de secours (rendu dégradé).');
    return fallbackH(tag, attrs, children);
  }
  function fallbackH(tag, attrs, children) {
    const el = SVG_TAG_SET.has(tag) ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach((k) => {
      const v = attrs[k];
      if (v == null) return;
      if (k === 'class' || k === 'className') { el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v)); return; }
      if (k === 'dataset') { Object.keys(v).forEach((dk) => { el.dataset[dk] = String(v[dk]); }); return; }
      if (k === 'style') { if (typeof v === 'string') el.style.cssText = v; return; }
      if (k === 'html') { el.innerHTML = String(v); return; }
      if (k === 'on') { Object.keys(v).forEach((evt) => el.addEventListener(evt, v[evt])); return; }
      if (BOOL_ATTRS.has(k)) { if (v) el.setAttribute(k, ''); return; }
      el.setAttribute(k, String(v));
    });
    fallbackAppend(el, children);
    return el;
  }
  function fallbackAppend(el, child) {
    if (child == null || child === false || child === true) return;
    if (Array.isArray(child)) { child.forEach((c) => fallbackAppend(el, c)); return; }
    if (child instanceof Node) { el.appendChild(child); return; }
    el.appendChild(document.createTextNode(String(child)));
  }

  function esc(s) {
    const U = util();
    if (U && typeof U.esc === 'function') return U.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function mdHtml(text) {
    const U = util();
    if (U && typeof U.md === 'function') return U.md(text || '');
    warnOnce('md', 'CARDIO.util.md absent : rendu markdown minimal.');
    return String(text || '').split(/\n{2,}/).map((p) => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('');
  }
  function mdBlock(text, cls) {
    const d = h('div', { class: 'md' + (cls ? ' ' + cls : '') });
    d.innerHTML = mdHtml(text);
    return d;
  }
  function pill(text, mod) { return h('span', { class: 'pill' + (mod ? ' pill--' + mod : '') }, text); }
  function rankPill(rank) { const r = rank === 'B' ? 'B' : 'A'; return h('span', { class: 'pill pill--' + r, title: 'Rang ' + r }, r); }

  function seedOf(str) {
    const s = String(str || 'ecg');
    let hsh = 2166136261;
    for (let i = 0; i < s.length; i++) { hsh ^= s.charCodeAt(i); hsh = Math.imul(hsh, 16777619) >>> 0; }
    return hsh >>> 0;
  }
  function seededRandomLocal(seed) {
    const U = util();
    if (U && typeof U.seededRandom === 'function') return U.seededRandom(seed);
    let a = (typeof seed === 'number' ? seed : seedOf(seed)) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, seed) {
    const U = util();
    if (U && typeof U.shuffle === 'function') {
      try { const out = U.shuffle(arr.slice(), seed); if (Array.isArray(out) && out.length === arr.length) return out; } catch (e) { /* repli */ }
    }
    const a = arr.slice();
    const rnd = seededRandomLocal(seed);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function nowMs() { const U = util(); return (U && typeof U.now === 'function') ? U.now() : Date.now(); }
  function toast(msg, tone) { const S = window.CARDIO && CARDIO.shell; if (S && typeof S.toast === 'function') S.toast(msg, { tone: tone || 'info' }); }
  function haptic() {
    try {
      const st = window.CARDIO && CARDIO.store && CARDIO.store.state;
      const on = !st || !st.profile || st.profile.haptics !== false;
      if (on && navigator.vibrate) navigator.vibrate(10);
    } catch (e) { /* silencieux */ }
  }
  function scrollTop() {
    const v = document.getElementById('view');
    if (v) v.scrollTop = 0;
    try { window.scrollTo(0, 0); } catch (e) { /* silencieux */ }
  }
  function clampNum(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }
  function has(list, name) { return Array.isArray(list) && list.indexOf(name) >= 0; }
  function num(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
  }

  /* ==================================================================== */
  /* 1. CARDIO.ecg — synthétiseur (moteur pur, déterministe)                */
  /* ==================================================================== */

  const LEAD_NAMES = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
  const LEADS_BY_COL = [['I', 'II', 'III'], ['aVR', 'aVL', 'aVF'], ['V1', 'V2', 'V3'], ['V4', 'V5', 'V6']];
  const LEADS_COMPACT = [['I', 'aVR'], ['II', 'aVL'], ['III', 'aVF'], ['V1', 'V4'], ['V2', 'V5'], ['V3', 'V6']];
  const LIMB_ANGLE = { I: 0, II: 60, III: 120, aVR: -150, aVL: -30, aVF: 90 };
  const PRECORDIAL = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
  const R_CANON = [0.15, 0.30, 0.65, 1.15, 1.65, 1.35];
  const S_CANON = [1.00, 1.15, 0.70, 0.35, 0.15, 0.05];
  const P_POLARITY = { I: 1, II: 1, III: 0.6, aVR: -1, aVL: 0.35, aVF: 0.9, V1: 0.4, V2: 0.55, V3: 0.55, V4: 0.5, V5: 0.5, V6: 0.45 };

  const PX_PER_MM = 3.2;       // résolution interne (unités SVG par mm de « papier »)
  const SAMPLE_HZ = 200;       // fréquence d'échantillonnage du tracé (points par seconde)
  const SAMPLE_DT = 1 / SAMPLE_HZ;

  const RHYTHM_FR = {
    sinus: 'Rythme sinusal', sinusBrady: 'Bradycardie sinusale', sinusTachy: 'Tachycardie sinusale',
    af: 'Fibrillation atriale', flutter: 'Flutter atrial', atrialTachy: 'Tachycardie atriale',
    svt: 'Tachycardie jonctionnelle (SVT)', junctional: 'Rythme jonctionnel',
    vt: 'Tachycardie ventriculaire', vtPolymorphic: 'TV polymorphe', torsades: 'Torsades de pointes',
    vf: 'Fibrillation ventriculaire', asystole: 'Asystolie', paced: 'Rythme électro-entraîné',
    idioventricular: 'Rythme idioventriculaire', wpw: 'Pré-excitation (WPW)'
  };
  const AVBLOCK_FR = { none: '', '1': 'bloc AV du 1er degré', '2m1': 'BAV 2 Mobitz I (Wenckebach)', '2m2': 'BAV 2 Mobitz II', '2:1': 'BAV 2:1', '3': 'BAV complet (3e degré)' };
  const BBB_FR = { none: '', rbbb: 'bloc de branche droit', lbbb: 'bloc de branche gauche', irbbb: 'bloc incomplet droit', ilbbb: 'bloc incomplet gauche', lahb: 'hémibloc antérieur gauche', lphb: 'hémibloc postérieur gauche', bifascicular: 'bloc bifasciculaire' };
  const ECTOPY_FR = { none: 'aucune', pvc: 'extrasystoles ventriculaires', pac: 'extrasystoles atriales', pjc: 'extrasystoles jonctionnelles' };

  /* ---------------------------------------------------------------- */
  /* 1.1 Normalisation du descripteur                                    */
  /* ---------------------------------------------------------------- */

  function normalizeDescriptor(input) {
    const src = input && typeof input === 'object' ? input : {};
    let d;
    try { d = JSON.parse(JSON.stringify(src)); } catch (e) { d = Object.assign({}, src); }
    d.rhythm = String(d.rhythm || 'sinus');
    d.rate = clampNum(d.rate, 15, 320, 75);
    d.irregular = !!d.irregular;
    d.p = Object.assign({ present: true, amp: 0.15, dur: 0.09, inverted: [], biphasicV1: false, wide: false }, d.p || {});
    d.p.inverted = Array.isArray(d.p.inverted) ? d.p.inverted : [];
    d.pr = clampNum(d.pr, 0.04, 0.44, 0.16);
    d.avBlock = d.avBlock || 'none';
    d.ratio = d.ratio || '1:1';
    d.qrs = Object.assign({ dur: 0.09, bbb: 'none', lvh: false, rvh: false, delta: false, axis: 60, qWaves: [], lowVoltage: false, rsRatioV1: 0.2, pathologicR: [] }, d.qrs || {});
    d.qrs.qWaves = Array.isArray(d.qrs.qWaves) ? d.qrs.qWaves : [];
    d.qrs.pathologicR = Array.isArray(d.qrs.pathologicR) ? d.qrs.pathologicR : [];
    d.qrs.dur = clampNum(d.qrs.dur, 0.04, 0.24, 0.09);
    d.qrs.axis = clampNum(d.qrs.axis, -180, 180, 60);
    d.st = Object.assign({ elev: {}, dep: {}, shape: 'normal' }, d.st || {});
    d.st.elev = (d.st.elev && typeof d.st.elev === 'object') ? d.st.elev : {};
    d.st.dep = (d.st.dep && typeof d.st.dep === 'object') ? d.st.dep : {};
    d.t = Object.assign({ inverted: [], peaked: false, flat: false, amp: 0.3 }, d.t || {});
    d.t.inverted = Array.isArray(d.t.inverted) ? d.t.inverted : [];
    d.qt = clampNum(d.qt, 0.24, 0.70, 0.40);
    d.u = !!d.u;
    d.prDep = !!d.prDep;
    d.ectopy = Object.assign({ type: 'none', every: 0, bigeminy: false, run: 0 }, d.ectopy || {});
    d.pause = clampNum(d.pause, 0, 6, 0);
    d.pacer = Object.assign({ mode: 'none' }, d.pacer || {});
    d.notes = d.notes ? String(d.notes) : '';
    return d;
  }

  function seedFromDescriptor(d) {
    try { return seedOf(JSON.stringify(d)); } catch (e) { return seedOf(d && d.rhythm); }
  }

  function synthNormal() {
    return normalizeDescriptor({
      rhythm: 'sinus', rate: 75, irregular: false,
      p: { present: true, amp: 0.15, dur: 0.09, inverted: [], biphasicV1: false, wide: false },
      pr: 0.16, avBlock: 'none', ratio: '1:1',
      qrs: { dur: 0.09, bbb: 'none', lvh: false, rvh: false, delta: false, axis: 60, qWaves: [], lowVoltage: false, rsRatioV1: 0.2, pathologicR: [] },
      st: { elev: {}, dep: {}, shape: 'normal' }, t: { inverted: [], peaked: false, flat: false, amp: 0.3 },
      qt: 0.40, u: false, prDep: false, ectopy: { type: 'none', every: 0, bigeminy: false, run: 0 },
      pause: 0, pacer: { mode: 'none' }, notes: 'Tracé normal.'
    });
  }

  /* ---------------------------------------------------------------- */
  /* 1.2 Profil de morphologie QRS/P/ST/T par dérivation                 */
  /* ---------------------------------------------------------------- */

  function buildQrsSegments(a) {
    const hasQ = Math.abs(a.qAmp) > 0.012;
    const hasS = Math.abs(a.sAmp) > 0.012;
    const hasR2 = Math.abs(a.r2Amp) > 0.012;
    let wQ = hasQ ? 0.16 : 0, wR2 = hasR2 ? 0.28 : 0, wS = hasS ? 0.32 : 0;
    let wR = Math.max(0.24, 1 - wQ - wS - wR2);
    const total = wQ + wR + wS + wR2 || 1;
    wQ /= total; wR /= total; wS /= total; wR2 /= total;
    const segs = [];
    let cursor = 0;
    if (hasQ) { segs.push({ type: 'q', start: cursor, width: wQ, amp: -Math.abs(a.qAmp) }); cursor += wQ; }
    segs.push({ type: 'r', start: cursor, width: wR, amp: a.rAmp, notch: !!a.notch }); cursor += wR;
    if (hasS) { segs.push({ type: 's', start: cursor, width: wS, amp: -Math.abs(a.sAmp) }); cursor += wS; }
    if (hasR2) { segs.push({ type: 'r2', start: cursor, width: wR2, amp: Math.abs(a.r2Amp) }); cursor += wR2; }
    return segs;
  }

  /** computeLeadProfile(lead, d) → morphologie mV + polarités P/T pour une dérivation donnée. */
  function computeLeadProfile(lead, d) {
    const qrs = d.qrs;
    const isLimb = LIMB_ANGLE.hasOwnProperty(lead);
    const voltScale = qrs.lowVoltage ? 0.4 : 1;
    let qAmp = 0, rAmp = 0, sAmp = 0, r2Amp = 0, notch = false;
    const slur = !!(qrs.delta || d.rhythm === 'wpw');

    if (isLimb) {
      const proj = Math.cos((LIMB_ANGLE[lead] - qrs.axis) * Math.PI / 180);
      const base = lead === 'II' ? 1.05 : 0.95;
      rAmp = base * Math.max(0, proj) + 0.05;
      sAmp = base * Math.max(0, -proj) + 0.05;
      qAmp = (lead === 'I' || lead === 'aVL' || lead === 'II') ? Math.min(0.09, rAmp * 0.10) : 0.02;
    } else {
      const idx = PRECORDIAL.indexOf(lead);
      const ratio0 = clampNum(qrs.rsRatioV1, 0.03, 3, 0.2);
      const scaleR = ratio0 / (R_CANON[0] / S_CANON[0]);
      rAmp = R_CANON[idx] * scaleR;
      sAmp = S_CANON[idx];
      qAmp = idx >= 4 ? 0.08 : 0.015;
    }

    if (has(qrs.qWaves, lead)) qAmp = Math.max(qAmp, 0.35);
    if (has(qrs.pathologicR, lead)) rAmp *= 1.7;
    if (qrs.lvh) {
      if (lead === 'V1' || lead === 'V2') sAmp *= 1.6;
      if (lead === 'V5' || lead === 'V6') rAmp *= 1.35;
      if (lead === 'I' || lead === 'aVL') rAmp *= 1.15;
    }
    if (qrs.rvh) {
      if (lead === 'V1') { rAmp = rAmp * 2.1 + 0.3; sAmp *= 0.5; }
      if (lead === 'aVR') rAmp *= 1.35;
    }

    const bbb = qrs.bbb || 'none';
    let forceDiscordant = false;
    if (bbb === 'rbbb' || bbb === 'irbbb') {
      const k = bbb === 'rbbb' ? 1 : 0.55;
      if (lead === 'V1' || lead === 'V2') r2Amp = Math.max(r2Amp, (rAmp + 0.3) * k);
      if (lead === 'I' || lead === 'V6') sAmp += 0.35 * k;
    }
    if (bbb === 'lbbb' || bbb === 'ilbbb') {
      const k = bbb === 'lbbb' ? 1 : 0.55;
      if (lead === 'V1' || lead === 'V2' || lead === 'V3') { rAmp *= (1 - 0.85 * k); sAmp = Math.max(sAmp, 1.1 * k); }
      if (lead === 'I' || lead === 'aVL' || lead === 'V5' || lead === 'V6') { if (k > 0.7) notch = true; rAmp = Math.max(rAmp, 1.1 * k); qAmp = 0; }
      forceDiscordant = true;
    }
    if (bbb === 'lahb' || bbb === 'bifascicular') {
      if (lead === 'I' || lead === 'aVL') { qAmp = Math.max(qAmp, 0.12); rAmp = Math.max(rAmp, 0.9); sAmp = Math.min(sAmp, 0.15); }
      if (lead === 'II' || lead === 'III' || lead === 'aVF') { rAmp = Math.min(rAmp, 0.25); sAmp = Math.max(sAmp, 0.7); }
    }
    if (bbb === 'lphb') {
      if (lead === 'II' || lead === 'III' || lead === 'aVF') { qAmp = Math.max(qAmp, 0.10); rAmp = Math.max(rAmp, 0.9); }
      if (lead === 'I' || lead === 'aVL') { rAmp = Math.min(rAmp, 0.25); sAmp = Math.max(sAmp, 0.7); }
    }
    if (bbb === 'bifascicular') {
      if (lead === 'V1' || lead === 'V2') r2Amp = Math.max(r2Amp, rAmp + 0.3);
      if (lead === 'I' || lead === 'V6') sAmp += 0.35;
    }

    qAmp *= voltScale; rAmp *= voltScale; sAmp *= voltScale; r2Amp *= voltScale;
    const netPolarity = (rAmp + r2Amp * 0.6) - sAmp - qAmp * 0.5;

    const pInv = has(d.p.inverted, lead) ? -1 : 1;
    const pSign = (P_POLARITY[lead] >= 0 ? 1 : -1) * pInv;
    const pMag = Math.abs(P_POLARITY[lead]) * voltScale;

    const elev = Number(d.st.elev[lead]) || 0;
    const dep = Number(d.st.dep[lead]) || 0;
    const stMv = (elev - dep) * 0.1; // 1 mm ≙ 0,1 mV à un gain standard

    const tFlip = has(d.t.inverted, lead);
    const tBaseSign = netPolarity >= 0 ? 1 : -1;
    let tMag = Math.max(0, d.t.amp);
    if (d.t.peaked) tMag *= 1.45;
    if (d.t.flat) tMag *= 0.25;
    tMag *= voltScale;

    return {
      lead, qAmp, rAmp, sAmp, r2Amp, notch, slur, netPolarity, voltScale,
      pSign, pMag, stMv, tBaseSign, tFlip, forceDiscordant, tMag,
      segs: buildQrsSegments({ qAmp, rAmp, sAmp, r2Amp, notch })
    };
  }

  /* ---------------------------------------------------------------- */
  /* 1.3 Composants d'onde (gaussiennes / demi-sinus)                    */
  /* ---------------------------------------------------------------- */

  function gaussWave(t, center, duration, amp) {
    if (!duration || duration <= 0 || !amp) return 0;
    const sigma = duration / 4;
    const z = (t - center) / sigma;
    return amp * Math.exp(-0.5 * z * z);
  }

  function qrsShapeAt(f, segs) {
    let v = 0;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (f < s.start || f > s.start + s.width) continue;
      const lf = s.width > 0 ? (f - s.start) / s.width : 0;
      let bump = Math.sin(Math.PI * Math.min(1, Math.max(0, lf))) * s.amp;
      if (s.notch) bump -= Math.exp(-Math.pow((lf - 0.5) / 0.14, 2)) * Math.abs(s.amp) * 0.32;
      v += bump;
    }
    return v;
  }

  function stShapeCurve(p, shape, off) {
    p = Math.min(1, Math.max(0, p));
    switch (shape) {
      case 'concave': return off * Math.sin(Math.PI * 0.5 * p);
      case 'convex': return off * (1 - Math.pow(1 - p, 2.2));
      case 'coved': return off * (Math.sin(Math.PI * p) * 0.7 + p * 0.5);
      case 'downsloping': return off * (1 - p * 0.75) + off * 0.15;
      case 'horizontal': return off;
      case 'saddle': return off * (0.35 - 0.35 * Math.cos(4 * Math.PI * p));
      default: return off * p; // 'normal' : légère pente ascendante vers l'isoélectrique
    }
  }

  /** pComponent(t, pEvt, lead, d, profile) → contribution (mV) d'une onde P (ou d'un spike) à l'instant t. */
  function pComponent(t, pEvt, lead, d, profile) {
    let v = 0;
    if (pEvt.spike) {
      const dt = t - pEvt.t;
      if (dt >= -0.002 && dt <= 0.009) v += 1.5 * Math.max(0, 1 - Math.abs(dt - 0.0035) / 0.006);
      if (pEvt.tiny) return v;
    }
    if (!pEvt.forceDraw && d.p.present === false) return v;
    const ampScale = pEvt.ampScale != null ? pEvt.ampScale : 1;
    const dur = Math.max(0.04, d.p.dur) * (pEvt.wide ? 1.35 : 1);
    const anchor = pEvt.spike ? pEvt.t + 0.02 : pEvt.t;
    const signedMag = profile.pSign * profile.pMag * Math.max(0, d.p.amp) * ampScale; // profile.pMag = facteur relatif 0..1 par dérivation
    if (lead === 'V1' && d.p.biphasicV1 && !pEvt.spike) {
      const half = dur / 2;
      v += gaussWave(t, anchor - half * 0.32, half * 0.9, Math.abs(signedMag) * 0.55);
      v += gaussWave(t, anchor + half * 0.5, half * 1.05, -Math.abs(signedMag) * 0.9 - 0.04);
      return v;
    }
    v += gaussWave(t, anchor, dur, signedMag);
    return v;
  }

  function qrsComplexComponent(t, qEvt, lead, d, profile) {
    let v = 0;
    const dur = qEvt.qrsDur || d.qrs.dur;
    const f = (t - qEvt.t) / dur;
    if (f >= -0.06 && f <= 1.06) {
      const shape = qEvt.flip ? profile.segs.map((s) => Object.assign({}, s, { amp: -s.amp })) : profile.segs;
      v += qrsShapeAt(Math.min(1, Math.max(0, f)), shape) * (qEvt.ampScale || 1);
      if ((qEvt.slur || profile.slur) && f >= -0.06 && f < 0.16) {
        const firstAmp = Math.abs(profile.segs[0] ? profile.segs[0].amp : profile.rAmp);
        v += 0.3 * firstAmp * Math.max(0, Math.sin(Math.PI * ((f + 0.06) / 0.22)));
      }
    }
    if (qEvt.isPaced) {
      const spikeT = qEvt.t - 0.004;
      const dt = t - spikeT;
      if (dt >= -0.002 && dt <= 0.008) v += 1.6 * Math.max(0, 1 - Math.abs(dt - 0.003) / 0.005);
    }
    if (d.prDep && t < qEvt.t && t > qEvt.t - 0.09) v += -0.05 * profile.voltScale;

    // ST + T + U (à partir du point J)
    const jT = qEvt.t + dur;
    const qtSec = qEvt.qt || d.qt;
    const tEnd = qEvt.t + qtSec;
    if (t >= jT - 0.01 && t <= tEnd + 0.14) {
      const stOff = profile.stMv;
      const shape = d.st.shape || 'normal';
      const stDur = Math.max(0.03, (tEnd - jT) * 0.40);
      const stEnd = jT + stDur;
      if (t <= stEnd) v += stShapeCurve((t - jT) / Math.max(0.001, stDur), shape, stOff);
      else v += stOff;
      const flip = profile.tFlip || qEvt.discordant || profile.forceDiscordant;
      const tSign = flip ? -profile.tBaseSign : profile.tBaseSign;
      const tCenter = jT + (tEnd - jT) * 0.72;
      const tDur = Math.max(0.10, (tEnd - jT) * 0.58);
      v += gaussWave(t, tCenter, tDur, tSign * profile.tMag);
      if (d.u) v += gaussWave(t, tEnd + 0.09, 0.12, (tSign >= 0 ? 1 : -1) * 0.06 * profile.voltScale);
    }
    return v;
  }

  /* ---------------------------------------------------------------- */
  /* 1.4 Ordonnancement des battements (rythmes, blocs, extrasystoles)   */
  /* ---------------------------------------------------------------- */

  function makeEctopyState(ectopy) {
    const type = (ectopy && ectopy.type) || 'none';
    if (type === 'none') return null;
    const bigeminy = !!(ectopy && ectopy.bigeminy);
    const every = (ectopy && ectopy.every > 0) ? ectopy.every : (bigeminy ? 2 : 4);
    const run = (ectopy && ectopy.run > 1) ? ectopy.run : 0;
    return { type, every, run, n: 0, remaining: 0 };
  }
  function nextEctopy(state) {
    if (!state) return null;
    state.n++;
    if (state.remaining > 0) { state.remaining--; return state.type; }
    if (state.n % state.every === 0) {
      if (state.run > 1) state.remaining = state.run - 1;
      return state.type;
    }
    return null;
  }

  function genSinusFamily(sched, duration, rr, pr, d, ecto, qrsDurBase) {
    const avBlock = d.avBlock || 'none';
    const wpw = d.rhythm === 'wpw' || !!d.qrs.delta;
    let cycleTotal = 0, cycleConduct = 0;
    if (avBlock === '2m1') { const parts = String(d.ratio || '4:3').split(':').map(Number); cycleTotal = parts[0] || 4; cycleConduct = (parts[1] != null ? parts[1] : cycleTotal - 1); }
    if (avBlock === '2m2') { const parts = String(d.ratio || '3:2').split(':').map(Number); cycleTotal = parts[0] || 3; cycleConduct = parts[1] || 2; }
    const pPresent = d.p.present !== false;
    let t = 0.08, idx = 0;
    while (t < duration) {
      idx++;
      let conducts = true, thisPR = pr;
      if (avBlock === '1') thisPR = Math.max(pr, 0.22);
      if (avBlock === '2:1') conducts = (idx % 2 === 1);
      if (avBlock === '2m2' && cycleTotal) { const pos = ((idx - 1) % cycleTotal) + 1; conducts = pos <= cycleConduct; }
      if (avBlock === '2m1' && cycleTotal) { const pos = ((idx - 1) % cycleTotal) + 1; conducts = pos <= cycleConduct; if (conducts) thisPR = pr + (pos - 1) * 0.045; }
      if (avBlock === '3') conducts = false;
      if (pPresent) sched.pEvents.push({ t });
      if (conducts) {
        const ect = nextEctopy(ecto);
        if (ect === 'pvc') {
          sched.qrsEvents.push({ t: t + thisPR + 0.02, qrsDur: Math.max(qrsDurBase * 1.55, 0.14), ampScale: 1.5, discordant: true, ectopic: 'pvc' });
        } else if (ect === 'pac') {
          sched.qrsEvents.push({ t: t + thisPR, qrsDur: qrsDurBase, ampScale: 1, discordant: false, ectopic: 'pac' });
        } else if (ect === 'pjc') {
          sched.qrsEvents.push({ t: t + Math.min(thisPR, 0.09), qrsDur: qrsDurBase, ampScale: 1, discordant: false, ectopic: 'pjc' });
        } else {
          sched.qrsEvents.push({ t: t + thisPR, qrsDur: qrsDurBase, ampScale: 1, discordant: false, slur: wpw });
        }
      }
      t += rr;
    }
    if (avBlock === '3') {
      const wide = qrsDurBase >= 0.12;
      const escRate = wide ? 30 : 40;
      const escRR = 60 / escRate;
      let et = 0.35;
      while (et < duration) {
        sched.qrsEvents.push({ t: et, qrsDur: wide ? Math.max(qrsDurBase, 0.14) : Math.min(qrsDurBase, 0.09), ampScale: wide ? 1.2 : 1, discordant: wide, ectopic: 'escape' });
        et += escRR;
      }
    }
  }

  function genRegular(sched, duration, rr, qrsDur, ecto, extra) {
    extra = extra || {};
    let t = 0.08;
    while (t < duration) {
      const ect = nextEctopy(ecto);
      if (ect === 'pvc') {
        sched.qrsEvents.push({ t, qrsDur: Math.max(qrsDur * 1.5, 0.14), ampScale: 1.5, discordant: true, ectopic: 'pvc' });
        t += rr * 1.35;
      } else if (ect === 'pac') {
        sched.qrsEvents.push(Object.assign({}, extra, { t, qrsDur, ectopic: 'pac' }));
        t += rr * 0.95;
      } else if (ect === 'pjc') {
        sched.qrsEvents.push(Object.assign({}, extra, { t, qrsDur, ectopic: 'pjc' }));
        t += rr * 0.95;
      } else {
        sched.qrsEvents.push(Object.assign({}, extra, { t, qrsDur }));
        t += rr;
      }
    }
  }

  function genIrregular(sched, duration, meanRate, rng, qrsDur) {
    let t = 0.08;
    const meanRR = 60 / meanRate;
    while (t < duration) {
      sched.qrsEvents.push({ t, qrsDur, ampScale: 1, discordant: false });
      const jitter = 0.5 + rng() * 1.0;
      t += Math.max(0.26, meanRR * jitter);
    }
  }

  function genPaced(sched, duration, rr, qrsDurBase, pacer) {
    const mode = (pacer && pacer.mode && pacer.mode !== 'none') ? pacer.mode : 'VVI';
    let t = 0.08;
    while (t < duration) {
      if (mode === 'AAI') {
        sched.pEvents.push({ t, spike: true });
        sched.qrsEvents.push({ t: t + 0.16, qrsDur: Math.min(qrsDurBase, 0.09), ampScale: 1, discordant: false });
      } else if (mode === 'DDD') {
        sched.pEvents.push({ t, spike: true, tiny: true });
        sched.qrsEvents.push({ t: t + 0.15, qrsDur: Math.max(qrsDurBase, 0.14), ampScale: 1.2, discordant: true, isPaced: true });
      } else {
        sched.qrsEvents.push({ t, qrsDur: Math.max(qrsDurBase, 0.14), ampScale: 1.2, discordant: true, isPaced: true });
      }
      t += rr;
    }
    if (mode === 'VVI') sched.suppressP = true;
  }

  function genTwisting(sched, duration, rr, qrsDur) {
    let t = 0.08, i = 0;
    while (t < duration) {
      sched.qrsEvents.push({ t, qrsDur, ampScale: 1.1 + 0.45 * Math.abs(Math.sin(i / 2.2)), discordant: true, flip: Math.sin(i / 2.2) < 0 });
      t += rr * (0.92 + 0.14 * Math.abs(Math.sin(i * 1.3)));
      i++;
    }
  }

  function fibrillationBaseline(rng) {
    const ph = {};
    return function (t, lead) {
      if (ph[lead] == null) ph[lead] = rng() * Math.PI * 2;
      const boost = (lead === 'II' || lead === 'III' || lead === 'aVF' || lead === 'V1') ? 1.5 : 1;
      const s = ph[lead];
      return boost * 0.045 * (Math.sin(2 * Math.PI * 7.6 * t + s) * 0.5 + Math.sin(2 * Math.PI * 5.3 * t + s * 1.7) * 0.3 + Math.sin(2 * Math.PI * 11 * t + s * 0.6) * 0.2);
    };
  }
  function flutterBaseline(atrialRate) {
    const freq = atrialRate / 60;
    return function (t, lead) {
      const boost = (lead === 'II' || lead === 'III' || lead === 'aVF' || lead === 'V1') ? 1 : 0.22;
      const phase = (t * freq) % 1;
      return boost * 0.22 * (1 - 2 * phase);
    };
  }
  function chaosBaseline(rng) {
    const ph = {}, amps = {};
    return function (t, lead) {
      if (ph[lead] == null) { ph[lead] = rng() * Math.PI * 2; amps[lead] = 0.22 + rng() * 0.32; }
      const a = amps[lead], p = ph[lead];
      return a * (Math.sin(2 * Math.PI * 3.3 * t + p) + Math.sin(2 * Math.PI * 5.1 * t + p * 1.3) * 0.6 + Math.sin(2 * Math.PI * 8.7 * t + p * 0.4) * 0.4) / 1.6;
    };
  }
  function flatlineNoise(rng) {
    const ph = {};
    return function (t, lead) {
      if (ph[lead] == null) ph[lead] = rng() * Math.PI * 2;
      return 0.015 * Math.sin(2 * Math.PI * 1.7 * t + ph[lead]);
    };
  }

  function applyPause(sched, pauseSec, duration) {
    const p = Number(pauseSec) || 0;
    if (p <= 0) return;
    const at = duration * 0.42;
    function shift(list) { for (let i = 0; i < list.length; i++) if (list[i].t >= at) list[i].t += p; }
    shift(sched.qrsEvents); shift(sched.pEvents);
  }

  /** buildSchedule(d, duration, rng) → {pEvents, qrsEvents, baseline, suppressP}. */
  function buildSchedule(d, duration, rng) {
    const sched = { pEvents: [], qrsEvents: [], baseline: null, suppressP: false };
    const rhythm = d.rhythm || 'sinus';
    const qrsDurBase = d.qrs.dur;
    const rate = d.rate;
    const rr = 60 / rate;
    const pr = d.pr;
    const ecto = makeEctopyState(d.ectopy);

    switch (rhythm) {
      case 'af':
        genIrregular(sched, duration, rate, rng, qrsDurBase);
        sched.suppressP = true;
        sched.baseline = fibrillationBaseline(rng);
        break;
      case 'flutter': {
        const parts = String(d.ratio || '2:1').split(':').map(Number);
        const num0 = parts[0] || 2;
        genRegular(sched, duration, rr, Math.min(qrsDurBase, 0.10), ecto, {});
        sched.suppressP = true;
        sched.baseline = flutterBaseline(rate * num0);
        break;
      }
      case 'vf':
        sched.baseline = chaosBaseline(rng);
        sched.suppressP = true;
        break;
      case 'asystole':
        sched.baseline = flatlineNoise(rng);
        sched.suppressP = true;
        break;
      case 'svt':
        genRegular(sched, duration, rr, Math.min(qrsDurBase, 0.09), ecto, {});
        sched.suppressP = true;
        break;
      case 'junctional':
        genRegular(sched, duration, rr, Math.min(qrsDurBase, 0.10), ecto, {});
        if (d.p.present !== false) sched.qrsEvents.forEach((q) => sched.pEvents.push({ t: q.t + 0.06, forceDraw: true, ampScale: 0.8 }));
        else sched.suppressP = true;
        break;
      case 'vt':
        genRegular(sched, duration, rr, Math.max(qrsDurBase, 0.14), ecto, { discordant: true, ampScale: 1.35 });
        { let t = 0.15; const dRR = 60 / 80; while (t < duration) { sched.pEvents.push({ t, forceDraw: true, ampScale: 0.55, dissociated: true }); t += dRR; } }
        break;
      case 'idioventricular':
        genRegular(sched, duration, rr, Math.max(qrsDurBase, 0.14), ecto, { discordant: true, ampScale: 1.15 });
        sched.suppressP = true;
        break;
      case 'vtPolymorphic':
      case 'torsades':
        genTwisting(sched, duration, rr, Math.max(qrsDurBase, 0.14));
        sched.suppressP = true;
        break;
      case 'paced':
        genPaced(sched, duration, rr, qrsDurBase, d.pacer);
        break;
      case 'atrialTachy':
      case 'wpw':
      case 'sinus':
      case 'sinusBrady':
      case 'sinusTachy':
      default:
        genSinusFamily(sched, duration, rr, pr, d, ecto, qrsDurBase);
        break;
    }
    applyPause(sched, d.pause, duration);
    return sched;
  }

  function leadAmplitudeAt(lead, t, d, schedule, profile) {
    let mv = 0;
    if (schedule.baseline) mv += schedule.baseline(t, lead);
    if (!schedule.suppressP) {
      for (let i = 0; i < schedule.pEvents.length; i++) {
        const p = schedule.pEvents[i];
        if (t < p.t - 0.22 || t > p.t + 0.30) continue;
        mv += pComponent(t, p, lead, d, profile);
      }
    }
    for (let i = 0; i < schedule.qrsEvents.length; i++) {
      const q = schedule.qrsEvents[i];
      const span = (q.qrsDur || d.qrs.dur) + (q.qt || d.qt) + 0.2;
      if (t < q.t - 0.10 || t > q.t + span) continue;
      mv += qrsComplexComponent(t, q, lead, d, profile);
    }
    return Number.isFinite(mv) ? mv : 0;
  }

  /* ---------------------------------------------------------------- */
  /* 1.5 Rendu SVG : grille, calibration, tracés                        */
  /* ---------------------------------------------------------------- */

  function pathFromSamples(points) {
    if (!points.length) return '';
    let d = 'M ' + num(points[0][0]) + ' ' + num(points[0][1]);
    for (let i = 1; i < points.length; i++) d += ' L ' + num(points[i][0]) + ' ' + num(points[i][1]);
    return d;
  }

  function buildGrid(widthMm, heightMm, pxPerMm) {
    const wPx = widthMm * pxPerMm, hPx = heightMm * pxPerMm;
    const fine = [], strong = [];
    const wR = Math.round(widthMm), hR = Math.round(heightMm);
    for (let x = 0; x <= wR; x++) {
      const px = num(x * pxPerMm);
      (x % 5 === 0 ? strong : fine).push('M ' + px + ' 0 L ' + px + ' ' + num(hPx));
    }
    for (let y = 0; y <= hR; y++) {
      const py = num(y * pxPerMm);
      (y % 5 === 0 ? strong : fine).push('M 0 ' + py + ' L ' + num(wPx) + ' ' + py);
    }
    return { fine: fine.join(' '), strong: strong.join(' '), wPx: num(wPx), hPx: num(hPx) };
  }

  function gridNodes(widthMm, heightMm) {
    const grid = buildGrid(widthMm, heightMm, PX_PER_MM);
    return {
      wPx: grid.wPx, hPx: grid.hPx,
      nodes: [
        h('rect', { x: 0, y: 0, width: grid.wPx, height: grid.hPx, fill: 'var(--ecg-paper)' }),
        h('path', { d: grid.fine, stroke: 'var(--ecg-grid)', 'stroke-width': 1, fill: 'none' }),
        h('path', { d: grid.strong, stroke: 'var(--ecg-grid-strong)', 'stroke-width': 1.3, fill: 'none' })
      ]
    };
  }

  const CAL_MM = 6;
  function calPulseNode(x0, baselineYpx, mmPerMv, pxPerMm) {
    const hgt = mmPerMv * pxPerMm;
    const steps = [1, 0.6, 2.4, 0.6, 0.6].map((mm) => mm * pxPerMm);
    let x = x0;
    const pts = [[x, baselineYpx]];
    x += steps[0]; pts.push([x, baselineYpx]);
    x += steps[1]; pts.push([x, baselineYpx - hgt]);
    x += steps[2]; pts.push([x, baselineYpx - hgt]);
    x += steps[3]; pts.push([x, baselineYpx]);
    x += steps[4]; pts.push([x, baselineYpx]);
    return { node: h('path', { d: pathFromSamples(pts), stroke: 'var(--ecg-trace)', 'stroke-width': 1.4, fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }), endX: x };
  }

  function traceNode(lead, tStart, tEnd, x0Px, baselineYpx, mmPerSec, mmPerMv, d, schedule, profile) {
    const pts = [];
    for (let tt = tStart; tt <= tEnd + 1e-6; tt += SAMPLE_DT) {
      const mv = leadAmplitudeAt(lead, tt, d, schedule, profile);
      pts.push([x0Px + (tt - tStart) * mmPerSec * PX_PER_MM, baselineYpx - mv * mmPerMv * PX_PER_MM]);
    }
    return h('path', { d: pathFromSamples(pts), stroke: 'var(--ecg-trace)', 'stroke-width': 1.4, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  }

  function leadLabelNode(x, y, text) {
    return h('text', { x, y, 'font-family': 'var(--font-mono)', 'font-size': 11, 'font-weight': 600, fill: 'var(--ecg-trace)' }, text);
  }

  function ariaLabelFor(d) {
    return 'Tracé ECG synthétique — ' + (RHYTHM_FR[d.rhythm] || d.rhythm) + ', fréquence ' + Math.round(d.rate) + ' par minute.';
  }

  function allProfiles(d) {
    const p = {};
    LEAD_NAMES.forEach((L) => { p[L] = computeLeadProfile(L, d); });
    return p;
  }

  function synthRender12(d, mmPerSec, mmPerMv, rng) {
    const COL_SEC = 2.5, ROW_H_MM = 38, RHY_H_MM = 34, GAP_MM = 3;
    const colWMm = COL_SEC * mmPerSec;
    const gridWMm = CAL_MM + 4 * colWMm;
    const rhyWMm = CAL_MM + 10 * mmPerSec;
    const totalWMm = Math.max(gridWMm, rhyWMm);
    const totalHMm = 6 + 3 * ROW_H_MM + 2 * GAP_MM + RHY_H_MM + 8;

    const schedule = buildSchedule(d, 10, rng);
    const profiles = allProfiles(d);
    const grid = gridNodes(totalWMm, totalHMm);
    const kids = grid.nodes.slice();

    let yCursor = 6;
    for (let row = 0; row < 3; row++) {
      const rowY0 = yCursor;
      const baselineYpx = num((rowY0 + ROW_H_MM * 0.58) * PX_PER_MM);
      const cal = calPulseNode(0, baselineYpx, mmPerMv, PX_PER_MM);
      kids.push(cal.node);
      for (let col = 0; col < 4; col++) {
        const lead = LEADS_BY_COL[col][row];
        const tStart = col * COL_SEC, tEnd = tStart + COL_SEC;
        const x0Px = num((CAL_MM + col * colWMm) * PX_PER_MM);
        kids.push(traceNode(lead, tStart, tEnd, x0Px, baselineYpx, mmPerSec, mmPerMv, d, schedule, profiles[lead]));
        kids.push(leadLabelNode(x0Px + 2, num(rowY0 * PX_PER_MM) + 11, lead));
      }
      yCursor += ROW_H_MM + GAP_MM;
    }
    // bandelette de rythme (DII, 10 s)
    {
      const baselineYpx = num((yCursor + RHY_H_MM * 0.55) * PX_PER_MM);
      const cal = calPulseNode(0, baselineYpx, mmPerMv, PX_PER_MM);
      kids.push(cal.node);
      kids.push(traceNode('II', 0, 10, num(CAL_MM * PX_PER_MM), baselineYpx, mmPerSec, mmPerMv, d, schedule, profiles.II));
      kids.push(leadLabelNode(2, num(yCursor * PX_PER_MM) + 11, 'II (rythme)'));
      yCursor += RHY_H_MM;
    }
    yCursor += 6;

    const wPx = num(totalWMm * PX_PER_MM), hPx = num(yCursor * PX_PER_MM);
    return h('svg', {
      viewBox: '0 0 ' + wPx + ' ' + hPx, width: '100%', role: 'img', 'aria-label': ariaLabelFor(d),
      style: 'display:block;min-width:' + Math.min(Math.round(wPx), 760) + 'px'
    }, kids);
  }

  function synthRenderSingle(d, leadName, seconds, mmPerSec, mmPerMv, rng) {
    const lead = LEAD_NAMES.indexOf(leadName) >= 0 ? leadName : 'II';
    const ROW_H_MM = 70;
    const totalWMm = CAL_MM + seconds * mmPerSec;
    const totalHMm = ROW_H_MM + 14;
    const schedule = buildSchedule(d, seconds, rng);
    const profile = computeLeadProfile(lead, d);
    const grid = gridNodes(totalWMm, totalHMm);
    const kids = grid.nodes.slice();
    const baselineYpx = num((7 + ROW_H_MM * 0.55) * PX_PER_MM);
    const cal = calPulseNode(0, baselineYpx, mmPerMv, PX_PER_MM);
    kids.push(cal.node);
    kids.push(traceNode(lead, 0, seconds, num(CAL_MM * PX_PER_MM), baselineYpx, mmPerSec, mmPerMv, d, schedule, profile));
    kids.push(leadLabelNode(2, 18, lead));
    const wPx = num(totalWMm * PX_PER_MM), hPx = num(totalHMm * PX_PER_MM);
    return h('svg', {
      viewBox: '0 0 ' + wPx + ' ' + hPx, width: '100%', role: 'img', 'aria-label': ariaLabelFor(d) + ' Dérivation ' + lead + '.',
      style: 'display:block;min-width:' + Math.min(Math.round(wPx), 700) + 'px'
    }, kids);
  }

  function synthRenderCompactImpl(d, rng) {
    const mmPerSec = 25, mmPerMv = 8, SEC = 2.2;
    const ROW_H_MM = 21, COL_W_MM = SEC * mmPerSec, GAP_MM = 1.5;
    const totalWMm = 2 * COL_W_MM + 4;
    const totalHMm = 6 * (ROW_H_MM + GAP_MM) + 6;
    const schedule = buildSchedule(d, SEC + 0.3, rng);
    const profiles = allProfiles(d);
    const grid = gridNodes(totalWMm, totalHMm);
    const kids = grid.nodes.slice();
    let y = 4;
    for (let row = 0; row < 6; row++) {
      const baselineYpx = num((y + ROW_H_MM * 0.55) * PX_PER_MM);
      for (let col = 0; col < 2; col++) {
        const lead = LEADS_COMPACT[row][col];
        const x0Mm = col === 0 ? 1 : (2 + COL_W_MM);
        const x0Px = num(x0Mm * PX_PER_MM);
        kids.push(traceNode(lead, 0, SEC, x0Px, baselineYpx, mmPerSec, mmPerMv, d, schedule, profiles[lead]));
        kids.push(h('text', { x: x0Px + 1, y: num(y * PX_PER_MM) + 9, 'font-family': 'var(--font-mono)', 'font-size': 8.5, 'font-weight': 600, fill: 'var(--ecg-trace)' }, lead));
      }
      y += ROW_H_MM + GAP_MM;
    }
    const wPx = num(totalWMm * PX_PER_MM), hPx = num(y * PX_PER_MM);
    return h('svg', { viewBox: '0 0 ' + wPx + ' ' + hPx, width: '100%', role: 'img', 'aria-label': ariaLabelFor(d), style: 'display:block' }, kids);
  }

  function synthRender(descriptor, opts) {
    opts = opts || {};
    const d = normalizeDescriptor(descriptor);
    const seed = opts.seed != null ? opts.seed : seedFromDescriptor(d);
    const rng = seededRandomLocal(seed);
    const mmPerSec = clampNum(opts.mmPerSec, 5, 50, 25);
    const mmPerMv = clampNum(opts.mmPerMv, 2, 20, 10);
    if (opts.mode === 'single') {
      const seconds = clampNum(opts.seconds, 2, 20, 10);
      return synthRenderSingle(d, opts.lead || 'II', seconds, mmPerSec, mmPerMv, rng);
    }
    return synthRender12(d, mmPerSec, mmPerMv, rng);
  }
  function synthRenderCompact(descriptor) {
    const d = normalizeDescriptor(descriptor);
    const rng = seededRandomLocal(seedFromDescriptor(d));
    return synthRenderCompactImpl(d, rng);
  }
  function synthRenderString(descriptor, opts) {
    const svg = synthRender(descriptor, opts);
    try { return new XMLSerializer().serializeToString(svg); }
    catch (e) { return (svg && svg.outerHTML) ? svg.outerHTML : ''; }
  }

  function synthDescribe(descriptor) {
    const d = normalizeDescriptor(descriptor);
    const out = [];
    out.push('Rythme : ' + (RHYTHM_FR[d.rhythm] || d.rhythm) + ', fréquence ' + Math.round(d.rate) + '/min' + (d.irregular ? ' (irrégulier)' : ''));
    if (d.p.present) {
      out.push('Onde P ' + (d.p.inverted.length ? 'inversée en ' + d.p.inverted.join(', ') : 'présente devant chaque QRS') +
        (d.p.wide ? ', élargie' : '') + (d.p.biphasicV1 ? ', biphasique en V1' : ''));
    } else out.push('Pas d’onde P identifiable.');
    out.push('PR à ' + Math.round(d.pr * 1000) + ' ms' + (d.avBlock !== 'none' ? ' — ' + (AVBLOCK_FR[d.avBlock] || d.avBlock) : ''));
    out.push('QRS à ' + Math.round(d.qrs.dur * 1000) + ' ms' + (d.qrs.bbb !== 'none' ? ', ' + (BBB_FR[d.qrs.bbb] || d.qrs.bbb) : '') + ', axe ≈ ' + Math.round(d.qrs.axis) + '°');
    if (d.qrs.qWaves.length) out.push('Ondes Q pathologiques en ' + d.qrs.qWaves.join(', '));
    if (d.qrs.pathologicR.length) out.push('Onde R anormalement ample en ' + d.qrs.pathologicR.join(', '));
    if (d.qrs.lvh) out.push('Signes d’hypertrophie ventriculaire gauche');
    if (d.qrs.rvh) out.push('Signes d’hypertrophie ventriculaire droite');
    if (d.qrs.lowVoltage) out.push('Microvoltage');
    if (d.qrs.delta) out.push('Onde delta (pré-excitation)');
    const stLeads = Object.keys(d.st.elev).filter((k) => d.st.elev[k]);
    if (stLeads.length) out.push('Sus-décalage de ST (' + d.st.shape + ') en ' + stLeads.map((l) => l + ' +' + d.st.elev[l] + ' mm').join(', '));
    const depLeads = Object.keys(d.st.dep).filter((k) => d.st.dep[k]);
    if (depLeads.length) out.push('Sous-décalage de ST en ' + depLeads.map((l) => l + ' −' + d.st.dep[l] + ' mm').join(', '));
    if (d.t.inverted.length) out.push('Ondes T inversées en ' + d.t.inverted.join(', '));
    if (d.t.peaked) out.push('Ondes T amples et pointues');
    if (d.t.flat) out.push('Ondes T aplaties');
    out.push('QT à ' + Math.round(d.qt * 1000) + ' ms');
    if (d.u) out.push('Onde U visible');
    if (d.prDep) out.push('Sous-décalage du segment PR');
    if (d.ectopy.type !== 'none') out.push('Extrasystoles : ' + (ECTOPY_FR[d.ectopy.type] || d.ectopy.type) + (d.ectopy.bigeminy ? ', bigéminisme' : '') + (d.ectopy.run > 1 ? ', salve de ' + d.ectopy.run : ''));
    if (d.pause > 0) out.push('Pause sinusale de ' + d.pause + ' s');
    if (d.pacer.mode !== 'none') out.push('Stimulateur cardiaque, mode ' + d.pacer.mode);
    return out;
  }

  const ECG = {
    render: synthRender,
    renderString: synthRenderString,
    renderCompact: synthRenderCompact,
    describe: synthDescribe,
    normal: synthNormal
  };
  CARDIO.ecg = ECG;

  /* ==================================================================== */
  /* 2. CARDIO.views.ecg — vues « #/ecg » et « #/item/:num/ecg »           */
  /* ==================================================================== */

  const STYLE_ID = 'cardio-ecg-style';
  const CSS = [
    '.ecg-page{display:grid;gap:12px;grid-template-columns:minmax(0,1fr)}',
    '.ecg-page>*{min-width:0}',
    '.ecg-sub{color:var(--muted);font-size:.875rem;margin:0}',
    '.ecg-sec-title{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:14px 0 6px;font-weight:600}',
    '.ecg-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:4px}',
    '.ecg-head h2{flex:1 1 100%;margin:2px 0 0}',
    '.ecg-group-title{font-size:1rem;margin:4px 0 0}',
    '.ecg-list{display:grid;gap:10px;margin:0;padding:0;list-style:none}',
    '.ecg-item{display:flex;align-items:center;gap:10px;width:100%;text-align:left;cursor:pointer;border:0;font:inherit;color:inherit;min-height:44px}',
    '.ecg-item:focus-visible{outline:2px solid var(--blue);outline-offset:2px}',
    '.ecg-item__body{flex:1;min-width:0;display:grid;gap:4px}',
    '.ecg-item__title{font-weight:600}',
    '.ecg-item__meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:.75rem;color:var(--muted)}',
    '.ecg-item__chev{color:var(--muted);flex:0 0 auto}',
    '.ecg-nav{display:flex;gap:8px;justify-content:space-between;align-items:center}',
    '.ecg-nav .btn{flex:1}',
    '.ecg-src{font-size:.75rem;color:var(--muted);margin:12px 0 0}',
    '.ecg-method{margin-bottom:4px}',
    '.ecg-loadall{display:grid;gap:10px}',
    '.ecg-daily-head{text-align:center}',
    '.ecg-empty{text-align:center;padding:32px 16px;color:var(--muted);display:grid;gap:12px;justify-items:center}',
    '.ecg-empty p{margin:0}',
    '.ecg__leads{display:flex;flex-direction:column;gap:8px}',
    '.ecg-quiz__stem{font-weight:600;margin:4px 0 8px}',
    '.ecg-quiz__actions{margin-top:12px}',
    '.ecg-quiz__feedback{margin:12px 0 0;font-weight:600}',
    '.ecg-quiz__feedback.is-ok{color:var(--ok)}',
    '.ecg-quiz__feedback.is-bad{color:var(--bad)}',
    '.ecg-reveal{margin-top:12px;border-top:1px solid var(--line);padding-top:4px}',
    '.ecg-quiz .grades .btn.is-suggested{outline:2px solid var(--blue);outline-offset:2px}',
    '.ecg-quiz .grades .btn.is-chosen{box-shadow:inset 0 0 0 2px var(--ink)}',
    '@media (min-width:900px){.ecg-item__meta{font-size:.8125rem}}'
  ].join('\n');
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  const FAMILY_LABELS = {
    sinus: 'Sinusal', fa: 'FA / Flutter', tachy: 'Tachycardies', jonctionnel: 'Jonctionnel / échappement',
    arret: 'Arrêt / chaotique', appareil: 'Électro-entraîné', bloc: 'Blocs AV', bbbFam: 'Blocs de branche', extrasystole: 'Extrasystoles'
  };
  function familiesOf(ecgDesc) {
    const d = ecgDesc || {};
    const fams = [];
    const r = d.rhythm;
    if (['sinus', 'sinusBrady', 'sinusTachy', 'wpw', 'atrialTachy'].indexOf(r) >= 0) fams.push('sinus');
    if (r === 'af' || r === 'flutter') fams.push('fa');
    if (['svt', 'vt', 'vtPolymorphic', 'torsades'].indexOf(r) >= 0) fams.push('tachy');
    if (['junctional', 'idioventricular'].indexOf(r) >= 0) fams.push('jonctionnel');
    if (r === 'vf' || r === 'asystole') fams.push('arret');
    if (r === 'paced') fams.push('appareil');
    if (d.avBlock && d.avBlock !== 'none') fams.push('bloc');
    if (d.qrs && d.qrs.bbb && d.qrs.bbb !== 'none') fams.push('bbbFam');
    if (d.ectopy && d.ectopy.type && d.ectopy.type !== 'none') fams.push('extrasystole');
    if (!fams.length) fams.push('sinus');
    return fams;
  }

  const GRADE_DEFS = [
    { g: 1, key: 'a', label: 'Encore', cls: 'grade--again' },
    { g: 2, key: 'h', label: 'Difficile', cls: 'grade--hard' },
    { g: 3, key: 'g', label: 'Bien', cls: 'grade--good' },
    { g: 4, key: 'e', label: 'Facile', cls: 'grade--easy' }
  ];

  function gradeButtons(entry, score, onChoose) {
    const wrap = h('div', { class: 'grades', role: 'group', 'aria-label': 'Comment tu t’en es sorti ?' });
    const suggested = score >= 0.99 ? 3 : (score >= 0.5 ? 2 : 1);
    let previews = null;
    try {
      const S = window.CARDIO && CARDIO.store, R = window.CARDIO && CARDIO.srs;
      if (S && R && typeof S.card === 'function' && typeof R.nextIntervalsPreview === 'function') previews = R.nextIntervalsPreview(S.card(entry.id), nowMs());
    } catch (e) { previews = null; }
    const buttons = GRADE_DEFS.map((gd) => {
      const b = h('button', { type: 'button', class: 'btn ' + gd.cls + (gd.g === suggested ? ' is-suggested' : ''), dataset: { grade: gd.g } },
        [gd.label, previews && previews[gd.g] ? h('small', {}, previews[gd.g]) : null]);
      b.addEventListener('click', () => {
        buttons.forEach((x) => { x.disabled = true; x.classList.remove('is-suggested'); });
        b.classList.add('is-chosen');
        onChoose(gd.g);
      });
      return b;
    });
    buttons.forEach((b) => wrap.appendChild(b));
    wrap._choose = (key) => {
      const gd = GRADE_DEFS.filter((x) => x.key === key)[0];
      if (!gd) return;
      const b = buttons[GRADE_DEFS.indexOf(gd)];
      if (b && !b.disabled) b.click();
    };
    return wrap;
  }

  function findingsBlock(entry) {
    const list = Array.isArray(entry.findings) ? entry.findings.filter(Boolean) : [];
    if (!list.length) return null;
    return h('div', {}, [
      h('div', { class: 'ecg-sec-title' }, 'Éléments du tracé'),
      h('ul', { class: 'kp' }, list.map((f) => {
        const li = h('li');
        li.innerHTML = mdHtml(String(f)).replace(/^<p>|<\/p>$/g, '');
        return li;
      }))
    ]);
  }
  function diagnosisBlock(entry) {
    if (!entry.diagnosis) return null;
    return h('div', { class: 'explain' }, [h('span', { class: 'caption' }, 'Diagnostic'), h('p', { style: 'margin:4px 0 0;font-weight:600' }, entry.diagnosis)]);
  }
  function teachingBlock(entry) {
    if (!entry.teaching) return null;
    return h('div', {}, [h('div', { class: 'ecg-sec-title' }, 'Enseignement'), mdBlock(entry.teaching)]);
  }
  function methodBlock(md) {
    if (!md) return null;
    return h('div', { class: 'card ecg-method' }, [h('div', { class: 'ecg-sec-title' }, 'Méthode de lecture d’un ECG'), mdBlock(md)]);
  }
  function srcLine(entry) {
    if (!entry.src) return null;
    return h('p', { class: 'ecg-src' }, 'Source : Collège de cardiologie, ' + entry.src);
  }

  /* ------------------------------------------------------------------ */
  /* Tracé + bascule 12 dérivations / 1 dérivation / compact              */
  /* ------------------------------------------------------------------ */

  function buildTracing(entry, opts) {
    opts = opts || {};
    let mode = opts.mode === 'single' || opts.mode === 'compact' ? opts.mode : '12';
    let lead = opts.lead || 'II';
    const wrap = h('div', { class: 'stack stack--sm' });
    const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Mode d’affichage du tracé' });
    const leadChips = h('div', { class: 'chips', hidden: mode !== 'single' });
    const ecgHost = h('div', { class: 'ecg' });
    const scaleEl = h('span', { class: 'ecg__scale' }, '25 mm/s · 10 mm/mV');

    function paintSvg() {
      let svg = null;
      const api = window.CARDIO && CARDIO.ecg;
      if (api && typeof api.render === 'function') {
        try {
          if (mode === 'compact') svg = typeof api.renderCompact === 'function' ? api.renderCompact(entry.ecg) : api.render(entry.ecg, { mode: '12' });
          else svg = api.render(entry.ecg, { mode: mode === 'single' ? 'single' : '12', lead: lead });
        } catch (e) { console.error('[views/ecg] rendu impossible', e); svg = null; }
      } else warnOnce('engine', 'CARDIO.ecg indisponible : tracé non affiché.');
      Array.prototype.slice.call(ecgHost.querySelectorAll('svg, .ecg__fallback')).forEach((n) => n.remove());
      if (svg) ecgHost.insertBefore(svg, scaleEl);
      else ecgHost.insertBefore(h('p', { class: 'ecg__fallback secondary', style: 'margin:16px' }, 'Tracé indisponible pour le moment.'), scaleEl);
    }

    [['12', '12 dérivations'], ['single', '1 dérivation'], ['compact', 'Compact']].forEach((m) => {
      const btn = h('button', { type: 'button', class: 'tab' + (mode === m[0] ? ' is-on' : ''), role: 'tab', 'aria-selected': mode === m[0] ? 'true' : 'false' }, m[1]);
      btn.addEventListener('click', () => {
        mode = m[0];
        Array.prototype.forEach.call(tabs.children, (t) => { t.classList.remove('is-on'); t.setAttribute('aria-selected', 'false'); });
        btn.classList.add('is-on'); btn.setAttribute('aria-selected', 'true');
        leadChips.hidden = mode !== 'single';
        paintSvg();
      });
      tabs.appendChild(btn);
    });
    LEAD_NAMES.forEach((L) => {
      const c = h('button', { type: 'button', class: 'chip' + (L === lead ? ' is-on' : '') }, L);
      c.addEventListener('click', () => {
        lead = L;
        Array.prototype.forEach.call(leadChips.children, (x) => x.classList.toggle('is-on', x === c));
        paintSvg();
      });
      leadChips.appendChild(c);
    });

    ecgHost.appendChild(scaleEl);
    paintSvg();
    wrap.appendChild(h('div', { class: 'ecg__leads' }, [tabs, leadChips]));
    wrap.appendChild(ecgHost);
    return wrap;
  }

  /* ------------------------------------------------------------------ */
  /* Quiz (utilisé aussi bien depuis cette vue que depuis le moteur de    */
  /* séance CARDIO.views.quiz, via l'alias CARDIO.ecg.renderQuiz)         */
  /* ------------------------------------------------------------------ */

  function renderQuiz(entry, opts) {
    ensureStyles();
    opts = opts || {};
    entry = entry || {};
    const onGrade = typeof opts.onGrade === 'function' ? opts.onGrade : function () {};
    const startedAt = nowMs();
    const wrap = h('div', { class: 'ecg-quiz stack', dataset: { id: entry.id || '' }, tabindex: '-1' });

    wrap.appendChild(h('div', { class: 'ecg-head' }, [pill('ECG', 'kind'), rankPill(entry.rank), h('h2', {}, entry.title || 'Tracé ECG')]));
    wrap.appendChild(buildTracing(entry, { mode: opts.mode }));

    const reveal = h('div', { class: 'ecg-reveal' }, [diagnosisBlock(entry), findingsBlock(entry), teachingBlock(entry), srcLine(entry)]);
    const gradesHost = h('div');
    let graded = false;

    function finish(score, correct) {
      const grades = gradeButtons(entry, score, (grade) => {
        if (graded) return;
        graded = true;
        onGrade(grade, score, { ms: nowMs() - startedAt, correct: correct });
      });
      gradesHost.appendChild(h('div', { class: 'ecg-sec-title' }, 'Comment tu t’en es sorti ?'));
      gradesHost.appendChild(grades);
      wrap._grades = grades;
    }

    const quiz = entry.quiz;
    const hasQuiz = quiz && Array.isArray(quiz.options) && quiz.options.length >= 2 && typeof quiz.correct === 'number';

    if (!hasQuiz) {
      wrap.appendChild(h('p', { class: 'ecg-sub' }, 'Pas de question pour ce tracé : lis-le, puis évalue-toi.'));
      wrap.appendChild(reveal);
      wrap.appendChild(gradesHost);
      const selfGrades = gradeButtons(entry, 1, (grade) => {
        if (graded) return;
        graded = true;
        const score = grade >= 3 ? 1 : (grade === 2 ? 0.5 : 0);
        onGrade(grade, score, { ms: nowMs() - startedAt, correct: null });
      });
      gradesHost.appendChild(h('div', { class: 'ecg-sec-title' }, 'Comment tu t’en es sorti ?'));
      gradesHost.appendChild(selfGrades);
      wrap._grades = selfGrades;
      wrap.addEventListener('keydown', (ev) => { if (wrap._grades && /^[ahge]$/i.test(ev.key)) { wrap._grades._choose(ev.key.toLowerCase()); ev.preventDefault(); } });
      return wrap;
    }

    let order = quiz.options.map((t, i) => ({ t: String(t), i }));
    order = shuffle(order, seedOf(entry.id || quiz.stem));
    let selected = -1, validated = false;

    wrap.appendChild(h('div', { class: 'ecg-quiz__stem' }, mdBlock(quiz.stem || 'Quel est le diagnostic ?')));
    const rows = order.map((o, pos) => {
      const key = String.fromCharCode(65 + pos);
      const row = h('button', { type: 'button', class: 'opt', 'aria-pressed': 'false', dataset: { pos } }, [
        h('span', { class: 'opt__key' }, key), h('span', { class: 'opt__text' }, o.t)
      ]);
      row.addEventListener('click', () => select(pos));
      return row;
    });
    wrap.appendChild(h('div', { class: 'opts', role: 'group', 'aria-label': 'Réponses' }, rows));
    const validateBtn = h('button', { type: 'button', class: 'btn btn--primary btn--block' }, 'Valider');
    validateBtn.disabled = true;
    validateBtn.addEventListener('click', validate);
    wrap.appendChild(h('div', { class: 'ecg-quiz__actions' }, validateBtn));
    const feedback = h('p', { class: 'ecg-quiz__feedback', 'aria-live': 'polite' });
    wrap.appendChild(feedback);
    wrap.appendChild(gradesHost);

    function select(pos) {
      if (validated) return;
      selected = pos;
      rows.forEach((r, i) => { r.classList.toggle('is-selected', i === pos); r.setAttribute('aria-pressed', i === pos ? 'true' : 'false'); });
      validateBtn.disabled = false;
    }
    function validate() {
      if (validated || selected < 0) return;
      validated = true;
      haptic();
      const correct = order[selected].i === quiz.correct;
      rows.forEach((r, i) => {
        r.disabled = true;
        const isCorrect = order[i].i === quiz.correct;
        r.classList.remove('is-selected');
        if (isCorrect) r.classList.add('is-correct');
        else if (i === selected) r.classList.add('is-wrong', 'is-selected');
        else r.classList.add('is-neutral');
      });
      feedback.textContent = correct ? 'Juste.' : 'Faux — regarde pourquoi.';
      feedback.classList.add(correct ? 'is-ok' : 'is-bad');
      validateBtn.disabled = true;
      validateBtn.textContent = correct ? 'Bonne réponse' : 'Réponse attendue en vert';
      wrap.insertBefore(reveal, gradesHost);
      finish(correct ? 1 : 0, correct);
    }
    wrap.addEventListener('keydown', (ev) => {
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
      const k = ev.key;
      if (!validated && /^[1-9]$/.test(k)) { const pos = parseInt(k, 10) - 1; if (pos < rows.length) { select(pos); ev.preventDefault(); } }
      else if (!validated && k === 'Enter') { if (selected >= 0) { validate(); ev.preventDefault(); } }
      else if (validated && wrap._grades && /^[ahge]$/i.test(k)) { wrap._grades._choose(k.toLowerCase()); ev.preventDefault(); }
    });
    return wrap;
  }

  /* ------------------------------------------------------------------ */
  /* Enregistrement de la tentative                                       */
  /* ------------------------------------------------------------------ */

  function recordAttempt(entry, itemNum, grade, score, extra) {
    const S = window.CARDIO && CARDIO.store;
    if (!S || typeof S.recordAttempt !== 'function') {
      warnOnce('store', 'CARDIO.store.recordAttempt absent : la réponse n’est pas enregistrée.');
      toast('Réponse non enregistrée (progression indisponible).', 'warn');
      return;
    }
    try {
      S.recordAttempt({
        cardId: entry.id, item: itemNum, kind: 'ecg', score: score, grade: grade,
        ms: extra && extra.ms ? extra.ms : 0,
        details: { correct: extra ? extra.correct : null, rhythm: entry.ecg && entry.ecg.rhythm }
      });
      toast('Réponse enregistrée.', 'ok');
    } catch (e) {
      warnOnce('record', 'recordAttempt a échoué : ' + (e && e.message));
      toast('Impossible d’enregistrer la réponse.', 'bad');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Page d'un item : liste + détail                                      */
  /* ------------------------------------------------------------------ */

  function emptyState(msg, num) {
    const back = h('a', { class: 'btn btn--secondary', href: num ? '#/item/' + num : '#/items' }, num ? 'Retour à l’item' : 'Voir les items');
    return h('div', { class: 'card ecg-empty' }, [h('p', {}, msg), back]);
  }

  function buildItemList(host, num, meta, entries, method, open) {
    let filter = 'all';
    const listEl = h('ul', { class: 'ecg-list' });
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtre par rang' });
    function chip(label, value) {
      const c = h('button', { type: 'button', class: 'chip' + (value === filter ? ' is-on' : ''), 'aria-pressed': value === filter ? 'true' : 'false' }, label);
      c.addEventListener('click', () => {
        filter = value;
        Array.prototype.forEach.call(chips.children, (x) => { x.classList.toggle('is-on', x === c); x.setAttribute('aria-pressed', x === c ? 'true' : 'false'); });
        fill();
      });
      return c;
    }
    chips.appendChild(chip('Tout', 'all')); chips.appendChild(chip('Rang A', 'A')); chips.appendChild(chip('Rang B', 'B'));

    function fill() {
      listEl.replaceChildren();
      const shown = entries.filter((e) => filter === 'all' || (e.rank || 'A') === filter);
      if (!shown.length) { listEl.appendChild(h('li', { class: 'ecg-sub' }, 'Aucun tracé de ce rang dans cet item.')); return; }
      shown.forEach((e) => {
        const idx = entries.indexOf(e);
        const rhythmLabel = (e.ecg && RHYTHM_FR[e.ecg.rhythm]) || 'Tracé';
        const row = h('button', { type: 'button', class: 'card ecg-item' }, [
          h('span', { class: 'ecg-item__body' }, [
            h('span', { class: 'ecg-item__title' }, e.title || 'Tracé ECG'),
            h('span', { class: 'ecg-item__meta' }, [rankPill(e.rank), h('span', {}, '· ' + rhythmLabel), e.quiz ? h('span', {}, '· quiz') : null])
          ]),
          h('span', { class: 'ecg-item__chev', 'aria-hidden': 'true' }, '›')
        ]);
        row.addEventListener('click', () => open(idx));
        listEl.appendChild(h('li', {}, row));
      });
    }
    fill();

    const n = entries.length;
    host.replaceChildren();
    const kids = [];
    if (method) kids.push(methodBlock(method));
    kids.push(h('h2', {}, 'ECG — ' + (meta && meta.short ? meta.short : 'item ' + num)));
    kids.push(h('p', { class: 'ecg-sub' }, n + (n > 1 ? ' tracés' : ' tracé') + ' : lis, réponds, puis vérifie.'));
    kids.push(chips); kids.push(listEl);
    kids.forEach((k) => host.appendChild(k));
  }

  function buildItemEntry(host, num, entries, idx, backToList, open) {
    const entry = entries[idx];
    const card = h('div', { class: 'card' }, [
      h('div', { class: 'ecg-head' }, [pill('ECG', 'kind'), rankPill(entry.rank), h('h2', {}, entry.title || 'Tracé ECG')]),
      buildTracing(entry, {}),
      diagnosisBlock(entry), findingsBlock(entry), teachingBlock(entry), srcLine(entry)
    ]);
    const quizCard = h('div', { class: 'card' });
    const testBtn = h('button', { type: 'button', class: 'btn btn--primary btn--block' }, entry.quiz ? 'Me tester sur ce tracé' : 'M’auto-évaluer');
    testBtn.addEventListener('click', () => {
      quizCard.replaceChildren();
      const q = renderQuiz(entry, {
        onGrade: (grade, score, extra) => {
          recordAttempt(entry, num, grade, score, extra);
          const next = idx + 1 < entries.length;
          quizCard.appendChild(h('div', { class: 'ecg-nav' }, [
            next
              ? h('button', { type: 'button', class: 'btn btn--primary', on: { click: () => open(idx + 1) } }, 'Tracé suivant')
              : h('button', { type: 'button', class: 'btn btn--primary', on: { click: backToList } }, 'Tous les tracés')
          ]));
        }
      });
      quizCard.appendChild(q);
      try { q.focus({ preventScroll: true }); } catch (e) { /* silencieux */ }
    });
    quizCard.appendChild(h('p', { class: 'ecg-sub' }, entry.quiz ? 'Une question pour vérifier la lecture.' : 'Relis le tracé puis note-toi.'));
    quizCard.appendChild(testBtn);

    const prev = h('button', { type: 'button', class: 'btn btn--secondary' }, '‹ Précédent');
    const next = h('button', { type: 'button', class: 'btn btn--secondary' }, 'Suivant ›');
    prev.disabled = idx === 0; next.disabled = idx >= entries.length - 1;
    prev.addEventListener('click', () => open(idx - 1));
    next.addEventListener('click', () => open(idx + 1));
    const back = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, '‹ Tous les tracés');
    back.addEventListener('click', backToList);

    host.replaceChildren();
    [h('div', {}, back), h('p', { class: 'ecg-sub' }, 'Tracé ' + (idx + 1) + ' sur ' + entries.length), card, quizCard, h('div', { class: 'ecg-nav' }, [prev, next])]
      .forEach((k) => host.appendChild(k));
    scrollTop();
  }

  function renderItemPage(num, params, query) {
    const page = h('div', { class: 'page ecg-page', dataset: { view: 'ecg', item: num } });
    page.appendChild(h('div', { class: 'ecg-empty' }, h('p', {}, 'Chargement des tracés…')));
    const R = registry();
    if (!R || typeof R.load !== 'function') {
      warnOnce('registry', 'CARDIO.registry.load absent : impossible de charger le contenu.');
      page.replaceChildren(emptyState('Le contenu n’est pas encore disponible. Réessaie dans un instant.', num));
      return Promise.resolve(page);
    }
    return Promise.resolve().then(() => R.load(num)).then((content) => {
      const data = content && content.ecg && Array.isArray(content.ecg.data) ? content.ecg.data : [];
      const method = String(num) === '231' && content && content.ecg ? content.ecg.method : '';
      const meta = (content && content.meta) || (typeof R.item === 'function' ? R.item(num) : null) || {};
      page.replaceChildren();
      if (!data.length && !method) {
        page.appendChild(emptyState('Pas de tracé ECG pour cet item : passe à la fiche ou aux QCM.', num));
        return page;
      }
      const host = h('div', { class: 'ecg-page' });
      page.appendChild(host);
      function backToList() { buildItemList(host, num, meta, data, method, open); scrollTop(); }
      function open(i) { if (i < 0 || i >= data.length) return; buildItemEntry(host, num, data, i, backToList, open); }
      const wanted = params.entry || params.id || query.entry;
      const start = wanted ? data.findIndex((e) => e.id === wanted) : -1;
      if (start >= 0) open(start); else backToList();
      return page;
    }).catch((err) => {
      warnOnce('load-' + num, 'chargement de l’item ' + num + ' impossible : ' + (err && err.message));
      page.replaceChildren(emptyState('Impossible de charger cet item pour le moment. Vérifie ta connexion et réessaie.', num));
      return page;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Bibliothèque globale « #/ecg »                                       */
  /* ------------------------------------------------------------------ */

  function dailyIndex(n) {
    const U = util();
    const today = (U && typeof U.today === 'function') ? U.today() : new Date().toDateString();
    const rnd = seededRandomLocal('ecg-daily-' + today);
    return Math.floor(rnd() * n) % Math.max(1, n);
  }

  function loadAllCard(onDone, forDaily) {
    const status = h('p', { class: 'ecg-sub' }, 'Charge le contenu de tous les items disponibles (peut prendre quelques secondes).');
    const btn = h('button', { type: 'button', class: 'btn btn--primary btn--block' }, forDaily ? 'Charger les items pour l’ECG du jour' : 'Charger tous les items');
    btn.addEventListener('click', () => {
      const R = registry();
      if (!R || typeof R.loadAll !== 'function') { warnOnce('loadall', 'CARDIO.registry.loadAll indisponible.'); return; }
      btn.disabled = true; btn.textContent = 'Chargement…';
      R.loadAll({ onProgress: (done, total) => { status.textContent = 'Chargement… ' + done + ' / ' + total; } })
        .then((res) => { toast(((res && res.loaded) ? res.loaded.length : 0) + ' items chargés.', 'ok'); onDone(); })
        .catch((e) => { console.error(e); toast('Chargement incomplet.', 'warn'); onDone(); });
    });
    return h('div', { class: 'card ecg-loadall' }, [status, btn]);
  }

  function paintDaily(host, item) {
    host.replaceChildren();
    const U = util();
    const dateStr = (U && typeof U.fmtDate === 'function') ? U.fmtDate(new Date(), { long: true, weekday: true }) : '';
    host.appendChild(h('div', { class: 'card ecg-daily-head' }, [
      h('span', { class: 'pill pill--kind' }, 'ECG du jour'),
      h('h2', { style: 'margin:8px 0 0' }, item.entry.title || 'Tracé du jour'),
      h('p', { class: 'ecg-sub' }, (item.meta && item.meta.short ? item.meta.short : 'Item ' + item.num) + (dateStr ? ' · ' + dateStr : ''))
    ]));
    const q = renderQuiz(item.entry, { onGrade: (grade, score, extra) => recordAttempt(item.entry, item.num, grade, score, extra) });
    host.appendChild(q);
    host.appendChild(h('a', { class: 'btn btn--secondary btn--block', href: '#/ecg' }, 'Toute la bibliothèque ECG'));
  }

  function renderLibrary(query) {
    const page = h('div', { class: 'page ecg-page', dataset: { view: 'ecg-library' } });
    const host = h('div', { class: 'stack' });
    page.appendChild(host);
    const R = registry();
    let familyFilter = 'all';

    function collect() {
      const out = [];
      if (!R || typeof R.loaded !== 'function') return out;
      R.loaded().forEach((numStr) => {
        const c = typeof R.content === 'function' ? R.content(numStr) : null;
        if (c && c.ecg && Array.isArray(c.ecg.data)) {
          c.ecg.data.forEach((e) => out.push({ entry: e, num: numStr, meta: typeof R.item === 'function' ? R.item(numStr) : null }));
        }
      });
      return out;
    }

    function paint() {
      host.replaceChildren();
      if (!R || typeof R.loaded !== 'function') {
        warnOnce('registry-lib', 'CARDIO.registry indisponible.');
        host.appendChild(emptyState('La bibliothèque ECG n’est pas disponible pour le moment.', ''));
        return;
      }
      const all = collect();
      const isDaily = query && (query.daily === '1' || query.daily === 1);
      if (isDaily) {
        if (!all.length) { host.appendChild(loadAllCard(paint, true)); return; }
        paintDaily(host, all[dailyIndex(all.length)]);
        return;
      }

      const allItems = typeof R.items === 'function' ? R.items() : [];
      const missing = allItems.filter((it) => it.available !== false && typeof R.isLoaded === 'function' && !R.isLoaded(it.num));

      const families = {};
      all.forEach((x) => familiesOf(x.entry.ecg).forEach((f) => { families[f] = true; }));
      const famList = Object.keys(FAMILY_LABELS).filter((f) => families[f]);
      const chips = h('div', { class: 'chips' });
      function chipBtn(label, value) {
        const c = h('button', { type: 'button', class: 'chip' + (value === familyFilter ? ' is-on' : '') }, label);
        c.addEventListener('click', () => { familyFilter = value; paint(); });
        return c;
      }
      chips.appendChild(chipBtn('Tout', 'all'));
      famList.forEach((f) => chips.appendChild(chipBtn(FAMILY_LABELS[f], f)));

      const shown = all.filter((x) => familyFilter === 'all' || familiesOf(x.entry.ecg).indexOf(familyFilter) >= 0);
      const groups = {}, order = [];
      shown.forEach((x) => { if (!groups[x.num]) { groups[x.num] = []; order.push(x.num); } groups[x.num].push(x); });

      const listNodes = order.map((numKey) => {
        const groupMeta = groups[numKey][0].meta;
        const items = groups[numKey].map((x) => {
          const row = h('button', { type: 'button', class: 'card ecg-item' }, [
            h('span', { class: 'ecg-item__body' }, [
              h('span', { class: 'ecg-item__title' }, x.entry.title || 'Tracé ECG'),
              h('span', { class: 'ecg-item__meta' }, [rankPill(x.entry.rank), h('span', {}, '· ' + ((RHYTHM_FR[x.entry.ecg && x.entry.ecg.rhythm]) || 'Tracé'))])
            ]),
            h('span', { class: 'ecg-item__chev', 'aria-hidden': 'true' }, '›')
          ]);
          row.addEventListener('click', () => {
            const router = window.CARDIO && CARDIO.router;
            const href = '#/item/' + numKey + '/ecg?entry=' + encodeURIComponent(x.entry.id);
            if (router && typeof router.go === 'function') router.go(href); else location.hash = href;
          });
          return h('li', {}, row);
        });
        return h('div', { class: 'stack stack--sm' }, [
          h('h3', { class: 'ecg-group-title' }, [(groupMeta && groupMeta.short) ? groupMeta.short : ('Item ' + numKey), h('span', { class: 'muted' }, ' · item ' + numKey)]),
          h('ul', { class: 'ecg-list' }, items)
        ]);
      });

      host.appendChild(h('h2', {}, 'Bibliothèque ECG'));
      host.appendChild(h('p', { class: 'ecg-sub' }, all.length
        ? (all.length + (all.length > 1 ? ' tracés chargés' : ' tracé chargé') + (missing.length ? ' · ' + missing.length + ' item' + (missing.length > 1 ? 's' : '') + ' non chargé' + (missing.length > 1 ? 's' : '') : ''))
        : 'Aucun tracé chargé pour le moment.'));
      if (missing.length) host.appendChild(loadAllCard(paint, false));
      if (famList.length) host.appendChild(chips);
      if (!listNodes.length) host.appendChild(emptyState('Aucun tracé ECG à afficher : charge des items pour commencer.', ''));
      else listNodes.forEach((n) => host.appendChild(n));
    }

    paint();
    return page;
  }

  /* ------------------------------------------------------------------ */
  /* Point d'entrée de la vue                                             */
  /* ------------------------------------------------------------------ */

  function viewRender(params, query) {
    ensureStyles();
    params = params || {}; query = query || {};
    if (params.mode === 'library') return Promise.resolve(renderLibrary(query));
    const num = String(params.num || params.item || '').trim();
    if (!num) return Promise.resolve(h('div', { class: 'page ecg-page' }, emptyState('Aucun item précisé : choisis un item pour voir ses ECG.', '')));
    return renderItemPage(num, params, query);
  }

  const VIEWS_ECG = { render: viewRender, renderQuiz: renderQuiz };
  CARDIO.views.ecg = VIEWS_ECG;
  CARDIO.ecg.renderQuiz = VIEWS_ECG.renderQuiz;
})();
