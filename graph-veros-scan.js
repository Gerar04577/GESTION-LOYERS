// graph-veros-scan.js — v145 — 09/09/2026
// Gestion Loyers — scan des documents locataires dans OneDrive
// Détection par NOM de dossier/fichier (pas de lecture du contenu des PDF ici —
// l'OCR viendra dans une étape séparée pour les documents combinés).
// Scan indépendant de VéroS, redondant volontairement, ne touche jamais à VéroS.
//
// Navigation PAR IDENTIFIANT, jamais par chemin texte (voir graph-storage.js
// pour l'explication complète : un chemin texte échoue sur un dossier partagé
// vu en raccourci — c'est le cas pour toute personne autre que Gérard).

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

// cache des refs immeuble (driveId+id), pour ne pas relister la racine à chaque scan
const _cacheRefImmeuble = {};

async function obtenirRefImmeuble(immeubleId) {
  if (_cacheRefImmeuble[immeubleId]) return _cacheRefImmeuble[immeubleId];
  const nomOneDrive = DOSSIER_ONEDRIVE_PAR_IMMEUBLE[immeubleId];
  if (!nomOneDrive) throw new Error('Immeuble non mappé à OneDrive');
  const refRacine = await obtenirRefRacineImmobilier();
  const enfantsRacine = await enfantsDeRef(refRacine);
  const trouve = enfantsRacine.find(e => (e.name || '').trim() === nomOneDrive);
  if (!trouve) throw new Error(`Dossier immeuble "${nomOneDrive}" introuvable`);
  const ref = refDe(trouve, refRacine.driveId);
  _cacheRefImmeuble[immeubleId] = ref;
  return ref;
}

