// Gestion Loyers — stockage des données dans OneDrive
// Un fichier PAR MOIS dans un sous-dossier dédié "GESTION-LOYERS/historique",
// à l'intérieur du dossier PARTAGÉ "Immobilier 2025-2026" (le même que VéroS).
//
// IMPORTANT (méthode reprise de VéroS après un vrai bug en conditions réelles) :
// pour Gérard, "Immobilier 2025-2026" est un vrai dossier — un accès par CHEMIN
// TEXTE (/me/drive/root:/Immobilier 2025-2026/...) fonctionne. Mais pour toute
// autre personne (Véronique, Carine...), ce même dossier n'est visible que comme
// un RACCOURCI vers le drive de Gérard — Microsoft appelle ça un "remoteItem".
// Un accès par chemin texte échoue sur un raccourci (confirmé : erreur 422
// "Children cannot be listed from an item that is not a folder"). La seule
// méthode fiable pour tout le monde est de naviguer par IDENTIFIANT, jamais
// par texte — exactement ce que fait VéroS.

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
  const url = `${GRAPH_BASE}${chemin}`;
  const params = {
    ...options,
    headers: {
      ...(options.headers || {}),
      "Authorization": `Bearer ${token}`
    }
  };
  // SÉCURITÉ (21/08) : preuve directe (onglet Network chez Véronique) qu'une
  // requête peut rester bloquée indéfiniment ("pending"), sans jamais échouer
  // ni réussir d'elle-même. Une vraie limite de temps force l'abandon d'une
  // requête figée, puis on réessaie automatiquement — plutôt que d'attendre
  // sans fin ou d'abandonner au premier aléa passager.
  const NB_ESSAIS_MAX = 3;
  const DELAI_ENTRE_ESSAIS_MS = 700;
  const LIMITE_TEMPS_MS = 15000;
  let derniereErreur;
  for (let essai = 1; essai <= NB_ESSAIS_MAX; essai++) {
    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), LIMITE_TEMPS_MS);
    try {
      const res = await fetch(url, { ...params, signal: controleur.signal });
      clearTimeout(minuteur);
      return res;
    } catch (e) {
      clearTimeout(minuteur);
      derniereErreur = e;
      if (essai < NB_ESSAIS_MAX) {
        await new Promise(r => setTimeout(r, DELAI_ENTRE_ESSAIS_MS * essai));
      }
    }
  }
  throw derniereErreur;
}

