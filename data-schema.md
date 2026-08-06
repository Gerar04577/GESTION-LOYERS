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
`loyerCC` n'est jamais stocké : il est **calculé** = loyerBrut + charges + poubelles + internet (+ provisionCharges si applicable).

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