async function trouverRefUnite(enfantsImmeuble, refImmeuble, nomUnite, locataire) {
  const cibleTypeNum = extraireTypeEtNumero(nomUnite);
  if (!cibleTypeNum.type) return null;
  // "RDC" côté app est ambigu (peut être résidentiel ou commercial selon les cas comme PTG) :
  // on élargit aux deux types réels possibles et on laisse le locataire départager
  const typesAcceptes = cibleTypeNum.type === 'RDC' ? ['RDC', 'RDC_COMMERCIAL'] : [cibleTypeNum.type];
  const candidats = enfantsImmeuble.filter(enfant => {
    if (!enfant.folder && !enfant.remoteItem) return false;
    const t = extraireTypeEtNumero(enfant.name);
    return typesAcceptes.includes(t.type) && t.num === cibleTypeNum.num;
  });
  if (candidats.length <= 1) return candidats[0] ? { item: candidats[0], ref: refDe(candidats[0], refImmeuble.driveId) } : null;

  // plusieurs dossiers du même type (ex. RDC résidentiel ET RDC commercial) :
  // on départage via le nom du locataire déjà connu dans l'app
  if (locataire) {
    const motsLoc = normaliserNom(locataire).split(' ').filter(m => m.length >= 3);
    for (const candidat of candidats) {
      const refCandidat = refDe(candidat, refImmeuble.driveId);
      const sousDossiers = await enfantsDeRef(refCandidat);
      const correspond = sousDossiers.some(d => {
        const nomD = normaliserNom(d.name);
        return motsLoc.some(mot => nomD.includes(mot));
      });
      if (correspond) return { item: candidat, ref: refCandidat };
    }
  }
  return { item: candidats[0], ref: refDe(candidats[0], refImmeuble.driveId) }; // repli si aucun locataire ne correspond
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
  let refImmeuble;
  try {
    refImmeuble = await obtenirRefImmeuble(immeubleId);
  } catch (e) {
    return { erreur: e.message };
  }
  const enfantsImmeuble = await enfantsDeRef(refImmeuble);
  const nomOneDrive = DOSSIER_ONEDRIVE_PAR_IMMEUBLE[immeubleId];
  const nomUnite = extraireNomUnite(designation, nomOneDrive); // pour affichage lisible seulement
  const trouveUnite = await trouverRefUnite(enfantsImmeuble, refImmeuble, designation, locataire);
  if (!trouveUnite) return { erreur: `Dossier unité "${nomUnite}" introuvable dans OneDrive` };

  const enfantsUnite = await enfantsDeRef(trouveUnite.ref);
  const dossiersLocataires = enfantsUnite.filter(e => e.folder || e.remoteItem);
  if (!dossiersLocataires.length) return { erreur: 'Aucun dossier locataire trouvé' };

  // LES DOCUMENTS D'UN AUTRE LOCATAIRE NE SONT PAS LES SIENS.
  //
  // La correspondance se faisait sur N'IMPORTE QUEL mot d'au moins trois
  // lettres, et — bien pire — quand AUCUN dossier ne correspondait, le scan
  // repartait sur TOUS les dossiers du studio.
  //
  // Un locataire qui vient d'arriver n'a pas encore de dossier à son nom :
  // le scan lisait donc ceux de tous ses prédécesseurs, et leurs bails,
  // EDLE et EDLS devenaient les siens. C'est ainsi qu'un étudiant entré en
  // septembre affichait un état des lieux de SORTIE. Constaté par Gérard le
  // 09/09/2026, capture à l'appui.
  //
  // Trois degrés désormais, du plus sûr au moins sûr :
  //   1. tous les mots du nom se retrouvent dans le dossier — c'est lui ;
  //   2. à défaut, un seul mot suffit MAIS un seul dossier doit sortir : on
  //      l'accepte en le signalant incertain (Vincent/Valentin ISTASSE) ;
  //   3. rien, ou plusieurs candidats : on le DIT, on ne répond pas avec
  //      les dossiers des autres.
  let dossiersACheck = dossiersLocataires;
  let rapprochement = null;
  if (locataire) {
    const motsLoc = normaliserNom(locataire).split(' ').filter(m => m.length >= 3);
    const contient = (d, f) => f(motsLoc, normaliserNom(d.name));

    // UN NOM SANS MOT SIGNIFICATIF NE PERMET DE RIEN TRANCHER.
    //
    // Les mots de moins de trois lettres sont écartés. Un locataire dont le
    // nom n'en compte aucun d'assez long — « Li Wu » — donnait une liste
    // vide, et la liste vide déclarait le dossier introuvable alors qu'il
    // pouvait être là. On garde alors tout, en le signalant.
    if (!motsLoc.length) {
      rapprochement = { incertain: true, dossier: dossiersLocataires.map(d => d.name).join(', ') };
      dossiersACheck = dossiersLocataires;
      return await lireDocuments(dossiersACheck, trouveUnite, rapprochement);
    }

    const exacts = dossiersLocataires.filter(d =>
      contient(d, (mots, nom) => mots.every(mot => nom.includes(mot))));

    if (exacts.length === 1) {
      dossiersACheck = exacts;
    } else if (exacts.length > 1) {
      // PLUSIEURS DOSSIERS PORTENT LE MÊME NOM.
      //
      // Les lire tous les mêlerait — et l'état des lieux de SORTIE d'un
      // séjour précédent redeviendrait celui d'aujourd'hui, ce qu'on vient
      // justement de corriger. On prend le plus récemment créé, et on le
      // dit. Constaté le 09/09/2026.
      const parDate = exacts.slice().sort((a, b) => {
        const ca = a.createdDateTime || '', cb = b.createdDateTime || '';
        return ca < cb ? 1 : (ca > cb ? -1 : 0);
      });
      dossiersACheck = [parDate[0]];
      rapprochement = { incertain: true, dossier: `${parDate[0].name} (${
        exacts.length} dossiers de ce nom, le plus récent retenu)` };
    } else {
      const partiels = dossiersLocataires.filter(d =>
        contient(d, (mots, nom) => mots.some(mot => nom.includes(mot))));
      if (partiels.length === 1) {
        dossiersACheck = partiels;
        rapprochement = { incertain: true, dossier: partiels[0].name };
      } else if (partiels.length > 1) {
        return { erreur: `Plusieurs dossiers pourraient être ceux de ${locataire} : ` +
          partiels.map(d => d.name).join(', ') };
      } else {
        return { erreur: `Aucun dossier au nom de ${locataire} dans ${nomUnite}` };
      }
    }
  }

  return await lireDocuments(dossiersACheck, trouveUnite, rapprochement);
}

