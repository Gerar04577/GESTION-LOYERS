// rentree.js — v87 — 04/09/2026
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
  /* BASCULE AU 1er SEPTEMBRE.

     De septembre à décembre, la rentrée de l'année civile a déjà eu lieu :
     ce qui reste à préparer est celle de l'année suivante. De janvier à
     août, on prépare celle de l'année en cours.

     En septembre 2026 : Rentrée 2027. En février 2027 : Rentrée 2027 —
     c'est bien le même dossier, celui qu'on remplit de février à l'été.

     La version précédente contenait une condition neutralisée qui rendait
     toujours l'année civile : le commentaire annonçait 2027 et le code
     ouvrait 2026. Corrigé le 04/09/2026. */
  const d = new Date();
  return d.getFullYear() + (d.getMonth() >= 8 ? 1 : 0);   /* 8 = septembre */
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
let anneeRentreeAffichee = null;

/* ---- Lecture et écriture ------------------------------------------------

   Le mois de rentrée suit exactement le même chemin que les mois
   calendaires : OneDrive fait foi, le stockage local ne sert que de cache.
   C'est la règle posée après l'incident du 18/08. */

function rentreeVide(annee) {
  return { annee, unites: {}, modifiePar: null, modifieLe: null };
}

function ligneRentreeVide() {
  return {
    statut: 'reste',
    locataireSuivant: '',
    acompte: null,
    dateAcompte: null,
    garantie: null,
    controles: { bail: false, avenant: false, samadhi: false, edle: false },
    verseeLe: null,          /* horodatage de la fusion, null si pas encore versée */
    verseeVers: null,        /* le mois calendaire qui a reçu l'unité */
    versePar: null,
  };
}

/* SILENCIEUSE : cette fonction est aussi appelée en arrière-plan, pour
   rafraîchir le libellé du bouton. Une alerte y surgirait trois secondes
   après l'ouverture de l'application, alors que l'utilisateur n'a rien
   demandé — et par-dessus le message de blocage hors ligne de
   l'application. Le message d'invitation est désormais dans
   ouvrirVueRentree, où il correspond à un geste volontaire. */
