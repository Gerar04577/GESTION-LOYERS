// Gestion Loyers — stockage des données dans OneDrive
// Utilise le dossier réservé à l'application (special/approot), comme VéroS,
// jamais le dossier partagé des locataires (celui-là reste en lecture seule, étape 6).

const NOM_FICHIER_DONNEES = "gestion-loyers-data.json";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

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

async function chargerDonneesOneDrive() {
  const res = await appelGraph(`/me/drive/special/approot:/${NOM_FICHIER_DONNEES}:/content`);
  if (res.status === 404) {
    return null; // pas encore de fichier — première utilisation
  }
  if (!res.ok) {
    throw new Error(`Lecture OneDrive : ${await detailErreur(res)}`);
  }
  return await res.json();
}

async function sauvegarderDonneesOneDrive(data) {
  const res = await appelGraph(`/me/drive/special/approot:/${NOM_FICHIER_DONNEES}:/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data, null, 2)
  });
  if (!res.ok) {
    throw new Error(`Écriture OneDrive : ${await detailErreur(res)}`);
  }
  return true;
}
