// Gestion Loyers — module LISTE REMBOURSEMENT, entièrement séparé
// Isolé volontairement : ne touche à AUCUNE fonction ni variable de app.js,
// seulement les fonctions déjà globales qu'il réutilise en lecture (appData,
// calculerLoyerCC, indexMoisConnus, chargerMoisOneDrive, etc.) et les fonctions
// déjà globales de graph-storage.js pour écrire sur OneDrive.
//
// BUT : construire, pour chaque locataire, 3 informations dont a besoin
// l'application séparée "REMBOURSEMENT" (dans Charges et Compteurs) :
// 1) sa garantie locative, 2) son retard de loyer cumulé, 3) son retard
// d'assurance — et les rendre consultables ICI, ET écrites dans un fichier
// JSON partagé sur OneDrive que l'autre app peut lire de son côté.

const NOM_FICHIER_REMBOURSEMENT = 'remboursements.json';
let donneesRemboursementCalculees = null;

// SÉCURITÉ (19/08) : "AGestion Charges/Calcul charges et compteurs" est un dossier
// PARTAGÉ, en dehors de "Immobilier 2025-2026" — il doit donc être résolu depuis
// la vraie racine "Mes fichiers" (enfantsDeRef(null)), pas depuis resoudreRefParChemin()
// qui part toujours de "Immobilier 2025-2026". Même principe déjà validé pour
// Véronique/Julien (navigation par identifiant, gère aussi bien un vrai dossier
// qu'un raccourci) — juste appliqué à partir d'un point de départ différent.
const CHEMIN_DOSSIER_CHARGES_COMPTEURS = "AGestion Charges/Calcul charges et compteurs";

async function resoudreRefDepuisRacineReelle(cheminRelatif) {
  let ref = null; // null = vraie racine "Mes fichiers"
  const segments = cheminRelatif.split('/').filter(Boolean);
  for (const segment of segments) {
    const enfants = await enfantsDeRef(ref);
    const trouve = enfants.find(e => (e.name || '').trim() === segment);
    if (!trouve) {
      throw new Error(`Dossier "${segment}" introuvable dans "${cheminRelatif}" — vérifier qu'il est bien accessible (dossier réel ou raccourci) sur ce compte.`);
    }
    ref = refDe(trouve, ref ? ref.driveId : null);
  }
  return ref;
}

async function ouvrirVueRemboursement() {
  document.getElementById('immeubles-container').style.display = 'none';
  document.getElementById('vue-remboursement').style.display = 'block';
  const container = document.getElementById('vue-remboursement-container');
  container.innerHTML = '<p class="placeholder-note">Calcul en cours…</p>';

  // sécurité : ne jamais rester bloqué indéfiniment sur "Calcul en cours" si
  // OneDrive répond très lentement ou pas du tout
  const delaiSecurite = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Le calcul prend trop de temps (plus de 20s) — vérifie ta connexion OneDrive et réessaie.")), 20000)
  );

  try {
    donneesRemboursementCalculees = await Promise.race([calculerListeRemboursement(), delaiSecurite]);
    afficherListeRemboursement();
  } catch (e) {
    container.innerHTML = `<p class="statut-documents-erreur">${e.message}</p><button class="btn-connexion" onclick="ouvrirVueRemboursement()">Réessayer</button>`;
  }
}

