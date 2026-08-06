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

function estEnRetard(unite) {
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

function supprimerUnite(uniteId) {
  if (!confirm('Supprimer cette unité locative ?')) return;
  for (const immeuble of appData.immeubles) {
    const idx = immeuble.unites.findIndex(x => x.id === uniteId);
    if (idx !== -1) { immeuble.unites.splice(idx, 1); break; }
  }
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
  u.loyerBrut = parseFloat(get('loyerBrut')) || 0;
  u.charges = parseFloat(get('charges')) || 0;
  u.poubelles = parseFloat(get('poubelles')) || 0;
  u.internet = parseFloat(get('internet')) || 0;
  if (found.immeuble.provisionCharges) {
    u.provisionCharges = parseFloat(get('provisionCharges')) || 0;
  }
  u.montantsVerses = parseFloat(get('montantsVerses')) || 0;
  u.prochainPaiement = get('prochainPaiement') || null;
  u.typeUnite = get('typeUnite') || null;
  u.debutBail = get('debutBail') || null;
  u.assuranceDue = document.getElementById(`f-assuranceDue-${uniteId}`).checked;
  u.assuranceStatut = get('assuranceStatut') || null;
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
      ${champ('Loyer brut (€)', 'loyerBrut', u.id, u.loyerBrut, 'number')}
      ${champ('Charges (€)', 'charges', u.id, u.charges, 'number')}
      ${champ('Poubelles (€)', 'poubelles', u.id, u.poubelles, 'number')}
      ${champ('Internet (€)', 'internet', u.id, u.internet, 'number')}
      ${immeuble.provisionCharges ? champ('Provision charges (€)', 'provisionCharges', u.id, u.provisionCharges, 'number') : ''}
      ${champ('Montants versés (€)', 'montantsVerses', u.id, u.montantsVerses, 'number')}
      ${champ('Prochain paiement', 'prochainPaiement', u.id, u.prochainPaiement, 'date')}
      <div class="section-titre">Assurance</div>
      ${champSelect("Type d'unité", 'typeUnite', u.id, u.typeUnite, [
        ['studio', 'Studio'], ['appartement', 'Appartement'], ['duplex', 'Duplex'],
        ['garage', 'Garage'], ['rdc_commercial', 'RDC commercial'], ['autre', 'Autre']
      ])}
      ${champ('Début du bail', 'debutBail', u.id, u.debutBail, 'date')}
      <div class="champ champ-lecture-seule">
        <span>Fin d'assurance (calculée)</span>
        <span>${finAssurance ? finAssurance : '— (renseigner le début du bail)'}</span>
      </div>
      ${champCheckbox('Assurance due par le locataire', 'assuranceDue', u.id, assuranceDueVal)}
      ${champSelect('Statut assurance', 'assuranceStatut', u.id, u.assuranceStatut, [
        ['en_ordre', 'En ordre'], ['a_verifier', 'À vérifier']
      ])}
      <div class="section-titre">Notes</div>
      ${champ('Commentaires', 'commentaires', u.id, u.commentaires)}
      ${champ('Notes internes', 'notesInternes', u.id, u.notesInternes)}
      <div class="edit-actions">
        <button class="btn btn-primary" onclick="enregistrerEdition('${u.id}')">Enregistrer</button>
        <button class="btn" onclick="fermerEdition()">Annuler</button>
        <button class="btn btn-danger" onclick="supprimerUnite('${u.id}')">Supprimer l'unité</button>
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
      const row = document.createElement('div');
      row.className = 'unite-row unite-row-clickable';
      row.onclick = () => ouvrirEdition(u.id);
      row.innerHTML = `
        <div>
          <div class="designation">${u.designation}</div>
          <div class="locataire">${u.locataire || 'Logement libre'}</div>
        </div>
        <div class="montant">
          ${u.aVentiler ? '<span title="Loyer non encore ventilé">*</span> ' : ''}${formatMontant(loyerCC)}
          ${retard ? '<span class="badge retard">Retard</span>' : (u.locataire ? '<span class="badge ok">OK</span>' : '')}
          ${assuranceKO ? '<span class="badge assurance">Assurance</span>' : ''}
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
