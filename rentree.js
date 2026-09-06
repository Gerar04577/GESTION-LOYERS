// rentree.js — v130 — 06/09/2026
// Gestion Loyers — module RENTRÉE, entièrement séparé
//
// POURQUOI CE MODULE EXISTE
//
// Les studios sont loués à des étudiants. Dès février, on sait qui part en juin
// et par qui il sera remplacé en septembre — mais ces futurs locataires
// n'existent dans aucun mois de l'application, qui raisonne par mois
// calendaires. Pendant sept mois, cette information vivait dans un tableur
// tenu à part, avec le risque d'oubli que cela suppose.
//
// Ce module crée un mois PARTICULIER, « Rentrée AAAA », qui ne porte ni loyer
// ni charge : uniquement la préparation. Au fil des entrées réelles, chaque
// unité est versée dans le mois calendaire, une par une.
//
// ISOLÉ VOLONTAIREMENT, comme presence.js : ne touche à AUCUNE fonction ni
// variable de app.js. Il réutilise seulement ce qui est déjà global —
// appData, moisAffiche, estConnecte, chargerMoisOneDrive, sauvegarder... — et
// n'écrit jamais dans un mois calendaire sans passer par les mêmes fonctions
// que l'application elle-même.
//
// Si ce fichier est retiré de index.html, l'application retrouve exactement
// son comportement d'avant.

const CLE_RENTREE = 'gestionLoyersRentree:';       // + année, ex. gestionLoyersRentree:2027
const RENTREE_DOSSIER = 'GESTION-LOYERS/rentree';

/* L'ANNÉE DE RENTRÉE AVANCE AU 1er JANVIER.

   En septembre 2026 on prépare déjà la rentrée de 2027 : le travail commence
   en février et s'étale jusqu'à l'été. L'année affichée est donc l'année
   civile en cours si l'on est en janvier ou après — jamais l'année passée. */
function anneeRentree() {
  /* L'ANNÉE CHANGE AU 1er JANVIER.

     Le dossier « Rentrée 2027 » se remplit de février à l'été 2027 et se
     verse en août vers septembre 2027. Il reste donc le dossier courant
     jusqu'au 31 décembre 2027 ; au 1er janvier 2028, on ouvre le suivant.

     Une bascule en septembre avait d'abord été posée : elle aurait fait
     changer de dossier en pleine période de versement. */
  return new Date().getFullYear();
}

/* Les quatre contrôles à cocher. Les autres colonnes — poubelles, internet,
   assurance, garantie — existent déjà dans l'application et s'affichent en
   lecture : on ne les redemande pas. */
const CONTROLES_RENTREE = [
  { cle: 'bail',     libelle: 'bail',     partout: true  },
  { cle: 'avenant',  libelle: 'avenant',  partout: false },
  { cle: 'samadhi',  libelle: 'Samadhi',  partout: false },
  { cle: 'edle',     libelle: 'EDLE',     partout: true  },
];

/* AVENANT ET SAMADHI NE CONCERNENT QUE TROIS IMMEUBLES.

   Ce sont ceux où les charges font l'objet d'un décompte et où le mobilier
   Samadhi est prêté. Ailleurs, la colonne n'a pas d'objet : elle s'affiche
   en tiret, ce qui se distingue d'une case non cochée. */
const IMMEUBLES_AVENANT_SAMADHI = ['nimy', 'biche', 'ptg', 'petite-guirlande'];

function immeubleAvecAvenant(immeubleId) {
  const id = String(immeubleId || '').toLowerCase();
  return IMMEUBLES_AVENANT_SAMADHI.some(x => id.includes(x));
}

const STATUTS_RENTREE = [
  { cle: 'reste',     libelle: 'reste',      couleur: '#1D9E75' },
  { cle: 'depart',    libelle: 'départ',     couleur: '#C0392B' },
  { cle: 'attente',   libelle: 'en attente', couleur: '#C8891F' },
  { cle: 'inoccupe',  libelle: 'inoccupé',   couleur: '#8A8A8A' },
];

let donneesRentree = null;      // { annee, unites: { uniteId: {...} } }
let ouvertureRentree = false;   // vrai le temps du premier dessin d'un écran
let anneeRentreeAffichee = null;

/* ---- Lecture et écriture ------------------------------------------------

   Le mois de rentrée suit exactement le même chemin que les mois
   calendaires : OneDrive fait foi, le stockage local ne sert que de cache.
   C'est la règle posée après l'incident du 18/08. */

function rentreeVide(annee) {
  return { annee, unites: {}, modifiePar: null, modifieLe: null };
}

/* LES SIX MONTANTS DU NOUVEAU BAIL.

   Ils reprennent les colonnes du tableau tenu jusqu'ici sous Excel :
   paiement loyer, paiement charges, poubelles, wifi, assurances, garantie
   locative. Ce sont les montants du BAIL À VENIR, distincts de ceux du
   locataire sortant — quand une unité est remise en location, ils changent
   tous.

   Ils sont versés dans l'unité au moment de la fusion. */
/* SIX MONTANTS, ET CHACUN A SON PÉRIMÈTRE.

   LE POSTE DES CHARGES PORTE TROIS NOMS POUR UNE SEULE CHOSE : « paiement
   charges » dans le tableau tenu sous Excel, « provision de charges » dans
   la conversation, et le champ `charges` dans l'application. C'est ce
   dernier qu'il faut écrire :

     — calculerLoyerCC() additionne loyerBrut + charges + poubelles +
       internet, quatre termes et pas un de plus ;
     — le formulaire du mois affiche `charges` sous « Charges (€) » ;
     — 46 unités sur 50 le renseignent.

   LE CHAMP `provisionCharges` DES UNITÉS EST UN RÉSIDU : nulle part lu,
   nulle part écrit, à zéro partout. Un septième montant avait été créé en
   v90 pour l'alimenter, puis les charges y ont été redirigées en v93 : le
   loyer toutes charges comprises aurait été faux sur chaque unité versée.
   Ne pas s'en servir.

   Le drapeau `provisionCharges: true` au niveau de l'IMMEUBLE est autre
   chose : il commande l'affichage d'une ligne indicative, rien de plus.

   Les périmètres viennent de l'exploitant, non d'une lecture du tableau :
   les trois lectures que j'en avais faites étaient fausses. */
const MONTANTS_RENTREE = [
  { cle: 'loyer',     libelle: 'loyer',     champ: 'loyerBrut' },
  { cle: 'charges',   libelle: 'charges',   champ: 'charges' },
  /* POURCELET EST LE NOM D'USAGE DE LA FERMETTE : l'exploitant l'appelle
     ainsi, data.json l'enregistre sous « fermette ». Les deux figurent
     dans la liste pour que le nom parlé et le nom stocké se rejoignent. */
  { cle: 'poubelles', libelle: 'poubelles', champ: 'poubelles',
    immeubles: ['biche', 'nimy', 'ptg', 'petite-guirlande',
                'fermette', 'pourcelet'] },
  { cle: 'wifi',      libelle: 'wifi',      champ: 'internet',
    immeubles: ['biche', 'nimy', 'ptg', 'petite-guirlande'] },
  { cle: 'assurance', libelle: 'assurance', champ: 'montantAssurance',
    saufImmeubles: ['vannes'] },
  { cle: 'garantie',  libelle: 'garantie',  champ: 'garantieMontant' },
];

/* LES SIX CHAMPS DE TEXTE LIBRE d'une unité, tels que le formulaire du mois
   les présente :

     preuveGarantie                Commentaire garantie
     docAssurance                  Doc. assurance (référence/note)
     commentaireAssurance          Commentaire assurance
     domiciliationOrdrePermanent   Ordre permanent (référence/note)
     commentaires                  Commentaires
     notesInternes                 Notes internes                        */
const CHAMPS_TEXTE_UNITE = [
  'preuveGarantie', 'docAssurance', 'commentaireAssurance',
  'domiciliationOrdrePermanent', 'commentaires', 'notesInternes',
];

/* L'ADRESSE ÉLECTRONIQUE SUIT LA PERSONNE, PAS L'UNITÉ.

   Elle avait d'abord été rangée avec les six textes ci-dessus, qui restent
   attachés au studio. C'était une erreur de la même famille que celle de la
   garantie : un locataire qui déménage dans le parc perdait son adresse si
   on ne la ressaisissait pas.

     nouveau locataire   → l'adresse du sortant s'efface, celle de la
                           rentrée la remplace ;
     déménagement        → l'adresse suit la personne, comme sa garantie ;
     locataire qui reste → rien ne bouge.                              */

function immeubleEst(immeubleId, liste) {
  const id = String(immeubleId || '').toLowerCase();
  return liste.some(x => id.includes(x));
}

/* P3 — LE DÉBUT DU BAIL EST UNE DATE À PART.

   La v90 le déduisait de la date du dernier acompte. Or les acomptes sont
   versés au printemps et en été, tandis que les baux de rentrée commencent
   au 1er septembre : chaque nouvel acompte repoussait la date, et la fin de
   bail avec elle.

   C'est une information distincte, qui se saisit. Le 1er septembre de
   l'année de rentrée est proposé par défaut. */
function debutBailPropose(annee) {
  return `${annee}-09-01`;
}

/* LE GARAGE N'A QU'UN LOYER : c'est un emplacement, pas un logement. */
function estGarage(designation) {
  return /\bgarage\b/i.test(String(designation || '').trim());
}

/* Les montants à demander pour une unité donnée.

     loyer      tous, garage compris
     charges    tous sauf le garage        (la provision de charges)
     poubelles  Biche, Nimy, Pourcelet, Petite Guirlande
     wifi       Biche, Nimy, Petite Guirlande
     assurance  tous sauf Vannes
     garantie   tous sauf le garage                                  */
function montantsApplicables(immeubleId, designation) {
  if (estGarage(designation)) {
    return MONTANTS_RENTREE.filter(m => m.cle === 'loyer');
  }
  return MONTANTS_RENTREE.filter(m => {
    if (m.immeubles && !immeubleEst(immeubleId, m.immeubles)) return false;
    if (m.saufImmeubles && immeubleEst(immeubleId, m.saufImmeubles)) return false;
    return true;
  });
}

function ligneRentreeVide() {
  return {
    statut: 'reste',
    locataireSuivant: '',
    /* PLUSIEURS ACOMPTES, autant qu'il en vient : un locataire verse
       parfois en deux ou trois fois. Chacun porte son montant et sa date ;
       c'est le TOTAL qui devient la garantie encaissée. */
    acomptes: [],
    acompte: null,        /* ancien champ, conservé pour relire la v89 */
    dateAcompte: null,
    debutBail: null,      /* saisi, distinct des dates d'acompte */
    email: '',            /* adresse du futur locataire */
    /* DEUX ADRESSES PAR UNITÉ, PAS UNE.

       Un étudiant change de boîte, ne la relève pas, ou la ferme en fin
       d'année. Le garant — le plus souvent un parent — est l'adresse qui
       tient. Les décomptes partent aux deux. Ajouté le 06/09/2026. */
    emailGarant: '',      /* adresse du garant, facultative */
    /* Ce qu'on a répondu quand le nom figurait déjà ailleurs :
       'demenagement', 'homonyme', ou absent tant qu'on n'a pas tranché. */
    montants: { loyer: null, charges: null, poubelles: null,
                wifi: null, assurance: null, garantie: null },
    controles: { bail: false, avenant: false, samadhi: false, edle: false },
    verseeLe: null,
    verseeVers: null,
    versePar: null,
  };
}

/* SILENCIEUSE : cette fonction est aussi appelée en arrière-plan, pour
   rafraîchir le libellé du bouton. */
async function chargerRentree(annee) {
  if (typeof estConnecte !== 'function' || !estConnecte()) return null;
  try {
    const ref = await resoudreRefParChemin(RENTREE_DOSSIER, false);
    if (!ref) return rentreeVide(annee);
    const res = await lireFichierDansDossier(ref, `rentree-${annee}.json`);
    if (res && res.ok) {
      const contenu = await res.json();
      if (contenu && contenu.unites) return normaliserRentree(contenu);
    }
  } catch (e) {
    /* Premier usage de l'année : le fichier n'existe pas encore. */
  }
  return rentreeVide(annee);
}

/* VERROU ET RÉFÉRENCE EN RÉSERVE : deux clics rapides lançaient deux
   écritures concurrentes, dont la dernière écrasait la première. */
let ecritureRentreeEnCours = false;
let ecritureRentreeAttendue = false;
let refDossierRentree = null;

async function enregistrerRentree() {
  if (!donneesRentree) return;
  if (ecritureRentreeEnCours) { ecritureRentreeAttendue = true; return; }
  ecritureRentreeEnCours = true;
  try {
    donneesRentree.modifiePar = (typeof obtenirMonPrenom === 'function')
      ? obtenirMonPrenom() : '';
    donneesRentree.modifieLe = new Date().toISOString();
    if (!refDossierRentree) {
      refDossierRentree = await resoudreRefParChemin(RENTREE_DOSSIER, true);
    }
    await ecrireFichierDansDossier(refDossierRentree,
      `rentree-${donneesRentree.annee}.json`,
      JSON.stringify(donneesRentree, null, 2));
    localStorage.setItem(CLE_RENTREE + donneesRentree.annee,
      JSON.stringify(donneesRentree));
  } finally {
    ecritureRentreeEnCours = false;
    /* LA REPRISE EST ICI, PAS APRÈS : placée après le bloc, elle était
       sautée quand l'écriture levait une erreur. */
    if (ecritureRentreeAttendue) {
      ecritureRentreeAttendue = false;
      enregistrerRentree().catch(() => {});
    }
  }
}

/* Toutes les unités du parc, avec leur immeuble. */
function toutesUnitesRentree() {
  const liste = [];
  if (typeof appData === 'undefined' || !appData) return liste;
  (appData && appData.immeubles || []).forEach(im => {
    (im.unites || []).forEach(u => {
      liste.push({ immeubleId: im.id, immeubleNom: im.nom, unite: u });
    });
  });
  return liste;
}

function ligneRentree(uniteId) {
  if (!donneesRentree) donneesRentree = rentreeVide(anneeRentree());
  if (!donneesRentree.unites[uniteId]) {
    donneesRentree.unites[uniteId] = ligneRentreeVide();
  }
  /* Seul point de passage garanti : on normalise ici aussi. */
  return normaliserLigne(donneesRentree.unites[uniteId]);
}

/* NORMALISER UNE LIGNE — acomptes, montants, contrôles et statut garantis
   présents. La normalisation se fait AU CHARGEMENT, une fois pour toutes :
   plusieurs fonctions lisent les lignes sans passer par ligneRentree. */
function normaliserLigne(l) {
  if (!l || typeof l !== 'object') l = ligneRentreeVide();
  if (!Array.isArray(l.acomptes)) l.acomptes = [];
  if (l.debutBail === undefined) l.debutBail = null;
  if (typeof l.email !== 'string') l.email = '';
  if (typeof l.emailGarant !== 'string') l.emailGarant = '';
  /* Reprise des fichiers antérieurs aux acomptes multiples. */
  if (l.acompte != null && !l.acomptes.length) {
    l.acomptes.push({ montant: l.acompte, date: l.dateAcompte || null });
  }
  if (!l.montants || typeof l.montants !== 'object') l.montants = {};
  MONTANTS_RENTREE.forEach(m => {
    if (l.montants[m.cle] === undefined) l.montants[m.cle] = null;
  });
  if (l.garantie != null && l.montants.garantie == null) {
    l.montants.garantie = l.garantie;
  }
  if (!l.controles || typeof l.controles !== 'object') l.controles = {};
  CONTROLES_RENTREE.forEach(c => {
    if (typeof l.controles[c.cle] !== 'boolean') l.controles[c.cle] = false;
  });
  if (!STATUTS_RENTREE.some(x => x.cle === l.statut)) l.statut = 'reste';
  return l;
}

function normaliserRentree(d) {
  if (!d || typeof d !== 'object') return d;
  if (!d.unites || typeof d.unites !== 'object') d.unites = {};
  Object.keys(d.unites).forEach(k => {
    d.unites[k] = normaliserLigne(d.unites[k]);
  });
  return d;
}

/* L'immeuble d'une unité, pour savoir quels montants s'appliquent. */
function immeubleIdDe(uniteId) {
  const t = toutesUnitesRentree().find(x => x.unite.id === uniteId);
  return t ? t.immeubleId : '';
}

/* Le versement à venir sera-t-il le premier ? Sert au texte de la
   confirmation, avant que l'instantané ne soit posé. */
function premierVersementPrevu(l) {
  return !l.instantane;
}

/* Q5 — ON NE REGARDE QUE LES MONTANTS APPLICABLES À L'IMMEUBLE.

   La provision n'est ni affichée ni saisissable hors des trois immeubles à
   décompte : la compter là-bas n'aurait d'effet que sur un fichier modifié
   à la main, mais autant que les deux fonctions disent la même chose. */
function aDesMontants(l, immeubleId, designation) {
  if (l.debutBail) return true;
  return montantsApplicables(immeubleId, designation)
    .some(m => l.montants[m.cle] != null);
}

/* UNE ADRESSE ÉLECTRONIQUE PLAUSIBLE.

   On ne cherche pas à valider selon la norme — elle autorise des formes que
   personne n'emploie. On refuse ce qui est manifestement faux : pas
   d'arobase, pas de point après lui, un espace, deux arobases.

   Une adresse malformée enregistrée serait recopiée dans l'unité à la
   fusion, puis dans un envoi qui échouerait sans qu'on sache pourquoi. */
/* AU MOINS UNE ADRESSE, PEU IMPORTE LAQUELLE.

   Le garant est facultatif : c'est le COUPLE qui compte. Une unité sans
   aucune des deux est signalée dans « Ce qui manque », mais ne bloque pas
   le versement — décision du 06/09/2026. Une adresse MALFORMÉE, elle,
   bloque toujours : elle partirait dans un envoi qui échouerait sans
   qu'on sache pourquoi. */
function aUneAdresse(l) {
  return !!(String(l.email || '').trim() || String(l.emailGarant || '').trim());
}

function adressesPlausibles(l) {
  return emailPlausible(l.email) && emailPlausible(l.emailGarant);
}

function emailPlausible(v) {
  const t = String(v || '').trim();
  if (!t) return true;                       /* vide est permis à la saisie */
  if (/\s/.test(t)) return false;
  const parts = t.split('@');
  if (parts.length !== 2) return false;
  if (!parts[0].length) return false;
  const dom = parts[1];
  return dom.includes('.') && !dom.startsWith('.') && !dom.endsWith('.')
      && dom.split('.').every(x => x.length > 0);
}

/* Le total versé en acomptes. C'est lui qui devient la garantie encaissée :
   verser plusieurs fois ne compte jamais deux fois, puisqu'on recalcule à
   partir du total au lieu d'ajouter. */
function totalAcomptes(l) {
  return (l.acomptes || []).reduce((t, a) =>
    t + (a && a.montant != null ? Number(a.montant) : 0), 0);
}

/* L'unité a-t-elle une garantie ? C'est ce qui décide où va l'acompte. */
function avecGarantieIci(immeubleId, designation) {
  return montantsApplicables(immeubleId, designation).some(m => m.cle === 'garantie');
}

/* PAS D'ACOMPTE TANT QUE LA LIGNE N'EST PAS COMPLÈTE.

   Règle unique, arrêtée le 06/09/2026, valable pour tout le monde —
   déménageur comme nouveau locataire.

   Elle remplace trois traitements particuliers qui divergeaient :

     — un acompte pouvait être saisi AVANT le nom du remplaçant. Saisi là,
       puis le nom déclaré déménagement, il était déduit sur le document de
       remise des clés mais jamais porté dans l'unité. Le locataire lisait
       « vos 200 € sont déduits » et l'application ne les connaissait pas ;
     — le bloc était purement et simplement MASQUÉ pour un déménageur, alors
       qu'un rattrapage de garantie existe réellement quand le loyer du
       nouveau studio diffère ;
     — un acompte saisi sur une unité sans garantie n'était porté nulle
       part, et on ne l'apprenait qu'au moment de verser.

   Un acompte se calcule sur les chiffres du nouveau bail. Tant qu'ils ne
   sont pas là, il n'y a rien sur quoi le calculer. */
/* UN MONTANT VALABLE : un nombre fini, positif ou nul.

   Le contrôle testait `== null`. Or un champ mal saisi — « cinquante », un
   caractère resté d'un copier-coller — donne NaN, qui n'est pas null : la
   ligne passait pour complète, le bloc acompte s'ouvrait, et le document
   affichait 0,00 € pour ce poste au lieu de refuser. Un montant faux et
   silencieux dans une pièce remise au locataire. Constaté le 06/09/2026. */
function montantValable(v) {
  return v != null && Number.isFinite(Number(v)) && Number(v) >= 0;
}

function manquePourAcompte(immeubleId, unite, l) {
  const m = [];
  if (!l.locataireSuivant) m.push('le nom du remplaçant');
  if (!l.debutBail) m.push('le début du bail');
  montantsApplicables(immeubleId, unite.designation).forEach(x => {
    if (!montantValable(l.montants[x.cle])) m.push(x.libelle);
  });
  return m;
}

/* UN ACOMPTE NÉGATIF N'EXISTE PAS.

   Il était accepté tel quel : le document annonçait « Acompte versé
   − -100,00 € » et un reste à payer SUPÉRIEUR au total, et la fusion
   inscrivait une garantie encaissée négative. Constaté le 06/09/2026. */
