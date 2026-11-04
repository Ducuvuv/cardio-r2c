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
          h('p', { class: 'secondary', style: 'margin:0' }, 'Sur un autre téléphone ou navigateur, connecte-toi avec la même adresse : tu retrouves tout. ' +
            (st.cloud === 'ok' ? 'Synchronisation : à jour.' : st.cloud === 'syncing' ? 'Synchronisation en cours…' : st.cloud === 'error' ? 'Synchronisation : erreur, nouvel essai automatique.' : '')),
          h('button', { type: 'button', class: 'btn btn--outline', style: 'justify-self:start', on: { click: function () { R.signOut(); } } }, 'Se déconnecter'));
      } else {
        const input = h('input', { type: 'email', placeholder: 'ton.adresse@mail.com', autocomplete: 'email', style: 'width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font-size:1rem' });
        const msg = h('p', { class: 'secondary', style: 'margin:0' });
        const btn = h('button', { type: 'button', class: 'btn btn--primary btn--block', on: { click: send } }, 'Recevoir le lien de connexion');
        function send() {
          const email = String(input.value || '').trim();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = 'Adresse e-mail invalide.'; return; }
          btn.disabled = true; msg.textContent = 'Envoi…';
          R.signIn(email).then(function () {
            msg.textContent = '✉️ Lien envoyé à ' + email + '. Ouvre-le sur cet appareil (pense aux spams) : tu seras connecté·e et ta progression sera sauvegardée.';
          }, function (e) {
            btn.disabled = false;
            msg.textContent = 'Échec de l’envoi (' + (e && e.message ? e.message : 'erreur') + '). Réessaie dans une minute.';
          });
        }
        acc.replaceChildren(
          h('strong', {}, '💾 Sauvegarde ta progression'),
          h('p', { class: 'secondary', style: 'margin:0' }, 'Pour l’instant elle n’est gardée que dans ce navigateur. Connecte-toi avec ton e-mail (pas de mot de passe : tu reçois un lien) pour la retrouver partout et ne jamais la perdre. Ce que tu as déjà fait ici sera conservé.'),
          input, btn, msg);
      }
    });

    function drawPriv() {
      if (R.privUnlocked()) {
        priv.replaceChildren(h('strong', {}, '🔓 Polys débloqués'),
          h('p', { class: 'secondary', style: 'margin:0' }, 'Parasito, bactério, viro et l’atlas parasito sont disponibles sur ce navigateur.'),
          h('button', { type: 'button', class: 'btn btn--outline', style: 'justify-self:start', on: { click: function () { R.lock(); } } }, 'Verrouiller sur ce navigateur'));
        return;
      }
      priv.replaceChildren(h('strong', {}, '🔒 Polys de la fac (parasito, bactério, viro)'),
        h('p', { class: 'secondary', style: 'margin:0' }, 'Réservés à la promo : ouvre une fois, sur ce navigateur, le lien complet qu’on t’a envoyé pour les débloquer.'));
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
    return box;
  }

  C.views.compte = { render: render, banner: banner };
})();
