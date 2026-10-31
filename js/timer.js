/* CardioR2C — js/timer.js
 * Minuteur de bloc (type Pomodoro) : un bloc de travail chronométré, puis une pause proposée.
 * Pastille flottante visible sur toutes les pages ; l'heure de fin est gardée (localStorage « cardio.timer »),
 * donc le minuteur continue si on change de page ou recharge. Fin de bloc : son, vibration, carte de fin.
 * API : CARDIO.timer.start({ label, min, kind: 'work' | 'break' }), CARDIO.timer.stop(), CARDIO.timer.presets()
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  const KEY = 'cardio.timer';
  let tick = null, audio = null, open = false, baseTitle = null;

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function save(s) { try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }
  function left(s) { return s.paused != null ? s.paused : Math.max(0, s.end - Date.now()); }
  function fmt(ms) { const t = Math.ceil(ms / 1000), m = Math.floor(t / 60), x = t % 60; return m + ':' + (x < 10 ? '0' : '') + x; }
  function el(tag, attrs, kids) {
    const e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'on') Object.keys(attrs.on).forEach(function (ev) { e.addEventListener(ev, attrs.on[ev]); }); else e.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }

  function styles() {
    if (document.getElementById('tm-css')) return;
    const st = document.createElement('style'); st.id = 'tm-css';
    st.textContent = [
      '.tm{position:fixed;right:12px;bottom:calc(var(--tabbar-h,60px) + 12px + env(safe-area-inset-bottom,0px));z-index:60;font-family:inherit}',
      '@media (min-width:1024px){.tm{bottom:20px}}',
      '.tm__pill{display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;border:0;cursor:pointer;color:#fff;font-weight:800;font-size:15px;',
      'background:linear-gradient(135deg,var(--accent,#5b5bd6),var(--accent-2,var(--accent,#5b5bd6)));box-shadow:0 6px 18px rgba(0,0,0,.22)}',
      '.tm__pill--break{background:linear-gradient(135deg,#16a34a,#0ea5a4)}',
      '.tm__pill--paused{opacity:.75}',
      '.tm__ring{width:22px;height:22px;border-radius:50%;flex:none}',
      '.tm__panel{margin-top:8px;padding:12px;border-radius:16px;background:var(--surface,#fff);color:var(--text,#111);box-shadow:0 10px 30px rgba(0,0,0,.25);display:grid;gap:8px;min-width:230px;max-width:calc(100vw - 24px)}',
      '.tm__row{display:flex;gap:6px;flex-wrap:wrap}',
      '.tm__b{border:1px solid var(--line,#ddd);background:var(--surface,#fff);color:inherit;border-radius:10px;padding:6px 10px;font-weight:700;cursor:pointer;font-size:14px}',
      '.tm__b--p{background:var(--accent,#5b5bd6);border-color:transparent;color:#fff}',
      '.tm__end{position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);padding:16px}',
      '.tm__card{background:var(--surface,#fff);color:var(--text,#111);border-radius:20px;padding:20px;max-width:360px;width:100%;display:grid;gap:10px;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.3)}',
      '.tm__card h3{margin:0;font-size:20px}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function beep() {
    try {
      if (!audio) return;
      if (audio.state === 'suspended') audio.resume();
      [0, 0.35, 0.7].forEach(function (d) {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = 'sine'; o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
        const t0 = audio.currentTime + d;
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
        o.start(t0); o.stop(t0 + 0.32);
      });
    } catch (e) { /* ignore */ }
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 300]); } catch (e) { /* ignore */ }
  }

  function root() {
    let r = document.getElementById('tm-root');
    if (!r) { r = el('div', { id: 'tm-root', class: 'tm' }); document.body.appendChild(r); }
    return r;
  }

  function render() {
    const s = load(); const r = root();
    if (!s) { r.replaceChildren(); r.hidden = true; if (baseTitle != null) { document.title = baseTitle; baseTitle = null; } return; }
    r.hidden = false;
    const ms = left(s), frac = s.total ? 1 - ms / s.total : 0, brk = s.kind === 'break';
    const ring = el('span', { class: 'tm__ring', style: 'background:conic-gradient(#fff ' + Math.round(frac * 360) + 'deg, rgba(255,255,255,.3) 0)' });
    const pill = el('button', { type: 'button', class: 'tm__pill' + (brk ? ' tm__pill--break' : '') + (s.paused != null ? ' tm__pill--paused' : ''), 'aria-label': 'Minuteur de bloc', on: { click: function () { open = !open; render(); } } },
      [ring, (brk ? '☕ ' : '⏱ ') + fmt(ms) + (s.paused != null ? ' ⏸' : '')]);
    const kids = [pill];
    if (open) {
      kids.push(el('div', { class: 'tm__panel' }, [
        el('b', {}, [brk ? 'Pause' : (s.label || 'Bloc de travail')]),
        el('span', { style: 'font-size:13px;opacity:.75' }, [brk ? 'Lève-toi, bouge, bois de l’eau. Pas d’écran si possible.' : 'Téléphone loin, une seule tâche. Tu tiens jusqu’au bip.']),
        el('div', { class: 'tm__row' }, [
          el('button', { type: 'button', class: 'tm__b tm__b--p', on: { click: function () { const x = load(); if (!x) return; if (x.paused != null) { x.end = Date.now() + x.paused; x.paused = null; } else x.paused = left(x); save(x); render(); } } }, [s.paused != null ? '▶ Reprendre' : '⏸ Pause']),
          el('button', { type: 'button', class: 'tm__b', on: { click: function () { const x = load(); if (!x) return; if (x.paused != null) x.paused += 5 * 60000; else x.end += 5 * 60000; x.total += 5 * 60000; save(x); render(); } } }, ['+5 min']),
          el('button', { type: 'button', class: 'tm__b', on: { click: function () { stop(); } } }, ['✕ Arrêter'])
        ])
      ]));
    }
    r.replaceChildren.apply(r, kids);
    { baseTitle = document.title.replace(/^[⏱☕] \d+:\d\d · /, ''); document.title = (brk ? '☕ ' : '⏱ ') + fmt(ms) + ' · ' + baseTitle; }
  }

  function finish(s) {
    save(null); open = false; render(); beep();
    const brk = s.kind === 'break';
    if (!brk) { try { if (CARDIO.store && CARDIO.store.gainXp) CARDIO.store.gainXp(10, 'Bloc tenu'); } catch (e) { /* ignore */ } }
    const close = function () { ov.remove(); };
    const go = function (fn) { return function () { close(); fn(); }; };
    const btns = brk
      ? [el('button', { type: 'button', class: 'tm__b tm__b--p', on: { click: go(function () { location.hash = '#/planj'; }) } }, ['Au bloc suivant']),
         el('button', { type: 'button', class: 'tm__b', on: { click: close } }, ['Fermer'])]
      : [el('button', { type: 'button', class: 'tm__b tm__b--p', on: { click: go(function () { start({ kind: 'break', min: 5, label: 'Pause' }); }) } }, ['☕ Pause 5 min']),
         el('button', { type: 'button', class: 'tm__b', on: { click: go(function () { start({ kind: 'break', min: 10, label: 'Pause' }); }) } }, ['☕ Pause 10 min']),
         el('button', { type: 'button', class: 'tm__b', on: { click: go(function () { start({ kind: 'work', min: 5, label: s.label }); }) } }, ['+5 min de travail']),
         el('button', { type: 'button', class: 'tm__b', on: { click: close } }, ['Fermer'])];
    const ov = el('div', { class: 'tm__end', role: 'dialog', 'aria-modal': 'true' }, [
      el('div', { class: 'tm__card' }, [
        el('div', { style: 'font-size:42px' }, [brk ? '⏰' : '🎉']),
        el('h3', {}, [brk ? 'Pause terminée' : 'Bloc terminé !']),
        el('p', { style: 'margin:0;opacity:.8' }, [brk ? 'On repart : ouvre ton créneau suivant.' : (s.label ? s.label + ' : ' : '') + 'bien joué (+10 XP). Une vraie pause maintenant, ton cerveau consolide.']),
        el('div', { class: 'tm__row', style: 'justify-content:center' }, btns)
      ])
    ]);
    document.body.appendChild(ov);
    try { if (!brk && CARDIO.fx && CARDIO.fx.confetti) CARDIO.fx.confetti(); } catch (e) { /* ignore */ }
  }

  function loop() {
    clearInterval(tick);
    tick = setInterval(function () {
      const s = load();
      if (!s) { clearInterval(tick); tick = null; render(); return; }
      if (s.paused == null && s.end <= Date.now()) { clearInterval(tick); tick = null; finish(s); return; }
      render();
    }, 1000);
  }

  function start(o) {
    styles();
    try { const AC = window.AudioContext || window.webkitAudioContext; if (AC && !audio) audio = new AC(); if (audio && audio.state === 'suspended') audio.resume(); } catch (e) { /* ignore */ }
    const min = Math.max(1, Math.min(180, Math.round(Number(o && o.min) || 25)));
    const s = { label: o && o.label ? String(o.label).slice(0, 80) : '', kind: o && o.kind === 'break' ? 'break' : 'work', end: Date.now() + min * 60000, total: min * 60000, paused: null };
    save(s); open = false; render(); loop();
    try { if (CARDIO.shell && CARDIO.shell.toast) CARDIO.shell.toast((s.kind === 'break' ? 'Pause de ' : 'Bloc de ') + min + ' min lancé', { tone: 'ok' }); } catch (e) { /* ignore */ }
  }
  function stop() { save(null); clearInterval(tick); tick = null; open = false; render(); }
  function presets() { return [25, 45, 60]; }

  function boot() {
    styles();
    const s = load();
    if (s) { if (s.paused == null && s.end <= Date.now()) { save(null); } else { render(); loop(); } }
    document.addEventListener('visibilitychange', function () { const x = load(); if (x && x.paused == null && x.end <= Date.now()) { clearInterval(tick); tick = null; finish(x); } else render(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  CARDIO.timer = { start: start, stop: stop, presets: presets, active: function () { return !!load(); } };
})();
