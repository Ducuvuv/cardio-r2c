/* CardioR2C — js/remote.js
 * Version partagée (site GitHub Pages, hors claude.ai) :
 *  1) Sauvegarde de la progression en ligne (Supabase) : connexion par lien magique envoyé par e-mail ; la
 *     progression suit la personne sur tous ses navigateurs. On imite l'interface window.claude.use('db' | 'user')
 *     que store.js sait déjà synchroniser (documents « profile » et « cards-… »), table public.progress_docs
 *     protégée par RLS (chacun ne lit / n'écrit que ses lignes).
 *  2) Contenus privés (polys parasito, bactério, viro, atlas parasito) : servis chiffrés (content/enc/, AES-GCM,
 *     clé dérivée d'un mot de passe par PBKDF2) et déchiffrés dans le navigateur après saisie du mot de passe.
 * Ne fait rien dans l'artefact claude.ai (window.claude présent). Chargé AVANT store.js.
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const C = window.CARDIO;
  // Seulement sur le site partagé (GitHub Pages) et en local pour les tests ; jamais dans l'artefact claude.ai
  const host = location.hostname;
  if (window.claude || !(/\.github\.io$/.test(host) || host === '127.0.0.1' || host === 'localhost')) return;

  const SUPA_URL = 'https://oxynspymbyrxleejavyi.supabase.co';
  const SUPA_KEY = 'sb_publishable_yMohDBXt7tzBx2HsgLSDyA_wzeSKIgT';   // clé publique (faite pour être dans l'appli)
  const SUPA_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
  const TABLE = 'progress_docs';
  const LS_PRIV = 'cardio.privkey.v1';

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('script ' + src)); };
      document.head.appendChild(s);
    });
  }

  /* ---------------- Supabase ---------------- */
  let clientP = null;
  function client() {
    if (!clientP) {
      clientP = loadScript(SUPA_JS).then(function () {
        return window.supabase.createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' } });
      });
      clientP.catch(function () { clientP = null; });
    }
    return clientP;
  }
  function session() {
    return client().then(function (sb) { return sb.auth.getSession(); }).then(function (r) { return r && r.data ? r.data.session : null; });
  }
  function err(code, e) { const x = new Error(code); x.code = code; x.cause = e; return x; }
  function keyOf(path) { const p = String(path).split('/'); return p[p.length - 1]; }

  function makeDb(sb, uid) {
    return {
      doc: function (path) {
        const key = keyOf(path);
        return {
          get: function () {
            return sb.from(TABLE).select('data').eq('user_id', uid).eq('key', key).maybeSingle().then(function (r) {
              if (r.error) throw err('read_failed', r.error);
              const d = r.data ? r.data.data : null;
              return { exists: !!r.data, id: key, data: function () { return d; } };
            });
          },
          set: function (data) {
            return sb.from(TABLE).upsert({ user_id: uid, key: key, data: data, updated_at: new Date().toISOString() }).then(function (r) {
              if (r.error) throw err(r.error.code === '42501' ? 'not_granted' : 'write_failed', r.error);
            });
          }
        };
      },
      collection: function () {
        return {
          get: function () {
            return sb.from(TABLE).select('key,data').eq('user_id', uid).then(function (r) {
              if (r.error) throw err('read_failed', r.error);
              return { docs: (r.data || []).map(function (row) { return { id: row.key, exists: true, data: function () { return row.data; } }; }) };
            });
          }
        };
      }
    };
  }

  // Interface attendue par store.js (cloudInit) : use('db') → db, use('user') → { id() }
  window.claude = {
    __shared: true,
    use: function (name) {
      if (name === 'db') {
        return Promise.all([client(), session()]).then(function (a) {
          if (!a[1]) throw err('not_signed_in');
          return makeDb(a[0], a[1].user.id);
        });
      }
      if (name === 'user') {
        return session().then(function (s) {
          if (!s) throw err('not_signed_in');
          return { id: function () { return s.user.id; }, email: function () { return s.user.email; } };
        });
      }
      return Promise.reject(err('capability_disabled'));
    }
  };

  // Progression arrivée du cloud après l'affichage : on redessine la page courante.
  // Pas encore connecté·e : on ouvre directement « Mon compte » (e-mail) à l'arrivée, sauf si « Plus tard » < 3 jours.
  document.addEventListener('DOMContentLoaded', function () {
    try {
      const later = Number(lsGet('cardio.login.later') || 0);
      if (Date.now() - later >= 3 * 864e5) {
        let n = 0;
        const iv = setInterval(function () {             // attend que l'app ait démarré (routeur actif)
          if (++n > 75) { clearInterval(iv); return; }
          if (!(C.router && C.router.started)) return;
          clearInterval(iv);
          session().then(function (s) {
            if (!s && (location.hash || '#/') === '#/') C.router.go('#/compte');
          }, function () { /* hors ligne : on laisse */ });
        }, 200);
      }
    } catch (e) { /* ignore */ }
    try {
      C.util && C.util.on && C.util.on('store:change', function (e) {
        if (e && e.reason === 'cloud-merge' && C.router && C.router.started) C.router.go(location.hash || '#/', { force: true });
      });
    } catch (e) { /* ignore */ }
  });

  /* ---------------- Contenus privés chiffrés ---------------- */
  const b64 = {
    enc: function (buf) { let s = ''; new Uint8Array(buf).forEach(function (b) { s += String.fromCharCode(b); }); return btoa(s); },
    dec: function (str) { const s = atob(str); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  };
  let encIndexP = null;
  function encIndex() {
    if (!encIndexP) encIndexP = fetch('content/enc/index.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('index'); return r.json(); });
    return encIndexP;
  }
  function aesKey(raw) { return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']); }
  function decryptFile(key, name) {
    return fetch('content/enc/' + name + '.enc').then(function (r) { if (!r.ok) throw new Error(name); return r.arrayBuffer(); }).then(function (buf) {
      const u = new Uint8Array(buf);
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, key, u.slice(12));
    }).then(function (plain) { return new TextDecoder().decode(plain); });
  }
  function runCode(code) {
    const s = document.createElement('script');
    s.text = code;
    document.head.appendChild(s);
  }
  let privKey = null;
  function unlockWith(raw) {
    return aesKey(raw).then(function (k) {
      return encIndex().then(function (ix) {
        // vérifie la clé sur un petit témoin avant de tout charger
        return decryptFile(k, ix.check).then(function (txt) {
          if (txt !== 'ok') throw new Error('bad');
          privKey = k;
          let chain = Promise.resolve();
          (ix.files || []).forEach(function (n) { chain = chain.then(function () { return decryptFile(k, n).then(runCode); }); });
          return chain;
        });
      });
    });
  }
  // Lien secret : …/cardio-r2c/#k=<clé> → la clé est gardée sur ce navigateur et retirée de l'adresse
  // (le fragment # n'est jamais envoyé au serveur). Lu avant le démarrage du routeur.
  (function () {
    const m = /^#k=([A-Za-z0-9_-]{40,})/.exec(location.hash || '');
    if (!m) return;
    lsSet(LS_PRIV, m[1].replace(/-/g, '+').replace(/_/g, '/') + '=');
    try { history.replaceState(null, '', location.pathname + location.search + '#/'); } catch (e) { location.hash = '#/'; }
  })();
  // Paquets d'images de l'atlas parasito (chargés à la demande par views/atlas.js)
  C.privChunk = function (src) {
    if (!privKey) return Promise.resolve();
    const name = String(src).split('/').pop().replace(/\.js$/, '');
    return decryptFile(privKey, 'atlas-img/' + name).then(runCode).catch(function () { /* ignore */ });
  };
  C.remote = {
    active: true,
    session: session,
    signIn: function (email) {
      return client().then(function (sb) {
        return sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.origin + location.pathname } });
      }).then(function (r) { if (r.error) throw r.error; return true; });
    },
    // connexion e-mail + mot de passe ; si l'adresse n'a pas encore de compte, il est créé (confirmation e-mail désactivée)
    signInPassword: function (email, password) {
      return client().then(function (sb) {
        return sb.auth.signInWithPassword({ email: email, password: password }).then(function (r) {
          if (!r.error && r.data && r.data.session) return 'signed';
          return sb.auth.signUp({ email: email, password: password }).then(function (u) {
            if (u.error) {
              if (/registered|exists/i.test(u.error.message || '')) throw err('wrong_password', u.error);
              throw u.error;
            }
            if (u.data && u.data.session) return 'created';
            // adresse déjà inscrite (Supabase renvoie un utilisateur sans identités) → mauvais mot de passe
            if (u.data && u.data.user && Array.isArray(u.data.user.identities) && !u.data.user.identities.length) throw err('wrong_password');
            throw err('confirm_needed');
          });
        });
      });
    },
    signOut: function () {
      return client().then(function (sb) { return sb.auth.signOut(); }).then(function () { location.reload(); });
    },
    privUnlocked: function () { return !!privKey; },
    // code de déblocage (ex. donné à la promo) : déchiffre la clé enveloppée dans content/enc/index.json
    unlockCode: function (code) {
      return encIndex().then(function (ix) {
        if (!ix.wrap) throw new Error('nocode');
        const enc = new TextEncoder();
        return crypto.subtle.importKey('raw', enc.encode(String(code).trim()), 'PBKDF2', false, ['deriveKey']).then(function (base) {
          return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64.dec(ix.wrap.salt), iterations: ix.wrap.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        }).then(function (kek) {
          const blob = b64.dec(ix.wrap.blob);
          return crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.slice(0, 12) }, kek, blob.slice(12));
        }).then(function (raw) {
          return unlockWith(raw).then(function () { lsSet(LS_PRIV, b64.enc(raw)); return true; });
        });
      });
    },
    lock: function () { lsSet(LS_PRIV, null); location.reload(); }
  };
  // Déverrouillage automatique (mot de passe déjà saisi sur ce navigateur), avant le démarrage de l'app si possible
  C.remote.privReady = (function () {
    const saved = lsGet(LS_PRIV);
    if (!saved || !window.crypto || !crypto.subtle) return Promise.resolve(false);
    return unlockWith(b64.dec(saved)).then(function () {
      if (C.router && C.router.started) C.router.go(location.hash || '#/', { force: true });
      return true;
    }).catch(function () { lsSet(LS_PRIV, null); return false; });
  })();
})();
