// Base de données en ligne (Firebase) pour l'application installée.
// - Connexion avec un compte Google
// - Accès réservé aux frères ajoutés par le responsable (collection « membres »)
// - Données partagées en direct, et utilisables sans connexion (copie locale)
// L'application appelle « window.firebaseReady » : on lui donne un objet qui imite
// l'interface { doc(), collection() } qu'elle utilise déjà.

const VERSION = '10.12.2';
const resolveReady = window.__resolveFirebase || (() => {});
const cfg = window.FIREBASE_CONFIG;
const OWNER = String(window.FIREBASE_OWNER || '').toLowerCase();
const ROLES = { admin: 'Responsable (tout, y compris les accès)', editeur: 'Peut modifier le programme', lecteur: 'Consultation seule' };

let F = null;          // fonctions Firebase chargées
let auth = null, fs = null, me = null;

if (!cfg || !cfg.apiKey) resolveReady(null); // pas encore configuré : l'application garde ses données sur le téléphone
else start().catch(e => { console.error(e); showGate('error', 'Impossible de charger la base de données. Vérifiez la connexion internet puis rouvrez l’application.'); });

async function start(){
  const base = `https://www.gstatic.com/firebasejs/${VERSION}/`;
  const [appM, authM, fsM] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
  F = { ...appM, ...authM, ...fsM };
  const app = F.initializeApp(cfg);
  auth = F.getAuth(app);
  fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  F.getRedirectResult(auth).catch(e => showGate('error', messageErreur(e)));

  let ready = false;
  F.onAuthStateChanged(auth, async u => {
    if (!u) { if (ready) location.reload(); else showGate('login'); return; }
    const email = (u.email || '').toLowerCase();
    const role = await roleDe(email);
    if (!role) { showGate('denied', email); return; }
    me = { email, role, name: u.displayName || email };
    hideGate();
    window.onSettingsOpen = renderAccess;
    if (!ready) { ready = true; resolveReady(adapter(role)); }
  });
}

async function roleDe(email){
  const cle = 'vcm-role-' + email;
  if (email === OWNER) return 'admin';
  try {
    const s = await F.getDoc(F.doc(fs, 'membres', email));
    const r = s.exists() ? s.data().role : null;
    try { r ? localStorage.setItem(cle, r) : localStorage.removeItem(cle); } catch {}
    return ROLES[r] ? r : null;
  } catch (e) {
    // Hors ligne : on reprend le dernier rôle connu sur ce téléphone
    try { return localStorage.getItem(cle); } catch { return null; }
  }
}

/* Interface attendue par l'application */
function adapter(role){
  const erreurEcriture = e => {
    const code = e && e.code === 'permission-denied' ? 'invalid_argument' : 'unavailable';
    if (typeof window.writeError === 'function') window.writeError({ code });
  };
  const meta = s => ({ fromCache: s.metadata.fromCache, hasPendingWrites: s.metadata.hasPendingWrites });
  const erreurLecture = err => e => err && err({ code: e && e.code === 'permission-denied' ? 'revoked' : 'unavailable', message: String(e && e.message) });
  return {
    canWrite: role !== 'lecteur',
    doc(p){
      const r = F.doc(fs, p);
      return {
        // L'écriture est d'abord enregistrée sur le téléphone, puis envoyée dès que possible
        set: d => { F.setDoc(r, d).catch(erreurEcriture); return Promise.resolve(); },
        delete: () => { F.deleteDoc(r).catch(erreurEcriture); return Promise.resolve(); },
        get: async () => { const s = await F.getDoc(r); return { id: s.id, exists: s.exists(), data: () => s.data(), metadata: meta(s) }; },
        onSnapshot: (next, err) => F.onSnapshot(r, { includeMetadataChanges: true },
          s => next({ id: s.id, exists: s.exists(), data: () => s.data(), metadata: meta(s) }), erreurLecture(err))
      };
    },
    collection(p){
      return {
        onSnapshot: (next, err) => F.onSnapshot(F.collection(fs, p), { includeMetadataChanges: true },
          s => next({ docs: s.docs.map(d => ({ id: d.id, exists: true, data: () => d.data() })), size: s.size, empty: s.empty, metadata: meta(s) }), erreurLecture(err))
      };
    }
  };
}

