// Gestion Loyers — scan des documents locataires dans OneDrive
// Détection par NOM de dossier/fichier (pas de lecture du contenu des PDF ici —
// l'OCR viendra dans une étape séparée pour les documents combinés).
// Scan indépendant de VéroS, redondant volontairement, ne touche jamais à VéroS.

const DOSSIER_RACINE_IMMEUBLES = "Immobilier 2025-2026";

// Correspondance entre l'identifiant interne de Gestion Loyers et le vrai nom du dossier OneDrive
const DOSSIER_ONEDRIVE_PAR_IMMEUBLE = {
  'nimy': 'Nimy',
  'petite-guirlande': 'PTG',
  'havre': 'Havré',
  'vannes': 'Vannes',
  'fermette': 'Pourcelet Fermette',
  'egmont': 'Egmont',
  'biche': 'Biche',
};

function normaliserNom(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

async function listerEnfants(cheminDossier) {
  const chemin = cheminDossier.split('/').map(encodeURIComponent).join('/');
  let url = `/me/drive/root:/${chemin}:/children?$select=name,folder,file,webUrl&$top=200`;
  const tousLesElements = [];
  while (url) {
    const res = await appelGraph(url);
    if (!res.ok) {
      if (res.status === 404) return tousLesElements;
      throw new Error(`Listage dossier "${cheminDossier}" : ${await detailErreur(res)}`);
    }
    const data = await res.json();
    tousLesElements.push(...(data.value || []));
    // suivre la pagination Graph (@odata.nextLink) pour ne pas rater d'éléments
    // dans les dossiers avec beaucoup de photos (200+)
    url = data['@odata.nextLink'] ? data['@odata.nextLink'].replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, '') : null;
  }
  return tousLesElements;
}

// Extrait la partie "unité" d'une désignation complète, ex. "STUDIO 3 NIMY" + immeuble "Nimy" -> "STUDIO 3"
// Correspondance par TYPE + NUMÉRO (studio 3, étage 1, RDC, garage, duplex, appart 3...)
// plutôt que par mots — les vrais noms OneDrive sont trop différents des désignations
// de Gestion Loyers pour une simple comparaison de texte (ex. "REZ-DE-CHAUSSÉE" vs "RDC").
function extraireTypeEtNumero(nom) {
  const n = normaliserNom(nom);
  if (/COMMERCIAL/.test(n)) return { type: 'RDC_COMMERCIAL', num: null };
  if (/\bRDC\b/.test(n) || /REZ[\s-]*DE[\s-]*CHAUSSEE/.test(n)) return { type: 'RDC', num: null };
  if (/GARAGE/.test(n)) return { type: 'GARAGE', num: null };
  if (/DUPLEX/.test(n)) return { type: 'DUPLEX', num: null };
  let m = n.match(/STUDIO\s*(\d+)/);
  if (m) return { type: 'STUDIO', num: parseInt(m[1], 10) };
  m = n.match(/(\d+)\s*(ER|EME|E)?\s*ETAGE/);
  if (m) return { type: 'ETAGE', num: parseInt(m[1], 10) };
  m = n.match(/APPART(?:EMENT)?\.?\s*(\d+)/);
  if (m) return { type: 'ETAGE', num: parseInt(m[1], 10) }; // APPART et ETAGE traités comme équivalents (même logement désigné différemment)
  if (/\bAPPARTEMENT\b/.test(n) || /\bAPPART\.?\b/.test(n)) return { type: 'APPART', num: null };
  return { type: null, num: null };
}

function extraireNomUnite(designation, nomImmeubleAffiche) {
  // conservé pour l'affichage (comparaison lisible), la vraie correspondance utilise extraireTypeEtNumero
  const norm = normaliserNom(designation);
  const motsImmeuble = normaliserNom(nomImmeubleAffiche).split(' ');
  return norm.split(' ').filter(mot => !motsImmeuble.includes(mot)).join(' ').trim();
}

