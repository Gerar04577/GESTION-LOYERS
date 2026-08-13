// Gestion Loyers — logique applicative
// Étape 6 : suivi mensuel — un mois en cours créé automatiquement, mois passés
// consultables ET modifiables (ex. loyer payé en retard, noté après coup).

const JOURS_TOLERANCE_RETARD = 4; // reprend la règle de l'ancien fichier VBA (WARNING_Date)
const STORAGE_KEY_PREFIX = 'gestionLoyersData:'; // + mois, ex. gestionLoyersData:2026-08
const STORAGE_KEY_INDEX = 'gestionLoyersIndexMois';

const NOMS_MOIS = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];

let appData = null;
let moisAffiche = moisActuel();
let indexMoisConnus = []; // liste de "YYYY-MM" trié

function moisActuel() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function moisPrecedent(mois) {
  const [a, m] = mois.split('-').map(Number);
  const d = new Date(a, m - 2, 1); // m-1 (0-index) - 1 mois
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function moisSuivant(mois) {
  const [a, m] = mois.split('-').map(Number);
  const d = new Date(a, m, 1); // m (0-index) = mois suivant
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function libelleMois(mois) {
  const [a, m] = mois.split('-').map(Number);
  return `${NOMS_MOIS[m - 1]} ${a}`;
}

function calculerLoyerCC(unite) {
  if (unite.inoccupe) return 0;
  const brut = unite.loyerBrut || 0;
  const charges = unite.charges || 0;
  const poubelles = unite.poubelles || 0;
  const internet = unite.internet || 0;
  return brut + charges + poubelles + internet;
}

// Provision de charges = charges + poubelles + internet (colonnes L, M, N de l'ancien fichier).
// Affichage uniquement — jamais un champ saisi séparément, jamais ajouté une 2e fois au loyer CC.
function calculerProvisionCharges(unite) {
  return (unite.charges || 0) + (unite.poubelles || 0) + (unite.internet || 0);
}

function calculerFinAssurance(unite) {
  if (!unite.debutBail) return null;
  return calculerFinParDefaut(unite.debutBail);
}

function calculerFinParDefaut(dateDebut) {
  if (!dateDebut) return null;
  const d = new Date(dateDebut);
  if (isNaN(d.getTime())) return null;
  d.setFullYear(d.getFullYear() + 1);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function assuranceDueParDefaut(typeUnite) {
  return !(typeUnite === 'garage' || typeUnite === 'rdc_commercial');
}

function assuranceAVerifier(unite) {
  if (!unite.assuranceDue) return false;
  const fin = calculerFinAssurance(unite);
  if (!fin) return false;
  return new Date() > new Date(fin) && unite.assuranceStatut !== 'en_ordre';
}

function resteEnAttente(unite) {
  return calculerLoyerCC(unite) - (unite.montantsVerses || 0);
}

function conflitPoubelles(u) {
  if (u.inoccupe) return null;
  if (u.poubellesStatut === 'ND' && !(u.poubelles > 0)) return 'Statut ND (doit payer) mais 0€ dans les charges';
  if (u.poubellesStatut === 'D' && u.poubelles > 0) return 'Statut D (domicilié) mais montant facturé dans les charges';
  return null;
}

function conflitInternet(u) {
  if (u.inoccupe) return null;
  if (u.internetStatut === 'oui' && !(u.internet > 0)) return 'Statut Oui (doit payer) mais 0€ dans les charges';
  if (u.internetStatut === 'non' && u.internet > 0) return 'Statut Non mais montant facturé dans les charges';
  return null;
}

const JOURS_SEUIL_ORANGE = 2;
const JOURS_SEUIL_ROUGE = 4;

function calculerRetard(unite) {
  if (unite.inoccupe) return null;
  if (!unite.prochainPaiement) return null;
  const echeance = new Date(unite.prochainPaiement);
  const aujourdhui = new Date();
  const joursEcart = (aujourdhui - echeance) / (1000 * 60 * 60 * 24);
  const loyerCC = calculerLoyerCC(unite);
  const insuffisant = (unite.montantsVerses || 0) < loyerCC;
  if (!insuffisant) return null;
  if (joursEcart >= JOURS_SEUIL_ROUGE) return 'rouge';
  if (joursEcart >= JOURS_SEUIL_ORANGE) return 'orange';
  return null;
}

function estEnRetard(unite) {
  return calculerRetard(unite) !== null;
}

function formatMontant(n) {
  return new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
}

function calculerTotauxImmeuble(immeuble) {
  let du = 0, verse = 0;
  for (const u of immeuble.unites) {
    du += calculerLoyerCC(u);
    verse += (u.montantsVerses || 0);
  }
  return { du, verse, attente: du - verse };
}

function calculerTotauxGeneraux(data) {
  let du = 0, verse = 0;
  for (const immeuble of data.immeubles) {
    const t = calculerTotauxImmeuble(immeuble);
    du += t.du;
    verse += t.verse;
  }
  return { du, verse, attente: du - verse };
}

// ---------- Persistance (locale + OneDrive), par mois ----------

function sauvegarderLocal() {
  localStorage.setItem(STORAGE_KEY_PREFIX + moisAffiche, JSON.stringify(appData));
  const idx = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY_INDEX) || '[]'));
  idx.add(moisAffiche);
  localStorage.setItem(STORAGE_KEY_INDEX, JSON.stringify([...idx].sort()));
}

let sauvegardeEnCours = false;
const CLE_DERNIERE_SAUVEGARDE = 'gestionLoyersDerniereSauvegarde';
const CLE_DERNIER_ENVOI = 'gestionLoyersDernierEnvoi'; // ce qui a été tenté, pour vérif à la réouverture

async function sauvegarder() {
  sauvegarderLocal();
  render();
  if (typeof estConnecte === 'function' && estConnecte()) {
    sauvegardeEnCours = true;
    afficherStatutSync("Sauvegarde en cours… ne pas fermer l'app");
    const tentative = JSON.stringify(appData);
    localStorage.setItem(CLE_DERNIER_ENVOI, JSON.stringify({ mois: moisAffiche, contenu: tentative }));
    try {
      await sauvegarderMoisOneDrive(moisAffiche, appData);

      const relu = await chargerMoisOneDrive(moisAffiche);
      const identique = JSON.stringify(relu) === tentative;
      if (!identique) {
        throw new Error("Vérification échouée : le contenu relu ne correspond pas à ce qui a été envoyé");
      }

      const horodatage = new Date().toISOString();
      localStorage.setItem(CLE_DERNIERE_SAUVEGARDE, horodatage);
      localStorage.removeItem(CLE_DERNIER_ENVOI); // confirmé, plus besoin de vérifier au prochain démarrage
      afficherDerniereSauvegarde(horodatage);
      afficherStatutSync(`Sauvegardé et vérifié — ${libelleMois(moisAffiche)}`);
    } catch (err) {
      console.error("Échec sauvegarde OneDrive", err);
      afficherStatutSync("⚠️ Sauvegarde OneDrive NON confirmée : " + err.message, true);
    } finally {
      sauvegardeEnCours = false;
    }
  }
}

async function verifierEnvoiInterrompu() {
  const brut = localStorage.getItem(CLE_DERNIER_ENVOI);
  if (!brut) return; // rien en attente, tout est déjà confirmé
  const { mois, contenu } = JSON.parse(brut);
  if (typeof estConnecte !== 'function' || !estConnecte()) return;
  try {
    const distant = await chargerMoisOneDrive(mois);
    if (JSON.stringify(distant) === contenu) {
      // en fait bien arrivé (keepalive a fonctionné) — on confirme après coup
      localStorage.setItem(CLE_DERNIERE_SAUVEGARDE, new Date().toISOString());
      localStorage.removeItem(CLE_DERNIER_ENVOI);
      afficherDerniereSauvegarde(localStorage.getItem(CLE_DERNIERE_SAUVEGARDE));
    } else {
      afficherStatutSync(`⚠️ La dernière modification de ${libelleMois(mois)} n'a peut-être pas été sauvegardée — vérifie et resaisis si besoin`, true);
    }
  } catch (e) {
    console.error("Vérification de reprise impossible", e);
  }
}

function afficherDerniereSauvegarde(horodatageISO) {
  const el = document.getElementById('derniere-sauvegarde');
  if (!el) return;
  const d = new Date(horodatageISO);
  el.textContent = `Dernière sauvegarde OneDrive confirmée : ${d.toLocaleDateString('fr-BE')} à ${d.toLocaleTimeString('fr-BE', {hour:'2-digit', minute:'2-digit'})}`;
}

window.addEventListener('beforeunload', (e) => {
  if (sauvegardeEnCours) {
    e.preventDefault();
    e.returnValue = '';
  }
});

function afficherStatutSync(message, erreur = false) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('erreur', !!erreur);
}