function acompteNegatif(l) {
  return (l.acomptes || []).some(a => a && a.montant != null &&
    (!Number.isFinite(Number(a.montant)) || Number(a.montant) < 0));
}

/* LE GARAGE NE REÇOIT JAMAIS PLUS D'UN MOIS D'AVANCE.

   Il n'a pas de garantie : son acompte est une avance sur le loyer, et un
   emplacement ne se paie pas plusieurs mois d'avance. Au-delà du loyer, le
   montant est refusé — le champ passe en rouge et le versement est bloqué,
   comme une adresse malformée. */
function acompteTropGrand(immeubleId, unite, l) {
  if (avecGarantieIci(immeubleId, unite.designation)) return false;
  const loyer = l.montants.loyer;
  if (loyer == null) return false;
  return totalAcomptes(l) > Number(loyer);
}

/* ---- Ce qui manque ------------------------------------------------------

   Savoir d'un coup d'œil ce qui reste à faire avant la rentrée, locataire
   par locataire. Une unité qui reste, ou laissée volontairement inoccupée,
   n'a rien à préparer : on ne la compte pas. */
function manquesRentree() {
  const resultat = [];
  if (!donneesRentree) return resultat;
  toutesUnitesRentree().forEach(({ immeubleId, immeubleNom, unite }) => {
    const l = donneesRentree.unites[unite.id];
    if (!l) return;
    if (l.statut === 'reste' || l.statut === 'inoccupe') return;

    /* UNE UNITÉ VERSÉE N'EST PAS UNE UNITÉ TERMINÉE.

       Elle sortait de la liste dès le versement. Or on verse dès que le
       remplaçant et les montants sont connus — le bail signé, l'avenant et
       l'EDLE arrivent souvent après. La liste annonçait « rien ne manque »
       alors que les documents n'étaient pas rentrés, et c'est précisément
       ce que ce bouton doit empêcher.

       Ce qui n'a plus lieu d'être réclamé après un versement, ce sont les
       éléments que le versement a posés : le remplaçant, les montants, la
       date de bail, l'acompte. Les quatre CONTRÔLES, eux, restent dus. */
    const versee = !!l.verseeLe;

    const manquants = [];
    if (!versee && (l.statut === 'attente' || !l.locataireSuivant)) {
      manquants.push('remplaçant');
    }
    /* Un doublon non tranché empêche le versement : il manque autant qu'un
       document. */
    if (doublonEnAttente(l)) manquants.push('nom en double à trancher');
    CONTROLES_RENTREE.forEach(c => {
      if (!c.partout && !immeubleAvecAvenant(immeubleId)) return;
      if (!l.controles[c.cle]) manquants.push(c.libelle);
    });
    /* L'acompte n'est pas dû par un locataire qui déménage dans le parc :
       il a déjà versé sa garantie ailleurs. */
    /* Pas de garantie, pas d'acompte à réclamer. */
    const avecGarantie = montantsApplicables(immeubleId, unite.designation)
      .some(m => m.cle === 'garantie');
    if (!versee && avecGarantie && l.statut === 'depart' && !totalAcomptes(l) &&
        !estUnDemenagement(l, unite.id)) {
      manquants.push('acompte');
    }
    if (!versee && !l.debutBail) manquants.push('début du bail');
    /* Sans adresse, aucun envoi n'est possible — ni le document de remise
       des clés, ni le décompte de charges. */
    if (!aUneAdresse(l) || !adressesPlausibles(l)) manquants.push('courriel');
    if (!versee) {
      /* MÊME MESURE QUE LA PORTE DE L'ACOMPTE.

         Cette liste testait `== null`, alors que manquePourAcompte exige un
         nombre fini et positif depuis la v118. Les deux pouvaient donc se
         contredire sur une valeur héritée d'un fichier ancien : « Ce qui
         manque » disait que tout était là, et le bloc acompte restait
         fermé sans qu'on comprenne pourquoi. */
      montantsApplicables(immeubleId, unite.designation).forEach(m => {
        if (!montantValable(l.montants[m.cle])) manquants.push(m.libelle);
      });
    }

    if (manquants.length) {
      resultat.push({ immeubleNom, unite, ligne: l, manquants,
                      inoccupe: false, versee });
    }
  });
  /* Du plus incomplet au plus complet. */
  resultat.sort((a, b) => b.manquants.length - a.manquants.length);
  return resultat;
}

/* UN LOCATAIRE QUI FIGURE DÉJÀ AILLEURS DANS LE PARC DÉMÉNAGE : il ne paie
   pas d'acompte, sa garantie le suit.

   AILLEURS, précisément — pas dans l'unité qu'on est en train de verser.
   Après un premier versement, le nouveau locataire y est installé : sans
   cette exclusion, un second versement le prenait pour un déménagement. */
/* OÙ CE NOM FIGURE-T-IL DÉJÀ ?

   Deux sources, et toutes deux comptent :

     le LOCATAIRE ACTUEL d'une autre unité — un déménagement, ou un
       homonyme de l'occupant en place ;
     le LOCATAIRE SUIVANT d'une autre ligne de rentrée — presque toujours
       une erreur de saisie, parfois deux personnes du même nom.

   Rend l'unité trouvée et la nature de la source. */
function trouverMemeNom(nom, uniteExclue) {
  const cible = String(nom || '').trim().toLowerCase();
  if (!cible) return null;

  for (const x of toutesUnitesRentree()) {
    if (x.unite.id === uniteExclue) continue;
    if (String(x.unite.locataire || '').trim().toLowerCase() === cible) {
      return { unite: x.unite, immeubleNom: x.immeubleNom, source: 'actuel' };
    }
  }
  if (donneesRentree) {
    for (const x of toutesUnitesRentree()) {
      if (x.unite.id === uniteExclue) continue;
      const autre = donneesRentree.unites[x.unite.id];
      /* Une ligne déjà versée a posé son locataire dans l'unité : il a été
         trouvé au premier tour, inutile de le compter une seconde fois. */
      if (autre && !autre.verseeLe &&
          String(autre.locataireSuivant || '').trim().toLowerCase() === cible) {
        return { unite: x.unite, immeubleNom: x.immeubleNom, source: 'rentree' };
      }
    }
  }
  return null;
}

/* LA NATURE DU DOUBLON, EN UN SEUL ENDROIT.

   Trois endroits la calculaient encore chacun à sa façon : le champ
   d'acompte, la confirmation, la fusion. Le champ se grisait sur la seule
   présence du nom, avant même qu'on ait répondu — et restait grisé après un
   choix « homonyme ».

   Le choix tranché à la saisie fait foi. La recherche en direct ne sert que
   de filet, pour une ligne écrite avant ce mécanisme. */
function estUnDemenagement(l, uniteId) {
  if (l.doublon) return l.doublon.choix === 'demenagement';
  return estDemenagementInterne(l.locataireSuivant, uniteId) && !l.homonyme;
}

function estDemenagementInterne(nom, uniteExclue) {
  if (!nom || typeof appData === 'undefined' || !appData) return false;
  const cible = String(nom).trim().toLowerCase();
  if (!cible) return false;
  return toutesUnitesRentree().some(({ unite }) =>
    unite.id !== uniteExclue &&
    unite.locataire && String(unite.locataire).trim().toLowerCase() === cible);
}

function comptesRentree() {
  let locataires = 0, documents = 0;
  manquesRentree().forEach(m => {
    locataires++;
    documents += m.manquants.length;
  });
  return { locataires, documents };
}

/* ---- Les écrans --------------------------------------------------------- */

function echapperR(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

async function ouvrirVueRentree() {
  if (typeof estConnecte !== 'function' || !estConnecte()) {
    alert("Connecte-toi à OneDrive avant d'ouvrir la rentrée.");
    return;
  }
  const annee = anneeRentreeAffichee || anneeRentree();
  const d = await chargerRentree(annee);
  if (!d) return;
  donneesRentree = d;
  anneeRentreeAffichee = annee;
  ouvertureRentree = true;
  dessinerVueRentree();
}

/* Un message d'alerte annonce que quelque chose n'a PAS eu lieu. Une
   confirmation annonce que c'est fait. Seul le premier mérite qu'on
   déplace l'écran. */
function messageEstUneAlerte(message) {
  /* « n'ont pas pu » couvre l'échec partiel de la remise à zéro : le
     message annonce un succès pour les unes et un échec pour les autres,
     en nommant celles qui demandent une correction à la main. Il était
     classé comme une confirmation, et restait hors de vue. */
  return /NON vers|impossible|non enregistr|Aucune|à vérifier|saisis |Indique |déjà été versée|place-toi|n'ont pas pu|ATTENTION|ne ressemble pas|figure déjà|NON enregistré|Il manque|dépasse le loyer|n'est pas un montant valable|pas un\s+montant valable/i
    .test(String(message));
}

function dessinerVueRentree(message) {
  const c = comptesRentree();
  const parImmeuble = {};
  toutesUnitesRentree().forEach(x => {
    (parImmeuble[x.immeubleNom] = parImmeuble[x.immeubleNom] || []).push(x);
  });

  let html = `<div class="vue-rentree">
    <div class="rentree-entete">
      <button class="btn-connexion" onclick="fermerVueRentree()">Retour</button>
      <h2>Rentrée ${donneesRentree.annee}</h2>
      <span class="rentree-mois">vers ${libelleMois(moisAffiche)}</span>
      <div class="rentree-annee">
        <button class="btn-connexion mini" onclick="changerAnneeRentree(-1)">année −</button>
        <button class="btn-connexion mini" onclick="changerAnneeRentree(1)">année +</button>
      </div>
    </div>
    ${message ? `<div class="rentree-message${
      messageEstUneAlerte(message) ? ' alerte' : ''}">${
      echapperR(message).replace(/\n/g, '<br>')}</div>` : ''}
    ${blocPresenceRentree()}
    <div class="rentree-douteux" id="rentree-douteux" style="display:none"></div>
    ${signalerDoublonsEnAttente()}
    ${signalerDoublesGaranties()}
    <p class="rentree-resume">${resumeStatuts()}</p>
    <button class="btn-connexion rentree-manques"
      onclick="ouvrirVueManques()">📝 Ce qui manque — ${c.locataires} locataire${
        c.locataires > 1 ? 's' : ''}, ${c.documents} document${c.documents > 1 ? 's' : ''}</button>
    <button class="btn-connexion rentree-aide-bouton"
      onclick="ouvrirAideRentree()">Mode d'emploi</button>
    ${nbVersees() ? `<button class="btn-connexion rentree-raz"
      onclick="remiseAZeroRentree()">Annuler les ${nbVersees()} versement(s) — essais</button>` : ''}`;

  Object.keys(parImmeuble).forEach(nom => {
    html += `<p class="rentree-immeuble">${echapperR(nom)}</p>`;
    parImmeuble[nom].forEach(({ immeubleId, unite }) => {
      html += ligneHtmlRentree(immeubleId, unite);
    });
  });

  html += `</div>`;
  const zone = document.getElementById('vue-rentree-conteneur');
  if (!zone) return;
  zone.innerHTML = html;
  zone.style.display = 'block';
  masquerFondRentree(true);
  /* P6 — ON NE REMONTE EN HAUT QU'À L'OUVERTURE.

     dessinerVueRentree est appelée après chaque saisie : un statut, une
     case, un montant d'acompte. Remonter à chaque fois renvoyait au sommet
     d'une liste de cinquante unités — il fallait redescendre pour saisir la
     date, puis remonter. La position est donc conservée. */
  /* ON REMONTE POUR UN AVERTISSEMENT, PAS POUR UNE CONFIRMATION.

     Un message d'échec — « NON versée », « impossible d'annuler » — doit
     être vu : il dit que rien n'est parti sur OneDrive, et il s'affiche
     tout en haut.

     Mais un versement RÉUSSI affiche lui aussi un message. Remonter alors
     renvoyait au sommet d'une liste de cinquante unités : après avoir versé
     la quarantième, il fallait redescendre. Le remède était devenu pire que
     le mal. Constaté le 05/09/2026.

     On ne remonte donc que pour un message d'alerte. */
  if (ouvertureRentree || (message && messageEstUneAlerte(message))) {
    window.scrollTo(0, 0);
    ouvertureRentree = false;
  }
  remplirPresenceRentree();
  signalerVersementsDouteux();
}

/* ÉCRITURE RÉUSSIE, RELECTURE ÉCHOUÉE.

   La sauvegarde de l'application écrit sur OneDrive puis relit pour
   vérifier. Si la coupure survient ENTRE les deux, l'horodatage n'est pas
   mis à jour : le module conclut à l'échec et rétablit l'unité en mémoire —
   alors que OneDrive contient bien le versement.

   Au chargement suivant, le nouveau locataire est en place mais l'écran
   propose encore de le verser. Un second versement ajouterait l'acompte une
   deuxième fois.

   On repère donc, à l'ouverture, les unités dont le locataire suivant est
   DÉJÀ en place sans qu'aucun versement soit noté. Rien n'est corrigé
   automatiquement : on signale, l'opérateur juge. */
/* LA GARANTIE APPARAÎT DANS DEUX UNITÉS pendant un déménagement.

   Marc arrive au studio 1 avec ses 400 €, mais le studio 7 les porte encore
   tant qu'il n'a pas été versé : le total des garanties est faussé d'autant.

   C'est cohérent — c'est le même argent en transit — mais il vaut mieux le
   dire que de laisser découvrir un écart au total. */
/* LE BANDEAU DES NOMS EN DOUBLE NON TRANCHÉS.

   Un doublon détecté sur la trentième ligne d'une liste de cinquante reste
   invisible tant qu'on ne descend pas. Le bandeau les rassemble en tête. */
/* LE BANDEAU RECENSE EN PERMANENCE, PAS SEULEMENT À LA SAISIE.

   Un doublon né de la SECONDE saisie n'était signalé que sur la seconde
   ligne : la première l'ignorait, puisqu'au moment où on l'avait remplie le
   nom n'existait nulle part ailleurs.

   Le bandeau recompte donc à chaque dessin, sur les noms tels qu'ils sont
   maintenant. Constaté en simulation le 05/09/2026. */
function signalerDoublonsEnAttente() {
  if (!donneesRentree) return '';

  /* Tous les noms en présence, actuels et futurs, avec leur unité. */
  const par = new Map();
  toutesUnitesRentree().forEach(({ unite, immeubleNom }) => {
    const l = donneesRentree.unites[unite.id];
    const ajouter = (nom, futur) => {
      const c = String(nom || '').trim().toLowerCase();
      if (!c) return;
      if (!par.has(c)) par.set(c, []);
      par.get(c).push({ unite, immeubleNom, futur, nom: String(nom).trim(), ligne: l });
    };
    /* UNE UNITÉ VERSÉE NE COMPTE QU'UNE FOIS.

       Après le versement, le locataire suivant EST devenu le locataire de
       l'unité. L'ajouter aux deux titres produisait un faux doublon sur
       chaque unité versée — « STUDIO 3 et STUDIO 3 ». Constaté en
       simulation le 05/09/2026. */
    if (l && l.verseeLe) {
      ajouter(unite.locataire, false);
      return;
    }
    ajouter(unite.locataire, false);
    if (l && l.statut !== 'reste') ajouter(l.locataireSuivant, true);
  });

  const attente = [];
  par.forEach(liste => {
    if (liste.length < 2) return;
    /* Tranché sur au moins une des lignes futures : plus rien à demander. */
    const futurs = liste.filter(x => x.futur);
    if (!futurs.length) return;
    if (futurs.every(x => x.ligne && x.ligne.doublon && x.ligne.doublon.choix)) return;
    attente.push({
      nom: liste[0].nom,
      ou: liste.map(x => x.unite.designation + (x.futur ? ' (à venir)' : '')).join(' et '),
    });
  });

  if (!attente.length) return '';
  return `<div class="rentree-doublon" style="margin-bottom:10px">
    <p><strong>${attente.length} nom(s) en double à trancher</strong></p>
    ${attente.map(x => `<div>${echapperR(x.nom)} — ${echapperR(x.ou)}</div>`).join('')}
    <p>Déménagement, homonyme ou erreur ? Réponds sur la ligne concernée :
    ces unités ne peuvent pas être versées avant.</p></div>`;
}

function signalerDoublesGaranties() {
  if (!donneesRentree) return '';
  const doubles = [];
  toutesUnitesRentree().forEach(({ unite }) => {
    const l = donneesRentree.unites[unite.id];
    if (!l || !l.verseeLe || !l.demenagement || !l.apporte) return;
    const source = toutesUnitesRentree().find(x =>
      x.unite.designation === l.apporte.venantDe);
    /* Si l'unité d'origine porte encore le même locataire, l'argent y est
       toujours compté. */
    if (source && String(source.unite.locataire || '').trim().toLowerCase()
        === String(l.locataireSuivant || '').trim().toLowerCase()) {
      doubles.push(`${l.locataireSuivant} — ${l.apporte.venantDe} et ${unite.designation}`);
    }
  });
  if (!doubles.length) return '';
  return `<div class="rentree-douteux" style="display:block">
    <strong>${doubles.length} garantie(s) comptée(s) deux fois</strong>
    ${doubles.map(d => `<div>${echapperR(d)}</div>`).join('')}
    <p>C'est le même argent, en transit. L'écart disparaîtra quand l'unité
    d'origine sera versée à son tour.</p></div>`;
}

function signalerVersementsDouteux() {
  if (!donneesRentree) return;
  const douteuses = toutesUnitesRentree().filter(({ unite }) => {
    const l = donneesRentree.unites[unite.id];
    if (!l || l.verseeLe || !l.locataireSuivant) return false;
    return String(unite.locataire || '').trim().toLowerCase()
        === String(l.locataireSuivant).trim().toLowerCase();
  });
  if (!douteuses.length) return;
  const zone = document.getElementById('rentree-douteux');
  if (!zone) return;
  zone.innerHTML =
    `<strong>${douteuses.length} unité(s) à vérifier</strong>` +
    douteuses.map(d => `<div>${echapperR(d.unite.designation)} — ` +
      `${echapperR(d.unite.locataire)} est déjà en place, mais aucun versement n'est noté.</div>`).join('') +
    `<p>Un versement a pu partir sur OneDrive sans être confirmé. Ne verse pas ` +
    `une seconde fois : l'acompte serait compté deux fois.</p>`;
  zone.style.display = 'block';
}

/* MASQUER LE FOND, EN-TÊTE COMPRIS.

   <main> ne suffit pas : les flèches de mois et le bouton « Tout
   enregistrer » sont AU-DESSUS, donc restés visibles et cliquables. On
   pouvait ainsi changer de mois sans quitter l'écran — les lignes affichées
   ne correspondaient plus au mois actif, et un versement serait parti dans
   le mauvais mois sans qu'on s'en aperçoive.

   Défaut trouvé en simulation le 02/09/2026. On masque donc aussi la barre
   de navigation des mois, et on la rétablit à la sortie. */
function masquerFondRentree(masquer) {
  const valeur = masquer ? 'none' : '';
  const principal = document.querySelector('main');
  if (principal) principal.style.display = valeur;
  const barre = document.querySelector('.ligne-controle');
  if (barre) barre.style.display = valeur;
}

/* Combien d'unités ont déjà été versées. Sert au bouton de remise à zéro,
   qui n'apparaît que s'il y a quelque chose à annuler. */
function nbVersees() {
  if (!donneesRentree) return 0;
  return Object.values(donneesRentree.unites)
    .filter(l => l.verseeLe && l.verseeVers === moisAffiche).length;
}

function resumeStatuts() {
  const n = { reste: 0, depart: 0, attente: 0, inoccupe: 0 };
  if (!donneesRentree) return '';
  toutesUnitesRentree().forEach(({ unite }) => {
    const l = donneesRentree.unites[unite.id];
    /* Un statut hors des quatre prévus compterait pour « NaN départs ».
       On retombe sur « reste », qui est la valeur par défaut. */
    const st = (l && n[l.statut] !== undefined) ? l.statut : 'reste';
    n[st]++;
  });
  return `${n.depart} départ${n.depart > 1 ? 's' : ''} · ${n.reste} reste${
    n.reste > 1 ? 'nt' : ''} · ${n.attente} en attente${
    n.inoccupe ? ` · ${n.inoccupe} inoccupé${n.inoccupe > 1 ? 's' : ''}` : ''}`;
}

/* Le bandeau de présence emploie presence.js, qui existe depuis le 19/08 :
   on ne réécrit pas ce qui fonctionne.

   autresPersonnesActives est ASYNCHRONE — elle interroge OneDrive. On ne
   peut donc pas l'appeler pendant le dessin : le bandeau est rempli après,
   quand la réponse arrive. L'écran ne l'attend pas. */
function blocPresenceRentree() {
  return `<div class="rentree-presence" id="rentree-presence" style="display:none"></div>`;
}

async function remplirPresenceRentree() {
  const zone = document.getElementById('rentree-presence');
  if (!zone || typeof autresPersonnesActives !== 'function') return;
  try {
    const autres = await autresPersonnesActives();
    if (!autres || !autres.length) { zone.style.display = 'none'; return; }
    zone.innerHTML = autres.map(p =>
      `<div><strong>${echapperR(p.prenom || p)}</strong> utilise aussi l'application</div>`
    ).join('') + `<p>Évitez de travailler sur le même immeuble en même temps.</p>`;
    zone.style.display = 'block';
  } catch (_) { zone.style.display = 'none'; }
}

