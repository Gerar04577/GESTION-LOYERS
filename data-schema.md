# Modèle de données — Gestion Loyers

## Immeuble
```json
{
  "id": "nimy",
  "nom": "NIMY",
  "provisionCharges": true
}
```
`provisionCharges: true` uniquement pour Nimy, Biche, PTG.

## Unité locative
```json
{
  "id": "nimy-studio-3",
  "immeubleId": "nimy",
  "designation": "STUDIO 3 NIMY",
  "adresse": "...",
  "type": "studio",
  "exemptAssurance": false
}
```
`type` peut valoir : studio, appartement, garage, rdc_commercial, duplex...
`exemptAssurance` = true automatiquement si type = garage ou rdc_commercial (mais reste modifiable au cas par cas).
`designation` = la clé utilisée pour la correspondance avec VéroS/OneDrive (ex. "STUDIO 3 NIMY").

## Locataire (peut être vide si logement libre)
```json
{
  "id": "loc-0123",
  "uniteId": "nimy-studio-3",
  "nom": "Cyril MESSE",
  "actif": true
}
```

## Loyer (données financières par unité/locataire)
```json
{
  "uniteId": "nimy-studio-3",
  "loyerBrut": 500,
  "charges": 100,
  "provisionCharges": 50,
  "poubelles": 10,
  "internet": 15,
  "montantsVerses": 500,
  "prochainPaiement": "2026-09-01",
  "commentaires": "",
  "notesInternes": ""
}
```
`loyerCC` n'est jamais stocké : il est **calculé** = loyerBrut + charges + poubelles + internet.

**Quatre termes, pas cinq.** Cette ligne annonçait autrefois « (+ provisionCharges si applicable) » — une intention qui n'a jamais été codée. `calculerLoyerCC()` dans app.js n'additionne que les quatre champs ci-dessus.

**Le champ `provisionCharges` d'une unité est un résidu** : il n'est ni lu ni écrit par app.js, et vaut zéro sur les cinquante unités. Ne pas s'en servir — le poste des charges se porte dans `charges`.

Cette ligne a induit en erreur le module de rentrée en septembre 2026 : un montant y écrivait dans `provisionCharges`, et le loyer toutes charges comprises s'en trouvait faux sur chaque unité versée. Corrigé le 05/09/2026.

Le drapeau `provisionCharges: true` au niveau de l'**immeuble** est autre chose : il commande l'affichage d'une ligne indicative sous le formulaire.

## Assurance
```json
{
  "uniteId": "nimy-studio-3",
  "debutBail": "2025-09-01",
  "finAssurance": "2026-08-31",
  "payeeParLocataire": true,
  "statut": "en_ordre"
}
```
`finAssurance` = debutBail + 12 mois, calculé automatiquement (jamais saisi à la main).
`payeeParLocataire` = false automatiquement si l'unité est garage ou rdc_commercial.
Plus de "Mois à payer / Mois restants dûs / Montants à payer par mois" — supprimés comme demandé.

## Statut documents (lu depuis le scan OneDrive, pas stocké durablement)
```json
{
  "uniteId": "nimy-studio-3",
  "bail": true,
  "edle": true,
  "edls": false,
  "samadhi": null,
  "derniereVerif": "2026-08-06T10:00:00"
}
```
`null` = non applicable (ex. Samadhi pas prêté à ce locataire).

## Alertes calculées (jamais stockées, recalculées à l'affichage)
- Loyer en retard : `prochainPaiement` dépassé de plus de 4 jours et `montantsVerses` insuffisant
- Assurance à vérifier : `finAssurance` dépassée et statut ≠ en_ordre
