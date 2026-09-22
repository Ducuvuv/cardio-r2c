/* CardioR2C — registry.js
 * CARDIO.registry : registre de contenu, chargeur paresseux des items, index des cartes.
 * Contrat : docs/SPEC.md §3.4 et §2.6. Script classique ES2020, aucune dépendance au chargement.
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const CARDIO = window.CARDIO;
  CARDIO.views = CARDIO.views || {};

  // manifest.js peut (par erreur d'ordre de chargement) avoir été exécuté avant ce fichier :
  // on conserve alors le manifest déjà posé sur un objet registry provisoire.
  const previous = CARDIO.registry || {};

  const SECTION_ORDER = ['I', 'II', 'III', 'IV', 'V', 'VI'];
  const SECTION_TITLES = {
    I: 'Athérome, facteurs de risque, coronaropathie, artériopathie',
    II: 'Maladies des valves',
    III: 'Rythmologie',
    IV: 'Insuffisance cardiaque',
    V: 'Maladie thromboembolique veineuse',
    VI: 'Divers'
  };
  const LOAD_TIMEOUT_MS = 15000;

  /* Segment d'id → kind (SPEC §2.6). L'id d'une carte est « <num>-<seg>-<n> ». */
  const KIND_OF_SEGMENT = {
    qcm: 'qcm', qru: 'qcm', qroc: 'qroc', open: 'open', kfp: 'kfp', tcs: 'tcs',
    ess: 'flash', num: 'flash', mn: 'flash', tree: 'tree', tx: 'tx', case: 'case',
    ecg: 'ecg', echo: 'echo'
  };
  const KIND_LABEL = {
    qcm: 'QCM', qroc: 'QROC', open: 'Ouverte', kfp: 'KFP', tcs: 'TCS', flash: 'Flash',
    tree: 'Arbre', tx: 'Traitement', case: 'Cas', ecg: 'ECG', echo: 'Écho'
  };

  const contents = {};      // num → ItemContent
  const pending = {};       // num → {promise, resolve, reject, timer, script}
  const cardCache = {};     // num → [card…]
  const cardById = {};      // id → card (rempli lors de l'indexation)

  function str(v) { return v === undefined || v === null ? '' : String(v); }

  function emptyContent(num) {
    return {
      item: str(num), meta: null, objectives: [],
      course: { sections: [], essentials: [], numbers: [], mnemonics: [] },
      questions: [], edn: [], trees: [],
      treatments: { data: [], strategies: [] },
      cases: [], ecg: { data: [], method: '' }, echo: { data: [] }
    };
  }

  function arr(v) { return Array.isArray(v) ? v : []; }

  /* Fusionne un fragment (fichier généré ou fragment partiel) dans le contenu d'un item. */
  function mergeFragment(target, frag) {
    if (frag.meta) target.meta = frag.meta;
    if (frag.objectives) target.objectives = target.objectives.concat(arr(frag.objectives));
    if (frag.course) {
      ['sections', 'essentials', 'numbers', 'mnemonics'].forEach(function (k) {
        target.course[k] = target.course[k].concat(arr(frag.course[k]));
      });
    }
    target.questions = target.questions.concat(arr(frag.questions));
    target.edn = target.edn.concat(arr(frag.edn));
    target.trees = target.trees.concat(arr(frag.trees));
    if (frag.treatments) {
      target.treatments.data = target.treatments.data.concat(arr(frag.treatments.data));
      target.treatments.strategies = target.treatments.strategies.concat(arr(frag.treatments.strategies));
    }
    target.cases = target.cases.concat(arr(frag.cases));
    if (frag.ecg) {
      target.ecg.data = target.ecg.data.concat(arr(frag.ecg.data));
      if (frag.ecg.method) target.ecg.method = frag.ecg.method;
    }
    if (frag.echo) target.echo.data = target.echo.data.concat(arr(frag.echo.data));
    return target;
  }

  function emit(evt, payload) {
    try {
      if (CARDIO.util && typeof CARDIO.util.emit === 'function') CARDIO.util.emit(evt, payload);
    } catch (e) { console.warn('[registry] emit', evt, e); }
  }

  /* ---------- Manifest / items ---------- */

  function manifestItems() {
    const m = registry.manifest;
    return m && Array.isArray(m.items) ? m.items : [];
  }

  function sectionTitle(code) {
    const m = registry.manifest;
    if (m && m.sections && m.sections[code]) return m.sections[code];
    return SECTION_TITLES[code] || str(code);
  }

  function items() {
    const list = manifestItems().slice();
    list.sort(function (a, b) {
      const sa = SECTION_ORDER.indexOf(a.section), sb = SECTION_ORDER.indexOf(b.section);
      if (sa !== sb) return (sa < 0 ? 99 : sa) - (sb < 0 ? 99 : sb);
      return (a.chapter || 0) - (b.chapter || 0);
    });
    return list.map(function (it) {
      if (!it.sectionTitle) it.sectionTitle = sectionTitle(it.section);
      return it;
    });
  }

  function sections() {
    const seen = {};
    const out = [];
    items().forEach(function (it) {
      if (seen[it.section]) return;
      seen[it.section] = true;
      out.push({ code: it.section, title: sectionTitle(it.section) });
    });
    return out;
  }

  function item(num) {
    const key = str(num);
    const found = manifestItems().find(function (it) { return str(it.num) === key; });
    if (found) return found;
    // Item chargé mais absent du manifest (cas improbable) : on dérive du contenu.
    const c = contents[key];
    if (c && c.meta) {
      return {
        num: key, short: c.meta.short, title: c.meta.title, section: c.meta.section,
        chapter: c.meta.chapter, pages: c.meta.pages, available: true, sdd: c.meta.sdd || [],
        counts: countsOf(c)
      };
    }
    return null;
  }

  function countsOf(c) {
    const q = c.questions;
    return {
      qcm: q.filter(function (x) { return x.type === 'QRM' || x.type === 'QRU'; }).length,
      qroc: q.filter(function (x) { return x.type === 'QROC'; }).length,
      open: q.filter(function (x) { return x.type === 'OPEN'; }).length,
      kfp: c.edn.filter(function (x) { return x.type === 'KFP'; }).length,
      tcs: c.edn.filter(function (x) { return x.type === 'TCS'; }).length,
      flash: c.course.essentials.length + c.course.numbers.length + c.course.mnemonics.length,
      trees: c.trees.length, tx: c.treatments.data.length, cases: c.cases.length,
      ecg: c.ecg.data.length, echo: c.echo.data.length
    };
  }

  /* ---------- Chargement paresseux ---------- */

  function isLoaded(num) { return !!contents[str(num)]; }
  function content(num) { return contents[str(num)] || null; }

  function friendlyError(msg) {
    const e = new Error(msg);
    e.friendly = true;
    return e;
  }

  function load(num) {
    const key = str(num);
    if (!key) return Promise.reject(friendlyError('Item inconnu.'));
    if (contents[key]) return Promise.resolve(contents[key]);
    if (pending[key]) return pending[key].promise;

    const meta = item(key);
    if (meta && meta.available === false) {
      return Promise.reject(friendlyError('Cet item n’est pas encore disponible dans cette version.'));
    }

    const entry = {};
    entry.promise = new Promise(function (resolve, reject) {
      entry.resolve = resolve;
      entry.reject = reject;
    });
    pending[key] = entry;

    function fail(msg) {
      if (!pending[key]) return;
      clearTimeout(entry.timer);
      delete pending[key];
      if (entry.script && entry.script.parentNode) entry.script.parentNode.removeChild(entry.script);
      entry.reject(friendlyError(msg));
    }

    try {
      const s = document.createElement('script');
      s.async = true;
      s.charset = 'utf-8';
      s.src = 'content/item-' + encodeURIComponent(key) + '.js';
      s.dataset.item = key;
      s.addEventListener('error', function () {
        fail('Impossible de charger l’item ' + key + '. Vérifie ta connexion puis réessaie.');
      });
      s.addEventListener('load', function () {
        // Le script a été exécuté : s'il n'a pas appelé CARDIO.register pour cet item, c'est un
        // fichier vide ou corrompu ; on n'attend pas le timeout.
        if (pending[key] && !contents[key]) fail('Le contenu de l’item ' + key + ' est vide ou corrompu.');
      });
      entry.script = s;
      entry.timer = setTimeout(function () {
        fail('Le chargement de l’item ' + key + ' prend trop de temps. Réessaie dans un instant.');
      }, LOAD_TIMEOUT_MS);
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {
      console.warn('[registry] injection du script', e);
      fail('Impossible de charger l’item ' + key + '.');
    }
    return entry.promise;
  }

  /* Charge tous les items disponibles, par lots de 3 (séquentiels) pour garder le téléphone fluide.
   * Résout avec {loaded:[num…], failed:[{num, error}…]} ; ne rejette jamais. */
  function loadAll(opts) {
    const o = opts || {};
    const batch = o.batch || 3;
    const list = items().filter(function (it) { return it.available !== false; }).map(function (it) { return str(it.num); });
    const result = { loaded: [], failed: [] };
    let i = 0;
    function step() {
      if (i >= list.length) return Promise.resolve(result);
      const slice = list.slice(i, i + batch);
      i += batch;
      return Promise.all(slice.map(function (n) {
        return load(n).then(function () { result.loaded.push(n); }, function (err) {
          result.failed.push({ num: n, error: err });
        });
      })).then(function () {
        if (typeof o.onProgress === 'function') {
          try { o.onProgress(Math.min(i, list.length), list.length); } catch (e) { /* ignore */ }
        }
        // Une micro-pause entre les lots laisse respirer le thread principal.
        return new Promise(function (r) { setTimeout(r, 0); }).then(step);
      });
    }
    return step();
  }

  /* Point d'entrée des fichiers générés : CARDIO.register({item, meta, objectives, course, …}). */
  CARDIO.register = function register(fragment) {
    if (!fragment || typeof fragment !== 'object') {
      console.warn('[registry] register : fragment invalide', fragment);
      return;
    }
    const key = str(fragment.item || (fragment.meta && fragment.meta.num));
    if (!key) {
      console.warn('[registry] register : item manquant', fragment);
      return;
    }
    const target = contents[key] || emptyContent(key);
    contents[key] = mergeFragment(target, fragment);
    delete cardCache[key];
    delete cardCache['*'];
    // Ré-indexe immédiatement pour que card(id) réponde dès la résolution du chargement.
    cards(key);
    const p = pending[key];
    if (p) {
      clearTimeout(p.timer);
      delete pending[key];
      p.resolve(contents[key]);
    }
    emit('registry:loaded', { item: key });
  };

  /* ---------- Index des cartes ---------- */

  function kindOfId(id) {
    const parts = str(id).split('-');
    return parts.length >= 3 ? (KIND_OF_SEGMENT[parts[1]] || null) : null;
  }

  function itemOfId(id) {
    const parts = str(id).split('-');
    return parts.length >= 2 ? parts[0] : '';
  }

  function makeCard(num, kind, rank, obj, ref) {
    const c = { id: str(ref.id), item: str(num), kind: kind, rank: ref.rank || rank || 'A', objective: obj || null, ref: ref };
    cardById[c.id] = c;
    return c;
  }

  function buildCards(num) {
    const c = contents[str(num)];
    if (!c) return [];
    const out = [];
    let rank = 0;
    function push(kind, ref, objective) {
      if (!ref || !ref.id) return;
      const k = kindOfId(ref.id) || kind;
      const card = makeCard(num, k, ref.rank, objective !== undefined ? objective : (ref.objective || null), ref);
      card.rank = ref.rank || 'A';
      card.order = rank++;
      out.push(card);
    }
    c.questions.forEach(function (q) { push(q.type === 'QROC' ? 'qroc' : q.type === 'OPEN' ? 'open' : 'qcm', q); });
    c.edn.forEach(function (e) { push(e.type === 'TCS' ? 'tcs' : 'kfp', e); });
    c.course.essentials.forEach(function (e) { push('flash', e, e.objective || null); });
    c.course.numbers.forEach(function (n) { push('flash', n, n.objective || null); });
    c.course.mnemonics.forEach(function (m) { push('flash', m, m.objective || null); });
    c.trees.forEach(function (t) { push('tree', t); });
    c.treatments.data.forEach(function (t) { push('tx', t, t.objective || null); });
    c.cases.forEach(function (cs) { push('case', cs, cs.objective || null); });
    c.ecg.data.forEach(function (e) { push('ecg', e); });
    c.echo.data.forEach(function (e) { push('echo', e); });
    return out;
  }

  /* cards(num?) : index des cartes de l'item (ou de tous les items chargés). Résultat mis en cache. */
  function cards(num) {
    if (num !== undefined && num !== null && num !== '') {
      const key = str(num);
      if (!cardCache[key]) cardCache[key] = buildCards(key);
      return cardCache[key];
    }
    if (!cardCache['*']) {
      let all = [];
      Object.keys(contents).forEach(function (k) { all = all.concat(cards(k)); });
      cardCache['*'] = all;
    }
    return cardCache['*'];
  }

  /* card(id) → {id, item, kind, rank, objective, data} ou null si l'item n'est pas chargé. */
  function card(id) {
    const key = str(id);
    if (!key) return null;
    let c = cardById[key];
    if (!c) {
      const num = itemOfId(key);
      if (num && contents[num]) { cards(num); c = cardById[key]; }
    }
    if (!c) return null;
    return { id: c.id, item: c.item, kind: c.kind, rank: c.rank, objective: c.objective, data: c.ref, ref: c.ref };
  }

  /* ensureCard(id) : charge l'item si nécessaire puis résout la carte. */
  function ensureCard(id) {
    const existing = card(id);
    if (existing) return Promise.resolve(existing);
    const num = itemOfId(id);
    if (!num) return Promise.reject(friendlyError('Identifiant de carte invalide.'));
    return load(num).then(function () {
      const c = card(id);
      if (!c) throw friendlyError('Carte introuvable : ' + id);
      return c;
    });
  }

  function objective(num, objId) {
    const c = contents[str(num)];
    if (!c) return null;
    return c.objectives.find(function (o) { return o.id === objId; }) || null;
  }

  /* Cartes rattachées à un objectif (questions, edn, arbres, ecg, echo dont .objective === objId). */
  function cardsForObjective(num, objId) {
    return cards(num).filter(function (c) { return c.objective === objId; });
  }

  /* ---------- Recherche ---------- */

  function normalize(s) {
    if (CARDIO.util && typeof CARDIO.util.normalize === 'function') {
      try { return CARDIO.util.normalize(str(s)); } catch (e) { /* fallback */ }
    }
    return str(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /* search(query) : titres des items (manifest) + sections, essentiels, chiffres et mnémos des items
   * chargés. Retourne [{type, item, id, title, text, route, rank}] (max opts.limit, défaut 40). */
  function search(query, opts) {
    const q = normalize(query);
    const limit = (opts && opts.limit) || 40;
    const out = [];
    if (!q || q.length < 2) return out;
    const terms = q.split(' ').filter(Boolean);
    function matches(text) {
      const n = normalize(text);
      return terms.every(function (t) { return n.indexOf(t) >= 0; });
    }
    items().forEach(function (it) {
      if (matches(it.short + ' ' + it.title + ' ' + it.num)) {
        out.push({ type: 'item', item: str(it.num), id: str(it.num), title: 'Item ' + it.num + ' · ' + it.short,
          text: it.title, route: '#/item/' + it.num, rank: null });
      }
    });
    Object.keys(contents).forEach(function (num) {
      const c = contents[num];
      const label = c.meta ? c.meta.short : 'Item ' + num;
      c.course.sections.forEach(function (s) {
        if (out.length < limit && matches(s.title)) {
          out.push({ type: 'section', item: num, id: s.id, title: s.title, text: label + ' · fiche',
            route: '#/item/' + num + '/cours', rank: s.rank });
        }
      });
      c.course.essentials.forEach(function (e) {
        if (out.length < limit && matches(e.text)) {
          out.push({ type: 'essential', item: num, id: e.id, title: e.text, text: label + ' · l’essentiel',
            route: '#/item/' + num + '/cours', rank: e.rank });
        }
      });
      c.course.numbers.forEach(function (n) {
        if (out.length < limit && matches(n.label + ' ' + n.value)) {
          out.push({ type: 'number', item: num, id: n.id, title: n.label + ' : ' + n.value, text: label + ' · chiffres clés',
            route: '#/item/' + num + '/cours', rank: n.rank });
        }
      });
      c.course.mnemonics.forEach(function (m) {
        if (out.length < limit && matches(m.title + ' ' + m.mnemonic)) {
          out.push({ type: 'mnemonic', item: num, id: m.id, title: m.mnemonic, text: label + ' · ' + m.title,
            route: '#/item/' + num + '/mnemos', rank: m.rank });
        }
      });
    });
    return out.slice(0, limit);
  }

  const registry = {
    manifest: previous.manifest || null,
    SECTION_ORDER: SECTION_ORDER,
    KIND_LABEL: KIND_LABEL,
    items: items,
    sections: sections,
    sectionTitle: sectionTitle,
    item: item,
    load: load,
    loadAll: loadAll,
    isLoaded: isLoaded,
    loaded: function () { return Object.keys(contents); },
    content: content,
    cards: cards,
    card: card,
    ensureCard: ensureCard,
    kindOfId: kindOfId,
    itemOfId: itemOfId,
    objective: objective,
    cardsForObjective: cardsForObjective,
    search: search
  };
  CARDIO.registry = registry;
})();
