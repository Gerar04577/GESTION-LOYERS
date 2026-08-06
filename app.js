// Gestion Loyers — logique applicative
// Étape 4 : édition des champs, ajout/suppression d'unités et de locataires
// Sauvegarde locale temporaire (localStorage) — remplacée par OneDrive à l'étape 5

const JOURS_TOLERANCE_RETARD = 4; // reprend la règle de l'ancien fichier VBA (WARNING_Date)
const STORAGE_KEY = 'gestionLoyersData';

let appData = null;

function calculerLoyerCC(unite) {
  const brut = unite.loyerBrut || 0;
  const charges = unite.charges || 0;
  const poubelles = unite.poubelles || 0;
  const internet = unite.internet || 0;
  const provision = unite.provisionCharges || 0;
  return brut + charges + poubelles + internet + provision;
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

function sauvegarder() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
  if (typeof estConnecte === 'function' && estConnecte()) {
    sauvegarderDonneesOneDrive(appData).catch(err => {
      console.error("Échec sauvegarde OneDrive, gardé en local seulement", err);
      afficherStatutSync("Erreur sauvegarde OneDrive : " + err.message, true);
    });
    afficherStatutSync("Sauvegardé dans OneDrive");
  }
  render();
}

function afficherStatutSync(message, erreur = false) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.textContent = message;
  el.style.color = erreur ? '#fbb' : '#c9d1cb';
}

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
  const n = immeuble.unites.length + 1;
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

function formulaireEdition(immeuble, u) {
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
      ${champ('Commentaires', 'commentaires', u.id, u.commentaires)}
      ${champ('Notes internes', 'notesInternes', u.id, u.notesInternes)}
      <div class="edit-actions">
        <button class="btn btn-primary" onclick="enregistrerEdition('${u.id}')">Enregistrer</button>
        <button class="btn" onclick="fermerEdition()">Annuler</button>
        <button class="btn btn-danger" onclick="supprimerUnite('${u.id}')">Supprimer l'unité</button>
      </div>
    </div>`;
}

function render() {
  const totaux = calculerTotauxGeneraux(appData);
  document.getElementById('total-du').textContent = formatMontant(totaux.du);
  document.getElementById('total-verse').textContent = formatMontant(totaux.verse);
  document.getElementById('total-attente').textContent = formatMontant(totaux.attente);

  const container = document.getElementById('immeubles-container');
  container.innerHTML = '';

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

async function init() {
  // Retour d'une connexion Microsoft (redirection avec ?code=...) ?
  if (typeof traiterRetourConnexion === 'function') {
    const vientDeSeConnecter = await traiterRetourConnexion();
    if (vientDeSeConnecter) afficherStatutSync("Connecté à OneDrive");
  }

  mettreAJourBoutonConnexion();

  if (typeof estConnecte === 'function' && estConnecte()) {
    try {
      const distant = await chargerDonneesOneDrive();
      if (distant) {
        appData = distant;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
        render();
        afficherStatutSync("Données à jour depuis OneDrive");
        return;
      }
      // Rien encore dans OneDrive : on part des données locales/initiales et on les y dépose
      await chargerDonneesLocalesPuisInitiales();
      await sauvegarderDonneesOneDrive(appData);
      afficherStatutSync("Première sauvegarde envoyée vers OneDrive");
      return;
    } catch (e) {
      console.error("Erreur OneDrive, bascule sur les données locales", e);
      afficherStatutSync("Erreur OneDrive : " + e.message, true);
    }
  }

  await chargerDonneesLocalesPuisInitiales();
}

async function chargerDonneesLocalesPuisInitiales() {
  const local = localStorage.getItem(STORAGE_KEY);
  if (local) {
    appData = JSON.parse(local);
    render();
    return;
  }
  try {
    const res = await fetch('data.json');
    appData = await res.json();
    render();
  } catch (e) {
    console.error('Erreur de chargement des données', e);
    document.getElementById('immeubles-container').innerHTML =
      '<p class="placeholder-note">Erreur de chargement de data.json</p>';
  }
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
