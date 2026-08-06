// Gestion Loyers — authentification Microsoft Graph (OAuth2 + PKCE)
// Même approche que VéroS : aucune librairie, aucun CDN.
//
// Permissions demandées :
//  - Files.Read                : lire les documents des locataires dans OneDrive (scan bail/EDLE/EDLS/Samadhi)
//  - Files.ReadWrite.AppFolder : lire/écrire UNIQUEMENT le fichier de données de Gestion Loyers,
//                                dans un dossier réservé à l'app (jamais les documents des locataires)

const MSAL_CLIENT_ID = "42a7292b-76c0-404c-bb3a-fb4cb35d4694"; // inscription Entra "Gestion Loyers"
const MSAL_REDIRECT_URI = window.location.origin + window.location.pathname.replace(/index\.html$/, "");
const MSAL_SCOPES = "Files.Read Files.ReadWrite.AppFolder offline_access";
const MSAL_AUTHORITY = "https://login.microsoftonline.com/consumers"; // comptes Microsoft personnels uniquement

const TOKEN_STORAGE_KEY = "gestionLoyersMsalToken";
const VERIFIER_STORAGE_KEY = "gestionLoyersPkceVerifier";

// --- PKCE : génération du vérifieur et du challenge ---

function genererChaineAleatoire(longueur) {
  const tableau = new Uint8Array(longueur);
  crypto.getRandomValues(tableau);
  return Array.from(tableau, b => ('0' + b.toString(16)).slice(-2)).join('');
}

async function genererCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(digest);
}

function base64UrlEncode(arrayBuffer) {
  let binaire = '';
  const octets = new Uint8Array(arrayBuffer);
  for (let i = 0; i < octets.byteLength; i++) binaire += String.fromCharCode(octets[i]);
  return btoa(binaire).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// --- Connexion ---

async function demarrerConnexion() {
  const verifier = genererChaineAleatoire(64);
  sessionStorage.setItem(VERIFIER_STORAGE_KEY, verifier);
  const challenge = await genererCodeChallenge(verifier);

  const params = new URLSearchParams({
    client_id: MSAL_CLIENT_ID,
    response_type: "code",
    redirect_uri: MSAL_REDIRECT_URI,
    response_mode: "query",
    scope: MSAL_SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256"
  });

  window.location.href = `${MSAL_AUTHORITY}/oauth2/v2.0/authorize?${params.toString()}`;
}

async function traiterRetourConnexion() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  if (!code) return false;

  const verifier = sessionStorage.getItem(VERIFIER_STORAGE_KEY);
  if (!verifier) return false;

  const body = new URLSearchParams({
    client_id: MSAL_CLIENT_ID,
    grant_type: "authorization_code",
    code: code,
    redirect_uri: MSAL_REDIRECT_URI,
    code_verifier: verifier
  });

  const res = await fetch(`${MSAL_AUTHORITY}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  if (!res.ok) {
    console.error("Échec de l'échange du code contre un jeton", await res.text());
    return false;
  }

  const jeton = await res.json();
  jeton.obtenu_le = Date.now();
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(jeton));

  // Nettoyer l'URL (retirer ?code=...)
  window.history.replaceState({}, document.title, MSAL_REDIRECT_URI);
  return true;
}

async function rafraichirJeton(refreshToken) {
  const body = new URLSearchParams({
    client_id: MSAL_CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: MSAL_SCOPES
  });
  const res = await fetch(`${MSAL_AUTHORITY}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  if (!res.ok) return null;
  const jeton = await res.json();
  jeton.obtenu_le = Date.now();
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(jeton));
  return jeton;
}

async function obtenirJetonValide() {
  const brut = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (!brut) return null;
  let jeton = JSON.parse(brut);

  const ageSecondes = (Date.now() - jeton.obtenu_le) / 1000;
  const encoreValide = ageSecondes < (jeton.expires_in - 60); // marge de 60s

  if (encoreValide) return jeton.access_token;

  if (jeton.refresh_token) {
    const nouveau = await rafraichirJeton(jeton.refresh_token);
    if (nouveau) return nouveau.access_token;
  }

  localStorage.removeItem(TOKEN_STORAGE_KEY);
  return null;
}

function estConnecte() {
  return !!localStorage.getItem(TOKEN_STORAGE_KEY);
}

function seDeconnecter() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  location.reload();
}
