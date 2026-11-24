/* CardioR2C — views/paquets.js
 * « Paquets du soir » : Aymen regroupe les chapitres qu'il a vus en paquets ; chaque soir (20-30 min) il fait une
 * séance : 🔥 échauffement (quelques QCM) → 📄 lecture complète des fiches EDNi → ✍️ QCM du soir. Les anciens paquets
 * reviennent à J+1, J+3, J+7, J+15, J+30, J+60 (rappel par QCM).
 * Données : fiches EDN (CARDIO.registry.ednfiches, clé = n° d'item, « 400b » pour le bonus) ; QCM = banque EDN
 *   (CARDIO.registry.edn, items « 152 », « d111 », « p359bis »… ; lancés par CARDIO.views.edn.trainItems).
 * Routes : #/paquets (liste) · #/paquets/nouveau · #/paquets/:id (séance + chapitres) · #/paquets/:id/modifier.
 * Stockage : localStorage « cardio.paquets » = {list: [{id, name, items: [cléFiche], created, sessions: [{at, note, nq}]}]}
 *   (synchronisé via js/lsync.js). API : CARDIO.paquets = {list, get, logSession, nextFiche}. */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const C = window.CARDIO;
  C.views = C.views || {};
  const LS = 'cardio.paquets';
  const DAY = 86400000;
  const GAPS = [1, 3, 7, 15, 30, 60];   // jours avant le rappel suivant, selon le nombre de séances déjà faites

  function h() { return C.util.h.apply(null, arguments); }
  function toast(m, tone) { try { C.shell.toast(m, tone ? { tone: tone } : undefined); } catch (e) { /* ignore */ } }
  function data() { try { const o = JSON.parse(localStorage.getItem(LS) || '{}'); return o && Array.isArray(o.list) ? o : { list: [] }; } catch (e) { return { list: [] }; } }
  function save(d) { try { localStorage.setItem(LS, JSON.stringify(d)); } catch (e) { /* ignore */ } }
  function list() { return data().list; }
  function get(id) { return list().filter(function (p) { return p.id === id; })[0] || null; }
  function update(id, fn) { const d = data(); const p = d.list.filter(function (x) { return x.id === id; })[0]; if (p) { fn(p, d); save(d); } return p; }

  /* ---------- fiches EDN & banque de QCM ---------- */
  function fiches() { const r = C.registry && C.registry.ednfiches; return Array.isArray(r) ? r : []; }
  function fkey(f) { return f.n + (String(f.t).indexOf('BONUS') === 0 ? 'b' : ''); }
  function fiche(k) { return fiches().filter(function (f) { return fkey(f) === String(k); })[0] || null; }
  function pad(n) { return n < 100 ? ('00' + n).slice(-3) : String(n); }
  function bankItems() { const b = C.registry && C.registry.edn; return (b && b.items) || {}; }
  function bankKeys(k) {
    k = String(k); if (/b$/.test(k)) return [];
    return Object.keys(bankItems()).filter(function (x) { return x.replace(/^[dp]/, '').replace(/bis$/, '') === k; });
  }
  function edn() { return C.views && C.views.edn && C.views.edn.trainItems ? C.views.edn : null; }
  function nQcm(keys) { const e = edn(); return e ? e.countForItems(keys) : 0; }
  function paqKeys(p) { return (p.items || []).reduce(function (a, k) { return a.concat(bankKeys(k)); }, []); }
  function readAt(k) { try { const o = JSON.parse(localStorage.getItem('cardio.ednfiches') || '{}'); return o[k] ? Number(o[k].at) || 0 : 0; } catch (e) { return 0; } }
  function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function readToday(k) { return readAt(k) >= startOfDay(Date.now()); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function lastAt(p) { const s = p.sessions || []; return s.length ? s[s.length - 1].at : 0; }
  function dueAt(p) { const s = p.sessions || []; if (!s.length) return 0; return startOfDay(lastAt(p)) + GAPS[Math.min(s.length - 1, GAPS.length - 1)] * DAY; }
  function isDue(p) { return dueAt(p) <= Date.now(); }
  function fmtDay(t) {
    if (!t) return '';
    const d = Math.round((startOfDay(t) - startOfDay(Date.now())) / DAY);
    if (d === 0) return 'aujourd’hui'; if (d === -1) return 'hier'; if (d === 1) return 'demain';
    return d < 0 ? 'il y a ' + (-d) + ' j' : 'dans ' + d + ' j';
  }

  /* ---------- API ---------- */
  function logSession(ids, note, nq) {
    String(ids).split('|').forEach(function (id) { logOne(id, note, nq); });
  }
  function logOne(id, note, nq) {
    update(id, function (p) {
      p.sessions = p.sessions || [];
      const last = p.sessions[p.sessions.length - 1];
      // plusieurs séances le même jour (échauffement + QCM du soir) = une seule étape de rappel
      if (last && startOfDay(last.at) === startOfDay(Date.now())) { last.at = Date.now(); last.note = note; last.nq = (last.nq || 0) + nq; }
      else p.sessions.push({ at: Date.now(), note: note, nq: nq });
    });
  }
  function nextFiche(id, cur) {
    const p = get(id); if (!p) return null;
    const its = p.items || [], i = its.indexOf(String(cur));
    const after = its.slice(i + 1).concat(its.slice(0, Math.max(0, i)));
    return after.filter(function (k) { return fiche(k) && !readToday(k) && k !== String(cur); })[0] || null;
  }
  C.paquets = { list: list, get: get, logSession: logSession, nextFiche: nextFiche };

  /* ---------- styles ---------- */
  let styled = false;
  function styles() {
    if (styled) return; styled = true;
    const css = [
      '.pq-row{display:flex;align-items:center;gap:10px;padding:10px 14px;border-top:1px solid var(--line)}', '.pq-row:first-child{border-top:0}',
      '.pq-num{font:700 .9rem/1 var(--font-mono);color:var(--muted);min-width:34px}',
      '.pq-t{flex:1 1 auto;min-width:0;line-height:1.3;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
      '.pq-box{background:var(--surface);border-radius:var(--r-m);box-shadow:var(--shadow-1);overflow:hidden}',
      '.pq-step{display:flex;gap:12px;align-items:flex-start}', '.pq-dot{flex:none;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:var(--accent-soft);font-size:1rem}',
      '.pq-step.ok .pq-dot{background:var(--ok-soft)}', '.pq-tag{flex:none;font-size:.72rem;font-weight:700;padding:2px 8px;border-radius:999px;background:var(--surface-2);color:var(--muted);white-space:nowrap}',
      '.pq-tag.ok{background:var(--ok-soft);color:var(--ok)}', '.pq-tag.due{background:var(--warn-soft);color:var(--warn)}',
      '.pq-pick{display:flex;align-items:center;gap:10px;padding:9px 14px;border-top:1px solid var(--line);cursor:pointer}', '.pq-pick input{width:20px;height:20px;flex:none;accent-color:var(--accent)}'
    ].join('\n');
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  }

  function launch(p, keys, size, title) {
    const e = edn();
    if (!e) { toast('Banque de QCM indisponible', 'warn'); return; }
    const ok = e.trainItems({ keys: keys, size: size, title: title, backHref: '#/paquets/' + encodeURIComponent(p.id), backLabel: p.name, paquet: p.id });
    if (!ok) toast('Pas encore de QCM pour ces chapitres', 'warn');
  }

  /* ---------- liste ---------- */
  function renderList() {
    styles();
    const page = h('div', { class: 'page' });
    page.dataset.title = 'Paquets du soir';
    const ps = list();
    page.appendChild(h('div', { class: 'card stack stack--sm' },
      h('div', { class: 'caption' }, '🌙 Paquets du soir'),
      h('strong', { style: 'font-size:1.15rem' }, 'Chaque soir, 20-30 min : quelques QCM → la fiche EDNi en entier → les QCM du soir.'),
      h('p', { class: 'secondary', style: 'margin:0' }, 'Regroupe les chapitres que tu as vus en paquets. Commencer par quelques QCM rend la lecture plus ciblée ; les anciens paquets reviennent à J+1, J+3, J+7, J+15, J+30, J+60.'),
      h('a', { class: 'btn btn--primary', href: '#/paquets/nouveau' }, '＋ Nouveau paquet')));

    const due = ps.filter(function (p) { return (p.sessions || []).length && isDue(p); });
    if (due.length) {
      const keys = due.reduce(function (a, p) { return a.concat(paqKeys(p)); }, []);
      const n = nQcm(keys);
      page.appendChild(h('div', { class: 'card stack stack--sm', style: 'border-left:4px solid var(--warn)' },
        h('strong', {}, '🔁 Rappel : ' + due.length + ' ancien' + (due.length > 1 ? 's' : '') + ' paquet' + (due.length > 1 ? 's' : '') + ' à revoir'),
        h('div', { class: 'secondary' }, due.map(function (p) { return p.name; }).join(' · ')),
        n ? h('button', { type: 'button', class: 'btn btn--secondary', on: { click: function () {
          const e = edn(); if (!e) return;
          // une seule séance mélangée ; chaque paquet du rappel avance d'une étape à la fin
          const ok = e.trainItems({ keys: keys, size: 10, title: 'Rappel des anciens paquets', backHref: '#/paquets', backLabel: 'Paquets du soir', paquet: due.map(function (p) { return p.id; }).join('|') });
          if (!ok) toast('Pas de QCM pour ces chapitres', 'warn');
        } } }, '✍️ 10 QCM de rappel') : h('div', { class: 'secondary' }, 'Pas de QCM pour ces chapitres : relis leurs fiches.')));
    }

    if (!ps.length) {
      page.appendChild(h('div', { class: 'card empty' }, h('p', { class: 'empty__title' }, 'Aucun paquet pour l’instant'),
        h('p', { class: 'secondary' }, 'Crée ton premier paquet avec les chapitres de la semaine.')));
      return page;
    }
    const box = h('div', { class: 'pq-box' });
    ps.slice().reverse().forEach(function (p) {
      const ns = (p.sessions || []).length;
      const tag = !ns ? h('span', { class: 'pq-tag due' }, 'à démarrer') : isDue(p) ? h('span', { class: 'pq-tag due' }, 'rappel dû') : h('span', { class: 'pq-tag ok' }, 'rappel ' + fmtDay(dueAt(p)));
      box.appendChild(h('a', { class: 'pq-row', href: '#/paquets/' + encodeURIComponent(p.id), style: 'text-decoration:none;color:inherit' },
        h('span', { style: 'font-size:1.3rem' }, '📦'),
        h('span', { class: 'pq-t' }, h('b', {}, p.name), h('div', { class: 'secondary', style: 'font-size:.8rem' },
          (p.items || []).length + ' chapitre' + ((p.items || []).length > 1 ? 's' : '') + ' · ' + nQcm(paqKeys(p)) + ' QCM' + (ns ? ' · ' + ns + ' séance' + (ns > 1 ? 's' : '') + ', dernière ' + fmtDay(lastAt(p)) : ''))),
        tag));
    });
    page.appendChild(box);
    return page;
  }

  /* ---------- un paquet : séance du soir ---------- */
  function renderPaquet(p) {
    styles();
    const page = h('div', { class: 'page' });
    page.dataset.title = p.name;
    const its = (p.items || []).filter(function (k) { return fiche(k); });
    const keys = paqKeys(p), nq = nQcm(keys);
    const nRead = its.filter(readToday).length;
    const firstUnread = its.filter(function (k) { return !readToday(k); })[0];
    const ns = (p.sessions || []).length;
    const today = ns && startOfDay(lastAt(p)) === startOfDay(Date.now());

    page.appendChild(h('div', { class: 'stack stack--sm' },
      h('div', { class: 'caption' }, '📦 Paquet · ' + its.length + ' chapitre' + (its.length > 1 ? 's' : '') + ' · ' + nq + ' QCM'),
      h('h2', { style: 'margin:0;font-size:1.4rem' }, p.name),
      h('div', { class: 'secondary', style: 'font-size:.85rem' }, !ns ? 'Pas encore de séance.' : ns + ' séance' + (ns > 1 ? 's' : '') + ' · dernière ' + fmtDay(lastAt(p)) +
        (p.sessions[ns - 1].note != null ? ' (' + (Math.round(p.sessions[ns - 1].note * 10) / 10) + '/20)' : '') + ' · prochain rappel ' + fmtDay(dueAt(p)))));

    const step = function (done, ico, title, sub, action) {
      return h('div', { class: 'pq-step' + (done ? ' ok' : '') }, h('span', { class: 'pq-dot' }, done ? '✓' : ico),
        h('div', { class: 'stack stack--sm', style: 'flex:1;min-width:0' }, h('strong', {}, title), sub ? h('div', { class: 'secondary', style: 'font-size:.85rem' }, sub) : null, action));
    };
    page.appendChild(h('div', { class: 'card stack' },
      h('div', { class: 'caption' }, '🌙 Séance du soir · 20-30 min'),
      step(false, '🔥', '1. Échauffement : 5 QCM', 'Avant de lire : chercher la réponse rend la lecture bien plus efficace.',
        nq ? h('button', { type: 'button', class: 'btn btn--secondary btn--sm', on: { click: function () { launch(p, keys, 5, p.name + ' · échauffement'); } } }, 'Lancer 5 QCM') : h('span', { class: 'secondary', style: 'font-size:.8rem' }, 'Pas de QCM pour ces chapitres.')),
      step(its.length && nRead === its.length, '📄', '2. Lire les fiches EDNi en entier', nRead + ' / ' + its.length + ' lue' + (nRead > 1 ? 's' : '') + ' aujourd’hui · ✓ « Lue » en bas de chaque fiche passe à la suivante du paquet.',
        firstUnread ? h('a', { class: 'btn btn--primary btn--sm', href: '#/ednfiches/' + firstUnread + '?paquet=' + encodeURIComponent(p.id) }, nRead ? '▶ Continuer la lecture' : '▶ Commencer la lecture') : null),
      step(today && (p.sessions[ns - 1].nq || 0) >= 10, '✍️', '3. QCM du soir : 15 QCM (ou plus)', 'Correction après chaque validation ; tes erreurs reviennent en priorité les soirs suivants.',
        nq ? h('div', { class: 'cluster' },
          h('button', { type: 'button', class: 'btn btn--primary btn--sm', on: { click: function () { launch(p, keys, 15, p.name + ' · QCM du soir'); } } }, 'Lancer 15 QCM'),
          [30, 50].filter(function (n) { return n < nq; }).map(function (n) {
            return h('button', { type: 'button', class: 'btn btn--secondary btn--sm', on: { click: function () { launch(p, keys, n, p.name + ' · ' + n + ' QCM'); } } }, n);
          }),
          h('button', { type: 'button', class: 'btn btn--outline btn--sm', on: { click: function () { launch(p, keys, nq, p.name + ' · tout le paquet'); } } }, 'Tout (' + nq + ')')) : null),
      nq ? h('p', { class: 'secondary', style: 'margin:0;font-size:.8rem' }, '🔀 Les QCM sont toujours mélangés entre tous les chapitres du paquet (même nombre par chapitre, ceux jamais faits d’abord). Tu peux relancer autant de séries que tu veux.') : null));

    const box = h('div', { class: 'pq-box' });
    its.forEach(function (k) {
      const f = fiche(k), bk = bankKeys(k), n = nQcm(bk);
      let st = null;
      if (n && edn() && edn().itemStats) {
        const s = bk.map(function (x) { return edn().itemStats(x); }).reduce(function (a, b) { return { n: a.n + b.n, seen: a.seen + b.seen, sum: a.sum + (b.avg || 0) * b.seen }; }, { n: 0, seen: 0, sum: 0 });
        st = s.seen ? Math.round(100 * s.sum / s.seen) + ' % · ' + s.seen + '/' + s.n + ' faites' : null;
      }
      box.appendChild(h('div', { class: 'pq-row' },
        h('span', { class: 'pq-num' }, pad(f.n)),
        h('span', { class: 'pq-t' }, f.t, st ? h('div', { class: 'secondary', style: 'font-size:.78rem' }, 'QCM : ' + st) : null),
        h('a', { class: 'btn btn--sm ' + (readToday(k) ? 'btn--ok' : 'btn--outline'), href: '#/ednfiches/' + k + '?paquet=' + encodeURIComponent(p.id), title: 'Lire la fiche' }, readToday(k) ? '✓ 📄' : '📄'),
        n ? h('button', { type: 'button', class: 'btn btn--sm btn--secondary', title: 'QCM de ce chapitre', on: { click: function () { launch(p, bk, 10, pad(f.n) + ' · QCM'); } } }, '✍️ ' + n) : h('span', { class: 'pq-tag', title: 'Pas de QCM dans la banque pour cet item' }, '0 QCM')));
    });
    page.appendChild(h('div', { class: 'section-head' }, h('h3', {}, 'Chapitres'), h('a', { href: '#/paquets/' + encodeURIComponent(p.id) + '/modifier' }, '✏️ Modifier')));
    page.appendChild(its.length ? box : h('p', { class: 'secondary' }, 'Aucun chapitre : ajoute-en avec « Modifier ».'));
    if (its.some(function (k) { return !nQcm(bankKeys(k)); })) {
      page.appendChild(h('p', { class: 'secondary', style: 'font-size:.8rem' }, 'Les QCM viennent de la banque EDN de l’appli (cardio, dermato, pneumo). Pour les autres items, la fiche reste disponible ; tu peux t’entraîner sur les annales et les polys à côté.'));
    }
    return page;
  }

  /* ---------- création / modification ---------- */
  function renderEdit(p) {
    styles();
    const isNew = !p;
    const draft = { name: p ? p.name : 'Paquet ' + (list().length + 1), items: p ? (p.items || []).slice() : [] };
    const page = h('div', { class: 'page' });
    page.dataset.title = isNew ? 'Nouveau paquet' : 'Modifier le paquet';
    const name = h('input', { class: 'input', value: draft.name, placeholder: 'Nom du paquet (ex. Coronaires + HTA)' });
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Chercher un n° ou un mot (ex. 334, asthme)…' });
    let onlyQ = false;
    const count = h('span', { class: 'secondary' });
    const host = h('div', { class: 'pq-box' });
    const onlyBtn = h('button', { type: 'button', class: 'chip' }, 'Avec QCM seulement');
    onlyBtn.addEventListener('click', function () { onlyQ = !onlyQ; onlyBtn.classList.toggle('is-on', onlyQ); draw(); });
    function draw() {
      count.textContent = draft.items.length + ' chapitre' + (draft.items.length > 1 ? 's' : '') + ' choisi' + (draft.items.length > 1 ? 's' : '');
      host.textContent = '';
      const q = norm(search.value.trim());
      const sel = {}; draft.items.forEach(function (k) { sel[k] = 1; });
      let rows = fiches().filter(function (f) {
        const k = fkey(f);
        if (onlyQ && !nQcm(bankKeys(k))) return false;
        if (!q) return true;
        if (/^\d+$/.test(q)) return String(f.n).indexOf(String(Number(q))) === 0;
        return norm(f.t).indexOf(q) >= 0;
      });
      rows.sort(function (a, b) { return (sel[fkey(b)] ? 1 : 0) - (sel[fkey(a)] ? 1 : 0) || a.n - b.n; });
      if (!q && !onlyQ) rows = rows.filter(function (f) { return sel[fkey(f)]; }).concat(rows.filter(function (f) { return !sel[fkey(f)]; }).slice(0, 60));
      rows.forEach(function (f) {
        const k = fkey(f), n = nQcm(bankKeys(k));
        const cb = h('input', { type: 'checkbox', checked: !!sel[k] });
        cb.addEventListener('change', function () {
          if (cb.checked) { if (draft.items.indexOf(k) < 0) draft.items.push(k); } else draft.items = draft.items.filter(function (x) { return x !== k; });
          count.textContent = draft.items.length + ' chapitre' + (draft.items.length > 1 ? 's' : '') + ' choisi' + (draft.items.length > 1 ? 's' : '');
        });
        host.appendChild(h('label', { class: 'pq-pick' }, cb, h('span', { class: 'pq-num' }, pad(f.n)), h('span', { class: 'pq-t' }, f.t), h('span', { class: 'pq-tag' + (n ? ' ok' : '') }, n ? n + ' QCM' : f.p + ' p.')));
      });
      if (!q && !onlyQ) host.appendChild(h('div', { class: 'secondary', style: 'padding:10px 14px;font-size:.8rem' }, 'Cherche un numéro ou un mot pour voir les ' + fiches().length + ' fiches.'));
    }
    let tmr = null;
    search.addEventListener('input', function () { clearTimeout(tmr); tmr = setTimeout(draw, 150); });
    page.appendChild(h('div', { class: 'card stack' },
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Nom'), name),
      h('div', { class: 'search' }, search),
      h('div', { class: 'cluster' }, onlyBtn, count)));
    page.appendChild(host);
    page.appendChild(h('div', { class: 'card', style: 'position:sticky;bottom:12px;z-index:5;padding:10px 12px' }, h('div', { class: 'cluster', style: 'justify-content:space-between' },
      !isNew ? h('button', { type: 'button', class: 'btn btn--danger btn--sm', on: { click: function () {
        const go = function (ok) { if (!ok) return; const d = data(); d.list = d.list.filter(function (x) { return x.id !== p.id; }); save(d); location.hash = '#/paquets'; };
        try { C.shell.confirm('Supprimer le paquet « ' + p.name + ' » ? (les fiches et ta progression QCM restent)', { ok: 'Supprimer', tone: 'danger' }).then(go); } catch (e) { go(window.confirm('Supprimer ce paquet ?')); }
      } } }, 'Supprimer') : null,
      h('button', { type: 'button', class: 'btn btn--primary', on: { click: function () {
        const nm = name.value.trim() || draft.name;
        if (!draft.items.length) { toast('Choisis au moins un chapitre', 'warn'); return; }
        const d = data();
        let id = p && p.id;
        if (isNew) { id = 'pq' + Date.now().toString(36); d.list.push({ id: id, name: nm, items: draft.items, created: Date.now(), sessions: [] }); }
        else d.list.forEach(function (x) { if (x.id === id) { x.name = nm; x.items = draft.items; } });
        save(d); location.hash = '#/paquets/' + encodeURIComponent(id);
      } } }, isNew ? 'Créer le paquet' : 'Enregistrer'))));
    draw();
    return page;
  }

  function render(params) {
    const id = params && params.id;
    let el;
    if (id === 'nouveau') el = renderEdit(null);
    else if (id) { const p = get(id); el = !p ? renderList() : params.edit ? renderEdit(p) : renderPaquet(p); }
    else el = renderList();
    return { el: el, title: el.dataset.title || 'Paquets du soir', back: id ? (params.edit && get(id) ? '#/paquets/' + encodeURIComponent(id) : '#/paquets') : undefined };
  }
  C.views.paquets = { render: render, available: function () { return fiches().length > 0; } };
})();
