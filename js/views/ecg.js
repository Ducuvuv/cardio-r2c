/* CardioR2C — views/ecg.js
 * Banque d'ECG réels (docs/ECG_BANK.md) : tracés PTB-XL (PhysioNet, CC BY 4.0) redessinés, lecture vérifiée et
 * questions type EDN (QRM / QRU / QRP / QROC) tirées du Collège.
 * Données : CARDIO.registry.ecgBank = {ecgs: [{id, dx, secondary, rythme, fc, axe, pr, qrs, st_t, visible, objectifs,
 * rang, pieges, age, sex}], questions: [...], img: {id: 'content/ecg-img/ecg-NN.js'}} (content/ecg-bank.js, généré
 * par tools/_patches/_build_ecgbank.py). Images : paquets content/ecg-img/*.js chargés à la demande
 * (CARDIO.registry.ecgImg[id] = data: URI).
 * Routes : #/ecg (bibliothèque), #/ecg?id=<ecg> (un ECG), #/ecg?daily=1 (ECG du jour), #/ecg?train=1 (séance).
 * Progression : CARDIO.store, chemin « ecgq.<questionId> » = {n, ok, at, last} (ok = somme des scores, synchronisée).
 * Barème EDN : QRM 1 si parfait, 0,5 si une seule discordance, 0 sinon ; QRU / QRP / QROC 1 ou 0.
 * Script classique ES2020.
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const C = window.CARDIO;
  C.views = C.views || {};

  function h() { return C.util.h.apply(null, arguments); }
  function put(el) {
    const kids = Array.prototype.slice.call(arguments, 1).flat(Infinity).filter(function (k) { return k != null && k !== false; });
    el.replaceChildren.apply(el, kids);
  }
  function icon(name) { try { return C.util.iconEl(name, { size: 18 }); } catch (e) { return null; } }

  const CREDIT = 'ECG : PTB-XL (PhysioNet), CC BY 4.0 — tracé redessiné';
  /* ECG Wikimedia Commons : auteur + licence propres (lien vers la page source) */
  function credit(e) {
    if (e && e.credit) return h('a', { class: 'eb-credit', href: e.credit_url || '#', target: '_blank', rel: 'noopener' }, e.credit);
    return h('span', { class: 'eb-credit' }, CREDIT);
  }
  const LETTERS = 'ABCDEFGHIJ';
  const SS_DX = 'cardio.ecg.dx';
  const LS_TRAIN = 'cardio.ecg.train.v1';

  /* ---------------------------------------------------------------- données */
  function bank() {
    const b = (C.registry || {}).ecgBank;
    return b && Array.isArray(b.ecgs) ? { ecgs: b.ecgs, questions: Array.isArray(b.questions) ? b.questions : [], img: b.img || {} } : { ecgs: [], questions: [], img: {} };
  }
  function available() { return bank().ecgs.length > 0; }
  function ecgById(id) { return bank().ecgs.find(function (e) { return String(e.id) === String(id); }) || null; }
  function questionsOf(id) { return bank().questions.filter(function (q) { return String(q.ecg) === String(id); }); }
  function dxList(e) { return Array.isArray(e.dx) ? e.dx : (e.dx ? [String(e.dx)] : []); }
  /* Familles de diagnostics (filtres) : les libellés « dx » sont précis (« Flutter atrial avec conduction 2/1 »…),
     on les regroupe par mots-clés ; un ECG peut appartenir à plusieurs familles. */
  const FAMILIES = [
    ['ECG normal', /^(ECG )?normal\b/i],
    ['Fibrillation atriale', /fibrillation atriale/i],
    ['Flutter atrial', /flutter/i],
    ['Tachycardie jonctionnelle', /jonctionnelle|bouveret|intranodale/i],
    ['TV / torsade / FV', /[Tt]achycardie ventriculaire|\bTV\b|[Tt]orsade|[Ff]ibrillation ventriculaire/],
    ['Brugada', /brugada/i],
    ['Tachycardie sinusale', /tachycardie sinusale/i],
    ['Bradycardie sinusale', /bradycardie sinusale|dysfonction sinusale|pause sinusale/i],
    ['Extrasystoles', /extrasystol/i],
    ['BAV', /bloc atrio-?ventriculaire|\bBAV\b/i],
    ['Bloc de branche gauche', /branche gauche|\bBBG\b/i],
    ['Bloc de branche droit', /branche droit|\bBBD\b|bifasciculaire/i],
    ['Hémibloc', /h[ée]mibloc|bifasciculaire/i],
    ['Préexcitation (WPW)', /pr[ée]excitation|wolff/i],
    ['HVG', /hypertrophie ventriculaire gauche|\bHVG\b/i],
    ['Autres hypertrophies', /hypertrophie atriale|hypertrophie ventriculaire droite|\bHVD\b/i],
    ['Séquelle d’infarctus', /infarctus|n[ée]crose/i],
    ['SCA', /\bSCA\b|sus-d[ée]calage aigu/],
    ['Péricardite', /p[ée]ricardite/i],
    ['Pacemaker', /[ée]lectroentra[iî]nement|stimulat(eur|ion)|pacemaker/i],
    ['Dyskaliémie', /kali[ée]mie/i],
    ['QT long', /\bQT\b/],
    ['ST-T / repolarisation', /ondes? T\b|repolarisation|sous-d[ée]calage/i]
  ];
  function famsOf(e) {
    const out = [];
    dxList(e).forEach(function (d) { FAMILIES.forEach(function (f) { if (f[1].test(d) && out.indexOf(f[0]) < 0) out.push(f[0]); }); });
    if (!out.length) out.push('Autres');
    return out;
  }
  function allDx() {   // [[famille, nombre d'ECG]], dans l'ordre de FAMILIES
    const counts = {};
    bank().ecgs.forEach(function (e) { famsOf(e).forEach(function (d) { counts[d] = (counts[d] || 0) + 1; }); });
    return FAMILIES.map(function (f) { return f[0]; }).concat(['Autres']).filter(function (k) { return counts[k]; }).map(function (k) { return [k, counts[k]]; });
  }
  function patient(e) {
    const sex = e.sex === 'H' || e.sex === 'M' ? 'Homme' : e.sex === 'F' ? 'Femme' : '';
    const age = Number.isFinite(e.age) ? e.age + ' ans' : '';
    return [sex, age].filter(Boolean).join(', ');
  }
  function stat(qid) { const s = C.store; const v = s && s.get ? s.get('ecgq.' + qid) : null; return v && v.n ? v : null; }
  function ecgStatus(e) {   // '' jamais vu · 'ok' toutes faites, dernier essai ≥ 75 % · 'mid' sinon
    const qs = questionsOf(e.id);
    if (!qs.length) return '';
    const st = qs.map(function (q) { return stat(q.id); });
    if (!st.some(Boolean)) return '';
    const done = st.every(Boolean);
    const avg = st.reduce(function (n, s) { return n + (s ? s.last : 0); }, 0) / qs.length;
    return done && avg >= 0.75 ? 'ok' : 'mid';
  }
  function lsGet(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function dayKey() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dailyEcg() {
    const list = bank().ecgs.slice().sort(function (a, b) { return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0; });
    if (!list.length) return null;
    let x = 0; const k = dayKey();
    for (let i = 0; i < k.length; i++) x = (x * 31 + k.charCodeAt(i)) >>> 0;
    return list[x % list.length];
  }

  /* markdown-lite : texte échappé, **gras**, retours à la ligne */
  function md(s, cls) {
    const e = String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    return h('div', { class: cls || null, html: e.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>') });
  }

  /* ---------------------------------------------------------------- styles */
  let styled = false;
  function ensureStyles() {
    if (styled) return; styled = true;
    document.head.appendChild(h('style', {}, [
      '.eb-chips{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 12px}',
      '.eb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}',
      '.eb-th{position:relative;display:block;width:100%;border-radius:12px;overflow:hidden;background:#fff;border:1px solid var(--line);padding:0;cursor:pointer;text-align:left;font:inherit;color:var(--ink)}',
      '.eb-th__img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;object-position:0 0;background:var(--surface-2)}',
      '.eb-th__cap{display:block;padding:6px 8px;font-size:.8rem;line-height:1.25;background:var(--surface)}',
      '.eb-th__cap small{display:block;color:var(--muted);font-size:.72rem}',
      '.eb-dot{position:absolute;top:6px;right:6px;width:12px;height:12px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.15)}',
      '.eb-dot--ok{background:var(--ok)}.eb-dot--mid{background:var(--warn)}',
      '.eb-fig{margin:0}',
      '.eb-scroll{overflow:auto;-webkit-overflow-scrolling:touch;touch-action:pan-x pan-y pinch-zoom;background:#fff;border:1px solid var(--line);border-radius:12px;max-height:80vh}',
      '.eb-img{display:block;width:100%;height:auto;min-height:60px}',
      '.eb-scroll.is-zoom .eb-img{width:250%;max-width:none}',
      '.eb-img.is-missing{min-height:120px;background:repeating-linear-gradient(45deg,var(--surface-2),var(--surface-2) 10px,var(--surface) 10px,var(--surface) 20px)}',
      '.eb-figbar{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap}',
      '.eb-credit{font-size:.72rem;color:var(--muted)}',
      '.eb-read{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 12px;margin:8px 0 0}',
      '.eb-read dt{font-weight:600;color:var(--ink-2)}.eb-read dd{margin:0}',
      '.eb-list{margin:4px 0 0;padding-left:20px}.eb-list li{margin:3px 0}',
      '.eb-top{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}',
      '.eb-actions{position:sticky;bottom:calc(env(safe-area-inset-bottom,0px) + 72px);z-index:5;margin-top:12px}',
      '@media (min-width:900px){.eb-actions{bottom:12px}}',
      '.eb-seg{display:flex;flex-wrap:wrap;gap:6px}',
      '.eb-res{display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--line);font-size:.9rem}',
      '.eb-big{font-size:2.2rem;font-weight:700;line-height:1}',
      '.eb-qroc{width:100%}'
    ].join('\n')));
  }

  /* ---------------------------------------------------------------- images (paquets à la demande) */
  const chunkP = {};
  function loadChunk(src) {
    if (!chunkP[src]) chunkP[src] = new Promise(function (res) {
      const s = document.createElement('script'); s.src = src; s.charset = 'utf-8';
      s.onload = res; s.onerror = function () { delete chunkP[src]; res(); };
      document.head.appendChild(s);
    });
    return chunkP[src];
  }
  function imgData(id) { const m = (C.registry || {}).ecgImg; return (m && m[String(id)]) || null; }
  function ecgImg(e, cls, lazy) {
    const el = h('img', { class: cls, alt: 'ECG 12 dérivations' + (patient(e) ? ' — ' + patient(e) : ''), decoding: 'async' });
    function set() { const d = imgData(e.id); if (d) { el.src = d; el.classList.remove('is-missing'); } else el.classList.add('is-missing'); }
    if (imgData(e.id)) { set(); return el; }
    const src = bank().img[String(e.id)];
    if (!src) { el.classList.add('is-missing'); return el; }
    if (lazy) { lazyAdd(el, src, set); return el; }   // vignettes : paquet chargé quand l'image approche de l'écran
    loadChunk(src).then(set);
    return el;
  }
  // file d'attente des vignettes (même principe que views/atlas.js) : contrôle de position au défilement
  let lazy = [], lazyTimer = null;
  function lazyCheck() {
    const vh = window.innerHeight || 800;
    lazy = lazy.filter(function (p) {
      if (!p.el.isConnected) return !p.seen && Date.now() - p.t < 5000;   // pas encore inséré : on attend un peu
      p.seen = true;
      const r = p.el.getBoundingClientRect();
      if (r.bottom > -400 && r.top < vh + 400 && r.width > 0) { loadChunk(p.chunk).then(p.set); return false; }
      return true;
    });
    if (!lazy.length && lazyTimer) { clearInterval(lazyTimer); lazyTimer = null; }
  }
  function lazyAdd(el, chunk, set) {
    lazy.push({ el: el, chunk: chunk, set: set, t: Date.now() });
    if (!lazyTimer) lazyTimer = setInterval(lazyCheck, 400);
    setTimeout(lazyCheck, 30);
  }
  window.addEventListener('scroll', function () { if (lazy.length) lazyCheck(); }, { capture: true, passive: true });
  window.addEventListener('resize', function () { if (lazy.length) lazyCheck(); });
  /* image pleine largeur, défilable, zoom ×2,5 (bouton ou double tap), pincement natif */
  function figure(e) {
    let zoom = false;
    const im = ecgImg(e, 'eb-img', false);
    const sc = h('div', { class: 'eb-scroll' }, im);
    const btn = h('button', { type: 'button', class: 'btn btn--sm btn--outline', on: { click: toggle } }, 'Zoomer ×2,5');
    function toggle() { zoom = !zoom; sc.classList.toggle('is-zoom', zoom); btn.textContent = zoom ? 'Ajuster à l’écran' : 'Zoomer ×2,5'; }
    im.addEventListener('dblclick', toggle);
    return h('figure', { class: 'eb-fig' }, sc, h('figcaption', { class: 'eb-figbar' }, credit(e), btn));
  }

  /* ---------------------------------------------------------------- bibliothèque */
  function library(root) {
    const b = bank();
    const dxs = allDx();
    let dx = null, hide = false;
    try { const s = sessionStorage.getItem(SS_DX); if (s && dxs.some(function (d) { return d[0] === s; })) dx = s; } catch (e) { /* ignore */ }
    function paint() {
      const list = b.ecgs.filter(function (e) { return !dx || famsOf(e).indexOf(dx) >= 0; });
      const chip = function (val, label) {
        return h('button', { type: 'button', class: 'chip' + (dx === val ? ' is-on' : ''), 'aria-pressed': dx === val ? 'true' : 'false',
          on: { click: function () { dx = val; try { if (val) sessionStorage.setItem(SS_DX, val); else sessionStorage.removeItem(SS_DX); } catch (e) { /* ignore */ } paint(); } } }, label);
      };
      const d = dailyEcg();
      put(root,
        h('p', { class: 'secondary', style: 'margin:0 0 10px' }, 'De vrais ECG 12 dérivations, lus d’après le Collège (rangs A et B). Ouvre un tracé, interprète-le toi-même, puis compare à la lecture vérifiée et réponds aux questions type EDN.'),
        h('div', { class: 'card stack' },
          h('strong', {}, '🎯 S’entraîner'),
          h('p', { class: 'secondary', style: 'margin:0' }, b.ecgs.length + ' ECG · ' + b.questions.length + ' questions QRM / QRU / QRP / QROC, corrigées comme à l’EDN.'),
          h('div', { class: 'eb-seg' },
            h('a', { class: 'btn btn--primary', href: '#/ecg?train=1' }, 'S’entraîner'),
            d ? h('a', { class: 'btn btn--outline', href: '#/ecg?daily=1' }, icon('ecg'), 'ECG du jour') : null)),
        h('div', { class: 'eb-chips', role: 'group', 'aria-label': 'Filtrer par diagnostic' },
          chip(null, 'Tous (' + b.ecgs.length + ')'), dxs.map(function (x) { return chip(x[0], x[0] + ' (' + x[1] + ')'); })),
        h('div', { class: 'eb-top', style: 'margin-bottom:8px' },
          h('strong', {}, list.length + ' tracé' + (list.length > 1 ? 's' : '')),
          h('label', { class: 'secondary', style: 'display:flex;gap:6px;align-items:center' },
            h('input', { type: 'checkbox', checked: hide, on: { change: function (ev) { hide = ev.target.checked; paint(); } } }), 'cacher les diagnostics')),
        list.length ? h('div', { class: 'eb-grid' }, list.map(function (e) { return thumb(e, hide); }))
          : h('p', { class: 'secondary' }, b.ecgs.length ? 'Aucun ECG pour ce diagnostic.' : 'La banque d’ECG est en cours de préparation.'));
    }
    paint();
  }
  function thumb(e, hide) {
    const st = ecgStatus(e);
    const nq = questionsOf(e.id).length;
    return h('a', { class: 'eb-th', href: '#/ecg?id=' + encodeURIComponent(e.id), 'aria-label': hide ? 'ECG ' + e.id : dxList(e).join(', ') },
      ecgImg(e, 'eb-th__img', true),
      st ? h('span', { class: 'eb-dot eb-dot--' + st, title: st === 'ok' ? 'Questions réussies' : 'Questions commencées' }) : null,
      h('span', { class: 'eb-th__cap' }, hide ? 'ECG n° ' + e.id : dxList(e).join(' · '),
        h('small', {}, [patient(e), nq ? nq + ' question' + (nq > 1 ? 's' : '') : null].filter(Boolean).join(' · '))));
  }

  /* ---------------------------------------------------------------- page d'un ECG */
  function ecgPage(root, e, daily) {
    const qs = questionsOf(e.id);
    const reveal = h('div', { class: 'card stack', hidden: true });
    const showBtn = h('button', { type: 'button', class: 'btn btn--outline btn--block', on: { click: function () {
      reveal.hidden = !reveal.hidden; showBtn.textContent = reveal.hidden ? 'Voir l’interprétation' : 'Masquer l’interprétation';
    } } }, 'Voir l’interprétation');
    const row = function (k, v) { return v ? [h('dt', {}, k), h('dd', {}, String(v))] : null; };
    const list = function (title, arr) {
      return Array.isArray(arr) && arr.length ? h('div', {}, h('span', { class: 'caption' }, title), h('ul', { class: 'eb-list' }, arr.map(function (s) { return h('li', {}, md(s)); }))) : null;
    };
    put(reveal,
      h('div', {}, h('span', { class: 'caption' }, 'Diagnostic'), h('div', { style: 'font-weight:700;font-size:1.05rem' }, dxList(e).join(' · ')),
        Array.isArray(e.secondary) && e.secondary.length ? h('div', { class: 'secondary' }, 'Associé : ' + e.secondary.join(' · ')) : null),
      h('dl', { class: 'eb-read' }, row('Rythme', e.rythme), row('FC', e.fc), row('Axe', e.axe), row('PR', e.pr), row('QRS', e.qrs), row('ST-T', e.st_t)),
      list('Signes visibles', e.visible),
      list('Pièges', e.pieges),
      h('div', { class: 'eb-seg' }, e.rang ? h('span', { class: 'pill pill--' + (e.rang === 'A' ? 'accent' : 'info') }, 'Rang ' + e.rang) : null,
        (e.objectifs || []).map(function (o) { return h('span', { class: 'pill pill--kind' }, o); })));
    const done = qs.filter(function (q) { return stat(q.id); }).length;
    put(root,
      h('div', { class: 'eb-top', style: 'margin-bottom:8px' },
        h('a', { href: '#/ecg', class: 'btn btn--ghost btn--sm' }, '← Bibliothèque'),
        h('span', { class: 'eb-seg' }, daily ? h('span', { class: 'pill pill--accent' }, 'ECG du jour') : null,
          patient(e) ? h('span', { class: 'pill pill--kind' }, patient(e)) : null)),
      figure(e),
      h('div', { style: 'margin:12px 0 8px' }, showBtn),
      reveal,
      h('div', { class: 'card stack', style: 'margin-top:12px' },
        h('strong', {}, qs.length ? qs.length + ' question' + (qs.length > 1 ? 's' : '') + ' sur cet ECG' : 'Questions'),
        qs.length ? h('p', { class: 'secondary', style: 'margin:0' }, done ? done + ' / ' + qs.length + ' déjà faite' + (done > 1 ? 's' : '') + '.' : 'Pas encore faites.')
          : h('p', { class: 'secondary', style: 'margin:0' }, 'Pas encore de question pour ce tracé.'),
        qs.length ? h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: function () {
          runSession(root, qs, function () { ecgPage(root, e, daily); window.scrollTo(0, 0); });
        } } }, 'Répondre aux questions') : null));
  }

  /* ---------------------------------------------------------------- réglages de séance */
  function trainSetup(root) {
    const b = bank();
    const o = Object.assign({ scope: 'all', dx: null, size: 10 }, lsGet(LS_TRAIN, {}));
    const dxs = allDx().filter(function (d) { return b.questions.some(function (q) { const e = ecgById(q.ecg); return e && famsOf(e).indexOf(d[0]) >= 0; }); });
    if (o.dx && !dxs.some(function (d) { return d[0] === o.dx; })) o.dx = null;
    function pool() {
      return b.questions.filter(function (q) {
        const e = ecgById(q.ecg);
        if (!e) return false;
        if (o.scope === 'A') return q.rank === 'A';
        if (o.scope === 'dx') return !!o.dx && famsOf(e).indexOf(o.dx) >= 0;
        return true;
      });
    }
    function pick(list) {   // jamais faites, puis ratées au dernier essai, puis le reste ; hasard à l'intérieur
      const never = [], missed = [], rest = [];
      shuffle(list).forEach(function (q) { const s = stat(q.id); (!s ? never : s.last < 1 ? missed : rest).push(q); });
      const all = never.concat(missed, rest);
      return o.size ? all.slice(0, o.size) : all;
    }
    function segBtn(on, label, fn) { return h('button', { type: 'button', class: 'btn btn--sm ' + (on ? 'btn--primary' : 'btn--outline'), 'aria-pressed': on ? 'true' : 'false', on: { click: fn } }, label); }
    function paint() {
      lsSet(LS_TRAIN, o);
      const p = pool();
      put(root,
        h('div', { class: 'eb-top', style: 'margin-bottom:8px' }, h('a', { href: '#/ecg', class: 'btn btn--ghost btn--sm' }, '← Bibliothèque')),
        h('div', { class: 'card stack' },
          h('strong', {}, 'S’entraîner sur la banque ECG'),
          h('span', { class: 'caption' }, 'Questions'),
          h('div', { class: 'eb-seg' },
            segBtn(o.scope === 'all', 'Toutes', function () { o.scope = 'all'; paint(); }),
            segBtn(o.scope === 'dx', 'Par diagnostic', function () { o.scope = 'dx'; paint(); }),
            segBtn(o.scope === 'A', 'Rang A seulement', function () { o.scope = 'A'; paint(); })),
          o.scope === 'dx' ? h('div', { class: 'eb-chips', style: 'margin:0' }, dxs.length ? dxs.map(function (d) {
            return h('button', { type: 'button', class: 'chip' + (o.dx === d[0] ? ' is-on' : ''), on: { click: function () { o.dx = d[0]; paint(); } } }, d[0]);
          }) : h('span', { class: 'secondary' }, 'Aucun diagnostic avec des questions.')) : null,
          h('span', { class: 'caption' }, 'Nombre'),
          h('div', { class: 'eb-seg' }, [10, 20, 0].map(function (k) { return segBtn(o.size === k, k ? String(k) : 'Toutes', function () { o.size = k; paint(); }); })),
          h('p', { class: 'secondary', style: 'margin:0' }, p.length + ' question' + (p.length > 1 ? 's' : '') + ' disponible' + (p.length > 1 ? 's' : '') + '. Les jamais faites et les ratées passent en premier.'),
          h('button', { type: 'button', class: 'btn btn--primary btn--block', disabled: !p.length, on: { click: function () {
            runSession(root, pick(p), function () { trainSetup(root); window.scrollTo(0, 0); });
          } } }, 'Commencer')));
    }
    paint();
  }

  /* ---------------------------------------------------------------- correction */
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function qrocOk(q, input) {
    const ni = norm(input);
    if (!ni) return false;
    return [q.answer].concat(q.accept || []).some(function (v) {
      const nv = norm(v);
      return nv && (ni === nv || (nv.length >= 4 && (' ' + ni + ' ').indexOf(' ' + nv + ' ') >= 0));
    });
  }
  /* sel : indices cochés → score EDN */
  function scoreOf(q, sel) {
    const ok = q.options.map(function (o) { return o.ok === true; });
    if (q.format === 'QRM') {
      const disc = ok.filter(function (v, i) { return v !== (sel.indexOf(i) >= 0); }).length;
      return disc === 0 ? 1 : disc === 1 ? 0.5 : 0;
    }
    return ok.every(function (v, i) { return v === (sel.indexOf(i) >= 0); }) ? 1 : 0;   // QRU, QRP
  }
  function record(q, score, prevScore) {
    const s = C.store;
    if (!s || !s.get || !s.set) return;
    const key = 'ecgq.' + q.id;
    const p = s.get(key) || {};
    const first = prevScore == null;
    const okSum = (Number(p.ok) || 0) + score - (first ? 0 : prevScore);
    s.set(key, { n: (p.n | 0) + (first ? 1 : 0), ok: Math.round(okSum * 100) / 100, at: Date.now(), last: score });
    try { if (s.gainXp) s.gainXp(Math.round(10 * (first ? score : Math.max(0, score - prevScore))), 'ecg'); } catch (e) { /* ignore */ }
  }
  function fmtScore(x) { return String(Math.round(x * 100) / 100).replace('.', ','); }

  /* ---------------------------------------------------------------- séance */
  function runSession(root, list, onExit) {
    let i = 0;
    const results = [];
    function show() {
      const q = list[i];
      const e = ecgById(q.ecg);
      if (!e) { results.push({ q: q, score: 0 }); next(); return; }
      const multi = q.format === 'QRM' || q.format === 'QRP';
      let sel = [], validated = false;
      const slot = h('div', { class: 'stack', 'aria-live': 'polite' });
      const actions = h('div', { class: 'eb-actions' });
      const rows = (q.options || []).map(function (o, k) {
        const why = h('div', { class: 'opt__why', hidden: true });
        const btn = h('button', { type: 'button', class: 'opt', role: multi ? 'checkbox' : 'radio', 'aria-checked': 'false', on: { click: function () { toggle(k); } } },
          h('span', { class: 'opt__key', 'aria-hidden': 'true' }, LETTERS[k] || String(k + 1)), h('span', { class: 'opt__text' }, String(o.t)), why);
        return { btn: btn, why: why };
      });
      const input = q.format === 'QROC' ? h('input', { class: 'input eb-qroc', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'Ta réponse',
        on: { input: function () { vbtn.disabled = !input.value.trim(); }, keydown: function (ev) { if (ev.key === 'Enter' && input.value.trim()) validate(); } } }) : null;
      const vbtn = h('button', { type: 'button', class: 'btn btn--primary btn--block', disabled: true, on: { click: validate } }, 'Valider');
      function toggle(k) {
        if (validated) return;
        const at = sel.indexOf(k);
        if (!multi) sel = at >= 0 ? [] : [k];
        else if (at >= 0) sel.splice(at, 1);
        else if (q.format === 'QRP' && sel.length >= q.n) { flash('Tu as déjà coché ' + q.n + ' propositions : décoche-en une.'); return; }
        else sel.push(k);
        rows.forEach(function (r, j) { const on = sel.indexOf(j) >= 0; r.btn.classList.toggle('is-selected', on); r.btn.setAttribute('aria-checked', on ? 'true' : 'false'); });
        vbtn.disabled = !sel.length;
      }
      function flash(msg) { put(slot, h('div', { class: 'feedback feedback--info' }, msg)); }
      function validate() {
        if (validated) return;
        validated = true;
        let score;
        if (q.format === 'QROC') {
          score = qrocOk(q, input.value) ? 1 : 0;
          input.disabled = true;
        } else {
          score = scoreOf(q, sel);
          rows.forEach(function (r, k) {
            const on = sel.indexOf(k) >= 0, ok = q.options[k].ok === true;
            r.btn.classList.remove('is-selected');
            r.btn.classList.add(on && ok ? 'is-correct' : on && !ok ? 'is-wrong' : ok ? 'is-missed' : 'is-neutral');
            r.btn.disabled = true;
            r.why.replaceChildren(h('strong', {}, ok ? 'Vrai — ' : 'Faux — '), md(q.options[k].why));
            r.why.hidden = false;
          });
        }
        try { if (C.shell && C.shell.haptic) C.shell.haptic(score === 1 ? 10 : 30); } catch (er) { /* ignore */ }
        record(q, score, null);
        results.push({ q: q, score: score });
        const fb = function (sc) {
          return sc === 1 ? h('div', { class: 'feedback feedback--ok' }, 'Juste → 1 point')
            : sc === 0.5 ? h('div', { class: 'feedback feedback--warn' }, 'Une seule discordance → 0,5 point')
              : h('div', { class: 'feedback feedback--bad' }, 'Faux → 0 point' + (q.format === 'QRM' ? ' (au moins 2 discordances)' : ''));
        };
        const fbSlot = h('div', {}, fb(score));
        const qrocBox = q.format === 'QROC' ? h('div', { class: 'explain' }, h('span', { class: 'caption' }, 'Réponse attendue'), h('strong', {}, String(q.answer)),
          (q.accept || []).length ? h('div', { class: 'secondary' }, 'Accepté aussi : ' + q.accept.join(' · ')) : null,
          score === 0 ? h('button', { type: 'button', class: 'btn btn--sm btn--outline', style: 'margin-top:8px', on: { click: function (ev) {
            record(q, 1, 0); results[results.length - 1].score = 1; put(fbSlot, fb(1)); ev.currentTarget.remove();
          } } }, 'J’avais juste (compter 1 point)') : null) : null;
        put(slot, fbSlot, qrocBox,
          q.deep ? h('div', { class: 'explain' }, h('span', { class: 'caption' }, 'Pour aller plus loin'), md(q.deep)) : null,
          h('div', { class: 'eb-top' }, q.src ? h('span', { class: 'src' }, 'Collège · ' + q.src) : h('span'), credit(e)),
          h('a', { href: '#/ecg?id=' + encodeURIComponent(e.id), class: 'secondary', style: 'font-size:.85rem' }, 'Voir la lecture complète de cet ECG'));
        put(actions, h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: next } }, i + 1 < list.length ? 'Question suivante' : 'Voir le bilan'));
        try { slot.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (er) { /* ignore */ }
      }
      const fmtLabel = q.format === 'QRP' ? 'QRP · cochez les ' + q.n + ' propositions' : q.format === 'QRM' ? 'QRM · une ou plusieurs réponses' : q.format === 'QRU' ? 'QRU · une seule réponse' : 'QROC · réponse courte';
      const total = results.reduce(function (n, r) { return n + r.score; }, 0);
      put(actions, vbtn);
      put(root,
        h('div', { class: 'eb-top', style: 'margin-bottom:8px' },
          h('button', { type: 'button', class: 'btn btn--ghost btn--sm', on: { click: onExit } }, '✕ Quitter'),
          h('span', { class: 'secondary' }, 'Question ' + (i + 1) + ' / ' + list.length + (results.length ? ' · ' + fmtScore(total) + ' pt' : ''))),
        q.vignette ? h('div', { class: 'card', style: 'margin-bottom:10px' }, md(q.vignette)) : null,
        figure(e),
        h('div', { class: 'card stack', style: 'margin-top:10px' },
          h('div', { class: 'eb-seg' }, h('span', { class: 'pill pill--kind' }, fmtLabel), q.rank ? h('span', { class: 'pill pill--' + (q.rank === 'A' ? 'accent' : 'info') }, 'Rang ' + q.rank) : null),
          md(q.stem, 'qz-stem')),
        input ? h('div', { style: 'margin-top:10px' }, input) : h('div', { class: 'opts', role: multi ? 'group' : 'radiogroup', style: 'margin-top:10px' }, rows.map(function (r) { return r.btn; })),
        h('div', { style: 'margin-top:10px' }, slot),
        actions);
      window.scrollTo(0, 0);
    }
    function next() { i += 1; if (i < list.length) show(); else end(); }
    function end() {
      const total = results.reduce(function (n, r) { return n + r.score; }, 0);
      const pct = results.length ? Math.round(100 * total / results.length) : 0;
      const missed = results.filter(function (r) { return r.score < 1; }).map(function (r) { return r.q; });
      put(root,
        h('div', { class: 'card stack', style: 'text-align:center' },
          h('span', { class: 'caption' }, 'Bilan de la séance'),
          h('div', { class: 'eb-big' }, fmtScore(total) + ' / ' + results.length),
          h('div', { class: 'secondary' }, pct + ' % · barème EDN (QRM : 0,5 point pour une seule discordance)')),
        h('div', { class: 'card', style: 'margin-top:10px' }, results.map(function (r, k) {
          const e = ecgById(r.q.ecg);
          return h('div', { class: 'eb-res' },
            h('span', {}, (k + 1) + '. ' + r.q.format + ' · ', e ? h('a', { href: '#/ecg?id=' + encodeURIComponent(e.id) }, dxList(e).join(' · ') || 'ECG ' + e.id) : 'ECG'),
            h('strong', { style: 'color:var(--' + (r.score === 1 ? 'ok' : r.score > 0 ? 'warn' : 'bad') + ')' }, fmtScore(r.score)));
        })),
        h('div', { class: 'stack', style: 'margin-top:12px' },
          missed.length ? h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: function () { runSession(root, shuffle(missed), onExit); } } }, 'Refaire les ' + missed.length + ' question' + (missed.length > 1 ? 's' : '') + ' non parfaite' + (missed.length > 1 ? 's' : '')) : null,
          h('button', { type: 'button', class: 'btn btn--outline btn--block', on: { click: onExit } }, 'Terminer')));
      window.scrollTo(0, 0);
    }
    if (!list.length) { onExit(); return; }
    show();
  }

  /* ---------------------------------------------------------------- point d'entrée */
  function render(params, query) {
    ensureStyles();
    const q = query || {};
    const root = h('div', { class: 'page view-ecgbank' });
    if (!available()) {
      put(root, h('div', { class: 'card empty' },
        h('p', { class: 'empty__title' }, 'Banque ECG en préparation'),
        h('p', { class: 'secondary' }, 'Les vrais tracés et leurs questions type EDN arrivent bientôt.')));
      return { el: root, title: 'Banque ECG' };
    }
    if (q.daily) {
      const d = dailyEcg();
      ecgPage(root, d, true);
      return { el: root, title: 'ECG du jour' };
    }
    if (q.id != null && q.id !== '') {
      const e = ecgById(q.id);
      if (e) { ecgPage(root, e, false); return { el: root, title: 'ECG' }; }
    }
    if (q.train) { trainSetup(root); return { el: root, title: 'S’entraîner · ECG' }; }
    library(root);   // #/ecg, et anciennes routes #/item/:num/ecg
    return { el: root, title: 'Banque ECG' };
  }

  C.views.ecg = { render: render, available: available, dailyEcg: dailyEcg, scoreOf: scoreOf, qrocOk: qrocOk };
})();
