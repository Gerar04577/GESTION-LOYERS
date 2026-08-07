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
  const provision = unite.provisionCharges || 0;
  return brut + charges + poubelles + internet + provision;
}

function calculerFinAssurance(unite) {
  if (!unite.debutBail) return null;
  const d = new Date(unite.debutBail);
  d.setFullYear(d.getFullYear() + 1);
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

function estEnRetard(unite) {
  if (unite.inoccupe) return false;
  if (!unite.prochainPaiement) return false;
  const echeance = new Date(unite.prochainPaiement);
  const aujourdhui = new Date();
  const joursEcart = (aujourdhui - echeance) / (1000 * 60 * 60 * 24);
  const loyerCC = calculerLoyerCC(unite);
  const insuffisant = (unite.montantsVerses || 0) < loyerCC;
  return joursEcart > JOURS_TOLERANCE_RETARD && insuffisant;
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

function sauvegarder() {
  sauvegarderLocal();
  if (typeof estConnecte === 'function' && estConnecte()) {
    sauvegarderMoisOneDrive(moisAffiche, appData).catch(err => {
      console.error("Échec sauvegarde OneDrive", err);
      afficherStatutSync("Erreur sauvegarde OneDrive : " + err.message, true);
    });
    afficherStatutSync(`Sauvegardé — ${libelleMois(moisAffiche)}`);
  }
  render();
}

function afficherStatutSync(message, erreur = false) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.textContent = message;
  el.style.color = erreur ? '#fbb' : '#c9d1cb';
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

async function reimporterVentilation() {
  if (!confirm("Réimporter la ventilation loyer/charges/poubelles/internet depuis data.json dans le mois affiché ? (les locataires, versements et autres champs déjà saisis ne sont pas touchés)")) return;
  const frais = await chargerDonneesInitiales();
  const index = {};
  for (const b of frais.immeubles) {
    for (const u of b.unites) index[u.designation] = u;
  }
  let maj = 0;
  for (const b of appData.immeubles) {
    for (const u of b.unites) {
      const source = index[u.designation];
      if (!source) continue;
      u.loyerBrut = source.loyerBrut;
      u.charges = source.charges;
      u.poubelles = source.poubelles;
      u.internet = source.internet;
      if (source.debutBail && !u.debutBail) u.debutBail = source.debutBail;
      if (source.garantieMontant !== undefined) u.garantieMontant = source.garantieMontant;
      if (source.garantieForme) u.garantieForme = source.garantieForme;
      if (source.bailEnregistre !== undefined) u.bailEnregistre = source.bailEnregistre;
      if (source.finBail) u.finBail = source.finBail;
      if (source.preuveGarantie) u.preuveGarantie = source.preuveGarantie;
      if (source.poubellesStatut) u.poubellesStatut = source.poubellesStatut;
      if (source.internetStatut) u.internetStatut = source.internetStatut;
      u.aVentiler = false;
      maj++;
    }
  }
  sauvegarder();
  alert(`${maj} unité(s) mise(s) à jour avec la ventilation.`);
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
        afficherStatutSync(`${libelleMois(moisAffiche)} — à jour depuis OneDrive`);
        return;
      }
      // Ce mois n'existe pas encore dans OneDrive
      if (estOuvertureInitiale && moisAffiche === moisActuel()) {
        await demarrerNouveauMois();
        return;
      }
      // Mois passé demandé mais inexistant : rien à afficher
      appData = { immeubles: [] };
      render();
      afficherStatutSync(`Aucune donnée pour ${libelleMois(moisAffiche)}`, true);
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
  if (estOuvertureInitiale && moisAffiche === moisActuel()) {
    await demarrerNouveauMois();
    return;
  }
  appData = { immeubles: [] };
  render();
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
    base = await chargerDonneesInitiales(); // tout premier mois : reprise des données extraites de l'ancien fichier
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

function demanderSuppressionImmeuble(immeubleId) {
  const immeuble = appData.immeubles.find(b => b.id === immeubleId);
  if (!confirm(`Supprimer tout l'immeuble "${immeuble.nom}" et ses ${immeuble.unites.length} unité(s) ?`)) return;
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
    provisionCharges: immeuble.provisionCharges ? 0 : null,
    montantsVerses: 0, prochainPaiement: null,
    commentaires: '', notesInternes: '', aVentiler: false
  };
  immeuble.unites.push(nouvelle);
  sauvegarder();
  ouvrirEdition(nouvelle.id);
}

let uniteEnEdition = null;

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
  if (found.immeuble.provisionCharges) {
    u.provisionCharges = parseFloat(get('provisionCharges')) || 0;
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
  u.docAssurance = get('docAssurance') || '';
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
      ${immeuble.provisionCharges ? champ('Provision charges (€)', 'provisionCharges', u.id, u.provisionCharges, 'number') : ''}
      ${champ('Montants versés (€)', 'montantsVerses', u.id, u.montantsVerses, 'number')}
      ${champ('Prochain paiement', 'prochainPaiement', u.id, u.prochainPaiement, 'date')}
      <div class="champ-lecture-seule">
        <span>Reste en attente</span>
        <span>${formatMontant(resteEnAttente(u))}</span>
      </div>

      <div class="section-titre">Bail</div>
      ${champ('Début du bail', 'debutBail', u.id, u.debutBail, 'date')}
      ${champ('Fin réelle du bail', 'finBail', u.id, u.finBail, 'date')}
      ${champCheckbox('Bail enregistré', 'bailEnregistre', u.id, u.bailEnregistre)}

      <div class="section-titre">Garantie locative</div>
      ${champ('Montant garantie (€)', 'garantieMontant', u.id, u.garantieMontant, 'number')}
      ${champSelect('Forme', 'garantieForme', u.id, u.garantieForme, [
        ['especes', 'Espèces'], ['compte_bancaire', 'Compte bancaire bloqué']
      ])}
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
      ${champ('Doc. assurance (référence/note)', 'docAssurance', u.id, u.docAssurance)}

      <div class="section-titre">Domiciliation</div>
      ${champ('Ordre permanent (référence/note)', 'domiciliationOrdrePermanent', u.id, u.domiciliationOrdrePermanent)}

      <div class="section-titre">Notes</div>
      ${champ('Commentaires', 'commentaires', u.id, u.commentaires)}
      ${champ('Notes internes', 'notesInternes', u.id, u.notesInternes)}
      <div class="edit-actions">
        <button class="btn btn-primary" onclick="enregistrerEdition('${u.id}')">Enregistrer</button>
        <button class="btn" onclick="fermerEdition()">Annuler</button>
        <button class="btn btn-danger" onclick="demanderSuppressionUnite('${u.id}')">Supprimer l'unité</button>
      </div>
    </div>`;
}

// ---------- Rendu ----------

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
    details.open = immeuble.unites.some(u => u.id === uniteEnEdition);

    const summary = document.createElement('summary');
    summary.innerHTML = `
      <span class="nom">${immeuble.nom}</span>
      <span class="sous-total">${formatMontant(t.du)} — ${immeuble.unites.length} unité(s)</span>
    `;
    details.appendChild(summary);

    const btnSupprimerImmeuble = document.createElement('button');
    btnSupprimerImmeuble.className = 'btn btn-danger btn-supprimer-immeuble';
    btnSupprimerImmeuble.textContent = "Supprimer l'immeuble";
    btnSupprimerImmeuble.onclick = (e) => { e.preventDefault(); demanderSuppressionImmeuble(immeuble.id); };
    details.appendChild(btnSupprimerImmeuble);

    for (const u of immeuble.unites) {
      if (u.id === uniteEnEdition) {
        const wrap = document.createElement('div');
        wrap.innerHTML = formulaireEdition(immeuble, u);
        details.appendChild(wrap.firstElementChild);
        continue;
      }
      const loyerCC = calculerLoyerCC(u);
      const retard = estEnRetard(u);
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
          ${!u.inoccupe && retard ? '<span class="badge retard">Retard</span>' : ''}
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

  await chargerMoisCourant(true);
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