async function chargerRentree(annee) {
  if (typeof estConnecte !== 'function' || !estConnecte()) return null;
  try {
    const ref = await resoudreRefParChemin(RENTREE_DOSSIER, false);
    if (!ref) return rentreeVide(annee);
    /* lireFichierDansDossier rend une RÉPONSE, pas du texte — même
       convention que dans presence.js. */
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

/* VERROU ET RÉFÉRENCE EN RÉSERVE.

   enregistrerRentree est appelée à chaque saisie validée : un statut, un
   nom, un acompte, une case cochée. Sans verrou, deux clics rapides sur
   deux cases voisines lancent deux écritures concurrentes, dont la
   dernière arrivée écrase la première. C'est le principe posé après
   l'incident du 18/08 : plus aucune écriture qui se recouvre.

   La référence du dossier est mise en réserve après la première
   résolution : chaque saisie évitait sinon deux allers-retours vers
   OneDrive avant même d'écrire. */
let ecritureRentreeEnCours = false;
let ecritureRentreeAttendue = false;
let refDossierRentree = null;

async function enregistrerRentree() {
  if (!donneesRentree) return;
  if (ecritureRentreeEnCours) {
    /* Une écriture est déjà partie : on note qu'il faudra recommencer
       après, avec l'état le plus récent. Rien ne se perd. */
    ecritureRentreeAttendue = true;
    return;
  }
  ecritureRentreeEnCours = true;
  try {
    donneesRentree.modifiePar = (typeof obtenirMonPrenom === 'function')
      ? obtenirMonPrenom() : '';
    donneesRentree.modifieLe = new Date().toISOString();
    if (!refDossierRentree) {
      /* true : le dossier est créé s'il n'existe pas — cas du premier
         enregistrement d'une année. */
      refDossierRentree = await resoudreRefParChemin(RENTREE_DOSSIER, true);
    }
    await ecrireFichierDansDossier(refDossierRentree,
      `rentree-${donneesRentree.annee}.json`,
      JSON.stringify(donneesRentree, null, 2));
    localStorage.setItem(CLE_RENTREE + donneesRentree.annee,
      JSON.stringify(donneesRentree));
  } finally {
    ecritureRentreeEnCours = false;
    /* LA REPRISE DOIT ÊTRE ICI, PAS APRÈS.

       Placée après le bloc, elle était sautée quand l'écriture levait une
       erreur : le drapeau restait armé, la saisie mise en attente n'était
       jamais réécrite — et déclenchait une écriture en double à la saisie
       suivante. L'appel en attente se résolvait pourtant sans erreur, et
       l'écran se redessinait comme si tout était enregistré. */
    if (ecritureRentreeAttendue) {
      ecritureRentreeAttendue = false;
      /* Pas d'await ici : on est dans un finally, l'erreur éventuelle doit
         continuer de remonter à l'appelant. */
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
  /* Si l'écran est ouvert avant le chargement — cas rare mais possible —
     on repart d'une année vide plutôt que d'échouer. */
  if (!donneesRentree) donneesRentree = rentreeVide(anneeRentree());
  if (!donneesRentree.unites[uniteId]) {
    donneesRentree.unites[uniteId] = ligneRentreeVide();
  }
  return donneesRentree.unites[uniteId];
}

/* NORMALISER UNE LIGNE — objet des contrôles complété, statut ramené dans
   les valeurs connues.

   La garde était d'abord posée dans ligneRentree(), mais trois fonctions
   lisent donneesRentree.unites[...] DIRECTEMENT sans passer par elle :
   manquesRentree, resumeStatuts et le dessin des lignes. Et comptesRentree
   s'exécute en premier dans dessinerVueRentree — l'écran restait vide, sans
   message, sur un fichier dont une ligne n'a pas d'objet controles.

   La normalisation se fait donc AU CHARGEMENT, une fois pour toutes, sur
   toutes les lignes. Aucun chemin de lecture ne peut plus l'éviter. */
function normaliserLigne(l) {
  if (!l || typeof l !== 'object') l = ligneRentreeVide();
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

/* ---- Ce qui manque ------------------------------------------------------

   La liste que Gérard a demandée en premier : savoir d'un coup d'œil ce qui
   reste à faire avant la rentrée, locataire par locataire.

   Une unité qui reste n'a rien à préparer — on ne la compte pas. Une unité
   inoccupée est signalée à part : ce n'est pas un document qui manque, c'est
   un locataire. */
function manquesRentree() {
  const resultat = [];
  if (!donneesRentree) return resultat;
  toutesUnitesRentree().forEach(({ immeubleId, immeubleNom, unite }) => {
    const l = donneesRentree.unites[unite.id];
    if (!l) return;
    if (l.statut === 'reste') return;
    if (l.verseeLe) return;                /* déjà versée, plus rien à faire */

    const manquants = [];
    if (l.statut === 'attente' || !l.locataireSuivant) {
      manquants.push('remplaçant');
    }
    CONTROLES_RENTREE.forEach(c => {
      if (!c.partout && !immeubleAvecAvenant(immeubleId)) return;
      if (!l.controles[c.cle]) manquants.push(c.libelle);
    });
    /* L'acompte n'est pas dû par un locataire qui déménage dans le parc :
       il a déjà versé sa garantie ailleurs. */
    if (l.statut === 'depart' && !l.acompte &&
        !(estDemenagementInterne(l.locataireSuivant) && !l.homonyme)) {
      manquants.push('acompte');
    }

    if (manquants.length || l.statut === 'inoccupe') {
      resultat.push({
        immeubleNom, unite, ligne: l, manquants,
        inoccupe: l.statut === 'inoccupe',
      });
    }
  });
  /* Du plus incomplet au plus complet : ce qui demande le plus de travail
     apparaît en premier. */
  resultat.sort((a, b) => b.manquants.length - a.manquants.length);
  return resultat;
}

/* Un locataire qui figure déjà comme occupant d'une autre unité du parc
   déménage : il ne paie pas d'acompte, sa garantie suit. */
function estDemenagementInterne(nom) {
  if (!nom || !appData) return false;
  const cible = String(nom).trim().toLowerCase();
  if (!cible) return false;
  return toutesUnitesRentree().some(({ unite }) =>
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
  dessinerVueRentree();
}

function dessinerVueRentree(message) {
  const c = comptesRentree();
  const parImmeuble = {};
  toutesUnitesRentree().forEach(x => {
    (parImmeuble[x.immeubleNom] = parImmeuble[x.immeubleNom] || []).push(x);
  });

  let html = `<div class="vue-rentree">
    <div class="rentree-entete">
      <button class="btn-connexion" onclick="fermerVueRentree()">‹ Retour</button>
      <h2>Rentrée ${donneesRentree.annee}</h2>
      <span class="rentree-mois">vers ${libelleMois(moisAffiche)}</span>
      <div class="rentree-annee">
        <button class="btn-connexion mini" onclick="changerAnneeRentree(-1)">‹</button>
        <button class="btn-connexion mini" onclick="changerAnneeRentree(1)">›</button>
      </div>
    </div>
    ${message ? `<div class="rentree-message">${
      echapperR(message).replace(/\n/g, '<br>')}</div>` : ''}
    ${blocPresenceRentree()}
    <div class="rentree-douteux" id="rentree-douteux" style="display:none"></div>
    <p class="rentree-resume">${resumeStatuts()}</p>
    <button class="btn-connexion rentree-manques"
      onclick="ouvrirVueManques()">📝 Ce qui manque — ${c.locataires} locataire${
        c.locataires > 1 ? 's' : ''}, ${c.documents} document${c.documents > 1 ? 's' : ''}</button>
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
  window.scrollTo(0, 0);
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
  const l = ligneRentree(unite.id);
  const st = STATUTS_RENTREE.find(s => s.cle === l.statut) || STATUTS_RENTREE[0];
  const avecAvenant = immeubleAvecAvenant(immeubleId);
  const demenage = estDemenagementInterne(l.locataireSuivant);

  const cases = CONTROLES_RENTREE.map(ct => {
    const applicable = ct.partout || avecAvenant;
    if (!applicable) {
      return `<div class="rentree-case"><div class="case sans-objet">—</div>
        <span>${ct.libelle}</span></div>`;
    }
    const coche = !!l.controles[ct.cle];
    return `<div class="rentree-case">
      <div class="case ${coche ? 'ok' : 'manque'}"
        onclick="basculerControleRentree('${unite.id}','${ct.cle}')"
        >${coche ? '✓' : '●'}</div>
      <span>${ct.libelle}</span></div>`;
  }).join('');

  const pretAVerser = l.statut === 'depart' && l.locataireSuivant && !l.verseeLe;

  return `<div class="rentree-ligne" style="border-left-color:${st.couleur}">
    <div class="rentree-ligne-titre">
      <span class="rentree-unite">${echapperR(unite.designation)}</span>
      <select onchange="changerStatutRentree('${unite.id}', this.value)">
        ${STATUTS_RENTREE.map(s => `<option value="${s.cle}"${
          s.cle === l.statut ? ' selected' : ''}>${s.libelle}</option>`).join('')}
      </select>
    </div>

    <p class="rentree-locataires">${echapperR(unite.locataire || 'libre')}${
      l.statut === 'depart' || l.statut === 'attente'
        ? ` <span class="fleche">→</span> ` : ''}${
      l.statut === 'depart' || l.statut === 'attente'
        ? `<input type="text" class="rentree-suivant" value="${echapperR(l.locataireSuivant)}"
             placeholder="remplaçant" onchange="changerSuivantRentree('${unite.id}', this.value)">`
        : ''}</p>

    ${l.statut === 'depart' ? `
    <div class="rentree-montants">
      <label>acompte
        <input type="number" step="0.01" inputmode="decimal"
          value="${l.acompte == null ? '' : l.acompte}"
          ${demenage ? 'disabled placeholder="déménagement"' : 'placeholder="200,00"'}
          onchange="changerAcompteRentree('${unite.id}', this.value)"></label>
      <label>date
        <input type="date" value="${l.dateAcompte || ''}"
          onchange="changerDateRentree('${unite.id}', this.value)"></label>
      <label>garantie
        <input type="number" step="0.01" inputmode="decimal"
          value="${l.garantie == null ? '' : l.garantie}" placeholder="du bail"
          onchange="changerGarantieRentree('${unite.id}', this.value)"></label>
    </div>` : ''}

    <div class="rentree-cases">${cases}</div>

    ${l.verseeLe
      ? `<p class="rentree-versee">Versée dans ${echapperR(l.verseeVers)} le ${
          new Date(l.verseeLe).toLocaleDateString('fr-BE')}${
          l.versePar ? ' par ' + echapperR(l.versePar) : ''}
         ${l.verseeVers === moisAffiche
           ? `<button class="btn-connexion mini" onclick="annulerVersementRentree('${unite.id}')"
                >annuler</button>`
           : `<span class="rentree-autre-mois">place-toi sur ${echapperR(l.verseeVers)} pour annuler</span>`}</p>`
      : pretAVerser
        ? `<button class="btn-connexion rentree-verser"
             onclick="verserUniteRentree('${unite.id}')">Verser dans ${
             libelleMois(moisAffiche)}</button>`
        : ''}
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
function changerAcompteRentree(uniteId, valeur) {
  const v = String(valeur).replace(',', '.').trim();
  ligneRentree(uniteId).acompte = v === '' ? null : Number(v);
  enregistrerRentree();
}
function changerDateRentree(uniteId, valeur) {
  ligneRentree(uniteId).dateAcompte = valeur || null;
  enregistrerRentree();
}
function changerGarantieRentree(uniteId, valeur) {
  const v = String(valeur).replace(',', '.').trim();
  ligneRentree(uniteId).garantie = v === '' ? null : Number(v);
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

  if (!l.locataireSuivant) {
    return dessinerVueRentree("Indique d'abord le remplaçant.");
  }

  /* LES HOMONYMES NE SONT PAS DES DÉMÉNAGEMENTS.

     La détection repose sur le nom seul. Sur cinquante studios d'étudiants,
     deux personnes peuvent porter le même. Prises pour un déménagement,
     leur garantie ne serait pas initialisée et leur acompte jamais porté au
     crédit — sans que rien ne le signale.

     On demande donc confirmation, en nommant l'unité où le nom figure
     déjà. */
  if (estDemenagementInterne(l.locataireSuivant)) {
    const ou = toutesUnitesRentree().find(x => x.unite.locataire &&
      String(x.unite.locataire).trim().toLowerCase()
        === String(l.locataireSuivant).trim().toLowerCase());
    const memePersonne = confirm(
      `« ${l.locataireSuivant} » occupe déjà ${ou ? ou.unite.designation : 'une autre unité'}.\n\n` +
      `S'agit-il de la MÊME personne qui déménage ?\n\n` +
      `Oui : sa garantie le suit, aucun acompte n'est réclamé.\n` +
      `Non : c'est un homonyme, sa garantie repart de zéro.`);
    l.homonyme = !memePersonne;
  } else {
    l.homonyme = false;
  }
  /* UNE UNITÉ NE SE VERSE QU'UNE FOIS.

     Le bouton disparaît après le versement, mais rien n'empêchait un second
     appel — et l'acompte s'ajoutait alors une deuxième fois à la garantie,
     sans que l'annulation puisse le rattraper. Défaut trouvé en simulation
     le 02/09/2026. */
  if (l.verseeLe) {
    return dessinerVueRentree(
      `${u.designation} a déjà été versée dans ${l.verseeVers}. Annule d'abord si tu veux recommencer.`);
  }
  const ok = confirm(
    `Verser ${u.designation} dans ${libelleMois(moisAffiche)} ?\n\n` +
    `${u.locataire || 'libre'} → ${l.locataireSuivant}\n` +
    (l.garantie != null ? `Garantie due : ${l.garantie} €\n` : '') +
    (l.acompte ? `Acompte de ${l.acompte} € porté en garantie encaissée.\n` : '') +
    `\nLes loyers et charges ne sont pas modifiés.`);
  if (!ok) return;

  const demenagement = estDemenagementInterne(l.locataireSuivant) && !l.homonyme;
  /* Instantané complet, même principe qu'à l'annulation. */
  const instantaneAvant = JSON.parse(JSON.stringify(u));

  /* ON GARDE DE QUOI REVENIR EN ARRIÈRE, EXACTEMENT.

     Une unité peut n'avoir aucune garantie : le champ est alors absent, et
     non pas nul. Le distinguer importe — sinon l'annulation pose une
     garantie à zéro là où il n'y en avait aucune, et l'état d'origine
     n'est pas rétabli. Défaut trouvé en simulation le 02/09/2026. */
  l.ancienLocataire = ('locataire' in u) ? u.locataire : undefined;
  l.avaitMontant = ('garantieMontant' in u);
  l.ancienMontant = u.garantieMontant;
  l.avaitEncaissee = ('garantieEncaissee' in u);
  l.ancienneEncaissee = u.garantieEncaissee;
  l.avaitDatePaiement = ('garantieDatePaiement' in u);
  l.ancienneDatePaiement = u.garantieDatePaiement;
  l.avaitDebutBail = ('debutBail' in u);
  l.ancienDebutBail = u.debutBail;

  /* DEUX CHAMPS DE GARANTIE, À NE PAS CONFONDRE — l'application les
     distingue depuis la v85 :

       garantieMontant   ce qui est CONTRACTUELLEMENT dû, lu dans le bail ;
       garantieEncaissee ce qui a été RÉELLEMENT reçu.

     L'acompte est de l'argent reçu : il va dans garantieEncaissee. Le
     montant du bail, saisi dans l'écran de rentrée, va dans
     garantieMontant. Le restant dû se calcule tout seul par différence,
     comme pour n'importe quelle unité.

     J'écrivais d'abord dans un champ « garantie » qui n'existe pas : rien
     n'aurait atteint la garantie réelle. Défaut trouvé le 02/09/2026. */
  u.locataire = l.locataireSuivant;

  if (demenagement) {
    /* DÉMÉNAGEMENT INTERNE : la garantie du locataire le suit, telle
       quelle. Rien n'est ni ajouté ni remis à zéro — c'est le même argent,
       simplement rattaché à une autre unité. */
  } else {
    /* NOUVEAU LOCATAIRE : la garantie de l'ancien n'a rien à voir avec la
       sienne. On repart de zéro et on porte son acompte, sinon l'encaissé
       du partant s'ajouterait à celui de l'entrant — 400 € de l'un plus
       200 € de l'autre feraient croire à 600 € reçus. */
    u.garantieMontant = l.garantie != null ? Number(l.garantie) : 0;
    u.garantieEncaissee = l.acompte ? Number(l.acompte) : 0;
    u.garantieDatePaiement = l.dateAcompte || null;
  }
  if (l.dateAcompte) u.debutBail = l.dateAcompte;

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
  dessinerVueRentree(`${u.designation} versée dans ${libelleMois(moisAffiche)}.`);
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
function retablirUnite(u, l) {
  const remettre = (champ, avait, valeur) => {
    if (avait) u[champ] = valeur; else delete u[champ];
  };
  if (l.ancienLocataire === undefined) delete u.locataire;
  else u.locataire = l.ancienLocataire;

  remettre('garantieMontant', l.avaitMontant, l.ancienMontant);
  remettre('garantieEncaissee', l.avaitEncaissee, l.ancienneEncaissee);
  remettre('garantieDatePaiement', l.avaitDatePaiement, l.ancienneDatePaiement);
  remettre('debutBail', l.avaitDebutBail, l.ancienDebutBail);
}

async function annulerVersementRentree(uniteId) {
  const l = ligneRentree(uniteId);
  const trouve = toutesUnitesRentree().find(x => x.unite.id === uniteId);
  if (!trouve) return;
  const u = trouve.unite;
  if (!l.verseeLe) return;   /* rien n'a été versé : rien à annuler */

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
  versees.forEach(([uniteId, l]) => {
    const trouve = toutesUnitesRentree().find(x => x.unite.id === uniteId);
    if (trouve) {
      instantanes.push({ unite: trouve.unite,
                         avant: JSON.parse(JSON.stringify(trouve.unite)) });
      retablirUnite(trouve.unite, l);
    }
    memoire.set(l, { verseeLe: l.verseeLe, verseeVers: l.verseeVers, versePar: l.versePar });
    l.verseeLe = null; l.verseeVers = null; l.versePar = null;
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
  dessinerVueRentree(`${versees.length} versement(s) annulé(s).`);
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
      <button class="btn-connexion" onclick="ouvrirVueRentree()">‹ Retour</button>
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
            <span>${echapperR(m.unite.designation)}</span></p>
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
