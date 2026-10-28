/* CardioR2C — js/fx.js
 * Effets de récompense : « +N XP » qui s'envole, passage de niveau, badge débloqué, confettis.
 * Écoute les événements du store (store:xp, store:xplevel, store:badge). Respecte prefers-reduced-motion.
 * API : CARDIO.fx.confetti(), CARDIO.fx.burst(text), CARDIO.fx.badgeName(id).
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;

  const BADGES = {
    'pj-day-1': 'Première journée bouclée', 'pj-day-7': '7 journées bouclées', 'pj-day-30': '30 journées bouclées', 'pj-day-100': '100 journées bouclées',
    'pj-stage': 'Stage tenu', 'pj-placed-20': '20 cours placés', 'pj-placed-all': 'Tous les cours placés',
    'pj-acquis-1': 'Premier cours acquis', 'pj-acquis-10': '10 cours acquis', 'pj-acquis-50': '50 cours acquis',
    'pj-tour-1': 'Premier tour terminé', 'pj-review-100': '100 révisions J',
    'first-session': 'Première session', 'streak-3': 'Série de 3', 'streak-7': 'Série de 7', 'streak-30': 'Série de 30', 'streak-100': 'Série de 100',
    'cards-100': '100 cartes', 'cards-500': '500 cartes', 'cards-2000': '2 000 cartes', 'all-A-90': 'Rang A à 90 %',
    'errors-cleared': 'Cahier d’erreurs vidé', 'night-owl': 'Oiseau de nuit', 'early-bird': 'Lève-tôt', 'exam-80': 'Examen blanc ≥ 80 %'
  };
  function badgeName(id) {
    if (BADGES[id]) return BADGES[id];
    const m = /^item-mastered-(.+)$/.exec(id || '');
    if (m) return 'Item ' + m[1] + ' maîtrisé';
    const p = /^pj-pole-(.+)$/.exec(id || '');
    if (p) return 'Pôle ' + decodeURIComponent(p[1]) + ' solide';
    return String(id || 'Badge');
  }
  function reduced() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }

  const CSS = [
    '.fx-xp{position:fixed;left:50%;bottom:calc(var(--tabbar-h,60px) + 28px);transform:translateX(-50%);z-index:9999;pointer-events:none;',
    'font:800 20px/1 var(--font-display);color:#fff;padding:10px 18px;border-radius:999px;',
    'background:linear-gradient(135deg,var(--accent),var(--accent-2,var(--accent)));box-shadow:0 10px 30px color-mix(in srgb,var(--accent) 45%,transparent);',
    'animation:fxUp 1.3s cubic-bezier(.2,.8,.2,1) forwards}',
    '@keyframes fxUp{0%{opacity:0;transform:translate(-50%,20px) scale(.7)}15%{opacity:1;transform:translate(-50%,0) scale(1.08)}30%{transform:translate(-50%,0) scale(1)}80%{opacity:1}100%{opacity:0;transform:translate(-50%,-70px) scale(.95)}}',
    '.fx-modal{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(10,8,30,.45);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:fxFade .25s ease}',
    '.fx-card{width:min(86vw,340px);border-radius:28px;padding:26px 22px;text-align:center;color:#fff;',
    'background:linear-gradient(150deg,var(--accent),var(--accent-2,var(--accent)));box-shadow:0 24px 60px rgba(0,0,0,.35);animation:fxPop .5s cubic-bezier(.2,1.4,.4,1)}',
    '.fx-card__ico{font-size:54px;line-height:1;margin-bottom:8px;animation:fxSpin 1.2s ease-out}',
    '.fx-card__t{font:800 24px/1.15 var(--font-display);margin:0 0 6px}',
    '.fx-card__s{font-size:15px;opacity:.92;margin:0 0 16px}',
    '.fx-card button{border:0;border-radius:999px;padding:12px 26px;font:700 16px var(--font-body);background:#fff;color:var(--accent);cursor:pointer;box-shadow:0 4px 0 rgba(0,0,0,.15)}',
    '@keyframes fxPop{0%{transform:scale(.6);opacity:0}100%{transform:scale(1);opacity:1}}',
    '@keyframes fxFade{from{opacity:0}to{opacity:1}}',
    '@keyframes fxSpin{0%{transform:scale(0) rotate(-40deg)}70%{transform:scale(1.2) rotate(8deg)}100%{transform:scale(1) rotate(0)}}',
    '.fx-confetti{position:fixed;inset:0;pointer-events:none;z-index:10001}'
  ].join('');
  function ensure() {
    if (document.getElementById('fx-css')) return;
    const s = document.createElement('style'); s.id = 'fx-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  let lastXpAt = 0, pending = 0, xpTimer = null;
  function burst(text) {
    ensure();
    const el = document.createElement('div');
    el.className = 'fx-xp'; el.textContent = text;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 1400);
  }
  function onXp(p) {
    // regroupe les gains rapprochés (une note + un bonus) en une seule bulle
    pending += Number(p && p.xp) || 0;
    clearTimeout(xpTimer);
    xpTimer = setTimeout(function () { if (pending > 0) burst('+' + pending + ' XP'); pending = 0; }, 120);
    lastXpAt = Date.now();
  }

  const queue = [];
  let showing = false;
  function modal(ico, title, sub, withConfetti) {
    queue.push({ ico: ico, title: title, sub: sub, confetti: withConfetti });
    if (!showing) next();
  }
  function next() {
    const it = queue.shift();
    if (!it) { showing = false; return; }
    showing = true; ensure();
    const wrap = document.createElement('div'); wrap.className = 'fx-modal'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-live', 'polite');
    const card = document.createElement('div'); card.className = 'fx-card';
    card.innerHTML = '<div class="fx-card__ico" aria-hidden="true"></div><p class="fx-card__t"></p><p class="fx-card__s"></p><button type="button">Continuer</button>';
    card.querySelector('.fx-card__ico').textContent = it.ico;
    card.querySelector('.fx-card__t').textContent = it.title;
    card.querySelector('.fx-card__s').textContent = it.sub;
    wrap.appendChild(card); document.body.appendChild(wrap);
    const close = function () { wrap.remove(); setTimeout(next, 150); };
    card.querySelector('button').addEventListener('click', close);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    if (it.confetti) confetti();
    try { if (navigator.vibrate) navigator.vibrate([20, 40, 20]); } catch (e) { /* ignore */ }
  }

  function confetti() {
    if (reduced()) return;
    ensure();
    const cv = document.createElement('canvas'); cv.className = 'fx-confetti';
    const W = cv.width = window.innerWidth, H = cv.height = window.innerHeight;
    document.body.appendChild(cv);
    const ctx = cv.getContext('2d');
    const cs = getComputedStyle(document.documentElement);
    const cols = [cs.getPropertyValue('--accent').trim() || '#5B4BF0', cs.getPropertyValue('--accent-2').trim() || '#EC4899', '#FBBF24', '#34D399', '#60A5FA', '#F472B6'];
    const N = 140, ps = [];
    for (let i = 0; i < N; i++) ps.push({ x: W / 2 + (Math.random() - 0.5) * 80, y: H * 0.45, vx: (Math.random() - 0.5) * 13, vy: -Math.random() * 15 - 5, r: 4 + Math.random() * 5, c: cols[i % cols.length], a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4 });
    const t0 = performance.now();
    (function frame(t) {
      const dt = t - t0;
      ctx.clearRect(0, 0, W, H);
      ps.forEach(function (p) {
        p.vy += 0.38; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - dt / 2600);
        ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore();
      });
      if (dt < 2600) requestAnimationFrame(frame); else cv.remove();
    })(t0);
  }

  function bind() {
    const u = CARDIO.util;
    if (!u || typeof u.on !== 'function') { setTimeout(bind, 200); return; }
    u.on('store:xp', onXp);
    u.on('store:xplevel', function (p) { modal('⭐', 'Niveau ' + (p && p.level) + ' !', (p && p.name ? p.name + ' · ' : '') + 'Continue comme ça.', true); });
    u.on('store:badge', function (p) {
      const id = String((p && p.badge) || '');
      // les grands badges ont droit à la célébration plein écran ; les autres à une bulle discrète
      if (/^(pj-|streak-|item-mastered-|all-A)/.test(id)) modal('🏆', 'Badge débloqué', badgeName(id), true);
      else burst('🏆 ' + badgeName(id));
    });
  }
  bind();

  CARDIO.fx = { confetti: confetti, burst: burst, badgeName: badgeName, celebrate: function (t, s) { modal('🎉', t, s, true); } };
})();
