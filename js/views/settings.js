/* CardioR2C — vue « Plus » (CARDIO.views.settings)
 * Profil, sauvegarde (export / import / réinitialisation), contenu (préchargement),
 * raccourcis clavier, à propos. Chaque contrôle a un id stable ; chaque changement est
 * enregistré immédiatement (store.set) avec un toast.
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  CARDIO.views = CARDIO.views || {};

  var DEFAULTS = { name: '', dailyGoal: 30, newPerDay: 15, retention: 0.9, theme: 'system', sound: false, haptics: true };
  var COUNT_LABELS = [
    ['qcm', 'QCM'], ['qroc', 'QROC'], ['open', 'ouvertes'], ['kfp', 'KFP'], ['tcs', 'TCS'], ['flash', 'flash'],
    ['trees', 'arbres'], ['tx', 'traitements'], ['cases', 'cas'], ['ecg', 'ECG'], ['echo', 'écho']
  ];

  /* ------------------------------------------------------------------ helpers */

  function util() { return CARDIO.util || {}; }
  function store() { return CARDIO.store || null; }
  function registry() { return CARDIO.registry || null; }
  function shell() { return CARDIO.shell || null; }

  function h(tag, attrs) {
    var kids = [];
    for (var i = 2; i < arguments.length; i++) flatten(arguments[i], kids);
    var u = util();
    if (typeof u.h === 'function') return u.h.apply(null, [tag, attrs || {}].concat(kids));
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.keys(v).forEach(function (d) { el.dataset[d] = v[d]; });
      else if (k === 'on') Object.keys(v).forEach(function (e) { el.addEventListener(e, v[e]); });
      else if (k === 'html') el.innerHTML = v;
      else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v === true ? '' : v);
    });
    kids.forEach(function (c) { el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function flatten(c, out) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { flatten(x, out); }); return; }
    if (typeof c === 'number') { out.push(String(c)); return; }
    out.push(c);
  }
  function icon(name) { var u = util(); return typeof u.icon === 'function' ? u.icon(name) : ''; }
  function md(text) { var u = util(); return typeof u.md === 'function' ? u.md(text) : ''; }
  function fmtInt(n) { return Number(n || 0).toLocaleString('fr-FR'); }

  function toast(msg, tone) {
    var s = shell();
    if (s && typeof s.toast === 'function') { try { s.toast(msg, { tone: tone || 'ok' }); return; } catch (e) { /* repli */ } }
    console.warn('[settings] toast:', msg);
  }
  function confirmDlg(msg) {
    var s = shell();
    if (s && typeof s.confirm === 'function') { try { return Promise.resolve(s.confirm(msg)); } catch (e) { /* repli */ } }
    return Promise.resolve(window.confirm(msg));
  }
  /** Ouvre une feuille (sheet) ; renvoie une fonction de fermeture. */
  function openSheet(contentEl, title) {
    var s = shell();
    if (s && typeof s.sheet === 'function') {
      try {
        var r = s.sheet(contentEl, { title: title });
        return function () {
          if (r && typeof r.close === 'function') r.close();
          else if (typeof r === 'function') r();
          else if (typeof s.closeSheet === 'function') s.closeSheet();
          else { var sc = document.querySelector('.scrim'); if (sc) sc.click(); }
        };
      } catch (e) { console.warn('[settings] sheet', e); }
    }
    // Repli : bloc inséré en haut de la page.
    var wrap = h('div', { class: 'card card--raised', style: 'margin:12px 0' }, h('h3', {}, title), contentEl);
    var page = document.getElementById('settings-page');
    (page || document.body).insertBefore(wrap, (page || document.body).firstChild);
    return function () { wrap.remove(); };
  }

  function profile() {
    var st = store() && store().state;
    var p = (st && st.profile) || {};
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) { out[k] = p[k] === undefined || p[k] === null ? DEFAULTS[k] : p[k]; });
    return out;
  }
  function saveProfile(key, value, msg) {
    var s = store();
    if (!s) { console.warn('[settings] store indisponible'); toast('Impossible d’enregistrer pour le moment.', 'bad'); return false; }
    try {
      if (typeof s.set === 'function') s.set('profile.' + key, value);
      else if (typeof s.update === 'function') s.update(function (st) { st.profile = st.profile || {}; st.profile[key] = value; });
      else { s.state.profile = s.state.profile || {}; s.state.profile[key] = value; if (typeof s.save === 'function') s.save(); }
      if (msg) toast(msg, 'ok');
      return true;
    } catch (e) { console.warn('[settings] set', e); toast('Enregistrement impossible.', 'bad'); return false; }
  }

  /* ------------------------------------------------------------------ styles */

  var CSS = [
    '.set-section{margin-bottom:16px}',
    '.set-section h2{font:700 1.125rem/1.3 var(--font-display);margin:0 0 6px}',
    '.set-hint{color:var(--muted);font-size:.875rem;margin:0 0 10px}',
    '.set-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:52px;padding:8px 0;border-top:1px solid var(--line)}',
    '.set-row:first-of-type{border-top:0}',
    '.set-row--col{flex-direction:column;align-items:stretch}',
    '.set-row__label{font-weight:500;display:block}',
    '.set-row__desc{font-size:.8125rem;color:var(--muted);display:block;margin-top:2px}',
    '.set-row__ctl{display:flex;align-items:center;gap:10px;flex-shrink:0}',
    '.set-input{font:inherit;color:var(--ink);background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-s);padding:10px 12px;min-height:44px;width:100%;max-width:260px}',
    '.set-input:focus-visible{outline:2px solid var(--blue);outline-offset:2px}',
    '.set-range{display:flex;align-items:center;gap:12px;width:100%}',
    '.set-range input[type=range]{flex:1;accent-color:var(--accent);min-height:44px;margin:0}',
    '.set-range output{font:700 1.125rem/1 var(--font-display);font-variant-numeric:tabular-nums;min-width:3.5ch;text-align:right}',
    '.set-seg{display:inline-flex;background:var(--surface-2);border-radius:var(--r-s);padding:3px;gap:2px}',
    '.set-seg button{font:inherit;font-weight:600;font-size:.875rem;color:var(--ink-2);background:transparent;border:0;border-radius:6px;min-height:38px;padding:0 12px;cursor:pointer}',
    '.set-seg button.is-on{background:var(--surface);color:var(--ink);box-shadow:var(--shadow-1)}',
    '.set-seg button:focus-visible{outline:2px solid var(--blue);outline-offset:2px}',
    '.switch{position:relative;display:inline-block;width:48px;height:28px;flex-shrink:0}',
    '.switch input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer;z-index:1}',
    '.switch__track{position:absolute;inset:0;background:var(--surface-3);border-radius:999px;transition:background .18s cubic-bezier(.2,.7,.2,1)}',
    '.switch__track::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:var(--surface);box-shadow:var(--shadow-1);transition:transform .18s cubic-bezier(.2,.7,.2,1)}',
    '.switch input:checked+.switch__track{background:var(--accent)}',
    '.switch input:checked+.switch__track::after{transform:translateX(20px)}',
    '.switch input:focus-visible+.switch__track{outline:2px solid var(--blue);outline-offset:2px}',
    '.set-status{display:flex;align-items:center;gap:8px;font-size:.9375rem;margin:0 0 12px}',
    '.set-status__dot{width:10px;height:10px;border-radius:50%;background:var(--muted);flex-shrink:0}',
    '.set-status--ok .set-status__dot{background:var(--ok)}.set-status--warn .set-status__dot{background:var(--warn)}',
    '.set-status--bad .set-status__dot{background:var(--bad)}.set-status--info .set-status__dot{background:var(--info)}',
    '.set-actions{display:grid;gap:8px}',
    '@media(min-width:600px){.set-actions{grid-template-columns:1fr 1fr}}',
    '.set-actions .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px}',
    '.set-actions .btn svg{width:18px;height:18px}',
    '.set-items{list-style:none;margin:0;padding:0}',
    '.set-items li{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--line);font-size:.875rem}',
    '.set-items li:first-child{border-top:0}',
    '.set-items__name{font-weight:500}.set-items__name b{font-variant-numeric:tabular-nums;margin-right:6px}',
    '.set-items__counts{color:var(--muted);font-variant-numeric:tabular-nums;text-align:right;font-size:.8125rem}',
    '.set-items__state{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--surface-3);margin-left:6px;vertical-align:middle}',
    '.set-items__state.is-loaded{background:var(--ok)}',
    '.set-progress{margin-top:10px}.set-progress .bar{height:6px;background:var(--surface-3);border-radius:999px;overflow:hidden}',
    '.set-progress .bar__fill{height:100%;background:var(--accent);border-radius:999px;transition:width .2s}',
    '.set-progress__txt{font-size:.8125rem;color:var(--muted);margin-top:4px;font-variant-numeric:tabular-nums}',
    '.set-keys{list-style:none;margin:0;padding:0;display:grid;gap:6px}',
    '@media(min-width:600px){.set-keys{grid-template-columns:1fr 1fr}}',
    '.set-keys li{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:.875rem;min-height:32px}',
    '.set-keys kbd{font:500 .8125rem var(--font-mono);background:var(--surface-2);border:1px solid var(--line);border-bottom-width:2px;border-radius:6px;padding:2px 7px;color:var(--ink);white-space:nowrap}',
    '.set-about p{margin:0 0 8px;font-size:.9375rem}',
    '.set-about .set-version{font-size:.8125rem;color:var(--muted);font-variant-numeric:tabular-nums}',
    '.set-sheet{display:grid;gap:10px}',
    '.set-sheet textarea{font:.8125rem/1.4 var(--font-mono);color:var(--ink);background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-s);padding:10px;width:100%;min-height:160px;resize:vertical}',
    '.set-sheet textarea:focus-visible{outline:2px solid var(--blue);outline-offset:2px}',
    '.set-sheet__choices{display:flex;gap:16px;flex-wrap:wrap}',
    '.set-sheet__choices label{display:flex;align-items:center;gap:8px;min-height:44px;cursor:pointer}',
    '.set-sheet__choices input{accent-color:var(--accent);width:18px;height:18px}',
    '.set-file{display:block}.set-file input[type=file]{font:inherit;width:100%;min-height:44px;color:var(--ink-2)}',
    '.set-sheet__row{display:flex;gap:8px;flex-wrap:wrap}.set-sheet__row .btn{flex:1}'
  ].join('\n');

  function ensureStyles() {
    if (document.getElementById('cardio-settings-css')) return;
    var st = document.createElement('style');
    st.id = 'cardio-settings-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ------------------------------------------------------------ composants */

  function section(title, hint, body) {
    return h('section', { class: 'card set-section' }, h('h2', {}, title), hint ? h('p', { class: 'set-hint' }, hint) : null, body);
  }
  function row(label, desc, ctl, col) {
    return h('div', { class: 'set-row' + (col ? ' set-row--col' : '') },
      h('div', {}, h('span', { class: 'set-row__label' }, label), desc ? h('span', { class: 'set-row__desc' }, desc) : null),
      h('div', { class: 'set-row__ctl' + (col ? ' set-range' : '') }, ctl));
  }
  function switchCtl(id, checked, onChange) {
    var input = h('input', { type: 'checkbox', id: id, role: 'switch', 'aria-checked': checked ? 'true' : 'false',
      on: { change: function () { input.setAttribute('aria-checked', input.checked ? 'true' : 'false'); onChange(input.checked); } } });
    input.checked = !!checked;
    return h('label', { class: 'switch', 'for': id }, input, h('span', { class: 'switch__track' }));
  }
  function rangeCtl(id, min, max, step, value, format, onCommit) {
    var out = h('output', { 'for': id }, format(value));
    var input = h('input', { type: 'range', id: id, min: min, max: max, step: step,
      on: {
        input: function () { out.textContent = format(parseFloat(input.value)); },
        change: function () { onCommit(parseFloat(input.value)); }
      } });
    input.value = String(value);
    return [input, out];
  }

  /* ------------------------------------------------------------- (a) profil */

  function renderProfile() {
    var p = profile();
    var nameInput = h('input', { type: 'text', id: 'set-name', class: 'set-input', maxlength: 40, autocomplete: 'given-name', placeholder: 'Ton prénom',
      on: { change: function () {
        var v = nameInput.value.trim();
        saveProfile('name', v, v ? 'Enchanté, ' + v + '.' : 'Prénom effacé.');
      } } });
    nameInput.value = p.name || '';

    var goal = rangeCtl('set-goal', 10, 100, 5, Math.max(10, Math.min(100, p.dailyGoal)), function (v) { return v + ''; },
      function (v) { saveProfile('dailyGoal', v, 'Objectif : ' + v + ' cartes par jour.'); });
    var newPer = rangeCtl('set-new', 5, 50, 5, Math.max(5, Math.min(50, p.newPerDay)), function (v) { return v + ''; },
      function (v) { saveProfile('newPerDay', v, v + ' nouvelles cartes par jour.'); });
    var ret = rangeCtl('set-retention', 0.80, 0.95, 0.01, Math.max(0.8, Math.min(0.95, p.retention)),
      function (v) { return Math.round(v * 100) + ' %'; },
      function (v) { saveProfile('retention', Math.round(v * 100) / 100, 'Rétention cible : ' + Math.round(v * 100) + ' %.'); });

    var themes = [['system', 'Système'], ['light', 'Clair'], ['dark', 'Sombre']];
    var segBtns = {};
    var seg = h('div', { class: 'set-seg', id: 'set-theme', role: 'radiogroup', 'aria-label': 'Thème' }, themes.map(function (t) {
      var b = h('button', { type: 'button', id: 'set-theme-' + t[0], role: 'radio', 'aria-checked': p.theme === t[0] ? 'true' : 'false',
        class: p.theme === t[0] ? 'is-on' : '', on: { click: function () { applyTheme(t[0]); } } }, t[1]);
      segBtns[t[0]] = b;
      return b;
    }));
    function applyTheme(theme) {
      Object.keys(segBtns).forEach(function (k) {
        segBtns[k].classList.toggle('is-on', k === theme);
        segBtns[k].setAttribute('aria-checked', k === theme ? 'true' : 'false');
      });
      var s = shell();
      if (s && typeof s.applyTheme === 'function') { try { s.applyTheme(theme); } catch (e) { console.warn('[settings] applyTheme', e); } }
      else {
        // Repli : attribut data-theme sur <html> (contrat DESIGN.md §1).
        if (theme === 'system') document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme', theme);
      }
      saveProfile('theme', theme, 'Thème ' + ({ system: 'système', light: 'clair', dark: 'sombre' })[theme] + ' activé.');
    }

    var sound = switchCtl('set-sound', p.sound, function (on) { saveProfile('sound', on, on ? 'Sons activés.' : 'Sons désactivés.'); });
    var hapt = switchCtl('set-haptics', p.haptics, function (on) {
      saveProfile('haptics', on, on ? 'Vibrations activées.' : 'Vibrations désactivées.');
      if (on) { try { if (navigator.vibrate) navigator.vibrate(10); } catch (e) { /* ignore */ } }
    });

    return section('Profil', null, h('div', {},
      row('Prénom', 'Pour te saluer sur l’accueil.', nameInput),
      row('Objectif quotidien', 'Cartes à revoir chaque jour pour prolonger ta série.', goal, true),
      row('Nouvelles cartes par jour', 'Au-delà des cartes dues, combien de cartes jamais vues ajouter.', newPer, true),
      row('Rétention cible', 'Probabilité de te souvenir d’une carte au moment où elle revient : plus elle est haute, plus les révisions sont rapprochées.', ret, true),
      row('Thème', null, seg),
      row('Sons', 'Petit son à la validation.', sound),
      row('Vibrations', 'Retour haptique sur téléphone.', hapt)
    ));
  }

  /* --------------------------------------------------------- (b) sauvegarde */

  function syncLine() {
    var s = store(), st = null;
    if (s && typeof s.syncStatus === 'function') { try { st = s.syncStatus(); } catch (e) { /* repli */ } }
    var cloud = st && st.cloud;
    var tone = 'warn', text = 'Sauvegarde locale uniquement (ouvre le lien depuis claude.ai pour synchroniser)';
    if (cloud === 'ok') { tone = 'ok'; text = 'Sauvegarde cloud active'; }
    else if (cloud === 'syncing') { tone = 'info'; text = 'Synchronisation en cours…'; }
    else if (cloud === 'error') { tone = 'bad'; text = 'Erreur de synchronisation cloud : tes données restent sauvegardées sur cet appareil.'; }
    var when = '';
    if (st && st.lastSync && cloud === 'ok') {
      try { when = ' · ' + new Date(st.lastSync).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); } catch (e) { /* ignore */ }
    }
    return h('p', { class: 'set-status set-status--' + tone, id: 'set-sync' }, h('span', { class: 'set-status__dot' }), text + when);
  }

  function exportData() {
    var s = store();
    if (!s || typeof s.exportJSON !== 'function') { toast('Export indisponible pour le moment.', 'bad'); return Promise.resolve(); }
    var json;
    try { json = s.exportJSON(); } catch (e) { console.warn('[settings] exportJSON', e); toast('Export impossible.', 'bad'); return Promise.resolve(); }
    var u = util();
    var filename = 'cardio-r2c-' + (typeof u.today === 'function' ? u.today() : new Date().toISOString().slice(0, 10)) + '.json';
    var canUse = window.claude && typeof window.claude.use === 'function';
    var p = canUse ? Promise.resolve(window.claude.use('downloads')).catch(function () { return null; }) : Promise.resolve(null);
    return p.then(function (dl) {
      if (!dl || typeof dl.save !== 'function') { exportSheet(json, filename); return; }
      return dl.save({ filename: filename, data: json }).then(function () {
        toast('Sauvegarde exportée.', 'ok');
      }, function (err) {
        var code = err && err.code;
        if (code === 'declined') return;                       // le lecteur a refusé : silence.
        if (code === 'rate_limited') { toast('Une demande est déjà en cours, réessaie dans un instant.', 'warn'); return; }
        console.warn('[settings] downloads.save', err);
        exportSheet(json, filename);
      });
    });
  }
  function exportSheet(json, filename) {
    var ta = h('textarea', { id: 'set-export-text', readonly: true, 'aria-label': 'Données exportées' });
    ta.value = json;
    var copyBtn = h('button', { class: 'btn btn--primary', type: 'button', id: 'set-export-copy', on: { click: function () {
      var done = function () { toast('Copié dans le presse-papiers.', 'ok'); };
      var fail = function () { ta.focus(); ta.select(); toast('Sélectionne le texte puis copie-le manuellement.', 'warn'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).then(done, fail);
      else fail();
    } } }, 'Copier');
    var close = openSheet(h('div', { class: 'set-sheet' },
      h('p', { class: 'set-hint', style: 'margin:0' }, 'Copie ce texte et garde-le dans un fichier « ' + filename + ' ». Tu pourras le réimporter ici.'),
      ta,
      h('div', { class: 'set-sheet__row' }, copyBtn, h('button', { class: 'btn btn--secondary', type: 'button', on: { click: function () { close(); } } }, 'Fermer'))
    ), 'Exporter mes données');
  }

  function importSheet(onDone) {
    var mode = 'merge';
    var ta = h('textarea', { id: 'set-import-text', placeholder: 'Colle ici le contenu d’une sauvegarde JSON…', 'aria-label': 'JSON à importer' });
    var file = h('input', { type: 'file', id: 'set-import-file', accept: '.json,application/json', on: { change: function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { ta.value = String(rd.result || ''); toast('Fichier lu : ' + f.name, 'info'); };
      rd.onerror = function () { toast('Lecture du fichier impossible.', 'bad'); };
      rd.readAsText(f);
    } } });
    function radio(val, label, desc) {
      var r = h('input', { type: 'radio', name: 'set-import-mode', id: 'set-import-' + val, value: val, on: { change: function () { if (r.checked) mode = val; } } });
      r.checked = val === mode;
      return h('label', { 'for': 'set-import-' + val }, r, h('span', {}, h('b', {}, label), h('span', { class: 'set-row__desc' }, desc)));
    }
    var go = h('button', { class: 'btn btn--primary', type: 'button', id: 'set-import-go', on: { click: function () {
      var txt = ta.value.trim();
      if (!txt) { toast('Choisis un fichier ou colle une sauvegarde d’abord.', 'warn'); return; }
      try { JSON.parse(txt); } catch (e) { toast('Ce texte n’est pas un JSON valide.', 'bad'); return; }
      var q = mode === 'replace'
        ? 'Remplacer toute ta progression par cette sauvegarde ? L’actuelle sera perdue.'
        : 'Fusionner cette sauvegarde avec ta progression actuelle ?';
      confirmDlg(q).then(function (ok) {
        if (!ok) return;
        var s = store();
        if (!s || typeof s.importJSON !== 'function') { toast('Import indisponible pour le moment.', 'bad'); return; }
        go.disabled = true;
        Promise.resolve().then(function () { return s.importJSON(txt, { merge: mode !== 'replace' }); }).then(function () {
          close();
          toast(mode === 'replace' ? 'Progression remplacée.' : 'Sauvegarde fusionnée.', 'ok');
          if (onDone) onDone();
        }, function (e) {
          console.warn('[settings] importJSON', e);
          go.disabled = false;
          toast('Import impossible : ' + ((e && e.message) || 'format inattendu') + '.', 'bad');
        });
      });
    } } }, 'Importer');
    var close = openSheet(h('div', { class: 'set-sheet' },
      h('label', { class: 'set-file', 'for': 'set-import-file' }, h('span', { class: 'set-row__desc', style: 'margin-bottom:4px' }, 'Fichier .json'), file),
      h('div', { class: 'set-row__desc' }, 'ou'),
      ta,
      h('div', { class: 'set-sheet__choices', role: 'radiogroup', 'aria-label': 'Mode d’import' },
        radio('merge', 'Fusionner', 'garde le meilleur des deux'),
        radio('replace', 'Remplacer', 'écrase la progression actuelle')),
      h('div', { class: 'set-sheet__row' }, go, h('button', { class: 'btn btn--secondary', type: 'button', on: { click: function () { close(); } } }, 'Annuler'))
    ), 'Importer une sauvegarde');
  }

  function resetAll(onDone) {
    confirmDlg('Tout réinitialiser ? Progression, séries, badges et cahier d’erreurs seront effacés.').then(function (ok) {
      if (!ok) return;
      return confirmDlg('Dernière vérification : cette action est irréversible. Continuer ?').then(function (ok2) {
        if (!ok2) return;
        var s = store();
        if (!s || typeof s.resetAll !== 'function') { toast('Réinitialisation indisponible.', 'bad'); return; }
        return Promise.resolve().then(function () { return s.resetAll(); }).then(function () {
          toast('Tout a été réinitialisé.', 'ok');
          if (onDone) onDone();
        }, function (e) { console.warn('[settings] resetAll', e); toast('Réinitialisation impossible.', 'bad'); });
      });
    });
  }

  function renderBackup(rerender) {
    var btn = function (id, ico, label, cls, fn) {
      return h('button', { class: 'btn ' + cls, type: 'button', id: id, on: { click: fn } }, h('span', { html: icon(ico), 'aria-hidden': 'true' }), label);
    };
    return section('Sauvegarde', 'Ta progression est enregistrée sur cet appareil à chaque changement.', h('div', {},
      syncLine(),
      h('div', { class: 'set-actions' },
        btn('set-export', 'download', 'Exporter mes données', 'btn--secondary', function () { exportData(); }),
        btn('set-import', 'upload', 'Importer', 'btn--secondary', function () { importSheet(rerender); }),
        btn('set-reset', 'trash', 'Tout réinitialiser', 'btn--danger', function () { resetAll(rerender); }))
    ));
  }

  /* ------------------------------------------------------------ (c) contenu */

  function manifestItems() {
    var r = registry();
    var list = null;
    if (r && typeof r.items === 'function') { try { list = r.items(); } catch (e) { /* repli */ } }
    if (!list || !list.length) list = (r && r.manifest && r.manifest.items) || [];
    return list;
  }
  function isLoaded(num) {
    var r = registry();
    if (r && typeof r.isLoaded === 'function') { try { return !!r.isLoaded(num); } catch (e) { /* ignore */ } }
    return false;
  }
  function countsText(c) {
    c = c || {};
    var parts = [];
    COUNT_LABELS.forEach(function (kv) { if (c[kv[0]]) parts.push(fmtInt(c[kv[0]]) + ' ' + kv[1]); });
    return parts.length ? parts.join(' · ') : 'aucun contenu';
  }
  function renderContent() {
    var items = manifestItems();
    var list = h('ul', { class: 'set-items', id: 'set-items' }, items.map(function (it) {
      var avail = it.available !== false;
      return h('li', { dataset: { item: String(it.num) } },
        h('span', { class: 'set-items__name' }, h('b', {}, String(it.num)), it.short || it.title || '',
          avail ? h('span', { class: 'set-items__state' + (isLoaded(it.num) ? ' is-loaded' : ''), title: isLoaded(it.num) ? 'Chargé' : 'Non chargé' }) : null),
        h('span', { class: 'set-items__counts' }, avail ? countsText(it.counts) : 'indisponible'));
    }));
    var fill = h('span', { class: 'bar__fill', style: 'width:0%' });
    var txt = h('div', { class: 'set-progress__txt' }, '');
    var prog = h('div', { class: 'set-progress', hidden: true }, h('div', { class: 'bar' }, fill), txt);
    var avail = items.filter(function (it) { return it.available !== false; });
    var loadedN = avail.filter(function (it) { return isLoaded(it.num); }).length;
    var preload = h('button', { class: 'btn btn--secondary btn--block', type: 'button', id: 'set-preload', on: { click: function () {
      var r = registry();
      if (!r) { toast('Contenu indisponible pour le moment.', 'bad'); return; }
      preload.disabled = true;
      prog.hidden = false;
      var total = avail.length, done = 0;
      function tick(num) {
        done++;
        fill.style.width = Math.round(done / total * 100) + '%';
        txt.textContent = done + ' / ' + total + ' items chargés' + (num ? ' · ' + num : '');
        var dot = list.querySelector('li[data-item="' + num + '"] .set-items__state');
        if (dot) dot.classList.add('is-loaded');
      }
      var p;
      if (typeof r.load === 'function') {
        // Un par un pour afficher la progression (registry.load est idempotent).
        p = avail.reduce(function (chain, it) {
          return chain.then(function () {
            return Promise.resolve(r.load(it.num)).then(function () { tick(it.num); }, function (e) { console.warn('[settings] load ' + it.num, e); tick(it.num); });
          });
        }, Promise.resolve());
      } else if (typeof r.loadAll === 'function') {
        txt.textContent = 'Chargement…';
        p = Promise.resolve(r.loadAll()).then(function () { fill.style.width = '100%'; txt.textContent = total + ' / ' + total + ' items chargés'; });
      } else {
        p = Promise.reject(new Error('registry.load indisponible'));
      }
      p.then(function () {
        preload.disabled = false;
        preloadLabel.textContent = 'Contenu préchargé';
        toast('Tout le contenu est chargé : tu peux réviser même avec une connexion instable.', 'ok');
      }, function (e) {
        console.warn('[settings] preload', e);
        preload.disabled = false;
        prog.hidden = true;
        toast('Préchargement impossible pour le moment.', 'bad');
      });
    } } });
    var preloadLabel = h('span', {}, loadedN === avail.length && avail.length ? 'Contenu préchargé' : 'Précharger tout le contenu');
    preload.appendChild(h('span', { html: icon('download'), 'aria-hidden': 'true', style: 'display:inline-flex;width:18px;height:18px;margin-right:8px;vertical-align:middle' }));
    preload.appendChild(preloadLabel);
    return section('Contenu', avail.length + ' items disponibles' + (loadedN ? ' · ' + loadedN + ' déjà chargé' + (loadedN > 1 ? 's' : '') : '') + '.',
      h('div', {}, list, h('div', { style: 'margin-top:12px' }, preload, prog)));
  }

  /* --------------------------------------------------------- (d) raccourcis */

  function renderShortcuts() {
    var keys = [
      ['1 – 5', 'Cocher / décocher la proposition A – E'],
      ['Entrée', 'Valider, puis passer à la suivante'],
      ['A', 'Noter « À revoir » (Again)'],
      ['H', 'Noter « Difficile » (Hard)'],
      ['G', 'Noter « Bien » (Good)'],
      ['E', 'Noter « Facile » (Easy)'],
      ['Espace', 'Retourner une carte flash'],
      ['Échap', 'Fermer une feuille ou une fenêtre']
    ];
    return section('Raccourcis clavier', 'Sur ordinateur, pendant une session.',
      h('ul', { class: 'set-keys', id: 'set-keys' }, keys.map(function (k) {
        return h('li', {}, h('span', {}, k[1]), h('kbd', {}, k[0]));
      })));
  }

  /* ----------------------------------------------------------- (e) à propos */

  function renderAbout() {
    var r = registry(), m = (r && r.manifest) || {};
    var built = m.builtAt ? String(m.builtAt) : '';
    var builtTxt = '';
    if (built) {
      try {
        var d = new Date(built);
        builtTxt = isNaN(d.getTime()) ? built : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      } catch (e) { builtTxt = built; }
    }
    var nItems = manifestItems().filter(function (it) { return it.available !== false; }).length;
    var text = 'CardioR2C est construit uniquement à partir du **Collège de cardiologie** (CNEC, « Médecine cardiovasculaire », édition R2C) : ' +
      'fiches, questions, arbres, traitements, dossiers, ECG et écho en sont des synthèses, chacune référencée à la page du livre, sans aucun ajout extérieur. ' +
      'Les révisions sont planifiées par l’algorithme de répétition espacée **FSRS** : chaque carte revient juste avant que tu ne l’oublies, selon la rétention cible choisie dans ton profil.';
    var body = h('div', { class: 'set-about' });
    var html = md(text);
    if (html) body.appendChild(h('div', { html: html }));
    else body.appendChild(h('p', {}, text.replace(/\*\*/g, '')));
    body.appendChild(h('p', { class: 'set-version', id: 'set-version' },
      'Version ' + (m.version != null ? m.version : '1') + (builtTxt ? ' · contenu généré le ' + builtTxt : '') + (nItems ? ' · ' + nItems + ' items' : '')));
    return section('À propos', null, body);
  }

  /* ------------------------------------------------------------------ render */

  function render() {
    ensureStyles();
    var page = h('div', { class: 'page', id: 'settings-page' });
    function build() {
      page.textContent = '';
      var parts = [
        renderProfile,
        function () { return renderBackup(build); },
        renderContent,
        renderShortcuts,
        renderAbout
      ];
      parts.forEach(function (fn) {
        try { page.appendChild(fn()); }
        catch (e) { console.warn('[settings]', e); page.appendChild(h('section', { class: 'card set-section' }, h('p', { class: 'set-hint' }, 'Section indisponible pour le moment.'))); }
      });
    }
    build();

    // La ligne de synchronisation se met à jour toute seule quand le store signale un changement.
    var u = util();
    if (typeof u.on === 'function') {
      var handler = function () {
        if (!page.isConnected) { if (page.dataset.mounted === '1' && typeof u.off === 'function') u.off('store:change', handler); return; }
        page.dataset.mounted = '1';
        var old = page.querySelector('#set-sync');
        if (old) { try { old.replaceWith(syncLine()); } catch (e) { /* ignore */ } }
      };
      u.on('store:change', handler);
      setTimeout(function () { if (page.isConnected) page.dataset.mounted = '1'; }, 500);
    }
    return page;
  }

  CARDIO.views.settings = { render: render, title: 'Plus', tab: 'settings' };
})();
