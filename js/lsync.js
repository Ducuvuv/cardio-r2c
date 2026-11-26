/* CardioR2C — lsync.js
 * La progression des polys (parasito / bactério / viro : fiches lues, répétition espacée, plafond de nouvelles cartes),
 * du Mode Scroll et des paquets vit dans des clés localStorage séparées. Ce module les recopie dans l'état du store
 * (state.lsx, sauvegardé avec le reste et synchronisé dans le cloud) et les restaure si le navigateur les a perdues.
 * Règle : par clé, l'écriture la plus récente gagne (horodatage local « cardio.lsx.at »).
 * Chargé juste après store.js, avant les vues. */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  const KEEP = /^cardio\.(parasito(\.srs|\.newday|\.seen)?|scroll\.(game|opts)|deck\.(v1(\.[a-z0-9]+)?|slots)|passes|annales|ednfiches|paquets|hiba)$/;
  const LSAT = 'cardio.lsx.at';
  let LSO = null;
  try { LSO = window.localStorage; } catch (e) { LSO = null; }
  if (!LSO || !window.Storage) return;
  const P = window.Storage.prototype, oSet = P.setItem, oRem = P.removeItem, oGet = P.getItem;
  let mute = false, pending = {}, timer = null;

  function ats() { try { return JSON.parse(oGet.call(LSO, LSAT) || '{}') || {}; } catch (e) { return {}; } }
  function saveAts(a) { try { oSet.call(LSO, LSAT, JSON.stringify(a)); } catch (e) { /* ignore */ } }
  function store() { const s = CARDIO.store; return s && typeof s.update === 'function' && typeof s.get === 'function' ? s : null; }

  function flush() {
    timer = null;
    const st = store(); if (!st) { timer = setTimeout(flush, 1000); return; }
    const p = pending; pending = {};
    if (!Object.keys(p).length) return;
    try { st.update(function (s) { if (!s.lsx || typeof s.lsx !== 'object') s.lsx = {}; Object.keys(p).forEach(function (k) { s.lsx[k] = p[k]; }); }); } catch (e) { /* ignore */ }
  }
  function queue(k, v) {
    const t = Date.now(), a = ats(); a[k] = t; saveAts(a);
    pending[k] = { v: v, at: t };
    if (!timer) timer = setTimeout(flush, 1200);
  }
  P.setItem = function (k, v) {
    const r = oSet.apply(this, arguments);
    if (!mute && this === LSO && KEEP.test(String(k))) queue(String(k), String(v));
    return r;
  };
  P.removeItem = function (k) {
    const r = oRem.apply(this, arguments);
    if (!mute && this === LSO && KEEP.test(String(k))) queue(String(k), null);
    return r;
  };
  window.addEventListener('pagehide', function () { if (timer) { clearTimeout(timer); flush(); } });

  /* Restaure depuis le store les clés plus récentes que la copie locale ; renvoie le nombre de clés restaurées. */
  function restore() {
    const st = store(); if (!st) return 0;
    let x = null; try { x = st.get('lsx'); } catch (e) { x = null; }
    if (!x || typeof x !== 'object') return 0;
    const a = ats(); let n = 0;
    const maps = (st.LSX_MAPS || {}), mergeMaps = st.lsxMergeMaps;
    Object.keys(x).forEach(function (k) {
      const e = x[k];
      if (!KEEP.test(k) || !e) return;
      // clés « carte » : fusion entrée par entrée avec la copie locale (rien n'est perdu d'un côté ni de l'autre)
      if (maps[k] && typeof mergeMaps === 'function' && typeof e.v === 'string') {
        const loc = oGet.call(LSO, k);
        if (loc != null && loc !== e.v) {
          const m = mergeMaps(loc, e.v);
          if (m) {
            const mv = JSON.stringify(m);
            if (mv !== loc) { mute = true; try { oSet.call(LSO, k, mv); n++; } catch (err) { /* quota */ } finally { mute = false; } }
            if (mv !== e.v) { queue(k, mv); a[k] = pending[k].at; } else { a[k] = Math.max(a[k] || 0, Number(e.at) || 0); }
            return;
          }
        }
      }
      if (!(Number(e.at) > (a[k] || 0))) return;
      mute = true;
      try { if (e.v == null) oRem.call(LSO, k); else oSet.call(LSO, k, e.v); a[k] = Number(e.at); n++; } catch (err) { /* quota */ } finally { mute = false; }
    });
    saveAts(a);
    return n;
  }
  /* Premier passage : les clés locales jamais envoyées partent dans le store (progression déjà faite avant ce module). */
  function seed() {
    const st = store(); if (!st) return;
    let x = {}; try { x = st.get('lsx') || {}; } catch (e) { x = {}; }
    const a = ats();
    for (let i = 0; i < LSO.length; i++) {
      const k = LSO.key(i);
      if (!k || !KEEP.test(k) || x[k]) continue;
      const v = oGet.call(LSO, k);
      if (v != null) { const t = a[k] || Date.now(); a[k] = t; pending[k] = { v: v, at: t }; }
    }
    saveAts(a);
    if (Object.keys(pending).length && !timer) timer = setTimeout(flush, 800);
  }
  function rerender() { try { window.dispatchEvent(new HashChangeEvent('hashchange')); } catch (e) { /* ignore */ } }

  function init() {
    restore();
    seed();
    const u = CARDIO.util;
    if (u && typeof u.on === 'function') u.on('store:change', function (ev) {
      if (ev && (ev.reason === 'cloud-merge' || ev.reason === 'import')) { if (restore()) rerender(); }
    });
  }
  init();
  CARDIO.lsync = { restore: restore, flush: flush };
})();
