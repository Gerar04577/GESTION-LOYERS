// Gestion Loyers — module PRÉSENCE, entièrement séparé
// Ajouté le 19/08 : simple information, JAMAIS un blocage — signale quand une
// autre personne semble aussi utiliser l'app, pour permettre de se téléphoner
// et se coordonner. Contrairement à un verrou, une présence trop ancienne
// (5 minutes sans activité) est automatiquement ignorée — aucun risque de
// rester bloqué si quelqu'un ferme l'app sans prévenir.
//
// Isolé volontairement : ne touche à AUCUNE fonction ni variable de app.js,
// seulement les fonctions déjà globales qu'il réutilise (estConnecte,
// resoudreRefParChemin, enfantsDeRef, lireFichierDansDossier,
// ecrireFichierDansDossier, afficherStatutSync).

const SOUS_DOSSIER_PRESENCE = "GESTION-LOYERS/presence";
const DELAI_PEREMPTION_MINUTES = 5;
const CLE_MON_PRENOM = 'gestionLoyersMonPrenom';

function obtenirMonPrenom() {
  let prenom = localStorage.getItem(CLE_MON_PRENOM);
  if (!prenom) {
    prenom = (prompt("Quel est ton prénom ? (demandé une seule fois, pour prévenir si quelqu'un d'autre utilise l'app en même temps)") || '').trim();
    if (!prenom) prenom = 'Quelqu\'un';
    localStorage.setItem(CLE_MON_PRENOM, prenom);
  }
  return prenom;
}

function nomFichierPresence(prenom) {
  // nom de fichier sûr : on retire les accents proprement (é→e) plutôt que
  // de les supprimer (ce qui donnerait "grard" au lieu de "gerard")
  const sansAccents = prenom.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return sansAccents.toLowerCase().replace(/[^a-z0-9]/g, '') + '.json';
}

async function signalerPresence() {
  if (typeof estConnecte !== 'function' || !estConnecte()) return; // jamais bloquant, silencieux si hors ligne
  try {
    const prenom = obtenirMonPrenom();
    const refDossier = await resoudreRefParChemin(SOUS_DOSSIER_PRESENCE, true);
    await ecrireFichierDansDossier(refDossier, nomFichierPresence(prenom), JSON.stringify({
      prenom,
      derniereActivite: new Date().toISOString(),
    }));
  } catch (e) {
    console.error("Présence : signalement ignoré (non bloquant)", e);
  }
}

// Retourne la liste des AUTRES personnes actives récemment (hors soi-même),
// ou [] si aucune, ou en cas d'erreur — jamais bloquant, jamais d'exception
// qui remonte à l'appelant.
async function autresPersonnesActives() {
  if (typeof estConnecte !== 'function' || !estConnecte()) return [];
  try {
    const monPrenom = localStorage.getItem(CLE_MON_PRENOM);
    const refDossier = await resoudreRefParChemin(SOUS_DOSSIER_PRESENCE, false);
    if (!refDossier) return [];
    const enfants = await enfantsDeRef(refDossier);
    const maintenant = Date.now();
    const actives = [];
    for (const fichier of enfants) {
      if (!fichier.file || !(fichier.name || '').endsWith('.json')) continue;
      try {
        const res = await lireFichierDansDossier(refDossier, fichier.name);
        if (!res.ok) continue;
        const info = await res.json();
        if (!info || !info.prenom || !info.derniereActivite) continue;
        if (monPrenom && info.prenom.toLowerCase() === monPrenom.toLowerCase()) continue; // pas soi-même
        const minutesEcoulees = (maintenant - new Date(info.derniereActivite).getTime()) / 60000;
        if (minutesEcoulees <= DELAI_PEREMPTION_MINUTES) {
          actives.push(info.prenom);
        }
      } catch (e) {
        continue; // un fichier illisible ne doit pas bloquer les autres
      }
    }
    return actives;
  } catch (e) {
    console.error("Présence : vérification ignorée (non bloquant)", e);
    return [];
  }
}

async function verifierEtAfficherPresence() {
  const autres = await autresPersonnesActives();
  const bandeau = document.getElementById('bandeau-presence');
  if (!bandeau) return;
  if (autres.length > 0) {
    bandeau.textContent = `⚠️ ${autres.join(' et ')} semble${autres.length > 1 ? 'nt' : ''} aussi utiliser l'app en ce moment — vérifie avant de continuer.`;
    bandeau.style.display = 'block';
  } else {
    bandeau.style.display = 'none';
  }
}