// Réutilise le même principe déjà en place pour "Dettes locataires" :
// le loyer se cumule sur tous les mois strictement PASSÉS (jamais le mois
// affiché, qui n'est pas encore terminé) ; l'assurance reste un montant
// unique, jamais démultiplié ; la garantie est une donnée du mois affiché
// (elle ne "s'accumule" pas, c'est un montant fixe déjà versé une fois).
async function calculerListeRemboursement() {
  // SÉCURITÉ (18/08) : un calcul basé sur des données locales potentiellement
  // obsolètes serait trompeur pour une app externe qui lit ce fichier —
  // on bloque plutôt que de risquer de publier des montants faux
  if (typeof estConnecte !== 'function' || !estConnecte()) {
    throw new Error("Connexion OneDrive requise pour calculer les remboursements de façon fiable");
  }

  let tousMois = [...indexMoisConnus].sort();
  const moisPasses = tousMois.filter(m => m < moisAffiche);

  const parLocataire = {};

  // Résout le dossier "historique" UNE SEULE FOIS avant la boucle — auparavant,
  // chargerMoisOneDrive() le retrouvait à chaque mois, multipliant inutilement
  // les allers-retours réseau (source probable d'un calcul très long, voire bloqué,
  // avec plusieurs mois d'historique).
  let refDossierHistorique = null;
  try {
    refDossierHistorique = await resoudreRefParChemin('GESTION-LOYERS/historique', false);
  } catch (e) {
    refDossierHistorique = null;
  }

  async function chargerMoisRapide(mois) {
    if (!refDossierHistorique) return null;
    try {
      const res = await lireFichierDansDossier(refDossierHistorique, `${mois}.json`);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  function assurerEntree(b, u) {
    const cle = `${b.id}__${(u.designation || '').toUpperCase().trim()}`;
    if (!parLocataire[cle]) {
      parLocataire[cle] = {
        immeuble: b.nom, immeubleId: b.id, unite: u.designation, locataire: u.locataire,
        inoccupe: false,
        garantieMontant: 0, garantieEncaissee: 0, garantieResteDu: 0, garantieForme: null,
        assuranceMontant: 0, assuranceEncaissee: 0,
        retardLoyer: 0, retardAssurance: 0
      };
    }
    return parLocataire[cle];
  }

  // 1) loyer en retard, cumulé sur les mois passés — tous les mois chargés
  // EN PARALLÈLE (Promise.all), pas un par un en attendant chacun avant le suivant
  const donneesParMois = await Promise.all(moisPasses.map(mois => chargerMoisRapide(mois)));
  for (const donnees of donneesParMois) {
    if (!donnees || !donnees.immeubles) continue;
    for (const b of donnees.immeubles) {
      for (const u of b.unites) {
        if (!u.locataire || u.inoccupe) continue;
        const loyerDu = calculerLoyerCC(u) - (u.montantsVerses || 0);
        if (loyerDu > 0) assurerEntree(b, u).retardLoyer += loyerDu;
      }
    }
  }

  // SPEC (20/08, Gérard) : la liste doit TOUJOURS contenir les 50 logements,
  // occupés ou non. Un logement inoccupé s'affiche avec "inoccupé" et 0 dette/
  // garantie, quel que soit son historique passé (ancien locataire, etc.)
  for (const b of appData.immeubles) {
    for (const u of b.unites) {
      const cleUnite = `${b.id}__${(u.designation || '').toUpperCase().trim()}`;
      if (!u.locataire || u.inoccupe) {
        // écrase toute trace éventuelle d'un ancien locataire dans l'historique —
        // un logement inoccupé aujourd'hui n'a plus aucune dette à afficher
        parLocataire[cleUnite] = {
          immeuble: b.nom, immeubleId: b.id, unite: u.designation, locataire: null,
          inoccupe: true,
          garantieMontant: 0, garantieEncaissee: 0, garantieResteDu: 0, garantieForme: null,
          assuranceMontant: 0, assuranceEncaissee: 0,
          retardLoyer: 0, retardAssurance: 0
        };
        continue;
      }
      const entree = assurerEntree(b, u);
      entree.locataire = u.locataire;
      // v85 — on exporte les DEUX notions, sans jamais les confondre :
      //   garantieMontant   : ce qui est contractuellement dû
      //   garantieEncaissee : ce qui a réellement été reçu -> base du REMBOURSEMENT
      //                       au départ du locataire (lu par Charges & Compteurs)
      //   garantieResteDu   : ce qui manque encore -> entre dans la DETTE
      // retardAssurance conserve son nom (Charges & Compteurs le lit déjà) mais
      // vaut désormais le restant dû, et non plus la prime entière.
      entree.garantieMontant = u.garantieMontant || 0;
      entree.garantieEncaissee = u.garantieEncaissee || 0;
      entree.garantieResteDu = garantieResteDu(u);
      entree.garantieForme = u.garantieForme || null;
      if (b.id !== 'vannes') {
        entree.assuranceMontant = u.montantAssurance || 0;
        entree.assuranceEncaissee = u.assuranceEncaissee || 0;
        entree.retardAssurance = assuranceResteDu(u);
      }
    }
  }

  return Object.values(parLocataire);
}

function afficherListeRemboursement() {
  const container = document.getElementById('vue-remboursement-container');
  const lignes = donneesRemboursementCalculees || [];

  if (!lignes.length) {
    container.innerHTML = '<p class="placeholder-note">Aucune donnée de garantie, retard de loyer ou d\'assurance à afficher pour l\'instant.</p>';
    return;
  }

  container.innerHTML = `
    <button class="btn-connexion" style="background:#2e7d4f;color:white;margin-bottom:1rem;" onclick="exporterRemboursementOneDrive()">📤 Enregistrer sur OneDrive (pour Charges et Compteurs)</button>
    <div id="statut-export-remboursement"></div>
    <table class="table-comparaison table-dettes">
      <thead><tr>
        <th>Immeuble</th><th>Unité</th><th>Locataire</th>
        <th class="num">Reste garantie</th><th class="num">Reste assurance</th>
        <th class="num">Retard loyer CC</th><th class="num">Total dû</th>
      </tr></thead>
      <tbody>
        ${lignes.map(l => {
          if (l.inoccupe) {
            return `<tr class="ligne-inoccupee">
              <td>${l.immeuble}</td><td>${l.unite}</td><td><em>inoccupé</em></td>
              <td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td>
            </tr>`;
          }
          const resteGar = l.garantieResteDu || 0;
          const resteAss = l.retardAssurance || 0;
          const retardL = l.retardLoyer || 0;
          const total = resteGar + resteAss + retardL;
          const eur = v => v > 0 ? v.toFixed(2) + ' €' : '—';
          return `<tr class="${total <= 0 ? 'ligne-soldee' : ''}">
            <td>${l.immeuble}</td><td>${l.unite}</td><td>${l.locataire}</td>
            <td class="num">${eur(resteGar)}</td>
            <td class="num">${eur(resteAss)}</td>
            <td class="num">${eur(retardL)}</td>
            <td class="num cellule-total">${total.toFixed(2)} €</td>
          </tr>`;
        }).join('')}
      </tbody>
      <tfoot>
        ${(() => {
          const actives = lignes.filter(l => !l.inoccupe);
          const somme = cle => actives.reduce((t, l) => t + (l[cle] || 0), 0);
          const tGar = somme('garantieResteDu');
          const tAss = somme('retardAssurance');
          const tLoy = somme('retardLoyer');
          return `<tr>
            <td colspan="3">Total général — ${lignes.length} logement${lignes.length > 1 ? 's' : ''}</td>
            <td class="num">${tGar.toFixed(2)} €</td>
            <td class="num">${tAss.toFixed(2)} €</td>
            <td class="num">${tLoy.toFixed(2)} €</td>
            <td class="num cellule-total">${(tGar + tAss + tLoy).toFixed(2)} €</td>
          </tr>`;
        })()}
      </tfoot>
    </table>
  `;
}

async function exporterRemboursementOneDrive() {
  const statut = document.getElementById('statut-export-remboursement');
  statut.innerHTML = '<p class="placeholder-note">Écriture sur OneDrive…</p>';
  try {
    const refDossier = await resoudreRefDepuisRacineReelle(CHEMIN_DOSSIER_CHARGES_COMPTEURS);
    const contenu = JSON.stringify({
      genereLe: new Date().toISOString(),
      mois: moisAffiche,
      locataires: donneesRemboursementCalculees
    }, null, 2);
    await ecrireFichierDansDossier(refDossier, NOM_FICHIER_REMBOURSEMENT, contenu);
    statut.innerHTML = `<p style="color:#2e7d4f;font-weight:700;">✓ Enregistré sur OneDrive (${CHEMIN_DOSSIER_CHARGES_COMPTEURS}/${NOM_FICHIER_REMBOURSEMENT}) — Charges et Compteurs peut maintenant le lire.</p>`;
  } catch (e) {
    statut.innerHTML = `<p class="statut-documents-erreur">Échec de l'écriture : ${e.message}</p>`;
  }
}