function avancerDUnMois(dateStr) {
  if (!dateStr) return dateStr;
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function creerMoisDepuis(donneesPrecedentes) {
  // Nouveau mois : structure et tous les champs repris tels quels,
  // sauf : montants versés remis à zéro, prochain paiement avancé d'un mois
  // (exactement le comportement de l'ancien Module00PassageMois VBA).
  const copie = JSON.parse(JSON.stringify(donneesPrecedentes));
  for (const immeuble of copie.immeubles) {
    for (const u of immeuble.unites) {
      u.montantsVerses = 0;
      u.prochainPaiement = avancerDUnMois(u.prochainPaiement);
      u.aVentiler = false;
    }
  }
  return copie;
}

async function chargerDonneesInitiales() {
  const res = await fetch('data.json');
  return await res.json();
}

const CHAMPS_PROTEGES_REIMPORT = ['id', 'montantsVerses', 'commentaires', 'notesInternes'];

async function reimporterVentilation() {
  if (!confirm("Réimporter TOUTES les données depuis data.json dans le mois affiché ? (montants versés, prochain paiement, commentaires et notes internes déjà saisis ce mois-ci ne sont pas touchés — tout le reste, y compris locataire, désignation et statut inoccupé, sera remplacé)")) return;
  const frais = await chargerDonneesInitiales();
  const index = {};
  for (const b of frais.immeubles) {
    for (const u of b.unites) index[u.id] = u;
  }
  let maj = 0;
  for (const b of appData.immeubles) {
    for (const u of b.unites) {
      const source = index[u.id];
      if (!source) continue;
      for (const cle of Object.keys(source)) {
        if (CHAMPS_PROTEGES_REIMPORT.includes(cle)) continue;
        u[cle] = source[cle];
      }
      maj++;
    }
  }
  sauvegarder();
  alert(`${maj} unité(s) mise(s) à jour avec toutes les données (sauf versements/prochain paiement/notes déjà saisis ce mois-ci).`);
}

// ---------- Navigation entre mois ----------

async function allerAuMois(mois) {
  moisAffiche = mois;
  await chargerMoisCourant(false);
}

async function chargerMoisCourant(estOuvertureInitiale) {
  // 1) essayer OneDrive si connecté
  if (typeof estConnecte === 'function' && estConnecte()) {
    try {
      const index = await chargerIndexMoisOneDrive();
      indexMoisConnus = index.mois || [];
      const distant = await chargerMoisOneDrive(moisAffiche);
      if (distant) {
        appData = distant;
        sauvegarderLocal();
        render();
        afficherStatutSync(`Dernière sauvegarde chargée, vous pouvez travailler. Mais n'oubliez pas de sauvegarder ! (${libelleMois(moisAffiche)}, ${new Date().toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'})})`);
        return;
      }
      // Ce mois n'existe pas encore dans OneDrive : le recopier depuis le mois précédent
      // s'il y en a un (permet de préparer un mois à l'avance, pas seulement le vrai mois en cours)
      await demarrerNouveauMois();
      return;
    } catch (e) {
      console.error("Erreur OneDrive", e);
      afficherStatutSync("Erreur OneDrive : " + e.message, true);
    }
  }

  // 2) repli local
  const local = localStorage.getItem(STORAGE_KEY_PREFIX + moisAffiche);
  if (local) {
    appData = JSON.parse(local);
    render();
    return;
  }
  await demarrerNouveauMois();
}

async function demarrerNouveauMois() {
  // Chercher le mois précédent disponible (OneDrive ou local) pour reprendre la structure
  let base = null;
  const moisAConsiderer = [...indexMoisConnus].sort().reverse();
  const localIdx = JSON.parse(localStorage.getItem(STORAGE_KEY_INDEX) || '[]');
  const tousMoisConnus = [...new Set([...moisAConsiderer, ...localIdx])].sort().reverse();
  const moisPrecedentTrouve = tousMoisConnus.find(m => m < moisAffiche);

  if (moisPrecedentTrouve) {
    if (typeof estConnecte === 'function' && estConnecte()) {
      try { base = await chargerMoisOneDrive(moisPrecedentTrouve); } catch (e) { /* ignore, on retombe sur local */ }
    }
    if (!base) {
      const local = localStorage.getItem(STORAGE_KEY_PREFIX + moisPrecedentTrouve);
      if (local) base = JSON.parse(local);
    }
  }

  if (!base) {
    if (tousMoisConnus.length === 0) {
      base = await chargerDonneesInitiales(); // vraiment aucun historique nulle part : tout premier usage de l'app
    } else {
      // de l'historique existe, mais aucun mois avant celui-ci (navigation en arrière avant le début réel)
      appData = { immeubles: [] };
      render();
      afficherStatutSync(`Aucune donnée pour ${libelleMois(moisAffiche)}`, true);
      return;
    }
  } else {
    base = creerMoisDepuis(base);
  }

  appData = base;
  sauvegarder();
  afficherStatutSync(`Nouveau mois créé — ${libelleMois(moisAffiche)}`);
}

// ---------- Édition ----------

function trouverUnite(uniteId) {
  for (const immeuble of appData.immeubles) {
    const u = immeuble.unites.find(x => x.id === uniteId);
    if (u) return { immeuble, unite: u };
  }
  return null;
}

function demanderSuppressionUnite(uniteId) {
  const motif = prompt("Pourquoi supprimer cette unité ? (obligatoire, conservé comme trace)");
  if (motif === null) return; // annulé
  if (!motif.trim()) {
    alert("Un commentaire est obligatoire pour supprimer une unité.");
    return;
  }
  supprimerUnite(uniteId, motif.trim());
}

function supprimerUnite(uniteId, motif) {
  for (const immeuble of appData.immeubles) {
    const idx = immeuble.unites.findIndex(x => x.id === uniteId);
    if (idx !== -1) {
      const copieUnite = JSON.parse(JSON.stringify(immeuble.unites[idx]));
      journaliserSuppression('unite', copieUnite.designation, motif, copieUnite, immeuble.id);
      immeuble.unites.splice(idx, 1);
      break;
    }
  }
  sauvegarder();
}

function basculerMenuGestionImmeubles() {
  const menu = document.getElementById('menu-gestion-immeubles');
  const ouvert = menu.style.display !== 'none';
  if (ouvert) {
    menu.style.display = 'none';
    return;
  }
  menu.innerHTML = appData.immeubles.map(immeuble => `
    <div class="ligne-gestion-immeuble">
      <span>${immeuble.nom}</span>
      <button class="option-danger" onclick="demanderSuppressionImmeuble('${immeuble.id}')">🗑 Supprimer</button>
    </div>
  `).join('');
  menu.style.display = 'block';
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.zone-gestion-immeubles')) {
    const menu = document.getElementById('menu-gestion-immeubles');
    if (menu) menu.style.display = 'none';
  }
});

function demanderSuppressionImmeuble(immeubleId) {
  const immeuble = appData.immeubles.find(b => b.id === immeubleId);
  document.getElementById('menu-gestion-immeubles').style.display = 'none';

  if (!confirm(`⚠️ PREMIÈRE MISE EN GARDE ⚠️\n\nSupprimer tout l'immeuble "${immeuble.nom}" et ses ${immeuble.unites.length} unité(s) ?`)) return;
  if (!confirm(`⚠️ DEUXIÈME MISE EN GARDE ⚠️\n\nÊtes-vous VRAIMENT certain de vouloir supprimer "${immeuble.nom}" ? Cette action retire ${immeuble.unites.length} unité(s) (récupérable ensuite via la Corbeille).`)) return;

  const motif = prompt("Pourquoi supprimer cet immeuble ? (obligatoire, conservé comme trace)");
  if (motif === null) return;
  if (!motif.trim()) {
    alert("Un commentaire est obligatoire pour supprimer un immeuble.");
    return;
  }
  const copieImmeuble = JSON.parse(JSON.stringify(immeuble));
  journaliserSuppression('immeuble', immeuble.nom, motif.trim(), copieImmeuble, null);
  appData.immeubles = appData.immeubles.filter(b => b.id !== immeubleId);
  sauvegarder();
}

function journaliserSuppression(type, nom, motif, donnees, immeubleId) {
  if (!appData.journalSuppressions) appData.journalSuppressions = [];
  appData.journalSuppressions.push({
    type, nom, motif, donnees, immeubleId,
    date: new Date().toISOString(),
    mois: moisAffiche,
    restaure: false
  });
}

function restaurer(index) {
  const entree = appData.journalSuppressions[index];
  if (!entree || entree.restaure) return;
  if (!confirm(`Restaurer "${entree.nom}" avec toutes ses données ?`)) return;

  if (entree.type === 'unite') {
    const immeuble = appData.immeubles.find(b => b.id === entree.immeubleId);
    if (!immeuble) {
      alert("L'immeuble d'origine n'existe plus — impossible de restaurer directement l'unité.");
      return;
    }
    immeuble.unites.push(JSON.parse(JSON.stringify(entree.donnees)));
  } else if (entree.type === 'immeuble') {
    appData.immeubles.push(JSON.parse(JSON.stringify(entree.donnees)));
  }
  entree.restaure = true;
  sauvegarder();
}

function ajouterUnite(immeubleId) {
  const immeuble = appData.immeubles.find(b => b.id === immeubleId);
  const nouvelle = {
    id: `${immeubleId}-nouvelle-${Date.now()}`,
    designation: `NOUVELLE UNITÉ ${immeuble.nom.toUpperCase()}`,
    locataire: null,
    loyerBrut: 0, charges: 0, poubelles: 0, internet: 0,
    montantAssurance: 0,
    montantsVerses: 0, prochainPaiement: null,
    commentaires: '', notesInternes: '', aVentiler: false
  };
  immeuble.unites.push(nouvelle);
  sauvegarder();
  ouvrirEdition(nouvelle.id);
}