async function trouverDossierUnite(dossierImmeubleEnfants, cheminImmeuble, nomUnite, locataire) {
  const cibleTypeNum = extraireTypeEtNumero(nomUnite);
  if (!cibleTypeNum.type) return null;
  // "RDC" côté app est ambigu (peut être résidentiel ou commercial selon les cas comme PTG) :
  // on élargit aux deux types réels possibles et on laisse le locataire départager
  const typesAcceptes = cibleTypeNum.type === 'RDC' ? ['RDC', 'RDC_COMMERCIAL'] : [cibleTypeNum.type];
  const candidats = dossierImmeubleEnfants.filter(enfant => {
    if (!enfant.folder) return false;
    const t = extraireTypeEtNumero(enfant.name);
    return typesAcceptes.includes(t.type) && t.num === cibleTypeNum.num;
  });
  if (candidats.length <= 1) return candidats[0] || null;

  // plusieurs dossiers du même type (ex. RDC résidentiel ET RDC commercial) :
  // on départage via le nom du locataire déjà connu dans l'app
  if (locataire) {
    const motsLoc = normaliserNom(locataire).split(' ').filter(m => m.length >= 3);
    for (const candidat of candidats) {
      const cheminCandidat = `${cheminImmeuble}/${candidat.name}`;
      const sousDossiers = await listerEnfants(cheminCandidat);
      const correspond = sousDossiers.some(d => {
        const nomD = normaliserNom(d.name);
        return motsLoc.some(mot => nomD.includes(mot));
      });
      if (correspond) return candidat;
    }
  }
  return candidats[0]; // repli si aucun locataire ne correspond
}

const TYPES_DOCUMENTS = {
  bail: ['BAIL'],
  edle: ['EDLE'],
  edls: ['EDLS'],
  avenant: ['AVENANT'],
  samadhi: ['SAMADHI', 'PRET MEUBLE', 'PRÊT MEUBLE'],
};

function detecterTypesDansNom(nomDossierOuFichier) {
  const nom = normaliserNom(nomDossierOuFichier);
  const trouves = new Set();
  for (const [type, motsClefs] of Object.entries(TYPES_DOCUMENTS)) {
    if (motsClefs.some(mc => nom.includes(normaliserNom(mc)))) trouves.add(type);
  }
  return trouves;
}

async function scannerUnite(immeubleId, designation, locataire) {
  const nomOneDrive = DOSSIER_ONEDRIVE_PAR_IMMEUBLE[immeubleId];
  if (!nomOneDrive) return { erreur: 'Immeuble non mappé à OneDrive' };

  const cheminImmeuble = `${DOSSIER_RACINE_IMMEUBLES}/${nomOneDrive}`;
  const enfantsImmeuble = await listerEnfants(cheminImmeuble);
  const nomUnite = extraireNomUnite(designation, nomOneDrive); // pour affichage lisible seulement
  const dossierUnite = await trouverDossierUnite(enfantsImmeuble, cheminImmeuble, designation, locataire);
  if (!dossierUnite) return { erreur: `Dossier unité "${nomUnite}" introuvable dans OneDrive` };

  const cheminUnite = `${cheminImmeuble}/${dossierUnite.name}`;
  const enfantsUnite = await listerEnfants(cheminUnite);
  const dossiersLocataires = enfantsUnite.filter(e => e.folder);
  if (!dossiersLocataires.length) return { erreur: 'Aucun dossier locataire trouvé' };

  // essai de correspondance par nom de locataire : n'importe quel mot significatif
  // (nom de famille le plus souvent) suffit, pas seulement le premier mot — un prénom
  // mal orthographié (Vincent/Valentin) ne doit pas empêcher la correspondance sur le nom (ISTASSE)
  let dossiersACheck = dossiersLocataires;
  if (locataire) {
    const motsLoc = normaliserNom(locataire).split(' ').filter(m => m.length >= 3);
    const correspondance = dossiersLocataires.filter(d => {
      const nomDossier = normaliserNom(d.name);
      return motsLoc.some(mot => nomDossier.includes(mot));
    });
    if (correspondance.length) dossiersACheck = correspondance;
  }

  const trouves = new Set();
  for (const dossierLoc of dossiersACheck) {
    const cheminLoc = `${cheminUnite}/${dossierLoc.name}`;
    const enfantsLoc = await listerEnfants(cheminLoc);
    for (const item of enfantsLoc) {
      // seuls les vrais FICHIERS comptent comme preuve — un dossier vide nommé "EDLS"
      // ne doit jamais suffire (il est créé à l'avance et reste vide tant que le locataire est en place)
      if (item.file) {
        for (const type of detecterTypesDansNom(item.name)) trouves.add(type);
      }
      if (item.folder) {
        const cheminItem = `${cheminLoc}/${item.name}`;
        let sousItems = [];
        try { sousItems = await listerEnfants(cheminItem); } catch (e) { /* dossier illisible, ignoré */ }
        for (const sousItem of sousItems) {
          if (sousItem.file) {
            for (const type of detecterTypesDansNom(sousItem.name)) trouves.add(type);
          }
        }
      }
    }
  }

  return { trouves: [...trouves] };
}

