// Gestion Loyers — stockage des données dans OneDrive
// Écrit dans le dossier PARTAGÉ "Immobilier 2025-2026" (le même que VéroS utilise),
// pour que Gérard, Véronique et son fils voient tous les mêmes données,
// quel que soit le compte Microsoft avec lequel chacun se connecte.
//
// ATTENTION (même mise en garde que pour VéroS) : le nom de ce dossier peut changer
// chaque année. S'il est renommé, changer DOSSIER_PARTAGE ci-dessous.

const DOSSIER_PARTAGE = "Immobilier 2025-2026";
const NOM_FICHIER_DONNEES = "gestion-loyers-data.json";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

function cheminGraphEncode() {
  // encode chaque segment du chemin (espaces, accents...) sans toucher aux séparateurs
  const segments = `${DOSSIER_PARTAGE}/${NOM_FICHIER_DONNEES}`.split('/').map(encodeURIComponent);
  return segments.join('/');
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

async function chargerDonneesOneDrive() {
  const res = await appelGraph(`/me/drive/root:/${cheminGraphEncode()}:/content`);
  if (res.status === 404) {
    return null; // pas encore de fichier — première utilisation
  }
  if (!res.ok) {
    throw new Error(`Lecture OneDrive : ${await detailErreur(res)}`);
  }
  return await res.json();
}

async function sauvegarderDonneesOneDrive(data) {
  const res = await appelGraph(`/me/drive/root:/${cheminGraphEncode()}:/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data, null, 2)
  });
  if (!res.ok) {
    throw new Error(`Écriture OneDrive : ${await detailErreur(res)}`);
  }
  return true;
}
