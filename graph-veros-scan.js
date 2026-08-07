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
  const res = await appelGraph(`/me/drive/root:/${chemin}:/children?$select=name,folder,file`);
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`Listage dossier "${cheminDossier}" : ${await detailErreur(res)}`);
  }
  const data = await res.json();
  return data.value || [];
}

// Extrait la partie "unité" d'une désignation complète, ex. "STUDIO 3 NIMY" + immeuble "Nimy" -> "STUDIO 3"
function extraireNomUnite(designation, nomImmeubleAffiche) {
  const norm = normaliserNom(designation);
  const motsImmeuble = normaliserNom(nomImmeubleAffiche).split(' ');
  return norm.split(' ').filter(mot => !motsImmeuble.includes(mot)).join(' ').trim();
}

async function trouverDossierUnite(dossierImmeubleEnfants, cheminImmeuble, nomUnite) {
  const cible = normaliserNom(nomUnite);
  // correspondance : le nom du dossier OneDrive contient tous les mots significatifs du nom d'unité, ou l'inverse
  const motsCible = cible.split(' ').filter(m => m.length > 0);
  let meilleur = null;
  for (const enfant of dossierImmeubleEnfants) {
    if (!enfant.folder) continue;
    const nomDossier = normaliserNom(enfant.name);
    const contientTout = motsCible.every(m => nomDossier.includes(m));
    if (contientTout) { meilleur = enfant; break; }
  }
  return meilleur;
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
  const nomUnite = extraireNomUnite(designation, nomOneDrive);
  const dossierUnite = await trouverDossierUnite(enfantsImmeuble, cheminImmeuble, nomUnite);
  if (!dossierUnite) return { erreur: `Dossier unité "${nomUnite}" introuvable dans OneDrive` };

  const cheminUnite = `${cheminImmeuble}/${dossierUnite.name}`;
  const enfantsUnite = await listerEnfants(cheminUnite);
  const dossiersLocataires = enfantsUnite.filter(e => e.folder);
  if (!dossiersLocataires.length) return { erreur: 'Aucun dossier locataire trouvé' };

  // essai de correspondance par nom de locataire, sinon on prend tous les dossiers locataires
  let dossiersACheck = dossiersLocataires;
  if (locataire) {
    const nomLoc = normaliserNom(locataire).split(' ')[0]; // premier mot (nom ou prénom) suffit généralement
    const correspondance = dossiersLocataires.filter(d => normaliserNom(d.name).includes(nomLoc));
    if (correspondance.length) dossiersACheck = correspondance;
  }

  const trouves = new Set();
  for (const dossierLoc of dossiersACheck) {
    const cheminLoc = `${cheminUnite}/${dossierLoc.name}`;
    const enfantsLoc = await listerEnfants(cheminLoc);
    for (const item of enfantsLoc) {
      for (const type of detecterTypesDansNom(item.name)) trouves.add(type);
    }
  }

  return { trouves: [...trouves] };
}

// --- Règles métier : qui doit avoir quoi ---

function avenantRequis(immeubleId, locataire) {
  if (!['nimy', 'petite-guirlande', 'biche'].includes(immeubleId)) return false;
  if (locataire && normaliserNom(locataire).includes('DELISSE')) return false;
  return true;
}

function samadhiRequis(immeubleId, designation) {
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