// --- Ouverture directe dans OneDrive (immeuble ou recherche locataire/unité) ---
// Volontairement limité aux 7 immeubles réels — exclut toujours les dossiers utilitaires
// "VeroS" et "GESTION-LOYERS" à la racine, jamais listés ici.

async function obtenirWebUrlDossier(cheminDossier) {
  const chemin = cheminDossier.split('/').map(encodeURIComponent).join('/');
  const res = await appelGraph(`/me/drive/root:/${chemin}?$select=webUrl`);
  if (!res.ok) throw new Error(`Lecture lien OneDrive "${cheminDossier}" : ${await detailErreur(res)}`);
  const data = await res.json();
  return data.webUrl;
}

async function obtenirLienImmeuble(immeubleId) {
  const nomOneDrive = DOSSIER_ONEDRIVE_PAR_IMMEUBLE[immeubleId];
  if (!nomOneDrive) throw new Error('Immeuble non mappé à OneDrive');
  return await obtenirWebUrlDossier(`${DOSSIER_RACINE_IMMEUBLES}/${nomOneDrive}`);
}

// Recherche un texte (nom de locataire ou désignation d'unité) dans les 7 immeubles réels,
// renvoie les dossiers locataires correspondants avec leur lien OneDrive direct
async function rechercherDansOneDrive(texte) {
  const cible = normaliserNom(texte);
  if (!cible) return [];
  const resultats = [];
  for (const [immeubleId, nomOneDrive] of Object.entries(DOSSIER_ONEDRIVE_PAR_IMMEUBLE)) {
    const cheminImmeuble = `${DOSSIER_RACINE_IMMEUBLES}/${nomOneDrive}`;
    let enfantsImmeuble;
    try { enfantsImmeuble = await listerEnfants(cheminImmeuble); } catch (e) { continue; }
    for (const uniteDossier of enfantsImmeuble) {
      if (!uniteDossier.folder) continue;
      const cheminUnite = `${cheminImmeuble}/${uniteDossier.name}`;
      let enfantsUnite;
      try { enfantsUnite = await listerEnfants(cheminUnite); } catch (e) { continue; }
      for (const locDossier of enfantsUnite) {
        if (!locDossier.folder) continue;
        const nomUniteNorm = normaliserNom(uniteDossier.name);
        const nomLocNorm = normaliserNom(locDossier.name);
        if (nomUniteNorm.includes(cible) || nomLocNorm.includes(cible)) {
          resultats.push({
            immeuble: nomOneDrive,
            unite: uniteDossier.name,
            locataire: locDossier.name,
            webUrl: locDossier.webUrl,
          });
        }
      }
    }
  }
  return resultats;
}

// --- Règles métier : qui doit avoir quoi ---

function avenantRequis(immeubleId, locataire, designation) {
  if (!['nimy', 'petite-guirlande', 'biche'].includes(immeubleId)) return false;
  if (locataire && normaliserNom(locataire).includes('DELIS')) return false; // accepte Delise et Delisse
  if (designation && /COMMERCIAL/i.test(designation)) return false; // RDC COMMERCIAL jamais d'avenant
  if (immeubleId === 'biche' && designation && /^APPARTEMENT/i.test(normaliserNom(designation).trim())) return false; // Appart. Biche (sans numéro) jamais d'avenant
  return true;
}

function samadhiRequis(immeubleId, designation) {
  if (designation && /^APPART(EMENT)?\b/i.test(normaliserNom(designation).trim()) && immeubleId === 'biche') return false; // Appart. Biche (sans numéro) jamais de Samadhi
  if (immeubleId === 'nimy' || immeubleId === 'biche') return true;
  if (immeubleId === 'petite-guirlande') {
    const m = designation.match(/STUDIO\s+(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      return n >= 5 && n <= 10;
    }
    return false;
  }
  return false;
}