function ligneHtmlRentree(immeubleId, unite) {
  /* ligneRentree normalise : acomptes, montants, contrôles et statut sont
     garantis présents. Aucun autre chemin ne doit lire une ligne brute. */
  const l = ligneRentree(unite.id);
  const st = STATUTS_RENTREE.find(s => s.cle === l.statut) || STATUTS_RENTREE[0];
  const avecAvenant = immeubleAvecAvenant(immeubleId);
  const demenage = estUnDemenagement(l, unite.id);
  const attendRemplacant = l.statut === 'depart' || l.statut === 'attente';

  /* LES QUATRE CASES À COCHER.
     Avenant et Samadhi ne concernent que Biche, Nimy et Petite Guirlande :
     ailleurs, un tiret sur fond hachuré, qui ne se confond pas avec une
     case non cochée. */
  const cases = CONTROLES_RENTREE.map(ct => {
    if (!(ct.partout || avecAvenant)) {
      return `<div class="rentree-case"><div class="case sans-objet">—</div>
        <span>${ct.libelle}</span></div>`;
    }
    const coche = !!l.controles[ct.cle];
    return `<div class="rentree-case">
      <div class="case ${coche ? 'ok' : 'manque'}"
        onclick="basculerControleRentree('${unite.id}','${ct.cle}')"
        >${coche ? '\u2713' : '\u25CF'}</div>
      <span>${ct.libelle}</span></div>`;
  }).join('');

  /* P1 — LE BOUTON REVIENT APRÈS UN VERSEMENT.

     Le code permettait de verser plusieurs fois, le mode d'emploi
     l'annonçait, mais le bouton disparaissait au premier versement : la
     seule voie restante était d'annuler puis de reverser.

     P5 — ET IL EXISTE AUSSI POUR UNE UNITÉ QUI RESTE.

     Le loyer d'un bail renouvelé est indexé, les charges revues. Ces
     montants se saisissaient déjà, mais rien ne les appliquait. Le bouton
     s'appelle alors « Appliquer les montants » : il ne change aucun
     locataire, il n'y en a pas de nouveau. */
  const versableDansCeMois = !l.verseeLe || l.verseeVers === moisAffiche;
  const pretAVerser = versableDansCeMois && (
    (l.statut === 'depart' && l.locataireSuivant) ||
    (l.statut === 'reste' && aDesMontants(l, immeubleId, unite.designation)));
  const libelleBouton = l.statut === 'reste'
    ? `Appliquer les montants dans ${libelleMois(moisAffiche)}`
    : `${l.verseeLe ? 'Verser à nouveau' : 'Verser'} dans ${libelleMois(moisAffiche)}`;

  return `<div class="rentree-ligne" style="border-left-color:${st.couleur}">

    <div class="rentree-ligne-titre">
      <span class="rentree-unite">${echapperR(unite.designation)}</span>
      <select onchange="changerStatutRentree('${unite.id}', this.value)">
        ${STATUTS_RENTREE.map(x => `<option value="${x.cle}"${
          x.cle === l.statut ? ' selected' : ''}>${x.libelle}</option>`).join('')}
      </select>
    </div>

    <p class="rentree-locataires">${echapperR(unite.locataire || 'libre')}
      <span class="rentree-lu">lu dans le mois</span></p>

    ${attendRemplacant ? `
    <div class="rentree-champs">
      <label class="large">locataire suivant
        <input type="text" value="${echapperR(l.locataireSuivant)}"
          placeholder="nom du remplaçant"
          onchange="changerSuivantRentree('${unite.id}', this.value)"></label>
    </div>

    ${l.doublon ? (l.doublon.choix
      ? `<p class="rentree-doublon-fait">${
          l.doublon.choix === 'demenagement'
            ? `Déménagement depuis ${echapperR(l.doublon.unite)} — sa garantie et son adresse le suivent.`
            : `Homonyme de l'occupant de ${echapperR(l.doublon.unite)} — deux personnes distinctes.`}
         <button class="btn-connexion mini" onclick="rouvrirDoublonRentree('${unite.id}')"
           >revenir dessus</button></p>`
      : `<div class="rentree-doublon">
          <p><strong>Ce nom figure déjà</strong> ${l.doublon.source === 'rentree'
            ? `comme futur locataire de ${echapperR(l.doublon.unite)}`
            : `à ${echapperR(l.doublon.unite)}`} — ${echapperR(l.doublon.immeuble)}.
          De quoi s'agit-il ?</p>
          <div class="rentree-doublon-choix">
            ${l.doublon.source === 'actuel' ? `<button class="btn-connexion mini"
              onclick="trancherDoublonRentree('${unite.id}','demenagement')">Déménagement</button>` : ''}
            <button class="btn-connexion mini"
              onclick="trancherDoublonRentree('${unite.id}','homonyme')">${
              l.doublon.source === 'rentree' ? 'Deux personnes' : 'Homonyme'}</button>
            <button class="btn-connexion mini retirer"
              onclick="trancherDoublonRentree('${unite.id}','erreur')">Erreur de saisie</button>
          </div>
        </div>`) : ''}

    <div class="rentree-champs">
      <label class="large">courriel du locataire
        <input type="email" inputmode="email" autocapitalize="off"
          class="${emailPlausible(l.email) ? '' : 'champ-faux'}"
          value="${echapperR(l.email)}" placeholder="nom@exemple.be"
          onchange="changerEmailRentree('${unite.id}', this.value, 'locataire')"></label>
    </div>
    <div class="rentree-champs">
      <label class="large">courriel du garant
        <input type="email" inputmode="email" autocapitalize="off"
          class="${emailPlausible(l.emailGarant) ? '' : 'champ-faux'}"
          value="${echapperR(l.emailGarant)}" placeholder="parent@exemple.be"
          onchange="changerEmailRentree('${unite.id}', this.value, 'garant')"></label>
    </div>
    ${adressesPlausibles(l) ? '' :
      `<p class="rentree-alerte-champ">${
        emailPlausible(l.email) ? 'L\'adresse du garant' : 'L\'adresse du locataire'}
       ne ressemble pas à un courriel. Corrige-la avant de verser.</p>`}
    ${adressesPlausibles(l) && !aUneAdresse(l) ?
      `<p class="rentree-note">Aucune adresse pour cette unité. Le versement
       reste possible, mais les décomptes n'auront nulle part où aller.</p>` : ''}

    ${(() => {
      /* LE BLOC N'EST PLUS MASQUÉ POUR UN DÉMÉNAGEUR : il est fermé pour
         tout le monde tant que la ligne n'est pas complète, et ouvert pour
         tout le monde ensuite. Une seule condition, pas de cas particulier. */
      const manque = manquePourAcompte(immeubleId, unite, l);
      const avecGar = avecGarantieIci(immeubleId, unite.designation);
      const trop = acompteTropGrand(immeubleId, unite, l) || acompteNegatif(l);

      if (manque.length) {
        return `<p class="rentree-acompte-ferme"><strong>Acomptes</strong> —
          à remplir d'abord : ${echapperR(manque.join(', '))}.${
          totalAcomptes(l) ? `<br>Un acompte de ${totalAcomptes(l).toFixed(2)} €
          est déjà inscrit sur cette ligne : complète ces champs pour le revoir.` : ''}</p>`;
      }

      return `
    <p class="rentree-sous-titre">Acomptes${
      l.acomptes.length ? ` — total ${totalAcomptes(l).toFixed(2)} €` : ''}</p>
    ${demenage ? `<p class="rentree-note">Déménagement interne : cet acompte ne
      peut concerner que la garantie — un rattrapage, quand celle du nouveau
      bail dépasse celle qu'il apporte.</p>` : ''}
    ${!avecGar ? `<p class="rentree-note">Pas de garantie sur cette unité :
      l'acompte est une avance sur le loyer, et ne peut dépasser un mois
      (${Number(l.montants.loyer).toFixed(2)} €).</p>` : ''}
    ${l.acomptes.map((a, i) => `<div class="rentree-champs">
      <label>montant
        <input type="number" step="0.01" inputmode="decimal"
          class="${trop ? 'champ-faux' : ''}"
          value="${a.montant == null ? '' : a.montant}"
          onchange="changerAcompteRentree('${unite.id}', ${i}, 'montant', this.value)"></label>
      <label class="date">date
        <input type="date" value="${a.date || ''}"
          onchange="changerAcompteRentree('${unite.id}', ${i}, 'date', this.value)"></label>
      <button class="btn-connexion mini retirer"
        onclick="retirerAcompteRentree('${unite.id}', ${i})">retirer</button>
    </div>`).join('')}
    ${acompteNegatif(l) ? `<p class="rentree-alerte-champ">Un acompte n'est pas
      un montant valable. Corrige-le avant de verser.</p>`
      : trop ? `<p class="rentree-alerte-champ">Le total des acomptes
      (${totalAcomptes(l).toFixed(2)} €) dépasse le loyer
      (${Number(l.montants.loyer).toFixed(2)} €). Corrige-le avant de verser.</p>` : ''}
    <button class="btn-connexion mini ajouter"
      onclick="ajouterAcompteRentree('${unite.id}')">+ acompte</button>`;
    })()}` : ''}

    ${l.clesDepotLe ? `<p class="rentree-depot">📁 Document remis déposé le ${
      dateHeureCourte(l.clesDepotLe)}<br>${echapperR(l.clesChemin || '')}${
      l.clesFichier ? ' / ' + echapperR(l.clesFichier) : ''}</p>` : ''}

    ${!attendRemplacant && totalAcomptes(l) ? `<p class="rentree-alerte-champ">
      Un acompte de ${totalAcomptes(l).toFixed(2)} € reste inscrit sur cette ligne.
      Sous ce statut il ne sera porté nulle part : repasse en « départ » pour le
      traiter, ou retire-le.</p>` : ''}

    <div class="rentree-cases">${cases}</div>

    ${l.statut === 'inoccupe' ? '' : `
    <div class="rentree-champs">
      <label class="large">début du bail
        <input type="date" value="${l.debutBail || ''}"
          placeholder="${debutBailPropose(donneesRentree.annee)}"
          onchange="changerDebutBailRentree('${unite.id}', this.value)"></label>
      <button class="btn-connexion mini ajouter"
        onclick="changerDebutBailRentree('${unite.id}', '${
          debutBailPropose(donneesRentree.annee)}')">1er sept.</button>
    </div>

    <p class="rentree-sous-titre">Montants du nouveau bail
      <span class="rentree-aide">vide = inchangé</span></p>
    <div class="rentree-montants">
      ${montantsApplicables(immeubleId, unite.designation).map(m => `<label>${m.libelle}
        <input type="number" step="0.01" inputmode="decimal"
          value="${l.montants[m.cle] == null ? '' : l.montants[m.cle]}"
          onchange="changerMontantRentree('${unite.id}', '${m.cle}', this.value)"></label>`).join('')}
    </div>`}

    ${l.verseeLe ? `<p class="rentree-versee">Versée dans ${echapperR(l.verseeVers)} le ${
        new Date(l.verseeLe).toLocaleDateString('fr-BE')}${
        l.versePar ? ' par ' + echapperR(l.versePar) : ''}
       ${l.verseeVers === moisAffiche
         ? `<button class="btn-connexion mini" onclick="annulerVersementRentree('${unite.id}')"
              >annuler</button>`
         : `<span class="rentree-autre-mois">place-toi sur ${echapperR(l.verseeVers)} pour annuler</span>`}</p>` : ''}

    ${pretAVerser ? `<button class="btn-connexion rentree-verser"
         onclick="verserUniteRentree('${unite.id}')">${libelleBouton}</button>` : ''}

    ${l.statut === 'depart' && l.locataireSuivant
      ? `<button class="btn-connexion rentree-cles"
           onclick="documentClesRentree('${unite.id}')">Avant remise des clés</button>` : ''}
  </div>`;
}

/* ---- Les saisies -------------------------------------------------------- */

function changerStatutRentree(uniteId, valeur) {
  const l = ligneRentree(uniteId);
  const avant = l.statut;
  l.statut = valeur;

  /* UN ACOMPTE NE DOIT PAS DEVENIR INVISIBLE.

     Passer une ligne de « départ » à « reste » ou « inoccupé » masquait le
     bloc acompte : les 200 € restaient dans le fichier, hors de vue, et la
     fusion ne les portait nulle part puisqu'elle ne traite les acomptes que
     lorsqu'il y a changement de locataire. Même famille que l'argent perdu
     du déménageur. Constaté le 06/09/2026. */
  if ((valeur === 'reste' || valeur === 'inoccupe') &&
      avant !== valeur && totalAcomptes(l)) {
    const t = toutesUnitesRentree().find(x => x.unite.id === uniteId);
    return enregistrerRentree().then(() => dessinerVueRentree(
      `${t ? t.unite.designation : 'Cette unité'} : ATTENTION — un acompte de ` +
      `${totalAcomptes(l).toFixed(2)} € est inscrit sur cette ligne. Sous « ${
        valeur === 'reste' ? 'le locataire reste' : 'inoccupé'} » il ne sera porté ` +
      `nulle part. Il est conservé, mais rien ne l'appliquera.`));
  }
  enregistrerRentree().then(() => dessinerVueRentree());
}
/* LE DÉMÉNAGEMENT SE CONSTATE À LA SAISIE DU NOM, PAS AU VERSEMENT.

   Il était constaté au premier versement, en cherchant le nom parmi les
   occupants des autres unités. Mais rien n'oblige à verser le studio
   d'arrivée en premier : si l'ancien est reloué d'abord, le déménageur n'y
   est plus, et l'on ne trouve rien.

   Marc arrivait alors avec ZÉRO garantie au lieu de ses 400 €, et sans
   adresse. Ses versements étaient perdus sans un mot. Constaté en
   simulation le 05/09/2026.

   Au moment où l'on tape son nom, en revanche, il est encore chez lui. On
   relève donc là, et l'on conserve : l'ordre des versements n'a plus
   d'importance. */
function changerSuivantRentree(uniteId, valeur) {
  const l = ligneRentree(uniteId);
  const nom = String(valeur || '').trim();
  const change = nom.toLowerCase() !== String(l.locataireSuivant || '').trim().toLowerCase();
  l.locataireSuivant = nom;

  /* Le nom a changé : ce qui avait été tranché sur l'ancien n'a plus
     d'objet. Une unité déjà versée conserve sa décision. */
  if (change && !l.verseeLe) {
    delete l.apporte; delete l.doublon; delete l.homonyme;
  }

  /* ON CHERCHE LE NOM DANS LES DEUX SOURCES.

     La recherche ne portait que sur les locataires ACTUELS. Le même futur
     locataire inscrit dans DEUX LIGNES DE RENTRÉE — Julie au studio 3 et au
     studio 8 — n'était pas signalé : c'est pourtant l'erreur de saisie la
     plus probable, et à la fusion elle aurait occupé deux studios.

     Constaté en simulation le 05/09/2026. */
  const venantDe = nom ? trouverMemeNom(nom, uniteId) : null;

  if (venantDe && !l.verseeLe) {
    /* CE NOM FIGURE DÉJÀ AILLEURS — trois causes possibles, et rien dans
       les données ne permet de trancher :

         déménagement  la même personne change de studio ;
         homonyme      deux personnes distinctes ;
         erreur        le même locataire saisi deux fois par mégarde.

       La question était posée au premier versement, donc des mois après la
       saisie. Elle l'est désormais tout de suite, sur la ligne.

       ON RELÈVE DÈS MAINTENANT ce que la personne apporterait : elle est
       encore chez elle. Si l'ancien studio était reloué d'abord, on ne
       trouverait plus rien. Mais on ne s'en sert qu'une fois tranché. */
    l.doublon = {
      unite: venantDe.unite.designation,
      immeuble: venantDe.immeubleNom,
      source: venantDe.source,
      choix: null,
      /* Un nom trouvé dans une autre LIGNE DE RENTRÉE n'apporte rien : la
         personne n'occupe pas encore ce studio, il n'y a ni garantie ni
         adresse à reprendre. Seul un locataire en place en a. */
      releve: venantDe.source === 'actuel' ? {
        garantieEncaissee: venantDe.unite.garantieEncaissee,
        garantieDatePaiement: venantDe.unite.garantieDatePaiement,
        assuranceEncaissee: venantDe.unite.assuranceEncaissee,
        assuranceDatePaiement: venantDe.unite.assuranceDatePaiement,
        email: venantDe.unite.email,
        emailGarant: venantDe.unite.emailGarant || '',
        venantDe: venantDe.unite.designation,
      } : null,
    };
    delete l.apporte;
  }
  enregistrerRentree().then(() => dessinerVueRentree());
}

/* LES TROIS RÉPONSES AU DOUBLON. */
function trancherDoublonRentree(uniteId, choix) {
  const l = ligneRentree(uniteId);
  if (!l.doublon) return;

  if (choix === 'erreur') {
    l.locataireSuivant = '';
    delete l.doublon; delete l.apporte; delete l.homonyme;
  } else if (choix === 'demenagement' && l.doublon.source === 'actuel') {
    l.doublon.choix = 'demenagement';
    l.apporte = l.doublon.releve;   /* garantie, assurance et adresse le suivent */
    l.homonyme = false;
  } else {
    l.doublon.choix = 'homonyme';
    delete l.apporte;               /* deux personnes : rien ne suit */
    l.homonyme = true;
  }
  enregistrerRentree().then(() => dessinerVueRentree());
}

/* Revenir sur un choix déjà fait, tant que l'unité n'est pas versée. */
function rouvrirDoublonRentree(uniteId) {
  const l = ligneRentree(uniteId);
  if (!l.doublon || l.verseeLe) return;
  l.doublon.choix = null;
  delete l.apporte; delete l.homonyme;
  enregistrerRentree().then(() => dessinerVueRentree());
}

/* Un doublon détecté, pas encore tranché. Bloque le versement. */
function doublonEnAttente(l) {
  return !!(l.doublon && !l.doublon.choix);
}
function changerAcompteRentree(uniteId, index, champ, valeur) {
  const l = ligneRentree(uniteId);
  if (!l.acomptes[index]) return;
  if (champ === 'montant') {
    const v = String(valeur).replace(',', '.').trim();
    if (v !== '' && !montantValable(v)) {
      l.acomptes[index].montant = null;
      const t = toutesUnitesRentree().find(x => x.unite.id === uniteId);
      return enregistrerRentree().then(() => dessinerVueRentree(
        `${t ? t.unite.designation : 'Cette unité'} : « ${valeur} » n'est pas un ` +
        `montant valable. L'acompte a été laissé vide.`));
    }
    l.acomptes[index].montant = v === '' ? null : Number(v);
  } else {
    l.acomptes[index].date = valeur || null;
  }
  enregistrerRentree().then(() => dessinerVueRentree());
}

/* L'adresse est enregistrée telle quelle, même douteuse : l'effacer
   d'autorité ferait disparaître une saisie en cours de frappe. Elle est
   signalée à l'écran et bloque le versement — c'est suffisant. */
function changerEmailRentree(uniteId, valeur, quel) {
  const l = ligneRentree(uniteId);
  if (quel === 'garant') l.emailGarant = String(valeur || '').trim();
  else l.email = String(valeur || '').trim();
  enregistrerRentree().then(() => dessinerVueRentree());
}

function changerDebutBailRentree(uniteId, valeur) {
  ligneRentree(uniteId).debutBail = valeur || null;
  enregistrerRentree().then(() => dessinerVueRentree());
}

function ajouterAcompteRentree(uniteId) {
  ligneRentree(uniteId).acomptes.push({ montant: null, date: null });
  enregistrerRentree().then(() => dessinerVueRentree());
}

function retirerAcompteRentree(uniteId, index) {
  ligneRentree(uniteId).acomptes.splice(index, 1);
  enregistrerRentree().then(() => dessinerVueRentree());
}
/* Les six montants du bail à venir. Un champ vide vaut « rien saisi », et
   non zéro : la distinction compte pour savoir ce qui reste à remplir. */
function changerMontantRentree(uniteId, cle, valeur) {
  const l = ligneRentree(uniteId);
  const t = toutesUnitesRentree().find(x => x.unite.id === uniteId);
  const ouvertAvant = t && !manquePourAcompte(t.immeubleId, t.unite, l).length;

  const v = String(valeur).replace(',', '.').trim();

  /* Une saisie qui n'est pas un nombre positif n'est pas enregistrée : mieux
     vaut un champ vide, que la barrière voit, qu'un NaN qu'elle laisse
     passer et qui ressort en 0,00 € sur le document. */
  if (v !== '' && !montantValable(v)) {
    l.montants[cle] = null;
    return enregistrerRentree().then(() => dessinerVueRentree(
      `${t ? t.unite.designation : 'Cette unité'} : « ${valeur} » n'est pas un ` +
      `montant valable. Le champ a été laissé vide.`));
  }
  l.montants[cle] = v === '' ? null : Number(v);

  const ouvertApres = t && !manquePourAcompte(t.immeubleId, t.unite, l).length;

  /* UN MONTANT VIDÉ SOUS UN ACOMPTE DÉJÀ INSCRIT.

     La barrière ne joue qu'à la saisie : rien n'empêche de vider un montant
     ensuite. On ne supprime pas le paiement pour autant — on le dit. */
  if (v === '' && totalAcomptes(l)) {
    return enregistrerRentree().then(() => dessinerVueRentree(
      `${t ? t.unite.designation : 'Cette unité'} : ATTENTION — un acompte de ` +
      `${totalAcomptes(l).toFixed(2)} € est inscrit sur cette ligne et tu viens ` +
      `de vider un montant. L'acompte est conservé, mais il ne sera plus ` +
      `modifiable tant que la ligne n'est pas complète.`));
  }

  /* Le bloc acompte vient de s'ouvrir ou de se fermer : il faut redessiner.
     Hors de ce cas on ne redessine pas, pour ne pas couper une saisie en
     cours sur les montants suivants. */
  if (ouvertAvant !== ouvertApres) {
    return enregistrerRentree().then(() => dessinerVueRentree());
  }
  enregistrerRentree();
}
function basculerControleRentree(uniteId, cle) {
  const l = ligneRentree(uniteId);
  l.controles[cle] = !l.controles[cle];
  enregistrerRentree().then(() => dessinerVueRentree());
}
function changerAnneeRentree(pas) {
  anneeRentreeAffichee = (anneeRentreeAffichee || anneeRentree()) + pas;
  ouvrirVueRentree();
}

/* ---- La fusion ----------------------------------------------------------

   CE QUI PASSE dans le mois calendaire :
     — le locataire suivant devient le locataire de l'unité ;
     — l'acompte s'ajoute à la garantie déjà versée ;
     — la date devient la date de début de bail.

   CE QUI NE PASSE PAS :
     — les quatre contrôles, qui restent dans le mois de rentrée pour
       consultation les années suivantes ;
     — les loyers et les charges, qui appartiennent au mois calendaire et
       ne sont pas touchés.

   LA BASCULE EST RÉVERSIBLE tant que le mois n'est pas clôturé : « annuler »
   remet le locataire précédent et retire l'acompte de la garantie. */
async function verserUniteRentree(uniteId) {
  const l = ligneRentree(uniteId);
  const trouve = toutesUnitesRentree().find(x => x.unite.id === uniteId);
  if (!trouve) return;
  const u = trouve.unite;

  /* UNE UNITÉ QUI RESTE N'A PAS DE REMPLAÇANT : on n'applique que les
     montants du bail renouvelé. */
  const changeDeLocataire = l.statut !== 'reste';
  if (changeDeLocataire && !l.locataireSuivant) {
    return dessinerVueRentree("Indique d'abord le remplaçant.");
  }

  /* La question de l'homonymie était posée ici, au premier versement.
     Elle est désormais tranchée à la saisie du nom, sur la ligne — des mois
     plus tôt, au moment où l'on sait de qui il s'agit. */

  /* UN DOUBLON NON TRANCHÉ BLOQUE LE VERSEMENT.

     Verser sans savoir s'il s'agit d'un déménagement ou d'un homonyme, ce
     serait choisir au hasard entre reporter une garantie de 400 € et la
     mettre à zéro. */
  /* Un doublon né APRÈS la saisie de cette ligne n'a pas été détecté sur
     elle : on revérifie au versement. */
  if (!l.doublon && changeDeLocataire) {
    const tardif = trouverMemeNom(l.locataireSuivant, uniteId);
    if (tardif) {
      l.doublon = {
        unite: tardif.unite.designation, immeuble: tardif.immeubleNom,
        source: tardif.source, choix: null,
        releve: tardif.source === 'actuel' ? {
          garantieEncaissee: tardif.unite.garantieEncaissee,
          garantieDatePaiement: tardif.unite.garantieDatePaiement,
          assuranceEncaissee: tardif.unite.assuranceEncaissee,
          assuranceDatePaiement: tardif.unite.assuranceDatePaiement,
          email: tardif.unite.email, emailGarant: tardif.unite.emailGarant || '',
          venantDe: tardif.unite.designation,
        } : null,
      };
      await enregistrerRentree();
    }
  }

  if (doublonEnAttente(l)) {
    return dessinerVueRentree(
      `${u.designation} : « ${l.locataireSuivant} » figure déjà à ${l.doublon.unite}. ` +
      `Indique s'il s'agit d'un déménagement, d'un homonyme ou d'une erreur.`);
  }

  /* UNE ADRESSE FAUSSE BLOQUE LE VERSEMENT.

     Recopiée dans l'unité, elle partirait dans un envoi qui échouerait sans
     qu'on sache pourquoi. Mieux vaut refuser ici. */
  if (changeDeLocataire && !adressesPlausibles(l)) {
    const fautive = emailPlausible(l.email) ? l.emailGarant : l.email;
    const quelle = emailPlausible(l.email) ? 'du garant' : 'du locataire';
    return dessinerVueRentree(
      `${u.designation} : l'adresse ${quelle} « ${fautive} » ne ressemble pas ` +
      `à un courriel. Corrige-la.`);
  }

  /* PAS PLUS D'UN MOIS D'AVANCE SUR UNE UNITÉ SANS GARANTIE.

     Le garage n'a qu'un loyer : son acompte est une avance sur le premier
     mois, jamais davantage. Règle arrêtée le 06/09/2026. */
  if (changeDeLocataire && acompteNegatif(l)) {
    return dessinerVueRentree(
      `${u.designation} : un acompte n'est pas un montant valable. Corrige-le ` +
      `avant de verser — un acompte négatif inscrirait une garantie négative.`);
  }

  if (changeDeLocataire && acompteTropGrand(immeubleIdDe(uniteId), u, l)) {
    return dessinerVueRentree(
      `${u.designation} : l'acompte (${totalAcomptes(l).toFixed(2)} €) dépasse le ` +
      `loyer (${Number(l.montants.loyer).toFixed(2)} €). Cette unité n'a pas de ` +
      `garantie : l'avance ne peut pas excéder un mois.`);
  }

  /* ON PEUT VERSER PLUSIEURS FOIS, MAIS DANS LE MÊME MOIS.

     Le dossier de rentrée se remplit de février à l'été : on verse une
     première fois dès que le bail est signé, puis à nouveau quand un second
     acompte arrive ou qu'un montant est complété. Cela ne compte jamais
     deux fois, puisque la garantie encaissée est recalculée à partir du
     total des acomptes.

     MAIS LE SECOND VERSEMENT DOIT SE FAIRE DANS LE MÊME MOIS QUE LE
     PREMIER. Sinon on installe le locataire dans deux mois différents :
     septembre le porte déjà, octobre le reçoit aussi. Le mois enregistré
     est écrasé, l'annulation devient impossible depuis l'un comme depuis
     l'autre, et l'instantané de septembre est perdu.

     Ce contrôle existait en v101. Il était collé au bloc de confirmation
     d'homonymie que la version 105 a remplacé par les trois réponses au
     doublon : il est parti avec lui, sans que je m'en aperçoive. Aucun des
     vingt-neuf bancs ne couvrait ce cas. Rétabli le 06/09/2026 sur
     signalement.

     L'ORDRE IMPORTE : ce contrôle doit venir AVANT premierVersement, sinon
     un second versement venu d'un autre mois aurait déjà été traité. */
  if (l.verseeLe && l.verseeVers !== moisAffiche) {
    return dessinerVueRentree(
      `${u.designation} a déjà été versée dans ${l.verseeVers}. ` +
      `Place-toi sur ce mois pour la compléter.`);
  }

  /* PREMIER VERSEMENT OU NON — lu avant d'être posé, et avant la
     confirmation, qui en dépend pour son texte. */
  const premierVersement = !l.instantane;

  /* Q3 — PAS DE PREMIER VERSEMENT SANS DATE DE BAIL.

     La règle « vide = inchangé » vaut pour les montants, mais un nouveau
     locataire qui hérite des dates du sortant se retrouve avec un bail
     déjà expiré. Et une fois l'unité versée, elle sort de « Ce qui
     manque » : l'oubli devient invisible.

     On propose le 1er septembre plutôt que de refuser sèchement. */
  if (premierVersement && changeDeLocataire && !l.debutBail) {
    const propose = debutBailPropose(donneesRentree.annee);
    const accepte = confirm(
      `${u.designation} : aucune date de début de bail.\n\n` +
      `Sans elle, ${l.locataireSuivant} garderait les dates du locataire ` +
      `sortant — un bail déjà expiré.\n\n` +
      `Appliquer le ${propose} ?\n\n` +
      `Annuler pour saisir une autre date.`);
    if (!accepte) return dessinerVueRentree(
      `${u.designation} : saisis la date de début du bail avant de verser.`);
    l.debutBail = propose;
    await enregistrerRentree();
  }


  /* P4 — LA CONFIRMATION DOIT DIRE CE QUI VA CHANGER.

     Elle annonçait encore « les loyers et charges ne sont pas modifiés »,
     texte hérité d'avant les montants — alors qu'un loyer saisi à 999 €
     allait précisément être écrit. C'est le dernier message lu avant une
     écriture sur OneDrive : il doit énumérer les remplacements. */
  const montantsIci = montantsApplicables(immeubleIdDe(uniteId), u.designation);
  const avecGarantie = montantsIci.some(m => m.cle === 'garantie');
  /* La décision de déménagement n'est prise que plus bas ; on l'anticipe
     ici pour le texte, sans l'enregistrer. */
  const demenagementPrevu = l.instantane ? l.demenagement
    : (!changeDeLocataire || estUnDemenagement(l, uniteId));

  const remplaces = montantsIci
    .filter(m => l.montants[m.cle] != null)
    .map(m => `  ${m.libelle} : ${Number(l.montants[m.cle]).toFixed(2)} €`);

  const ok = confirm(
    `${changeDeLocataire ? 'Verser' : 'Appliquer les montants sur'} ${
      u.designation} dans ${libelleMois(moisAffiche)} ?\n\n` +
    /* Q4 — au second versement, le locataire est déjà en place : afficher
       « X → X » n'apprend rien et fait douter. */
    (changeDeLocataire && premierVersement
      ? `${u.locataire || 'libre'} → ${l.locataireSuivant}\n\n`
      : `${l.locataireSuivant || u.locataire || 'libre'} reste en place.\n\n`) +
    (remplaces.length
      ? `Ces montants seront remplacés :\n${remplaces.join('\n')}\n\n`
      : `Aucun montant saisi : rien ne sera remplacé.\n\n`) +
    (l.debutBail ? `Bail du ${l.debutBail}, pour douze mois.\n` : '') +
    /* S2 — ON N'ANNONCE PAS UNE ÉCRITURE QUI N'AURA PAS LIEU.

       Le code ne pose plus de garantie hors périmètre, mais le texte
       additionnait les acomptes sans se poser la question : sur le garage,
       il annonçait 400 € qui n'étaient jamais écrits. Et un acompte saisi
       là où il n'y a pas de garantie mérite d'être signalé, plutôt
       qu'ignoré en silence. */
    /* LA CONFIRMATION DIT LE MONTANT RÉELLEMENT ÉCRIT, ET OÙ.

       Elle annonçait le seul total des acomptes. Pour un déménageur elle
       affichait donc 200 € là où le code en écrivait 400 : ni l'un ni
       l'autre n'était la somme réelle, qui est leur addition. Et sur une
       unité sans garantie elle prévenait que l'acompte ne serait pas
       porté — il l'est désormais, sur le premier mois de loyer. */
    (changeDeLocataire && totalAcomptes(l)
      ? (avecGarantie
          ? (() => {
              const ap = demenagementPrevu
                ? (l.apporte || (l.doublon && l.doublon.releve) || null) : null;
              const dejaG = (ap && Number(ap.garantieEncaissee)) || 0;
              return dejaG
                ? `Garantie encaissée : ${dejaG.toFixed(2)} € apportés + ${
                    totalAcomptes(l).toFixed(2)} € d'acomptes = ${
                    (dejaG + totalAcomptes(l)).toFixed(2)} €.\n`
                : `Garantie encaissée : ${totalAcomptes(l).toFixed(2)} € (total des acomptes).\n`;
            })()
          : `Loyers versés : ${totalAcomptes(l).toFixed(2)} € — cette unité n'a pas de ` +
            `garantie, l'acompte est porté sur le premier mois.\n`)
      : '') +
    /* Le report sur les loyers versés n'a lieu qu'au PREMIER versement :
       aux suivants, l'unité porte des paiements réels du nouveau locataire
       qu'on ne peut pas écraser. Si l'acompte a bougé depuis, on le dit. */
    (changeDeLocataire && !avecGarantie && !premierVersement &&
     totalAcomptes(l) !== (l.acomptesPortes || 0)
      ? `ATTENTION : l'acompte a changé depuis le premier versement (${
          (l.acomptesPortes || 0).toFixed(2)} € portés). Les loyers versés du mois ` +
        `ne seront pas retouchés — corrige-les à la main dans l'écran du mois.\n` : '') +
    /* DEUX PHRASES, car les deux règles ne sont pas la même : l'argent
       suit la personne, les textes suivent l'unité. Une seule phrase était
       fausse pour l'une ou pour l'autre dans le cas du déménagement. */
    (changeDeLocataire && premierVersementPrevu(l) && !demenagementPrevu
      ? `L'assurance payée et les loyers versés par le sortant repartent à zéro.\n` : '') +
    (changeDeLocataire && premierVersementPrevu(l)
      ? `Les notes et références de l'unité sont effacées.\n` : '') +
    `\nLes champs laissés vides ne sont pas touchés.`);
  if (!ok) return;

  /* Q1 — LA DÉCISION EST PRISE UNE FOIS, AU PREMIER VERSEMENT.

     Elle était recalculée à chaque fois, en cherchant le nom du locataire
     parmi les occupants des AUTRES unités. Or un déménagement interne
     libère un studio, et ce studio est reloué — c'est le cas nominal.

     Une fois l'ancien studio reloué, le déménageur n'est plus trouvé nulle
     part : au second versement, il passait pour un nouveau venu et sa
     garantie était recalculée à partir de ses acomptes, dont il n'a versé
     aucun. Ses 400 € disparaissaient sans un mot.

     Comme pour l'homonymie, la décision est donc mémorisée. C'est la
     troisième de la famille — premier versement, homonymie, déménagement —
     et la dernière : toutes reposaient sur le même piège. */
  if (premierVersement) {
    /* Le relevé fait foi : il a été pris quand le déménageur était encore
       chez lui. La recherche en direct ne sert que de filet, pour une ligne
       venue d'une version antérieure. */
    /* Le choix tranché à la saisie fait foi. La recherche en direct ne sert
       que de filet, pour une ligne venue d'une version antérieure. */
    l.demenagement = !changeDeLocataire || estUnDemenagement(l, uniteId);

    /* CE QUI APPARTIENT AU DÉMÉNAGEUR EST RELEVÉ MAINTENANT.

       La garantie et l'adresse étaient allées chercher dans l'unité qu'il
       occupe encore — au moment du versement. Mais rien n'oblige à verser
       le studio d'arrivée en premier : si l'ancien est reloué d'abord, le
       déménageur n'y est plus, et l'on ne trouve rien.

       Résultat constaté en simulation le 05/09/2026 : Marc arrivait avec
       ZÉRO garantie au lieu de ses 400 €, et sans adresse. Ses versements
       étaient perdus sans un mot.

       On relève donc au moment de la DÉCISION, une fois pour toutes, et on
       conserve avec elle. L'ordre des versements n'a plus d'importance. */
  }
  const demenagement = l.demenagement;
  /* Instantané complet, même principe qu'à l'annulation. */
  const instantaneAvant = JSON.parse(JSON.stringify(u));

  /* ON GARDE DE QUOI REVENIR EN ARRIÈRE, EXACTEMENT.

     Une unité peut n'avoir aucune garantie : le champ est alors absent, et
     non pas nul. Le distinguer importe — sinon l'annulation pose une
     garantie à zéro là où il n'y en avait aucune, et l'état d'origine
     n'est pas rétabli. Défaut trouvé en simulation le 02/09/2026. */
  /* L'INSTANTANÉ N'EST PRIS QU'AU PREMIER VERSEMENT : au second, l'unité
     porte déjà les données de la rentrée, et le conserver écraserait la
     référence d'origine — l'annulation ne rendrait plus l'état d'août. */
  if (!l.instantane) l.instantane = JSON.parse(JSON.stringify(u));

  /* LE NOUVEAU LOCATAIRE PREND LA PLACE.

     Cette ligne avait disparu lors d'une restauration de bloc le
     05/09/2026 : le versement posait tous les montants mais laissait le
     locataire sortant en place. Signalé à l'essai.

     Une unité qui reste garde le sien : il n'y a pas de suivant. */
  if (changeDeLocataire) u.locataire = l.locataireSuivant;

  /* CE QUI EST SAISI ÉCRASE CE QUI VIENT D'AOÛT. CE QUI EST VIDE NE TOUCHE
     À RIEN.

     Septembre est créé par recopie d'août : chaque unité y arrive avec le
     locataire, les montants et les encaissés du mois précédent. Le dossier
     de rentrée ne remplace que ce qu'on y a effectivement saisi. */
  montantsApplicables(immeubleIdDe(uniteId), u.designation).forEach(m => {
    if (l.montants[m.cle] != null) u[m.champ] = Number(l.montants[m.cle]);
  });

  const total = totalAcomptes(l);
  const dernierAcompte = (l.acomptes || [])
    .filter(a => a && a.date).map(a => a.date).sort().pop() || null;

  if (demenagement) {
    /* DÉMÉNAGEMENT INTERNE : LA GARANTIE SUIT LA PERSONNE — encore
       faut-il aller la chercher.

       « Telle quelle » était faux : l'unité d'arrivée porte celle du
       SORTANT, pas celle du déménageur. Marc arrivait dans un studio dont
       la garantie valait 740 € alors qu'il en avait versé 400. Défaut
       trouvé en simulation le 05/09/2026, en même temps que celui de
       l'adresse — même cause.

       On va donc la chercher dans l'unité qu'il occupe encore. Le MONTANT
       DÛ, lui, reste celui du nouveau bail : c'est la boucle ci-dessus qui
       l'a posé, et c'est voulu. */
    /* Le relevé pris à la saisie du nom fait foi. À défaut — ligne venue
       d'une version antérieure — on cherche en direct : cela ne marche que
       si le déménageur est encore chez lui, mais c'est mieux que rien. */
    const apporte = l.apporte || (() => {
      const v = toutesUnitesRentree().find(x => x.unite.id !== uniteId &&
        String(x.unite.locataire || '').trim().toLowerCase()
          === String(l.locataireSuivant).trim().toLowerCase());
      return v ? {
        garantieEncaissee: v.unite.garantieEncaissee,
        garantieDatePaiement: v.unite.garantieDatePaiement,
        assuranceEncaissee: v.unite.assuranceEncaissee,
        assuranceDatePaiement: v.unite.assuranceDatePaiement,
        email: v.unite.email,
        emailGarant: v.unite.emailGarant || '',
        /* D'OÙ VIENT L'ARGENT — sans cette mention, le bandeau des
           garanties comptées deux fois ne peut rien signaler pour une ligne
           passée par ce chemin de repli. */
        venantDe: v.unite.designation,
      } : null;
    })();
    if (apporte) {
      /* On conserve le relevé retrouvé : la ligne l'aura pour ses
         versements suivants et pour l'avertissement. */
      if (!l.apporte) l.apporte = apporte;
      /* LA GARANTIE APPORTÉE ET LE RATTRAPAGE S'ADDITIONNENT.

         La garantie apportée était posée SEULE, et les acomptes de la ligne
         ignorés. Un déménageur ne verse pas d'acompte de garantie, mais il
         verse parfois un RATTRAPAGE : le loyer augmente chaque année, donc
         la garantie du nouveau bail dépasse celle qu'il apporte.

         Ces acomptes-là étaient déduits sur le document de remise des clés
         et n'arrivaient nulle part. Le locataire lisait « vos 200 € sont
         déduits » et l'application ne les connaissait pas. Corrigé le
         06/09/2026, en même temps que la règle d'ouverture du bloc.

         Sur une unité sans garantie, on ne pose rien ici : l'acompte part
         sur le premier mois de loyer, plus bas. */
      if (avecGarantie) {
        u.garantieEncaissee = Number(apporte.garantieEncaissee || 0) + total;
        u.garantieDatePaiement = dernierAcompte || apporte.garantieDatePaiement;
      }
      u.assuranceEncaissee = apporte.assuranceEncaissee;
      u.assuranceDatePaiement = apporte.assuranceDatePaiement;
      if (!l.email && apporte.email) u.email = apporte.email;
      if (!l.emailGarant && apporte.emailGarant) u.emailGarant = apporte.emailGarant;
    }
  } else {
    /* NOUVEAU LOCATAIRE : l'argent du sortant n'est pas le sien.

       LA GARANTIE ENCAISSÉE EST RECALCULÉE à partir du TOTAL des acomptes,
       jamais additionnée. C'est ce qui permet de verser plusieurs fois la
       même unité au fil des acomptes qui arrivent, sans jamais compter
       deux fois. */
    /* LA GARANTIE N'EST PORTÉE QUE LÀ OÙ ELLE S'APPLIQUE.

       Le garage n'a qu'un loyer : lui poser une garantie encaissée de
       400 € parce qu'un acompte a été saisi n'a pas de sens. Constaté en
       simulation le 05/09/2026 — le garage recevait 400 € alors qu'aucun
       champ de garantie ne lui est demandé. */
    if (montantsApplicables(immeubleIdDe(uniteId), u.designation)
        .some(m => m.cle === 'garantie')) {
      u.garantieEncaissee = total;
      u.garantieDatePaiement = dernierAcompte;
    }

    /* L'ASSURANCE ENCAISSÉE ET LES LOYERS VERSÉS repartent de zéro AU
       PREMIER VERSEMENT SEULEMENT : ils viennent d'août et appartiennent au
       sortant. Sans cela, l'entrant paraîtrait avoir déjà payé — un reste
       dû de 10 € au lieu de 130.

       MAIS PAS AUX VERSEMENTS SUIVANTS. L'unité porte alors le nouveau
       locataire, et ces montants sont les SIENS : le loyer de septembre
       qu'il a réglé, l'assurance qu'il a payée. Les effacer parce qu'un
       troisième acompte arrive détruirait des paiements réels.

       La garantie encaissée, elle, est recalculée à chaque fois — c'est
       normal, elle vient du total des acomptes et de rien d'autre. */
    if (premierVersement) {
      u.assuranceEncaissee = 0;
      u.assuranceDatePaiement = null;
      u.montantsVerses = 0;
      u.dateVersement = null;      /* P7 : pas de date sans paiement */
    }
  }

  /* L'ACOMPTE D'UNE UNITÉ SANS GARANTIE VA SUR LE PREMIER MOIS DE LOYER.

     Le garage n'a qu'un loyer : son acompte est une avance sur le premier
     mois, plafonnée à un mois — le contrôle est fait plus haut. Il était
     jusqu'ici saisi puis porté nulle part.

     APRÈS la remise à zéro ci-dessus, sinon il serait effacé aussitôt.

     AU PREMIER VERSEMENT SEULEMENT : aux suivants, l'unité porte les
     paiements réels du nouveau locataire, qu'on ne peut pas écraser. On
     mémorise ce qui a été porté pour signaler une divergence ultérieure. */
  if (changeDeLocataire && !avecGarantie && premierVersement && total) {
    u.montantsVerses = total;
    u.dateVersement = dernierAcompte;
    /* La MÉMOIRE de ce report n'est posée qu'une fois la sauvegarde
       confirmée, avec le reste des marques de versement — voir plus bas.
       Posée ici, elle survivait à un échec : l'unité était rétablie mais la
       ligne prétendait avoir porté l'acompte. */
  }

  /* LES TEXTES SUIVENT L'UNITÉ, L'ARGENT SUIT LA PERSONNE.

     Deux questions distinctes, que j'avais confondues.

     L'ARGENT — garantie encaissée, assurance payée, loyers versés —
     appartient à la personne. Un déménagement interne la conserve : c'est
     le même argent, simplement rattaché à un autre studio. D'où la
     condition `!demenagement` du bloc ci-dessus.

     LES SIX CHAMPS DE TEXTE, eux, sont attachés au STUDIO. Les notes du
     studio 1 parlent de celui qui l'occupait ; celles du déménageur sont
     restées dans le studio 7 qu'il vient de quitter. Un déménagement ne dit
     pas que l'unité garde son occupant — il dit que l'entrant vient
     d'ailleurs dans le parc. L'unité change bien de locataire.

     Les exclure du déménagement laissait donc Marc hériter des notes, de la
     police d'assurance et de l'ordre permanent de son prédécesseur — le
     risque de litige que ce même code invoque pour justifier la remise à
     vide. Corrigé le 05/09/2026.

     La condition est donc `changeDeLocataire`, pas `!demenagement` : seule
     une unité qui RESTE garde ses textes. */
  if (changeDeLocataire && premierVersement) {
    CHAMPS_TEXTE_UNITE.forEach(c => { u[c] = ''; });
  }

  /* LES DEUX ADRESSES, SELON LES TROIS CAS DÉCRITS PLUS HAUT.

     Locataire et garant suivent exactement la même règle : ce qui a été
     saisi dans la rentrée gagne ; à défaut, un déménageur emporte les
     siennes ; à défaut encore, on n'hérite pas de celles du sortant. */
  [['email', 'email'], ['emailGarant', 'emailGarant']].forEach(([champ, releve]) => {
    if (l[champ]) {
      u[champ] = l[champ];                /* saisie dans la rentrée */
    } else if (changeDeLocataire && premierVersement) {
      if (demenagement) {
        u[champ] = (l.apporte && l.apporte[releve]) || '';
      } else {
        u[champ] = '';                    /* celle du sortant n'est pas la sienne */
      }
    }
  });

  /* La date du dernier acompte a sa place dans garantieDatePaiement, posée
     plus haut. Le DÉBUT DU BAIL est celui qu'on a saisi. */
  if (l.debutBail) {
    u.debutBail = l.debutBail;
    /* LA FIN DE BAIL SUIT LE DÉBUT : douze mois moins un jour, comme tous
       les baux de l'exploitation. */
    const d = new Date(l.debutBail);
    if (!isNaN(d.getTime())) {
      d.setFullYear(d.getFullYear() + 1);
      d.setDate(d.getDate() - 1);
      u.finBail = d.toISOString().slice(0, 10);
    }
  }

  /* ON N'ENREGISTRE LE VERSEMENT QU'UNE FOIS LA SAUVEGARDE CONFIRMÉE.

     Si elle échoue, l'unité est remise dans son état d'avant et rien n'est
     noté : mieux vaut recommencer que croire un versement fait. */
  const r = await sauvegarderEtVerifier();
  if (!r.ok) {
    Object.keys(u).forEach(k => delete u[k]);
    Object.assign(u, instantaneAvant);
    if (typeof sauvegarderLocal === 'function') sauvegarderLocal();
    return dessinerVueRentree(`${u.designation} NON versée. ${r.message}`);
  }

  l.verseeLe = new Date().toISOString();
  l.verseeVers = moisAffiche;
  l.versePar = (typeof obtenirMonPrenom === 'function') ? obtenirMonPrenom() : '';
  /* Ce qui a été porté sur les loyers versés, pour signaler plus tard un
     acompte qui aurait bougé depuis. Avec les autres marques : rien n'est
     noté tant que la sauvegarde n'est pas confirmée. */
  if (changeDeLocataire && !avecGarantie && premierVersement && total) {
    l.acomptesPortes = total;
  }
  await enregistrerRentree();
  /* Pas de message en tête pour une réussite : la ligne elle-même porte
     désormais « Versée dans … », visible à l'endroit où l'on travaille. */
  dessinerVueRentree();
}

/* SAUVEGARDER ET VÉRIFIER QUE C'EST PARTI.

   sauvegarder() peut échouer sans lever d'erreur : conflit avec une autre
   personne, connexion perdue, vérification impossible. Elle écrit alors son
   avertissement dans « immeubles-container » — qui est MASQUÉ pendant
   l'écran de rentrée — et sort en silence.

   Sans ce contrôle, on annonçait « versée dans décembre » alors que rien
   n'était parti sur OneDrive. C'est exactement le scénario de la perte de
   données du 18/08. Défaut trouvé en simulation le 02/09/2026.

   On compare donc l'horodatage de la dernière sauvegarde avant et après :
   s'il n'a pas bougé, rien n'est parti, et on le dit. */
const CLE_SAUVEGARDE_APP = 'gestionLoyersDerniereSauvegarde';

async function sauvegarderEtVerifier() {
  if (typeof sauvegarder !== 'function') return { ok: false, message: "Sauvegarde indisponible." };
  const avant = localStorage.getItem(CLE_SAUVEGARDE_APP);
  try {
    await sauvegarder();
  } catch (e) {
    return { ok: false, message: String((e && e.message) || e) };
  }
  const apres = localStorage.getItem(CLE_SAUVEGARDE_APP);
  if (apres && apres !== avant) return { ok: true };
  return { ok: false, message:
    "La sauvegarde n'est pas partie sur OneDrive — conflit avec une autre personne, " +
    "ou connexion perdue. Reviens à l'écran principal pour voir le détail." };
}

/* Rétablit une unité dans l'état exact où elle était avant la fusion :
   un champ absent redevient absent, un champ nul redevient nul. */
/* RÉTABLIT L'UNITÉ DANS SON ÉTAT EXACT.

   L'instantané pris avant la fusion couvre TOUS les champs, y compris les
   six montants du bail. Une liste tenue à la main aurait oublié le loyer,
   les charges et l'assurance — c'est ce qui est arrivé en simulation le
   04/09/2026, où l'annulation laissait les montants du nouveau bail sur
   l'ancien locataire.

   Un champ absent avant redevient absent, un champ nul redevient nul. */
function retablirUnite(u, l) {
  /* N2 — PAS DE SORTIE SILENCIEUSE.

     Une ligne écrite par une version antérieure n'a pas d'instantané. La
     fonction sortait alors sans rien faire, mais l'annulation se poursuivait
     et se déclarait réussie : le locataire n'était pas rétabli, et l'écran
     reproposait de verser — ce qui aurait ajouté l'acompte une seconde fois.

     L'appelant vérifie désormais avant d'appeler. */
  if (!l.instantane) return false;
  Object.keys(u).forEach(k => delete u[k]);
  Object.assign(u, JSON.parse(JSON.stringify(l.instantane)));
  return true;
}

async function annulerVersementRentree(uniteId) {
  const l = ligneRentree(uniteId);
  const trouve = toutesUnitesRentree().find(x => x.unite.id === uniteId);
  if (!trouve) return;
  const u = trouve.unite;
  if (!l.verseeLe) return;   /* rien n'a été versé : rien à annuler */

  if (!l.instantane) {
    return dessinerVueRentree(
      `${u.designation} : impossible d'annuler. Ce versement vient d'une version ` +
      `antérieure du module, qui ne conservait pas l'état d'avant. ` +
      `Corrige l'unité à la main dans l'écran du mois, puis reviens ici.`);
  }

  /* ON N'ANNULE QUE DEPUIS LE MOIS OÙ L'ON A VERSÉ.

     appData contient les unités DU MOIS AFFICHÉ. Annuler depuis un autre
     mois rétablirait le locataire dans ce mois-là — qui ne l'a jamais eu —
     tout en laissant le mois du versement inchangé. Deux mois faux au lieu
     d'un. Défaut trouvé en simulation le 02/09/2026. */
  if (l.verseeVers !== moisAffiche) {
    return dessinerVueRentree(
      `${u.designation} a été versée dans ${l.verseeVers}. Place-toi sur ce mois pour annuler.`);
  }
  if (!confirm(`Annuler le versement de ${u.designation} ?\n\nLe locataire précédent est rétabli.`)) return;

  /* INSTANTANÉ COMPLET AVANT DE TOUCHER À QUOI QUE CE SOIT.

     La version précédente ne remettait qu'un seul champ sur cinq en cas
     d'échec : le nouveau locataire restait en place, mais avec la garantie
     du partant. Un état qui n'a jamais existé, et que rien à l'écran ne
     signalait — 400 € affichés comme encaissés alors qu'ils appartiennent
     à quelqu'un d'autre.

     Un instantané couvre aussi les champs qui viendraient à s'ajouter plus
     tard, sans qu'il faille penser à mettre une liste à jour. */
  const instantane = JSON.parse(JSON.stringify(u));
  retablirUnite(u, l);
  const r = await sauvegarderEtVerifier();
  if (!r.ok) {
    Object.keys(u).forEach(k => delete u[k]);
    Object.assign(u, instantane);
    /* ANOMALIE 6 : sauvegarder() a écrit dans le cache local avant
       d'échouer. On le remet d'aplomb, sinon il garde une annulation qui
       n'a pas eu lieu. */
    if (typeof sauvegarderLocal === 'function') sauvegarderLocal();
    return dessinerVueRentree(`Annulation impossible. ${r.message}`);
  }
  l.verseeLe = null; l.verseeVers = null; l.versePar = null;
  /* L'instantané ne sert qu'à défaire un versement : une fois l'annulation
     faite, il n'a plus d'objet et alourdit le fichier pour rien. */
  /* La décision de déménagement est liée à l'instantané : un versement
     refait doit repartir d'une décision neuve. */
  delete l.instantane;
  delete l.demenagement;
  delete l.apporte;
  /* Le report de l'acompte sur les loyers versés est défait avec le reste :
     un versement refait doit pouvoir le reposer. */
  delete l.acomptesPortes;
  /* Le choix du doublon se rouvre aussi : l'unité redevient modifiable, et
     la situation a pu changer entre-temps. */
  if (l.doublon) { l.doublon.choix = null; delete l.homonyme; }
  await enregistrerRentree();
  dessinerVueRentree(`Versement de ${u.designation} annulé.`);
}

/* REMISE À ZÉRO DU MOIS D'ESSAI.

   Les essais se font sur décembre 2026 : il faut pouvoir recommencer autant
   de fois qu'il le faut. Annule tous les versements d'un coup et rétablit
   les locataires précédents. */
async function remiseAZeroRentree() {
  /* Même règle que l'annulation unitaire : on ne défait que ce qui a été
     versé dans le mois où l'on se trouve. */
  const versees = Object.entries(donneesRentree.unites)
    .filter(([, l]) => l.verseeLe && l.verseeVers === moisAffiche);
  const ailleurs = Object.values(donneesRentree.unites)
    .filter(l => l.verseeLe && l.verseeVers !== moisAffiche).length;
  if (!versees.length) {
    return alert(ailleurs
      ? `Aucune unité versée dans ${libelleMois(moisAffiche)}.\n\n${ailleurs} l'ont été dans un autre mois : place-toi sur ce mois pour les annuler.`
      : 'Aucune unité versée.');
  }
  if (!confirm(`Annuler les ${versees.length} versement(s) de ${libelleMois(moisAffiche)} ?\n\nLes locataires précédents sont rétablis. Les contrôles cochés sont conservés.`)) return;

  const instantanes = [];
  const memoire = new Map();
  const sansInstantane = [];
  versees.forEach(([uniteId, l]) => {
    const trouve = toutesUnitesRentree().find(x => x.unite.id === uniteId);
    if (trouve && l.instantane) {
      instantanes.push({ unite: trouve.unite,
                         avant: JSON.parse(JSON.stringify(trouve.unite)) });
      retablirUnite(trouve.unite, l);
    } else if (trouve) {
      sansInstantane.push(trouve.unite.designation);
      return;                /* on n'annule pas ce qu'on ne sait pas défaire */
    }
    /* On conserve TOUT ce qui va être effacé : si la sauvegarde échoue, la
       décision de déménagement et le relevé doivent revenir avec le reste.
       Sans cela, un versement refait repartait d'une décision perdue. */
    memoire.set(l, { verseeLe: l.verseeLe, verseeVers: l.verseeVers,
                     versePar: l.versePar, instantane: l.instantane,
                     demenagement: l.demenagement, apporte: l.apporte,
                     choixDoublon: l.doublon ? l.doublon.choix : undefined,
                     homonyme: l.homonyme, acomptesPortes: l.acomptesPortes });
    l.verseeLe = null; l.verseeVers = null; l.versePar = null;
    delete l.instantane;
    delete l.demenagement;
    delete l.apporte;
    delete l.acomptesPortes;
    if (l.doublon) { l.doublon.choix = null; delete l.homonyme; }
  });

  const r = await sauvegarderEtVerifier();
  if (!r.ok) {
    /* On remet toutes les unités comme elles étaient avant la remise à
       zéro : versées. */
    instantanes.forEach(({ unite, avant }) => {
      Object.keys(unite).forEach(k => delete unite[k]);
      Object.assign(unite, avant);
    });
    versees.forEach(([, l]) => {
      const m = memoire.get(l);
      Object.assign(l, { verseeLe: m.verseeLe, verseeVers: m.verseeVers,
        versePar: m.versePar, instantane: m.instantane,
        demenagement: m.demenagement, apporte: m.apporte, homonyme: m.homonyme,
        acomptesPortes: m.acomptesPortes });
      if (l.doublon) l.doublon.choix = m.choixDoublon;
    });
    if (typeof sauvegarderLocal === 'function') sauvegarderLocal();
    return dessinerVueRentree(
      `Remise à zéro non enregistrée. ${r.message} Recharge le mois avant de recommencer.`);
  }
  await enregistrerRentree();
  dessinerVueRentree(`${instantanes.length} versement(s) annulé(s).` +
    (sansInstantane.length
      ? ` ${sansInstantane.length} n'ont pas pu l'être (version antérieure) : ${
          sansInstantane.join(', ')}.`
      : ''));
}

/* ---- La liste des manques ---------------------------------------------- */

async function ouvrirVueManques() {
  if (!donneesRentree) {
    if (typeof estConnecte !== 'function' || !estConnecte()) {
      alert("Connecte-toi à OneDrive avant d'ouvrir la rentrée.");
      return;
    }
    const d = await chargerRentree(anneeRentreeAffichee || anneeRentree());
    if (!d) return;
    donneesRentree = d;
    anneeRentreeAffichee = donneesRentree.annee;
  }
  const liste = manquesRentree();
  const c = comptesRentree();

  const parImmeuble = {};
  liste.forEach(m => (parImmeuble[m.immeubleNom] = parImmeuble[m.immeubleNom] || []).push(m));

  let html = `<div class="vue-rentree">
    <div class="rentree-entete">
      <button class="btn-connexion" onclick="ouvrirVueRentree()">Retour</button>
      <h2>Ce qui manque</h2>
    </div>
    <p class="rentree-resume">${c.locataires} locataire${c.locataires > 1 ? 's' : ''} · ${
      c.documents} document${c.documents > 1 ? 's' : ''} — rentrée ${donneesRentree.annee}</p>`;

  if (!liste.length) {
    html += `<p class="rentree-rien">Rien ne manque. Tout est prêt pour la rentrée.</p>`;
  } else {
    Object.keys(parImmeuble).forEach(nom => {
      html += `<p class="rentree-immeuble">${echapperR(nom)}</p>`;
      parImmeuble[nom].forEach(m => {
        html += `<div class="manque-ligne${m.inoccupe ? ' inoccupe' : ''}">
          <p class="manque-qui">${echapperR(
            m.ligne.locataireSuivant || (m.inoccupe ? 'INOCCUPÉ' : 'remplaçant inconnu'))}
            <span>${echapperR(m.unite.designation)}</span>${
            m.versee ? `<span class="manque-versee">déjà versée</span>` : ''}</p>
          <p class="manque-quoi">${m.manquants.map(x =>
            `<span>${echapperR(x)}</span>`).join('')}</p>
        </div>`;
      });
    });
  }
  html += `</div>`;
  const zone = document.getElementById('vue-rentree-conteneur');
  if (!zone) return;
  zone.innerHTML = html;
  zone.style.display = 'block';
  masquerFondRentree(true);
  window.scrollTo(0, 0);
}

/* ---- Le document de remise des clés ------------------------------------

   Un fichier HTML portant l'extension .doc : Word l'ouvre sans difficulté,
   et l'application n'a besoin d'aucune bibliothèque extérieure. Elle ne
   dépend aujourd'hui que de Microsoft, et je n'y ajoute pas de script tiers.

   Il est affiché à l'écran, puis déposé dans OneDrive sous deux formes,
   Word et PDF, dans le dossier EDLE du locataire — au même endroit que son
   bail et son état des lieux. Une pièce communiquée à un locataire doit
   rester ce qu'elle était le jour de l'envoi. */

/* LES TROIS COMPTES BANCAIRES, selon le propriétaire de l'immeuble. */
const COMPTES = {
  havre:   { iban: 'BE73 0018 2894 1060', titulaire: 'SAMADHI SA' },
  egmont:  { iban: 'BE03 0015 4693 5384', titulaire: 'GERARD JULIEN' },
  defaut:  { iban: 'BE45 0014 6988 8789', titulaire: 'GERARD JEAN-MARC' },
};

function compteDe(immeubleId) {
  const id = String(immeubleId || '').toLowerCase();
  if (id.includes('havre')) return COMPTES.havre;
  if (id.includes('egmont')) return COMPTES.egmont;
  return COMPTES.defaut;
}

/* CE QUI DOIT ÊTRE PRÉSENT POUR ÉCRIRE AU LOCATAIRE.

   Le document annonce des montants à verser sur un compte : incomplet, il
   ferait payer une somme fausse. Mieux vaut refuser et dire quoi. */
function manquePourLesCles(immeubleId, unite, l) {
  const m = [];
  if (!l.locataireSuivant) m.push('le nom du locataire');
  if (!aUneAdresse(l)) m.push('un courriel — locataire ou garant');
  else if (!adressesPlausibles(l)) m.push('un courriel valable');
  if (!l.debutBail) m.push('la date de début du bail');
  if (doublonEnAttente(l)) m.push('la réponse au nom en double');
  montantsApplicables(immeubleId, unite.designation).forEach(x => {
    if (!montantValable(l.montants[x.cle])) m.push('le montant : ' + x.libelle);
  });

  /* UN DÉMÉNAGEMENT SANS RELEVÉ NE PEUT RIEN DÉDUIRE.

     Une ligne écrite avant les trois réponses au doublon n'a ni décision ni
     relevé : le document reconnaissait le déménagement mais ne déduisait ni
     la garantie ni l'assurance apportées. Marc recevait une demande de
     1 400 € au lieu de 1 000. Constaté le 06/09/2026.

     Retaper le nom sur la ligne reconstitue le relevé. */
  if (estUnDemenagement(l, unite.id) && l.statut !== 'reste' &&
      !(l.apporte || (l.doublon && l.doublon.releve))) {
    m.push('le relevé de ce que le locataire apporte — retape son nom sur la ligne');
  }

  /* Un acompte qui bloque le versement bloque aussi le document : il y
     figurerait en déduction d'une somme qui ne sera jamais encaissée. */
  if (acompteNegatif(l)) {
    m.push('un acompte qui soit un montant valable');
  }
  if (acompteTropGrand(immeubleId, unite, l)) {
    m.push(`un acompte au plus égal au loyer (${
      totalAcomptes(l).toFixed(2)} € pour un loyer de ${
      Number(l.montants.loyer).toFixed(2)} €)`);
  }
  return m;
}

function eur(n) {
  return Number(n || 0).toLocaleString('fr-BE',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function dateHeureCourte(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' à ' + d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
}

function dateFr(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-BE');
}

/* LE NOM DU FICHIER : immeuble, unité, locataire.

   Trois pièges rencontrés en simulation le 06/09/2026 :

     — une désignation sans chiffre — « RDC NIMY », « APPART BICHE » — était
       tronquée à six caractères et donnait « RDC-NI » ;
     — un nom composé — « VAN DER BERG », « DE SMET » — perdait ses premiers
       mots, dont il ne restait que « BERG » ;
     — l'immeuble figurait deux fois quand la désignation le contenait déjà :
       « NIMY-RDC-NIMY ».

   On garde donc la désignation entière, débarrassée du nom de l'immeuble
   qu'elle répète, et le nom complet du locataire. */
/* LA DÉSIGNATION SANS LE NOM DE L'IMMEUBLE QU'ELLE RÉPÈTE.

   « RDC NIMY » dans l'immeuble NIMY donne « RDC ». Sert au nom de fichier
   et à la communication de virement, qui avaient chacun leur version. */
function uniteSansImmeuble(immeubleNom, designation) {
  let d = String(designation || '').trim();
  String(immeubleNom || '').split(/\s+/).forEach(mot => {
    const m = mot.replace(/[^A-Za-zÀ-ÿ0-9]/g, '');
    if (m.length > 2) d = d.replace(new RegExp('\\b' + m + '\\b', 'gi'), '');
  });
  return d.replace(/\s+/g, ' ').trim() || String(designation || '').trim();
}

function nomFichierCles(immeubleNom, unite, nom) {
  const propre = (t) => String(t || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').toUpperCase();

  const im = propre(immeubleNom);
  /* La désignation porte souvent le nom de l'immeuble : on l'ôte pour ne pas
     l'écrire deux fois. */
  let u = propre(unite.designation);
  im.split('-').forEach(mot => {
    if (mot.length > 2) u = u.replace(new RegExp('-?' + mot + '(?=-|$)', 'g'), '');
  });
  u = u.replace(/^-+|-+$/g, '').replace(/-+/g, '-') || 'UNITE';

  /* L'EXTENSION DIT CE QUE LE FICHIER EST.
     « .doc » sur du HTML : Word l'ouvrait, l'iPhone non, et OneDrive ne
     savait pas l'afficher. Le nom de base porte désormais l'extension du
     vrai fichier Word ; le PDF prend la même racine. */
  return `${im}-${u}-${propre(nom)}.docx`;
}

/* LE DOCUMENT LUI-MÊME.

   Trois blocs, dans l'ordre où le locataire se pose les questions : ce
   qu'il paiera chaque mois, ce qu'il doit avant les clés, comment payer.

   AUCUNE EXPLICATION DU CALCUL DES CHARGES : le détail figure dans
   l'avenant au bail, et le répéter ici l'exposerait à diverger. */

/* ---- LE DOSSIER DU LOCATAIRE ------------------------------------------

   Le document ne va plus dans un dossier à part : il rejoint la pièce à
   laquelle il se rapporte, dans l'arborescence des immeubles —

     Immobilier 2025-2026 / <immeuble> / <studio> / <locataire> / EDLE

   C'est le même chemin que les baux et les états des lieux, et le même
   mécanisme que les documents de garantie déposés depuis la fiche.

   Une différence tient : le locataire ARRIVE. Son dossier n'existe pas
   encore, et obtenirRefLocataire ne sait que chercher — elle lève une
   erreur quand elle ne trouve rien. On crée donc ce qui manque, sous le
   nom exactement tel qu'il a été saisi dans la rentrée, débarrassé des
   caractères que OneDrive refuse. */
function nomDossierPropre(nom) {
  return String(nom || '').replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

async function dossierEnfant(refParent, nom) {
  const enfants = await enfantsDeRef(refParent);
  const existe = enfants.find(e => (e.folder || e.remoteItem) &&
    normaliserNom(e.name) === normaliserNom(nom));
  if (existe) return { ref: refDe(existe, refParent.driveId), cree: false };

  /* UN SEUL MOT COMMUN NE FAIT PAS LE MÊME LOCATAIRE.

     La recherche d'un dossier existant se fait ailleurs sur un mot commun,
     ce qui convient pour RETROUVER quelqu'un déjà en place. Mais pour
     RANGER la pièce d'un arrivant, ce critère est faux : « MARTIN Olivia »
     et « MARTIN Pierre » partagent MARTIN, et le document de la nouvelle
     serait déposé dans le dossier du sortant — sans que rien ne le
     signale. Constaté le 06/09/2026.

     On exige donc que TOUS les mots significatifs du nom se retrouvent
     dans celui du dossier. À défaut, on en crée un : un dossier de trop se
     voit et se corrige, une pièce classée chez un autre, non. */
  const mots = normaliserNom(nom).split(' ').filter(m => m.length >= 3);
  const proche = mots.length ? enfants.find(e => (e.folder || e.remoteItem) &&
    mots.every(m => normaliserNom(e.name).includes(m))) : null;
  if (proche) return { ref: refDe(proche, refParent.driveId), cree: false };

  const url = refParent.driveId
    ? `/drives/${refParent.driveId}/items/${refParent.id}/children`
    : `/me/drive/items/${refParent.id}/children`;
  const res = await appelGraph(url, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nomDossierPropre(nom), folder: {},
      '@microsoft.graph.conflictBehavior': 'rename' }) });
  if (!res || !res.ok) {
    throw new Error(`création du dossier « ${nom} » : ` +
      (typeof detailErreur === 'function' ? await detailErreur(res) : 'refus de Microsoft'));
  }
  const item = await res.json();
  return { ref: refDe(item, refParent.driveId), cree: true };
}

/* ON REGARDE OÙ L'ON VA AVANT D'Y ÉCRIRE.

   Quatre doutes peuvent peser sur la destination, et aucun ne se voyait :

     — le dossier du locataire n'existe pas et va être CRÉÉ. C'était
       signalé, mais APRÈS coup : si le dossier existait sous un nom que
       l'application n'a pas reconnu, on se retrouvait avec deux dossiers
       pour la même personne, et on l'apprenait une fois la pièce écrite ;
     — un dossier est retenu sur une correspondance APPROCHANTE : « Olivia
       MARTIN » retrouve « MARTIN Olivia », ce qui est voulu, mais rien ne
       disait que le nom trouvé n'était pas celui qu'on avait tapé ;
     — PLUSIEURS dossiers pourraient convenir : le premier gagnait, en
       silence ;
     — le dossier de l'UNITÉ lui-même est ambigu, « RDC » pouvant désigner
       le résidentiel ou le commercial.

   Cette fonction ne crée rien : elle rend le chemin envisagé et la liste
   des doutes. La décision revient à Gérard. */
async function preparerDossierEdle(immeubleId, immeubleNom, unite, l) {
  const refImmeuble = await obtenirRefImmeuble(immeubleId);
  const enfantsImm = await enfantsDeRef(refImmeuble);
  const trouveUnite = await trouverRefUnite(enfantsImm, refImmeuble,
    unite.designation, unite.locataire);
  if (!trouveUnite) throw new Error(`dossier de l'unité « ${unite.designation} » introuvable`);
  const nomUnite = (trouveUnite.item && trouveUnite.item.name) || unite.designation;

  /* LE CHEMIN MONTRÉ DOIT ÊTRE CELUI DE ONEDRIVE, PAS CELUI DE L'APPLICATION.

     Les dossiers ne portent pas les noms de l'application : « Petite
     Guirlande » s'appelle PTG, « La Fermette » s'appelle Pourcelet
     Fermette, « HAVRE » s'écrit Havré. La confirmation annonçait donc une
     destination fausse pour trois immeubles sur sept — et c'est
     précisément ce qu'elle est censée montrer. Constaté le 06/09/2026. */
  const nomImmeubleOneDrive =
    (typeof DOSSIER_ONEDRIVE_PAR_IMMEUBLE === 'object'
      && DOSSIER_ONEDRIVE_PAR_IMMEUBLE[immeubleId]) || immeubleNom;
  const racine = (typeof DOSSIER_RACINE_PARTAGE === 'string')
    ? DOSSIER_RACINE_PARTAGE : 'Immobilier';

  /* CES DEUX NOMS-LÀ NE SONT PAS UN DOUTE : CE SONT DES ÉQUIVALENCES CONNUES.

     L'application appelle « Petite Guirlande » ce que OneDrive appelle PTG,
     et « La Fermette » ce qu'il appelle Pourcelet Fermette. La table de
     correspondance des sept immeubles existe depuis toujours dans le module
     de lecture OneDrive : c'est elle qui sert à trouver les dossiers.

     Je les signalais comme un doute — un avertissement se serait affiché à
     chaque document de PTG, de la Fermette et de Havré, sur un écart
     parfaitement normal. Un avertissement qui crie au loup à chaque fois
     n'est plus lu quand il a raison. Corrigé le 06/09/2026 : on le dit,
     sans alerter. */
  const doutes = [], equivalences = [];
  if (normaliserNom(nomImmeubleOneDrive) !== normaliserNom(immeubleNom)) {
    equivalences.push(`« ${immeubleNom} » se range dans le dossier « ${
      nomImmeubleOneDrive} »`);
  }
  if (normaliserNom(nomUnite) !== normaliserNom(unite.designation)) {
    doutes.push(`le dossier de l'unité s'appelle « ${nomUnite} » et non « ${unite.designation} »`);
  }

  const enfantsUnite = await enfantsDeRef(trouveUnite.ref);
  const dossiers = enfantsUnite.filter(e => e.folder || e.remoteItem);
  const cible = normaliserNom(l.locataireSuivant);
  const mots = cible.split(' ').filter(m => m.length >= 3);

  const exact = dossiers.find(d => normaliserNom(d.name) === cible);
  const proches = mots.length
    ? dossiers.filter(d => mots.every(m => normaliserNom(d.name).includes(m)))
    : [];

  let refLoc = null, nomLoc = nomDossierPropre(l.locataireSuivant), creerLoc = false;
  if (exact) {
    refLoc = refDe(exact, trouveUnite.ref.driveId);
    nomLoc = exact.name;
  } else if (proches.length === 1) {
    refLoc = refDe(proches[0], trouveUnite.ref.driveId);
    nomLoc = proches[0].name;
    doutes.push(`le dossier retenu s'appelle « ${nomLoc} », et non « ${l.locataireSuivant} »`);
  } else if (proches.length > 1) {
    refLoc = refDe(proches[0], trouveUnite.ref.driveId);
    nomLoc = proches[0].name;
    doutes.push(`${proches.length} dossiers pourraient convenir (${
      proches.map(p => p.name).join(', ')}) — « ${nomLoc} » a été retenu`);
  } else {
    creerLoc = true;
    doutes.push(`aucun dossier pour ce locataire : « ${nomLoc} » sera CRÉÉ`);
  }

  let refEdle = null, creerEdle = true;
  if (refLoc) {
    const sous = await enfantsDeRef(refLoc);
    const e = sous.find(x => (x.folder || x.remoteItem) && normaliserNom(x.name) === 'EDLE');
    if (e) { refEdle = refDe(e, refLoc.driveId); creerEdle = false; }
  }
  if (creerEdle) doutes.push('le sous-dossier EDLE sera créé');

  return { refUnite: trouveUnite.ref, nomUnite, refLoc, nomLoc, creerLoc,
           refEdle, creerEdle, doutes, equivalences,
           chemin: `${racine} / ${nomImmeubleOneDrive} / ${nomUnite} / ${nomLoc} / EDLE` };
}

/* Crée ce qui manque, une fois la destination confirmée. */
async function creerDossierEdle(plan) {
  let refLoc = plan.refLoc;
  if (!refLoc) refLoc = (await dossierEnfant(plan.refUnite, plan.nomLoc)).ref;
  if (plan.refEdle) return plan.refEdle;
  return (await dossierEnfant(refLoc, 'EDLE')).ref;
}

/* ---- LE DOCUMENT EN VRAI FICHIER WORD ---------------------------------

   Le document était déposé en « .doc » : du HTML sous une extension que
   Word accepte sur PC. L'iPhone n'en fait rien, et OneDrive ne sait pas
   l'afficher — le fichier se sauvait, et il n'y avait rien à voir.
   Constaté par Gérard le 06/09/2026.

   Un vrai .docx règle les deux, et il en règle un troisième : Microsoft
   convertit lui-même un .docx en PDF, gratuitement, par l'interface
   stable de Graph. Le HTML, lui, n'y figure pas — seulement en version
   beta, avec des défauts connus. Le détour par Word est donc le chemin le
   plus court vers le PDF.

   La recette est celle de Charges & Compteurs, éprouvée depuis des mois :
   les sept pièces d'un paquet Office, compressées par JSZip. */

const DOCX_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

const DOCX_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

const DOCX_DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const DOCX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr>
    <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>
    <w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="fr-BE"/>
  </w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
</w:styles>`;

const DOCX_CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Montant à verser avant la remise des clés</dc:title>
  <dc:creator>Gestion Loyers</dc:creator>
</cp:coreProperties>`;

/* Word veut du XML valide : cinq caractères doivent être protégés, faute de
   quoi un nom contenant « & » ou « < » rend le fichier illisible sans le
   moindre message. */
function xmlEch(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/* Les tailles de Word sont en DEMI-points : 22 vaut 11 points. */
function dxP(texte, o = {}) {
  const rPr = `${o.bold ? '<w:b/>' : ''}${o.italic ? '<w:i/>' : ''}` +
    `${o.color ? `<w:color w:val="${o.color}"/>` : ''}` +
    `${o.size ? `<w:sz w:val="${o.size}"/><w:szCs w:val="${o.size}"/>` : ''}` +
    `${o.caps ? '<w:caps/>' : ''}`;
  const pPr = `${o.align ? `<w:jc w:val="${o.align}"/>` : ''}` +
    `<w:spacing w:before="${o.before || 0}" w:after="${o.after == null ? 60 : o.after}"/>`;
  return `<w:p><w:pPr>${pPr}</w:pPr><w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}` +
    `<w:t xml:space="preserve">${xmlEch(texte)}</w:t></w:r></w:p>`;
}

function dxCell(paras, o = {}) {
  const bords = o.hautLigne
    ? `<w:tcBorders><w:top w:val="single" w:sz="4" w:color="C9C4BB"/></w:tcBorders>` : '';
  return `<w:tc><w:tcPr><w:tcW w:w="${o.w || 0}" w:type="dxa"/>` +
    `${o.bg ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.bg}"/>` : ''}` +
    `${bords}${o.marges ? '<w:tcMar><w:top w:w="120" w:type="dxa"/><w:bottom w:w="120" w:type="dxa"/>' +
      '<w:left w:w="160" w:type="dxa"/><w:right w:w="160" w:type="dxa"/></w:tcMar>' : ''}` +
    `</w:tcPr>${paras}</w:tc>`;
}

/* Aucune bordure par défaut : ce document est une lettre, pas un tableau
   comptable. Seules les lignes de total en portent une, en haut. */
function dxTable(lignes, cols) {
  const grid = cols.map(w => `<w:gridCol w:w="${w}"/>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${cols.reduce((a, b) => a + b, 0)}" w:type="dxa"/>` +
    `<w:tblBorders><w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/>` +
    `<w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/></w:tblBorders>` +
    `<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>` +
    `</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${lignes.join('')}</w:tbl>`;
}

const LARG_LIB = 6900, LARG_MT = 2738;

function documentClesDocxXml(immeubleId, immeubleNom, unite, l) {
  const c = chiffresCles(immeubleId, immeubleNom, unite, l);
  const GRIS = '7A7A7A', BLEU = '1B3A52', VERT = '1F7A4D';

  /* une ligne « libellé … montant » */
  const lig = (lib, montant, o = {}) => montant == null ? '' :
    `<w:tr>${
      dxCell(dxP(lib, { size: 20, bold: o.bold, color: o.color, after: 40 }),
        { w: LARG_LIB, hautLigne: o.trait })}${
      dxCell(dxP(eur(montant), { size: 20, bold: o.bold, color: o.color, align: 'right', after: 40 }),
        { w: LARG_MT, hautLigne: o.trait })}</w:tr>`;

  const tableauLoyer = dxTable([
    lig('Loyer', c.loyer),
    lig('Provision de charges', c.charges),
    lig('Poubelles', c.poubelles),
    lig('Wifi', c.wifi),
    c.detaille ? lig('Loyer charges comprises', c.loyerCC, { bold: true, trait: true }) : '',
  ].filter(Boolean), [LARG_LIB, LARG_MT]);

  const deductions = (l.acomptes || []).filter(a => a.montant).map(a =>
    lig('Acompte versé' + (a.date ? ' le ' + dateFr(a.date) : ''), -a.montant, { color: VERT }))
    .join('');

  const tableauDu = dxTable([
    lig('Garantie locative', c.garantie),
    lig(c.detaille ? 'Premier mois de loyer, charges comprises' : 'Premier mois de loyer', c.loyerCC),
    lig('Assurance', c.assurance),
    lig('Total', c.total, { trait: true }),
    deductions,
    c.dejaGarantie ? lig('Garantie déjà versée' +
      (c.apporte && c.apporte.venantDe ? ' pour ' + c.apporte.venantDe : ''),
      -c.dejaGarantie, { color: VERT }) : '',
    c.dejaAssurance ? lig('Assurance déjà payée', -c.dejaAssurance, { color: VERT }) : '',
  ].filter(Boolean), [LARG_LIB, LARG_MT]);

  const titreReste = c.reste > 0 ? 'Reste à payer'
    : c.reste < 0 ? 'Trop-perçu, à vous rembourser' : 'Rien à verser — tout est réglé';
  const fondReste = c.reste < 0 ? 'FBF3E0' : 'E4EFDC';
  const encreReste = c.reste < 0 ? '6B4E11' : '2E4522';

  const blocReste = dxTable([`<w:tr>${
    dxCell(dxP(titreReste, { size: 24, bold: true, color: encreReste, after: 0 }),
      { w: LARG_LIB, bg: fondReste, marges: true })}${
    dxCell(dxP(eur(Math.abs(c.reste)), { size: 32, bold: true, color: encreReste, align: 'right', after: 0 }),
      { w: LARG_MT, bg: fondReste, marges: true })}</w:tr>`], [LARG_LIB, LARG_MT]);

  const blocBandeau = dxTable([`<w:tr>${
    dxCell(dxP(unite.designation, { size: 26, bold: true, color: BLEU, after: 40 }) +
           dxP(`${l.locataireSuivant} · bail du ${dateFr(l.debutBail)}` +
               (c.finBail ? ' au ' + c.finBail : ''), { size: 20, color: '2F5A78', after: 0 }),
      { w: LARG_LIB + LARG_MT, bg: 'DCE9F5', marges: true })}</w:tr>`], [LARG_LIB + LARG_MT]);

  const blocPaiement = dxTable([`<w:tr>${
    dxCell(
      dxP('Comment payer', { size: 20, bold: true, after: 60 }) +
      dxP(`Par virement sur le compte ${c.compte.iban} au nom de ${c.compte.titulaire}, ` +
          `avec la communication « ${c.comm} ».`, { size: 20, after: 80 }) +
      dxP((c.reste > 0
            ? 'La totalité doit être réglée avant la remise des clés. '
            : "Il n'y a rien à verser avant la remise des clés. ") +
          "Celles-ci vous seront remises contre signature de l'état des lieux d'entrée.",
        { size: 20, after: 0 }),
      { w: LARG_LIB + LARG_MT, bg: 'F4F1EA', marges: true })}</w:tr>`], [LARG_LIB + LARG_MT]);

  return [
    dxP(`${c.compte.titulaire} — Gestion locative`, { size: 16, color: GRIS, caps: true, after: 40 }),
    dxP('Montant à verser avant la remise des clés', { size: 32, bold: true, color: BLEU, after: 200 }),
    blocBandeau,
    dxP('', { after: 160 }),
    dxP(c.detaille ? 'VOTRE LOYER MENSUEL' : 'VOTRE LOYER', { size: 16, color: GRIS, after: 60 }),
    tableauLoyer,
    dxP('', { after: 160 }),
    dxP('À VERSER AVANT LA REMISE DES CLÉS', { size: 16, color: GRIS, after: 60 }),
    tableauDu,
    dxP('', { after: 140 }),
    blocReste,
    dxP('', { after: 140 }),
    c.demenage ? dxP('Vous changez de logement au sein du même parc : la garantie et ' +
      "l'assurance déjà versées vous suivent et sont déduites ci-dessus.",
      { size: 20, color: '4A4A4A', after: 160 }) : '',
    blocPaiement,
    dxP('', { after: 120 }),
    dxP("Le détail du calcul des charges figure dans l'avenant à votre bail. " +
        `Document établi le ${dateFr(new Date().toISOString().slice(0, 10))}.`,
      { size: 16, italic: true, color: GRIS, after: 0 }),
  ].filter(Boolean).join('');
}

async function construireDocxCles(immeubleId, immeubleNom, unite, l) {
  /* JSZip est déposé DANS le dépôt, pas chargé depuis un serveur extérieur :
     le jour où celui-ci ne répond pas, le bouton doit continuer de marcher.
     S'il manque quand même, on le dit — on ne produit pas un fichier vide. */
  if (typeof JSZip !== 'function') {
    throw new Error("le composant de compression n'est pas chargé (jszip.min.js manquant)");
  }
  const corps = documentClesDocxXml(immeubleId, immeubleNom, unite, l);
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${corps}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
</w:body></w:document>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', DOCX_TYPES);
  zip.folder('_rels').file('.rels', DOCX_RELS);
  zip.folder('word').file('document.xml', documentXml);
  zip.folder('word').file('styles.xml', DOCX_STYLES);
  zip.folder('word/_rels').file('document.xml.rels', DOCX_DOC_RELS);
  zip.folder('docProps').file('core.xml', DOCX_CORE);
  return zip.generateAsync({ type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

/* ---- LE PDF, FABRIQUÉ PAR ONEDRIVE ------------------------------------

   Microsoft convertit lui-même un .docx en PDF : une requête sur le fichier
   déjà déposé, avec format=pdf. Gratuit, sans service tiers, sans scénario.
   Le HTML n'est pas accepté par l'interface stable — c'est la raison pour
   laquelle on passe par Word. */
async function pdfDepuisOneDrive(item) {
  const url = item.parentReference && item.parentReference.driveId
    ? `/drives/${item.parentReference.driveId}/items/${item.id}/content?format=pdf`
    : `/me/drive/items/${item.id}/content?format=pdf`;
  const res = await appelGraph(url, { method: 'GET' });
  if (!res || !res.ok) {
    throw new Error(res && typeof detailErreur === 'function'
      ? await detailErreur(res) : 'conversion refusée');
  }
  return await res.blob();
}

/* LES CHIFFRES DU DOCUMENT, CALCULÉS UNE SEULE FOIS.

   Le document existe désormais sous deux formes : la page affichée à
   l'écran et le fichier Word déposé dans OneDrive. Deux calculs séparés
   auraient fini par se contredire — c'est la faute que j'ai trouvée trois
   fois dans ce module. Les deux formes lisent donc les mêmes chiffres. */
function chiffresCles(immeubleId, immeubleNom, unite, l) {
  const mts = montantsApplicables(immeubleId, unite.designation);
  const val = (cle) => {
    const m = mts.find(x => x.cle === cle);
    return m && l.montants[cle] != null ? Number(l.montants[cle]) : null;
  };

  const loyer = val('loyer'), charges = val('charges');
  const poubelles = val('poubelles'), wifi = val('wifi');
  const assurance = val('assurance'), garantie = val('garantie');

  const loyerCC = (loyer || 0) + (charges || 0) + (poubelles || 0) + (wifi || 0);
  const total = (garantie || 0) + loyerCC + (assurance || 0);

  /* CE QUI A DÉJÀ ÉTÉ VERSÉ : les acomptes, et pour un déménagement interne
     la garantie et l'assurance payées dans l'ancien studio, qui suivent la
     personne. Sans cette déduction on réclamait deux fois la garantie. */
  const demenage = estUnDemenagement(l, unite.id) && l.statut !== 'reste';
  const apporte = demenage
    ? (l.apporte || (l.doublon && l.doublon.releve) || null)
    : null;
  const dejaGarantie = apporte && apporte.garantieEncaissee || 0;
  const dejaAssurance = apporte && apporte.assuranceEncaissee || 0;
  const verse = totalAcomptes(l) + dejaGarantie + dejaAssurance;

  /* UN RESTE NÉGATIF SE DIT AUTREMENT : si les acomptes dépassent le dû, ou
     si la garantie transférée couvre plus que le total, « Reste à payer
     −270,00 € » n'a pas de sens. On annonce un trop-perçu. */
  const reste = total - verse;

  const compte = compteDe(immeubleId);
  /* LA COMMUNICATION DOIT DÉSIGNER L'UNITÉ. Elle ne gardait que les
     chiffres : « RDC NIMY », « GARAGE » n'en ont pas, et la communication
     devenait « NIMY  — MARC », sans dire quelle unité. */
  const numero = (unite.designation.match(/\d+/) || [''])[0]
    || uniteSansImmeuble(immeubleNom, unite.designation);
  const comm = `${immeubleNom} ${numero} — ${l.locataireSuivant}`
    .replace(/\s+/g, ' ').trim().toUpperCase();

  const finBail = (() => {
    const d = new Date(l.debutBail);
    if (isNaN(d.getTime())) return '';
    d.setFullYear(d.getFullYear() + 1); d.setDate(d.getDate() - 1);
    return dateFr(d.toISOString().slice(0, 10));
  })();

  const detaille = charges != null || poubelles != null || wifi != null;

  return { loyer, charges, poubelles, wifi, assurance, garantie, loyerCC,
           total, demenage, apporte, dejaGarantie, dejaAssurance, verse,
           reste, compte, comm, finBail, detaille };
}

function documentCles(immeubleId, immeubleNom, unite, l) {
  const c = chiffresCles(immeubleId, immeubleNom, unite, l);
  const { loyer, charges, poubelles, wifi, assurance, garantie, loyerCC,
          total, demenage, apporte, dejaGarantie, dejaAssurance,
          reste, compte, comm, finBail } = c;

  const ligne = (lib, montant, gras) => montant == null ? '' :
    `<tr><td style="padding:4px 0;${gras ? 'font-weight:bold' : ''}">${lib}</td>
     <td align="right" style="padding:4px 0;${gras ? 'font-weight:bold' : ''}">${eur(montant)}</td></tr>`;

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:w="urn:schemas-microsoft-com:office:word"><head>
    <meta charset="utf-8"><title>Remise des clés</title>
    <style>
      body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #1a1a1a; }
      .entete { font-size: 8pt; letter-spacing: 1pt; color: #7a7a7a;
        text-transform: uppercase; }
      h1 { font-size: 16pt; color: #1B3A52; margin: 4pt 0 14pt; }
      .bandeau { background: #DCE9F5; border-left: 4pt solid #4A7FA8;
        padding: 8pt 10pt; margin-bottom: 12pt; }
      .bandeau .u { font-size: 13pt; font-weight: bold; color: #1B3A52; }
      .bandeau .q { font-size: 10pt; color: #2F5A78; }
      .titre { font-size: 8pt; letter-spacing: 1pt; color: #7a7a7a;
        text-transform: uppercase; margin: 12pt 0 4pt; }
      table { width: 100%; border-collapse: collapse; }
      .sep td { border-top: 0.5pt solid #c9c4bb; }
      .reste { background: #E4EFDC; border-left: 4pt solid #6B9455;
        padding: 10pt; margin: 10pt 0 14pt; }
      .paiement { background: #F4F1EA; padding: 9pt 10pt; }
      .pied { font-size: 8pt; color: #7a7a7a; margin-top: 14pt; }
    </style></head><body>

    <p class="entete">${echapperR(compte.titulaire)} — Gestion locative</p>
    <h1>Montant à verser avant la remise des clés</h1>

    <div class="bandeau">
      <div class="u">${echapperR(unite.designation)}</div>
      <div class="q">${echapperR(l.locataireSuivant)} · bail du ${
        dateFr(l.debutBail)}${finBail ? ' au ' + finBail : ''}</div>
    </div>

    <p class="titre">${charges != null || poubelles != null || wifi != null
      ? 'Votre loyer mensuel' : 'Votre loyer'}</p>
    <table>
      ${ligne('Loyer', loyer)}
      ${ligne('Provision de charges', charges)}
      ${ligne('Poubelles', poubelles)}
      ${ligne('Wifi', wifi)}
      ${charges != null || poubelles != null || wifi != null
        ? `<tr class="sep"><td style="padding:6pt 0;font-weight:bold">Loyer charges comprises</td>
           <td align="right" style="padding:6pt 0;font-weight:bold">${eur(loyerCC)}</td></tr>`
        : ''}
    </table>

    <p class="titre">À verser avant la remise des clés</p>
    <table>
      ${ligne('Garantie locative', garantie)}
      ${ligne(charges != null || poubelles != null || wifi != null
        ? 'Premier mois de loyer, charges comprises'
        : 'Premier mois de loyer', loyerCC)}
      ${ligne('Assurance', assurance)}
      <tr class="sep"><td style="padding:6pt 0">Total</td>
        <td align="right" style="padding:6pt 0">${eur(total)}</td></tr>
      ${(l.acomptes || []).filter(a => a.montant).map(a =>
        `<tr><td style="padding:4px 0;color:#1F7A4D">Acompte versé${
          a.date ? ' le ' + dateFr(a.date) : ''}</td>
         <td align="right" style="padding:4px 0;color:#1F7A4D">− ${eur(a.montant)}</td></tr>`).join('')}
      ${dejaGarantie ? `<tr><td style="padding:4px 0;color:#1F7A4D">Garantie déjà versée${
        apporte.venantDe ? ' pour ' + echapperR(apporte.venantDe) : ''}</td>
        <td align="right" style="padding:4px 0;color:#1F7A4D">− ${eur(dejaGarantie)}</td></tr>` : ''}
      ${dejaAssurance ? `<tr><td style="padding:4px 0;color:#1F7A4D">Assurance déjà payée</td>
        <td align="right" style="padding:4px 0;color:#1F7A4D">− ${eur(dejaAssurance)}</td></tr>` : ''}
    </table>

    <div class="reste" style="${reste < 0 ? 'background:#FBF3E0;border-left-color:#C8891F' : ''}">
      <table><tr>
        <td style="font-size:12pt;font-weight:bold;color:${
          reste < 0 ? '#6B4E11' : '#2E4522'}">${
          reste > 0 ? 'Reste à payer' : reste < 0 ? 'Trop-perçu, à vous rembourser'
                                                 : 'Rien à verser — tout est réglé'}</td>
        <td align="right" style="font-size:16pt;font-weight:bold;color:${
          reste < 0 ? '#6B4E11' : '#2E4522'}">${eur(Math.abs(reste))}</td>
      </tr></table>
    </div>

    ${demenage ? `<p style="font-size:10pt;color:#4a4a4a;margin:0 0 10pt">
      Vous changez de logement au sein du même parc : la garantie et
      l'assurance déjà versées vous suivent et sont déduites ci-dessus.</p>` : ''}

    <div class="paiement">
      <p style="margin:0 0 4pt;font-weight:bold">Comment payer</p>
      <p style="margin:0">Par virement sur le compte <b>${echapperR(compte.iban)}</b>
      au nom de <b>${echapperR(compte.titulaire)}</b>, avec la communication
      <b>« ${echapperR(comm)} »</b>.</p>
      <p style="margin:6pt 0 0">${reste > 0
        ? `<b>La totalité doit être réglée avant la remise des clés.</b> `
        : `<b>Il n'y a rien à verser avant la remise des clés.</b> `
        }Celles-ci vous seront remises contre signature de l'état des lieux
      d'entrée.</p>
    </div>

    <p class="pied">Le détail du calcul des charges figure dans l'avenant à
    votre bail. Document établi le ${dateFr(new Date().toISOString())}.</p>

    </body></html>`;
}

/* Le bouton : contrôle, produit, télécharge, dépose, et dit où. */
async function documentClesRentree(uniteId) {
  const t = toutesUnitesRentree().find(x => x.unite.id === uniteId);
  if (!t) return;
  const l = ligneRentree(uniteId);

  const manque = manquePourLesCles(t.immeubleId, t.unite, l);
  if (manque.length) {
    return dessinerVueRentree(
      `${t.unite.designation} : impossible d'établir le document. Il manque ` +
      manque.join(', ') + '.');
  }

  const contenu = documentCles(t.immeubleId, t.immeubleNom, t.unite, l);
  const nom = nomFichierCles(t.immeubleNom, t.unite, l.locataireSuivant);

  /* Word et PDF portent la même racine : on les retrouve côte à côte dans
     le dossier, et on sait au premier coup d'œil qu'il s'agit de la même
     pièce sous deux formes. */
  const nomDocx = nom.replace(/\.[^.]+$/, '') + '.docx';
  const nomPdf  = nom.replace(/\.[^.]+$/, '') + '.pdf';

  /* LA DESTINATION EST MONTRÉE AVANT D'Y ÉCRIRE.

     Immobilier 2025-2026 / <immeuble> / <studio> / <locataire> / EDLE —
     le même chemin que le bail et l'état des lieux.

     Elle repose sur des rapprochements de noms qui peuvent se tromper, et
     une pièce classée chez un autre locataire ne se voit pas. On montre
     donc le chemin et les doutes, et on attend. */
  let plan;
  try {
    plan = await preparerDossierEdle(t.immeubleId, t.immeubleNom, t.unite, l);
  } catch (e) {
    return dessinerVueRentree(`${nomDocx} : NON enregistré dans OneDrive — ` +
      String((e && e.message) || e) + `.`);
  }

  const question = `Enregistrer le document dans :\n\n${plan.chemin}\n\n` +
    (plan.equivalences.length
      ? `${plan.equivalences.join('\n')}\n\n` : '') +
    (plan.doutes.length ? `⚠️ À vérifier :\n— ${plan.doutes.join('\n— ')}\n\n` : '') +
    `Deux fichiers seront déposés : ${nomDocx} et ${nomPdf}.`;
  if (!confirm(question)) {
    return dessinerVueRentree(
      `${t.unite.designation} : rien n'a été enregistré. Corrige le dossier ` +
      `dans OneDrive si besoin, puis recommence.`);
  }

  let ref, chemin = plan.chemin, dossierCree = plan.creerLoc;
  try {
    ref = await creerDossierEdle(plan);
  } catch (e) {
    return dessinerVueRentree(`${nomDocx} : NON enregistré dans OneDrive — ` +
      String((e && e.message) || e) + `.`);
  }

  /* L'aperçu vient APRÈS la confirmation : on ne montre pas une pièce comme
     déposée avant de savoir où elle va. */
  afficherApercuCles(contenu, nomPdf);
  if (document.getElementById('apercu-cles-chemin')) {
    document.getElementById('apercu-cles-chemin').textContent = chemin + ' (dépôt en cours…)';
  }

  /* 2. LE WORD DANS ONEDRIVE. */
  let item;
  try {
    const blob = await construireDocxCles(t.immeubleId, t.immeubleNom, t.unite, l);
    const res = await ecrireFichierDansDossier(ref, nomDocx, blob, { headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } });
    if (!res || !res.ok) {
      throw new Error(res && typeof detailErreur === 'function'
        ? await detailErreur(res) : 'refus de Microsoft');
    }
    item = await res.json();
    /* LE CHEMIN AFFICHÉ EST CELUI DE MICROSOFT, PAS UN CHEMIN RECONSTITUÉ.

       Les dossiers de OneDrive ne portent pas toujours le nom que
       l'application donne aux unités — c'est la raison d'être de l'écran
       « Comparer noms OneDrive ». Un chemin deviné serait faux là où on en
       a le plus besoin. Même règle que pour les documents de garantie. */
    const brut = item.parentReference && item.parentReference.path;
    if (brut) {
      chemin = decodeURIComponent(String(brut).replace(/^\/[^:]*:?/, ''))
        .replace(/^\/+/, '').split('/').filter(Boolean).join(' / ');
    }
    if (document.getElementById('apercu-cles-chemin')) {
      document.getElementById('apercu-cles-chemin').textContent = chemin;
    }
  } catch (e) {
    /* Même raison : le message attend la fermeture de l'aperçu. */
    annoncerCles(`${nomDocx} : NON enregistré dans OneDrive — ` +
      String((e && e.message) || e) + `.`);
    return;
  }

  /* 3. LE PDF, CONVERTI PAR ONEDRIVE ET DÉPOSÉ À CÔTÉ.

     C'est le format qu'un locataire ouvre sans y penser, sur les quatre
     systèmes. Son échec ne doit pas faire passer le Word pour perdu : il
     est déjà en place, on le dit et on s'arrête là. */
  try {
    const pdf = await pdfDepuisOneDrive(item);
    const res = await ecrireFichierDansDossier(ref, nomPdf, pdf,
      { headers: { 'Content-Type': 'application/pdf' } });
    if (!res || !res.ok) {
      throw new Error(res && typeof detailErreur === 'function'
        ? await detailErreur(res) : 'refus de Microsoft');
    }
  } catch (e) {
    annoncerCles(`${nomDocx} enregistré — ${chemin}\n` +
      `Le PDF n'a PAS pu être produit : ` + String((e && e.message) || e) +
      `. Ouvre le Word depuis OneDrive et enregistre-le en PDF à la main.`);
    return;
  }

  /* ON NOTE OÙ LA PIÈCE EST PARTIE.

     Le chemin n'apparaissait que dans l'aperçu, puis disparaissait : le
     lendemain, plus rien ne disait où le document avait été déposé. Il est
     désormais conservé sur la ligne, comme pour les documents de garantie
     dans la fiche de l'unité. */
  l.clesDepotLe = new Date().toISOString();
  l.clesChemin = chemin;
  l.clesFichier = nomPdf;
  await enregistrerRentree();

  annoncerCles(
    `Document enregistré — ${chemin} / ${nomPdf}\n` +
    `Le Word est déposé au même endroit, sous le même nom.` +
    (dossierCree ? `\nLe dossier du locataire a été créé.` : ''));
}

/* ---- L'aperçu à l'écran ------------------------------------------------

   Un cadre isolé et deux boutons. Ce qu'on veut ici, c'est voir la pièce
   avant qu'elle parte. Le message de dépôt attend la fermeture : on ne
   redessine pas l'écran sous un aperçu ouvert. */
let messageApresApercuCles = null;

/* UN MESSAGE QUI ARRIVE APRÈS LA FERMETURE DE L'APERÇU.

   Le dépôt du Word, la conversion en PDF et le second dépôt prennent
   quelques secondes. Rien n'empêche de refermer l'aperçu pendant ce
   temps — et le message était alors mis en attente d'une fermeture qui
   avait déjà eu lieu : ni succès ni échec ne s'affichaient jamais.

   On regarde donc si l'aperçu est encore là. S'il l'est, le message
   attend ; sinon, il s'affiche tout de suite. Constaté le 06/09/2026. */
function annoncerCles(message) {
  if (document.getElementById('apercu-cles')) {
    messageApresApercuCles = message;
  } else {
    dessinerVueRentree(message);
  }
}

function afficherApercuCles(contenu, nomPdf) {
  fermerApercuCles();
  const boite = document.createElement('div');
  boite.id = 'apercu-cles';
  boite.className = 'apercu-cles';
  boite.innerHTML = `
    <div class="apercu-cles-barre">
      <span class="apercu-cles-nom">${echapperR(nomPdf)}</span>
      <button class="btn-connexion" onclick="fermerApercuCles()">Fermer</button>
    </div>
    <iframe id="apercu-cles-cadre" class="apercu-cles-cadre" title="Document"></iframe>
    <p class="apercu-cles-aide">📁 <span id="apercu-cles-chemin">dépôt en cours…</span>
    <br>Le PDF est déposé à côté du Word : c'est lui qu'il faut joindre au
    courriel du locataire.</p>`;
  document.body.appendChild(boite);
  const cadre = document.getElementById('apercu-cles-cadre');
  if (cadre) cadre.srcdoc = contenu;
}

function fermerApercuCles() {
  const b = document.getElementById('apercu-cles');
  if (b && b.parentNode) b.parentNode.removeChild(b);
  if (messageApresApercuCles) {
    const m = messageApresApercuCles;
    messageApresApercuCles = null;
    dessinerVueRentree(m);
  }
}

/* ---- Mode d'emploi -----------------------------------------------------

   Il vit ici plutôt que dans le guide de l'application : app.js n'est pas
   modifié par ce module, et une aide qui accompagne l'écran qu'elle décrit
   se trouve plus facilement. */
function ouvrirAideRentree() {
  const html = `<div class="vue-rentree">
    <div class="rentree-entete">
      <button class="btn-connexion" onclick="ouvrirVueRentree()">Retour</button>
      <h2>Mode d'emploi — Rentrée</h2>
    </div>

    <div class="aide-rentree">

      <h3>À quoi sert cet écran</h3>
      <p>Les studios sont loués à des étudiants. Dès février, on sait qui part
      en juin et par qui il sera remplacé en septembre. Ces futurs locataires
      n'existent dans aucun mois de l'application, qui raisonne par mois
      calendaires : cet écran leur donne une place en attendant.</p>
      <p class="ex"><strong>Exemple.</strong> En mars, Jules Amouri annonce
      qu'il quitte le studio 6 de Biche en juin. Olivia Megali le remplacera
      au 1<sup>er</sup> septembre. On l'inscrit ici tout de suite ; le mois de
      mars, lui, continue d'afficher Jules.</p>

      <h3>Quand le remplir</h3>
      <p>De février à l'été, au fur et à mesure. Le dossier porte l'année de la
      rentrée à préparer — « Rentrée 2027 » — et change au
      1<sup>er</sup> janvier.</p>
      <p class="ex"><strong>Exemple.</strong> Le 3 février 2027, l'écran
      s'ouvre sur « Rentrée 2027 ». Il gardera ce nom jusqu'au 31 décembre.
      Le 1<sup>er</sup> janvier 2028, il deviendra « Rentrée 2028 » et repartira
      vide.</p>

      <h3>Les seize colonnes</h3>
      <p><strong>Deux sont lues dans le mois</strong> et ne se saisissent pas :
      le nom de l'unité et son locataire actuel. Elles suivent le mois affiché
      en haut de l'application.</p>
      <p><strong>Quatorze se remplissent ici</strong> : le statut, le locataire
      suivant, son courriel, les acomptes, la date de début du bail, les quatre
      contrôles et les montants.</p>
      <p class="ex"><strong>Exemple.</strong> Sur la ligne du studio 6, tu lis
      « STUDIO 6 BICHE » et « Jules Amouri — lu dans le mois ». Tout le reste,
      c'est toi qui le remplis.</p>

      <h3>Le statut</h3>
      <p><strong>Reste</strong> — le locataire ne bouge pas.
      <strong>Départ</strong> — il s'en va et tu connais son remplaçant.
      <strong>En attente</strong> — il s'en va mais tu ne sais pas encore par
      qui.
      <strong>Inoccupé</strong> — tu as décidé de ne pas relouer.</p>
      <p class="ex"><strong>Exemple.</strong> En février, le studio 6 passe en
      « en attente » : Jules a donné son préavis, personne n'est encore trouvé.
      En avril, Olivia signe : tu passes en « départ » et tu saisis son nom.</p>

      <h3>Les quatre contrôles</h3>
      <p>Bail, avenant, Samadhi, EDLE. Touche la case : elle passe du point
      rouge au V vert.</p>
      <p><strong>Avenant et Samadhi ne concernent que Biche, Nimy et Petite
      Guirlande.</strong> Ailleurs, un tiret gris sur fond hachuré indique que
      la colonne est sans objet — ce n'est pas une case oubliée.</p>
      <p class="ex"><strong>Exemple.</strong> Sur un studio de Vannes, tu vois
      « bail ● » et « EDLE ● » à cocher, mais « avenant — » et « Samadhi — »
      en gris. Il n'y a rien à faire pour ces deux-là.</p>

      <h3>Les deux courriels</h3>
      <p>Deux adresses par unité : celle du <strong>locataire</strong> et celle
      du <strong>garant</strong>. S'il n'y en a aucune, on ne peut envoyer ni
      le document de remise des clés, ni le décompte de charges.</p>
      <p>Le garant est facultatif, mais c'est souvent lui qui tient : un
      étudiant change de boîte, ne la relève pas, ou la ferme en fin d'année.
      L'adresse d'un parent survit à tout ça.</p>
      <p><strong>Aucune des deux n'est obligatoire pour verser.</strong>
      L'unité apparaît simplement dans « Ce qui manque », et une note le
      rappelle sur la ligne. En revanche, une adresse <strong>mal écrite
      empêche le versement</strong> : elle partirait dans un envoi qui
      échouerait sans qu'on sache pourquoi.</p>
      <p>La forme vérifiée est la plus simple : un arobase, un point après
      lui, pas d'espace.</p>
      <p class="ex"><strong>Exemple.</strong> « olivia.megali@gmail.com »
      passe. « olivia.megali » devient rouge : il manque tout ce qui suit
      l'arobase. Laisser le champ garant vide ne bloque rien.</p>
      <p>Les deux adresses suivent le locataire : s'il déménage dans un autre
      studio du parc, elles le suivent avec sa garantie.</p>

      <h3>Les acomptes</h3>
      <p><strong>Le bloc reste fermé tant que la ligne n'est pas
      complète.</strong> Il faut le nom du remplaçant, le début du bail et
      tous les montants qui s'appliquent à l'unité. Le message te dit
      lesquels manquent. Un acompte se calcule sur les chiffres du nouveau
      bail : tant qu'ils ne sont pas là, il n'y a rien sur quoi le
      calculer.</p>
      <p class="ex"><strong>Exemple.</strong> Un acompte de 200 € arrive en
      mars pour le studio 1, mais tu n'as pas encore arrêté le loyer. Le bloc
      affiche « à remplir d'abord : loyer, charges, garantie ». Tu saisis les
      montants, le bloc s'ouvre, tu inscris les 200 €.</p>
      <p>Ensuite, « + acompte » ajoute autant de lignes qu'il en vient, avec
      leur date. Le <strong>total</strong> s'affiche à côté du titre.</p>
      <p class="ex"><strong>Exemple.</strong> Olivia verse 200 € le 5 avril,
      puis 200 € le 12 juin. Tu ajoutes deux lignes. Le titre affiche
      « Acomptes — total 400,00 € ».</p>

      <h3>Où va l'acompte</h3>
      <p>Trois cas, selon l'unité et le locataire :</p>
      <p><strong>Nouveau locataire</strong> — le total devient la garantie
      encaissée.<br>
      <strong>Déménagement</strong> — la garantie qu'il apporte
      <strong>et</strong> ses acomptes s'additionnent. Un déménageur ne verse
      pas de garantie, mais parfois un rattrapage : le loyer augmente chaque
      année, donc la garantie du nouveau bail est souvent plus élevée que
      celle qu'il a versée ailleurs.<br>
      <strong>Unité sans garantie — le garage</strong> — l'acompte est une
      avance sur le loyer. Il est porté sur les loyers versés du mois, et ne
      peut pas dépasser un mois : au-delà, le champ passe en rouge et le
      versement est refusé.</p>
      <p class="ex"><strong>Exemple — rattrapage.</strong> Marc apporte 400 €
      du studio 7. La garantie du studio 1 est de 840 €. Il verse 440 € de
      rattrapage : l'application inscrira 840 € de garantie encaissée, et la
      confirmation te l'annoncera ainsi — « 400,00 € apportés + 440,00 €
      d'acomptes = 840,00 € ».</p>
      <p class="ex"><strong>Exemple — garage.</strong> Le garage de Biche est
      à 60 €. Un acompte de 60 € est accepté et porté sur le premier mois.
      Un acompte de 200 € est refusé.</p>
      <p>Si tu vides un montant sur une ligne qui porte déjà un acompte,
      l'application te le signale. <strong>Elle n'efface jamais un
      paiement</strong> : l'acompte reste, mais le bloc se referme jusqu'à ce
      que la ligne soit de nouveau complète.</p>

      <h3>Le début du bail</h3>
      <p>Une date à part, qui n'a rien à voir avec les acomptes : ceux-ci sont
      versés au printemps, le bail commence en septembre. Le bouton
      « 1<sup>er</sup> sept. » la remplit d'un geste.</p>
      <p>La fin de bail se calcule toute seule : douze mois moins un jour.</p>
      <p class="ex"><strong>Exemple.</strong> Tu touches « 1<sup>er</sup> sept. » :
      le bail court du 1<sup>er</sup> septembre 2027 au 31 août 2028.</p>

      <h3>Les montants du bail</h3>
      <p>Six montants, dont chacun a son périmètre — seuls ceux qui s'appliquent
      à l'unité sont demandés :</p>
      <p><strong>Loyer</strong> partout, garage compris.<br>
      <strong>Charges</strong> — la provision — partout sauf le garage.<br>
      <strong>Poubelles</strong> à Biche, Nimy, Pourcelet et Petite Guirlande.<br>
      <strong>Wifi</strong> à Biche, Nimy et Petite Guirlande.<br>
      <strong>Assurance</strong> partout sauf Vannes.<br>
      <strong>Garantie</strong> partout sauf le garage.</p>
      <p><strong>Un champ laissé vide ne touche à rien</strong> : la valeur du
      mois précédent reste en place. Un champ rempli la remplace.</p>
      <p class="ex"><strong>Exemple.</strong> Sur un studio de Vannes, tu ne
      vois que trois champs : loyer, charges, garantie. Ni poubelles, ni wifi,
      ni assurance — ils ne sont pas facturés là-bas. Le garage, lui, n'a qu'un
      loyer.</p>
      <p class="ex"><strong>Autre exemple.</strong> Le loyer passe de 380 à
      395 € mais les charges ne bougent pas : tu saisis 395 dans « loyer » et tu
      laisses « charges » vide. Les 90 € de charges resteront.</p>

      <h3>Un nom qui figure déjà ailleurs</h3>
      <p>Si le nom du remplaçant est déjà connu dans le parc, l'application le
      signale <strong>dès la saisie</strong> et demande de quoi il s'agit. Elle
      cherche dans deux endroits : les locataires en place, et les futurs
      locataires déjà inscrits sur une autre ligne.</p>
      <p><strong>Déménagement</strong> — la même personne change de studio. Sa
      garantie, son assurance payée et son adresse le suivent ; on ne lui
      réclame pas de garantie, seulement un rattrapage si celle du nouveau
      bail est plus élevée.<br>
      <strong>Homonyme</strong> — deux personnes différentes qui portent le même
      nom. Chacune sa garantie, son acompte, son adresse.<br>
      <strong>Erreur de saisie</strong> — le nom est effacé, à corriger.</p>
      <p>Tant que tu n'as pas répondu, <strong>l'unité ne peut pas être
      versée</strong>. Un bandeau en tête rassemble tous les noms en attente.</p>
      <p class="ex"><strong>Exemple — déménagement.</strong> Marc Dupont occupe
      le studio 7 de Nimy, où il a versé 400 € de garantie. Il veut le studio 1,
      plus grand. Tu l'inscris comme remplaçant au studio 1 : l'application dit
      « Ce nom figure déjà à STUDIO 7 NIMY ». Tu réponds « Déménagement » : ses
      400 € et son adresse le suivront. S'il ne reste rien à rattraper, tu
      n'inscris aucun acompte.</p>
      <p class="ex"><strong>Exemple — erreur.</strong> Tu inscris Julie Martin
      au studio 3, puis, distrait, au studio 8. L'application signale le
      doublon. Tu réponds « Erreur de saisie » sur la seconde ligne, le nom
      s'efface.</p>
      <p>Ce que la personne apporte est relevé <strong>au moment où tu tapes son
      nom</strong>, pendant qu'elle occupe encore son studio. L'ordre dans lequel
      tu verses les deux unités n'a donc aucune importance.</p>

      <h3>Verser dans le mois</h3>
      <p>Septembre est créé au mois d'août, par recopie d'août. Tu verses
      ensuite <strong>unité par unité</strong>, au fur et à mesure que les
      lignes se remplissent.</p>
      <p>Le versement installe le nouveau locataire dans le mois : son nom, son
      courriel, les montants du bail, sa garantie.</p>
      <p class="ex"><strong>Exemple.</strong> En août, tu te places sur
      « septembre 2027 » dans l'application, tu ouvres la rentrée, et tu verses
      le studio 6. Olivia remplace Jules dans le mois de septembre.</p>

      <h3>Verser une seconde fois — toujours dans le même mois</h3>
      <p>Une unité déjà versée peut l'être à nouveau : le bouton devient
      « Verser à nouveau ». C'est utile quand un acompte arrive après coup, ou
      qu'un montant était encore vide.</p>
      <p>Cela ne compte jamais deux fois : la garantie encaissée est
      <strong>recalculée</strong> à partir du total des acomptes, jamais
      additionnée.</p>
      <p><strong>Mais il faut être sur le même mois que la première fois.</strong>
      Si tu as versé dans septembre, tu dois être sur septembre pour recommencer.
      L'application refuse et te dit où te placer.</p>
      <p class="ex"><strong>Exemple.</strong> Tu as versé le studio 6 dans
      septembre 2027 avec un acompte de 200 €. En juillet, Olivia verse 200 € de
      plus. Tu ajoutes la ligne, tu te replaces sur septembre 2027, et tu verses
      à nouveau : la garantie passe à 400 €, pas à 600.</p>
      <p class="ex"><strong>Ce qui arriverait sinon.</strong> Si tu étais resté
      sur octobre, Olivia aurait été installée dans septembre <em>et</em> dans
      octobre — deux mois faux au lieu d'un —, et tu ne pourrais plus annuler
      ni depuis l'un ni depuis l'autre. C'est pourquoi l'application refuse.</p>

      <h3>Ce que le versement efface</h3>
      <p>Au <strong>premier</strong> versement d'un nouveau locataire,
      l'assurance payée et les loyers versés par le sortant repartent à zéro :
      ils ne sont pas les siens. Les six champs de texte de l'unité aussi —
      commentaire garantie, document et commentaire d'assurance, ordre
      permanent, commentaires, notes internes.</p>
      <p>Aux versements suivants, rien n'est effacé : ce qui a été écrit
      concerne désormais le nouveau locataire.</p>
      <p class="ex"><strong>Exemple.</strong> La note « bruyant, voisins se
      plaignent » parlait de Jules. Quand Olivia arrive, elle disparaît. Et la
      référence de la police d'assurance de Jules aussi — ce n'est pas la
      sienne.</p>
      <p><strong>L'argent suit la personne, les textes suivent l'unité.</strong>
      Marc qui déménage garde sa garantie, mais l'unité où il arrive perd les
      notes de celui qui la quittait.</p>

      <h3>Un locataire qui reste</h3>
      <p>Son bail est renouvelé, son loyer peut être indexé. Saisis les montants
      et touche <strong>« Appliquer les montants »</strong> : le locataire ne
      change pas, seuls les montants sont remplacés.</p>
      <p class="ex"><strong>Exemple.</strong> Axel reste au studio 8 de Biche,
      mais son loyer passe de 370 à 380 €. Tu laisses le statut sur « reste »,
      tu saisis 380 dans « loyer », et tu touches « Appliquer les montants ».</p>

      <h3>Annuler</h3>
      <p>Un versement s'annule <strong>depuis le mois où il a été fait</strong>,
      et rend l'unité exactement dans l'état d'avant : le locataire, les
      montants, la garantie, les notes.</p>
      <p>Le bouton rouge en tête annule tous les versements du mois d'un coup —
      utile pour les essais.</p>
      <p class="ex"><strong>Exemple.</strong> Tu t'aperçois qu'Olivia s'est
      désistée. Tu te places sur septembre 2027, tu touches « annuler » sur la
      ligne du studio 6 : Jules revient, avec ses montants et sa garantie de
      1 150 €.</p>

      <h3>Ce qui manque</h3>
      <p>Le bouton en haut liste, locataire par locataire, ce qui reste à faire
      avant la rentrée. Les unités qui restent et celles laissées volontairement
      inoccupées n'y figurent pas.</p>
      <p><strong>Une unité versée y reste tant que ses documents ne sont pas
      rentrés</strong> — elle porte alors la mention « déjà versée ». On verse
      dès que le remplaçant et les montants sont connus ; le bail signé,
      l'avenant et l'EDLE arrivent souvent après.</p>
      <p class="ex"><strong>Exemple.</strong> Le bouton affiche « Ce qui
      manque — 12 locataires, 34 documents ». En touchant, tu vois
      « Olivia Megali — STUDIO 6 BICHE : Samadhi, EDLE ». Le reste est fait.</p>

      <h3>Le document de remise des clés</h3>
      <p>Le bouton <strong>« Avant remise des clés »</strong>, au bas de chaque
      ligne en départ, établit le document à envoyer au futur locataire : son
      loyer mensuel, ce qu'il doit verser avant les clés, les acomptes déjà
      versés déduits, et le compte sur lequel payer.</p>
      <p>Il est <strong>téléchargé sur ton téléphone</strong> — pour le joindre
      au courriel depuis Envoi Décomptes — et <strong>déposé dans OneDrive</strong>,
      pour le retrouver des mois plus tard tel qu'il a été envoyé. Le chemin
      complet s'affiche après l'enregistrement.</p>
      <p>Le compte bancaire dépend de l'immeuble : Havré va sur celui de
      Samadhi, Egmont sur celui de Julien, les cinq autres sur celui de
      Jean-Marc.</p>
      <p><strong>Si une donnée manque</strong> — le nom, le courriel, la date de
      bail, un montant — le document n'est pas établi et l'application dit ce
      qui bloque. Un document incomplet ferait payer une somme fausse.</p>
      <p><strong>L'application te montre d'abord où elle va écrire</strong>, et
      te signale ce qui mérite un coup d'œil : un dossier qui va être créé, un
      nom de dossier différent de celui que tu as tapé, plusieurs dossiers qui
      pourraient convenir. Rien n'est écrit avant que tu aies confirmé.</p>
      <p class="ex"><strong>Exemple.</strong> Sur le studio 6 de Biche, tu
      touches le bouton. L'application demande : « Enregistrer dans BICHE /
      STUDIO 6 / OLIVIA MEGALI / EDLE ? » en précisant que le dossier de la
      locataire sera créé. Tu confirmes. Deux fichiers sont déposés, un Word
      et un PDF, et la ligne garde la date et le chemin. C'est le PDF qu'il
      faut joindre au courriel.</p>
      <p class="ex"><strong>Le garage.</strong> Il n'a qu'un loyer : le document
      ne parle ni de charges, ni de garantie, ni d'assurance. Le locataire ne
      verse que le premier mois.</p>
      <p class="ex"><strong>Un déménagement.</strong> Marc quitte le studio 7
      pour le studio 1. Sa garantie de 400 € et son assurance de 85 € le
      suivent : le document les <strong>déduit</strong> du total et le dit.
      Sans cela, on lui ferait payer deux fois.</p>
      <p class="ex"><strong>Si le locataire a trop versé</strong>, le document
      n'affiche pas un montant négatif : il annonce « Trop-perçu, à vous
      rembourser » et la somme à lui rendre.</p>
      <p class="ex"><strong>Exemple — blocage.</strong> « STUDIO 6 BICHE :
      impossible d'établir le document. Il manque son courriel, le montant :
      garantie. » Remplis ces deux champs et recommence.</p>

      <h3>Travailler à deux</h3>
      <p>Un bandeau signale qu'une autre personne utilise l'application au même
      moment. <strong>Évitez de travailler sur le même immeuble en même
      temps</strong> : le dernier qui enregistre l'emporte, et le travail de
      l'autre serait perdu.</p>
      <p class="ex"><strong>Exemple.</strong> Le bandeau dit « Julien utilise
      aussi l'application ». Si tu comptais faire Nimy, appelle-le : demande-lui
      sur quel immeuble il est, et prends-en un autre.</p>

      <h3>Si quelque chose ne part pas</h3>
      <p>Chaque versement écrit sur OneDrive. Si l'écriture échoue — connexion
      perdue, ou quelqu'un d'autre a modifié le mois entre-temps — l'application
      <strong>défait ce qu'elle venait de faire</strong> et affiche un message
      rouge en haut de l'écran.</p>
      <p>Ne recommence pas aussitôt : reviens à l'écran principal, regarde le
      message de sauvegarde, et réessaie ensuite.</p>
      <p class="ex"><strong>Exemple.</strong> « STUDIO 6 BICHE NON versée. La
      sauvegarde n'est pas partie sur OneDrive — conflit avec une autre
      personne, ou connexion perdue. » Rien n'a été écrit : l'unité est restée
      comme avant.</p>

    </div>
  </div>`;
  const zone = document.getElementById('vue-rentree-conteneur');
  if (!zone) return;
  zone.innerHTML = html;
  zone.style.display = 'block';
  masquerFondRentree(true);
  window.scrollTo(0, 0);
}

function fermerVueRentree() {
  const zone = document.getElementById('vue-rentree-conteneur');
  if (zone) { zone.style.display = 'none'; zone.innerHTML = ''; }
  masquerFondRentree(false);
  majBoutonManques();
}

/* Le compte sur le bouton d'accueil, rafraîchi à l'ouverture et au retour.
   L'année y figure aussi : « Rentrée 2027 ». */
async function majBoutonManques() {
  const b = document.getElementById('btn-rentree-manques');
  if (!b) return;
  try {
    const d = await chargerRentree(anneeRentreeAffichee || anneeRentree());
    if (!d) return;
    const memoire = donneesRentree;
    donneesRentree = d;
    const c = comptesRentree();
    donneesRentree = memoire;
    b.textContent = `📝 Ce qui manque — ${c.locataires} locataire${
      c.locataires > 1 ? 's' : ''}, ${c.documents} document${c.documents > 1 ? 's' : ''}`;
  } catch (_) { /* le bouton garde son libellé par défaut */ }
}

/* Au chargement de la page : l'année sur le premier bouton, le compte sur le
   second. Rien de bloquant — si OneDrive n'est pas prêt, les libellés par
   défaut restent. */
window.addEventListener('load', () => {
  const b = document.getElementById('btn-rentree');
  if (b) b.textContent = `📅 Rentrée ${anneeRentree()}`;
  /* Dix secondes plutôt que trois : l'application charge le mois en cours
     pendant les premières secondes, inutile d'interroger OneDrive en même
     temps. */
  setTimeout(majBoutonManques, 10000);
});


/* Exposé pour les bancs d'essai seulement. Dans un navigateur, ces noms sont
   déjà globaux et cette ligne ne change rien. */
if (typeof globalThis !== 'undefined') {
  globalThis.__rentree = {
    poser: (d) => { donneesRentree = d; },
    lire: () => donneesRentree,
  };
}
