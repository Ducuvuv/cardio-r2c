/* CardioR2C — views/compte.js
 * « Mon compte » (version partagée, js/remote.js) : connexion par e-mail pour sauvegarder la progression en ligne,
 * et mot de passe pour débloquer les polys privés. Sans objet dans l'artefact claude.ai.
 */
(function () {
  'use strict';
  window.CARDIO = window.CARDIO || {};
  const C = window.CARDIO;
  C.views = C.views || {};
  function h() { return C.util.h.apply(null, arguments); }

  function render() {
    const root = h('div', { class: 'page stack' });
    const R = C.remote;
    if (!R || !R.active) {
      root.appendChild(h('p', {}, 'Ta progression est déjà sauvegardée avec ton compte Claude.'));
      return { el: root, title: 'Mon compte' };
    }
    const acc = h('div', { class: 'card stack' }, h('strong', {}, '💾 Sauvegarde de ta progression'), h('p', { class: 'secondary' }, 'Chargement…'));
    const priv = h('div', { class: 'card stack' });
    root.append(acc, priv);

    R.session().then(function (s) {
      if (s) {
        const st = C.store && C.store.syncStatus ? C.store.syncStatus() : {};
        acc.replaceChildren(
          h('strong', {}, '💾 Progression sauvegardée en ligne'),
          h('p', { style: 'margin:0' }, 'Connecté·e avec ', h('b', {}, s.user.email), '.'),
          h('p', { class: 'secondary', style: 'margin:0' }, 'Sur un autre téléphone ou navigateur, connecte-toi avec le même e-mail et le même mot de passe : tu retrouves tout. ' +
            (st.cloud === 'ok' ? 'Synchronisation : à jour.' : st.cloud === 'syncing' ? 'Synchronisation en cours…' : st.cloud === 'error' ? 'Synchronisation : erreur, nouvel essai automatique.' : '')),
          h('button', { type: 'button', class: 'btn btn--outline', style: 'justify-self:start', on: { click: function () { R.signOut(); } } }, 'Se déconnecter'));
      } else {
        const css = 'width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font-size:1rem';
        const input = h('input', { type: 'email', placeholder: 'ton.adresse@mail.com', autocomplete: 'email', style: css });
        const pw = h('input', { type: 'password', placeholder: 'Mot de passe (6 caractères min.)', autocomplete: 'current-password', style: css });
        const msg = h('p', { class: 'secondary', style: 'margin:0' });
        const btn = h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: send } }, 'Me connecter');
        [input, pw].forEach(function (el) { el.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); }); });
        function send() {
          const email = String(input.value || '').trim();
          const pass = String(pw.value || '');
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = 'Adresse e-mail invalide.'; return; }
          if (pass.length < 6) { msg.textContent = 'Mot de passe : 6 caractères minimum.'; return; }
          btn.disabled = true; msg.textContent = 'Connexion…';
          R.signInPassword(email, pass).then(function (r) {
            msg.textContent = r === 'created' ? 'Compte créé ✓ Ta progression est maintenant sauvegardée.' : 'Connecté·e ✓';
            setTimeout(function () { location.hash = '#/'; location.reload(); }, 600);
          }, function (e) {
            btn.disabled = false;
            msg.textContent = e && e.code === 'wrong_password' ? 'Mot de passe incorrect pour cette adresse.' :
              e && e.code === 'confirm_needed' ? 'Compte créé, mais la confirmation par e-mail est activée dans Supabase : il faut la désactiver.' :
              'Échec (' + (e && e.message ? e.message : 'erreur') + '). Réessaie.';
          });
        }
        acc.replaceChildren(
          h('strong', {}, '💾 Connecte-toi pour sauvegarder ta progression'),
          h('p', { class: 'secondary', style: 'margin:0' }, 'Première fois : choisis un mot de passe, ton compte est créé. Ensuite, sur n’importe quel appareil, même e-mail + même mot de passe : tu retrouves tout. Ta progression s’enregistre toute seule, et ce que tu as déjà fait ici est conservé.'),
          input, pw, btn, msg,
          h('button', { type: 'button', class: 'btn btn--ghost btn--sm', style: 'justify-self:start', on: { click: function () {
            try { localStorage.setItem('cardio.login.later', String(Date.now())); } catch (e) { /* ignore */ }
            location.hash = '#/';
          } } }, 'Plus tard'));
        setTimeout(function () { try { input.focus(); } catch (e) { /* ignore */ } }, 50);
      }
    });

    function drawPriv() {
      if (R.privUnlocked()) {
        priv.replaceChildren(h('strong', {}, '🔓 Polys débloqués'),
          h('p', { class: 'secondary', style: 'margin:0' }, 'Parasito, bactério, viro et l’atlas parasito sont disponibles sur ce navigateur.'));
        return;
      }
      const code = h('input', { type: 'text', placeholder: 'Code de déblocage', autocomplete: 'off', autocapitalize: 'off', style: 'width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font-size:1rem' });
      const msg = h('p', { class: 'secondary', style: 'margin:0' });
      const btn = h('button', { type: 'button', class: 'btn btn--secondary btn--block', on: { click: go } }, 'Débloquer');
      function go() {
        btn.disabled = true; msg.textContent = 'Vérification…';
        R.unlockCode(code.value).then(function () {
          msg.textContent = 'Débloqué ✓';
          setTimeout(function () { location.hash = '#/'; location.reload(); }, 400);
        }, function () { btn.disabled = false; msg.textContent = 'Code incorrect.'; });
      }
      code.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
      priv.replaceChildren(h('strong', {}, '🔒 Polys de la fac (parasito, bactério, viro)'),
        h('p', { class: 'secondary', style: 'margin:0' }, 'Réservés à la promo : entre le code de déblocage (ou ouvre le lien complet qu’on t’a envoyé). Il est retenu sur ce navigateur.'),
        code, btn, msg);
    }
    drawPriv();
    return { el: root, title: 'Mon compte' };
  }

  /* Bandeau d'accueil (version partagée) tant que la personne n'est pas connectée. */
  function banner() {
    const R = C.remote;
    if (!R || !R.active) return null;
    const box = h('a', { class: 'card', href: '#/compte', style: 'display:none;margin:0 0 12px;text-decoration:none;color:inherit;border:1px solid var(--accent)' },
      h('strong', {}, '💾 Sauvegarde ta progression'),
      h('p', { class: 'secondary', style: 'margin:4px 0 0' }, 'Connecte-toi avec ton e-mail pour la retrouver sur tous tes appareils →'));
    R.session().then(function (s) { if (!s) box.style.display = 'block'; }, function () { box.style.display = 'block'; });
    if (R.privUnlocked()) return box;
    const lock = h('a', { class: 'card', href: '#/compte', style: 'display:block;margin:0 0 12px;text-decoration:none;color:inherit' },
      h('strong', {}, '🔒 Débloquer parasito, bactério et viro'),
      h('p', { class: 'secondary', style: 'margin:4px 0 0' }, 'Entre le code de déblocage de la promo →'));
    return h('div', {}, box, lock);
  }

  C.views.compte = { render: render, banner: banner };
})();