// Lit les fichiers des dossiers retenus et rend les types reconnus.
//
// ON GARDE LA TRACE DE CE QUI A JUSTIFIÉ CHAQUE COCHE.
//
// Deux fois de suite, une coche verte inattendue a coûté une soirée à
// chercher si le code était fautif ou si le fichier existait vraiment.
// L'écran peut désormais montrer le dossier lu et le nom des fichiers
// reconnus : la question se tranche d'un coup d'œil. Ajouté le 09/09/2026.
async function lireDocuments(dossiersACheck, trouveUnite, rapprochement) {
  const trouves = new Set();
  const preuves = {};
  const noter = (nomFichier, dossier) => {
    for (const type of detecterTypesDansNom(nomFichier)) {
      trouves.add(type);
      if (!preuves[type]) preuves[type] = [];
      if (preuves[type].length < 3) preuves[type].push(`${dossier} / ${nomFichier}`);
    }
  };
  for (const dossierLoc of dossiersACheck) {
    const refLoc = refDe(dossierLoc, trouveUnite.ref.driveId);
    const enfantsLoc = await enfantsDeRef(refLoc);
    for (const item of enfantsLoc) {
      // seuls les vrais FICHIERS comptent comme preuve — un dossier vide nommé "EDLS"
      // ne doit jamais suffire (il est créé à l'avance et reste vide tant que le locataire est en place)
      if (item.file) {
        noter(item.name, dossierLoc.name);
      }
      if (item.folder || item.remoteItem) {
        const refItem = refDe(item, refLoc.driveId);
        let sousItems = [];
        try { sousItems = await enfantsDeRef(refItem); } catch (e) { /* dossier illisible, ignoré */ }
        for (const sousItem of sousItems) {
          if (sousItem.file) {
            noter(sousItem.name, `${dossierLoc.name} / ${item.name}`);
          }
        }
      }
    }
  }

  const base = { trouves: [...trouves], preuves,
                 dossiersLus: dossiersACheck.map(d => d.name) };
  return rapprochement
    ? { ...base, incertain: true, dossier: rapprochement.dossier }
    : base;
}

// --- Ouverture directe dans OneDrive (immeuble ou recherche locataire/unité) ---
// Volontairement limité aux 7 immeubles réels — exclut toujours les dossiers utilitaires
// "VeroS" et "GESTION-LOYERS" à la racine, jamais listés ici.

async function obtenirWebUrlRef(ref) {
  const url = ref.driveId ? `/drives/${ref.driveId}/items/${ref.id}?$select=webUrl` : `/me/drive/items/${ref.id}?$select=webUrl`;
  const res = await appelGraph(url);
  if (!res.ok) throw new Error(`Lecture lien OneDrive : ${await detailErreur(res)}`);
  const data = await res.json();
  return data.webUrl;
}

async function obtenirLienImmeuble(immeubleId) {
  const refImmeuble = await obtenirRefImmeuble(immeubleId);
  return await obtenirWebUrlRef(refImmeuble);
}

// Recherche un texte (nom de locataire ou désignation d'unité) dans les 7 immeubles réels,
// renvoie les dossiers locataires correspondants avec leur lien OneDrive direct
async function rechercherDansOneDrive(texte) {
  const cible = normaliserNom(texte);
  if (!cible) return [];
  const resultats = [];
  for (const [immeubleId, nomOneDrive] of Object.entries(DOSSIER_ONEDRIVE_PAR_IMMEUBLE)) {
    let refImmeuble, enfantsImmeuble;
    try {
      refImmeuble = await obtenirRefImmeuble(immeubleId);
      enfantsImmeuble = await enfantsDeRef(refImmeuble);
    } catch (e) { continue; }
    for (const uniteDossier of enfantsImmeuble) {
      if (!uniteDossier.folder && !uniteDossier.remoteItem) continue;
      const refUnite = refDe(uniteDossier, refImmeuble.driveId);
      let enfantsUnite;
      try { enfantsUnite = await enfantsDeRef(refUnite); } catch (e) { continue; }
      for (const locDossier of enfantsUnite) {
        if (!locDossier.folder && !locDossier.remoteItem) continue;
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

// Résout le dossier OneDrive d'un locataire précis (utilisée par le dépôt de
// documents garantie/assurance dans app.js — manquait dans le dépôt, corrigé le 21/08).
async function obtenirRefLocataire(immeubleId, designation, locataire) {
  const refImmeuble = await obtenirRefImmeuble(immeubleId);
  const enfantsImmeuble = await enfantsDeRef(refImmeuble);
  const trouveUnite = await trouverRefUnite(enfantsImmeuble, refImmeuble, designation, locataire);
  if (!trouveUnite) throw new Error(`Dossier unité introuvable pour "${designation}"`);

  const enfantsUnite = await enfantsDeRef(trouveUnite.ref);
  const dossiersLocataires = enfantsUnite.filter(e => e.folder || e.remoteItem);
  if (!locataire) throw new Error('Nom du locataire manquant');
  const motsLoc = normaliserNom(locataire).split(' ').filter(m => m.length >= 3);
  const trouveLoc = dossiersLocataires.find(d => {
    const nomD = normaliserNom(d.name);
    return motsLoc.some(mot => nomD.includes(mot));
  });
  if (!trouveLoc) throw new Error(`Dossier locataire "${locataire}" introuvable`);
  return refDe(trouveLoc, trouveUnite.ref.driveId);
}
