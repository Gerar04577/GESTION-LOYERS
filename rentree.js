// rentree.js — v101 — 05/09/2026
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

/* Le total versé en acomptes. C'est lui qui devient la garantie encaissée :
   verser plusieurs fois ne compte jamais deux fois, puisqu'on recalcule à
   partir du total au lieu d'ajouter. */
function totalAcomptes(l) {
  return (l.acomptes || []).reduce((t, a) =>
    t + (a && a.montant != null ? Number(a.montant) : 0), 0);
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
        !(estDemenagementInterne(l.locataireSuivant, unite.id) && !l.homonyme)) {
      manquants.push('acompte');
    }
    if (!versee && !l.debutBail) manquants.push('début du bail');
    if (!versee) {
      montantsApplicables(immeubleId, unite.designation).forEach(m => {
        if (l.montants[m.cle] == null) manquants.push(m.libelle);
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
  return /NON vers|impossible|non enregistr|Aucune|à vérifier|saisis |Indique |déjà été versée|place-toi|n'ont pas pu|ATTENTION/i
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
  const demenage = estDemenagementInterne(l.locataireSuivant, unite.id) && !l.homonyme;
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

    ${demenage ? `<p class="rentree-note">Déménagement interne : aucun acompte,
      la garantie du locataire le suit.</p>` : `
    <p class="rentree-sous-titre">Acomptes${
      l.acomptes.length ? ` — total ${totalAcomptes(l).toFixed(2)} €` : ''}</p>
    ${l.acomptes.map((a, i) => `<div class="rentree-champs">
      <label>montant
        <input type="number" step="0.01" inputmode="decimal"
          value="${a.montant == null ? '' : a.montant}"
          onchange="changerAcompteRentree('${unite.id}', ${i}, 'montant', this.value)"></label>
      <label class="date">date
        <input type="date" value="${a.date || ''}"
          onchange="changerAcompteRentree('${unite.id}', ${i}, 'date', this.value)"></label>
      <button class="btn-connexion mini retirer"
        onclick="retirerAcompteRentree('${unite.id}', ${i})">retirer</button>
    </div>`).join('')}
    <button class="btn-connexion mini ajouter"
      onclick="ajouterAcompteRentree('${unite.id}')">+ acompte</button>`}` : ''}

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
  </div>`;
}

/* ---- Les saisies -------------------------------------------------------- */

function changerStatutRentree(uniteId, valeur) {
  ligneRentree(uniteId).statut = valeur;
  enregistrerRentree().then(() => dessinerVueRentree());
}
function changerSuivantRentree(uniteId, valeur) {
  ligneRentree(uniteId).locataireSuivant = String(valeur || '').trim();
  enregistrerRentree().then(() => dessinerVueRentree());
}
function changerAcompteRentree(uniteId, index, champ, valeur) {
  const l = ligneRentree(uniteId);
  if (!l.acomptes[index]) return;
  if (champ === 'montant') {
    const v = String(valeur).replace(',', '.').trim();
    l.acomptes[index].montant = v === '' ? null : Number(v);
  } else {
    l.acomptes[index].date = valeur || null;
  }
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
  const v = String(valeur).replace(',', '.').trim();
  ligneRentree(uniteId).montants[cle] = v === '' ? null : Number(v);
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

  /* LES HOMONYMES NE SONT PAS DES DÉMÉNAGEMENTS.

     La détection repose sur le nom seul. Sur cinquante studios d'étudiants,
     deux personnes peuvent porter le même. Prises pour un déménagement,
     leur garantie ne serait pas initialisée et leur acompte jamais porté au
     crédit — sans que rien ne le signale.

     On demande donc confirmation, en nommant l'unité où le nom figure
     déjà. */
  if (changeDeLocataire && !l.instantane &&
      estDemenagementInterne(l.locataireSuivant, uniteId)) {
    const ou = toutesUnitesRentree().find(x => x.unite.id !== uniteId &&
      x.unite.locataire && String(x.unite.locataire).trim().toLowerCase()
        === String(l.locataireSuivant).trim().toLowerCase());
    const memePersonne = confirm(
      `« ${l.locataireSuivant} » occupe déjà ${ou ? ou.unite.designation : 'une autre unité'}.\n\n` +
      `S'agit-il de la MÊME personne qui déménage ?\n\n` +
      `Oui : sa garantie le suit, aucun acompte n'est réclamé.\n` +
      `Non : c'est un homonyme, sa garantie repart de zéro.`);
    l.homonyme = !memePersonne;
  } else if (!l.instantane) {
    l.homonyme = false;
  }
  /* ON PEUT VERSER PLUSIEURS FOIS.

     Le dossier de rentrée se remplit d'février à l'été : on verse une
     première fois dès que le bail est signé, puis à nouveau quand un
     second acompte arrive ou qu'un montant est complété.

     Ce n'est sans danger que parce que la garantie encaissée est
     RECALCULÉE à partir du total des acomptes, jamais additionnée — voir
     plus bas. L'interdiction posée le 02/09 visait justement le cas où
     elle s'ajoutait.

     Le versement suivant doit se faire dans le MÊME mois que le premier :
     sinon on installerait le locataire dans deux mois différents. */
  if (l.verseeLe && l.verseeVers !== moisAffiche) {
    return dessinerVueRentree(
      `${u.designation} a déjà été versée dans ${l.verseeVers}. Place-toi sur ce mois pour la compléter.`);
  }
  /* PREMIER VERSEMENT OU NON — le marqueur doit être LU AVANT d'être posé,
     et avant la confirmation, qui en dépend pour son texte. */
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
    : (!changeDeLocataire ||
       (estDemenagementInterne(l.locataireSuivant, uniteId) && !l.homonyme));

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
    (changeDeLocataire && totalAcomptes(l)
      ? (avecGarantie
          ? `Garantie encaissée : ${totalAcomptes(l).toFixed(2)} € (total des acomptes).\n`
          : `ATTENTION : cette unité n'a pas de garantie. Les ${
              totalAcomptes(l).toFixed(2)} € d'acompte saisis ne seront pas portés.\n`)
      : '') +
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
    l.demenagement = !changeDeLocataire ||
      (estDemenagementInterne(l.locataireSuivant, uniteId) && !l.homonyme);
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
    /* DÉMÉNAGEMENT INTERNE : la garantie encaissée suit la personne, telle
       quelle — c'est le même argent, rattaché à une autre unité. Le
       MONTANT DÛ, lui, est bien celui du nouveau bail s'il a été saisi :
       c'est la boucle ci-dessus qui l'a posé, et c'est voulu. */
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
    memoire.set(l, { verseeLe: l.verseeLe, verseeVers: l.verseeVers,
                     versePar: l.versePar, instantane: l.instantane });
    l.verseeLe = null; l.verseeVers = null; l.versePar = null;
    delete l.instantane;
    delete l.demenagement;
  });

  const r = await sauvegarderEtVerifier();
  if (!r.ok) {
    /* On remet toutes les unités comme elles étaient avant la remise à
       zéro : versées. */
    instantanes.forEach(({ unite, avant }) => {
      Object.keys(unite).forEach(k => delete unite[k]);
      Object.assign(unite, avant);
    });
    versees.forEach(([, l]) => Object.assign(l, memoire.get(l)));
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
      <p>Les studios sont loués à des étudiants. Dès février, on sait qui
      part en juin et par qui il sera remplacé en septembre. Ces futurs
      locataires n'existent dans aucun mois de l'application, qui raisonne
      par mois calendaires : cet écran leur donne une place.</p>

      <h3>Quand le remplir</h3>
      <p>De février à l'été. Le dossier porte l'année de la rentrée à
      préparer — « Rentrée 2027 » —, et change au 1<sup>er</sup> janvier.</p>

      <h3>Les seize colonnes</h3>
      <p><strong>Deux sont lues dans le mois</strong> et ne se saisissent
      pas : l'unité et son locataire actuel. Elles suivent le mois affiché.</p>
      <p><strong>Quatorze se remplissent ici</strong> : le statut, le
      locataire suivant, les acomptes, les quatre contrôles, et les montants
      du nouveau bail.</p>

      <h3>Les quatre contrôles</h3>
      <p>Bail, avenant, Samadhi, EDLE. Un V vert quand c'est fait, un point
      rouge sinon. <strong>Avenant et Samadhi ne concernent que Biche, Nimy
      et Petite Guirlande</strong> : ailleurs, un tiret gris indique que la
      colonne est sans objet.</p>

      <h3>Les acomptes</h3>
      <p>Un locataire verse parfois en deux ou trois fois. Le bouton
      « + acompte » ajoute autant de lignes qu'il en vient, chacune avec sa
      date. <strong>C'est le total qui devient la garantie encaissée.</strong></p>
      <p>Un locataire qui déménage dans le parc ne verse pas d'acompte : sa
      garantie le suit.</p>

      <h3>Les montants du bail</h3>
      <p>Six montants, dont chacun a son périmètre — seuls ceux qui
      s'appliquent à l'unité sont demandés :</p>
      <p><strong>Loyer</strong> partout, garage compris.<br>
      <strong>Charges</strong> — la provision — partout sauf le garage.<br>
      <strong>Poubelles</strong> à Biche, Nimy, Pourcelet et Petite Guirlande.<br>
      <strong>Wifi</strong> à Biche, Nimy et Petite Guirlande.<br>
      <strong>Assurance</strong> partout sauf Vannes.<br>
      <strong>Garantie</strong> partout sauf le garage.</p>
      <p>Le garage n'a qu'un loyer : c'est un emplacement, pas un logement.</p>
      <p><strong>Un champ vide ne touche à rien</strong> : la valeur venue du
      mois précédent reste. Un champ rempli la remplace. C'est vrai pour un
      locataire qui reste comme pour un nouveau.</p>

      <h3>Le début du bail</h3>
      <p>Une date à part, distincte des acomptes — ceux-ci sont versés au
      printemps, le bail commence en septembre. Le bouton « 1<sup>er</sup>
      sept. » la remplit d'un geste. La fin de bail se calcule à douze mois
      moins un jour.</p>

      <h3>Verser dans le mois</h3>
      <p>Septembre est créé au mois d'août, par recopie d'août. On verse
      ensuite unité par unité, <strong>au fil du remplissage</strong> : une
      unité déjà versée peut l'être à nouveau quand un acompte arrive ou
      qu'un montant est complété. Le bouton devient « Verser à nouveau ».</p>
      <p>Verser deux fois ne compte jamais deux fois : la garantie encaissée
      est recalculée à partir du total des acomptes, jamais additionnée.</p>
      <p><strong>Au premier versement seulement</strong>, l'assurance payée
      et les loyers versés par le sortant repartent à zéro — ils ne sont pas
      les siens. Aux versements suivants ils sont conservés : ce sont
      désormais ceux du nouveau locataire.</p>
      <p>Les six champs de texte libre de l'unité repartent à vide eux
      aussi : commentaire garantie, document et commentaire d'assurance,
      ordre permanent, commentaires et notes internes. Ils parlaient du
      locataire précédent.</p>
      <p><strong>L'argent suit la personne, les textes suivent l'unité.</strong>
      Un locataire qui déménage dans le parc garde sa garantie — c'est le même
      argent —, mais l'unité où il arrive perd les notes de celui qui la
      quittait : elles ne le concernent pas.</p>

      <h3>Un locataire qui reste</h3>
      <p>Son bail est renouvelé, son loyer peut être indexé. Saisis les
      montants et touche <strong>« Appliquer les montants »</strong> : le
      locataire ne change pas, seuls les montants sont remplacés.</p>

      <h3>Annuler</h3>
      <p>Un versement s'annule depuis le mois où il a été fait, et rend
      l'unité exactement dans l'état d'avant. Le bouton rouge en tête annule
      tous les versements du mois d'un coup — utile pour les essais.</p>

      <h3>Ce qui manque</h3>
      <p>Le bouton liste, locataire par locataire, ce qui reste à faire avant
      la rentrée. Les unités qui restent et celles laissées volontairement
      inoccupées n'y figurent pas.</p>
      <p><strong>Une unité versée y reste tant que ses documents ne sont pas
      rentrés</strong> — elle porte alors la mention « déjà versée ». On
      verse dès que le remplaçant et les montants sont connus ; le bail
      signé, l'avenant et l'EDLE arrivent souvent après.</p>

      <h3>Travailler à deux</h3>
      <p>Un bandeau signale qu'une autre personne utilise l'application.
      Évitez de travailler sur le même immeuble en même temps : le dernier
      qui enregistre l'emporte.</p>
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
