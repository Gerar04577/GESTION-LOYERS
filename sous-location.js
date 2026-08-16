// Gestion Loyers — module SOUS-LOCATION, entièrement séparé
// Isolé volontairement dans son propre fichier : en cas de bug ici, aucun risque
// pour le calcul du loyer, les versements, les documents ou le reste de l'app.
// Réutilise les fonctions d'aide déjà existantes (champ, champCheckbox) sans
// dupliquer leur logique.

// Bloc HTML : une case à cocher, qui affiche/cache 2 champs (nom + coordonnées
// du sous-locataire). Caché par défaut pour ne pas allonger le formulaire.
function blocSousLocation(u) {
  const coche = !!u.sousLocationActive;
  return `
    <div class="section-titre">Sous-location</div>
    ${champCheckbox('Il y a une sous-location', 'sousLocationActive', u.id, coche)}
    <div id="bloc-sous-location-${u.id}" style="display:${coche ? 'block' : 'none'};">
      ${champ('Nom du sous-locataire', 'sousLocataireNom', u.id, u.sousLocataireNom)}
      ${champ('Coordonnées du sous-locataire', 'sousLocataireCoordonnees', u.id, u.sousLocataireCoordonnees)}
    </div>`;
}

// Branche la case à cocher : afficher/cacher les 2 champs, sans dépendre du reste du formulaire
function brancherSousLocation(formEl, u) {
  const champCoche = formEl.querySelector(`#f-sousLocationActive-${u.id}`);
  const bloc = formEl.querySelector(`#bloc-sous-location-${u.id}`);
  if (champCoche && bloc) {
    champCoche.addEventListener('change', () => {
      bloc.style.display = champCoche.checked ? 'block' : 'none';
    });
  }
}

// Lecture des 2 champs à l'enregistrement — appelée depuis enregistrerEdition,
// ne touche à aucun autre champ de l'unité
function lireSousLocation(u, get) {
  u.sousLocationActive = document.getElementById(`f-sousLocationActive-${u.id}`)?.checked || false;
  u.sousLocataireNom = u.sousLocationActive ? (get('sousLocataireNom') || '') : '';
  u.sousLocataireCoordonnees = u.sousLocationActive ? (get('sousLocataireCoordonnees') || '') : '';
}