/* Écran de connexion / accès refusé */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LOGO = document.querySelector('.logo') ? document.querySelector('.logo').innerHTML : '';
const style = document.createElement('style');
style.textContent = `
#gate{position:fixed;inset:0;z-index:80;background:var(--paper);display:grid;place-items:center;
  padding:calc(24px + env(safe-area-inset-top,0px)) max(20px,env(safe-area-inset-right,0px)) calc(24px + env(safe-area-inset-bottom,0px)) max(20px,env(safe-area-inset-left,0px))}
#gate .box{width:min(420px,100%);display:flex;flex-direction:column;align-items:center;text-align:center;gap:14px}
#gate .glogo svg{width:96px;height:96px;display:block;filter:drop-shadow(0 10px 24px rgba(20,40,36,.22))}
#gate h1{font-family:var(--f-display);font-size:26px;margin:6px 0 0}
#gate p{margin:0;color:var(--muted);max-width:36ch}
#gate .gbtn{display:inline-flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:14px 18px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--ink);font:inherit;font-weight:700;font-size:16px;cursor:pointer;box-shadow:0 2px 8px rgba(20,40,36,.08)}
#gate .gbtn svg{width:20px;height:20px}
#gate .gbtn.alt{background:transparent;box-shadow:none;border-color:transparent;color:var(--muted);font-size:14px;padding:8px}
#gate .gerr{color:var(--bad);font-size:14px}
#gate .gmail{font-weight:700;color:var(--ink)}
.acc-list{list-style:none;margin:6px 0 10px;padding:0;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.acc-list li{display:flex;gap:8px;align-items:center;padding:8px 10px;border-top:1px solid var(--line);flex-wrap:wrap}
.acc-list li:first-child{border-top:0}
.acc-list .m{flex:1;min-width:160px;overflow:hidden;text-overflow:ellipsis;font-size:14px}
.acc-list select{width:auto;max-width:100%}
.acc-add{display:grid;grid-template-columns:1fr auto auto;gap:8px}
@media (max-width:520px){.acc-add{grid-template-columns:1fr}}`;
document.head.appendChild(style);

const G = '<svg viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>';

function showGate(kind, info){
  let g = document.getElementById('gate');
  if (!g) { g = document.createElement('div'); g.id = 'gate'; document.body.appendChild(g); }
  const tete = `<div class="glogo">${LOGO}</div><h1>Programme des réunions</h1>`;
  if (kind === 'login') g.innerHTML = `<div class="box">${tete}
    <p>Connectez-vous avec votre compte Google pour retrouver le programme de l’assemblée.</p>
    <button class="gbtn" id="g-login">${G}Se connecter avec Google</button>
    <p style="font-size:13px">Seuls les frères ajoutés par le responsable de l’assemblée ont accès.</p><p class="gerr" id="g-err"></p></div>`;
  else if (kind === 'denied') g.innerHTML = `<div class="box">${tete}
    <p>Le compte <span class="gmail">${esc(info)}</span> n’a pas encore accès au programme.</p>
    <p>Demandez au responsable de l’assemblée de vous ajouter dans <b>Paramètres → Accès des frères</b>, puis touchez « Réessayer ».</p>
    <button class="gbtn" id="g-retry">Réessayer</button><button class="gbtn alt" id="g-out">Utiliser un autre compte</button></div>`;
  else g.innerHTML = `<div class="box">${tete}<p class="gerr">${esc(info)}</p><button class="gbtn" id="g-retry">Réessayer</button></div>`;
  const b = id => document.getElementById(id);
  if (b('g-login')) b('g-login').onclick = connexion;
  if (b('g-retry')) b('g-retry').onclick = () => location.reload();
  if (b('g-out')) b('g-out').onclick = () => F.signOut(auth).then(() => location.reload());
}
function hideGate(){ const g = document.getElementById('gate'); if (g) g.remove(); }