async function detailErreur(res) {
  try {
    const texte = await res.text();
    return `${res.status} ${res.statusText} — ${texte.slice(0, 300)}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

// --- Navigation PAR IDENTIFIANT (méthode VéroS) ---

// coordonnées réelles d'un élément : son espace de stockage (driveId) et son
// identifiant — gère aussi bien un vrai dossier qu'un raccourci (remoteItem)
function refDe(item, driveParent) {
  if (item.remoteItem) {
    return {
      driveId: (item.remoteItem.parentReference && item.remoteItem.parentReference.driveId) || driveParent || null,
      id: item.remoteItem.id,
    };
  }
  return { driveId: driveParent || null, id: item.id };
}

async function enfantsDeRef(ref) {
  const champs = 'id,name,folder,file,remoteItem,webUrl';
  let url;
  if (!ref || !ref.id) {
    url = `/me/drive/root/children?$top=200&$select=${champs}`;
  } else if (ref.driveId) {
    url = `/drives/${ref.driveId}/items/${ref.id}/children?$top=200&$select=${champs}`;
  } else {
    url = `/me/drive/items/${ref.id}/children?$top=200&$select=${champs}`;
  }
  const tousLesElements = [];
  while (url) {
    const res = await appelGraph(url);
    if (!res.ok) {
      if (res.status === 404) return tousLesElements;
      throw new Error(`Listage : ${await detailErreur(res)}`);
    }
    const data = await res.json();
    tousLesElements.push(...(data.value || []));
    url = data['@odata.nextLink'] ? data['@odata.nextLink'].replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, '') : null;
  }
  return tousLesElements;
}

let _refRacineImmobilierCache = null;
async function obtenirRefRacineImmobilier() {
  if (_refRacineImmobilierCache) return _refRacineImmobilierCache;
  const enfants = await enfantsDeRef(null); // racine "Mes fichiers"
  const trouve = enfants.find(e => (e.name || '').trim() === DOSSIER_RACINE_PARTAGE);
  if (!trouve) throw new Error(`Dossier "${DOSSIER_RACINE_PARTAGE}" introuvable dans "Mes fichiers" — vérifier qu'il est bien ajouté en raccourci`);
  _refRacineImmobilierCache = refDe(trouve, null);
  return _refRacineImmobilierCache;
}

// résout un chemin RELATIF à "Immobilier 2025-2026" (ex. "GESTION-LOYERS/historique")
// en descendant segment par segment PAR IDENTIFIANT ; crée les segments manquants
// si creerSiAbsent est vrai
async function resoudreRefParChemin(cheminRelatif, creerSiAbsent) {
  let ref = await obtenirRefRacineImmobilier();
  if (!cheminRelatif) return ref;
  const segments = cheminRelatif.split('/').filter(Boolean);
  for (const segment of segments) {
    const enfants = await enfantsDeRef(ref);
    let trouve = enfants.find(e => (e.name || '').trim() === segment);
    if (!trouve) {
      if (!creerSiAbsent) return null;
      const urlCreation = ref.driveId
        ? `/drives/${ref.driveId}/items/${ref.id}/children`
        : `/me/drive/items/${ref.id}/children`;
      const creation = await appelGraph(urlCreation, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: segment, folder: {}, '@microsoft.graph.conflictBehavior': 'rename' })
      });
      if (creation.ok) {
        trouve = await creation.json();
      } else if (creation.status === 409) {
        // le dossier existe déjà (créé entre-temps par un autre utilisateur/session) — pas une erreur
        const enfants2 = await enfantsDeRef(ref);
        trouve = enfants2.find(e => (e.name || '').trim() === segment);
      } else {
        throw new Error(`Création dossier "${segment}" : ${await detailErreur(creation)}`);
      }
    }
    ref = refDe(trouve, ref.driveId);
  }
  return ref;
}

// lit le contenu d'un fichier désigné par son NOM, à l'intérieur d'un dossier déjà résolu par identifiant
async function lireFichierDansDossier(refDossier, nomFichier) {
  const url = refDossier.driveId
    ? `/drives/${refDossier.driveId}/items/${refDossier.id}:/${encodeURIComponent(nomFichier)}:/content`
    : `/me/drive/items/${refDossier.id}:/${encodeURIComponent(nomFichier)}:/content`;
  return await appelGraph(url);
}

// écrit (crée ou remplace) un fichier désigné par son NOM, à l'intérieur d'un dossier déjà résolu
async function ecrireFichierDansDossier(refDossier, nomFichier, corpsTexte, options = {}) {
  const url = refDossier.driveId
    ? `/drives/${refDossier.driveId}/items/${refDossier.id}:/${encodeURIComponent(nomFichier)}:/content`
    : `/me/drive/items/${refDossier.id}:/${encodeURIComponent(nomFichier)}:/content`;
  const { headers: enTetesSupplementaires, ...autresOptions } = options;
  return await appelGraph(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(enTetesSupplementaires || {}) },
    body: corpsTexte,
    ...autresOptions
  });
}

async function assurerDossier(cheminRelatif) {
  await resoudreRefParChemin(cheminRelatif, true);
}

async function chargerIndexMoisOneDrive() {
  const refDossier = await resoudreRefParChemin(SOUS_DOSSIER_HISTORIQUE, false);
  if (!refDossier) return { mois: [] };
  const res = await lireFichierDansDossier(refDossier, NOM_FICHIER_INDEX);
  if (res.status === 404) return { mois: [] };
  if (!res.ok) throw new Error(`Lecture index mois : ${await detailErreur(res)}`);
  return await res.json();
}

