// Gestion Loyers — module ARCHIVAGE, entièrement séparé
// Ajouté après l'incident de perte de données du 18/08. Garde automatiquement
// jusqu'à 15 points de sauvegarde horodatés PAR MOIS, espacés d'environ 2 jours
// chacun — un filet de sécurité à part de l'historique natif OneDrive (qui, lui,
// garde TOUTES les versions sans distinction et devient vite difficile à fouiller
// si on sauvegarde 20 fois dans la même journée).
//
// Isolé volontairement : en cas de problème ici, ça ne doit jamais empêcher ni
// ralentir la vraie sauvegarde (celle qui compte) — toujours best-effort, jamais
// bloquant, jamais d'erreur remontée à l'utilisateur si l'archivage échoue.

const SOUS_DOSSIER_ARCHIVES = "GESTION-LOYERS/archives";
const MAX_POINTS_ARCHIVE_PAR_MOIS = 15;
const ECART_MINIMUM_JOURS = 2;

// Liste les points d'archive déjà existants pour un mois donné, triés du plus
// ancien au plus récent. Chaque nom de fichier est horodaté : "2026-09_2026-08-18T14-32-05.json"
async function listerPointsArchive(mois) {
  try {
    const refDossierMois = await resoudreRefParChemin(`${SOUS_DOSSIER_ARCHIVES}/${mois}`, false);
    if (!refDossierMois) return [];
    const enfants = await enfantsDeRef(refDossierMois);
    return enfants
      .filter(e => e.file && (e.name || '').endsWith('.json'))
      .map(e => e.name)
      .sort(); // tri alphabétique = tri chronologique, grâce au format de date ISO
  } catch (e) {
    console.error("Archivage : impossible de lister les points existants", e);
    return [];
  }
}

function extraireDateDuNomArchive(nomFichier) {
  // format attendu : "2026-09_2026-08-18T14-32-05.json"
  const correspondance = nomFichier.match(/_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.json$/);
  if (!correspondance) return null;
  const iso = correspondance[1].replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3');
  return new Date(iso);
}

// Décide si un nouveau point d'archive doit être créé maintenant pour ce mois,
// et le crée si oui — jamais bloquant, jamais d'erreur visible en cas d'échec
async function archiverSiNecessaire(mois, donnees) {
  try {
    const points = await listerPointsArchive(mois);

    if (points.length >= MAX_POINTS_ARCHIVE_PAR_MOIS) {
      return; // quota atteint pour ce mois, on ne crée rien de plus
    }

    if (points.length > 0) {
      const dernierPoint = points[points.length - 1];
      const dateDernierPoint = extraireDateDuNomArchive(dernierPoint);
      if (dateDernierPoint) {
        const joursEcoules = (Date.now() - dateDernierPoint.getTime()) / (1000 * 60 * 60 * 24);
        if (joursEcoules < ECART_MINIMUM_JOURS) {
          return; // trop tôt depuis le dernier point, on attend
        }
      }
    }

    // créer le nouveau point, horodaté
    const maintenant = new Date();
    const horodatageNomFichier = maintenant.toISOString().slice(0, 19).replace(/:/g, '-');
    const nomFichier = `${mois}_${horodatageNomFichier}.json`;
    const refDossierMois = await resoudreRefParChemin(`${SOUS_DOSSIER_ARCHIVES}/${mois}`, true);
    await ecrireFichierDansDossier(refDossierMois, nomFichier, JSON.stringify(donnees, null, 2));
  } catch (e) {
    // best-effort uniquement : un échec d'archivage ne doit jamais gêner la vraie sauvegarde
    console.error("Archivage : échec de la création d'un point (ignoré, non bloquant)", e);
  }
}