function messageErreur(e){
  const c = e && e.code || '';
  if (c === 'auth/unauthorized-domain') return 'Ce site n’est pas encore autorisé dans Firebase (Authentication → Paramètres → Domaines autorisés).';
  if (c === 'auth/network-request-failed') return 'Pas de connexion internet. La première connexion demande internet.';
  if (c === 'auth/operation-not-allowed') return 'La connexion Google n’est pas activée dans Firebase (Authentication → Méthode de connexion).';
  return 'La connexion n’a pas abouti. Réessayez.';
}
async function connexion(){
  const p = new F.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
  const err = document.getElementById('g-err'); if (err) err.textContent = '';
  try { await F.signInWithPopup(auth, p); }
  catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'].includes(e.code)) { await F.signInWithRedirect(auth, p); return; }
    if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request' && err) err.textContent = messageErreur(e);
  }
}

/* Paramètres : compte et accès des frères */
async function renderAccess(el){
  const admin = me.role === 'admin';
  el.innerHTML = `<fieldset><legend>Compte</legend><div class="row"><span style="flex:1;min-width:0"><b>${esc(me.email)}</b><br><span class="muted" style="font-size:13px">${esc(ROLES[me.role])}${me.email === OWNER ? ' · propriétaire' : ''}</span></span>
    <button type="button" class="btn sm" id="acc-out">Se déconnecter</button></div></fieldset>
    ${admin ? `<fieldset style="margin-top:14px"><legend>Accès des frères</legend><p class="muted" style="margin:0;font-size:13px">Ajoutez l’adresse Gmail de chaque frère qui doit voir ou préparer le programme.</p>
      <ul class="acc-list" id="acc-list"><li class="muted">Chargement…</li></ul>
      <div class="acc-add"><input type="email" id="acc-mail" placeholder="adresse@gmail.com" autocomplete="off">
        <select id="acc-role">${Object.entries(ROLES).map(([k, l]) => `<option value="${k}"${k === 'editeur' ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <button type="button" class="btn sm primary" id="acc-add">Ajouter</button></div><p class="muted" id="acc-msg" style="margin:6px 0 0;font-size:13px"></p></fieldset>` : ''}`;
  el.querySelector('#acc-out').onclick = () => F.signOut(auth);
  if (!admin) return;
  const list = el.querySelector('#acc-list'), msg = el.querySelector('#acc-msg');
  const charger = async () => {
    let rows = [];
    try { const s = await F.getDocs(F.collection(fs, 'membres')); rows = s.docs.map(d => ({ email: d.id, role: d.data().role })); }
    catch { list.innerHTML = '<li class="muted">Liste indisponible hors connexion.</li>'; return; }
    rows.sort((a, b) => a.email.localeCompare(b.email));
    list.innerHTML = `<li><span class="m"><b>${esc(OWNER)}</b><br><span class="muted" style="font-size:12.5px">Propriétaire · toujours responsable</span></span></li>` +
      rows.filter(r => r.email !== OWNER).map(r => `<li data-m="${esc(r.email)}"><span class="m">${esc(r.email)}</span>
        <select data-r>${Object.entries(ROLES).map(([k, l]) => `<option value="${k}"${k === r.role ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <button type="button" class="icon-btn" data-del aria-label="Retirer l’accès"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></li>`).join('');
    list.querySelectorAll('li[data-m]').forEach(li => {
      const m = li.dataset.m;
      li.querySelector('[data-r]').onchange = e => F.setDoc(F.doc(fs, 'membres', m), { role: e.target.value, ajoutePar: me.email }).then(() => msg.textContent = `Accès de ${m} modifié.`).catch(() => msg.textContent = 'Modification impossible.');
      li.querySelector('[data-del]').onclick = () => F.deleteDoc(F.doc(fs, 'membres', m)).then(() => { msg.textContent = `Accès de ${m} retiré.`; charger(); }).catch(() => msg.textContent = 'Suppression impossible.');
    });
  };
  el.querySelector('#acc-add').onclick = async () => {
    const m = el.querySelector('#acc-mail').value.trim().toLowerCase(), r = el.querySelector('#acc-role').value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)) { msg.textContent = 'Adresse e-mail invalide.'; return; }
    try { await F.setDoc(F.doc(fs, 'membres', m), { role: r, ajoutePar: me.email }); msg.textContent = `${m} a maintenant accès. Envoyez-lui le lien de l’application.`; el.querySelector('#acc-mail').value = ''; charger(); }
    catch { msg.textContent = 'Ajout impossible. Vérifiez la connexion internet.'; }
  };
  charger();
}