async function sauvegarderIndexMoisOneDrive(index) {
  const refDossier = await resoudreRefParChemin(SOUS_DOSSIER_HISTORIQUE, true);
  const res = await ecrireFichierDansDossier(refDossier, NOM_FICHIER_INDEX, JSON.stringify(index, null, 2));
  if (!res.ok) throw new Error(`Écriture index mois : ${await detailErreur(res)}`);
}

async function chargerMoisOneDrive(mois) {
  const refDossier = await resoudreRefParChemin(SOUS_DOSSIER_HISTORIQUE, false);
  if (!refDossier) return null;
  const res = await lireFichierDansDossier(refDossier, `${mois}.json`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Lecture mois ${mois} : ${await detailErreur(res)}`);
  return await res.json();
}

async function sauvegarderMoisOneDrive(mois, data) {
  const refDossier = await resoudreRefParChemin(SOUS_DOSSIER_HISTORIQUE, true);
  // v84 (22/08) — RETRAIT de "keepalive: true", qui était posé ici et NULLE PART
  // ailleurs dans le dépôt, exactement sur la seule opération qui échouait.
  // Motif : l'option keepalive de fetch() n'a rien à voir avec l'en-tête HTTP
  // Connection: keep-alive. Elle sert à laisser survivre une requête à la
  // fermeture de la page, et la spécification Fetch lui impose un budget de
  // 64 Kio par document. Le fichier mensuel pèse ~37,7 Kio : deux écritures
  // totalisent 75,4 Kio et dépassent le budget, ce qui produit un
  // "TypeError: Failed to fetch" indiscernable d'une panne réseau.
  // La garantie perdue (finir l'envoi si l'app est fermée en pleine sauvegarde)
  // est déjà couverte par CLE_DERNIER_ENVOI + verifierEnvoiInterrompu() (app.js).
  const res = await ecrireFichierDansDossier(refDossier, `${mois}.json`, JSON.stringify(data, null, 2));
  if (!res.ok) throw new Error(`Écriture mois ${mois} : ${await detailErreur(res)}`);

  const index = await chargerIndexMoisOneDrive();
  if (!index.mois.includes(mois)) {
    index.mois.push(mois);
    index.mois.sort();
    await sauvegarderIndexMoisOneDrive(index);
  }
  return true;
}

// dépose un vrai fichier (PDF, image...) dans un sous-dossier nommé, à l'intérieur d'un dossier déjà résolu ;
// crée le sous-dossier s'il n'existe pas encore
async function televerserFichierDansSousDossier(refDossierParent, nomSousDossier, fichier) {
  let refSousDossier = null;
  const enfants = await enfantsDeRef(refDossierParent);
  let trouve = enfants.find(e => (e.name || '').trim() === nomSousDossier);
  if (!trouve) {
    const urlCreation = refDossierParent.driveId
      ? `/drives/${refDossierParent.driveId}/items/${refDossierParent.id}/children`
      : `/me/drive/items/${refDossierParent.id}/children`;
    const creation = await appelGraph(urlCreation, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nomSousDossier, folder: {}, '@microsoft.graph.conflictBehavior': 'rename' })
    });
    if (creation.ok) {
      trouve = await creation.json();
    } else if (creation.status === 409) {
      const enfants2 = await enfantsDeRef(refDossierParent);
      trouve = enfants2.find(e => (e.name || '').trim() === nomSousDossier);
    } else {
      throw new Error(`Création dossier "${nomSousDossier}" : ${await detailErreur(creation)}`);
    }
  }
  refSousDossier = refDe(trouve, refDossierParent.driveId);

  const nomFichier = fichier.name;
  const url = refSousDossier.driveId
    ? `/drives/${refSousDossier.driveId}/items/${refSousDossier.id}:/${encodeURIComponent(nomFichier)}:/content`
    : `/me/drive/items/${refSousDossier.id}:/${encodeURIComponent(nomFichier)}:/content`;
  const res = await appelGraph(url, {
    method: 'PUT',
    headers: { 'Content-Type': fichier.type || 'application/octet-stream' },
    body: fichier
  });
  if (!res.ok) throw new Error(`Dépôt du fichier "${nomFichier}" : ${await detailErreur(res)}`);
  return nomFichier;
}
