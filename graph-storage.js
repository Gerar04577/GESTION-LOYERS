// Gestion Loyers — stockage des données dans OneDrive
// Un fichier PAR MOIS dans un sous-dossier dédié "GESTION-LOYERS/historique",
// à l'intérieur du dossier PARTAGÉ "Immobilier 2025-2026" (le même que VéroS).
// Chaque mois reste entièrement modifiable, y compris les mois passés
// (ex. pour noter un loyer payé en retard après coup).
//
// ATTENTION (même mise en garde que pour VéroS) : le nom du dossier partagé peut
// changer chaque année. S'il est renommé, changer DOSSIER_RACINE_PARTAGE ci-dessous.

const DOSSIER_RACINE_PARTAGE = "Immobilier 2025-2026";
const SOUS_DOSSIER = "GESTION-LOYERS";
const SOUS_DOSSIER_HISTORIQUE = "GESTION-LOYERS/historique";
const NOM_FICHIER_INDEX = "index.json"; // liste des mois qui ont des données
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

function encoderChemin(chemin) {
  return chemin.split('/').map(encodeURIComponent).join('/');
}

async function appelGraph(chemin, options = {}) {
  const token = await obtenirJetonValide();
  if (!token) throw new Error("Jeton Microsoft absent ou expiré (reconnexion nécessaire)");
  const res = await fetch(`${GRAPH_BASE}${chemin}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "Authorization": `Bearer ${token}`
    }
  });
  return res;
}

async function detailErreur(res) {
  try {
    const texte = await res.text();
    return `${res.status} ${res.statusText} — ${texte.slice(0, 300)}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

async function assurerDossier(cheminRelatif) {
  const chemin = encoderChemin(`${DOSSIER_RACINE_PARTAGE}/${cheminRelatif}`);
  const verif = await appelGraph(`/me/drive/root:/${chemin}`);
  if (verif.ok) return;
  if (verif.status !== 404) throw new Error(`Vérification dossier : ${await detailErreur(verif)}`);

  // Créer récursivement segment par segment (les sous-dossiers imbriqués ne se créent pas tout seuls)
  const segments = cheminRelatif.split('/');
  let cheminCourant = DOSSIER_RACINE_PARTAGE;
  for (const segment of segments) {
    const cheminCourantEnc = encoderChemin(cheminCourant);
    const cible = await appelGraph(`/me/drive/root:/${encoderChemin(cheminCourant + '/' + segment)}`);
    if (!cible.ok) {
      const creation = await appelGraph(`/me/drive/root:/${cheminCourantEnc}:/children`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: segment, folder: {}, "@microsoft.graph.conflictBehavior": "rename" })
      });
      if (!creation.ok) throw new Error(`Création dossier "${segment}" : ${await detailErreur(creation)}`);
    }
    cheminCourant = cheminCourant + '/' + segment;
  }
}

function cheminMois(mois) {
  return encoderChemin(`${DOSSIER_RACINE_PARTAGE}/${SOUS_DOSSIER_HISTORIQUE}/${mois}.json`);
}

function cheminIndex() {
  return encoderChemin(`${DOSSIER_RACINE_PARTAGE}/${SOUS_DOSSIER_HISTORIQUE}/${NOM_FICHIER_INDEX}`);
}

async function chargerIndexMoisOneDrive() {
  const res = await appelGraph(`/me/drive/root:/${cheminIndex()}:/content`);
  if (res.status === 404) return { mois: [] };
  if (!res.ok) throw new Error(`Lecture index mois : ${await detailErreur(res)}`);
  return await res.json();
}

async function sauvegarderIndexMoisOneDrive(index) {
  await assurerDossier(SOUS_DOSSIER_HISTORIQUE);
  const res = await appelGraph(`/me/drive/root:/${cheminIndex()}:/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(index, null, 2)
  });
  if (!res.ok) throw new Error(`Écriture index mois : ${await detailErreur(res)}`);
}

async function chargerMoisOneDrive(mois) {
  const res = await appelGraph(`/me/drive/root:/${cheminMois(mois)}:/content`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Lecture mois ${mois} : ${await detailErreur(res)}`);
  return await res.json();
}

async function sauvegarderMoisOneDrive(mois, data) {
  await assurerDossier(SOUS_DOSSIER_HISTORIQUE);
  const res = await appelGraph(`/me/drive/root:/${cheminMois(mois)}:/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data, null, 2)
  });
  if (!res.ok) throw new Error(`Écriture mois ${mois} : ${await detailErreur(res)}`);

  const index = await chargerIndexMoisOneDrive();
  if (!index.mois.includes(mois)) {
    index.mois.push(mois);
    index.mois.sort();
    await sauvegarderIndexMoisOneDrive(index);
  }
  return true;
}