let uniteEnEdition = null;
let immeublesOuverts = new Set();
let immeublesOuvertsDocuments = new Set();

function ouvrirEdition(uniteId) {
  uniteEnEdition = uniteId;
  render();
  const el = document.getElementById('form-' + uniteId);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function fermerEdition() {
  uniteEnEdition = null;
  render();
}

function toutEnregistrer() {
  if (uniteEnEdition) {
    enregistrerEdition(uniteEnEdition); // commite d'abord le formulaire ouvert (appelle déjà sauvegarder())
  } else {
    sauvegarder();
  }
}

function enregistrerEdition(uniteId) {
  const found = trouverUnite(uniteId);
  if (!found) return;
  const u = found.unite;
  const get = (name) => document.getElementById(`f-${name}-${uniteId}`).value;

  u.designation = get('designation') || u.designation;
  u.locataire = get('locataire') || null;
  u.inoccupe = document.getElementById(`f-inoccupe-${uniteId}`).checked;
  u.loyerBrut = parseFloat(get('loyerBrut')) || 0;
  u.charges = parseFloat(get('charges')) || 0;
  u.poubelles = parseFloat(get('poubelles')) || 0;
  u.internet = parseFloat(get('internet')) || 0;
  u.poubellesStatut = get('poubellesStatut') || null;
  u.internetStatut = get('internetStatut') || null;
  if (found.immeuble.id !== 'vannes') {
    u.montantAssurance = parseFloat(get('montantAssurance')) || 0;
  }
  u.montantsVerses = parseFloat(get('montantsVerses')) || 0;
  u.prochainPaiement = get('prochainPaiement') || null;
  u.typeUnite = get('typeUnite') || null;
  u.debutBail = get('debutBail') || null;
  u.finBail = get('finBail') || null;
  u.bailEnregistre = document.getElementById(`f-bailEnregistre-${uniteId}`).checked;
  u.assuranceDue = document.getElementById(`f-assuranceDue-${uniteId}`).checked;
  u.assuranceStatut = get('assuranceStatut') || null;
  u.garantieMontant = parseFloat(get('garantieMontant')) || 0;
  u.garantieForme = get('garantieForme') || null;
  u.preuveGarantie = get('preuveGarantie') || '';
  if (found.immeuble.id !== 'vannes') {
    u.docAssurance = get('docAssurance') || '';
  }
  u.domiciliationOrdrePermanent = get('domiciliationOrdrePermanent') || '';
  u.commentaires = get('commentaires') || '';
  u.notesInternes = get('notesInternes') || '';
  u.aVentiler = false;

  uniteEnEdition = null;
  sauvegarder();
}

function champ(label, id, uniteId, value, type = 'text') {
  return `
    <label class="champ">
      <span>${label}</span>
      <input type="${type}" id="f-${id}-${uniteId}" value="${value ?? ''}">
    </label>`;
}

function champTexteLong(label, id, uniteId, value) {
  return `
    <label class="champ">
      <span>${label}</span>
      <textarea id="f-${id}-${uniteId}" rows="3">${value ?? ''}</textarea>
    </label>`;
}

function champSelect(label, id, uniteId, value, options) {
  const opts = options.map(([v, l]) =>
    `<option value="${v}" ${value === v ? 'selected' : ''}>${l}</option>`).join('');
  return `
    <label class="champ">
      <span>${label}</span>
      <select id="f-${id}-${uniteId}">
        <option value="">—</option>
        ${opts}
      </select>
    </label>`;
}

function champCheckbox(label, id, uniteId, checked) {
  return `
    <label class="champ champ-checkbox">
      <input type="checkbox" id="f-${id}-${uniteId}" ${checked ? 'checked' : ''}>
      <span>${label}</span>
    </label>`;
}

function formulaireEdition(immeuble, u) {
  const finAssurance = calculerFinAssurance(u);
  const assuranceDueVal = (u.assuranceDue !== undefined && u.assuranceDue !== null)
    ? u.assuranceDue : assuranceDueParDefaut(u.typeUnite);
  return `
    <div class="edit-form" id="form-${u.id}">
      ${champ('Désignation', 'designation', u.id, u.designation)}
      ${champ('Locataire (vide = libre)', 'locataire', u.id, u.locataire)}
      ${champCheckbox('Inoccupé ce mois (suspend le loyer attendu et les alertes)', 'inoccupe', u.id, u.inoccupe)}
      ${champ('Loyer brut (€)', 'loyerBrut', u.id, u.loyerBrut, 'number')}
      ${champ('Charges (€)', 'charges', u.id, u.charges, 'number')}
      ${champ('Poubelles (€)', 'poubelles', u.id, u.poubelles, 'number')}
      ${champSelect('Statut poubelles', 'poubellesStatut', u.id, u.poubellesStatut, [
        ['ND', 'ND — non domicilié, il paie'], ['D', 'D — domicilié, il ne paie pas ici']
      ])}
      ${conflitPoubelles(u) ? `<div class="conflit-warning">⚠️ ${conflitPoubelles(u)}</div>` : ''}
      ${champ('Internet (€)', 'internet', u.id, u.internet, 'number')}
      ${champSelect('Statut internet', 'internetStatut', u.id, u.internetStatut, [
        ['oui', 'Oui — il paie'], ['non', 'Non — il ne paie pas']
      ])}
      ${conflitInternet(u) ? `<div class="conflit-warning">⚠️ ${conflitInternet(u)}</div>` : ''}
      <p class="hint">Provision de charges (calculée, charges + poubelles + internet) : <strong>${calculerProvisionCharges(u).toFixed(2)} €</strong></p>
      ${champ('Montants versés (€)', 'montantsVerses', u.id, u.montantsVerses, 'number')}
      ${champ('Prochain paiement', 'prochainPaiement', u.id, u.prochainPaiement, 'date')}
      <div class="champ-lecture-seule">
        <span>Reste en attente</span>
        <span>${formatMontant(resteEnAttente(u))}</span>
      </div>

      <div class="section-titre">Bail</div>
      ${champ('Début du bail', 'debutBail', u.id, u.debutBail, 'date')}
      ${champ('Fin réelle du bail', 'finBail', u.id, u.finBail || calculerFinParDefaut(u.debutBail) || '', 'date')}
      ${champCheckbox('Bail enregistré', 'bailEnregistre', u.id, u.bailEnregistre)}

      <div class="section-titre">Garantie locative</div>
      ${champ('Montant garantie (€)', 'garantieMontant', u.id, u.garantieMontant, 'number')}
      ${champSelect('Forme', 'garantieForme', u.id, u.garantieForme, [
        ['especes', 'Espèces'], ['compte_bancaire', 'Compte bancaire bloqué'],
        ['garantie_bancaire', 'Garantie bancaire'], ['cpas', 'CPAS']
      ])}
      <div id="bloc-doc-garantie-${u.id}" style="display:${['compte_bancaire','garantie_bancaire','cpas'].includes(u.garantieForme) ? 'block' : 'none'};">
        <p>${u.docGarantieFichier ? `✓ Document déposé (${u.docGarantieFichier})` : '✗ Aucun document déposé'}</p>
        <input type="file" id="f-fichierGarantie-${u.id}" accept="application/pdf,image/*">
        <button type="button" class="btn-connexion" onclick="deposerDocumentGarantie('${u.id}')">📤 Déposer le document</button>
      </div>
      ${champ('Preuve garantie (référence/note)', 'preuveGarantie', u.id, u.preuveGarantie)}

      <div class="section-titre">Assurance</div>
      ${champSelect("Type d'unité", 'typeUnite', u.id, u.typeUnite, [
        ['studio', 'Studio'], ['appartement', 'Appartement'], ['duplex', 'Duplex'],
        ['garage', 'Garage'], ['rdc_commercial', 'RDC commercial'], ['autre', 'Autre']
      ])}
      <div class="champ champ-lecture-seule">
        <span>Fin d'assurance (calculée, début+12 mois)</span>
        <span>${finAssurance ? finAssurance : '— (renseigner le début du bail)'}</span>
      </div>
      ${champCheckbox('Assurance due par le locataire', 'assuranceDue', u.id, assuranceDueVal)}
      ${champSelect('Statut assurance', 'assuranceStatut', u.id, u.assuranceStatut, [
        ['en_ordre', 'En ordre'], ['a_verifier', 'À vérifier']
      ])}
      ${immeuble.id !== 'vannes' ? champ('Doc. assurance (référence/note)', 'docAssurance', u.id, u.docAssurance) : ''}
      ${immeuble.id !== 'vannes' ? champ('Montant assurance (€)', 'montantAssurance', u.id, u.montantAssurance, 'number') : `
        <p class="hint">Vannes : assurance payée directement par le locataire — déposer le document justificatif ci-dessous.</p>
        <p>${u.docAssuranceFichier ? `✓ Document déposé (${u.docAssuranceFichier})` : '✗ Aucun document déposé'}</p>
        <input type="file" id="f-fichierAssuranceVannes-${u.id}" accept="application/pdf,image/*">
        <button type="button" class="btn-connexion" onclick="deposerDocumentAssurance('${u.id}')">📤 Déposer le document</button>
      `}

      <div class="section-titre">Domiciliation</div>
      ${champ('Ordre permanent (référence/note)', 'domiciliationOrdrePermanent', u.id, u.domiciliationOrdrePermanent)}

      <div class="section-titre">Notes</div>
      ${champTexteLong('Commentaires', 'commentaires', u.id, u.commentaires)}
      ${champ('Notes internes', 'notesInternes', u.id, u.notesInternes)}
      <div class="edit-actions">
        <button class="btn btn-primary" onclick="enregistrerEdition('${u.id}')">Enregistrer</button>
        <button class="btn" onclick="fermerEdition()">Annuler</button>
        <button class="btn btn-danger" onclick="demanderSuppressionUnite('${u.id}')">Supprimer l'unité</button>
      </div>
    </div>`;
}

// ---------- Scan documents VéroS (indépendant, redondant volontairement) ----------
// Vue entièrement séparée de la liste des loyers, dédiée aux documents.

let resultatsScanDocuments = {}; // { uniteId: {trouves: [...]} ou {erreur: ...} }
let changementLocataireParUnite = {}; // { uniteId: true si locataire différent du mois précédent }
let filtreVueDocuments = '';

async function lancerScanDocuments() {
  if (typeof estConnecte !== 'function' || !estConnecte()) {
    alert("Connecte-toi à OneDrive d'abord pour vérifier les documents.");
    return;
  }
  document.getElementById('immeubles-container').style.display = 'none';
  document.getElementById('vue-documents').style.display = 'block';

  const statut = document.getElementById('statut-scan-documents');
  const barreConteneur = document.getElementById('barre-progression-conteneur');
  const barre = document.getElementById('barre-progression');
  barreConteneur.style.display = 'block';
  barre.style.width = '0%';

  // charger le mois précédent pour repérer les changements de locataire (ancien locataire = qui doit avoir l'EDLS)
  let ancienLocatairesParUnite = {};
  try {
    const moisPrec = moisPrecedent(moisAffiche);
    const donneesPrec = await chargerMoisOneDrive(moisPrec);
    if (donneesPrec) {
      for (const b of donneesPrec.immeubles) {
        for (const u of b.unites) ancienLocatairesParUnite[u.id] = u.locataire;
      }
    }
  } catch (e) { /* pas de mois précédent disponible, on continue sans */ }

  const unitesAScannaner = [];
  for (const b of appData.immeubles) {
    for (const u of b.unites) {
      if (u.locataire && !u.inoccupe) unitesAScannaner.push({ immeubleId: b.id, u });
    }
  }
  let fait = 0;
  for (const { immeubleId, u } of unitesAScannaner) {
    statut.textContent = `Vérification en cours… ${fait}/${unitesAScannaner.length}`;
    barre.style.width = `${Math.round((fait / unitesAScannaner.length) * 100)}%`;
    try {
      const resultat = await scannerUnite(immeubleId, u.designation, u.locataire);
      // si le locataire a changé depuis le mois précédent, l'EDLS attendu est celui de L'ANCIEN locataire
      const ancien = ancienLocatairesParUnite[u.id];
      const changement = !!(ancien && ancien !== u.locataire);
      changementLocataireParUnite[u.id] = changement;
      if (changement && resultat && !resultat.erreur && !resultat.trouves.includes('edls')) {
        try {
          const resultatAncien = await scannerUnite(immeubleId, u.designation, ancien);
          if (resultatAncien && !resultatAncien.erreur && resultatAncien.trouves.includes('edls')) {
            resultat.trouves.push('edls');
          }
        } catch (e) { /* ancien locataire introuvable dans OneDrive, tant pis */ }
      }
      resultatsScanDocuments[u.id] = resultat;
    } catch (e) {
      resultatsScanDocuments[u.id] = { erreur: e.message };
    }
    fait++;
    barre.style.width = `${Math.round((fait / unitesAScannaner.length) * 100)}%`;
    rendreVueDocuments();
  }
  barreConteneur.style.display = 'none';
  statut.textContent = `Vérification terminée — ${fait} unité(s) contrôlée(s) sur ${appData.immeubles.reduce((n,b)=>n+b.unites.length,0)} (${new Date().toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'})})`;
}

function retourVueLoyers() {
  // ferme TOUTES les vues secondaires par préfixe (vue-*), pas une par une à la main —
  // pour ne plus jamais en oublier une nouvellement ajoutée (c'est ce qui a posé
  // problème : 4 vues ajoutées depuis n'avaient jamais été prises en compte ici)
  document.querySelectorAll('[id^="vue-"]').forEach(el => { el.style.display = 'none'; });
  document.getElementById('immeubles-container').style.display = 'block';
}

function filtrerVueDocuments(valeur) {
  filtreVueDocuments = normaliserNom(valeur);
  rendreVueDocuments();
}

function rendreVueDocuments() {
  const container = document.getElementById('vue-documents-container');
  container.innerHTML = '';

  for (const immeuble of appData.immeubles) {
    const unitesAAfficher = immeuble.unites.filter(u => {
      if (!u.locataire || u.inoccupe) return false;
      if (filtreVueDocuments) {
        const cible = normaliserNom(u.designation + ' ' + u.locataire);
        if (!cible.includes(filtreVueDocuments)) return false;
      }
      return true;
    });
    if (!unitesAAfficher.length) continue;

    const nbAvecManque = unitesAAfficher.filter(u => {
      const s = statutDocumentsDetail(immeuble.id, u);
      return s && !s.erreur && s.lignes.some(l => l.requis && !l.present);
    }).length;

    const details = document.createElement('details');
    details.className = 'immeuble-card';
    details.open = immeublesOuvertsDocuments.has(immeuble.id) || !!filtreVueDocuments;
    details.addEventListener('toggle', () => {
      if (details.open) immeublesOuvertsDocuments.add(immeuble.id);
      else immeublesOuvertsDocuments.delete(immeuble.id);
    });

    const summary = document.createElement('summary');
    summary.innerHTML = `
      <span class="nom">${immeuble.nom}</span>
      <span class="sous-total">${unitesAAfficher.length} unité(s)${nbAvecManque ? ` — <span class="attente-immeuble">${nbAvecManque} avec document(s) manquant(s)</span>` : ' — tout est en ordre'}</span>
    `;
    details.appendChild(summary);

    for (const u of unitesAAfficher) {
      const statut = statutDocumentsDetail(immeuble.id, u);
      const row = document.createElement('div');
      row.className = 'unite-row';
      row.innerHTML = `
        <div style="flex:1;">
          <div class="designation">${u.designation}</div>
          <div class="locataire">${u.locataire}</div>
          ${statut ? rendreStatutDocumentsHTML(statut) : '<div class="statut-documents-erreur">Pas encore vérifié</div>'}
        </div>
      `;
      details.appendChild(row);
    }
    container.appendChild(details);
  }

  if (!container.children.length) {
    container.innerHTML = '<p class="placeholder-note">Aucune unité ne correspond.</p>';
  }

  rendreListeManquants();
}

function collecterDocumentsManquants() {
  const lignes = [];
  for (const b of appData.immeubles) {
    for (const u of b.unites) {
      if (!u.locataire || u.inoccupe) continue;
      const statut = statutDocumentsDetail(b.id, u);
      if (!statut || statut.erreur) continue;
      const manquants = statut.lignes.filter(l => l.requis && !l.present).map(l => l.label);
      if (manquants.length) {
        lignes.push({ immeuble: b.nom, unite: u.designation, locataire: u.locataire, manquants });
      }
    }
  }
  return lignes;
}

function rendreListeManquants() {
  const container = document.getElementById('liste-manquants-container');
  const lignes = collecterDocumentsManquants();
  if (!lignes.length) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `
    <div class="entete-vue-documents" style="margin-top:1.2rem;">
      <h2>Documents manquants (${lignes.length})</h2>
      <button class="btn-connexion" onclick="telechargerListeManquants()">⬇ Télécharger (CSV)</button>
    </div>
    <table class="table-comparaison" style="max-width:720px;margin:0 auto;">
      <thead><tr><th>Immeuble</th><th>Unité</th><th>Locataire</th><th>Manquant</th></tr></thead>
      <tbody>
        ${lignes.map(l => `<tr><td>${l.immeuble}</td><td>${l.unite}</td><td>${l.locataire}</td><td>${l.manquants.join(', ')}</td></tr>`).join('')}
      </tbody>
    </table>
  `;
}

function telechargerListeManquants() {
  const lignes = collecterDocumentsManquants();
  const entete = 'Immeuble;Unite;Locataire;Documents manquants\n';
  const corps = lignes.map(l =>
    [l.immeuble, l.unite, l.locataire, l.manquants.join(', ')]
      .map(champ => `"${String(champ).replace(/"/g, '""')}"`)
      .join(';')
  ).join('\n');
  const contenu = '\uFEFF' + entete + corps; // BOM pour un bon affichage des accents dans Excel
  const blob = new Blob([contenu], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `documents-manquants-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const LABELS_DOCUMENTS = { bail: 'Bail', edle: 'EDLE', edls: 'EDLS', avenant: 'Avenant', samadhi: 'Samadhi' };

// --- Import ponctuel VBA septembre (bouton temporaire, à retirer après usage) ---
// Le fichier JSON est préparé par Claude à partir du vrai fichier VBA (comme pour août),
// jamais l'app elle-même qui ne lit pas les .xlsm — juste un petit JSON déjà extrait.

function lancerImportVbaSeptembre(fichier) {
  if (!fichier) return;
  const lecteur = new FileReader();
  lecteur.onload = (e) => {
    let donneesVba;
    try {
      donneesVba = JSON.parse(e.target.result);
    } catch (err) {
      alert("Fichier illisible — ce doit être le JSON préparé par Claude, pas le fichier Excel directement.");
      return;
    }
    demarrerRevueVbaSeptembre(donneesVba);
  };
  lecteur.readAsText(fichier);
}

const LABELS_CHAMPS_VBA = {
  locataire: 'Locataire',
  loyerBrut: 'Loyer brut (€)',
  charges: 'Charges (€)',
  poubelles: 'Poubelles (€)',
  internet: 'Internet (€)',
};

let listeDifferencesVba = [];
let indexDifferenceVbaEnCours = 0;

function demarrerRevueVbaSeptembre(donneesVba) {
  listeDifferencesVba = [];
  for (const b of appData.immeubles) {
    for (const u of b.unites) {
      const entreeVba = donneesVba[u.id];
      if (!entreeVba) continue; // rien dans le VBA pour cette unité (ex. RDC commercial sans locataire), on ignore
      for (const champ of Object.keys(LABELS_CHAMPS_VBA)) {
        if (!(champ in entreeVba)) continue;
        const valeurVba = entreeVba[champ];
        const valeurActuelle = u[champ];
        const different = champ === 'locataire'
          ? normaliserNom(valeurVba) !== normaliserNom(valeurActuelle || '')
          : Number(valeurVba) !== Number(valeurActuelle || 0);
        if (different) {
          listeDifferencesVba.push({ uniteId: u.id, designation: u.designation, champ, valeurActuelle, valeurVba });
        }
      }
    }
  }
  indexDifferenceVbaEnCours = 0;
  document.getElementById('immeubles-container').style.display = 'none';
  document.getElementById('vue-import-vba').style.display = 'block';
  afficherProchaineDifferenceVba();
}

function afficherProchaineDifferenceVba() {
  const container = document.getElementById('vue-import-vba-container');
  if (indexDifferenceVbaEnCours >= listeDifferencesVba.length) {
    container.innerHTML = `<p class="placeholder-note">Terminé — ${listeDifferencesVba.length} différence(s) passée(s) en revue.</p>`;
    sauvegarder();
    return;
  }
  const d = listeDifferencesVba[indexDifferenceVbaEnCours];
  const label = LABELS_CHAMPS_VBA[d.champ];
  container.innerHTML = `
    <div class="immeuble-card" style="padding:1rem;">
      <div class="designation">${d.designation}</div>
      <p>${label} : <strong>${d.valeurActuelle ?? '(vide)'}</strong> → <strong>${d.valeurVba}</strong></p>
      <p class="placeholder-note">Différence ${indexDifferenceVbaEnCours + 1} sur ${listeDifferencesVba.length}</p>
      <button class="btn btn-primary" onclick="repondreDifferenceVba(true)">✓ Confirmer le changement</button>
      <button class="btn" onclick="repondreDifferenceVba(false)">✗ Ignorer</button>
    </div>
  `;
}

function repondreDifferenceVba(confirmer) {
  const d = listeDifferencesVba[indexDifferenceVbaEnCours];
  if (confirmer) {
    const trouve = trouverUnite(d.uniteId);
    if (trouve) trouve.unite[d.champ] = d.valeurVba;
  }
  indexDifferenceVbaEnCours++;
  afficherProchaineDifferenceVba();
}

async function deposerDocumentGarantie(uniteId) {
  const champFichier = document.getElementById(`f-fichierGarantie-${uniteId}`);
  const fichier = champFichier && champFichier.files[0];
  if (!fichier) { alert("Choisis d'abord un fichier."); return; }

  const trouve = trouverUnite(uniteId);
  if (!trouve) return;
  const { immeuble: b, unite: u } = trouve;
  if (!u.locataire) { alert("Pas de locataire sur cette unité."); return; }

  try {
    const refLocataire = await obtenirRefLocataire(b.id, u.designation, u.locataire);
    const nomDepose = await televerserFichierDansSousDossier(refLocataire, 'Garantie', fichier);
    u.docGarantieFichier = nomDepose;
    sauvegarder();
    alert(`Document "${nomDepose}" déposé dans OneDrive (dossier Garantie de ${u.locataire}).`);
    ouvrirEdition(uniteId);
  } catch (e) {
    alert("Échec du dépôt : " + e.message);
  }
}

async function deposerDocumentAssurance(uniteId) {
  const champFichier = document.getElementById(`f-fichierAssuranceVannes-${uniteId}`);
  const fichier = champFichier && champFichier.files[0];
  if (!fichier) { alert("Choisis d'abord un fichier."); return; }

  const trouve = trouverUnite(uniteId);
  if (!trouve) return;
  const { immeuble: b, unite: u } = trouve;
  if (!u.locataire) { alert("Pas de locataire sur cette unité."); return; }

  try {
    const refLocataire = await obtenirRefLocataire(b.id, u.designation, u.locataire);
    const nomDepose = await televerserFichierDansSousDossier(refLocataire, 'Assurance', fichier);
    u.docAssuranceFichier = nomDepose;
    sauvegarder();
    alert(`Document "${nomDepose}" déposé dans OneDrive (dossier Assurance de ${u.locataire}).`);
    ouvrirEdition(uniteId);
  } catch (e) {
    alert("Échec du dépôt : " + e.message);
  }
}

const GUIDE_SIMPLE = `
<h3>Gestion Loyers — Mode d'emploi simple</h3>
<p><strong>1. À l'ouverture</strong> — le bandeau vert en haut confirme que les dernières données sont bien chargées. Un bandeau rouge signale un problème.</p>
<p><strong>2. Se connecter à OneDrive</strong> — clique sur "Se connecter à OneDrive" une fois, connecte-toi avec ton compte habituel.</p>
<p><strong>3. Changer de mois</strong> — les flèches ‹ › en haut. La première fois qu'on passe à un nouveau mois, tout est repris automatiquement (locataires, loyers, charges), sauf les montants versés qui repartent à zéro.</p>
<p><strong>4. Modifier une unité</strong> — clique sur la ligne d'un locataire, modifie les champs, clique sur "Enregistrer" en bas du formulaire.</p>
<p><strong>5. ⚠️ Toujours sauvegarder</strong> — après avoir modifié une ou plusieurs unités, clique sur le gros bouton doré "Tout enregistrer maintenant". C'est le point le plus important.</p>
<p><strong>6. Vérifier documents</strong> — scanne OneDrive pour chaque locataire : ✅ vert = trouvé, ❌ rouge = manquant, ➖ gris = pas nécessaire.</p>
<p><strong>7. Déposer un document</strong> — pour l'assurance à Vannes ou pour certaines formes de garantie, un bouton "📤 Déposer le document" apparaît dans le formulaire : choisis le fichier, clique dessus, il part directement dans le dossier du locataire sur OneDrive.</p>
<p><strong>8. Dettes locataires</strong> — bouton rouge, liste cumulée des mois déjà terminés (jamais le mois en cours). Ne montrera quelque chose qu'à partir d'octobre.</p>
<p><strong>9. En cas de gros problème</strong> — "🔍 Diagnostic OneDrive" pour comprendre sans rien casser ; "🗑️ Déconnecter et tout réinitialiser" en dernier recours (efface seulement ce qui est sur cet appareil, jamais ce qui est sur OneDrive ; deux confirmations dont taper SUPPRIMER, pour éviter tout clic accidentel).</p>
<p><strong>En résumé, 3 réflexes</strong> : vérifier le bandeau vert à l'ouverture, cliquer sur "Enregistrer" après chaque modification, cliquer sur "Tout enregistrer maintenant" avant de fermer.</p>
`;

const GUIDE_COMPLET = `
<h3>Gestion Loyers — Structure complète</h3>
<p><strong>Architecture</strong> — HTML/JS pur, aucune librairie ni CDN. 4 fichiers JS (app.js, graph-auth.js, graph-storage.js, graph-veros-scan.js) + index.html + style.css + data.json. Dépôt GitHub Gerar04577/GESTION-LOYERS, publié sur gerar04577.github.io/GESTION-LOYERS/.</p>
<p><strong>Stockage OneDrive</strong> — dossier partagé "Immobilier 2025-2026" (le même que VéroS) → "GESTION-LOYERS/historique/" → un fichier JSON par mois (ex. 2026-08.json) + index.json listant tous les mois connus.</p>
<p><strong>Navigation par identifiant</strong> — depuis la v30, l'app navigue toujours par identifiant OneDrive (jamais par chemin texte), pour fonctionner aussi bien sur ton compte (dossier réel) que sur celui de Véronique/Carine (dossier vu en raccourci).</p>
<p><strong>Modèle de données par unité</strong> — locataire, loyer brut, charges, poubelles, internet (→ Loyer CC = la somme des 4, Provision de charges = charges+poubelles+internet affiché à part), montants versés, montant assurance (sauf Vannes), garantie (montant + forme : Espèces/Compte bancaire bloqué/Garantie bancaire/CPAS), bail (début/fin, enregistré), documents déposés (référence fichier).</p>
<p><strong>RÈGLE VERSION</strong> — chaque modification de fichier doit incrémenter le numéro affiché ET les 5 adresses ?v=NN dans index.html (4 scripts + le CSS), sinon risque de cache navigateur.</p>
<p><strong>Cas particulier Vannes</strong> — assurance payée directement par le locataire : pas de montant à saisir, juste un document à déposer et sauvegarder dans OneDrive (sous-dossier "Assurance" du locataire).</p>
<p><strong>Dépôt de documents (garantie + assurance Vannes)</strong> — fonctions obtenirRefLocataire (résout le dossier OneDrive du locataire) et televerserFichierDansSousDossier (dépose le fichier, crée le sous-dossier si besoin) dans graph-storage.js / graph-veros-scan.js.</p>
<p><strong>Dettes locataires</strong> — cumul sur tous les mois strictement PASSÉS (jamais le mois affiché), loyer CC - versé sommé mois après mois ; assurance en montant unique (pas cumulée, sauf Vannes exclue).</p>
<p><strong>Vérification documents OneDrive</strong> — scan indépendant de VéroS (redondant volontairement) : Bail/EDLE/EDLS/Avenant/Samadhi détectés par nom de fichier réel (jamais un dossier vide). Règles : avenant obligatoire Nimy/PTG/Biche sauf Delise/Delisse, RDC COMMERCIAL, "APPARTEMENT" Biche ; Samadhi obligatoire Nimy/Biche + PTG studios 5-10.</p>
<p><strong>Outils de diagnostic/gestion</strong> — Gérer les immeubles, Consulter les baux, Comparer noms OneDrive, Diagnostic OneDrive (montre le compte réellement connecté et ce qu'il voit), Déconnecter et tout réinitialiser (nettoyage par préfixe "gestionLoyers*", pas clé par clé, pour ne jamais rien oublier).</p>
<p><strong>Import VBA</strong> — bouton temporaire "Importer VBA septembre" : charge un JSON pré-extrait par Claude depuis l'ancien fichier Excel, compare champ par champ par id stable, questions Confirmer/Ignorer une par une. À retirer après usage.</p>
`;

function ouvrirVueAide() {
  document.getElementById('immeubles-container').style.display = 'none';
  document.getElementById('vue-aide').style.display = 'block';
  afficherGuide('simple');
}

function afficherGuide(quel) {
  document.getElementById('vue-aide-container').innerHTML = quel === 'simple' ? GUIDE_SIMPLE : GUIDE_COMPLET;
}

async function ouvrirVueDettes() {
  document.getElementById('immeubles-container').style.display = 'none';
  document.getElementById('vue-dettes').style.display = 'block';
  const container = document.getElementById('vue-dettes-container');
  container.innerHTML = '<p class="placeholder-note">Calcul en cours…</p>';

  // rassembler tous les mois connus, du plus ancien au plus récent
  let tousMois = [...new Set([...indexMoisConnus, ...(JSON.parse(localStorage.getItem(STORAGE_KEY_INDEX) || '[]'))])].sort();

  // le mois AFFICHÉ n'est jamais compté : un mois en cours n'est pas "en retard",
  // il n'est simplement pas encore terminé — seuls les mois strictement PASSÉS comptent
  const moisPasses = tousMois.filter(m => m < moisAffiche);

  if (!moisPasses.length) {
    container.innerHTML = '<p class="placeholder-note">Pas encore de mois entièrement passé à comparer — la liste des dettes ne peut commencer qu\'une fois qu\'au moins un mois précédent est terminé.</p>';
    return;
  }

  // dette par unité : { loyer: cumul sur tous les mois passés, assurance: montant du dernier mois passé où impayée }
  const dettesParUnite = {};

  for (const mois of moisPasses) {
    const donnees = typeof estConnecte === 'function' && estConnecte()
      ? await chargerMoisOneDrive(mois).catch(() => null)
      : JSON.parse(localStorage.getItem(STORAGE_KEY_PREFIX + mois) || 'null');
    if (!donnees || !donnees.immeubles) continue;

    for (const b of donnees.immeubles) {
      for (const u of b.unites) {
        if (!u.locataire || u.inoccupe) continue;
        const cle = `${b.id}__${u.designation}__${u.locataire}`;
        if (!dettesParUnite[cle]) {
          dettesParUnite[cle] = { immeuble: b.nom, unite: u.designation, locataire: u.locataire, loyer: 0, assurance: 0 };
        }
        const loyerDu = calculerLoyerCC(u) - (u.montantsVerses || 0);
        if (loyerDu > 0) dettesParUnite[cle].loyer += loyerDu;

        // assurance : montant unique, pas cumulé — le dernier mois connu fait foi (elle se reporte telle quelle)
        if (b.id !== 'vannes' && u.assuranceDue && u.assuranceStatut !== 'en_ordre') {
          dettesParUnite[cle].assurance = u.montantAssurance || 0;
        } else if (b.id !== 'vannes') {
          dettesParUnite[cle].assurance = 0; // remise en ordre depuis, on efface la dette
        }
      }
    }
  }

  const lignes = Object.values(dettesParUnite).filter(d => d.loyer > 0 || d.assurance > 0);
  let totalLoyer = 0, totalAssurance = 0;
  lignes.forEach(d => { totalLoyer += d.loyer; totalAssurance += d.assurance; });
  const totalGeneral = totalLoyer + totalAssurance;

  if (!lignes.length) {
    container.innerHTML = '<p class="placeholder-note">✓ Aucune dette — tout est en ordre.</p>';
    return;
  }

  container.innerHTML = `
    <div class="totaux-generaux" style="margin-bottom:1rem;">
      <div class="total-item"><span>Total loyers dus</span><strong>${totalLoyer.toFixed(2)} €</strong></div>
      <div class="total-item"><span>Total assurances dues</span><strong>${totalAssurance.toFixed(2)} €</strong></div>
      <div class="total-item"><span>Total général</span><strong style="color:var(--alert-red);">${totalGeneral.toFixed(2)} €</strong></div>
    </div>
    <table class="table-comparaison">
      <thead><tr><th>Immeuble</th><th>Unité</th><th>Locataire</th><th>Loyer dû (cumulé)</th><th>Assurance due</th></tr></thead>
      <tbody>
        ${lignes.map(d => `<tr>
          <td>${d.immeuble}</td><td>${d.unite}</td><td>${d.locataire}</td>
          <td>${d.loyer > 0 ? d.loyer.toFixed(2) + ' €' : '—'}</td>
          <td>${d.assurance > 0 ? d.assurance.toFixed(2) + ' €' : '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  `;
}

async function ouvrirVueOneDrive() {
  if (typeof estConnecte !== 'function' || !estConnecte()) {
    alert("Connecte-toi à OneDrive d'abord.");
    return;
  }
  document.getElementById('immeubles-container').style.display = 'none';
  document.getElementById('vue-onedrive').style.display = 'block';
  document.getElementById('vue-onedrive-resultats').innerHTML = '';

  const container = document.getElementById('vue-onedrive-immeubles');
  container.innerHTML = '<p class="placeholder-note">Chargement des immeubles…</p>';
  const lignes = [];
  for (const b of appData.immeubles) {
    try {
      const url = await obtenirLienImmeuble(b.id);
      lignes.push(`<div class="ligne-gestion-immeuble"><span>${b.nom}</span><a class="btn-connexion" href="${url}" target="_blank" rel="noopener" style="text-decoration:none;display:inline-block;">Ouvrir</a></div>`);
    } catch (e) {
      lignes.push(`<div class="ligne-gestion-immeuble"><span>${b.nom}</span><span class="statut-documents-erreur">Indisponible</span></div>`);
    }
  }
  container.innerHTML = `<div class="menu-gestion-immeubles">${lignes.join('')}</div>`;
}

async function lancerRechercheOneDrive() {
  const texte = document.getElementById('recherche-onedrive').value.trim();
  const container = document.getElementById('vue-onedrive-resultats');
  if (!texte) { container.innerHTML = ''; return; }
  container.innerHTML = '<p class="placeholder-note">Recherche en cours…</p>';
  const resultats = await rechercherDansOneDrive(texte);
  if (!resultats.length) {
    container.innerHTML = '<p class="placeholder-note">Aucun résultat.</p>';
    return;
  }
  container.innerHTML = `<div class="menu-gestion-immeubles">${resultats.map(r => `
    <div class="ligne-gestion-immeuble">
      <span>${r.immeuble} — ${r.unite} — ${r.locataire}</span>
      <a class="btn-connexion" href="${r.webUrl}" target="_blank" rel="noopener" style="text-decoration:none;display:inline-block;">Ouvrir</a>
    </div>
  `).join('')}</div>`;
}

function reinitialisationComplete() {
  document.getElementById('immeubles-container').style.display = 'none';
  document.getElementById('vue-reinitialisation').style.display = 'block';
  document.getElementById('reinit-etape-1').style.display = 'block';
  document.getElementById('reinit-etape-2').style.display = 'none';
  document.getElementById('reinit-mot-confirmation').value = '';
  document.getElementById('reinit-bouton-final').disabled = true;
}

function reinitPasserEtape2() {
  document.getElementById('reinit-etape-1').style.display = 'none';
  document.getElementById('reinit-etape-2').style.display = 'block';
}

function reinitVerifierMot() {
  const saisi = document.getElementById('reinit-mot-confirmation').value.trim().toUpperCase();
  document.getElementById('reinit-bouton-final').disabled = (saisi !== 'SUPPRIMER');
}

function reinitExecuter() {
  // Nettoyage PAR PRÉFIXE, pas clé par clé : tout ce qui commence par "gestionLoyers"
  // est effacé, pour ne jamais rien oublier même si une clé est ajoutée plus tard sans
  // penser à mettre à jour cette fonction (c'est ce qui avait posé problème sur un autre projet).
  const clesLocalStorage = Object.keys(localStorage).filter(k => k.startsWith('gestionLoyers'));
  clesLocalStorage.forEach(k => localStorage.removeItem(k));

  const clesSessionStorage = Object.keys(sessionStorage).filter(k => k.startsWith('gestionLoyers'));
  clesSessionStorage.forEach(k => sessionStorage.removeItem(k));

  alert(`Réinitialisation terminée (${clesLocalStorage.length + clesSessionStorage.length} élément(s) effacé(s)). L'application va recharger.`);
  window.location.reload();
}

async function lancerDiagnosticRacine() {
  if (typeof estConnecte !== 'function' || !estConnecte()) {
    alert("Connecte-toi à OneDrive d'abord.");
    return;
  }
  document.getElementById('immeubles-container').style.display = 'none';
  document.getElementById('vue-diagnostic').style.display = 'block';
  const container = document.getElementById('vue-diagnostic-container');
  container.innerHTML = '<p class="placeholder-note">Lecture en cours…</p>';

  let html = '';

  // 1. Identité du compte réellement connecté
  try {
    const resMoi = await appelGraph('/me?$select=displayName,mail,userPrincipalName');
    const moi = await resMoi.json();
    html += `<div class="immeuble-card" style="padding:1rem;">
      <div class="designation">Compte connecté</div>
      <p>Nom : <strong>${moi.displayName || '(inconnu)'}</strong><br>
      Email (mail) : <strong>${moi.mail || '(vide)'}</strong><br>
      Identifiant (userPrincipalName) : <strong>${moi.userPrincipalName || '(vide)'}</strong></p>
    </div>`;
  } catch (e) {
    html += `<div class="immeuble-card" style="padding:1rem;"><div class="statut-documents-erreur">⚠️ Impossible de lire l'identité du compte : ${e.message}</div></div>`;
  }

  // 2. Racine du drive : tout ce qui est visible à la racine de "Mes fichiers"
  try {
    const resRacine = await appelGraph('/me/drive/root/children?$select=name,folder,remoteItem');
    const dataRacine = await resRacine.json();
    const dossiers = (dataRacine.value || []).filter(e => e.folder || e.remoteItem).map(e => e.name + (e.remoteItem ? ' (raccourci)' : ''));
    const presentImmobilier = dossiers.some(n => n.toLowerCase().includes('immobilier'));
    html += `<div class="immeuble-card" style="padding:1rem;">
      <div class="designation">Racine de "Mes fichiers" (${dossiers.length} dossier(s))</div>
      <p>${dossiers.length ? dossiers.join(', ') : '(aucun dossier trouvé)'}</p>
      <p style="font-weight:700;color:${presentImmobilier ? '#2e7d4f' : 'var(--alert-red)'};">
        ${presentImmobilier ? '✓ "Immobilier 2025-2026" est bien visible ici' : "✗ Immobilier 2025-2026 n'est PAS visible ici"}
      </p>
    </div>`;
  } catch (e) {
    html += `<div class="immeuble-card" style="padding:1rem;"><div class="statut-documents-erreur">⚠️ Impossible de lire la racine du drive : ${e.message}</div></div>`;
  }

  // 3. Accès par identifiant (nouvelle méthode, gère aussi les raccourcis)
  try {
    const refRacine = await obtenirRefRacineImmobilier();
    const enfantsDirect = await enfantsDeRef(refRacine);
    const dossiers = enfantsDirect.filter(e => e.folder || e.remoteItem).map(e => e.name);
    html += `<div class="immeuble-card" style="padding:1rem;">
      <div class="designation">Accès direct à "Immobilier 2025-2026" (par identifiant)</div>
      <p style="color:#2e7d4f;font-weight:700;">✓ Trouvé — contenu : ${dossiers.join(', ') || '(vide)'}</p>
    </div>`;
  } catch (e) {
    html += `<div class="immeuble-card" style="padding:1rem;">
      <div class="designation">Accès direct à "Immobilier 2025-2026" (par identifiant)</div>
      <p class="statut-documents-erreur">✗ Échec : ${e.message}</p>
    </div>`;
  }

  // 4. Comparaison : l'ancienne méthode par chemin texte (pour montrer la différence)
  try {
    const resDirect = await appelGraph(`/me/drive/root:/${encodeURIComponent(DOSSIER_RACINE_PARTAGE)}:/children?$select=name,folder`);
    if (resDirect.ok) {
      const dataDirect = await resDirect.json();
      const dossiers = (dataDirect.value || []).filter(e => e.folder).map(e => e.name);
      html += `<div class="immeuble-card" style="padding:1rem;">
        <div class="designation">Ancienne méthode (par chemin texte)</div>
        <p style="color:#2e7d4f;font-weight:700;">✓ Trouvé — contenu : ${dossiers.join(', ') || '(vide)'}</p>
      </div>`;
    } else {
      const erreurTexte = await resDirect.text();
      html += `<div class="immeuble-card" style="padding:1rem;">
        <div class="designation">Ancienne méthode (par chemin texte)</div>
        <p class="statut-documents-erreur">✗ Échec (${resDirect.status}) : ${erreurTexte.slice(0, 300)}</p>
      </div>`;
    }
  } catch (e) {
    html += `<div class="immeuble-card" style="padding:1rem;"><div class="statut-documents-erreur">⚠️ ${e.message}</div></div>`;
  }

  container.innerHTML = html;
}

async function lancerComparaisonDossiers() {
  if (typeof estConnecte !== 'function' || !estConnecte()) {
    alert("Connecte-toi à OneDrive d'abord.");
    return;
  }
  document.getElementById('immeubles-container').style.display = 'none';
  document.getElementById('vue-comparaison').style.display = 'block';
  const container = document.getElementById('vue-comparaison-container');
  container.innerHTML = '<p class="placeholder-note">Lecture de OneDrive en cours…</p>';

  const resultatsParImmeuble = [];
  for (const b of appData.immeubles) {
    const nomOneDrive = DOSSIER_ONEDRIVE_PAR_IMMEUBLE[b.id];
    let dossiersReels = [];
    let erreur = null;
    try {
      const refImmeuble = await obtenirRefImmeuble(b.id);
      const enfants = await enfantsDeRef(refImmeuble);
      dossiersReels = enfants.filter(e => e.folder || e.remoteItem).map(e => e.name);
    } catch (e) {
      erreur = e.message;
    }
    resultatsParImmeuble.push({ immeuble: b, nomOneDrive, dossiersReels, erreur });
  }

  container.innerHTML = resultatsParImmeuble.map(r => {
    const dossiersReelsUtilises = new Set();
    const lignes = r.immeuble.unites.map(u => {
      const attendu = extraireNomUnite(u.designation, r.nomOneDrive);
      const cible = extraireTypeEtNumero(u.designation);
      const typesAcceptesIci = cible.type === 'RDC' ? ['RDC', 'RDC_COMMERCIAL'] : [cible.type];
      const reel = r.dossiersReels.find(d => {
        const t = extraireTypeEtNumero(d);
        return cible.type && typesAcceptesIci.includes(t.type) && t.num === cible.num;
      });
      if (reel) dossiersReelsUtilises.add(reel);
      return `<tr class="${!reel ? 'ligne-non-correspondante' : ''}">
        <td>${attendu || '—'}</td>
        <td>${reel || '(aucune correspondance trouvée)'}</td>
      </tr>`;
    });
    // dossiers réels qui ne correspondent à aucune unité attendue (ex. "Bail RDC Commercial 2022",
    // "Photos Géomètre avril 2024") — affichés à part, jamais mélangés aux vraies unités
    const extras = r.dossiersReels.filter(d => !dossiersReelsUtilises.has(d));
    return `
      <details class="immeuble-card" open>
        <summary><span class="nom">${r.immeuble.nom}</span><span class="sous-total">dossier OneDrive : "${r.nomOneDrive}"</span></summary>
        ${r.erreur ? `<div class="statut-documents-erreur" style="padding:0.8rem;">⚠️ ${r.erreur}</div>` : `
        <table class="table-comparaison">
          <thead><tr><th>Attendu par Gestion Loyers</th><th>Trouvé dans OneDrive</th></tr></thead>
          <tbody>${lignes.join('')}</tbody>
        </table>
        ${extras.length ? `<p class="placeholder-note" style="padding:0.6rem 0.9rem;">Dossiers présents dans OneDrive mais qui ne correspondent à aucune unité (normal — pas des logements) : ${extras.join(', ')}</p>` : ''}
        `}
      </details>`;
  }).join('');
}

function statutDocumentsDetail(immeubleId, u) {
  if (!u.locataire || u.inoccupe) return null;
  const res = resultatsScanDocuments[u.id];
  if (!res) return null;
  if (res.erreur) return { erreur: res.erreur };
  const lignes = [];
  for (const type of ['bail', 'edle', 'edls', 'avenant', 'samadhi']) {
    let requis = true;
    if (type === 'avenant') requis = avenantRequis(immeubleId, u.locataire, u.designation);
    if (type === 'samadhi') requis = samadhiRequis(immeubleId, u.designation);
    if (type === 'edls') requis = !!changementLocataireParUnite[u.id]; // rouge seulement si changement de locataire détecté
    const present = res.trouves.includes(type);
    lignes.push({ type, label: LABELS_DOCUMENTS[type], present, requis });
  }
  return { lignes };
}

function rendreStatutDocumentsHTML(statut) {
  if (!statut) return '';
  if (statut.erreur) return `<div class="statut-documents statut-documents-erreur">⚠️ ${statut.erreur}</div>`;
  return `<div class="statut-documents">${statut.lignes.map(l => {
    let icone, classe;
    if (l.present) { icone = '✓'; classe = 'doc-present'; }
    else if (l.requis) { icone = '✗'; classe = 'doc-manquant'; }
    else { icone = '—'; classe = 'doc-non-requis'; }
    return `<span class="doc-item ${classe}"><span class="doc-icone">${icone}</span> ${l.label}</span>`;
  }).join('')}</div>`;
}

function render() {
  document.getElementById('mois-label').textContent = libelleMois(moisAffiche);
  document.getElementById('mois-courant-badge').style.display = (moisAffiche === moisActuel()) ? 'inline' : 'none';

  const totaux = calculerTotauxGeneraux(appData);
  document.getElementById('total-du').textContent = formatMontant(totaux.du);
  document.getElementById('total-verse').textContent = formatMontant(totaux.verse);
  document.getElementById('total-attente').textContent = formatMontant(totaux.attente);

  const container = document.getElementById('immeubles-container');
  container.innerHTML = '';

  if (!appData.immeubles.length) {
    container.innerHTML = '<p class="placeholder-note">Aucune donnée pour ce mois.</p>';
    afficherCorbeille();
    return;
  }

  for (const immeuble of appData.immeubles) {
    const t = calculerTotauxImmeuble(immeuble);
    const details = document.createElement('details');
    details.className = 'immeuble-card';
    details.open = immeuble.unites.some(u => u.id === uniteEnEdition) || immeublesOuverts.has(immeuble.id);
    details.addEventListener('toggle', () => {
      if (details.open) immeublesOuverts.add(immeuble.id);
      else immeublesOuverts.delete(immeuble.id);
    });

    const summary = document.createElement('summary');
    summary.innerHTML = `
      <span class="nom">${immeuble.nom}</span>
      <span class="sous-total">
        ${formatMontant(t.du)} — ${immeuble.unites.length} unité(s)
        ${t.attente > 0 ? `<br><span class="attente-immeuble">En attente : ${formatMontant(t.attente)}</span>` : ''}
      </span>
    `;
    details.appendChild(summary);

    for (const u of immeuble.unites) {
      if (u.id === uniteEnEdition) {
        const wrap = document.createElement('div');
        wrap.innerHTML = formulaireEdition(immeuble, u);
        const formEl = wrap.firstElementChild;
        details.appendChild(formEl);

        const champDebut = formEl.querySelector(`#f-debutBail-${u.id}`);
        const champFin = formEl.querySelector(`#f-finBail-${u.id}`);
        if (champDebut && champFin) {
          champDebut.addEventListener('change', () => {
            if (champDebut.value) champFin.value = calculerFinParDefaut(champDebut.value);
          });
        }
        const champGarantieForme = formEl.querySelector(`#f-garantieForme-${u.id}`);
        const blocDocGarantie = formEl.querySelector(`#bloc-doc-garantie-${u.id}`);
        if (champGarantieForme && blocDocGarantie) {
          champGarantieForme.addEventListener('change', () => {
            blocDocGarantie.style.display = ['compte_bancaire', 'garantie_bancaire', 'cpas'].includes(champGarantieForme.value) ? 'block' : 'none';
          });
        }
        continue;
      }
      const loyerCC = calculerLoyerCC(u);
      const retard = calculerRetard(u);
      const assuranceKO = assuranceAVerifier(u);
      const attente = resteEnAttente(u);
      const conflit = conflitPoubelles(u) || conflitInternet(u);
      const row = document.createElement('div');
      row.className = 'unite-row unite-row-clickable';
      row.onclick = () => ouvrirEdition(u.id);
      row.innerHTML = `
        <div>
          <div class="designation">${u.designation}</div>
          <div class="locataire">${u.locataire || 'Logement libre'}</div>
          ${attente > 0 ? `<div class="attente-unite">En attente : ${formatMontant(attente)}</div>` : ''}
        </div>
        <div class="montant">
          ${u.aVentiler && !u.inoccupe ? '<span title="Loyer non encore ventilé">*</span> ' : ''}${formatMontant(loyerCC)}
          ${u.inoccupe ? '<span class="badge inoccupe">Inoccupé</span>' : ''}
          ${!u.inoccupe && retard === 'rouge' ? '<span class="badge retard-rouge">Retard 4j+</span>' : ''}
          ${!u.inoccupe && retard === 'orange' ? '<span class="badge retard-orange">Retard 2j+</span>' : ''}
          ${!u.inoccupe && !retard && u.locataire ? '<span class="badge ok">OK</span>' : ''}
          ${!u.inoccupe && assuranceKO ? '<span class="badge assurance">Assurance retard</span>' : ''}
          ${!u.inoccupe && conflit ? '<span class="badge conflit" title="'+conflit+'">Conflit</span>' : ''}
        </div>
      `;
      details.appendChild(row);
    }

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-add';
    addBtn.textContent = '+ Ajouter une unité';
    addBtn.onclick = (e) => { e.preventDefault(); ajouterUnite(immeuble.id); };
    details.appendChild(addBtn);

    container.appendChild(details);
  }

  afficherCorbeille();
}

function afficherCorbeille() {
  const zone = document.getElementById('corbeille-container');
  const journal = appData.journalSuppressions || [];
  const actifs = journal.map((e, i) => ({ ...e, index: i })).filter(e => !e.restaure);

  if (!actifs.length) {
    zone.innerHTML = '';
    return;
  }

  zone.innerHTML = `<details class="immeuble-card corbeille">
    <summary><span class="nom">🗑 Corbeille</span><span class="sous-total">${actifs.length} élément(s)</span></summary>
    ${actifs.map(e => `
      <div class="unite-row corbeille-row">
        <div>
          <div class="designation">${e.nom} <span class="corbeille-type">(${e.type})</span></div>
          <div class="locataire">${e.motif} — ${new Date(e.date).toLocaleDateString('fr-BE')}</div>
        </div>
        <button class="btn btn-primary" onclick="restaurer(${e.index})">Restaurer</button>
      </div>
    `).join('')}
  </details>`;
}

// ---------- Initialisation ----------

async function init() {
  if (typeof traiterRetourConnexion === 'function') {
    const vientDeSeConnecter = await traiterRetourConnexion();
    if (vientDeSeConnecter) afficherStatutSync("Connecté à OneDrive");
  }
  mettreAJourBoutonConnexion();

  document.getElementById('mois-precedent').onclick = () => allerAuMois(moisPrecedent(moisAffiche));
  document.getElementById('mois-suivant').onclick = () => allerAuMois(moisSuivant(moisAffiche));

  const derniere = localStorage.getItem(CLE_DERNIERE_SAUVEGARDE);
  if (derniere) afficherDerniereSauvegarde(derniere);

  await chargerMoisCourant(true);
  await verifierEnvoiInterrompu();

  document.getElementById('alerte-enregistrement').style.display = 'block';
  setInterval(() => {
    document.getElementById('alerte-enregistrement').style.display = 'block';
  }, 10 * 60 * 1000);
}

function mettreAJourBoutonConnexion() {
  const el = document.getElementById('connexion-onedrive');
  if (!el) return;
  if (typeof estConnecte === 'function' && estConnecte()) {
    el.textContent = "Connecté à OneDrive (déconnecter)";
    el.onclick = () => seDeconnecter();
  } else {
    el.textContent = "Se connecter à OneDrive";
    el.onclick = () => demarrerConnexion();
  }
}

init();
