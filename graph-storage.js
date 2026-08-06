// Gestion Loyers — stockage des données dans OneDrive
// Écrit dans un sous-dossier dédié "GESTION-LOYERS", à l'intérieur du dossier
// PARTAGÉ "Immobilier 2025-2026" (le même que VéroS utilise) — jamais à la racine
// directe, pour éviter tout risque de suppression accidentelle du fichier.
//
// ATTENTION (même mise en garde que pour VéroS) : le nom du dossier partagé peut
// changer chaque année. S'il est renommé, changer DOSSIER_RACINE_PARTAGE ci-dessous.

const DOSSIER_RACINE_PARTAGE = "Immobilier 2025-2026";
const SOUS_DOSSIER = "GESTION-LOYERS";
const NOM_FICHIER_DONNEES = "gestion-loyers-data.json";
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

async function assurerSousDossier() {
  const cheminDossier = encoderChemin(`${DOSSIER_RACINE_PARTAGE}/${SOUS_DOSSIER}`);
  const verif = await appelGraph(`/me/drive/root:/${cheminDossier}`);
  if (verif.ok) return; // le sous-dossier existe déjà

  if (verif.status !== 404) {
    throw new Error(`Vérification du sous-dossier : ${await detailErreur(verif)}`);
  }

  // Le sous-dossier n'existe pas : on le crée dans le dossier racine partagé
  const cheminRacine = encoderChemin(DOSSIER_RACINE_PARTAGE);
  const creation = await appelGraph(`/me/drive/root:/${cheminRacine}:/children`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: SOUS_DOSSIER,
      folder: {},
      "@microsoft.graph.conflictBehavior": "rename"
    })
  });
  if (!creation.ok) {
    throw new Error(`Création du sous-dossier : ${await detailErreur(creation)}`);
  }
}

function cheminFichier() {
  return encoderChemin(`${DOSSIER_RACINE_PARTAGE}/${SOUS_DOSSIER}/${NOM_FICHIER_DONNEES}`);
}

async function chargerDonneesOneDrive() {
  const res = await appelGraph(`/me/drive/root:/${cheminFichier()}:/content`);
  if (res.status === 404) {
    return null; // pas encore de fichier — première utilisation
  }
  if (!res.ok) {
    throw new Error(`Lecture OneDrive : ${await detailErreur(res)}`);
  }
  return await res.json();
}

async function sauvegarderDonneesOneDrive(data) {
  await assurerSousDossier();
  const res = await appelGraph(`/me/drive/root:/${cheminFichier()}:/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data, null, 2)
  });
  if (!res.ok) {
    throw new Error(`Écriture OneDrive : ${await detailErreur(res)}`);
  }
  return true;
}
